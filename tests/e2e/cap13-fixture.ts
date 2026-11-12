// FEC fictif partagé par les parcours Cap 13 : SIREN fictif, écritures équilibrées, aucune donnée réelle.
// Arrêté au 28/02/2026 : disponibilités 37 804,33 €, dettes 65 500,00 €, soldes bancaires nets 35 804,33 €.
// Aucune écriture n'est lettrée : les postes fournisseurs ouverts égalent le solde net des comptes 40.
const HEADER = ["JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib", "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit", "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise"];
type Row = [journal: string, num: string, date: string, account: string, aux: string, debit: string, credit: string];
const ROWS: Row[] = [
  ["AN", "AN1", "20260101", "512000", "", "50000,00", "0,00"],
  ["AN", "AN1", "20260101", "530000", "", "150,00", "0,00"],
  ["AN", "AN1", "20260101", "503000", "", "1000,00", "0,00"],
  ["AN", "AN1", "20260101", "164000", "", "0,00", "30000,00"],
  ["AN", "AN1", "20260101", "519000", "", "0,00", "5000,00"],
  ["AN", "AN1", "20260101", "455000", "", "0,00", "7000,00"],
  ["AN", "AN1", "20260101", "101000", "", "0,00", "9150,00"],
  ["BQ", "BQ1", "20260115", "627000", "", "2000,00", "0,00"],
  ["BQ", "BQ1", "20260115", "512100", "", "0,00", "2000,00"],
  ["AC", "AC1", "20260120", "607000", "", "10000,00", "0,00"],
  ["AC", "AC1", "20260120", "401000", "F001", "0,00", "10000,00"],
  ["OD", "OD1", "20260201", "411000", "", "300,00", "0,00"],
  ["OD", "OD1", "20260201", "419000", "", "0,00", "300,00"],
  ["OD", "OD2", "20260201", "658000", "", "100,00", "0,00"],
  ["OD", "OD2", "20260201", "467000", "", "0,00", "100,00"],
  ["BQ", "BQ2", "20260205", "401000", "F001", "4000,00", "0,00"],
  ["BQ", "BQ2", "20260205", "512000", "", "0,00", "4000,00"],
  ["BQ", "BQ3", "20260206", "401000", "F002", "500,00", "0,00"],
  ["BQ", "BQ3", "20260206", "512000", "", "0,00", "500,00"],
  ["BQ", "BQ4", "20260210", "613000", "", "7845,67", "0,00"],
  ["BQ", "BQ4", "20260210", "512000", "", "0,00", "7845,67"],
  ["OD", "OD3", "20260228", "604000", "", "1200,00", "0,00"],
  ["OD", "OD3", "20260228", "408000", "", "0,00", "1200,00"],
  ["OD", "OD4", "20260228", "641000", "", "8000,00", "0,00"],
  ["OD", "OD4", "20260228", "421000", "", "0,00", "8000,00"],
  ["OD", "OD5", "20260228", "645000", "", "3500,00", "0,00"],
  ["OD", "OD5", "20260228", "431000", "", "0,00", "3500,00"],
  ["VT", "VT1", "20260228", "411000", "", "14400,00", "0,00"],
  ["VT", "VT1", "20260228", "706000", "", "0,00", "12000,00"],
  ["VT", "VT1", "20260228", "445710", "", "0,00", "2400,00"],
  ["OD", "OD6", "20260228", "445660", "", "900,00", "0,00"],
  ["OD", "OD6", "20260228", "471000", "", "0,00", "900,00"],
  // Après la date d'arrêté du cas de référence.
  ["AC", "AC2", "20260315", "607000", "", "2500,00", "0,00"],
  ["AC", "AC2", "20260315", "401000", "F001", "0,00", "2500,00"],
];
const fecText = [HEADER.join("\t"), ...ROWS.map(([journal, num, date, account, aux, debit, credit]) =>
  [journal, `Journal fictif ${journal}`, num, date, account, `Compte fictif ${account}`, aux, aux ? `Tiers fictif ${aux}` : "", `P-${num}`, date, `Écriture fictive ${num}`, debit, credit, "", "", date, "", ""].join("\t"))].join("\r\n");
export const CAP13_FEC = { name: "000000000FEC20261231.txt", mimeType: "text/plain", buffer: Buffer.from(fecText, "utf-8") };
