import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { sourceRecord, sourceSync } from "@/db/schema";
import type { WorkspaceTransaction } from "@/db/workspace-scope";
import { sha256 } from "@/lib/crypto";
import { dsnCoverageIn } from "@/lib/dsn/import";
import { opaqueId, type SnapshotInputs, type SnapshotRecord } from "./snapshot";

type Tx = WorkspaceTransaction;
export type Sources = { dsn: { available: boolean }; payfit: { available: boolean; referenceDate: string | null } };
export type SourceProbe = { months: string[]; sources: Sources; inputs: SnapshotInputs };

// Les payloads, clés de déclaration, NIR/NTT et noms de fichiers ne sont jamais chargés
// dans le snapshot. Les quelques clés de regroupement ne quittent pas cet adaptateur.
export async function sourceInputsIn(tx: Tx, workspaceId: string, controlMonth: string): Promise<SourceProbe> {
  const dsnSyncs = await tx.select({ id: sourceSync.id, contentHash: sourceSync.contentHash }).from(sourceSync)
    .where(and(eq(sourceSync.provider, "dsn"), eq(sourceSync.status, "applied"))).orderBy(sourceSync.id);
  const coverage = await dsnCoverageIn(tx);
  const monthCoverage = coverage.filter((r) => r.month === controlMonth);
  const selectedPairs = monthCoverage.flatMap((r) => r.status === "blocked" ? [] : r.selected.map((d) => ({ syncId: d.sourceId, key: d.key })));
  const dsnRecords = selectedPairs.length ? await tx.select({
    id: sourceRecord.id, syncId: sourceRecord.syncId, recordHash: sourceRecord.recordHash, collection: sourceRecord.collection, period: sourceRecord.period,
    data: sql<SnapshotRecord["data"]>`case when ${sourceRecord.collection} = 'people' then jsonb_build_object(
      'entityId', ${sourceRecord.data}->'personId', 'familyName', ${sourceRecord.data}->'familyName', 'givenNames', ${sourceRecord.data}->'givenNames')
      else jsonb_build_object('entityId', ${sourceRecord.data}->'contractId', 'personId', ${sourceRecord.data}->'personId',
      'startDate', ${sourceRecord.data}->'startDate', 'endDate', ${sourceRecord.data}->'endDate', 'nature', ${sourceRecord.data}->'nature') end`,
  }).from(sourceRecord).where(and(
    eq(sourceRecord.period, controlMonth), inArray(sourceRecord.collection, ["people", "contracts"]),
    or(...selectedPairs.map((p) => and(eq(sourceRecord.syncId, p.syncId), sql`${sourceRecord.data}->>'declarationKey' = ${p.key}`))),
  )).orderBy(sourceRecord.id) : [];
  const [payfit] = await tx.select({ id: sourceSync.id, contentHash: sourceSync.contentHash, startedAt: sourceSync.startedAt, summary: sourceSync.summary }).from(sourceSync)
    .where(and(eq(sourceSync.provider, "payfit"), eq(sourceSync.status, "applied"))).orderBy(desc(sourceSync.decidedAt), desc(sourceSync.startedAt), desc(sourceSync.id)).limit(1);
  const payfitRecords = payfit ? await tx.select({
    id: sourceRecord.id, syncId: sourceRecord.syncId, recordHash: sourceRecord.recordHash, collection: sourceRecord.collection, period: sourceRecord.period,
    data: sql<SnapshotRecord["data"]>`case when ${sourceRecord.collection} = 'collaborators' then jsonb_build_object(
      'entityId', ${sourceRecord.data}->'id', 'familyName', ${sourceRecord.data}->'lastName', 'givenNames', ${sourceRecord.data}->'firstName')
      else jsonb_build_object('entityId', ${sourceRecord.data}->'contractId', 'personId', ${sourceRecord.data}->'collaboratorId',
      'startDate', ${sourceRecord.data}->'startDate', 'endDate', ${sourceRecord.data}->'endDate', 'nature', ${sourceRecord.data}->'natureContratDsn') end`,
  }).from(sourceRecord).where(and(eq(sourceRecord.syncId, payfit.id), inArray(sourceRecord.collection, ["collaborators", "contracts"]))).orderBy(sourceRecord.id) : [];
  const collections = Array.isArray(payfit?.summary.collections) ? payfit.summary.collections as { collection?: unknown; status?: unknown }[] : [];
  const missingCollections: ("persons" | "contracts")[] = [];
  if (payfit) {
    if (!collections.some((c) => c.collection === "collaborators" && c.status === "read")) missingCollections.push("persons");
    if (!collections.some((c) => c.collection === "contracts" && c.status === "read")) missingCollections.push("contracts");
  }
  const referenceDate = payfit ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(payfit.startedAt) : null;
  return {
    months: [...new Set(coverage.map((r) => r.month))].sort().reverse(),
    sources: { dsn: { available: dsnSyncs.length > 0 }, payfit: { available: Boolean(payfit), referenceDate } },
    inputs: {
      workspaceId, controlMonth, dsnSyncs, dsnRecords, payfitRecords,
      coverage: monthCoverage.map((r) => ({ id: opaqueId(workspaceId, "dsn", "coverage", r.siret), month: r.month, status: r.status,
        selected: r.selected.map((d) => ({ syncId: d.sourceId, keyHash: sha256(d.key) })) })),
      payfitSync: payfit && referenceDate ? { id: payfit.id, contentHash: payfit.contentHash, referenceDate, missingCollections } : null,
    },
  };
}
