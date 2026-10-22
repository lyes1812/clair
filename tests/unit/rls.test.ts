import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { organization, workspaceEvent } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";

// Exige une base migrée et un rôle non superutilisateur (comme sur Scalingo) : DATABASE_URL de test.
const A = `test-ws-a-${Date.now()}`;
const B = `test-ws-b-${Date.now()}`;

beforeAll(async () => {
  const [{ rolsuper }] = (await db.execute(sql`select rolsuper from pg_roles where rolname = current_user`)).rows as { rolsuper: boolean }[];
  if (rolsuper) throw new Error("Le test RLS doit tourner avec un rôle non superutilisateur");
  await db.insert(organization).values([
    { id: A, name: "Espace A", slug: A, createdAt: new Date() },
    { id: B, name: "Espace B", slug: B, createdAt: new Date() },
  ]);
  await withWorkspace(A, (tx) => tx.insert(workspaceEvent).values({ workspaceId: A, kind: "workspace.created" }));
  await withWorkspace(B, (tx) => tx.insert(workspaceEvent).values({ workspaceId: B, kind: "workspace.created" }));
});

afterAll(async () => {
  await db.delete(organization).where(sql`id in (${A}, ${B})`);
  await pool.end();
});

describe("isolation des espaces par RLS", () => {
  it("toutes les tables portant workspace_id sont en RLS activée et forcée (y compris module 5)", async () => {
    const rows = (await db.execute(sql`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
      join information_schema.columns k on k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'workspace_id'
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace`)).rows as { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[];
    expect(rows.map((r) => r.relname)).toEqual(expect.arrayContaining(["budget_base", "budget_scenario", "budget_hypothesis"]));
    expect(rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("sans espace déclaré, aucune ligne n'est visible", async () => {
    const rows = await db.select().from(workspaceEvent);
    expect(rows).toHaveLength(0);
  });

  it("dans l'espace A, seules les lignes de A sont visibles", async () => {
    const rows = await withWorkspace(A, (tx) => tx.select().from(workspaceEvent));
    expect(rows.map((r) => r.workspaceId)).toEqual([A]);
  });

  it("une écriture pour B depuis l'espace A est refusée", async () => {
    await expect(
      withWorkspace(A, (tx) => tx.insert(workspaceEvent).values({ workspaceId: B, kind: "workspace.renamed" })),
    ).rejects.toThrow();
  });

  it("une mise à jour depuis A ne touche pas les lignes de B", async () => {
    await withWorkspace(A, (tx) => tx.update(workspaceEvent).set({ kind: "workspace.renamed" }));
    const rowsB = await withWorkspace(B, (tx) => tx.select().from(workspaceEvent));
    expect(rowsB.map((r) => r.kind)).toEqual(["workspace.created"]);
  });
});
