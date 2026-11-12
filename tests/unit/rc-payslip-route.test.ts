import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/lib/crypto";
import type { RcPayslipScan } from "@/lib/payroll/rc-payslips";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), active: vi.fn(), configured: vi.fn(), scan: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/connectors/sync", () => ({ activeSync: mocks.active, configuredPayfitClient: mocks.configured }));
vi.mock("@/lib/connectors/payfit/payslips", () => ({ fetchPayFitPayslip: mocks.fetch }));
vi.mock("@/lib/payroll/rc-payslips-store", () => ({ getRcPayslipScan: mocks.scan }));
import * as route from "@/app/e/[slug]/studio-rh/masse-salariale/bulletins/[id]/route";

const SYNC = "11111111-1111-4111-8111-111111111111";
const bytes = new TextEncoder().encode("%PDF-1.4\nBULLETIN_FICTIF_PRIVE\n%%EOF");
const boundClient = { fixture: "client-configure-cote-serveur" };
const snapshot = (): RcPayslipScan => ({
  version: 1, id: "22222222-2222-4222-8222-222222222222", payrollSyncId: SYNC, companyId: "SOCIETE-FICTIVE",
  from: "2026-02", to: "2026-02", status: "complete", startedAt: "2026-03-01T10:00:00Z", finishedAt: "2026-03-01T10:01:00Z",
  closedMonths: ["2026-02"], unavailableMonths: [], totalCollaborators: 1, completedCollaborators: 1, checkedPayslips: 1, issues: [],
  records: [{ month: "2026-02", collaboratorId: "COLLABORATEUR-FICTIF", contractId: "CONTRAT-FICTIF", payslipId: "BULLETIN-FICTIF", pdfHash: sha256(Buffer.from(bytes)), parserVersion: "fictif-v1", status: "identified", code: "explicit-rc-amount", indemnityCents: 12345, components: [{ label: "Indemnité de rupture conventionnelle fictive", amountCents: 12345, page: 1, line: 2 }] }],
});
const request = (query = "") => new Request(`https://clair.invalid/e/espace-fictif/studio-rh/masse-salariale/bulletins/BULLETIN-FICTIF${query}`);
const params = (id = "BULLETIN-FICTIF") => ({ params: Promise.resolve({ slug: "espace-fictif", id }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ workspace: { id: "ESPACE-FICTIF" } });
  mocks.active.mockResolvedValue({ id: SYNC });
  mocks.scan.mockResolvedValue(snapshot());
  mocks.configured.mockResolvedValue({ client: boundClient, companyId: "SOCIETE-FICTIVE" });
  mocks.fetch.mockResolvedValue(bytes);
});

describe("bulletin RC privé : autorisation, rattachement et empreinte", () => {
  it("refuse un lecteur avant toute lecture métier ou récupération du PDF", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(route.GET(request(), params())).rejects.toThrow("404");
    expect(mocks.auth).toHaveBeenCalledExactlyOnceWith("espace-fictif", "editor");
    for (const operation of [mocks.scan, mocks.active, mocks.configured, mocks.fetch]) expect(operation).not.toHaveBeenCalled();
  });

  it.each(["../BULLETIN-FICTIF", "https://evil.invalid/doc.pdf", "x".repeat(129), ""])("un identifiant arbitraire est refusé avant lecture : %s", async (id) => {
    const response = await route.GET(request(), params(id));
    expect(response.status).toBe(404);
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["missing-scan", "missing-record", "duplicate-record", "missing-hash", "stale-sync", "missing-active"])("référence absente ou ambiguë : %s donne404 sans téléchargement", async (condition) => {
    const scan = snapshot();
    if (condition === "missing-scan") mocks.scan.mockResolvedValue(null);
    if (condition === "missing-record") scan.records[0].payslipId = "AUTRE-BULLETIN-FICTIF";
    if (condition === "duplicate-record") scan.records.push({ ...scan.records[0] });
    if (condition === "missing-hash") scan.records[0].pdfHash = null;
    if (condition === "stale-sync") mocks.active.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
    if (condition === "missing-active") mocks.active.mockResolvedValue(null);
    if (condition !== "missing-scan") mocks.scan.mockResolvedValue(scan);
    const response = await route.GET(request(), params());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.configured).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await response.text()).not.toMatch(/BULLETIN_FICTIF_PRIVE|COLLABORATEUR-FICTIF|CONTRAT-FICTIF|12345/);
  });

  it("une connexion changée de société impose une nouvelle lecture, sans exposer le document", async () => {
    mocks.configured.mockResolvedValue({ client: boundClient, companyId: "AUTRE-SOCIETE-FICTIVE" });
    const response = await route.GET(request(), params());
    expect(response.status).toBe(409);
    expect(mocks.configured).toHaveBeenCalledWith("ESPACE-FICTIF");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("un PDF modifié depuis la lecture est refusé sans rendre son contenu", async () => {
    mocks.fetch.mockResolvedValue(new TextEncoder().encode("%PDF-1.4\nPDF_FICTIF_MODIFIE"));
    const response = await route.GET(request(), params());
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("PDF_FICTIF_MODIFIE");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("tous les identifiants viennent de la lecture autorisée, jamais de la requête", async () => {
    const scan = snapshot();
    scan.records.unshift({ ...scan.records[0], payslipId: "AUTRE-BULLETIN-FICTIF", collaboratorId: "AUTRE-COLLABORATEUR-FICTIF", contractId: "AUTRE-CONTRAT-FICTIF" });
    mocks.scan.mockResolvedValue(scan);
    const response = await route.GET(request("?url=https%3A%2F%2Fevil.invalid%2Fdoc.pdf&companyId=AUTRE&collaboratorId=AUTRE&contractId=AUTRE"), params());
    expect(response.status).toBe(200);
    expect(mocks.scan).toHaveBeenCalledExactlyOnceWith("ESPACE-FICTIF");
    expect(mocks.active).toHaveBeenCalledExactlyOnceWith("ESPACE-FICTIF", "payfit");
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(boundClient, "SOCIETE-FICTIVE", "COLLABORATEUR-FICTIF", "CONTRAT-FICTIF", "BULLETIN-FICTIF");
  });

  it("rend uniquement le PDF vérifié, sans cache partagé ni nom de personne dans le fichier", async () => {
    const response = await route.GET(request(), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="bulletin-payfit.pdf"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"]);
  });

  it("une erreur fournisseur rend une réponse sûre, sans contenu ni détail de l’erreur", async () => {
    mocks.fetch.mockRejectedValue(new Error("DONNEE_FICTIVE_PRIVEE_DANS_ERREUR"));
    const response = await route.GET(request(), params());
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toMatch(/DONNEE_FICTIVE|COLLABORATEUR-FICTIF|CONTRAT-FICTIF/);
  });
});
