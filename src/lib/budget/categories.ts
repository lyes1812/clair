import { getSetting, setSetting } from "@/lib/settings";
import { CATEGORY_IDS, type CategoryId } from "./types";

// Catégories de contrat (CDI, CDD, apprenti, stagiaire) : proposées depuis le code de nature DSN du contrat, selon une
// table de l'espace (Paramètres › Projection), puis corrigées salarié par salarié par une hypothèse « catégorie ».
// PayFit code certains apprentis en CDD : la nature seule ne suffit pas, d'où la correction par salarié.
export type CategoryNatures = Record<CategoryId, string[]>;
export const CATEGORY_NATURES_KEY = "rh.projection.categoryNatures";
// Valeur proposée (nomenclature DSN : 01 CDI, 02 CDD, 29 convention de stage) ; affichée et modifiable dans Paramètres.
export const DEFAULT_CATEGORY_NATURES: CategoryNatures = { cdi: ["01"], cdd: ["02"], apprenti: [], stagiaire: ["29"] };

export function parseCategoryNatures(v: unknown): CategoryNatures | null {
  if (!v || typeof v !== "object") return null;
  const out = {} as CategoryNatures;
  const seen = new Set<string>();
  for (const id of CATEGORY_IDS) {
    const list = (v as Record<string, unknown>)[id];
    if (!Array.isArray(list) || list.some((c) => typeof c !== "string" || !/^\d{2}$/.test(c))) return null;
    for (const c of list as string[]) {
      if (seen.has(c)) return null; // un code dans une seule catégorie
      seen.add(c);
    }
    out[id] = [...(list as string[])];
  }
  return out;
}

export async function getCategoryNatures(workspaceId: string): Promise<{ natures: CategoryNatures; origin: "default" | "setting" }> {
  const v = await getSetting(workspaceId, CATEGORY_NATURES_KEY, parseCategoryNatures);
  return v ? { natures: v, origin: "setting" } : { natures: DEFAULT_CATEGORY_NATURES, origin: "default" };
}

export async function setCategoryNatures(workspaceId: string, v: unknown, actorUserId: string): Promise<void> {
  const p = parseCategoryNatures(v);
  if (!p) throw new Error("Codes de nature invalides : deux chiffres, chaque code dans une seule catégorie.");
  await setSetting(workspaceId, CATEGORY_NATURES_KEY, p, actorUserId);
}

export const categoryOfNature = (nature: string | null, map: CategoryNatures): CategoryId | null => (nature === null ? null : (CATEGORY_IDS.find((id) => map[id].includes(nature)) ?? null));
