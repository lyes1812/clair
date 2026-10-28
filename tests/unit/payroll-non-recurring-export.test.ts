import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { actualNonRecurringSheet } from "@/lib/payroll/non-recurring-export";
import { buildWorkbook } from "@/lib/export/xlsx";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import type { ActualEvent } from "@/lib/payroll/non-recurring";
const syncId = "11111111-1111-4111-8111-111111111111";
const event: ActualEvent = { id: "22222222-2222-4222-8222-222222222222", syncId, month: "2026-06", kind: "tuilage", contractKeys: ["PERSONNE_FICTIVE_PRIVEE_A", "PERSONNE_FICTIVE_PRIVEE_B"], chargedCents: 12345, note: "NOTE_PRIVEE_FICTIVE" };
const input = { grid: DEFAULT_PREFIXES, months: [event.month], openMonths: [], lines: [{ key: "ligne-fictive", month: event.month, accountId: "6411", accountName: null, contractId: null, debitCents: 100000, creditCents: 0 }] };
describe("Excel du réel non récurrent : agrégats exacts, sans noms", () => {
  it("conserve les centimes, le brut source et la soustraction séparée", async () => {
    const sheet = actualNonRecurringSheet(input, [event], input.months, syncId);
    expect(sheet.rows[2]).toEqual(["Tuilages", 1, 12345, 12345, "Déclaration du client, rattachée à la lecture PayFit ; montants déjà compris dans la paie. Liste non exhaustive, aucun prorata de tuilage présumé."]);
    expect(sheet.rows.at(-1)?.at(-2)).toBe(87655);
    const text = JSON.stringify(sheet); expect(text).not.toContain("PERSONNE_FICTIVE"); expect(text).not.toContain(event.note);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildWorkbook({ title: "Fictif", workspaceName: "Fictif", generatedAt: "2026-10-28T10:00:00Z", filters: [], sources: [], definitions: [], sheets: [sheet] }) as unknown as ExcelJS.Buffer);
    const values = wb.worksheets[0].getColumn(3).values; expect(values).toContain(123.45);
  });
  it("un coût absent ne devient pas zéro ni un total partiel", () => {
    const sheet = actualNonRecurringSheet(input, [{ ...event, chargedCents: null }], input.months, syncId);
    expect(sheet.rows[2][2]).toHaveProperty("nd"); expect(sheet.rows.at(-1)?.at(-2)).toHaveProperty("nd");
  });
});
