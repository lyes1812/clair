import { describe, expect, it } from "vitest";
import { monthRange } from "@/lib/connectors/months";
import { createPayFitClient, readPayFit } from "@/lib/connectors/payfit/client";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";
import { costPerEtp, evolution, monthPayroll, NO_TYPE, serviceOf, servicesOf, shiftYear, windowPayroll, withService, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import type { DsnMonth } from "@/lib/payroll/dsn";
import { classify, DEFAULT_PREFIXES, gridRubrics, parseGrid } from "@/lib/payroll/grid";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { rawPayfitHistory } from "@/lib/rh/raw-history";
import { fixtureAbsences, kpiInput } from "./helpers/kpi";
import { payfitFixtureBuild } from "./helpers/rh";

let n = 0;
const line = (month: string, accountId: string, debit: number | null, credit: number | null, contractId: string | null = null): LedgerLine => ({
  key: `${month}#${String(n++).padStart(5, "0")}`,
  month,
  accountId,
  accountName: `Compte ${accountId}`,
  debitCents: debit,
  creditCents: credit,
  contractId,
});
const journal = (lines: LedgerLine[], months: string[], openMonths: string[] = []): JournalInput => ({ lines, months, openMonths, grid: DEFAULT_PREFIXES });

describe("grille de comptes", () => {
  const rubrics = gridRubrics(DEFAULT_PREFIXES);
  it("classe par le préfixe le plus long ; 63/64 sans rubrique « non classé » ; tiers et produits en contrepartie", () => {
    const id = (a: string) => {
      const c = classify(a, rubrics);
      return c.rubric ? c.rubric.id : c.payroll ? "non-classe" : "contrepartie";
    };
    expect(id("641100")).toBe("salaires");
    expect(id("641300")).toBe("primes");
    expect(id("6413700")).toBe("stages");
    expect(id("641200")).toBe("provisions-cp");
    expect(id("641400")).toBe("indemnites");
    expect(id("645300")).toBe("cotisations");
    expect(id("647600")).toBe("autres-charges");
    expect(id("631100")).toBe("taxes");
    expect(rubrics.find((r) => r.id === "taxes")!.role).toBe("cotisations");
    expect(id("649000")).toBe("non-classe");
    expect(id("421000")).toBe("contrepartie");
    expect(id("758000")).toBe("contrepartie");
  });
  it("paramètre lisible seulement si chaque préfixe est numérique et dans une seule rubrique", () => {
    expect(parseGrid(DEFAULT_PREFIXES)).toEqual(DEFAULT_PREFIXES);
    expect(parseGrid({ ...DEFAULT_PREFIXES, primes: ["641"] })).toBeNull();
    expect(parseGrid({ ...DEFAULT_PREFIXES, primes: ["64A"] })).toBeNull();
    expect(parseGrid({ ...DEFAULT_PREFIXES, primes: undefined })).toBeNull();
    expect(parseGrid({ ...DEFAULT_PREFIXES, primes: [" 6413 ", "6413"] })?.primes).toEqual(["6413"]);
  });
});

describe("masse salariale d'un mois (cas écrits à la main)", () => {
  // Janvier 2026 : salaires 3 000,00 €, prime 500,00 €, cotisations 1 200,00 € moins une régularisation de 20,00 €,
  // provision de congés payés 100,00 € (hors masse), compte 649 non classé 15,00 €, contreparties 421/431 ignorées.
  const lines = [
    line("2026-01", "641100", 300000, null, "C1"),
    line("2026-01", "641300", 50000, null, "C1"),
    line("2026-01", "645100", 120000, null, "C1"),
    line("2026-01", "645100", null, 2000, "C1"),
    line("2026-01", "641200", 10000, null),
    line("2026-01", "649000", 1500, null),
    line("2026-01", "421000", null, 350000, "C1"),
    line("2026-01", "431000", null, 118000, "C1"),
  ];
  const input = journal(lines, ["2026-01", "2026-02", "2026-03"], ["2026-03"]);
  it("brut 3 500,00 € (dont primes 500,00 €), cotisations 1 180,00 €, masse chargée 4 680,00 €", () => {
    const m = monthPayroll(input, "2026-01");
    expect(m).toMatchObject({ kind: "value", brut: 350000, cotisations: 118000, masse: 468000, open: false });
    if (m.kind === "value") {
      expect(m.byRubric).toMatchObject({ salaires: 300000, primes: 50000, cotisations: 118000, "provisions-cp": 10000 });
      expect(m.unclassified.map((a) => [a.accountId, a.balanceCents])).toEqual([["649000", 1500]]);
      expect(m.accounts.find((a) => a.accountId === "645100")).toMatchObject({ debitCents: 120000, creditCents: 2000, balanceCents: 118000, lines: 2 });
      expect(m.accounts.some((a) => a.accountId === "421000")).toBe(false);
    }
  });
  it("mois lu sans journal, mois hors lecture, ligne sans montant : n.d. avec raison, jamais zéro", () => {
    expect(monthPayroll(input, "2026-02")).toMatchObject({ kind: "nd", nd: { code: "no-journal" } });
    expect(monthPayroll(input, "2026-04")).toMatchObject({ kind: "nd", nd: { code: "not-read" } });
    const broken = journal([line("2026-01", "641100", null, null)], ["2026-01"]);
    expect(monthPayroll(broken, "2026-01")).toMatchObject({ kind: "nd", nd: { code: "amount-missing" } });
    // Une contrepartie sans montant n'empêche pas le calcul.
    expect(monthPayroll(journal([line("2026-01", "641100", 1000, null), line("2026-01", "421000", null, null)], ["2026-01"]), "2026-01")).toMatchObject({ kind: "value", masse: 1000 });
  });
  it("paie non clôturée : montants affichés et signalés provisoires", () => {
    const i = journal([line("2026-03", "641100", 1000, null)], ["2026-03"], ["2026-03"]);
    expect(monthPayroll(i, "2026-03")).toMatchObject({ kind: "value", open: true, masse: 1000 });
    expect(windowPayroll(i, ["2026-03"])).toMatchObject({ kind: "value", openMonths: ["2026-03"] });
  });
});

describe("période, N-1 et coût par ETP-mois (cas écrits à la main)", () => {
  // N : janvier 4 000,00 €, février 6 000,00 € ; N-1 : janvier 3 000,00 €, février 5 000,00 €.
  const input = journal(
    [line("2025-01", "641100", 300000, null), line("2025-02", "641100", 500000, null), line("2026-01", "641100", 400000, null), line("2026-02", "641100", 600000, null)],
    ["2025-01", "2025-02", "2025-03", "2026-01", "2026-02", "2026-03"],
  );
  const cur = windowPayroll(input, ["2026-01", "2026-02"]);
  const prev = windowPayroll(input, ["2026-01", "2026-02"].map((m) => shiftYear(m, -1)));
  it("10 000,00 € contre 8 000,00 € : +2 000,00 €, soit 2 000/8 000 = +25 %", () => {
    expect(cur).toMatchObject({ kind: "value", masse: 1000000 });
    expect(prev).toMatchObject({ kind: "value", masse: 800000 });
    expect(evolution(cur, prev, (w) => w.masse)).toEqual({ kind: "value", deltaCents: 200000, ratio: { num: 200000, den: 800000 } });
  });
  it("N-1 nul : l'écart en euros reste affiché, le % est non défini", () => {
    const z = journal([line("2025-01", "641100", 0, null), line("2026-01", "641100", 1000, null)], ["2025-01", "2026-01"]);
    expect(evolution(windowPayroll(z, ["2026-01"]), windowPayroll(z, ["2025-01"]), (w) => w.masse)).toEqual({ kind: "value", deltaCents: 1000, ratio: null });
  });
  it("un mois n.d. dans la période ou dans N-1 : total et évolution n.d., mois nommé", () => {
    const withMarch = windowPayroll(input, ["2026-01", "2026-02", "2026-03"]);
    expect(withMarch).toMatchObject({ kind: "nd", nd: { code: "month-nd", months: ["2026-03"] } });
    expect(evolution(cur, windowPayroll(input, ["2025-02", "2025-03"]), (w) => w.masse)).toMatchObject({ kind: "nd" });
  });
  it("coût par ETP-mois : 10 000,00 € ÷ (2,0 + 3,0) ETP-mois = 2 000,00 € ; un ETP n.d. rend le coût n.d.", () => {
    expect(costPerEtp(cur, [{ month: "2026-01", etp4: 20000, reason: null }, { month: "2026-02", etp4: 30000, reason: null }])).toEqual({ kind: "value", costCents: { num: 1000000 * 10000, den: 50000 }, etpMonths4: 50000 });
    expect(costPerEtp(cur, [{ month: "2026-01", etp4: 20000, reason: null }, { month: "2026-02", etp4: null, reason: "x" }])).toMatchObject({ kind: "nd", nd: { code: "etp-nd", months: ["2026-02"] } });
  });
});

describe("journal PayFit fictif (profil A, photographie 1) : totaux recalculés à la main depuis la fixture", async () => {
  const months = monthRange("2024-10", "2026-09");
  const read = await readPayFit(createPayFitClient("fixture-A-1", { fetchImpl: createFixtureFetch("fixture-A-1"), minIntervalMs: 0 }), months);
  const lines: LedgerLine[] = read.records
    .filter((r) => r.collection === "ledger_lines")
    .map((r) => ({ key: r.key, month: String(r.data.month), accountId: String(r.data.accountId), accountName: (r.data.accountName as string) ?? null, debitCents: r.data.debitCents as number | null, creditCents: r.data.creditCents as number | null, contractId: (r.data.contractId as string) ?? null, analytic: r.data.analyticCodes as never }));
  const input = journal(lines, months);
  const range = (from: string, to: string) => monthRange(from, to);
  it("octobre 2024 : brut 13 840,00 €, cotisations 4 390,00 €, masse 18 230,00 € (6 contrats)", () => {
    expect(monthPayroll(input, "2024-10")).toMatchObject({ kind: "value", brut: 1384000, cotisations: 439000, masse: 1823000 });
  });
  it("janvier → septembre 2025 : brut 132 760,00 €, cotisations 41 110,00 €, masse 173 870,00 €", () => {
    // Brut : 3 × 13 840 + 2 × 16 080 + 13 080 (001 à 0 en juin) + 13 840 (002 sans montant en juillet : pas de ligne) + 2 × 16 080.
    expect(windowPayroll(input, range("2025-01", "2025-09"))).toMatchObject({ kind: "value", brut: 13276000, cotisations: 4111000, masse: 17387000 });
  });
  it("janvier → septembre 2026 : masse 211 260,00 €, soit +37 390,00 € et 3 739 000/17 387 000 vs 2025", () => {
    // Brut : 14 830 (janvier) + 14 830 (février, 004 sans montant) + 7 × 18 730 ; cotisations : 4 700 + 4 700 + 7 × 5 870.
    const cur = windowPayroll(input, range("2026-01", "2026-09"));
    expect(cur).toMatchObject({ kind: "value", brut: 16077000, cotisations: 5049000, masse: 21126000 });
    expect(evolution(cur, windowPayroll(input, range("2025-01", "2025-09")), (w) => w.masse)).toEqual({ kind: "value", deltaCents: 3739000, ratio: { num: 3739000, den: 17387000 } });
  });
  it("coût par ETP-mois 2026 : 211 260,00 € ÷ 53,90 ETP-mois (5,10 en janvier, 6,10 ensuite) ; 2025 : 173 870,00 € ÷ 48,00", async () => {
    const kpi = kpiInput(rawPayfitHistory(await payfitFixtureBuild()), await fixtureAbsences()); // historique brut, comme l'écran par défaut
    const etp = (ms: string[]) => ms.map((m) => {
      const e = etpMonthEnd(kpi, m);
      return { month: m, etp4: e.kind === "exact" ? e.etp4 : null, reason: null };
    });
    expect(costPerEtp(windowPayroll(input, range("2026-01", "2026-09")), etp(range("2026-01", "2026-09")))).toEqual({ kind: "value", costCents: { num: 21126000 * 10000, den: 539000 }, etpMonths4: 539000 });
    expect(costPerEtp(windowPayroll(input, range("2025-01", "2025-09")), etp(range("2025-01", "2025-09")))).toMatchObject({ kind: "value", etpMonths4: 480000 });
  });
});

describe("services : code analytique du journal (cas écrits à la main)", () => {
  const withCode = (l: LedgerLine, type: string | null, code: string | null): LedgerLine => ({ ...l, analytic: [{ type, code, value: null }] });
  it("service d'une ligne : code de l'axe choisi ; axe sans type ; ligne sans code = non ventilé", () => {
    expect(serviceOf(withCode(line("2026-01", "641100", 1, null), "Service", "TECH"), "Service")).toBe("TECH");
    expect(serviceOf(withCode(line("2026-01", "641100", 1, null), null, "TECH"), NO_TYPE)).toBe("TECH");
    expect(serviceOf(line("2026-01", "641100", 1, null), "Service")).toBeNull();
  });
  it("filtre par service : le mois reste lu (0 si le service n'a pas de ligne) et la somme des services égale le total", () => {
    const input = { ...journal([withCode(line("2026-01", "641100", 1000, null, "C1"), "S", "TECH"), withCode(line("2026-01", "645100", 400, null, "C1"), "S", "TECH"), line("2026-01", "641100", 500, null, "C2")], ["2026-01"]), serviceAxis: "S" };
    expect(servicesOf(input, ["2026-01"])).toEqual(["TECH", null]);
    // Une contrepartie (421) sans code n'ouvre pas de service « non ventilé » ; un code vide prend le libellé.
    const cp = { ...input, lines: [...input.lines.slice(0, 2), line("2026-01", "421000", null, 1400, "C1")] };
    expect(servicesOf(cp, ["2026-01"])).toEqual(["TECH"]);
    expect(serviceOf({ ...line("2026-01", "641100", 1, null), analytic: [{ type: "S", code: "", value: "Tech" }] }, "S")).toBe("Tech");
    expect(monthPayroll(withService(input, "TECH"), "2026-01")).toMatchObject({ kind: "value", masse: 1400, paidContracts: ["C1"] });
    expect(monthPayroll(withService(input, null), "2026-01")).toMatchObject({ kind: "value", masse: 500, paidContracts: ["C2"] });
    expect(monthPayroll(withService(input, "DON"), "2026-01")).toMatchObject({ kind: "value", masse: 0 });
    expect(monthPayroll(input, "2026-01")).toMatchObject({ kind: "value", masse: 1900 });
  });
});

describe("services sur le journal PayFit fictif (Service fictif A : 003, 006 ; B : 001, 004, 007 ; C : 002, 005, 008)", async () => {
  const months = monthRange("2024-10", "2026-09");
  const read = await readPayFit(createPayFitClient("fixture-A-1", { fetchImpl: createFixtureFetch("fixture-A-1"), minIntervalMs: 0 }), months);
  const lines: LedgerLine[] = read.records
    .filter((r) => r.collection === "ledger_lines")
    .map((r) => ({ key: r.key, month: String(r.data.month), accountId: String(r.data.accountId), accountName: null, debitCents: r.data.debitCents as number | null, creditCents: r.data.creditCents as number | null, contractId: (r.data.contractId as string) ?? null, analytic: r.data.analyticCodes as never }));
  const input = { ...journal(lines, months), serviceAxis: "Service" };
  const masse = (svc: string, from: string, to: string) => {
    const w = windowPayroll(withService(input, svc), monthRange(from, to));
    return w.kind === "value" ? w.masse : null;
  };
  it("2026 (janv.–sept.) : A 37 800 € (006), B 98 490 € (001, 004 de mars, 007), C 74 970 € (002, 005, 008) ; total 211 260 €", () => {
    expect(masse("TEST-SVC-A", "2026-01", "2026-09")).toBe(3780000);
    expect(masse("TEST-SVC-B", "2026-01", "2026-09")).toBe(9849000);
    expect(masse("TEST-SVC-C", "2026-01", "2026-09")).toBe(7497000);
    expect(servicesOf(input, monthRange("2026-01", "2026-09"))).toEqual(["TEST-SVC-A", "TEST-SVC-B", "TEST-SVC-C"]);
  });
  it("2025 (janv.–sept.) : A 51 300 €, B 58 800 € (001 à zéro en juin), C 63 770 € (002 d'avril, sans juillet) ; B : 25 personnes-mois en 2026", () => {
    expect(masse("TEST-SVC-A", "2025-01", "2025-09")).toBe(5130000);
    expect(masse("TEST-SVC-B", "2025-01", "2025-09")).toBe(5880000);
    expect(masse("TEST-SVC-C", "2025-01", "2025-09")).toBe(6377000);
    expect(windowPayroll(withService(input, "TEST-SVC-B"), monthRange("2026-01", "2026-09"))).toMatchObject({ kind: "value", paidContractMonths: 25 });
  });
});

describe("source DSN : brut déclaré (type 001) d'une période (cas écrits à la main)", async () => {
  const { dsnBrutWindow } = await import("@/lib/payroll/dsn");
  const m = (month: string, status: "complete" | "incomplete" | "blocked", byType: Record<string, number>): [string, DsnMonth] => [month, { month, status, sirets: ["S1"], byType, messages: [] }];
  const dsn = new Map([m("2026-01", "complete", { "001": 300000, "002": 280000 }), m("2026-02", "incomplete", { "001": 250000 }), m("2026-03", "blocked", { "001": 1 }), m("2026-04", "complete", { "002": 10 })]);
  it("janvier + février = 5 500,00 € (type 002 jamais additionné) ; février incomplet signalé", () => {
    expect(dsnBrutWindow(dsn, ["2026-01", "2026-02"])).toEqual({ kind: "value", brutCents: 550000, incompleteMonths: ["2026-02"] });
  });
  it("mois bloqué, sans type 001 ou non déposé : n.d. avec le mois nommé, jamais zéro", () => {
    expect(dsnBrutWindow(dsn, ["2026-01", "2026-03"])).toMatchObject({ kind: "nd", months: ["2026-03"] });
    expect(dsnBrutWindow(dsn, ["2026-04"])).toMatchObject({ kind: "nd", months: ["2026-04"], reason: expect.stringContaining("type 001") });
    expect(dsnBrutWindow(dsn, ["2026-05"])).toMatchObject({ kind: "nd", months: ["2026-05"] });
  });
});
