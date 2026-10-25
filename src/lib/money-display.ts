export type MoneyDisplayUnit = "eur" | "keur";

const whole = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** Unité de lecture seulement : les montants sources restent en centimes. */
export function formatMoneyDisplay(cents: number, unit: MoneyDisplayUnit, signed = false): string {
  if (!Number.isFinite(cents)) return "n.d.";
  const value = cents / (unit === "keur" ? 100_000 : 100);
  const divisor = unit === "keur" ? 100_000n : 100n;
  const absolute = Number.isSafeInteger(cents) ? BigInt(Math.abs(cents)) : null;
  const number = whole.format(absolute === null ? Math.abs(value) : absolute / divisor + (absolute % divisor * 2n >= divisor ? 1n : 0n));
  // Arrondir un petit écart à zéro ne doit pas afficher « −0 » ou « +0 ».
  const nonzero = /[1-9]/.test(number);
  const sign = nonzero && cents < 0 ? "−" : nonzero && signed && cents > 0 ? "+" : "";
  return `${sign}${number}\u00a0${unit === "keur" ? "k€" : "€"}`;
}

export type MoneyToken = { text: string; cents?: number; signed?: boolean };

// Uniquement les montants explicitement marqués €, produits par les vues existantes.
// Ni comptes, ni pourcentages, ni dates, ni nombres sans devise ne sont interprétés.
const euroToken = /(?<![\p{L}\p{N}_.,+−–-])([+−–-]?)(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:,(\d{2}))?[ \u00a0\u202f]*€(?![\p{L}\p{N}_])/gu;

export function moneyTextTokens(text: string): MoneyToken[] {
  const tokens: MoneyToken[] = [];
  let end = 0;
  for (const match of text.matchAll(euroToken)) {
    const start = match.index;
    const sign = match[1];
    const absolute = BigInt(match[2].replace(/[ \u00a0\u202f]/g, "")) * 100n + BigInt(match[3] ?? "0");
    if (absolute > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    if (start > end) tokens.push({ text: text.slice(end, start) });
    tokens.push({ text: match[0], cents: Number(absolute) * (sign && sign !== "+" ? -1 : 1), signed: sign === "+" });
    end = start + match[0].length;
  }
  if (end < text.length) tokens.push({ text: text.slice(end) });
  return tokens.length ? tokens : [{ text }];
}
