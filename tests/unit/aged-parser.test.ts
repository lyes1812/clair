import { describe, expect, it } from "vitest";
import { AgedError, parseAgedFile } from "@/lib/aged/parser";
import { agedCsv, agedXlsx } from "@/lib/aged/fixture";

const enc = (s: string) => new TextEncoder().encode(s);
const expected = [
  { supplier: "Fournisseur fictif Alpha", auxiliary: "F001", invoice: "FA-2026-002", invoiceDate: "2026-02-10", dueDate: "2026-03-12", amountCents: 300_000 },
  { supplier: "Fournisseur fictif Œuvre", auxiliary: "F002", invoice: "AC-1", invoiceDate: "2026-01-15", dueDate: "2026-02-14", amountCents: 70_000 },
  { supplier: "Fournisseur fictif Gamma", auxiliary: "F003", invoice: "AC-3", invoiceDate: "2026-02-20", dueDate: "2026-12-20", amountCents: 30_000 },
  { supplier: "Fournisseur fictif Delta", auxiliary: "F004", invoice: "FD-77", invoiceDate: "2026-10-25", dueDate: "2026-11-24", amountCents: 45_000 },
];

describe("balance âgée fournisseurs", () => {
  it("CSV : en-tête trouvé sous un titre, tranches du fichier ignorées, ligne de total écartée, montants au centime", async () => {
    const r = await parseAgedFile(enc(agedCsv()));
    expect(r.profile.format).toBe("csv");
    expect(r.invoices.map(({ line: _l, ...x }) => x)).toEqual(expected);
    expect(r.profile.ignored).toEqual(["Non échu", "0-30 j"]);
    expect(r.warnings.join(" ")).toContain("recalculées par Clair");
  });

  it("XLSX : dates et nombres natifs, mêmes factures", async () => {
    const r = await parseAgedFile(await agedXlsx());
    expect(r.profile.format).toBe("xlsx");
    expect(r.invoices.map(({ line: _l, ...x }) => x)).toEqual(expected);
  });

  it("sans colonne d'échéance : lu, échéance n.d. signalée ; en-tête inconnu ou ligne illisible : refus", async () => {
    const r = await parseAgedFile(enc("Fournisseur;Facture;Date;Solde\nFournisseur fictif;F1;01/02/2026;-12,50\n"));
    expect(r.invoices[0]).toMatchObject({ dueDate: null, amountCents: -1250 });
    expect(r.warnings.join(" ")).toContain("Aucune colonne d'échéance");
    await expect(parseAgedFile(enc("a;b;c\n1;2;3\n"))).rejects.toThrow(AgedError);
    await expect(parseAgedFile(enc("Fournisseur;Facture;Date;Solde\nX;F1;31/02/2026;1,00\n"))).rejects.toThrow(/Ligne 2 : date de facture/);
    await expect(parseAgedFile(enc("<html></html>"))).rejects.toThrow(/CSV ou XLSX/);
  });
});
