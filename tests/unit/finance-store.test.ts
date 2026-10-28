import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { budgetScenario, workspaceEvent, workspaceSetting } from "@/db/schema";
import { emptyFinanceSettings, FINANCE_SETTINGS_KEY, FinanceError } from "@/lib/finance/plans";
import type { FinancePlan, FinanceSettings } from "@/lib/finance/types";

const scope = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/db/workspace-scope", () => ({ withWorkspace: scope.run }));
import { getFinanceSettings, saveFinanceSettings } from "@/lib/finance/store";

const ID = "11111111-1111-4111-8111-111111111111";
const RH = "abcdefab-2222-4222-8222-222222222222";
const plan = (over: Partial<FinancePlan> = {}): FinancePlan => ({
  id: ID, name: "Budget FICTIF_NON_JOURNALISE", kind: "budget", year: 2026, currency: "EUR", firstForecastMonth: null,
  cells: { "2026-01": { revenue: 123456, personnel: 654321 } },
  personnelSource: "manual", rhScenarioId: null, updatedAt: "2026-01-01T12:00:00.000Z", ...over,
});
const settings = (over: Partial<FinanceSettings> = {}): FinanceSettings => ({ ...emptyFinanceSettings(), plans: [plan()], ...over });
const dialect = new PgDialect();
type Query = { table: unknown; selection: Record<string, unknown>; params: unknown[]; locked: boolean };
type Conflict = { target: unknown[]; set: Record<string, unknown>; setWhere: SQL };
const state = {
  settings: new Map<string, unknown>(), rh: new Map<string, string[]>(),
  events: [] as Record<string, unknown>[], queries: [] as Query[],
  writes: [] as Record<string, unknown>[], conflicts: [] as Conflict[],
  returnNoRow: false, failEvent: false,
};

function transaction(workspaceId: string) {
  return {
    select(selection: Record<string, unknown>) {
      return { from(table: unknown) { return { where(condition: SQL) {
        const params = dialect.sqlToQuery(condition).params;
        const query = { table, selection, params, locked: false };
        state.queries.push(query);
        const rows = table === workspaceSetting
          ? state.settings.has(workspaceId) ? [{ value: structuredClone(state.settings.get(workspaceId)) }] : []
          : table === budgetScenario ? (state.rh.get(workspaceId) ?? []).filter((id) => params.includes(id)).map((id) => ({ id })) : [];
        return Object.assign(Promise.resolve(rows), { for(mode: string) { query.locked = mode === "update"; return Promise.resolve(rows); } });
      } }; } };
    },
    insert(table: unknown) {
      return { values(value: Record<string, unknown>) {
        if (table === workspaceEvent) {
          if (state.failEvent) throw new Error("Échec fictif du journal");
          state.events.push(structuredClone(value));
          return Promise.resolve();
        }
        if (table !== workspaceSetting) throw new Error("Table inattendue dans le test");
        state.writes.push(value);
        return { onConflictDoUpdate(conflict: Conflict) {
          state.conflicts.push(conflict);
          return { returning() {
            if (state.returnNoRow) return Promise.resolve([]);
            state.settings.set(workspaceId, structuredClone(value.value));
            return Promise.resolve([{ id: "setting-fictif" }]);
          } };
        } };
      } };
    },
  };
}

beforeEach(() => {
  scope.run.mockReset();
  state.settings.clear(); state.rh.clear(); state.events.length = 0; state.queries.length = 0;
  state.writes.length = 0; state.conflicts.length = 0; state.returnNoRow = false; state.failEvent = false;
  scope.run.mockImplementation(async (workspaceId: string, callback: (tx: ReturnType<typeof transaction>) => Promise<unknown>) => {
    const previous = structuredClone(state.settings);
    const eventCount = state.events.length;
    try { return await callback(transaction(workspaceId)); }
    catch (error) {
      state.settings.clear(); previous.forEach((value, key) => state.settings.set(key, value));
      state.events.splice(eventCount);
      throw error;
    }
  });
});

describe("paramètres financiers sous le périmètre de l'espace — transactions simulées", () => {
  it("une absence donne un réglage vide ; lecture bornée par espace et clé, sans lire l'autre espace", async () => {
    state.settings.set("autre-espace", settings());
    const value = await getFinanceSettings("espace-fictif");
    expect(value).toEqual(emptyFinanceSettings());
    expect(scope.run).toHaveBeenCalledOnce();
    expect(scope.run.mock.calls[0][0]).toBe("espace-fictif");
    expect(state.queries[0].params).toEqual(["espace-fictif", FINANCE_SETTINGS_KEY]);
    expect(state.queries[0].selection).toEqual({ value: workspaceSetting.value });
    state.settings.set("espace-fictif", settings());
    const read = await getFinanceSettings("espace-fictif");
    read.plans[0].cells["2026-01"].revenue = 0;
    expect((state.settings.get("espace-fictif") as FinanceSettings).plans[0].cells["2026-01"].revenue).toBe(123456);
  });

  it("un réglage stocké invalide est refusé en lecture et écriture, jamais remplacé par un vide", async () => {
    state.settings.set("espace-fictif", { invalid: true });
    await expect(getFinanceSettings("espace-fictif")).rejects.toBeInstanceOf(FinanceError);
    await expect(saveFinanceSettings("espace-fictif", "acteur-fictif", 0, settings())).rejects.toBeInstanceOf(FinanceError);
    expect(state.settings.get("espace-fictif")).toEqual({ invalid: true });
    expect(state.writes).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("enregistre révision suivante et journal de compteurs dans une seule transaction, sans libellé ni montant", async () => {
    const input = settings({ mappings: [{ account: "641", row: "personnel" }] });
    state.settings.set("autre-espace", settings({ revision: 9 }));
    await saveFinanceSettings("espace-fictif", "acteur-fictif", 0, input);
    expect(scope.run).toHaveBeenCalledOnce();
    expect((state.settings.get("espace-fictif") as FinanceSettings).revision).toBe(1);
    expect((state.settings.get("autre-espace") as FinanceSettings).revision).toBe(9);
    expect(input.revision).toBe(0);
    expect(state.queries[0].locked).toBe(true);
    expect(state.events).toEqual([{
      workspaceId: "espace-fictif", actorUserId: "acteur-fictif", kind: "setting.changed",
      detail: { key: FINANCE_SETTINGS_KEY, revision: 1, mappingCount: 1, planCount: 1, cellCount: 2 },
    }]);
    const event = JSON.stringify(state.events);
    for (const forbidden of ["FICTIF_NON_JOURNALISE", "123456", "654321", ID]) expect(event).not.toContain(forbidden);
    expect(state.conflicts[0].target).toEqual([workspaceSetting.workspaceId, workspaceSetting.key]);
    const query = dialect.sqlToQuery(state.conflicts[0].setWhere);
    expect(query.sql).toContain("->>'revision'");
    expect(query.params).toEqual(["espace-fictif", FINANCE_SETTINGS_KEY, "0"]);
  });

  it("révision périmée ou création absente avec révision non nulle : conflit sans écriture ni journal", async () => {
    state.settings.set("espace-fictif", settings({ revision: 2 }));
    await expect(saveFinanceSettings("espace-fictif", "acteur-fictif", 1, settings({ revision: 1 }))).rejects.toMatchObject({ code: "conflict" });
    await expect(saveFinanceSettings("absent", "acteur-fictif", 1, settings({ revision: 1 }))).rejects.toMatchObject({ code: "conflict" });
    expect(state.writes).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect((state.settings.get("espace-fictif") as FinanceSettings).revision).toBe(2);
  });

  it("la condition CAS reste requise si une création concurrente ne retourne aucune ligne", async () => {
    state.returnNoRow = true;
    await expect(saveFinanceSettings("espace-fictif", "acteur-fictif", 0, settings())).rejects.toMatchObject({ code: "conflict" });
    expect(state.conflicts).toHaveLength(1);
    expect(state.events).toHaveLength(0);
    expect(state.settings.has("espace-fictif")).toBe(false);
  });

  it("un scénario RH d'un autre espace est refusé sans lire son nom ni sa base", async () => {
    state.rh.set("autre-espace", [RH]);
    const input = settings({ plans: [plan({ personnelSource: "rh", rhScenarioId: RH })] });
    await expect(saveFinanceSettings("espace-fictif", "acteur-fictif", 0, input)).rejects.toMatchObject({ code: "rh-unavailable" });
    const query = state.queries.find((item) => item.table === budgetScenario)!;
    expect(query.selection).toEqual({ id: budgetScenario.id });
    expect(query.params).toEqual(["espace-fictif", RH]);
    expect(state.writes).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("références RH autorisées validées ensemble et UUID insensibles à la casse sans faux doublon", async () => {
    state.rh.set("espace-fictif", [RH]);
    const input = settings({ plans: [
      plan({ personnelSource: "rh", rhScenarioId: RH }),
      plan({ id: "33333333-3333-4333-8333-333333333333", personnelSource: "rh", rhScenarioId: RH.toUpperCase() }),
    ] });
    await saveFinanceSettings("espace-fictif", "acteur-fictif", 0, input);
    expect(state.queries.find((item) => item.table === budgetScenario)?.params).toEqual(["espace-fictif", RH]);
    expect((state.settings.get("espace-fictif") as FinanceSettings).plans).toHaveLength(2);
    expect(state.events).toHaveLength(1);
  });

  it("un échec du journal annule l'écriture dans la même transaction simulée", async () => {
    state.settings.set("espace-fictif", settings({ revision: 1 }));
    state.failEvent = true;
    await expect(saveFinanceSettings("espace-fictif", "acteur-fictif", 1, settings({ revision: 1 }))).rejects.toThrow("Échec fictif du journal");
    expect(scope.run).toHaveBeenCalledOnce();
    expect((state.settings.get("espace-fictif") as FinanceSettings).revision).toBe(1);
    expect(state.events).toHaveLength(0);
  });

  it("les entrées invalides sont rejetées avant toute transaction", async () => {
    const inputs: Array<[number, FinanceSettings]> = [[-1, settings()], [1, settings()], [Number.MAX_SAFE_INTEGER, settings({ revision: Number.MAX_SAFE_INTEGER })], [0, { ...settings(), secret: "fictif" } as FinanceSettings]];
    for (const [expected, input] of inputs) {
      await expect(saveFinanceSettings("espace-fictif", "acteur-fictif", expected, input)).rejects.toMatchObject({ code: "invalid" });
    }
    expect(scope.run).not.toHaveBeenCalled();
  });
});
