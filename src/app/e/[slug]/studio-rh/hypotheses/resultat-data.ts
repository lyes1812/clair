import { project } from "@/lib/budget/engine";
import { budgetSeries, liveSeries, scenarioSeries, shifted, type Series } from "@/lib/budget/series";
import { getScenario, KIND_LABELS, listBudgets, listScenarios, type BudgetRow, type ScenarioRow } from "@/lib/budget/store";
import type { BaseSnapshot, ProjectedMonth, Projection } from "@/lib/budget/types";
import { monthRange } from "@/lib/connectors/months";
import { loadPayrollContext } from "@/lib/payroll/context";
import { frDates } from "@/lib/viz/hypotheses";

// Données communes de l'onglet Résultat (écran et export Excel) : lignes « Mois par mois » de la projection, lectures de la
// comparaison. Aucun calcul propre : base figée, moteur de projection et séries de lecture existants.
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const fd = (s: string | null) => (s === null ? null : frDates(s));

export type ProjectionRow = { month: string; layer: "reel" | "parent" | "projete"; source?: string; brut: number | null; charges: number | null; cost: number | null; headcount: number | null; etp4: number | null; nd: string | null; etpNd: string | null };

// Mois de l'année du premier mois projeté (réel figé) puis mois projetés jusqu'à la fin de l'horizon.
export function projectionRows(base: BaseSnapshot, proj: Projection, scenario: ScenarioRow): ProjectionRow[] {
  const year = scenario.firstMonth.slice(0, 4);
  const actual: ProjectionRow[] = base.actuals
    .filter((a) => a.month.startsWith(year) && a.month < scenario.firstMonth)
    .map((a) => (a.kind === "nd" ? { month: a.month, layer: "reel", brut: null, charges: null, cost: null, headcount: null, etp4: null, nd: frDates(a.reason), etpNd: null } : { month: a.month, layer: "reel", brut: a.brut, charges: a.cotisations, cost: a.masse, headcount: a.headcount, etp4: a.etp4, nd: null, etpNd: fd(a.etpNd) }));
  // Base dérivée : mois projetés par le scénario parent dans l'année (coût et effectif seulement).
  const prior: ProjectionRow[] = (base.prior ?? [])
    .filter((p) => p.month.startsWith(year) && p.month < scenario.firstMonth && !base.actuals.some((a) => a.month === p.month))
    .map((p) => (p.kind === "nd" ? { month: p.month, layer: "parent", source: p.source, brut: null, charges: null, cost: null, headcount: null, etp4: null, nd: frDates(p.reason), etpNd: null } : { month: p.month, layer: "parent", source: p.source, brut: p.brut ?? null, charges: p.charges ?? null, cost: p.cost, headcount: p.headcount, etp4: p.etp4, nd: p.brut === undefined ? "brut et charges non conservés par la base dérivée (créée avant leur reprise)" : null, etpNd: fd(p.etpNd) }));
  const projected: ProjectionRow[] = proj.kind === "error" ? [] : proj.months.map((p: ProjectedMonth) => (p.kind === "nd" ? { month: p.month, layer: "projete", brut: null, charges: null, cost: null, headcount: null, etp4: null, nd: frDates(p.reasons.join(" ; ")), etpNd: null } : { month: p.month, layer: "projete", brut: p.brut, charges: p.charges, cost: p.cost, headcount: p.headcount, etp4: p.etp4, nd: null, etpNd: fd(p.etpNd) }));
  return [...actual, ...prior, ...projected];
}

export type ComparisonOption = { value: string; label: string };
export type ComparisonData = { years: string[]; year: string; options: ComparisonOption[]; selected: string[]; principal: Series; compared: Series[] };

// Onglet Comparaison : lectures choisies (paramètre « cmp », trois au plus) ; par défaut réel courant, N-1 et budgets saisis de l'année.
export async function loadComparison(slug: string, workspaceId: string, s: ScenarioRow, base: BaseSnapshot, proj: Projection, sp: Search): Promise<ComparisonData> {
  const years = [...new Set(monthRange(s.firstMonth, s.lastMonth).map((m) => m.slice(0, 4)))];
  const year = years.includes(one(sp.annee)) ? one(sp.annee) : years[0];
  const [budgets, scenarios] = await Promise.all([listBudgets(workspaceId), listScenarios(workspaceId)]);
  const options: ComparisonOption[] = [
    { value: "reel", label: "Réel courant (lecture PayFit appliquée)" },
    { value: "n1", label: "N-1 (réel figé du scénario, projeté du parent le cas échéant)" },
    ...budgets.filter((b: BudgetRow) => b.year === year).map((b) => ({ value: `budget:${b.id}`, label: `Budget saisi « ${b.name} » (${b.year})` })),
    ...scenarios.filter((x) => x.scenario.id !== s.id).map((x) => ({ value: `scenario:${x.scenario.id}`, label: `Scénario « ${x.scenario.name} » (${KIND_LABELS[x.scenario.kind]}, ${x.scenario.status === "fige" ? "figé" : "brouillon"})` })),
  ];
  const raw = Array.isArray(sp.cmp) ? sp.cmp : sp.cmp ? [sp.cmp] : null;
  const selected = (raw ?? ["reel", "n1", ...options.filter((o) => o.value.startsWith("budget:")).map((o) => o.value)]).filter((v) => options.some((o) => o.value === v)).slice(0, 3);
  const principal = scenarioSeries(s.id, s.name, base, proj);
  const compared: Series[] = [];
  for (const v of selected) {
    if (v === "n1") compared.push(shifted(principal, 12, "n1", "N-1"));
    else if (v === "reel") {
      const ctx = await loadPayrollContext(slug);
      // Sans journal PayFit (source DSN, lecture absente) : chaque mois est n.d. avec la raison réelle.
      const why = ctx.unavailable ?? (ctx.source === "dsn" ? "source RH retenue : DSN — journal de paie PayFit non lu" : "journal de paie indisponible");
      compared.push(ctx.input ? liveSeries("reel", "Réel courant", ctx.input, ctx.kpi.input) : { key: "reel", label: "Réel courant", points: new Map(monthRange(`${year}-01`, `${year}-12`).map((m) => [m, { month: m, kind: "nd" as const, reason: why }])) });
    } else if (v.startsWith("budget:")) {
      const b = budgets.find((x) => x.id === v.slice(7));
      if (b) compared.push(budgetSeries(`budget-${b.id.slice(0, 8)}`, `Budget « ${b.name} »`, b.year, b.amounts));
    } else if (v.startsWith("scenario:")) {
      const o = await getScenario(workspaceId, v.slice(9));
      if (o) compared.push(scenarioSeries(`scenario-${o.scenario.id.slice(0, 8)}`, `« ${o.scenario.name} »`, o.base, project(o.base, o.scenario.firstMonth, o.scenario.lastMonth, o.hypotheses, o.scenario.conventions)));
    }
  }
  return { years, year, options, selected, principal, compared };
}
