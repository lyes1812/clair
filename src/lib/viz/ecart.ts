import type { Cascade, masseByRubric } from "@/lib/budget/cascade";
import type { Bridge } from "@/lib/budget/series";
import { ROW_LABELS, ROW_UNIT, type Cell, type RowKey, type Version } from "@/lib/budget/versions";
import { formatEuros } from "@/lib/money";
import type { ChartSeries } from "@/components/charts/shared";
import { niceTicks } from "@/components/charts/scale";
import { unitFormat, type UnitName } from "@/components/charts/units";

// Adaptateurs purs de l'écart budgétaire et de l'analyse des écarts vers les graphiques : ils ne calculent rien de neuf,
// ils rangent les valeurs déjà calculées (grille de versions, cascade, pont). Une valeur absente reste null avec sa raison :
// jamais un zéro. Les graphiques client reçoivent ces structures en props : tout y est sérialisable.

export type RubricChart = { unit: "eur" | "etp" | "nombre"; series: ChartSeries[] };
export type EcartChartData = { categories: string[]; categoryTitles: string[]; byRubric: Record<string, RubricChart> };

// Rubriques proposées au sélecteur : celles que le tableau d'écart fournit (vue Détail), groupées par nature.
export const RUBRIC_GROUPS: { label: string; keys: RowKey[] }[] = [
  { label: "Effectifs", keys: ["etp", "headcount", "entrees", "sorties"] },
  { label: "Masse salariale", keys: ["masse", "brut", "remun", "primes", "indemnites", "autres", "charges", "nonventile"] },
];
export const RUBRIC_KEYS: RowKey[] = RUBRIC_GROUPS.flatMap((g) => g.keys);
// Libellés du sélecteur : le graphique donne la valeur de chaque mois, alors que le tableau donne la valeur de la période
// (moyenne des ETP de fin de mois, inscrits en fin de période, sommes). Les quatre rubriques d'effectif sont donc nommées
// « du mois » ou « de fin de mois » ; les montants gardent le libellé du tableau (le montant du mois).
export const CHART_LABELS: Record<RowKey, string> = {
  ...ROW_LABELS,
  etp: "ETP de fin de mois",
  headcount: "Inscrits en fin de mois",
  entrees: "Entrées du mois",
  sorties: "Sorties du mois",
};
export const rubricGroups = (): { label: string; options: { key: string; label: string }[] }[] =>
  RUBRIC_GROUPS.map((g) => ({ label: g.label, options: g.keys.map((k) => ({ key: k, label: CHART_LABELS[k] })) }));

// Teintes des versions : bleu (version 1), vert, bleu nuit. Trait plein pour la version 1, pointillés ensuite ; aire sous un scénario.
// Une teinte ne porte jamais seule l'information : numéro de version dans la légende, style de trait, infobulle.
export const VERSION_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)"];

const MONTH_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTH_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const rankShort = (month: string) => MONTH_SHORT[Number(month.slice(5, 7)) - 1] ?? month;
export const rankLong = (month: string) => MONTH_LONG[Number(month.slice(5, 7)) - 1] ?? month;

// Période choisie (rangs de mois « 01 » à « 12 ») en toutes lettres : « de janvier à décembre », « d'avril à juin », « en mars ».
const de = (name: string) => (/^[aeiouhéèêàâîôû]/i.test(name) ? `d'${name}` : `de ${name}`);
export function periodText(from: string, to: string): string {
  const a = MONTH_LONG[Number(from) - 1];
  const b = MONTH_LONG[Number(to) - 1];
  if (!a || !b) return `rangs de mois ${from}–${to}`;
  return from === to ? `en ${a}` : `${de(a)} à ${b}`;
}

const NA_REASON = "rubrique sans objet pour cette version";
const NO_MONTH = "mois non couvert par la version";

function point(c: Cell | undefined): { v: number | null; reason: string | null } {
  if (!c) return { v: null, reason: NO_MONTH };
  if (c.kind === "value") return { v: c.v, reason: null };
  if (c.kind === "nd") return { v: null, reason: c.reason };
  return { v: null, reason: NA_REASON };
}

// Une courbe par version et par rubrique, mois par mois. Les mois d'une version sont ceux de sa propre année (le mois i de la
// période de chaque version est tracé à la position i) ; l'axe porte les rangs de mois de la première version.
export function ecartChartData(versions: Version[], names: string[], monthsOf: (v: Version) => string[], keys: RowKey[] = RUBRIC_KEYS): EcartChartData {
  const first = versions[0] ? monthsOf(versions[0]) : [];
  const byRubric: Record<string, RubricChart> = {};
  for (const k of keys) {
    const series: ChartSeries[] = versions.map((v, i) => {
      const ms = monthsOf(v);
      const pts = first.map((_, c) => {
        const m = ms[c];
        const f = m === undefined ? undefined : v.months.get(m);
        return point(f ? (k === "etp" ? f.etp4 : f[k as Exclude<RowKey, "etp">]) : undefined);
      });
      return {
        key: `v${i + 1}`,
        name: `Version ${i + 1} · ${names[i] ?? v.label}`,
        values: pts.map((p) => p.v),
        reasons: pts.map((p) => p.reason),
        color: VERSION_COLORS[i % VERSION_COLORS.length],
        dashed: i > 0,
        area: v.kind === "scenario",
      };
    });
    byRubric[k] = { unit: ROW_UNIT[k], series };
  }
  return { categories: first.map(rankShort), categoryTitles: first.map(rankLong), byRubric };
}

// Cascades : départ, contributions signées, arrivée. Même contenu que les tableaux d'analyse, mêmes unités.
export type WaterfallData =
  | { kind: "value"; unit: "etp" | "eur"; start: number; end: number; steps: { label: string; value: number }[] }
  | { kind: "nd"; reason: string };

// ETP (dix-millièmes) : les cinq contributions de la cascade, plus le résiduel d'arrondi s'il n'est pas nul (il l'est par construction).
export function etpWaterfall(c: Cascade): WaterfallData {
  if (c.kind === "nd") return { kind: "nd", reason: c.reason };
  const steps = c.steps.map((s) => ({ label: s.label, value: s.etp4 }));
  if (c.residual !== 0) steps.push({ label: "Résiduel d'arrondi", value: c.residual });
  return { kind: "value", unit: "etp", start: c.start, end: c.end, steps };
}

// Masse salariale chargée (centimes) : une contribution par rubrique connue ; la part de l'écart que portent les rubriques
// n.d. figure en une barre « Rubriques n.d. » (le résiduel), jamais répartie entre elles.
export type MasseRubric = ReturnType<typeof masseByRubric>;
export function masseWaterfall(m: MasseRubric): WaterfallData {
  if (m.kind === "nd") return { kind: "nd", reason: m.reason };
  if (m.residual === null) return { kind: "nd", reason: "résiduel de la cascade n.d." };
  const steps = m.steps.filter((s) => s.delta !== null).map((s) => ({ label: s.label, value: s.delta as number }));
  const anyNd = m.steps.some((s) => s.delta === null);
  if (anyNd || m.residual !== 0) steps.push({ label: anyNd ? "Rubriques n.d." : "Résiduel", value: m.residual });
  return { kind: "value", unit: "eur", start: m.start, end: m.end, steps };
}

// Pont volume / coût moyen : coût de la version 1, effet volume, effet coût moyen, coût de la version 2 (centimes).
// La somme des deux effets égale l'écart (l'effet coût moyen est le reste). `bridge` est appelé avec la version 2 en premier
// argument (a) et la version 1 en second (b) : le départ est donc `b`, l'arrivée `a`.
export function pontWaterfall(p: Bridge): WaterfallData {
  if (p.kind === "nd") return { kind: "nd", reason: p.reason };
  return {
    kind: "value", unit: "eur", start: p.b.cost, end: p.a.cost,
    steps: [{ label: "Effet volume", value: p.volume }, { label: "Effet coût moyen", value: p.averageCost }],
  };
}

export { waterfallAxisBadge } from "./waterfall-axis";

// Signe moins typographique (« − », comme les ETP et les pourcentages) : formatEuros et String() écrivent un trait d'union.
// Réservé à l'affichage ; les exports CSV gardent le trait d'union (lisible par un tableur).
export const neg = (text: string) => (text.startsWith("-") ? `−${text.slice(1)}` : text);
// Montant en centimes avec son signe écrit : « +3 550,00 € », « −79,51 € », « 0,00 € ».
export const eurosSigned = (cents: number) => `${cents > 0 ? "+" : ""}${neg(formatEuros(cents))}`;
