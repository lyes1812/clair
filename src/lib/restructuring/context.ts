import { BudgetError, getScenario, listScenarios, type ScenarioFull } from "@/lib/budget/store";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { buildRestructuring, type RestructuringScenario } from "./model";
import { RESTRUCTURING_VIEWS, type RestructuringViewId } from "./views";
export { RESTRUCTURING_VIEWS, type RestructuringViewId } from "./views";
export type RestructuringQuery = Record<string, string | undefined>;

const scenarioInput = (full: ScenarioFull): RestructuringScenario => ({
  id: full.scenario.id, name: full.scenario.name, status: full.scenario.status,
  firstMonth: full.scenario.firstMonth, lastMonth: full.scenario.lastMonth,
  baseHash: full.baseHash, base: full.base, hypotheses: full.hypotheses, conventions: full.scenario.conventions,
});

// Lecture uniquement : les hypothèses restent dans le moteur RH, dans leur espace et leur version.
export async function loadRestructuringContext(slug: string, query: RestructuringQuery) {
  const { workspace } = await requireWorkspace(slug);
  const scenarios = await listScenarios(workspace.id);
  const options = scenarios.map(({ scenario: s }) => ({ id: s.id, name: s.name, firstMonth: s.firstMonth, lastMonth: s.lastMonth, status: s.status }));
  const notices: string[] = [];
  const read = async (id: string | undefined, label: string): Promise<RestructuringScenario | null> => {
    if (!id) return null;
    const selected = options.find((s) => s.id.toLowerCase() === id.toLowerCase());
    if (!selected) { notices.push(`${label} indisponible dans cet espace. Choisis un scénario dans la liste.`); return null; }
    try {
      const full = await getScenario(workspace.id, selected.id);
      if (full) return scenarioInput(full);
      notices.push(`${label} indisponible. Recharge la page pour actualiser les versions.`);
      return null;
    } catch (error) {
      if (!(error instanceof BudgetError)) throw error;
      notices.push(`${label} non lisible : sa base figée ne peut pas être validée.`);
      return null;
    }
  };
  const [reference, proposal] = await Promise.all([read(query.reference, "Référence"), read(query.projet, "Projet")]);
  const view: RestructuringViewId = RESTRUCTURING_VIEWS.some((v) => v.id === query.vue) ? query.vue as RestructuringViewId : "overview";
  return {
    slug, workspaceName: workspace.name, canEdit: hasAtLeast(workspace.role, "editor"), view,
    options, reference, proposal, model: buildRestructuring(reference, proposal), notices,
  };
}
export type RestructuringContext = Awaited<ReturnType<typeof loadRestructuringContext>>;
