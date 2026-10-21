// Mois au format AAAA-MM.
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

export function monthRange(from: string, to: string): string[] {
  if (!isMonth(from) || !isMonth(to) || from > to) return [];
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  for (;;) {
    const value = `${y}-${String(m).padStart(2, "0")}`;
    if (value > to) break;
    out.push(value);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function monthBounds(month: string): { begin: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { begin: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
