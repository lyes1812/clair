import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { pairFingerprint } from "@/lib/reconciliation/compare";
import type { RunDetail } from "@/lib/reconciliation/store";

// Test opt-in : refuse toute base autre que la base locale fictive dédiée.
const enabled = process.env.CLAIR_RECONCILIATION_DB_TESTS === "1";
describe.skipIf(!enabled)("persistance du rapprochement (PostgreSQL fictif, rôle RLS)", () => {
  let store: typeof import("@/lib/reconciliation/store");
  let scope: typeof import("@/db/workspace-scope");
  let schema: typeof import("@/db/schema");
  let client: typeof import("@/db/client");
  const ws = `fixture-reconciliation-${randomUUID()}`;
  const other = `fixture-reconciliation-${randomUUID()}`;
  const syncA = randomUUID(), syncB = randomUUID(), payfit = randomUUID();
  const actor = `fixture-control-author-${randomUUID()}`;
  const unrelatedActor = `fixture-unrelated-author-${randomUUID()}`;
  let runId: string;
  let selected: RunDetail;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "invalid");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/clair_fixture_e2e" || url.port !== "55485" || url.username !== "clair_fixture_app") throw new Error("Dedicated fictional database required");
    [store, scope, schema, client] = await Promise.all([import("@/lib/reconciliation/store"), import("@/db/workspace-scope"), import("@/db/schema"), import("@/db/client")]);
    const roles = await client.db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(sql`select rolsuper, rolbypassrls from pg_roles where rolname=current_user`);
    expect(roles.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await client.db.insert(schema.user).values([
      { id: actor, name: "Auteur fictif du contrôle", email: `${actor}@test.invalid`, createdAt: new Date(), updatedAt: new Date() },
      { id: unrelatedActor, name: "Compte fictif sans décision", email: `${unrelatedActor}@test.invalid`, createdAt: new Date(), updatedAt: new Date() },
    ]);
    await client.db.insert(schema.organization).values([{ id: ws, name: "Espace fictif du contrôle", slug: ws, createdAt: new Date() }, { id: other, name: "Autre espace fictif", slug: other, createdAt: new Date() }]);
    await scope.withWorkspace(ws, async (tx) => {
      await tx.insert(schema.sourceSync).values([
        { id: syncA, workspaceId: ws, provider: "dsn", status: "applied", contentHash: "fixture-dsn-a", startedAt: new Date("2026-11-04T10:00:00Z"), decidedAt: new Date("2026-11-04T11:00:00Z") },
        { id: syncB, workspaceId: ws, provider: "dsn", status: "applied", contentHash: "fixture-dsn-b", startedAt: new Date("2026-11-04T10:00:00Z"), decidedAt: new Date("2026-11-04T11:00:00Z") },
        { id: payfit, workspaceId: ws, provider: "payfit", status: "applied", contentHash: "fixture-payfit", startedAt: new Date("2026-11-04T23:30:00Z"), decidedAt: new Date("2026-11-05T12:00:00Z"), summary: { collections: [{ collection: "collaborators", status: "read", count: 1 }, { collection: "contracts", status: "read", count: 1 }] } },
      ]);
      const declaration = (key: string, siret: string) => ({ key, month: "2026-10", siret, nature: "01", type: "01", fraction: "11", order: "1", eligible: true, blocking: [], contentHash: key });
      const rec = (syncId: string, collection: string, recordKey: string, data: Record<string, unknown>, period: string | null = "2026-10") => ({ workspaceId: ws, syncId, collection, recordKey, period, data, recordHash: `fixture-${recordKey}` });
      await tx.insert(schema.sourceRecord).values([
        rec(syncA, "declarations", "fixture-declaration-a", declaration("fixture-declaration-a", "12345678900011")),
        rec(syncB, "declarations", "fixture-declaration-b", declaration("fixture-declaration-b", "12345678900029")),
        rec(syncA, "people", "dsn-person", { declarationKey: "fixture-declaration-a", personId: "raw-dsn-person", familyName: "Fictif", givenNames: "Alice", nir: "fixture-private-nir", filename: "private-fictive-file.dsn", employeeNumber: "private-matricule" }),
        rec(syncA, "contracts", "dsn-contract", { declarationKey: "fixture-declaration-a", contractId: "raw-dsn-contract", personId: "raw-dsn-person", startDate: "2025-01-01", endDate: null, nature: "01" }),
        rec(syncA, "people", "cross-pair-excluded", { declarationKey: "fixture-declaration-b", personId: "wrong-pair", familyName: "Interdit", givenNames: "Pair" }),
        rec(syncA, "people", "wrong-period-excluded", { declarationKey: "fixture-declaration-a", personId: "wrong-month", familyName: "Interdit", givenNames: "Month" }, "2026-09"),
        rec(payfit, "collaborators", "payfit-person", { id: "raw-payfit-person", lastName: "Fictif", firstName: "Alice", employeeNumber: "private-matricule" }, null),
        rec(payfit, "contracts", "payfit-contract", { contractId: "raw-payfit-contract", collaboratorId: "raw-payfit-person", startDate: "2025-01-01", endDate: null, natureContratDsn: "01" }, null),
      ]);
    });
    await scope.withWorkspace(other, async (tx) => {
      const [sync] = await tx.insert(schema.sourceSync).values({ workspaceId: other, provider: "dsn", status: "applied", contentHash: "fixture-dsn-only" }).returning({ id: schema.sourceSync.id });
      await tx.insert(schema.sourceRecord).values({ workspaceId: other, syncId: sync.id, collection: "declarations", recordKey: "fixture-dsn-only", period: "2026-10", recordHash: "fixture-dsn-only", data: {
        key: "fixture-dsn-only", month: "2026-10", siret: "12345678900037", nature: "01", type: "01", fraction: "11", order: "1", eligible: true, blocking: [], contentHash: "fixture-dsn-only",
      } });
    });
  });
  afterAll(async () => {
    if (client) {
      // La cascade de suppression de l'espace fictif reste autorisée par les garde-fous.
      await client.db.delete(schema.organization).where(and(sql`${schema.organization.id} in (${ws}, ${other})`));
      await client.db.delete(schema.user).where(inArray(schema.user.id, [actor, unrelatedActor]));
      await client.pool.end();
    }
  });
  it("crée une seule fois le contrôle, sans correspondance automatique et sans champs sensibles", async () => {
    runId = await store.createReconciliationRun(ws, actor, "2026-10");
    expect(await store.createReconciliationRun(ws, actor, "2026-10")).toBe(runId);
    const loaded = await store.loadReconciliation(ws, runId);
    selected = loaded.selected!;
    expect(loaded.actorNames).toEqual({});
    expect(selected.stale).toBe(false);
    expect(selected.revision).toBe(0);
    expect(selected.state.personLinks).toEqual([]);
    expect(selected.snapshot.dsn.persons).toHaveLength(1);
    expect(selected.snapshot.dsn.contracts).toHaveLength(1);
    const json = JSON.stringify(selected.snapshot);
    for (const forbidden of ["raw-dsn-person", "raw-payfit-person", "fixture-private-nir", "private-fictive-file", "private-matricule", "fixture-declaration-a", "12345678900011", "Interdit"]) expect(json).not.toContain(forbidden);
    expect(selected.snapshot.payfit.referenceDate).toBe("2026-11-05");
  });
  it("isole les deux espaces et refuse une décision avec une FK d'espace forgée", async () => {
    await expect(store.loadReconciliation(other, runId)).rejects.toMatchObject({ code: "not_found" });
    await scope.withWorkspace(other, async (tx) => {
      expect(await tx.select().from(schema.reconciliationRun)).toEqual([]);
      expect(await tx.select().from(schema.reconciliationDecision)).toEqual([]);
    });
    await expect(scope.withWorkspace(other, (tx) => tx.insert(schema.reconciliationDecision).values({ workspaceId: other, runId, revision: 1, inputHash: selected.inputHash, actorId: actor, action: { kind: "link-person", dsnId: selected.snapshot.dsn.persons[0].id, payfitId: selected.snapshot.payfit.persons[0].id, fingerprint: "a".repeat(64) } }))).rejects.toBeDefined();
  });
  it("refuse un POST de création avec un seul référentiel disponible", async () => {
    await expect(store.createReconciliationRun(other, actor, "2026-10")).rejects.toMatchObject({ code: "unavailable" });
    expect((await store.loadReconciliation(other)).runs).toEqual([]);
  });
  it("sérialise deux décisions concurrentes et conserve un seul auteur/date/révision", async () => {
    const dsnId = selected.snapshot.dsn.persons[0].id, payfitId = selected.snapshot.payfit.persons[0].id;
    const action = { kind: "link-person", dsnId, payfitId, fingerprint: pairFingerprint(selected.snapshot, "person", dsnId, payfitId, selected.state) };
    const results = await Promise.allSettled([store.appendReconciliationDecision(ws, actor, runId, 0, selected.inputHash, action), store.appendReconciliationDecision(ws, actor, runId, 0, selected.inputHash, action)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason.code).toBe("revision_conflict");
    const loaded = await store.loadReconciliation(ws, runId);
    selected = loaded.selected!;
    expect(loaded.actorNames).toEqual({ [actor]: "Auteur fictif du contrôle" });
    expect(JSON.stringify(loaded.actorNames)).not.toContain("@test.invalid");
    expect(loaded.actorNames).not.toHaveProperty(unrelatedActor);
    expect(selected.revision).toBe(1);
    expect(selected.decisions).toHaveLength(1);
    expect(selected.decisions[0]).toMatchObject({ actorId: actor, revision: 1, inputHash: selected.inputHash });
    expect(Number.isFinite(Date.parse(selected.decisions[0].createdAt))).toBe(true);
  });
  it("refuse modification du snapshot et des décisions et annule toute transaction incomplète", async () => {
    await expect(scope.withWorkspace(ws, (tx) => tx.update(schema.reconciliationRun).set({ controlMonth: "2026-09" }).where(eq(schema.reconciliationRun.id, runId)))).rejects.toBeDefined();
    await expect(scope.withWorkspace(ws, (tx) => tx.update(schema.reconciliationDecision).set({ actorId: "modified" }).where(eq(schema.reconciliationDecision.runId, runId)))).rejects.toBeDefined();
    await expect(scope.withWorkspace(ws, (tx) => tx.delete(schema.reconciliationDecision).where(eq(schema.reconciliationDecision.runId, runId)))).rejects.toBeDefined();
    await expect(scope.withWorkspace(ws, async (tx) => {
      await tx.update(schema.reconciliationRun).set({ revision: 2 }).where(eq(schema.reconciliationRun.id, runId));
      await tx.insert(schema.reconciliationDecision).values({ workspaceId: ws, runId, revision: 3, inputHash: selected.inputHash, actorId: actor, action: selected.decisions[0].action });
    })).rejects.toBeDefined();
    expect((await store.loadReconciliation(ws, runId)).selected?.revision).toBe(1);
  });
  it("rend le contrôle obsolète après changement de source et garde l'historique consultable", async () => {
    await scope.withWorkspace(ws, (tx) => tx.update(schema.sourceSync).set({ contentHash: "fixture-source-modified" }).where(eq(schema.sourceSync.id, payfit)));
    const historical = (await store.loadReconciliation(ws, runId)).selected!;
    expect(historical.stale).toBe(true);
    expect(historical.decisions).toHaveLength(1);
    expect(historical.snapshot).toEqual(selected.snapshot);
    await expect(store.appendReconciliationDecision(ws, actor, runId, 1, selected.inputHash, selected.decisions[0].action)).rejects.toMatchObject({ code: "stale" });
    const freshId = await store.createReconciliationRun(ws, actor, "2026-10");
    expect(freshId).not.toBe(runId);
    const loadedFresh = await store.loadReconciliation(ws, freshId);
    const fresh = loadedFresh.selected!;
    expect(loadedFresh.actorNames).toEqual({});
    expect(fresh.state.personLinks).toEqual([]);
    expect(fresh.revision).toBe(0);
  });
  it("conserve le snapshot et son historique après purge d'un build RH", async () => {
    await scope.withWorkspace(ws, async (tx) => {
      const [build] = await tx.insert(schema.rhBuild).values({ workspaceId: ws, source: "dsn", status: "current", builderVersion: 5, inputsHash: "fixture-build", inputs: { source: "dsn", syncs: [], coverage: [] } }).returning({ id: schema.rhBuild.id });
      await tx.delete(schema.rhBuild).where(eq(schema.rhBuild.id, build.id));
    });
    const old = (await store.loadReconciliation(ws, runId)).selected!;
    expect(old.snapshot).toEqual(selected.snapshot);
    expect(old.decisions).toEqual(selected.decisions);
  });
  it("ne renvoie aucun libellé pour un profil auteur supprimé", async () => {
    await client.db.delete(schema.user).where(eq(schema.user.id, actor));
    const loaded = await store.loadReconciliation(ws, runId);
    expect(loaded.actorNames).toEqual({});
    expect(loaded.selected?.decisions[0].actorId).toBe(actor);
  });
});
