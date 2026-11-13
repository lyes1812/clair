import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/restructuring/crisis/cash-context", () => ({ loadCashContext: mocks.load }));
import { buildWorkbook } from "@/lib/export/xlsx";
import { buildCashPlan, buildScenarioPlan, emptyCashPlan, type CashFlow, type CashPlanSettings, type Scenario } from "@/lib/restructuring/crisis/cashplan";
import { crisisWorkbook, type CrisisExportContext } from "@/lib/restructuring/crisis/export";
import { buildCrisisPosition, type CrisisLine } from "@/lib/restructuring/crisis/model";
import { GET } from "@/app/e/[slug]/studio-restructuring/cap13-export/route";
import { NextRequest } from "next/server";

// Société fictive. Position au 28/02/2026 : banque 10 000,00 ; fournisseur F001 dû 6 000,00 ; acompte F002 500,00 ; URSSAF 3 500,00.
const line = (accountId: string, debit: number, credit: number, auxiliary: string | null = null): CrisisLine =>
  ({ accountId, accountName: `Compte fictif ${accountId}`, auxiliary, auxiliaryLabel: auxiliary ? `Tiers fictif ${auxiliary}` : null, date: "2026-02-01", debitCents: debit, creditCents: credit });
const LINES = [line("512000", 1_000_000, 0), line("401000", 0, 600_000, "F001"), line("401000", 50_000, 0, "F002"), line("431000", 0, 350_000)];
const flow = (id: string, patch: Partial<CashFlow>): CashFlow => ({ id, label: `Flux fictif ${id}`, category: "other", direction: "out", amountCents: 1, date: "2026-03-05", recurrence: "once", until: null, ...patch });
const FLOWS = [flow("A", { category: "customers", direction: "in", amountCents: 500_000, date: "2026-03-06" }), flow("D", { category: "social", amountCents: 900_000, date: "2026-03-16" }), flow("E", { amountCents: 300_000, date: "2026-03-04" })];
const SCENARIO: Scenario = { id: "s1", name: "Scénario fictif", measures: [{ id: "m1", kind: "report", flowId: "D", weeks: 4 }, { id: "m2", kind: "encaissement", label: "Cession fictive", nature: "cession", amountCents: 1_000_000, date: "2026-04-28" }] };

function context(patch: Partial<CrisisExportContext> = {}, withScenario = true): CrisisExportContext {
  const settings: CashPlanSettings = { ...emptyCashPlan(), revision: 7, start: { date: "2026-03-04", cents: 2_000_000 }, flows: FLOWS, scenarios: [SCENARIO] };
  const plan = buildCashPlan({ date: "2026-03-04", cents: 2_000_000, source: "saisi" }, "sans objet", settings);
  return {
    workspaceName: "Espace fictif", generatedAt: "2026-11-13T15:00:00Z",
    exercise: { filename: "000000000FEC20261231.txt", firstDate: "2026-01-01", lastDate: "2026-12-31" }, asOf: "2026-02-28",
    position: buildCrisisPosition(LINES, "2026-02-28", { suppliers: "chirographaire", social: "privilege" }),
    plan, scenarioPlan: withScenario ? buildScenarioPlan(plan, settings, SCENARIO) : null, settings,
    fecStart: { date: "2026-02-28", cents: 1_000_000 }, openItems: { kind: "nd", reason: "sans objet" }, supplierNet: 550_000, ...patch,
  };
}
const sheet = (spec: NonNullable<ReturnType<typeof crisisWorkbook>>, name: string) => spec.sheets.find((s) => s.name === name)!;
const row = (spec: NonNullable<ReturnType<typeof crisisWorkbook>>, name: string, first: string) => sheet(spec, name).rows.find((r) => r[0] === first)!;

describe("Cap 13 : classeur du dossier de crise", () => {
  it("la synthèse reprend les nombres de l’écran, au centime", () => {
    const spec = crisisWorkbook(context())!;
    expect(row(spec, "Synthèse", "Disponibilités")[1]).toBe(1_000_000);
    expect(row(spec, "Synthèse", "Dettes comptabilisées")[1]).toBe(950_000);
    expect(row(spec, "Synthèse", "Dettes comptabilisées")[2]).toContain("pas le passif exigible");
    expect(row(spec, "Synthèse", "Solde de départ du plan")[1]).toBe(2_000_000);
    expect(row(spec, "Synthèse", "Point bas du plan de base")[1]).toBe(1_600_000);
    expect(row(spec, "Synthèse", "Découvert autorisé")[1]).toEqual({ nd: expect.stringContaining("Non saisi") });
    expect(row(spec, "Synthèse", "Solde de fin de semaine au moment de la rupture").slice(1)).toEqual(["", expect.stringContaining("Aucune rupture")]);
  });
  it("dettes par nature, par tiers et par rang : soldes débiteurs à part, créanciers nommés", () => {
    const spec = crisisWorkbook(context())!;
    expect(row(spec, "Dettes par nature", "Fournisseurs").slice(2)).toEqual(["Chirographaire", 600_000, 50_000]);
    expect(row(spec, "Dettes par nature", "Personnel")[2]).toBe("Non choisi");
    expect(row(spec, "Dettes par nature", "Total des dettes comptabilisées")[3]).toBe(950_000);
    expect(sheet(spec, "Dettes par tiers").rows).toEqual([
      ["Fournisseurs", "401000", "Compte fictif 401000", "F001", "Tiers fictif F001", "Créditeur", 600_000],
      ["Fournisseurs", "401000", "Compte fictif 401000", "F002", "Tiers fictif F002", "Débiteur", 50_000],
      ["Organismes sociaux", "431000", "Compte fictif 431000", "", "", "Créditeur", 350_000],
    ]);
    expect(Object.fromEntries(sheet(spec, "Dettes par rang").rows.map((r) => [r[0], r[2]]))).toMatchObject({ "Privilégié": 350_000, "Chirographaire": 600_000 });
    expect(row(spec, "Disponibilités", "Total des disponibilités")[2]).toBe(1_000_000);
  });
  it("plan à 13 semaines : même tableau qu’à l’écran, lignes hors plan signalées", () => {
    const spec = crisisWorkbook(context())!;
    const plan = sheet(spec, "Plan 13 semaines");
    expect(plan.columns).toHaveLength(15);
    expect(plan.columns[1].header).toBe("S1 02/03→08/03");
    expect(row(spec, "Plan 13 semaines", "Solde de fin de semaine").slice(1, 4)).toEqual([2_500_000, 2_500_000, 1_600_000]);
    expect(row(spec, "Plan 13 semaines", "Décaissements · Charges sociales").at(-1)).toBe(900_000);
    expect(sheet(spec, "Détail des flux du plan").rows).toEqual([["S1", "2026-03-06", "Flux fictif A", 500_000], ["S3", "2026-03-16", "Flux fictif D", -900_000]]);
    expect(row(spec, "Flux saisis", "Flux fictif E").at(-1)).toContain("Hors du plan : date antérieure ou égale");
    expect(row(spec, "Flux saisis", "Flux fictif A").at(-1)).toBe("Dans le plan");
  });
  it("scénario : comparaison, mesures et montants tracés ; absent si aucun scénario n’est affiché", () => {
    const spec = crisisWorkbook(context())!;
    expect(row(spec, "Scénario - comparaison", "Écart (scénario − base)").slice(1, 4)).toEqual([0, 0, 900_000]);
    expect(row(spec, "Scénario - comparaison", "Écart (scénario − base)").at(-1)).toBe(1_000_000);
    expect(sheet(spec, "Scénario - mesures").rows.map((r) => r[1])).toEqual(["Appliquée", "Appliquée"]);
    expect(sheet(spec, "Scénario - détail des flux").rows.map((r) => r[2])).toEqual(["Flux fictif A", "Flux fictif D (reporté de 4 sem., prévu le 16/03/2026)", "Cession fictive · Cession d’actif"]);
    expect(spec.filters.find((f) => f.label === "Scénario")?.value).toBe("Scénario fictif");
    const base = crisisWorkbook(context({}, false))!;
    expect(base.sheets.some((s) => s.name.startsWith("Scénario"))).toBe(false);
    expect(base.filters.find((f) => f.label === "Scénario")?.value).toBe("Plan de base seul");
  });
  it("une partie n.d. reste n.d. avec sa raison ; rien à exporter quand tout est n.d.", () => {
    const noFec = crisisWorkbook(context({ position: { kind: "nd", reason: "Aucun FEC appliqué dans Données." }, exercise: null, asOf: null }))!;
    expect(row(noFec, "Synthèse", "Trésorerie et dettes à date")[1]).toEqual({ nd: "Aucun FEC appliqué dans Données." });
    expect(noFec.sheets.some((s) => s.name === "Dettes par nature")).toBe(false);
    expect(noFec.sheets.some((s) => s.name === "Plan 13 semaines")).toBe(true);
    const noRank = crisisWorkbook(context({ position: buildCrisisPosition(LINES, "2026-02-28", null) }))!;
    expect(sheet(noRank, "Dettes par rang").rows).toEqual([["Répartition par rang", "", { nd: expect.stringContaining("Rang non choisi") }]]);
    expect(crisisWorkbook(context({ position: { kind: "nd", reason: "x" }, plan: { kind: "nd", reason: "y" }, scenarioPlan: null }))).toBeNull();
  });
  it("Excel construit et relu : montants numériques en euros, n.d. en texte, aucune formule", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(await buildWorkbook(crisisWorkbook(context())!)) as unknown as ExcelJS.Buffer);
    const find = (name: string, first: string) => { let found: ExcelJS.Row | undefined; workbook.getWorksheet(name)!.eachRow((r) => { if (r.getCell(1).value === first) found = r; }); return found!; };
    expect(find("Synthèse", "Dettes comptabilisées").getCell(2).value).toBe(9500);
    expect(find("Synthèse", "Découvert autorisé").getCell(2).value).toBe("n.d.");
    expect(find("Plan 13 semaines", "Solde de fin de semaine").getCell(4).value).toBe(16000);
    expect(find("Scénario - comparaison", "Écart (scénario − base)").getCell(4).value).toBe(9000);
    workbook.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => { expect(c.type).not.toBe(ExcelJS.ValueType.Formula); })));
    for (const name of ["Dettes par tiers", "Dettes par rang", "Flux saisis", "Scénario - mesures", "Sources", "Définitions"]) expect(workbook.getWorksheet(name)).toBeDefined();
  });
});

describe("Cap 13 : route d’export réservée aux éditeurs et administrateurs", () => {
  const request = (query = "") => new NextRequest(`http://localhost/e/fictif/studio-restructuring/cap13-export${query}`);
  const params = { params: Promise.resolve({ slug: "fictif" }) };
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ workspace: { id: "espace-fictif" } }); mocks.load.mockResolvedValue(context()); });
  it("un lecteur ou un non-membre est refusé avant toute lecture", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(GET(request(), params)).rejects.toThrow("404");
    expect(mocks.auth).toHaveBeenCalledWith("fictif", "editor"); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("classeur renvoyé en pièce jointe, jamais mis en cache, avec le scénario demandé", async () => {
    const response = await GET(request("?scenario=s1&date=2026-02-28"), params);
    expect(mocks.load).toHaveBeenCalledWith("fictif", { scenario: "s1", date: "2026-02-28" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    expect(response.headers.get("content-disposition")).toContain("cap13-dossier-de-crise-2026-03-04.xlsx");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rien à exporter : 422 avec la raison, pas un classeur vide", async () => {
    mocks.load.mockResolvedValue(context({ position: { kind: "nd", reason: "x" }, plan: { kind: "nd", reason: "y" }, scenarioPlan: null }));
    const response = await GET(request(), params);
    expect(response.status).toBe(422); expect(await response.text()).toContain("Rien à exporter");
  });
});
