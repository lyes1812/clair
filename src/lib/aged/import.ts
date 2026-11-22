import { and, eq } from "drizzle-orm";
import { sourceRecord, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { isIsoDate } from "@/lib/dates";
import { recordEvent } from "@/lib/events";
import { digestOf, knownFileHashes, listSourceFiles, safeFilename, storeSourceFiles, type FileOutcome } from "@/lib/connectors/files";
import { contentHash, type SyncSummary } from "@/lib/connectors/sync";
import type { CollectionOutcome, SourceRecordInput } from "@/lib/connectors/types";
import { AGED_MAX_FILES, AgedError, parseAgedFile, type AgedProfile } from "./parser";

// Dépôt d'une balance âgée fournisseurs : une lecture (fournisseur « aged ») par dépôt, arrêtée à la date saisie.
// Une seule balance est en vigueur : l'appliquer remplace la précédente.
export type AgedUpload = { filename: string; bytes: Uint8Array };
export type AgedSyncSummary = SyncSummary & {
  mode: "additive";
  files: FileOutcome[];
  asOf: string;
  invoiceCount: number;
  totalCents: number;
  profile: AgedProfile | null;
  collections: CollectionOutcome[];
};

export async function importAgedFiles(workspaceId: string, uploads: AgedUpload[], actorUserId: string, options: { asOf?: string | null } = {}): Promise<string> {
  if (uploads.length === 0) throw new AgedError("Aucun fichier.");
  if (uploads.length > AGED_MAX_FILES) throw new AgedError("Une balance âgée par dépôt.");
  const asOf = String(options.asOf ?? "").trim();
  if (!isIsoDate(asOf)) throw new AgedError("Date de la balance obligatoire : la date à laquelle les montants restant dus sont arrêtés.");
  const files: FileOutcome[] = [];
  const records: SourceRecordInput[] = [];
  const warnings: string[] = [];
  let profile: AgedProfile | null = null;
  let totalCents = 0;
  let stored: { filename: string; sha256: string; sizeBytes: number; encoding: string; bytes: Uint8Array } | null = null;
  const known = await knownFileHashes(workspaceId);
  const [u] = uploads;
  const filename = safeFilename(u.filename, "balance-agee");
  const digest = digestOf(u.bytes);
  const prior = known.get(digest);
  if (prior) files.push({ filename, status: "duplicate", sha256: digest, importedAt: prior.createdAt.toISOString() });
  else {
    try {
      const parsed = await parseAgedFile(u.bytes);
      profile = parsed.profile;
      for (const inv of parsed.invoices) {
        totalCents += inv.amountCents;
        records.push({ collection: "aged_invoices", key: `${filename}#${String(inv.line).padStart(6, "0")}`, period: asOf.slice(0, 7), data: { ...inv, asOf, filename } });
      }
      if (!Number.isSafeInteger(totalCents)) throw new AgedError("Total hors des centimes entiers sûrs.");
      const later = parsed.invoices.filter((i) => i.invoiceDate > asOf).length;
      if (later) parsed.warnings.push(`${later} facture(s) datée(s) après le ${asOf.split("-").reverse().join("/")} : vérifie la date de la balance.`);
      for (const w of parsed.warnings) warnings.push(`${filename} : ${w}`);
      files.push({ filename, status: "read", sha256: digest, sizeBytes: u.bytes.length, encoding: parsed.encoding, detail: `${parsed.invoices.length} facture(s) · arrêtée au ${asOf.split("-").reverse().join("/")}` });
      stored = { filename, sha256: digest, sizeBytes: u.bytes.length, encoding: parsed.encoding, bytes: u.bytes };
    } catch (e) {
      files.push({ filename, status: "rejected", reason: e instanceof AgedError ? e.message : "Fichier illisible." });
    }
  }

  const status = stored ? "preview" : files[0].status === "rejected" ? "failed" : "unchanged";
  const { hash, hashes } = contentHash(records);
  const replaces = stored ? (await withWorkspace(workspaceId, (tx) => tx.select({ id: sourceSync.id }).from(sourceSync).where(and(eq(sourceSync.provider, "aged"), eq(sourceSync.status, "applied"))))).map((s) => s.id) : [];
  const summary: AgedSyncSummary = {
    mode: "additive", files, asOf, invoiceCount: records.length, totalCents, profile, replaces, months: stored ? [asOf.slice(0, 7)] : [],
    collections: [{ collection: "aged_invoices", status: "read", count: records.length }],
  };
  const syncId = await withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx.insert(sourceSync).values({
      workspaceId, provider: "aged", status, scope: { files: files.map((f) => f.filename), months: summary.months },
      contentHash: stored ? hash : null, summary, warnings, requestedBy: actorUserId, finishedAt: new Date(),
      errorCode: status === "failed" ? "invalid_file" : null,
      errorMessage: status === "failed" ? files.map((f) => (f.status === "rejected" ? `${f.filename} : ${f.reason}` : "")).join(" ").trim() : null,
    }).returning({ id: sourceSync.id });
    if (stored) {
      const rows = records.map((r) => ({ workspaceId, syncId: row.id, collection: r.collection, recordKey: r.key, period: r.period, data: r.data, recordHash: hashes.get(`${r.collection}\u0000${r.key}`)! }));
      for (let i = 0; i < rows.length; i += 2000) await tx.insert(sourceRecord).values(rows.slice(i, i + 2000));
      await storeSourceFiles(tx, workspaceId, row.id, "aged", [stored]);
    }
    return row.id;
  });
  await recordEvent(workspaceId, actorUserId, "aged.uploaded", { syncId, files: files.length, read: stored ? 1 : 0 });
  return syncId;
}

export const listAgedFiles = (workspaceId: string) => listSourceFiles(workspaceId, "aged");
