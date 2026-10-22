import type { Shown } from "@/lib/rh/view";
import { reduce, roundHalfUp } from "./fraction";
import type { Delta, Kind, KpiNd, Ratio } from "./types";

// Affichage fr-FR depuis les fractions exactes : arrondi au plus proche (demi vers le haut), sans passer par un flottant.
const group = new Intl.NumberFormat("fr-FR");
const MINUS = "−";

function fixed(units: bigint, decimals: number): string {
  const neg = units < 0n;
  const a = neg ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const int = group.format(a / scale);
  const frac = decimals ? `,${(a % scale).toString().padStart(decimals, "0")}` : "";
  return `${neg ? MINUS : ""}${int}${frac}`;
}

export function fmtFixed(r: Ratio, decimals = 2): string {
  return fixed(roundHalfUp(r, decimals), decimals);
}

export const fmtEtp4 = (etp4: number): string => fmtFixed({ num: etp4, den: 10000 });

export function fmtPercent(r: Ratio): string {
  return `${fixed(roundHalfUp({ num: r.num * 100, den: r.den }, 2), 2)} %`;
}

export function fmtHalfDays(half: number): string {
  return `${half % 2 === 0 ? group.format(half / 2) : `${group.format((half - 1) / 2)},5`} j`;
}

const UNIT: Record<string, (r: Ratio) => string> = {
  etp: (r) => `${fmtFixed(r)} ETP`,
  persons: (r) => `${fmtFixed(r)} personne${Math.abs(r.num) > r.den ? "s" : ""}`,
  points: (r) => `${fmtFixed(r)} pts`,
};
export function fmtDelta(d: Delta): string {
  if (d.kind === "nd") return `n.d. — ${d.nd.reason}`;
  const text = UNIT[d.unit](d.value);
  return d.value.num > 0 ? `+${text}` : text;
}

export function fmtFraction(r: Ratio): string {
  const x = reduce(r);
  return `${x.num}/${x.den}`;
}

export function showKpi(v: { kind: Kind | "nd"; nd?: KpiNd | null }, text: () => string): Shown {
  if (v.kind === "nd") return { text: `n.d. — ${v.nd?.reason ?? "valeur absente"}`, kind: "nd" };
  if (v.kind === "lower_bound") return { text: `≥ ${text()}`, kind: "lower" };
  return { text: text(), kind: "value" };
}
