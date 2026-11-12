import { and, eq, sql } from "drizzle-orm";
import { sourceRecord } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import type { CrisisLine } from "./model";

const cents = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const text = (value: unknown): string | null => typeof value === "string" && value !== "" ? value : null;

/**
 * Écritures de bilan (comptes 16, 17, 4 et 5) d'un fichier FEC appliqué, jusqu'à la date d'arrêté incluse.
 * Un seul exercice est lu : additionner deux exercices compterait deux fois les à-nouveaux.
 */
export async function readCrisisLines(workspaceId: string, syncId: string, filename: string, asOf: string): Promise<CrisisLine[]> {
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx.select({ data: sourceRecord.data }).from(sourceRecord).where(and(
      eq(sourceRecord.syncId, syncId), eq(sourceRecord.collection, "ledger_lines"),
      sql`${sourceRecord.data}->>'filename' = ${filename}`,
      sql`${sourceRecord.data}->>'accountId' ~ '^(1[67]|4|5)'`,
      sql`${sourceRecord.data}->>'operationDate' <= ${asOf}`,
    )),
  );
  return rows.map((row) => {
    const d = row.data as Record<string, unknown>;
    return {
      accountId: String(d.accountId), accountName: text(d.accountName), auxiliary: text(d.auxiliaryAccount), auxiliaryLabel: text(d.auxiliaryLabel),
      date: String(d.operationDate), debitCents: cents(d.debitCents), creditCents: cents(d.creditCents),
    };
  });
}
