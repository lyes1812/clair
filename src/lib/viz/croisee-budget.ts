import type { ChartSeries } from "@/components/charts/shared";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { etpCascade, STEP_LABELS, type Cascade } from "@/lib/budget/cascade";
import { landing, roundDiv, type Landing } from "@/lib/budget/engine";
import { compareLanding } from "@/lib/budget/landing-compare";
import { retraite, type Retraite } from "@/lib/budget/lot3";
import { bridge, budgetSeries, gap, liveSeries, scenarioSeries, total, type Bridge, type Gap, type Layer, type Point, type Series } from "@/lib/budget/series";
import type { BaseSnapshot, Projection } from "@/lib/budget/types";
import { aggregate, alignedSeries, diff, nd as ndCell, reelVersion, val, type Agg, type ServiceFilter } from "@/lib/budget/versions";
import { HORS_SALARIE, zoomOf } from "@/lib/budget/zoom";
import { confidentialiteHref, confidentialiteReason, isHidden, maskGroups, maskReason, personsOfContracts, type MaskInput, type MaskStatus, type PersonLink } from "@/lib/confidentialite";
import { maskCohorts, maskNonRecurring, nonRecurringContributors, partitionCohorts, type CohortPartition, type CohortRowId, type NonRecurringContributors } from "@/lib/croisee/cohortes";
import { confidentialiteOf as seuilOf, groupInput, masseContracts, masseGroup, unionGroups, type Confidentialite, type JournalGroup } from "@/lib/croisee/confidentialite";
import { journalReason } from "@/lib/croisee/format";
import { memoPublicModel as memoByContext } from "@/lib/croisee/public";
import { withService, type JournalInput } from "@/lib/payroll/engine";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";
import { roundHalfUp } from "@/lib/rh/kpi/fraction";
import { costTone } from "@/lib/trend";
import { costVariation, plainVariation, yearMonths, type ChapterModel, type CroiseeCell, type CroiseeChart, type CroiseeRow, type CroiseeTable, type TileSpec, type TileVariation } from "@/lib/viz/croisee";
import { pontWaterfall } from "@/lib/viz/ecart";
import { comparisonSeries, frDates, landingParts, landingWaterfall, layerSpans, monthAxis, retraiteWaterfall, type WaterfallIn } from "@/lib/viz/hypotheses";
import { capital, euros, eurosSigned, monthLongLabel, monthShortYear, ndGroups, ndLines, reasonLines } from "@/lib/viz/masse";
import { landingView, nd, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitres 06 · Budget & prévisions et 08 · Effets d'évolution. Pour chacun, deux fonctions :
// - load<Chapitre>Input(ctx) lit les sources par les lecteurs du contexte et appelle les fonctions existantes : séries, écart et
//   pont du module budgétaire (series.ts), atterrissage (engine.ts) et atterrissage retraité (lot3.ts), versions et cascade d'ETP
//   (versions.ts, cascade.ts, comme l'Analyse des écarts), détail par contrat (zoom.ts) ; aucun nouveau moteur ;
// - build<Chapitre>(input), pure, met ces résultats en forme : cartes, graphiques, tableaux exacts, blocs « Prévu ». L'écran et les
//   exports partent de ce même modèle.
// Calculs nouveaux, testés : la partition des contrats observés (src/lib/croisee/cohortes.ts), l'effectif d'un service en contrats
// observés (masseContracts) et la valeur tracée d'un ETP moyen exact (plotEtp4). Montants en centimes, ETP en dix-millièmes ou en
// fractions exactes ; un n.d. reste n.d. avec sa raison, jamais zéro.
//
// Aucune identité dans le modèle ni dans les entrées : ni nom, ni identifiant de contrat. Les raisons n.d. du moteur de projection,
// qui nomment le contrat, sont remplacées par leur nombre, et la raison de l'ETP n.d. d'un mois projeté par un texte sans nom
// (publicScenario) ; les libellés libres des éléments non récurrents ne sont pas repris (le détail reste dans Hypothèses budgétaires).
//
// Seuil de confidentialité (module partagé src/lib/confidentialite : un paramètre d'espace sans valeur par défaut ; absent ou
// illisible : bloc n.d. avec le lien vers Paramètres › Confidentialité) : il s'applique aux groupes de contrats observés et aux totaux
// des éléments non récurrents déjà comptabilisés et prévus (chapitre 06), aux paliers de la cascade d'ETP (chapitre 08) et aux chiffres
// d'un service retenu par le filtre (réalisé, contrats observés, pont et ETP). Chaque groupe est compté en PERSONNES DISTINCTES : ses
// contrats (contrats qui portent une ligne de la masse affichée, masseContracts ; contrats des paliers ; contributeurs) sont reliés à
// leur personne par le référentiel Collaborateurs (lien du contexte) ; un contrat non relié ne protège jamais : un groupe dont les
// personnes reliées sont sous le seuil et qui compte des contrats non reliés n'est pas dénombré (seuil non vérifiable), de même qu'un
// groupe sans contrat pour une valeur non nulle (lignes du journal sans contrat). Masquage secondaire par le moteur partagé, personnes
// comptées une fois d'un groupe masqué à l'autre (mois, paliers) : aucune valeur masquée ne se retrouve par différence. Une seule
// raison : « non affiché (seuil de confidentialité : N personnes) ». Les totaux de toute l'entreprise ne sont jamais masqués.

// Identifiants du glossaire vers lesquels renvoient les deux chapitres (un test vérifie que chacun existe).
export const BUDGET_CX_TERMS = {
  masse: "masse",
  budgetSaisi: "budget-saisi",
  ecartBudget: "croisee-ecart-budget",
  atterrissage: "croisee-atterrissage",
  retraite: "retraite",
  cascades: "atterrissage-cascades",
  comparaison: "comparaison",
  origineMois: "origine-mois",
  tendances: "lecture-tendances",
  personnes: "croisee-personnes-observees",
  nMoinsUn: "previous-period",
  prevu: "lecture-prevu",
  tuilage: "croisee-tuilage",
  confidentialite: "croisee-confidentialite",
} as const;
export const EFFETS_CX_TERMS = {
  pont: "pont-volume-cout",
  cascade: "cascade",
  residuel: "residuel",
  etpMoyen: "etp-average",
  etpFinMois: "etp-month-end",
  masse: "masse",
  tendances: "lecture-tendances",
  nMoinsUn: "previous-period",
  effetsMasseNiveauReport: "croisee-effets-masse-niveau-report",
  tuilage: "croisee-tuilage",
  prevu: "lecture-prevu",
  confidentialite: "croisee-confidentialite",
} as const;
const T = BUDGET_CX_TERMS;
const E = EFFETS_CX_TERMS;

export const BUDGET_TABLE_IDS = {
  mensuel: "budget-mensuel",
  douzeMois: "budget-douze-mois",
  atterrissage: "budget-atterrissage",
  annuel: "budget-annuel",
  personnes: "budget-personnes",
} as const;
export const BUDGET_CHART_IDS = { douzeMois: "budget-douze-mois", atterrissage: "budget-atterrissage-cascade", retraite: "budget-retraite-cascade" } as const;
export const EFFETS_TABLE_IDS = { pont: "effets-pont", pontBase: "effets-pont-base", etp: "effets-etp" } as const;
export const EFFETS_CHART_IDS = { pont: "effets-pont-cascade", etp: "effets-etp-cascade" } as const;

// --- Modèle commun aux deux chapitres : cartes en tête, puis blocs (graphiques et leurs tableaux exacts), puis blocs « Prévu » ---------

type Action = { href: string; label: string };
export type CxNd = { label?: string; reason: string; action?: Action };
// Bloc du chapitre : ancre cx-<chapitre>-<id> ; graphiques et tableaux désignés par leur identifiant dans le modèle.
export type CxBlock = { id: string; title: string; term?: string; charts: string[]; tables: string[]; nd: CxNd[]; notes: string[]; links: Action[]; trend: boolean };
// Bloc sans chiffre : la mention « Prévu », la raison en une ligne et les écrans qui couvrent déjà une partie du besoin.
export type CxPrevu = { id: string; label: string; reason: string; term?: string; links: Action[] };
export type BlocksModel = ChapterModel & {
  blocks: CxBlock[];
  prevu: CxPrevu[];
  tileNd: string[]; // raisons des n.d. des lignes de cartes, écrites une fois sous les cartes
  trend: boolean; // une carte porte une tendance de coût colorée : la légende rouge / vert est écrite
};

// Cascade d'un modèle (kind « cascade ») : catégories = [départ, contributions…, arrivée], une série aux valeurs dans le même ordre.
// Rendue par WaterfallChart ; null si une valeur manque (une cascade n'est jamais tracée avec un n.d.).
export type CascadeView = { startLabel: string; endLabel: string; start: number; end: number; steps: { label: string; value: number }[] };
export function cascadeOf(c: CroiseeChart): CascadeView | null {
  const v = c.series[0]?.values ?? [];
  const n = c.categories.length;
  if (c.kind !== "cascade" || n < 2 || v.length !== n || v.some((x) => x === null || !Number.isFinite(x))) return null;
  const vals = v as number[];
  return { startLabel: c.categories[0], endLabel: c.categories[n - 1], start: vals[0], end: vals[n - 1], steps: c.categories.slice(1, -1).map((label, i) => ({ label, value: vals[i + 1] })) };
}
const cascadeChart = (id: string, title: string, unit: "eur" | "etp", start: { label: string; value: number }, steps: { label: string; value: number }[], end: { label: string; value: number }, tableId: string, trend?: "cost"): CroiseeChart => ({
  id,
  title,
  kind: "cascade",
  unit,
  categories: [start.label, ...steps.map((s) => s.label), end.label],
  series: [{ key: "cascade", name: title, values: [start.value, ...steps.map((s) => s.value), end.value] }],
  tableId,
  ...(trend ? { trend } : {}),
});

// --- Mise en forme -----------------------------------------------------------------------------------------------------------------

const nf = new Intl.NumberFormat("fr-FR");
const plural = (n: number, one: string, many: string) => `${nf.format(n)} ${n > 1 ? many : one}`;
const monthsText = (list: string[]) => list.map(monthShortYear).join(", ");
// « des 2 mois avec budget », « du mois avec budget » : libellés de la carte du budget et du total du tableau mensuel.
const withBudgetText = (n: number) => (n === 1 ? "du mois avec budget" : `des ${nf.format(n)} mois avec budget`);
const pointOf = (s: Series, m: string): Point => s.points.get(m) ?? { month: m, kind: "nd", reason: "mois non couvert" };
// Cellule d'une lecture pour un mois (même règle que la Comparaison des Hypothèses budgétaires) : montant, ou n.d. avec sa raison.
const readingCell = (s: Series, m: string): CroiseeCell => {
  const p = s.points.get(m);
  if (!p) return { nd: "mois non couvert par cette lecture" };
  return p.kind === "value" ? p.cost : { nd: frDates(p.reason) };
};
const money = (cents: number): TileValue => ({ text: euros(cents), kind: "value", reason: null });
const signedMoney = (cents: number): TileValue => ({ text: eurosSigned(cents), kind: "value", reason: null });
const pctText = (r: { num: number; den: number }) => `${r.num > 0 ? "+" : ""}${fmtPercent(r)}`;
const word = (delta: number) => (delta > 0 ? "défavorable" : delta < 0 ? "favorable" : "égal au budget");
const tileLine = (label: string, v: TileValue): TileVariation => plainVariation(label, v.kind === "nd" ? null : v.text, v.kind === "nd" ? v.reason : null);
const ndIn = (reason: string): CroiseeCell => ({ nd: reason });
// Série entièrement n.d. (lecture absente) : chaque mois porte la raison, comme dans la Comparaison des Hypothèses budgétaires.
const ndSeries = (key: string, label: string, months: string[], reason: string): Series => ({ key, label, points: new Map(months.map((m) => [m, { month: m, kind: "nd" as const, reason }])) });
const LAYER_TEXT: Record<Layer, string> = { reel: "réel", "projete-parent": "projeté (parent)", projete: "projeté", budget: "budget" };

type Why = { label: string; reason: string | null | undefined };

// --- Seuil de confidentialité : effectif d'un service en personnes distinctes ---------------------------------------------------

// Contrats observés d'un mois (ligne de masse) : fonction partagée de la croisée, ré-exportée pour l'Analyse des écarts et les tests.
export { masseContracts };

// Effectif d'un service : personnes distinctes des contrats observés (masseContracts) du journal restreint au service, reliés par le
// référentiel (link), par mois et sur l'ensemble des mois, avec les contrats non reliés et la présence d'une masse non nulle. Les
// personnes sont des jetons de la lecture : le masquage secondaire compte ainsi une personne une seule fois d'un mois masqué à
// l'autre. null : mois n.d. (effectif non dénombré, seuil non vérifiable).
export type ServiceSizes = { months: (JournalGroup | null)[]; period: JournalGroup | null };
export function observedSizes(journal: JournalInput, months: readonly string[], link: PersonLink): ServiceSizes {
  return { months: months.map((m) => masseGroup(journal, [m], link)), period: masseGroup(journal, months, link) };
}

// Entrée de masquage d'un groupe de contrats observés (groupInput), ou d'un groupe non dénombré (mois n.d.) pour la valeur affichée.
const sizeInput = (g: JournalGroup | null, seuil: number, value: number | null): MaskInput => (g ? groupInput(g, seuil, value === null ? null : Math.abs(value), g.nonZero) : { size: null, value: value === null ? null : Math.abs(value) });

// --- Aucune identité : raisons n.d. de la projection -----------------------------------------------------------------------------

// Le moteur de projection nomme le contrat dans ses raisons n.d. (« <libellé> : base n.d. (…) — saisir une correction de base »).
// Dans la page croisée, chaque raison est remplacée par un décompte ; le détail nominatif reste dans Hypothèses budgétaires. Toute
// autre raison du moteur est décomptée de la même façon : aucun texte de la projection ne passe dans la page.
const BASE_ND = / : base n\.d\. \(.*\) — saisir une correction de base$/s;
const DETAIL = "détail dans Hypothèses budgétaires";
export function publicProjectionReasons(reasons: readonly string[]): string[] {
  const base = reasons.filter((r) => BASE_ND.test(r)).length;
  const other = reasons.length - base;
  return [
    ...(base ? [`${plural(base, "contrat", "contrats")} sans base de projection (${DETAIL})`] : []),
    ...(other ? [`${plural(other, "autre raison", "autres raisons")} de n.d. de la projection (${DETAIL})`] : []),
  ];
}
// Raison de l'ETP n.d. d'un mois projeté chiffré : le moteur y nomme chaque contrat sans ETP (« <libellé> : <raison> », joints par
// « ; ») ; elle est remplacée par une raison sans identité (le décompte n'est pas tiré du texte, qu'un libellé peut couper).
export const ETP_ND_PUBLIC = `ETP n.d. pour au moins un contrat (${DETAIL})`;
const publicEtp = <P extends { etpNd: string | null }>(p: P): P => (p.etpNd === null ? p : { ...p, etpNd: ETP_ND_PUBLIC });
// Base figée et projection dont seules les raisons changent (montants identiques) : raisons des mois projetés n.d. et des mois projetés
// par un scénario parent n.d. (raisons du parent jointes par « ; ») ; raison de l'ETP n.d. des mois projetés chiffrés, du scénario
// comme du parent. Les objets d'origine ne sont pas modifiés.
export function publicScenario(base: BaseSnapshot, proj: Projection): { base: BaseSnapshot; proj: Projection } {
  const prior = base.prior?.map((p) => (p.kind === "nd" ? { ...p, reason: publicProjectionReasons(p.reason.split(" ; ")).join(" ; ") } : publicEtp(p)));
  const pub: Projection = proj.kind === "error" ? proj : { ...proj, months: proj.months.map((m) => (m.kind === "nd" ? { ...m, reasons: publicProjectionReasons(m.reasons) } : publicEtp(m))) };
  return { base: prior ? { ...base, prior } : base, proj: pub };
}

// =================================================================================================================================
// Chapitre 06 · Budget & prévisions
// =================================================================================================================================

export type BudgetReading = { kind: "value"; name: string; series: Series } | { kind: "absent" | "na"; reason: string };
export type LiveReading = { kind: "value"; series: Series } | { kind: "nd"; reason: string };
// contributors : contributeurs des éléments non récurrents de l'année (déjà comptabilisés, prévus), pour le seuil de confidentialité.
export type ScenarioReading = { kind: "value"; name: string; refMonth: string; series: Series; landing: Landing; retraite: Retraite; contributors: NonRecurringContributors } | { kind: "nd" | "na"; reason: string };
export type CohortReading = CohortPartition;
// atterrissage : null quand l'écran Hypothèses › Atterrissage montrerait une autre année que celle de la période (il prend la première
// année du scénario) : le lien n'est alors pas proposé.
export type BudgetHrefs = { hypotheses: string; comparaison: string; atterrissage: string | null; postes: string; embauches: string; parametres: string };

export type BudgetChapterInput =
  | { kind: "nd"; reason: string; action: Action }
  | {
      kind: "value";
      year: number;
      months: string[]; // mois de la période
      labels: { period: string; prev: string };
      filtered: boolean; // un service est choisi : réalisé et contrats observés du service ; budget et scénario globaux (n.d.)
      hrefs: BudgetHrefs;
      live: LiveReading; // réalisé du journal de paie (mois clos), filtré par service le cas échéant
      budget: BudgetReading;
      scenario: ScenarioReading; // scénario retenu, avec son atterrissage et son atterrissage retraité de l'année
      cohorts: CohortReading;
      confidentialite: Confidentialite; // seuil de confidentialité de l'espace, ou la raison de son absence
      serviceSizes: ServiceSizes | null; // filtre de service : contrats observés du service, par mois de la période et sur la période
    };

export type BudgetModel = BlocksModel;

// Lignes de la partition des contrats observés, dans l'ordre du tableau.
const COHORT_LABELS: Record<CohortRowId, string> = {
  onlyPrev: "Contrats observés seulement en N-1",
  onlyCur: "Contrats observés seulement en N",
  both: "Contrats observés dans les deux périodes",
  outside: "Lignes du journal sans contrat",
};

export function buildBudget(input: BudgetChapterInput): BudgetModel {
  const base: BudgetModel = { chapter: "budget", tiles: [], alerts: [], tables: [], charts: [], limits: [], nd: null, terms: Object.values(T), blocks: [], prevu: [], tileNd: [], trend: false };
  if (input.kind === "nd") return { ...base, nd: { reason: capital(input.reason), action: input.action } };
  const { year, months, labels, live, budget, scenario, cohorts, hrefs, confidentialite: conf } = input;
  const yearKey = String(year);
  const ym = yearMonths(year);
  const why: Why[] = [];
  const tables: CroiseeTable[] = [];
  const charts: CroiseeChart[] = [];
  const blocks: CxBlock[] = [];
  const hypLink = { href: hrefs.hypotheses, label: "Hypothèses budgétaires" };
  const paramLink = { href: hrefs.parametres, label: "Paramètres" };

  // --- 0. Réalisé d'un service retenu par le filtre (seuil de confidentialité) : n.d. sans seuil ; n.d. quand le service compte de 1
  // à (seuil − 1) personnes sur la période, ou n'est pas dénombré (contrats non reliés sous le seuil, masse non nulle sans contrat) ;
  // sinon un tel mois est masqué, avec le masquage secondaire de la colonne dont le total (la carte « Réalisé ») est affiché.
  const real = live.kind === "value" ? total(live.series, months) : ({ kind: "nd", reason: live.reason } as const);
  let realGuard: string | null = null;
  let monthMask: MaskStatus[] | null = null;
  if (input.filtered) {
    const sz = input.serviceSizes;
    if (conf.kind === "nd") realGuard = conf.reason;
    else {
      const [periodSt] = maskGroups([sizeInput(sz?.period ?? null, conf.value, real.kind === "value" ? real.cost : null)], conf.value, false);
      if (isHidden(periodSt)) realGuard = maskReason(periodSt, conf.value);
      else if (live.kind === "value") {
        // Taille d'un mois : ses personnes ; members : les mêmes personnes (jetons), pour qu'une personne présente dans deux mois
        // masqués n'y compte qu'une fois.
        monthMask = maskGroups(
          months.map((m, i) => {
            const p = live.series.points.get(m);
            return sizeInput(sz?.months[i] ?? null, conf.value, p && p.kind === "value" ? p.cost : null);
          }),
          conf.value,
          real.kind === "value",
        );
      }
    }
  }
  const seuil = conf.kind === "set" ? conf.value : 0;
  const monthHidden = (i: number): string | null => (monthMask && isHidden(monthMask[i]) ? maskReason(monthMask[i], seuil) : null);

  // --- 1. Réalisé, budget saisi et écart sur la période : seuls les mois qui ont un montant de budget sont comparés.
  const realTile: TileSpec = {
    id: "realise",
    label: "Réalisé",
    term: T.masse,
    sub: labels.period,
    value: realGuard ? nd(realGuard) : real.kind === "value" ? money(real.cost) : nd(frDates(real.reason)),
    cost: true,
    main: true,
  };
  const withBudget = budget.kind === "value" ? months.filter((m) => pointOf(budget.series, m).kind === "value") : [];
  const excluded = budget.kind === "value" ? months.filter((m) => !withBudget.includes(m)) : [];
  const g: Gap | null = budget.kind !== "value" || withBudget.length === 0 ? null : live.kind === "nd" ? { kind: "nd", reason: `réalisé : ${live.reason}` } : gap(live.series, budget.series, withBudget);
  const exclNote = excluded.length && withBudget.length ? `Comparé sur ${plural(withBudget.length, "mois", "mois")} ; sans montant de budget, exclus : ${monthsText(excluded)}` : undefined;
  const budgetBase = { term: T.ecartBudget, cost: true };
  let budgetTile: TileSpec;
  let gapTile: TileSpec;
  if (budget.kind !== "value") {
    budgetTile = { ...budgetBase, id: "budget", label: "Budget de la période", term: T.budgetSaisi, sub: labels.period, value: nd(budget.reason) };
    gapTile = { ...budgetBase, id: "ecart", label: "Écart au budget", sub: labels.period, value: nd(budget.reason) };
  } else if (withBudget.length === 0) {
    const r = `aucun montant de budget saisi « ${budget.name} » sur la période`;
    budgetTile = { ...budgetBase, id: "budget", label: "Budget de la période", term: T.budgetSaisi, sub: `Budget saisi « ${budget.name} »`, value: nd(r) };
    gapTile = { ...budgetBase, id: "ecart", label: "Écart au budget", sub: `Réalisé − budget saisi « ${budget.name} »`, value: nd(r) };
  } else {
    const b = total(budget.series, withBudget);
    // Mois exclus : la carte nomme le budget des mois comparés et porte le réalisé de ces mêmes mois, pour que réalisé des mois
    // comparés − budget de ces mois = écart se lise sur les mêmes mois (la carte « Réalisé » couvre toute la période).
    const partial = excluded.length > 0;
    const cmpLabel = "Réalisé des mois comparés";
    const realCmp = live.kind === "value" ? total(live.series, withBudget) : ({ kind: "nd", reason: live.reason } as const);
    // n.d. : la carte « Réalisé » l'est aussi (ses mois contiennent les mois comparés) et en écrit la raison.
    const cmpLine = realGuard ? plainVariation(cmpLabel, null, realGuard) : realCmp.kind === "value" ? plainVariation(cmpLabel, euros(realCmp.cost)) : plainVariation(cmpLabel, null, frDates(realCmp.reason));
    budgetTile = {
      ...budgetBase,
      id: "budget",
      label: partial ? `Budget ${withBudgetText(withBudget.length)}` : "Budget de la période",
      term: T.budgetSaisi,
      sub: `Budget saisi « ${budget.name} »`,
      value: b.kind === "value" ? money(b.cost) : nd(frDates(b.reason)),
      ...(partial ? { variations: [cmpLine] } : {}),
      note: exclNote,
    };
    const sub = `Réalisé − budget saisi « ${budget.name} »`;
    if (!g || g.kind === "nd") gapTile = { ...budgetBase, id: "ecart", label: "Écart au budget", sub, value: nd(frDates(g?.reason ?? "valeur absente")), note: exclNote };
    else {
      gapTile = {
        ...budgetBase,
        id: "ecart",
        label: "Écart au budget",
        sub,
        value: signedMoney(g.delta),
        valueTone: costTone(g.delta),
        variations: [
          costVariation("Écart (%)", g.pct === null ? null : g.delta, g.pct === null ? null : `${pctText(g.pct)} · ${word(g.delta)}`, g.pct === null ? "budget saisi nul ou négatif : pourcentage non défini" : null),
        ],
        note: exclNote,
        spark: {
          label: "Écart mensuel au budget saisi",
          values: months.map((m) => {
            if (!withBudget.includes(m) || live.kind === "nd") return null;
            const x = gap(live.series, budget.series, [m]);
            return x.kind === "value" ? x.delta : null;
          }),
        },
      };
      if (g.pct === null) why.push({ label: "Écart au budget (%)", reason: "budget saisi nul ou négatif : pourcentage non défini" });
    }
  }

  // Tableau exact des trois cartes : chaque mois de la période, puis le total des mois comparés.
  const budgetNdOf = (): string => (budget.kind === "value" ? "montant du budget non saisi : mois exclu de l'écart" : budget.reason);
  const mensuelRows: CroiseeRow[] = months.map((m, i) => {
    const hidden = realGuard ?? monthHidden(i);
    const r: CroiseeCell = hidden ? ndIn(hidden) : live.kind === "value" ? readingCell(live.series, m) : ndIn(live.reason);
    const bp = budget.kind === "value" ? pointOf(budget.series, m) : null;
    const b: CroiseeCell = bp && bp.kind === "value" ? bp.cost : ndIn(budgetNdOf());
    const e: CroiseeCell = typeof r === "number" && typeof b === "number" ? r - b : typeof b !== "number" ? ndIn(budgetNdOf()) : ndIn((r as { nd: string }).nd);
    return { cells: [capital(monthLongLabel(m)), r, b, e] };
  });
  // Pied : total des mois comparés au budget (de la période entière sans montant de budget) ; l'écart n'existe que si les deux le sont.
  const footMonths = withBudget.length ? withBudget : months;
  const footLabel = excluded.length && withBudget.length ? `Total ${withBudgetText(withBudget.length)}` : "Total de la période";
  const noAmount = budget.kind === "value" ? `aucun montant de budget saisi « ${budget.name} » sur la période` : budget.reason;
  const footReal = live.kind === "value" ? total(live.series, footMonths) : ({ kind: "nd", reason: live.reason } as const);
  const footBudget = budget.kind === "value" && withBudget.length ? total(budget.series, withBudget) : ({ kind: "nd", reason: noAmount } as const);
  const footRow: CroiseeRow = {
    cells: [
      footLabel,
      realGuard ? ndIn(realGuard) : footReal.kind === "value" ? footReal.cost : ndIn(frDates(footReal.reason)),
      footBudget.kind === "value" ? footBudget.cost : ndIn(frDates(footBudget.reason)),
      g && g.kind === "value" ? g.delta : ndIn(g ? frDates(g.reason) : noAmount),
    ],
  };
  const budgetHeader = budget.kind === "value" ? `Budget saisi « ${budget.name} »` : "Budget saisi";
  tables.push({
    id: BUDGET_TABLE_IDS.mensuel,
    title: `Réalisé et budget saisi par mois, ${labels.period}`,
    columns: [
      { key: "mois", header: "Mois", kind: "text" },
      { key: "realise", header: "Réalisé", kind: "eur", term: T.masse },
      { key: "budget", header: budgetHeader, kind: "eur", term: T.budgetSaisi },
      { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true, term: T.tendances },
    ],
    rows: mensuelRows,
    foot: footRow,
    notes: excluded.length && withBudget.length ? [`Sans montant de budget, exclus de l'écart : ${monthsText(excluded)}.`] : [],
    terms: [T.masse, T.budgetSaisi, T.ecartBudget, T.tendances, ...(input.filtered ? [T.confidentialite] : [])],
  });
  blocks.push({ id: "ecart", title: "Écart au budget", term: T.ecartBudget, charts: [], tables: [BUDGET_TABLE_IDS.mensuel], nd: input.filtered && conf.kind === "nd" ? [{ label: "Réalisé du service", reason: conf.reason, action: paramLink }] : [], notes: [], links: [], trend: Boolean(g && g.kind === "value") || mensuelRows.some((r) => typeof r.cells[3] === "number" && r.cells[3] !== 0) });

  // --- 2. Douze mois : scénario retenu (réel figé puis projection), réalisé et budget saisi, comme Hypothèses › Résultat › Comparaison.
  // Global : n.d. sous un filtre de service (la courbe du réalisé n'est donc jamais celle d'un service).
  const prevision: CxBlock = { id: "prevision", title: `Réalisé, projection et budget, ${yearKey}`, term: T.comparaison, charts: [], tables: [], nd: [], notes: [], links: [], trend: false };
  if (scenario.kind !== "value") {
    prevision.nd.push({ label: "Projection", reason: scenario.reason, action: scenario.kind === "nd" ? hypLink : undefined });
  } else {
    const principal = scenario.series;
    const compared: Series[] = [live.kind === "value" ? live.series : ndSeries("reel", "Réalisé", ym, live.reason)];
    if (budget.kind === "value") compared.push(budget.series);
    const lines: ChartSeries[] = comparisonSeries(principal, compared, ym);
    const axis = monthAxis(ym);
    charts.push({ id: BUDGET_CHART_IDS.douzeMois, title: `Coût employeur par mois, ${yearKey} : scénario, réalisé et budget`, kind: "courbe", unit: "eur", categories: axis.categories, categoryTitles: axis.titles, series: lines, tableId: BUDGET_TABLE_IDS.douzeMois });
    const origin = layerSpans(principal, ym);
    const liveS = compared[0];
    const budgetS = budget.kind === "value" ? budget.series : null;
    tables.push({
      id: BUDGET_TABLE_IDS.douzeMois,
      title: `Coût employeur par mois, ${yearKey} : scénario « ${scenario.name} », réalisé et budget`,
      columns: [
        { key: "mois", header: "Mois", kind: "text" },
        { key: "origine", header: "Origine (scénario)", kind: "text", term: T.origineMois },
        { key: "scenario", header: `Scénario « ${scenario.name} »`, kind: "eur" },
        { key: "realise", header: "Réalisé", kind: "eur", term: T.masse },
        { key: "budget", header: budgetHeader, kind: "eur", term: T.budgetSaisi },
        { key: "ecart", header: "Écart scénario − budget", kind: "eur", signed: true, costTrend: true, term: T.tendances },
      ],
      rows: ym.map((m) => {
        const p = principal.points.get(m);
        const s = readingCell(principal, m);
        const b: CroiseeCell = budgetS ? readingCell(budgetS, m) : ndIn(budget.kind === "value" ? "montant du budget non saisi" : budget.reason);
        const e: CroiseeCell = typeof s === "number" && typeof b === "number" ? s - b : typeof s !== "number" ? ndIn(`scénario : ${(s as { nd: string }).nd}`) : ndIn(`budget : ${(b as { nd: string }).nd}`);
        return { cells: [capital(monthLongLabel(m)), p?.kind === "value" ? (p.source ?? LAYER_TEXT[p.layer]) : "", s, readingCell(liveS, m), b, e] };
      }),
      notes: origin ? [`Origine des mois du scénario : ${origin.replace(/\.$/, "")}.`] : [],
      terms: [T.comparaison, T.origineMois, T.masse, T.budgetSaisi, T.tendances],
    });
    prevision.charts.push(BUDGET_CHART_IDS.douzeMois);
    prevision.tables.push(BUDGET_TABLE_IDS.douzeMois);
    prevision.trend = true;
    prevision.links.push({ href: hrefs.comparaison, label: "Comparaison dans Hypothèses budgétaires" });
  }
  blocks.push(prevision);

  // --- 3. Atterrissage de l'année (réel + projection du scénario), atterrissage retraité, écart au budget saisi de l'année. Comme la
  // Synthèse : valeur sur les douze mois ; comparaison au budget saisi sur les MÊMES mois (ceux qui ont un montant de budget) :
  // atterrissage de ces mois − budget de ces mois = écart, le nombre de mois comparés écrit.
  const att: CxBlock = { id: "atterrissage", title: `Atterrissage ${yearKey}`, term: T.atterrissage, charts: [], tables: [], nd: [], notes: [], links: [], trend: false };
  let landTile: TileSpec;
  let annualTile: TileSpec;
  let retraiteTile: TileSpec;
  if (scenario.kind !== "value") {
    landTile = { id: "atterrissage", label: `Atterrissage ${yearKey}`, term: T.atterrissage, value: nd(scenario.reason), cost: true };
    annualTile = { id: "ecart-annuel", label: "Écart annuel projeté", term: T.ecartBudget, value: nd(scenario.reason), cost: true };
    retraiteTile = { id: "retraite", label: `Atterrissage retraité ${yearKey}`, term: T.retraite, value: nd(scenario.reason), cost: true };
    att.nd.push({ label: "Atterrissage", reason: scenario.reason, action: scenario.kind === "nd" ? hypLink : undefined });
  } else {
    const land = scenario.landing;
    const r = scenario.retraite;
    // Budget saisi de l'année : les mois sans montant sont exclus du total et nommés ; l'écart est calculé sur ces mêmes mois.
    let budgetIn: Parameters<typeof landingView>[1] = null;
    let gapIn: Gap | null = null;
    let withY: string[] = [];
    let exclY: string[] = [];
    if (budget.kind === "value") {
      const c = compareLanding(scenario.series, land.kind === "value", budget, yearKey);
      budgetIn = { total: c.budget };
      gapIn = c.gap;
      withY = c.withBudget;
      exclY = c.excluded;
    }
    const v = landingView(land.kind === "value" ? land : { kind: "nd", reason: frDates(land.reason) }, budgetIn, gapIn, yearKey);
    const parts = land.kind === "value" ? landingParts(land) : [];
    const partial = exclY.length > 0 && withY.length > 0;
    const nm = plural(withY.length, "mois", "mois");
    const exclText = `sans montant de budget, exclus : ${monthsText(exclY)}`;
    landTile = {
      id: "atterrissage",
      label: `Atterrissage ${yearKey}`,
      term: T.atterrissage,
      sub: `Scénario « ${scenario.name} » · douze mois`,
      value: v.value,
      cost: true,
      variations: [
        tileLine(budget.kind === "value" ? `Budget saisi « ${budget.name} »${partial ? ` (${nm})` : ""}` : "Budget saisi", v.budget),
        ...(partial && gapIn?.kind === "value" ? [plainVariation(`Atterrissage ${yearKey}, mois avec budget (${nm})`, euros(gapIn.a))] : []),
      ],
      note: [parts.map((x) => `${x.label} : ${euros(x.value)}`).join(" · "), partial ? exclText : ""].filter(Boolean).join(" ; ") || undefined,
      spark: {
        label: "Réel puis projection, par mois",
        values: ym.map((m) => {
          const p = pointOf(scenario.series, m);
          return p.kind === "value" ? p.cost : null;
        }),
      },
    };
    if (v.value.kind !== "nd") why.push({ label: "Budget saisi de l'année", reason: v.budget.kind === "nd" ? v.budget.reason : null });
    const annualBase = {
      id: "ecart-annuel",
      label: "Écart annuel projeté",
      term: T.ecartBudget,
      sub: budget.kind === "value" ? `Atterrissage − budget saisi « ${budget.name} »${partial ? `, ${nm} comparés` : ""}` : undefined,
      cost: true,
      note: partial ? capital(exclText) : undefined,
    };
    if (!gapIn || gapIn.kind === "nd") annualTile = { ...annualBase, value: nd(gapIn?.kind === "nd" ? frDates(gapIn.reason) : (v.gap.reason ?? (budget.kind !== "value" ? budget.reason : "valeur absente"))) };
    else {
      annualTile = {
        ...annualBase,
        value: signedMoney(gapIn.delta),
        valueTone: costTone(gapIn.delta),
        variations: [costVariation("Écart (%)", gapIn.pct === null ? null : gapIn.delta, gapIn.pct === null ? null : `${pctText(gapIn.pct)} · ${word(gapIn.delta)}`, gapIn.pct === null ? "budget saisi nul ou négatif : pourcentage non défini" : null)],
      };
      if (gapIn.pct === null) why.push({ label: "Écart annuel (%)", reason: "budget saisi nul ou négatif : pourcentage non défini" });
    }
    // Éléments non récurrents déjà comptabilisés et prévus : chaque total décrit ses contributeurs (contrats, à défaut hypothèses) et
    // suit le seuil de confidentialité, avec le masquage secondaire de l'autre total (leur somme est affichée). Réglage absent : n.d.
    // avec le lien vers les Paramètres. La somme (« Non récurrents retirés ») et l'atterrissage retraité, totaux de l'entreprise, restent
    // affichés.
    const nrHidden = { realised: null as string | null, projected: null as string | null };
    if (r.kind === "value") {
      if (conf.kind === "nd") nrHidden.realised = nrHidden.projected = conf.reason;
      else {
        const st = maskNonRecurring(scenario.contributors, r, conf.value);
        nrHidden.realised = maskReason(st.realised, conf.value);
        nrHidden.projected = maskReason(st.projected, conf.value);
      }
    }
    const nrLine = (label: string, cents: number, hidden: string | null): TileVariation => {
      if (hidden === null) return plainVariation(label, euros(cents));
      why.push({ label, reason: hidden });
      return plainVariation(label, null, hidden);
    };
    retraiteTile =
      r.kind === "value"
        ? {
            id: "retraite",
            label: `Atterrissage retraité ${yearKey}`,
            term: T.retraite,
            sub: "Hors éléments non récurrents",
            value: money(r.retraite),
            cost: true,
            variations: [plainVariation("Non récurrents retirés", euros(r.total)), nrLine("Déjà comptabilisés", r.realised, nrHidden.realised), nrLine("Prévus", r.projected, nrHidden.projected)],
          }
        : { id: "retraite", label: `Atterrissage retraité ${yearKey}`, term: T.retraite, sub: "Hors éléments non récurrents", value: nd(frDates(r.reason)), cost: true };

    // Tableau exact des deux cascades : composantes de l'atterrissage, éléments non récurrents retirés, atterrissage retraité. Le
    // détail des éléments non récurrents (libellés saisis, motifs de départ) reste dans Hypothèses budgétaires.
    const attRows: CroiseeRow[] = [];
    if (land.kind === "value") {
      for (const x of parts) attRows.push({ cells: [x.label, x.value], style: "child" });
      attRows.push({ cells: [`Atterrissage ${yearKey}`, land.total], style: "subtotal" });
    } else attRows.push({ cells: [`Atterrissage ${yearKey}`, ndIn(frDates(land.reason))], style: "subtotal" });
    if (r.kind === "value") {
      // 0 − x : jamais « −0 ».
      attRows.push({ cells: ["Éléments non récurrents déjà comptabilisés", nrHidden.realised ? ndIn(nrHidden.realised) : 0 - r.realised], style: "child" });
      attRows.push({ cells: ["Éléments non récurrents prévus (hypothèses)", nrHidden.projected ? ndIn(nrHidden.projected) : 0 - r.projected], style: "child" });
    }
    tables.push({
      id: BUDGET_TABLE_IDS.atterrissage,
      title: `Atterrissage ${yearKey} et atterrissage retraité, scénario « ${scenario.name} »`,
      columns: [
        { key: "ligne", header: "Composante", kind: "text" },
        { key: "montant", header: "Montant", kind: "eur" },
      ],
      rows: attRows,
      foot: { cells: [`Atterrissage retraité ${yearKey}`, r.kind === "value" ? r.retraite : ndIn(frDates(r.reason))] },
      terms: [T.atterrissage, T.retraite, T.cascades],
    });
    att.tables.push(BUDGET_TABLE_IDS.atterrissage);
    // Cascades : tracées quand les composantes le permettent ; sinon la raison est écrite (« vide » : une ligne ; n.d. : mention n.d.,
    // une seule quand les deux cascades le sont pour la même raison).
    const ndCharts: { label: string; reason: string }[] = [];
    const wf = (id: string, title: string, label: string, w: WaterfallIn) => {
      if (w.kind === "value") {
        charts.push(cascadeChart(id, title, "eur", { label: w.startLabel, value: w.start }, w.steps, { label: w.endLabel, value: w.end }, BUDGET_TABLE_IDS.atterrissage));
        att.charts.push(id);
      } else if (w.kind === "vide") att.notes.push(w.text);
      else ndCharts.push({ label, reason: frDates(w.reason) });
    };
    wf(BUDGET_CHART_IDS.atterrissage, `Atterrissage ${yearKey} : réel puis projection`, "Cascade de l'atterrissage", landingWaterfall(land));
    // Un total non récurrent masqué : la cascade du retraité n'est pas tracée (ni sa phrase « vide », qui dirait les totaux nuls) ;
    // une seule mention n.d. pour les deux totaux et la cascade, avec le lien vers les Paramètres quand le seuil n'est pas défini.
    const rw: WaterfallIn = r.kind === "value" ? retraiteWaterfall(r) : { kind: "nd", reason: r.reason };
    const nrReason = nrHidden.realised ?? nrHidden.projected;
    if (nrReason) {
      const label = `Éléments non récurrents déjà comptabilisés et prévus${rw.kind === "value" ? ", cascade du retraité" : ""}`;
      att.nd.push({ label, reason: nrReason, ...(conf.kind === "nd" ? { action: paramLink } : {}) });
    } else wf(BUDGET_CHART_IDS.retraite, `De l'atterrissage ${yearKey} à l'atterrissage retraité`, "Cascade du retraité", rw);
    const byReason = new Map<string, string[]>();
    for (const x of ndCharts) byReason.set(x.reason, [...(byReason.get(x.reason) ?? []), x.label]);
    for (const [reason, ls] of byReason) att.nd.push({ label: ls.length > 1 ? "Cascades de l'atterrissage et du retraité" : ls[0], reason });
    // Atterrissage face au budget saisi de l'année, sur les mois qui ont un montant de budget (Valeur − Référence = Écart).
    if (budget.kind === "value") {
      const ndR = gapIn?.kind === "nd" ? frDates(gapIn.reason) : (v.gap.reason ?? `aucun montant de budget saisi « ${budget.name} » pour ${yearKey}`);
      const compared = withY.length === 12 ? "Douze mois" : withY.length ? `${capital(nm)} avec budget (${exclText})` : "Aucun mois avec budget";
      const gv = gapIn?.kind === "value" ? gapIn : null;
      const twelve: CroiseeRow = { cells: [`Atterrissage ${yearKey}`, "Douze mois", land.kind === "value" ? land.total : ndIn(frDates(land.reason)), "", "", ""] };
      const budgetCell: CroiseeCell = gv ? gv.b : budgetIn && budgetIn.total.kind === "value" ? budgetIn.total.cost : ndIn(budgetIn && budgetIn.total.kind === "nd" ? frDates(budgetIn.total.reason) : ndR);
      tables.push({
        id: BUDGET_TABLE_IDS.annuel,
        title: `Atterrissage ${yearKey} face au budget saisi « ${budget.name} »`,
        columns: [
          { key: "ligne", header: "Lecture", kind: "text" },
          { key: "mois", header: "Mois comparés", kind: "text" },
          { key: "valeur", header: "Valeur", kind: "eur", term: T.atterrissage },
          { key: "comparaison", header: "Comparé à", kind: "text" },
          { key: "reference", header: "Référence", kind: "eur", term: T.budgetSaisi },
          { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true, term: T.tendances },
        ],
        rows: [
          // Mois exclus : l'atterrissage des douze mois sur sa propre ligne, sans écart, puis celui des mois avec budget.
          ...(partial ? [twelve] : []),
          { cells: [partial ? `Atterrissage ${yearKey}, mois avec budget` : `Atterrissage ${yearKey}`, compared, gv ? gv.a : ndIn(ndR), `Budget saisi « ${budget.name} »`, budgetCell, gv ? gv.delta : ndIn(ndR)] },
        ],
        terms: [T.atterrissage, T.budgetSaisi, T.ecartBudget],
      });
      att.tables.push(BUDGET_TABLE_IDS.annuel);
      att.trend = Boolean(gv);
    }
    if (hrefs.atterrissage) att.links.push({ href: hrefs.atterrissage, label: "Atterrissage et éléments non récurrents dans Hypothèses budgétaires" });
  }
  blocks.push(att);

  // --- 4. Écart lié aux personnes observées : partition des contrats de paie observés en N-1 et en N (nombres et montants seulement),
  // soumise au seuil de confidentialité.
  const pers: CxBlock = { id: "personnes", title: "Écart lié aux contrats observés", term: T.personnes, charts: [], tables: [], nd: [], notes: [], links: [], trend: false };
  const persLabel = "Contrats observés";
  if (conf.kind === "nd") pers.nd.push({ label: persLabel, reason: conf.reason, action: paramLink });
  if (cohorts.kind === "nd") pers.nd.push({ label: persLabel, reason: frDates(cohorts.reason) });
  if (conf.kind === "set" && cohorts.kind === "value") {
    const c = cohorts;
    const s = conf.value;
    // Service retenu par le filtre : ses contrats observés sur N (seulement N et les deux) ou sur N-1 (seulement N-1 et les deux)
    // décrivent de 1 à (seuil − 1) personnes, ou ne sont pas dénombrés (contrats non reliés sous le seuil, coût non nul sans contrat :
    // lignes sans contrat) → tout le tableau est n.d. ; un service sous le seuil l'emporte sur un service non dénombré.
    const [stCur, stPrev] = input.filtered
      ? [maskGroups([groupInput(unionGroups(c.onlyCur, c.both), s, Math.abs(c.total.cur))], s, false)[0], maskGroups([groupInput(unionGroups(c.onlyPrev, c.both), s, Math.abs(c.total.prev))], s, false)[0]]
      : ["shown" as MaskStatus, "shown" as MaskStatus];
    const serviceGuard = [stCur, stPrev].find((st) => st === "masked") ?? [stCur, stPrev].find(isHidden) ?? null;
    if (serviceGuard !== null) pers.nd.push({ label: persLabel, reason: maskReason(serviceGuard, s)! });
    else {
      const mask = maskCohorts(c, s);
      // Ligne masquée : chaque cellule chiffrée devient n.d. avec la même raison (masquage principal ou secondaire, indiscernables ;
      // lignes sans contrat d'un montant non nul : seuil non vérifiable) ; une cellule sans objet par construction (« — ») le reste.
      const cell = (id: CohortRowId, v: number | "" | null): CroiseeCell => (v === "" || v === null ? "" : mask[id] === "shown" ? v : ndIn(maskReason(mask[id], s)!));
      const rows: CroiseeRow[] = [
        { cells: [COHORT_LABELS.onlyPrev, cell("onlyPrev", c.onlyPrev.count), cell("onlyPrev", c.onlyPrev.prev), "", cell("onlyPrev", c.onlyPrev.delta)] },
        { cells: [COHORT_LABELS.onlyCur, cell("onlyCur", c.onlyCur.count), "", cell("onlyCur", c.onlyCur.cur), cell("onlyCur", c.onlyCur.delta)] },
        { cells: [COHORT_LABELS.both, cell("both", c.both.count), cell("both", c.both.prev), cell("both", c.both.cur), cell("both", c.both.delta)] },
      ];
      if (c.outside) rows.push({ cells: [COHORT_LABELS.outside, "", cell("outside", c.outside.prev), cell("outside", c.outside.cur), cell("outside", c.outside.delta)] });
      tables.push({
        id: BUDGET_TABLE_IDS.personnes,
        title: `Écart de masse lié aux contrats observés, ${labels.period} face à ${labels.prev}`,
        columns: [
          { key: "groupe", header: "Groupe", kind: "text" },
          { key: "nombre", header: "Contrats", kind: "nombre" },
          { key: "n1", header: `Coût N-1 (${labels.prev})`, kind: "eur", term: T.nMoinsUn },
          { key: "n", header: `Coût N (${labels.period})`, kind: "eur", term: T.masse },
          { key: "contribution", header: "Contribution à l'écart", kind: "eur", signed: true, costTrend: true, term: T.tendances },
        ],
        rows,
        foot: { cells: ["Total", c.total.count, c.total.prev, c.total.cur, c.total.delta] },
        notes: ["Contrat observé : contrat de paie qui porte au moins une ligne de masse dans la période ; une personne qui change de contrat entre les deux périodes compte dans deux groupes (une fois pour le seuil de confidentialité)."],
        terms: [T.personnes, T.masse, T.nMoinsUn, T.confidentialite],
      });
      pers.tables.push(BUDGET_TABLE_IDS.personnes);
      pers.trend = rows.some((r) => typeof r.cells[4] === "number" && r.cells[4] !== 0) || c.total.delta !== 0;
    }
  }
  blocks.push(pers);

  // --- 5. Blocs du rapport historique non repris (raisons de la matrice) : renvois vers Hypothèses budgétaires.
  const prevu: CxPrevu[] = [
    { id: "budget-plan", label: "Plan de départs, de congé et de reprise", reason: "noms, dates et montants nominatifs non repris : les départs, absences et reprises se saisissent comme hypothèses d'un scénario.", links: [{ href: hrefs.postes, label: "Modifications de postes" }] },
    { id: "budget-noria", label: "Simulation de noria", reason: "saisies hors scénario non reprises : un remplacement se saisit comme une embauche liée au départ qu'elle remplace.", term: T.tuilage, links: [{ href: hrefs.embauches, label: "Embauches prévisionnelles" }] },
    { id: "budget-integration", label: "Coût d'intégration", reason: "saisies propres au rapport historique : le coût d'une embauche est déjà compté dans la projection du scénario.", links: [{ href: hrefs.embauches, label: "Embauches prévisionnelles" }] },
  ];

  const tiles = [realTile, budgetTile, gapTile, landTile, annualTile, retraiteTile];
  const trend = tiles.some((t) => t.cost && ((t.valueTone && t.valueTone !== "flat") || (t.variations ?? []).some((x) => x.tone !== "flat" && x.text !== null)));
  const limits = input.filtered ? ["Budget saisi et scénario : globaux, non filtrables par service ; le réalisé et les contrats observés sont ceux du service choisi, soumis au seuil de confidentialité."] : [];
  return { ...base, tiles, tables, charts, blocks, prevu, tileNd: reasonLines(why), trend, limits };
}

// --- Lecture du chapitre 06 ------------------------------------------------------------------------------------------------------

const NA = "non filtrable par service";

// Raison n.d. du détail par contrat (zoomOf : « AAAA-MM : raison » par mois, séparés par « ; ») regroupée par raison identique, le
// mois retiré de la raison : « janv. 2025, févr. 2025 : mois hors de la lecture PayFit appliquée ». Texte inchangé sinon.
export function zoomReason(reason: string): string {
  const items = reason.split(" ; ").map((x) => {
    const m = /^(\d{4}-\d{2}) : (.+)$/.exec(x);
    return m ? { month: m[1], reason: m[2].split(m[1]).join("").replace(/\s{2,}/g, " ").trim() } : null;
  });
  if (items.length === 0 || items.some((x) => x === null)) return reason;
  return ndLines(ndGroups(items as { month: string; reason: string }[])).join(" ; ");
}

// Seuil de confidentialité de l'espace (module partagé, paramètre sans valeur par défaut) : valeur, ou raison de son absence.
export function confidentialiteOf(ctx: Pick<CroiseeContext, "settings">): Confidentialite {
  return seuilOf(ctx.settings.confidentialite);
}

export async function loadBudgetInput(ctx: CroiseeContext): Promise<BudgetChapterInput> {
  const slug = ctx.slug;
  const dataAction = { href: `/e/${slug}/donnees`, label: ctx.canEdit ? "Choisir ou lire une source dans Données" : "Données" };
  const p = ctx.period;
  if (!p) return { kind: "nd", reason: ctx.periodNd ?? "aucun mois disponible", action: dataAction };
  const year = p.year;
  const months = p.months;
  const svc = ctx.service.value;
  const filtered = svc !== undefined;
  const pay = await ctx.load.payroll();
  const journal = pay.input;
  const why = journalReason(pay) ?? "journal de paie indisponible";
  // Lien contrat → personne du référentiel : les groupes du seuil (service, cohortes, contributeurs) sont comptés en personnes.
  const link = await ctx.load.persons();

  // Réalisé : journal de paie de la lecture appliquée, mois clos ; restreint au service choisi (même objet pour l'effectif du service).
  const fj = journal && filtered ? withService(journal, svc ?? null) : journal;
  const live: LiveReading = fj ? { kind: "value", series: liveSeries("reel", "Réalisé", fj, pay.kpi.input) } : { kind: "nd", reason: why };

  // Budget saisi et scénario retenus dans les filtres : globaux (aucune ventilation par service).
  const b = ctx.budget.selected;
  const budget: BudgetReading = filtered
    ? { kind: "na", reason: `budget saisi global : ${NA}` }
    : b
      ? { kind: "value", name: b.name, series: budgetSeries(`budget-${b.id.slice(0, 8)}`, `Budget saisi « ${b.name} »`, String(year), b.amounts) }
      : { kind: "absent", reason: ctx.budget.reason ?? `aucun budget saisi pour ${year}` };
  let scenario: ScenarioReading;
  let scenarioId: string | null = null;
  let sameYear = false;
  if (filtered) scenario = { kind: "na", reason: `scénario global : ${NA}` };
  else {
    const s = await ctx.load.scenario();
    if (s.kind === "nd") scenario = { kind: "nd", reason: s.reason };
    else {
      const sc = s.full.scenario;
      scenarioId = sc.id;
      sameYear = sc.firstMonth.slice(0, 4) === String(year);
      // Raisons n.d. de la projection sans identité ; montants identiques à ceux des Hypothèses budgétaires.
      const pub = publicScenario(s.full.base, s.proj);
      const land = landing(pub.base, pub.proj, String(year));
      const ret = retraite(pub.base, pub.proj, s.full.hypotheses, String(year));
      scenario = {
        kind: "value",
        name: sc.name,
        refMonth: s.full.base.refMonth,
        series: scenarioSeries(sc.id, `Scénario « ${sc.name} »`, pub.base, pub.proj),
        // Raison n.d. de l'année (« AAAA-MM : raison » par mois) regroupée par raison identique.
        landing: land.kind === "nd" ? { ...land, reason: zoomReason(land.reason) } : land,
        // Totaux seulement : le détail par élément (catégories et motifs saisis, texte libre) reste dans Hypothèses budgétaires.
        retraite: ret.kind === "nd" ? { ...ret, reason: zoomReason(ret.reason) } : { ...ret, rows: [] },
        contributors: nonRecurringContributors(pub.base, pub.proj, s.full.hypotheses, String(year), link),
      };
    }
  }

  // Contrats observés : détail par contrat du journal (zoomOf, masse chargée) sur la période et sur N-1, puis partition.
  let cohorts: CohortReading;
  if (!journal) cohorts = { kind: "nd", reason: why };
  else {
    const filter: ServiceFilter = filtered ? { value: svc ?? null } : null;
    const cur = zoomOf({ kind: "reel", journal, filter }, months, "masse");
    const prev = zoomOf({ kind: "reel", journal, filter }, ctx.prevMonths, "masse");
    cohorts = prev.kind === "nd" ? { kind: "nd", reason: `N-1 : ${zoomReason(prev.reason)}` } : cur.kind === "nd" ? { kind: "nd", reason: zoomReason(cur.reason) } : partitionCohorts(prev.byKey, cur.byKey, HORS_SALARIE, link);
  }

  const hyp = `/e/${slug}/studio-rh/hypotheses`;
  const withScenario = (q: string) => (scenarioId ? `${hyp}?scenario=${encodeURIComponent(scenarioId)}&${q}` : hyp);
  return {
    kind: "value",
    year,
    months,
    labels: ctx.labels,
    filtered,
    hrefs: {
      hypotheses: hyp,
      comparaison: withScenario(`vue=resultat&sous=comparaison&annee=${year}`),
      // Hypothèses › Atterrissage montre la première année du scénario : lien proposé seulement quand c'est l'année de la période.
      atterrissage: scenarioId && sameYear ? withScenario("vue=resultat&sous=atterrissage") : null,
      postes: withScenario("vue=postes"),
      embauches: withScenario("vue=embauches"),
      parametres: confidentialiteHref(slug),
    },
    live,
    budget,
    scenario,
    cohorts,
    confidentialite: confidentialiteOf(ctx),
    serviceSizes: fj && filtered ? observedSizes(fj, months, link) : null,
  };
}

// Modèle du chapitre 06, calculé une fois par requête : l'écran (ChBudget) et l'export appellent cette même fonction.
export const budgetModel = memoByContext((ctx: CroiseeContext) => loadBudgetInput(ctx).then(buildBudget));

// =================================================================================================================================
// Chapitre 08 · Effets d'évolution
// =================================================================================================================================

export type EffetsHrefs = { analyse: string; embauches: string; globales: string; fixeVariable: string; parametres: string };
export type EffetsInput =
  | { kind: "nd"; reason: string; action: Action }
  | {
      kind: "value";
      year: number;
      labels: { period: string; prev: string };
      masse: { cur: Agg; prev: Agg }; // masse salariale chargée de N et de N-1 (aggregate, comme l'Analyse des écarts) : sans ETP
      pont: Bridge; // pont volume / coût moyen de N-1 à N (bridge, comme l'Analyse des écarts)
      cascade: Cascade; // cascade d'ETP de N-1 à N (etpCascade)
      etp: { cur: Agg; prev: Agg }; // ETP moyens (moyenne des ETP de fin de mois)
      confidentialite: Confidentialite;
      serviceSizes: { cur: JournalGroup | null; prev: JournalGroup | null } | null; // filtre de service : personnes des contrats observés du service sur N et N-1
      link: PersonLink; // lien contrat (clé de référentiel des paliers) → jeton de personne
      hrefs: EffetsHrefs;
    };
export type EffetsModel = BlocksModel;

const etpText = (a: Agg): TileValue => (a.kind === "value" ? { text: `${fmtFixed({ num: a.num, den: a.den })} ETP`, kind: "value", reason: null } : a.kind === "nd" ? nd(frDates(a.reason)) : nd("sans objet"));
const aggMoney = (a: Agg): TileValue => (a.kind === "value" ? money(a.num) : a.kind === "nd" ? nd(frDates(a.reason)) : nd("sans objet"));

// Départ (N-1) ou arrivée (N) exacts de la cascade d'ETP : l'ETP moyen de la carte, somme des ETP de fin de mois sur n × 10 000,
// quand il est connu et que la cascade, arrondie au dix-millième, part (ou arrive) bien de cette valeur (même composition) ; sinon
// n.d. avec la raison de la carte. num : la somme, sur n × 10 000.
type CascadeEnd = { kind: "value"; num: number } | { kind: "nd"; reason: string };
export const CASCADE_NON_RAPPROCHEE = "ETP moyen de la carte et composition par salarié de la cascade non rapprochés";
function cascadeEnd(c: Extract<Cascade, { kind: "value" }>, a: Agg, rounded: number): CascadeEnd {
  if (a.kind !== "value") return { kind: "nd", reason: a.kind === "nd" ? frDates(a.reason) : "sans objet" };
  if (a.den !== c.months * 10_000 || roundDiv(BigInt(a.num), BigInt(c.months)) !== rounded) return { kind: "nd", reason: CASCADE_NON_RAPPROCHEE };
  return { kind: "value", num: a.num };
}

// Valeur tracée d'un ETP moyen exact num ÷ (n × 10 000), en dix-millièmes entiers : son arrondi au dix-millième, ou le dix-millième
// voisin, du côté de la valeur exacte, quand cet arrondi s'écrirait autrement au centième (12,344 97 arrondi à 12,345 0 s'écrirait
// « 12,35 » au lieu de « 12,34 »). Le graphique écrit ainsi la même valeur que la carte et le tableau, à un dix-millième près.
export function plotEtp4(num: number, n: number): number {
  const r = roundDiv(BigInt(num), BigInt(n));
  if (roundHalfUp({ num: r, den: 10_000 }, 2) === roundHalfUp({ num, den: n * 10_000 }, 2)) return r;
  return r * n > num ? r - 1 : r + 1;
}

export function buildEffets(input: EffetsInput): EffetsModel {
  const base: EffetsModel = { chapter: "effets", tiles: [], alerts: [], tables: [], charts: [], limits: [], nd: null, terms: Object.values(E), blocks: [], prevu: [], tileNd: [], trend: false };
  if (input.kind === "nd") return { ...base, nd: { reason: capital(input.reason), action: input.action } };
  const { labels, masse, pont, cascade, etp, hrefs, confidentialite: conf } = input;
  const startLabel = `N-1 (${labels.prev})`;
  const endLabel = `N (${labels.period})`;
  const tables: CroiseeTable[] = [];
  const charts: CroiseeChart[] = [];
  const why: Why[] = [];
  const paramLink = { href: hrefs.parametres, label: "Paramètres" };

  // Service retenu par le filtre (seuil de confidentialité) : sans seuil, ou quand le service compte de 1 à (seuil − 1) personnes sur
  // N ou sur N-1, ses chiffres (cartes, pont) sont n.d. ; un effectif non dénombré (contrats non reliés sous le seuil, aucun contrat
  // pour une masse ou un ETP non nuls) ne permet pas de vérifier le seuil. Un service sous le seuil l'emporte sur un service non
  // dénombré.
  let guard: string | null = null;
  const sz = input.serviceSizes;
  if (sz) {
    if (conf.kind === "nd") guard = conf.reason;
    else {
      const shownNonZero = (xs: Agg[]) => xs.some((a) => a.kind === "value" && a.num !== 0);
      const side = (g: JournalGroup | null, shown: Agg[]): MaskStatus => maskGroups([g ? groupInput(g, conf.value, 1, g.nonZero || shownNonZero(shown)) : { size: null, value: 1 }], conf.value, false)[0];
      const st = [side(sz.cur, [masse.cur, etp.cur]), side(sz.prev, [masse.prev, etp.prev])];
      const worst = st.find((x) => x === "masked") ?? st.find(isHidden) ?? null;
      if (worst !== null) guard = maskReason(worst, conf.value);
    }
  }
  // Carte gardée : une valeur déjà n.d. garde sa raison ; une valeur affichable devient n.d. avec la raison du seuil.
  const guarded = (t: TileSpec): TileSpec => (guard === null ? t : { id: t.id, label: t.label, term: t.term, sub: t.sub, cost: t.cost, value: t.value.kind === "nd" ? t.value : nd(guard) });

  // --- 1. Écart de masse N − N-1 (aggregate, indépendant de l'ETP) et décomposition en effet volume (ETP-mois) et effet coût moyen
  // (bridge, pontWaterfall).
  const dec: CxBlock = { id: "decomposition", title: "Décomposer la variation du coût", term: E.pont, charts: [], tables: [], nd: [], notes: [], links: [{ href: hrefs.analyse, label: "Analyse des écarts" }], trend: false };
  const dm = diff(masse.prev, masse.cur);
  const ecartTile: TileSpec =
    dm.kind === "value"
      ? { id: "ecart", label: "Écart de coût observé", term: E.masse, sub: "Masse salariale chargée, N − N-1", value: signedMoney(dm.num), valueTone: costTone(dm.num), cost: true, variations: [tileLine(endLabel, aggMoney(masse.cur)), tileLine(startLabel, aggMoney(masse.prev))] }
      : { id: "ecart", label: "Écart de coût observé", term: E.masse, sub: "Masse salariale chargée, N − N-1", value: nd(dm.kind === "nd" ? frDates(dm.reason) : "sans objet"), cost: true };
  let volumeTile: TileSpec;
  let coutTile: TileSpec;
  if (guard !== null) {
    volumeTile = { id: "volume", label: "Effet volume", term: E.pont, value: nd(guard), cost: true };
    coutTile = { id: "cout-moyen", label: "Effet coût moyen", term: E.pont, value: nd(guard), cost: true };
    dec.nd.push({ label: "Pont volume / coût moyen du service", reason: guard, action: conf.kind === "nd" ? paramLink : undefined });
  } else if (pont.kind === "nd") {
    const r = frDates(pont.reason);
    volumeTile = { id: "volume", label: "Effet volume", term: E.pont, value: nd(r), cost: true };
    coutTile = { id: "cout-moyen", label: "Effet coût moyen", term: E.pont, value: nd(r), cost: true };
    dec.nd.push({ label: "Pont volume / coût moyen", reason: r });
  } else {
    volumeTile = { id: "volume", label: "Effet volume", term: E.pont, sub: "Écart d'ETP-mois au coût moyen de N-1", value: signedMoney(pont.volume), valueTone: costTone(pont.volume), cost: true };
    coutTile = { id: "cout-moyen", label: "Effet coût moyen", term: E.pont, sub: "Écart de coût par ETP-mois, sur les ETP-mois de N", value: signedMoney(pont.averageCost), valueTone: costTone(pont.averageCost), cost: true };
    const w = pontWaterfall(pont);
    if (w.kind === "value") {
      charts.push(cascadeChart(EFFETS_CHART_IDS.pont, `Masse salariale chargée, de N-1 à N : effet volume et effet coût moyen`, "eur", { label: startLabel, value: w.start }, w.steps, { label: endLabel, value: w.end }, EFFETS_TABLE_IDS.pont, "cost"));
      dec.charts.push(EFFETS_CHART_IDS.pont);
    }
    tables.push({
      id: EFFETS_TABLE_IDS.pont,
      title: `Pont de la masse salariale chargée, de ${startLabel} à ${endLabel}`,
      columns: [
        { key: "ligne", header: "Ligne", kind: "text" },
        { key: "montant", header: "Montant", kind: "eur", term: E.masse },
        { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true, term: E.tendances },
      ],
      rows: [
        { cells: [`Masse salariale chargée ${startLabel}`, pont.b.cost, ""], style: "subtotal" },
        { cells: ["Effet volume", "", pont.volume], style: "child" },
        { cells: ["Effet coût moyen", "", pont.averageCost], style: "child" },
        { cells: ["Écart total", "", pont.delta], style: "subtotal" },
      ],
      foot: { cells: [`Masse salariale chargée ${endLabel}`, pont.a.cost, ""] },
      notes: ["Effet de structure (mix) non isolé : compris dans l'effet coût moyen."],
      terms: [E.pont, E.masse, E.tendances],
    });
    // Base du pont : masse, ETP-mois (somme des ETP de fin de mois) et coût par ETP-mois de chaque période.
    const cpe = (x: { cost: number; etpMonths4: number }) => roundDiv(BigInt(x.cost) * 10_000n, BigInt(x.etpMonths4));
    tables.push({
      id: EFFETS_TABLE_IDS.pontBase,
      title: `Base du pont : masse, ETP-mois et coût par ETP-mois`,
      columns: [
        { key: "periode", header: "Période", kind: "text" },
        { key: "masse", header: "Masse salariale chargée", kind: "eur", term: E.masse },
        { key: "etp", header: "ETP-mois", kind: "etp", term: E.etpFinMois },
        { key: "cout", header: "Coût par ETP-mois", kind: "eur" },
      ],
      rows: [
        { cells: [startLabel, pont.b.cost, pont.b.etpMonths4, cpe(pont.b)] },
        { cells: [endLabel, pont.a.cost, pont.a.etpMonths4, cpe(pont.a)] },
      ],
      terms: [E.pont, E.etpFinMois],
    });
    dec.tables.push(EFFETS_TABLE_IDS.pont, EFFETS_TABLE_IDS.pontBase);
    dec.trend = true;
  }
  // Carte d'ETP : moyenne des ETP de fin de mois de N, celle de N-1 et l'écart (neutre : un ETP n'est pas un montant).
  const cur = etpText(etp.cur);
  const prev = etpText(etp.prev);
  const d = diff(etp.prev, etp.cur);
  const dText = d.kind === "value" ? `${d.num > 0 ? "+" : d.num < 0 ? "−" : ""}${fmtFixed({ num: Math.abs(d.num), den: d.den })} ETP` : null;
  const etpTile: TileSpec = {
    id: "etp",
    label: "ETP moyen",
    term: E.etpMoyen,
    sub: labels.period,
    value: cur,
    variations: [tileLine(startLabel, prev), plainVariation("Écart", dText, d.kind === "nd" ? frDates(d.reason) : d.kind === "na" ? "sans objet" : null)],
  };
  if (guard === null && cur.kind !== "nd") why.push({ label: "ETP moyen N-1", reason: prev.kind === "nd" ? prev.reason : null });

  // --- 2. Cascade d'ETP (etpCascade, comme l'Analyse des écarts) : entrées, sorties, effets de présence, changements de quotité. Chaque
  // palier décrit un groupe de contrats : seuil de confidentialité, avec le masquage secondaire des paliers (l'écart total est affiché).
  const etpBlock: CxBlock = { id: "etp", title: "Cascade d'ETP", term: E.cascade, charts: [], tables: [], nd: [], notes: [], links: [], trend: false };
  if (cascade.kind === "nd") etpBlock.nd.push({ label: "Cascade d'ETP", reason: frDates(cascade.reason) });
  else if (guard !== null) etpBlock.nd.push({ label: "Cascade d'ETP du service", reason: guard, action: conf.kind === "nd" ? paramLink : undefined });
  else if (conf.kind === "nd") etpBlock.nd.push({ label: "Cascade d'ETP", reason: conf.reason, action: paramLink });
  else {
    const seuil = conf.value;
    // Taille d'un palier : les personnes de ses contrats (reliés par le lien) ; members : leurs jetons, pour qu'une personne présente
    // dans deux paliers masqués (effet report et changement d'ETP, par exemple) n'y compte qu'une fois ; un contrat non relié ne
    // protège pas (palier non dénombré sous le seuil).
    const status = maskGroups(
      cascade.steps.map((s) => groupInput(personsOfContracts(s.people.map((p) => p.key), input.link), seuil, Math.abs(s.etp4), s.people.length > 0)),
      seuil,
      true,
    );
    const hidden = status.some(isHidden);
    // Départ et arrivée : les ETP moyens exacts de la carte (fraction sur n × 10 000), jamais leur arrondi au dix-millième arrondi une
    // seconde fois au centième ; le résiduel d'arrondi absorbe l'écart entre ces valeurs exactes et les paliers arrondis.
    const n = cascade.months;
    const den = n * 10_000;
    const A = cascadeEnd(cascade, etp.prev, cascade.start);
    const B = cascadeEnd(cascade, etp.cur, cascade.end);
    const paliers = cascade.steps.reduce((s, x) => s + x.etp4, 0);
    const both = A.kind === "value" && B.kind === "value" ? { a: A.num, b: B.num } : null;
    const bothNd = A.kind === "nd" ? A.reason : B.kind === "nd" ? B.reason : "";
    const exactOf = (e: CascadeEnd): CroiseeCell => (e.kind === "value" ? { exact: e.num / den } : ndIn(e.reason));
    // Arrivée exacte − départ exact (écart total), puis − somme des paliers arrondis (résiduel), en n × dix-millièmes sur n × 10 000.
    const gapOf = (f: (x: { a: number; b: number }) => number): CroiseeCell => (both ? { exact: f(both) / den } : ndIn(bothNd));
    if (hidden) etpBlock.nd.push({ label: "Graphique de la cascade d'ETP", reason: confidentialiteReason(seuil) });
    else if (!both) etpBlock.nd.push({ label: "Graphique de la cascade d'ETP", reason: bothNd });
    else {
      // Graphique en dix-millièmes entiers : départ et arrivée écrits au centième comme la carte (plotEtp4), paliers arrondis, et le
      // résiduel d'arrondi qui les raccorde quand il n'est pas nul.
      const start = plotEtp4(both.a, n);
      const end = plotEtp4(both.b, n);
      const steps = cascade.steps.map((s) => ({ label: s.label, value: s.etp4 }));
      const residual = end - start - paliers;
      if (residual !== 0) steps.push({ label: "Résiduel d'arrondi", value: residual });
      charts.push(cascadeChart(EFFETS_CHART_IDS.etp, "ETP moyen, de N-1 à N : entrées, sorties et changements de quotité", "etp", { label: startLabel, value: start }, steps, { label: endLabel, value: end }, EFFETS_TABLE_IDS.etp));
      etpBlock.charts.push(EFFETS_CHART_IDS.etp);
    }
    tables.push({
      id: EFFETS_TABLE_IDS.etp,
      title: `Cascade des ETP moyens, de ${startLabel} à ${endLabel}`,
      columns: [
        { key: "ligne", header: "Ligne", kind: "text" },
        { key: "etp", header: "ETP", kind: "etp", term: E.etpMoyen },
        { key: "ecart", header: "Écart", kind: "etp", signed: true },
      ],
      rows: [
        { cells: [`ETP moyen ${startLabel}`, exactOf(A), ""], style: "subtotal" },
        ...cascade.steps.map((s, i): CroiseeRow => ({ cells: [STEP_LABELS[s.id], "", isHidden(status[i]) ? ndIn(maskReason(status[i], seuil)!) : s.etp4], style: "child" })),
        { cells: ["Résiduel d'arrondi", "", gapOf((x) => x.b - x.a - n * paliers)], style: "child" },
        { cells: ["Écart total", "", gapOf((x) => x.b - x.a)], style: "subtotal" },
      ],
      foot: { cells: [`ETP moyen ${endLabel}`, exactOf(B), ""] },
      terms: [E.cascade, E.residuel, E.etpMoyen, E.confidentialite],
    });
    etpBlock.tables.push(EFFETS_TABLE_IDS.etp);
  }

  // --- 3. Blocs non repris dans cette version (raisons de la matrice).
  const prevu: CxPrevu[] = [
    { id: "effets-tuilages", label: "Tuilages", reason: "binômes de passation non désignés dans Clair : un tuilage à venir se saisit dans un scénario, par une embauche liée au départ qu'elle remplace.", term: E.tuilage, links: [{ href: hrefs.embauches, label: "Embauches prévisionnelles" }] },
    { id: "effets-structure", label: "Effet de structure", reason: "classifications et changements individuels datés absents.", term: E.pont, links: [] },
    { id: "effets-hausses", label: "Hausses de base observées", reason: "rubrique de salaire de base absente de l'API de paie.", links: [{ href: hrefs.fixeVariable, label: "04 · Fixe & variable" }] },
    { id: "effets-masse-niveau-report", label: "Masse, niveau et report", reason: "simulation à dériver de la grille mensuelle des taux d'augmentation d'un scénario (Hypothèses globales).", term: E.effetsMasseNiveauReport, links: [{ href: hrefs.globales, label: "Hypothèses globales" }] },
  ];

  const tiles = [ecartTile, volumeTile, coutTile, etpTile].map(guarded);
  const trend = tiles.some((t) => t.cost && t.valueTone !== undefined && t.valueTone !== "flat");
  return {
    ...base,
    tiles,
    tables,
    charts,
    blocks: [dec, etpBlock],
    prevu,
    tileNd: reasonLines(why),
    trend,
    limits: ["ETP-mois : somme des ETP de fin de mois (ETP contractuels), pas des ETP payés."],
  };
}

// --- Lecture du chapitre 08 ------------------------------------------------------------------------------------------------------

export async function loadEffetsInput(ctx: CroiseeContext): Promise<EffetsInput> {
  const slug = ctx.slug;
  const dataAction = { href: `/e/${slug}/donnees`, label: ctx.canEdit ? "Choisir ou lire une source dans Données" : "Données" };
  const p = ctx.period;
  if (!p) return { kind: "nd", reason: ctx.periodNd ?? "aucun mois disponible", action: dataAction };
  const pay = await ctx.load.payroll();
  const journal = pay.input;
  const year = p.year;
  const svc = ctx.service.value;
  const hyp = `/e/${slug}/studio-rh/hypotheses`;
  const sc = ctx.scenario.selected?.scenario.id ?? null;
  const q = (v: string) => (sc ? `${hyp}?scenario=${encodeURIComponent(sc)}&vue=${v}` : hyp);
  const analyse = new URLSearchParams({ v1: `reel:${year - 1}`, v2: `reel:${year}`, de: p.from, a: p.to });
  if (ctx.state.service) analyse.set("service", ctx.state.service);
  const hrefs: EffetsHrefs = {
    analyse: `/e/${slug}/studio-rh/masse-salariale/analyse?${analyse.toString()}`,
    embauches: q("embauches"),
    globales: q("globales"),
    fixeVariable: ctx.href({ chapitre: "fixe-variable", tri: null, sens: null }),
    parametres: confidentialiteHref(slug),
  };
  const confidentialite = confidentialiteOf(ctx);
  const link = await ctx.load.persons();
  if (!journal) {
    const r = journalReason(pay) ?? "journal de paie indisponible";
    const n: Agg = { kind: "nd", reason: r };
    return { kind: "value", year, labels: ctx.labels, masse: { cur: n, prev: n }, pont: { kind: "nd", reason: r }, cascade: { kind: "nd", reason: r }, etp: { cur: n, prev: n }, confidentialite, serviceSizes: null, link, hrefs };
  }
  // Mêmes versions que l'Analyse des écarts pour « Réel PayFit N-1 » et « Réel PayFit N » : mêmes mois, même filtre de service,
  // même ETP par service (lignes du journal rattachées au contrat).
  const filter: ServiceFilter = svc === undefined ? null : { value: svc };
  const kpi = pay.kpi.input;
  const etpService = (m: string, f: { value: string | null }) => {
    const [e] = pay.etp([m], f);
    return e.etp4 === null ? ndCell(e.reason ?? "ETP par service n.d.") : val(e.etp4);
  };
  const a = reelVersion(`reel:${year - 1}`, `Réel PayFit ${year - 1}`, String(year - 1), journal, kpi, filter, etpService);
  const b = reelVersion(`reel:${year}`, `Réel PayFit ${year}`, String(year), journal, kpi, filter, etpService);
  const monthsA = ctx.prevMonths;
  const monthsB = p.months;
  // Le pont aligne les mois de N sur ceux de N-1 (comparaison mois à mois) : une raison n.d. y serait datée du mois de N-1. Elle est
  // relue sur les mois réels de chaque période (même fonction bridge, chaque lecture face à elle-même).
  let pont = bridge(alignedSeries(b, monthsB, monthsA), alignedSeries(a, monthsA, monthsA), monthsA);
  if (pont.kind === "nd") {
    const own = (v: typeof a, months: string[]) => bridge(alignedSeries(v, months, months), alignedSeries(v, months, months), months);
    const dated = [own(b, monthsB), own(a, monthsA)].find((x) => x.kind === "nd");
    if (dated) pont = dated;
  }
  const fj = filter ? withService(journal, filter.value) : null;
  return {
    kind: "value",
    year,
    labels: ctx.labels,
    masse: { cur: aggregate(b, monthsB, "masse"), prev: aggregate(a, monthsA, "masse") },
    pont,
    cascade: etpCascade(a, b, monthsA, monthsB),
    etp: { cur: aggregate(b, monthsB, "etp"), prev: aggregate(a, monthsA, "etp") },
    confidentialite,
    serviceSizes: fj ? { cur: masseGroup(fj, monthsB, link), prev: masseGroup(fj, monthsA, link) } : null,
    link,
    hrefs,
  };
}

// Modèle du chapitre 08, calculé une fois par requête : l'écran (ChEffets) et l'export appellent cette même fonction.
export const effetsModel = memoByContext((ctx: CroiseeContext) => loadEffetsInput(ctx).then(buildEffets));
