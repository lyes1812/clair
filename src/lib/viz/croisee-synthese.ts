import type { ChartSeries } from "@/components/charts/shared";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { masseByRubric } from "@/lib/budget/cascade";
import { landing } from "@/lib/budget/engine";
import { budgetSeries, gap, liveSeries, scenarioSeries, total, type Gap, type Point, type Series } from "@/lib/budget/series";
import { aggregate, reelVersion } from "@/lib/budget/versions";
import { printFold, selectAlerts, type AlertesInput, type AlertMention, type ComptaCheck, type DsnCheck, type MissingSource, type SeuilInput } from "@/lib/croisee/alertes";
import { journalReason } from "@/lib/croisee/format";
import { memoByContext } from "@/lib/croisee/memo";
import { croiseeSettingReason, croiseeSettingsHref, settingValue, type CroiseeSetting, type SeuilEffectif } from "@/lib/croisee-settings";
import { monthEnd, monthsBetween } from "@/lib/dates";
import { dsnBrutWindow } from "@/lib/payroll/dsn";
import { costPerEtp, evolution, monthPayroll, windowPayroll, withService, type JournalInput, type PayrollWindow } from "@/lib/payroll/engine";
import { reconcile } from "@/lib/payroll/lot2";
import { headcountAt } from "@/lib/rh/headcount";
import { absenteeism, absenteeismMonth } from "@/lib/rh/kpi/absence";
import { etpAverage, headcountAverage } from "@/lib/rh/kpi/average";
import { compareWindows, delta as kpiDelta, etpProratedValue, type Valued } from "@/lib/rh/kpi/compare";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { ETP_PRORATED_LABEL, etpProratedMonth, etpProratedQualifier } from "@/lib/rh/kpi/etp-prorata";
import { fmtEtp4, fmtFixed, fmtHalfDays, fmtPercent } from "@/lib/rh/kpi/format";
import { civilWindow, countedOpts, rollingWindow } from "@/lib/rh/kpi/period";
import { turnover } from "@/lib/rh/kpi/turnover";
import { kpiNd, type Delta, type DeltaUnit, type Kind, type KpiInput, type KpiNd, type Ratio, type Window } from "@/lib/rh/kpi/types";
import { KPI_KEYS } from "@/lib/rh-kpi-settings";
import { costTone } from "@/lib/trend";
import {
  cellView,
  costVariation,
  plainVariation,
  sparkValues,
  yearMonths,
  type ChapterModel,
  type CroiseeCell,
  type CroiseeChart,
  type CroiseeColumn,
  type CroiseeRow,
  type CroiseeTable,
  type TileSpec,
  type TileVariation,
} from "@/lib/viz/croisee";
import { seuilAlerts } from "@/lib/viz/croisee-effectifs";
import { buildServices, loadServicesInput, N1_NEGATIF, N1_NUL, SERVICES_IDS, type ServicesInput } from "@/lib/viz/croisee-masse";
import { masseWaterfall, type MasseRubric } from "@/lib/viz/ecart";
import { etpProratedNotes, motifsRetenusLine, type EtpIn, type HeadcountIn, type RatioIn } from "@/lib/viz/kpi";
import { brutParts, capital, COLORS, euros, eurosSigned, hasData, monthLongLabel, monthShortLabel, monthShortYear, ndGroups, ndLines, reasonLines, type MonthIn } from "@/lib/viz/masse";
import { averageTile, deltaView, eurosOfFraction, evolutionView, kpiRefusal, landingView, nd, periodLabel, rateTile, windowOf, type AverageIn, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitre 01 · Synthèse. Trois fonctions :
// - loadSyntheseInput(ctx) lit les sources par les lecteurs du contexte et appelle les fonctions existantes (moteur des KPI RH,
//   moteur de masse salariale, versions et cascade de l'Analyse des écarts, séries et atterrissage du module budgétaire, lignes par
//   service du chapitre 05, repères de seuil du chapitre 02) : aucun nouveau moteur ;
// - buildSynthese(input), pure, met ces résultats en forme : six cartes, points à surveiller, graphique principal et son tableau
//   exact, composition, cascade de l'écart de coût, tableau par service, chiffres clés et séries des cartes en tableau ;
// - syntheseModel(ctx), mémoïsée par requête : l'écran et les exports partent de ce même modèle, calculé une fois.
// Seul calcul nouveau de ce fichier : la moyenne, sur la période, de l'ETP contractuel proratisé (etpProratedAverage, testée).
// Montants en centimes, ETP en dix-millièmes ou fractions exactes, taux en fractions ; un n.d. reste n.d. avec sa raison, et aucune
// raison n'expose un identifiant de contrat ou d'absence (publicReason).

const CHAPTER = "synthese" as const;

// Identifiants du glossaire vers lesquels renvoie le chapitre (un test vérifie que chacun existe).
export const SYNTHESE_CX_TERMS = {
  etpMoyen: "etp-average",
  etpProratise: "etp-prorated",
  masse: "masse",
  evolution: "evolution",
  coutEtp: "cout-etp",
  ecartBudget: "croisee-ecart-budget",
  budgetSaisi: "budget-saisi",
  atterrissage: "croisee-atterrissage",
  absenteisme: "absenteeism",
  turnover: "turnover",
  effectifMoyen: "headcount-average",
  seuilsEffectif: "croisee-seuils-effectif",
  alertes: "croisee-alertes",
  fixeVariable: "fixe-variable",
  brut: "brut",
  cotisations: "cotisations",
  nMoinsUn: "previous-period",
  tendances: "lecture-tendances",
  projection: "projection",
  commentaire: "croisee-commentaire",
  impression: "croisee-impression",
  service: "service",
  cascades: "ecart-cascades",
  contributions: "contributions",
  residuel: "residuel",
  ecartPourcentage: "ecart-pourcentage",
} as const;
const T = SYNTHESE_CX_TERMS;

export const SYNTHESE_TABLE_IDS = {
  mensuel: "synthese-mensuel",
  composition: "synthese-composition",
  cascade: "synthese-cascade",
  services: "synthese-services",
  montants: "synthese-montants",
  rh: "synthese-rh",
  series: "synthese-series",
} as const;
const ID = SYNTHESE_TABLE_IDS;

// Impression « Synthèse en PDF · 1 page » : nombre de repères imprimés avant le regroupement « + k autres repères » (contrainte de
// présentation, pas une règle métier). La feuille croisee-synthese.css masque le repère suivant par une chaîne de « ~ » de même
// longueur (vérifié par un test).
export const PRINT_REPERES_MAX = 3;

// --- Entrées minimales (les types des moteurs y sont assignables) --------------------------------------------------------------

type NdIn = { nd: { reason: string } };
type Action = { href: string; label: string };
export type ComparedIn<T = RatioIn> = { current: T; previous: T; delta: Delta };
export type TurnoverIn = { kind: "exact"; ratio: Ratio; entries: number | null; exits: number } | ({ kind: "nd" } & NdIn);
export type EtpProratedMonthIn = { month: string; kind: "exact" | "lower_bound"; ratio: Ratio; qualifiers: string[] } | ({ month: string; kind: "nd" } & NdIn);
export type WindowIn =
  | { kind: "value"; brut: number; cotisations: number; masse: number; byRubric: { salaires: number; primes: number; stages: number; indemnites: number }; openMonths: string[] }
  | ({ kind: "nd" } & NdIn);
export type EvolutionIn = { kind: "value"; deltaCents: number; ratio: Ratio | null } | ({ kind: "nd" } & NdIn);
export type CostIn = { kind: "value"; costCents: Ratio; etpMonths4: number } | ({ kind: "nd" } & NdIn);
export type LandingIn = { kind: "value"; total: number; actualMonths: string[]; priorMonths: string[]; projectedMonths: string[] } | { kind: "nd"; reason: string };
// Effectif moyen de l'année civile N-1 et de N à date (janvier → dernier mois de la période) : même lecture que le chapitre 02.
export type AnnualIn = { prevYear: number; prev: AverageIn; curMonths: string[]; cur: AverageIn };
export type CompositionKey = "fixe" | "variable" | "stages" | "brut" | "cotisations" | "masse";

export type SyntheseRh =
  | {
      kind: "value";
      etpAverage: ComparedIn;
      prorated: EtpProratedMonthIn[]; // un par mois de la période
      proratedPrev: EtpProratedMonthIn[]; // mêmes mois un an plus tôt
      proratedQualifier: string; // qualifieur obligatoire du moteur (etpProratedQualifier)
      absenteeism: ComparedIn;
      absenceTypes: string[]; // motifs retenus (Paramètres › Définitions des KPI)
      turnover: ComparedIn<TurnoverIn>; // douze mois glissants qui finissent avec la période
      annual: AnnualIn; // seuils d'effectif
      rolling: string[]; // douze mois glissants des mini-courbes
      sparks: { etp: EtpIn[]; absenteeism: RatioIn[]; headcount: HeadcountIn[] };
    }
  | { kind: "nd"; reason: string; action: Action }
  | { kind: "na"; reason: string };
export type SynthesePay =
  | {
      kind: "value";
      cur: WindowIn;
      prev: WindowIn;
      evolution: EvolutionIn;
      composition: Record<CompositionKey, EvolutionIn>; // évolution N / N-1 de chaque composante (moteur : evolution)
      cost: CostIn;
      costPrev: CostIn;
      rolling: MonthIn[]; // douze mois glissants (mini-courbe)
      year: MonthIn[]; // les douze mois de l'année N
      yearPrev: MonthIn[]; // les douze mois de N-1
      yearEvo: EvolutionIn[]; // mois i de N face au mois i de N-1 (moteur : evolution)
      cascade: MasseRubric; // écart de masse par rubrique, de N-1 à N (masseByRubric, comme l'Analyse des écarts)
      unclassified: string[]; // comptes 63 / 64 sans rubrique sur la période
      checks: { compta: ComptaCheck; dsn: DsnCheck };
    }
  | { kind: "nd"; reason: string; action: Action };
export type SyntheseBudget = { kind: "value"; name: string; series: Series } | { kind: "absent" | "na"; reason: string };
export type SyntheseLive = { kind: "value"; series: Series } | { kind: "nd"; reason: string };
export type SyntheseLanding = { kind: "value"; scenarioName: string; refMonth: string; landing: LandingIn; series: Series } | { kind: "nd" | "na"; reason: string };
export type SyntheseHrefs = {
  donnees: string;
  parametres: string;
  grille: string;
  budget: string;
  services: string;
  budgetChapter: string;
  paieCompta: string;
  fixeVariable: string;
  effectifs: string; // seuils d'effectif du chapitre 02
  tableau: string; // affichage « Tableaux », ancré sur le graphique principal
  tableauComposition: string;
  tableauCascade: string;
  months: string[]; // douze adresses : la période restreinte à chaque mois de l'année N
};

export type SyntheseInput =
  | { kind: "nd"; reason: string; action: Action }
  | {
      kind: "value";
      year: number;
      months: string[];
      prevMonths: string[];
      labels: { period: string; prev: string };
      openMonths: string[];
      filtered: boolean; // un service est retenu dans les filtres
      hrefs: SyntheseHrefs;
      rh: SyntheseRh;
      pay: SynthesePay;
      budget: SyntheseBudget;
      live: SyntheseLive;
      landing: SyntheseLanding;
      services: ServicesInput; // lignes par service du chapitre 05 (loadServicesInput)
      seuils: CroiseeSetting<SeuilEffectif[]>;
      marge: CroiseeSetting<number>;
    };

// --- Modèle ------------------------------------------------------------------------------------------------------------------------

export type BlockNd = { label?: string; reason: string; action?: Action };
// Bloc de l'écran : ses tableaux et graphiques (identifiants dans le modèle), ses n.d. et ses lignes courtes. L'export lit la même
// liste : les tableaux affichés deviennent des feuilles, les n.d. vont dans « Non disponibles ».
export type SyntheseBlockId = "cartes" | "graphique" | "composition" | "cascade" | "services" | "chiffres";
export type SyntheseBlock = { id: SyntheseBlockId; title: string; tables: string[]; charts: string[]; nd: BlockNd[]; notes: string[] };
export type PrevuItem = { id: string; label: string; reason: string; term: string };
export type SyntheseChart = CroiseeChart & { note?: string };

// Modèle du chapitre : le modèle commun, plus ce que seul l'écran de la Synthèse montre.
export type SyntheseModel = Omit<ChapterModel, "charts"> & {
  charts: SyntheseChart[];
  blocks: SyntheseBlock[];
  prevu: PrevuItem[]; // indicateurs « Prévu » (commentaire du mois), repris par l'export
  tileNd: string[]; // raisons des n.d. des lignes de cartes (N-1, écarts, notes), écrites une fois sous les cartes
  mentions: AlertMention[]; // réglages absents (seuils d'effectif, marge) : mention et lien vers Paramètres, jamais une alerte
  links: { href: string; label: string }[];
  tableHref: string; // affichage « Tableaux », ancré sur le graphique principal
  tableHrefs: { composition: string; cascade: string };
  trend: boolean; // une carte ou une cellule de tableau porte une tendance de coût colorée : la légende rouge / vert est écrite
  print: { max: number; folded: number }; // « Synthèse en PDF · 1 page » : repères regroupés en « + k autres repères »
  servicesNote: string | null; // filtre de service : seul le service retenu est listé
};

export const PREVU_SYNTHESE: PrevuItem[] = [
  { id: "commentaire", label: "Commentaire du mois", reason: "prévu en version 1.1 : un texte par mois de fin de période, enregistré dans Clair", term: T.commentaire },
];

// --- Calcul nouveau : moyenne de l'ETP contractuel proratisé sur la période --------------------------------------------------

export type ProratedAverage = { kind: "exact" | "lower_bound"; ratio: Ratio; months: number } | { kind: "nd"; reason: string };
const absBig = (x: bigint) => (x < 0n ? -x : x);
const gcd = (a: bigint, b: bigint): bigint => {
  a = absBig(a);
  b = absBig(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};

// Somme des fractions exactes de chaque mois ÷ nombre de mois, sans arrondi intermédiaire. n.d. dès qu'un mois l'est (mois nommés,
// regroupés par raison) ; borne basse (« ≥ ») dès qu'un mois en est une : la moyenne de bornes basses est une borne basse.
export function etpProratedAverage(list: readonly EtpProratedMonthIn[]): ProratedAverage {
  if (list.length === 0) return { kind: "nd", reason: "aucun mois dans la période" };
  const nds = list.filter((m): m is Extract<EtpProratedMonthIn, { kind: "nd" }> => m.kind === "nd");
  if (nds.length) return { kind: "nd", reason: ndLines(ndGroups(nds.map((m) => ({ month: m.month, reason: m.nd.reason })))).join(" ; ") };
  let num = 0n;
  let den = 1n;
  for (const m of list as Extract<EtpProratedMonthIn, { kind: Kind }>[]) {
    if (!Number.isSafeInteger(m.ratio.num) || !Number.isSafeInteger(m.ratio.den) || m.ratio.den <= 0) return { kind: "nd", reason: `${monthShortYear(m.month)} : fraction invalide` };
    num = num * BigInt(m.ratio.den) + BigInt(m.ratio.num) * den;
    den = den * BigInt(m.ratio.den);
    const g = gcd(num, den);
    num /= g;
    den /= g;
  }
  den *= BigInt(list.length);
  const g = gcd(num, den);
  num /= g;
  den /= g;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (absBig(num) > max || den > max) return { kind: "nd", reason: "valeur hors des entiers sûrs" };
  return { kind: list.some((m) => m.kind === "lower_bound") ? "lower_bound" : "exact", ratio: { num: Number(num), den: Number(den) }, months: list.length };
}

// --- Raisons publiques : aucun identifiant de contrat ni d'absence dans la page croisée ---------------------------------------

// Les raisons n.d. du moteur des KPI qui citent un identifiant (contrats continus non vérifiables du turnover, absence rattachée à
// un contrat inconnu, absence sans date) sont remplacées par une raison générique qui garde le mois et le nombre ; le détail
// nominatif reste dans KPI RH, avec ses droits. Les autres raisons sont rendues telles quelles.
const LE_DATE = / le \d{2}\/\d{2}\/\d{4}/g;
const continuity = (_m: string, what: string, month: string, list: string) => {
  const n = (list.match(LE_DATE) ?? []).length || list.split(", ").filter(Boolean).length || 1;
  return `${n} ${n > 1 ? "contrats continus non vérifiables" : "contrat continu non vérifiable"} en ${month} (${what.toLowerCase()}, détail dans KPI RH)`;
};
export function publicReason(text: string): string {
  return text
    .replace(/(entrées|sorties) de (\d{4}-\d{2}) : contrats continus non vérifiables \((.*?)\) — jour voisin hors de la couverture ; sans la neutralisation \(Paramètres\), ces mouvements seraient comptés/gi, continuity)
    .replace(/(entrées|sorties) de (\d{4}-\d{2}) : contrats continus non vérifiables \((.*?)\)/gi, continuity)
    .replace(/absence \S+ rattachée au contrat \S+ inconnu du référentiel/gi, "1 absence rattachée à un contrat inconnu du référentiel (détail dans KPI RH)")
    .replace(/absence \S+ : date de (\S+) non renseignée dans PayFit/gi, (_m, which: string) => `1 absence sans date de ${which} renseignée dans PayFit (détail dans KPI RH)`);
}

// --- Mise en forme ------------------------------------------------------------------------------------------------------------

const nf = new Intl.NumberFormat("fr-FR");
const plural = (n: number, one: string, many: string) => `${nf.format(n)} ${n > 1 ? many : one}`;
const tileLine = (label: string, v: TileValue): TileVariation => plainVariation(label, v.kind === "nd" ? null : v.text, v.kind === "nd" ? v.reason : null);
const money = (w: WindowIn): TileValue => (w.kind === "nd" ? nd(w.nd.reason) : { text: euros(w.masse), kind: "value", reason: null });
const pointOf = (s: Series, m: string): Point => s.points.get(m) ?? { month: m, kind: "nd", reason: "mois non couvert" };
const monthsText = (list: string[]) => list.map(monthShortYear).join(", ");
// Mois consécutifs (dans l'ordre de `all`) : « avr. 2026 → déc. 2026 » ; sinon la liste.
const monthsSpan = (list: string[], all: string[]): string => {
  const i = all.indexOf(list[0]);
  const run = i >= 0 && list.every((m, k) => all[i + k] === m);
  return run && list.length > 1 ? `${monthShortYear(list[0])} → ${monthShortYear(list[list.length - 1])}` : monthsText(list);
};

// Cellules du tableau : fraction exacte (ETP, fraction d'un pourcentage), borne basse écrite « ≥ x », n.d. avec sa raison.
const exactCell = (r: RatioIn, fmt: (x: Ratio) => string): CroiseeCell => (r.kind === "nd" ? { nd: r.nd.reason } : r.kind === "lower_bound" ? `≥ ${fmt(r.ratio)}` : { exact: r.ratio.num / r.ratio.den });
const deltaCell = (d: Delta): CroiseeCell => (d.kind === "nd" ? { nd: d.nd.reason } : { exact: d.value.num / d.value.den / (d.unit === "points" ? 100 : 1) });
const centsCell = (w: WindowIn, pick: (x: Extract<WindowIn, { kind: "value" }>) => number): CroiseeCell => (w.kind === "nd" ? { nd: w.nd.reason } : pick(w));
const costCell = (c: CostIn): CroiseeCell => (c.kind === "nd" ? { nd: c.nd.reason } : { exact: c.costCents.num / c.costCents.den / 100 });
// Écart d'une évolution du moteur, en montant et en % de N-1 (n.d. sur un N-1 nul ou négatif, comme le chapitre 05).
const evoCell = (e: EvolutionIn): CroiseeCell => (e.kind === "nd" ? { nd: e.nd.reason } : e.deltaCents);
const evoPctCell = (e: EvolutionIn): CroiseeCell => (e.kind === "nd" ? { nd: e.nd.reason } : e.ratio === null ? { nd: N1_NUL } : e.ratio.den < 0 ? { nd: N1_NEGATIF } : { exact: e.ratio.num / e.ratio.den });
const pct = (r: Ratio) => `${r.num > 0 ? "+" : ""}${fmtPercent(r)}`;
type ProratedValued = { kind: Kind; ratio: Ratio } | { kind: "nd"; nd: KpiNd };
const valued = (p: ProratedAverage): ProratedValued => (p.kind === "nd" ? { kind: "nd", nd: kpiNd("month-nd", p.reason) } : { kind: p.kind, ratio: p.ratio });

// Raisons des lignes de cartes : celle d'un écart n'est retenue que si la valeur et N-1 sont connues (sinon elle les répète).
type Why = { label: string; reason: string | null | undefined };
const lineReasons = (label: string, cur: TileValue, prev: TileValue, d: { text: string | null; reason: string | null }): Why[] => [
  { label: `${label} N-1`, reason: prev.kind === "nd" ? prev.reason : null },
  { label: `${label}, écart`, reason: cur.kind !== "nd" && prev.kind !== "nd" && d.text === null ? d.reason : null },
];

// Colonnes des tableaux.
const textCol = (key: string, header: string): CroiseeColumn => ({ key, header, kind: "text" });
const eurCol = (key: string, header: string, extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key, header, kind: "eur", ...extra });
const gapCol = (key: string, header: string): CroiseeColumn => ({ key, header, kind: "eur", signed: true, costTrend: true, term: T.tendances });
const gapPctCol = (key: string, header: string): CroiseeColumn => ({ key, header, kind: "pourcent", signed: true, costTrend: true, term: T.ecartPourcentage });

// Mois de l'année N dans le graphique principal : réel (journal ; « réel provisoire » si la paie n'est pas clôturée), projection du
// scénario retenu après son mois de bascule, ou n.d. Le réel et la projection sont deux séries distinctes.
// projNa : la projection est sans objet ce mois-là (mois réalisé, ou antérieur à la bascule du scénario) : « — », jamais n.d.
type YearPoint = { month: string; inPeriod: boolean; nature: "Réel" | "Réel provisoire" | "Projection" | "n.d."; real: number | null; realReason: string | null; proj: number | null; projReason: string | null; projNa: boolean };

export function buildSynthese(input: SyntheseInput): SyntheseModel {
  const empty: SyntheseModel = {
    chapter: CHAPTER,
    tiles: [],
    alerts: [],
    tables: [],
    charts: [],
    limits: [],
    nd: null,
    terms: Object.values(T),
    blocks: [],
    prevu: PREVU_SYNTHESE,
    tileNd: [],
    mentions: [],
    links: [],
    tableHref: "",
    tableHrefs: { composition: "", cascade: "" },
    trend: false,
    print: { max: PRINT_REPERES_MAX, folded: 0 },
    servicesNote: null,
  };
  if (input.kind === "nd") return scrub({ ...empty, nd: { reason: capital(input.reason), action: input.action } });
  const { year, months, labels, rh, pay, budget, live, hrefs } = input;
  const lastMonth = months[months.length - 1];
  const inPeriod = new Set(months);
  const why: Why[] = [];

  // --- 1. ETP moyen (et ETP contractuel proratisé — quotité actuelle, moyenne des mois)
  let etpTile: TileSpec;
  let prorated: ProratedAverage | null = null;
  let proratedPrev: ProratedAverage | null = null;
  const PRORATED_AVG = `${ETP_PRORATED_LABEL}, moyenne des mois`;
  if (rh.kind === "value") {
    const cur = averageTile(rh.etpAverage.current);
    const prev = averageTile(rh.etpAverage.previous);
    const d = deltaView(rh.etpAverage.delta);
    prorated = etpProratedAverage(rh.prorated);
    proratedPrev = etpProratedAverage(rh.proratedPrev);
    const prText = prorated.kind === "nd" ? null : `${prorated.kind === "lower_bound" ? "≥ " : ""}${fmtFixed(prorated.ratio)}`;
    const qualifiers = rh.prorated.flatMap((m) => (m.kind === "nd" ? [] : m.qualifiers));
    etpTile = {
      id: "etp",
      label: "ETP moyen",
      term: T.etpMoyen,
      sub: labels.period,
      value: cur,
      variations: [tileLine("N-1", prev), plainVariation("Écart", d.text, d.reason), plainVariation(PRORATED_AVG, prText, prorated.kind === "nd" ? prorated.reason : null)],
      note: etpProratedNotes(qualifiers.length ? qualifiers : [rh.proratedQualifier]).join(" ; "),
      spark: { label: "ETP contractuel de fin de mois, douze mois glissants", values: rh.sparks.etp.map((e) => (e.kind === "exact" ? e.etp4 : null)) },
    };
    why.push(...lineReasons("ETP moyen", cur, prev, d), { label: PRORATED_AVG, reason: prorated.kind === "nd" ? prorated.reason : null });
  } else etpTile = { id: "etp", label: "ETP moyen", term: T.etpMoyen, sub: labels.period, value: nd(rh.reason) };

  // --- 2. Masse salariale chargée, N-1, évolution, coût par ETP-mois
  let masseTile: TileSpec;
  if (pay.kind === "value") {
    const cur = money(pay.cur);
    const prev = money(pay.prev);
    const ev = evolutionView(pay.evolution);
    const open = pay.cur.kind === "value" ? pay.cur.openMonths : [];
    const costText = pay.cost.kind === "value" ? eurosOfFraction(pay.cost.costCents) : "n.d.";
    const costPrevText = pay.costPrev.kind === "value" ? eurosOfFraction(pay.costPrev.costCents) : "n.d.";
    masseTile = {
      id: "masse",
      label: "Masse salariale chargée",
      term: T.masse,
      sub: open.length ? `${labels.period} · provisoire : ${monthsText(open)}` : labels.period,
      value: cur,
      cost: true,
      main: true,
      variations: [tileLine("N-1", prev), costVariation("Évolution", pay.evolution.kind === "value" ? pay.evolution.deltaCents : null, ev.text, ev.reason)],
      note: `Coût par ETP-mois : ${costText} (N-1 : ${costPrevText})`,
      spark: { label: "Masse salariale chargée par mois, douze mois glissants", values: sparkValues(pay.rolling.map((m) => (m.kind === "value" ? m.masse : null))) },
    };
    why.push(
      { label: "Masse salariale chargée N-1", reason: prev.kind === "nd" ? prev.reason : null },
      { label: "Évolution", reason: cur.kind !== "nd" && prev.kind !== "nd" && ev.text === null ? ev.reason : null },
      { label: "Coût par ETP-mois", reason: pay.cost.kind === "nd" && cur.kind !== "nd" ? pay.cost.nd.reason : null },
      { label: "Coût par ETP-mois N-1", reason: pay.costPrev.kind === "nd" && prev.kind !== "nd" ? pay.costPrev.nd.reason : null },
    );
  } else masseTile = { id: "masse", label: "Masse salariale chargée", term: T.masse, sub: labels.period, value: nd(pay.reason), cost: true, main: true };

  // --- 3. Écart au budget saisi, sur les mois de la période qui ont un montant de budget (les autres sont exclus et nommés)
  const budgetBase = { id: "ecart-budget", label: "Écart au budget", term: T.ecartBudget, cost: true };
  let budgetTile: TileSpec;
  let alertBudget: AlertesInput["budget"];
  const ecartMois = new Map<string, { value: number | null; reason: string }>(); // écart mensuel (mini-courbe et séries des cartes)
  if (budget.kind !== "value") {
    budgetTile = { ...budgetBase, sub: labels.period, value: nd(budget.reason) };
    alertBudget = budget.kind === "absent" ? { kind: "absent", reason: budget.reason } : { kind: "na" };
    for (const m of months) ecartMois.set(m, { value: null, reason: budget.reason });
  } else {
    const withBudget = months.filter((m) => pointOf(budget.series, m).kind === "value");
    const excluded = months.filter((m) => !withBudget.includes(m));
    const monthly = months.map((m) => {
      const b = pointOf(budget.series, m);
      const r = live.kind === "value" ? pointOf(live.series, m) : null;
      return { month: m, real: r?.kind === "value" ? r.cost : null, budget: b.kind === "value" ? b.cost : null };
    });
    for (const m of months) {
      if (!withBudget.includes(m)) ecartMois.set(m, { value: null, reason: "montant du budget non saisi" });
      else if (live.kind === "nd") ecartMois.set(m, { value: null, reason: `réalisé : ${live.reason}` });
      else {
        const x = gap(live.series, budget.series, [m]);
        ecartMois.set(m, x.kind === "value" ? { value: x.delta, reason: "" } : { value: null, reason: x.reason });
      }
    }
    const g = withBudget.length === 0 ? null : live.kind === "nd" ? ({ kind: "nd", reason: `réalisé : ${live.reason}` } as const) : gap(live.series, budget.series, withBudget);
    // Journal non lu : le point « Journal de paie non lu » le dit une fois ; l'écart au budget n'en ajoute pas un second.
    alertBudget = live.kind === "nd" ? { kind: "na" } : { kind: "value", name: budget.name, gap: g === null ? null : g.kind === "nd" ? g : { kind: "value", real: g.a, budget: g.b, delta: g.delta }, monthly };
    const note = excluded.length ? `Comparé sur ${plural(withBudget.length, "mois", "mois")} ; sans montant de budget, exclus : ${monthsText(excluded)}` : undefined;
    const sub = `Réalisé − budget saisi « ${budget.name} »`;
    if (g === null) budgetTile = { ...budgetBase, sub, value: nd(`aucun montant de budget saisi « ${budget.name} » sur la période`) };
    else if (g.kind === "nd") budgetTile = { ...budgetBase, sub, value: nd(g.reason), note };
    else {
      const word = g.delta > 0 ? "défavorable" : g.delta < 0 ? "favorable" : "égal au budget";
      budgetTile = {
        ...budgetBase,
        sub,
        value: { text: eurosSigned(g.delta), kind: "value", reason: null },
        valueTone: costTone(g.delta),
        variations: [
          plainVariation("Budget de la période", euros(g.b)),
          plainVariation("Réalisé", euros(g.a)),
          costVariation("Écart (%)", g.pct === null ? null : g.delta, g.pct === null ? null : `${pct(g.pct)} · ${word}`, g.pct === null ? "budget saisi nul ou négatif : pourcentage non défini" : null),
        ],
        note,
        spark: { label: "Écart mensuel au budget saisi", values: months.map((m) => ecartMois.get(m)?.value ?? null) },
      };
      if (g.pct === null) why.push({ label: "Écart au budget (%)", reason: "budget saisi nul ou négatif : pourcentage non défini" });
    }
  }

  // --- 4. Atterrissage annuel : réel des mois clos + projection du scénario retenu. Valeur : les douze mois. Comparaison au budget
  // saisi sur les MÊMES mois (ceux qui ont un montant de budget) : atterrissage de ces mois − budget de ces mois = écart.
  const yearKey = String(year);
  const ym = yearMonths(year);
  let landingTile: TileSpec;
  let alertLanding: AlertesInput["landing"] = input.landing.kind === "nd" ? { kind: "nd", reason: input.landing.reason } : { kind: "na" };
  let landingGap: Gap | null = null;
  let landingCompared: { months: number; excluded: string[] } | null = null;
  let landingBudgetReason: string | null = null;
  if (input.landing.kind === "value") {
    const L = input.landing;
    const land = L.landing;
    let budgetIn: Parameters<typeof landingView>[1] = null;
    let excluded: string[] = [];
    let compared = 0;
    if (budget.kind === "value") {
      const withBudget = ym.filter((m) => pointOf(budget.series, m).kind === "value");
      excluded = ym.filter((m) => !withBudget.includes(m));
      compared = withBudget.length;
      if (withBudget.length === 0) budgetIn = { total: { kind: "nd", reason: `aucun montant de budget saisi « ${budget.name} » pour ${yearKey}` } };
      else {
        budgetIn = { total: total(budget.series, withBudget) };
        if (land.kind === "value") landingGap = gap(L.series, budget.series, withBudget);
        landingCompared = { months: compared, excluded };
      }
    }
    const v = landingView(land, budgetIn, landingGap, yearKey);
    landingBudgetReason = v.budget.kind === "nd" ? v.budget.reason : null;
    const partial = excluded.length > 0 && compared > 0;
    const nm = plural(compared, "mois", "mois");
    const sameMonths = landingGap?.kind === "value" && land.kind === "value" && (partial || landingGap.a !== land.total);
    const parts = land.kind === "value" ? [`réel : ${plural(land.actualMonths.length, "mois", "mois")}`, ...(land.priorMonths.length ? [`projection du scénario parent : ${plural(land.priorMonths.length, "mois", "mois")}`] : []), `projection : ${plural(land.projectedMonths.length, "mois", "mois")}`] : [];
    landingTile = {
      id: "atterrissage",
      label: `Atterrissage ${yearKey}`,
      term: T.atterrissage,
      sub: `Scénario « ${L.scenarioName} » · douze mois`,
      value: v.value,
      cost: true,
      variations: [
        tileLine(budget.kind === "value" ? `Budget saisi « ${budget.name} »${partial ? `, ${nm}` : ""}` : "Budget saisi", v.budget),
        ...(sameMonths && landingGap?.kind === "value" ? [plainVariation(`Atterrissage, ${nm} comparés`, euros(landingGap.a))] : []),
        costVariation(partial ? `Écart, ${nm} comparés` : "Écart", landingGap?.kind === "value" ? landingGap.delta : null, v.gap.text, v.gap.reason),
      ],
      note: [parts.join(" · "), partial ? `sans montant de budget, exclus : ${monthsText(excluded)}` : ""].filter(Boolean).join(" ; ") || undefined,
      spark: {
        label: "Réel puis projection, par mois",
        values: ym.map((m) => {
          const p = pointOf(L.series, m);
          return p.kind === "value" ? p.cost : null;
        }),
      },
    };
    if (v.value.kind !== "nd") why.push({ label: "Budget saisi de l'année", reason: v.budget.kind === "nd" ? v.budget.reason : null }, { label: "Atterrissage, écart", reason: v.budget.kind !== "nd" && v.gap.text === null ? v.gap.reason : null });
    alertLanding = land.kind === "nd"
      ? { kind: "nd", reason: land.reason }
      : { kind: "value", total: land.total, gap: landingGap === null ? null : landingGap.kind === "nd" ? landingGap : { kind: "value", landing: landingGap.a, budget: landingGap.b, delta: landingGap.delta, months: compared, excluded } };
  } else landingTile = { id: "atterrissage", label: `Atterrissage ${yearKey}`, term: T.atterrissage, value: nd(input.landing.reason), cost: true };

  // --- 5. Absentéisme (tuile principale du moteur : motifs retenus) et 6. turnover sur douze mois glissants
  let absTile: TileSpec;
  let toTile: TileSpec;
  const rolling12 = `douze mois glissants à fin ${monthLongLabel(lastMonth)}`;
  if (rh.kind === "value") {
    const a = rh.absenteeism;
    const cur = rateTile(a.current);
    const prev = rateTile(a.previous);
    const d = deltaView(a.delta);
    absTile = {
      id: "absenteisme",
      label: "Absentéisme",
      term: T.absenteisme,
      sub: labels.period,
      value: cur,
      variations: [
        tileLine("N-1", prev),
        plainVariation("Écart", d.text, d.reason),
        // Une borne basse du taux est une borne basse des jours d'absence : « ≥ » écrit devant.
        ...(a.current.kind === "nd" ? [] : [plainVariation("Absence", `${a.current.kind === "lower_bound" ? "≥ " : ""}${fmtHalfDays(a.current.ratio.num)} sur ${fmtHalfDays(a.current.ratio.den)} théoriques`)]),
      ],
      note: motifsRetenusLine(rh.absenceTypes),
      spark: { label: "Absentéisme par mois, douze mois glissants", values: rh.sparks.absenteeism.map((r) => (r.kind === "exact" && r.ratio.den > 0 ? r.ratio.num / r.ratio.den : null)) },
    };
    why.push(...lineReasons("Absentéisme", cur, prev, d));
    const t = rh.turnover;
    const tc = rateTile(t.current);
    const tp = rateTile(t.previous);
    const td = deltaView(t.delta);
    const moves = t.current.kind === "nd" ? [] : [plainVariation("Sorties", nf.format(t.current.exits)), plainVariation("Entrées", t.current.entries === null ? null : nf.format(t.current.entries), t.current.entries === null ? "entrées non exactes sur la période" : null)];
    // Effectif de fin de la fenêtre de douze mois : dernier point de la mini-courbe (effectif de fin de mois).
    const end = rh.sparks.headcount[rh.sparks.headcount.length - 1];
    const endText = !end || end.kind === "nd" ? "n.d." : `${end.kind === "lower_bound" ? "≥ " : ""}${nf.format(end.persons)}`;
    toTile = {
      id: "turnover",
      label: "Turnover",
      term: T.turnover,
      sub: capital(rolling12),
      value: tc,
      variations: [tileLine("N-1", tp), plainVariation("Écart", td.text, td.reason), ...moves],
      note: `Effectif de fin : ${endText} (fin ${monthLongLabel(lastMonth)})`,
      spark: { label: "Effectif de fin de mois, douze mois glissants", values: rh.sparks.headcount.map((h) => (h.kind === "exact" ? h.persons : null)) },
    };
    why.push(...lineReasons("Turnover", tc, tp, td));
    if (t.current.kind !== "nd" && t.current.entries === null) why.push({ label: "Entrées", reason: "entrées non exactes sur la période" });
    if (end && end.kind === "nd") why.push({ label: "Effectif de fin", reason: end.nd.reason });
  } else {
    absTile = { id: "absenteisme", label: "Absentéisme", term: T.absenteisme, sub: labels.period, value: nd(rh.reason) };
    toTile = { id: "turnover", label: "Turnover", term: T.turnover, sub: capital(rolling12), value: nd(rh.reason) };
  }
  const tiles = [etpTile, masseTile, budgetTile, landingTile, absTile, toTile];

  // --- Graphique principal : les douze mois de N, réel et projection en séries distinctes, budget saisi, N-1 ; mois de la période
  // marqués (« • ») ; tableau exact avec l'écart réel − N-1 de chaque mois réalisé, un lien par mois clos et le total de la période.
  const L = input.landing.kind === "value" ? input.landing : null;
  const landingReason = input.landing.kind === "value" ? null : input.landing.reason;
  const yearPoints: YearPoint[] = ym.map((m, i) => {
    const r = pay.kind === "value" ? pay.year[i] : null;
    const base = { month: m, inPeriod: inPeriod.has(m) };
    if (r && r.kind === "value") return { ...base, nature: r.open ? "Réel provisoire" : "Réel", real: r.masse, realReason: null, proj: null, projReason: "mois réalisé : réel affiché", projNa: true };
    const realReason = (r && r.kind === "nd" ? r.nd.reason : pay.kind === "nd" ? pay.reason : null) ?? "valeur absente";
    if (L && m > L.refMonth) {
      const p = pointOf(L.series, m);
      if (p.kind === "value" && (p.layer === "projete" || p.layer === "projete-parent")) return { ...base, nature: "Projection", real: null, realReason: "mois projeté : projection affichée", proj: p.cost, projReason: null, projNa: false };
      return { ...base, nature: "n.d.", real: null, realReason, proj: null, projReason: `projection : ${p.kind === "nd" ? p.reason : "mois non projeté"}`, projNa: false };
    }
    return L
      ? { ...base, nature: "n.d.", real: null, realReason, proj: null, projReason: "mois antérieur à la bascule du scénario", projNa: true }
      : { ...base, nature: "n.d.", real: null, realReason, proj: null, projReason: `projection : ${landingReason ?? "aucun scénario"}`, projNa: false };
  });
  const budgetCell = (m: string): { value: number | null; reason: string | null } => {
    if (budget.kind !== "value") return { value: null, reason: budget.reason };
    const p = pointOf(budget.series, m);
    return p.kind === "value" ? { value: p.cost, reason: null } : { value: null, reason: p.reason };
  };
  const n1 = (i: number): { value: number | null; reason: string | null } => {
    if (pay.kind === "nd") return { value: null, reason: pay.reason };
    const r = pay.yearPrev[i];
    return r && r.kind === "value" ? { value: r.masse, reason: null } : { value: null, reason: r?.kind === "nd" ? r.nd.reason : "mois non lu" };
  };
  const projected = yearPoints.filter((p) => p.nature === "Projection").map((p) => p.month);
  const budgetName = budget.kind === "value" ? `Budget saisi « ${budget.name} »` : "Budget saisi";
  const yearLabel = periodLabel(ym);
  const mark = (p: YearPoint) => (p.inPeriod ? " •" : "");
  const mainSeries: ChartSeries[] = [
    { key: "reel", name: "Réel", values: yearPoints.map((p) => p.real), reasons: yearPoints.map((p) => p.realReason), color: COLORS.now },
    { key: "projection", name: L ? `Projection, scénario « ${L.scenarioName} »` : "Projection", values: yearPoints.map((p) => p.proj), reasons: yearPoints.map((p) => p.projReason), color: "var(--chart-3)" },
    { key: "budget", name: budgetName, values: ym.map((m) => budgetCell(m).value), reasons: ym.map((m) => budgetCell(m).reason), color: "var(--chart-2)" },
    { key: "n1", name: "N-1 (même mois)", values: ym.map((_, i) => n1(i).value), reasons: ym.map((_, i) => n1(i).reason), color: COLORS.before },
  ];
  const isReal = (p: YearPoint) => p.nature === "Réel" || p.nature === "Réel provisoire";
  const mensuelRows = yearPoints.map((p, i): CroiseeRow => {
    const b = budgetCell(p.month);
    const q = n1(i);
    const evo: EvolutionIn | null = pay.kind === "value" ? (pay.yearEvo[i] ?? null) : null;
    const gapCells: CroiseeCell[] = p.nature === "Projection" ? ["", ""] : !isReal(p) ? [{ nd: p.realReason ?? "valeur absente" }, { nd: p.realReason ?? "valeur absente" }] : evo ? [evoCell(evo), evoPctCell(evo)] : [{ nd: "évolution non calculée" }, { nd: "évolution non calculée" }];
    // Lien : la période restreinte à ce mois (mois clos seulement : un mois provisoire ou projeté n'est pas une période possible).
    const href = p.nature === "Réel" ? hrefs.months[i] : undefined;
    return {
      cells: [
        capital(monthLongLabel(p.month)),
        p.inPeriod ? "Oui" : "Non",
        p.nature === "n.d." ? "" : p.nature,
        p.real !== null ? p.real : p.nature === "Projection" ? "" : { nd: p.realReason ?? "valeur absente" },
        p.proj !== null ? p.proj : p.projNa ? "" : { nd: p.projReason ?? "valeur absente" },
        b.value === null ? { nd: b.reason ?? "montant du budget non saisi" } : b.value,
        q.value === null ? { nd: q.reason ?? "valeur absente" } : q.value,
        ...gapCells,
      ],
      ...(href ? { href } : {}),
    };
  });
  const totalBudget: CroiseeCell = budget.kind !== "value" ? { nd: budget.reason } : (() => {
    const t = total(budget.series, months);
    return t.kind === "value" ? t.cost : { nd: t.reason };
  })();
  const mensuelFoot: CroiseeRow =
    pay.kind === "value"
      ? {
          cells: [
            `Total ${labels.period}`,
            "",
            pay.cur.kind === "value" && pay.cur.openMonths.length ? "Réel provisoire" : "Réel",
            centsCell(pay.cur, (x) => x.masse),
            "",
            totalBudget,
            centsCell(pay.prev, (x) => x.masse),
            evoCell(pay.evolution),
            evoPctCell(pay.evolution),
          ],
        }
      : { cells: [`Total ${labels.period}`, "", "", { nd: pay.reason }, "", totalBudget, { nd: pay.reason }, { nd: pay.reason }, { nd: pay.reason }] };
  const mensuel: CroiseeTable = {
    id: ID.mensuel,
    title: `Masse salariale chargée par mois, ${yearLabel} : réel, projection, budget saisi et N-1`,
    columns: [
      textCol("mois", "Mois"),
      textCol("periode", "Dans la période"),
      textCol("nature", "Nature"),
      eurCol("reel", "Réel", { term: T.masse }),
      eurCol("projection", "Projection", { term: T.projection }),
      eurCol("budget", budgetName, { term: T.budgetSaisi }),
      eurCol("n1", "N-1 (même mois)", { term: T.nMoinsUn }),
      gapCol("ecart", "Écart réel − N-1"),
      gapPctCol("ecart-pct", "Écart réel − N-1 (%)"),
    ],
    rows: mensuelRows,
    foot: mensuelFoot,
    notes: [
      ...(projected.length && L ? [`Projection : ${monthsSpan(projected, ym)}, scénario « ${L.scenarioName} ».`] : []),
      `Période retenue : ${labels.period} ; N-1 : ${labels.prev}.`,
    ],
    terms: [T.masse, T.budgetSaisi, T.projection, T.nMoinsUn, T.tendances],
  };
  const mainChart: SyntheseChart = {
    id: ID.mensuel,
    title: `Masse salariale chargée par mois, ${yearLabel} : réel, projection, budget et N-1`,
    kind: "barres",
    unit: "eur",
    categories: yearPoints.map((p) => `${monthShortLabel(p.month)}${mark(p)}`),
    categoryTitles: yearPoints.map((p) => `${monthLongLabel(p.month)} · ${p.nature === "Projection" && L ? `projection (scénario « ${L.scenarioName} »)` : p.nature.toLowerCase()}${p.inPeriod ? " · dans la période" : ""}`),
    series: mainSeries,
    mode: "grouped",
    tableId: ID.mensuel,
    note: `• : mois de la période (${labels.period}).`,
  };

  // --- Composition de la masse chargée de la période : fixe, variable, gratifications de stage (brutParts) et cotisations ; écart
  // N / N-1 en montant et en % (évolution du moteur, n.d. sur un N-1 nul ou négatif).
  const curW: WindowIn = pay.kind === "value" ? pay.cur : { kind: "nd", nd: { reason: pay.reason } };
  const prevW: WindowIn = pay.kind === "value" ? pay.prev : { kind: "nd", nd: { reason: pay.reason } };
  const PICK: Record<CompositionKey, (x: Extract<WindowIn, { kind: "value" }>) => number> = {
    fixe: (x) => x.byRubric.salaires,
    variable: (x) => x.byRubric.primes + x.byRubric.indemnites,
    stages: (x) => x.byRubric.stages,
    brut: (x) => x.brut,
    cotisations: (x) => x.cotisations,
    masse: (x) => x.masse,
  };
  const compLine = (label: string, k: CompositionKey, style?: CroiseeRow["style"]): CroiseeRow => {
    const e: EvolutionIn = pay.kind === "value" ? pay.composition[k] : { kind: "nd", nd: { reason: pay.reason } };
    return { cells: [label, centsCell(curW, PICK[k]), centsCell(prevW, PICK[k]), evoCell(e), evoPctCell(e)], ...(style ? { style } : {}) };
  };
  const composition: CroiseeTable = {
    id: ID.composition,
    title: `Composition de la masse chargée, ${labels.period}`,
    columns: [textCol("composante", "Composante"), eurCol("n", labels.period), eurCol("n1", `N-1 (${labels.prev})`), gapCol("ecart", "Écart"), gapPctCol("ecart-pct", "Écart (%)")],
    rows: [
      compLine("Fixe (salaires et congés payés)", "fixe", "child"),
      compLine("Variable (primes et indemnités)", "variable", "child"),
      compLine("Gratifications de stage", "stages", "child"),
      compLine("Brut", "brut", "subtotal"),
      compLine("Cotisations patronales", "cotisations"),
    ],
    foot: compLine("Masse salariale chargée", "masse"),
    terms: [T.fixeVariable, T.brut, T.cotisations, T.masse, T.tendances],
  };
  const cs = curW.kind === "value" ? { fixe: PICK.fixe(curW), variable: PICK.variable(curW), stages: PICK.stages(curW) } : null;
  const parts = cs ? brutParts(cs) : [];
  const compChart: SyntheseChart = {
    id: ID.composition,
    title: `Composition de la masse chargée, ${labels.period}`,
    kind: "anneau",
    unit: "eur",
    categories: [labels.period],
    series: [
      ...(parts.length ? parts.map((p) => ({ key: p.key, name: p.name, values: [p.value], reasons: [p.reason ?? null], color: p.color })) : [{ key: "brut", name: "Brut", values: [null], reasons: [curW.kind === "nd" ? curW.nd.reason : null], color: COLORS.brut }]),
      { key: "cotisations", name: "Cotisations patronales", values: [curW.kind === "value" ? curW.cotisations : null], reasons: [curW.kind === "nd" ? curW.nd.reason : null], color: COLORS.charges },
    ],
    tableId: ID.composition,
  };

  // --- D'où vient l'écart de coût ? Cascade de la masse chargée par rubrique, de N-1 à N (masseByRubric + masseWaterfall, comme
  // l'Analyse des écarts) et son tableau exact. Une rubrique n.d. n'est jamais répartie : sa part est la barre « Rubriques n.d. ».
  const tables: CroiseeTable[] = [mensuel, composition];
  const charts: SyntheseChart[] = [mainChart, compChart];
  const cascadeBlock: SyntheseBlock = { id: "cascade", title: "D'où vient l'écart de coût ?", tables: [], charts: [], nd: [], notes: [] };
  const cascade: MasseRubric = pay.kind === "value" ? pay.cascade : { kind: "nd", reason: pay.reason };
  const wf = masseWaterfall(cascade);
  if (cascade.kind === "nd" || wf.kind === "nd") cascadeBlock.nd.push({ label: "Cascade de l'écart de coût", reason: cascade.kind === "nd" ? cascade.reason : wf.kind === "nd" ? wf.reason : "cascade n.d." });
  else {
    const anyNd = cascade.steps.some((s) => s.delta === null);
    const residual = cascade.residual ?? 0;
    charts.push({
      id: ID.cascade,
      title: `Masse salariale chargée, de N-1 (${labels.prev}) à N (${labels.period}) : contribution de chaque rubrique`,
      kind: "cascade",
      unit: "eur",
      categories: ["N-1", ...wf.steps.map((s) => s.label), "N"],
      series: [{ key: "cascade", name: "Masse salariale chargée", values: [wf.start, ...wf.steps.map((s) => s.value), wf.end] }],
      tableId: ID.cascade,
      trend: "cost",
    });
    tables.push({
      id: ID.cascade,
      title: `De la masse chargée N-1 (${labels.prev}) à N (${labels.period}), par rubrique`,
      columns: [textCol("ligne", "Ligne"), eurCol("montant", "Montant", { term: T.masse }), gapCol("ecart", "Écart")],
      rows: [
        { cells: [`Masse salariale chargée N-1 (${labels.prev})`, cascade.start, ""], style: "subtotal" },
        ...cascade.steps.map((s): CroiseeRow => ({ cells: [s.label, "", s.delta === null ? { nd: s.reason ?? "rubrique n.d." } : s.delta], style: "child" })),
        ...(anyNd || residual !== 0 ? [{ cells: [anyNd ? "Rubriques n.d. (écart non réparti)" : "Résiduel", "", residual], style: "child" } as CroiseeRow] : []),
        { cells: ["Écart total", "", cascade.end - cascade.start], style: "subtotal" },
      ],
      foot: { cells: [`Masse salariale chargée N (${labels.period})`, cascade.end, ""] },
      terms: [T.contributions, T.residuel, T.cascades, T.masse, T.tendances],
    });
    cascadeBlock.tables.push(ID.cascade);
    cascadeBlock.charts.push(ID.cascade);
  }

  // --- Tableau de synthèse par service : lignes du chapitre 05 (buildServices sur loadServicesInput), colonnes Service, coût de la
  // période, part du coût, écart et écart en % ; chaque service filtre la page. Sous un filtre de service, seule la ligne du service
  // retenu (aucun total de toute l'entreprise, aucune part).
  const servicesBlock: SyntheseBlock = { id: "services", title: "Tableau de synthèse par service", tables: [], charts: [], nd: [], notes: [] };
  let servicesNote: string | null = null;
  const sv = buildServices(input.services);
  const src = sv.tables.find((t) => t.id === SERVICES_IDS.table);
  if (sv.nd || !src) servicesBlock.nd.push({ label: "Tableau de synthèse par service", reason: sv.nd?.reason ?? "tableau par service indisponible", action: sv.nd?.action });
  else {
    const filtered = sv.selected !== null;
    const wanted: [string, string][] = [["service", "Service"], ["n", `Coût ${labels.period}`], ...(filtered ? [] : ([["part", "Part du coût"]] as [string, string][])), ["ecart", "Écart N / N-1"], ["ecart-pct", "Écart N / N-1 (%)"]];
    const picks = wanted.map(([key, header]) => ({ i: src.columns.findIndex((c) => c.key === key), header })).filter((x) => x.i >= 0);
    if (picks.length < 2 || src.columns[picks[0].i].key !== "service") servicesBlock.nd.push({ label: "Tableau de synthèse par service", reason: "colonnes du tableau par service introuvables" });
    else {
      const project = (r: CroiseeRow): CroiseeRow => ({ cells: picks.map((p) => r.cells[p.i]), ...(r.href ? { href: r.href } : {}) });
      const rows = filtered ? src.rows.filter((r) => r.cells[0] === sv.selected!.label) : src.rows;
      tables.push({
        id: ID.services,
        title: `Coût par service, ${labels.period} (N-1 : ${labels.prev})`,
        columns: picks.map((p) => ({ ...src.columns[p.i], header: p.header, sortable: false })),
        rows: rows.map(project),
        ...(src.foot && !filtered ? { foot: project(src.foot) } : {}),
        terms: [T.service, T.masse, T.evolution, T.tendances],
      });
      servicesBlock.tables.push(ID.services);
      if (filtered) servicesNote = `Filtre Service : seul le service « ${sv.selected!.label} » est listé ; le chapitre 05 · Services montre tous les services.`;
      if (rows.length === 0) servicesBlock.notes.push("Aucune ligne de charges de personnel dans le journal sur la période.");
    }
  }

  // --- Chiffres clés en tableau (exports) : montants d'une part, effectifs et taux d'autre part (unités jamais mêlées). Chaque
  // ligne vérifie Valeur − Référence = Écart sur les mêmes mois.
  const montantsRows: CroiseeRow[] = [];
  if (pay.kind === "value") {
    montantsRows.push(
      { cells: ["Masse salariale chargée", labels.period, centsCell(pay.cur, (x) => x.masse), `N-1 : ${labels.prev}`, centsCell(pay.prev, (x) => x.masse), pay.evolution.kind === "value" ? pay.evolution.deltaCents : { nd: pay.evolution.nd.reason }] },
      { cells: ["Coût par ETP-mois", labels.period, costCell(pay.cost), `N-1 : ${labels.prev}`, costCell(pay.costPrev), ""] },
    );
  } else {
    const r = { nd: pay.reason };
    montantsRows.push({ cells: ["Masse salariale chargée", labels.period, r, `N-1 : ${labels.prev}`, r, r] }, { cells: ["Coût par ETP-mois", labels.period, r, `N-1 : ${labels.prev}`, r, ""] });
  }
  {
    const b = alertBudget;
    const gv = b.kind === "value" ? b.gap : null;
    const reason = budgetTile.value.kind === "nd" ? (budgetTile.value.reason ?? "valeur absente") : "valeur absente";
    const n = b.kind === "value" ? b.monthly.filter((m) => m.budget !== null).length : 0;
    montantsRows.push({
      cells: [
        "Écart au budget saisi",
        b.kind === "value" && n > 0 ? `${labels.period} (${plural(n, "mois", "mois")} avec budget)` : labels.period,
        gv?.kind === "value" ? gv.real : { nd: reason },
        budget.kind === "value" ? `Budget saisi « ${budget.name} »` : "Budget saisi",
        gv?.kind === "value" ? gv.budget : { nd: reason },
        gv?.kind === "value" ? gv.delta : { nd: reason },
      ],
    });
  }
  {
    // Atterrissage des douze mois sur sa propre ligne, sans écart ; puis atterrissage et budget sur les mêmes mois, avec l'écart.
    const lr = landingTile.value.kind === "nd" ? (landingTile.value.reason ?? "valeur absente") : null;
    const scen = input.landing.kind === "value" ? `Scénario « ${input.landing.scenarioName} » · douze mois` : `Année ${yearKey}`;
    montantsRows.push({ cells: [`Atterrissage ${yearKey}`, scen, input.landing.kind === "value" && input.landing.landing.kind === "value" ? input.landing.landing.total : { nd: lr ?? "valeur absente" }, "", "", ""] });
    const gr = lr ?? (landingGap?.kind === "nd" ? landingGap.reason : landingBudgetReason ?? (budget.kind !== "value" ? budget.reason : "valeur absente"));
    const cmp = landingCompared;
    montantsRows.push({
      cells: [
        `Atterrissage ${yearKey} face au budget`,
        cmp ? `${plural(cmp.months, "mois", "mois")} comparés${cmp.excluded.length ? ` (sans montant de budget : ${monthsText(cmp.excluded)})` : ""}` : `Année ${yearKey}`,
        landingGap?.kind === "value" ? landingGap.a : { nd: gr },
        budget.kind === "value" ? `Budget saisi « ${budget.name} »` : "Budget saisi",
        landingGap?.kind === "value" ? landingGap.b : { nd: gr },
        landingGap?.kind === "value" ? landingGap.delta : { nd: gr },
      ],
    });
  }
  const montants: CroiseeTable = {
    id: ID.montants,
    title: `Chiffres clés de la période : montants, ${labels.period}`,
    columns: [textCol("indicateur", "Indicateur"), textCol("mesure", "Mesure"), eurCol("valeur", "Valeur"), textCol("comparaison", "Comparé à"), eurCol("reference", "Référence"), gapCol("ecart", "Écart")],
    rows: montantsRows,
    terms: [T.masse, T.coutEtp, T.ecartBudget, T.atterrissage, T.evolution],
  };
  const rhRows: CroiseeRow[] = [];
  if (rh.kind === "value") {
    const pr = prorated ?? etpProratedAverage(rh.prorated);
    const pp = proratedPrev ?? etpProratedAverage(rh.proratedPrev);
    const avgCell = (p: ProratedAverage): CroiseeCell => (p.kind === "nd" ? { nd: p.reason } : p.kind === "lower_bound" ? `≥ ${fmtFixed(p.ratio)}` : { exact: p.ratio.num / p.ratio.den });
    const prDelta = kpiDelta(valued(pr), valued(pp), etpProratedValue, "etp", labels.prev);
    const t = rh.turnover;
    const turnoverCell = (x: TurnoverIn): CroiseeCell => (x.kind === "nd" ? { nd: x.nd.reason } : { exact: x.ratio.num / x.ratio.den });
    rhRows.push(
      { cells: ["ETP moyen", labels.period, exactCell(rh.etpAverage.current, (x) => fmtFixed(x)), exactCell(rh.etpAverage.previous, (x) => fmtFixed(x)), deltaCell(rh.etpAverage.delta)], kind: "etp" },
      { cells: [PRORATED_AVG, labels.period, avgCell(pr), avgCell(pp), deltaCell(prDelta)], kind: "etp" },
      { cells: ["Absentéisme", labels.period, exactCell(rh.absenteeism.current, fmtPercent), exactCell(rh.absenteeism.previous, fmtPercent), deltaCell(rh.absenteeism.delta)], kind: "pourcent" },
      { cells: ["Turnover", capital(rolling12), turnoverCell(t.current), turnoverCell(t.previous), deltaCell(t.delta)], kind: "pourcent" },
    );
  } else {
    const r = { nd: rh.reason };
    for (const [label, mesure, kind] of [["ETP moyen", labels.period, "etp"], [PRORATED_AVG, labels.period, "etp"], ["Absentéisme", labels.period, "pourcent"], ["Turnover", capital(rolling12), "pourcent"]] as const) rhRows.push({ cells: [label, mesure, r, r, r], kind });
  }
  const rhTable: CroiseeTable = {
    id: ID.rh,
    title: `Chiffres clés de la période : ETP et taux, ${labels.period}`,
    columns: [textCol("indicateur", "Indicateur"), textCol("mesure", "Mesure"), { key: "valeur", header: "Valeur", kind: "etp" }, { key: "n1", header: `N-1 (${labels.prev})`, kind: "etp", term: T.nMoinsUn }, { key: "ecart", header: "Écart", kind: "etp", signed: true, points: true }],
    rows: rhRows,
    notes: ["ETP en équivalents temps plein ; taux en pourcentage, écarts de taux en points."],
    terms: [T.etpMoyen, T.etpProratise, T.absenteisme, T.turnover, T.nMoinsUn],
  };

  // --- Séries des cartes en tableau : les valeurs exactes des mini-courbes, mois par mois (n.d. avec sa raison ; « — » quand la
  // mini-courbe ne couvre pas ce mois).
  const rollMonths = rollingWindow(lastMonth).months;
  const allMonths = [...new Set([...rollMonths, ...months, ...ym])].sort();
  const rIdx = (m: string) => rollMonths.indexOf(m);
  const seriesRows = allMonths.map((m): CroiseeRow => {
    const i = rIdx(m);
    // Les mini-courbes RH suivent rh.rolling (les mêmes douze mois glissants).
    const k = rh.kind === "value" ? rh.rolling.indexOf(m) : i;
    const rhCell = <V,>(list: V[] | null, f: (v: V) => CroiseeCell): CroiseeCell => (i < 0 ? "" : rh.kind !== "value" ? { nd: rh.reason } : !list || k < 0 || list[k] === undefined ? { nd: "mois non calculé" } : f(list[k]));
    const etp = rhCell(rh.kind === "value" ? rh.sparks.etp : null, (e) => (e.kind === "nd" ? { nd: e.nd.reason } : e.kind === "lower_bound" ? `≥ ${fmtEtp4(e.etp4)}` : e.etp4));
    const abs = rhCell(rh.kind === "value" ? rh.sparks.absenteeism : null, (r) => exactCell(r, fmtPercent));
    const head = rhCell(rh.kind === "value" ? rh.sparks.headcount : null, (h) => (h.kind === "nd" ? { nd: h.nd.reason } : h.kind === "lower_bound" ? `≥ ${nf.format(h.persons)}` : h.persons));
    const ri = pay.kind === "value" ? pay.rolling.findIndex((x) => x.month === m) : -1;
    const masse: CroiseeCell = i < 0 ? "" : pay.kind === "nd" ? { nd: pay.reason } : ri < 0 ? { nd: "mois non calculé" } : (() => {
      const x = pay.rolling[ri];
      return x.kind === "value" ? x.masse : { nd: x.nd.reason };
    })();
    const e = ecartMois.get(m);
    const ecart: CroiseeCell = !e ? "" : e.value === null ? { nd: e.reason } : e.value;
    const land: CroiseeCell = !ym.includes(m) ? "" : L ? (() => {
      const p = pointOf(L.series, m);
      return p.kind === "value" ? p.cost : { nd: p.reason };
    })() : { nd: landingReason ?? "atterrissage non calculé" };
    return { cells: [capital(monthLongLabel(m)), etp, masse, abs, head, ecart, land] };
  });
  const seriesTable: CroiseeTable = {
    id: ID.series,
    title: "Séries des cartes, mois par mois",
    columns: [
      textCol("mois", "Mois"),
      { key: "etp", header: "ETP de fin de mois", kind: "etp", term: "etp-month-end" },
      eurCol("masse", "Masse salariale chargée", { term: T.masse }),
      { key: "absenteisme", header: "Absentéisme du mois", kind: "pourcent", term: T.absenteisme },
      { key: "effectif", header: "Effectif de fin de mois", kind: "nombre" },
      { key: "ecart-budget", header: "Écart au budget saisi", kind: "eur", signed: true, costTrend: true, term: T.ecartBudget },
      eurCol("atterrissage", "Réel puis projection (atterrissage)", { term: T.atterrissage }),
    ],
    rows: seriesRows,
    notes: [`Douze mois glissants à fin ${monthLongLabel(lastMonth)} pour l'ETP, la masse, l'absentéisme et l'effectif ; période pour l'écart au budget ; année ${yearKey} pour l'atterrissage.`],
    terms: ["etp-month-end", T.masse, T.absenteisme, T.ecartBudget, T.atterrissage],
  };
  tables.push(montants, rhTable, seriesTable);

  // --- Points à surveiller (fonction pure, mêmes chiffres que les cartes)
  const missing: MissingSource[] = [];
  if (pay.kind === "nd") missing.push({ id: "journal", label: "Journal de paie non lu", reason: pay.reason, href: pay.action.href, linkLabel: pay.action.label });
  if (rh.kind === "nd") missing.push({ id: "rh", label: "Indicateurs RH non calculés", reason: rh.reason, href: rh.action.href, linkLabel: rh.action.label });
  const ndTiles = [...(rh.kind === "value" ? [etpTile, absTile, toTile] : []), ...(pay.kind === "value" ? [masseTile] : [])].filter((t) => t.value.kind === "nd");
  if (ndTiles.length) missing.push({ id: "indicateurs", label: "Indicateurs n.d.", reason: `${ndTiles.map((t) => t.label).join(", ")} : raison sur la carte` });
  const { alerts, mentions } = selectAlerts({
    year,
    budget: alertBudget,
    landing: alertLanding,
    openMonths: input.openMonths,
    unclassified: pay.kind === "value" ? pay.unclassified : [],
    missing,
    seuils: seuilInput(input),
    checks: pay.kind === "value" ? pay.checks : { compta: { kind: "skip" }, dsn: { kind: "skip" } },
    hrefs: { parametres: hrefs.parametres, grille: hrefs.grille, budget: hrefs.budget, paieCompta: hrefs.paieCompta, donnees: hrefs.donnees },
  });
  // Sous un filtre de service, les contrôles du journal (comptabilité, DSN) ne sont pas faits : la mention le dit (pas de silence).
  if (input.filtered) mentions.push({ id: "controles", text: "Contrôles du journal de paie (comptabilité, DSN) : non filtrables par service." });

  const tileTrend = tiles.some((t) => t.cost && ((t.valueTone && t.valueTone !== "flat") || (t.variations ?? []).some((x) => x.tone !== "flat" && x.text !== null)));
  const blocks: SyntheseBlock[] = [
    { id: "cartes", title: "Cartes de synthèse", tables: [], charts: [], nd: why.filter((w): w is { label: string; reason: string } => Boolean(w.reason)).map((w) => ({ label: w.label, reason: w.reason })), notes: [] },
    { id: "graphique", title: mainChart.title, tables: [ID.mensuel], charts: [ID.mensuel], nd: [], notes: [] },
    { id: "composition", title: composition.title, tables: [ID.composition], charts: [ID.composition], nd: [], notes: [] },
    cascadeBlock,
    servicesBlock,
    { id: "chiffres", title: "Chiffres clés en tableau", tables: [ID.montants, ID.rh, ID.series], charts: [], nd: [], notes: [] },
  ];
  return scrub({
    ...empty,
    tiles,
    alerts,
    tables,
    charts,
    limits: ["ETP payé non calculé : aucune règle de conversion paramétrée."],
    blocks,
    tileNd: reasonLines(why),
    mentions,
    links: [
      { href: hrefs.services, label: "Coût et écart par service (05 · Services)" },
      { href: hrefs.fixeVariable, label: "Parts du brut : fixe, primes (04 · Fixe & variable)" },
      { href: hrefs.budgetChapter, label: "Budget et atterrissage en détail (06 · Budget & prévisions)" },
    ],
    tableHref: hrefs.tableau,
    tableHrefs: { composition: hrefs.tableauComposition, cascade: hrefs.tableauCascade },
    trend: tileTrend || tables.some((t) => [...t.rows, ...(t.foot ? [t.foot] : [])].some((r) => r.cells.some((c, i) => t.columns[i] && cellView(c, t.columns[i], r).tone !== "flat"))),
    print: { max: PRINT_REPERES_MAX, folded: printFold(alerts, PRINT_REPERES_MAX).folded },
    servicesNote,
  });
}

// Seuils d'effectif : réglages de l'espace (sans valeur par défaut) puis repères du chapitre 02 (seuilAlerts) sur l'effectif moyen de
// l'année N-1 et de N à date ; le lien du repère mène au bloc des seuils du chapitre 02.
function seuilInput(input: Extract<SyntheseInput, { kind: "value" }>): SeuilInput {
  const seuilsWhy = croiseeSettingReason("seuilsEffectif", input.seuils);
  const margeWhy = croiseeSettingReason("margeAlerte", input.marge);
  const seuils = settingValue(input.seuils);
  const marge = settingValue(input.marge);
  if (seuilsWhy || seuils === null) return { kind: "mention", id: "seuils-effectif", text: capital(seuilsWhy ?? "seuils d'effectif non définis (Paramètres)"), settings: true };
  if (margeWhy || marge === null) return { kind: "mention", id: "marge-alerte", text: capital(margeWhy ?? "marge d'alerte des seuils d'effectif non définie (Paramètres)"), settings: true };
  const rh = input.rh;
  if (rh.kind === "na") return { kind: "mention", id: "seuils-effectif", text: "Seuils d'effectif : effectif moyen non filtrable par service.", settings: false };
  if (rh.kind === "nd") return { kind: "skip" };
  const a = rh.annual;
  const list = [
    { id: "n1", label: `Effectif moyen ${a.prevYear}`, avg: a.prev },
    { id: "n", label: `Effectif moyen ${input.year} (${periodLabel(a.curMonths)})`, avg: a.cur },
  ];
  return {
    kind: "value",
    alerts: seuilAlerts(list, seuils, marge).map((x) => ({ ...x, href: input.hrefs.effectifs, linkLabel: "Effectifs & mouvements" })),
    nd: list.flatMap((x) => (x.avg.kind === "exact" ? [] : [{ label: x.label, reason: x.avg.kind === "nd" ? x.avg.nd.reason : "effectif moyen en borne basse : comparaison aux seuils non faite" }])),
  };
}

// Toutes les raisons et tous les textes du modèle passent par publicReason (aucun identifiant de contrat ni d'absence).
function scrub(m: SyntheseModel): SyntheseModel {
  const r = publicReason;
  const cell = (c: CroiseeCell): CroiseeCell => (typeof c === "object" && c !== null && "nd" in c ? { nd: r(c.nd) } : c);
  const row = (x: CroiseeRow): CroiseeRow => ({ ...x, cells: x.cells.map(cell) });
  return {
    ...m,
    nd: m.nd && { ...m.nd, reason: r(m.nd.reason) },
    tiles: m.tiles.map((t) => ({ ...t, value: t.value.reason ? { ...t.value, reason: r(t.value.reason) } : t.value, variations: t.variations?.map((v) => (v.reason ? { ...v, reason: r(v.reason) } : v)), note: t.note && r(t.note) })),
    tables: m.tables.map((t) => ({ ...t, rows: t.rows.map(row), foot: t.foot && row(t.foot), notes: t.notes?.map(r) })),
    charts: m.charts.map((c) => ({ ...c, series: c.series.map((s) => (s.reasons ? { ...s, reasons: s.reasons.map((x) => x && r(x)) } : s)) })),
    alerts: m.alerts.map((a) => ({ ...a, text: r(a.text) })),
    mentions: m.mentions.map((x) => ({ ...x, text: r(x.text) })),
    tileNd: m.tileNd.map(r),
    blocks: m.blocks.map((b) => ({ ...b, nd: b.nd.map((n) => ({ ...n, reason: r(n.reason) })), notes: b.notes.map(r) })),
    limits: m.limits.map(r),
  };
}

// Un graphique a-t-il au moins une valeur connue ? (sinon il n'est pas tracé : un axe vide ferait croire à des zéros)
export const chartHasData = (c: CroiseeChart): boolean => hasData(c.series);

// --- Lecture : lecteurs du contexte et fonctions existantes --------------------------------------------------------------------

// Indicateur du moteur des KPI sur la période et sur les mêmes mois un an plus tôt (comme la Synthèse du Studio RH) : la fenêtre
// N-1 est le décalage explicite des mois, jamais l'année civile précédente entière.
function compareOver<V extends Valued>(input: KpiInput, months: string[], prevMonths: string[], fn: (i: KpiInput, w: Window) => V, valueOf: (t: Extract<V, { kind: Kind }>) => Ratio, unit: DeltaUnit) {
  const cur = windowOf(months);
  const prv = windowOf(prevMonths);
  const current = fn(input, cur);
  const previous = fn(input, prv);
  return { current, previous, delta: kpiDelta(current, previous, valueOf, unit, prv.label) };
}

export async function loadSyntheseInput(ctx: CroiseeContext): Promise<SyntheseInput> {
  const slug = ctx.slug;
  const donnees = `/e/${slug}/donnees`;
  const dataAction = { href: donnees, label: ctx.canEdit ? "Choisir ou lire une source dans Données" : "Données" };
  const p = ctx.period;
  if (!p) return { kind: "nd", reason: ctx.periodNd ?? "aucun mois disponible", action: dataAction };
  const months = p.months;
  const prevMonths = ctx.prevMonths;
  const year = p.year;
  const last = months[months.length - 1];
  const rolling = rollingWindow(last).months;
  const svc = ctx.service.value;
  const filtered = svc !== undefined;
  const NA = "non filtrable par service";
  const pay = await ctx.load.payroll();
  const kpi = pay.kpi;

  // --- Indicateurs RH (moteur des KPI : aucun calcul ici). Le référentiel RH n'est pas ventilé par service.
  const refusal = kpiRefusal({
    chosen: Boolean(kpi.collab.source.chosen),
    sourceReason: kpi.collab.source.reason,
    unavailable: kpi.collab.state?.kind === "unavailable" ? kpi.collab.state.reason : null,
    hasInput: Boolean(kpi.input),
    invalid: kpi.settings.invalid.map((k) => KPI_KEYS[k]),
  });
  const rhAction = kpi.settings.invalid.length > 0 ? { href: `/e/${slug}/parametres#kpi`, label: "Paramètres › Définitions des KPI" } : dataAction;
  let rh: SyntheseRh;
  if (filtered) rh = { kind: "na", reason: `référentiel RH : ${NA}` };
  else if (refusal !== null || !kpi.input) rh = { kind: "nd", reason: refusal ?? "référentiel RH non construit", action: rhAction };
  else {
    const input = kpi.input;
    const opts = countedOpts(input);
    // Effectif moyen de l'année civile N-1 et de N à date : mêmes appels que le chapitre 02 (seuils d'effectif).
    const curMonths = monthsBetween(`${year}-01`, last);
    rh = {
      kind: "value",
      etpAverage: compareOver(input, months, prevMonths, etpAverage, (a) => a.ratio, "etp"),
      prorated: months.map((m) => etpProratedMonth(input, m)),
      proratedPrev: prevMonths.map((m) => etpProratedMonth(input, m)),
      proratedQualifier: etpProratedQualifier(input),
      absenteeism: compareOver(input, months, prevMonths, absenteeism, (a) => a.ratio, "points"),
      absenceTypes: input.params.absenceTypes,
      turnover: compareWindows(input, rollingWindow(last), turnover, (t) => t.ratio, "points"),
      annual: { prevYear: year - 1, prev: headcountAverage(input, civilWindow(year - 1)), curMonths, cur: headcountAverage(input, windowOf(curMonths)) },
      rolling,
      sparks: {
        etp: rolling.map((m) => etpMonthEnd(input, m)),
        absenteeism: rolling.map((m) => absenteeismMonth(input, m)),
        headcount: rolling.map((m) => headcountAt(input.data, monthEnd(m), opts)),
      },
    };
  }

  // --- Journal de paie (filtré par service quand un service est choisi)
  const journal = pay.input;
  let payIn: SynthesePay;
  if (!journal) payIn = { kind: "nd", reason: journalReason(pay) ?? "journal de paie indisponible", action: dataAction };
  else {
    const j: JournalInput = filtered ? withService(journal, svc ?? null) : journal;
    const cur = windowPayroll(j, months);
    const prev = windowPayroll(j, prevMonths);
    const svcFilter = filtered ? { value: svc ?? null } : undefined;
    const unclassified = [...new Set(cur.months.flatMap((r) => (r.kind === "value" ? r.unclassified.map((a) => a.accountId) : [])))].sort();
    // Contrôles du total de l'entreprise seulement : la DSN et la comptabilité ne portent pas le code analytique du journal.
    let compta: ComptaCheck = { kind: "skip" };
    let dsn: DsnCheck = { kind: "skip" };
    if (!filtered && cur.kind === "value") {
      const d = dsnBrutWindow(pay.dsn, months);
      dsn = d.kind === "value" ? { kind: "value", delta: cur.brut - d.brutCents, incomplete: d.incompleteMonths } : { kind: "nd", reason: d.reason, months: d.months, none: pay.dsn.size === 0 };
      const c = await ctx.load.compta();
      if (!c.source || c.error) compta = { kind: "absent", reason: c.reason || "aucune source comptable retenue" };
      else {
        const rec = reconcile(journal, c.lines, c.months, months, c.nd);
        compta = rec.kind === "value" ? { kind: "value", ecart: rec.ecart } : { kind: "nd", reason: rec.reason };
      }
    }
    // Cascade de l'écart (Analyse des écarts) : versions réelles N-1 et N du même journal (mêmes mois de même rang). Les rubriques
    // sans objet des deux côtés (enveloppes, coûts non ventilés : jamais portés par le réel) ne sont pas des contributions.
    const filter = filtered ? { value: svc ?? null } : null;
    const vPrev = reelVersion("n1", "N-1", String(year - 1), journal, null, filter);
    const vCur = reelVersion("n", "N", String(year), journal, null, filter);
    const rubric = masseByRubric(vPrev, vCur, prevMonths, months);
    const cascade: MasseRubric = rubric.kind === "nd" ? rubric : { ...rubric, steps: rubric.steps.filter((s) => !(aggregate(vPrev, prevMonths, s.key as never).kind === "na" && aggregate(vCur, months, s.key as never).kind === "na")) };
    const ym = yearMonths(year);
    const ymPrev = yearMonths(year - 1);
    const pick = (f: (w: Extract<PayrollWindow, { kind: "value" }>) => number) => evolution(cur, prev, f);
    payIn = {
      kind: "value",
      cur,
      prev,
      evolution: evolution(cur, prev, (w) => w.masse),
      composition: {
        fixe: pick((w) => w.byRubric.salaires),
        variable: pick((w) => w.byRubric.primes + w.byRubric.indemnites),
        stages: pick((w) => w.byRubric.stages),
        brut: pick((w) => w.brut),
        cotisations: pick((w) => w.cotisations),
        masse: pick((w) => w.masse),
      },
      cost: costPerEtp(cur, pay.etp(months, svcFilter)),
      costPrev: costPerEtp(prev, pay.etp(prevMonths, svcFilter)),
      rolling: rolling.map((m) => monthPayroll(j, m)),
      year: ym.map((m) => monthPayroll(j, m)),
      yearPrev: ymPrev.map((m) => monthPayroll(j, m)),
      yearEvo: ym.map((m, i) => evolution(windowPayroll(j, [m]), windowPayroll(j, [ymPrev[i]]), (w) => w.masse)),
      cascade,
      unclassified,
      checks: { compta, dsn },
    };
  }

  // --- Budget saisi (global), réalisé du journal (mois clos) et atterrissage du scénario retenu (global)
  const b = ctx.budget.selected;
  const budget: SyntheseBudget = filtered
    ? { kind: "na", reason: `budget saisi global : ${NA}` }
    : b
      ? { kind: "value", name: b.name, series: budgetSeries(`budget-${b.id.slice(0, 8)}`, `Budget saisi « ${b.name} »`, String(year), b.amounts) }
      : { kind: "absent", reason: ctx.budget.reason ?? `aucun budget saisi pour ${year}` };
  const live: SyntheseLive = journal ? { kind: "value", series: liveSeries("reel", "Réalisé", journal, kpi.input) } : { kind: "nd", reason: journalReason(pay) ?? "journal de paie indisponible" };
  let landingIn: SyntheseLanding;
  if (filtered) landingIn = { kind: "na", reason: `atterrissage du scénario global : ${NA}` };
  else {
    const s = await ctx.load.scenario();
    if (s.kind === "nd") landingIn = { kind: "nd", reason: s.reason };
    else {
      const sc = s.full.scenario;
      landingIn = { kind: "value", scenarioName: sc.name, refMonth: s.full.base.refMonth, landing: landing(s.full.base, s.proj, String(year)), series: scenarioSeries(sc.id, `Scénario « ${sc.name} »`, s.full.base, s.proj) };
    }
  }

  // --- Lignes par service : le chargeur du chapitre 05, avec le contexte de la page (liens de filtre service= sur ce chapitre).
  const services = await loadServicesInput(ctx);

  const chapter = (id: "services" | "budget" | "paie-compta" | "fixe-variable" | "effectifs", hash?: string) => ctx.href({ chapitre: id, tri: null, sens: null }, hash);
  return {
    kind: "value",
    year,
    months,
    prevMonths,
    labels: ctx.labels,
    openMonths: ctx.openMonths,
    filtered,
    hrefs: {
      donnees,
      parametres: croiseeSettingsHref(slug),
      grille: `/e/${slug}/parametres#masse-salariale`,
      budget: `/e/${slug}/studio-rh/hypotheses`,
      services: chapter("services"),
      budgetChapter: chapter("budget"),
      paieCompta: chapter("paie-compta"),
      fixeVariable: chapter("fixe-variable"),
      effectifs: chapter("effectifs", "cx-effectifs-seuils"),
      tableau: ctx.href({ affichage: "tableau" }, "cx-synthese-graphique"),
      tableauComposition: ctx.href({ affichage: "tableau" }, "cx-synthese-composition"),
      tableauCascade: ctx.href({ affichage: "tableau" }, "cx-synthese-cascade"),
      months: yearMonths(year).map((m) => ctx.href({ de: m.slice(5, 7), a: m.slice(5, 7) })),
    },
    rh,
    pay: payIn,
    budget,
    live,
    landing: landingIn,
    services,
    seuils: ctx.settings.seuilsEffectif,
    marge: ctx.settings.margeAlerte,
  };
}

// Modèle du chapitre, calculé une fois par requête : le composant ChSynthese et l'export appellent cette même fonction.
export const syntheseModel = memoByContext((ctx: CroiseeContext) => loadSyntheseInput(ctx).then(buildSynthese));
