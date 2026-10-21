// Dates calendaires (AAAA-MM-JJ) et mois (AAAA-MM), sans fuseau : comparaisons lexicographiques exactes.
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function todayParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Présence d'un contrat à une date : début et fin inclus ; fin inconnue (null) = contrat ouvert.
export function isActiveOn(startDate: string, endDate: string | null, date: string): boolean {
  return startDate <= date && (endDate === null || endDate >= date);
}

// Le contrat recouvre-t-il au moins un jour du mois ?
export function overlapsMonth(startDate: string, endDate: string | null, month: string): boolean {
  return startDate <= monthEnd(month) && (endDate === null || endDate >= monthStart(month));
}

export const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "UTC" });
export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : "n.d.";
}

const MONTH_FMT = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
export function formatMonth(month: string): string {
  const s = MONTH_FMT.format(new Date(`${month}-01T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
