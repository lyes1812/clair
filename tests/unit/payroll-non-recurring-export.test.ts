import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { actualNonRecurringSheet } from "@/lib/payroll/non-recurring-export";
import { buildWorkbook } from "@/lib/export/xlsx";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import type { ActualEvent } from "@/lib/payroll/non-recurring";
const syncId = "11111111-1111-4111-8111-111111111111";
const event: ActualEvent = { id: "22222222-2222-4222-8222-222222222222", syncId, month: "2026-06", kind: "tuilage", contractKeys: ["PERSONNE_FICTIVE_PRIVEE_A", "PERSONNE_FICTIVE_PRIVEE_B"], chargedCents: 12345, note: "NOTE_PRIVEE_FICTIVE" };
// Seuil 1 et binôme relié à deux personnes fictives : la ligne est publiée (le masquage est éprouvé dans non-recurring-mask.test.ts).
const conf = { link: new Map([["PERSONNE_FICTIVE_PRIVEE_A", "p-a"], ["PERSONNE_FICTIVE_PRIVEE_B", "p-b"]]), confidentialite: { kind: "set" as const, value: 1, updatedAt: null, updatedBy: null }, guard: null };
const input = { grid: DEFAULT_PREFIXES, months: [event.month], openMonths: [], lines: [{ key: "ligne-fictive", month: event.month, accountId: "6411", accountName: null, contractId: null, debitCents: 100000, creditCents: 0 }] };
describe("Excel du réel non récurrent : agrégats exacts, sans noms", () => {
  it("conserve les centimes, le brut source et la soustraction séparée", async () => {
    const sheet = actualNonRecurringSheet(input, [event], input.months, syncId, conf);
    expect(sheet.rows[2]).toEqual(["Tuilages", 1, 12345, 12345, "Déclaration du client, rattachée à la lecture PayFit ; montants déjà compris dans la paie. Liste non exhaustive, aucun prorata de tuilage présumé."]);
    expect(sheet.rows.at(-1)?.at(-2)).toBe(87655);
    const text = JSON.stringify(sheet); expect(text).not.toContain("PERSONNE_FICTIVE"); expect(text).not.toContain(event.note);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildWorkbook({ title: "Fictif", workspaceName: "Fictif", generatedAt: "2026-10-28T10:00:00Z", filters: [], sources: [], definitions: [], sheets: [sheet] }) as unknown as ExcelJS.Buffer);
    const values = wb.worksheets[0].getColumn(3).values; expect(values).toContain(123.45);
  });
  it("un coût absent ne devient pas zéro ni un total partiel", () => {
    const sheet = actualNonRecurringSheet(input, [{ ...event, chargedCents: null }], input.months, syncId, conf);
    expect(sheet.rows[2][2]).toHaveProperty("nd"); expect(sheet.rows.at(-1)?.at(-2)).toHaveProperty("nd");
  });
  it("seuil de confidentialité : binôme sous le seuil n.d. sur toute sa ligne ; filtre Service gardé : masse du service n.d.", () => {
    const sheet = actualNonRecurringSheet(input, [event], input.months, syncId, { ...conf, confidentialite: { ...conf.confidentialite, value: 3 } });
    // Une seule nature non vide (2 personnes < 3) et aucune autre pour la protéger : relation impossible, la nature est n.d.
    expect(sheet.rows[2].slice(1, 4)).toEqual([{ nd: "non affiché (seuil de confidentialité : 3 personnes)" }, { nd: "non affiché (seuil de confidentialité : 3 personnes)" }, { nd: "non affiché (seuil de confidentialité : 3 personnes)" }]);
    const guarded = actualNonRecurringSheet(input, [event], input.months, syncId, { ...conf, guard: { cause: "seuil", reason: "non affiché (seuil de confidentialité : 5 personnes)" } });
    expect(guarded.rows.at(-3)?.at(-2)).toEqual({ nd: "non affiché (seuil de confidentialité : 5 personnes)" });
    expect(guarded.rows.at(-1)?.at(-2)).toHaveProperty("nd");
  });
});
