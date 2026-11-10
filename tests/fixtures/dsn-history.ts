// DSN intégralement fictive pour la recette historique : un contrat réellement
// déclaré dès janvier 2023, commencé en 2022. NIR à clé invalide, SIREN nul.
export const HISTORY_NIR = "2990175100010";
export const HISTORY_CONTRACT = "TEST-HISTORY-C-001";

export type HistoryDsnOptions = {
  month?: string;
  norm?: string;
  fraction?: string;
  order?: string;
  type?: "01" | "03";
  gross?: string | null;
  paidTime?: string | null;
  referenceQuota?: string | null;
  contractQuota?: string | null;
  netSocial?: { amount: string; startDate: string; endDate: string };
};

const date = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

export function historyDsnText(options: HistoryDsnOptions = {}): string {
  const month = options.month ?? "2023-01";
  const [year, rank] = month.split("-").map(Number);
  const monthEnd = `${month}-${String(new Date(Date.UTC(year, rank, 0)).getUTCDate()).padStart(2, "0")}`;
  const norm = options.norm ?? `P${String(year).slice(-2)}V01`;
  const gross = options.gross === undefined ? "1234.56" : options.gross;
  const paidTime = options.paidTime === undefined ? "121.33" : options.paidTime;
  const reference = options.referenceQuota === undefined ? "151.67" : options.referenceQuota;
  const quota = options.contractQuota === undefined ? "121.33" : options.contractQuota;
  const lines: string[] = [];
  const row = (code: string, value: string | number) => lines.push(`${code},'${value}'`);
  row("S10.G00.00.001", "TEST-HISTORY-100-PERCENT-FICTIF");
  row("S10.G00.00.006", norm);
  row("S20.G00.05.001", "01");
  row("S20.G00.05.002", options.type ?? "01");
  row("S20.G00.05.003", options.fraction ?? "11");
  row("S20.G00.05.004", options.order ?? "1");
  row("S20.G00.05.005", date(`${month}-01`));
  row("S21.G00.06.001", "000000000");
  row("S21.G00.11.001", "00011");
  row("S21.G00.30.001", HISTORY_NIR);
  row("S21.G00.30.002", "FICTIF-HISTORIQUE");
  row("S21.G00.30.004", "Test");
  row("S21.G00.30.019", "HIST-FICTIF-001");
  row("S21.G00.40.001", "01092022");
  row("S21.G00.40.007", "01");
  row("S21.G00.40.009", HISTORY_CONTRACT);
  row("S21.G00.40.011", "10");
  if (reference !== null) row("S21.G00.40.012", reference);
  if (quota !== null) row("S21.G00.40.013", quota);
  row("S21.G00.40.014", "20");
  if (gross !== null || options.netSocial) row("S21.G00.50.001", date(monthEnd));
  if (gross !== null) {
    row("S21.G00.51.001", date(`${month}-01`));
    row("S21.G00.51.002", date(monthEnd));
    row("S21.G00.51.010", HISTORY_CONTRACT);
    row("S21.G00.51.011", "001");
    row("S21.G00.51.013", gross);
    if (paidTime !== null) {
      row("S21.G00.53.001", "01");
      row("S21.G00.53.002", paidTime);
      row("S21.G00.53.003", "10");
    }
  }
  if (options.netSocial) {
    row("S21.G00.51.001", date(options.netSocial.startDate));
    row("S21.G00.51.002", date(options.netSocial.endDate));
    row("S21.G00.51.010", HISTORY_CONTRACT);
    row("S21.G00.51.011", "027");
    row("S21.G00.51.013", options.netSocial.amount);
  }
  row("S90.G00.90.001", lines.length + 2);
  row("S90.G00.90.002", 1);
  return `${lines.join("\r\n")}\r\n`;
}

export const historyDsnBytes = (options: HistoryDsnOptions = {}) => new TextEncoder().encode(historyDsnText(options));
