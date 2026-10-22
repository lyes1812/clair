import { and, eq, inArray } from "drizzle-orm";
import { workspaceSetting } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { recordEvent } from "./events";

// Paramètres d'espace : lecture typée par une fonction de validation, écriture tracée dans le journal.
// Aucune valeur par défaut cachée : un paramètre absent est renvoyé comme tel (null) et c'est l'appelant qui
// décide d'afficher « n.d. » ou d'appliquer une règle explicite.
export async function getSetting<T>(workspaceId: string, key: string, parse: (value: unknown) => T | null): Promise<T | null> {
  const [row] = await withWorkspace(workspaceId, (tx) =>
    tx.select({ value: workspaceSetting.value }).from(workspaceSetting).where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, key))),
  );
  return row ? parse(row.value) : null;
}

// Valeur et traçabilité d'un paramètre (qui l'a changé, quand) : affichées à côté d'un choix forcé.
export async function getSettingMeta<T>(workspaceId: string, key: string, parse: (value: unknown) => T | null): Promise<{ value: T; updatedAt: Date; updatedBy: string | null } | null> {
  const [row] = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ value: workspaceSetting.value, updatedAt: workspaceSetting.updatedAt, updatedBy: workspaceSetting.updatedBy })
      .from(workspaceSetting)
      .where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, key))),
  );
  if (!row) return null;
  const value = parse(row.value);
  return value === null ? null : { value, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
}

// Plusieurs paramètres en une requête, avec leur traçabilité ; une clé absente n'apparaît pas dans le résultat.
export async function getSettingsMeta(workspaceId: string, keys: string[]): Promise<Map<string, { value: unknown; updatedAt: Date; updatedBy: string | null }>> {
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ key: workspaceSetting.key, value: workspaceSetting.value, updatedAt: workspaceSetting.updatedAt, updatedBy: workspaceSetting.updatedBy })
      .from(workspaceSetting)
      .where(and(eq(workspaceSetting.workspaceId, workspaceId), inArray(workspaceSetting.key, keys))),
  );
  return new Map(rows.map((r) => [r.key, { value: r.value, updatedAt: r.updatedAt, updatedBy: r.updatedBy }]));
}

export async function setSetting(workspaceId: string, key: string, value: unknown, actorUserId: string): Promise<void> {
  const now = new Date();
  await withWorkspace(workspaceId, (tx) =>
    tx
      .insert(workspaceSetting)
      .values({ workspaceId, key, value, updatedBy: actorUserId, updatedAt: now })
      .onConflictDoUpdate({ target: [workspaceSetting.workspaceId, workspaceSetting.key], set: { value, updatedBy: actorUserId, updatedAt: now } }),
  );
  await recordEvent(workspaceId, actorUserId, "setting.changed", { key, value });
}
