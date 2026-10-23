import type { ChartSeries } from "@/components/charts/shared";
import { fmtEtp4, fmtPercent } from "@/lib/rh/kpi/format";
import { roundHalfUp } from "@/lib/rh/kpi/fraction";

// Adaptateurs purs « résultat du moteur → séries de graphique » de l'écran KPI RH et des effectifs mensuels.
// Aucun calcul métier : chaque valeur vient d'un résultat déjà calculé ; un n.d. reste n.d. (null + raison), une borne
// basse n'est jamais tracée comme une valeur exacte (la valeur « ≥ x » est dans le tableau), rien n'est ramené à zéro.
// Les séries sont sérialisables (composants client) : jamais de fonction.

// --- Entrées minimales (les types du moteur y sont assignables)
type Nd = { nd: { reason: string } };
type Ratio = { num: number; den: number };
export type HeadcountIn = { kind: "exact" | "lower_bound"; persons: number } | ({ kind: "nd" } & Nd);
export type EtpIn = { kind: "exact" | "lower_bound"; etp4: number } | ({ kind: "nd" } & Nd);
export type CountIn = { kind: "exact" | "lower_bound"; value: number } | ({ kind: "nd" } & Nd);
export type RatioIn = { kind: "exact" | "lower_bound"; ratio: Ratio } | ({ kind: "nd" } & Nd);
export type RowIn = {
  month: string;
  headcount: HeadcountIn;
  etp: EtpIn;
  movements: { entries: CountIn; exits: CountIn };
  absenteeism: RatioIn;
  previous: { month: string; etp: EtpIn; absenteeism: RatioIn };
};
export type CategoryMonthIn =
  | { kind: "value"; month: string; lowerBound: boolean; byCategory: Record<string, { headcount: number; etp4: number | null }> }
  | { kind: "nd"; month: string; reason: string };
type CellIn = { kind: "value"; v: number } | { kind: "nd"; reason: string } | { kind: "na" };
export type GridIn = { months: string[]; groups: string[]; cell: (group: string, month: string) => CellIn; total: (month: string) => CellIn };

// --- Teintes et libellés
// Teintes de série de la charte (--chart-1 … --chart-8) : explicites, pour que l'anneau, les barres et les tableaux
// donnent la même teinte au même groupe, même quand un groupe à zéro disparaît de l'anneau.
export const groupColor = (i: number): string => `var(--chart-${(i % 8) + 1})`;

const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const idx = (m: string) => Number(m.slice(5, 7)) - 1;
export const monthShortLabel = (m: string): string => SHORT[idx(m)] ?? m;
export const monthLongLabel = (m: string): string => (LONG[idx(m)] ? `${LONG[idx(m)]} ${m.slice(0, 4)}` : m);

// Étiquettes d'axe : « janv. » seul dans une même année, « oct. 25 » dès que les mois couvrent deux années (12 mois glissants).
export function monthAxis(months: string[], previous?: string[]): { categories: string[]; titles: string[] } {
  const years = new Set(months.map((m) => m.slice(0, 4)));
  return {
    categories: months.map((m) => (years.size > 1 ? `${monthShortLabel(m)} ${m.slice(2, 4)}` : monthShortLabel(m))),
    titles: months.map((m, i) => (previous?.[i] ? `${monthLongLabel(m)} · N-1 : ${monthLongLabel(previous[i])}` : monthLongLabel(m))),
  };
}

// --- Points
type Point = { value: number | null; reason: string | null };
const known = (value: number): Point => ({ value, reason: null });
const absent = (reason: string): Point => ({ value: null, reason });
const LOWER = "source incomplète, non tracée comme valeur exacte";
const bound = (shown: string): Point => absent(`borne basse (≥ ${shown}) : ${LOWER}`);

const nf = new Intl.NumberFormat("fr-FR");

// Fraction exacte → points de base (1 pb = 0,01 %), arrondi au plus proche, demi vers le haut : l'arrondi de fmtPercent,
// donc l'infobulle affiche le même « 6,91 % » que le tableau.
export const ratioBps = (r: Ratio): number => Number(roundHalfUp({ num: r.num * 100, den: r.den }, 2));

// Les trois issues d'un résultat du moteur : exact (tracé), borne basse (non tracée, valeur dans la raison), n.d. (non tracé).
const headcountPoint = (h: HeadcountIn): Point => (h.kind === "nd" ? absent(h.nd.reason) : h.kind === "lower_bound" ? bound(nf.format(h.persons)) : known(h.persons));
const etpPoint = (e: EtpIn): Point => (e.kind === "nd" ? absent(e.nd.reason) : e.kind === "lower_bound" ? bound(`${fmtEtp4(e.etp4)} ETP`) : known(e.etp4));
const countPoint = (c: CountIn): Point => (c.kind === "nd" ? absent(c.nd.reason) : c.kind === "lower_bound" ? bound(nf.format(c.value)) : known(c.value));
// Un dénominateur nul n'est jamais tracé (le moteur le rend déjà n.d. ; la garde évite qu'un taux indéfini fasse échouer l'écran).
const ratePoint = (r: RatioIn): Point =>
  r.kind === "nd" ? absent(r.nd.reason) : r.ratio.den <= 0 ? absent("dénominateur nul : taux non défini") : r.kind === "lower_bound" ? bound(fmtPercent(r.ratio)) : known(ratioBps(r.ratio));

function series(key: string, name: string, points: Point[], extra: Partial<Pick<ChartSeries, "color" | "dashed" | "area">> = {}): ChartSeries {
  return { key, name, values: points.map((p) => p.value), reasons: points.map((p) => p.reason), ...extra };
}

// --- Écran KPI RH (une valeur par mois de la fenêtre ; N-1 = même mois un an plus tôt)
export const headcountSeries = (rows: RowIn[]): ChartSeries[] => [series("effectif", "Effectif fin de mois (personnes)", rows.map((r) => headcountPoint(r.headcount)))];

export const etpSeries = (rows: RowIn[]): ChartSeries[] => [
  series("etp", "ETP fin de mois", rows.map((r) => etpPoint(r.etp))),
  series("etp-n1", "ETP N-1 (même mois un an plus tôt)", rows.map((r) => etpPoint(r.previous.etp)), { dashed: true }),
];

export const movementSeries = (rows: RowIn[]): ChartSeries[] => [
  series("entrees", "Entrées comptées", rows.map((r) => countPoint(r.movements.entries))),
  series("sorties", "Sorties comptées", rows.map((r) => countPoint(r.movements.exits))),
];

export const absenteeismSeries = (rows: RowIn[]): ChartSeries[] => [
  series("absenteisme", "Absentéisme du mois", rows.map((r) => ratePoint(r.absenteeism))),
  series("absenteisme-n1", "Absentéisme N-1 (même mois un an plus tôt)", rows.map((r) => ratePoint(r.previous.absenteeism)), { dashed: true }),
];

// Taux d'une période (turnover, absentéisme) : deux colonnes, la période précédente (N-1) puis la période affichée.
export function comparedRate(name: string, previous: { label: string; value: RatioIn }, current: { label: string; value: RatioIn }): { categories: string[]; titles: string[]; series: ChartSeries[] } {
  return {
    categories: ["N-1", "Période"],
    titles: [`N-1 : ${previous.label}`, `Période : ${current.label}`],
    series: [series("taux", name, [ratePoint(previous.value), ratePoint(current.value)])],
  };
}

// Effectif et ETP de fin de mois par catégorie (même calcul que l'ETP contractuel de fin de mois). Une catégorie absente
// d'un mois connu n'a aucun contrat ce mois-là : zéro réel, comme dans le tableau (« — »). Un mois n.d. ou en borne basse
// n'est pas tracé ; un ETP n.d. (contrat sans quotité) reste n.d.
export function categorySeries(months: CategoryMonthIn[], keys: string[], labels: Record<string, string>, measure: "etp" | "headcount"): ChartSeries[] {
  const gate = (m: CategoryMonthIn): Point | null => (m.kind === "nd" ? absent(m.reason) : m.lowerBound ? absent(`borne basse : ${LOWER}`) : null);
  // Aucune catégorie lue : une série « Total » porte les raisons des mois n.d. (et 0 pour un mois connu sans contrat).
  if (keys.length === 0) return [series("total", "Total", months.map((m) => gate(m) ?? known(0)), { color: groupColor(0) })];
  return keys.map((k, i) => {
    const pts = months.map((m): Point => {
      const g = gate(m);
      if (g) return g;
      const x = m.kind === "value" ? m.byCategory[k] : undefined;
      if (!x) return known(0);
      if (measure === "headcount") return known(x.headcount);
      return x.etp4 === null ? absent("ETP n.d. : au moins un contrat de la catégorie sans quotité lisible") : known(x.etp4);
    });
    return series(k, labels[k] ?? k, pts, { color: groupColor(i) });
  });
}

// --- Effectifs mensuels (grille mesure × groupe × mois)
const cellPoint = (c: CellIn): Point => (c.kind === "value" ? known(c.v) : absent(c.kind === "nd" ? c.reason : "non applicable"));

// Une série par groupe, mois par mois, teinte du groupe. Sans aucun groupe (aucun mouvement sur l'année), une seule
// série « Total » porte les zéros réels des mois connus et les n.d. des autres.
export function gridSeries(g: GridIn): ChartSeries[] {
  if (g.groups.length === 0) return [series("total", "Total", g.months.map((m) => cellPoint(g.total(m))), { color: groupColor(0) })];
  return g.groups.map((grp, i) => series(grp, grp, g.months.map((m) => cellPoint(g.cell(grp, m))), { color: groupColor(i) }));
}

// Répartition : un stock se lit au dernier mois connu, un flux se cumule sur les mois connus (un mois n.d. n'est pas compté).
export function repartition(g: GridIn, stock: boolean): { known: string[]; used: string[]; items: { group: string; v: number }[]; total: number } {
  const knownMonths = g.months.filter((m) => g.total(m).kind === "value");
  const used = stock ? knownMonths.slice(-1) : knownMonths;
  const items = g.groups.map((group) => ({ group, v: used.reduce((s, m) => s + ((c) => (c.kind === "value" ? c.v : 0))(g.cell(group, m)), 0) }));
  return { known: knownMonths, used, items, total: items.reduce((s, x) => s + x.v, 0) };
}

// Série entièrement absente : le graphique est remplacé par la raison (une ligne vide ou une rangée de colonnes hachurées
// ne dirait rien). null dès qu'une valeur est connue.
export function ndSummary(list: ChartSeries[]): string | null {
  if (list.some((s) => s.values.some((v) => v !== null && v !== undefined))) return null;
  const reasons = [...new Set(list.flatMap((s) => (s.reasons ?? []).filter((r): r is string => !!r)))];
  return reasons.length ? reasons.slice(0, 3).join(" ; ") + (reasons.length > 3 ? ` ; … (${reasons.length} raisons)` : "") : "aucune valeur disponible";
}
