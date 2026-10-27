import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), csv: vi.fn(), spec: vi.fn(), workbook: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/finance/context", () => ({ loadFinanceContext: mocks.context }));
vi.mock("@/lib/finance/export", () => ({ financeCsv: mocks.csv, financeWorkbook: mocks.spec }));
vi.mock("@/lib/export/xlsx", () => ({ buildWorkbook: mocks.workbook }));
import * as route from "@/app/e/[slug]/studio-finance/export/route";
const request = (query = "") => new NextRequest(`https://clair.invalid/e/fictif/studio-finance/export?${query}`);
const params = { params: Promise.resolve({ slug: "fictif" }) };
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ workspace: { id: "w-fictif" } });
  mocks.context.mockResolvedValue({ year: 2026, from: "2026-01", to: "2026-09" });
  mocks.csv.mockReturnValue("\uFEFFsection;mois;ligne\r\n"); mocks.spec.mockReturnValue({ title: "Fictif" });
  mocks.workbook.mockResolvedValue(Buffer.from("XLSX_FICTIF"));
});
describe("Export Finance privé, mêmes paramètres et pas de cache partagé", () => {
  it("un non-membre ne déclenche ni lecture ni export", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(route.GET(request("format=csv"), params)).rejects.toThrow("404");
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.csv).not.toHaveBeenCalled(); expect(mocks.workbook).not.toHaveBeenCalled();
  });
  it("CSV : même espace/période, téléchargement sans cache ni type ambigu", async () => {
    const response = await route.GET(request("format=csv&annee=2026&debut=2026-03&fin=2026-09"), params);
    expect(mocks.context).toHaveBeenCalledWith("fictif", { format: "csv", annee: "2026", debut: "2026-03", fin: "2026-09" });
    expect(mocks.csv).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-01", generatedAt: expect.any(String) }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
  });
  it("Excel est produit uniquement après autorisation et modèle commun", async () => {
    const response = await route.GET(request("format=xlsx"), params);
    expect(mocks.auth).toHaveBeenCalledWith("fictif"); expect(mocks.workbook).toHaveBeenCalledWith({ title: "Fictif" });
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("XLSX_FICTIF");
  });
  it("format inconnu refusé sans lecture métier et aucune méthode de mutation exposée", async () => {
    expect((await route.GET(request("format=html"), params)).status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"]);
  });
});
