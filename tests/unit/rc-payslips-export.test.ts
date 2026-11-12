import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook } from "@/lib/export/xlsx";
import { rcPayslipSheet } from "@/lib/payroll/rc-payslips-export";
import { actualNonRecurringSheet } from "@/lib/payroll/non-recurring-export";
import type { RcPayslipScan } from "@/lib/payroll/rc-payslips";
import type { ActualEvent } from "@/lib/payroll/non-recurring";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";

const syncId = "11111111-1111-4111-8111-111111111111";
const event: ActualEvent = { id: "33333333-3333-4333-8333-333333333333", syncId, month: "2026-02", kind: "rupture-conventionnelle", chargedCents: null, contractKeys: ["payfit:CONTRAT_PRIVE_FICTIF"], note: "NOTE_PRIVEE_FICTIVE" };
const scan = (patch: Partial<RcPayslipScan> = {}): RcPayslipScan => ({
  version: 1, id: "22222222-2222-4222-8222-222222222222", payrollSyncId: syncId, companyId: "SOCIETE_PRIVEE_FICTIVE",
  from: "2026-01", to: "2026-02", status: "complete", startedAt: "2026-03-01T08:00:00.000Z", finishedAt: "2026-03-01T08:01:00.000Z",
  closedMonths: ["2026-01", "2026-02"], unavailableMonths: [], totalCollaborators: 1, completedCollaborators: 1, checkedPayslips: 2, issues: [],
  records: [{ month: "2026-02", collaboratorId: "COLLAB_PRIVE_FICTIF", contractId: "CONTRAT_PRIVE_FICTIF", payslipId: "PDF_PRIVE_FICTIF", pdfHash: "a".repeat(64), parserVersion: "fictif-v1", status: "identified", code: "identified", indemnityCents: 123456, components: [{ label: "LIBELLE_INDIVIDUEL_PRIVE_FICTIF", amountCents: 123456, page: 1, line: 8 }] }], ...patch,
});

describe("Excel des indemnités RC des bulletins", () => {
  it("conserve les centimes et une feuille distincte du coût chargé, sans addition au journal", async () => {
    const value = scan(); const events = [event];
    const sheet = rcPayslipSheet(value, ["2026-01", "2026-02"], syncId, events);
    expect(sheet.name).toBe("Indemnités RC bulletins");
    expect(sheet.rows[1].slice(0, 4)).toEqual(["2026-02", 1, 123456, "Indemnités identifiées"]);
    expect(sheet.rows[2].slice(0, 3)).toEqual(["Période", 1, 123456]);
    expect(sheet.rows[0][2]).toHaveProperty("nd");
    expect(sheet.note).toContain("2026-03-01T08:01:00.000Z");
    const input = { grid: DEFAULT_PREFIXES, months: ["2026-02"], openMonths: [], lines: [{ key: "ligne-fictive", month: "2026-02", accountId: "6411", accountName: null, contractId: null, debitCents: 400000, creditCents: 0 }] };
    const chargedBefore = actualNonRecurringSheet(input, events, ["2026-02"], syncId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook({ title: "Export fictif", workspaceName: "Espace fictif", generatedAt: "2026-03-01T08:02:00.000Z", filters: [], sources: [], definitions: [], sheets: [chargedBefore, sheet] }) as unknown as ExcelJS.Buffer);
    expect(wb.getWorksheet("Indemnités RC bulletins")!.getColumn(3).values).toContain(1234.56);
    expect(chargedBefore.rows[1].at(-2)).toHaveProperty("nd");
    expect(actualNonRecurringSheet(input, events, ["2026-02"], syncId)).toEqual(chargedBefore);
    expect(event.chargedCents).toBeNull();
    expect(value.records[0].indemnityCents).toBe(123456);
  });

  it("n’exporte aucun identifiant, libellé ou justificatif individuel, même pour un éditeur", async () => {
    const sheet = rcPayslipSheet(scan(), ["2026-02"], syncId, [event]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook({ title: "Export fictif", workspaceName: "Espace fictif", generatedAt: "2026-03-01T08:02:00.000Z", filters: [], sources: [], definitions: [], sheets: [sheet] }) as unknown as ExcelJS.Buffer);
    for (const output of [JSON.stringify(sheet), JSON.stringify(wb.model)]) {
      expect(output).not.toMatch(/CONTRAT_PRIVE|COLLAB_PRIVE|PDF_PRIVE|NOTE_PRIVEE|LIBELLE_INDIVIDUEL|SOCIETE_PRIVEE/);
      expect(output).not.toContain(syncId); expect(output).not.toContain("a".repeat(64));
    }
  });

  it("garde un montant manquant, une période partielle et une autre lecture n.d., jamais zéro ou total partiel", () => {
    for (const sheet of [rcPayslipSheet(scan({ status: "partial" }), ["2026-01", "2026-02"], syncId), rcPayslipSheet(scan(), ["2026-02"], "44444444-4444-4444-8444-444444444444"), rcPayslipSheet(scan({ closedMonths: ["2026-01"] }), ["2026-01", "2026-02"], syncId)]) {
      for (const row of sheet.rows) expect(row[2]).toHaveProperty("nd");
      expect(sheet.rows.at(-1)![2]).not.toBe(123456);
    }
    const none = rcPayslipSheet(scan({ records: [] }), ["2026-01", "2026-02"], syncId);
    expect(none.rows.at(-1)![2]).toHaveProperty("nd");
    expect(none.rows.at(-1)![3]).toBe("Aucune indemnité repérée");
  });

  it("applique le même filtre de mois et de service et conserve un zéro confirmé", () => {
    const value = scan();
    const jan = rcPayslipSheet(value, ["2026-01"], syncId);
    expect(jan.rows.at(-1)![2]).toHaveProperty("nd");
    const service = rcPayslipSheet(value, ["2026-02"], syncId, [event], true);
    expect(service.rows.at(-1)![2]).toHaveProperty("nd");
    expect(JSON.stringify(service)).toContain("pas ventilées par service");
    value.records[0].indemnityCents = 0; value.records[0].components[0].amountCents = 0;
    expect(rcPayslipSheet(value, ["2026-02"], syncId).rows.at(-1)![2]).toBe(0);
  });
});
