import { formatEuros } from "@/lib/money";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";

// Unités des graphiques de Clair : euros en centimes, ETP en dix-millièmes, nombres entiers, pourcentages en points de base.
// Les graphiques reçoivent le NOM de l'unité (sérialisable des composants serveur vers les composants client), jamais une fonction. `fmt` donne la valeur exacte
// (infobulle, lecture au clavier) ; `axis` et `label` sont des versions courtes pour l'axe et les étiquettes de barres.
export type UnitName = "eur" | "etp" | "nombre" | "bps";
export type UnitFormat = { fmt: (v: number) => string; axis: (v: number) => string; label: (v: number) => string; integer: boolean; minSpan: number };

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
export function unitFormat(unit: UnitName): UnitFormat {
  if (unit === "eur") return { fmt: formatEuros, axis: compactEuros, label: labelEuros, integer: false, minSpan: 100_000 };
  if (unit === "etp") return { fmt: (v) => fmtFixed({ num: v, den: 10000 }, 2), axis: (v) => n2.format(v / 10000), label: (v) => fmtFixed({ num: v, den: 10000 }, 2), integer: false, minSpan: 10_000 };
  if (unit === "bps") return { fmt: (v) => fmtPercent({ num: v, den: 10000 }), axis: (v) => `${nf(2).format(v / 100)} %`, label: (v) => `${nf(1).format(v / 100)} %`, integer: false, minSpan: 100 };
  return { fmt: (v) => n0.format(v), axis: (v) => n0.format(v), label: (v) => n0.format(v), integer: true, minSpan: 5 };
}
