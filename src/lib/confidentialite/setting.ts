// Seuil de confidentialité de l'espace : un seul paramètre, rh.confidentialite.seuil (nombre entier de personnes distinctes, au moins
// 1), lu par toutes les répartitions de l'application et par leurs exports, SANS aucune valeur par défaut. Lecture en trois états
// (absent, défini, illisible), avec repli sur l'ancienne clé de la Masse salariale croisée (rh.croisee.confidentialite) tant que la
// nouvelle est absente ; écriture de la nouvelle clé seulement, tracée par un événement setting.changed.
// Ce fichier ne charge aucun module de base de données à l'import (chargés à la demande par getConfidentialite / setConfidentialite) :
// l'analyseur, la lecture pure, les raisons et le lien servent aux modules sans base (src/lib/croisee/settings-format.ts, src/lib/viz).

export const CONFIDENTIALITE_KEY = "rh.confidentialite.seuil";
export const CONFIDENTIALITE_LEGACY_KEY = "rh.croisee.confidentialite";
// Clés lues, dans l'ordre de priorité : la nouvelle, puis l'ancienne (repli).
export const CONFIDENTIALITE_KEYS: readonly string[] = [CONFIDENTIALITE_KEY, CONFIDENTIALITE_LEGACY_KEY];

export type ConfidentialiteSetting =
  | { kind: "absent" }
  | { kind: "set"; value: number; updatedAt: Date | null; updatedBy: string | null }
  | { kind: "invalid"; raw: unknown };
// Clé d'où vient la valeur lue : « seuil » (rh.confidentialite.seuil), « croisee » (ancienne clé, reprise), null (rien d'enregistré).
export type ConfidentialiteSource = "seuil" | "croisee";
export type ConfidentialiteRead = { setting: ConfidentialiteSetting; source: ConfidentialiteSource | null };

// Analyseur pur : une valeur est acceptée telle quelle ou refusée (null), jamais convertie (« 5 » en texte est refusé).
export const parseConfidentialite = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 1 ? v : null);

// Raisons d'un n.d. dû au paramètre, et lien vers la section des Paramètres où il se saisit.
export const SEUIL_NON_DEFINI = "seuil de confidentialité non défini (Paramètres)";
export const SEUIL_ILLISIBLE = "seuil de confidentialité illisible : à ré-enregistrer (Paramètres)";
export const confidentialiteHref = (slug: string): string => `/e/${slug}/parametres#confidentialite`;
export const confidentialiteSettingReason = (s: ConfidentialiteSetting): string | null => (s.kind === "set" ? null : s.kind === "absent" ? SEUIL_NON_DEFINI : SEUIL_ILLISIBLE);

export type StoredSetting = { value: unknown; updatedAt?: Date | null; updatedBy?: string | null };

// Lecture pure à partir des lignes enregistrées (clé complète → ligne, comme la table workspace_setting). La nouvelle clé l'emporte
// dès qu'elle est enregistrée, lisible ou non ; absente, l'ancienne clé est lue telle quelle (lisible ou illisible).
export function readConfidentialite(stored: ReadonlyMap<string, StoredSetting>): ConfidentialiteRead {
  const own = stored.get(CONFIDENTIALITE_KEY);
  const row = own ?? stored.get(CONFIDENTIALITE_LEGACY_KEY);
  if (!row) return { setting: { kind: "absent" }, source: null };
  const source: ConfidentialiteSource = own ? "seuil" : "croisee";
  const value = parseConfidentialite(row.value);
  if (value === null) return { setting: { kind: "invalid", raw: row.value }, source };
  return { setting: { kind: "set", value, updatedAt: row.updatedAt ?? null, updatedBy: row.updatedBy ?? null }, source };
}

// Lecture en base (une requête pour les deux clés), avec la clé d'origine.
export async function getConfidentialiteRead(workspaceId: string): Promise<ConfidentialiteRead> {
  const { getSettingsMeta } = await import("@/lib/settings");
  return readConfidentialite(await getSettingsMeta(workspaceId, [...CONFIDENTIALITE_KEYS]));
}

export async function getConfidentialite(workspaceId: string): Promise<ConfidentialiteSetting> {
  return (await getConfidentialiteRead(workspaceId)).setting;
}

// Écriture de la nouvelle clé seulement : une valeur (analysée, jamais convertie) l'enregistre ; null la supprime (retour à « non
// défini », jamais 0). Une valeur déjà enregistrée sous la nouvelle clé n'est pas réécrite ; la même valeur lue par repli sur l'ancienne
// clé est écrite (la nouvelle clé doit exister). Chaque écriture ou suppression est tracée par un événement setting.changed.
// L'ancienne clé n'est jamais touchée : supprimée, la nouvelle clé laisse l'ancienne lue par repli tant qu'elle existe.
export type ConfidentialiteWrite = "written" | "deleted" | "unchanged";
export async function setConfidentialite(workspaceId: string, value: number | null, actorUserId: string): Promise<ConfidentialiteWrite> {
  if (value !== null && parseConfidentialite(value) === null) throw new Error(`Valeur invalide pour ${CONFIDENTIALITE_KEY}.`);
  const current = await getConfidentialiteRead(workspaceId);
  const own: ConfidentialiteSetting = current.source === "seuil" ? current.setting : { kind: "absent" };
  if (value === null) {
    if (own.kind === "absent") return "unchanged";
    const [{ and, eq }, { workspaceSetting }, { withWorkspace }, { recordEvent }] = await Promise.all([import("drizzle-orm"), import("@/db/schema"), import("@/db/workspace-scope"), import("@/lib/events")]);
    await withWorkspace(workspaceId, (tx) => tx.delete(workspaceSetting).where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, CONFIDENTIALITE_KEY))));
    await recordEvent(workspaceId, actorUserId, "setting.changed", { key: CONFIDENTIALITE_KEY, value: null });
    return "deleted";
  }
  if (own.kind === "set" && own.value === value) return "unchanged";
  const { setSetting } = await import("@/lib/settings");
  await setSetting(workspaceId, CONFIDENTIALITE_KEY, value, actorUserId);
  return "written";
}
