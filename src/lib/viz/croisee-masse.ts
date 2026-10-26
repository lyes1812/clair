import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { NV } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart-data";
import type { ChartSeries } from "@/components/charts/shared";
import { journalReason } from "@/lib/croisee/format";
import { memoPublicModel as memoByContext } from "@/lib/croisee/public";
import { maskReason, type Confidentialite, type MaskStatus } from "@/lib/croisee/structure";
import { croiseeSettingReason, settingValue } from "@/lib/croisee/settings-format";
import { evolution, windowPayroll, withService } from "@/lib/payroll/engine";
import { RUBRICS, type RubricId } from "@/lib/payroll/grid";
import { labelTotals, type LabelTotal } from "@/lib/payroll/lot2";
import { serviceLabel, serviceRows, type ServiceRow } from "@/lib/payroll/service-rows";
import { cellView, costVariation, plainVariation, sortRows, sortState, sparkValues, type ChapterModel, type CroiseeCell, type CroiseeChart, type CroiseeColumn, type CroiseeRow, type CroiseeTable, type SortDir, type TileSpec, type TileVariation } from "@/lib/viz/croisee";
import { brutParts, capital, COLORS, euros, eurosSigned, fixeVariableMonths, fixeVariableSeries, monthLongLabel, monthsAxis, monthShortYear, ndGroups, ndLines, pluriel, primesSeries, reasonLines, servicesParts, type MonthIn, type PrimesMonth } from "@/lib/viz/masse";
import { masseContracts } from "@/lib/viz/croisee-budget";
import { MONTH_NAMES, nd as ndTile, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitres 04 · Fixe & variable et 05 · Services (journal de paie PayFit). buildFixeVariable et
// buildServices sont des fonctions PURES : elles mettent en forme des résultats déjà calculés par le moteur de la masse salariale
// (windowPayroll, evolution, labelTotals, serviceRows) et par les adaptateurs de l'écran Masse salariale (brutParts,
// fixeVariableSeries, primesSeries, servicesParts). L'écran, le CSV et l'Excel partent du même modèle. Les chargeurs
// (load…Input) appellent les MÊMES fonctions que l'écran Masse salariale, sur les mêmes mois et le même service : les chiffres sont
// identiques. Montants en centimes ; un n.d. reste n.d. (raison écrite) jusqu'au tableau et au graphique, jamais un zéro. Les
// périodes s'écrivent avec les libellés du contexte (« janvier → mars 2026 », N-1 : « janvier → mars 2025 »), jamais l'année seule.
// Aucun texte libre saisi dans Clair n'est affiché : les libellés viennent du journal de paie (comptes) et des codes de service.

// --- Entrées minimales (les types du moteur y sont assignables) ------------------------------------------------------------------

type Rubrics = Pick<Record<RubricId, number>, "salaires" | "primes" | "stages" | "indemnites">;
export type WindowValue = { kind: "value"; brut: number; cotisations: number; masse: number; byRubric: Rubrics; months: MonthIn[]; paidContractMonths: number };
export type WindowIn = WindowValue | { kind: "nd"; nd: { reason: string }; months: MonthIn[] };
export type EvolutionIn = { kind: "value"; deltaCents: number; ratio: { num: number; den: number } | null } | { kind: "nd"; nd: { reason: string } };
export type LabelIn = Pick<LabelTotal, "rubric" | "key" | "label" | "cents">;
export type Action = { href: string; label: string };
// Bloc (ou chapitre) non calculable : la raison, et l'action qui y remédie (Données, Paramètres).
export type BlockNd = { label?: string; reason: string; action?: Action };

// --- Modèle -------------------------------------------------------------------------------------------------------------------------

// Graphique du chapitre : contrat commun (CroiseeChart) plus la note d'une ligne du graphique et le libellé du centre d'un anneau.
export type MasseChart = CroiseeChart & { note?: string; centerLabel?: string };
// Bloc de l'écran : graphiques et tableaux (identifiants dans model.charts / model.tables), n.d. et lignes courtes. graph : bloc
// affiché aussi en « Graphiques » ; half : bloc en demi-largeur ; badge : étiquette du titre ; trend : légende des tendances de coût ;
// graphLinks : tableaux du bloc qui n'ont pas de graphique, signalés par un lien en « Graphiques ».
export type MasseBlock = { id: string; title: string; term?: string; graph: boolean; half?: boolean; badge?: string; trend?: boolean; nd: BlockNd[]; charts: string[]; tables: string[]; notes: string[]; graphLinks?: string[] };
// Indicateur « Prévu » : aucun chiffre, la raison (matrice de correspondance) et l'entrée du glossaire.
export type PrevuItem = { id: string; label: string; reason: string; term: string };
type MasseModel = Omit<ChapterModel, "charts"> & { charts: MasseChart[]; blocks: MasseBlock[]; trend: boolean };
export type FixeVariableModel = MasseModel & { chapter: "fixe-variable"; tileNd: string[]; prevu: PrevuItem[] };
export type ServicesModel = MasseModel & { chapter: "services"; count: number | null; selected: { label: string; clearHref: string } | null };

export const N1_NUL = "N-1 nul : % non défini";
export const N1_NEGATIF = "N-1 négatif : % non défini";
export const BRUT_NUL = "brut nul ou négatif : part non définie";
export const TOTAL_NUL = "coût total nul ou négatif : part non définie";
export const SANS_CONTRAT = "aucun contrat rémunéré sur la période";
export const SANS_LIGNE = "Aucune ligne de charges de personnel dans le journal sur la période.";

// Identifiants du glossaire cités par les deux chapitres (cartes, blocs, colonnes, « Prévu ») ; vérifiés par le garde-fou du glossaire.
export const MASSE_CX_TERMS = {
  fixeVariable: "fixe-variable",
  primes: "primes",
  stages: "gratifications-stage",
  brut: "brut",
  cotisations: "cotisations",
  masse: "masse",
  evolution: "evolution",
  grille: "grille",
  service: "service",
  partSalaires: "croisee-rigidite",
  partPrimes: "croisee-part-primes",
  contributionServices: "croisee-contribution-services",
  nonRecurrents: "croisee-non-recurrents",
  calendrierPrimes: "croisee-calendrier-primes",
  confidentialite: "croisee-confidentialite",
} as const;
const X = MASSE_CX_TERMS;

export const FIXE_VARIABLE_IDS = {
  composantes: "fixe-variable-composantes",
  parts: "fixe-variable-parts",
  mois: "fixe-variable-mois",
  primesMois: "fixe-variable-primes-mois",
  primesFamilles: "fixe-variable-primes-familles",
  libelles: "fixe-variable-libelles",
  repartition: "fixe-variable-repartition",
  structure: "fixe-variable-structure",
} as const;
export const SERVICES_IDS = { table: "services", contribution: "services-contribution", repartition: "services-repartition" } as const;

// Indicateurs du chapitre 04 que Clair ne lit pas (matrice 4.4) : « Prévu », sans valeur reconstituée.
export const PREVU_FIXE_VARIABLE: PrevuItem[] = [
  {
    id: "fixe-variable-indemnites",
    label: "Indemnités de départ (ruptures conventionnelles, indemnités compensatrices de congés payés)",
    reason: "non distinguées par le journal de paie PayFit ; la lecture des DSN ne retient pas encore les éléments de revenu qui les portent",
    term: X.nonRecurrents,
  },
  {
    id: "fixe-variable-calendrier",
    label: "Calendrier de versement des primes et versements hors calendrier",
    reason: "le calendrier de versement par famille de prime est un paramètre de l'espace prévu dans une prochaine version",
    term: X.calendrierPrimes,
  },
  {
    id: "fixe-variable-heures-sup",
    label: "Heures supplémentaires",
    reason: "aucune rubrique d'heures supplémentaires dans la grille de comptes ; aucune reconnaissance par libellé",
    term: X.grille,
  },
  {
    id: "fixe-variable-fixe-contractuel",
    label: "Fixe contractuel de repère et rapprochement du brut",
    reason: "salaire de base contractuel absent du journal de paie et de l'API PayFit",
    term: X.fixeVariable,
  },
  {
    id: "fixe-variable-rigidite",
    label: "Rigidité de la rémunération (fixe contractuel et avantages obligatoires)",
    reason: "classification fixe / avantages obligatoires absente des sources ; seule la part des salaires dans le brut est calculée",
    term: X.partSalaires,
  },
];

// --- Petites mises en forme (aucun calcul métier) ---------------------------------------------------------------------------------

type Val = number | { nd: string };
const isNum = (v: unknown): v is number => typeof v === "number";
const ndOf = (c: CroiseeCell): { nd: string } | null => (typeof c === "object" && "nd" in c ? c : null);
const exactOf = (c: CroiseeCell): number | null => (typeof c === "object" && "exact" in c ? c.exact : null);

// Raison d'un mois n.d. sans le mois (écrit à part) : « mois hors de la lecture PayFit appliquée ».
const stripMonth = (m: Extract<MonthIn, { kind: "nd" }>) => m.nd.reason.split(m.month).join("").replace(/\s{2,}/g, " ").trim();
// Raison d'un mois n.d., mois en clair : « févr. 2026 : mois hors de la lecture PayFit appliquée ».
export const monthReason = (m: Extract<MonthIn, { kind: "nd" }>): string => `${monthShortYear(m.month)} : ${stripMonth(m)}`;
// Raison d'une fenêtre n.d. : ses mois n.d. regroupés par raison identique (« févr. 2026, mars 2026 : … »).
export function windowReason(w: { nd: { reason: string }; months: readonly MonthIn[] }): string {
  return ndLines(ndGroups(w.months.map((m) => ({ month: m.month, reason: m.kind === "nd" ? stripMonth(m) : null })))).join(" ; ") || w.nd.reason;
}

const of = (w: WindowIn, pick: (v: WindowValue) => number): Val => (w.kind === "value" ? pick(w) : { nd: windowReason(w) });
const ofMonth = (m: MonthIn, pick: (v: Extract<MonthIn, { kind: "value" }>) => number): Val => (m.kind === "value" ? pick(m) : { nd: monthReason(m) });
// Écart N − N-1 : n.d. dès qu'un des deux montants l'est (raison de N d'abord).
const gap = (a: Val, b: Val): Val => (!isNum(a) ? a : !isNum(b) ? b : a - b);
// Écart en % : défini seulement sur un N-1 positif (même règle que l'onglet Fixe & variable).
const pct = (a: Val, b: Val): CroiseeCell => (!isNum(a) ? a : !isNum(b) ? b : b === 0 ? { nd: N1_NUL } : b < 0 ? { nd: N1_NEGATIF } : { exact: (a - b) / b });
// Part d'un montant dans un total (fraction exacte, mise en forme par la colonne) : n.d. sur un total nul ou négatif.
const share = (part: Val, whole: Val, why: string): CroiseeCell => (!isNum(part) ? part : !isNum(whole) ? whole : whole <= 0 ? { nd: why } : { exact: part / whole });
// Écart de deux parts, en points : différence des deux fractions.
const points = (a: CroiseeCell, b: CroiseeCell): CroiseeCell => {
  const na = ndOf(a) ?? ndOf(b);
  if (na) return na;
  const x = exactOf(a);
  const y = exactOf(b);
  return x === null || y === null ? "" : { exact: x - y };
};

const PICK = {
  fixe: (v: WindowValue) => v.byRubric.salaires,
  variable: (v: WindowValue) => v.byRubric.primes + v.byRubric.indemnites,
  primes: (v: WindowValue) => v.byRubric.primes,
  indemnites: (v: WindowValue) => v.byRubric.indemnites,
  stages: (v: WindowValue) => v.byRubric.stages,
  brut: (v: WindowValue) => v.brut,
  horsPrimes: (v: WindowValue) => v.brut - v.byRubric.primes,
  cotisations: (v: WindowValue) => v.cotisations,
  masse: (v: WindowValue) => v.masse,
};

const text = (key: string, header: string, extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key, header, kind: "text", ...extra });
const eur = (key: string, header: string, extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key, header, kind: "eur", ...extra });
const gapCol = (extra: Partial<CroiseeColumn> = {}): CroiseeColumn => eur("ecart", "Écart", { signed: true, costTrend: true, term: X.evolution, ...extra });
const pctCol = (extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key: "ecart-pct", header: "Écart (%)", kind: "pourcent", signed: true, costTrend: true, ...extra });

// Formats des cartes : ceux des colonnes, pour qu'une carte et son tableau écrivent la même valeur au centime près.
const F = {
  pct: pctCol(),
  share: { key: "part", header: "", kind: "pourcent" } as CroiseeColumn,
  pts: { key: "pts", header: "", kind: "pourcent", signed: true, points: true } as CroiseeColumn,
};
const show = (c: CroiseeCell, col: CroiseeColumn): string => cellView(c, col).text;

const monthName = (m: string) => capital(MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m);
const monthRow = (m: MonthIn) => `${capital(monthLongLabel(m.month))}${m.open ? " (provisoire)" : ""}`;
const short = (s: string, max = 18) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// Forme exportable d'un bloc n.d. : une ligne et sa raison (jamais un tableau vide qui se lirait comme « aucun »).
function ndTable(id: string, title: string, reason: string): CroiseeTable {
  return { id, title, columns: [text("bloc", "Bloc"), text("valeur", "Valeur")], rows: [{ cells: [title, { nd: reason }] }] };
}

// Une tendance de coût (rouge ou verte) est-elle écrite dans l'un des tableaux ? La légende n'est alors affichée qu'une fois.
function hasTrend(tables: CroiseeTable[]): boolean {
  return tables.some((t) => t.columns.some((c, i) => c.costTrend && [...t.rows, ...(t.foot ? [t.foot] : [])].some((r) => cellView(r.cells[i], c, r).tone !== "flat")));
}

// Mois non clos de deux fenêtres (N et N-1), en clair.
function openLine(...windows: WindowIn[]): string | null {
  const open = windows.flatMap((w) => w.months.filter((m) => m.open).map((m) => m.month));
  return open.length ? `Mois non clos (montants provisoires) : ${[...new Set(open)].sort().map(monthShortYear).join(", ")}.` : null;
}

// En-têtes de la période et de N-1 : libellés du contexte (« Janvier → mars 2026 », « N-1 (janvier → mars 2025) »).
export const periodHeads = (labels: { period: string; prev: string }) => ({ n: capital(labels.period), n1: `N-1 (${labels.prev})` });

// --- Seuil de confidentialité sous le filtre Service ----------------------------------------------------------------------------

// Mois du journal du service retenu, pour le seuil : contrats qui portent une ligne de la valeur affichée, c'est-à-dire de la masse
// (brut ou cotisations : masseContracts), et présence d'une telle ligne de solde non nul ; ou mois n.d.
export type GuardMonth = { kind: "value"; contracts: readonly string[]; nonZero: boolean } | { kind: "nd" };
export type ServiceGuard = { cause: "parametre" | "seuil"; reason: string };

// Sous le filtre Service, tous les chiffres du chapitre 04 décrivent ce seul service : le seuil de confidentialité s'y applique.
// Chaque mois connu de la période et de N-1 est un groupe (ses contrats qui portent une ligne de masse : brut, cotisations) ; un mois
// de 1 à (seuil − 1) contrats, ou un mois qui porte un montant de masse non nul sans aucun contrat rattaché (effectif non dénombré,
// quel que soit le seuil défini), rend tout le chapitre n.d. : aucun montant de ce service ne se lit alors, ni directement ni par
// différence. Un mois vide (aucun contrat, aucun montant non nul) ne désigne personne. Seuil absent ou illisible : n.d. avec la raison
// du paramètre. null : affiché.
export function serviceConfidentiality(conf: Confidentialite, months: readonly GuardMonth[]): ServiceGuard | null {
  if (conf.kind === "nd") return { cause: "parametre", reason: conf.reason };
  const status = months.flatMap((m): MaskStatus[] => {
    if (m.kind !== "value") return [];
    const size = m.contracts.length;
    return [size === 0 ? (m.nonZero ? "unverifiable" : "shown") : size < conf.value ? "masked" : "shown"];
  });
  const worst = status.includes("masked") ? "masked" : status.includes("unverifiable") ? "unverifiable" : null;
  if (!worst) return null;
  return { cause: "seuil", reason: `${maskReason(worst, conf.value)} — service retenu par le filtre` };
}

// --- Chapitre 04 · Fixe & variable ----------------------------------------------------------------------------------------------------

export type FixeVariableData = {
  year: number;
  prevYear: number;
  months: string[];
  prevMonths: string[];
  labels: { period: string; prev: string };
  cur: WindowIn; // windowPayroll(journal du service retenu, mois de la période)
  prev: WindowIn; // même chose sur les mêmes mois un an plus tôt
  labelsN: LabelIn[] | null; // labelTotals sur la période (null : période n.d.)
  labelsN1: LabelIn[] | null; // labelTotals sur N-1 (null : N-1 n.d.)
  labelsByMonth: Record<string, LabelIn[]>; // labelTotals de chaque mois connu de la période
};
export type FixeVariableInput = { nd: BlockNd | null; data: FixeVariableData | null };

const BRUT_ORDER: RubricId[] = ["salaires", "primes", "stages", "indemnites"];
const rubricLabel = (id: RubricId) => RUBRICS.find((r) => r.id === id)?.label ?? id;

// Familles de prime : libellés de la rubrique « Primes » sur la période (comme l'onglet Fixe & variable) ; période n.d. : libellés des
// mois connus (leur total de période reste n.d.).
function familiesOf(d: FixeVariableData): LabelIn[] {
  const byLabel = (a: LabelIn, b: LabelIn) => a.label.localeCompare(b.label);
  if (d.labelsN) return d.labelsN.filter((t) => t.rubric === "primes").sort(byLabel);
  const seen = new Map<string, LabelIn>();
  for (const m of d.months) for (const t of d.labelsByMonth[m] ?? []) if (t.rubric === "primes" && !seen.has(t.key)) seen.set(t.key, t);
  return [...seen.values()].sort(byLabel);
}

export function buildFixeVariable(input: FixeVariableInput): FixeVariableModel {
  const terms = [X.fixeVariable, X.primes, X.stages, X.brut, X.cotisations, X.masse, X.evolution, X.grille, X.partSalaires, X.partPrimes, X.nonRecurrents, X.calendrierPrimes, X.confidentialite];
  const empty = { chapter: "fixe-variable" as const, alerts: [], terms, prevu: PREVU_FIXE_VARIABLE };
  const d = input.data;
  if (input.nd || !d) return { ...empty, tiles: [], tables: [], charts: [], blocks: [], limits: [], tileNd: [], trend: false, nd: input.nd ?? { reason: "journal de paie indisponible" } };
  const { cur, prev, labels } = d;
  const ID = FIXE_VARIABLE_IDS;
  const { n: nHead, n1: pHead } = periodHeads(labels);
  // Mois de la période ; la raison d'un mois n.d. est écrite avec le mois en clair (même texte dans le tableau et l'infobulle).
  const fv = fixeVariableMonths(cur.months.map((m): MonthIn => (m.kind === "nd" ? { ...m, nd: { reason: monthReason(m) } } : m)));
  const families = familiesOf(d);
  const ndList: { label: string; reason: string | null }[] = [];

  // --- Cartes (période écrite sur chacune) : montant, N-1, écart et écart en % (ton de coût, neutre quand le % est n.d.) ; parts du
  // brut et écart en points (neutres).
  const amountTile = (id: string, label: string, term: string, pick: (v: WindowValue) => number, extra: Partial<TileSpec> = {}): TileSpec => {
    const a = of(cur, pick);
    const b = of(prev, pick);
    const g = gap(a, b);
    const r = pct(a, b);
    if (isNum(g) && ndOf(r)) ndList.push({ label: `${label} — écart (%)`, reason: ndOf(r)!.nd });
    const value: TileValue = isNum(a) ? { text: euros(a), kind: "value", reason: null } : ndTile(a.nd);
    const rv = cellView(r, F.pct);
    const pctLine: TileVariation = rv.nd !== null ? plainVariation("Écart (%)", null, rv.nd) : { label: "Écart (%)", text: rv.text, reason: null, tone: rv.tone };
    return {
      id,
      label,
      term,
      sub: labels.period,
      value,
      cost: true,
      variations: [plainVariation("N-1", isNum(b) ? euros(b) : null, isNum(b) ? null : b.nd), isNum(g) ? costVariation("Écart", g, eurosSigned(g)) : costVariation("Écart", null, null, g.nd), pctLine],
      ...extra,
    };
  };
  const shareTile = (id: string, label: string, term: string, pick: (v: WindowValue) => number): TileSpec => {
    const n = share(of(cur, pick), of(cur, PICK.brut), BRUT_NUL);
    const p = share(of(prev, pick), of(prev, PICK.brut), BRUT_NUL);
    const e = points(n, p);
    const nn = ndOf(n);
    const pn = ndOf(p);
    if (nn && cur.kind === "value") ndList.push({ label, reason: nn.nd });
    if (pn && prev.kind === "value") ndList.push({ label: `${label} — N-1`, reason: pn.nd });
    return {
      id,
      label,
      term,
      sub: labels.period,
      value: nn ? ndTile(nn.nd) : { text: show(n, F.share), kind: "value", reason: null },
      variations: [plainVariation("N-1", pn ? null : show(p, F.share), pn?.nd ?? null), plainVariation("Écart", ndOf(e) || e === "" ? null : show(e, F.pts), ndOf(e)?.nd ?? null)],
    };
  };
  const spark = (label: string, pick: (m: Extract<(typeof fv)[number], { kind: "value" }>) => number) => ({ label: `${label} par mois sur la période`, values: sparkValues(fv.map((m) => (m.kind === "value" ? pick(m) : null))) });
  const hasStages = d.labelsN ? d.labelsN.some((t) => t.rubric === "stages") : null;
  const tiles: TileSpec[] = [
    amountTile("fixe", "Fixe (salaires et congés payés)", X.fixeVariable, PICK.fixe, { spark: spark("Fixe", (m) => m.fixe) }),
    amountTile("variable", "Variable (primes et indemnités)", X.fixeVariable, PICK.variable, { spark: spark("Variable", (m) => m.variable) }),
    amountTile("primes", "dont primes", X.primes, PICK.primes, cur.kind === "value" ? { note: families.length ? `${pluriel(families.length, "famille")} de prime` : "aucune famille de prime" } : {}),
    amountTile("stages", "Gratifications de stage", X.stages, PICK.stages, hasStages === false ? { note: "aucune ligne dans le journal sur la période" } : {}),
    shareTile("part-primes", "Part des primes dans le brut", X.partPrimes, PICK.primes),
    shareTile("part-salaires", "Part des salaires dans le brut", X.partSalaires, PICK.fixe),
  ];
  if (cur.kind === "nd") ndList.unshift({ label: `Période (${labels.period})`, reason: windowReason(cur) });
  if (prev.kind === "nd") ndList.unshift({ label: `N-1 (${labels.prev})`, reason: windowReason(prev) });

  // --- Composantes du brut et de la masse chargée, N face à N-1 (tableau exact de l'anneau et de la structure).
  const line = (label: string, pick: (v: WindowValue) => number, style?: CroiseeRow["style"]): CroiseeRow => {
    const a = of(cur, pick);
    const b = of(prev, pick);
    return { cells: [label, a, b, gap(a, b), pct(a, b)], ...(style ? { style } : {}) };
  };
  const composantes: CroiseeTable = {
    id: ID.composantes,
    title: "Composantes du brut et de la masse chargée",
    columns: [text("composante", "Composante"), eur("n", nHead), eur("n1", pHead), gapCol(), pctCol()],
    rows: [
      line("Fixe (salaires et congés payés)", PICK.fixe),
      line("Variable (primes et indemnités)", PICK.variable),
      line("dont primes", PICK.primes, "child"),
      line("dont indemnités et avantages", PICK.indemnites, "child"),
      line("Gratifications de stage", PICK.stages),
      line("Brut", PICK.brut, "subtotal"),
      line("dont brut hors primes", PICK.horsPrimes, "child"),
      line("Cotisations patronales", PICK.cotisations),
    ],
    foot: line("Masse chargée", PICK.masse),
    terms: [X.fixeVariable, X.primes, X.stages, X.brut, X.cotisations, X.masse, X.evolution],
  };
  const partLine = (label: string, pick: (v: WindowValue) => number): CroiseeRow => {
    const n = share(of(cur, pick), of(cur, PICK.brut), BRUT_NUL);
    const p = share(of(prev, pick), of(prev, PICK.brut), BRUT_NUL);
    return { cells: [label, n, p, points(n, p)] };
  };
  const parts: CroiseeTable = {
    id: ID.parts,
    title: "Parts du brut",
    columns: [text("indicateur", "Indicateur"), { key: "n", header: nHead, kind: "pourcent" }, { key: "n1", header: pHead, kind: "pourcent" }, { key: "ecart", header: "Écart (points)", kind: "pourcent", signed: true, points: true }],
    rows: [partLine("Part des salaires dans le brut", PICK.fixe), partLine("Part des primes dans le brut", PICK.primes)],
    terms: [X.partSalaires, X.partPrimes],
  };
  const ringReason = cur.kind === "nd" ? windowReason(cur) : null;
  const ring = brutParts(cur.kind === "value" ? { fixe: PICK.fixe(cur), variable: PICK.variable(cur), stages: PICK.stages(cur) } : { fixe: 0, variable: 0, stages: 0 });
  const offRing = cur.kind === "value" ? ring.filter((p) => (p.value ?? 0) <= 0).map((p) => `${p.name} (${euros(p.value ?? 0)})`) : [];
  const repartition: MasseChart = {
    id: ID.repartition,
    title: "Répartition du brut de la période",
    kind: "anneau",
    unit: "eur",
    categories: [labels.period],
    series: ring.map((p) => ({ key: p.key, name: p.name, values: [ringReason ? null : p.value], reasons: [ringReason], color: p.color })),
    tableId: ID.composantes,
    centerLabel: "brut",
    ...(offRing.length ? { note: `Hors anneau (montant nul ou négatif) : ${offRing.join(" ; ")}. Parts calculées sur les natures tracées.` } : {}),
  };
  const asMonth = (w: WindowIn, key: string): MonthIn =>
    w.kind === "value" ? { month: key, kind: "value", open: false, brut: w.brut, cotisations: w.cotisations, masse: w.masse, byRubric: w.byRubric } : { month: key, kind: "nd", open: false, nd: { reason: windowReason(w) } };
  const structure: MasseChart = {
    id: ID.structure,
    title: "Structure du brut, N-1 et N",
    kind: "barres",
    unit: "eur",
    categories: ["N-1", "N"],
    categoryTitles: [pHead, nHead],
    series: fixeVariableSeries(fixeVariableMonths([asMonth(prev, "n1"), asMonth(cur, "n")])),
    mode: "stacked",
    tableId: ID.composantes,
  };

  // --- Brut par nature et par mois (période).
  const openN = cur.months.filter((m) => m.open).map((m) => m.month);
  const axisN = monthsAxis(d.months, [], openN);
  const moisTable: CroiseeTable = {
    id: ID.mois,
    title: "Brut par nature et par mois",
    columns: [text("mois", "Mois"), eur("brut", "Brut"), eur("fixe", "Fixe"), eur("variable", "Variable"), eur("primes", "dont primes"), eur("stages", "Gratifications de stage")],
    rows: cur.months.map((m) => ({ cells: [monthRow(m), ofMonth(m, (x) => x.brut), ofMonth(m, (x) => x.byRubric.salaires), ofMonth(m, (x) => x.byRubric.primes + x.byRubric.indemnites), ofMonth(m, (x) => x.byRubric.primes), ofMonth(m, (x) => x.byRubric.stages)] })),
    foot: { cells: ["Période", of(cur, PICK.brut), of(cur, PICK.fixe), of(cur, PICK.variable), of(cur, PICK.primes), of(cur, PICK.stages)] },
    terms: [X.fixeVariable, X.primes, X.stages],
  };
  const moisChart: MasseChart = { id: ID.mois, title: "Brut par nature et par mois", kind: "barres", unit: "eur", categories: axisN.categories, categoryTitles: axisN.titles, series: fixeVariableSeries(fv), mode: "stacked", tableId: ID.mois };

  // --- Primes : total par mois, N face à N-1 (mêmes mois un an plus tôt), puis par famille de prime sur la période.
  const openAll = [...cur.months, ...prev.months].filter((m) => m.open).map((m) => m.month);
  const axisNN1 = monthsAxis(d.months, d.prevMonths, openAll);
  const primeOf = (m: MonthIn | undefined): Val => (m ? ofMonth(m, (x) => x.byRubric.primes) : { nd: "mois absent de la lecture" });
  const primesMoisTable: CroiseeTable = {
    id: ID.primesMois,
    title: "Primes par mois, N et N-1",
    columns: [text("mois", "Mois"), eur("n", nHead), eur("n1", pHead), gapCol()],
    rows: d.months.map((m, i) => {
      const a = primeOf(cur.months[i]);
      const b = primeOf(prev.months[i]);
      return { cells: [monthName(m), a, b, gap(a, b)] };
    }),
    foot: { cells: ["Période", of(cur, PICK.primes), of(prev, PICK.primes), gap(of(cur, PICK.primes), of(prev, PICK.primes))] },
    terms: [X.primes, X.evolution],
  };
  const point = (v: Val) => (isNum(v) ? { v, r: null } : { v: null, r: v.nd });
  const pts = (list: MonthIn[]) => d.months.map((_, i) => point(primeOf(list[i])));
  const nPts = pts(cur.months);
  const pPts = pts(prev.months);
  const primesMoisChart: MasseChart = {
    id: ID.primesMois,
    title: "Primes par mois, N face à N-1",
    kind: "barres",
    unit: "eur",
    categories: axisNN1.categories,
    categoryTitles: axisNN1.titles,
    series: [
      { key: "primes", name: `Primes, ${labels.period}`, values: nPts.map((p) => p.v), reasons: nPts.map((p) => p.r), color: COLORS.now },
      { key: "primes-n1", name: `Primes, N-1 (${labels.prev})`, values: pPts.map((p) => p.v), reasons: pPts.map((p) => p.r), color: COLORS.before },
    ],
    mode: "grouped",
    tableId: ID.primesMois,
  };
  const primesMonths: PrimesMonth[] = cur.months.map((r) => {
    if (r.kind === "nd") return { month: r.month, kind: "nd", reason: monthReason(r) };
    const lt = d.labelsByMonth[r.month];
    if (!lt) return { month: r.month, kind: "nd", reason: `${monthShortYear(r.month)} : libellés du mois non lus` };
    return { month: r.month, kind: "value", byFamily: families.map((f) => lt.filter((t) => t.key === f.key).reduce((s, t) => s + t.cents, 0)) };
  });
  const familiesTable: CroiseeTable | null = families.length
    ? {
        id: ID.primesFamilles,
        title: "Primes par famille et par mois",
        columns: [text("mois", "Mois"), eur("total", "Total primes"), ...families.map((f, j) => eur(`f${j + 1}`, f.label))],
        rows: cur.months.map((m, i) => {
          const pm = primesMonths[i];
          return { cells: [monthRow(m), ofMonth(m, (x) => x.byRubric.primes), ...families.map((_, j): CroiseeCell => (pm.kind === "value" ? pm.byFamily[j] : { nd: pm.reason }))] };
        }),
        foot: { cells: ["Période", of(cur, PICK.primes), ...families.map((f): CroiseeCell => (cur.kind === "value" ? f.cents : { nd: windowReason(cur) }))] },
        terms: [X.primes],
      }
    : null;
  const familiesChart: MasseChart | null =
    families.length > 0 && families.length <= 8
      ? { id: ID.primesFamilles, title: "Primes par famille et par mois", kind: "barres", unit: "eur", categories: axisN.categories, categoryTitles: axisN.titles, series: primesSeries(families, primesMonths), mode: "stacked", tableId: ID.primesFamilles }
      : null;
  const primesNotes = [
    ...(families.length === 0 ? [cur.kind === "value" ? "Aucune famille de prime sur la période." : "Aucune famille de prime dans les mois connus de la période."] : []),
    ...(families.length > 8 ? ["Plus de huit familles de prime : graphique par famille non tracé ; montants dans le tableau « Primes par famille et par mois »."] : []),
  ];

  // --- Brut par libellé de paie, N face à N-1 (même clé de regroupement que le calcul : rubrique + libellé sans accents ni casse).
  let libelles: CroiseeTable;
  const libellesNd: BlockNd[] = [];
  if (!d.labelsN) {
    const why = cur.kind === "nd" ? windowReason(cur) : "libellés de la période non lus";
    libelles = ndTable(ID.libelles, "Brut par libellé de paie", why);
    libellesNd.push({ label: "Brut par libellé de paie", reason: why });
  } else {
    const n = d.labelsN;
    const p = d.labelsN1;
    const prevNd: Val | null = p ? null : { nd: prev.kind === "nd" ? windowReason(prev) : "libellés N-1 non lus" };
    const keys = [...new Map([...(p ?? []), ...n].map((t) => [t.key, t])).values()].sort((a, b) => BRUT_ORDER.indexOf(a.rubric) - BRUT_ORDER.indexOf(b.rubric) || a.label.localeCompare(b.label));
    const val = (list: LabelIn[], k: string) => list.filter((t) => t.key === k).reduce((s, t) => s + t.cents, 0);
    libelles = {
      id: ID.libelles,
      title: "Brut par libellé de paie",
      columns: [text("libelle", "Libellé (PayFit)"), eur("n", nHead), eur("n1", pHead), gapCol(), pctCol(), text("rubrique", "Rubrique", { term: X.grille })],
      rows: keys.map((t) => {
        const a: Val = val(n, t.key);
        const b: Val = prevNd ?? val(p!, t.key);
        return { cells: [t.label, a, b, gap(a, b), pct(a, b), rubricLabel(t.rubric)] };
      }),
      foot: { cells: ["Brut", of(cur, PICK.brut), of(prev, PICK.brut), gap(of(cur, PICK.brut), of(prev, PICK.brut)), pct(of(cur, PICK.brut), of(prev, PICK.brut)), ""] },
      terms: [X.grille, X.brut, X.evolution],
    };
  }

  // Mois non clos : une seule ligne, dans les limites de la lecture ; les mois provisoires sont aussi marqués dans les tableaux mensuels.
  const open = openLine(cur, prev);
  const tables = [composantes, parts, moisTable, primesMoisTable, ...(familiesTable ? [familiesTable] : []), libelles];
  const charts = [repartition, structure, moisChart, primesMoisChart, ...(familiesChart ? [familiesChart] : [])];
  const blocks: MasseBlock[] = [
    { id: "composition", title: "Composition du brut", term: X.fixeVariable, graph: true, nd: [], charts: [repartition.id, structure.id], tables: [composantes.id, parts.id], notes: [] },
    { id: "mois", title: "Brut par nature et par mois", term: X.fixeVariable, graph: true, nd: [], charts: [moisChart.id], tables: [moisTable.id], notes: [] },
    {
      id: "primes",
      title: "Primes",
      term: X.primes,
      graph: true,
      nd: [],
      charts: [primesMoisChart.id, ...(familiesChart ? [familiesChart.id] : [])],
      tables: [primesMoisTable.id, ...(familiesTable ? [familiesTable.id] : [])],
      notes: primesNotes,
      ...(familiesTable && !familiesChart ? { graphLinks: [familiesTable.id] } : {}),
    },
    { id: "libelles", title: "Brut par libellé de paie", term: X.grille, graph: false, nd: libellesNd, charts: [], tables: libellesNd.length ? [] : [libelles.id], notes: [] },
  ];
  const limits = [
    ...(open ? [open] : []),
    "Indemnités de départ (ruptures conventionnelles, indemnités compensatrices de congés payés) : comprises dans « Indemnités et avantages », non distinguées par le journal PayFit.",
  ];
  return {
    ...empty,
    nd: null,
    tiles,
    tables,
    charts,
    blocks,
    limits,
    tileNd: reasonLines(ndList),
    // Légende des tendances : un ton rouge ou vert écrit sur une carte ou dans l'un des tableaux (libellés et primes compris).
    trend: hasTrend(tables) || tiles.some((t) => t.cost && (t.variations ?? []).some((v) => v.tone !== "flat")),
  };
}

export async function loadFixeVariableInput(ctx: CroiseeContext): Promise<FixeVariableInput> {
  const dataAction = { href: `/e/${ctx.slug}/donnees`, label: ctx.canEdit ? "Choisir ou lire une source dans Données" : "Données" };
  const p = ctx.period;
  if (!p) return { nd: { reason: ctx.periodNd ?? "aucun mois disponible", action: dataAction }, data: null };
  const pay = await ctx.load.payroll();
  const journal = pay.input;
  if (!journal) return { nd: { reason: journalReason(pay) ?? "journal de paie indisponible", action: dataAction }, data: null };
  // Même entrée que l'onglet Fixe & variable : le journal restreint au service retenu dans les filtres (s'il y en a un).
  const svc = ctx.service.value;
  const input = svc === undefined ? journal : withService(journal, svc);
  const months = p.months;
  const prevMonths = ctx.prevMonths;
  const cur = windowPayroll(input, months);
  const prev = windowPayroll(input, prevMonths);
  // Service retenu : seuil de confidentialité sur les contrats qui portent une ligne de masse, chaque mois (période et N-1).
  if (svc !== undefined) {
    const conf = ctx.settings.confidentialite;
    const seuil = settingValue(conf);
    const c: Confidentialite = seuil !== null ? { kind: "set", value: seuil } : { kind: "nd", reason: croiseeSettingReason("confidentialite", conf) ?? "seuil de confidentialité non défini (Paramètres)" };
    const guard = serviceConfidentiality(
      c,
      [...months, ...prevMonths].map((m): GuardMonth => {
        const g = masseContracts(input, m);
        return g ? { kind: "value", ...g } : { kind: "nd" };
      }),
    );
    if (guard) {
      const action = guard.cause === "parametre" ? { href: `/e/${ctx.slug}/parametres#croisee`, label: "Paramètres" } : { href: ctx.href({ service: null }), label: "Retirer le filtre Service" };
      return { nd: { reason: guard.reason, action }, data: null };
    }
  }
  const labelsByMonth: Record<string, LabelIn[]> = {};
  for (const r of cur.months) if (r.kind === "value") labelsByMonth[r.month] = labelTotals(input, [r.month]);
  return {
    nd: null,
    data: {
      year: p.year,
      prevYear: p.year - 1,
      months,
      prevMonths,
      labels: ctx.labels,
      cur,
      prev,
      labelsN: cur.kind === "value" ? labelTotals(input, months) : null,
      labelsN1: prev.kind === "value" ? labelTotals(input, prevMonths) : null,
      labelsByMonth,
    },
  };
}

// Modèle du chapitre 04, calculé une fois par requête : le composant du chapitre et l'export appellent cette même fonction.
export const fixeVariableModel = memoByContext((ctx: CroiseeContext) => loadFixeVariableInput(ctx).then(buildFixeVariable));

// --- Chapitre 05 · Services -----------------------------------------------------------------------------------------------------------

// Lignes par service : la règle partagée avec le tableau « Services » de l'écran Masse salariale (src/lib/payroll/service-rows.ts),
// reprise telle quelle par la Synthèse.
export { serviceLabel, serviceRows, type ServiceRow };

export type ServiceRowIn = { value: string | null; cur: WindowIn; prev: WindowIn; evo: EvolutionIn; href?: string };
export type ServicesData = {
  year: number;
  prevYear: number;
  labels: { period: string; prev: string };
  axis: string;
  axisMissing: boolean; // axe enregistré dans Paramètres absent du journal courant
  rows: ServiceRowIn[];
  total: { cur: WindowIn; prev: WindowIn; evo: EvolutionIn };
  selected: { label: string; clearHref: string } | null; // service retenu dans les filtres
};
export type ServicesInput = { nd: BlockNd | null; data: ServicesData | null };

// Tri par défaut du tableau des services : coût de la période décroissant, n.d. en dernier (ordre des lignes du modèle).
export const SERVICES_DEFAULT_SORT: { key: string; dir: SortDir } = { key: "n", dir: "desc" };
// Tri effectif du tableau : celui de l'adresse s'il vise une colonne triable de ce tableau, sinon le tri par défaut. L'écran
// l'annonce par aria-sort ; les lignes du modèle sont déjà dans l'ordre par défaut (même ordre à l'écran et dans les exports).
export function servicesSort(table: CroiseeTable, tri: string | null, sens: SortDir | null): { tri: string; sens: SortDir } {
  const s = sortState(table, tri, sens);
  return s ? { tri: `${table.id}.${s.key}`, sens: s.dir } : { tri: `${table.id}.${SERVICES_DEFAULT_SORT.key}`, sens: SERVICES_DEFAULT_SORT.dir };
}

// Écart et écart en % d'une évolution du moteur : n.d. avec la raison de la fenêtre n.d. (mois en clair).
function evoGap(e: EvolutionIn, cur: WindowIn, prev: WindowIn): CroiseeCell {
  if (e.kind === "value") return e.deltaCents;
  return { nd: cur.kind === "nd" ? windowReason(cur) : prev.kind === "nd" ? windowReason(prev) : e.nd.reason };
}
function evoPct(e: EvolutionIn, cur: WindowIn, prev: WindowIn): CroiseeCell {
  if (e.kind !== "value") return evoGap(e, cur, prev);
  if (e.ratio === null) return { nd: N1_NUL };
  return e.ratio.den < 0 ? { nd: N1_NEGATIF } : { exact: e.ratio.num / e.ratio.den };
}
// Coût par personne-mois : masse ÷ contrats portant une ligne de brut, mois par mois (comme l'écran Masse salariale).
const perPerson = (w: WindowIn): CroiseeCell => (w.kind === "nd" ? { nd: windowReason(w) } : w.paidContractMonths > 0 ? { exact: w.masse / (w.paidContractMonths * 100) } : { nd: SANS_CONTRAT });

export function buildServices(input: ServicesInput): ServicesModel {
  const terms = [X.service, X.masse, X.evolution, X.contributionServices, X.primes, X.cotisations];
  const empty = { chapter: "services" as const, alerts: [], terms, tiles: [] };
  const d = input.data;
  if (input.nd || !d) return { ...empty, tables: [], charts: [], blocks: [], limits: [], trend: false, count: null, selected: null, nd: input.nd ?? { reason: "journal de paie indisponible" } };
  const ID = SERVICES_IDS;
  const { total, labels } = d;
  const cells = (label: string, cur: WindowIn, prev: WindowIn, evo: EvolutionIn, whole: WindowIn | null): CroiseeCell[] => [
    label,
    of(cur, PICK.masse),
    of(prev, PICK.masse),
    evoGap(evo, cur, prev),
    evoPct(evo, cur, prev),
    whole ? share(of(cur, PICK.masse), of(whole, PICK.masse), TOTAL_NUL) : "",
    of(cur, PICK.horsPrimes),
    of(cur, PICK.primes),
    of(cur, PICK.cotisations),
    perPerson(cur),
  ];
  const sortable = { sortable: true };
  const columns: CroiseeColumn[] = [
    text("service", "Service", sortable),
    eur("n", `Coût ${labels.period}`, { ...sortable, term: X.masse }),
    eur("n1", `Coût N-1 (${labels.prev})`, sortable),
    gapCol(sortable),
    pctCol(sortable),
    { key: "part", header: "Part du coût", kind: "pourcent", ...sortable },
    eur("hors-primes", "Hors primes", { ...sortable, term: X.primes }),
    eur("primes", "Primes", sortable),
    eur("cotisations", "Cotisations", { ...sortable, term: X.cotisations }),
    eur("cout-pm", "Coût / personne-mois", { ...sortable, term: X.service }),
  ];
  // Lignes dans l'ordre du tri par défaut (coût de la période décroissant, n.d. en dernier), le même que celui de l'écran : le
  // tableau, les deux graphiques et les exports suivent cet ordre.
  const draft = d.rows.map((r) => ({ r, row: { cells: cells(serviceLabel(r.value), r.cur, r.prev, r.evo, total.cur), ...(r.href ? { href: r.href } : {}) } as CroiseeRow }));
  const sorted = sortRows({ id: ID.table, title: "", columns, rows: draft.map((x) => x.row) }, SERVICES_DEFAULT_SORT.key, SERVICES_DEFAULT_SORT.dir);
  const source = new Map(draft.map((x) => [x.row, x.r]));
  const rows = sorted.map((row) => source.get(row)!);
  const table: CroiseeTable = {
    id: ID.table,
    title: "Coût par service",
    columns,
    rows: sorted,
    foot: { cells: cells("Total", total.cur, total.prev, total.evo, null) },
    terms,
  };
  const open = openLine(total.cur, total.prev);

  // Contribution des services à l'écart : l'écart de chaque service (colonne Écart du tableau), barres signées.
  const pts = rows.map((r) => {
    const c = evoGap(r.evo, r.cur, r.prev);
    return isNum(c) ? { v: c, r: null } : { v: null, r: ndOf(c)?.nd ?? null };
  });
  const contribution: MasseChart = {
    id: ID.contribution,
    title: "Contribution des services à l'écart",
    kind: "barres",
    unit: "eur",
    categories: rows.map((r) => short(serviceLabel(r.value))),
    categoryTitles: rows.map((r) => serviceLabel(r.value)),
    series: [{ key: "ecart", name: `Écart à N-1, ${labels.period}`, values: pts.map((p) => p.v), reasons: pts.map((p) => p.r), color: COLORS.now }],
    mode: "grouped",
    tableId: ID.table,
  };
  // Répartition du coût de la période : une part par service au coût positif (servicesParts, comme l'écran Masse salariale).
  const ring = servicesParts(rows.map((r) => ({ value: r.value, cur: r.cur })));
  const reasonOf = new Map(rows.map((r) => [r.value ?? NV, r.cur.kind === "nd" ? windowReason(r.cur) : null]));
  const ringSeries: ChartSeries[] = ring.parts.map((p) => ({ key: p.key, name: p.name, values: [p.value], reasons: [p.value === null ? (reasonOf.get(p.key) ?? p.reason ?? null) : null], color: p.color }));
  const ringNote = [
    ring.omitted.length ? `Hors anneau (coût nul ou négatif) : ${ring.omitted.join(" ; ")}.` : null,
    ring.omitted.length || ring.parts.some((p) => p.value === null) ? "Parts calculées sur les services tracés." : null,
  ]
    .filter(Boolean)
    .join(" ");
  const repartition: MasseChart = {
    id: ID.repartition,
    title: "Répartition du coût de la période",
    kind: "anneau",
    unit: "eur",
    categories: [labels.period],
    series: ringSeries,
    tableId: ID.table,
    centerLabel: "masse chargée",
    ...(ringNote ? { note: ringNote } : {}),
  };

  const trend = hasTrend([table]);
  const tableBlock: MasseBlock = { id: "tableau", title: "Coût par service", term: X.service, graph: false, badge: pluriel(rows.length, "service"), trend, nd: [], charts: [], tables: [table.id], notes: [] };
  // Sans aucune ligne : la phrase est écrite une fois, dans le bloc du tableau (affiché aussi en « Graphiques »), sans graphique vide.
  const blocks: MasseBlock[] =
    rows.length === 0
      ? [{ ...tableBlock, graph: true, notes: [SANS_LIGNE] }]
      : [
          tableBlock,
          { id: "contribution", title: "Contribution des services à l'écart", term: X.contributionServices, graph: true, half: true, nd: [], charts: [contribution.id], tables: [], notes: [] },
          { id: "repartition", title: "Répartition du coût", term: X.service, graph: true, half: true, nd: [], charts: [repartition.id], tables: [], notes: [] },
        ];
  const limits = [
    ...(d.axisMissing ? [`L'axe « ${d.axis} » choisi dans Paramètres n'existe plus dans le journal appliqué : toutes les lignes sont « Non ventilé ».`] : []),
    ...(open ? [open] : []),
    "Coût / personne-mois : contrats rémunérés chaque mois ; ce n'est pas un coût par ETP.",
  ];
  return { ...empty, nd: null, tables: [table], charts: rows.length === 0 ? [] : [contribution, repartition], blocks, limits, trend, count: rows.length, selected: d.selected };
}

export async function loadServicesInput(ctx: CroiseeContext): Promise<ServicesInput> {
  const dataAction = { href: `/e/${ctx.slug}/donnees`, label: ctx.canEdit ? "Choisir ou lire une source dans Données" : "Données" };
  const p = ctx.period;
  if (!p) return { nd: { reason: ctx.periodNd ?? "aucun mois disponible", action: dataAction }, data: null };
  const pay = await ctx.load.payroll();
  const journal = pay.input;
  if (!journal) return { nd: { reason: journalReason(pay) ?? "journal de paie indisponible", action: dataAction }, data: null };
  if (!pay.service.axis) {
    return { nd: { reason: ctx.service.reason ?? "aucun axe de service retenu", action: { href: `/e/${ctx.slug}/parametres#masse-salariale`, label: "Choisir l'axe du service dans Paramètres" } }, data: null };
  }
  const months = p.months;
  const prevMonths = ctx.prevMonths;
  const rows = serviceRows(journal, months, prevMonths);
  const cur = windowPayroll(journal, months);
  const prev = windowPayroll(journal, prevMonths);
  const svc = ctx.service.value;
  return {
    nd: null,
    data: {
      year: p.year,
      prevYear: p.year - 1,
      labels: ctx.labels,
      axis: pay.service.axis,
      axisMissing: pay.axisMissing,
      // Un clic sur un service filtre tout le rapport (paramètre service=, « __nv__ » pour non ventilé).
      rows: rows.map((r) => ({ ...r, href: ctx.href({ service: r.value ?? NV }) })),
      total: { cur, prev, evo: evolution(cur, prev, (w) => w.masse) },
      selected: svc === undefined ? null : { label: ctx.service.label, clearHref: ctx.href({ service: null }) },
    },
  };
}

// Modèle du chapitre 05, calculé une fois par requête : le composant du chapitre et l'export appellent cette même fonction.
export const servicesModel = memoByContext((ctx: CroiseeContext) => loadServicesInput(ctx).then(buildServices));
