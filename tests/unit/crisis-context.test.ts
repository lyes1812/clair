import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), coverage: vi.fn(), lines: vi.fn(), setting: vi.fn(), set: vi.fn(), revalidate: vi.fn(), plan: vi.fn(), update: vi.fn(), suppliers: vi.fn() }));
const { CashPlanError } = vi.hoisted(() => ({ CashPlanError: class CashPlanError extends Error {} }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/fec/import", () => ({ fecCoverage: mocks.coverage }));
vi.mock("@/lib/restructuring/crisis/store", () => ({ readCrisisLines: mocks.lines, getCashPlan: mocks.plan, updateCashPlan: mocks.update, readSupplierLines: mocks.suppliers, CashPlanError }));
vi.mock("@/lib/settings", () => ({ getSetting: mocks.setting, setSetting: mocks.set }));
vi.mock("@/lib/budget/store", () => ({ getScenario: vi.fn(), applyChanges: vi.fn() }));
vi.mock("@/lib/events", () => ({ recordEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
import { loadCrisisContext } from "@/lib/restructuring/crisis/context";
import { CRISIS_RANKS_KEY } from "@/lib/restructuring/crisis/ranks";
import { addCashFlowAction, deleteCashFlowAction, saveCashStartAction, saveCrisisRanksAction } from "@/app/e/[slug]/studio-restructuring/actions";
import { loadCashContext } from "@/lib/restructuring/crisis/cash-context";
import { emptyCashPlan, type CashPlanSettings } from "@/lib/restructuring/crisis/cashplan";

const exercise = (filename: string, firstDate: string, lastDate: string, pending = false) => ({ filename, firstDate, lastDate, pending, syncId: `sync-${filename}` });
const OLD = exercise("000000000FEC20251231.txt", "2025-01-01", "2025-12-31");
const NEW = exercise("000000000FEC20261231.txt", "2026-01-01", "2026-09-30");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ workspace: { id: "espace-fictif", name: "Espace fictif", role: "reader" }, session: { user: { id: "editeur-fictif" } } });
  mocks.coverage.mockResolvedValue([OLD, NEW]);
  mocks.lines.mockResolvedValue([{ accountId: "512000", accountName: "Banque fictive", auxiliary: null, auxiliaryLabel: null, date: "2026-01-01", debitCents: 1_000, creditCents: 0 }]);
  mocks.setting.mockImplementation(async (_ws: string, _key: string, parse: (v: unknown) => unknown) => parse({ staff: "superprivilege" }));
  mocks.plan.mockResolvedValue(emptyCashPlan());
  mocks.suppliers.mockResolvedValue([]);
  mocks.update.mockImplementation(async (_ws: string, _actor: string, change: (c: CashPlanSettings) => CashPlanSettings) => change(emptyCashPlan()));
});

describe("Cap 13 : accès d’abord, un seul exercice FEC appliqué lu", () => {
  it("un non-membre n’entraîne aucune lecture comptable", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(loadCrisisContext("refuse", {})).rejects.toThrow("404");
    expect(mocks.coverage).not.toHaveBeenCalled(); expect(mocks.lines).not.toHaveBeenCalled();
  });
  it("sans FEC appliqué : n.d. avec sa raison, aucune lecture de lignes", async () => {
    mocks.coverage.mockResolvedValue([exercise("en-attente.txt", "2026-01-01", "2026-06-30", true)]);
    const ctx = await loadCrisisContext("fictif", {});
    expect(ctx.position).toEqual({ kind: "nd", reason: expect.stringContaining("Aucun FEC appliqué") });
    expect(ctx.exercise).toBeNull(); expect(mocks.lines).not.toHaveBeenCalled();
  });
  it("par défaut : l’exercice le plus récent, arrêté à sa dernière écriture, dans l’espace vérifié", async () => {
    const ctx = await loadCrisisContext("fictif", {});
    expect(mocks.lines).toHaveBeenCalledWith("espace-fictif", NEW.syncId, NEW.filename, "2026-09-30");
    expect(ctx.exercise?.filename).toBe(NEW.filename); expect(ctx.asOf).toBe("2026-09-30");
    expect(ctx.position.kind === "value" && ctx.position.cash.available.cents).toBe(1_000);
    expect(mocks.setting).toHaveBeenCalledWith("espace-fictif", CRISIS_RANKS_KEY, expect.any(Function));
    expect(ctx.ranks).toEqual({ staff: "superprivilege" }); expect(ctx.canEdit).toBe(false);
  });
  it("exercice et date choisis sont respectés s’ils sont cohérents", async () => {
    const ctx = await loadCrisisContext("fictif", { exercice: OLD.filename, date: "2025-06-30" });
    expect(mocks.lines).toHaveBeenCalledWith("espace-fictif", OLD.syncId, OLD.filename, "2025-06-30");
    expect(ctx.notices).toEqual([]);
  });
  it("un exercice inconnu ou une date hors exercice ne sont jamais lus tels quels", async () => {
    const ctx = await loadCrisisContext("fictif", { exercice: "../autre-espace.txt", date: "2027-01-01" });
    expect(mocks.lines).toHaveBeenCalledWith("espace-fictif", NEW.syncId, NEW.filename, "2026-09-30");
    expect(ctx.notices).toHaveLength(2);
  });
  it("des rangs stockés illisibles ne sont pas appliqués", async () => {
    mocks.setting.mockImplementation(async (_ws: string, _key: string, parse: (v: unknown) => unknown) => parse({ staff: "inconnu" }));
    const ctx = await loadCrisisContext("fictif", {});
    expect(ctx.ranks).toBeNull(); expect(ctx.ranksUnreadable).toBe(true); expect(ctx.notices.join(" ")).toContain("illisibles");
  });
});

describe("Cap 13 : enregistrement des rangs réservé aux éditeurs", () => {
  const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.set(k, v); return f; };
  it("un lecteur refusé n’écrit rien", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(saveCrisisRanksAction("fictif", undefined, form({ "rank-staff": "superprivilege" }))).rejects.toThrow("404");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("enregistre uniquement les rangs connus, dans l’espace vérifié avec le rôle éditeur", async () => {
    const state = await saveCrisisRanksAction("fictif", undefined, form({ "rank-staff": "superprivilege", "rank-suppliers": "" }));
    expect(mocks.auth).toHaveBeenCalledWith("fictif", "editor");
    expect(mocks.set).toHaveBeenCalledWith("espace-fictif", CRISIS_RANKS_KEY, { staff: "superprivilege" }, "editeur-fictif");
    expect(state?.ok).toBeTruthy();
  });
  it("un rang inconnu est refusé sans écriture", async () => {
    const state = await saveCrisisRanksAction("fictif", undefined, form({ "rank-tax": "premier" }));
    expect(state?.error).toContain("État et collectivités"); expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe("Cap 13 : trésorerie à 13 semaines, solde de départ et accès", () => {
  it("un non-membre n’entraîne aucune lecture", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(loadCashContext("refuse", {})).rejects.toThrow("404");
    expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.coverage).not.toHaveBeenCalled();
  });
  it("par défaut : le plan part du solde net du FEC à la date d’arrêté", async () => {
    const ctx = await loadCashContext("fictif", {});
    expect(mocks.plan).toHaveBeenCalledWith("espace-fictif");
    expect(ctx.plan.kind === "value" && ctx.plan.start).toEqual({ date: "2026-09-30", cents: 1_000, source: "fec" });
    expect(mocks.suppliers).toHaveBeenCalledWith("espace-fictif", NEW.syncId, NEW.filename, "2026-09-30");
  });
  it("un solde saisi remplace celui du FEC, qui reste affiché pour mémoire", async () => {
    mocks.plan.mockResolvedValue({ ...emptyCashPlan(), start: { date: "2026-10-05", cents: -250 } });
    const ctx = await loadCashContext("fictif", {});
    expect(ctx.plan.kind === "value" && ctx.plan.start).toEqual({ date: "2026-10-05", cents: -250, source: "saisi" });
    expect(ctx.fecStart).toEqual({ date: "2026-09-30", cents: 1_000 });
  });
  it("sans FEC : n.d. tant qu’aucun solde n’est saisi, puis plan calculé sans FEC", async () => {
    mocks.coverage.mockResolvedValue([]);
    const empty = await loadCashContext("fictif", {});
    expect(empty.plan).toEqual({ kind: "nd", reason: expect.stringContaining("Aucun solde de départ") });
    expect(mocks.suppliers).not.toHaveBeenCalled(); expect(empty.openItems.kind).toBe("nd");
    mocks.plan.mockResolvedValue({ ...emptyCashPlan(), start: { date: "2026-10-05", cents: 5_000 } });
    expect((await loadCashContext("fictif", {})).plan.kind).toBe("value");
  });
  it("un plan stocké illisible n’est ni affiché ni remplacé", async () => {
    mocks.plan.mockRejectedValue(new CashPlanError("illisible"));
    const ctx = await loadCashContext("fictif", {});
    expect(ctx.settingsUnreadable).toBe(true); expect(ctx.plan.kind).toBe("nd"); expect(ctx.notices.join(" ")).toContain("illisible");
  });
  it("pré-remplissage : seules des valeurs valides sont reprises de l’adresse", async () => {
    expect((await loadCashContext("fictif", { pl: "Organismes sociaux", pm: "350000", pc: "social" })).prefill).toEqual({ label: "Organismes sociaux", amountCents: 350_000, category: "social" });
    for (const query of [{ pl: "x", pm: "-5", pc: "social" }, { pl: "x", pm: "12.5", pc: "social" }, { pl: "x", pm: "100", pc: "inconnue" }, { pl: "", pm: "100", pc: "social" }]) expect((await loadCashContext("fictif", query)).prefill).toBeNull();
  });
});

describe("Cap 13 : écritures du plan réservées aux éditeurs", () => {
  const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.set(k, v); return f; };
  const flow = { label: "Loyer fictif", category: "suppliers", direction: "out", amount: "1500", date: "2026-03-10", recurrence: "once", until: "" };
  it("un lecteur refusé n’écrit rien", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(addCashFlowAction("fictif", undefined, form(flow))).rejects.toThrow("404");
    await expect(deleteCashFlowAction("fictif", "id", undefined, form({}))).rejects.toThrow("404");
    await expect(saveCashStartAction("fictif", undefined, form({}))).rejects.toThrow("404");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("ajout : la ligne validée est ajoutée dans l’espace vérifié, avec le rôle éditeur", async () => {
    const state = await addCashFlowAction("fictif", undefined, form(flow));
    expect(mocks.auth).toHaveBeenCalledWith("fictif", "editor");
    expect(mocks.update).toHaveBeenCalledWith("espace-fictif", "editeur-fictif", expect.any(Function), "flow-added");
    const next = (await mocks.update.mock.results[0].value) as CashPlanSettings;
    expect(next.flows).toHaveLength(1); expect(next.flows[0]).toMatchObject({ label: "Loyer fictif", amountCents: 150_000, direction: "out" });
    expect(state?.ok).toBeTruthy();
  });
  it("une saisie invalide est refusée sans écriture ; une erreur de stockage ne fuit pas", async () => {
    expect((await addCashFlowAction("fictif", undefined, form({ ...flow, amount: "0" })))?.error).toContain("positif");
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.update.mockRejectedValue(new Error("détail privé de la base"));
    expect((await addCashFlowAction("fictif", undefined, form(flow)))?.error).not.toContain("détail privé");
  });
  it("ligne proposée depuis le FEC : après l’ajout, retour à un formulaire vide sur le même exercice", async () => {
    await expect(addCashFlowAction("fictif", undefined, form({ ...flow, prefilled: "1", exercice: "000000000FEC20261231.txt", arrete: "2026-03-15" })))
      .rejects.toThrow("REDIRECT /e/fictif/studio-restructuring?vue=cash&exercice=000000000FEC20261231.txt&date=2026-03-15");
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await expect(addCashFlowAction("fictif", undefined, form({ ...flow, prefilled: "1", exercice: "", arrete: "pas-une-date" }))).rejects.toThrow("REDIRECT /e/fictif/studio-restructuring?vue=cash");
  });
  it("suppression : seule la ligne visée est retirée", async () => {
    mocks.update.mockImplementation(async (_ws: string, _actor: string, change: (c: CashPlanSettings) => CashPlanSettings) => change({ ...emptyCashPlan(), flows: [{ id: "a", label: "A", category: "other", direction: "in", amountCents: 1, date: "2026-03-10", recurrence: "once", until: null }, { id: "b", label: "B", category: "other", direction: "in", amountCents: 1, date: "2026-03-10", recurrence: "once", until: null }] }));
    await deleteCashFlowAction("fictif", "a", undefined, form({}));
    expect(((await mocks.update.mock.results[0].value) as CashPlanSettings).flows.map((f) => f.id)).toEqual(["b"]);
  });
  it("solde de départ : champs vides = retour au solde du FEC", async () => {
    const state = await saveCashStartAction("fictif", undefined, form({ startDate: "", startAmount: "", overdraft: "8000" }));
    expect((await mocks.update.mock.results[0].value) as CashPlanSettings).toMatchObject({ start: null, overdraftCents: 800_000 });
    expect(state?.ok).toContain("FEC");
  });
});
