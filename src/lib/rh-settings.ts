import { CONTRACT_NATURE_LABELS } from "./dsn/labels";
import { getSetting, setSetting } from "./settings";

// Natures de contrat (nomenclature DSN) comptées dans « l'effectif » : décision de Lyes du 21/10/2026,
// CDI (01) et CDD (02) par défaut ; les autres natures sont affichées à part. Modifiable par espace.
export const HEADCOUNT_NATURES_KEY = "rh.headcount.natures";
export const DEFAULT_HEADCOUNT_NATURES = ["01", "02"] as const;

export type HeadcountNatures = { codes: string[]; origin: "default" | "setting" };

export function parseNatureCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const codes = value.filter((c): c is string => typeof c === "string" && /^\d{2}$/.test(c));
  return codes.length === value.length && codes.length > 0 ? [...new Set(codes)].sort() : null;
}

export async function getHeadcountNatures(workspaceId: string): Promise<HeadcountNatures> {
  const codes = await getSetting(workspaceId, HEADCOUNT_NATURES_KEY, parseNatureCodes);
  return codes ? { codes, origin: "setting" } : { codes: [...DEFAULT_HEADCOUNT_NATURES], origin: "default" };
}

export async function setHeadcountNatures(workspaceId: string, codes: string[], actorUserId: string): Promise<void> {
  const parsed = parseNatureCodes(codes);
  if (!parsed) throw new Error("Codes de nature invalides (deux chiffres attendus, au moins un code).");
  await setSetting(workspaceId, HEADCOUNT_NATURES_KEY, parsed, actorUserId);
}

export function natureChoices(): { code: string; label: string }[] {
  // Tri explicite par code : Object.entries place les clés numériques canoniques (« 10 », « 20 ») avant « 01 ».
  return Object.entries(CONTRACT_NATURE_LABELS).map(([code, label]) => ({ code, label })).sort((a, b) => a.code.localeCompare(b.code));
}
