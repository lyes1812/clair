import { desc, eq } from "drizzle-orm";
import { sourceFile, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { encryptSecret, sha256 } from "@/lib/crypto";

// Fichiers déposés (DSN, FEC) : contenu brut conservé chiffré par espace, reconnu à son empreinte SHA-256.
export type SourceFileKind = "dsn" | "fec";

export type FileOutcome =
  | { filename: string; status: "read"; sha256: string; sizeBytes: number; encoding: string; detail: string }
  | { filename: string; status: "duplicate"; sha256: string; importedAt: string }
  | { filename: string; status: "rejected"; reason: string };

export type StoredUpload = { filename: string; sha256: string; sizeBytes: number; encoding: string; bytes: Uint8Array };

const fileContext = (workspaceId: string, kind: SourceFileKind) => `${workspaceId}:${kind}-file`;

export function digestOf(bytes: Uint8Array): string {
  return sha256(Buffer.from(bytes));
}

export async function knownFileHashes(workspaceId: string) {
  const rows = await withWorkspace(workspaceId, (tx) => tx.select({ sha256: sourceFile.sha256, filename: sourceFile.filename, createdAt: sourceFile.createdAt }).from(sourceFile));
  return new Map(rows.map((r) => [r.sha256, r]));
}

type Tx = Parameters<Parameters<typeof withWorkspace>[1]>[0];

export async function storeSourceFiles(tx: Tx, workspaceId: string, syncId: string, kind: SourceFileKind, files: StoredUpload[]) {
  if (files.length === 0) return;
  await tx.insert(sourceFile).values(
    files.map((f) => ({
      workspaceId,
      syncId,
      kind,
      sha256: f.sha256,
      filename: f.filename,
      sizeBytes: f.sizeBytes,
      encoding: f.encoding,
      sealedContent: encryptSecret(Buffer.from(f.bytes).toString("base64"), fileContext(workspaceId, kind)),
    })),
  );
}

export async function listSourceFiles(workspaceId: string, kind: SourceFileKind) {
  return withWorkspace(workspaceId, (tx) =>
    tx
      .select({ id: sourceFile.id, filename: sourceFile.filename, sha256: sourceFile.sha256, sizeBytes: sourceFile.sizeBytes, createdAt: sourceFile.createdAt, syncId: sourceFile.syncId, syncStatus: sourceSync.status })
      .from(sourceFile)
      .innerJoin(sourceSync, eq(sourceFile.syncId, sourceSync.id))
      .where(eq(sourceFile.kind, kind))
      .orderBy(desc(sourceFile.createdAt)),
  );
}

// Nom de fichier sûr pour l'affichage et le stockage.
export function safeFilename(name: string, fallback: string): string {
  return name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || fallback;
}
