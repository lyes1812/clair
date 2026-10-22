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

// Historique PayFit au-delà de la limite de conservation des contrats archivés (décision de Lyes du 22/10/2026) :
// « raw » (défaut) : chiffres tels que l'API les renvoie, avec une mention unique en tête d'écran ;
// « flagged » : mois concernés signalés (effectifs « ≥ », sorties, turnover et N-1 n.d.).
export const PAYFIT_HISTORY_KEY = "rh.payfit.historyMode";
export type PayfitHistoryMode = "raw" | "flagged";
export const DEFAULT_PAYFIT_HISTORY: PayfitHistoryMode = "raw";
export const PAYFIT_HISTORY_VALIDATED_ON = "2026-10-22";
export const parsePayfitHistoryMode = (v: unknown): PayfitHistoryMode | null => (v === "raw" || v === "flagged" ? v : null);

export async function getPayfitHistoryMode(workspaceId: string): Promise<{ mode: PayfitHistoryMode; origin: "default" | "setting" }> {
  const mode = await getSetting(workspaceId, PAYFIT_HISTORY_KEY, parsePayfitHistoryMode);
  return mode ? { mode, origin: "setting" } : { mode: DEFAULT_PAYFIT_HISTORY, origin: "default" };
}

export async function setPayfitHistoryMode(workspaceId: string, mode: PayfitHistoryMode, actorUserId: string): Promise<void> {
  if (!parsePayfitHistoryMode(mode)) throw new Error("Mode d'historique PayFit invalide.");
  await setSetting(workspaceId, PAYFIT_HISTORY_KEY, mode, actorUserId);
}
