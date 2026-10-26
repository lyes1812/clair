import type { ChartSeries } from "@/components/charts/shared";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { journalReason } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { etpCascade, STEP_LABELS, type Cascade } from "@/lib/budget/cascade";
import { landing, roundDiv, type Landing } from "@/lib/budget/engine";
import { retraite, type Retraite } from "@/lib/budget/lot3";
import { bridge, budgetSeries, gap, liveSeries, scenarioSeries, total, type Bridge, type Gap, type Layer, type Point, type Series } from "@/lib/budget/series";
import { aggregate, alignedSeries, diff, nd as ndCell, reelVersion, val, type Agg, type ServiceFilter } from "@/lib/budget/versions";
import { HORS_SALARIE, zoomOf } from "@/lib/budget/zoom";
import { partitionCohorts, type CohortPartition } from "@/lib/croisee/cohortes";
import { withService } from "@/lib/payroll/engine";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";
import { costTone } from "@/lib/trend";
import { costVariation, plainVariation, yearMonths, type ChapterModel, type CroiseeCell, type CroiseeChart, type CroiseeRow, type CroiseeTable, type TileSpec, type TileVariation } from "@/lib/viz/croisee";
import { etpWaterfall, pontWaterfall } from "@/lib/viz/ecart";
import { comparisonSeries, frDates, landingParts, landingWaterfall, layerSpans, monthAxis, retraiteWaterfall, type WaterfallIn } from "@/lib/viz/hypotheses";
import { capital, euros, eurosSigned, monthLongLabel, monthShortYear, ndGroups, ndLines, reasonLines } from "@/lib/viz/masse";
import { landingView, nd, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitres 06 · Budget & prévisions et 08 · Effets d'évolution. Pour chacun, deux fonctions :
// - load<Chapitre>Input(ctx) lit les sources par les lecteurs du contexte et appelle les fonctions existantes : séries, écart et
//   pont du module budgétaire (series.ts), atterrissage (engine.ts) et atterrissage retraité (lot3.ts), versions et cascade d'ETP
//   (versions.ts, cascade.ts, comme l'Analyse des écarts), détail par contrat (zoom.ts) ; aucun nouveau moteur ;
// - build<Chapitre>(input), pure, met ces résultats en forme : cartes, graphiques, tableaux exacts, blocs « Prévu ». L'écran et les
//   exports partent de ce même modèle.
// Seul calcul nouveau : la partition des personnes observées (src/lib/croisee/cohortes.ts, testée). Montants en centimes, ETP en
// dix-millièmes ; un n.d. reste n.d. avec sa raison, jamais zéro. Aucune identité de personne dans le modèle.

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
} as const;
const T = BUDGET_CX_TERMS;
const E = EFFETS_CX_TERMS;

export const BUDGET_TABLE_IDS = {
  mensuel: "budget-mensuel",
  douzeMois: "budget-douze-mois",
  atterrissage: "budget-atterrissage",
  nonRecurrents: "budget-non-recurrents",
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

// =================================================================================================================================
// Chapitre 06 · Budget & prévisions
// =================================================================================================================================

export type BudgetReading = { kind: "value"; name: string; series: Series } | { kind: "absent" | "na"; reason: string };
export type LiveReading = { kind: "value"; series: Series } | { kind: "nd"; reason: string };
export type ScenarioReading = { kind: "value"; name: string; refMonth: string; series: Series; landing: Landing; retraite: Retraite } | { kind: "nd" | "na"; reason: string };
export type CohortReading = CohortPartition;
export type BudgetHrefs = { hypotheses: string; comparaison: string; atterrissage: string; postes: string; embauches: string };

export type BudgetChapterInput =
  | { kind: "nd"; reason: string; action: Action }
  | {
      kind: "value";
      year: number;
      months: string[]; // mois de la période
      labels: { period: string; prev: string };
      filtered: boolean; // un service est choisi : réalisé et personnes du service ; budget et scénario globaux (n.d.)
      hrefs: BudgetHrefs;
      live: LiveReading; // réalisé du journal de paie (mois clos), filtré par service le cas échéant
      budget: BudgetReading;
      scenario: ScenarioReading; // scénario retenu, avec son atterrissage et son atterrissage retraité de l'année
      cohorts: CohortReading;
    };

export type BudgetModel = BlocksModel;

export function buildBudget(input: BudgetChapterInput): BudgetModel {
  const base: BudgetModel = { chapter: "budget", tiles: [], alerts: [], tables: [], charts: [], limits: [], nd: null, terms: Object.values(T), blocks: [], prevu: [], tileNd: [], trend: false };
  if (input.kind === "nd") return { ...base, nd: { reason: capital(input.reason), action: input.action } };
  const { year, months, labels, live, budget, scenario, cohorts, hrefs } = input;
  const yearKey = String(year);
  const ym = yearMonths(year);
  const why: Why[] = [];
  const tables: CroiseeTable[] = [];
  const charts: CroiseeChart[] = [];
  const blocks: CxBlock[] = [];
  const hypLink = { href: hrefs.hypotheses, label: "Hypothèses budgétaires" };

  // --- 1. Réalisé, budget saisi et écart sur la période : seuls les mois qui ont un montant de budget sont comparés.
  const real = live.kind === "value" ? total(live.series, months) : ({ kind: "nd", reason: live.reason } as const);
  const realTile: TileSpec = { id: "realise", label: "Réalisé", term: T.masse, sub: labels.period, value: real.kind === "value" ? money(real.cost) : nd(frDates(real.reason)), cost: true, main: true };
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
    budgetTile = { ...budgetBase, id: "budget", label: "Budget de la période", term: T.budgetSaisi, sub: `Budget saisi « ${budget.name} »`, value: b.kind === "value" ? money(b.cost) : nd(frDates(b.reason)), note: exclNote };
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
          ...(excluded.length ? [plainVariation("Réalisé des mois comparés", euros(g.a))] : []),
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
  const mensuelRows: CroiseeRow[] = months.map((m) => {
    const r: CroiseeCell = live.kind === "value" ? readingCell(live.series, m) : ndIn(live.reason);
    const bp = budget.kind === "value" ? pointOf(budget.series, m) : null;
    const b: CroiseeCell = bp && bp.kind === "value" ? bp.cost : ndIn(budgetNdOf());
    const e: CroiseeCell = typeof r === "number" && typeof b === "number" ? r - b : typeof b !== "number" ? ndIn(budgetNdOf()) : ndIn((r as { nd: string }).nd);
    return { cells: [capital(monthLongLabel(m)), r, b, e] };
  });
  // Pied : total des mois comparés au budget (de la période entière sans montant de budget) ; l'écart n'existe que si les deux le sont.
  const footMonths = withBudget.length ? withBudget : months;
  const footLabel = excluded.length && withBudget.length ? `Total des ${plural(withBudget.length, "mois", "mois")} avec budget` : "Total de la période";
  const noAmount = budget.kind === "value" ? `aucun montant de budget saisi « ${budget.name} » sur la période` : budget.reason;
  const footReal = live.kind === "value" ? total(live.series, footMonths) : ({ kind: "nd", reason: live.reason } as const);
  const footBudget = budget.kind === "value" && withBudget.length ? total(budget.series, withBudget) : ({ kind: "nd", reason: noAmount } as const);
  const footRow: CroiseeRow = {
    cells: [
      footLabel,
      footReal.kind === "value" ? footReal.cost : ndIn(frDates(footReal.reason)),
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
    terms: [T.masse, T.budgetSaisi, T.ecartBudget, T.tendances],
  });
  blocks.push({ id: "ecart", title: "Écart au budget", term: T.ecartBudget, charts: [], tables: [BUDGET_TABLE_IDS.mensuel], nd: [], notes: [], links: [], trend: Boolean(g && g.kind === "value") || mensuelRows.some((r) => typeof r.cells[3] === "number" && r.cells[3] !== 0) });

  // --- 2. Douze mois : scénario retenu (réel figé puis projection), réalisé et budget saisi, comme Hypothèses › Résultat › Comparaison.
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

  // --- 3. Atterrissage de l'année (réel + projection du scénario), atterrissage retraité, écart au budget saisi de l'année.
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
      withY = ym.filter((m) => pointOf(budget.series, m).kind === "value");
      exclY = ym.filter((m) => !withY.includes(m));
      if (withY.length === 0) budgetIn = { total: { kind: "nd", reason: `aucun montant de budget saisi « ${budget.name} » pour ${yearKey}` } };
      else {
        budgetIn = { total: total(budget.series, withY) };
        if (land.kind === "value") gapIn = gap(scenario.series, budget.series, withY);
      }
    }
    const v = landingView(land.kind === "value" ? land : { kind: "nd", reason: frDates(land.reason) }, budgetIn, gapIn, yearKey);
    const parts = land.kind === "value" ? landingParts(land) : [];
    const exclYNote = exclY.length && withY.length ? `Comparé sur ${plural(withY.length, "mois", "mois")} ; sans montant de budget, exclus : ${monthsText(exclY)}` : undefined;
    landTile = {
      id: "atterrissage",
      label: `Atterrissage ${yearKey}`,
      term: T.atterrissage,
      sub: `Scénario « ${scenario.name} »`,
      value: v.value,
      cost: true,
      variations: [tileLine(budget.kind === "value" ? `Budget saisi « ${budget.name} »` : "Budget saisi", v.budget)],
      note: parts.length ? parts.map((x) => `${x.label} : ${euros(x.value)}`).join(" · ") : undefined,
      spark: { label: "Réel puis projection, par mois", values: ym.map((m) => {
        const p = pointOf(scenario.series, m);
        return p.kind === "value" ? p.cost : null;
      }) },
    };
    if (v.value.kind !== "nd") why.push({ label: "Budget saisi de l'année", reason: v.budget.kind === "nd" ? v.budget.reason : null });
    const annualBase = { id: "ecart-annuel", label: "Écart annuel projeté", term: T.ecartBudget, sub: budget.kind === "value" ? `Atterrissage − budget saisi « ${budget.name} »` : undefined, cost: true };
    if (!gapIn || gapIn.kind === "nd") annualTile = { ...annualBase, value: nd(gapIn?.kind === "nd" ? frDates(gapIn.reason) : (v.gap.reason ?? (budget.kind !== "value" ? budget.reason : "valeur absente"))), note: exclYNote };
    else {
      annualTile = {
        ...annualBase,
        value: signedMoney(gapIn.delta),
        valueTone: costTone(gapIn.delta),
        variations: [costVariation("Écart (%)", gapIn.pct === null ? null : gapIn.delta, gapIn.pct === null ? null : `${pctText(gapIn.pct)} · ${word(gapIn.delta)}`, gapIn.pct === null ? "budget saisi nul ou négatif : pourcentage non défini" : null)],
        note: exclYNote,
      };
      if (gapIn.pct === null) why.push({ label: "Écart annuel (%)", reason: "budget saisi nul ou négatif : pourcentage non défini" });
    }
    retraiteTile =
      r.kind === "value"
        ? {
            id: "retraite",
            label: `Atterrissage retraité ${yearKey}`,
            term: T.retraite,
            sub: "Hors éléments non récurrents",
            value: money(r.retraite),
            cost: true,
            variations: [plainVariation("Non récurrents retirés", euros(r.total)), plainVariation("Déjà comptabilisés", euros(r.realised)), plainVariation("Prévus", euros(r.projected))],
          }
        : { id: "retraite", label: `Atterrissage retraité ${yearKey}`, term: T.retraite, sub: "Hors éléments non récurrents", value: nd(frDates(r.reason)), cost: true };

    // Tableau exact des deux cascades : composantes de l'atterrissage, éléments non récurrents retirés, atterrissage retraité.
    const attRows: CroiseeRow[] = [];
    if (land.kind === "value") {
      for (const x of parts) attRows.push({ cells: [x.label, x.value], style: "child" });
      attRows.push({ cells: [`Atterrissage ${yearKey}`, land.total], style: "subtotal" });
    } else attRows.push({ cells: [`Atterrissage ${yearKey}`, ndIn(frDates(land.reason))], style: "subtotal" });
    if (r.kind === "value") {
      attRows.push({ cells: ["Éléments non récurrents déjà comptabilisés", 0 - r.realised], style: "child" }); // 0 − x : jamais « −0 »
      attRows.push({ cells: ["Éléments non récurrents prévus (hypothèses)", 0 - r.projected], style: "child" });
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
    const wf = (id: string, title: string, w: WaterfallIn) => {
      if (w.kind !== "value") return;
      charts.push(cascadeChart(id, title, "eur", { label: w.startLabel, value: w.start }, w.steps, { label: w.endLabel, value: w.end }, BUDGET_TABLE_IDS.atterrissage));
      att.charts.push(id);
    };
    wf(BUDGET_CHART_IDS.atterrissage, `Atterrissage ${yearKey} : réel puis projection`, landingWaterfall(land));
    wf(BUDGET_CHART_IDS.retraite, `De l'atterrissage ${yearKey} à l'atterrissage retraité`, r.kind === "value" ? retraiteWaterfall(r) : { kind: "nd", reason: r.reason });
    if (r.kind === "value") {
      if (r.rows.length === 0) att.notes.push("Aucun élément non récurrent saisi ni prévu.");
      else {
        tables.push({
          id: BUDGET_TABLE_IDS.nonRecurrents,
          title: `Éléments non récurrents de ${yearKey}`,
          columns: [
            { key: "element", header: "Élément", kind: "text" },
            { key: "realise", header: "Déjà dans les comptes", kind: "eur" },
            { key: "prevu", header: "D'ici décembre (hypothèses)", kind: "eur" },
            { key: "total", header: "Total", kind: "eur" },
          ],
          rows: r.rows.map((x) => ({ cells: [x.label, x.realised, x.projected, x.realised + x.projected] })),
          foot: { cells: ["Total retiré de l'atterrissage", r.realised, r.projected, r.total] },
          terms: [T.retraite],
        });
        att.tables.push(BUDGET_TABLE_IDS.nonRecurrents);
      }
    }
    // Atterrissage face au budget saisi de l'année, sur les mois qui ont un montant de budget.
    if (budget.kind === "value") {
      const ndR = gapIn?.kind === "nd" ? frDates(gapIn.reason) : (v.gap.reason ?? `aucun montant de budget saisi « ${budget.name} » pour ${yearKey}`);
      const compared = withY.length === 12 ? `année ${yearKey}` : withY.length ? `${plural(withY.length, "mois", "mois")} avec budget` : "aucun mois";
      const gv = gapIn?.kind === "value" ? gapIn : null;
      tables.push({
        id: BUDGET_TABLE_IDS.annuel,
        title: `Atterrissage ${yearKey} face au budget saisi « ${budget.name} »`,
        columns: [
          { key: "ligne", header: "Lecture", kind: "text" },
          { key: "mois", header: "Mois comparés", kind: "text" },
          { key: "montant", header: "Montant", kind: "eur" },
          { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true, term: T.tendances },
        ],
        rows: [
          { cells: [`Atterrissage ${yearKey}`, compared, gv ? gv.a : ndIn(ndR), ""] },
          { cells: [`Budget saisi « ${budget.name} »`, compared, gv ? gv.b : budgetIn && budgetIn.total.kind === "value" ? budgetIn.total.cost : ndIn(budgetIn && budgetIn.total.kind === "nd" ? frDates(budgetIn.total.reason) : ndR), ""] },
        ],
        foot: { cells: ["Écart atterrissage − budget", compared, "", gv ? gv.delta : ndIn(ndR)] },
        notes: exclY.length && withY.length ? [`Sans montant de budget, exclus : ${monthsText(exclY)}.`] : [],
        terms: [T.atterrissage, T.budgetSaisi, T.ecartBudget],
      });
      att.tables.push(BUDGET_TABLE_IDS.annuel);
      att.trend = Boolean(gv);
    }
    att.links.push({ href: hrefs.atterrissage, label: "Atterrissage dans Hypothèses budgétaires" });
  }
  blocks.push(att);

  // --- 4. Écart lié aux personnes observées : partition des contrats de paie observés en N-1 et en N (nombres et montants seulement).
  const pers: CxBlock = { id: "personnes", title: "Écart lié aux personnes observées", term: T.personnes, charts: [], tables: [], nd: [], notes: [], links: [], trend: false };
  if (cohorts.kind === "nd") pers.nd.push({ label: "Personnes observées", reason: frDates(cohorts.reason) });
  else {
    const c = cohorts;
    const rows: CroiseeRow[] = [
      { cells: ["Observées seulement en N-1", c.onlyPrev.count, c.onlyPrev.prev, "", c.onlyPrev.delta] },
      { cells: ["Observées seulement en N", c.onlyCur.count, "", c.onlyCur.cur, c.onlyCur.delta] },
      { cells: ["Observées dans les deux périodes", c.both.count, c.both.prev, c.both.cur, c.both.delta] },
    ];
    if (c.outside) rows.push({ cells: ["Lignes du journal sans contrat", "", c.outside.prev ?? "", c.outside.cur ?? "", c.outside.delta] });
    tables.push({
      id: BUDGET_TABLE_IDS.personnes,
      title: `Écart de masse lié aux personnes observées, ${labels.period} face à ${labels.prev}`,
      columns: [
        { key: "groupe", header: "Personnes du périmètre", kind: "text" },
        { key: "nombre", header: "Nombre", kind: "nombre" },
        { key: "n1", header: `Coût N-1 (${labels.prev})`, kind: "eur", term: T.nMoinsUn },
        { key: "n", header: `Coût N (${labels.period})`, kind: "eur", term: T.masse },
        { key: "contribution", header: "Contribution à l'écart", kind: "eur", signed: true, costTrend: true, term: T.tendances },
      ],
      rows,
      foot: { cells: ["Total", c.total.count, c.total.prev, c.total.cur, c.total.delta] },
      notes: ["Personne observée : contrat de paie présent dans le journal de la période ; une personne qui change de contrat entre les deux périodes compte dans deux groupes."],
      terms: [T.personnes, T.masse, T.nMoinsUn],
    });
    pers.tables.push(BUDGET_TABLE_IDS.personnes);
    pers.trend = true;
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
  return { ...base, tiles, tables, charts, blocks, prevu, tileNd: reasonLines(why), trend, limits: input.filtered ? ["Budget saisi et scénario : globaux, non filtrables par service ; le réalisé et les personnes observées sont ceux du service choisi."] : [] };
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

  // Réalisé : journal de paie de la lecture appliquée, mois clos ; restreint au service choisi.
  const live: LiveReading = journal ? { kind: "value", series: liveSeries("reel", "Réalisé", filtered ? withService(journal, svc ?? null) : journal, pay.kpi.input) } : { kind: "nd", reason: why };

  // Budget saisi et scénario retenus dans les filtres : globaux (aucune ventilation par service).
  const b = ctx.budget.selected;
  const budget: BudgetReading = filtered
    ? { kind: "na", reason: `budget saisi global : ${NA}` }
    : b
      ? { kind: "value", name: b.name, series: budgetSeries(`budget-${b.id.slice(0, 8)}`, `Budget saisi « ${b.name} »`, String(year), b.amounts) }
      : { kind: "absent", reason: ctx.budget.reason ?? `aucun budget saisi pour ${year}` };
  let scenario: ScenarioReading;
  let scenarioId: string | null = null;
  if (filtered) scenario = { kind: "na", reason: `scénario global : ${NA}` };
  else {
    const s = await ctx.load.scenario();
    if (s.kind === "nd") scenario = { kind: "nd", reason: s.reason };
    else {
      const sc = s.full.scenario;
      scenarioId = sc.id;
      scenario = {
        kind: "value",
        name: sc.name,
        refMonth: s.full.base.refMonth,
        series: scenarioSeries(sc.id, `Scénario « ${sc.name} »`, s.full.base, s.proj),
        landing: landing(s.full.base, s.proj, String(year)),
        retraite: retraite(s.full.base, s.proj, s.full.hypotheses, String(year)),
      };
    }
  }

  // Personnes observées : détail par contrat du journal (zoomOf, masse chargée) sur la période et sur N-1, puis partition.
  let cohorts: CohortReading;
  if (!journal) cohorts = { kind: "nd", reason: why };
  else {
    const filter: ServiceFilter = filtered ? { value: svc ?? null } : null;
    const cur = zoomOf({ kind: "reel", journal, filter }, months, "masse");
    const prev = zoomOf({ kind: "reel", journal, filter }, ctx.prevMonths, "masse");
    cohorts = prev.kind === "nd" ? { kind: "nd", reason: `N-1 : ${zoomReason(prev.reason)}` } : cur.kind === "nd" ? { kind: "nd", reason: zoomReason(cur.reason) } : partitionCohorts(prev.byKey, cur.byKey, HORS_SALARIE);
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
      atterrissage: withScenario("vue=resultat&sous=atterrissage"),
      postes: withScenario("vue=postes"),
      embauches: withScenario("vue=embauches"),
    },
    live,
    budget,
    scenario,
    cohorts,
  };
}

// =================================================================================================================================
// Chapitre 08 · Effets d'évolution
// =================================================================================================================================

export type EffetsHrefs = { analyse: string; embauches: string; globales: string; fixeVariable: string };
export type EffetsInput =
  | { kind: "nd"; reason: string; action: Action }
  | {
      kind: "value";
      year: number;
      labels: { period: string; prev: string };
      pont: Bridge; // pont volume / coût moyen de N-1 à N (bridge, comme l'Analyse des écarts)
      cascade: Cascade; // cascade d'ETP de N-1 à N (etpCascade)
      etp: { cur: Agg; prev: Agg }; // ETP moyens (moyenne des ETP de fin de mois)
      hrefs: EffetsHrefs;
    };
export type EffetsModel = BlocksModel;

const etpText = (a: Agg): TileValue => (a.kind === "value" ? { text: `${fmtFixed({ num: a.num, den: a.den })} ETP`, kind: "value", reason: null } : a.kind === "nd" ? nd(frDates(a.reason)) : nd("sans objet"));

export function buildEffets(input: EffetsInput): EffetsModel {
  const base: EffetsModel = { chapter: "effets", tiles: [], alerts: [], tables: [], charts: [], limits: [], nd: null, terms: Object.values(E), blocks: [], prevu: [], tileNd: [], trend: false };
  if (input.kind === "nd") return { ...base, nd: { reason: capital(input.reason), action: input.action } };
  const { labels, pont, cascade, etp, hrefs } = input;
  const startLabel = `N-1 (${labels.prev})`;
  const endLabel = `N (${labels.period})`;
  const tables: CroiseeTable[] = [];
  const charts: CroiseeChart[] = [];
  const why: Why[] = [];

  // --- 1. Décomposition de l'écart de masse : effet volume (ETP-mois) et effet coût moyen (bridge, pontWaterfall).
  const dec: CxBlock = { id: "decomposition", title: "Décomposer la variation du coût", term: E.pont, charts: [], tables: [], nd: [], notes: [], links: [{ href: hrefs.analyse, label: "Analyse des écarts" }], trend: false };
  let ecartTile: TileSpec;
  let volumeTile: TileSpec;
  let coutTile: TileSpec;
  if (pont.kind === "nd") {
    const r = frDates(pont.reason);
    ecartTile = { id: "ecart", label: "Écart de coût observé", term: E.masse, value: nd(r), cost: true };
    volumeTile = { id: "volume", label: "Effet volume", term: E.pont, value: nd(r), cost: true };
    coutTile = { id: "cout-moyen", label: "Effet coût moyen", term: E.pont, value: nd(r), cost: true };
    dec.nd.push({ label: "Pont volume / coût moyen", reason: r });
  } else {
    ecartTile = { id: "ecart", label: "Écart de coût observé", term: E.masse, sub: "Masse salariale chargée, N − N-1", value: signedMoney(pont.delta), valueTone: costTone(pont.delta), cost: true, variations: [plainVariation("N", euros(pont.a.cost)), plainVariation("N-1", euros(pont.b.cost))] };
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
    variations: [tileLine("N-1", prev), plainVariation("Écart", dText, d.kind === "nd" ? frDates(d.reason) : d.kind === "na" ? "sans objet" : null)],
  };
  if (cur.kind !== "nd") why.push({ label: "ETP moyen N-1", reason: prev.kind === "nd" ? prev.reason : null });

  // --- 2. Cascade d'ETP (etpCascade, comme l'Analyse des écarts) : entrées, sorties, effets de présence, changements de quotité.
  const etpBlock: CxBlock = { id: "etp", title: "Cascade d'ETP", term: E.cascade, charts: [], tables: [], nd: [], notes: [], links: [], trend: false };
  if (cascade.kind === "nd") etpBlock.nd.push({ label: "Cascade d'ETP", reason: frDates(cascade.reason) });
  else {
    const w = etpWaterfall(cascade);
    if (w.kind === "value") {
      charts.push(cascadeChart(EFFETS_CHART_IDS.etp, "ETP moyen, de N-1 à N : entrées, sorties et changements de quotité", "etp", { label: startLabel, value: w.start }, w.steps, { label: endLabel, value: w.end }, EFFETS_TABLE_IDS.etp));
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
        { cells: [`ETP moyen ${startLabel}`, cascade.start, ""], style: "subtotal" },
        ...cascade.steps.map((s): CroiseeRow => ({ cells: [STEP_LABELS[s.id], "", s.etp4], style: "child" })),
        { cells: ["Résiduel d'arrondi", "", cascade.residual], style: "child" },
        { cells: ["Écart total", "", cascade.end - cascade.start], style: "subtotal" },
      ],
      foot: { cells: [`ETP moyen ${endLabel}`, cascade.end, ""] },
      terms: [E.cascade, E.residuel, E.etpMoyen],
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

  const tiles = [ecartTile, volumeTile, coutTile, etpTile];
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
  };
  if (!journal) {
    const r = journalReason(pay) ?? "journal de paie indisponible";
    return { kind: "value", year, labels: ctx.labels, pont: { kind: "nd", reason: r }, cascade: { kind: "nd", reason: r }, etp: { cur: { kind: "nd", reason: r }, prev: { kind: "nd", reason: r } }, hrefs };
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
  return {
    kind: "value",
    year,
    labels: ctx.labels,
    pont: bridge(alignedSeries(b, monthsB, monthsA), alignedSeries(a, monthsA, monthsA), monthsA),
    cascade: etpCascade(a, b, monthsA, monthsB),
    etp: { cur: aggregate(b, monthsB, "etp"), prev: aggregate(a, monthsA, "etp") },
    hrefs,
  };
}
