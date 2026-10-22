import { getSettingMeta, setSetting } from "@/lib/settings";
import type { Conventions, Prorata } from "./types";

// Conventions de calcul de la projection (paramètre de l'espace, administrateur). Aucune valeur par défaut : tant
// qu'elles ne sont pas saisies, Clair refuse de créer un scénario et le dit. Copiées dans le scénario à sa création.
export const PROJECTION_PRORATA_KEY = "rh.projection.prorata";
export const PRORATA_LABELS: Record<Prorata, string> = {
  calendaire: "Jours calendaires : jours payés du mois ÷ nombre de jours du mois (entrée et sortie en cours de mois)",
  aucun: "Aucun prorata : un mois commencé ou terminé compte entier",
};
export const parseProrata = (v: unknown): Prorata | null => (v === "calendaire" || v === "aucun" ? v : null);

export async function getConventions(workspaceId: string): Promise<{ conventions: Conventions; updatedAt: Date } | null> {
  const meta = await getSettingMeta(workspaceId, PROJECTION_PRORATA_KEY, parseProrata);
  return meta ? { conventions: { prorata: meta.value }, updatedAt: meta.updatedAt } : null;
}

export async function setProrata(workspaceId: string, value: unknown, actorUserId: string): Promise<void> {
  const p = parseProrata(value);
  if (!p) throw new Error("Choisissez une règle de prorata.");
  await setSetting(workspaceId, PROJECTION_PRORATA_KEY, p, actorUserId);
}
