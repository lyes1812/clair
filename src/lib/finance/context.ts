import { project } from "@/lib/budget/engine";
import { getScenario, listScenarios } from "@/lib/budget/store";
import { loadCompta } from "@/lib/payroll/context";
import { hasAtLeast } from "@/lib/roles";
import { resolveSource } from "@/lib/sources";
import { requireWorkspace } from "@/lib/workspace";
import { buildActuals } from "./actuals";
import { buildFinanceProjection } from "./plans";
import { getFinanceSettings } from "./store";
import type { FinancePlan, FinanceRhMonth } from "./types";
import { FINANCE_VIEWS, type FinanceViewId } from "./view-types";

export const yearMonths = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
export type FinanceQuery = Record<string, string | undefined>;

// Pas de « dernier scénario » implicite : seules les versions explicitement choisies sont lues.
export async function loadFinanceContext(slug: string, query: FinanceQuery) {
  const { workspace } = await requireWorkspace(slug);
  const [source, accounting, settings, scenarios] = await Promise.all([
    resolveSource(workspace.id, "accounting"), loadCompta(workspace.id), getFinanceSettings(workspace.id), listScenarios(workspace.id),
  ]);
  const years = [...new Set([...accounting.months, ...Object.keys(accounting.nd)].map((m) => Number(m.slice(0, 4)))
    .concat(settings.plans.map((p) => p.year)).filter((y) => Number.isInteger(y) && y >= 2000 && y <= 2100))].sort((a, b) => b - a);
  const requestedYear = Number(query.annee);
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100 ? requestedYear : years[0] ?? new Date().getFullYear();
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => b - a);
  const months = yearMonths(year);
  const knownMonths = accounting.months.filter((m) => m.startsWith(`${year}-`)).sort();
  const validMonth = (s: string | undefined): s is string => Boolean(s && months.includes(s));
  const from = validMonth(query.debut) ? query.debut : months[0];
  const requestedTo = validMonth(query.fin) ? query.fin : knownMonths.at(-1) ?? months[11];
  const to = requestedTo >= from ? requestedTo : from;
  const view: FinanceViewId = FINANCE_VIEWS.some((v) => v.id === query.vue) ? query.vue as FinanceViewId : "overview";
  const plans = settings.plans.filter((p) => p.year === year);
  const selectedPlan = plans.find((p) => p.id === query.plan) ?? null;
  const selectedBudget = plans.find((p) => p.id === query.budget && p.kind === "budget") ?? null;
  // Si la source retenue change pendant la lecture, on n'attribue pas ses lignes à une autre source.
  const compta = accounting.source === source.chosen ? accounting : { ...accounting, lines: [], months: [], error: true };
  const actuals = buildActuals(compta, months, settings.mappings);
  const previous = buildActuals(compta, yearMonths(year - 1), settings.mappings);
  const rhCache = new Map<string, Promise<FinanceRhMonth[]>>();
  const rhFor = (plan: FinancePlan) => {
    if (plan.personnelSource !== "rh" || !plan.rhScenarioId) return Promise.resolve([]);
    const id = plan.rhScenarioId;
    if (!rhCache.has(id)) rhCache.set(id, (async () => {
      try {
        const full = await getScenario(workspace.id, id);
        if (!full) return [];
        const result = project(full.base, full.scenario.firstMonth, full.scenario.lastMonth, full.hypotheses, full.scenario.conventions);
        if (result.kind !== "value") return [];
        return result.months.map((m) => ({ month: m.month, cell: m.kind === "value" ? { cents: m.cost, reason: null } : { cents: null, reason: "Projection RH non calculable pour ce mois." } }));
      } catch { return []; }
    })());
    return rhCache.get(id)!;
  };
  const projection = selectedPlan ? buildFinanceProjection(actuals, selectedPlan, await rhFor(selectedPlan)) : null;
  const budgetMonths = selectedBudget ? buildFinanceProjection(actuals, selectedBudget, await rhFor(selectedBudget)) : null;
  return {
    slug, workspaceName: workspace.name, workspaceId: workspace.id,
    year, years, from, to, view, months: months.filter((m) => m >= from && m <= to), actuals, previous, selectedPlan, projection, selectedBudget, budgetMonths,
    plans, mappings: settings.mappings, revision: settings.revision, source,
    sourceNotice: "Écritures de la lecture appliquée dans Données ; la couverture d’un mois ne certifie pas sa clôture comptable. Les axes par service ne sont pas disponibles dans cette lecture.",
    rhOptions: scenarios.map(({ scenario: s }) => ({ id: s.id, name: s.name, firstMonth: s.firstMonth, lastMonth: s.lastMonth })),
    canEdit: hasAtLeast(workspace.role, "editor"), canAdmin: hasAtLeast(workspace.role, "admin"),
  };
}
