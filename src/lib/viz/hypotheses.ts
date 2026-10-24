import type { ChartSeries } from "@/components/charts/shared";
import type { Landing } from "@/lib/budget/engine";
import type { Measures, Retraite, SensitivityRow } from "@/lib/budget/lot3";
import { groupReasons, type Bridge, type Layer as SeriesLayer, type Series } from "@/lib/budget/series";
import type { ContributionKind, ProjectedMonth } from "@/lib/budget/types";
import { costTone, type TrendTone } from "@/lib/trend";

// Adaptateurs purs « résultat du moteur → séries de graphique » des écrans de résultat des hypothèses budgétaires
// (projection, comparaison, atterrissage, embauches prévisionnelles). Ils rangent des valeurs déjà calculées par le moteur :
// la seule opération est une somme de contributions du moteur (par nature) ou une différence déjà écrite dans les tableaux.
// Une valeur absente reste null avec sa raison, jamais zéro. Tout est sérialisable (props des graphiques client).
// Couleurs : uniquement les huit teintes de série var(--chart-1…8) de charts.css (univers bleu, blanc, noir) ; le rouge et le vert des
// tendances de coût sont posés par les écrans (costTone), jamais sur une série.

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
// Au moins une valeur absente avec sa raison, hors valeur sans objet (mois d'une autre origine, départ sans remplaçant lié) : la légende
// « n.d. » s'impose.
const SANS_OBJET = /^sans (objet|remplaçant lié)/;
export const hasNd = (series: ChartSeries[]): boolean => series.some((s) => s.values.some((v, i) => (v === null || v === undefined) && !!s.reasons?.[i] && !SANS_OBJET.test(s.reasons[i]!)));

// Espace client d'une adresse d'écran (« /e/<espace>/studio-rh/… ») : sert aux renvois vers le glossaire. null si l'adresse n'est pas de cette forme.
export const slugOf = (href: string): string | null => /^\/e\/([^/?#]+)\//.exec(href)?.[1] ?? null;

// Économie (départ évité, coût en moins) : un montant positif est une baisse de coût, donc une tendance favorable (vert) ; un montant
// négatif, une hausse (rouge). Nul ou n.d. : neutre. Même convention que costTone, lue dans l'autre sens.
export const savingTone = (cents: number | null | undefined): TrendTone => costTone(cents === null || cents === undefined ? null : -cents);

// --- Teintes de série : les huit teintes de charts.css, rangées de la plus sombre à la plus claire (luminance relative : 2, 4, 5, 1, 7,
// 3, 6, 8). Deux séries voisines dans une pile se distinguent par leur écart de clarté, pas par leur nuance : le rang sert à écarter
// une teinte de remplacement de ses voisines. Un test relit charts.css pour garder cet ordre exact.
export const TONE_ORDER = [2, 4, 5, 1, 7, 3, 6, 8];
const tint = (n: number): string => `var(--chart-${n})`;
const TINTS = Array.from({ length: 8 }, (_, i) => tint(i + 1));
const toneRank = (c: string): number => {
  const m = /^var\(--chart-(\d)\)$/.exec(c);
  return m ? TONE_ORDER.indexOf(Number(m[1])) : -1;
};
const toneGap = (a: string, b: string): number => (toneRank(a) < 0 || toneRank(b) < 0 ? 0 : Math.abs(toneRank(a) - toneRank(b)));

// --- Projection : coût, effectif et ETP par mois (réel, projeté par le scénario parent, projeté)
export type Layer = "reel" | "parent" | "projete";
export type RowIn = { month: string; layer: Layer; cost: number | null; headcount: number | null; etp4: number | null; nd: string | null; etpNd: string | null };

// Une seule origine par mois : les trois teintes sont des repères sans voisinage (navy, gris, bleu vif).
const LAYERS: { layer: Layer; key: string; name: string; color: string }[] = [
  { layer: "reel", key: "reel", name: "Réel (paie lue)", color: tint(2) },
  { layer: "parent", key: "parent", name: "Projeté par le scénario parent", color: tint(5) },
  { layer: "projete", key: "projete", name: "Projeté", color: tint(1) },
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
// Teintes préférées, rangées pour que les natures les plus fréquentes (base, augmentations, embauches, éléments ponctuels, coûts de
// sortie) alternent sombre / clair dans la pile : navy, bleu clair, bleu foncé, bleu pâle, gris foncé (au moins 2,9:1 de clarté
// entre voisines). Les positives sont empilées au-dessus de l'axe dans cet ordre, les négatives (départs, entrées après la base,
// congés non payés) en dessous : elles reprennent les teintes de natures rares. Seules deux teintes sont partagées (8 et 7).
export const NATURES: { key: NatureKey; name: string; color: string }[] = [
  { key: "base", name: "Base (figée ou corrigée)", color: tint(2) },
  { key: "augmentation", name: "Augmentations", color: tint(3) },
  { key: "quotite", name: "Changements de quotité", color: tint(8) },
  { key: "embauche", name: "Embauches", color: tint(4) },
  { key: "ponctuel", name: "Éléments ponctuels", color: tint(6) },
  { key: "enveloppe", name: "Enveloppes", color: tint(7) },
  { key: "sortie", name: "Coûts de sortie", color: tint(5) },
  { key: "depart", name: "Départs et fins de contrat connues", color: tint(1) },
  { key: "entree", name: "Entrées après la base (prorata)", color: tint(8) },
  { key: "absence", name: "Congés non payés", color: tint(7) },
];
// Chaque nature du moteur appartient à une seule série : la somme des séries d'un mois égale son coût.
const NATURE_OF: Record<ContributionKind, NatureKey> = {
  base: "base", augmentation: "augmentation", quotite: "quotite", embauche: "embauche", ponctuel: "ponctuel", enveloppe: "enveloppe",
  sortie: "sortie", depart: "depart", "fin-contrat": "depart", entree: "entree", absence: "absence",
};

// Teinte de chaque série présente : la teinte préférée de sa nature, ou, quand une autre nature présente l'a déjà prise (deux séries de
// même couleur ne se distingueraient que par l'infobulle), la teinte libre la plus éloignée en clarté de ses voisines dans la pile ;
// à égalité, la première. Au-delà de huit séries, la teinte se répète.
export function distinctColors(preferred: string[]): string[] {
  const used = new Set<string>();
  const kept = preferred.map((c) => (used.has(c) ? null : (used.add(c), c)));
  const out: string[] = [];
  kept.forEach((c, i) => {
    if (c !== null) {
      out.push(c);
      return;
    }
    const free = TINTS.filter((t) => !used.has(t));
    if (free.length === 0) {
      out.push(preferred[i]);
      return;
    }
    const near = [out[i - 1], kept[i + 1] ?? undefined].filter((x): x is string => x !== undefined);
    const room = (t: string) => (near.length === 0 ? 0 : Math.min(...near.map((n) => toneGap(t, n))));
    const best = free.reduce((a, b) => (room(b) > room(a) ? b : a));
    used.add(best);
    out.push(best);
  });
  return out;
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
// Teinte du i-ième groupe (ordre alphabétique) : une suite où deux groupes voisins alternent sombre et clair (bleu vif, navy, bleu clair,
// bleu foncé, bleu pâle, gris foncé, gris pâle, gris-bleu : au moins 2,9:1 entre voisins sur les six premiers). Au-delà de huit groupes, la suite recommence.
const GROUP_TINTS = [1, 2, 3, 4, 6, 5, 8, 7];
export const groupColor = (i: number): string => tint(GROUP_TINTS[i % GROUP_TINTS.length]);
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

// Style d'une lecture : le scénario en trait plein bleu vif avec aire, le réel en trait plein navy, les autres lectures en pointillés :
// N-1 gris-bleu, budget saisi bleu clair, autre scénario bleu foncé. Seules des teintes lisibles en trait fin (3:1 au moins sur blanc :
// ni la 6 ni la 8) ; le nom dans la légende et l'infobulle porte l'information, la teinte ne la porte jamais seule.
const LINE_TINTS = [4, 7, 3, 5];
export function readingStyle(key: string, principalKey: string, index: number): { color: string; dashed: boolean; area: boolean } {
  if (key === principalKey) return { color: tint(1), dashed: false, area: true };
  if (key === "reel") return { color: tint(2), dashed: false, area: false };
  if (key === "n1") return { color: tint(7), dashed: true, area: false };
  if (key.startsWith("budget-")) return { color: tint(3), dashed: true, area: false };
  if (key.startsWith("scenario-")) return { color: tint(4), dashed: true, area: false };
  return { color: tint(LINE_TINTS[index % LINE_TINTS.length]), dashed: true, area: false };
}

// Teinte finale de chaque lecture (le scénario d'abord) : deux lectures du même genre (deux budgets) ne gardent pas la même teinte.
function readingColors(principal: Series, compared: Series[]): string[] {
  const used = new Set<string>();
  return [principal, ...compared].map((s, i) => {
    let color = readingStyle(s.key, principal.key, i).color;
    if (used.has(color)) color = LINE_TINTS.map(tint).find((t) => !used.has(t)) ?? color;
    used.add(color);
    return color;
  });
}

export function comparisonSeries(principal: Series, compared: Series[], months: string[]): ChartSeries[] {
  const colors = readingColors(principal, compared);
  return [principal, ...compared].map((s, i) => {
    const cells = months.map((m) => cellOf(s, m));
    return { key: s.key, name: s.label, values: cells.map((c) => c.v), reasons: cells.map((c) => c.reason), ...readingStyle(s.key, principal.key, i), color: colors[i] };
  });
}

// Écart mensuel : ce scénario − lecture comparée (la différence que le tableau écrit déjà, mois par mois). Chaque lecture garde la teinte
// de sa courbe : le rouge et le vert des écarts de coût sont réservés aux tableaux et aux tuiles.
export function gapSeries(principal: Series, compared: Series[], months: string[]): ChartSeries[] {
  const colors = readingColors(principal, compared);
  return compared.map((c, i) => {
    const cells = months.map((m) => ({ a: cellOf(principal, m), b: cellOf(c, m) }));
    return {
      key: `ecart-${c.key}`,
      name: `${principal.label} − ${c.label}`,
      color: colors[i + 1],
      values: cells.map(({ a, b }) => (a.v !== null && b.v !== null ? a.v - b.v : null)),
      reasons: cells.map(({ a, b }) => (a.v === null ? `${principal.label} : ${a.reason}` : b.v === null ? `${c.label} : ${b.reason}` : null)),
    };
  });
}

// Mois sans valeur d'une lecture, raisons groupées : la ligne « n.d. » sous les graphiques de la comparaison.
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
// coupe la plage. Le trait d'un scénario mêle des mois réels figés et des mois projetés : cette phrase complète l'étiquette lue par les
// lecteurs d'écran (rien n'est écrit sous la courbe : l'origine est au glossaire et sous chaque montant du tableau).
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

// Une série par effet de la mesure (centimes), des barres côte à côte : bleu clair, navy, bleu pâle, bleu vif (économie nette, le résultat).
// Le coût du remplaçant est absent d'une mesure sans remplaçant lié.
export function measuresBars(m: Measures): BarsIn {
  if (m.kind === "nd") return { kind: "nd", reason: m.reason };
  if (m.rows.length === 0) return { kind: "vide", text: "Aucun départ dans ce scénario." };
  const rows = m.rows;
  const series: ChartSeries[] = [
    { key: "avoided", name: "Paie évitée", color: tint(3), values: rows.map((r) => r.avoided) },
    { key: "exit", name: "Coûts de sortie", color: tint(2), values: rows.map((r) => r.exit) },
  ];
  if (rows.some((r) => r.replacement !== null)) {
    series.push({ key: "replacement", name: "Coût du remplaçant", color: tint(6), values: rows.map((r) => r.replacement), reasons: rows.map((r) => (r.replacement === null ? "sans remplaçant lié" : null)) });
  }
  series.push({ key: "net", name: "Économie nette", color: tint(1), values: rows.map((r) => r.net) });
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
      { key: "atterrissage", name: "Effet sur l'atterrissage", color: tint(1), values: eff.map((e) => (e.kind === "value" ? e.atterrissage : null)), reasons: eff.map((_, i) => nd(i)) },
      {
        key: "retraite", name: "Effet sur le retraité", color: tint(2),
        values: eff.map((e) => (e.kind === "value" ? e.retraite : null)),
        reasons: eff.map((e, i) => (e.kind === "nd" ? nd(i) : e.retraite === null ? "atterrissage retraité n.d. pour cette lecture" : null)),
      },
    ],
  };
}
