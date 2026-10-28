export const FINANCE_ROWS = [
  { id: "revenue", label: "Chiffre d’affaires", kind: "income" },
  { id: "other-income", label: "Autres produits", kind: "income" },
  { id: "personnel", label: "Charges de personnel", kind: "expense" },
  { id: "other-expenses", label: "Autres charges", kind: "expense" },
] as const;
export type FinanceRowId = typeof FINANCE_ROWS[number]["id"];
export type FinanceCell = { cents: number | null; reason: string | null };
export type FinanceMapping = { account: string; row: FinanceRowId };
export type FinanceMonth = { month: string; cells: Record<FinanceRowId, FinanceCell>; result: FinanceCell; lineCount: number };
export type FinanceAccount = { account: string; row: FinanceRowId; months: Record<string, FinanceCell>; total: FinanceCell; lineCount: number };
export type FinanceActuals = { months: FinanceMonth[]; accounts: FinanceAccount[] };

export type FinancePlan = {
  id: string;
  name: string;
  kind: "budget" | "forecast";
  year: number;
  currency: "EUR";
  // Budget : null ; prévision : bascule explicite entre comptabilité et hypothèses (dans l'année).
  firstForecastMonth: string | null;
  // Cents dans le sens de lecture : produits positifs, charges positives (un avoir peut être négatif).
  cells: Record<string, Partial<Record<FinanceRowId, number>>>;
  // Le scénario RH choisi remplace la ligne de personnel projetée, jamais le réel comptable.
  personnelSource: "manual" | "rh";
  rhScenarioId: string | null;
  updatedAt: string;
};
export type FinanceSettings = { version: 1; revision: number; mappings: FinanceMapping[]; plans: FinancePlan[] };
export type FinanceRhMonth = { month: string; cell: FinanceCell };
export type FinanceProjectionMonth = FinanceMonth & { origin: "actual" | "plan"; personnelOrigin: "accounting" | "manual" | "rh" };
export type FinanceFormState = { error?: string; ok?: string; details?: string[] } | undefined;
