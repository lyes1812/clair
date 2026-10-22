import { DEFAULT_PREFIXES, parseGrid, type AccountGrid } from "./payroll/grid";
import { getSettingMeta, setSetting } from "./settings";

// Grille de comptes de la masse salariale (paramètre de l'espace). Défaut proposé : grille du script d'actualisation
// PayFit de Lyes, affichée avec son origine et modifiable par un administrateur.
export const PAYROLL_GRID_KEY = "rh.payroll.accountGrid";
export type PayrollGrid = { grid: AccountGrid; origin: "default" | "setting"; updatedAt: Date | null };

export async function getPayrollGrid(workspaceId: string): Promise<PayrollGrid> {
  const meta = await getSettingMeta(workspaceId, PAYROLL_GRID_KEY, parseGrid);
  return meta ? { grid: meta.value, origin: "setting", updatedAt: meta.updatedAt } : { grid: DEFAULT_PREFIXES, origin: "default", updatedAt: null };
}

export async function setPayrollGrid(workspaceId: string, grid: AccountGrid, actorUserId: string): Promise<void> {
  const parsed = parseGrid(grid);
  if (!parsed) throw new Error("Grille de comptes invalide (préfixes de 2 à 10 chiffres, chacun dans une seule rubrique).");
  await setSetting(workspaceId, PAYROLL_GRID_KEY, parsed, actorUserId);
}
