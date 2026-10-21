import { and, eq, sql } from "drizzle-orm";
import { sourceRecord } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";

// Totaux du journal par mois et par compte, tels que lus (centimes) ; un total n'est donné
// que si toutes ses lignes ont un montant, sinon « n.d. » avec le nombre de lignes sans montant.
export async function ledgerTotals(workspaceId: string, syncId: string, accountPrefixes?: RegExp) {
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({
        period: sourceRecord.period,
        accountId: sql<string>`${sourceRecord.data}->>'accountId'`,
        accountName: sql<string | null>`min(${sourceRecord.data}->>'accountName')`,
        lines: sql<number>`count(*)::int`,
        debitCents: sql<string | null>`sum((${sourceRecord.data}->>'debitCents')::bigint)`,
        creditCents: sql<string | null>`sum((${sourceRecord.data}->>'creditCents')::bigint)`,
        missing: sql<number>`count(*) filter (where ${sourceRecord.data}->'debitCents' = 'null'::jsonb and ${sourceRecord.data}->'creditCents' = 'null'::jsonb)::int`,
      })
      .from(sourceRecord)
      .where(and(eq(sourceRecord.syncId, syncId), eq(sourceRecord.collection, "ledger_lines")))
      .groupBy(sourceRecord.period, sql`${sourceRecord.data}->>'accountId'`)
      .orderBy(sourceRecord.period, sql`${sourceRecord.data}->>'accountId'`),
  );
  return rows.filter((r) => !accountPrefixes || accountPrefixes.test(r.accountId)).map((r) => ({
    ...r,
    // null : aucune ligne n'a de montant de ce côté (affiché « — », pas 0).
    debitCents: r.debitCents === null ? null : Number(r.debitCents),
    creditCents: r.creditCents === null ? null : Number(r.creditCents),
  }));
}
