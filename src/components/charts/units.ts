import { formatEuros } from "@/lib/money";
import { formatMoneyDisplay, type MoneyDisplayUnit } from "@/lib/money-display";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";

// Unités des graphiques de Clair : euros en centimes, ETP en dix-millièmes, nombres entiers, pourcentages en points de base.
// Les graphiques reçoivent le NOM de l'unité (sérialisable des composants serveur vers les composants client), jamais une fonction. `fmt` donne la valeur exacte
// (infobulle, lecture au clavier) ; `axis` et `label` sont des versions courtes pour l'axe et les étiquettes de barres.
export type UnitName = "eur" | "etp" | "nombre" | "bps";
export type UnitFormat = { fmt: (v: number) => string; axis: (v: number) => string; label: (v: number) => string; signed: (v: number) => string; integer: boolean; minSpan: number };

// Réserver la même marge en € et en k€ : changer l'unité de lecture ne déplace pas les barres ou les courbes.
export function axisLabelWidth(unit: UnitName, ticks: number[]): number {
  const labels = unit === "eur"
    ? ticks.flatMap((v) => [formatMoneyDisplay(v, "eur"), formatMoneyDisplay(v, "keur")])
    : ticks.map(unitFormat(unit).axis);
  return Math.ceil(Math.max(0, ...labels.map((label) => label.length)) * 6.1) + 12;
}

// Une plage très petite peut produire plusieurs graduations arrondies identiques en k€ : les traits restent,
// mais le même libellé n'est écrit qu'une fois. Les coordonnées et l'étendue ne sont jamais arrondies.
export function axisTexts(ticks: number[], format: (v: number) => string): string[] {
  const seen = new Set<string>();
  return ticks.map((v) => {
    const text = format(v);
    if (seen.has(text)) return "";
    seen.add(text);
    return text;
  });
}

export function chartUnitText(text: string, unit: UnitName, moneyUnit: MoneyDisplayUnit): string {
  if (unit !== "eur" || moneyUnit === "eur") return text;
  return text.replace(/\beuros\b/g, "k€").replace(/\(€\)/g, "(k€)").replace(/\ben €/g, "en k€");
}

const nf = (digits: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: digits });
const n0 = nf(0);
const n2 = nf(2);

// 1 640 000 € → « 1,64 M€ » ; 42 000 € → « 42 k€ » ; 12 500 € → « 12,5 k€ » ; 850 € → « 850 € ». Deux décimales au plus :
// une graduation à 12 500 € ne doit pas s'arrondir en « 13 k€ ».
export function compactEuros(cents: number): string {
  const e = cents / 100;
  const a = Math.abs(e);
  if (a >= 1_000_000) return `${n2.format(e / 1_000_000)} M€`;
  if (a >= 1_000) return `${n2.format(e / 1_000)} k€`;
  return `${n0.format(e)} €`;
}

// Étiquette au-dessus d'une barre : une décimale fixe en k€ (« 24,6 k€ », « 19,5 k€ »), jamais deux largeurs différentes.
const n1f = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function labelEuros(cents: number): string {
  const e = cents / 100;
  const a = Math.abs(e);
  if (a >= 1_000_000) return `${n2.format(e / 1_000_000)} M€`;
  if (a >= 1_000) return `${n1f.format(e / 1_000)} k€`;
  return `${n0.format(e)} €`;
}

// minSpan : étendue minimale d'un axe, pour qu'un graphique dont toutes les valeurs sont nulles garde des graduations lisibles
// (0 %, 0,2 %, 0,4 %… et non six fois « 0 % »).
export function unitFormat(unit: UnitName, moneyUnit?: MoneyDisplayUnit): UnitFormat {
  // Le choix € / k€ change les textes, jamais les centimes transmis au tracé ni le domaine de l'axe.
  if (unit === "eur" && moneyUnit) {
    const fmt = (v: number) => formatMoneyDisplay(v, moneyUnit);
    return { fmt, axis: fmt, label: fmt, signed: (v) => formatMoneyDisplay(v, moneyUnit, true), integer: false, minSpan: 100_000 };
  }
  if (unit === "eur") return { fmt: formatEuros, axis: compactEuros, label: labelEuros, signed: (v) => `${v > 0 ? "+" : ""}${formatEuros(v)}`, integer: false, minSpan: 100_000 };
  if (unit === "etp") {
    const fmt = (v: number) => fmtFixed({ num: v, den: 10000 }, 2);
    return { fmt, axis: (v) => n2.format(v / 10000), label: fmt, signed: (v) => `${v > 0 ? "+" : ""}${fmt(v)}`, integer: false, minSpan: 10_000 };
  }
  if (unit === "bps") {
    const fmt = (v: number) => fmtPercent({ num: v, den: 10000 });
    return { fmt, axis: (v) => `${nf(2).format(v / 100)} %`, label: (v) => `${nf(1).format(v / 100)} %`, signed: (v) => `${v > 0 ? "+" : ""}${fmt(v)}`, integer: false, minSpan: 100 };
  }
  const fmt = (v: number) => n0.format(v);
  return { fmt, axis: fmt, label: fmt, signed: (v) => `${v > 0 ? "+" : ""}${fmt(v)}`, integer: true, minSpan: 5 };
}
