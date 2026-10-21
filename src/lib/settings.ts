import { and, eq } from "drizzle-orm";
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
