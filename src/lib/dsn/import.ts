import { and, eq, inArray } from "drizzle-orm";
import { sourceRecord, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { canonicalJson, sha256, workspaceFingerprint } from "@/lib/crypto";
import { recordEvent } from "@/lib/events";
import { digestOf, knownFileHashes, listSourceFiles, storeSourceFiles, type FileOutcome, type StoredUpload } from "@/lib/connectors/files";
import { contentHash, type SyncSummary } from "@/lib/connectors/sync";
import type { CollectionOutcome, SourceRecordInput } from "@/lib/connectors/types";
import { DsnError, parseDsn, type DsnDeclaration } from "./parser";
import { selectDeclarations, type CoverageRow, type SelectableDeclaration } from "./selection";

// Import de fichiers DSN : une lecture (source_sync, fournisseur « dsn ») par dépôt, additive — les lectures appliquées
// s'additionnent et la couverture (quelle déclaration fait foi par établissement et par mois) est recalculée à chaque fois.
export type DsnUpload = { filename: string; bytes: Uint8Array };

export type DsnFileOutcome = FileOutcome;

export type DsnDeclarationSummary = {
  key: string; month: string | null; siret: string | null; type: string | null; fraction: string | null; order: string | null;
  eligible: boolean; blocking: string[]; warnings: string[]; filename: string;
  counts: { people: number; contracts: number; remunerations: number; activities: number };
};

export type DsnSyncSummary = SyncSummary & { mode: "additive"; files: DsnFileOutcome[]; declarations: DsnDeclarationSummary[]; collections: CollectionOutcome[] };

const MAX_FILES = 24;

function declarationRecords(d: DsnDeclaration, filename: string): SourceRecordInput[] {
  const content = sha256(canonicalJson({ people: d.people, contracts: d.contracts, remunerations: d.remunerations, activities: d.activities }));
  const out: SourceRecordInput[] = [
    {
      collection: "declarations",
      key: d.key,
      period: d.month,
      data: {
        key: d.key, siret: d.siret, siren: d.siren, month: d.month, nature: d.nature, type: d.type, fraction: d.fraction, order: d.order,
        eligible: d.eligible, blocking: d.blocking, warnings: d.warnings, contentHash: content, filename,
        counts: { people: d.people.length, contracts: d.contracts.length, remunerations: d.remunerations.length, activities: d.activities.length },
      },
    },
  ];
  for (const p of d.people) out.push({ collection: "people", key: `${d.key}|${p.personId}`, period: d.month, data: { ...p, declarationKey: d.key, siret: d.siret } });
  for (const c of d.contracts) out.push({ collection: "contracts", key: `${d.key}|${c.contractId}`, period: d.month, data: { ...c, declarationKey: d.key, siret: d.siret } });
  d.remunerations.forEach((r, i) => out.push({ collection: "remunerations", key: `${d.key}|${String(i).padStart(5, "0")}`, period: d.month, data: { ...r, declarationKey: d.key, siret: d.siret } }));
  d.activities.forEach((a, i) => out.push({ collection: "activities", key: `${d.key}|${String(i).padStart(5, "0")}`, period: d.month, data: { ...a, declarationKey: d.key, siret: d.siret } }));
  return out;
}

export async function importDsnFiles(workspaceId: string, uploads: DsnUpload[], actorUserId: string): Promise<string> {
  if (uploads.length === 0) throw new DsnError("empty", "Aucun fichier.");
  if (uploads.length > MAX_FILES) throw new DsnError("too_large", `${MAX_FILES} fichiers au plus par dépôt.`);
  const fingerprint = (v: string) => workspaceFingerprint(workspaceId, v);
  const files: DsnFileOutcome[] = [];
  const declarations: DsnDeclarationSummary[] = [];
  const records: SourceRecordInput[] = [];
  const toStore: StoredUpload[] = [];
  const warnings: string[] = [];
  const months = new Set<string>();

  const known = await knownFileHashes(workspaceId);
  const seenInBatch = new Set<string>();

  for (const u of uploads) {
    const digest = digestOf(u.bytes);
    const prior = known.get(digest);
    if (prior) { files.push({ filename: u.filename, status: "duplicate", sha256: digest, importedAt: prior.createdAt.toISOString() }); continue; }
    if (seenInBatch.has(digest)) { files.push({ filename: u.filename, status: "duplicate", sha256: digest, importedAt: "ce dépôt" }); continue; }
    seenInBatch.add(digest);
    try {
      const parsed = parseDsn(u.bytes, { fingerprint });
      files.push({ filename: u.filename, status: "read", sha256: parsed.hash, sizeBytes: parsed.sizeBytes, encoding: parsed.encoding, detail: `${parsed.norm ?? "norme n.d."} · ${parsed.declarations.length} déclaration(s)` });
      for (const w of parsed.warnings) if (!warnings.includes(`${u.filename} : ${w}`)) warnings.push(`${u.filename} : ${w}`);
      for (const d of parsed.declarations) {
        if (d.month) months.add(d.month);
        declarations.push({
          key: d.key, month: d.month, siret: d.siret, type: d.type, fraction: d.fraction, order: d.order, eligible: d.eligible,
          blocking: d.blocking, warnings: d.warnings, filename: u.filename,
          counts: { people: d.people.length, contracts: d.contracts.length, remunerations: d.remunerations.length, activities: d.activities.length },
        });
        records.push(...declarationRecords(d, u.filename));
      }
      toStore.push({ filename: u.filename, sha256: parsed.hash, sizeBytes: parsed.sizeBytes, encoding: parsed.encoding, bytes: u.bytes });
    } catch (e) {
      files.push({ filename: u.filename, status: "rejected", reason: e instanceof DsnError ? e.message : "Fichier illisible." });
    }
  }

  // Même déclaration dans deux fichiers du dépôt : la seconde est écartée.
  const keys = new Set<string>();
  const dedup: SourceRecordInput[] = [];
  const dropped = new Set<string>();
  for (const r of records) {
    const declKey = r.collection === "declarations" ? r.key : r.key.split("|")[0];
    if (r.collection === "declarations") {
      if (keys.has(r.key)) { dropped.add(r.key); continue; }
      keys.add(r.key);
    } else if (dropped.has(declKey)) continue;
    dedup.push(r);
  }
  if (dropped.size) warnings.push(`${dropped.size} déclaration(s) présente(s) dans plusieurs fichiers du dépôt : une seule copie retenue.`);

  const readCount = files.filter((f) => f.status === "read").length;
  const rejected = files.filter((f) => f.status === "rejected");
  const status = readCount === 0 ? (rejected.length ? "failed" : "unchanged") : "preview";
  const { hash, hashes } = contentHash(dedup);
  const collections: CollectionOutcome[] = (["declarations", "people", "contracts", "remunerations", "activities"] as const).map((c) => ({
    collection: c, status: "read", count: dedup.filter((r) => r.collection === c).length,
  }));
  const summary: DsnSyncSummary = { mode: "additive", files, declarations, collections, months: [...months].sort() };

  const syncId = await withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx
      .insert(sourceSync)
      .values({
        workspaceId, provider: "dsn", status, scope: { files: files.map((f) => f.filename), months: [...months].sort() },
        contentHash: readCount ? hash : null, summary, warnings, requestedBy: actorUserId, finishedAt: new Date(),
        errorCode: status === "failed" ? "invalid_file" : null,
        errorMessage: status === "failed" ? rejected.map((f) => `${f.filename} : ${f.reason}`).join(" ") : null,
      })
      .returning({ id: sourceSync.id });
    if (status === "preview") {
      const rows = dedup.map((r) => ({ workspaceId, syncId: row.id, collection: r.collection, recordKey: r.key, period: r.period, data: r.data, recordHash: hashes.get(`${r.collection}\u0000${r.key}`)! }));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(sourceRecord).values(rows.slice(i, i + 500));
      await storeSourceFiles(tx, workspaceId, row.id, "dsn", toStore);
    }
    return row.id;
  });
  await recordEvent(workspaceId, actorUserId, "dsn.uploaded", { syncId, files: files.length, read: readCount, duplicates: files.length - readCount - rejected.length });
  return syncId;
}

export const listDsnFiles = (workspaceId: string) => listSourceFiles(workspaceId, "dsn");

type Tx = Parameters<Parameters<typeof withWorkspace>[1]>[0];

// Couverture : déclarations retenues par établissement et par mois, calculées sur toutes les lectures appliquées.
export async function dsnCoverage(workspaceId: string, extraSyncId?: string): Promise<CoverageRow[]> {
  return withWorkspace(workspaceId, (tx) => dsnCoverageIn(tx, extraSyncId));
}

// Même calcul dans une transaction déjà ouverte (reconstruction du référentiel sous verrou).
export async function dsnCoverageIn(tx: Tx, extraSyncId?: string): Promise<CoverageRow[]> {
  const applied = await tx.select({ id: sourceSync.id }).from(sourceSync).where(and(eq(sourceSync.provider, "dsn"), eq(sourceSync.status, "applied")));
  const ids = applied.map((s) => s.id);
  if (extraSyncId && !ids.includes(extraSyncId)) ids.push(extraSyncId);
  if (ids.length === 0) return [];
  // Ordre explicite : deux copies identiques d'une déclaration dans deux dépôts donnent toujours la même sélection.
  const rows = await tx
    .select({ syncId: sourceRecord.syncId, data: sourceRecord.data })
    .from(sourceRecord)
    .where(and(inArray(sourceRecord.syncId, ids), eq(sourceRecord.collection, "declarations")))
    .orderBy(sourceRecord.syncId, sourceRecord.recordKey);
  const declarations: SelectableDeclaration[] = rows.map((r) => {
    const d = r.data as Record<string, unknown>;
    return {
      key: String(d.key), siret: (d.siret as string | null) ?? null, month: (d.month as string | null) ?? null, nature: (d.nature as string | null) ?? null,
      type: (d.type as string | null) ?? null, fraction: (d.fraction as string | null) ?? null, order: (d.order as string | null) ?? null,
      eligible: Boolean(d.eligible), blocking: (d.blocking as string[]) ?? [], sourceId: r.syncId, contentHash: String(d.contentHash),
    };
  });
  return selectDeclarations(declarations);
}
