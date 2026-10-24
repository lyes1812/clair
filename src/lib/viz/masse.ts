import type { Part } from "@/components/charts/DonutChart";
import type { ChartSeries } from "@/components/charts/shared";
import { formatEuros } from "@/lib/money";
import { roundHalfUp } from "@/lib/rh/kpi/fraction";

// Adaptateurs purs « résultat du moteur de masse salariale → séries de graphique » de l'écran Masse salariale (Synthèse,
// Fixe & variable, Paie & comptabilité, vue DSN). Aucun calcul métier : chaque valeur vient d'un résultat déjà calculé
// (mois du journal de paie, provision, rapprochement, DSN) et se retrouve dans le tableau de l'écran. Un mois n.d. reste
// n.d. (null + raison), jamais un zéro. Les séries sont sérialisables (composants client) : jamais de fonction.

// --- Entrées minimales (les types du moteur y sont assignables)
type Nd = { nd: { reason: string } };
export type MonthIn =
  | ({ month: string; kind: "nd"; open: boolean } & Nd)
  | { month: string; kind: "value"; open: boolean; brut: number; cotisations: number; masse: number; byRubric: { salaires: number; primes: number; stages: number; indemnites: number } };
export type EtpIn = { month: string; etp4: number | null; reason: string | null };
export type WindowIn = { kind: "value"; masse: number } | ({ kind: "nd" } & Nd);
export type ProvisionIn = { kind: "value"; conges: number | null; charges: number | null; total: number | null; missing: string[] } | { kind: "nd"; reason: string };
export type DsnIn = { status: "complete" | "incomplete" | "blocked"; byType: Record<string, number> };

// --- Teintes : celles de la charte (charts.css). Une teinte = une notion métier sur un écran : aucune teinte n'est reprise
// pour une autre notion voisine (N en bleu, N-1 en gris ; brut en bleu nuit, cotisations en orange ; fixe en bleu nuit, variable
// en bleu, gratifications en vert ; primes, services et familles prennent les teintes restantes). La teinte ne porte jamais
// seule l'information : légende nommée, étiquettes et infobulle donnent le nom et la valeur. Le montant écrit dans une colonne
// empilée prend la couleur de texte lisible sur sa teinte (blanc ou encre, 4,5:1 au moins : voir onColor des graphiques).
export const COLORS = {
  now: "var(--chart-1)", // l'année N (masse chargée, coût par ETP, provision, brut DSN)
  before: "var(--muted)", // le même mois un an plus tôt (N-1)
  brut: "var(--chart-2)",
  cotisations: "var(--chart-6)",
  fixe: "var(--chart-2)",
  variable: "var(--chart-1)",
  stages: "var(--chart-3)",
  conges: "var(--chart-3)",
  charges: "var(--chart-6)",
  journal: "var(--chart-2)",
  compta: "var(--chart-8)",
} as const;

// --- Montants : un seul formateur signé pour tout l'écran. Le moins est le vrai signe moins (U+2212), comme pour les
// pourcentages et les ETP ; « + » devant un écart positif ; un montant nul n'a pas de signe. Valeurs en centimes entiers.
const minus = (s: string) => s.replace(/^[-\u2212]/, "\u2212");
export const euros = (cents: number): string => minus(formatEuros(cents));
export const eurosSigned = (cents: number): string => `${cents > 0 ? "+" : ""}${euros(cents)}`;
export const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? "s" : ""}`;

// --- Axe des mois
const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const idx = (m: string) => Number(m.slice(5, 7)) - 1;
export const monthShortLabel = (m: string): string => SHORT[idx(m)] ?? m;
export const monthLongLabel = (m: string): string => (LONG[idx(m)] ? `${LONG[idx(m)]} ${m.slice(0, 4)}` : m);
export const monthShortYear = (m: string): string => (SHORT[idx(m)] ? `${SHORT[idx(m)]} ${m.slice(0, 4)}` : m);

// Étiquettes courtes de l'axe (« janv. ») et intitulés complets de l'infobulle (« janvier 2026 (provisoire) · N-1 : janvier 2025 »).
export function monthsAxis(months: string[], previous: string[] = [], open: string[] = []): { categories: string[]; titles: string[] } {
  const tag = (m: string) => `${monthLongLabel(m)}${open.includes(m) ? " (provisoire)" : ""}`;
  return { categories: months.map(monthShortLabel), titles: months.map((m, i) => (previous[i] ? `${tag(m)} · N-1 : ${tag(previous[i])}` : tag(m))) };
}

// --- Points
type Point = { v: number | null; reason: string | null };
const known = (v: number): Point => ({ v, reason: null });
const absent = (reason: string): Point => ({ v: null, reason });
const ofMonth = (m: MonthIn, pick: (x: Extract<MonthIn, { kind: "value" }>) => number): Point => (m.kind === "nd" ? absent(m.nd.reason) : known(pick(m)));

function series(key: string, name: string, pts: Point[], extra: Partial<Pick<ChartSeries, "color" | "dashed" | "area">> = {}): ChartSeries {
  return { key, name, values: pts.map((p) => p.v), reasons: pts.map((p) => p.reason), ...extra };
}

// --- Synthèse
// Masse chargée par mois : année N et année N-1 (même mois un an plus tôt).
export function masseSeries(cur: MonthIn[], prev: MonthIn[], names: { cur: string; prev: string }): ChartSeries[] {
  return [
    series("masse", names.cur, cur.map((m) => ofMonth(m, (x) => x.masse)), { color: COLORS.now }),
    series("masse-n1", names.prev, prev.map((m) => ofMonth(m, (x) => x.masse)), { color: COLORS.before }),
  ];
}

// Brut et cotisations patronales par mois : empilés, ils font la masse chargée du mois.
export function brutCotisationsSeries(cur: MonthIn[]): ChartSeries[] {
  return [
    series("brut", "Brut", cur.map((m) => ofMonth(m, (x) => x.brut)), { color: COLORS.brut }),
    series("cotisations", "Cotisations patronales", cur.map((m) => ofMonth(m, (x) => x.cotisations)), { color: COLORS.cotisations }),
  ];
}

// Coût par ETP d'un mois, en centimes : masse chargée du mois ÷ ETP fin de mois, arrondi au centime (demi vers le haut), comme la
// colonne « Coût / ETP » du tableau. null si l'ETP est nul ou si le produit sort des entiers sûrs.
export function costPerEtpCents(masseCents: number, etp4: number): number | null {
  const num = masseCents * 10000;
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(etp4) || etp4 <= 0) return null;
  return Number(roundHalfUp({ num, den: etp4 }, 0));
}

function costPoint(m: MonthIn, e: EtpIn | undefined): Point {
  if (m.kind === "nd") return absent(m.nd.reason);
  if (!e) return absent(`ETP fin ${m.month} non fourni`);
  if (e.etp4 === null) return absent(`ETP fin ${e.month} : ${e.reason ?? "n.d."}`);
  const c = costPerEtpCents(m.masse, e.etp4);
  return c === null ? absent(`ETP fin ${e.month} nul : coût par ETP non défini`) : known(c);
}

// Coût par ETP, mois par mois : N en trait plein, N-1 en pointillés. Un mois sans masse ou sans ETP exact n'est pas tracé.
export function costSeries(cur: MonthIn[], etpCur: EtpIn[], prev: MonthIn[], etpPrev: EtpIn[], names: { cur: string; prev: string }): ChartSeries[] {
  return [
    series("cout-etp", names.cur, cur.map((m, i) => costPoint(m, etpCur[i])), { color: COLORS.now }),
    series("cout-etp-n1", names.prev, prev.map((m, i) => costPoint(m, etpPrev[i])), { color: COLORS.before, dashed: true }),
  ];
}

// Teinte d'un service : son rang dans le tableau Services (classé par coût décroissant, non ventilé en dernier). L'anneau et les
// colonnes empilées par mois donnent ainsi la même teinte au même service, même quand un service sans coût positif n'a pas de secteur.
// Les teintes prises par brut / cotisations / masse chargée (1, 2, 6) viennent en dernier : tant qu'il y a au plus cinq services,
// aucun ne reprend la teinte d'une autre notion de l'écran.
export const SERVICE_HUES = [3, 8, 4, 7, 5, 6, 1, 2] as const;
export const serviceColor = (rank: number): string => `var(--chart-${SERVICE_HUES[rank % SERVICE_HUES.length]})`;

// Teinte d'une famille de prime : ni le bleu nuit du fixe, ni le bleu du variable, ni le vert des gratifications de stage pour les
// cinq premières familles, et les teintes proches du bleu (4) et du vert (7) ne viennent qu'en quatrième et cinquième. Les trois
// suivantes (jusqu'à huit familles, limite du graphique) reprennent celles du fixe, du variable et des gratifications : chaque
// série du graphique garde ainsi une teinte différente de ses voisines.
export const FAMILY_HUES = [8, 6, 5, 4, 7, 3, 1, 2] as const;
export const familyColor = (rank: number): string => `var(--chart-${FAMILY_HUES[rank % FAMILY_HUES.length]})`;

// Au-delà de cinq services (ou familles), une teinte est reprise d'une autre notion de l'écran : la légende de chaque graphique le dit.
export const HUES_DISTINCT = 5;
export const hueReuseNote = (count: number, noun: string, others: string): string =>
  count > HUES_DISTINCT ? `Au-delà de ${HUES_DISTINCT} ${noun}, une teinte est reprise d'une autre notion de l'écran (${others}) : la légende de chaque graphique fait foi.` : "";

// Répartition par service : une part par service (masse chargée de la période). Un service n.d. est listé avec sa raison ;
// un service sans masse positive n'a pas de secteur : il est nommé dans `omitted` (son montant est dans le tableau).
export function servicesParts(rows: { value: string | null; cur: WindowIn }[]): { parts: Part[]; omitted: string[] } {
  const parts: Part[] = [];
  const omitted: string[] = [];
  rows.forEach((r, i) => {
    const name = r.value ?? "Non ventilé";
    const key = r.value ?? "__nv__";
    const color = serviceColor(i);
    if (r.cur.kind === "nd") parts.push({ key, name, value: null, reason: r.cur.nd.reason, color });
    else if (r.cur.masse > 0) parts.push({ key, name, value: r.cur.masse, color });
    else omitted.push(`${name} (${formatEuros(r.cur.masse)})`);
  });
  return { parts, omitted };
}

// Masse chargée par mois et par service : une série par service, empilées elles font la masse du mois (la somme des services,
// non ventilé compris, égale le total). Un mois n.d. d'un service reste n.d. avec sa raison.
export function serviceMonthSeries(rows: { value: string | null; months: MonthIn[] }[]): ChartSeries[] {
  return rows.map((r, i) => series(r.value ?? "__nv__", r.value ?? "Non ventilé", r.months.map((m) => ofMonth(m, (x) => x.masse)), { color: serviceColor(i) }));
}

// --- Fixe et variable
// Fixe = rubrique « Salaires et appointements » ; variable = « Primes » + « Indemnités et avantages » ; les gratifications de
// stage sont à part. Les trois font le brut du mois.
export type FvMonth =
  | { month: string; kind: "value"; fixe: number; variable: number; primes: number; stages: number; brut: number }
  | { month: string; kind: "nd"; reason: string };
export function fixeVariableMonths(list: MonthIn[]): FvMonth[] {
  return list.map((m): FvMonth => (m.kind === "nd"
    ? { month: m.month, kind: "nd", reason: m.nd.reason }
    : { month: m.month, kind: "value", fixe: m.byRubric.salaires, variable: m.byRubric.primes + m.byRubric.indemnites, primes: m.byRubric.primes, stages: m.byRubric.stages, brut: m.brut }));
}
const ofFv = (m: FvMonth, pick: (x: Extract<FvMonth, { kind: "value" }>) => number): Point => (m.kind === "nd" ? absent(m.reason) : known(pick(m)));

export function fixeVariableSeries(list: FvMonth[]): ChartSeries[] {
  return [
    series("fixe", "Fixe (salaires et congés payés)", list.map((m) => ofFv(m, (x) => x.fixe)), { color: COLORS.fixe }),
    series("variable", "Variable (primes et indemnités)", list.map((m) => ofFv(m, (x) => x.variable)), { color: COLORS.variable }),
    series("stages", "Gratifications de stage", list.map((m) => ofFv(m, (x) => x.stages)), { color: COLORS.stages }),
  ];
}

// Répartition du brut de la période : fixe, variable, gratifications de stage (valeurs déjà affichées dans les tuiles).
export function brutParts(w: { fixe: number; variable: number; stages: number }): Part[] {
  return [
    { key: "fixe", name: "Fixe", value: w.fixe, color: COLORS.fixe },
    { key: "variable", name: "Variable", value: w.variable, color: COLORS.variable },
    { key: "stages", name: "Gratifications de stage", value: w.stages, color: COLORS.stages },
  ];
}

// Primes par famille (libellé de paie) et par mois : une série par famille, empilées elles font le total des primes du mois.
export type PrimesMonth = { month: string; kind: "value"; byFamily: number[] } | { month: string; kind: "nd"; reason: string };
export function primesSeries(families: { label: string }[], list: PrimesMonth[]): ChartSeries[] {
  return families.map((f, i) => series(`prime-${i}`, f.label, list.map((m) => (m.kind === "nd" ? absent(m.reason) : m.byFamily[i] === undefined ? absent("famille absente du mois") : known(m.byFamily[i]))), { color: familyColor(i) }));
}

// --- Paie et comptabilité
const partReason = (x: Extract<ProvisionIn, { kind: "value" }>, prefix: string) => x.missing.filter((r) => r.startsWith(prefix)).join(" ; ") || x.missing.join(" ; ") || "part n.d.";
const provisionPart = (x: ProvisionIn, pick: (v: Extract<ProvisionIn, { kind: "value" }>) => number | null, prefix: string): Point => {
  if (x.kind === "nd") return absent(x.reason);
  const v = pick(x);
  return v === null ? absent(partReason(x, prefix)) : known(v);
};

// Provision de congés payés fin de mois : congés payés et charges sociales (empilés, ils font le total).
export function provisionParts(list: ProvisionIn[]): ChartSeries[] {
  return [
    series("conges", "Congés payés", list.map((x) => provisionPart(x, (v) => v.conges, "congés payés")), { color: COLORS.conges }),
    series("charges", "Charges sociales", list.map((x) => provisionPart(x, (v) => v.charges, "charges sociales")), { color: COLORS.charges }),
  ];
}

// Total de la provision, N face à N-1 : un total n.d. (une part sans ligne de dotation) n'est pas tracé.
export function provisionTotals(cur: ProvisionIn[], prev: ProvisionIn[], names: { cur: string; prev: string }): ChartSeries[] {
  const total = (x: ProvisionIn): Point => (x.kind === "nd" ? absent(x.reason) : x.total === null ? absent(x.missing.join(" ; ") || "total n.d.") : known(x.total));
  return [
    series("prov", names.cur, cur.map(total), { color: COLORS.now }),
    series("prov-n1", names.prev, prev.map(total), { color: COLORS.before, dashed: true }),
  ];
}

// Rapprochement journal de paie / comptabilité, par mois puis par rubrique (le rapprochement est n.d. dans son ensemble
// dès qu'un mois l'est : ici, tous les montants sont connus).
export function reconMonthSeries(rows: { month: string; journal: number; compta: number }[]): ChartSeries[] {
  return [
    series("journal", "Journal de paie", rows.map((r) => known(r.journal)), { color: COLORS.journal }),
    series("compta", "Comptabilité", rows.map((r) => known(r.compta)), { color: COLORS.compta }),
  ];
}
// Libellés courts de l'axe : le nom complet est dans l'infobulle.
const RUBRIC_SHORT: Record<string, string> = {
  salaires: "Salaires", primes: "Primes", stages: "Stages", indemnites: "Indemnités", cotisations: "Cotisations", taxes: "Taxes",
  "provisions-cp": "Prov. CP", "autres-charges": "Autres", "non-classe": "Non classés",
};
export function reconRubricChart(rows: { key: string; label: string; journal: number; compta: number }[]): { categories: string[]; titles: string[]; series: ChartSeries[] } {
  return {
    categories: rows.map((r) => RUBRIC_SHORT[r.key] ?? r.label),
    titles: rows.map((r) => r.label),
    series: [
      series("journal", "Journal de paie", rows.map((r) => known(r.journal)), { color: COLORS.journal }),
      series("compta", "Comptabilité", rows.map((r) => known(r.compta)), { color: COLORS.compta }),
    ],
  };
}

// --- Source DSN : brut déclaré (type 001) par mois, N face à N-1. Mêmes raisons que le contrôle du journal (dsnBrutWindow).
export function dsnPoint(d: DsnIn | undefined): Point {
  if (!d) return absent("aucune DSN retenue");
  if (d.status === "blocked") return absent("déclaration bloquée");
  const b = d.byType["001"];
  return b === undefined ? absent("aucune rémunération de type 001") : known(b);
}
export function dsnSeries(cur: (DsnIn | undefined)[], prev: (DsnIn | undefined)[], names: { cur: string; prev: string }): ChartSeries[] {
  return [
    series("dsn", names.cur, cur.map(dsnPoint), { color: COLORS.now }),
    series("dsn-n1", names.prev, prev.map(dsnPoint), { color: COLORS.before }),
  ];
}

// --- Série entièrement n.d. : le graphique n'est pas tracé (un axe à zéro, ou une courbe vide, ferait croire à des valeurs nulles).
// Un zéro réel (valeur 0 d'un mois connu) est une valeur connue : le graphique est tracé.
export const hasData = (list: ChartSeries[]): boolean => list.some((s) => s.values.some((v) => v !== null && v !== undefined));
// Raisons distinctes des valeurs absentes, dans l'ordre d'apparition (séries puis mois).
export const seriesReasons = (list: ChartSeries[]): string[] => [...new Set(list.flatMap((s) => (s.reasons ?? []).filter((r): r is string => Boolean(r))))];

// --- Mention « n.d. » d'un graphique : écrite seulement quand le graphique contient réellement un n.d. Une colonne hachurée est
// une catégorie (un mois) où aucune série n'a de valeur ; une valeur absente d'une seule série n'est pas tracée, sans hachure.
export function ndShape(list: ChartSeries[]): { columns: number; values: number } {
  const n = Math.max(0, ...list.map((s) => s.values.length));
  let columns = 0;
  let values = 0;
  for (let c = 0; c < n; c++) {
    const col = list.map((s) => s.values[c] ?? null);
    const missing = col.filter((v) => v === null).length;
    if (missing === col.length && col.length > 0) columns++;
    else values += missing;
  }
  return { columns, values };
}
export function ndNote(list: ChartSeries[], kind: "barres" | "courbe" = "barres"): string {
  const { columns, values } = ndShape(list);
  if (kind === "courbe") return columns + values > 0 ? "Un mois n.d. interrompt la courbe : sa raison est dans l'infobulle." : "";
  if (columns > 0) return "Une colonne hachurée est un mois n.d. : sa raison est dans l'infobulle et dans la liste des raisons de la page.";
  if (values > 0) return "Une valeur n.d. n'est pas tracée, jamais dessinée comme zéro : sa raison est dans l'infobulle.";
  return "";
}

// Première lettre en capitale (la raison d'un n.d. est écrite en minuscule dans les sources, elle ouvre une phrase à l'écran).
export const capital = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

// Raison d'un n.d. sans point final, pour s'insérer dans une phrase (« aucune source… : raison »).
export const noPeriod = (r: string): string => r.trim().replace(/[.\s]+$/, "");
// La même, avec la première lettre en minuscule (la raison d'une source commence par une capitale). Un sigle en tête (FEC, API,
// DSN) garde ses capitales ; à n'utiliser que sur les raisons de source, jamais sur un texte qui commence par un nom propre.
export const reasonText = (r: string): string => noPeriod(r).replace(/^(\p{Lu})(?=\p{Ll})/u, (c) => c.toLowerCase());
// « aucune source RH retenue (Aucune source appliquée pour ce domaine.) : … » : la raison de la source, entre parenthèses, perd sa
// capitale et son point (« (aucune source appliquée pour ce domaine) »). Le début de la phrase est conservé tel quel.
export const sourceReason = (r: string): string => r.replace(/^(aucune source RH retenue) \((.+?)\)( : .*)$/s, (_m, head: string, inner: string, tail: string) => `${head} (${reasonText(inner)})${tail}`);

// --- Raisons des n.d. : regroupées par raison identique, dans l'ordre d'apparition, pour être listées sous le tableau.
export function ndGroups(items: { month: string; reason: string | null | undefined }[]): { reason: string; months: string[] }[] {
  const out = new Map<string, string[]>();
  for (const it of items) {
    if (!it.reason) continue;
    const list = out.get(it.reason) ?? [];
    if (!list.includes(it.month)) list.push(it.month);
    out.set(it.reason, list);
  }
  return [...out].map(([reason, months]) => ({ reason, months }));
}
export const ndLines = (groups: { reason: string; months: string[] }[]): string[] => groups.map((g) => `${g.months.map(monthShortYear).join(", ")} : ${g.reason}`);

// Raisons des n.d. des tuiles : une raison identique à plusieurs indicateurs n'est écrite qu'une fois, avec la liste de ceux qu'elle touche.
export function reasonLines(items: { label: string; reason: string | null | undefined }[]): string[] {
  const out = new Map<string, string[]>();
  for (const it of items) {
    if (!it.reason) continue;
    const labels = out.get(it.reason) ?? [];
    if (!labels.includes(it.label)) labels.push(it.label);
    out.set(it.reason, labels);
  }
  return [...out].map(([reason, labels]) => `${labels.join(", ")} : ${reason}`);
}
