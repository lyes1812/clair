import { BankError, compactIdentifier, decimalToCents, isoFromParts, isValidIban, type BankMovement, type BankStatement } from "./model";

// OFX 1.x (SGML, balises de valeur sans balise fermante) et 2.x (XML) lus par le même lecteur tolérant : une balise
// suivie d'un texte est une valeur, une balise suivie d'une autre balise ouvre un bloc. Le FITID est conservé comme
// référence mais n'entre pas dans la clé de dédoublonnage (il n'est pas toujours unique selon les banques).

type Node = { name: string; value: string | null; children: Node[] };

function decode(v: string): string {
  return v.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_m, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " })[e]!).trim();
}

function tree(source: string): Node {
  const start = source.search(/<OFX>/i);
  if (start === -1) throw new BankError("Fichier OFX sans balise <OFX>.");
  const body = source.slice(start).replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  const root: Node = { name: "#root", value: null, children: [] };
  const stack: Node[] = [root];
  const re = /<(\/?)([A-Za-z0-9_.]+)[^>]*>([^<]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const [, closing, rawName, rawText] = m;
    const name = rawName.toUpperCase();
    if (closing) {
      const at = stack.map((n) => n.name).lastIndexOf(name);
      if (at > 0) stack.length = at; // ferme le bloc et les éventuelles valeurs SGML non fermées qu'il contient
      continue;
    }
    const text = decode(rawText);
    const node: Node = { name, value: text ? text : null, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!text) stack.push(node);
    if (stack.length > 64) throw new BankError("OFX trop profond.");
  }
  return root;
}

const kid = (n: Node | undefined, name: string) => n?.children.find((c) => c.name === name);
const kids = (n: Node | undefined, name: string) => n?.children.filter((c) => c.name === name) ?? [];
const val = (n: Node | undefined, ...path: string[]) => {
  let cur = n;
  for (const p of path) cur = kid(cur, p);
  return cur?.value ?? null;
};
function findAll(n: Node, name: string, out: Node[] = []): Node[] {
  for (const c of n.children) { if (c.name === name) out.push(c); else findAll(c, name, out); }
  return out;
}

function ofxDate(raw: string | null): string | null {
  const m = raw ? /^(\d{4})(\d{2})(\d{2})/.exec(raw) : null;
  return m ? isoFromParts(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

export function parseOfx(text: string): { statements: BankStatement[]; warnings: string[] } {
  const root = tree(text);
  const blocks = [...findAll(root, "STMTRS"), ...findAll(root, "CCSTMTRS")];
  if (!blocks.length) throw new BankError("Fichier OFX sans relevé de compte (STMTRS).");
  const statements: BankStatement[] = [];
  const warnings: string[] = [];
  for (const [i, rs] of blocks.entries()) {
    const where = `Relevé OFX ${i + 1}`;
    const currency = val(rs, "CURDEF");
    if (currency && currency.toUpperCase() !== "EUR") throw new BankError(`${where} : devise ${currency}. Seul l'euro est lu en V1.`);
    const from = kid(rs, "BANKACCTFROM") ?? kid(rs, "CCACCTFROM");
    const acct = compactIdentifier(val(from, "ACCTID") ?? "");
    if (!acct) throw new BankError(`${where} : compte sans identifiant (ACCTID).`);
    const iban = isValidIban(acct);
    const identifier = iban ? acct : [val(from, "BANKID"), val(from, "BRANCHID"), acct].filter(Boolean).map((s) => compactIdentifier(s!)).join("");
    const list = kid(rs, "BANKTRANLIST");
    const movements: BankMovement[] = [];
    for (const [n, trn] of kids(list, "STMTTRN").entries()) {
      const at = `${where}, opération ${n + 1}`;
      const bookingDate = ofxDate(val(trn, "DTPOSTED"));
      if (!bookingDate) throw new BankError(`${at} : date (DTPOSTED) illisible.`);
      const amount = decimalToCents(val(trn, "TRNAMT") ?? "");
      if (amount === null) throw new BankError(`${at} : montant (TRNAMT) illisible.`);
      const name = val(trn, "NAME") ?? val(trn, "PAYEE", "NAME");
      const memo = val(trn, "MEMO");
      const label = [name, memo && memo !== name ? memo : null].filter(Boolean).join(" ") || "(sans libellé)";
      movements.push({ bookingDate, valueDate: ofxDate(val(trn, "DTUSER")), amountCents: amount, label, counterparty: null, reference: val(trn, "FITID") });
    }
    const ledger = kid(rs, "LEDGERBAL");
    const balDate = ofxDate(val(ledger, "DTASOF"));
    const balCents = decimalToCents(val(ledger, "BALAMT") ?? "");
    const closing = balDate && balCents !== null ? { date: balDate, cents: balCents } : null;
    const dates = movements.map((m) => m.bookingDate).sort();
    const start = ofxDate(val(list, "DTSTART")) ?? dates[0] ?? closing?.date;
    const end = ofxDate(val(list, "DTEND")) ?? closing?.date ?? dates[dates.length - 1];
    if (!start || !end) throw new BankError(`${where} : ni période, ni solde, ni opération.`);
    statements.push({ identifier, identifierKind: iban ? "iban" : "national", bank: val(rs, "BANKACCTFROM", "BANKID"), currency: "EUR", from: start, to: end, opening: null, closing, movements, rowBreaks: null });
  }
  return { statements, warnings };
}
