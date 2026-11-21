import { addDays, isIsoDate } from "@/lib/dates";
import { BankError, compactIdentifier, decimalToCents, isValidIban, type BankBalance, type BankMovement, type BankStatement } from "./model";
import { child, childrenOf, findAll, parseXml, textAt, type XmlNode } from "./xml";

// CAMT.053 (ISO 20022, relevé de fin de journée). Plusieurs relevés <Stmt> par fichier ; une écriture <Ntry> groupée
// (plusieurs <TxDtls>) est éclatée en autant de mouvements quand le détail est complet, sinon gardée entière.

const day = (raw: string | null): string | null => {
  const d = raw?.slice(0, 10) ?? null;
  return isIsoDate(d) ? d : null;
};
const dateOf = (node: XmlNode | undefined) => day(textAt(node, "Dt") ?? textAt(node, "DtTm"));

function signed(amountNode: XmlNode | undefined, indicator: string | null, where: string): number {
  const cents = amountNode ? decimalToCents(amountNode.text.trim(), ".") : null;
  if (cents === null || cents < 0) throw new BankError(`${where} : montant illisible.`);
  if (indicator !== "CRDT" && indicator !== "DBIT") throw new BankError(`${where} : sens (CdtDbtInd) absent ou inconnu.`);
  return indicator === "CRDT" ? cents : -cents;
}

function currencyOf(node: XmlNode | undefined): string | null {
  return node?.attrs.Ccy ?? null;
}

const partyName = (party: XmlNode | undefined) => textAt(party, "Nm") ?? textAt(party, "Pty", "Nm");

function txCounterparty(tx: XmlNode | undefined, credit: boolean): string | null {
  const rp = child(tx, "RltdPties");
  return credit ? partyName(child(rp, "Dbtr")) : partyName(child(rp, "Cdtr"));
}

function txLabel(tx: XmlNode | undefined): string | null {
  const ustrd = childrenOf(child(tx, "RmtInf"), "Ustrd").map((u) => u.text.trim()).filter(Boolean);
  if (ustrd.length) return ustrd.join(" ");
  return textAt(tx, "AddtlTxInf");
}

function readBalances(stmt: XmlNode, where: string) {
  let opening: BankBalance | null = null;
  let closing: BankBalance | null = null;
  for (const bal of childrenOf(stmt, "Bal")) {
    const code = textAt(bal, "Tp", "CdOrPrtry", "Cd") ?? textAt(bal, "Tp", "CdOrPrtry", "Prtry");
    const date = dateOf(child(bal, "Dt"));
    if (!code || !date) continue;
    const ccy = currencyOf(child(bal, "Amt"));
    if (ccy && ccy !== "EUR") throw new BankError(`${where} : solde en ${ccy}. Seul l'euro est lu en V1.`);
    const cents = signed(child(bal, "Amt"), textAt(bal, "CdtDbtInd"), `${where}, solde ${code}`);
    if (code === "OPBD") opening = { date, cents };
    else if (code === "PRCD" && !opening) opening = { date: addDays(date, 1), cents };
    else if (code === "CLBD") closing = { date, cents };
  }
  return { opening, closing };
}

export function parseCamt053(text: string): { statements: BankStatement[]; warnings: string[] } {
  const doc = parseXml(text);
  const roots = findAll(doc, "BkToCstmrStmt");
  if (!roots.length) throw new BankError("Fichier XML sans relevé CAMT.053 (BkToCstmrStmt).");
  const warnings: string[] = [];
  const statements: BankStatement[] = [];
  let pending = 0;
  let unsplit = 0;
  for (const root of roots) {
    for (const stmt of childrenOf(root, "Stmt")) {
      const where = `Relevé ${textAt(stmt, "Id") ?? statements.length + 1}`;
      const acct = child(stmt, "Acct");
      const iban = textAt(acct, "Id", "IBAN");
      const other = textAt(acct, "Id", "Othr", "Id");
      const identifier = compactIdentifier(iban ?? other ?? "");
      if (!identifier) throw new BankError(`${where} : compte sans identifiant (IBAN ou autre).`);
      if (iban && !isValidIban(iban)) throw new BankError(`${where} : IBAN invalide (clé de contrôle).`);
      const ccy = textAt(acct, "Ccy");
      if (ccy && ccy !== "EUR") throw new BankError(`${where} : compte en ${ccy}. Seul l'euro est lu en V1.`);
      const bank = textAt(acct, "Svcr", "FinInstnId", "BICFI") ?? textAt(acct, "Svcr", "FinInstnId", "BIC") ?? textAt(acct, "Svcr", "FinInstnId", "Nm");
      const { opening, closing } = readBalances(stmt, where);

      const movements: BankMovement[] = [];
      for (const [n, entry] of childrenOf(stmt, "Ntry").entries()) {
        const at = `${where}, écriture ${n + 1}`;
        const status = textAt(entry, "Sts", "Cd") ?? textAt(entry, "Sts");
        if (status && status !== "BOOK") { pending++; continue; }
        const ccyE = currencyOf(child(entry, "Amt"));
        if (ccyE && ccyE !== "EUR") throw new BankError(`${at} : montant en ${ccyE}. Seul l'euro est lu en V1.`);
        const amount = signed(child(entry, "Amt"), textAt(entry, "CdtDbtInd"), at);
        const bookingDate = dateOf(child(entry, "BookgDt"));
        if (!bookingDate) throw new BankError(`${at} : date de comptabilisation (BookgDt) absente.`);
        const valueDate = dateOf(child(entry, "ValDt"));
        const entryRef = textAt(entry, "AcctSvcrRef");
        const entryInfo = textAt(entry, "AddtlNtryInf");
        const txs = childrenOf(child(entry, "NtryDtls"), "TxDtls");
        const credit = amount > 0;

        // Virement groupé : éclaté seulement si chaque détail porte son montant et que leur somme égale l'écriture.
        if (txs.length > 1) {
          const parts = txs.map((tx) => {
            const amt = child(tx, "Amt") ?? child(child(child(tx, "AmtDtls"), "TxAmt"), "Amt");
            const ind = textAt(tx, "CdtDbtInd") ?? textAt(entry, "CdtDbtInd");
            try { return amt ? signed(amt, ind, at) : null; } catch { return null; }
          });
          if (parts.every((p) => p !== null) && parts.reduce((s, p) => s + p!, 0) === amount) {
            txs.forEach((tx, k) => movements.push({
              bookingDate, valueDate, amountCents: parts[k]!,
              label: txLabel(tx) ?? entryInfo ?? txCounterparty(tx, parts[k]! > 0) ?? "(sans libellé)",
              counterparty: txCounterparty(tx, parts[k]! > 0),
              reference: textAt(tx, "Refs", "AcctSvcrRef") ?? textAt(tx, "Refs", "EndToEndId") ?? entryRef,
            }));
            continue;
          }
          unsplit++;
        }
        const tx = txs[0];
        movements.push({
          bookingDate, valueDate, amountCents: amount,
          label: (txs.length === 1 ? txLabel(tx) : null) ?? entryInfo ?? txCounterparty(tx, credit) ?? "(sans libellé)",
          counterparty: txs.length === 1 ? txCounterparty(tx, credit) : null,
          reference: entryRef ?? (txs.length === 1 ? textAt(tx, "Refs", "EndToEndId") : null),
        });
      }
      const dates = movements.map((m) => m.bookingDate).sort();
      const from = day(textAt(stmt, "FrToDt", "FrDtTm")) ?? opening?.date ?? dates[0] ?? closing?.date;
      const to = day(textAt(stmt, "FrToDt", "ToDtTm")) ?? closing?.date ?? dates[dates.length - 1] ?? opening?.date;
      if (!from || !to) throw new BankError(`${where} : ni période, ni solde, ni mouvement.`);
      statements.push({ identifier, identifierKind: iban ? "iban" : "national", bank, currency: "EUR", from, to, opening, closing, movements, rowBreaks: null });
    }
  }
  if (!statements.length) throw new BankError("Aucun relevé <Stmt> dans le fichier CAMT.053.");
  if (pending) warnings.push(`${pending} écriture(s) non comptabilisée(s) (statut autre que BOOK) ignorée(s).`);
  if (unsplit) warnings.push(`${unsplit} écriture(s) groupée(s) au détail incomplet gardée(s) en un seul mouvement.`);
  return { statements, warnings };
}
