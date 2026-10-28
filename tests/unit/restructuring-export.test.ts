import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook } from "@/lib/export/xlsx";
import { restructuringCsv, restructuringWorkbook } from "@/lib/restructuring/export";
import { buildRestructuring, type RestructuringScenario } from "@/lib/restructuring/model";

const base: RestructuringScenario["base"] = {
  currency: "EUR", refMonth: "2026-09", syncId: "fictif", readAt: "2026-10-01T12:00:00Z", actuals: [],
  refMasse: 100_000, refBaseCost: 100_000, etpNote: null,
  contracts: [{ contractKey: "contrat-fictif", externalId: "id-fictif", label: "NOM_FICTIF_JAMAIS_EXPORTE", service: null, serviceNd: null, startDate: "2025-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, baseNd: null, base: { salaryCents: 100_000, refBrutCents: 100_000, refCotisationsCents: 0 } }],
};
const reference: RestructuringScenario = { id: "ref-fictive", name: "Référence fictive", status: "fige", firstMonth: "2026-10", lastMonth: "2026-12", baseHash: "fictif", base, hypotheses: [], conventions: { prorata: "calendaire" } };
const proposal: RestructuringScenario = { ...reference, id: "projet-fictif", name: "=PROJET_FICTIF", status: "brouillon", hypotheses: [{ id: "depart-fictif", kind: "depart", label: "HYPOTHESE_INDIVIDUELLE_FICTIVE", contractKey: "contrat-fictif", lastPaidDate: "2026-10-31", exitCost: { mode: "charge", costCents: 150_000 } }] };
function context() { return { workspaceName: "Espace fictif", reference, proposal, model: buildRestructuring(reference, proposal), generatedAt: "2026-10-28T10:00:00Z" }; }

describe("Restructuring : exports exacts et agrégés", () => {
  it("les feuilles ont les mêmes nombres que la simulation, sorties déjà incluses", () => {
    const ctx = context(), spec = restructuringWorkbook(ctx);
    expect(ctx.model.totals.savings.value).toBe(50_000);
    expect(spec.sheets[0].rows.find((r) => r[0] === "Économie nette")?.[1]).toBe(50_000);
    expect(spec.sheets[1].rows[0].slice(0, 6)).toEqual(["2026-10", 100_000, 250_000, -150_000, -150_000, 150_000]);
    expect(spec.definitions.find((d) => d.term === "Coûts ponctuels supplémentaires")?.definition).toContain("seconde fois");
  });
  it("aucun nom de collaborateur, identifiant individuel ou détail d’hypothèse exporté", () => {
    const ctx = context(), content = JSON.stringify(restructuringWorkbook(ctx)) + restructuringCsv(ctx);
    for (const value of ["NOM_FICTIF_JAMAIS_EXPORTE", "contrat-fictif", "HYPOTHESE_INDIVIDUELLE_FICTIVE", "depart-fictif"]) expect(content).not.toContain(value);
  });
  it("Excel construit et relu : centimes et ETP numériques, aucune formule", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(await buildWorkbook(restructuringWorkbook(context()))) as unknown as ExcelJS.Buffer);
    const ws = workbook.getWorksheet("Impacts mensuels")!;
    let row: ExcelJS.Row | undefined;
    ws.eachRow((candidate) => { if (candidate.getCell(1).value === "2026-10") row = candidate; });
    expect(row?.getCell(2).value).toBe(1000); expect(row?.getCell(3).value).toBe(2500); expect(row?.getCell(9).value).toBe(1);
    workbook.eachSheet((sheet) => sheet.eachRow((r) => r.eachCell((c) => { expect(c.type).not.toBe(ExcelJS.ValueType.Formula); })));
    expect(workbook.getWorksheet("Sources")).toBeDefined(); expect(workbook.getWorksheet("Définitions")).toBeDefined();
  });
  it("un coût inconnu reste n.d. dans chaque format, sans faux cumul", () => {
    const ctx = context(); ctx.proposal = { ...proposal, hypotheses: proposal.hypotheses.map((h) => h.kind === "depart" ? { ...h, exitCost: null } : h) };
    ctx.model = buildRestructuring(reference, ctx.proposal);
    expect(restructuringWorkbook(ctx).sheets[0].rows.find((r) => r[0] === "Économie nette")?.[1]).toEqual(expect.objectContaining({ nd: expect.any(String) }));
    expect(restructuringCsv(ctx)).toContain('"Économie cumulée";"n.d.";"EUR"');
  });
  it("CSV exact à deux décimales pour EUR, quatre pour ETP, texte protégé", () => {
    const csv = restructuringCsv(context());
    expect(csv.startsWith("\uFEFF")).toBe(true); expect(csv).toContain('"-1500,00";"EUR"');
    expect(csv).toContain('"1,0000";"ETP"'); expect(csv).not.toContain('"=PROJET_FICTIF"'); expect(csv).toContain("'=PROJET_FICTIF");
  });
});
