import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { PayrollContext } from "@/lib/payroll/context";
const mocks = vi.hoisted(() => ({ scope: vi.fn(), selected: [] as unknown[][], fields: [] as Record<string, unknown>[], conditions: [] as unknown[] }));
vi.mock("@/db/workspace-scope", () => ({ withWorkspace: mocks.scope }));
import { loadPayrollExplorationContext } from "@/lib/payroll/exploration-context";

const months = ["2026-01", "2026-02", "2026-03"];
function ctx(): PayrollContext {
  return { source: "payfit", unavailable: null, read: { syncId: "sync-fixture", startedAt: new Date("2026-03-05T12:00:00Z"), months },
    input: { lines: [], months, openMonths: [], grid: {} }, kpi: { collab: { workspace: { id: "workspace-fixture" }, data: null } },
  } as unknown as PayrollContext;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.fields = []; mocks.conditions = [];
  mocks.selected = [[{ id: "sync-fixture", startedAt: new Date("2026-03-05T12:00:00Z") }], [
    { period: months[0], month: months[0], status: "completed" }, { period: months[1], month: months[1], status: "not_completed" },
  ]];
  mocks.scope.mockImplementation(async (_workspace, callback) => {
    const tx = { select: (fields: Record<string, unknown>) => {
      mocks.fields.push(fields); const rows = mocks.selected.shift() ?? [];
      const chain = { from: () => chain, where: (condition: unknown) => { mocks.conditions.push(condition); return chain; }, limit: () => chain, orderBy: () => chain,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
      return chain;
    } }; return callback(tx);
  });
});

describe("Masse explorée : clôture explicite isolée par espace et lecture appliquée", () => {
  it("ne déduit pas une clôture de l'absence de statut ouvert", async () => {
    const result = await loadPayrollExplorationContext(ctx());
    expect(result.read?.closedMonths).toEqual([months[0]]);
    expect(result.read?.closureReasons?.[months[1]]).toContain("non clôturée");
    expect(result.read?.closureReasons?.[months[2]]).toContain("absent");
  });
  it("vérifie la lecture appliquée et ne sélectionne que mois/statut sans JSON métier", async () => {
    await loadPayrollExplorationContext(ctx());
    expect(mocks.scope).toHaveBeenCalledWith("workspace-fixture", expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
    expect(Object.keys(mocks.fields[1])).toEqual(["period", "month", "status"]); expect(mocks.fields[1]).not.toHaveProperty("data");
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(mocks.conditions[0] as SQL).params).toEqual(["sync-fixture", "payfit", "applied"]);
    expect(dialect.sqlToQuery(mocks.conditions[1] as SQL).params).toEqual(["sync-fixture", "payroll_status"]);
  });
  it("des statuts contradictoires rendent le mois non clos", async () => {
    mocks.selected[1].push({ period: months[0], month: months[0], status: "not_completed" });
    const result = await loadPayrollExplorationContext(ctx());
    expect(result.read?.closedMonths).toEqual([]); expect(result.read?.closureReasons?.[months[0]]).toContain("contradictoires");
  });
  it("un doublon identique completed n'est compté qu'une fois", async () => {
    mocks.selected[1].push({ period: months[0], month: months[0], status: "completed" });
    expect((await loadPayrollExplorationContext(ctx())).read?.closedMonths).toEqual([months[0]]);
  });
  it("une période JSON incohérente ne prouve la clôture d'aucun des deux mois", async () => {
    mocks.selected[1].push({ period: months[1], month: months[0], status: "completed" });
    const result = await loadPayrollExplorationContext(ctx());
    expect(result.read?.closedMonths).toEqual([]); expect(result.read?.closureReasons?.[months[0]]).toContain("incohérent"); expect(result.read?.closureReasons?.[months[1]]).toContain("incohérent");
  });
  it("le statut d'un mois hors du périmètre appliqué est ignoré", async () => {
    mocks.selected[1].push({ period: "2025-12", month: "2025-12", status: "completed" });
    expect((await loadPayrollExplorationContext(ctx())).read?.closedMonths).toEqual([months[0]]);
  });
  it("refuse la lecture devenue remplacée, sans lire les statuts d'un autre dépôt", async () => {
    mocks.selected = [[]]; const result = await loadPayrollExplorationContext(ctx());
    expect(result.read).toBeNull(); expect(result.unavailable).toContain("remplacée"); expect(mocks.fields).toHaveLength(1);
  });
  it("source DSN ou contexte sans journal ne déclenche aucune requête", async () => {
    const dsn = ctx(); dsn.source = "dsn";
    expect((await loadPayrollExplorationContext(dsn)).source).toBe("dsn");
    const missing = ctx(); missing.input = null;
    expect((await loadPayrollExplorationContext(missing)).read).toBeNull(); expect(mocks.scope).not.toHaveBeenCalled();
  });
  it("un completed futur ne devient pas le défaut de clôture", async () => {
    mocks.selected[1].push({ period: months[2], month: months[2], status: "completed" });
    const result = await loadPayrollExplorationContext(ctx());
    expect(result.read?.closedMonths).toEqual([months[0]]); expect(result.read?.closureReasons?.[months[2]]).toContain("non terminé");
  });
  it("la date de Paris détermine la clôture calendaire, pas UTC ni l'horloge système", async () => {
    mocks.selected[0] = [{ id: "sync-fixture", startedAt: new Date("2026-01-30T23:30:00Z") }];
    expect((await loadPayrollExplorationContext(ctx())).read?.closedMonths).toEqual([months[0]]);
  });
  it("un statut inconnu, une date invalide ou une exception privée restent indisponibles", async () => {
    mocks.selected[1][0] = { period: months[0], month: months[0], status: "not-understood" };
    expect((await loadPayrollExplorationContext(ctx())).read?.closedMonths).toEqual([]);
    mocks.selected = [[{ id: "sync-fixture", startedAt: new Date("invalid") }]];
    expect((await loadPayrollExplorationContext(ctx())).read).toBeNull();
    mocks.scope.mockRejectedValueOnce(new Error("PRIVATE-SQL-CLIENT-CONTENT-FICTIVE"));
    const result = await loadPayrollExplorationContext(ctx());
    expect(result.read).toBeNull(); expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SQL/);
  });
});
