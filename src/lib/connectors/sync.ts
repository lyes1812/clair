import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { connectorCredential, sourceRecord, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { canonicalJson, decryptSecret, encryptSecret, sha256 } from "@/lib/crypto";
import { recordEvent } from "@/lib/events";
import { ProviderError } from "./http";
import { createPayFitClient, readPayFit } from "./payfit/client";
import { createFixtureFetch, fixtureProvidersEnabled, isFixtureKey } from "./payfit/fixture";
import type { CollectionOutcome, ProviderId, SourceRecordInput } from "./types";

export type SyncStatus = "running" | "preview" | "applied" | "superseded" | "discarded" | "failed" | "unchanged";

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  running: "Lecture en cours",
  preview: "Aperçu à valider",
  applied: "Appliquée (active)",
  superseded: "Remplacée",
  discarded: "Abandonnée",
  failed: "Échec",
  unchanged: "Aucun changement",
};

const STALE_AFTER_MS = 15 * 60 * 1000;

export type CollectionDiff = { total: number; added: number; changed: number; removed: number };
export type SyncSummary = {
  company?: { id: string; name: string; identificationNumber: string | null };
  scopes?: string[];
  collections?: CollectionOutcome[];
  diff?: Record<string, CollectionDiff>;
  months?: string[];
};

const secretContext = (workspaceId: string, provider: ProviderId) => `${workspaceId}:${provider}`;

// --- Clés

export function payfitClientFor(apiKey: string) {
  if (isFixtureKey(apiKey)) {
    if (!fixtureProvidersEnabled()) throw new ProviderError("key_rejected", "clé fictive refusée sur cet environnement");
    return createPayFitClient(apiKey, { fetchImpl: createFixtureFetch(apiKey), minIntervalMs: 0 });
  }
  return createPayFitClient(apiKey);
}

export async function verifyPayFitKey(apiKey: string) {
  const client = payfitClientFor(apiKey.trim());
  const identity = await client.introspect();
  const company = await client.company(identity.companyId);
  return { companyId: company.id, companyName: company.name, scopes: identity.scopes };
}

export async function saveCredential(
  workspaceId: string,
  provider: ProviderId,
  apiKey: string,
  verified: { companyId: string; companyName: string; scopes: string[] },
  actorUserId: string,
) {
  const sealed = encryptSecret(apiKey.trim(), secretContext(workspaceId, provider));
  const now = new Date();
  await withWorkspace(workspaceId, (tx) =>
    tx
      .insert(connectorCredential)
      .values({
        workspaceId,
        provider,
        sealedSecret: sealed,
        externalCompanyId: verified.companyId,
        companyName: verified.companyName,
        scopes: verified.scopes,
        status: "verified",
        lastVerifiedAt: now,
        createdBy: actorUserId,
      })
      .onConflictDoUpdate({
        target: [connectorCredential.workspaceId, connectorCredential.provider],
        set: {
          sealedSecret: sealed,
          externalCompanyId: verified.companyId,
          companyName: verified.companyName,
          scopes: verified.scopes,
          status: "verified",
          lastVerifiedAt: now,
          updatedAt: now,
        },
      }),
  );
  await recordEvent(workspaceId, actorUserId, "connector.connected", { provider, companyName: verified.companyName, scopes: verified.scopes });
}

export async function deleteCredential(workspaceId: string, provider: ProviderId, actorUserId: string) {
  await withWorkspace(workspaceId, (tx) =>
    tx.delete(connectorCredential).where(and(eq(connectorCredential.workspaceId, workspaceId), eq(connectorCredential.provider, provider))),
  );
  await recordEvent(workspaceId, actorUserId, "connector.disconnected", { provider });
}

// Vue publique d'une connexion : jamais le secret.
export async function getConnection(workspaceId: string, provider: ProviderId) {
  const [row] = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({
        companyName: connectorCredential.companyName,
        externalCompanyId: connectorCredential.externalCompanyId,
        scopes: connectorCredential.scopes,
        status: connectorCredential.status,
        lastVerifiedAt: connectorCredential.lastVerifiedAt,
        updatedAt: connectorCredential.updatedAt,
      })
      .from(connectorCredential)
      .where(and(eq(connectorCredential.workspaceId, workspaceId), eq(connectorCredential.provider, provider))),
  );
  return row ?? null;
}

async function readSecret(workspaceId: string, provider: ProviderId): Promise<string> {
  const [row] = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ sealed: connectorCredential.sealedSecret })
      .from(connectorCredential)
      .where(and(eq(connectorCredential.workspaceId, workspaceId), eq(connectorCredential.provider, provider))),
  );
  if (!row) throw new ProviderError("key_rejected", "aucune clé configurée");
  try {
    return decryptSecret(row.sealed, secretContext(workspaceId, provider));
  } catch {
    throw new ProviderError("key_rejected", "clé enregistrée illisible : reconnectez la source");
  }
}

// --- Synchronisations

export class SyncError extends Error {}

async function expireStale(workspaceId: string) {
  await withWorkspace(workspaceId, (tx) =>
    tx
      .update(sourceSync)
      .set({ status: "failed", errorCode: "timeout", errorMessage: "Lecture interrompue (serveur redémarré ou délai dépassé).", finishedAt: new Date() })
      .where(and(eq(sourceSync.status, "running"), lt(sourceSync.startedAt, new Date(Date.now() - STALE_AFTER_MS)))),
  );
}

async function activeSyncId(tx: Parameters<Parameters<typeof withWorkspace>[1]>[0], provider: ProviderId): Promise<string | null> {
  const [row] = await tx
    .select({ id: sourceSync.id })
    .from(sourceSync)
    .where(and(eq(sourceSync.provider, provider), eq(sourceSync.status, "applied")))
    .orderBy(desc(sourceSync.decidedAt))
    .limit(1);
  return row?.id ?? null;
}

export async function startSync(workspaceId: string, provider: ProviderId, months: string[], actorUserId: string): Promise<string> {
  await expireStale(workspaceId);
  const id = await withWorkspace(workspaceId, async (tx) => {
    const running = await tx
      .select({ id: sourceSync.id })
      .from(sourceSync)
      .where(and(eq(sourceSync.provider, provider), inArray(sourceSync.status, ["running"])))
      .limit(1);
    if (running.length) throw new SyncError("Une lecture est déjà en cours pour cette source.");
    const [row] = await tx
      .insert(sourceSync)
      .values({ workspaceId, provider, status: "running", scope: { months }, requestedBy: actorUserId })
      .returning({ id: sourceSync.id });
    return row.id;
  });
  void runSync(workspaceId, provider, id, months);
  return id;
}

export function contentHash(records: SourceRecordInput[]): { hash: string; hashes: Map<string, string> } {
  const hashes = new Map<string, string>();
  for (const r of records) hashes.set(`${r.collection}\u0000${r.key}`, sha256(canonicalJson({ period: r.period, data: r.data })));
  const sorted = [...hashes.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  return { hash: sha256(canonicalJson(sorted)), hashes };
}

export function diffByCollection(baseline: Map<string, string>, current: Map<string, string>): Record<string, CollectionDiff> {
  const out: Record<string, CollectionDiff> = {};
  const get = (key: string) => (out[key.split("\u0000")[0]] ??= { total: 0, added: 0, changed: 0, removed: 0 });
  for (const [key, hash] of current) {
    const d = get(key);
    d.total += 1;
    const before = baseline.get(key);
    if (before === undefined) d.added += 1;
    else if (before !== hash) d.changed += 1;
  }
  for (const key of baseline.keys()) if (!current.has(key)) get(key).removed += 1;
  return out;
}

export async function runSync(workspaceId: string, provider: ProviderId, syncId: string, months: string[]) {
  try {
    if (provider !== "payfit") throw new ProviderError("unavailable", "connecteur non disponible");
    const apiKey = await readSecret(workspaceId, provider);
    const result = await readPayFit(payfitClientFor(apiKey), months);
    const { hash, hashes } = contentHash(result.records);

    await withWorkspace(workspaceId, async (tx) => {
      const baselineId = await activeSyncId(tx, provider);
      const baseline = new Map<string, string>();
      let baselineHash: string | null = null;
      if (baselineId) {
        const [b] = await tx.select({ hash: sourceSync.contentHash }).from(sourceSync).where(eq(sourceSync.id, baselineId));
        baselineHash = b?.hash ?? null;
        const rows = await tx
          .select({ collection: sourceRecord.collection, key: sourceRecord.recordKey, hash: sourceRecord.recordHash })
          .from(sourceRecord)
          .where(eq(sourceRecord.syncId, baselineId));
        for (const r of rows) baseline.set(`${r.collection}\u0000${r.key}`, r.hash);
      }
      const summary: SyncSummary = {
        company: { id: result.company.id, name: result.company.name, identificationNumber: result.company.identificationNumber },
        scopes: result.scopes,
        collections: result.collections,
        diff: diffByCollection(baseline, hashes),
        months,
      };
      const unchanged = baselineHash === hash;
      if (!unchanged) {
        const rows = result.records.map((r) => ({
          workspaceId,
          syncId,
          collection: r.collection,
          recordKey: r.key,
          period: r.period,
          data: r.data,
          recordHash: hashes.get(`${r.collection}\u0000${r.key}`)!,
        }));
        for (let i = 0; i < rows.length; i += 500) await tx.insert(sourceRecord).values(rows.slice(i, i + 500));
      }
      await tx
        .update(sourceSync)
        .set({
          status: unchanged ? "unchanged" : "preview",
          baselineSyncId: baselineId,
          contentHash: hash,
          summary,
          warnings: result.warnings,
          finishedAt: new Date(),
        })
        .where(eq(sourceSync.id, syncId));
    });
  } catch (e) {
    const known = e instanceof ProviderError;
    if (!known) console.error("[sync] échec interne", provider, e instanceof Error ? e.name : "inconnu");
    await withWorkspace(workspaceId, (tx) =>
      tx
        .update(sourceSync)
        .set({
          status: "failed",
          errorCode: known ? e.code : "internal",
          errorMessage: known ? e.message : "Erreur interne pendant la lecture.",
          finishedAt: new Date(),
        })
        .where(eq(sourceSync.id, syncId)),
    ).catch(() => {});
  }
}

export async function applySync(workspaceId: string, syncId: string, actorUserId: string) {
  const provider = await withWorkspace(workspaceId, async (tx) => {
    const [sync] = await tx.select().from(sourceSync).where(eq(sourceSync.id, syncId)).for("update");
    if (!sync) throw new SyncError("Synchronisation introuvable.");
    if (sync.status !== "preview") throw new SyncError("Seul un aperçu peut être appliqué.");
    const active = await activeSyncId(tx, sync.provider as ProviderId);
    if (active !== sync.baselineSyncId) throw new SyncError("La source a changé depuis cet aperçu : relancez une lecture.");
    const now = new Date();
    if (active) await tx.update(sourceSync).set({ status: "superseded" }).where(eq(sourceSync.id, active));
    await tx.update(sourceSync).set({ status: "applied", decidedBy: actorUserId, decidedAt: now }).where(eq(sourceSync.id, syncId));
    return sync.provider;
  });
  await recordEvent(workspaceId, actorUserId, "source.applied", { provider, syncId });
}

export async function discardSync(workspaceId: string, syncId: string, actorUserId: string) {
  const provider = await withWorkspace(workspaceId, async (tx) => {
    const [sync] = await tx.select().from(sourceSync).where(eq(sourceSync.id, syncId)).for("update");
    if (!sync || sync.status !== "preview") throw new SyncError("Seul un aperçu peut être abandonné.");
    await tx.delete(sourceRecord).where(eq(sourceRecord.syncId, syncId));
    await tx.update(sourceSync).set({ status: "discarded", decidedBy: actorUserId, decidedAt: new Date() }).where(eq(sourceSync.id, syncId));
    return sync.provider;
  });
  await recordEvent(workspaceId, actorUserId, "source.discarded", { provider, syncId });
}

export async function listSyncs(workspaceId: string, provider: ProviderId, limit = 30) {
  await expireStale(workspaceId);
  return withWorkspace(workspaceId, (tx) =>
    tx.select().from(sourceSync).where(eq(sourceSync.provider, provider)).orderBy(desc(sourceSync.startedAt)).limit(limit),
  );
}

export async function getSync(workspaceId: string, syncId: string) {
  await expireStale(workspaceId);
  const [row] = await withWorkspace(workspaceId, (tx) => tx.select().from(sourceSync).where(eq(sourceSync.id, syncId)));
  return row ?? null;
}

export async function lastSync(workspaceId: string, provider: ProviderId) {
  const [row] = await withWorkspace(workspaceId, (tx) =>
    tx
      .select()
      .from(sourceSync)
      .where(and(eq(sourceSync.provider, provider), sql`${sourceSync.status} <> 'running'`))
      .orderBy(desc(sourceSync.startedAt))
      .limit(1),
  );
  return row ?? null;
}

export async function activeSync(workspaceId: string, provider: ProviderId) {
  return withWorkspace(workspaceId, async (tx) => {
    const id = await activeSyncId(tx, provider);
    if (!id) return null;
    const [row] = await tx.select().from(sourceSync).where(eq(sourceSync.id, id));
    return row ?? null;
  });
}

// Échantillon des enregistrements d'une synchronisation (aperçu à l'écran).
export async function sampleRecords(workspaceId: string, syncId: string, collection: string, limit = 20) {
  return withWorkspace(workspaceId, (tx) =>
    tx
      .select({ key: sourceRecord.recordKey, period: sourceRecord.period, data: sourceRecord.data })
      .from(sourceRecord)
      .where(and(eq(sourceRecord.syncId, syncId), eq(sourceRecord.collection, collection)))
      .orderBy(sourceRecord.recordKey)
      .limit(limit),
  );
}
