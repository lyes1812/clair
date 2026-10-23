import { getSetting, setSetting } from "@/lib/settings";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import type { KpiInput } from "@/lib/rh/kpi/types";
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

// Catégorie corrigée contrat par contrat (identifiant PayFit du contrat) : l'apprentie codée CDD par PayFit, par exemple.
// Paramètre de l'espace, utilisé par les KPI RH et copié dans les scénarios à leur création.
export type ContractCategories = Record<string, CategoryId>;
export const CONTRACT_CATEGORIES_KEY = "rh.projection.contractCategories";
export function parseContractCategories(v: unknown): ContractCategories | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: ContractCategories = {};
  for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
    if (typeof c !== "string" || !CATEGORY_IDS.includes(c as CategoryId) || k.length === 0 || k.length > 300) return null;
    out[k] = c as CategoryId;
  }
  return out;
}
export async function getContractCategories(workspaceId: string): Promise<ContractCategories> {
  return (await getSetting(workspaceId, CONTRACT_CATEGORIES_KEY, parseContractCategories)) ?? {};
}
export async function setContractCategories(workspaceId: string, v: unknown, actorUserId: string): Promise<void> {
  const p = parseContractCategories(v);
  if (!p) throw new Error("Catégories de contrat invalides.");
  await setSetting(workspaceId, CONTRACT_CATEGORIES_KEY, p, actorUserId);
}

// Catégorie d'un contrat : correction du contrat, sinon nature DSN selon la table de l'espace, sinon non classé (null).
export const categoryOfContract = (externalId: string, nature: string | null, natures: CategoryNatures, overrides: ContractCategories): CategoryId | null =>
  overrides[externalId] ?? categoryOfNature(nature, natures);

// Effectif et ETP de fin de mois par catégorie, depuis le même calcul que le KPI « ETP contractuel fin de mois » :
// la somme des catégories égale le total du KPI. Une catégorie dont un contrat n'a pas de quotité a un ETP n.d.
export type CategoryMonth =
  | { kind: "value"; month: string; lowerBound: boolean; byCategory: Record<string, { headcount: number; etp4: number | null }>; qualifiers: string[] }
  | { kind: "nd"; month: string; reason: string };
export function categoryMonth(kpi: KpiInput, month: string, natures: CategoryNatures, overrides: ContractCategories): CategoryMonth {
  const e = etpMonthEnd(kpi, month);
  if (e.kind === "nd") return { kind: "nd", month, reason: e.nd.reason };
  const byKey = new Map(kpi.data.contracts.map((c) => [c.contractKey, c]));
  const out: Record<string, { headcount: number; etp: number; nd: boolean }> = {};
  const put = (key: string, etp4: number | null) => {
    const c = byKey.get(key);
    const cat = c ? categoryOfContract(c.externalId, c.nature, natures, overrides) : null;
    const k = cat ?? "nc";
    const x = (out[k] ??= { headcount: 0, etp: 0, nd: false });
    x.headcount += 1;
    if (etp4 === null) x.nd = true;
    else x.etp += etp4;
  };
  for (const c of e.contributions) put(c.contractKey, c.etp4);
  for (const m of e.missing) put(m.contractKey, null);
  return { kind: "value", month, lowerBound: e.kind === "lower_bound", byCategory: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { headcount: v.headcount, etp4: v.nd ? null : v.etp }])), qualifiers: e.qualifiers };
}
