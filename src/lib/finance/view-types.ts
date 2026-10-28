import type { SourceResolution } from "@/lib/sources";
import type { FinanceActuals, FinanceFormState, FinanceMapping, FinancePlan, FinanceProjectionMonth } from "./types";

export const FINANCE_VIEWS = [
  { id: "overview", label: "Vue d’ensemble" },
  { id: "pnl", label: "Compte de résultat" },
  { id: "mapping", label: "Modèle" },
  { id: "plans", label: "Budget et prévision" },
  { id: "variance", label: "Écarts" },
] as const;
export type FinanceViewId = typeof FINANCE_VIEWS[number]["id"];
export type FinanceAction = (previous: FinanceFormState, form: FormData) => Promise<FinanceFormState>;
export type FinanceViewProps = {
  slug: string;
  workspaceName: string;
  year: number;
  years: number[];
  from: string;
  to: string;
  view: FinanceViewId;
  months: string[];
  actuals: FinanceActuals;
  previous: FinanceActuals;
  selectedPlan: FinancePlan | null;
  projection: FinanceProjectionMonth[] | null;
  selectedBudget: FinancePlan | null;
  budgetMonths: FinanceProjectionMonth[] | null;
  plans: FinancePlan[];
  mappings: FinanceMapping[];
  revision: number;
  source: SourceResolution;
  sourceNotice: string;
  rhOptions: { id: string; name: string; firstMonth: string; lastMonth: string }[];
  canEdit: boolean;
  canAdmin: boolean;
  savePlan: FinanceAction;
  duplicatePlan: FinanceAction;
  saveMappings: FinanceAction;
};
