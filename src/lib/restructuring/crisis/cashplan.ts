import { addDays, addMonthsToDate, isIsoDate } from "@/lib/dates";
import { toCents } from "@/lib/money";

// Cap 13, lot 2a — trésorerie à 13 semaines, plan de base.
// Projection traçable : le solde de départ vient du FEC ou d'une saisie datée, et chaque euro d'une semaine remonte à
// une ligne de flux saisie dans Clair. Aucune échéance n'est déduite du FEC.

export const CASH_PLAN_KEY = "restructuring.crisis.cashplan";
export const WEEK_COUNT = 13;
export const MAX_FLOWS = 500;
/** Plafond d'un montant saisi (1 milliard d'euros) : garantit des sommes entières exactes sur tout le plan. */
export const MAX_AMOUNT_CENTS = 100_000_000_000;

export const FLOW_CATEGORIES = [
  { id: "customers", label: "Clients" },
  { id: "suppliers", label: "Fournisseurs" },
  { id: "payroll", label: "Salaires" },
  { id: "social", label: "Charges sociales" },
  { id: "tax", label: "TVA et impôts" },
  { id: "loans", label: "Emprunts et banques" },
  { id: "other", label: "Autres" },
] as const;
export type FlowCategoryId = typeof FLOW_CATEGORIES[number]["id"];
export const DIRECTIONS = [{ id: "in", label: "Encaissement" }, { id: "out", label: "Décaissement" }] as const;
export type Direction = typeof DIRECTIONS[number]["id"];
export const RECURRENCES = [{ id: "once", label: "Ponctuel" }, { id: "weekly", label: "Chaque semaine" }, { id: "monthly", label: "Chaque mois" }] as const;
export type Recurrence = typeof RECURRENCES[number]["id"];

export type CashFlow = {
  id: string; label: string; category: FlowCategoryId; direction: Direction; amountCents: number;
  /** Date du flux, ou de sa première occurrence s'il est récurrent. */
  date: string; recurrence: Recurrence;
  /** Dernière date possible d'une occurrence ; null = sans fin (toujours null pour un flux ponctuel). */
  until: string | null;
};
export type CashStart = { date: string; cents: number };

// Lot 2b — scénarios : des mesures appliquées par-dessus le plan de base, qui n'est jamais modifié.
export const MAX_SCENARIOS = 5;
export const MAX_MEASURES = 100;
export const INFLOW_NATURES = [{ id: "cession", label: "Cession d’actif" }, { id: "apport", label: "Apport ou financement nouveau" }, { id: "autre", label: "Autre" }] as const;
export type InflowNature = typeof INFLOW_NATURES[number]["id"];
export type Measure =
  /** Report (moratoire) : chaque occurrence de la ligne dans le plan est décalée de `weeks` semaines. */
  | { id: string; kind: "report"; flowId: string; weeks: number }
  /** Étalement : les occurrences de la ligne dans le plan sont remplacées par `count` échéances égales. */
  | { id: string; kind: "etalement"; flowId: string; count: number; frequency: "weekly" | "monthly"; firstDate: string }
  /** Encaissement exceptionnel, présent dans le scénario seulement. */
  | { id: string; kind: "encaissement"; label: string; nature: InflowNature; amountCents: number; date: string };
export type Scenario = { id: string; name: string; measures: Measure[] };
export type CashPlanSettings = {
  revision: number;
  /** Solde bancaire saisi et daté ; null = le solde du FEC à la date d'arrêté est utilisé. */
  start: CashStart | null;
  /** Découvert autorisé saisi ; null = non saisi (la rupture se mesure alors par rapport à zéro, et l'écran le dit). */
  overdraftCents: number | null;
  flows: CashFlow[];
  scenarios: Scenario[];
};
export const emptyCashPlan = (): CashPlanSettings => ({ revision: 0, start: null, overdraftCents: null, flows: [], scenarios: [] });

const CATEGORY_IDS = new Set<string>(FLOW_CATEGORIES.map((c) => c.id));
const DIRECTION_IDS = new Set<string>(DIRECTIONS.map((d) => d.id));
const RECURRENCE_IDS = new Set<string>(RECURRENCES.map((r) => r.id));
const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= MAX_AMOUNT_CENTS;
const isBalance = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= MAX_AMOUNT_CENTS;
const plausible = (date: unknown): date is string => isIsoDate(date) && date >= "2000-01-01" && date <= "2100-12-31";

function parseFlow(value: unknown): CashFlow | null {
  if (value === null || typeof value !== "object") return null;
  const f = value as Record<string, unknown>;
  if (typeof f.id !== "string" || !f.id || f.id.length > 64) return null;
  if (typeof f.label !== "string" || !f.label.trim() || f.label.length > 120) return null;
  if (typeof f.category !== "string" || !CATEGORY_IDS.has(f.category)) return null;
  if (typeof f.direction !== "string" || !DIRECTION_IDS.has(f.direction)) return null;
  if (typeof f.recurrence !== "string" || !RECURRENCE_IDS.has(f.recurrence)) return null;
  if (!isAmount(f.amountCents) || !plausible(f.date)) return null;
  if (f.until !== null && (!plausible(f.until) || f.until < f.date || f.recurrence === "once")) return null;
  return { id: f.id, label: f.label, category: f.category as FlowCategoryId, direction: f.direction as Direction, amountCents: f.amountCents, date: f.date, recurrence: f.recurrence as Recurrence, until: f.until as string | null };
}

const NATURE_IDS = new Set<string>(INFLOW_NATURES.map((n) => n.id));
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isCount = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function parseMeasure(value: unknown): Measure | null {
  if (value === null || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  if (!isId(m.id)) return null;
  if (m.kind === "report") return isId(m.flowId) && isCount(m.weeks, 1, 52) ? { id: m.id, kind: "report", flowId: m.flowId, weeks: m.weeks } : null;
  if (m.kind === "etalement") {
    return isId(m.flowId) && isCount(m.count, 2, 60) && (m.frequency === "weekly" || m.frequency === "monthly") && plausible(m.firstDate)
      ? { id: m.id, kind: "etalement", flowId: m.flowId, count: m.count, frequency: m.frequency, firstDate: m.firstDate } : null;
  }
  if (m.kind === "encaissement") {
    return typeof m.label === "string" && m.label.trim() !== "" && m.label.length <= 120 && typeof m.nature === "string" && NATURE_IDS.has(m.nature) && isAmount(m.amountCents) && plausible(m.date)
      ? { id: m.id, kind: "encaissement", label: m.label, nature: m.nature as InflowNature, amountCents: m.amountCents, date: m.date } : null;
  }
  return null;
}
function parseScenario(value: unknown): Scenario | null {
  if (value === null || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  if (!isId(s.id) || typeof s.name !== "string" || !s.name.trim() || s.name.length > 80) return null;
  if (!Array.isArray(s.measures) || s.measures.length > MAX_MEASURES) return null;
  const measures = s.measures.map(parseMeasure);
  if (measures.some((m) => m === null) || new Set(measures.map((m) => m!.id)).size !== measures.length) return null;
  // Une ligne de base ne porte qu'une mesure par scénario : un report et un étalement ne se cumulent pas.
  const targets = measures.flatMap((m) => m!.kind === "encaissement" ? [] : [m!.flowId]);
  if (new Set(targets).size !== targets.length) return null;
  return { id: s.id, name: s.name, measures: measures as Measure[] };
}

/** Lecture stricte du paramètre stocké : une seule valeur invalide rend l'ensemble illisible (null), rien n'est corrigé en silence. */
export function parseCashPlan(value: unknown): CashPlanSettings | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.revision !== "number" || !Number.isSafeInteger(v.revision) || v.revision < 0) return null;
  if (!Array.isArray(v.flows) || v.flows.length > MAX_FLOWS) return null;
  const flows = v.flows.map(parseFlow);
  if (flows.some((f) => f === null) || new Set(flows.map((f) => f!.id)).size !== flows.length) return null;
  let start: CashStart | null = null;
  if (v.start !== null) {
    const s = v.start as Record<string, unknown> | undefined;
    if (!s || typeof s !== "object" || !plausible(s.date) || !isBalance(s.cents)) return null;
    start = { date: s.date, cents: s.cents };
  }
  if (v.overdraftCents !== null && !(isBalance(v.overdraftCents) && v.overdraftCents >= 0)) return null;
  // Un plan enregistré avant les scénarios n'a pas ce champ : il se lit comme « aucun scénario ».
  const rawScenarios = v.scenarios === undefined ? [] : v.scenarios;
  if (!Array.isArray(rawScenarios) || rawScenarios.length > MAX_SCENARIOS) return null;
  const scenarios = rawScenarios.map(parseScenario);
  if (scenarios.some((sc) => sc === null) || new Set(scenarios.map((sc) => sc!.id)).size !== scenarios.length) return null;
  return { revision: v.revision, start, overdraftCents: v.overdraftCents as number | null, flows: flows as CashFlow[], scenarios: scenarios as Scenario[] };
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** Ligne de flux saisie. Montant en euros, strictement positif ; le sens est porté par « Encaissement » ou « Décaissement ». */
export function flowFromForm(form: FormData, id: string): CashFlow {
  const label = text(form, "label");
  if (!label || label.length > 120) throw new Error("Libellé requis, 120 caractères au plus.");
  const category = text(form, "category");
  if (!CATEGORY_IDS.has(category)) throw new Error("Choisis une catégorie.");
  const direction = text(form, "direction");
  if (!DIRECTION_IDS.has(direction)) throw new Error("Choisis Encaissement ou Décaissement.");
  const amountCents = toCents(text(form, "amount"));
  if (!isAmount(amountCents)) throw new Error("Montant strictement positif requis, en euros.");
  const date = text(form, "date");
  if (!plausible(date)) throw new Error("Date du flux requise.");
  const recurrence = text(form, "recurrence");
  if (!RECURRENCE_IDS.has(recurrence)) throw new Error("Choisis Ponctuel, Chaque semaine ou Chaque mois.");
  const untilText = text(form, "until");
  if (untilText && recurrence === "once") throw new Error("Une date de fin ne s’applique qu’à un flux récurrent.");
  if (untilText && (!plausible(untilText) || untilText < date)) throw new Error("La date de fin doit être une date valide, postérieure ou égale à la première date.");
  return { id, label, category: category as FlowCategoryId, direction: direction as Direction, amountCents, date, recurrence: recurrence as Recurrence, until: untilText || null };
}

/** Solde de départ saisi (date et montant ensemble, ou aucun des deux) et découvert autorisé (vide = non saisi). */
export function startFromForm(form: FormData): { start: CashStart | null; overdraftCents: number | null } {
  const date = text(form, "startDate");
  const amount = text(form, "startAmount");
  let start: CashStart | null = null;
  if (date || amount) {
    const cents = toCents(amount);
    if (!plausible(date) || !isBalance(cents)) throw new Error("Solde saisi : une date valide et un montant en euros sont requis ensemble. Laisse les deux vides pour revenir au solde du FEC.");
    start = { date, cents };
  }
  const overdraftText = text(form, "overdraft");
  let overdraftCents: number | null = null;
  if (overdraftText) {
    const cents = toCents(overdraftText);
    if (!isBalance(cents) || cents < 0) throw new Error("Découvert autorisé : montant positif ou nul, en euros. Laisse vide s’il n’est pas connu.");
    overdraftCents = cents;
  }
  return { start, overdraftCents };
}

export function scenarioNameFromForm(form: FormData): string {
  const name = text(form, "name");
  if (!name || name.length > 80) throw new Error("Nom du scénario requis, 80 caractères au plus.");
  return name;
}

/** Mesure saisie ; `kind` est fixé par le formulaire utilisé. Aucune majoration ni pénalité n'est calculée. */
export function measureFromForm(form: FormData, id: string): Measure {
  const kind = text(form, "kind");
  if (kind === "encaissement") {
    const label = text(form, "label");
    if (!label || label.length > 120) throw new Error("Libellé requis, 120 caractères au plus.");
    const nature = text(form, "nature");
    if (!NATURE_IDS.has(nature)) throw new Error("Choisis la nature de l’encaissement.");
    const amountCents = toCents(text(form, "amount"));
    if (!isAmount(amountCents)) throw new Error("Montant strictement positif requis, en euros.");
    const date = text(form, "date");
    if (!plausible(date)) throw new Error("Date de l’encaissement requise.");
    return { id, kind, label, nature: nature as InflowNature, amountCents, date };
  }
  if (kind !== "report" && kind !== "etalement") throw new Error("Type de mesure inconnu.");
  const flowId = text(form, "flowId");
  if (!isId(flowId)) throw new Error("Choisis la ligne du plan de base visée.");
  if (kind === "report") {
    const weeks = Number(text(form, "weeks"));
    if (!isCount(weeks, 1, 52)) throw new Error("Report : nombre entier de semaines, de 1 à 52.");
    return { id, kind, flowId, weeks };
  }
  {
    const count = Number(text(form, "count"));
    if (!isCount(count, 2, 60)) throw new Error("Étalement : nombre entier d’échéances, de 2 à 60.");
    const frequency = text(form, "frequency");
    if (frequency !== "weekly" && frequency !== "monthly") throw new Error("Choisis une fréquence : chaque semaine ou chaque mois.");
    const firstDate = text(form, "firstDate");
    if (!plausible(firstDate)) throw new Error("Date de la première échéance requise.");
    return { id, kind, flowId, count, frequency, firstDate };
  }
}

/** Lundi de la semaine calendaire d'une date. */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

/** Dates d'occurrence d'un flux dans l'intervalle ]after ; upTo]. Mensuel : même jour du mois, ramené en fin de mois si besoin. */
export function occurrences(flow: CashFlow, after: string, upTo: string): string[] {
  const last = flow.until !== null && flow.until < upTo ? flow.until : upTo;
  const out: string[] = [];
  for (let k = 0; ; k++) {
    const date = flow.recurrence === "weekly" ? addDays(flow.date, 7 * k) : flow.recurrence === "monthly" ? addMonthsToDate(flow.date, k) : flow.date;
    if (date > last) break;
    if (date > after) out.push(date);
    if (flow.recurrence === "once") break;
  }
  return out;
}

export type PlanStart = CashStart & { source: "fec" | "saisi" };
/** `measureId` : le montant vient d'une mesure de scénario, appliquée à la ligne `flowId` quand elle en vise une. */
export type Contribution = { flowId: string | null; measureId: string | null; label: string; date: string; cents: number };
export type RowCategory = FlowCategoryId | "exceptional";
export type CategoryRow = { direction: Direction; category: RowCategory; label: string; weeks: number[]; total: number };
export type PlanWeek = { index: number; from: string; to: string; inflow: number; outflow: number; net: number; closing: number; contributions: Contribution[] };
export type PlanValue = {
  kind: "value"; start: PlanStart; horizonEnd: string;
  weeks: PlanWeek[]; rows: CategoryRow[];
  lowPoint: { week: number; cents: number };
  /** Seuil sous lequel la trésorerie est en rupture : −découvert autorisé s'il est saisi, sinon zéro. */
  floor: { cents: number; source: "decouvert" | "zero" };
  rupture: { week: number; from: string; to: string; cents: number } | null;
  /** Le solde de départ est déjà sous le seuil, avant tout flux. */
  startBelowFloor: boolean;
  /** Lignes saisies sans occurrence dans le plan, avec la raison : rien n'est déplacé ni reporté en silence. */
  ignored: { flowId: string; label: string; cents: number; direction: Direction; reason: string }[];
};
export type CashPlan = { kind: "nd"; reason: string } | PlanValue;

type Entry = { flowId: string | null; measureId: string | null; label: string; category: RowCategory; direction: Direction; date: string; amountCents: number };
const ROW_ORDER: RowCategory[] = [...FLOW_CATEGORIES.map((c) => c.id), "exceptional"];
const rowLabel = (category: RowCategory) => category === "exceptional" ? "Exceptionnels" : FLOW_CATEGORIES.find((c) => c.id === category)!.label;

function frame(start: PlanStart) {
  const first = mondayOf(start.date);
  return { first, horizonEnd: addDays(first, 7 * WEEK_COUNT - 1) };
}

/** Occurrences des lignes de base dans ]date de départ ; fin de la semaine 13], et lignes sans occurrence avec leur raison. */
function baseEntries(start: PlanStart, horizonEnd: string, flows: CashFlow[]) {
  const entries: Entry[] = [];
  const ignored: PlanValue["ignored"] = [];
  for (const flow of flows) {
    const dates = occurrences(flow, start.date, horizonEnd);
    if (!dates.length) {
      const reason = flow.recurrence === "once"
        ? (flow.date <= start.date ? "date antérieure ou égale à la date de départ : déjà dans le solde, ou à replanifier" : "date postérieure à la treizième semaine")
        : (flow.until !== null && flow.until <= start.date ? "récurrence terminée avant la date de départ" : "aucune occurrence dans les 13 semaines");
      ignored.push({ flowId: flow.id, label: flow.label, cents: flow.amountCents, direction: flow.direction, reason });
      continue;
    }
    for (const date of dates) entries.push({ flowId: flow.id, measureId: null, label: flow.label, category: flow.category, direction: flow.direction, date, amountCents: flow.amountCents });
  }
  return { entries, ignored };
}

function aggregate(start: PlanStart, overdraftCents: number | null, entries: Entry[], ignored: PlanValue["ignored"]): CashPlan {
  const { first, horizonEnd } = frame(start);
  const weeks: PlanWeek[] = Array.from({ length: WEEK_COUNT }, (_, i) => ({ index: i + 1, from: addDays(first, 7 * i), to: addDays(first, 7 * i + 6), inflow: 0, outflow: 0, net: 0, closing: 0, contributions: [] }));
  const rows = new Map<string, CategoryRow>();
  for (const entry of entries) {
    const week = weeks.find((w) => entry.date >= w.from && entry.date <= w.to);
    if (!week) continue; // les écritures hors des 13 semaines sont écartées en amont, avec leur raison
    const key = `${entry.direction}:${entry.category}`;
    const row = rows.get(key) ?? { direction: entry.direction, category: entry.category, label: rowLabel(entry.category), weeks: Array<number>(WEEK_COUNT).fill(0), total: 0 };
    if (entry.direction === "in") week.inflow += entry.amountCents; else week.outflow += entry.amountCents;
    week.contributions.push({ flowId: entry.flowId, measureId: entry.measureId, label: entry.label, date: entry.date, cents: entry.direction === "in" ? entry.amountCents : -entry.amountCents });
    row.weeks[week.index - 1] += entry.amountCents;
    row.total += entry.amountCents;
    rows.set(key, row);
  }
  let balance = start.cents;
  for (const week of weeks) {
    week.net = week.inflow - week.outflow;
    balance += week.net;
    week.closing = balance;
    week.contributions.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  }
  if (weeks.some((w) => ![w.inflow, w.outflow, w.net, w.closing].every(Number.isSafeInteger))) return { kind: "nd", reason: "Plan hors des centimes entiers sûrs." };
  const low = weeks.reduce((min, w) => (w.closing < min.closing ? w : min), weeks[0]);
  const floor = overdraftCents === null ? { cents: 0, source: "zero" as const } : { cents: -overdraftCents, source: "decouvert" as const };
  const broken = weeks.find((w) => w.closing < floor.cents) ?? null;
  return {
    kind: "value", start, horizonEnd, weeks,
    rows: [...rows.values()].sort((a, b) => (a.direction === b.direction ? ROW_ORDER.indexOf(a.category) - ROW_ORDER.indexOf(b.category) : a.direction === "in" ? -1 : 1)),
    lowPoint: { week: low.index, cents: low.closing }, floor,
    rupture: broken ? { week: broken.index, from: broken.from, to: broken.to, cents: broken.closing } : null,
    startBelowFloor: start.cents < floor.cents, ignored,
  };
}

/**
 * Plan à 13 semaines calendaires (lundi → dimanche), la première étant celle de la date de départ.
 * Seules les occurrences strictement postérieures à la date de départ comptent : le solde de départ contient déjà
 * les mouvements de ce jour-là et des jours précédents.
 */
export function buildCashPlan(start: PlanStart | null, startReason: string, settings: CashPlanSettings): CashPlan {
  if (!start) return { kind: "nd", reason: startReason };
  if (!plausible(start.date) || !isBalance(start.cents)) return { kind: "nd", reason: "Solde de départ illisible ou hors limites." };
  const { entries, ignored } = baseEntries(start, frame(start).horizonEnd, settings.flows);
  return aggregate(start, settings.overdraftCents, entries, ignored);
}

export type MeasureOutcome = {
  measureId: string; kind: Measure["kind"]; label: string;
  /** null = mesure appliquée ; sinon la raison pour laquelle elle ne l'est pas (jamais appliquée à moitié). */
  inapplicable: string | null;
  /** Montant sorti des 13 semaines par la mesure : toujours dû, simplement hors de l'horizon. */
  beyondCents: number;
};
export type ScenarioPlan =
  | { kind: "nd"; reason: string }
  | {
    kind: "value"; scenario: Scenario; plan: PlanValue; outcomes: MeasureOutcome[];
    /** Décaissements que les mesures font sortir de l'horizon : dus après la semaine 13, pas effacés. */
    beyondCents: number;
    comparison: { week: number; base: number; scenario: number; delta: number }[];
    lowPointDelta: number;
    baseRupture: PlanValue["rupture"];
  };

const describe = (m: Measure, flow: CashFlow | undefined) => m.kind === "encaissement" ? m.label
  : m.kind === "report" ? `Report de ${m.weeks} semaine${m.weeks === 1 ? "" : "s"} · ${flow?.label ?? "ligne supprimée"}`
  : `Étalement en ${m.count} échéances · ${flow?.label ?? "ligne supprimée"}`;

/**
 * Scénario = plan de base + mesures. Le plan de base n'est pas modifié. Une mesure qui ne peut pas s'appliquer
 * entièrement n'est pas appliquée du tout, et sa raison est donnée.
 */
export function buildScenarioPlan(base: CashPlan, settings: CashPlanSettings, scenario: Scenario): ScenarioPlan {
  if (base.kind === "nd") return { kind: "nd", reason: base.reason };
  const start = base.start;
  const { horizonEnd } = frame(start);
  const built = baseEntries(start, horizonEnd, settings.flows);
  let entries = built.entries;
  const outcomes: MeasureOutcome[] = [];
  for (const measure of scenario.measures) {
    const flow = measure.kind === "encaissement" ? undefined : settings.flows.find((f) => f.id === measure.flowId);
    const outcome: MeasureOutcome = { measureId: measure.id, kind: measure.kind, label: describe(measure, flow), inapplicable: null, beyondCents: 0 };
    outcomes.push(outcome);
    if (measure.kind === "encaissement") {
      if (measure.date <= start.date) outcome.inapplicable = "date antérieure ou égale à la date de départ";
      else if (measure.date > horizonEnd) outcome.inapplicable = "date postérieure à la treizième semaine";
      else entries.push({ flowId: null, measureId: measure.id, label: `${measure.label} (${INFLOW_NATURES.find((n) => n.id === measure.nature)!.label.toLowerCase()})`, category: "exceptional", direction: "in", date: measure.date, amountCents: measure.amountCents });
      continue;
    }
    const own = entries.filter((e) => e.flowId === measure.flowId && e.measureId === null);
    if (!flow) { outcome.inapplicable = "la ligne visée a été supprimée du plan de base"; continue; }
    if (flow.direction !== "out") { outcome.inapplicable = "la ligne visée est un encaissement : seuls les décaissements se reportent ou s’étalent"; continue; }
    if (!own.length) { outcome.inapplicable = "la ligne visée n’a aucune occurrence dans les 13 semaines"; continue; }
    const rest = entries.filter((e) => !own.includes(e));
    if (measure.kind === "report") {
      const moved = own.map((e) => ({ ...e, measureId: measure.id, date: addDays(e.date, 7 * measure.weeks), label: `${e.label} (reporté de ${measure.weeks} sem., prévu le ${frDate(e.date)})` }));
      outcome.beyondCents = moved.filter((e) => e.date > horizonEnd).reduce((sum, e) => sum + e.amountCents, 0);
      entries = [...rest, ...moved.filter((e) => e.date <= horizonEnd)];
      continue;
    }
    if (measure.firstDate <= start.date) { outcome.inapplicable = "première échéance antérieure ou égale à la date de départ"; continue; }
    const total = own.reduce((sum, e) => sum + e.amountCents, 0);
    const each = Math.floor(total / measure.count);
    if (each < 1) { outcome.inapplicable = "montant trop faible pour ce nombre d’échéances"; continue; }
    const installments: Entry[] = Array.from({ length: measure.count }, (_, i) => ({
      flowId: flow.id, measureId: measure.id, category: flow.category, direction: "out" as const,
      date: measure.frequency === "weekly" ? addDays(measure.firstDate, 7 * i) : addMonthsToDate(measure.firstDate, i),
      // Échéances égales ; le reliquat d'arrondi est porté par la dernière.
      amountCents: i === measure.count - 1 ? total - each * (measure.count - 1) : each,
      label: `${flow.label} (échéance ${i + 1}/${measure.count})`,
    }));
    outcome.beyondCents = installments.filter((e) => e.date > horizonEnd).reduce((sum, e) => sum + e.amountCents, 0);
    entries = [...rest, ...installments.filter((e) => e.date <= horizonEnd)];
  }
  const plan = aggregate(start, settings.overdraftCents, entries, built.ignored);
  if (plan.kind === "nd") return plan;
  const beyondCents = outcomes.reduce((sum, o) => sum + o.beyondCents, 0);
  if (!Number.isSafeInteger(beyondCents)) return { kind: "nd", reason: "Montants reportés hors des centimes entiers sûrs." };
  return {
    kind: "value", scenario, plan, outcomes, beyondCents,
    comparison: plan.weeks.map((w, i) => ({ week: w.index, base: base.weeks[i].closing, scenario: w.closing, delta: w.closing - base.weeks[i].closing })),
    lowPointDelta: plan.lowPoint.cents - base.lowPoint.cents, baseRupture: base.rupture,
  };
}
const frDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// --- Postes fournisseurs non lettrés : aide à la saisie, jamais une échéance.
export type SupplierLine = {
  accountId: string; auxiliary: string | null; auxiliaryLabel: string | null; date: string; pieceRef: string | null; pieceDate: string | null;
  debitCents: number | null; creditCents: number | null;
  /** false : écriture importée avant la lecture du lettrage (information absente, à ne pas confondre avec « non lettré »). */
  letteringKnown: boolean; lettering: string | null; letteringDate: string | null;
};
export type OpenItem = { accountId: string; auxiliary: string | null; auxiliaryLabel: string | null; pieceRef: string | null; pieceDate: string | null; cents: number };
export type OpenItems = { kind: "nd"; reason: string } | { kind: "value"; items: OpenItem[]; count: number; totalCents: number };

/** Écritures fournisseurs (comptes 40) non lettrées à la date de départ. Montant positif = dû au fournisseur. */
export function openSupplierItems(lines: SupplierLine[], asOf: string): OpenItems {
  const scoped = lines.filter((l) => l.date <= asOf);
  if (!scoped.length) return { kind: "value", items: [], count: 0, totalCents: 0 };
  if (scoped.some((l) => !l.letteringKnown)) return { kind: "nd", reason: "FEC importé avant la lecture du lettrage : dépose-le à nouveau dans Données pour lister les factures non lettrées." };
  if (scoped.some((l) => l.debitCents === null || l.creditCents === null)) return { kind: "nd", reason: "Débit ou crédit manquant sur une écriture fournisseur." };
  const open = scoped.filter((l) => l.lettering === null || (l.letteringDate !== null && l.letteringDate > asOf));
  const items = open.map((l) => ({ accountId: l.accountId, auxiliary: l.auxiliary, auxiliaryLabel: l.auxiliaryLabel, pieceRef: l.pieceRef, pieceDate: l.pieceDate, cents: l.creditCents! - l.debitCents! }))
    .sort((a, b) => b.cents - a.cents || (a.pieceDate ?? "").localeCompare(b.pieceDate ?? ""));
  const total = items.reduce((sum, i) => sum + BigInt(i.cents), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER)) return { kind: "nd", reason: "Total des postes non lettrés hors limites." };
  return { kind: "value", items, count: items.length, totalCents: Number(total) };
}
