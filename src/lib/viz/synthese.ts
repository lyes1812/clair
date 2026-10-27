import type { ChartSeries } from "@/components/charts/shared";
import type { LandingCompare } from "@/lib/budget/landing-compare";
import { addMonths } from "@/lib/dates";
import { fmtDelta, fmtEtp4, fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";
import type { Delta, Window } from "@/lib/rh/kpi/types";
import { costTone, type TrendTone } from "@/lib/trend";
import { COLORS, euros, eurosSigned, monthLongLabel, monthShortLabel, monthShortYear, ndGroups, ndLines, type MonthIn } from "@/lib/viz/masse";

// Adaptateurs purs de la Synthèse du Studio RH : période (année, mois, périodes rapides), valeur de tuile, tendance d'un coût,
// séries et tableaux des deux graphiques. Aucun calcul métier : chaque valeur vient d'un résultat déjà calculé par le moteur
// des KPI RH, le moteur de masse salariale ou le moteur budgétaire. Un n.d. reste n.d. (texte « n.d. » + raison), jamais zéro.

// --- Identifiants du glossaire vers lesquels renvoient les tuiles et la barre de période (un test vérifie que chacun existe).
export const SYNTHESE_TERMS = {
  effectif: "headcount-persons",
  etpFin: "etp-month-end",
  etpMoyen: "etp-average",
  turnover: "turnover",
  absenteisme: "absenteeism",
  masse: "masse",
  evolution: "evolution",
  coutEtp: "cout-etp",
  atterrissage: "atterrissage",
  budget: "budget-saisi",
  tendances: "ms-tendances",
  periode: "closed-period",
  limites: "kpi-limites-lecture",
  nMoinsUn: "previous-period",
  hachure: "lecture-hachure",
  tableau: "lecture-tableau",
} as const;

// --- Période : année, premier et dernier mois (paramètres annee, de, a de l'adresse), comme la Synthèse de Masse salariale
export const MM = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
export const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export type Period = {
  year: number;
  from: string; // « 01 » à « 12 »
  to: string;
  years: number[]; // années proposées (celles des mois disponibles)
  last: string; // dernier mois disponible de l'année choisie (« 09 »)
  months: string[]; // AAAA-MM de la période
  notices: string[]; // paramètres écartés, avec leur raison
};

// available : mois clos disponibles (AAAA-MM, KPI RH ou journal de paie), triés. Sans mois disponible : null (rien à afficher).
// Année par défaut : la dernière ; période par défaut : de janvier au dernier mois disponible de l'année. Une valeur invalide est
// remplacée par le défaut et signalée.
export function resolvePeriod(available: string[], raw: { annee?: string; de?: string; a?: string }): Period | null {
  const sorted = [...new Set(available)].sort();
  if (sorted.length === 0) return null;
  const notices: string[] = [];
  const years = [...new Set(sorted.map((m) => Number(m.slice(0, 4))))];
  const lastOf = (y: number) => sorted.filter((m) => m.startsWith(`${y}-`)).at(-1)?.slice(5, 7) ?? "12";
  const rawYear = raw.annee ?? "";
  const yearOk = years.map(String).includes(rawYear);
  const year = yearOk ? Number(rawYear) : years[years.length - 1];
  if (rawYear && !yearOk) notices.push(`paramètre ignoré : annee=${rawYear} (années disponibles : ${years.join(", ")})`);
  const last = lastOf(year);
  const rawFrom = raw.de ?? "";
  const rawTo = raw.a ?? "";
  let from = MM.includes(rawFrom) ? rawFrom : "01";
  let to = MM.includes(rawTo) ? rawTo : last;
  if (rawFrom && from !== rawFrom) notices.push(`paramètre ignoré : de=${rawFrom} (mois 01 à 12 attendu)`);
  if (rawTo && to !== rawTo) notices.push(`paramètre ignoré : a=${rawTo} (mois 01 à 12 attendu)`);
  if (from > to) {
    notices.push(`paramètre ignoré : de=${from} (après le dernier mois ${to})`);
    from = "01";
  }
  const months = MM.filter((m) => m >= from && m <= to).map((m) => `${year}-${m}`);
  return { year, from, to, years, last, months, notices };
}

// Mêmes mois un an plus tôt (N-1).
export const previousMonths = (months: string[]): string[] => months.map((m) => addMonths(m, -12));

// « mars 2026 » ; « janvier → septembre 2026 » ; « année 2026 » quand la période couvre janvier à décembre.
export function periodLabel(months: string[]): string {
  if (months.length === 0) return "";
  const first = months[0];
  const last = months[months.length - 1];
  if (months.length === 1) return monthLongLabel(first);
  if (first.slice(5, 7) === "01" && last.slice(5, 7) === "12") return `année ${first.slice(0, 4)}`;
  return `${MONTH_NAMES[Number(first.slice(5, 7)) - 1]} → ${monthLongLabel(last)}`;
}

// Périodes rapides : janvier → mars, juin, septembre, décembre (année entière), seulement jusqu'au dernier mois disponible ; si ce
// dernier mois n'est pas l'un de ces jalons, « Janv.–<mois> » (l'année à ce jour) s'y ajoute.
export type Preset = { label: string; de: string; a: string };
export function presets(last: string): Preset[] {
  const fixed: Preset[] = [
    { label: "Janv.–mars", de: "01", a: "03" },
    { label: "Janv.–juin", de: "01", a: "06" },
    { label: "Janv.–sept.", de: "01", a: "09" },
    { label: "Année entière", de: "01", a: "12" },
  ];
  const out = fixed.filter((p) => p.a <= last);
  if (!fixed.some((p) => p.a === last) && MM.includes(last)) out.push({ label: `Janv.–${monthShortLabel(`2000-${last}`)}`, de: "01", a: last });
  return out.sort((x, y) => x.a.localeCompare(y.a));
}

// Fenêtre du moteur des KPI sur des mois quelconques. Le mode n'a pas d'effet ici : la fenêtre N-1 est construite par le décalage
// explicite des mêmes mois (previousMonths), jamais déduite du mode.
export function windowOf(months: string[]): Window {
  return { mode: "civil", from: months[0], to: months[months.length - 1], months, label: periodLabel(months) };
}

// --- Valeur d'une tuile
// kind « lower » : borne basse (« ≥ x ») ; « nd » : valeur absente, `reason` dit pourquoi (jamais zéro).
export type TileValue = { text: string; kind: "value" | "lower" | "nd"; reason: string | null };
export const nd = (reason: string): TileValue => ({ text: "n.d.", kind: "nd", reason });

type Nd = { nd: { reason: string } };
type Ratio = { num: number; den: number };
export type HeadcountIn = { kind: "exact" | "lower_bound"; persons: number } | ({ kind: "nd" } & Nd);
export type EtpIn = { kind: "exact" | "lower_bound"; etp4: number } | ({ kind: "nd" } & Nd);
export type AverageIn = { kind: "exact" | "lower_bound"; ratio: Ratio } | ({ kind: "nd" } & Nd);
export type RateIn = AverageIn;

const nf = new Intl.NumberFormat("fr-FR");
function tile<T extends { kind: "exact" | "lower_bound" | "nd" }>(v: T, text: (x: Exclude<T, { kind: "nd" }>) => string): TileValue {
  if (v.kind === "nd") return nd((v as unknown as Nd).nd.reason);
  const t = text(v as Exclude<T, { kind: "nd" }>);
  return v.kind === "lower_bound" ? { text: `≥ ${t}`, kind: "lower", reason: null } : { text: t, kind: "value", reason: null };
}
export const headcountTile = (h: HeadcountIn): TileValue => tile(h, (x) => nf.format(x.persons));
export const etpTile = (e: EtpIn): TileValue => tile(e, (x) => fmtEtp4(x.etp4));
export const averageTile = (a: AverageIn): TileValue => tile(a, (x) => fmtFixed(x.ratio));
export const rateTile = (r: RateIn): TileValue => tile(r, (x) => fmtPercent(x.ratio));

// Écart N / N-1 d'un indicateur RH (moteur des KPI) : texte signé et unité, sans couleur (un effectif, un ETP ou un taux n'est
// pas un montant). Écart n.d. : pas de texte, la raison.
export function deltaView(d: Delta): { text: string | null; reason: string | null } {
  return d.kind === "nd" ? { text: null, reason: d.nd.reason } : { text: fmtDelta(d), reason: null };
}

// Raison courte d'un n.d. : sans point final, coupée à un mot près avec « … » (le texte complet : reasonView).
export function shortReason(reason: string, max = 120): string {
  const r = reason.trim().replace(/[.\s]+$/, "");
  if (r.length <= max) return r;
  const cut = r.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, "")}…`;
}

// Raison d'un n.d. pour l'écran : la version courte, et le texte complet seulement quand la version courte le coupe (affiché alors
// en entier sous la version courte : une raison n'est jamais retirée, elle est repliée).
export function reasonView(reason: string, max = 120): { short: string; full: string | null } {
  const short = shortReason(reason, max);
  const plain = reason.trim().replace(/[.\s]+$/, "");
  return { short, full: short === plain ? null : plain };
}

// Pourquoi les tuiles RH ne sont pas calculées (null : elles le sont). Clair refuse de calculer et le dit : source absente,
// référentiel indisponible, paramètres des KPI illisibles.
export function kpiRefusal(p: { chosen: boolean; sourceReason: string; unavailable: string | null; hasInput: boolean; invalid: string[] }): string | null {
  if (!p.chosen) return `aucune source RH retenue (${p.sourceReason.replace(/[.\s]+$/, "")})`;
  if (p.unavailable) return `référentiel indisponible : ${p.unavailable.replace(/[.\s]+$/, "")}`;
  if (!p.hasInput) return "référentiel RH non construit";
  if (p.invalid.length) return `paramètres des KPI illisibles : ${p.invalid.join(", ")}`;
  return null;
}

// --- Tendance d'un coût : rouge pour une hausse, vert pour une baisse (costTone), signe écrit ; jamais sur un effectif ni un ETP.
export type TrendView = { text: string | null; tone: TrendTone; reason: string | null };
type EvolutionIn = { kind: "value"; deltaCents: number; ratio: Ratio | null } | { kind: "nd"; nd: { reason: string } };
const pct = (r: Ratio): string => `${r.num > 0 ? "+" : ""}${fmtPercent(r)}`;

// Évolution de la masse chargée face à N-1 : « +1 234,00 € (+3,45 %) ». Un N-1 nul laisse l'écart en euros, le pourcentage est n.d.
export function evolutionView(e: EvolutionIn): TrendView {
  if (e.kind === "nd") return { text: null, tone: "flat", reason: e.nd.reason };
  const euro = eurosSigned(e.deltaCents);
  return { text: e.ratio === null ? `${euro} (% n.d. : N-1 nul)` : `${euro} (${pct(e.ratio)})`, tone: costTone(e.deltaCents), reason: null };
}

// Atterrissage du dernier scénario face au budget saisi : trois valeurs (atterrissage, budget, écart) ; l'écart n'existe que si les
// deux premières sont connues.
export type LandingIn = { kind: "value"; total: number } | { kind: "nd"; reason: string };
export type BudgetIn = { total: { kind: "value"; cost: number } | { kind: "nd"; reason: string } } | null;
export type GapIn = { kind: "value"; delta: number; pct: Ratio | null } | { kind: "nd"; reason: string };
export function landingView(land: LandingIn, budget: BudgetIn, gap: GapIn | null, year: string): { value: TileValue; budget: TileValue; gap: TrendView } {
  const value: TileValue = land.kind === "value" ? { text: euros(land.total), kind: "value", reason: null } : nd(land.reason);
  const b: TileValue = budget === null ? nd(`aucun budget saisi pour ${year}`) : budget.total.kind === "value" ? { text: euros(budget.total.cost), kind: "value", reason: null } : nd(budget.total.reason);
  if (land.kind !== "value" || b.kind !== "value" || gap === null) return { value, budget: b, gap: { text: null, tone: "flat", reason: land.kind !== "value" ? land.reason : b.reason } };
  if (gap.kind === "nd") return { value, budget: b, gap: { text: null, tone: "flat", reason: gap.reason } };
  const euro = eurosSigned(gap.delta);
  return { value, budget: b, gap: { text: gap.pct === null ? `${euro} (% n.d. : budget nul)` : `${euro} (${pct(gap.pct)})`, tone: costTone(gap.delta), reason: null } };
}

// Tuile Atterrissage de la Synthèse du Studio RH, même règle que la Masse salariale croisée (compareLanding) : la valeur est
// l'atterrissage des douze mois ; budget saisi, atterrissage et écart portent sur les seuls mois de l'année dotés d'un montant de
// budget, leur nombre écrit quand des mois sont exclus, les mois exclus nommés. Sans budget : budget et écart n.d. avec la raison.
export type LandingTileView = {
  value: TileValue;
  budget: { label: string; value: TileValue };
  compared: { label: string; text: string } | null; // atterrissage des mois comparés, quand il diffère des douze mois
  gap: { label: string } & TrendView;
  note: string | null; // mois sans montant de budget, exclus et nommés
};
export function landingTileView(land: LandingIn, budget: { name: string; compare: LandingCompare } | null, year: string): LandingTileView {
  const c = budget?.compare ?? null;
  const v = landingView(land, c ? { total: c.budget } : null, c?.gap ?? null, year);
  const n = c ? c.withBudget.length : 0;
  const partial = c !== null && n > 0 && c.excluded.length > 0;
  const nm = `${nf.format(n)} mois`;
  const g = c?.gap ?? null;
  const sameMonths = g?.kind === "value" && land.kind === "value" && (partial || g.a !== land.total);
  return {
    value: v.value,
    budget: { label: budget ? `Budget saisi « ${budget.name} »${partial ? `, ${nm}` : ""}` : "Budget saisi", value: v.budget },
    compared: sameMonths && g?.kind === "value" ? { label: `Atterrissage, ${nm} comparés`, text: euros(g.a) } : null,
    gap: { label: partial ? `Écart, ${nm} comparés` : "Écart", ...v.gap },
    note: c && partial ? `sans montant de budget, exclus : ${c.excluded.map(monthShortYear).join(", ")}` : null,
  };
}

// Coût par ETP-mois : fraction de centimes → « 1 234,57 € » (arrondi au centime, demi vers le haut), comme la Synthèse de Masse salariale.
export const eurosOfFraction = (r: Ratio): string => `${fmtFixed({ num: r.num, den: r.den * 100 })} €`;

// --- Graphiques : séries et tableaux exacts
// Tableau exact d'un graphique : une cellule par mois et par colonne, la même valeur que le graphique, n.d. avec sa raison.
export type Cell = TileValue;
export const masseCells = (months: MonthIn[]): Cell[] => months.map((m) => (m.kind === "nd" ? nd(m.nd.reason) : { text: euros(m.masse), kind: "value", reason: null }));
export const etpCells = (points: EtpIn[]): Cell[] => points.map(etpTile);

// ETP de fin de mois, N en trait plein, N-1 en pointillés. Une borne basse n'est jamais tracée comme une valeur exacte (sa valeur
// « ≥ x » est dans le tableau) ; un mois n.d. coupe la ligne.
const LOWER = "borne basse, non tracée comme valeur exacte";
function etpPoint(e: EtpIn): { v: number | null; reason: string | null } {
  if (e.kind === "nd") return { v: null, reason: e.nd.reason };
  return e.kind === "lower_bound" ? { v: null, reason: `${LOWER} (≥ ${fmtEtp4(e.etp4)} ETP)` } : { v: e.etp4, reason: null };
}
export function etpMonthlySeries(cur: EtpIn[], prev: EtpIn[], names: { cur: string; prev: string }): ChartSeries[] {
  const make = (key: string, name: string, list: EtpIn[], extra: Partial<ChartSeries>): ChartSeries => {
    const pts = list.map(etpPoint);
    return { key, name, values: pts.map((p) => p.v), reasons: pts.map((p) => p.reason), ...extra };
  };
  return [make("etp", names.cur, cur, { color: COLORS.now }), make("etp-n1", names.prev, prev, { color: COLORS.before, dashed: true })];
}

// Raisons des n.d. d'un graphique, regroupées par raison identique : « janv. 2026, févr. 2026 : raison ». months[i] : mois de la série i.
export function ndReasonLines(months: string[][], series: ChartSeries[]): string[] {
  const items = series.flatMap((s, i) => (s.reasons ?? []).map((reason, k) => ({ month: months[i]?.[k] ?? "", reason })).filter((x) => x.month));
  return ndLines(ndGroups(items));
}

// Les n premières raisons, et le nombre des autres : sous un graphique, une liste de douze raisons ne se lirait plus.
export function capLines(lines: string[], max = 3): { shown: string[]; more: number } {
  return { shown: lines.slice(0, max), more: Math.max(0, lines.length - max) };
}
