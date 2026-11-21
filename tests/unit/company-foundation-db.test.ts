import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { organization, sourceSync, workspaceCompany, workspaceSetting } from "@/db/schema";
import { CompanySelectionError, currentCompanyId, withCompanyScope, withWorkspace } from "@/db/workspace-scope";
import { CompanyError, createCompany, getCompany, listCompanies, renameCompany } from "@/lib/companies";

// Base PostgreSQL fictive migrée, rôle propriétaire non superutilisateur.
const run = randomUUID();
const W = `test-company-foundation-${run}`;
const OTHER = `${W}-other`;
const THIRD = `${W}-third`;
const actor = null as unknown as string;
let A: string, B: string, otherCompany: string;
let syncId: string;
const scoped = <T>(id: string, fn: () => Promise<T>) => withCompanyScope(W, id, fn);

beforeAll(async () => {
  await db.insert(organization).values([
    { id: W, name: "Périmètre historique fictif", slug: W, createdAt: new Date() },
    { id: OTHER, name: "Autre espace fictif", slug: OTHER, createdAt: new Date() },
  ]);
  A = (await listCompanies(W))[0].id;
  otherCompany = (await listCompanies(OTHER))[0].id;
});
afterAll(async () => {
  await db.delete(organization).where(sql`id in (${W}, ${OTHER}, ${THIRD})`);
  await pool.end();
});

describe("registre de sociétés et contexte PostgreSQL", () => {
  it("crée automatiquement un périmètre initial portant le nom de l'ancien espace", async () => {
    const companies = await listCompanies(W);
    expect(companies).toHaveLength(1);
    expect(companies[0]).toMatchObject({ name: "Périmètre historique fictif", origin: "initial", siren: null });
    expect(await currentCompanyId(W)).toBe(A);
  });
  it("restaure le contexte de l'appelant après le déclencheur de création d'espace", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.workspace_id', ${W}, true)`);
      await tx.insert(organization).values({ id: THIRD, name: "Troisième espace fictif", slug: THIRD, createdAt: new Date() });
      const result = await tx.execute(sql`select current_setting('app.workspace_id', true) as workspace_id`);
      expect(result.rows[0]).toEqual({ workspace_id: W });
    });
    expect(await listCompanies(THIRD)).toHaveLength(1);
  });
  it("crée une société vide, puis exige un choix explicite sans attribuer la première", async () => {
    B = (await createCompany(W, actor, { name: "Société fictive B", siren: "123456789" })).id;
    await expect(currentCompanyId(W)).rejects.toBeInstanceOf(CompanySelectionError);
    expect(await scoped(A, () => currentCompanyId(W))).toBe(A);
    expect(await scoped(B, () => currentCompanyId(W))).toBe(B);
    expect(await scoped(B, () => withWorkspace(W, (tx) => tx.select().from(sourceSync)))).toEqual([]);
    expect(await getCompany(OTHER, B)).toBeNull();
  });
  it("renomme une société sans réécrire son SIREN ni son origine", async () => {
    const changed = await renameCompany(W, actor, B, { name: "Société B renommée" });
    expect(changed).toMatchObject({ id: B, name: "Société B renommée", siren: "123456789", origin: "manual" });
    await expect(createCompany(W, actor, { name: " société b renommée " })).rejects.toBeInstanceOf(CompanyError);
  });
  it("isole les paramètres de même clé et conserve l'isolation d'espace en vue métadonnées", async () => {
    for (const [id, value] of [[A, "alpha"], [B, "beta"]]) {
      await scoped(id, () => withWorkspace(W, (tx) => tx.insert(workspaceSetting).values({ workspaceId: W, key: "fixture.scope", value })));
    }
    expect(await scoped(A, () => withWorkspace(W, (tx) => tx.select({ value: workspaceSetting.value }).from(workspaceSetting)))).toEqual([{ value: "alpha" }]);
    expect(await scoped(B, () => withWorkspace(W, (tx) => tx.select({ value: workspaceSetting.value }).from(workspaceSetting)))).toEqual([{ value: "beta" }]);
    expect(await withWorkspace(W, (tx) => tx.select().from(workspaceCompany), { allCompanies: true })).toHaveLength(2);
    await expect(withWorkspace(W, (tx) => tx.insert(workspaceSetting).values({ workspaceId: W, companyId: otherCompany, key: "fixture.foreign", value: true }), { allCompanies: true })).rejects.toThrow();
  });
  it("fige le périmètre source et refuse de déplacer ses métadonnées vers une autre société", async () => {
    const [source] = await scoped(B, () => withWorkspace(W, (tx) => tx.insert(sourceSync).values({ workspaceId: W, provider: "fixture", status: "ready" }).returning()));
    syncId = source.id;
    await expect(renameCompany(W, actor, B, { name: "Société B renommée", siren: "987654321" })).rejects.toThrow(/SIREN/);
    await expect(withWorkspace(W, (tx) => tx.update(sourceSync).set({ companyId: A }).where(eq(sourceSync.id, syncId)), { allCompanies: true })).rejects.toThrow();
    const renamed = await renameCompany(W, actor, B, { name: "Nom sans effet sur la source" });
    expect(renamed.siren).toBe("123456789");
    expect(await scoped(A, () => withWorkspace(W, (tx) => tx.select().from(sourceSync)))).toEqual([]);
  });
});
