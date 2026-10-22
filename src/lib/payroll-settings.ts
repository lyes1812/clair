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

// Axe analytique du journal PayFit qui porte le service (type de code analytique). Sans choix enregistré : l'unique
// axe présent dans le journal s'il n'y en a qu'un (défaut affiché comme tel), sinon aucun.
export const PAYROLL_SERVICE_AXIS_KEY = "rh.payroll.serviceAxis";
export type ServiceAxis = { axis: string | null; origin: "setting" | "single-axis" | "none"; updatedAt: Date | null };
const parseAxis = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : v === "" ? "" : null);

export async function getServiceAxis(workspaceId: string, axesInJournal: string[]): Promise<ServiceAxis> {
  const meta = await getSettingMeta(workspaceId, PAYROLL_SERVICE_AXIS_KEY, parseAxis);
  if (meta) return { axis: meta.value || null, origin: "setting", updatedAt: meta.updatedAt };
  return axesInJournal.length === 1 ? { axis: axesInJournal[0], origin: "single-axis", updatedAt: null } : { axis: null, origin: "none", updatedAt: null };
}

export async function setServiceAxis(workspaceId: string, axis: string, actorUserId: string): Promise<void> {
  if (parseAxis(axis) === null) throw new Error("Axe analytique invalide.");
  await setSetting(workspaceId, PAYROLL_SERVICE_AXIS_KEY, axis, actorUserId);
}

export async function setPayrollGrid(workspaceId: string, grid: AccountGrid, actorUserId: string): Promise<void> {
  const parsed = parseGrid(grid);
  if (!parsed) throw new Error("Grille de comptes invalide (préfixes de 2 à 10 chiffres, chacun dans une seule rubrique).");
  await setSetting(workspaceId, PAYROLL_GRID_KEY, parsed, actorUserId);
}
