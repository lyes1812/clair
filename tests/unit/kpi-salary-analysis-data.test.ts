import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayrollContext } from "@/lib/payroll/context";
import type { PayrollExplorationInput } from "@/lib/payroll/exploration";
import { payrollItemsUnavailable } from "@/lib/rh/payroll-items";

const mocks = vi.hoisted(() => ({ context: vi.fn(), exploration: vi.fn(), payfit: vi.fn(), dsn: vi.fn() }));
vi.mock("@/lib/payroll/context", () => ({ loadPayrollContext: mocks.context }));
vi.mock("@/lib/payroll/exploration-context", () => ({ loadPayrollExplorationContext: mocks.exploration }));
vi.mock("@/lib/rh/payroll-items-store", () => ({ loadDsnPayrollItems: mocks.dsn }));
vi.mock("@/lib/rh/payroll-items", async (original) => ({
  ...await original<typeof import("@/lib/rh/payroll-items")>(), buildPayfitPayrollItems: mocks.payfit,
}));
import { loadSalaryAnalysis } from "@/app/e/[slug]/studio-rh/kpi/salary-analysis-data";

function context(source: "payfit" | "dsn" | null = "payfit"): PayrollContext {
  return {
    source,
    kpi: {
      collab: { chosen: source, workspace: { id: "workspace-fictif" }, data: {
        build: { source, referenceDate: "2026-11-05" },
        coverage: [{ month: "2024-02" }, { month: "2026-10" }, { month: "2026-08" }, { month: "2026-09" }, { month: "2026-11" }],
      } },
      input: { openMonths: ["2026-10"] },
    },
    input: { months: ["2026-08", "2026-09", "2026-10", "2026-11"], openMonths: [] },
    read: { syncId: "lecture-fictive", startedAt: new Date("2026-11-05T12:00:00Z"), months: ["2026-08", "2026-09", "2026-10", "2026-11"] },
    unavailable: null,
  } as unknown as PayrollContext;
}
function exploration(): PayrollExplorationInput {
  return {
    source: "payfit", journal: null, rh: null, unavailable: null,
    read: { syncId: "lecture-fictive", readAt: "2026-11-05T12:00:00.000Z", closedMonths: ["2026-08", "2026-09", "2026-11"],
      closureReasons: { "2026-10": "Paie non clôturée à la lecture." } },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue(context());
  mocks.exploration.mockResolvedValue(exploration());
  mocks.payfit.mockImplementation(({ month }: { month: string }) => ({ ...payrollItemsUnavailable("payfit", month, "fixture"), kind: "value", reason: null }));
  mocks.dsn.mockImplementation((_ctx, month: string) => ({ ...payrollItemsUnavailable("dsn", month, "fixture"), kind: "value", reason: null }));
});

describe("Analyse des salaires : période et sources appliquées", () => {
  it("choisit le dernier mois explicitement clôturé et ne propose que les mois de la lecture PayFit appliquée", async () => {
    const result = await loadSalaryAnalysis("espace-fictif", {});
    expect(result.month).toBe("2026-09");
    expect(result.months).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(result.months).not.toContain("2024-02");
    expect(mocks.context).toHaveBeenCalledWith("espace-fictif");
    expect(mocks.exploration).toHaveBeenCalledWith(expect.objectContaining({ source: "payfit" }));
    expect(mocks.payfit).toHaveBeenCalledWith(expect.objectContaining({ month: "2026-09", syncId: "lecture-fictive" }));
    expect(mocks.dsn).not.toHaveBeenCalled();
  });
  it("l'absence de completed explicite ne devient pas une paie clôturée", async () => {
    const read = exploration();
    read.read!.closedMonths = ["2026-08"];
    read.read!.closureReasons!["2026-09"] = "Statut de clôture absent : aucun completed explicite pour ce mois.";
    mocks.exploration.mockResolvedValue(read);
    const requested = await loadSalaryAnalysis("espace-fictif", { mois: "2026-09" });
    expect(requested.month).toBe("2026-09");
    expect(requested.payroll.reason).toContain("completed explicite");
    expect(mocks.payfit).not.toHaveBeenCalled();
    expect((await loadSalaryAnalysis("espace-fictif", {})).month).toBe("2026-08");
  });
  it("une couverture RH hors lecture ne devient ni une option ni un défaut PayFit", async () => {
    const read = exploration();
    read.read!.closedMonths = ["2024-02"];
    mocks.exploration.mockResolvedValue(read);
    const result = await loadSalaryAnalysis("espace-fictif", {});
    expect(result.months).not.toContain("2024-02");
    expect(result.month).toBe("");
    expect(result.payroll.reason).toContain("Aucun mois avec clôture PayFit explicite");
    const requested = await loadSalaryAnalysis("espace-fictif", { mois: "2024-02" });
    expect(requested.payroll.reason).toContain("hors de la lecture appliquée");
    expect(mocks.payfit).not.toHaveBeenCalled();
  });
  it.each([
    ["2026-10", "non clôturée"], ["2026-11", "non terminé"],
    ["2025-01", "hors de la lecture"], ["2026-99", "Mois invalide"], ["", "Mois invalide"],
  ])("ne remplace pas le mois explicite %s lorsqu'il est indisponible", async (month, reason) => {
    const result = await loadSalaryAnalysis("espace-fictif", { mois: month });
    expect(result.month).toBe(month);
    expect(result.payroll).toMatchObject({ kind: "nd", reason: expect.stringContaining(reason) });
    expect(mocks.payfit).not.toHaveBeenCalled(); expect(mocks.dsn).not.toHaveBeenCalled();
  });
  it("respecte aussi les mois ouverts du journal, sans dépendre du seul contexte KPI", async () => {
    const data = context(); data.input!.openMonths = ["2026-09"]; mocks.context.mockResolvedValue(data);
    expect((await loadSalaryAnalysis("espace-fictif", {})).month).toBe("2026-08");
    expect((await loadSalaryAnalysis("espace-fictif", { mois: "2026-09" })).payroll.reason).toContain("non clôturée");
  });
  it.each([null, "2026-99-99"])("une référence %s interdit de déduire la clôture", async (reference) => {
    const data = context(); data.kpi.collab.data!.build.referenceDate = reference; mocks.context.mockResolvedValue(data);
    const result = await loadSalaryAnalysis("espace-fictif", { mois: "2026-09" });
    expect(result.payroll.reason).toContain("Date de référence RH absente ou invalide");
    expect(mocks.payfit).not.toHaveBeenCalled();
  });
  it("réutilise exactement le chargeur DSN autorisé, sans mêler PayFit", async () => {
    const data = context("dsn"); data.input = null; data.read = null; data.kpi.input!.openMonths = []; mocks.context.mockResolvedValue(data);
    const result = await loadSalaryAnalysis("espace-fictif", { mois: ["2026-10", "2026-09"], rubrique: " dsn:001 " });
    expect(result).toMatchObject({ month: "2026-10", rubricKey: "dsn:001", payroll: { source: "dsn", kind: "value" } });
    expect(mocks.dsn).toHaveBeenCalledWith(data.kpi.collab, "2026-10");
    expect(mocks.exploration).not.toHaveBeenCalled(); expect(mocks.payfit).not.toHaveBeenCalled();
  });
  it("préserve l'indisponibilité DSN et ne charge pas un mois non clos", async () => {
    const data = context("dsn"); data.input = null; data.read = null; mocks.context.mockResolvedValue(data);
    mocks.dsn.mockResolvedValueOnce(payrollItemsUnavailable("dsn", "2026-09", "Couverture DSN bloquée", "blocked"));
    expect((await loadSalaryAnalysis("espace-fictif", { mois: "2026-09" })).payroll.coverage.status).toBe("blocked");
    mocks.dsn.mockClear();
    expect((await loadSalaryAnalysis("espace-fictif", { mois: "2026-11" })).payroll.reason).toContain("non terminé");
    expect(mocks.dsn).not.toHaveBeenCalled();
  });
  it("aucune source ne recycle la couverture d'un ancien référentiel", async () => {
    mocks.context.mockResolvedValue(context(null));
    const result = await loadSalaryAnalysis("espace-fictif", {});
    expect(result).toMatchObject({ month: "", months: [], payroll: { source: null, kind: "nd", reason: expect.stringContaining("Aucune source") } });
    expect(mocks.exploration).not.toHaveBeenCalled(); expect(mocks.payfit).not.toHaveBeenCalled(); expect(mocks.dsn).not.toHaveBeenCalled();
  });
  it("un référentiel d'une autre source et une clôture illisible ne donnent aucun montant", async () => {
    const data = context(); data.kpi.collab.data!.build.source = "dsn"; mocks.context.mockResolvedValueOnce(data);
    expect((await loadSalaryAnalysis("espace-fictif", {})).payroll.reason).toContain("Référentiel RH");
    mocks.exploration.mockResolvedValueOnce({ ...exploration(), unavailable: "Lecture des statuts indisponible", read: null });
    expect((await loadSalaryAnalysis("espace-fictif", { mois: "2026-09" })).payroll.reason).toContain("statuts indisponible");
    expect(mocks.payfit).not.toHaveBeenCalled();
  });
  it("borne les paramètres sans transformer un mois trop long en sélection valide", async () => {
    const result = await loadSalaryAnalysis("espace-fictif", { mois: "2026-09" + "x".repeat(1000), rubrique: "x".repeat(1000) });
    expect(result.month.length).toBeLessThanOrEqual(32); expect(result.rubricKey.length).toBe(180);
    expect(result.payroll.kind).toBe("nd"); expect(result.notices).toHaveLength(2); expect(mocks.payfit).not.toHaveBeenCalled();
  });
});
