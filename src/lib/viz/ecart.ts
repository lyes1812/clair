import type { Cascade, CascadeStep, masseByRubric } from "@/lib/budget/cascade";
import type { Bridge } from "@/lib/budget/series";
import { ROW_LABELS, ROW_UNIT, type Cell, type Diff, type RowKey, type Version } from "@/lib/budget/versions";
import { isHidden, maskGroups, maskReason, type MaskStatus, type PersonLink } from "@/lib/confidentialite";
import { projectedCell, type Confidentialite } from "@/lib/croisee/confidentialite";
import { formatEuros } from "@/lib/money";
import type { ServiceGuard } from "@/lib/payroll/service-rows";
import { costTone, type TrendTone } from "@/lib/trend";
import type { ChartSeries } from "@/components/charts/shared";

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

// Teintes des versions : bleu (version 1), bleu clair, bleu nuit. Trait plein pour la version 1, pointillés ensuite ; aire sous un scénario.
// Une teinte ne porte jamais seule l'information : numéro de version dans la légende, style de trait, infobulle.
export const VERSION_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)"];

// Tendance d'un écart : seules les rubriques qui sont des COÛTS (montants en euros du tableau d'écart) portent le rouge / vert, via
// costTone (hausse de coût = rouge, baisse = vert, nul ou n.d. = neutre). Les effectifs, les ETP, les entrées et les sorties restent
// neutres : ce ne sont pas des montants. Le pourcentage prend le sens de l'écart (un pourcentage n.d. n'a pas de couleur).
export const COST_ROWS: ReadonlySet<RowKey> = new Set<RowKey>(["masse", "brut", "remun", "primes", "indemnites", "autres", "charges", "nonventile"]);
export const isCostRow = (key: RowKey) => COST_ROWS.has(key);
export function gapTone(key: RowKey, d: Diff, of: "ecart" | "pct" = "ecart"): TrendTone {
  if (!isCostRow(key) || d.kind !== "value") return "flat";
  if (of === "pct" && !d.pct) return "flat";
  return costTone(d.num);
}

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

// --- Seuil de confidentialité (règle de toute l'application : src/lib/confidentialite ; même lecture que la croisée 08) ----------
// Unité : les personnes distinctes du référentiel Collaborateurs (lien contrat → jeton de personne, croiseeLink). Le masquage lui-même
// (principal et secondaire) est celui du module partagé (maskGroups / maskReason) ; les cellules sont celles de projectedCell : rien
// n'est recodé ici, les fonctions ci-dessous rangent les raisons. Un contrat réel non relié (contrat sans personne rattachée) ne
// protège jamais ; une embauche prévue d'un scénario ne décrit personne de réel : un palier porté seulement par des embauches prévues
// est exempt du masquage (affiché) et n'apporte aucune personne protectrice, un palier qui les mêle à des contrats réels se juge sur
// ses contrats réels. Les totaux (départ, arrivée, écart total, résiduel ; pont de toute l'entreprise) ne sont jamais masqués.

export type { Confidentialite } from "@/lib/croisee/confidentialite";

// Raison d'un n.d. dû au seuil ; param : le n.d. vient du paramètre absent ou illisible (l'écran ajoute le lien vers les Paramètres).
export type SeuilNd = { reason: string; param: boolean };

// Garde du filtre Service telle que l'écran la lit : la garde unique de l'application (ServiceGuard de src/lib/payroll/service-rows,
// appliquée aux versions comparées par ecartServiceGuard de ecart-data : lignes par service du journal masquées par le moteur, masquage
// secondaire compris, et composition projetée d'un scénario), ramenée à un n.d. de seuil. La raison reste celle du moteur, nue ; la
// mention du service retenu va dans le titre du bloc n.d. null : rien n'est masqué.
export const guardNd = (g: ServiceGuard | null): SeuilNd | null => (g ? { reason: g.reason, param: g.cause === "parametre" } : null);

// Paliers de la cascade après seuil : un palier de 1 à (seuil − 1) personnes est masqué ; l'écart total étant publié, les paliers
// masqués doivent compter ensemble au moins « seuil » personnes distinctes (masquage secondaire, maskGroups) ; une personne présente
// dans deux paliers masqués (effet report et changement d'ETP, par exemple) n'y compte qu'une fois. La valeur d'un palier est prise en
// valeur absolue : elle ne sert qu'à ordonner le masquage secondaire. `chart` : raison pour laquelle la cascade n'est pas tracée (un
// palier masqué suffit : une cascade ne se trace pas avec un n.d.) ; null : tracée.
export type CascadeMask = { status: MaskStatus[]; reasons: (string | null)[]; chart: string | null };
export function maskCascade(c: Pick<Extract<Cascade, { kind: "value" }>, "steps">, link: PersonLink, seuil: number): CascadeMask {
  const status = maskGroups(c.steps.map((s) => projectedCell(s.people.map((p) => p.key), link, seuil, s.etp4)), seuil, true);
  const reasons = status.map((st) => (isHidden(st) ? maskReason(st, seuil) : null));
  // Un palier sous le seuil (ou masqué pour le protéger) l'emporte sur un palier non dénombré dans la raison du graphique.
  const worst = status.find((st) => st === "masked" || st === "secondary") ?? status.find(isHidden);
  return { status, reasons, chart: worst === undefined ? null : maskReason(worst, seuil) };
}

// Cascade telle que l'écran la présente. Dans l'ordre : service retenu par le filtre sous le seuil ou non dénombré (guard : tout le
// bloc est n.d., quel que soit l'état de la cascade) ; cascade n.d. (sa raison) ; seuil non défini ou illisible (les paliers sont n.d.
// avec la raison, départ, arrivée, écart total et résiduel restent affichés : ce sont des totaux) ; sinon masquage des paliers. `nd`
// d'un palier : null s'il est affiché, sinon la raison ; `chart` : raison pour laquelle la cascade n'est pas tracée.
export type CascadeStepView = CascadeStep & { nd: string | null };
export type CascadeView =
  | { kind: "value"; months: number; start: number; end: number; residual: number; steps: CascadeStepView[]; chart: string | null; param: boolean }
  | { kind: "nd"; reason: string; param: boolean };
export function cascadeView(c: Cascade, conf: Confidentialite, link: PersonLink, guard: SeuilNd | null): CascadeView {
  if (guard) return { kind: "nd", reason: guard.reason, param: guard.param };
  if (c.kind === "nd") return { kind: "nd", reason: c.reason, param: false };
  const { months, start, end, residual } = c;
  if (conf.kind === "nd") return { kind: "value", months, start, end, residual, steps: c.steps.map((s) => ({ ...s, nd: conf.reason })), chart: conf.reason, param: true };
  const m = maskCascade(c, link, conf.value);
  return { kind: "value", months, start, end, residual, steps: c.steps.map((s, i) => ({ ...s, nd: m.reasons[i] })), chart: m.chart, param: false };
}

// Cascade d'ETP tracée (etpWaterfall) seulement quand aucun palier n'est n.d. ; sinon la raison, jamais une barre reconstituée.
export function etpWaterfallOf(v: CascadeView): WaterfallData {
  if (v.kind === "nd") return { kind: "nd", reason: v.reason };
  if (v.chart !== null) return { kind: "nd", reason: v.chart };
  return etpWaterfall({ kind: "value", months: v.months, start: v.start, end: v.end, residual: v.residual, steps: v.steps.map(({ nd: _nd, ...s }) => s) });
}
