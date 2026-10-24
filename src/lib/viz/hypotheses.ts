import type { ChartSeries } from "@/components/charts/shared";
import type { Landing } from "@/lib/budget/engine";
import type { Measures, Retraite, SensitivityRow } from "@/lib/budget/lot3";
import { groupReasons, type Bridge, type Layer as SeriesLayer, type Series } from "@/lib/budget/series";
import type { ContributionKind, ProjectedMonth } from "@/lib/budget/types";

// Adaptateurs purs « résultat du moteur → séries de graphique » des écrans de résultat des hypothèses budgétaires
// (projection, comparaison, atterrissage, embauches prévisionnelles). Ils rangent des valeurs déjà calculées par le moteur :
// la seule opération est une somme de contributions du moteur (par nature) ou une différence déjà écrite dans les tableaux.
// Une valeur absente reste null avec sa raison, jamais zéro. Tout est sérialisable (props des graphiques client).

// --- Affichage « Afficher tout / Graphique / Tableau » (paramètre d'adresse `affichage`)
export type Affichage = "tout" | "graphique" | "tableau";
export const AFFICHAGES: Affichage[] = ["tout", "graphique", "tableau"];
export const affichageOf = (v: string | null | undefined): Affichage => (AFFICHAGES.includes(v as Affichage) ? (v as Affichage) : "tout");
export const showCharts = (a: Affichage): boolean => a !== "tableau";
export const showTables = (a: Affichage): boolean => a !== "graphique";
// L'affichage « tout » est l'affichage par défaut : il n'est pas écrit dans l'adresse.
export const withAffichage = (url: string, a: Affichage): string => (a === "tout" ? url : `${url}${url.includes("?") ? "&" : "?"}affichage=${a}`);

// --- Mois
const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const idx = (m: string) => Number(m.slice(5, 7)) - 1;
export const monthShortLabel = (m: string): string => SHORT[idx(m)] ?? m;
export const monthLongLabel = (m: string): string => (LONG[idx(m)] ? `${LONG[idx(m)]} ${m.slice(0, 4)}` : m);
// « janv. » seul dans une même année, « oct. 26 » dès que les mois couvrent deux années.
export function monthAxis(months: string[]): { categories: string[]; titles: string[] } {
  const years = new Set(months.map((m) => m.slice(0, 4)));
  return { categories: months.map((m) => (years.size > 1 ? `${monthShortLabel(m)} ${m.slice(2, 4)}` : monthShortLabel(m))), titles: months.map(monthLongLabel) };
}
// Années couvertes par des mois : « 2026 » ou « 2026–2027 » (titre d'un graphique).
export function yearSpan(months: string[]): string {
  const ys = [...new Set(months.map((m) => m.slice(0, 4)))].sort();
  return ys.length === 0 ? "" : ys.length === 1 ? ys[0] : `${ys[0]}–${ys.at(-1)}`;
}
// Dates et mois ISO d'un texte écrit par le moteur (raisons n.d.) : « 16/11/2026 » pour un jour, « novembre 2026 » pour un mois.
// Un seul format à l'écran ; ce qui ressemble à une date sans en être une (mois 13, 31 février, identifiant collé) reste intact.
// « de » devant avril, août ou octobre s'élide (« paie d'avril 2026 »). Sans lookbehind : le fichier peut partir au navigateur.
const ISO_TOKEN = /(^|[^\w-])(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?(?![\w-])/g;
const DE_VOYELLE = /(^|[^\w'’-])(de|De) (?=(?:avril|août|octobre) \d{4})/g;
export const frDates = (text: string): string =>
  text
    .replace(ISO_TOKEN, (all, before: string, y: string, m: string, d: string | undefined) => {
      if (d === undefined) return `${before}${LONG[Number(m) - 1]} ${y}`;
      const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
      return Number(d) <= lastDay ? `${before}${d}/${m}/${y}` : all;
    })
    .replace(DE_VOYELLE, (_all, before: string, de: string) => `${before}${de === "De" ? "D" : "d"}'`);
const span = (months: string[]): string => (months.length === 0 ? "" : months.length === 1 ? monthShortLabel(months[0]) : `${monthShortLabel(months[0])}–${monthShortLabel(months.at(-1)!)}`);

export const hasValues = (series: ChartSeries[]): boolean => series.some((s) => s.values.some((v) => v !== null && v !== undefined));

// --- Projection : coût, effectif et ETP par mois (réel, projeté par le scénario parent, projeté)
export type Layer = "reel" | "parent" | "projete";
export type RowIn = { month: string; layer: Layer; cost: number | null; headcount: number | null; etp4: number | null; nd: string | null; etpNd: string | null };

const LAYERS: { layer: Layer; key: string; name: string; color: string }[] = [
  { layer: "reel", key: "reel", name: "Réel (paie lue)", color: "var(--chart-2)" },
  { layer: "parent", key: "parent", name: "Projeté par le scénario parent", color: "var(--chart-5)" },
  { layer: "projete", key: "projete", name: "Projeté", color: "var(--chart-1)" },
];
// Une série par origine du mois : sur un mois d'une autre origine, la cellule est « sans objet » (jamais zéro).
const NOT_THIS: Record<Layer, string> = { reel: "sans objet : mois réel (paie lue)", parent: "sans objet : mois projeté par le scénario parent", projete: "sans objet : mois projeté par ce scénario" };

function byLayer(rows: RowIn[], pick: (r: RowIn) => { v: number | null; reason: string }, line: boolean): ChartSeries[] {
  return LAYERS.filter((l) => rows.some((r) => r.layer === l.layer)).map((l) => ({
    key: l.key,
    name: l.name,
    color: l.color,
    values: rows.map((r) => (r.layer === l.layer ? pick(r).v : null)),
    reasons: rows.map((r) => {
      if (r.layer !== l.layer) return NOT_THIS[r.layer];
      const p = pick(r);
      return p.v === null ? p.reason : null;
    }),
    ...(line ? { dashed: l.layer !== "reel", area: l.layer === "projete" } : {}),
  }));
}

export const costSeries = (rows: RowIn[]): ChartSeries[] => byLayer(rows, (r) => ({ v: r.cost, reason: r.nd ?? "coût employeur n.d." }), false);
export const headcountSeries = (rows: RowIn[]): ChartSeries[] =>
  byLayer(rows, (r) => ({ v: r.headcount, reason: r.cost === null ? (r.nd ?? "mois n.d.") : "effectif de fin de mois non disponible pour ce mois" }), true);
export const etpSeries = (rows: RowIn[]): ChartSeries[] =>
  byLayer(rows, (r) => ({ v: r.etp4, reason: r.cost === null ? (r.nd ?? "mois n.d.") : (r.etpNd ?? "ETP n.d.") }), true);

// Mois dont le coût est n.d., raisons groupées (« raison (2026-11 → 2026-12) »).
export const ndMonthsNote = (rows: RowIn[]): string | null => {
  const nd = rows.filter((r) => r.cost === null);
  return nd.length ? frDates(groupReasons(nd.map((r) => ({ month: r.month, reason: r.nd ?? "coût employeur n.d." })))) : null;
};

// --- Projection : coût projeté par nature de contribution du moteur (somme des contributions de chaque nature)
export type NatureKey = "base" | "augmentation" | "quotite" | "embauche" | "ponctuel" | "enveloppe" | "sortie" | "depart" | "entree" | "absence";
export const NATURES: { key: NatureKey; name: string; color: string }[] = [
  { key: "base", name: "Base (figée ou corrigée)", color: "var(--chart-2)" },
  { key: "augmentation", name: "Augmentations", color: "var(--chart-1)" },
  { key: "quotite", name: "Changements de quotité", color: "var(--chart-4)" },
  { key: "embauche", name: "Embauches", color: "var(--chart-3)" },
  { key: "ponctuel", name: "Éléments ponctuels", color: "var(--chart-6)" },
  { key: "enveloppe", name: "Enveloppes", color: "var(--chart-7)" },
  { key: "sortie", name: "Coûts de sortie", color: "var(--chart-8)" },
  { key: "depart", name: "Départs et fins de contrat connues", color: "var(--chart-5)" },
  { key: "entree", name: "Entrées après la base (prorata)", color: "var(--chart-8)" },
  { key: "absence", name: "Congés non payés", color: "var(--chart-4)" },
];
// Chaque nature du moteur appartient à une seule série : la somme des séries d'un mois égale son coût.
const NATURE_OF: Record<ContributionKind, NatureKey> = {
  base: "base", augmentation: "augmentation", quotite: "quotite", embauche: "embauche", ponctuel: "ponctuel", enveloppe: "enveloppe",
  sortie: "sortie", depart: "depart", "fin-contrat": "depart", entree: "entree", absence: "absence",
};

// Teinte de chaque série présente : la teinte préférée de sa nature, ou la première teinte libre quand une autre nature présente
// l'a déjà prise (deux séries de même couleur ne se distingueraient que par l'infobulle). Au-delà de huit séries, la teinte se répète.
const TINTS = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`);
export function distinctColors(preferred: string[]): string[] {
  const used = new Set<string>();
  const first = preferred.map((c) => (used.has(c) ? null : (used.add(c), c)));
  return first.map((c, i) => {
    if (c !== null) return c;
    const free = TINTS.find((t) => !used.has(t));
    if (free === undefined) return preferred[i];
    used.add(free);
    return free;
  });
}

// contributing[série][mois] : au moins une contribution du moteur de cette nature ce mois-là (sinon la somme vide vaut 0 et le
// tableau écrit « — », jamais un 0,00 € qui se confondrait avec un solde calculé nul).
export type NatureChart = { categories: string[]; titles: string[]; series: ChartSeries[]; contributing: boolean[][] };
// Une série par nature présente (au moins une contribution non nulle sur l'horizon) ; un mois n.d. n'a aucune valeur (colonne
// hachurée, raison portée par la première série) ; une nature sans contribution un mois donné vaut 0 : somme vide du moteur.
export function natureChart(months: ProjectedMonth[]): NatureChart {
  const per = months.map((m) => {
    if (m.kind !== "value") return null;
    const sums = new Map<NatureKey, number>();
    for (const c of m.contributions) sums.set(NATURE_OF[c.kind], (sums.get(NATURE_OF[c.kind]) ?? 0) + c.cost);
    return sums;
  });
  const present = NATURES.filter((n) => per.some((s) => s !== null && (s.get(n.key) ?? 0) !== 0));
  const colors = distinctColors(present.map((n) => n.color));
  const { categories, titles } = monthAxis(months.map((m) => m.month));
  const series = present.map((n, first): ChartSeries => ({
    key: n.key,
    name: n.name,
    color: colors[first],
    values: per.map((s) => (s === null ? null : (s.get(n.key) ?? 0))),
    reasons: months.map((m) => (m.kind === "nd" && first === 0 ? frDates(m.reasons.join(" ; ")) : null)),
  }));
  return { categories, titles, series, contributing: present.map((n) => per.map((s) => s !== null && s.has(n.key))) };
}

// Contributions seules : la base (coût déjà acquis, bien plus haut que chaque contribution) écrase l'échelle du graphique complet ; sans elle, ce qui
// varie d'un mois à l'autre se lit. Mêmes séries, mêmes teintes, mêmes valeurs du moteur : seule la base est retirée. La raison d'un
// mois n.d., portée par la première série du graphique complet, passe à la première série restante.
export function contributionsChart(nature: NatureChart): NatureChart {
  const keep = nature.series.map((s) => s.key !== "base");
  const series = nature.series.filter((_, i) => keep[i]);
  const contributing = nature.contributing.filter((_, i) => keep[i]);
  if (series.length > 0) {
    const carrier = nature.series[0].reasons ?? [];
    series[0] = { ...series[0], reasons: nature.categories.map((_, i) => carrier[i] ?? series[0].reasons?.[i] ?? null) };
  }
  return { categories: nature.categories, titles: nature.titles, series, contributing };
}

// --- Embauches prévisionnelles : nombre de postes par mois de début, par groupe
export type HireIn = { start: string; group: string };
export type HiresByMonth = {
  groups: string[];
  counts: number[][]; // [groupe][mois] : postes qui commencent ce mois
  groupTotals: number[]; // postes du groupe, y compris ceux qui commencent hors des mois affichés
  totals: number[]; // [mois]
  outside: number; // postes qui commencent hors des mois affichés
  series: ChartSeries[];
};
export const groupColor = (i: number): string => `var(--chart-${(i % 8) + 1})`;
export function hiresByMonth(hires: HireIn[], months: string[]): HiresByMonth {
  const groups = [...new Set(hires.map((h) => h.group))].sort((a, b) => a.localeCompare(b, "fr"));
  const startOf = (h: HireIn) => h.start.slice(0, 7);
  const counts = groups.map((g) => months.map((m) => hires.filter((h) => h.group === g && startOf(h) === m).length));
  return {
    groups,
    counts,
    groupTotals: groups.map((g) => hires.filter((h) => h.group === g).length),
    totals: months.map((m) => hires.filter((h) => startOf(h) === m).length),
    outside: hires.filter((h) => !months.includes(startOf(h))).length,
    series: groups.map((g, i) => ({ key: `g${i}`, name: g, color: groupColor(i), values: counts[i] })),
  };
}

// --- Comparaison : coût mensuel du scénario face aux autres lectures
const cellOf = (s: Series, m: string): { v: number | null; reason: string | null } => {
  const p = s.points.get(m);
  if (!p) return { v: null, reason: "mois non couvert par cette lecture" };
  return p.kind === "value" ? { v: p.cost, reason: null } : { v: null, reason: frDates(p.reason) };
};

// Style d'une lecture : le scénario en trait plein bleu avec aire, le réel en trait plein noir, les autres lectures en pointillés
// de teintes distinctes. Le nom dans la légende et l'infobulle porte l'information, la teinte ne la porte jamais seule.
export function readingStyle(key: string, principalKey: string, index: number): { color: string; dashed: boolean; area: boolean } {
  if (key === principalKey) return { color: "var(--chart-1)", dashed: false, area: true };
  if (key === "reel") return { color: "var(--chart-ink)", dashed: false, area: false };
  if (key === "n1") return { color: "var(--chart-2)", dashed: true, area: false };
  if (key.startsWith("budget-")) return { color: "var(--chart-3)", dashed: true, area: false };
  if (key.startsWith("scenario-")) return { color: "var(--chart-6)", dashed: true, area: false };
  return { color: `var(--chart-${(index % 8) + 1})`, dashed: true, area: false };
}

export function comparisonSeries(principal: Series, compared: Series[], months: string[]): ChartSeries[] {
  return [principal, ...compared].map((s, i) => {
    const cells = months.map((m) => cellOf(s, m));
    return { key: s.key, name: s.label, values: cells.map((c) => c.v), reasons: cells.map((c) => c.reason), ...readingStyle(s.key, principal.key, i) };
  });
}

// Écart mensuel : ce scénario − lecture comparée (la différence que le tableau écrit déjà, mois par mois).
export function gapSeries(principal: Series, compared: Series[], months: string[]): ChartSeries[] {
  return compared.map((c, i) => {
    const cells = months.map((m) => ({ a: cellOf(principal, m), b: cellOf(c, m) }));
    return {
      key: `ecart-${c.key}`,
      name: `${principal.label} − ${c.label}`,
      color: readingStyle(c.key, principal.key, i + 1).color,
      values: cells.map(({ a, b }) => (a.v !== null && b.v !== null ? a.v - b.v : null)),
      reasons: cells.map(({ a, b }) => (a.v === null ? `${principal.label} : ${a.reason}` : b.v === null ? `${c.label} : ${b.reason}` : null)),
    };
  });
}

// Mois sans valeur d'une lecture, raisons groupées : pour la note sous la courbe.
export function ndReadings(all: Series[], months: string[]): string[] {
  return all.flatMap((s) => {
    const nd = months.flatMap((m) => {
      const c = cellOf(s, m);
      return c.v === null ? [{ month: m, reason: c.reason ?? "n.d." }] : [];
    });
    return nd.length ? [frDates(`${s.label} : ${groupReasons(nd)}`)] : [];
  });
}

// Origine des mois d'une lecture, d'après les points déjà tracés : « réel janv.–sept. ; projeté oct.–déc. ». Un mois sans valeur
// coupe la plage. Le trait d'un scénario mêle des mois réels figés et des mois projetés : cette phrase le dit sous la courbe.
const LAYER_TEXT: Record<SeriesLayer, string> = { reel: "réel", "projete-parent": "projeté par le scénario parent", projete: "projeté", budget: "budget saisi" };
export function layerSpans(s: Series, months: string[]): string {
  const groups: { text: string; months: string[] }[] = [];
  let open: { text: string; months: string[] } | null = null;
  for (const m of months) {
    const p = s.points.get(m);
    if (!p || p.kind !== "value") {
      open = null;
      continue;
    }
    const text = LAYER_TEXT[p.layer];
    if (open && open.text === text) open.months.push(m);
    else {
      open = { text, months: [m] };
      groups.push(open);
    }
  }
  return groups.map((g) => `${g.text} ${span(g.months)}`).join(" ; ");
}

// --- Cascades : atterrissage, retraité, pont volume / coût moyen. Même contenu que les tableaux, mêmes montants (centimes).
export type WaterfallIn =
  | { kind: "value"; startLabel: string; start: number; steps: { label: string; value: number }[]; endLabel: string; end: number }
  | { kind: "nd"; reason: string }
  | { kind: "vide"; text: string };

// Les composantes de l'atterrissage (réel, projeté par le scénario parent, projeté) qui couvrent au moins un mois, dans l'ordre
// du calendrier : mêmes montants que le moteur, sans recalcul. Elles alimentent la cascade et le pied de tuile qui l'accompagne.
export type LandingPart = { label: string; value: number; text: string };
export function landingParts(l: Extract<Landing, { kind: "value" }>): LandingPart[] {
  return [
    { label: `Réel ${span(l.actualMonths)}`, value: l.actual, n: l.actualMonths.length, text: "réel" },
    { label: "Projeté (parent)", value: l.prior, n: l.priorMonths.length, text: "projeté par le scénario parent" },
    { label: `Projeté ${span(l.projectedMonths)}`, value: l.projected, n: l.projectedMonths.length, text: "projeté (aucun mois réel dans l'année)" },
  ]
    .filter((x) => x.n > 0)
    .map(({ label, value, text }) => ({ label, value, text }));
}

// Réel, puis mois projetés par un scénario parent, puis mois projetés : la cascade monte jusqu'à l'atterrissage.
export function landingWaterfall(l: Landing): WaterfallIn {
  if (l.kind === "nd") return { kind: "nd", reason: l.reason };
  const layers = landingParts(l);
  if (layers.reduce((s, x) => s + x.value, 0) !== l.total) return { kind: "nd", reason: "les composantes de l'atterrissage ne s'additionnent pas à son total" };
  if (layers.length < 2) return { kind: "vide", text: `L'atterrissage ${l.year} est entièrement ${layers[0]?.text ?? "n.d."} : une cascade n'apporterait rien de plus que le total.` };
  return { kind: "value", startLabel: layers[0].label, start: layers[0].value, steps: layers.slice(1).map((x) => ({ label: x.label, value: x.value })), endLabel: `Atterrissage ${l.year}`, end: l.total };
}

// Atterrissage moins les éléments non récurrents (déjà dans les comptes, puis prévus) = atterrissage retraité.
export function retraiteWaterfall(r: Retraite): WaterfallIn {
  if (r.kind === "nd") return { kind: "nd", reason: r.reason };
  const steps: { label: string; value: number }[] = [];
  if (r.realised !== 0) steps.push({ label: "Déjà comptabilisé", value: -r.realised });
  if (r.projected !== 0) steps.push({ label: "Prévu", value: -r.projected });
  if (steps.length === 0) return { kind: "vide", text: `Aucun élément non récurrent : l'atterrissage retraité ${r.year} égale l'atterrissage.` };
  return { kind: "value", startLabel: `Atterrissage ${r.year}`, start: r.atterrissage, steps, endLabel: `Retraité ${r.year}`, end: r.retraite };
}

// Pont d'écart : lecture comparée, effet volume, effet coût moyen, scénario (la somme des deux effets égale l'écart).
export function bridgeWaterfall(b: Bridge, principalLabel: string, comparedLabel: string): WaterfallIn {
  if (b.kind === "nd") return { kind: "nd", reason: b.reason };
  return {
    kind: "value", startLabel: comparedLabel, start: b.b.cost,
    steps: [{ label: "Effet volume", value: b.volume }, { label: "Effet coût moyen", value: b.averageCost }],
    endLabel: principalLabel, end: b.a.cost,
  };
}

// --- Atterrissage : mesures de management et sensibilités
export type BarsIn = { kind: "value"; categories: string[]; titles: string[]; series: ChartSeries[] } | { kind: "nd"; reason: string } | { kind: "vide"; text: string };

// Une série par effet de la mesure (centimes). Le coût du remplaçant est absent d'une mesure sans remplaçant lié.
export function measuresBars(m: Measures): BarsIn {
  if (m.kind === "nd") return { kind: "nd", reason: m.reason };
  if (m.rows.length === 0) return { kind: "vide", text: "Aucun départ dans ce scénario." };
  const rows = m.rows;
  const series: ChartSeries[] = [
    { key: "avoided", name: "Paie évitée", color: "var(--chart-1)", values: rows.map((r) => r.avoided) },
    { key: "exit", name: "Coûts de sortie", color: "var(--chart-2)", values: rows.map((r) => r.exit) },
  ];
  if (rows.some((r) => r.replacement !== null)) {
    series.push({ key: "replacement", name: "Coût du remplaçant", color: "var(--chart-6)", values: rows.map((r) => r.replacement), reasons: rows.map((r) => (r.replacement === null ? "sans remplaçant lié" : null)) });
  }
  series.push({ key: "net", name: "Économie nette", color: "var(--chart-3)", values: rows.map((r) => r.net) });
  return { kind: "value", categories: rows.map((r) => r.label), titles: rows.map((r) => (r.who ? `${r.label} · ${r.who}` : r.label)), series };
}

// Effet de chaque variation (numérotée comme le tableau) sur l'atterrissage et sur l'atterrissage retraité.
export function sensitivityBars(rows: SensitivityRow[]): BarsIn {
  if (rows.length === 0) return { kind: "vide", text: "Aucune variation calculée." };
  const eff = rows.map((r) => r.effect);
  const nd = (i: number) => {
    const e = eff[i];
    return e.kind === "nd" ? frDates(e.reason) : null;
  };
  return {
    kind: "value",
    categories: rows.map((_, i) => String(i + 1)),
    titles: rows.map((r, i) => `Variation ${i + 1} : ${r.label}`),
    series: [
      { key: "atterrissage", name: "Effet sur l'atterrissage", color: "var(--chart-1)", values: eff.map((e) => (e.kind === "value" ? e.atterrissage : null)), reasons: eff.map((_, i) => nd(i)) },
      {
        key: "retraite", name: "Effet sur le retraité", color: "var(--chart-2)",
        values: eff.map((e) => (e.kind === "value" ? e.retraite : null)),
        reasons: eff.map((e, i) => (e.kind === "nd" ? nd(i) : e.retraite === null ? "atterrissage retraité n.d. pour cette lecture" : null)),
      },
    ],
  };
}
