import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayrollContext } from "@/lib/payroll/context";
import type { ScenarioFull } from "@/lib/budget/store";
import type { BaseSnapshot } from "@/lib/budget/types";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import type { JournalInput } from "@/lib/payroll/engine";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), payroll: vi.fn(), scenarios: vi.fn(), budgets: vi.fn(), getScenario: vi.fn(), getBudget: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.guard }));
vi.mock("@/lib/payroll/context", () => ({ loadPayrollContext: mocks.payroll }));
vi.mock("@/lib/rh/kpi/etp", () => ({ etpMonthEnd: () => ({ kind: "nd", nd: { reason: "ETP fictif indisponible" } }) }));
vi.mock("@/lib/budget/store", () => ({ listScenarios: mocks.scenarios, listBudgets: mocks.budgets, getScenario: mocks.getScenario, getBudget: mocks.getBudget, KIND_LABELS: { budget: "Budget", revise: "Révisé", simulation: "Simulation" } }));
import { loadSuivi } from "@/app/e/[slug]/studio-rh/masse-salariale/suivi/suivi-data";

const BID = "11111111-1111-4111-8111-111111111111";
const SID = "22222222-2222-4222-8222-222222222222";
const budget = { id: BID, name: "Budget fictif", year: "2026", amounts: { "2026-01": 100_000, "2026-02": 100_000, "2026-03": 100_000, "2026-04": 100_000 } };
const journal = (): JournalInput => ({
  months: ["2026-01", "2026-02", "2026-03", "2026-04"], openMonths: [], grid: DEFAULT_PREFIXES,
  lines: ["2026-01", "2026-02", "2026-03", "2026-04"].map((month) => ({ key: `PRIVATE-LEDGER-${month}`, month, accountId: "641100", accountName: "Compte fictif", debitCents: 110_000, creditCents: null, contractId: "PRIVATE-CONTRACT-ID" })),
});
const context = (): PayrollContext => ({ source: "payfit", input: journal(), read: { syncId: "PRIVATE-SYNC", startedAt: new Date("2026-04-05T08:00:00Z"), months: journal().months }, unavailable: null, kpi: { input: null } }) as unknown as PayrollContext;
const base = (): BaseSnapshot => ({
  currency: "EUR", refMonth: "2026-01", syncId: "PRIVATE-SYNC", readAt: "2026-02-05T08:00:00Z", refMasse: 110_000, refBaseCost: null, etpNote: null,
  contracts: [{ contractKey: "PRIVATE-CONTRACT-ID", externalId: "PRIVATE-EXTERNAL-ID", label: "NOM_FICTIF_CONFIDENTIEL", service: null, serviceNd: null, startDate: "2025-01-01", endDate: null, counted: true, etp4: 10_000, etpNd: null, base: { salaryCents: 100_000, refBrutCents: 100_000, refCotisationsCents: 10_000 }, baseNd: null }],
  actuals: [{ month: "2026-01", kind: "value", brut: 100_000, cotisations: 10_000, masse: 110_000, headcount: 1, etp4: 10_000, etpNd: null }],
});
const scenario = (): ScenarioFull => ({ scenario: { id: SID, name: "Scénario fictif", kind: "budget", status: "fige", firstMonth: "2026-02", lastMonth: "2026-12", conventions: { prorata: "calendaire" } }, base: base(), baseHash: "fixture", hypotheses: [] }) as unknown as ScenarioFull;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ workspace: { id: "workspace-fixture", role: "reader" } });
  mocks.payroll.mockResolvedValue(context());
  mocks.scenarios.mockResolvedValue([{ scenario: scenario().scenario, refMonth: "2026-01" }]);
  mocks.budgets.mockResolvedValue([budget]);
  mocks.getBudget.mockResolvedValue(budget);
  mocks.getScenario.mockResolvedValue(scenario());
});

describe("Suivi autonome : chargement autorisé et borné", () => {
  it("la garde précède toute lecture ; un refus d'accès ne lit aucune donnée", async () => {
    mocks.guard.mockRejectedValueOnce(new Error("Accès refusé fictif"));
    await expect(loadSuivi("demo", {})).rejects.toThrow("Accès refusé fictif");
    for (const mock of [mocks.payroll, mocks.scenarios, mocks.budgets, mocks.getBudget, mocks.getScenario]) expect(mock).not.toHaveBeenCalled();
    await loadSuivi("demo", { reference: `budget:${BID}` });
    expect(mocks.guard.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.payroll.mock.invocationCallOrder[0]);
    expect(mocks.scenarios).toHaveBeenCalledWith("workspace-fixture");
    expect(mocks.budgets).toHaveBeenCalledWith("workspace-fixture");
    expect(mocks.getBudget).toHaveBeenCalledWith("workspace-fixture", BID);
  });
  it("aucune référence autochoisie, malgré des budgets et scénarios disponibles", async () => {
    const m = await loadSuivi("demo", {});
    expect(m.reference).toBeNull();
    expect(m.state.reference).toBe("");
    expect(m.options).toHaveLength(2);
    expect(m.reason).toContain("Choisis un budget ou un scénario");
    expect(mocks.getBudget).not.toHaveBeenCalled();
    expect(mocks.getScenario).not.toHaveBeenCalled();
  });
  it("référence inconnue (autre espace ou supprimée) : aucune lecture directe, aucun repli ni recopie du paramètre libre", async () => {
    const m = await loadSuivi("demo", { reference: "scenario:PRIVATE-UNKNOWN-ID" });
    expect(m.reference).toBeNull();
    expect(m.reason).toContain("Référence indisponible dans cet espace");
    expect(mocks.getScenario).not.toHaveBeenCalled();
    expect(JSON.stringify(m)).not.toContain("PRIVATE-UNKNOWN-ID");
  });
  it("clôture par défaut au dernier mois clos de la lecture ; mois ouvert et mois calendaire courant exclus", async () => {
    const ctx = context();
    ctx.input!.openMonths = ["2026-03"];
    mocks.payroll.mockResolvedValue(ctx);
    const m = await loadSuivi("demo", { reference: `budget:${BID}` });
    expect(m.cutoffOptions).toEqual(["2026-01", "2026-02"]);
    expect(m.cutoff).toBe("2026-02");
    expect(m.totals.actual).toEqual({ kind: "value", cents: 220_000 });
    expect(m.totals.gap).toMatchObject({ kind: "value", cents: 20_000 });
    expect(JSON.stringify(m)).not.toMatch(/PRIVATE-LEDGER|PRIVATE-CONTRACT|PRIVATE-SYNC/);
  });
  it("la date du journal fait foi, même si le référentiel RH est plus ancien ; heure interprétée à Paris", async () => {
    const ctx = context();
    ctx.kpi.input = { data: { build: { referenceDate: "2026-02-01" } } } as never;
    // 1er mai à Paris : avril est fini, même si le jour UTC est encore le 30 avril.
    ctx.read!.startedAt = new Date("2026-04-30T22:30:00Z");
    mocks.payroll.mockResolvedValue(ctx);
    const m = await loadSuivi("demo", { reference: `budget:${BID}` });
    expect(m.cutoff).toBe("2026-04");
    expect(m.source.readAt).toBe("2026-04-30T22:30:00.000Z");
  });
  it("clôture ou année explicites invalides : pas de substitution automatique", async () => {
    const m = await loadSuivi("demo", { reference: `budget:${BID}`, cloture: "2026-04" });
    expect(m.cutoff).toBeNull();
    expect(m.state.cloture).toBe("");
    expect(m.totals.actual.kind).toBe("nd");
    expect(m.notices).toContainEqual(expect.stringContaining("Clôture indisponible"));
    const y = await loadSuivi("demo", { reference: `budget:${BID}`, annee: "PRIVATE-YEAR" });
    expect(y.state.annee).toBe("");
    expect(y.rows).toEqual([]);
    expect(JSON.stringify(y)).not.toContain("PRIVATE-YEAR");
  });
  it("un trou ou une ligne sans montant avant clôture invalide le cumul, sans exposer la clé de journal", async () => {
    const ctx = context();
    ctx.input!.lines[1].debitCents = null;
    ctx.input!.lines[1].key = "PRIVATE-LEDGER\nKEY WITH SPACES";
    mocks.payroll.mockResolvedValue(ctx);
    const m = await loadSuivi("demo", { reference: `budget:${BID}` });
    expect(m.cutoff).toBe("2026-03");
    expect(m.rows[1].actual).toEqual({ kind: "nd", reason: "Une ligne comptable n'a aucun montant (ni débit ni crédit)." });
    expect(m.totals.actual.kind).toBe("nd");
    expect(m.totals.gap.kind).toBe("nd");
    expect(m.chart.actual.slice(0, 3)).toEqual([110_000, null, 110_000]);
    expect(JSON.stringify(m)).not.toMatch(/PRIVATE-LEDGER|PRIVATE-CONTRACT|PRIVATE-SYNC/);
  });
  it("borne BigInt des lignes source : une annulation après dépassement intermédiaire ne publie pas un faux centime sûr", async () => {
    const ctx = context();
    const line = ctx.input!.lines[1];
    ctx.input!.lines = [
      ...ctx.input!.lines.filter((l) => l.month !== "2026-02"),
      { ...line, key: "PRIVATE-LARGE-DEBIT", debitCents: Number.MAX_SAFE_INTEGER },
      { ...line, key: "PRIVATE-SMALL-DEBIT", debitCents: 2 },
      { ...line, key: "PRIVATE-LARGE-CREDIT", debitCents: null, creditCents: Number.MAX_SAFE_INTEGER },
    ];
    mocks.payroll.mockResolvedValue(ctx);
    const m = await loadSuivi("demo", { reference: `budget:${BID}` });
    expect(m.rows[1].actual).toEqual({ kind: "nd", reason: "Montants source hors de la précision exacte en centimes : mois non publiable." });
    expect(m.cutoffOptions).toEqual(["2026-01", "2026-03"]);
    expect(m.cutoff).toBe("2026-03");
    expect(m.chart.actual.slice(0, 3)).toEqual([110_000, null, 110_000]);
    expect(m.totals.actual.kind).toBe("nd");
    expect(m.totals.gap.kind).toBe("nd");
    expect(JSON.stringify(m)).not.toContain("PRIVATE-LARGE");
  });
  it("borne source par mois, comptes de contrepartie hors grille exclus ; un mois risqué n'est jamais une clôture proposée", async () => {
    const ctx = context();
    const line = ctx.input!.lines[2];
    ctx.input!.lines.push(
      { ...line, key: "PRIVATE-COUNTERPART", accountId: "421100", debitCents: Number.MAX_SAFE_INTEGER, creditCents: Number.MAX_SAFE_INTEGER },
    );
    mocks.payroll.mockResolvedValueOnce(ctx);
    const safe = await loadSuivi("demo", { reference: `budget:${BID}` });
    expect(safe.cutoff).toBe("2026-03");
    expect(safe.rows[2].actual).toEqual({ kind: "value", cents: 110_000 });
    const risk = context();
    risk.input!.lines[2] = { ...line, debitCents: Number.MAX_SAFE_INTEGER, creditCents: 1 };
    mocks.payroll.mockResolvedValueOnce(risk);
    const excluded = await loadSuivi("demo", { reference: `budget:${BID}`, cloture: "2026-03" });
    expect(excluded.cutoffOptions).not.toContain("2026-03");
    expect(excluded.cutoff).toBeNull();
    expect(excluded.totals.actual.kind).toBe("nd");
  });
  it("scénario : moteur réutilisé, provenance et détail ; aucune identité ni hypothèse dans le DTO", async () => {
    const m = await loadSuivi("demo", { reference: `scenario:${SID}` });
    expect(m.rows[0].origin).toBe("Réel figé");
    expect(m.rows[1].origin).toBe("Projeté");
    expect(m.rows[1].reference).toEqual({ kind: "value", cents: 110_000 });
    expect(m.rows[1].referenceHref).toContain("mois=2026-02&affichage=tableau#proj-detail");
    expect(mocks.getScenario).toHaveBeenCalledWith("workspace-fixture", SID);
    expect(JSON.stringify(m)).not.toMatch(/NOM_FICTIF_CONFIDENTIEL|PRIVATE-CONTRACT|PRIVATE-EXTERNAL|PRIVATE-SYNC|salaryCents|contributions/);
  });
  it("projection n.d. : raison publique décomptée ; erreur moteur et erreur de lecture restent génériques", async () => {
    const full = scenario();
    full.base.contracts[0].base = null;
    full.base.contracts[0].baseNd = "PRIVATE-CAUSE";
    mocks.getScenario.mockResolvedValueOnce(full);
    const nd = await loadSuivi("demo", { reference: `scenario:${SID}` });
    expect(nd.rows[1].reference).toMatchObject({ kind: "nd", reason: expect.stringContaining("1 contrat sans base de projection") });
    expect(JSON.stringify(nd)).not.toMatch(/NOM_FICTIF_CONFIDENTIEL|PRIVATE-CAUSE/);
    const invalid = scenario();
    invalid.hypotheses = [{ id: "fixture-error", kind: "augmentation", label: "PRIVATE-ERROR-LABEL", from: "2027-01", rateBps: 100, scope: { kind: "global" } }];
    mocks.getScenario.mockResolvedValueOnce(invalid);
    const error = await loadSuivi("demo", { reference: `scenario:${SID}` });
    expect(error.reason).toContain("Projection indisponible");
    expect(JSON.stringify(error)).not.toContain("PRIVATE-ERROR-LABEL");
    mocks.getScenario.mockRejectedValueOnce(new Error("PRIVATE-RAW-ERROR"));
    const failure = await loadSuivi("demo", { reference: `scenario:${SID}` });
    expect(failure.reason).toContain("Lecture de la référence indisponible");
    expect(JSON.stringify(failure)).not.toContain("PRIVATE-RAW-ERROR");
  });
  it("budget supprimé entre liste et lecture : pas de repli vers un autre budget ou scénario", async () => {
    mocks.getBudget.mockResolvedValueOnce(null);
    const m = await loadSuivi("demo", { reference: `budget:${BID}` });
    expect(m.reference?.kind).toBe("budget");
    expect(m.reason).toContain("n'est plus disponible");
    expect(m.totals.reference.kind).toBe("nd");
    expect(mocks.getScenario).not.toHaveBeenCalled();
  });
});
