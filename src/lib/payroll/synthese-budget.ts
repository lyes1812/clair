import type { BudgetRow, ScenarioFull, ScenarioRow } from '@/lib/budget/store';
import { landing, project, type Landing } from '@/lib/budget/engine';
import { budgetSeries, gap, liveSeries, scenarioSeries, total, type Gap, type Total } from '@/lib/budget/series';
import { isMonth, monthRange } from '@/lib/connectors/months';
import { publicScenario } from '@/lib/viz/croisee-budget';
import type { JournalInput } from './engine';

type Budget = Pick<BudgetRow, 'id' | 'name' | 'year' | 'amounts' | 'updatedAt'> & Partial<Pick<BudgetRow, 'createdAt'>>;
type Scenario = Pick<ScenarioRow, 'id' | 'status' | 'createdAt'> & Partial<Pick<ScenarioRow, 'frozenAt'>>;
const stamp = (date: Date | null | undefined) => date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : 0;

/** Références par défaut validées : dernier budget modifié de l'année, dernier scénario figé. */
export function latestSyntheseBudget<T extends Budget>(rows: readonly T[], year: string): T | null {
  return [...rows].filter(row => row.year === year).sort((a, b) => stamp(b.updatedAt) - stamp(a.updatedAt)
    || stamp(b.createdAt) - stamp(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null;
}
export function latestFrozenScenario<T extends { scenario: Scenario }>(rows: readonly T[]): T | null {
  return [...rows].filter(row => row.scenario.status === 'fige').sort((a, b) => stamp(b.scenario.frozenAt ?? b.scenario.createdAt) - stamp(a.scenario.frozenAt ?? a.scenario.createdAt)
    || stamp(b.scenario.createdAt) - stamp(a.scenario.createdAt) || b.scenario.id.localeCompare(a.scenario.id))[0] ?? null;
}

export type SyntheseBudget = {
  budget: Budget | null;
  budgetTotal: Total;
  gap: Gap;
  landing: Landing;
  annualBudget: Total;
  annualGap: Gap | null;
  scenario: ScenarioFull['scenario'] | null;
  baseRefMonth: string | null;
  baseReadAt: string | null;
  baseDiffersFromCurrent: boolean;
};

/** Présentation seulement : réemploi des séries, de l'écart et de l'atterrissage existants. */
export function syntheseBudget(input: {
  year: string; months: string[]; journal: JournalInput | null; serviceFiltered?: boolean;
  budgets: readonly Budget[]; frozen: ScenarioFull | null; currentSyncId: string | null;
  budgetReason?: string; landingReason?: string;
}): SyntheseBudget {
  const selected = latestSyntheseBudget(input.budgets, input.year);
  const validPeriod = /^\d{4}$/.test(input.year) && input.months.length > 0 && input.months.every(month => isMonth(month) && month.startsWith(`${input.year}-`)) && new Set(input.months).size === input.months.length;
  const noBudget = input.budgetReason ?? `Aucun budget saisi pour ${input.year}.`;
  const budget = selected ? budgetSeries(`budget-${selected.id}`, selected.name, selected.year, selected.amounts) : null;
  const budgetTotal: Total = !validPeriod ? { kind: 'nd', reason: 'Période de comparaison invalide.' }
    : !budget ? { kind: 'nd', reason: noBudget } : total(budget, input.months);
  const comparison: Gap = input.serviceFiltered ? { kind: 'nd', reason: 'Le budget est global ; retirer le filtre de service pour comparer.' }
    : !validPeriod ? { kind: 'nd', reason: 'Période de comparaison invalide.' }
      : !budget ? { kind: 'nd', reason: noBudget }
        : !input.journal ? { kind: 'nd', reason: 'Journal de paie réel indisponible.' }
        : gap(liveSeries('reel', 'Réel courant', input.journal, null), budget, input.months);
  const annualMonths = /^\d{4}$/.test(input.year) ? monthRange(`${input.year}-01`, `${input.year}-12`) : [];
  const annualBudget: Total = !budget ? { kind: 'nd', reason: noBudget } : total(budget, annualMonths);
  const frozen = input.frozen?.scenario.status === 'fige' ? input.frozen : null;
  const unavailable: Landing = { kind: 'nd', year: input.year, reason: input.landingReason ?? `Aucun scénario figé disponible pour l'atterrissage ${input.year}.` };
  if (!frozen) return { budget: selected, budgetTotal, gap: comparison, landing: unavailable, annualBudget, annualGap: null, scenario: null, baseRefMonth: null, baseReadAt: null, baseDiffersFromCurrent: false };
  // Les raisons du moteur nomment les contrats ; le modèle public conserve les montants sans ces identités.
  const safe = publicScenario(frozen.base, project(frozen.base, frozen.scenario.firstMonth, frozen.scenario.lastMonth, frozen.hypotheses, frozen.scenario.conventions));
  const land: Landing = input.serviceFiltered ? { kind: 'nd', year: input.year, reason: "L’atterrissage figé est global ; retirer le filtre de service pour le lire." }
    : /^\d{4}$/.test(input.year) ? landing(safe.base, safe.proj, input.year) : unavailable;
  return {
    budget: selected, budgetTotal, gap: comparison, landing: land, annualBudget,
    annualGap: budget && !input.serviceFiltered ? gap(scenarioSeries(frozen.scenario.id, frozen.scenario.name, safe.base, safe.proj), budget, annualMonths) : null,
    scenario: frozen.scenario, baseRefMonth: frozen.base.refMonth, baseReadAt: frozen.base.readAt,
    baseDiffersFromCurrent: frozen.base.syncId !== input.currentSyncId,
  };
}
