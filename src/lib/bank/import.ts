import { and, eq, inArray } from "drizzle-orm";
import { sourceRecord, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { encryptSecret, workspaceFingerprint } from "@/lib/crypto";
import { formatDate } from "@/lib/dates";
import { recordEvent } from "@/lib/events";
import { digestOf, knownFileHashes, listSourceFiles, safeFilename, storeSourceFiles, type FileOutcome, type StoredUpload } from "@/lib/connectors/files";
import { contentHash, type SyncSummary } from "@/lib/connectors/sync";
import type { CollectionOutcome, SourceRecordInput } from "@/lib/connectors/types";
import { continuityOf, dedupKey, type AccountRecord, type Continuity, type MovementRecord, type StatementRecord } from "./ledger";
import { BANK_FORMAT_LABELS, BankError, compactIdentifier, isValidIban, maskIdentifier, occurrenceRanks, type BankFormat, type BankParseResult, type CsvProfile } from "./model";
import { BANK_MAX_FILES, parseBankFile } from "./parser";

// Dépôt de relevés bancaires : une lecture (source_sync, fournisseur « bank ») par dépôt, additive. Les relevés qui se
// chevauchent ne créent pas de doublon : chaque mouvement porte sa clé de dédoublonnage, et la lecture des relevés
// appliqués (store.ts) ne garde qu'un mouvement par clé. L'IBAN n'est stocké que chiffré ; l'écran l'affiche masqué.

export type BankUpload = { filename: string; bytes: Uint8Array };
export type BankStatementSummary = { filename: string; format: BankFormat; masked: string; from: string; to: string; movements: number; netCents: number; opening: StatementRecord["opening"]; closing: StatementRecord["closing"]; continuity: Continuity };
export type BankSyncSummary = SyncSummary & {
  mode: "additive";
  files: FileOutcome[];
  statements: BankStatementSummary[];
  profiles: { filename: string; profile: CsvProfile }[];
  /** Mouvements déjà présents dans un relevé appliqué, ou deux fois dans ce dépôt : comptés une seule fois. */
  duplicates: { known: number; inDeposit: number };
  collections: CollectionOutcome[];
};

const accountContext = (workspaceId: string) => `${workspaceId}:bank-account`;
export const bankAccountKey = (workspaceId: string, identifier: string) => workspaceFingerprint(workspaceId, `bank:${compactIdentifier(identifier)}`);

/** IBAN saisi pour un CSV (le fichier ne le porte pas) : vide = non saisi ; invalide = erreur explicite. */
export function csvAccountFrom(raw: string | null | undefined): { identifier: string; identifierKind: "iban" } | null {
  const v = compactIdentifier(raw ?? "");
  if (!v) return null;
  if (!isValidIban(v)) throw new BankError("IBAN saisi invalide (clé de contrôle). Vérifie-le ou laisse le champ vide si tu ne déposes pas de CSV.");
  return { identifier: v, identifierKind: "iban" };
}

export async function importBankFiles(workspaceId: string, uploads: BankUpload[], actorUserId: string, options: { csvIban?: string | null } = {}): Promise<string> {
  if (uploads.length === 0) throw new BankError("Aucun fichier.");
  if (uploads.length > BANK_MAX_FILES) throw new BankError(`${BANK_MAX_FILES} fichiers au plus par dépôt.`);
  const csvAccount = csvAccountFrom(options.csvIban);
  const files: FileOutcome[] = [];
  const statements: BankStatementSummary[] = [];
  const profiles: BankSyncSummary["profiles"] = [];
  const warnings: string[] = [];
  const toStore: StoredUpload[] = [];
  const accounts = new Map<string, SourceRecordInput>();
  const statementRecords: SourceRecordInput[] = [];
  const movementRecords = new Map<string, SourceRecordInput>();
  const months = new Set<string>();
  let inDeposit = 0;
  const known = await knownFileHashes(workspaceId);
  const seenInBatch = new Set<string>();

  for (const u of uploads) {
    const filename = safeFilename(u.filename, "releve");
    const digest = digestOf(u.bytes);
    const prior = known.get(digest);
    if (prior) { files.push({ filename, status: "duplicate", sha256: digest, importedAt: prior.createdAt.toISOString() }); continue; }
    if (seenInBatch.has(digest)) { files.push({ filename, status: "duplicate", sha256: digest, importedAt: "ce dépôt" }); continue; }
    seenInBatch.add(digest);
    let parsed: BankParseResult;
    try { parsed = parseBankFile(u.bytes, { csvAccount }); }
    catch (e) { files.push({ filename, status: "rejected", reason: e instanceof BankError ? e.message : "Fichier illisible." }); continue; }

    let count = 0;
    for (const [n, st] of parsed.statements.entries()) {
      const accountKey = bankAccountKey(workspaceId, st.identifier);
      const masked = maskIdentifier(st.identifier, st.identifierKind);
      if (!accounts.has(accountKey)) {
        const data: AccountRecord & { sealedIdentifier: string } = { accountKey, masked, identifierKind: st.identifierKind, bank: st.bank, sealedIdentifier: encryptSecret(st.identifier, accountContext(workspaceId)) };
        accounts.set(accountKey, { collection: "bank_accounts", key: accountKey, period: null, data });
      }
      const ranks = occurrenceRanks(st.movements);
      st.movements.forEach((m, k) => {
        const key = dedupKey(accountKey, m, ranks[k]);
        if (movementRecords.has(key)) { inDeposit++; return; }
        const data: MovementRecord = { key, accountKey, bookingDate: m.bookingDate, valueDate: m.valueDate, amountCents: m.amountCents, label: m.label, counterparty: m.counterparty, reference: m.reference, filename };
        movementRecords.set(key, { collection: "bank_movements", key, period: m.bookingDate.slice(0, 7), data });
        months.add(m.bookingDate.slice(0, 7));
      });
      const continuity = continuityOf(st, parsed.format);
      const netCents = st.movements.reduce((t, m) => t + m.amountCents, 0);
      const rec: StatementRecord = { accountKey, filename, format: parsed.format, from: st.from, to: st.to, opening: st.opening, closing: st.closing, movementCount: st.movements.length, netCents, continuity };
      statementRecords.push({ collection: "bank_statements", key: `${filename}#${String(n + 1).padStart(4, "0")}`, period: st.to.slice(0, 7), data: rec });
      statements.push({ filename, format: parsed.format, masked, from: st.from, to: st.to, movements: st.movements.length, netCents, opening: st.opening, closing: st.closing, continuity });
      count += st.movements.length;
    }
    if (parsed.profile) profiles.push({ filename, profile: parsed.profile });
    for (const w of parsed.warnings) warnings.push(`${filename} : ${w}`);
    files.push({ filename, status: "read", sha256: digest, sizeBytes: u.bytes.length, encoding: parsed.encoding, detail: `${BANK_FORMAT_LABELS[parsed.format]} · ${parsed.statements.length} relevé(s) · ${count} mouvement(s)` });
    toStore.push({ filename, sha256: digest, sizeBytes: u.bytes.length, encoding: parsed.encoding, bytes: u.bytes });
  }

  // Mouvements déjà connus par un relevé appliqué du même compte (chevauchement de périodes).
  const keys = [...movementRecords.keys()];
  const knownKeys = new Set<string>();
  if (keys.length) {
    await withWorkspace(workspaceId, async (tx) => {
      const applied = (await tx.select({ id: sourceSync.id }).from(sourceSync).where(and(eq(sourceSync.provider, "bank"), eq(sourceSync.status, "applied")))).map((s) => s.id);
      if (!applied.length) return;
      for (let i = 0; i < keys.length; i += 1000) {
        const rows = await tx.select({ key: sourceRecord.recordKey }).from(sourceRecord)
          .where(and(inArray(sourceRecord.syncId, applied), eq(sourceRecord.collection, "bank_movements"), inArray(sourceRecord.recordKey, keys.slice(i, i + 1000))));
        for (const r of rows) knownKeys.add(r.key);
      }
    });
  }
  for (const s of statements) {
    if (s.continuity.kind === "gap") warnings.push(`${s.filename} : relevé ${s.masked} du ${formatDate(s.from)} au ${formatDate(s.to)}, solde d'ouverture + mouvements ≠ solde de clôture.`);
  }

  const all = [...accounts.values(), ...statementRecords, ...movementRecords.values()];
  const readCount = files.filter((f) => f.status === "read").length;
  const rejected = files.filter((f) => f.status === "rejected");
  const status = readCount === 0 ? (rejected.length ? "failed" : "unchanged") : "preview";
  const { hash, hashes } = contentHash(all);
  const collections: CollectionOutcome[] = (["bank_accounts", "bank_statements", "bank_movements"] as const).map((c) => ({ collection: c, status: "read", count: all.filter((r) => r.collection === c).length }));
  const summary: BankSyncSummary = { mode: "additive", files, statements, profiles, duplicates: { known: knownKeys.size, inDeposit }, collections, months: [...months].sort() };

  const syncId = await withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx.insert(sourceSync).values({
      workspaceId, provider: "bank", status, scope: { files: files.map((f) => f.filename), months: [...months].sort() },
      contentHash: readCount ? hash : null, summary, warnings, requestedBy: actorUserId, finishedAt: new Date(),
      errorCode: status === "failed" ? "invalid_file" : null,
      errorMessage: status === "failed" ? rejected.map((f) => `${f.filename} : ${f.reason}`).join(" ") : null,
    }).returning({ id: sourceSync.id });
    if (status === "preview") {
      const rows = all.map((r) => ({ workspaceId, syncId: row.id, collection: r.collection, recordKey: r.key, period: r.period, data: r.data, recordHash: hashes.get(`${r.collection}\u0000${r.key}`)! }));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(sourceRecord).values(rows.slice(i, i + 500));
      await storeSourceFiles(tx, workspaceId, row.id, "bank", toStore);
    }
    return row.id;
  });
  await recordEvent(workspaceId, actorUserId, "bank.uploaded", { syncId, files: files.length, read: readCount });
  return syncId;
}

export const listBankFiles = (workspaceId: string) => listSourceFiles(workspaceId, "bank");
