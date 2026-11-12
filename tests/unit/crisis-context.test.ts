import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), coverage: vi.fn(), lines: vi.fn(), setting: vi.fn(), set: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/fec/import", () => ({ fecCoverage: mocks.coverage }));
vi.mock("@/lib/restructuring/crisis/store", () => ({ readCrisisLines: mocks.lines }));
vi.mock("@/lib/settings", () => ({ getSetting: mocks.setting, setSetting: mocks.set }));
vi.mock("@/lib/budget/store", () => ({ getScenario: vi.fn(), applyChanges: vi.fn() }));
vi.mock("@/lib/events", () => ({ recordEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { loadCrisisContext } from "@/lib/restructuring/crisis/context";
import { CRISIS_RANKS_KEY } from "@/lib/restructuring/crisis/ranks";
import { saveCrisisRanksAction } from "@/app/e/[slug]/studio-restructuring/actions";

const exercise = (filename: string, firstDate: string, lastDate: string, pending = false) => ({ filename, firstDate, lastDate, pending, syncId: `sync-${filename}` });
const OLD = exercise("000000000FEC20251231.txt", "2025-01-01", "2025-12-31");
const NEW = exercise("000000000FEC20261231.txt", "2026-01-01", "2026-09-30");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ workspace: { id: "espace-fictif", name: "Espace fictif", role: "reader" }, session: { user: { id: "editeur-fictif" } } });
  mocks.coverage.mockResolvedValue([OLD, NEW]);
  mocks.lines.mockResolvedValue([{ accountId: "512000", accountName: "Banque fictive", auxiliary: null, auxiliaryLabel: null, date: "2026-01-01", debitCents: 1_000, creditCents: 0 }]);
  mocks.setting.mockImplementation(async (_ws: string, _key: string, parse: (v: unknown) => unknown) => parse({ staff: "superprivilege" }));
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
