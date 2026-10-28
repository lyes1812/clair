import { and, desc, eq, like, sql } from "drizzle-orm";
import { sourceSync, workspaceEvent, workspaceSetting } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { canonicalJson, sha256 } from "@/lib/crypto";
import { parseActualEvent, type ActualEvent } from "./non-recurring";

export const ACTUAL_NON_RECURRING_KEY = "rh.payroll.actualNonRecurring.";
export class ActualEventError extends Error {}
export const actualEventVersion = (event: ActualEvent) => sha256(canonicalJson(event));

export async function listActualEvents(workspaceId: string): Promise<ActualEvent[]> {
  const rows = await withWorkspace(workspaceId, (tx) => tx.select({ value: workspaceSetting.value }).from(workspaceSetting).where(like(workspaceSetting.key, `${ACTUAL_NON_RECURRING_KEY}%`)).orderBy(workspaceSetting.key));
  return rows.map((row) => {
    const event = parseActualEvent(row.value);
    if (!event) throw new ActualEventError("Une déclaration du réel est illisible : aucun retraitement partiel n’est affiché.");
    return event;
  });
}

// Une ligne par événement, verrou par espace, comparaison de la version affichée et journal sans payload client.
// Ne pas utiliser setSetting : ce helper général journalise la valeur complète du paramètre.
export async function saveActualEvent(workspaceId: string, actorUserId: string, event: ActualEvent, expectedVersion: string | null): Promise<void> {
  if (!parseActualEvent(event)) throw new ActualEventError("Déclaration invalide.");
  await withWorkspace(workspaceId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`actual-non-recurring:${workspaceId}`}, 0))`);
    const [active] = await tx.select({ id: sourceSync.id }).from(sourceSync).where(and(eq(sourceSync.provider, "payfit"), eq(sourceSync.status, "applied"))).orderBy(desc(sourceSync.decidedAt)).limit(1);
    if (active?.id !== event.syncId) throw new ActualEventError("La lecture PayFit a changé. Recharge la page avant d’enregistrer.");
    const rows = await tx.select({ key: workspaceSetting.key, value: workspaceSetting.value }).from(workspaceSetting).where(like(workspaceSetting.key, `${ACTUAL_NON_RECURRING_KEY}%`));
    const previous = rows.find((row) => row.key === `${ACTUAL_NON_RECURRING_KEY}${event.id}`);
    const parsed = previous ? parseActualEvent(previous.value) : null;
    if (previous && (!parsed || !expectedVersion || actualEventVersion(parsed) !== expectedVersion)) throw new ActualEventError("Cette déclaration a changé depuis l’affichage. Recharge la page.");
    if (!previous && expectedVersion) throw new ActualEventError("Déclaration introuvable. Recharge la page.");
    if (!previous && rows.length >= 500) throw new ActualEventError("Le nombre maximal de déclarations est atteint.");
    const signature = (e: ActualEvent) => JSON.stringify([e.kind, e.month, [...e.contractKeys].sort()]);
    for (const row of rows) {
      const other = parseActualEvent(row.value);
      if (!other) throw new ActualEventError("Une déclaration du réel est illisible.");
      if (other.id !== event.id && signature(other) === signature(event)) throw new ActualEventError("Cet élément existe déjà pour ce mois et ces contrats. Modifie sa ligne.");
    }
    const now = new Date();
    await tx.insert(workspaceSetting).values({ workspaceId, key: `${ACTUAL_NON_RECURRING_KEY}${event.id}`, value: event, updatedBy: actorUserId, updatedAt: now }).onConflictDoUpdate({ target: [workspaceSetting.workspaceId, workspaceSetting.key], set: { value: event, updatedBy: actorUserId, updatedAt: now } });
    await tx.insert(workspaceEvent).values({ workspaceId, actorUserId, kind: "setting.changed", detail: { key: "rh.payroll.actualNonRecurring", operation: previous ? "updated" : "created", count: 1 } });
  });
}
