import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.CLAIR_SECRETS_KEY ??= Buffer.alloc(32, 3).toString("base64");
process.env.CLAIR_ENABLE_FIXTURE_PROVIDERS = "true";

// Le constructeur PayFit est enveloppé pour pouvoir le faire échouer une fois (chemin d'échec de rebuildRh).
vi.mock("@/lib/rh/referential/build-payfit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rh/referential/build-payfit")>();
  return { ...actual, buildFromPayFit: vi.fn(actual.buildFromPayFit) };
});
const { db, pool } = await import("@/db/client");
const { buildFromPayFit } = await import("@/lib/rh/referential/build-payfit");
const { organization, rhBuild, rhContract, rhPerson, workspaceEvent } = await import("@/db/schema");
const { withWorkspace } = await import("@/db/workspace-scope");
const sync = await import("@/lib/connectors/sync");
const { monthRange } = await import("@/lib/connectors/months");
const { importDsnFiles } = await import("@/lib/dsn/import");
const { fixtureDsnBytes } = await import("@/lib/dsn/fixture");
const { ensureRhBuild, loadRhBuild, loadAbsences } = await import("@/lib/rh/referential/store");
const { headcountAt } = await import("@/lib/rh/headcount");
const { chooseSourceMode, resolveSource } = await import("@/lib/sources");

// Base de test migrée, rôle non superutilisateur : la RLS est réelle.
const run = Date.now();
const A = `test-rh-a-${run}`;
const B = `test-rh-b-${run}`;
const actor = null as unknown as string;
const MONTHS = monthRange("2024-10", "2026-09");
const NATURES = { natures: ["01", "02"] };

async function settle(workspaceId: string, id: string) {
  for (let i = 0; i < 200; i++) {
    const s = await sync.getSync(workspaceId, id);
    if (s && s.status !== "running") return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("synchronisation bloquée");
}
async function readAndApply(workspaceId: string, key: string) {
  const verified = await sync.verifyPayFitKey(key);
  await sync.saveCredential(workspaceId, "payfit", key, verified, actor);
  const id = await sync.startSync(workspaceId, "payfit", MONTHS, actor);
  const s = await settle(workspaceId, id);
  if (s.status === "preview") await sync.applySync(workspaceId, id, actor);
  return s;
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

describe("référentiel Collaborateurs en base", () => {
  let firstBuild = "";

  it("sans source appliquée : aucun référentiel, raison explicite", async () => {
    expect(await ensureRhBuild(A, "payfit", actor)).toEqual({ kind: "none", reason: "aucune lecture PayFit appliquée" });
    expect(await ensureRhBuild(A, "dsn", actor)).toEqual({ kind: "none", reason: "aucun dépôt DSN appliqué" });
  });

  it("lecture PayFit appliquée ⇒ référentiel construit : 8 personnes, 8 contrats, 9 événements", async () => {
    await readAndApply(A, "fixture-A-1");
    const state = await ensureRhBuild(A, "payfit", actor);
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    firstBuild = state.build.id;
    expect(state.build.summary).toMatchObject({ persons: 8, contracts: 8, events: 9 });
    expect(state.build).toMatchObject({ status: "current", referenceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), presenceFrom: "2024-10" });
    const events = await withWorkspace(A, (tx) => tx.select().from(workspaceEvent).where(sql`${workspaceEvent.kind} = 'rh.rebuilt'`));
    expect(events).toHaveLength(1);
  });

  it("idempotence : un second appel renvoie le même build ; une relecture « inchangée » aussi", async () => {
    const again = await ensureRhBuild(A, "payfit", actor);
    expect(again.kind === "ready" && again.build.id).toBe(firstBuild);
    const s = await settle(A, await sync.startSync(A, "payfit", MONTHS, actor));
    expect(s.status).toBe("unchanged");
    const after = await ensureRhBuild(A, "payfit", actor);
    expect(after.kind === "ready" && after.build.id).toBe(firstBuild);
  });

  it("relecture et effectif : loadRhBuild + headcountAt au 2026-03-01 ⇒ 7 personnes ; contrôle SQL indépendant ⇒ 7/7", async () => {
    const data = await loadRhBuild(A, firstBuild);
    expect(data.persons).toHaveLength(8);
    expect(data.months.length).toBeGreaterThan(100);
    const r = headcountAt(data, "2026-03-01", NATURES);
    expect(r).toMatchObject({ kind: "exact", persons: 7, contracts: 7 });
    const [row] = await withWorkspace(A, async (tx) =>
      (
        await tx.execute(sql`
          select count(distinct c.person_key) filter (where c.person_key is not null)::int as persons, count(*)::int as contracts
          from rh_contract c
          where c.build_id = ${firstBuild} and c.start_date is not null and c.start_date <= '2026-03-01'
            and (c.end_date is null or c.end_date >= '2026-03-01') and c.nature in ('01', '02')`)
      ).rows as { persons: number; contracts: number }[],
    );
    expect(row).toEqual({ persons: 7, contracts: 7 });
    const absences = await loadAbsences(A, (await sync.activeSync(A, "payfit"))!.id, ["TEST-A-CONTRACT-001", "TEST-A-CONTRACT-003"]);
    expect(absences.every((a) => ["TEST-A-CONTRACT-001", "TEST-A-CONTRACT-003"].includes(a.contractId))).toBe(true);
  });

  it("échec du constructeur ⇒ l'ancien build reste courant, événement rh.rebuild_failed, reconstruction possible ensuite", async () => {
    await readAndApply(A, "fixture-A-2");
    vi.mocked(buildFromPayFit).mockImplementationOnce(() => {
      throw new Error("panne fictive du constructeur");
    });
    await expect(ensureRhBuild(A, "payfit", actor)).rejects.toThrow("panne fictive");
    const current = await withWorkspace(A, (tx) => tx.select({ id: rhBuild.id }).from(rhBuild).where(sql`${rhBuild.status} = 'current' and ${rhBuild.source} = 'payfit'`));
    expect(current.map((b) => b.id)).toEqual([firstBuild]);
    expect(await withWorkspace(A, (tx) => tx.select().from(rhPerson).where(sql`${rhPerson.buildId} = ${firstBuild}`))).toHaveLength(8);
    const failed = await withWorkspace(A, (tx) => tx.select().from(workspaceEvent).where(sql`${workspaceEvent.kind} = 'rh.rebuild_failed'`));
    expect(failed).toHaveLength(1);
    expect(failed[0].detail).toMatchObject({ source: "payfit", reason: "panne fictive du constructeur" });
  });

  it("nouvelle photographie appliquée ⇒ nouveau build courant, l'ancien conservé une fois comme « superseded »", async () => {
    const state = await ensureRhBuild(A, "payfit", actor);
    expect(state.kind === "ready" && state.build.id).not.toBe(firstBuild);
    const builds = await withWorkspace(A, (tx) => tx.select({ id: rhBuild.id, status: rhBuild.status }).from(rhBuild).where(sql`${rhBuild.source} = 'payfit'`));
    expect(builds.map((b) => b.status).sort()).toEqual(["current", "superseded"]);
    expect(builds.find((b) => b.status === "superseded")?.id).toBe(firstBuild);
    // Troisième photographie : l'ancien « superseded » disparaît, il n'en reste qu'un.
    await sync.deleteCredential(A, "payfit", actor);
    await readAndApply(A, "fixture-A-1");
    await ensureRhBuild(A, "payfit", actor);
    const after = await withWorkspace(A, (tx) => tx.select({ id: rhBuild.id, status: rhBuild.status }).from(rhBuild).where(sql`${rhBuild.source} = 'payfit'`));
    expect(after.map((b) => b.status).sort()).toEqual(["current", "superseded"]);
    expect(after.some((b) => b.id === firstBuild)).toBe(false);
  });

  it("dépôt DSN appliqué ⇒ référentiel DSN distinct (6 personnes sur 2024-10 et 2024-11) ; les deux builds coexistent", async () => {
    const id = await importDsnFiles(A, [{ filename: "2024-10.dsn", bytes: fixtureDsnBytes({ month: "2024-10" }) }, { filename: "2024-11.dsn", bytes: fixtureDsnBytes({ month: "2024-11" }) }], actor);
    await sync.applySync(A, id, actor);
    const state = await ensureRhBuild(A, "dsn", actor);
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    expect(state.build).toMatchObject({ presenceFrom: "2024-10", presenceTo: "2024-11", referenceDate: "2024-11-30" });
    expect(state.build.summary.persons).toBe(6);
    const data = await loadRhBuild(A, state.build.id);
    expect(headcountAt(data, "2024-11-30", NATURES)).toMatchObject({ kind: "exact", persons: 6, contracts: 6 });
    expect(data.persons.every((p) => p.personKey.startsWith("dsn:"))).toBe(true);
    const current = await withWorkspace(A, (tx) => tx.select({ source: rhBuild.source }).from(rhBuild).where(sql`${rhBuild.status} = 'current'`));
    expect(current.map((b) => b.source).sort()).toEqual(["dsn", "payfit"]);
  });

  it("la règle de source ne reconstruit rien ; en mode « fichiers », la date d'application est celle du dépôt", async () => {
    const before = await withWorkspace(A, (tx) => tx.select({ id: rhBuild.id }).from(rhBuild));
    await chooseSourceMode(A, "rh", "files", actor);
    const res = await resolveSource(A, "rh");
    expect(res).toMatchObject({ chosen: "dsn", mode: "files" });
    expect(res.appliedAt).toBeInstanceOf(Date);
    expect(res.modeSetAt).toBeInstanceOf(Date);
    const after = await withWorkspace(A, (tx) => tx.select({ id: rhBuild.id }).from(rhBuild));
    expect(after.map((b) => b.id).sort()).toEqual(before.map((b) => b.id).sort());
    await chooseSourceMode(A, "rh", "auto", actor);
    expect((await resolveSource(A, "rh")).modeSetAt).toBeNull();
  });

  it("isolation : l'espace B n'a rien, ne voit rien et ne peut rien écrire pour A", async () => {
    expect(await ensureRhBuild(B, "payfit", actor)).toMatchObject({ kind: "none" });
    expect(await withWorkspace(B, (tx) => tx.select().from(rhPerson))).toHaveLength(0);
    expect(await withWorkspace(B, (tx) => tx.select().from(rhContract))).toHaveLength(0);
    const [{ id: buildId }] = await withWorkspace(A, (tx) => tx.select({ id: rhBuild.id }).from(rhBuild).limit(1));
    await expect(
      withWorkspace(B, (tx) =>
        tx.insert(rhPerson).values({ workspaceId: A, buildId, personKey: "payfit:intrus", externalId: "intrus", identifierKind: "payfit", hasContract: false }),
      ),
    ).rejects.toThrow();
  });
});
