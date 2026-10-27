import { z } from "zod";
import { FINANCE_ROWS, type FinanceActuals, type FinanceCell, type FinancePlan, type FinanceProjectionMonth, type FinanceRhMonth, type FinanceRowId, type FinanceSettings } from "./types";

export const FINANCE_SETTINGS_KEY = "finance.v1";
export const MAX_FINANCE_CENTS = 1_000_000_000_000;
export class FinanceError extends Error {
  constructor(message: string, readonly code: "invalid" | "conflict" | "rh-unavailable" = "invalid") {
    super(message);
    this.name = "FinanceError";
  }
}

const rowId = z.enum(["revenue", "other-income", "personnel", "other-expenses"]);
const cents = z.number().int().safe().min(-MAX_FINANCE_CENTS).max(MAX_FINANCE_CENTS);
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const rowCells = z.object({
  revenue: cents.optional(), "other-income": cents.optional(), personnel: cents.optional(), "other-expenses": cents.optional(),
}).strict();
const planSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).refine((name) => name.trim().length > 0),
  kind: z.enum(["budget", "forecast"]),
  year: z.number().int().min(2000).max(2100),
  currency: z.literal("EUR"),
  firstForecastMonth: z.string().regex(monthPattern).nullable(),
  cells: z.record(z.string().regex(monthPattern), rowCells).refine((value) => Object.keys(value).length <= 12),
  personnelSource: z.enum(["manual", "rh"]),
  rhScenarioId: z.string().uuid().nullable(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((plan, ctx) => {
  if (Object.keys(plan.cells).some((month) => month.slice(0, 4) !== String(plan.year))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Mois hors année" });
  if (plan.kind === "budget" ? plan.firstForecastMonth !== null : plan.firstForecastMonth === null || plan.firstForecastMonth.slice(0, 4) !== String(plan.year)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Bascule invalide" });
  }
  if (plan.personnelSource === "rh" ? plan.rhScenarioId === null : plan.rhScenarioId !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Source RH incohérente" });
});
const settingsSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().safe().nonnegative(),
  mappings: z.array(z.object({ account: z.string().regex(/^[67][0-9A-Za-z]{0,19}$/), row: rowId }).strict()).max(256),
  plans: z.array(planSchema).max(12),
}).strict().superRefine((settings, ctx) => {
  if (new Set(settings.mappings.map((mapping) => mapping.account)).size !== settings.mappings.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Compte dupliqué" });
  if (new Set(settings.plans.map((plan) => plan.id.toLowerCase())).size !== settings.plans.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Plan dupliqué" });
});

export function parseFinanceSettings(value: unknown): FinanceSettings | null {
  const parsed = settingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function emptyFinanceSettings(): FinanceSettings {
  return { version: 1, revision: 0, mappings: [], plans: [] };
}

const missing = (reason: string): FinanceCell => ({ cents: null, reason });
const copyCell = (cell: FinanceCell): FinanceCell => ({ cents: cell.cents, reason: cell.reason });
const validCents = (value: number) => Number.isSafeInteger(value) && Math.abs(value) <= MAX_FINANCE_CENTS;
const copyCells = (cells: Record<FinanceRowId, FinanceCell>): Record<FinanceRowId, FinanceCell> => ({
  revenue: copyCell(cells.revenue), "other-income": copyCell(cells["other-income"]), personnel: copyCell(cells.personnel), "other-expenses": copyCell(cells["other-expenses"]),
});
function planResult(cells: Record<FinanceRowId, FinanceCell>): FinanceCell {
  if (FINANCE_ROWS.some((row) => cells[row.id].cents === null)) return missing("Résultat non calculable : une ligne financière n’est pas renseignée.");
  const value = BigInt(cells.revenue.cents!) + BigInt(cells["other-income"].cents!) - BigInt(cells.personnel.cents!) - BigInt(cells["other-expenses"].cents!);
  return value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)
    ? missing("Résultat hors des limites de calcul.")
    : { cents: Number(value), reason: null };
}

// La bascule est choisie par le client : une comptabilité passée incomplète reste réelle et n.d., jamais remplacée par le plan.
export function buildFinanceProjection(actuals: FinanceActuals, input: FinancePlan, rh: FinanceRhMonth[]): FinanceProjectionMonth[] {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) throw new FinanceError("Plan financier invalide.");
  const plan = parsed.data;
  const actualMonths = new Map<string, FinanceActuals["months"][number]>();
  for (const month of actuals.months) {
    if (actualMonths.has(month.month)) throw new FinanceError("Données comptables mensuelles ambiguës.");
    actualMonths.set(month.month, month);
  }
  const rhMonths = new Map<string, FinanceRhMonth>();
  const duplicateRh = new Set<string>();
  for (const month of rh) {
    if (rhMonths.has(month.month)) duplicateRh.add(month.month);
    rhMonths.set(month.month, month);
  }
  return Array.from({ length: 12 }, (_, index): FinanceProjectionMonth => {
    const month = `${plan.year}-${String(index + 1).padStart(2, "0")}`;
    if (plan.kind === "forecast" && month < plan.firstForecastMonth!) {
      const actual = actualMonths.get(month);
      if (actual) return { ...actual, cells: copyCells(actual.cells), result: copyCell(actual.result), origin: "actual", personnelOrigin: "accounting" };
      const cells = Object.fromEntries(FINANCE_ROWS.map((row) => [row.id, missing("Comptabilité non disponible pour ce mois.")])) as Record<FinanceRowId, FinanceCell>;
      return { month, cells, result: missing("Comptabilité non disponible pour ce mois."), lineCount: 0, origin: "actual", personnelOrigin: "accounting" };
    }
    const cells = Object.fromEntries(FINANCE_ROWS.map((row) => {
      const amount = plan.cells[month]?.[row.id];
      return [row.id, amount === undefined ? missing("Hypothèse non saisie pour ce mois.") : { cents: amount, reason: null }];
    })) as Record<FinanceRowId, FinanceCell>;
    if (plan.personnelSource === "rh") {
      const source = rhMonths.get(month)?.cell;
      cells.personnel = !duplicateRh.has(month) && source?.cents !== null && source?.cents !== undefined && validCents(source.cents)
        ? { cents: source.cents, reason: null }
        : missing("Projection RH indisponible pour ce mois.");
    }
    return { month, cells, result: planResult(cells), lineCount: 0, origin: "plan", personnelOrigin: plan.personnelSource };
  });
}
