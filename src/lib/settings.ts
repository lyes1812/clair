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
