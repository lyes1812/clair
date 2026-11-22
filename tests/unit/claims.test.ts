import { describe, expect, it } from "vitest";
import { agingOf, buildClaims, cashToOverdue, claimKey, claimsByRank, containsInvoice, exigibilityOf, overridesFromForm, parseClaimOverrides, similarity, weekStartOf, type ClaimFecLine } from "@/lib/restructuring/crisis/claims";
import { buildCrisisPosition, type CrisisLine } from "@/lib/restructuring/crisis/model";
import { parseFec } from "@/lib/fec/parser";
import { companyFecBytes } from "@/lib/fec/fixture-company";
import { parseAgedFile } from "@/lib/aged/parser";
import { agedCsv } from "@/lib/aged/fixture";

// Cap 13, lot L3. FEC fictif du lot L1 + balance âgée fictive au 31/10/2026 (src/lib/aged/fixture.ts), calcul à la main :
//   passif = balance 4 450,00 + emprunt 164 49 000,00 + TVA collectée 445710 1 000,00 = 54 450,00 €
//   = dettes FEC 54 000,00 − fournisseurs couverts 4 000,00 + balance 4 450,00.
//   Exigibilité au 31/10 : Alpha échu 3 000,00 ; Œuvre payée le 05/11 (virement « AC-1 », 700,00) ; Gamma semaine 7 ;
//   Delta semaine 4 ; 164 et 445710 n.d. (aucune échéance).
const asOf = "2026-10-31";
const parsed = parseFec(companyFecBytes());
const lines: CrisisLine[] = parsed.lines.map((l) => ({ accountId: l.accountId, accountName: l.accountName, auxiliary: l.auxiliaryAccount, auxiliaryLabel: l.auxiliaryLabel, date: l.entryDate, debitCents: l.debitCents, creditCents: l.creditCents }));
const supplierLines: ClaimFecLine[] = parsed.lines.filter((l) => l.accountId.startsWith("40")).map((l) => ({ accountId: l.accountId, auxiliary: l.auxiliaryAccount, auxiliaryLabel: l.auxiliaryLabel, date: l.entryDate, pieceRef: l.pieceRef, label: l.label, debitCents: l.debitCents, creditCents: l.creditCents }));
const ranks = { suppliers: "chirographaire" } as const;
const position = buildCrisisPosition(lines, asOf, ranks);
const invoices = (await parseAgedFile(new TextEncoder().encode(agedCsv()))).invoices;
const bankDebits = [
  { date: "2026-11-05", amountCents: -70_000, label: "VIR SEPA FOURNISSEUR FICTIF OEUVRE AC-1", counterparty: null, reference: null },
  { date: "2026-10-20", amountCents: -45_000, label: "VIR FD-77 ANTERIEUR", counterparty: null, reference: null },
];
const loan = claimKey("fec", "164000", null);

describe("passif par créance : cas de référence", () => {
  const v = buildClaims({ asOf, position, invoices, supplierLines, bankDebits, ranks, overrides: {} });
  if (v.kind !== "value") throw new Error(v.reason);
  const by = (creditor: string) => v.claims.find((c) => c.creditor === creditor)!;

  it("une créance par facture, puis par solde créditeur du FEC hors fournisseurs couverts", () => {
    expect(v.claims.map((c) => [c.source, c.accountId ?? c.invoice, c.amountCents])).toEqual([
      ["fec", "164000", 4_900_000], ["balance", "FA-2026-002", 300_000], ["fec", "445710", 100_000], ["balance", "AC-1", 70_000], ["balance", "FD-77", 45_000], ["balance", "AC-3", 30_000],
    ]);
  });

  it("passif exigible par rang : payée depuis exclue, créances sans rang jamais classées d'office", () => {
    const r = claimsByRank(v.claims);
    expect(r.totals.find((t) => t.id === "chirographaire")).toMatchObject({ cents: 300_000 + 45_000 + 30_000, count: 3 });
    expect(r.totals.filter((t) => t.id !== "chirographaire").every((t) => t.cents === 0)).toBe(true);
    expect(r).toMatchObject({ unrankedCents: 4_900_000 + 100_000, unrankedCount: 2 });
  });

  it("total passif = dettes FEC − fournisseurs couverts + balance âgée, au centime", () => {
    expect(v.reconciliation).toEqual({ fecDebtCents: 5_400_000, coveredFecCents: 400_000, agedCents: 445_000, passifCents: 5_445_000 });
    expect(v.totals.passifCents).toBe(5_400_000 - 400_000 + 445_000);
  });

  it("exigibilité : échu, semaines, n.d. sans échéance, payée depuis (règle 1 sur le virement)", () => {
    expect(by("Fournisseur fictif Alpha").exigibility).toEqual({ kind: "echu" });
    expect(by("Fournisseur fictif Gamma").exigibility).toEqual({ kind: "semaine", week: 7 });
    expect(by("Fournisseur fictif Delta").exigibility).toEqual({ kind: "semaine", week: 4 });
    expect(by("Emprunt bancaire").exigibility).toMatchObject({ kind: "nd" });
    const oeuvre = by("Fournisseur fictif Œuvre");
    expect(oeuvre.exigibility).toEqual({ kind: "payee", date: "2026-11-05" });
    expect(oeuvre.paid).toMatchObject({ rule: 1, cents: 70_000 });
    // Le débit du 20/10 est antérieur à la date d'arrêté : il ne paie rien « depuis ».
    expect(by("Fournisseur fictif Delta").paid).toBeNull();
    expect(v.totals).toMatchObject({ echuCents: 300_000, ndCents: 5_000_000, payeeCents: 70_000, exigibleCents: 5_375_000, auDelaCents: 0, nonExigibleCents: 0 });
    expect(v.totals.weeks[3]).toBe(45_000);
    expect(v.totals.weeks[6]).toBe(30_000);
  });

  it("rapprochement FEC : Alpha par la règle 2 (tiers, montant, date) ; montants différents non rapprochés", () => {
    expect(by("Fournisseur fictif Alpha").fecMatch).toEqual({ rule: 2, date: "2026-02-10", pieceRef: "P-AC-2", cents: 300_000 });
    expect(by("Fournisseur fictif Œuvre").fecMatch).toBeNull();
    expect(by("Fournisseur fictif Delta").fecMatch).toBeNull();
  });

  it("contrôle balance âgée ↔ FEC 401 : 450,00 € d'écart (11,25 %), avertissement fort détaillé sur Delta", () => {
    expect(v.control).toEqual({ kind: "value", agedCents: 445_000, fecCents: 400_000, gapCents: 45_000, strong: true, lines: [{ creditor: "Fournisseur fictif Delta", auxiliary: "F004", agedCents: 45_000, fecCents: 0, gapCents: 45_000 }] });
  });

  it("tranches d'âge recalculées à la date d'arrêté", () => {
    expect(v.aging.filter((a) => a.count)).toEqual([{ bucket: "non_echu", cents: 75_000, count: 2 }, { bucket: "plus_90", cents: 370_000, count: 2 }]);
  });

  it("rang hérité de la nature, jamais supposé ailleurs", () => {
    expect(by("Fournisseur fictif Alpha")).toMatchObject({ rank: "chirographaire", rankOrigin: "nature" });
    expect(by("Emprunt bancaire")).toMatchObject({ rank: null, rankOrigin: null });
    expect(v.unranked).toBe(2);
  });
});

describe("saisies par créance", () => {
  it("rang et échéance saisis : priment sur la nature et rendent l'exigibilité calculable", () => {
    const v = buildClaims({ asOf, position, invoices, supplierLines, bankDebits: [], ranks, overrides: { [loan]: { rank: "surete", dueDate: "2026-11-30" } } });
    if (v.kind !== "value") throw new Error();
    const c = v.claims.find((x) => x.key === loan)!;
    expect(c).toMatchObject({ rank: "surete", rankOrigin: "creance", dueDate: "2026-11-30", dueOrigin: "saisie", exigibility: { kind: "semaine", week: 5 } });
    expect(v.unranked).toBe(1);
  });

  it("sans balance âgée : les fournisseurs restent lus dans le FEC, contrôle n.d.", () => {
    const v = buildClaims({ asOf, position, invoices: null, supplierLines, bankDebits: [], ranks, overrides: {} });
    if (v.kind !== "value") throw new Error();
    expect(v.totals.passifCents).toBe(5_400_000);
    expect(v.control).toMatchObject({ kind: "nd" });
  });

  it("formulaire et paramètre : lecture stricte, une valeur vide retire la saisie", () => {
    const form = new FormData();
    form.append("claim", loan); form.set(`rank-${loan}`, "surete"); form.set(`due-${loan}`, "2026-11-30");
    const next = overridesFromForm(form, {});
    expect(next).toEqual({ [loan]: { rank: "surete", dueDate: "2026-11-30" } });
    expect(parseClaimOverrides(next)).toEqual(next);
    const clear = new FormData(); clear.append("claim", loan);
    expect(overridesFromForm(clear, next)).toEqual({});
    expect(parseClaimOverrides({ [loan]: { rank: "inconnu" } })).toBeNull();
    expect(parseClaimOverrides({ autre: {} })).toBeNull();
    const bad = new FormData(); bad.append("claim", loan); bad.set(`due-${loan}`, "2026-02-30");
    expect(() => overridesFromForm(bad, {})).toThrow(/Échéance/);
  });
});

describe("règles élémentaires", () => {
  it("échéance → exigibilité et tranche d'âge (jour J compris dans l'échu)", () => {
    expect(exigibilityOf("2026-10-31", asOf)).toEqual({ kind: "echu" });
    expect(exigibilityOf("2026-11-07", asOf)).toEqual({ kind: "semaine", week: 1 });
    // 31/10/2026 est un samedi : semaine 1 = lundi 02/11 au dimanche 08/11, le dimanche 01/11 y est rattaché.
    expect(exigibilityOf("2026-11-01", asOf)).toEqual({ kind: "semaine", week: 1 });
    expect(exigibilityOf("2026-11-08", asOf)).toEqual({ kind: "semaine", week: 1 });
    expect(exigibilityOf("2026-11-09", asOf)).toEqual({ kind: "semaine", week: 2 });
    expect(exigibilityOf("2027-01-31", asOf)).toEqual({ kind: "semaine", week: 13 }); // dimanche de la semaine 13
    expect(exigibilityOf("2027-02-01", asOf)).toEqual({ kind: "au_dela" });
    // Date d'arrêté un lundi : la semaine 1 commence ce lundi même.
    expect(weekStartOf("2026-11-02", 1)).toBe("2026-11-02");
    expect(exigibilityOf("2026-11-08", "2026-11-02")).toEqual({ kind: "semaine", week: 1 });
    expect(exigibilityOf("2026-11-09", "2026-11-02")).toEqual({ kind: "semaine", week: 2 });
    expect(weekStartOf(asOf, 13)).toBe("2027-01-25");
    expect(agingOf("2026-10-01", asOf)).toBe("0_30");
    expect(agingOf("2026-09-30", asOf)).toBe("31_60");
    expect(agingOf(null, asOf)).toBe("nd");
  });
  it("similarité trigramme et n° de facture", () => {
    expect(similarity("Fournisseur fictif Œuvre", "FOURNISSEUR FICTIF OEUVRE")).toBe(1);
    expect(similarity("Ateliers du Nord", "Atelier du Nord")).toBeCloseTo(15 / 18, 10);
    expect(similarity("Ateliers du Nord", "Papeterie Centrale")).toBeLessThan(0.85);
    expect(containsInvoice("P-AC-2 Facture fictive", "AC-2")).toBe(true);
    expect(containsInvoice("Facture fictive", "AC-2")).toBe(false);
    expect(containsInvoice("X 12 Y", "12")).toBe(false); // moins de 3 caractères : jamais rapproché sur le seul numéro
  });
});

describe("indicateur disponibilités / passif échu", () => {
  it("centièmes arrondis au plus proche ; n.d. sans échu ou sans disponibilités", () => {
    // 15 000,00 € / 3 000,00 € = 5,00 ; 1 000,00 / 3 000,00 = 0,333… → 0,33 ; 2 000,00 / 3 000,00 = 0,666… → 0,67.
    expect(cashToOverdue(1_500_000, 300_000)).toEqual({ kind: "value", hundredths: 500 });
    expect(cashToOverdue(100_000, 300_000)).toEqual({ kind: "value", hundredths: 33 });
    expect(cashToOverdue(200_000, 300_000)).toEqual({ kind: "value", hundredths: 67 });
    expect(cashToOverdue(null, 300_000).kind).toBe("nd");
    expect(cashToOverdue(1_500_000, 0).kind).toBe("nd");
  });
});
