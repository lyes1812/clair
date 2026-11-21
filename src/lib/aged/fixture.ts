import ExcelJS from "exceljs";

// Balance âgée fournisseurs fictive au 31/10/2026, cohérente avec le FEC fictif du lot L1 (fixture-company.ts), plus un
// fournisseur absent du FEC. Aucun nom de personne. Cas de référence écrit à la main :
//   Alpha  F001  FA-2026-002  10/02/2026  échéance 12/03/2026  3 000,00  (FEC : AC 2, 3 000,00 au 10/02 → règle 2)
//   Œuvre  F002  AC-1         15/01/2026  échéance 14/02/2026    700,00  (FEC : facture 1 200,00, règlement partiel 500,00)
//   Gamma  F003  AC-3         20/02/2026  échéance 20/12/2026    300,00
//   Delta  F004  FD-77        25/10/2026  échéance 24/11/2026    450,00  (absent du FEC)
//   Total 4 450,00 € ; FEC 401 au 31/10/2026 : 4 000,00 € ; écart 450,00 € (11,25 %), avertissement fort, détaillé sur Delta.
export const AGED_AS_OF = "2026-10-31";
export const AGED_ROWS = [
  ["Fournisseur fictif Alpha", "F001", "FA-2026-002", "10/02/2026", "12/03/2026", "3 000,00"],
  ["Fournisseur fictif Œuvre", "F002", "AC-1", "15/01/2026", "14/02/2026", "700,00"],
  ["Fournisseur fictif Gamma", "F003", "AC-3", "20/02/2026", "20/12/2026", "300,00"],
  ["Fournisseur fictif Delta", "F004", "FD-77", "25/10/2026", "24/11/2026", "450,00"],
];
const HEADER = ["Fournisseur", "Compte", "N° facture", "Date facture", "Échéance", "Non échu", "0-30 j", "Restant dû TTC"];

export function agedCsv(rows = AGED_ROWS): string {
  const lines = rows.map(([s, a, i, d, e, m]) => [s, a, i, d, e, "", "", m].join(";"));
  return ["Balance âgée fournisseurs fictive au 31/10/2026", "", HEADER.join(";"), ...lines, `Total;;;;;;;${"4 450,00"}`].join("\r\n") + "\r\n";
}

export async function agedXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Balance");
  ws.addRow(["Balance âgée fournisseurs fictive"]);
  ws.addRow(["Fournisseur", "Code tiers", "Numéro de facture", "Date de facture", "Date d'échéance", "Montant restant dû"]);
  const d = (fr: string) => { const [dd, mm, yy] = fr.split("/").map(Number); return new Date(Date.UTC(yy, mm - 1, dd)); };
  for (const [s, a, i, inv, due, m] of AGED_ROWS) ws.addRow([s, a, i, d(inv), d(due), Number(m.replace(/\s/g, "").replace(",", "."))]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
