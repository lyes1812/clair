// Montants en centimes entiers ; conversion exacte depuis une chaîne ou un nombre décimal, sans flottant.
export type Money = { cents: number; currency: string };

export function toCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    value = value.toString();
  }
  if (typeof value !== "string") return null;
  const s = value.trim().replace(/\s/g, "").replace(",", ".");
  const m = /^([+-]?)(\d+)(?:\.(\d{1,2})(0*))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] === "-" ? -cents : cents;
}

export function formatEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}
