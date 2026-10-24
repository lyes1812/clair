import { describe, expect, it } from "vitest";
import { project } from "@/lib/budget/engine";
import { DEFAULT_CATEGORY_NATURES } from "@/lib/budget/categories";
import { monthlyGrid, type Measure, type RealSource } from "@/lib/budget/monthly";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";

// Effectifs mensuels — réel (fixture PayFit fictive) et scénario : cas écrits à la main.
const grid = (g: ReturnType<typeof monthlyGrid>) => {
  if (g.kind !== "value") throw new Error(g.reason);
  return g;
};
const row = (g: ReturnType<typeof monthlyGrid>, group: string, months: string[]) => months.map((m) => {
  const c = grid(g).cell(group, m);
  return c.kind === "value" ? c.v : c.kind;
});

describe("réel (fixture PayFit fictive, septembre 2026)", async () => {
  const { payfitFixtureBuild } = await import("./helpers/rh");
  const { kpiInput, DSN_ABSENCES } = await import("./helpers/kpi");
  const kpi = kpiInput(await payfitFixtureBuild(), DSN_ABSENCES);
  const real: RealSource = { kpi, journal: null, natures: DEFAULT_CATEGORY_NATURES, overrides: {} };
  const g = (measure: Measure, axis: Parameters<typeof monthlyGrid>[0]["axis"], overrides = {}) => monthlyGrid({ measure, axis, year: "2026", real: { ...real, overrides }, scenario: null });
  it("inscrit fin septembre : 7 contrats permanents, tous CDI ; la somme des groupes égale l'effectif du KPI", () => {
    const r = g("inscrit", "categorie");
    expect(row(r, "CDI", ["2026-09"])).toEqual([7]);
    expect(grid(r).total("2026-09")).toEqual({ kind: "value", v: 7 });
    expect(grid(r).groups).toEqual(["CDI"]);
  });
  it("ETP fin septembre : 6,10 ; contrat 008 (50 %) classé apprenti : CDI 5,60 et apprenti 0,50 ; total inchangé", () => {
    const id = kpi.data.contracts.find((c) => c.externalId.endsWith("008"))!.externalId;
    const r = g("etp", "categorie", { [id]: "apprenti" });
    expect(row(r, "CDI", ["2026-09"])).toEqual([56000]);
    expect(row(r, "Apprenti", ["2026-09"])).toEqual([5000]);
    expect(grid(r).total("2026-09")).toEqual({ kind: "value", v: 61000 });
  });
  it("mois non lus : n.d. avec la raison (jamais 0) ; axe service sans journal : n.d. ; groupe absent d'un mois connu : 0", () => {
    const r = g("inscrit", "contrat");
    expect(row(r, "CDI (contrat à durée indéterminée)", ["2026-09"]).length).toBe(1);
    expect(grid(r).months).toHaveLength(12);
    const sv = g("etp", "service");
    expect(sv.kind).toBe("nd");
    expect(sv.kind === "nd" && sv.reason).toContain("axe analytique");
  });
  it("ETP par service : un mois sans aucune ligne de paie lue est n.d. (jamais un mois à 0,00) ; la répartition ne retombe pas sur un total nul", async () => {
    const { nd, val } = await import("@/lib/budget/versions");
    const lines: LedgerLine[] = [{ key: "1", month: "2026-09", accountId: "641100", accountName: null, debitCents: 300000, creditCents: null, contractId: "C1", analytic: [{ type: "SERVICE", code: "TECH", value: "TECH" }] }];
    const journal: JournalInput = { months: ["2026-09"], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "SERVICE", lines };
    // ETP par service (cas écrit à la main) : TECH 2,13 ETP en septembre, 21,33 de référence non utilisés ici.
    const etpService = (_m: string, f: { value: string | null }) => (f.value === "TECH" ? val(21300) : nd("service inconnu"));
    const r = monthlyGrid({ measure: "etp", axis: "service", year: "2026", real: { ...real, journal, etpService }, scenario: null });
    expect(row(r, "TECH", ["2026-09"])).toEqual([21300]);
    expect(row(r, "TECH", ["2026-08", "2026-10", "2026-12"])).toEqual(["nd", "nd", "nd"]);
    const c = grid(r).total("2026-10");
    expect(c.kind).toBe("nd");
    expect(c.kind === "nd" && c.reason).toContain("aucune ligne de paie lue pour 2026-10");
    expect(grid(r).total("2026-09")).toEqual({ kind: "value", v: 21300 });
  });
  it("entrées et sorties du mois : somme des groupes = nombre d'événements comptés du KPI", async () => {
    const { monthMovements } = await import("@/lib/rh/kpi/turnover");
    for (const month of ["2026-02", "2026-09"]) {
      const mv = monthMovements(kpi, month);
      const e = grid(g("entrees", "categorie")).total(month);
      expect(e).toEqual(mv.entries.kind === "exact" ? { kind: "value", v: mv.entries.value } : expect.objectContaining({ kind: "nd" }));
    }
  });
});

describe("réel : masse salariale par service et par catégorie (journal)", () => {
  const line = (k: string, acc: string, debit: number, contractId: string | null, service: string | null): LedgerLine => ({ key: k, month: "2026-05", accountId: acc, accountName: null, debitCents: debit, creditCents: null, contractId, analytic: service ? [{ type: "SERVICE", code: service, value: service }] : [] });
  const journal: JournalInput = {
    months: ["2026-05"], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "SERVICE",
    lines: [line("1", "641100", 300000, "C1", "TECH"), line("2", "645", 120000, "C1", "TECH"), line("3", "641100", 200000, "C2", "SALES"), line("4", "6414", 10000, null, "SALES"), line("5", "421", 9, "C1", "TECH")],
  };
  it("par service : TECH 4 200 €, SALES 2 100 € ; total = masse du journal (6 300 €)", () => {
    const g = monthlyGrid({ measure: "masse", axis: "service", year: "2026", real: { kpi: null, journal, natures: DEFAULT_CATEGORY_NATURES, overrides: {} }, scenario: null });
    expect(row(g, "TECH", ["2026-05"])).toEqual([420000]);
    expect(row(g, "SALES", ["2026-05"])).toEqual([210000]);
    expect(grid(g).total("2026-05")).toEqual({ kind: "value", v: 630000 });
    expect(row(g, "TECH", ["2026-04"])).toEqual(["nd"]);
  });
  it("par catégorie sans référentiel : n.d. avec la raison", () => {
    const g = monthlyGrid({ measure: "masse", axis: "categorie", year: "2026", real: { kpi: null, journal, natures: DEFAULT_CATEGORY_NATURES, overrides: {} }, scenario: null });
    expect(g.kind === "nd" && g.reason).toContain("référentiel Collaborateurs indisponible");
  });
});

describe("scénario : mois projetés par catégorie et par service", () => {
  const contract = (key: string, over: Partial<BaseContract>): BaseContract => ({ contractKey: key, externalId: key, label: key, service: "TECH", serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, nature: "01", category: "cdi", base: { salaryCents: 300000, refBrutCents: 300000, refCotisationsCents: 120000 }, baseNd: null, ...over });
  const A = contract("A", {});
  const B = contract("B", { service: "SALES", etp4: 5000, nature: "02", category: "cdd", base: { salaryCents: 200000, refBrutCents: 200000, refCotisationsCents: 90000 } });
  const base: BaseSnapshot = { currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05", contracts: [A, B], actuals: [], refMasse: 710000, refBaseCost: 710000, etpNote: null };
  const hyps: Hypothesis[] = [
    { id: "d1", kind: "depart", label: "Départ B", contractKey: "B", lastPaidDate: "2026-11-15", exitCost: null },
    { id: "h1", kind: "embauche", label: "Stagiaire", service: "TECH", start: "2026-11-16", end: null, grossFullTimeCents: 60000, quotaBps: 10000, chargesBps: 500, counted: true, category: "stagiaire", replaces: null },
  ];
  const proj = project(base, "2026-10", "2026-12", hyps, { prorata: "calendaire" });
  const real: RealSource = { kpi: null, journal: null, natures: DEFAULT_CATEGORY_NATURES, overrides: {} };
  const g = (measure: Measure, axis: Parameters<typeof monthlyGrid>[0]["axis"]) => monthlyGrid({ measure, axis, year: "2026", real, scenario: { base, hyps, proj } });
  it("ETP par catégorie : octobre CDI 1,00 et CDD 0,50 ; novembre CDD parti (0), stagiaire 1,00 ; mois réalisés (réel non lu) n.d.", () => {
    const r = g("etp", "categorie");
    expect(row(r, "CDI", ["2026-10", "2026-11", "2026-12"])).toEqual([10000, 10000, 10000]);
    expect(row(r, "CDD", ["2026-10", "2026-11"])).toEqual([5000, 0]);
    expect(row(r, "Stagiaire", ["2026-10", "2026-11", "2026-12"])).toEqual([0, 10000, 10000]);
    expect(row(r, "CDI", ["2026-03"])).toEqual(["nd"]);
    expect(grid(r).layers.get("2026-11")).toBe("projete");
  });
  it("entrées et sorties : novembre = 1 entrée (stagiaire) et 1 sortie (CDD) ; effectif fin par service", () => {
    expect(row(g("entrees", "categorie"), "Stagiaire", ["2026-10", "2026-11"])).toEqual([0, 1]);
    expect(row(g("sorties", "categorie"), "CDD", ["2026-10", "2026-11", "2026-12"])).toEqual([0, 1, 0]);
    const sv = g("inscrit", "service");
    expect(row(sv, "TECH", ["2026-10", "2026-11"])).toEqual([1, 2]);
    expect(row(sv, "SALES", ["2026-10", "2026-11"])).toEqual([1, 0]);
  });
  it("masse par service : somme = coût du mois ; novembre TECH = 4 200 + stagiaire 15/30 × 630 = 4 515 € ; SALES = 2 900 − moitié = 1 450 €", () => {
    const r = g("masse", "service");
    expect(row(r, "TECH", ["2026-11"])).toEqual([420000 + 31500]);
    expect(row(r, "SALES", ["2026-11"])).toEqual([145000]);
    expect(grid(r).total("2026-11")).toEqual({ kind: "value", v: 420000 + 31500 + 145000 });
    expect(row(g("masse", "contrat"), "Embauche prévisionnelle", ["2026-11"])).toEqual([31500]);
  });
  it("établissement : n.d. pour les mois projetés avec la raison (non conservé dans la base du scénario)", () => {
    const r = g("etp", "etablissement");
    expect(r.kind).toBe("nd");
    expect(r.kind === "nd" && r.reason).toContain("établissement non conservé");
  });
  it("statut : A cadre dirigeant, B non (base figée) ; l'embauche prévisionnelle, sans statut connu, est « Statut n.d. »", () => {
    const withStatut = (c: BaseContract, executive: boolean | null): BaseContract => ({ ...c, executive });
    const b2: BaseSnapshot = { ...base, contracts: [withStatut(A, true), withStatut(B, false)] };
    const p2 = project(b2, "2026-10", "2026-12", hyps, { prorata: "calendaire" });
    const r = monthlyGrid({ measure: "etp", axis: "statut", year: "2026", real, scenario: { base: b2, hyps, proj: p2 } });
    expect(row(r, "Cadre dirigeant", ["2026-10", "2026-11", "2026-12"])).toEqual([10000, 10000, 10000]);
    expect(row(r, "Hors cadre dirigeant", ["2026-10", "2026-11"])).toEqual([5000, 0]);
    expect(row(r, "Statut n.d.", ["2026-10", "2026-11", "2026-12"])).toEqual([0, 10000, 10000]);
    const m = monthlyGrid({ measure: "masse", axis: "statut", year: "2026", real, scenario: { base: b2, hyps, proj: p2 } });
    expect(row(m, "Cadre dirigeant", ["2026-11"])).toEqual([420000]);
    expect(row(m, "Hors cadre dirigeant", ["2026-11"])).toEqual([145000]);
    expect(row(m, "Statut n.d.", ["2026-11"])).toEqual([31500]);
  });
});
