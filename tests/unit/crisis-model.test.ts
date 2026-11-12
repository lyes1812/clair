import { describe, expect, it } from "vitest";
import { buildCrisisPosition, natureOf, isCashAccount, type CrisisLine, type RankSettings } from "@/lib/restructuring/crisis/model";
import { parseRanks, ranksFromForm } from "@/lib/restructuring/crisis/ranks";

// Cas de référence écrit à la main, société fictive, exercice ouvert le 01/01/2026, arrêté au 28/02/2026.
const line = (accountId: string, date: string, debit: number, credit: number, auxiliary: string | null = null): CrisisLine =>
  ({ accountId, accountName: `Compte fictif ${accountId}`, auxiliary, auxiliaryLabel: auxiliary ? `Tiers fictif ${auxiliary}` : null, date, debitCents: debit, creditCents: credit });
const LINES: CrisisLine[] = [
  line("512000", "2026-01-01", 5_000_000, 0),      // à-nouveau banque A : 50 000,00
  line("512000", "2026-02-10", 0, 1_234_567),      // décaissement 12 345,67 → 37 654,33
  line("512100", "2026-01-15", 0, 200_000),        // banque B à découvert : 2 000,00
  line("530000", "2026-01-01", 15_000, 0),         // caisse : 150,00
  line("401000", "2026-01-20", 0, 1_000_000, "F001"),
  line("401000", "2026-02-05", 400_000, 0, "F001"), // F001 : reste dû 6 000,00
  line("401000", "2026-02-06", 50_000, 0, "F002"),  // F002 : acompte versé 500,00 (débiteur)
  line("408000", "2026-02-28", 0, 120_000),        // factures non parvenues : 1 200,00
  line("421000", "2026-02-28", 0, 800_000),        // salaires à payer : 8 000,00
  line("431000", "2026-02-28", 0, 350_000),        // URSSAF : 3 500,00
  line("445710", "2026-02-28", 0, 240_000),        // TVA collectée : 2 400,00
  line("445660", "2026-02-28", 90_000, 0),         // TVA déductible : 900,00 (débiteur)
  line("164000", "2026-01-01", 0, 3_000_000),      // emprunt : 30 000,00
  line("519000", "2026-01-01", 0, 500_000),        // concours bancaire : 5 000,00
  line("455000", "2026-01-01", 0, 700_000),        // compte courant d'associé : 7 000,00
  line("419000", "2026-02-01", 0, 30_000),         // avance client : 300,00
  line("467000", "2026-02-01", 0, 10_000),         // créditeur divers : 100,00
  line("503000", "2026-01-01", 100_000, 0),        // VMP : 1 000,00
  line("411000", "2026-02-01", 999_900, 0),        // client : hors périmètre
  line("401000", "2026-03-01", 0, 9_999_900, "F001"), // après la date d'arrêté : ignorée
];
const RANKS: RankSettings = { staff: "superprivilege", social: "privilege", tax: "privilege", financial: "surete", banks: "surete", suppliers: "chirographaire", partners: "chirographaire", other: "chirographaire" };
const value = (lines: CrisisLine[], asOf = "2026-02-28", ranks: RankSettings | null = RANKS) => {
  const position = buildCrisisPosition(lines, asOf, ranks);
  if (position.kind !== "value") throw new Error(position.reason);
  return position;
};
const nature = (id: string, position = value(LINES)) => position.natures.find((n) => n.id === id)!;

describe("Cap 13 : position de trésorerie et dettes comptabilisées", () => {
  it("cas de référence : disponibilités 37 804,33 €, dettes 65 500,00 €, couverture −27 695,67 €", () => {
    const p = value(LINES);
    expect(p.cash.available.cents).toBe(3_780_433);
    expect(p.totalDebt.cents).toBe(6_550_000);
    expect(p.coverage.cents).toBe(-2_769_567);
    expect(p.securities.cents).toBe(100_000);
    expect(p.cash.net.cents).toBe(3_580_433); // 37 804,33 − découvert de 2 000,00
    expect(p.lineCount).toBe(18);
  });
  it("chaque nature porte la somme de ses soldes créditeurs", () => {
    const debts = Object.fromEntries(value(LINES).natures.map((n) => [n.id, n.debt.cents]));
    expect(debts).toEqual({ suppliers: 720_000, staff: 800_000, social: 350_000, tax: 240_000, financial: 3_000_000, banks: 700_000, partners: 700_000, other: 40_000 });
  });
  it("un solde débiteur n’est jamais déduit : acompte fournisseur et TVA déductible sont à part", () => {
    expect(nature("suppliers").debitBalances.cents).toBe(50_000);
    expect(nature("suppliers").debitItems.map((i) => i.auxiliary)).toEqual(["F002"]);
    expect(nature("tax").debitBalances.cents).toBe(90_000);
    expect(nature("tax").debt.cents).toBe(240_000);
  });
  it("le découvert est une dette bancaire et ne réduit pas les disponibilités", () => {
    const p = value(LINES);
    expect(p.cash.items.map((i) => [i.accountId, i.cents])).toEqual([["512000", 3_765_433], ["530000", 15_000]]);
    expect(nature("banks", p).items.map((i) => [i.accountId, i.cents])).toEqual([["519000", 500_000], ["512100", 200_000]]);
    expect(p.warnings.some((w) => w.includes("créditeur"))).toBe(true);
  });
  it("les soldes sont lus par tiers, triés du plus grand au plus petit", () => {
    expect(nature("suppliers").items.map((i) => [i.accountId, i.auxiliary, i.cents])).toEqual([["401000", "F001", 600_000], ["408000", null, 120_000]]);
  });
  it("la date d’arrêté borne la lecture", () => {
    expect(nature("suppliers", value(LINES, "2026-01-31")).debt.cents).toBe(1_000_000);
    expect(nature("suppliers", value(LINES, "2026-03-31")).debt.cents).toBe(600_000 + 9_999_900 + 120_000);
  });
  it("répartition par rang : la somme des rangs égale le total des dettes", () => {
    const ranks = value(LINES).ranks;
    if (ranks.kind !== "value") throw new Error(ranks.reason);
    expect(Object.fromEntries(ranks.totals.map((r) => [r.id, r.total.cents]))).toEqual({ superprivilege: 800_000, privilege: 590_000, surete: 3_700_000, chirographaire: 1_460_000 });
    expect(ranks.totals.reduce((sum, r) => sum + r.total.cents!, 0)).toBe(6_550_000);
  });
  it("aucun rang supposé : une nature endettée sans rang rend la répartition n.d. et la nomme", () => {
    const { suppliers: _removed, ...partial } = RANKS;
    const ranks = value(LINES, "2026-02-28", partial).ranks;
    expect(ranks.kind).toBe("nd");
    expect(ranks.kind === "nd" && ranks.reason).toContain("Fournisseurs");
    expect(value(LINES, "2026-02-28", null).ranks.kind).toBe("nd");
  });
  it("une nature sans dette n’exige pas de rang", () => {
    const only = [line("512000", "2026-01-01", 100, 0), line("421000", "2026-01-31", 0, 500)];
    const ranks = value(only, "2026-01-31", { staff: "superprivilege" }).ranks;
    expect(ranks.kind).toBe("value");
  });
  it("un montant manquant rend la nature et les totaux n.d., sans total partiel", () => {
    const broken = [...LINES, { ...line("431000", "2026-02-15", 0, 0), creditCents: null }];
    const p = value(broken);
    expect(nature("social", p).debt).toEqual({ cents: null, reason: expect.stringContaining("aucun total partiel") });
    expect(nature("staff", p).debt.cents).toBe(800_000);
    expect(p.totalDebt.cents).toBeNull();
    expect(p.coverage.cents).toBeNull();
    expect(p.ranks.kind).toBe("nd");
    expect(p.cash.available.cents).toBe(3_780_433);
  });
  it("refuse une date invalide ou une lecture vide plutôt que d’afficher zéro", () => {
    expect(buildCrisisPosition(LINES, "28/02/2026", RANKS).kind).toBe("nd");
    expect(buildCrisisPosition([line("411000", "2026-01-01", 100, 0)], "2026-02-28", RANKS).kind).toBe("nd");
    expect(buildCrisisPosition(LINES, "2025-12-31", RANKS).kind).toBe("nd");
  });
  it("signale un compte fournisseurs collectif sans auxiliaire", () => {
    const p = value([line("401000", "2026-01-10", 0, 1_000), line("512000", "2026-01-01", 10, 0)], "2026-01-31");
    expect(p.warnings.some((w) => w.includes("compte auxiliaire"))).toBe(true);
    expect(value(LINES).warnings.some((w) => w.includes("compte auxiliaire"))).toBe(false);
  });
  it("classement des comptes du plan comptable", () => {
    expect([natureOf("519000"), natureOf("419100"), natureOf("411000"), natureOf("471000"), natureOf("168800"), natureOf("601000")]).toEqual(["banks", "other", null, null, "financial", null]);
    expect([isCashAccount("512000"), isCashAccount("519000"), isCashAccount("531000"), isCashAccount("580000"), isCashAccount("503000")]).toEqual([true, false, true, false, false]);
  });
});

describe("Cap 13 : rangs choisis par l’espace", () => {
  it("lecture stricte du paramètre stocké", () => {
    expect(parseRanks({ staff: "superprivilege" })).toEqual({ staff: "superprivilege" });
    expect(parseRanks({})).toEqual({});
    expect(parseRanks({ staff: "prioritaire" })).toBeNull();
    expect(parseRanks({ clients: "privilege" })).toBeNull();
    expect(parseRanks(["privilege"])).toBeNull();
    expect(parseRanks(null)).toBeNull();
  });
  it("formulaire : un champ vide retire le rang, une valeur inconnue est refusée", () => {
    const form = new FormData();
    form.set("rank-staff", "superprivilege"); form.set("rank-suppliers", ""); form.set("rank-inconnu", "privilege");
    expect(ranksFromForm(form)).toEqual({ staff: "superprivilege" });
    form.set("rank-tax", "premier");
    expect(() => ranksFromForm(form)).toThrow("État et collectivités");
  });
});
