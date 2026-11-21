// Relevés bancaires (Cap 13, lot L2) : trois formats (CAMT.053, OFX, CSV) lus dans un seul modèle relevé → mouvements
// + soldes. Montants en centimes entiers signés (crédit positif, débit négatif). Aucun solde n'est déduit : un solde
// absent du fichier reste null et s'affiche « n.d. ».

export type BankFormat = "camt053" | "ofx" | "csv";
export const BANK_FORMAT_LABELS: Record<BankFormat, string> = { camt053: "CAMT.053", ofx: "OFX", csv: "CSV" };

export class BankError extends Error {}

/** Solde lu dans le fichier. `date` : jour du solde (ouverture = début de journée, clôture = fin de journée). */
export type BankBalance = { date: string; cents: number };

export type BankMovement = {
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  label: string;
  counterparty: string | null;
  reference: string | null;
};

export type BankStatement = {
  /** IBAN (sans espaces, en majuscules) ou numéro national du compte, tel que lu ou saisi. */
  identifier: string;
  identifierKind: "iban" | "national";
  bank: string | null;
  currency: string;
  /** Période couverte par le relevé, lue dans le fichier, sinon bornée par les mouvements. */
  from: string;
  to: string;
  opening: BankBalance | null;
  closing: BankBalance | null;
  movements: BankMovement[];
  /** Contrôle de continuité ligne à ligne propre au CSV avec colonne de solde (écarts relevés, null si non applicable). */
  rowBreaks: { line: number; gapCents: number }[] | null;
};

export type BankParseResult = { format: BankFormat; encoding: "utf-8" | "windows-1252"; statements: BankStatement[]; warnings: string[]; profile?: CsvProfile };

export type CsvProfile = {
  delimiter: ";" | "," | "\t";
  headerLine: number;
  columns: { date: number; valueDate: number | null; label: number; amount: number | null; debit: number | null; credit: number | null; balance: number | null };
  headers: string[];
  order: "chronological" | "reverse";
};

/** Libellé normalisé (clé de dédoublonnage et règles de libellé) : majuscules sans accents, espaces réduits. */
export function normalizeLabel(label: string): string {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

export function compactIdentifier(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** IBAN valide : structure et clé ISO 13616 (modulo 97). */
export function isValidIban(raw: string): boolean {
  const iban = compactIdentifier(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** Affichage masqué : « FR76 … 1234 » pour un IBAN, « … 1234 » pour un numéro national. */
export function maskIdentifier(identifier: string, kind: "iban" | "national"): string {
  const id = compactIdentifier(identifier);
  const tail = id.slice(-4);
  return kind === "iban" ? `${id.slice(0, 4)} … ${tail}` : `… ${tail}`;
}

/** Montant décimal (point ou virgule, espaces de milliers admis) en centimes ; null si illisible. */
export function decimalToCents(raw: string, decimal: "." | "," | "auto" = "auto"): number | null {
  let v = raw.replace(/[\s  €]/g, "");
  if (!v) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(v)) { sign = -1; v = v.slice(1, -1); }
  if (v.startsWith("-")) { sign = -sign; v = v.slice(1); } else if (v.startsWith("+")) v = v.slice(1);
  if (v.endsWith("-")) { sign = -sign; v = v.slice(0, -1); }
  const sep = decimal === "auto" ? (v.includes(",") ? "," : ".") : decimal;
  if (sep === ",") v = v.replace(/\./g, "").replace(",", ".");
  else v = v.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? sign * cents : null;
}

export function isoFromParts(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Mouvements en ordre de lecture ; rang d'apparition d'un mouvement identique le même jour (1, 2…). */
export function occurrenceRanks(movements: BankMovement[]): number[] {
  const seen = new Map<string, number>();
  return movements.map((m) => {
    const k = `${m.bookingDate}\u0000${m.amountCents}\u0000${normalizeLabel(m.label)}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n;
  });
}
