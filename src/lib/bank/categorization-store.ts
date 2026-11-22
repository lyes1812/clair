import { and, eq, inArray, sql } from "drizzle-orm";
import { sourceRecord, workspaceEvent, workspaceSetting } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { CATEGORIZATION_KEY, emptyCategorization, parseCategorization, type CategorizationSettings } from "./categories";

export class CategorizationError extends Error {}

export async function getCategorization(workspaceId: string): Promise<CategorizationSettings> {
  const [row] = await withWorkspace(workspaceId, (tx) => tx.select({ value: workspaceSetting.value }).from(workspaceSetting)
    .where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, CATEGORIZATION_KEY))));
  if (!row) return emptyCategorization();
  const parsed = parseCategorization(row.value);
  if (!parsed) throw new CategorizationError("Catégories enregistrées illisibles. Aucune valeur n’a été remplacée.");
  return parsed;
}

/**
 * Modifie les catégories sous verrou (deux saisies simultanées ne s'écrasent pas). Le journal ne reçoit ni libellé ni
 * montant : seulement l'opération et des comptes.
 */
export async function updateCategorization(workspaceId: string, actor: string | null, change: (current: CategorizationSettings) => CategorizationSettings, operation: string, counts: Record<string, number> = {}): Promise<CategorizationSettings> {
  return withWorkspace(workspaceId, async (tx) => {
    await tx.insert(workspaceSetting).values({ workspaceId, key: CATEGORIZATION_KEY, value: emptyCategorization(), updatedBy: actor }).onConflictDoNothing();
    const [row] = await tx.select({ value: workspaceSetting.value }).from(workspaceSetting)
      .where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, CATEGORIZATION_KEY))).for("update");
    const current = row ? parseCategorization(row.value) : null;
    if (!current) throw new CategorizationError("Catégories enregistrées illisibles. Aucune valeur n’a été remplacée.");
    const next = parseCategorization(change(current));
    if (!next) throw new CategorizationError("Catégories invalides après modification. Rien n’a été enregistré.");
    await tx.update(workspaceSetting).set({ value: next, updatedBy: actor, updatedAt: new Date() })
      .where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, CATEGORIZATION_KEY)));
    await tx.insert(workspaceEvent).values({ workspaceId, actorUserId: actor, kind: "bank.categorized", detail: { operation, ...counts } });
    return next;
  });
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Noms de personnes physiques connus de l'espace, à pseudonymiser avant tout envoi : salariés (PayFit, DSN) et tiers des
 * comptes de personnel et d'associés du FEC (421, 425, 455). Lus en base, jamais renvoyés à l'écran.
 */
export async function personNames(workspaceId: string): Promise<string[]> {
  return withWorkspace(workspaceId, async (tx) => {
    const people = await tx.select({ data: sourceRecord.data }).from(sourceRecord).where(inArray(sourceRecord.collection, ["collaborators", "people"]));
    const tiers = await tx.selectDistinct({ label: sql<string | null>`${sourceRecord.data}->>'auxiliaryLabel'` }).from(sourceRecord).where(and(
      eq(sourceRecord.collection, "ledger_lines"), sql`${sourceRecord.data}->>'accountId' ~ '^(421|425|455)'`, sql`${sourceRecord.data}->>'auxiliaryLabel' is not null`,
    ));
    const out = new Set<string>();
    for (const { data } of people) {
      const d = data as Record<string, unknown>;
      const first = text(d.firstName) ?? text(d.givenNames);
      for (const last of [text(d.lastName), text(d.familyName), text(d.usageName)]) {
        if (!last) continue;
        out.add(last);
        if (first) { out.add(`${first} ${last}`); out.add(`${last} ${first}`); }
      }
    }
    for (const { label } of tiers) if (label) out.add(label);
    return [...out];
  });
}
