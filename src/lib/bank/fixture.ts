import { addDays, addMonths, monthEnd, monthStart } from "@/lib/dates";
import type { BankMovement } from "./model";

// Relevés bancaires fictifs (développement et tests) : une PME imaginaire, aucun nom de personne, aucun compte réel.
// L'IBAN est construit avec une clé valide à partir d'un numéro de compte inventé.

export function fixtureIban(bban = "30001000010000000123456"): string {
  // FR + clé ISO 13616 calculée pour un BBAN fictif (banque 30001, guichet 00001, compte 00000001234, clé RIB 56).
  const digits = (bban + "FR00").replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return `FR${String(98 - rest).padStart(2, "0")}${bban}`;
}

export type FixtureMonth = { month: string; movements: BankMovement[] };

/** Mouvements d'un mois : encaissements clients chaque lundi, salaires, URSSAF, loyer, fournisseurs et frais bancaires. */
export function fixtureMovements(month: string): BankMovement[] {
  const out: BankMovement[] = [];
  const seed = Number(month.slice(5, 7));
  const push = (day: string, amountCents: number, label: string, counterparty: string | null = null) =>
    out.push({ bookingDate: day, valueDate: day, amountCents, label, counterparty, reference: null });
  for (let d = monthStart(month); d <= monthEnd(month); d = addDays(d, 1)) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 1) push(d, 1_850_000 + seed * 10_000, "VIR SEPA RECU CLIENT ATELIERS DU NORD", "ATELIERS DU NORD");
  }
  push(`${month}-05`, -420_000, "PRLV SEPA LOYER SCI DES TILLEULS", "SCI DES TILLEULS");
  push(`${month}-10`, -315_000, "PRLV SEPA URSSAF", "URSSAF");
  push(`${month}-12`, -96_000, "VIR SEPA EMIS FOURNISSEUR PAPETERIE CENTRALE", "PAPETERIE CENTRALE");
  push(`${month}-12`, -96_000, "VIR SEPA EMIS FOURNISSEUR PAPETERIE CENTRALE", "PAPETERIE CENTRALE");
  push(`${month}-20`, -1_200_000, "VIR SEPA SALAIRES DU MOIS");
  push(`${month}-28`, -4_500, "FRAIS TENUE DE COMPTE");
  return out.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
}

export function fixtureMonths(lastMonth: string, count: number): FixtureMonth[] {
  return Array.from({ length: count }, (_, i) => addMonths(lastMonth, i - count + 1)).map((month) => ({ month, movements: fixtureMovements(month) }));
}

const amount = (cents: number) => (Math.abs(cents) / 100).toFixed(2);
const sum = (ms: BankMovement[]) => ms.reduce((t, m) => t + m.amountCents, 0);

/** Fichier CAMT.053 : un relevé <Stmt> par mois, soldes OPBD et CLBD cohérents à partir de `openingCents`. */
export function fixtureCamt(months: FixtureMonth[], openingCents: number, iban = fixtureIban()): string {
  let balance = openingCents;
  const stmts = months.map(({ month, movements }, i) => {
    const open = balance;
    balance += sum(movements);
    const bal = (code: string, cents: number, date: string) =>
      `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${amount(cents)}</Amt><CdtDbtInd>${cents < 0 ? "DBIT" : "CRDT"}</CdtDbtInd><Dt><Dt>${date}</Dt></Dt></Bal>`;
    const entries = movements.map((m) => {
      const party = m.counterparty ? (m.amountCents > 0 ? `<Dbtr><Nm>${m.counterparty}</Nm></Dbtr>` : `<Cdtr><Nm>${m.counterparty}</Nm></Cdtr>`) : "";
      return `<Ntry><Amt Ccy="EUR">${amount(m.amountCents)}</Amt><CdtDbtInd>${m.amountCents < 0 ? "DBIT" : "CRDT"}</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>${m.bookingDate}</Dt></BookgDt><ValDt><Dt>${m.valueDate}</Dt></ValDt><NtryDtls><TxDtls>${party ? `<RltdPties>${party}</RltdPties>` : ""}<RmtInf><Ustrd>${m.label}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`;
    }).join("");
    return `<Stmt><Id>FIXTURE-${month}-${i + 1}</Id><FrToDt><FrDtTm>${monthStart(month)}T00:00:00</FrDtTm><ToDtTm>${monthEnd(month)}T23:59:59</ToDtTm></FrToDt><Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>EUR</Ccy><Svcr><FinInstnId><BICFI>FIXTFRPPXXX</BICFI></FinInstnId></Svcr></Acct>${bal("OPBD", open, monthStart(month))}${bal("CLBD", balance, monthEnd(month))}${entries}</Stmt>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>FIXTURE</MsgId><CreDtTm>2026-01-01T00:00:00</CreDtTm></GrpHdr>${stmts}</BkToCstmrStmt></Document>`;
}

const ofxDate = (iso: string) => iso.replace(/-/g, "");

/** Fichier OFX 1.x (SGML, balises de valeur non fermées), une période, solde de clôture LEDGERBAL. */
export function fixtureOfx(months: FixtureMonth[], openingCents: number, account = { bank: "30001", branch: "00001", acct: "00000001234" }): string {
  const all = months.flatMap((m) => m.movements);
  const closing = openingCents + sum(all);
  const first = monthStart(months[0].month);
  const last = monthEnd(months[months.length - 1].month);
  const trns = all.map((m, i) => `<STMTTRN>\n<TRNTYPE>${m.amountCents < 0 ? "DEBIT" : "CREDIT"}\n<DTPOSTED>${ofxDate(m.bookingDate)}\n<TRNAMT>${(m.amountCents / 100).toFixed(2).replace(".", ",")}\n<FITID>${ofxDate(m.bookingDate)}${i}\n<NAME>${m.label.slice(0, 32)}\n<MEMO>${m.label}\n</STMTTRN>`).join("\n");
  return `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\n\n<OFX>\n<BANKMSGSRSV1>\n<STMTTRNRS>\n<STMTRS>\n<CURDEF>EUR\n<BANKACCTFROM>\n<BANKID>${account.bank}\n<BRANCHID>${account.branch}\n<ACCTID>${account.acct}\n<ACCTTYPE>CHECKING\n</BANKACCTFROM>\n<BANKTRANLIST>\n<DTSTART>${ofxDate(first)}\n<DTEND>${ofxDate(last)}\n${trns}\n</BANKTRANLIST>\n<LEDGERBAL>\n<BALAMT>${(closing / 100).toFixed(2).replace(".", ",")}\n<DTASOF>${ofxDate(last)}\n</LEDGERBAL>\n</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>\n`;
}

/** Export CSV à la française : « ; », virgule décimale, JJ/MM/AAAA, plus récent en premier, colonne de solde. */
export function fixtureCsv(months: FixtureMonth[], openingCents: number): string {
  const all = months.flatMap((m) => m.movements);
  let balance = openingCents;
  const rows = all.map((m) => {
    balance += m.amountCents;
    const [y, mo, d] = m.bookingDate.split("-");
    const fr = (c: number) => (c / 100).toFixed(2).replace(".", ",");
    return `${d}/${mo}/${y};${m.label};${m.amountCents < 0 ? fr(-m.amountCents) : ""};${m.amountCents > 0 ? fr(m.amountCents) : ""};${fr(balance)}`;
  });
  return ["Compte courant fictif", "", "Date;Libellé;Débit;Crédit;Solde", ...rows.reverse(), "", "Fin du relevé"].join("\r\n");
}
