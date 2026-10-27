import { describe, expect, it } from "vitest";
import { buildActuals, defaultFinanceRow } from "@/lib/finance/actuals";
import { FINANCE_ROWS, type FinanceActuals, type FinanceRowId } from "@/lib/finance/types";
import type { ComptaSource } from "@/lib/payroll/context";

const line = (month: string, accountId: string, debitCents: number | null, creditCents: number | null): ComptaSource["lines"][number] => ({ month, accountId, debitCents, creditCents });
const source = (lines: ComptaSource["lines"], months: string[]): ComptaSource => ({ source: "pennylane", reason: "source comptable retenue", lines, months, nd: {}, error: false });
const value = (actuals: FinanceActuals, month: string, row: FinanceRowId) => actuals.months.find((entry) => entry.month === month)!.cells[row];
const account = (actuals: FinanceActuals, code: string) => actuals.accounts.find((entry) => entry.account === code)!;

// Janvier fictif : CA 1 000 − avoir 100 ; autres produits 50 ; personnel 300 + 100 ; autres charges 200 − avoir 20.
// Résultat = 900 + 50 − 400 − 180 = 370 euros. Les comptes de bilan sont des contreparties, jamais des charges.
const manual = () => source([
  line("2026-01", "706000", 0, 100_000),
  line("2026-01", "709000", 10_000, 0),
  line("2026-01", "758000", 0, 5_000),
  line("2026-01", "641000", 30_000, 0),
  line("2026-01", "645000", 10_000, 0),
  line("2026-01", "606000", 20_000, 0),
  line("2026-01", "609000", 0, 2_000),
  line("2026-01", "421000", null, null),
  line("2026-01", "512000", null, null),
  line("2026-02", "606000", 5_000, 0),
], ["2026-01", "2026-02"]);

describe("correspondance initiale des comptes de résultat", () => {
  it("70 est du CA, 64 du personnel, les autres 6 des charges et les autres 7 des produits ; classes 1 à 5 exclues", () => {
    expect(["701000", "709000", "641000", "649000", "606000", "681000", "713000", "758000", "787000"].map(defaultFinanceRow)).toEqual([
      "revenue", "revenue", "personnel", "personnel", "other-expenses", "other-expenses", "other-income", "other-income", "other-income",
    ]);
    expect(["101000", "211000", "310000", "421000", "512000", "890000", "", " 706000"].map(defaultFinanceRow)).toEqual(Array(8).fill(null));
  });
});

describe("réel mensuel : cas de référence écrit à la main", () => {
  it("calcule quatre lignes et le résultat, en gardant les avoirs et les contrecomptes", () => {
    const actuals = buildActuals(manual(), ["2026-01", "2026-02"], []);
    expect(actuals.months[0]).toEqual({
      month: "2026-01", lineCount: 7,
      cells: {
        revenue: { cents: 90_000, reason: null }, "other-income": { cents: 5_000, reason: null },
        personnel: { cents: 40_000, reason: null }, "other-expenses": { cents: 18_000, reason: null },
      }, result: { cents: 37_000, reason: null },
    });
    expect(actuals.months[1].result).toEqual({ cents: -5_000, reason: null });
    expect(actuals.accounts.map((entry) => entry.account)).toEqual(["606000", "609000", "641000", "645000", "706000", "709000", "758000"]);
    expect(account(actuals, "606000").total).toEqual({ cents: 25_000, reason: null });
    expect(account(actuals, "609000").total).toEqual({ cents: -2_000, reason: null });
    expect(account(actuals, "709000").total).toEqual({ cents: -10_000, reason: null });
  });

  it("les comptes se rapprochent de chaque ligne mensuelle et chaque total de compte de ses mois", () => {
    const actuals = buildActuals(manual(), ["2026-01", "2026-02"], []);
    for (const month of actuals.months) {
      for (const row of FINANCE_ROWS) {
        const sum = actuals.accounts.filter((entry) => entry.row === row.id).reduce((total, entry) => total + BigInt(entry.months[month.month].cents!), 0n);
        expect(BigInt(month.cells[row.id].cents!)).toBe(sum);
      }
      const result = BigInt(month.cells.revenue.cents!) + BigInt(month.cells["other-income"].cents!) - BigInt(month.cells.personnel.cents!) - BigInt(month.cells["other-expenses"].cents!);
      expect(BigInt(month.result.cents!)).toBe(result);
    }
    for (const entry of actuals.accounts) {
      expect(BigInt(entry.total.cents!)).toBe(Object.values(entry.months).reduce((total, cell) => total + BigInt(cell.cents!), 0n));
      expect(entry.lineCount).toBe(entry.account === "606000" ? 2 : 1);
    }
  });

  it("un mois lu avec de l'activité dans une autre catégorie justifie explicitement les zéros", () => {
    const actuals = buildActuals(manual(), ["2026-01", "2026-02"], []);
    for (const row of ["revenue", "other-income", "personnel"] as const) {
      expect(value(actuals, "2026-02", row)).toEqual({ cents: 0, reason: "aucune écriture affectée à cette ligne dans le mois comptable lu" });
    }
    expect(account(actuals, "641000").months["2026-02"]).toEqual({ cents: 0, reason: "aucune écriture de ce compte dans le mois comptable lu" });
    expect(value(actuals, "2026-02", "other-expenses")).toEqual({ cents: 5_000, reason: null });
  });

  it("conserve les montants nuls explicitement lus, et les débits négatifs de remboursement", () => {
    const zero = buildActuals(source([line("2026-01", "641000", 0, 0)], ["2026-01"]), ["2026-01"], []);
    expect(value(zero, "2026-01", "personnel")).toEqual({ cents: 0, reason: null });
    expect(zero.months[0].result).toEqual({ cents: 0, reason: null });
    const refund = buildActuals(source([line("2026-01", "606000", -1_000, 0)], ["2026-01"]), ["2026-01"], []);
    expect(value(refund, "2026-01", "other-expenses")).toEqual({ cents: -1_000, reason: null });
    expect(refund.months[0].result.cents).toBe(1_000);
  });
});

describe("correspondances exactes, sans création de compte", () => {
  it("une correspondance est exacte : ni préfixe implicite, ni compte absent, ni classe de bilan ajoutée", () => {
    const actuals = buildActuals(manual(), ["2026-01"], [
      { account: "706000", row: "other-income" },
      { account: "70", row: "other-expenses" },
      { account: "777000", row: "revenue" },
      { account: "421000", row: "personnel" },
    ]);
    expect(account(actuals, "706000").row).toBe("other-income");
    expect(account(actuals, "709000").row).toBe("revenue");
    expect(actuals.accounts.some((entry) => ["70", "777000", "421000"].includes(entry.account))).toBe(false);
    expect(value(actuals, "2026-01", "revenue").cents).toBe(-10_000);
    expect(value(actuals, "2026-01", "other-income").cents).toBe(105_000);
    expect(actuals.months[0].result.cents).toBe(37_000);
  });

  it("reclasser un produit en charge, ou une charge en produit, conserve le résultat avec le signe de destination", () => {
    const input = source([line("2026-01", "706000", 0, 100_000), line("2026-01", "606000", 20_000, 0)], ["2026-01"]);
    const before = buildActuals(input, ["2026-01"], []);
    const after = buildActuals(input, ["2026-01"], [{ account: "706000", row: "other-expenses" }, { account: "606000", row: "revenue" }]);
    expect(after.months[0].cells.revenue.cents).toBe(-20_000);
    expect(after.months[0].cells["other-expenses"].cents).toBe(-100_000);
    expect(after.months[0].result).toEqual(before.months[0].result);
    expect(after.months[0].result.cents).toBe(80_000);
  });
});

describe("indisponibilité explicite", () => {
  it.each([[null, 0], [0, null], [null, null]] as const)("une colonne monétaire manquante (%s / %s) ne devient pas zéro", (debit, credit) => {
    const actuals = buildActuals(source([line("2026-01", "641000", debit, credit)], ["2026-01"]), ["2026-01"], []);
    expect(value(actuals, "2026-01", "personnel")).toEqual({ cents: null, reason: "débit ou crédit manquant sur une écriture comptable" });
    expect(account(actuals, "641000").months["2026-01"].cents).toBeNull();
    expect(account(actuals, "641000").total.cents).toBeNull();
    expect(actuals.months[0].result.cents).toBeNull();
  });

  it("un mois lu sans écriture de classe 6 ou 7 reste n.d., même avec des contreparties de bilan", () => {
    const actuals = buildActuals(source([line("2026-01", "421000", 1_000, 0)], ["2026-01", "2026-02"]), ["2026-01", "2026-02"], []);
    expect(actuals.accounts).toEqual([]);
    for (const month of actuals.months) {
      expect(month.lineCount).toBe(0);
      for (const row of FINANCE_ROWS) expect(month.cells[row.id]).toEqual({ cents: null, reason: "aucune écriture de charges ou de produits (classes 6 et 7) lue pour ce mois" });
      expect(month.result.cents).toBeNull();
    }
  });

  it("une couverture signalée n.d. est prioritaire ; un mois hors lecture ne devient pas exploitable par ses seules lignes", () => {
    const input = source([line("2026-01", "706000", 0, 1_000), line("2026-02", "706000", 0, 2_000), line("2026-03", "706000", 0, 3_000), line("2026-04", "777000", 0, 4_000)], ["2026-01", "2026-02"]);
    input.nd["2026-02"] = "FEC fichier-confidentiel-fixture : couverture incomplète";
    const actuals = buildActuals(input, ["2026-03", "2026-01", "2026-02", "2026-01"], []);
    expect(actuals.months.map((month) => month.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(actuals.months[0].result.cents).toBe(1_000);
    expect(actuals.months[1].result).toEqual({ cents: null, reason: "mois comptable non exploitable selon la couverture de la source" });
    expect(actuals.months[2].result).toEqual({ cents: null, reason: "mois hors de la couverture comptable lue" });
    expect(actuals.accounts.map((entry) => entry.account)).toEqual(["706000"]);
    expect(account(actuals, "706000").total.cents).toBeNull();
    expect(JSON.stringify(actuals)).not.toContain("fichier-confidentiel-fixture");
  });

  it("source absente ou en erreur : aucune valeur retenue ni raison brute susceptible de contenir un libellé", () => {
    for (const input of [{ ...manual(), source: null, reason: "libellé-confidentiel-fixture" }, { ...manual(), error: true, reason: "libellé-confidentiel-fixture" }] as ComptaSource[]) {
      const actuals = buildActuals(input, ["2026-01"], []);
      for (const row of FINANCE_ROWS) expect(actuals.months[0].cells[row.id].cents).toBeNull();
      expect(actuals.months[0].result.cents).toBeNull();
      expect(JSON.stringify(actuals)).not.toContain("libellé-confidentiel-fixture");
    }
  });
});

describe("centimes et totaux sûrs", () => {
  it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("un montant source invalide (%s) reste n.d.", (invalid) => {
    const actuals = buildActuals(source([line("2026-01", "641000", invalid, 0)], ["2026-01"]), ["2026-01"], []);
    expect(value(actuals, "2026-01", "personnel")).toEqual({ cents: null, reason: "montant comptable hors des centimes entiers sûrs" });
    expect(actuals.months[0].result.cents).toBeNull();
  });

  it("BigInt précède l'addition : des intermédiaires au-delà de la limite peuvent se compenser exactement", () => {
    const input = source([line("2026-01", "706000", 0, Number.MAX_SAFE_INTEGER), line("2026-01", "706000", 0, 2), line("2026-01", "706000", Number.MAX_SAFE_INTEGER, 0)], ["2026-01"]);
    const actuals = buildActuals(input, ["2026-01"], []);
    expect(value(actuals, "2026-01", "revenue")).toEqual({ cents: 2, reason: null });
    expect(actuals.months[0].result.cents).toBe(2);
    expect(account(actuals, "706000").total.cents).toBe(2);
  });

  it("une ligne de gestion ou un total de compte non représentable devient n.d., sans tronquer ni arrondir", () => {
    const actuals = buildActuals(source([line("2026-01", "706000", 0, Number.MAX_SAFE_INTEGER), line("2026-01", "706000", 0, 1)], ["2026-01"]), ["2026-01"], []);
    expect(value(actuals, "2026-01", "revenue")).toEqual({ cents: null, reason: "total comptable hors des centimes entiers sûrs" });
    expect(account(actuals, "706000").months["2026-01"].cents).toBeNull();
    expect(actuals.months[0].result.cents).toBeNull();
    const acrossMonths = buildActuals(source([line("2025-12", "706000", 0, Number.MAX_SAFE_INTEGER), line("2026-01", "706000", 0, 1)], ["2025-12", "2026-01"]), ["2026-01", "2025-12"], []);
    expect(acrossMonths.months.map((month) => month.result.cents)).toEqual([Number.MAX_SAFE_INTEGER, 1]);
    expect(account(acrossMonths, "706000").total).toEqual({ cents: null, reason: "total comptable hors des centimes entiers sûrs" });
  });

  it("le résultat utilise lui aussi BigInt lorsque ses quatre lignes restent individuellement sûres", () => {
    const actuals = buildActuals(source([line("2026-01", "706000", 0, Number.MAX_SAFE_INTEGER), line("2026-01", "758000", 0, Number.MAX_SAFE_INTEGER)], ["2026-01"]), ["2026-01"], []);
    expect(value(actuals, "2026-01", "revenue").cents).toBe(Number.MAX_SAFE_INTEGER);
    expect(value(actuals, "2026-01", "other-income").cents).toBe(Number.MAX_SAFE_INTEGER);
    expect(actuals.months[0].result).toEqual({ cents: null, reason: "total comptable hors des centimes entiers sûrs" });
  });
});

describe("périmètre et absence de mutation", () => {
  it("ordonne les années sans mélanger les comptes ; Pennylane et FEC utilisent le même contrat en centimes", () => {
    const input = source([line("2026-01", "706000", 0, 12_345), line("2025-12", "706000", 0, 6_789)], ["2026-01", "2025-12"]);
    const actuals = buildActuals(input, ["2026-01", "2025-12"], []);
    expect(actuals.months.map((month) => [month.month, month.result.cents])).toEqual([["2025-12", 6_789], ["2026-01", 12_345]]);
    expect(account(actuals, "706000").total.cents).toBe(19_134);
    expect(buildActuals({ ...input, source: "fec" }, ["2026-01", "2025-12"], [])).toEqual(actuals);
  });

  it("laisse intacts lignes, couverture, mois demandés et correspondances ; aucune devise ni conversion n'est ajoutée", () => {
    const input = manual();
    const months = ["2026-02", "2026-01"];
    const mappings = [{ account: "706000", row: "other-income" as const }];
    const before = JSON.stringify({ input, months, mappings });
    input.lines.forEach(Object.freeze);
    Object.freeze(input.lines); Object.freeze(input.months); Object.freeze(input.nd); Object.freeze(input);
    mappings.forEach(Object.freeze); Object.freeze(mappings); Object.freeze(months);
    const actuals = buildActuals(input, months, mappings);
    expect(JSON.stringify({ input, months, mappings })).toBe(before);
    expect(account(actuals, "706000").total.cents).toBe(100_000);
    expect(actuals).not.toHaveProperty("currency");
    expect(buildActuals(input, [], mappings)).toEqual({ months: [], accounts: [] });
  });
});
