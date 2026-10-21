import { and, eq, inArray } from "drizzle-orm";
import { sourceRecord, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { recordEvent } from "@/lib/events";
import { digestOf, knownFileHashes, listSourceFiles, safeFilename, storeSourceFiles, type FileOutcome, type StoredUpload } from "@/lib/connectors/files";
import { contentHash, type SyncSummary } from "@/lib/connectors/sync";
import type { CollectionOutcome, SourceRecordInput } from "@/lib/connectors/types";
import { FecError, parseFec, parseFecFilename, type FecParseResult } from "./parser";

// Import de fichiers FEC : une lecture (source_sync, fournisseur « fec ») par dépôt, un fichier = un exercice.
// Un FEC appliqué dont la période recouvre celle d'un nouveau dépôt pour le même SIREN est remplacé à l'application.
export type FecUpload = { filename: string; bytes: Uint8Array };

export type FecExercise = {
  filename: string;
  siren: string | null;
  closingDate: string | null;
  firstDate: string;
  lastDate: string;
  lines: number;
  entries: number;
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
  unbalancedEntries: number;
  journals: { code: string; label: string; lines: number }[];
  encoding: string;
  delimiter: string;
  amountFormat: string;
  warnings: string[];
  replaces: { syncId: string; filename: string }[];
};

export type FecSyncSummary = SyncSummary & { mode: "additive"; files: FileOutcome[]; exercises: FecExercise[]; collections: CollectionOutcome[] };

const MAX_FILES = 6;
// Libellés retirés sur les comptes de personnel (noms possibles), comme pour Pennylane.
const PERSONAL_ACCOUNTS = /^(?:421|425|427|428|431|437)/;

function records(parsed: FecParseResult, siren: string | null, filename: string): SourceRecordInput[] {
  const out: SourceRecordInput[] = [];
  const accounts = new Map<string, { label: string; labels: Set<string> }>();
  for (const l of parsed.lines) {
    const a = accounts.get(l.accountId) ?? { label: l.accountName, labels: new Set<string>() };
    a.labels.add(l.accountName);
    accounts.set(l.accountId, a);
    const month = l.entryDate.slice(0, 7);
    out.push({
      collection: "ledger_lines",
      key: `${filename}#${String(l.line).padStart(7, "0")}`,
      period: month,
      data: {
        id: l.line,
        month,
        operationDate: l.entryDate,
        accountId: l.accountId,
        accountName: l.accountName,
        auxiliaryAccount: PERSONAL_ACCOUNTS.test(l.accountId) ? null : l.auxiliaryAccount,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        currency: "EUR",
        label: PERSONAL_ACCOUNTS.test(l.accountId) ? null : l.label,
        journalCode: l.journalCode,
        entryNumber: l.entryNumber,
        pieceRef: l.pieceRef,
        validationDate: l.validationDate,
        siren,
        filename,
      },
    });
  }
  for (const [number, a] of accounts) {
    out.push({ collection: "accounts", key: `${filename}#${number}`, period: null, data: { number, label: a.label, labels: a.labels.size > 1 ? [...a.labels] : undefined, filename } });
  }
  return out;
}

export async function importFecFiles(workspaceId: string, uploads: FecUpload[], actorUserId: string): Promise<string> {
  if (uploads.length === 0) throw new FecError("empty", "Aucun fichier.");
  if (uploads.length > MAX_FILES) throw new FecError("too_large", `${MAX_FILES} fichiers au plus par dépôt.`);
  const files: FileOutcome[] = [];
  const exercises: FecExercise[] = [];
  const all: SourceRecordInput[] = [];
  const toStore: StoredUpload[] = [];
  const warnings: string[] = [];
  const months = new Set<string>();
  const known = await knownFileHashes(workspaceId);
  const seenInBatch = new Set<string>();

  // Exercices déjà appliqués, pour détecter les recouvrements.
  const applied = await withWorkspace(workspaceId, (tx) =>
    tx.select({ id: sourceSync.id, summary: sourceSync.summary }).from(sourceSync).where(and(eq(sourceSync.provider, "fec"), eq(sourceSync.status, "applied"))),
  );
  const appliedExercises = applied.flatMap((s) => ((s.summary as FecSyncSummary).exercises ?? []).map((e) => ({ syncId: s.id, ...e })));

  for (const u of uploads) {
    const filename = safeFilename(u.filename, "fec.txt");
    const digest = digestOf(u.bytes);
    const prior = known.get(digest);
    if (prior) { files.push({ filename, status: "duplicate", sha256: digest, importedAt: prior.createdAt.toISOString() }); continue; }
    if (seenInBatch.has(digest)) { files.push({ filename, status: "duplicate", sha256: digest, importedAt: "ce dépôt" }); continue; }
    seenInBatch.add(digest);
    try {
      const parsed = parseFec(u.bytes);
      const named = parseFecFilename(filename);
      const siren = named?.siren ?? null;
      const fileWarnings = [...parsed.warnings];
      if (!named) fileWarnings.push("Nom de fichier hors convention <SIREN>FEC<AAAAMMJJ>.txt : SIREN et date de clôture non déduits.");
      else if (parsed.lastDate > named.closingDate) fileWarnings.push("Des écritures sont postérieures à la date de clôture indiquée dans le nom du fichier.");
      const replaces = appliedExercises
        .filter((e) => (e.siren ?? null) === siren && e.firstDate <= parsed.lastDate && e.lastDate >= parsed.firstDate)
        .map((e) => ({ syncId: e.syncId, filename: e.filename }));
      if (replaces.length) fileWarnings.push(`Période déjà couverte par ${replaces.map((r) => r.filename).join(", ")} : ce fichier le(s) remplacera à l'application.`);
      exercises.push({
        filename, siren, closingDate: named?.closingDate ?? null, firstDate: parsed.firstDate, lastDate: parsed.lastDate,
        lines: parsed.lines.length, entries: parsed.entryCount, totalDebitCents: parsed.totalDebitCents, totalCreditCents: parsed.totalCreditCents,
        balanced: parsed.balanced, unbalancedEntries: parsed.unbalancedEntries, journals: parsed.journals,
        encoding: parsed.encoding, delimiter: parsed.delimiter, amountFormat: parsed.amountFormat, warnings: fileWarnings, replaces,
      });
      files.push({ filename, status: "read", sha256: parsed.hash, sizeBytes: parsed.sizeBytes, encoding: parsed.encoding, detail: `${parsed.firstDate} → ${parsed.lastDate} · ${parsed.lines.length} ligne(s) · ${parsed.balanced ? "équilibré" : "non équilibré"}` });
      for (const w of fileWarnings) warnings.push(`${filename} : ${w}`);
      for (const l of parsed.lines) months.add(l.entryDate.slice(0, 7));
      all.push(...records(parsed, siren, filename));
      toStore.push({ filename, sha256: parsed.hash, sizeBytes: parsed.sizeBytes, encoding: parsed.encoding, bytes: u.bytes });
    } catch (e) {
      files.push({ filename, status: "rejected", reason: e instanceof FecError ? e.message : "Fichier illisible." });
    }
  }

  const readCount = files.filter((f) => f.status === "read").length;
  const rejected = files.filter((f) => f.status === "rejected");
  const status = readCount === 0 ? (rejected.length ? "failed" : "unchanged") : "preview";
  const { hash, hashes } = contentHash(all);
  const collections: CollectionOutcome[] = (["accounts", "ledger_lines"] as const).map((c) => ({ collection: c, status: "read", count: all.filter((r) => r.collection === c).length }));
  const replaces = [...new Set(exercises.flatMap((e) => e.replaces.map((r) => r.syncId)))];
  const summary: FecSyncSummary = { mode: "additive", files, exercises, collections, months: [...months].sort(), replaces };

  const syncId = await withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx
      .insert(sourceSync)
      .values({
        workspaceId, provider: "fec", status, scope: { files: files.map((f) => f.filename), months: [...months].sort() },
        contentHash: readCount ? hash : null, summary, warnings, requestedBy: actorUserId, finishedAt: new Date(),
        errorCode: status === "failed" ? "invalid_file" : null,
        errorMessage: status === "failed" ? rejected.map((f) => `${f.filename} : ${f.reason}`).join(" ") : null,
      })
      .returning({ id: sourceSync.id });
    if (status === "preview") {
      const rows = all.map((r) => ({ workspaceId, syncId: row.id, collection: r.collection, recordKey: r.key, period: r.period, data: r.data, recordHash: hashes.get(`${r.collection}\u0000${r.key}`)! }));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(sourceRecord).values(rows.slice(i, i + 500));
      await storeSourceFiles(tx, workspaceId, row.id, "fec", toStore);
    }
    return row.id;
  });
  await recordEvent(workspaceId, actorUserId, "fec.uploaded", { syncId, files: files.length, read: readCount });
  return syncId;
}

export const listFecFiles = (workspaceId: string) => listSourceFiles(workspaceId, "fec");

// Exercices en vigueur : un par FEC appliqué (non remplacé).
export async function fecCoverage(workspaceId: string, extraSyncId?: string): Promise<(FecExercise & { syncId: string; pending: boolean })[]> {
  const rows = await withWorkspace(workspaceId, async (tx) => {
    const ids = (await tx.select({ id: sourceSync.id }).from(sourceSync).where(and(eq(sourceSync.provider, "fec"), eq(sourceSync.status, "applied")))).map((s) => s.id);
    if (extraSyncId && !ids.includes(extraSyncId)) ids.push(extraSyncId);
    if (ids.length === 0) return [];
    return tx.select({ id: sourceSync.id, status: sourceSync.status, summary: sourceSync.summary }).from(sourceSync).where(inArray(sourceSync.id, ids));
  });
  const replaced = new Set(rows.flatMap((r) => ((r.summary as FecSyncSummary).replaces ?? [])).filter((id) => extraSyncId));
  return rows
    .flatMap((r) => ((r.summary as FecSyncSummary).exercises ?? []).map((e) => ({ ...e, syncId: r.id, pending: r.status !== "applied" })))
    .filter((e) => !(extraSyncId && replaced.has(e.syncId) && e.syncId !== extraSyncId))
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate));
}
