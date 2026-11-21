import { and, eq, inArray } from "drizzle-orm";
import { sourceRecord, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import type { AgedInvoice } from "./parser";
import type { AgedSyncSummary } from "./import";

export type AgedBalance = { syncId: string; asOf: string; filename: string; pending: boolean; invoices: AgedInvoice[] };

/** Balance âgée en vigueur (la dernière appliquée), ou l'aperçu `previewSyncId` pour montrer ce que donnera l'application. */
export async function readAgedBalance(workspaceId: string, previewSyncId?: string): Promise<AgedBalance | null> {
  return withWorkspace(workspaceId, async (tx) => {
    const where = previewSyncId
      ? and(eq(sourceSync.id, previewSyncId), eq(sourceSync.provider, "aged"), inArray(sourceSync.status, ["preview", "applied"]))
      : and(eq(sourceSync.provider, "aged"), eq(sourceSync.status, "applied"));
    const syncs = await tx.select({ id: sourceSync.id, status: sourceSync.status, summary: sourceSync.summary, decidedAt: sourceSync.decidedAt }).from(sourceSync).where(where);
    const sync = syncs.sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];
    if (!sync) return null;
    const rows = await tx.select({ data: sourceRecord.data }).from(sourceRecord).where(and(eq(sourceRecord.syncId, sync.id), eq(sourceRecord.collection, "aged_invoices")));
    const summary = sync.summary as AgedSyncSummary;
    const invoices = rows.map((r) => {
      const { asOf: _a, filename: _f, ...inv } = r.data as AgedInvoice & { asOf: string; filename: string };
      return inv;
    }).sort((a, b) => a.line - b.line);
    return { syncId: sync.id, asOf: summary.asOf, filename: summary.files.find((f) => f.status === "read")?.filename ?? "", pending: sync.status !== "applied", invoices };
  });
}
