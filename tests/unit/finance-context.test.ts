import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyFinanceSettings } from "@/lib/finance/plans";
import type { ComptaSource } from "@/lib/payroll/context";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), source: vi.fn(), accounting: vi.fn(), settings: vi.fn(), scenarios: vi.fn(), scenario: vi.fn(), project: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/sources", () => ({ resolveSource: mocks.source }));
vi.mock("@/lib/payroll/context", () => ({ loadCompta: mocks.accounting }));
vi.mock("@/lib/finance/store", () => ({ getFinanceSettings: mocks.settings }));
vi.mock("@/lib/budget/store", () => ({ listScenarios: mocks.scenarios, getScenario: mocks.scenario }));
vi.mock("@/lib/budget/engine", () => ({ project: mocks.project }));
import { loadFinanceContext } from "@/lib/finance/context";
const ID = "11111111-1111-4111-8111-111111111111", RH = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ workspace: { id: "w-fictif", name: "Espace fictif", role: "reader" } });
  mocks.source.mockResolvedValue({ chosen: "pennylane", appliedAt: new Date("2026-10-01") });
  mocks.accounting.mockResolvedValue({ source: "pennylane", reason: "lu", error: false, months: ["2026-01", "2026-09"], nd: {}, lines: [{ accountId: "707", month: "2026-01", debitCents: 0, creditCents: 10000 }, { accountId: "707", month: "2026-09", debitCents: 0, creditCents: 90000 }] } satisfies ComptaSource);
  mocks.settings.mockResolvedValue(emptyFinanceSettings()); mocks.scenarios.mockResolvedValue([]);
});
describe("Finance : mêmes sources appliquées, période et scénario explicites", () => {
  it("autorise avant toute lecture ; ne charge pas un autre espace", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(loadFinanceContext("refuse", {})).rejects.toThrow("404");
    expect(mocks.accounting).not.toHaveBeenCalled(); expect(mocks.settings).not.toHaveBeenCalled();
  });
  it("période visible distincte des12mois nécessaires à la prévision, N-1 reste n.d.", async () => {
    const c = await loadFinanceContext("fictif", { annee: "2026", debut: "2026-09", fin: "2026-09" });
    expect(c.months).toEqual(["2026-09"]); expect(c.actuals.months).toHaveLength(12); expect(c.previous.months).toHaveLength(12);
    expect(c.actuals.months[8].cells.revenue.cents).toBe(90000); expect(c.previous.months[8].cells.revenue.cents).toBeNull();
    expect(c.selectedPlan).toBeNull(); expect(c.canEdit).toBe(false);
    expect(mocks.scenario).not.toHaveBeenCalled();
    expect(mocks.accounting).toHaveBeenCalledWith("w-fictif");
  });
  it("un changement de source concurrent n'est pas faussement attribué à Pennylane", async () => {
    mocks.source.mockResolvedValue({ chosen: "fec" });
    const c = await loadFinanceContext("fictif", {});
    expect(c.actuals.months.every((m) => m.result.cents === null)).toBe(true);
  });
  it("pas de choix implicite du dernier scénario ; sélection explicite tenant/year", async () => {
    const settings = { ...emptyFinanceSettings(), plans: [{ id: ID, name: "Prévision fictive", year: 2026, kind: "forecast" as const, currency: "EUR" as const, firstForecastMonth: "2026-10", cells: {}, personnelSource: "rh" as const, rhScenarioId: RH, updatedAt: "2026-01-01T00:00:00Z" }] };
    mocks.settings.mockResolvedValue(settings);
    await loadFinanceContext("fictif", { plan: "autre-version" });
    expect(mocks.scenario).not.toHaveBeenCalled();
    mocks.scenario.mockResolvedValue({ base: {}, hypotheses: [], scenario: { firstMonth: "2026-10", lastMonth: "2026-12", conventions: {} } });
    mocks.project.mockReturnValue({ kind: "value", months: [{ month: "2026-10", kind: "value", cost: 50000 }] });
    const c = await loadFinanceContext("fictif", { plan: ID });
    expect(mocks.scenario).toHaveBeenCalledWith("w-fictif", RH);
    expect(c.projection?.[9].cells.personnel).toEqual({ cents: 50000, reason: null });
    expect(c.projection?.[0].cells.personnel.cents).toBe(0);
  });
});
