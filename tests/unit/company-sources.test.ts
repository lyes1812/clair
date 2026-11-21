import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.CLAIR_SECRETS_KEY ??= Buffer.alloc(32, 3).toString("base64");
process.env.CLAIR_ENABLE_FIXTURE_PROVIDERS = "true";

const { db, pool } = await import("@/db/client");
const { organization, user, workspaceCompany, connectorCredential, sourceSync, sourceRecord, sourceFile, workspaceSetting, workspaceEvent } = await import("@/db/schema");
const { currentCompanyId, withCompanyScope, withWorkspace } = await import("@/db/workspace-scope");
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
const sync = await import("@/lib/connectors/sync");
const { PROVIDERS } = await import("@/lib/connectors/providers");
const { importDsnFiles, dsnCoverage, listDsnFiles } = await import("@/lib/dsn/import");
const { fixtureDsnBytes } = await import("@/lib/dsn/fixture");
const { importFecFiles, fecCoverage, listFecFiles } = await import("@/lib/fec/import");
const { fixtureFecBytes, fixtureFecFilename } = await import("@/lib/fec/fixture");
const { saveActualEvent, listActualEvents } = await import("@/lib/payroll/non-recurring-store");
const { startRcPayslipScan, getRcPayslipScan } = await import("@/lib/payroll/rc-payslips-store");

// Uniquement transports et fichiers fictifs, sur une base migrée avec rôle non superutilisateur.
const run = randomUUID();
const workspaceId = `test-company-sources-${run}`;
const actor = `test-company-sources-user-${run}`;
const A = randomUUID(), B = randomUUID(), C = randomUUID();
const months = ["2025-01"];
const inCompany = <T>(companyId: string, fn: () => Promise<T>) => withCompanyScope(workspaceId, companyId, fn);
let activeA = "", activeB = "";

async function settle(id: string) {
  for (let i = 0; i < 150; i++) {
    const row = await sync.getSync(workspaceId, id);
    if (row && row.status !== "running") return row;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Lecture fictive bloquée");
}

async function connect(companyId: string, key: string, provider: "payfit" | "pennylane" = "payfit") {
  const verified = await sync.verifyKey(provider, key);
  await inCompany(companyId, () => sync.saveCredential(workspaceId, provider, key, verified, actor));
}

beforeAll(async () => {
  await db.insert(user).values({ id: actor, name: "Utilisateur fictif", email: `${run}@example.invalid` });
  await db.insert(organization).values({ id: workspaceId, name: "Espace fictif multisociétés", slug: workspaceId, createdAt: new Date() });
  await withWorkspace(workspaceId, tx => tx.insert(workspaceCompany).values([
    { id: A, workspaceId, name: "Société fictive A" },
    { id: B, workspaceId, name: "Société fictive B" },
    { id: C, workspaceId, name: "Société fictive C", siren: "111111111" },
  ]), { allCompanies: true });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await db.delete(organization).where(eq(organization.id, workspaceId));
  await db.delete(user).where(eq(user.id, actor));
  await pool.end();
});

describe("sources propres à chaque société d’un espace", () => {
  it("conserve deux connexions, chiffre leur secret avec leur société et ne les expose jamais", async () => {
    await connect(A, "fixture-A-1");
    await connect(B, "fixture-B-1");
    const a = await inCompany(A, () => sync.getConnection(workspaceId, "payfit"));
    const b = await inCompany(B, () => sync.getConnection(workspaceId, "payfit"));
    expect(a?.externalCompanyId).toBe("test-a-1");
    expect(b?.externalCompanyId).toBe("test-b-1");
    expect(JSON.stringify([a, b])).not.toContain("fixture-");
    const [stored] = await inCompany(A, () => withWorkspace(workspaceId, tx => tx.select().from(connectorCredential)));
    expect(stored.secretScopeVersion).toBe(2);
    expect(decryptSecret(stored.sealedSecret, `${workspaceId}:payfit:${A}`)).toBe("fixture-A-1");
    expect(() => decryptSecret(stored.sealedSecret, `${workspaceId}:payfit:${B}`)).toThrow();
    expect(await inCompany(C, () => sync.getConnection(workspaceId, "payfit"))).toBeNull();
  });

  it("refuse de remplacer l’identité liée ou de l’utiliser dans une autre société", async () => {
    await expect(connect(A, "fixture-C-1-2")).rejects.toThrow(/liée à une autre société/);
    await expect(connect(C, "fixture-A-1")).rejects.toThrow(/déjà liée/);
    expect((await inCompany(A, () => sync.getConnection(workspaceId, "payfit")))?.externalCompanyId).toBe("test-a-1");
  });

  it("garde la société capturée par une tâche même pendant une consultation de B", async () => {
    const original = PROVIDERS.payfit.read;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reading = new Promise<void>(resolve => { entered = resolve; });
    let observed: string | null = null;
    const spy = vi.spyOn(PROVIDERS.payfit, "read").mockImplementation(async (...args) => {
      if (args[1] === "test-a-1") {
        entered(); await gate;
        observed = await currentCompanyId(workspaceId);
      }
      return original(...args);
    });
    try {
      activeA = await inCompany(A, () => sync.startSync(workspaceId, "payfit", months, actor));
      await reading;
      await inCompany(B, async () => {
        expect(await currentCompanyId(workspaceId)).toBe(B);
        expect(await sync.getSync(workspaceId, activeA)).toBeNull();
        // Une lecture de A en cours ne bloque pas celle de B.
        activeB = await sync.startSync(workspaceId, "payfit", months, actor);
        expect((await settle(activeB)).status).toBe("preview");
        release();
        expect((await inCompany(A, () => settle(activeA))).status).toBe("preview");
      });
      expect(observed).toBe(A);
    } finally { release(); spy.mockRestore(); }
    await inCompany(A, () => sync.applySync(workspaceId, activeA, actor));
  });

  it("appliquer B préserve le réel et la référence active de A", async () => {
    await inCompany(B, () => sync.applySync(workspaceId, activeB, actor));
    expect((await inCompany(A, () => sync.activeSync(workspaceId, "payfit")))?.id).toBe(activeA);
    expect((await inCompany(B, () => sync.activeSync(workspaceId, "payfit")))?.id).toBe(activeB);
    const rows = await inCompany(A, () => withWorkspace(workspaceId, tx => tx.select().from(sourceRecord).where(eq(sourceRecord.syncId, activeB))));
    expect(rows).toEqual([]);
    await expect(inCompany(A, () => sync.applySync(workspaceId, activeB, actor))).rejects.toThrow(/introuvable/);
    expect((await inCompany(A, () => sync.getSync(workspaceId, activeA)))?.status).toBe("applied");
  });

  it("une clé d’une autre société est refusée avant de créer un aperçu ou des lignes", async () => {
    await inCompany(A, () => withWorkspace(workspaceId, tx => tx.update(connectorCredential)
      .set({ sealedSecret: encryptSecret("fixture-B-1", `${workspaceId}:payfit:${A}`) }).where(eq(connectorCredential.provider, "payfit"))));
    const id = await inCompany(A, () => sync.startSync(workspaceId, "payfit", months, actor));
    const row = await inCompany(A, () => settle(id));
    expect(row.status).toBe("failed");
    expect(row.errorMessage).toContain("autre société");
    expect(await inCompany(A, () => withWorkspace(workspaceId, tx => tx.select().from(sourceRecord).where(eq(sourceRecord.syncId, id))))).toEqual([]);
    await connect(A, "fixture-A-1");
  });

  it("lit explicitement les anciens secrets puis les remet au format par société à la reconnexion", async () => {
    await inCompany(A, () => withWorkspace(workspaceId, tx => tx.update(connectorCredential)
      .set({ sealedSecret: encryptSecret("fixture-A-1", `${workspaceId}:payfit`), secretScopeVersion: 1 }).where(eq(connectorCredential.provider, "payfit"))));
    expect((await inCompany(A, () => sync.configuredPayfitClient(workspaceId))).companyId).toBe("test-a-1");
    await inCompany(A, () => withWorkspace(workspaceId, tx => tx.update(connectorCredential).set({ secretScopeVersion: 2 }).where(eq(connectorCredential.provider, "payfit"))));
    await expect(inCompany(A, () => sync.configuredPayfitClient(workspaceId))).rejects.toThrow(/illisible/);
    await connect(A, "fixture-A-1");
  });

  it("une tâche préparée avant rotation de clé ne relit pas la nouvelle connexion", async () => {
    const id = await inCompany(A, () => withWorkspace(workspaceId, async tx => {
      const [credential] = await tx.select().from(connectorCredential).where(eq(connectorCredential.provider, "payfit"));
      const [row] = await tx.insert(sourceSync).values({ workspaceId, provider: "payfit", credentialId: credential.id, status: "running", requestedBy: actor,
        scope: { months, externalCompanyId: credential.externalCompanyId, credentialUpdatedAt: credential.updatedAt.toISOString() } }).returning({ id: sourceSync.id });
      return row.id;
    }));
    await new Promise(resolve => setTimeout(resolve, 5));
    await connect(A, "fixture-A-2");
    const spy = vi.spyOn(PROVIDERS.payfit, "read");
    try {
      await sync.runSync(workspaceId, "payfit", id, months, A);
      expect(spy).not.toHaveBeenCalled();
      const row = await inCompany(A, () => sync.getSync(workspaceId, id));
      expect(row).toMatchObject({ status: "failed", errorCode: "key_rejected" });
      expect(row?.errorMessage).toContain("connexion a changé");
    } finally { spy.mockRestore(); }
    await connect(A, "fixture-A-1");
  });

  it("les mêmes identifiants comptables restent séparés par la société de leur lecture", async () => {
    await connect(A, "fixture-pl-A-1", "pennylane");
    await connect(B, "fixture-pl-B-1", "pennylane");
    const ids: string[] = [];
    for (const companyId of [A, B]) await inCompany(companyId, async () => {
      const id = await sync.startSync(workspaceId, "pennylane", months, actor);
      const row = await settle(id);
      expect(row.status).toBe("preview");
      expect(row.warnings.join(" ")).toContain("SIREN de la source API non vérifiable");
      await sync.applySync(workspaceId, id, actor); ids.push(id);
    });
    for (const [index, companyId] of [A, B].entries()) {
      const rows = await inCompany(companyId, () => withWorkspace(workspaceId, tx => tx.select({ syncId: sourceRecord.syncId }).from(sourceRecord)
        .where(and(eq(sourceRecord.collection, "accounts"), eq(sourceRecord.recordKey, "107")))));
      expect(rows.map(row => row.syncId)).toEqual([ids[index]]);
    }
    await expect(inCompany(A, () => withWorkspace(workspaceId, tx => tx.insert(sourceRecord)
      .values({ workspaceId, syncId: ids[1], collection: "accounts", recordKey: "collision-test", period: null, data: {}, recordHash: "0".repeat(64) })))).rejects.toThrow();
  });

  it("DSN : fichiers identiques autorisés par société, couvertures et remplacements indépendants", async () => {
    const upload = { filename: "fictif.dsn", bytes: fixtureDsnBytes({ month: "2025-01" }) };
    const a = await inCompany(A, () => importDsnFiles(workspaceId, [upload], actor));
    const b = await inCompany(B, () => importDsnFiles(workspaceId, [upload], actor));
    await inCompany(A, () => sync.applySync(workspaceId, a, actor));
    await inCompany(B, () => sync.applySync(workspaceId, b, actor));
    const correction = await inCompany(B, () => importDsnFiles(workspaceId, [{ filename: "correction.dsn", bytes: fixtureDsnBytes({ month: "2025-01", photograph: 2, type: "03", order: "2" }) }], actor));
    await inCompany(B, () => sync.applySync(workspaceId, correction, actor));
    expect((await inCompany(A, () => dsnCoverage(workspaceId)))[0].selected[0].type).toBe("01");
    expect((await inCompany(B, () => dsnCoverage(workspaceId)))[0].selected[0].type).toBe("03");
    expect(await inCompany(A, () => listDsnFiles(workspaceId))).toHaveLength(1);
    expect(await inCompany(B, () => listDsnFiles(workspaceId))).toHaveLength(2);
    expect(await inCompany(C, () => listDsnFiles(workspaceId))).toEqual([]);
    const [stored] = await inCompany(A, () => withWorkspace(workspaceId, tx => tx.select().from(sourceFile).where(eq(sourceFile.kind, "dsn"))));
    // Les fichiers historiques restent lisibles avec le contexte documenté existant.
    expect(decryptSecret(stored.sealedContent, `${workspaceId}:dsn-file`)).toBe(Buffer.from(upload.bytes).toString("base64"));
    const rejected = await inCompany(C, () => importDsnFiles(workspaceId, [upload], actor));
    expect((await inCompany(C, () => sync.getSync(workspaceId, rejected)))?.errorMessage).toContain("SIREN");
    expect(await inCompany(C, () => withWorkspace(workspaceId, tx => tx.select().from(sourceFile)))).toEqual([]);
  });

  it("FEC : un réimport de B ne remplace que son exercice, et contrôle le SIREN renseigné", async () => {
    const options = { exerciseEnd: "2025-09" };
    const upload = { filename: fixtureFecFilename(options), bytes: fixtureFecBytes(options) };
    const a = await inCompany(A, () => importFecFiles(workspaceId, [upload], actor));
    const b = await inCompany(B, () => importFecFiles(workspaceId, [upload], actor));
    await inCompany(A, () => sync.applySync(workspaceId, a, actor));
    await inCompany(B, () => sync.applySync(workspaceId, b, actor));
    const correction = await inCompany(B, () => importFecFiles(workspaceId, [{ ...upload, bytes: fixtureFecBytes({ ...options, photograph: 2 }) }], actor));
    expect((await inCompany(B, () => sync.getSync(workspaceId, correction)))?.summary.replaces).toEqual([b]);
    await inCompany(B, () => sync.applySync(workspaceId, correction, actor));
    expect((await inCompany(A, () => sync.getSync(workspaceId, a)))?.status).toBe("applied");
    expect((await inCompany(B, () => sync.getSync(workspaceId, b)))?.status).toBe("superseded");
    expect((await inCompany(A, () => fecCoverage(workspaceId))).map(row => row.syncId)).toEqual([a]);
    expect((await inCompany(B, () => fecCoverage(workspaceId))).map(row => row.syncId)).toEqual([correction]);
    expect(await inCompany(A, () => listFecFiles(workspaceId))).toHaveLength(1);
    const rejected = await inCompany(C, () => importFecFiles(workspaceId, [upload], actor));
    expect((await inCompany(C, () => sync.getSync(workspaceId, rejected)))?.errorMessage).toContain("SIREN");
  });

  it("refuse le premier raccordement API si son SIREN connu contredit le registre", async () => {
    const verified = await sync.verifyKey("payfit", "fixture-C-1");
    expect(verified.identificationNumber).toBe("000000000");
    await expect(inCompany(C, () => sync.saveCredential(workspaceId, "payfit", "fixture-C-1", verified, actor))).rejects.toThrow(/SIREN/);
    expect(await inCompany(C, () => sync.getConnection(workspaceId, "payfit"))).toBeNull();
  });

  it("contrôle aussi le SIREN du résultat de lecture avant de stocker des lignes", async () => {
    const verified = await sync.verifyKey("payfit", "fixture-C-1");
    // Une vérification sans identifiant légal exploitable ne prouve aucune égalité de SIREN.
    await inCompany(C, () => sync.saveCredential(workspaceId, "payfit", "fixture-C-1", { companyId: verified.companyId, companyName: verified.companyName, scopes: verified.scopes }, actor));
    const id = await inCompany(C, () => sync.startSync(workspaceId, "payfit", months, actor));
    const row = await inCompany(C, () => settle(id));
    expect(row).toMatchObject({ status: "failed", errorCode: "invalid_response" });
    expect(row.errorMessage).toContain("SIREN");
    expect(await inCompany(C, () => withWorkspace(workspaceId, tx => tx.select().from(sourceRecord).where(eq(sourceRecord.syncId, id))))).toEqual([]);
    const preview = await inCompany(C, () => withWorkspace(workspaceId, async tx => (await tx.insert(sourceSync)
      .values({ workspaceId, provider: "payfit", status: "preview", requestedBy: actor, summary: { company: { id: verified.companyId, name: "Fictif", identificationNumber: "00000000000011" } } })
      .returning({ id: sourceSync.id }))[0].id));
    await expect(inCompany(C, () => sync.applySync(workspaceId, preview, actor))).rejects.toThrow(/SIREN/);
    expect((await inCompany(C, () => sync.getSync(workspaceId, preview)))?.status).toBe("preview");
  });

  it("les éléments non récurrents et les lectures RC gardent les paramètres de leur société", async () => {
    const eventId = randomUUID();
    for (const [companyId, syncId, amount] of [[A, activeA, 12300], [B, activeB, 45600]] as const) {
      await inCompany(companyId, () => saveActualEvent(workspaceId, actor, { id: eventId, syncId, month: "2025-01", kind: "autre", chargedCents: amount, contractKeys: [], note: "Fictif" }, null));
    }
    expect((await inCompany(A, () => listActualEvents(workspaceId)))[0].chargedCents).toBe(12300);
    expect((await inCompany(B, () => listActualEvents(workspaceId)))[0].chargedCents).toBe(45600);
    const scans = await Promise.all([A, B].map(companyId => inCompany(companyId, () => startRcPayslipScan(workspaceId, actor, "2025-01", "2025-01"))));
    for (let i = 0; i < 200; i++) {
      const states = await Promise.all([A, B].map(companyId => inCompany(companyId, () => getRcPayslipScan(workspaceId))));
      if (states.every(scan => scan && scan.status !== "running")) {
        expect(states.map(scan => scan?.id)).toEqual(scans);
        expect(states.map(scan => scan?.companyId)).toEqual(["test-a-1", "test-b-1"]);
        expect(states.map(scan => scan?.payrollSyncId)).toEqual([activeA, activeB]);
        expect(states.map(scan => ({ status: scan?.status, issues: scan?.issues })), JSON.stringify(states.map(scan => ({ status: scan?.status, issues: scan?.issues })))).toEqual([
          { status: expect.stringMatching(/^(complete|partial)$/), issues: expect.any(Array) },
          { status: expect.stringMatching(/^(complete|partial)$/), issues: expect.any(Array) },
        ]);
        const events = await withWorkspace(workspaceId, tx => tx.select({ companyId: workspaceEvent.companyId, detail: workspaceEvent.detail }).from(workspaceEvent)
          .where(sql`${workspaceEvent.detail}->>'key' in ('rh.payroll.actualNonRecurring', 'rh.payroll.rcPayslips')`), { allCompanies: true });
        // Le résultat est publié juste avant l’événement de fin du traitement.
        if (events.length < 6) { await new Promise(resolve => setTimeout(resolve, 25)); continue; }
        expect(events).toHaveLength(6);
        expect(events.every(event => event.companyId === A || event.companyId === B)).toBe(true);
        expect(events.filter(event => event.companyId === A)).toHaveLength(3);
        expect(events.filter(event => event.companyId === B)).toHaveLength(3);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("Lecture RC fictive bloquée");
  }, 15000);

  it("déconnecter B efface uniquement son secret et conserve son rattachement réservé", async () => {
    await inCompany(B, () => sync.deleteCredential(workspaceId, "payfit", actor));
    expect(await inCompany(B, () => sync.getConnection(workspaceId, "payfit"))).toBeNull();
    expect((await inCompany(A, () => sync.getConnection(workspaceId, "payfit")))?.externalCompanyId).toBe("test-a-1");
    const [row] = await inCompany(B, () => withWorkspace(workspaceId, tx => tx.select().from(connectorCredential).where(eq(connectorCredential.provider, "payfit"))));
    expect(row).toMatchObject({ sealedSecret: "", status: "disconnected", externalCompanyId: "test-b-1" });
    await expect(inCompany(B, () => sync.configuredPayfitClient(workspaceId))).rejects.toThrow(/aucune clé/);
    await expect(connect(C, "fixture-B-1")).rejects.toThrow(/déjà liée/);
    await expect(connect(B, "fixture-C-1-2")).rejects.toThrow(/liée à une autre société/);
    expect((await inCompany(A, () => withWorkspace(workspaceId, tx => tx.select({ n: sql<number>`count(*)::int` }).from(workspaceSetting))))[0].n).toBeGreaterThan(0);
  });
});
