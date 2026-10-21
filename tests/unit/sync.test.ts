import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CLAIR_SECRETS_KEY ??= Buffer.alloc(32, 3).toString("base64");
process.env.CLAIR_ENABLE_FIXTURE_PROVIDERS = "true";

const { db, pool } = await import("@/db/client");
const { organization, sourceRecord, connectorCredential } = await import("@/db/schema");
const { withWorkspace } = await import("@/db/workspace-scope");
const sync = await import("@/lib/connectors/sync");
type SyncSummary = import("@/lib/connectors/sync").SyncSummary;

// Base de test migrée, rôle non superutilisateur (DATABASE_URL de test).
const run = Date.now();
const A = `test-sync-a-${run}`;
const B = `test-sync-b-${run}`;
const MONTHS = ["2025-01", "2025-02"];

async function settle(workspaceId: string, id: string) {
  for (let i = 0; i < 100; i++) {
    const s = await sync.getSync(workspaceId, id);
    if (s && s.status !== "running") return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("synchronisation bloquée");
}

async function connect(workspaceId: string, key: string) {
  const verified = await sync.verifyPayFitKey(key);
  await sync.saveCredential(workspaceId, "payfit", key, verified, null as unknown as string);
}

beforeAll(async () => {
  await db.insert(organization).values([
    { id: A, name: "Espace A", slug: A, createdAt: new Date() },
    { id: B, name: "Espace B", slug: B, createdAt: new Date() },
  ]);
});
afterAll(async () => {
  await db.delete(organization).where(sql`id in (${A}, ${B})`);
  await pool.end();
});

describe("synchronisation PayFit (transport fictif)", () => {
  let first = "";

  it("la clé est stockée chiffrée et jamais renvoyée", async () => {
    await connect(A, "fixture-A-1");
    const conn = await sync.getConnection(A, "payfit");
    expect(conn).toMatchObject({ companyName: expect.stringContaining("TEST"), status: "verified" });
    expect(JSON.stringify(conn)).not.toContain("fixture-A-1");
    const [raw] = await withWorkspace(A, (tx) => tx.select().from(connectorCredential));
    expect(raw.sealedSecret).not.toContain("fixture-A-1");
  });

  it("première lecture : aperçu, tout est nouveau, rien n'est encore actif", async () => {
    first = await sync.startSync(A, "payfit", MONTHS, null as unknown as string);
    const s = await settle(A, first);
    expect(s.status).toBe("preview");
    const diff = (s.summary as SyncSummary).diff!;
    expect(diff.collaborators).toEqual({ total: 8, added: 8, changed: 0, removed: 0 });
    expect(await sync.activeSync(A, "payfit")).toBeNull();
  });

  it("application : devient la source active", async () => {
    await sync.applySync(A, first, null as unknown as string);
    expect((await sync.activeSync(A, "payfit"))?.id).toBe(first);
  });

  it("relecture identique : « aucun changement », sans doublon d'enregistrements", async () => {
    const again = await sync.startSync(A, "payfit", MONTHS, null as unknown as string);
    const s = await settle(A, again);
    expect(s.status).toBe("unchanged");
    const [{ n }] = await withWorkspace(A, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(sourceRecord).where(sql`${sourceRecord.syncId} = ${again}`),
    );
    expect(n).toBe(0);
    expect((await sync.activeSync(A, "payfit"))?.id).toBe(first);
  });

  it("nouvelle photographie : seul l'élément corrigé apparaît comme modifié", async () => {
    await connect(A, "fixture-A-2");
    const next = await sync.startSync(A, "payfit", MONTHS, null as unknown as string);
    const s = await settle(A, next);
    expect(s.status).toBe("preview");
    const diff = (s.summary as SyncSummary).diff!;
    expect(diff.collaborators).toMatchObject({ total: 8, added: 0, removed: 0 });
    expect(diff.collaborators.changed).toBeGreaterThanOrEqual(1);
    await sync.applySync(A, next, null as unknown as string);
    expect((await sync.activeSync(A, "payfit"))?.id).toBe(next);
  });

  it("conflit : un aperçu préparé sur une ancienne référence ne peut pas être appliqué", async () => {
    await connect(A, "fixture-A-1");
    const p1 = await sync.startSync(A, "payfit", MONTHS, null as unknown as string);
    await settle(A, p1);
    const p2 = await sync.startSync(A, "payfit", ["2025-03"], null as unknown as string);
    await settle(A, p2);
    await sync.applySync(A, p1, null as unknown as string);
    await expect(sync.applySync(A, p2, null as unknown as string)).rejects.toThrow(/a changé/);
    await sync.discardSync(A, p2, null as unknown as string);
    expect((await sync.getSync(A, p2))?.status).toBe("discarded");
  });

  it("une lecture qui échoue est marquée en échec, sans enregistrement partiel", async () => {
    await withWorkspace(A, (tx) => tx.update(connectorCredential).set({ sealedSecret: "v1.invalide.invalide.invalide" }));
    const bad = await sync.startSync(A, "payfit", MONTHS, null as unknown as string);
    const s = await settle(A, bad);
    expect(s.status).toBe("failed");
    expect(s.errorMessage).not.toMatch(/fixture-/);
  });

  it("isolation : l'espace B ne voit ni la connexion ni les synchronisations de A", async () => {
    expect(await sync.getConnection(B, "payfit")).toBeNull();
    expect(await sync.listSyncs(B, "payfit")).toHaveLength(0);
    expect(await sync.getSync(B, first)).toBeNull();
  });
});
