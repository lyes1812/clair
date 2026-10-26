import type { ChartSeries } from "@/components/charts/shared";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { journalReason } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { landing } from "@/lib/budget/engine";
import { budgetSeries, gap, liveSeries, scenarioSeries, total, type Gap, type Point, type Series } from "@/lib/budget/series";
import { selectAlerts, type AlertesInput, type AlertMention, type MissingSource } from "@/lib/croisee/alertes";
import { croiseeSettingsHref, type CroiseeSetting, type SeuilEffectif } from "@/lib/croisee-settings";
import { monthEnd } from "@/lib/dates";
import { dsnBrutWindow } from "@/lib/payroll/dsn";
import { costPerEtp, evolution, monthPayroll, windowPayroll, withService, type JournalInput } from "@/lib/payroll/engine";
import { reconcile } from "@/lib/payroll/lot2";
import { headcountAt } from "@/lib/rh/headcount";
import { absenteeism, absenteeismMonth } from "@/lib/rh/kpi/absence";
import { etpAverage, headcountAverage } from "@/lib/rh/kpi/average";
import { compareWindows, delta as kpiDelta, type Valued } from "@/lib/rh/kpi/compare";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { ETP_PRORATED_LABEL, etpProratedMonth, etpProratedQualifier } from "@/lib/rh/kpi/etp-prorata";
import { fmtFixed, fmtHalfDays, fmtPercent } from "@/lib/rh/kpi/format";
import { countedOpts, rollingWindow } from "@/lib/rh/kpi/period";
import { turnover } from "@/lib/rh/kpi/turnover";
import type { Delta, DeltaUnit, Kind, KpiInput, Ratio, Window } from "@/lib/rh/kpi/types";
import { KPI_KEYS } from "@/lib/rh-kpi-settings";
import { costTone } from "@/lib/trend";
import {
  costVariation,
  plainVariation,
  sparkValues,
  yearMonths,
  type ChapterModel,
  type CroiseeCell,
  type CroiseeChart,
  type CroiseeRow,
  type CroiseeTable,
  type TileSpec,
  type TileVariation,
} from "@/lib/viz/croisee";
import { etpProratedNotes, motifsRetenusLine, type EtpIn, type HeadcountIn, type RatioIn } from "@/lib/viz/kpi";
import { brutParts, capital, COLORS, euros, eurosSigned, hasData, monthLongLabel, monthShortLabel, monthShortYear, ndGroups, ndLines, reasonLines, type MonthIn } from "@/lib/viz/masse";
import { averageTile, deltaView, eurosOfFraction, evolutionView, kpiRefusal, landingView, nd, rateTile, windowOf, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitre 01 · Synthèse. Deux fonctions :
// - loadSyntheseInput(ctx) lit les sources par les lecteurs du contexte et appelle les fonctions existantes (moteur des KPI RH,
//   moteur de masse salariale, séries et atterrissage du module budgétaire) : aucun nouveau moteur ;
// - buildSynthese(input), pure, met ces résultats en forme : six cartes, points à surveiller, graphique principal et son tableau
//   exact, composition du coût, chiffres clés en tableau. L'écran et les exports partent de ce même modèle.
// Seul calcul nouveau de ce fichier : la moyenne, sur la période, de l'ETP contractuel proratisé (etpProratedAverage, testée).
// Montants en centimes, ETP en dix-millièmes ou fractions exactes, taux en fractions ; un n.d. reste n.d. avec sa raison.

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
  alertes: "croisee-alertes",
  fixeVariable: "fixe-variable",
  brut: "brut",
  cotisations: "cotisations",
  nMoinsUn: "previous-period",
  tendances: "lecture-tendances",
  projection: "projection",
  commentaire: "croisee-commentaire",
} as const;
const T = SYNTHESE_CX_TERMS;

export const SYNTHESE_TABLE_IDS = { mensuel: "synthese-mensuel", composition: "synthese-composition", montants: "synthese-montants", rh: "synthese-rh" } as const;

// --- Entrées minimales (les types des moteurs y sont assignables) --------------------------------------------------------------

type NdIn = { nd: { reason: string } };
export type ComparedIn<T = RatioIn> = { current: T; previous: T; delta: Delta };
export type TurnoverIn = { kind: "exact"; ratio: Ratio; entries: number | null; exits: number } | ({ kind: "nd" } & NdIn);
export type EtpProratedMonthIn = { month: string; kind: "exact" | "lower_bound"; ratio: Ratio; qualifiers: string[] } | ({ month: string; kind: "nd" } & NdIn);
export type WindowIn =
  | { kind: "value"; brut: number; cotisations: number; masse: number; byRubric: { salaires: number; primes: number; stages: number; indemnites: number }; openMonths: string[] }
  | ({ kind: "nd" } & NdIn);
export type EvolutionIn = { kind: "value"; deltaCents: number; ratio: Ratio | null } | ({ kind: "nd" } & NdIn);
export type CostIn = { kind: "value"; costCents: Ratio; etpMonths4: number } | ({ kind: "nd" } & NdIn);
export type LandingIn = { kind: "value"; total: number; actualMonths: string[]; priorMonths: string[]; projectedMonths: string[] } | { kind: "nd"; reason: string };
type Action = { href: string; label: string };

export type SyntheseRh =
  | {
      kind: "value";
      etpAverage: ComparedIn;
      prorated: EtpProratedMonthIn[]; // un par mois de la période
      proratedQualifier: string; // qualifieur obligatoire du moteur (etpProratedQualifier)
      absenteeism: ComparedIn;
      absenceTypes: string[]; // motifs retenus (Paramètres › Définitions des KPI)
      turnover: ComparedIn<TurnoverIn>; // douze mois glissants qui finissent avec la période
      headcountAverage: RatioIn; // effectif moyen de la période (seuils d'effectif)
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
      cost: CostIn;
      costPrev: CostIn;
      rolling: MonthIn[]; // douze mois glissants (mini-courbe)
      year: MonthIn[]; // les douze mois de l'année N
      yearPrev: MonthIn[]; // les douze mois de N-1
      unclassified: string[]; // comptes 63 / 64 sans rubrique sur la période
      checks: { compta: number | null; dsn: number | null };
    }
  | { kind: "nd"; reason: string; action: Action };
export type SyntheseBudget = { kind: "value"; name: string; series: Series } | { kind: "absent" | "na"; reason: string };
export type SyntheseLive = { kind: "value"; series: Series } | { kind: "nd"; reason: string };
export type SyntheseLanding = { kind: "value"; scenarioName: string; refMonth: string; landing: LandingIn; series: Series } | { kind: "nd" | "na"; reason: string };
export type SyntheseHrefs = { donnees: string; parametres: string; grille: string; budget: string; services: string; budgetChapter: string; paieCompta: string; tableau: string };

export type SyntheseInput =
  | { kind: "nd"; reason: string; action: Action }
  | {
      kind: "value";
      year: number;
      months: string[];
      prevMonths: string[];
      labels: { period: string; prev: string };
      openMonths: string[];
      hrefs: SyntheseHrefs;
      rh: SyntheseRh;
      pay: SynthesePay;
      budget: SyntheseBudget;
      live: SyntheseLive;
      landing: SyntheseLanding;
      seuils: CroiseeSetting<SeuilEffectif[]>;
      marge: CroiseeSetting<number>;
    };

// Modèle du chapitre : le modèle commun, plus ce que seul l'écran de la Synthèse montre.
export type SyntheseModel = ChapterModel & {
  tileNd: string[]; // raisons des n.d. des lignes de cartes (N-1, écarts, notes), écrites une fois sous les cartes
  mentions: AlertMention[]; // réglages absents (seuils d'effectif, marge) : mention et lien vers Paramètres, jamais une alerte
  links: { href: string; label: string }[];
  tableHref: string; // affichage « Tableaux », ancré sur le graphique principal
  trend: boolean; // une carte porte une tendance de coût colorée : la légende rouge / vert est écrite
};

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
const pct = (r: Ratio) => `${r.num > 0 ? "+" : ""}${fmtPercent(r)}`;

// Raisons des lignes de cartes : celle d'un écart n'est retenue que si la valeur et N-1 sont connues (sinon elle les répète).
type Why = { label: string; reason: string | null | undefined };
const lineReasons = (label: string, cur: TileValue, prev: TileValue, d: { text: string | null; reason: string | null }): Why[] => [
  { label: `${label} N-1`, reason: prev.kind === "nd" ? prev.reason : null },
  { label: `${label}, écart`, reason: cur.kind !== "nd" && prev.kind !== "nd" && d.text === null ? d.reason : null },
];

// Statut d'un mois de l'année pour le graphique principal : réel (journal), réel provisoire, projection du scénario, ou n.d.
type YearPoint = { month: string; nature: string; value: number | null; reason: string | null };

export function buildSynthese(input: SyntheseInput): SyntheseModel {
  const empty: SyntheseModel = { chapter: CHAPTER, tiles: [], alerts: [], tables: [], charts: [], limits: [], nd: null, terms: Object.values(T), tileNd: [], mentions: [], links: [], tableHref: "", trend: false };
  if (input.kind === "nd") return { ...empty, nd: { reason: capital(input.reason), action: input.action } };
  const { year, months, labels, rh, pay, budget, live, hrefs } = input;
  const lastMonth = months[months.length - 1];
  const why: Why[] = [];

  // --- 1. ETP moyen (et ETP contractuel proratisé — quotité actuelle, moyenne des mois)
  let etpTile: TileSpec;
  let prorated: ProratedAverage | null = null;
  if (rh.kind === "value") {
    const cur = averageTile(rh.etpAverage.current);
    const prev = averageTile(rh.etpAverage.previous);
    const d = deltaView(rh.etpAverage.delta);
    prorated = etpProratedAverage(rh.prorated);
    const prText = prorated.kind === "nd" ? null : `${prorated.kind === "lower_bound" ? "≥ " : ""}${fmtFixed(prorated.ratio)}`;
    const qualifiers = rh.prorated.flatMap((m) => (m.kind === "nd" ? [] : m.qualifiers));
    etpTile = {
      id: "etp",
      label: "ETP moyen",
      term: T.etpMoyen,
      sub: labels.period,
      value: cur,
      variations: [tileLine("N-1", prev), plainVariation("Écart", d.text, d.reason), plainVariation(ETP_PRORATED_LABEL, prText, prorated.kind === "nd" ? prorated.reason : null)],
      note: etpProratedNotes(qualifiers.length ? qualifiers : [rh.proratedQualifier]).join(" ; "),
      spark: { label: "ETP contractuel de fin de mois, douze mois glissants", values: rh.sparks.etp.map((e) => (e.kind === "exact" ? e.etp4 : null)) },
    };
    why.push(...lineReasons("ETP moyen", cur, prev, d), { label: ETP_PRORATED_LABEL, reason: prorated.kind === "nd" ? prorated.reason : null });
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
  if (budget.kind !== "value") {
    budgetTile = { ...budgetBase, sub: labels.period, value: nd(budget.reason) };
    alertBudget = budget.kind === "absent" ? { kind: "absent", reason: budget.reason } : { kind: "na" };
  } else {
    const withBudget = months.filter((m) => pointOf(budget.series, m).kind === "value");
    const excluded = months.filter((m) => !withBudget.includes(m));
    const monthly = months.map((m) => {
      const b = pointOf(budget.series, m);
      const r = live.kind === "value" ? pointOf(live.series, m) : null;
      return { month: m, real: r?.kind === "value" ? r.cost : null, budget: b.kind === "value" ? b.cost : null };
    });
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

  // --- 4. Atterrissage annuel : réel des mois clos + projection du scénario retenu, face au budget saisi de l'année
  const yearKey = String(year);
  const ym = yearMonths(year);
  let landingTile: TileSpec;
  let alertLanding: AlertesInput["landing"] = input.landing.kind === "nd" ? { kind: "nd", reason: input.landing.reason } : { kind: "na" };
  let budgetYear: { total: number; months: string[]; excluded: string[] } | null = null;
  if (input.landing.kind === "value") {
    const L = input.landing;
    const land = L.landing;
    let budgetIn: Parameters<typeof landingView>[1] = null;
    let gapIn: Gap | null = null;
    let excluded: string[] = [];
    let compared = 0;
    if (budget.kind === "value") {
      const withBudget = ym.filter((m) => pointOf(budget.series, m).kind === "value");
      excluded = ym.filter((m) => !withBudget.includes(m));
      compared = withBudget.length;
      if (withBudget.length === 0) budgetIn = { total: { kind: "nd", reason: `aucun montant de budget saisi « ${budget.name} » pour ${yearKey}` } };
      else {
        const t = total(budget.series, withBudget);
        budgetIn = { total: t };
        if (t.kind === "value") budgetYear = { total: t.cost, months: withBudget, excluded };
        // L'écart n'a de sens que pour un atterrissage complet : comparé sur les mêmes mois que le budget.
        if (land.kind === "value") gapIn = gap(L.series, budget.series, withBudget);
      }
    }
    const v = landingView(land, budgetIn, gapIn, yearKey);
    const gapLabel = excluded.length && compared > 0 ? `Écart (${plural(compared, "mois", "mois")} avec budget)` : "Écart";
    const parts = land.kind === "value" ? [`réel : ${plural(land.actualMonths.length, "mois", "mois")}`, ...(land.priorMonths.length ? [`projection du scénario parent : ${plural(land.priorMonths.length, "mois", "mois")}`] : []), `projection : ${plural(land.projectedMonths.length, "mois", "mois")}`] : [];
    landingTile = {
      id: "atterrissage",
      label: `Atterrissage ${yearKey}`,
      term: T.atterrissage,
      sub: `Scénario « ${L.scenarioName} »`,
      value: v.value,
      cost: true,
      variations: [tileLine(budget.kind === "value" ? `Budget saisi « ${budget.name} »` : "Budget saisi", v.budget), costVariation(gapLabel, gapIn?.kind === "value" ? gapIn.delta : null, v.gap.text, v.gap.reason)],
      note: [parts.join(" · "), excluded.length && compared > 0 ? `sans montant de budget, exclus : ${monthsText(excluded)}` : ""].filter(Boolean).join(" ; ") || undefined,
      spark: { label: "Réel puis projection, par mois", values: ym.map((m) => {
        const p = pointOf(L.series, m);
        return p.kind === "value" ? p.cost : null;
      }) },
    };
    if (v.value.kind !== "nd") why.push({ label: "Budget saisi de l'année", reason: v.budget.kind === "nd" ? v.budget.reason : null }, { label: "Atterrissage, écart", reason: v.budget.kind !== "nd" && v.gap.text === null ? v.gap.reason : null });
    alertLanding = land.kind === "nd"
      ? { kind: "nd", reason: land.reason }
      : { kind: "value", total: land.total, gap: gapIn === null ? null : gapIn.kind === "nd" ? gapIn : { kind: "value", budget: gapIn.b, delta: gapIn.delta, months: compared, excluded } };
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
        ...(a.current.kind === "nd" ? [] : [plainVariation("Absence", `${fmtHalfDays(a.current.ratio.num)} sur ${fmtHalfDays(a.current.ratio.den)} théoriques`)]),
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
    toTile = {
      id: "turnover",
      label: "Turnover",
      term: T.turnover,
      sub: capital(rolling12),
      value: tc,
      variations: [tileLine("N-1", tp), plainVariation("Écart", td.text, td.reason), ...moves],
      spark: { label: "Effectif de fin de mois, douze mois glissants", values: rh.sparks.headcount.map((h) => (h.kind === "exact" ? h.persons : null)) },
    };
    why.push(...lineReasons("Turnover", tc, tp, td));
    if (t.current.kind !== "nd" && t.current.entries === null) why.push({ label: "Entrées", reason: "entrées non exactes sur la période" });
  } else {
    absTile = { id: "absenteisme", label: "Absentéisme", term: T.absenteisme, sub: labels.period, value: nd(rh.reason) };
    toTile = { id: "turnover", label: "Turnover", term: T.turnover, sub: capital(rolling12), value: nd(rh.reason) };
  }
  const tiles = [etpTile, masseTile, budgetTile, landingTile, absTile, toTile];

  // --- Graphique principal : les douze mois de N (réel, puis projection du scénario), budget saisi, N-1 ; et son tableau exact
  const L = input.landing.kind === "value" ? input.landing : null;
  const yearPoints: YearPoint[] = ym.map((m, i) => {
    const r = pay.kind === "value" ? pay.year[i] : null;
    if (r && r.kind === "value") return { month: m, nature: r.open ? "Réel provisoire" : "Réel", value: r.masse, reason: null };
    const reasons = [r && r.kind === "nd" ? r.nd.reason : pay.kind === "nd" ? pay.reason : null];
    if (L && m > L.refMonth) {
      const p = pointOf(L.series, m);
      if (p.kind === "value" && (p.layer === "projete" || p.layer === "projete-parent")) return { month: m, nature: "Projection", value: p.cost, reason: null };
      reasons.push(`projection : ${p.kind === "nd" ? p.reason : "mois non projeté"}`);
    }
    return { month: m, nature: "n.d.", value: null, reason: reasons.filter(Boolean).join(" ; ") || "valeur absente" };
  });
  const budgetCell = (m: string): { value: number | null; reason: string | null } => {
    if (budget.kind !== "value") return { value: null, reason: budget.reason };
    const p = pointOf(budget.series, m);
    return p.kind === "value" ? { value: p.cost, reason: null } : { value: null, reason: p.reason };
  };
  const prevYear = year - 1;
  const n1 = (i: number): { value: number | null; reason: string | null } => {
    if (pay.kind === "nd") return { value: null, reason: pay.reason };
    const r = pay.yearPrev[i];
    return r && r.kind === "value" ? { value: r.masse, reason: null } : { value: null, reason: r?.kind === "nd" ? r.nd.reason : "mois non lu" };
  };
  const projected = yearPoints.filter((p) => p.nature === "Projection").map((p) => p.month);
  const budgetName = budget.kind === "value" ? `Budget saisi « ${budget.name} »` : "Budget saisi";
  const mainSeries: ChartSeries[] = [
    { key: "reel", name: projected.length ? `Réel ${year}, puis projection` : `Réel ${year}`, values: yearPoints.map((p) => p.value), reasons: yearPoints.map((p) => p.reason), color: COLORS.now },
    { key: "budget", name: budgetName, values: ym.map((m) => budgetCell(m).value), reasons: ym.map((m) => budgetCell(m).reason), color: "var(--chart-2)" },
    { key: "n1", name: `${prevYear} (N-1)`, values: ym.map((_, i) => n1(i).value), reasons: ym.map((_, i) => n1(i).reason), color: COLORS.before },
  ];
  const mensuel: CroiseeTable = {
    id: SYNTHESE_TABLE_IDS.mensuel,
    title: `Masse salariale chargée par mois, ${year} : réel ou projection, budget saisi et N-1`,
    columns: [
      { key: "mois", header: "Mois", kind: "text" },
      { key: "nature", header: "Nature", kind: "text" },
      { key: "reel", header: projected.length ? "Réel ou projection" : "Réel", kind: "eur", term: T.masse },
      { key: "budget", header: budgetName, kind: "eur", term: T.budgetSaisi },
      { key: "n1", header: `${prevYear} (N-1)`, kind: "eur", term: T.nMoinsUn },
    ],
    rows: yearPoints.map((p, i): CroiseeRow => {
      const b = budgetCell(p.month);
      const q = n1(i);
      return { cells: [capital(monthLongLabel(p.month)), p.nature === "n.d." ? "" : p.nature, p.value === null ? { nd: p.reason ?? "valeur absente" } : p.value, b.value === null ? { nd: b.reason ?? "montant du budget non saisi" } : b.value, q.value === null ? { nd: q.reason ?? "valeur absente" } : q.value] };
    }),
    notes: projected.length && L ? [`Projection : ${monthsSpan(projected, ym)}, scénario « ${L.scenarioName} ».`] : [],
    terms: [T.masse, T.budgetSaisi, T.projection, T.nMoinsUn],
  };
  const mainChart: CroiseeChart = {
    id: SYNTHESE_TABLE_IDS.mensuel,
    title: `Masse salariale chargée par mois, ${year} : réel, budget et N-1`,
    kind: "barres",
    unit: "eur",
    categories: ym.map(monthShortLabel),
    categoryTitles: yearPoints.map((p) => `${monthLongLabel(p.month)} · ${p.nature === "Projection" && L ? `projection (scénario « ${L.scenarioName} »)` : p.nature.toLowerCase()}`),
    series: mainSeries,
    mode: "grouped",
    tableId: SYNTHESE_TABLE_IDS.mensuel,
  };

  // --- Composition de la masse chargée de la période : fixe, variable, gratifications de stage (brutParts) et cotisations
  const compRows = (w: WindowIn) => (w.kind === "value" ? { fixe: w.byRubric.salaires, variable: w.byRubric.primes + w.byRubric.indemnites, stages: w.byRubric.stages } : null);
  const curW: WindowIn = pay.kind === "value" ? pay.cur : { kind: "nd", nd: { reason: pay.reason } };
  const prevW: WindowIn = pay.kind === "value" ? pay.prev : { kind: "nd", nd: { reason: pay.reason } };
  const cs = compRows(curW);
  const ps = compRows(prevW);
  const ndOf = (w: WindowIn) => (w.kind === "nd" ? w.nd.reason : "valeur absente");
  const compLine = (label: string, a: number | null, b: number | null, style?: CroiseeRow["style"]): CroiseeRow => ({
    cells: [label, a === null ? { nd: ndOf(curW) } : a, b === null ? { nd: ndOf(prevW) } : b, a === null || b === null ? { nd: a === null ? ndOf(curW) : ndOf(prevW) } : a - b],
    style,
  });
  const v = (w: WindowIn, pick: (x: Extract<WindowIn, { kind: "value" }>) => number) => (w.kind === "value" ? pick(w) : null);
  const composition: CroiseeTable = {
    id: SYNTHESE_TABLE_IDS.composition,
    title: `Composition de la masse chargée, ${labels.period}`,
    columns: [
      { key: "composante", header: "Composante", kind: "text" },
      { key: "n", header: labels.period, kind: "eur" },
      { key: "n1", header: `N-1 (${labels.prev})`, kind: "eur" },
      { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true, term: T.tendances },
    ],
    rows: [
      compLine("Fixe (salaires et congés payés)", cs?.fixe ?? null, ps?.fixe ?? null, "child"),
      compLine("Variable (primes et indemnités)", cs?.variable ?? null, ps?.variable ?? null, "child"),
      compLine("Gratifications de stage", cs?.stages ?? null, ps?.stages ?? null, "child"),
      compLine("Brut", v(curW, (x) => x.brut), v(prevW, (x) => x.brut), "subtotal"),
      compLine("Cotisations patronales", v(curW, (x) => x.cotisations), v(prevW, (x) => x.cotisations)),
    ],
    foot: compLine("Masse salariale chargée", v(curW, (x) => x.masse), v(prevW, (x) => x.masse)),
    terms: [T.fixeVariable, T.brut, T.cotisations, T.masse],
  };
  const parts = cs ? brutParts(cs) : [];
  const compChart: CroiseeChart = {
    id: SYNTHESE_TABLE_IDS.composition,
    title: `Composition de la masse chargée, ${labels.period}`,
    kind: "anneau",
    unit: "eur",
    categories: [labels.period],
    series: [
      ...(parts.length ? parts.map((p) => ({ key: p.key, name: p.name, values: [p.value], reasons: [p.reason ?? null], color: p.color })) : [{ key: "brut", name: "Brut", values: [null], reasons: [ndOf(curW)], color: COLORS.brut }]),
      { key: "cotisations", name: "Cotisations patronales", values: [v(curW, (x) => x.cotisations)], reasons: [curW.kind === "nd" ? curW.nd.reason : null], color: COLORS.charges },
    ],
    tableId: SYNTHESE_TABLE_IDS.composition,
  };

  // --- Chiffres clés en tableau (exports) : montants d'une part, effectifs et taux d'autre part (unités jamais mêlées)
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
    const l = alertLanding;
    const reason = landingTile.value.kind === "nd" ? (landingTile.value.reason ?? "valeur absente") : "valeur absente";
    const lg = l.kind === "value" ? l.gap : null;
    const bReason = landingTile.variations?.[0]?.reason ?? reason;
    montantsRows.push({
      cells: [
        `Atterrissage ${yearKey}`,
        input.landing.kind === "value" ? `Scénario « ${input.landing.scenarioName} »` : `Année ${yearKey}`,
        l.kind === "value" ? l.total : { nd: reason },
        budget.kind === "value" ? `Budget saisi « ${budget.name} »${budgetYear && budgetYear.excluded.length ? ` (${plural(budgetYear.months.length, "mois", "mois")})` : ""}` : "Budget saisi",
        budgetYear ? budgetYear.total : { nd: l.kind === "value" ? bReason : reason },
        lg?.kind === "value" ? lg.delta : { nd: lg?.kind === "nd" ? lg.reason : l.kind === "value" ? bReason : reason },
      ],
    });
  }
  const montants: CroiseeTable = {
    id: SYNTHESE_TABLE_IDS.montants,
    title: `Chiffres clés de la période : montants, ${labels.period}`,
    columns: [
      { key: "indicateur", header: "Indicateur", kind: "text" },
      { key: "mesure", header: "Mesure", kind: "text" },
      { key: "valeur", header: "Valeur", kind: "eur" },
      { key: "comparaison", header: "Comparé à", kind: "text" },
      { key: "reference", header: "Référence", kind: "eur" },
      { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true, term: T.tendances },
    ],
    rows: montantsRows,
    terms: [T.masse, T.coutEtp, T.ecartBudget, T.atterrissage, T.evolution],
  };
  const rhRows: CroiseeRow[] = [];
  if (rh.kind === "value") {
    const pr = prorated ?? etpProratedAverage(rh.prorated);
    const t = rh.turnover;
    const turnoverCell = (x: TurnoverIn): CroiseeCell => (x.kind === "nd" ? { nd: x.nd.reason } : { exact: x.ratio.num / x.ratio.den });
    rhRows.push(
      { cells: ["ETP moyen", labels.period, exactCell(rh.etpAverage.current, (x) => fmtFixed(x)), exactCell(rh.etpAverage.previous, (x) => fmtFixed(x)), deltaCell(rh.etpAverage.delta)], kind: "etp" },
      { cells: [ETP_PRORATED_LABEL, `moyenne des mois, ${labels.period}`, pr.kind === "nd" ? { nd: pr.reason } : pr.kind === "lower_bound" ? `≥ ${fmtFixed(pr.ratio)}` : { exact: pr.ratio.num / pr.ratio.den }, "", ""], kind: "etp" },
      { cells: ["Absentéisme", labels.period, exactCell(rh.absenteeism.current, fmtPercent), exactCell(rh.absenteeism.previous, fmtPercent), deltaCell(rh.absenteeism.delta)], kind: "pourcent" },
      { cells: ["Turnover", capital(rolling12), turnoverCell(t.current), turnoverCell(t.previous), deltaCell(t.delta)], kind: "pourcent" },
    );
  } else {
    const r = { nd: rh.reason };
    for (const [label, mesure, kind] of [["ETP moyen", labels.period, "etp"], [ETP_PRORATED_LABEL, `moyenne des mois, ${labels.period}`, "etp"], ["Absentéisme", labels.period, "pourcent"], ["Turnover", capital(rolling12), "pourcent"]] as const) rhRows.push({ cells: [label, mesure, r, r, r], kind });
  }
  const rhTable: CroiseeTable = {
    id: SYNTHESE_TABLE_IDS.rh,
    title: `Chiffres clés de la période : ETP et taux, ${labels.period}`,
    columns: [
      { key: "indicateur", header: "Indicateur", kind: "text" },
      { key: "mesure", header: "Mesure", kind: "text" },
      { key: "valeur", header: "Valeur", kind: "etp" },
      { key: "n1", header: "N-1", kind: "etp", term: T.nMoinsUn },
      { key: "ecart", header: "Écart", kind: "etp", signed: true, points: true },
    ],
    rows: rhRows,
    notes: ["ETP en équivalents temps plein ; taux en pourcentage, écarts de taux en points."],
    terms: [T.etpMoyen, T.etpProratise, T.absenteisme, T.turnover, T.nMoinsUn],
  };

  // --- Points à surveiller (fonction pure, mêmes chiffres que les cartes)
  const missing: MissingSource[] = [];
  if (pay.kind === "nd") missing.push({ id: "journal", label: "Journal de paie non lu", reason: pay.reason, href: pay.action.href, linkLabel: pay.action.label });
  if (rh.kind === "nd") missing.push({ id: "rh", label: "Indicateurs RH non calculés", reason: rh.reason, href: rh.action.href, linkLabel: rh.action.label });
  const ndTiles = [
    ...(rh.kind === "value" ? [etpTile, absTile, toTile] : []),
    ...(pay.kind === "value" ? [masseTile] : []),
  ].filter((t) => t.value.kind === "nd");
  if (ndTiles.length) missing.push({ id: "indicateurs", label: "Indicateurs n.d.", reason: `${ndTiles.map((t) => t.label).join(", ")} : raison sur la carte` });
  const { alerts, mentions } = selectAlerts({
    year,
    budget: alertBudget,
    landing: alertLanding,
    openMonths: input.openMonths,
    unclassified: pay.kind === "value" ? pay.unclassified : [],
    missing,
    headcount: rh.kind !== "value" ? { kind: "skip" } : rh.headcountAverage.kind === "nd" ? { kind: "nd", reason: rh.headcountAverage.nd.reason } : rh.headcountAverage.kind === "lower_bound" ? { kind: "nd", reason: "effectif moyen en borne basse : comparaison aux seuils non faite" } : { kind: "value", average: rh.headcountAverage.ratio },
    seuils: input.seuils,
    marge: input.marge,
    checks: pay.kind === "value" ? pay.checks : { compta: null, dsn: null },
    hrefs: { parametres: hrefs.parametres, grille: hrefs.grille, budget: hrefs.budget, paieCompta: hrefs.paieCompta },
  });

  const trend = tiles.some((t) => t.cost && ((t.valueTone && t.valueTone !== "flat") || (t.variations ?? []).some((x) => x.tone !== "flat" && x.text !== null)));
  return {
    chapter: CHAPTER,
    tiles,
    alerts,
    tables: [mensuel, composition, montants, rhTable],
    charts: [mainChart, compChart],
    limits: ["ETP payé non calculé : aucune règle de conversion paramétrée."],
    nd: null,
    terms: Object.values(T),
    tileNd: reasonLines(why),
    mentions,
    links: [
      { href: hrefs.services, label: "Coût et écart par service (05 · Services)" },
      { href: hrefs.budgetChapter, label: "Budget et atterrissage en détail (06 · Budget & prévisions)" },
    ],
    tableHref: hrefs.tableau,
    trend,
  };
}

// Le graphique principal a-t-il au moins une valeur connue ? (sinon il n'est pas tracé : un axe vide ferait croire à des zéros)
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
    rh = {
      kind: "value",
      etpAverage: compareOver(input, months, prevMonths, etpAverage, (a) => a.ratio, "etp"),
      prorated: months.map((m) => etpProratedMonth(input, m)),
      proratedQualifier: etpProratedQualifier(input),
      absenteeism: compareOver(input, months, prevMonths, absenteeism, (a) => a.ratio, "points"),
      absenceTypes: input.params.absenceTypes,
      turnover: compareWindows(input, rollingWindow(last), turnover, (t) => t.ratio, "points"),
      headcountAverage: headcountAverage(input, windowOf(months)),
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
    let dsn: number | null = null;
    let compta: number | null = null;
    if (!filtered && cur.kind === "value") {
      const d = dsnBrutWindow(pay.dsn, months);
      if (d.kind === "value") dsn = cur.brut - d.brutCents;
      const c = await ctx.load.compta();
      if (c.source && !c.error) {
        const rec = reconcile(journal, c.lines, c.months, months, c.nd);
        if (rec.kind === "value") compta = rec.ecart;
      }
    }
    payIn = {
      kind: "value",
      cur,
      prev,
      evolution: evolution(cur, prev, (w) => w.masse),
      cost: costPerEtp(cur, pay.etp(months, svcFilter)),
      costPrev: costPerEtp(prev, pay.etp(prevMonths, svcFilter)),
      rolling: rolling.map((m) => monthPayroll(j, m)),
      year: yearMonths(year).map((m) => monthPayroll(j, m)),
      yearPrev: yearMonths(year - 1).map((m) => monthPayroll(j, m)),
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

  const chapter = (id: "services" | "budget" | "paie-compta") => ctx.href({ chapitre: id, tri: null, sens: null });
  return {
    kind: "value",
    year,
    months,
    prevMonths,
    labels: ctx.labels,
    openMonths: ctx.openMonths,
    hrefs: {
      donnees,
      parametres: croiseeSettingsHref(slug),
      grille: `/e/${slug}/parametres#masse-salariale`,
      budget: `/e/${slug}/studio-rh/hypotheses`,
      services: chapter("services"),
      budgetChapter: chapter("budget"),
      paieCompta: chapter("paie-compta"),
      tableau: ctx.href({ affichage: "tableau" }, "cx-synthese-graphique"),
    },
    rh,
    pay: payIn,
    budget,
    live,
    landing: landingIn,
    seuils: ctx.settings.seuilsEffectif,
    marge: ctx.settings.margeAlerte,
  };
}
