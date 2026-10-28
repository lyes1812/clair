import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), save: vi.fn(), list: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/payroll/context", () => ({ loadPayrollContext: mocks.context }));
vi.mock("@/lib/payroll/non-recurring-store", () => ({ saveActualEvent: mocks.save, listActualEvents: mocks.list, ActualEventError: class extends Error {} }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveActualEventAction } from "@/app/e/[slug]/studio-rh/masse-salariale/actual-actions";
const sync = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const form = (patch: Record<string, string> = {}) => {
  const f = new FormData();
  Object.entries({ kind: "tuilage", month: "2026-06", contract1: "payfit:fictif-a", contract2: "payfit:fictif-b", chargedEuros: "", note: "Binôme déclaré, montant à préciser", ...patch }).forEach(([key, value]) => f.set(key, value));
  return f;
};
const ctx = () => ({ source: "payfit", read: { syncId: sync }, input: { grid: DEFAULT_PREFIXES, months: ["2026-06"], openMonths: [], lines: [{ key: "fictif-1", month: "2026-06", accountId: "6411", accountName: null, debitCents: 100000, creditCents: 0, contractId: "fictif-a" }] }, kpi: { collab: { data: { contracts: [{ contractKey: "payfit:fictif-a" }, { contractKey: "payfit:fictif-b" }] } } } });
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ workspace: { id: "espace-fictif" }, session: { user: { id: "editeur-fictif" } } }); mocks.context.mockResolvedValue(ctx()); mocks.save.mockResolvedValue(undefined); mocks.list.mockResolvedValue([]);
});

const calculationContext = () => ({
  ...ctx(), input: { ...ctx().input, lines: [
    { ...ctx().input.lines[0], debitCents: 100_000 },
    { ...ctx().input.lines[0], key: "charges-fictives", accountId: "6451", debitCents: 40_000 },
    { ...ctx().input.lines[0], key: "sortant-fictif", contractId: "fictif-b", debitCents: 999_999 },
  ] }, kpi: { collab: { data: { build: { inputs: { source: "payfit", syncId: sync } }, contracts: [
    { contractKey: "payfit:fictif-a", externalId: "fictif-a", startDate: "2026-06-11", endDate: null },
    { contractKey: "payfit:fictif-b", externalId: "fictif-b", startDate: "2020-01-01", endDate: "2026-06-20" },
  ] } } },
});

describe("Tuilage calculé : autorité serveur et provenance", () => {
  it("ignore le montant du navigateur et calcule seulement la paie de l’entrant avec une provenance persistée", async () => {
    mocks.context.mockResolvedValue(calculationContext());
    const result = await saveActualEventAction("fictif", sync, {}, undefined, form({ valuation: "calendar", chargedEuros: "DONNEE_CLIENT_INVALIDE", note: "" }));
    expect(result?.ok).toContain("Estimation calendaire");
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith("espace-fictif", "editeur-fictif", expect.objectContaining({ chargedCents: 70_000, contractKeys: ["payfit:fictif-a", "payfit:fictif-b"], calculation: expect.objectContaining({ basis: "calendar-estimate", days: { incomingPresence: 20, overlap: 10 }, source: expect.objectContaining({ chargedCents: 140_000, lineKeys: ["charges-fictives", "fictif-1"] }) }) }), null);
  });

  it("recalcule lors de l’édition en conservant le même événement et le verrou de version", async () => {
    const context = calculationContext(); mocks.context.mockResolvedValue(context);
    await saveActualEventAction("fictif", sync, {}, undefined, form({ valuation: "calendar" }));
    const previous = mocks.save.mock.calls[0][2]; mocks.list.mockResolvedValue([previous]);
    context.input.lines[0].debitCents = 200_000;
    const result = await saveActualEventAction("fictif", sync, { [previous.id]: "version-calcul-affichee" }, undefined, form({ id: previous.id, valuation: "calendar", chargedEuros: "1" }));
    expect(result?.ok).toBeTruthy();
    expect(mocks.save.mock.calls[1]).toEqual(["espace-fictif", "editeur-fictif", expect.objectContaining({ id: previous.id, chargedCents: 120_000 }), "version-calcul-affichee"]);
  });

  it("ne remplace jamais silencieusement une saisie manuelle attestée", async () => {
    mocks.context.mockResolvedValue(calculationContext());
    mocks.list.mockResolvedValue([{ id, kind: "tuilage", month: "2026-06", syncId: sync, contractKeys: ["payfit:fictif-a", "payfit:fictif-b"], chargedCents: 8_000, note: "Justificatif fictif validé" }]);
    const result = await saveActualEventAction("fictif", sync, { [id]: "version-affichee" }, undefined, form({ id, valuation: "calendar" }));
    expect(result?.error).toContain("Confirme explicitement"); expect(mocks.save).not.toHaveBeenCalled();
    expect((await saveActualEventAction("fictif", sync, { [id]: "version-affichee" }, undefined, form({ id, valuation: "calendar", confirmReplace: "yes" })))?.ok).toBeTruthy();
    expect(mocks.save.mock.calls[0][2]).toMatchObject({ id, chargedCents: 70_000, calculation: { basis: "calendar-estimate" } });
  });

  it("refuse absence de charges, dates inconnues, autre lecture et mode non applicable avant écriture", async () => {
    const noCharges = calculationContext(); noCharges.input.lines = noCharges.input.lines.filter((line) => line.accountId !== "6451"); mocks.context.mockResolvedValue(noCharges);
    expect((await saveActualEventAction("fictif", sync, {}, undefined, form({ valuation: "calendar" })))?.error).toContain("Aucune ligne de cotisations");
    const noEnd = calculationContext(); noEnd.kpi.collab.data.contracts[1].endDate = null; mocks.context.mockResolvedValue(noEnd);
    expect((await saveActualEventAction("fictif", sync, {}, undefined, form({ valuation: "calendar" })))?.error).toContain("Date de fin");
    const old = calculationContext(); old.kpi.collab.data.build.inputs.syncId = id; mocks.context.mockResolvedValue(old);
    expect((await saveActualEventAction("fictif", sync, {}, undefined, form({ valuation: "calendar" })))?.error).toContain("référentiel");
    expect((await saveActualEventAction("fictif", sync, {}, undefined, form({ valuation: "calendar", kind: "licenciement", contract2: "" })))?.error).toContain("réservée");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
describe("Non récurrents du réel : saisie indépendante des scénarios", () => {
  it("un lecteur est refusé avant toute lecture ou écriture métier", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(saveActualEventAction("fictif", sync, {}, undefined, form())).rejects.toThrow("404");
    expect(mocks.auth).toHaveBeenCalledWith("fictif", "editor"); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("désigne un binôme sans inventer son coût, et ne touche ni paie ni scénario", async () => {
    expect((await saveActualEventAction("fictif", sync, {}, undefined, form()))?.ok).toBeTruthy();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith("espace-fictif", "editeur-fictif", expect.objectContaining({ kind: "tuilage", month: "2026-06", chargedCents: null, contractKeys: ["payfit:fictif-a", "payfit:fictif-b"], syncId: sync }), null);
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual(["/e/fictif/studio-rh/masse-salariale", "/e/fictif/studio-rh/masse-salariale/croisee", "/e/fictif/studio-rh/hypotheses"]);
  });
  it("garde le zéro explicite et le montant en euros exact", async () => {
    await saveActualEventAction("fictif", sync, {}, undefined, form({ chargedEuros: "0" }));
    expect(mocks.save.mock.calls[0][2].chargedCents).toBe(0);
    await saveActualEventAction("fictif", sync, {}, undefined, form({ kind: "licenciement", contract2: "", chargedEuros: "1234,56" }));
    expect(mocks.save.mock.calls[1][2].chargedCents).toBe(123456);
  });
  it.each<Record<string, string>>([{ contract2: "payfit:fictif-a" }, { contract2: "" }, { contract1: "payfit:autre-espace" }, { month: "2026-07" }, { chargedEuros: "-1" }, { chargedEuros: "1.234" }, { chargedEuros: "50", note: "" }, { id }])("refuse une saisie invalide sans écriture", async (patch) => {
    expect((await saveActualEventAction("fictif", sync, {}, undefined, form(patch)))?.error).toBeTruthy(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("une nouvelle lecture invalide le formulaire affiché", async () => {
    mocks.context.mockResolvedValue({ ...ctx(), read: { syncId: id } });
    expect((await saveActualEventAction("fictif", sync, {}, undefined, form()))?.error).toContain("changé"); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("transmet la version affichée à la transaction et ne révèle aucune erreur brute", async () => {
    await saveActualEventAction("fictif", sync, { [id]: "version-affichee" }, undefined, form({ id }));
    expect(mocks.save.mock.calls[0][3]).toBe("version-affichee");
    const log = vi.spyOn(console, "error"); mocks.save.mockRejectedValue(new Error("PAYLOAD_FICTIF_SECRET_NE_PAS_LOGUER"));
    const result = await saveActualEventAction("fictif", sync, { [id]: "version-affichee" }, undefined, form({ id }));
    expect(JSON.stringify(result)).not.toContain("PAYLOAD"); expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
});
