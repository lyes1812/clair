import { and, eq, inArray } from "drizzle-orm";
import { sourceRecord, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { buildBankLedger, type AccountLedger, type AccountRecord, type MovementRecord, type StatementRecord } from "./ledger";

/**
 * Relevés appliqués de l'espace, réunis par compte et dédoublonnés. `extraSyncId` ajoute un aperçu non appliqué, pour
 * montrer dans l'aperçu ce que donnera l'application (doublons écartés, trous, historique).
 */
export async function readBankLedger(workspaceId: string, extraSyncId?: string): Promise<AccountLedger[]> {
  const rows = await withWorkspace(workspaceId, async (tx) => {
    const ids = (await tx.select({ id: sourceSync.id }).from(sourceSync).where(and(eq(sourceSync.provider, "bank"), eq(sourceSync.status, "applied")))).map((s) => s.id);
    if (extraSyncId && !ids.includes(extraSyncId)) {
      const [extra] = await tx.select({ id: sourceSync.id }).from(sourceSync).where(and(eq(sourceSync.id, extraSyncId), eq(sourceSync.provider, "bank"), eq(sourceSync.status, "preview")));
      if (extra) ids.push(extra.id);
    }
    if (!ids.length) return [];
    return tx.select({ collection: sourceRecord.collection, data: sourceRecord.data }).from(sourceRecord)
      .where(and(inArray(sourceRecord.syncId, ids), inArray(sourceRecord.collection, ["bank_accounts", "bank_statements", "bank_movements"])));
  });
  const accounts = new Map<string, AccountRecord>();
  const statements: StatementRecord[] = [];
  const movements: MovementRecord[] = [];
  for (const r of rows) {
    if (r.collection === "bank_accounts") {
      const { sealedIdentifier: _sealed, ...a } = r.data as AccountRecord & { sealedIdentifier?: string };
      if (!accounts.has(a.accountKey)) accounts.set(a.accountKey, a);
    } else if (r.collection === "bank_statements") statements.push(r.data as StatementRecord);
    else movements.push(r.data as MovementRecord);
  }
  return buildBankLedger([...accounts.values()], statements, movements);
}
