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
export type CashPlanSettings = {
  revision: number;
  /** Solde bancaire saisi et daté ; null = le solde du FEC à la date d'arrêté est utilisé. */
  start: CashStart | null;
  /** Découvert autorisé saisi ; null = non saisi (la rupture se mesure alors par rapport à zéro, et l'écran le dit). */
  overdraftCents: number | null;
  flows: CashFlow[];
};
export const emptyCashPlan = (): CashPlanSettings => ({ revision: 0, start: null, overdraftCents: null, flows: [] });

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
  return { revision: v.revision, start, overdraftCents: v.overdraftCents as number | null, flows: flows as CashFlow[] };
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
export type Contribution = { flowId: string; label: string; date: string; cents: number };
export type CategoryRow = { direction: Direction; category: FlowCategoryId; label: string; weeks: number[]; total: number };
export type PlanWeek = { index: number; from: string; to: string; inflow: number; outflow: number; net: number; closing: number; contributions: Contribution[] };
export type CashPlan =
  | { kind: "nd"; reason: string }
  | {
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

/**
 * Plan à 13 semaines calendaires (lundi → dimanche), la première étant celle de la date de départ.
 * Seules les occurrences strictement postérieures à la date de départ comptent : le solde de départ contient déjà
 * les mouvements de ce jour-là et des jours précédents.
 */
export function buildCashPlan(start: PlanStart | null, startReason: string, settings: CashPlanSettings): CashPlan {
  if (!start) return { kind: "nd", reason: startReason };
  if (!plausible(start.date) || !isBalance(start.cents)) return { kind: "nd", reason: "Solde de départ illisible ou hors limites." };
  const first = mondayOf(start.date);
  const horizonEnd = addDays(first, 7 * WEEK_COUNT - 1);
  const weeks: PlanWeek[] = Array.from({ length: WEEK_COUNT }, (_, i) => ({ index: i + 1, from: addDays(first, 7 * i), to: addDays(first, 7 * i + 6), inflow: 0, outflow: 0, net: 0, closing: 0, contributions: [] }));
  const rows = new Map<string, CategoryRow>();
  const ignored: Extract<CashPlan, { kind: "value" }>["ignored"] = [];
  for (const flow of settings.flows) {
    const dates = occurrences(flow, start.date, horizonEnd);
    if (!dates.length) {
      const reason = flow.recurrence === "once"
        ? (flow.date <= start.date ? "date antérieure ou égale à la date de départ : déjà dans le solde, ou à replanifier" : "date postérieure à la treizième semaine")
        : (flow.until !== null && flow.until <= start.date ? "récurrence terminée avant la date de départ" : "aucune occurrence dans les 13 semaines");
      ignored.push({ flowId: flow.id, label: flow.label, cents: flow.amountCents, direction: flow.direction, reason });
      continue;
    }
    const key = `${flow.direction}:${flow.category}`;
    const row = rows.get(key) ?? { direction: flow.direction, category: flow.category, label: FLOW_CATEGORIES.find((c) => c.id === flow.category)!.label, weeks: Array<number>(WEEK_COUNT).fill(0), total: 0 };
    for (const date of dates) {
      const week = weeks.find((w) => date >= w.from && date <= w.to)!;
      const signed = flow.direction === "in" ? flow.amountCents : -flow.amountCents;
      if (flow.direction === "in") week.inflow += flow.amountCents; else week.outflow += flow.amountCents;
      week.contributions.push({ flowId: flow.id, label: flow.label, date, cents: signed });
      row.weeks[week.index - 1] += flow.amountCents;
      row.total += flow.amountCents;
    }
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
  const floor = settings.overdraftCents === null ? { cents: 0, source: "zero" as const } : { cents: -settings.overdraftCents, source: "decouvert" as const };
  const broken = weeks.find((w) => w.closing < floor.cents) ?? null;
  const order = (r: CategoryRow) => FLOW_CATEGORIES.findIndex((c) => c.id === r.category);
  return {
    kind: "value", start, horizonEnd, weeks,
    rows: [...rows.values()].sort((a, b) => (a.direction === b.direction ? order(a) - order(b) : a.direction === "in" ? -1 : 1)),
    lowPoint: { week: low.index, cents: low.closing }, floor,
    rupture: broken ? { week: broken.index, from: broken.from, to: broken.to, cents: broken.closing } : null,
    startBelowFloor: start.cents < floor.cents, ignored,
  };
}

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
