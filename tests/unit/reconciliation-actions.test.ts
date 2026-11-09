import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn(), create: vi.fn(), append: vi.fn(), revalidate: vi.fn(), redirect: vi.fn(), pair: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.guard }));
vi.mock("@/lib/reconciliation/store", () => ({ loadReconciliation: mocks.load, createReconciliationRun: mocks.create, appendReconciliationDecision: mocks.append }));
vi.mock("@/lib/reconciliation/compare", () => ({ pairFingerprint: mocks.pair }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/app/e/[slug]/donnees/rapprochement/ReconciliationView", () => ({ ReconciliationView: () => null }));
import { createReconciliationAction, decideReconciliationAction } from "@/app/e/[slug]/donnees/rapprochement/actions";
import ReconciliationPage from "@/app/e/[slug]/donnees/rapprochement/page";

const RUN = "11111111-1111-4111-8111-111111111111";
const DSN = "22222222-2222-4222-8222-222222222222";
const PAYFIT = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64), FP = "b".repeat(64);
const snapshot = { inputHash: HASH };
const state = { revision: 0 };
const data = (change: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [key, value] of Object.entries({ runId: RUN, revision: "0", inputHash: HASH, kind: "link-person", dsnId: DSN, payfitId: PAYFIT, ...change })) f.set(key, value);
  return f;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ workspace: { id: "workspace-fixture" }, session: { user: { id: "actor-fixture" } } });
  mocks.load.mockResolvedValue({ selected: { id: RUN, inputHash: HASH, revision: 0, snapshot, state, stale: false } });
  mocks.pair.mockReturnValue(FP);
  mocks.create.mockResolvedValue(RUN);
  mocks.redirect.mockImplementation(() => { throw new Error("REDIRECT_FIXTURE"); });
});

describe("Rapprochement : actions protégées et décisions traçables", () => {
  it("la page et l'historique nominatifs exigent éditeur avant tout chargement", async () => {
    mocks.guard.mockRejectedValue(new Error("Accès refusé fictif"));
    await expect(ReconciliationPage({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve({ run: RUN }) })).rejects.toThrow("Accès refusé");
    expect(mocks.guard).toHaveBeenCalledWith("demo", "editor");
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("un identifiant de contrôle libre n'est ni repris dans la page ni utilisé dans une lecture directe", async () => {
    mocks.load.mockResolvedValue({ selected: null });
    const html = renderToStaticMarkup(await ReconciliationPage({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve({ run: "PRIVATE-EMPLOYEE-NAME" }) }));
    expect(mocks.load).not.toHaveBeenCalled();
    expect(html).toContain("Contrôle indisponible dans cet espace.");
    expect(html).not.toContain("PRIVATE-EMPLOYEE-NAME");
  });
  it("un contrôle d'un autre espace rend la même indisponibilité, sans afficher le dernier contrôle par repli", async () => {
    mocks.load.mockRejectedValueOnce({ code: "not_found" });
    const html = renderToStaticMarkup(await ReconciliationPage({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve({ run: RUN }) }));
    expect(html).toContain("Contrôle indisponible dans cet espace.");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledWith("workspace-fixture", RUN);
  });
  it("exige éditeur avant toute lecture ou écriture, y compris pour une cible fabriquée", async () => {
    mocks.guard.mockRejectedValue(new Error("Accès refusé fictif"));
    await expect(createReconciliationAction("demo", undefined, data({ controlMonth: "2026-01" }))).rejects.toThrow("Accès refusé");
    await expect(decideReconciliationAction("demo", undefined, data())).rejects.toThrow("Accès refusé");
    expect(mocks.guard).toHaveBeenCalledWith("demo", "editor");
    for (const fn of [mocks.load, mocks.create, mocks.append]) expect(fn).not.toHaveBeenCalled();
  });
  it("crée uniquement le mois demandé avec l'auteur serveur ; redirection après enregistrement", async () => {
    await expect(createReconciliationAction("demo", undefined, data({ controlMonth: "2026-01", actorId: "FORGED-ACTOR" }))).rejects.toThrow("REDIRECT_FIXTURE");
    expect(mocks.create).toHaveBeenCalledWith("workspace-fixture", "actor-fixture", "2026-01");
    expect(mocks.redirect).toHaveBeenCalledWith(`/e/demo/donnees/rapprochement?run=${RUN}`);
    expect(mocks.revalidate).toHaveBeenCalledWith("/e/demo/donnees/rapprochement");
  });
  it("refuse les métadonnées et mois invalides sans les recopier ni charger de contrôle", async () => {
    expect(await createReconciliationAction("demo", undefined, data({ controlMonth: "PRIVATE-NAME" }))).toMatchObject({ error: expect.any(String) });
    expect(await decideReconciliationAction("demo", undefined, data({ revision: "" }))).toMatchObject({ error: expect.any(String) });
    expect(await decideReconciliationAction("demo", undefined, data({ runId: "PRIVATE-NAME" }))).toMatchObject({ error: expect.any(String) });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("reconstruit l'empreinte d'un lien autorisé sur le serveur et ignore l'auteur/empreinte forgés", async () => {
    const result = await decideReconciliationAction("demo", undefined, data({ fingerprint: "FORGED-FP", actorId: "FORGED-ACTOR" }));
    expect(result?.ok).toBeDefined();
    expect(mocks.load).toHaveBeenCalledWith("workspace-fixture", RUN);
    expect(mocks.pair).toHaveBeenCalledWith(snapshot, "person", DSN, PAYFIT, state);
    expect(mocks.append).toHaveBeenCalledWith("workspace-fixture", "actor-fixture", RUN, 0, HASH, { kind: "link-person", dsnId: DSN, payfitId: PAYFIT, fingerprint: FP });
  });
  it("un contrôle d'un autre espace, obsolète ou modifié ne produit aucune décision", async () => {
    for (const selected of [null, { inputHash: HASH, revision: 0, stale: true }, { inputHash: HASH, revision: 1, stale: false }]) {
      mocks.load.mockResolvedValueOnce({ selected });
      expect(await decideReconciliationAction("demo", undefined, data())).toMatchObject({ error: expect.any(String) });
    }
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("un commentaire est requis pour expliquer un champ ; décision et commentaire restent en base seulement", async () => {
    const f = data({ kind: "resolve-field", entity: "person", field: "familyName", fingerprint: FP, disposition: "explained", comment: "" });
    expect(await decideReconciliationAction("demo", undefined, f)).toMatchObject({ error: expect.any(String) });
    expect(mocks.append).not.toHaveBeenCalled();
    f.set("comment", "Différence fictive expliquée");
    const result = await decideReconciliationAction("demo", undefined, f);
    expect(result?.ok).toBeDefined();
    expect(JSON.stringify(result)).not.toContain("Différence fictive");
    expect(mocks.append).toHaveBeenCalledWith("workspace-fixture", "actor-fixture", RUN, 0, HASH, expect.objectContaining({ kind: "resolve-field", comment: "Différence fictive expliquée" }));
  });
  it("aucune exception privée n'est renvoyée ; les raisons métier viennent du catalogue fermé", async () => {
    mocks.append.mockRejectedValueOnce(new Error("PRIVATE-EMPLOYEE SQL CONTENT"));
    expect(JSON.stringify(await decideReconciliationAction("demo", undefined, data()))).not.toMatch(/PRIVATE|SQL/);
    mocks.append.mockRejectedValueOnce({ code: "invalid_decision", decisionReason: "wrong-parent", message: "PRIVATE-CONTENT" });
    expect(await decideReconciliationAction("demo", undefined, data())).toMatchObject({ error: "Lie d’abord les personnes correspondantes." });
  });
});
