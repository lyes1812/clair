import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), csv: vi.fn(), spec: vi.fn(), workbook: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/restructuring/context", () => ({ loadRestructuringContext: mocks.context }));
vi.mock("@/lib/restructuring/export", () => ({ restructuringCsv: mocks.csv, restructuringWorkbook: mocks.spec }));
vi.mock("@/lib/export/xlsx", () => ({ buildWorkbook: mocks.workbook }));
import * as route from "@/app/e/[slug]/studio-restructuring/export/route";
const params = { params: Promise.resolve({ slug: "fictif" }) };
const req = (q = "") => new NextRequest(`https://clair.invalid/e/fictif/studio-restructuring/export?${q}`);
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({});
  mocks.context.mockResolvedValue({ reference: { firstMonth: "2026-10", lastMonth: "2026-12" }, model: { kind: "value" } });
  mocks.csv.mockReturnValue("\uFEFFSection;Mois\r\n"); mocks.spec.mockReturnValue({ title: "Simulation fictive" });
  mocks.workbook.mockResolvedValue(Buffer.from("XLSX_FICTIF"));
});
describe("Export Restructuring : privé, agrégé et lecture seule", () => {
  it("autorisation avant chargement ou génération", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(route.GET(req("format=csv"), params)).rejects.toThrow("404");
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.csv).not.toHaveBeenCalled();
  });
  it("Excel et CSV gardent les deux scénarios choisis, sans cache partagé", async () => {
    const result = await route.GET(req("format=csv&reference=ref-fictive&projet=projet-fictif"), params);
    expect(mocks.context).toHaveBeenCalledWith("fictif", { format: "csv", reference: "ref-fictive", projet: "projet-fictif" });
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("content-type")).toContain("text/csv");
    const xlsx = await route.GET(req("format=xlsx"), params);
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml"); expect(mocks.workbook).toHaveBeenCalledWith({ title: "Simulation fictive" });
  });
  it("une comparaison incompatible ne produit pas un faux export chiffré", async () => {
    mocks.context.mockResolvedValue({ model: { kind: "nd", reason: "Bases différentes." } });
    expect((await route.GET(req(), params)).status).toBe(422); expect(mocks.spec).not.toHaveBeenCalled();
  });
  it("format refusé avant lecture métier, aucune mutation offerte", async () => {
    expect((await route.GET(req("format=html"), params)).status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled(); expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"]);
  });
});
