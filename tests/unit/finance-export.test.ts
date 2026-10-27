import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook, NUM_FMT, type ExportCell, type SheetSpec } from "@/lib/export/xlsx";
import { buildActuals } from "@/lib/finance/actuals";
import { financeCsv, financeWorkbook, type FinanceExportContext } from "@/lib/finance/export";
import { buildFinanceProjection } from "@/lib/finance/plans";
import { FINANCE_ROWS, type FinancePlan } from "@/lib/finance/types";
import type { ComptaSource } from "@/lib/payroll/context";

// Sources exclusivement fictives ; ni base, ni variable d’environnement, ni accès fournisseur.
const line = (month: string, accountId: string, debitCents: number | null, creditCents: number | null): ComptaSource["lines"][number] => ({ month, accountId, debitCents, creditCents });
const months = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
const source = (lines: ComptaSource["lines"], covered: string[]): ComptaSource => ({ source: "pennylane", reason: "Non exporté : fichier-prive-test.csv", lines, months: covered, nd: {}, error: false });
const context = (): FinanceExportContext => {
  // Janvier : CA 1 000, personnel 300, autres charges 200, résultat 500 EUR.
  // Février : CA 800, personnel 400, autres charges 100, résultat 300 EUR.
  // N-1 : CA 900 puis 700 ; personnel 250 puis 350 ; autres charges 200 puis 100.
  const accounting = source([
    line("2026-01", "706000", 0, 100_000), line("2026-01", "641000", 30_000, 0), line("2026-01", "606000", 20_000, 0),
    line("2026-02", "706000", 0, 80_000), line("2026-02", "641000", 40_000, 0), line("2026-02", "606000", 10_000, 0),
    line("2026-12", "706000", 0, 999_999),
    line("2025-01", "706000", 0, 90_000), line("2025-01", "641000", 25_000, 0), line("2025-01", "606000", 20_000, 0),
    line("2025-02", "706000", 0, 70_000), line("2025-02", "641000", 35_000, 0), line("2025-02", "606000", 10_000, 0),
  ], ["2026-01", "2026-02", "2026-12", "2025-01", "2025-02"]);
  return {
    workspaceName: "Entreprise fictive", year: 2026, from: "2026-01", to: "2026-02",
    actuals: buildActuals(accounting, months(2026), []), previous: buildActuals(accounting, months(2025), []),
    selectedPlan: null, projection: null, selectedBudget: null, budgetMonths: null,
    mappings: [], revision: 7, generatedAt: "2026-10-27T12:00:00.000Z",
    source: {
      domain: "accounting", mode: "auto", chosen: "pennylane", reason: "fichier-prive-test.csv", apiApplied: true, filesApplied: false,
      appliedAt: new Date("2026-10-26T11:15:00.000Z"), modeSetAt: new Date("2026-10-26T11:15:00.000Z"), modeSetBy: "identite-a-ne-pas-exporter",
    },
  };
};
const plan = (kind: "budget" | "forecast" = "budget"): FinancePlan => ({
  id: kind === "budget" ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002",
  name: kind === "budget" ? "Budget fictif" : "Prévision fictive", kind, year: 2026, currency: "EUR",
  firstForecastMonth: kind === "forecast" ? "2026-03" : null,
  cells: Object.fromEntries(months(2026).map((month) => [month, { revenue: 100_000, "other-income": 0, personnel: 30_000, "other-expenses": 20_000 }])),
  personnelSource: "manual", rhScenarioId: null, updatedAt: "2026-10-25T08:00:00.000Z",
});
const sheet = (ctx: FinanceExportContext, name = "Réel et comparaison") => financeWorkbook(ctx).sheets.find((entry) => entry.name === name)!;
const find = (table: SheetSpec, month: string, label: string) => table.rows.find((row) => row[0] === month && row[1] === label)!;
const value = (table: SheetSpec, month: string, label: string, key: string): ExportCell => find(table, month, label)[table.columns.findIndex((column) => column.key === key)];
const total = (ctx: FinanceExportContext) => `Total ${ctx.from} → ${ctx.to}`;
const noteOf = (cell: ExcelJS.Cell) => typeof cell.note === "string" ? cell.note : cell.note?.texts?.map((text) => text.text).join("") ?? "";

function csvRows(csv: string): string[][] {
  const rows: string[][] = [], row: string[] = [];
  let cell = "", quoted = false;
  const text = csv.slice(1);
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ";" || char === "\r")) {
      row.push(cell); cell = "";
      if (char === "\r") { rows.push([...row]); row.length = 0; i++; }
    } else cell += char;
  }
  return rows;
}

describe("export financier de la période sélectionnée", () => {
  it("reprend les quatre lignes et le résultat, avec un N-1 aligné et des totaux réconciliables", () => {
    const ctx = context(), table = sheet(ctx);
    expect(table.rows).toHaveLength(15);
    expect(table.columns.map((column) => column.key)).toEqual(["month", "line", "actual", "previous", "observations"]);
    expect(value(table, "2026-01", "Chiffre d’affaires", "actual")).toBe(100_000);
    expect(value(table, "2026-01", "Chiffre d’affaires", "previous")).toBe(90_000);
    expect(value(table, "2026-02", "Résultat", "actual")).toBe(30_000);
    expect(value(table, total(ctx), "Résultat", "actual")).toBe(80_000);
    expect(value(table, total(ctx), "Résultat", "previous")).toBe(70_000);
    expect(value(table, total(ctx), "Chiffre d’affaires", "actual")).toBe(180_000);
    expect(table.rows.some((row) => row[0] === "2026-12")).toBe(false);
    for (const row of FINANCE_ROWS) {
      const accountTable = sheet(ctx, "Comptes détaillés");
      const sum = accountTable.rows.filter((entry) => entry[0] === total(ctx) && String(entry[1]).endsWith(row.label)).reduce((acc, entry) => acc + BigInt(entry[2] as number), 0n);
      expect(Number(sum)).toBe(value(table, total(ctx), row.label, "actual"));
    }
  });

  it("n’exporte pas le total annuel d’un compte comme total de la période", () => {
    const ctx = context(), table = sheet(ctx, "Comptes détaillés");
    expect(ctx.actuals.accounts.find((account) => account.account === "706000")!.total.cents).toBeNull();
    expect(value(table, total(ctx), "706000 · Chiffre d’affaires", "actual")).toBe(180_000);
    expect(table.rows.some((row) => row[0] === "2026-12")).toBe(false);
  });

  it("conserve les mois demandés et refuse tout total partiel si un mois manque", () => {
    const ctx = context(); ctx.to = "2026-03";
    const table = sheet(ctx);
    expect(value(table, "2026-03", "Chiffre d’affaires", "actual")).toEqual({ nd: "mois hors de la couverture comptable lue" });
    expect(value(table, total(ctx), "Chiffre d’affaires", "actual")).toEqual({ nd: "Total non calculable : au moins un mois est n.d. ; aucun total partiel." });
    expect(value(table, "2026-02", "Autres produits", "actual")).toBe(0);
    expect(String(find(table, "2026-02", "Autres produits").at(-1))).toContain("aucune écriture affectée");
  });

  it("le N-1 absent reste n.d. indépendamment du réel disponible", () => {
    const ctx = context(); ctx.previous.months = [];
    const table = sheet(ctx);
    expect(value(table, "2026-01", "Résultat", "actual")).toBe(50_000);
    expect(value(table, "2026-01", "Résultat", "previous")).toEqual({ nd: "Donnée financière non disponible pour ce mois." });
    expect(value(table, total(ctx), "Résultat", "previous")).toHaveProperty("nd");
  });

  it("garde les comptes présents seulement en N-1, sans créer de compte de mapping absent", () => {
    const ctx = context();
    ctx.previous = buildActuals(source([line("2025-01", "758000", 0, 3_000), line("2025-02", "758000", 0, 2_000)], ["2025-01", "2025-02"]), months(2025), []);
    ctx.mappings = [{ account: "799999", row: "revenue" }];
    const table = sheet(ctx, "Comptes détaillés");
    expect(value(table, total(ctx), "758000 · Autres produits", "previous")).toBe(5_000);
    expect(value(table, "2026-01", "758000 · Autres produits", "actual")).toBe(0);
    expect(String(find(table, "2026-01", "758000 · Autres produits").at(-1))).toContain("Aucune écriture de ce compte");
    expect(table.rows.some((row) => String(row[1]).startsWith("799999"))).toBe(false);
    expect(sheet(ctx, "Modèle").rows.some((row) => row[1] === "799999")).toBe(true);
  });

  it("additionne en entiers exacts puis rend n.d. les totaux et montants non sûrs", () => {
    const ctx = context();
    ctx.actuals.months[0].cells.revenue = { cents: Number.MAX_SAFE_INTEGER, reason: null };
    ctx.actuals.months[1].cells.revenue = { cents: 1, reason: null };
    ctx.actuals.months[0].result = { cents: Number.MAX_SAFE_INTEGER + 1, reason: null };
    ctx.actuals.months[1].cells.personnel = { cents: 0.5, reason: null };
    const table = sheet(ctx);
    expect(value(table, total(ctx), "Chiffre d’affaires", "actual")).toEqual({ nd: "Total hors des centimes entiers sûrs." });
    expect(value(table, "2026-01", "Résultat", "actual")).toEqual({ nd: "Montant hors des centimes entiers sûrs." });
    expect(value(table, "2026-02", "Charges de personnel", "actual")).toHaveProperty("nd");
  });
});

describe("plans choisis et budget comparatif", () => {
  it("réserve une feuille explicitement annuelle au plan, en conservant l’origine réelle avant bascule", () => {
    const ctx = context(); ctx.selectedPlan = plan("forecast");
    ctx.projection = buildFinanceProjection(ctx.actuals, ctx.selectedPlan, []);
    const table = sheet(ctx, "Plan annuel");
    expect(table.rows).toHaveLength(65);
    expect(table.note).toContain("janvier à décembre 2026");
    expect(value(table, "2026-02", "Résultat", "plan")).toBe(30_000);
    expect(value(table, "2026-12", "Résultat", "plan")).toBe(50_000);
    expect(value(table, "Total annuel 2026-01 → 2026-12", "Résultat", "plan")).toBe(580_000);
    expect(String(find(table, "2026-02", "Résultat").at(-1))).toContain("réel comptable");
    expect(String(find(table, "2026-03", "Résultat").at(-1))).toContain("hypothèses du plan");
    expect(sheet(ctx).rows.some((row) => row[0] === "2026-12")).toBe(false);
    expect(value(sheet(ctx), total(ctx), "Résultat", "plan")).toBe(80_000);
  });

  it("exporte le scénario RH choisi et ses montants de remplacement, sans recalculer le plan", () => {
    const ctx = context(); ctx.selectedPlan = { ...plan("forecast"), personnelSource: "rh", rhScenarioId: "00000000-0000-4000-8000-000000000099" };
    ctx.projection = buildFinanceProjection(ctx.actuals, ctx.selectedPlan, months(2026).map((month) => ({ month, cell: { cents: 45_000, reason: null } })));
    const spec = financeWorkbook(ctx);
    expect(spec.sources.find((entry) => entry.label === "Plan sélectionné")!.detail).toContain("scénario RH 00000000-0000-4000-8000-000000000099");
    expect(value(sheet(ctx, "Plan annuel"), "2026-03", "Charges de personnel", "plan")).toBe(45_000);
    expect(value(sheet(ctx, "Plan annuel"), "2026-02", "Charges de personnel", "plan")).toBe(40_000);
    expect(spec.definitions.find((entry) => entry.term === "Lien RH")!.definition).toContain("remplace uniquement");
  });

  it("conserve un budget à zéro et calcule l’écart réel moins budget, sans inverser les charges", () => {
    const ctx = context(); ctx.selectedBudget = plan();
    ctx.selectedBudget.cells["2026-01"].personnel = 0;
    ctx.budgetMonths = buildFinanceProjection(ctx.actuals, ctx.selectedBudget, []);
    const table = sheet(ctx, "Budget et écarts");
    expect(value(table, "2026-01", "Charges de personnel", "budget")).toBe(0);
    expect(value(table, "2026-01", "Charges de personnel", "gap")).toBe(30_000);
    expect(value(table, "2026-02", "Résultat", "gap")).toBe(-20_000);
    expect(value(table, total(ctx), "Charges de personnel", "gap")).toBe(40_000);
    expect(table.rows).toHaveLength(15);
    expect(financeWorkbook(ctx).sheets.some((entry) => entry.name === "Plan annuel")).toBe(false);
  });

  it("ne comble pas une hypothèse manquante et refuse les écarts débordants", () => {
    const ctx = context(); ctx.selectedBudget = plan();
    delete ctx.selectedBudget.cells["2026-02"].personnel;
    ctx.budgetMonths = buildFinanceProjection(ctx.actuals, ctx.selectedBudget, []);
    ctx.actuals.months[0].cells.revenue = { cents: Number.MAX_SAFE_INTEGER, reason: null };
    ctx.budgetMonths[0].cells.revenue = { cents: -1, reason: null };
    const table = sheet(ctx, "Budget et écarts");
    expect(value(table, "2026-02", "Charges de personnel", "budget")).toEqual({ nd: "Hypothèse non saisie pour ce mois." });
    expect(value(table, "2026-02", "Charges de personnel", "gap")).toEqual({ nd: "Écart non calculable : réel ou budget n.d." });
    expect(value(table, total(ctx), "Charges de personnel", "gap")).toHaveProperty("nd");
    expect(value(table, "2026-01", "Chiffre d’affaires", "gap")).toEqual({ nd: "Écart hors des centimes entiers sûrs." });
  });

  it("un plan sans modèle de projection disponible donne n.d., pas les cellules brutes du plan", () => {
    const ctx = context(); ctx.selectedPlan = plan();
    expect(value(sheet(ctx), "2026-01", "Résultat", "plan")).toHaveProperty("nd");
    expect(value(sheet(ctx, "Plan annuel"), "2026-12", "Résultat", "plan")).toHaveProperty("nd");
  });
});

describe("provenance et sorties réellement lisibles", () => {
  it("retient source, date appliquée, révision, règles et couverture, sans fichier ni identité de réglage", () => {
    const ctx = context(), spec = financeWorkbook(ctx);
    expect(spec.generatedAt).toBe(ctx.generatedAt);
    expect(spec.sources[0].detail).toContain("Pennylane — source retenue dans Données");
    expect(spec.sources[0].syncedAt).toBe("2026-10-26T11:15:00.000Z");
    expect(spec.sources[0].detail).toContain("pas une clôture comptable");
    expect(spec.filters).toContainEqual({ label: "Révision du modèle", value: "7" });
    expect(spec.definitions.find((entry) => entry.term === "Signes et résultat")!.definition).toContain("crédit − débit");
    const text = JSON.stringify(spec) + financeCsv(ctx);
    expect(text).not.toContain("fichier-prive-test.csv");
    expect(text).not.toContain("identite-a-ne-pas-exporter");
    expect(spec.sheets.some((entry) => entry.name === "Budget et écarts")).toBe(false);
  });

  it("produit un vrai classeur : EUR numériques au centime, zéro numérique, n.d. commenté et aucune formule", async () => {
    const ctx = context(); ctx.to = "2026-03";
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook(financeWorkbook(ctx)) as unknown as ExcelJS.Buffer);
    const table = wb.getWorksheet("Réel et comparaison")!;
    const locate = (month: string, label: string) => {
      let found: ExcelJS.Row | undefined;
      table.eachRow((row) => { if (row.getCell(1).value === month && row.getCell(2).value === label) found = row; });
      return found!;
    };
    const known = locate("2026-01", "Chiffre d’affaires").getCell(3);
    expect(known.value).toBe(1_000);
    expect(known.numFmt).toBe(NUM_FMT.eur);
    expect(locate("2026-01", "Autres produits").getCell(3).value).toBe(0);
    const missing = locate("2026-03", "Chiffre d’affaires").getCell(3);
    expect(missing.value).toBe("n.d.");
    expect(noteOf(missing)).toContain("hors de la couverture comptable");
    expect(noteOf(locate(total(ctx), "Résultat").getCell(3))).toContain("aucun total partiel");
    expect(wb.worksheets.map((entry) => entry.name)).toEqual(["Réel et comparaison", "Comptes détaillés", "Modèle", "Filtres", "Sources", "Définitions"]);
    wb.eachSheet((entry) => entry.eachRow((row) => row.eachCell((cell) => expect(cell.type).not.toBe(ExcelJS.ValueType.Formula))));
  });

  it("fournit un CSV long de neuf colonnes, avec BOM, valeurs EUR exactes et n.d. accompagné de raison", () => {
    const ctx = context(); ctx.to = "2026-03";
    const csv = financeCsv(ctx), rows = csvRows(csv);
    expect(Buffer.from(csv).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(rows.every((row) => row.length === 9)).toBe(true);
    expect(rows[0]).toEqual(["section", "mois", "ligne", "réel EUR", "N-1 EUR", "plan EUR", "budget EUR", "écart EUR", "raison"]);
    expect(rows.find((row) => row[0] === "Compte de résultat" && row[1] === "2026-01" && row[2] === "Résultat")!.slice(3, 8)).toEqual(["500,00", "450,00", "", "", ""]);
    const missing = rows.find((row) => row[0] === "Compte de résultat" && row[1] === "2026-03" && row[2] === "Résultat")!;
    expect(missing[3]).toBe("n.d."); expect(missing[8]).toContain("couverture comptable");
  });

  it("préserve les centimes extrêmes et négatifs sans conversion flottante ni zéro négatif", () => {
    const ctx = context(); ctx.to = "2026-01";
    ctx.actuals.months[0].cells.revenue = { cents: Number.MAX_SAFE_INTEGER, reason: null };
    ctx.actuals.months[0].cells.personnel = { cents: -101, reason: null };
    ctx.actuals.months[0].cells["other-income"] = { cents: -0, reason: null };
    const rows = csvRows(financeCsv(ctx)).filter((row) => row[0] === "Compte de résultat" && row[1] === "2026-01");
    expect(rows.find((row) => row[2] === "Chiffre d’affaires")![3]).toBe("90071992547409,91");
    expect(rows.find((row) => row[2] === "Charges de personnel")![3]).toBe("-1,01");
    expect(rows.find((row) => row[2] === "Autres produits")![3]).toBe("0,00");
  });

  it("neutralise les textes de formule en CSV et Excel, en gardant guillemets, séparateurs et retours à la ligne", async () => {
    const ctx = context(); ctx.workspaceName = '=FICTIF("a;b")\r\nseconde ligne';
    ctx.selectedPlan = { ...plan("forecast"), name: '@FICTIF("x;y")\nplan' };
    ctx.projection = buildFinanceProjection(ctx.actuals, ctx.selectedPlan, []);
    const rows = csvRows(financeCsv(ctx));
    expect(rows.every((row) => row.length === 9)).toBe(true);
    expect(rows.find((row) => row[0] === "Provenance" && row[2] === "Espace")![8]).toBe(`'${ctx.workspaceName}`);
    expect(rows.find((row) => row[0] === "Filtres" && row[2] === "Plan")![8]).toMatch(/^'@FICTIF/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook(financeWorkbook(ctx)) as unknown as ExcelJS.Buffer);
    const filters = wb.getWorksheet("Filtres")!;
    let planCell: ExcelJS.Cell | undefined;
    filters.eachRow((row) => { if (row.getCell(1).value === "Plan") planCell = row.getCell(2); });
    expect(planCell!.value).toMatch(/^'@FICTIF/);
    expect(planCell!.type).toBe(ExcelJS.ValueType.String);
  });

  it("ne modifie ni les modèles, ni les réglages, et conserve le résultat entre deux appels", () => {
    const ctx = context(); ctx.selectedPlan = plan("forecast"); ctx.projection = buildFinanceProjection(ctx.actuals, ctx.selectedPlan, []);
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } };
    const before = JSON.stringify(ctx); freeze(ctx);
    expect(financeWorkbook(ctx)).toEqual(financeWorkbook(ctx));
    expect(financeCsv(ctx)).toBe(financeCsv(ctx));
    expect(JSON.stringify(ctx)).toBe(before);
  });
});
