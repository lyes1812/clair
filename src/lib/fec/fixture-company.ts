import { FEC_FIELDS } from "./parser";

// FEC fictif d'une PME imaginaire pour les contrôles F01 à F09 (Cap 13, lot L1). Aucun nom de personne, SIREN fictif
// 000000000. Cas de référence calculé à la main (exercice 01/01/2026 → 31/12/2026, écritures jusqu'au 31/10/2026) :
//   13 écritures, 33 lignes, total débit = total crédit = 111 000,00 € ;
//   solde 512 au 31/10/2026 = 20 000 − 6 000 − 2 300 − 700 + 6 000 − 500 − 500 − 1 000 = 15 000,00 € (débiteur) ;
//   fournisseurs (401) : F001 3 000,00 € dont 3 000,00 non lettrés ; F002 700,00 € dont 700,00 non lettrés ;
//   F003 300,00 € (lettrage partiel AB), 0,00 non lettré ; total 4 000,00 €, non lettré 3 700,00 € (92,5 %) ;
//   comptes 401, 421, 431, 44x, 512 et 164 tous présents.
export const COMPANY_FEC_FILENAME = "000000000FEC20261231.txt";

type Row = [journal: string, journalLabel: string, num: string, date: string, account: string, accountLabel: string, aux: string, auxLabel: string, label: string, debit: string, credit: string, lettering: string, letteringDate: string];

const ROWS: Row[] = [
  ["AN", "A nouveaux", "1", "20260101", "512000", "Banque fictive", "", "", "Reprise des soldes", "20000,00", "0,00", "", ""],
  ["AN", "A nouveaux", "1", "20260101", "218000", "Matériel", "", "", "Reprise des soldes", "60000,00", "0,00", "", ""],
  ["AN", "A nouveaux", "1", "20260101", "164000", "Emprunt bancaire", "", "", "Reprise des soldes", "0,00", "50000,00", "", ""],
  ["AN", "A nouveaux", "1", "20260101", "401000", "Fournisseurs", "F001", "Fournisseur fictif Alpha", "Reprise des soldes", "0,00", "6000,00", "AA", "20260131"],
  ["AN", "A nouveaux", "1", "20260101", "101000", "Capital", "", "", "Reprise des soldes", "0,00", "24000,00", "", ""],
  ["AC", "Achats", "1", "20260115", "606000", "Achats non stockés", "", "", "Facture fictive n° 1 – 1 200 € TTC", "1000,00", "0,00", "", ""],
  ["AC", "Achats", "1", "20260115", "445660", "TVA déductible", "", "", "Facture fictive n° 1 – 1 200 € TTC", "200,00", "0,00", "", ""],
  ["AC", "Achats", "1", "20260115", "401000", "Fournisseurs", "F002", "Fournisseur fictif Œuvre", "Facture fictive n° 1 – 1 200 € TTC", "0,00", "1200,00", "", ""],
  ["AC", "Achats", "2", "20260210", "606000", "Achats non stockés", "", "", "Facture fictive n° 2", "2500,00", "0,00", "", ""],
  ["AC", "Achats", "2", "20260210", "445660", "TVA déductible", "", "", "Facture fictive n° 2", "500,00", "0,00", "", ""],
  ["AC", "Achats", "2", "20260210", "401000", "Fournisseurs", "F001", "Fournisseur fictif Alpha", "Facture fictive n° 2", "0,00", "3000,00", "", ""],
  ["AC", "Achats", "3", "20260220", "606000", "Achats non stockés", "", "", "Facture fictive n° 3", "800,00", "0,00", "", ""],
  ["AC", "Achats", "3", "20260220", "401000", "Fournisseurs", "F003", "Fournisseur fictif Gamma", "Facture fictive n° 3", "0,00", "800,00", "AB", "20260228"],
  ["BQ", "Banque", "1", "20260131", "401000", "Fournisseurs", "F001", "Fournisseur fictif Alpha", "Règlement fictif", "6000,00", "0,00", "AA", "20260131"],
  ["BQ", "Banque", "1", "20260131", "512000", "Banque fictive", "", "", "Règlement fictif", "0,00", "6000,00", "", ""],
  ["PA", "Paie", "1", "20260131", "641000", "Rémunérations", "", "", "Paie janvier", "3000,00", "0,00", "", ""],
  ["PA", "Paie", "1", "20260131", "421000", "Rémunérations dues", "", "", "Paie janvier", "0,00", "2300,00", "", ""],
  ["PA", "Paie", "1", "20260131", "431000", "Sécurité sociale", "", "", "Paie janvier", "0,00", "700,00", "", ""],
  ["BQ", "Banque", "2", "20260205", "421000", "Rémunérations dues", "", "", "Virement des salaires", "2300,00", "0,00", "", ""],
  ["BQ", "Banque", "2", "20260205", "512000", "Banque fictive", "", "", "Virement des salaires", "0,00", "2300,00", "", ""],
  ["BQ", "Banque", "3", "20260215", "431000", "Sécurité sociale", "", "", "Prélèvement URSSAF", "700,00", "0,00", "", ""],
  ["BQ", "Banque", "3", "20260215", "512000", "Banque fictive", "", "", "Prélèvement URSSAF", "0,00", "700,00", "", ""],
  ["BQ", "Banque", "7", "20260228", "401000", "Fournisseurs", "F003", "Fournisseur fictif Gamma", "Acompte fictif", "500,00", "0,00", "AB", "20260228"],
  ["BQ", "Banque", "7", "20260228", "512000", "Banque fictive", "", "", "Acompte fictif", "0,00", "500,00", "", ""],
  ["VT", "Ventes", "1", "20260301", "411000", "Clients", "C001", "Client fictif", "Facture client fictive", "6000,00", "0,00", "", ""],
  ["VT", "Ventes", "1", "20260301", "706000", "Prestations", "", "", "Facture client fictive", "0,00", "5000,00", "", ""],
  ["VT", "Ventes", "1", "20260301", "445710", "TVA collectée", "", "", "Facture client fictive", "0,00", "1000,00", "", ""],
  ["BQ", "Banque", "6", "20260310", "401000", "Fournisseurs", "F002", "Fournisseur fictif Œuvre", "Règlement partiel", "500,00", "0,00", "", ""],
  ["BQ", "Banque", "6", "20260310", "512000", "Banque fictive", "", "", "Règlement partiel", "0,00", "500,00", "", ""],
  ["BQ", "Banque", "4", "20260320", "512000", "Banque fictive", "", "", "Encaissement client", "6000,00", "0,00", "", ""],
  ["BQ", "Banque", "4", "20260320", "411000", "Clients", "C001", "Client fictif", "Encaissement client", "0,00", "6000,00", "", ""],
  ["BQ", "Banque", "5", "20261031", "164000", "Emprunt bancaire", "", "", "Échéance d'emprunt", "1000,00", "0,00", "", ""],
  ["BQ", "Banque", "5", "20261031", "512000", "Banque fictive", "", "", "Échéance d'emprunt", "0,00", "1000,00", "", ""],
];

// Ordre chronologique (tri stable : les lignes d'une écriture restent groupées).
const SORTED = [...ROWS].sort((a, b) => a[3].localeCompare(b[3]));

export type CompanyFecOptions = {
  delimiter?: "tab" | "pipe";
  amountFormat?: "debit-credit" | "montant-sens";
  encoding?: "utf-8" | "windows-1252";
  /** Modifie les lignes avant écriture (index 0 = première écriture). */
  mutate?: (rows: string[][]) => string[][];
};

const headers = (montantSens: boolean) => FEC_FIELDS.map((f, i) => (montantSens && i === 11 ? "Montant" : montantSens && i === 12 ? "Sens" : f));

function toCells(r: Row, montantSens: boolean): string[] {
  const [journal, journalLabel, num, date, account, accountLabel, aux, auxLabel, label, debit, credit, lettering, letteringDate] = r;
  const amount = montantSens ? (debit !== "0,00" ? [debit, "D"] : [credit, "C"]) : [debit, credit];
  return [journal, journalLabel, num, date, account, accountLabel, aux, auxLabel, `P-${journal}-${num}`, date, label, ...amount, lettering, letteringDate, date, "", ""];
}

export function companyFecText(o: CompanyFecOptions = {}): string {
  const montantSens = o.amountFormat === "montant-sens";
  const sep = o.delimiter === "pipe" ? "|" : "\t";
  const rows = (o.mutate ?? ((x) => x))(SORTED.map((r) => toCells(r, montantSens)));
  return [headers(montantSens), ...rows].map((cells) => cells.join(sep)).join("\r\n") + "\r\n";
}

// Windows-1252 : Latin-1 pour U+00A0–U+00FF, plus les caractères de la plage 0x80–0x9F utilisés ici.
const CP1252: Record<string, number> = { "€": 0x80, "–": 0x96, "Œ": 0x8c, "œ": 0x9c, "’": 0x92 };
export function encodeWindows1252(text: string): Uint8Array {
  return Uint8Array.from([...text].map((ch) => {
    if (CP1252[ch] !== undefined) return CP1252[ch];
    const code = ch.charCodeAt(0);
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code;
    throw new Error(`Caractère non encodable en Windows-1252 : ${ch}`);
  }));
}

export function companyFecBytes(o: CompanyFecOptions = {}): Uint8Array {
  const text = companyFecText(o);
  return o.encoding === "windows-1252" ? encodeWindows1252(text) : new TextEncoder().encode(text);
}

/**
 * FEC volumineux fictif : `lineCount` lignes (nombre pair), écritures d'achat de deux lignes (606000 / 401000) réparties
 * sur l'exercice 2026 entre 50 fournisseurs fictifs. Chaque écriture k vaut (k % 997 + 1) €.
 */
export function largeFecText(lineCount: number, sep = "\t"): string {
  const out: string[] = [headers(false).join(sep)];
  for (let k = 1; k <= lineCount / 2; k++) {
    const day = 1 + (k % 300);
    const d = new Date(Date.UTC(2026, 0, day));
    const date = d.toISOString().slice(0, 10).replace(/-/g, "");
    const amount = `${(k % 997) + 1},00`;
    const aux = `F${String(k % 50).padStart(3, "0")}`;
    out.push(["AC", "Achats", String(k), date, "606000", "Achats non stockés", "", "", `P${k}`, date, "Facture fictive", amount, "0,00", "", "", date, "", ""].join(sep));
    out.push(["AC", "Achats", String(k), date, "401000", "Fournisseurs", aux, `Fournisseur fictif ${aux}`, `P${k}`, date, "Facture fictive", "0,00", amount, "", "", date, "", ""].join(sep));
  }
  return out.join("\r\n") + "\r\n";
}
