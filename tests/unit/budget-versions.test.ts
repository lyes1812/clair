import { describe, expect, it } from "vitest";
import { project } from "@/lib/budget/engine";
import { flowsOf } from "@/lib/budget/flows";
import { aggregate, budgetVersion, diff, monthsOfYear, nd, scenarioVersion, val } from "@/lib/budget/versions";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import type { JournalInput } from "@/lib/payroll/engine";

// Écart budgétaire : versions comparables, rubriques, agrégation et écart — cas écrits à la main.
// A : salaire 3 000 €, charges 40 % (1 200 €), TECH, 1 ETP. B : 2 000 €, 45 % (900 €), SALES, 0,5 ETP.
const contract = (key: string, over: Partial<BaseContract>): BaseContract => ({
  contractKey: key, externalId: key, label: key, service: null, serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, base: null, baseNd: null, ...over,
});
const A = contract("A", { service: "TECH", base: { salaryCents: 300000, refBrutCents: 300000, refCotisationsCents: 120000 } });
const B = contract("B", { service: "SALES", etp4: 5000, base: { salaryCents: 200000, refBrutCents: 200000, refCotisationsCents: 90000 } });
const base: BaseSnapshot = {
  currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05", contracts: [A, B], refMasse: 710000, refBaseCost: 710000, etpNote: null,
  actuals: Array.from({ length: 9 }, (_, i) => ({ month: `2026-0${i + 1}`, kind: "value" as const, brut: 500000, cotisations: 200000, masse: 700000, headcount: 2, etp4: 15000, etpNd: null })),
};
const conv = { prorata: "calendaire" as const };
const journal: JournalInput = { lines: [], months: [], openMonths: [], grid: DEFAULT_PREFIXES };
const build = (hyps: Hypothesis[], filter: { value: string | null } | null = null, j: JournalInput | null = null) =>
  scenarioVersion("s", "Révisé", "2026", base, project(base, "2026-10", "2026-12", hyps, conv), j, null, filter);
const m = (v: ReturnType<typeof build>, month: string) => v.months.get(month)!;

describe("version scénario : réel figé puis projeté, rubriques", () => {
  it("sans hypothèse : mois réels = totaux figés (ventilation n.d. avec sa raison), mois projetés = base reconduite 4 200 + 2 900 = 7 100 €", () => {
    const v = build([]);
    expect(m(v, "2026-02")).toMatchObject({ layer: "reel", masse: val(700000), brut: val(500000), charges: val(200000), etp4: val(15000), headcount: val(2) });
    expect(m(v, "2026-02").remun).toEqual(nd("journal de paie courant indisponible"));
    expect(m(v, "2026-02").entrees).toEqual(nd("référentiel Collaborateurs indisponible"));
    const oct = m(v, "2026-10");
    expect(oct).toMatchObject({ layer: "projete", masse: val(710000), brut: val(500000), remun: val(500000), primes: val(0), indemnites: val(0), autres: val(0), charges: val(210000), nonventile: val(0), etp4: val(15000), headcount: val(2) });
    expect(oct.entrees).toEqual(val(0));
    expect(oct.sorties).toEqual(val(0));
  });
  it("ponctuel brut 1 000 € + 30 % → primes ; départ de B le 15 novembre avec sortie 500 € brut + 20 % → indemnités ; masse = somme des rubriques, au centime", () => {
    const hyps: Hypothesis[] = [
      { id: "p1", kind: "ponctuel", label: "Prime", month: "2026-11", amount: { mode: "brut", brutCents: 100000, chargesBps: 3000 }, service: null },
      { id: "d1", kind: "depart", label: "Départ B", contractKey: "B", lastPaidDate: "2026-11-15", exitCost: { mode: "brut", brutCents: 50000, chargesBps: 2000 } },
    ];
    const nov = m(build(hyps), "2026-11");
    // A : 3 000 + 1 200 ; B : 2 000 + 900 − (1/2) = 1 000 + 450 ; prime 1 000 + 300 ; sortie 500 + 100.
    expect(nov).toMatchObject({ remun: val(400000), primes: val(100000), indemnites: val(50000), autres: val(0), charges: val(120000 + 45000 + 30000 + 10000), nonventile: val(0) });
    expect(nov.masse).toEqual(val(400000 + 100000 + 50000 + 205000));
    expect(nov.brut).toEqual(val(550000));
    // Sorties : B n'est plus présent fin novembre ; entrées : aucune.
    expect(nov.sorties).toEqual(val(1));
    expect(nov.entrees).toEqual(val(0));
    expect(nov.headcount).toEqual(val(1));
  });
  it("enveloppes : rubrique « Primes » (libellé PayFit) → primes ; rubrique libre et enveloppe de service → autres ; coût chargé → non ventilé et brut n.d.", () => {
    const env = (id: string, axis: "service" | "rubrique", target: string, chargesBps: number | null): Hypothesis => ({ id, kind: "enveloppe", label: `Enveloppe ${target}`, axis, target, monthly: { "2026-12": 100000 }, chargesBps });
    const dec = m(build([env("e1", "rubrique", "primes", 4000), env("e2", "rubrique", "Heures supplémentaires", 4000), env("e3", "service", "TECH", 4000)], null, journal), "2026-12");
    expect(dec).toMatchObject({ primes: val(100000), autres: val(200000), remun: val(500000), charges: val(210000 + 3 * 40000), nonventile: val(0) });
    expect(dec.free).toEqual({ "Heures supplémentaires": 100000, "service TECH": 100000 });
    expect(dec.masse).toEqual(val(710000 + 3 * 140000));
    const nv = m(build([env("e4", "rubrique", "Primes", null)]), "2026-12");
    expect(nv).toMatchObject({ masse: val(710000 + 100000), nonventile: val(100000), primes: val(0) });
    expect(nv.brut).toEqual(nd("coûts chargés saisis sans brut ni charges (non ventilés)"));
    expect(nv.charges).toEqual(nd("coûts chargés saisis sans brut ni charges (non ventilés)"));
  });
  it("filtre service TECH : seul A (4 200 €), effectif 1, ETP 1,00 ; mois réels non filtrables (n.d. avec raison)", () => {
    const v = build([], { value: "TECH" });
    expect(m(v, "2026-10")).toMatchObject({ masse: val(420000), headcount: val(1), etp4: val(10000), remun: val(300000), charges: val(120000) });
    expect(m(v, "2026-03").masse).toEqual(nd("service TECH : journal de paie courant indisponible"));
    expect(m(v, "2026-03").headcount).toEqual(nd("référentiel Collaborateurs indisponible"));
  });
  it("mois hors horizon : n.d. avec la raison, jamais 0", () => {
    const v = scenarioVersion("s", "Révisé", "2027", base, project(base, "2026-10", "2026-12", [], conv), null, null, null);
    expect(v.months.get("2027-03")!.masse).toEqual(nd("mois 2027-03 hors de l'horizon du scénario"));
  });
});

describe("agrégation d'une période et écart", () => {
  const v = build([]);
  it("année 2026 : masse = 9 × 7 000 + 3 × 7 100 = 84 300 € ; ETP moyen = 12 × 1,50 ÷ 12 ; entrées et sorties n.d. (réel sans référentiel) ; effectif fin décembre", () => {
    const all = monthsOfYear("2026", "01", "12");
    expect(aggregate(v, all, "masse")).toEqual({ kind: "value", num: 9 * 700000 + 3 * 710000, den: 1 });
    expect(aggregate(v, all, "etp")).toEqual({ kind: "value", num: 12 * 15000, den: 120000 });
    expect(aggregate(v, all, "headcount")).toEqual({ kind: "value", num: 2, den: 1 });
    expect(aggregate(v, all, "entrees").kind).toBe("nd");
    // période projetée seule : entrées et sorties connues (0)
    expect(aggregate(v, monthsOfYear("2026", "10", "12"), "entrees")).toEqual({ kind: "value", num: 0, den: 1 });
    // rubrique sans objet pour le réel : sans objet sur la période réelle, n.d. si la ventilation manque
    expect(aggregate(v, monthsOfYear("2026", "01", "03"), "autres")).toEqual({ kind: "na" });
    expect(aggregate(v, monthsOfYear("2026", "01", "03"), "remun").kind).toBe("nd");
  });
  it("écart : b − a et % de a ; base nulle : % non défini ; une rubrique n.d. d'un côté rend l'écart n.d. ; période de longueur différente refusée", () => {
    const a = aggregate(v, monthsOfYear("2026", "10", "12"), "masse");
    const b = aggregate(build([{ id: "p", kind: "ponctuel", label: "Prime", month: "2026-12", amount: { mode: "charge", costCents: 71000 }, service: null }]), monthsOfYear("2026", "10", "12"), "masse");
    // a = 3 × 7 100 = 21 300 € ; b = 21 300 + 710 = 22 010 € → +710,00 € soit 3,33 % (71 000 ÷ 2 130 000).
    expect(diff(a, b)).toEqual({ kind: "value", num: 71000, den: 1, pct: { num: 71000, den: 2130000 } });
    expect(diff({ kind: "value", num: 0, den: 1 }, { kind: "value", num: 5, den: 1 })).toEqual({ kind: "value", num: 5, den: 1, pct: null });
    expect(diff({ kind: "nd", reason: "x" }, b)).toEqual({ kind: "nd", reason: "x" });
    expect(diff({ kind: "na" }, b)).toEqual({ kind: "na" });
    expect(diff({ kind: "value", num: 1, den: 12 }, { kind: "value", num: 1, den: 6 })).toEqual({ kind: "nd", reason: "périodes de longueur différente" });
  });
  it("budget saisi : seule la masse est connue ; mois non saisi n.d. ; entrées, sorties et ETP n.d. avec leur raison", () => {
    const bv = budgetVersion("b", "Budget 2026", "2026", { "2026-01": 700000, "2026-02": null });
    expect(aggregate(bv, ["2026-01"], "masse")).toEqual({ kind: "value", num: 700000, den: 1 });
    expect(aggregate(bv, ["2026-01"], "etp")).toEqual({ kind: "nd", reason: "2026-01 : budget saisi sans ETP" });
    expect(aggregate(bv, ["2026-01", "2026-02"], "masse")).toEqual({ kind: "nd", reason: "2026-02 : montant du budget non saisi" });
    expect(aggregate(bv, ["2026-01"], "brut").kind).toBe("nd");
  });
});

describe("entrées et sorties d'un scénario", () => {
  it("départ de B le 15 novembre et embauche le 16 : novembre = 1 entrée et 1 sortie ; octobre sans mouvement ; début + entrées − sorties = fin", () => {
    const hyps: Hypothesis[] = [
      { id: "d1", kind: "depart", label: "Départ B", contractKey: "B", lastPaidDate: "2026-11-15", exitCost: null },
      { id: "h1", kind: "embauche", label: "Remplaçant", service: "SALES", start: "2026-11-16", end: null, grossFullTimeCents: 300000, quotaBps: 10000, chargesBps: 4000, counted: true, category: "cdi", replaces: "d1" },
    ];
    const flows = flowsOf(base, project(base, "2026-10", "2026-12", hyps, conv));
    const get = (month: string) => flows.find((f) => f.month === month)!;
    expect(get("2026-10")).toMatchObject({ kind: "value", entrees: [], sorties: [] });
    expect(get("2026-11")).toMatchObject({ kind: "value", entrees: ["embauche:h1"], sorties: ["B"], start: ["A", "B"], end: ["A", "embauche:h1"] });
    for (const f of flows) if (f.kind === "value") expect(f.start.length + f.entrees.length - f.sorties.length).toBe(f.end.length);
  });
});
