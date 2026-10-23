import { describe, expect, it } from "vitest";
import { project } from "@/lib/budget/engine";
import { HORS_SALARIE, zoomOf } from "@/lib/budget/zoom";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";

// Détail individuel d'un écart : valeurs par salarié et par rubrique — cas écrits à la main.
const line = (key: string, accountId: string, debit: number, contractId: string | null, service: string | null = null): LedgerLine => ({
  key, month: "2026-05", accountId, accountName: null, debitCents: debit, creditCents: null, contractId, analytic: service ? [{ type: "SERVICE", code: service, value: service }] : [],
});
const journal: JournalInput = {
  months: ["2026-05"], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "SERVICE",
  lines: [
    line("1", "641100", 300000, "C1", "TECH"), line("2", "6413", 50000, "C1", "TECH"), line("3", "645", 120000, "C1", "TECH"),
    line("4", "641100", 200000, "C2", "SALES"), line("5", "645", 90000, "C2", "SALES"),
    line("6", "6414", 10000, null, "SALES"),
    line("7", "421", 999999, "C1", "TECH"), // contrepartie : hors masse
  ],
};
const get = (z: ReturnType<typeof zoomOf>) => {
  if (z.kind !== "value") throw new Error(z.reason);
  return Object.fromEntries([...z.byKey].sort(([a], [b]) => a.localeCompare(b)));
};
const reel = (filter: { value: string | null } | null = null) => ({ kind: "reel" as const, journal, filter });

describe("détail par salarié, réel (journal de paie)", () => {
  it("masse : C1 3 000 + 500 + 1 200 = 4 700 €, C2 2 000 + 900 = 2 900 €, ligne sans contrat 100 € ; la contrepartie 421 est hors masse", () => {
    expect(get(zoomOf(reel(), ["2026-05"], "masse"))).toEqual({ C1: 470000, C2: 290000, [HORS_SALARIE]: 10000 });
  });
  it("brut, rémunération de base, primes, indemnités et charges séparés", () => {
    expect(get(zoomOf(reel(), ["2026-05"], "brut"))).toEqual({ C1: 350000, C2: 200000, [HORS_SALARIE]: 10000 });
    expect(get(zoomOf(reel(), ["2026-05"], "remun"))).toEqual({ C1: 300000, C2: 200000 });
    expect(get(zoomOf(reel(), ["2026-05"], "primes"))).toEqual({ C1: 50000 });
    expect(get(zoomOf(reel(), ["2026-05"], "indemnites"))).toEqual({ [HORS_SALARIE]: 10000 });
    expect(get(zoomOf(reel(), ["2026-05"], "charges"))).toEqual({ C1: 120000, C2: 90000 });
  });
  it("filtre service TECH : C1 seulement", () => {
    expect(get(zoomOf(reel({ value: "TECH" }), ["2026-05"], "masse"))).toEqual({ C1: 470000 });
  });
  it("mois non lu : n.d. avec la raison ; budget : aucun détail", () => {
    const z = zoomOf(reel(), ["2026-06"], "masse");
    expect(z.kind).toBe("nd");
    expect(z.kind === "nd" && z.reason).toContain("2026-06");
    expect(zoomOf({ kind: "budget" }, ["2026-05"], "masse")).toEqual({ kind: "nd", reason: "budget saisi : montant global seulement, aucun détail par salarié" });
  });
});

describe("détail par salarié, scénario", () => {
  const A: BaseContract = { contractKey: "payfit:A", externalId: "A", label: "A", service: "TECH", serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, base: { salaryCents: 300000, refBrutCents: 300000, refCotisationsCents: 120000 }, baseNd: null };
  const base: BaseSnapshot = { currency: "EUR", refMonth: "2026-05", syncId: "s", readAt: "2026-06-05", contracts: [A], actuals: [{ month: "2026-05", kind: "value", brut: 360000, cotisations: 210000, masse: 570000, headcount: 1, etp4: 10000, etpNd: null }], refMasse: 570000, refBaseCost: 420000, etpNote: null };
  const proj = (hyps: Hypothesis[]) => project(base, "2026-06", "2026-07", hyps, { prorata: "calendaire" });
  const prime: Hypothesis = { id: "p1", kind: "ponctuel", label: "Prime A", month: "2026-07", amount: { mode: "brut", brutCents: 100000, chargesBps: 3000 }, service: null, contractKey: "payfit:A" };
  it("mois projetés : A = 4 200 € de base par mois, la prime ciblée sur A est à son nom (identifiant externe), une enveloppe sans salarié est « hors salarié »", () => {
    const env: Hypothesis = { id: "e1", kind: "enveloppe", label: "Enveloppe primes", axis: "rubrique", target: "Primes", monthly: { "2026-07": 20000 }, chargesBps: 0 };
    const src = { kind: "scenario" as const, base, proj: proj([prime, env]), journal: null, filter: null };
    expect(get(zoomOf(src, ["2026-06", "2026-07"], "masse"))).toEqual({ A: 420000 * 2 + 130000, [HORS_SALARIE]: 20000 });
    // « Primes » n'est rattachée à la rubrique PayFit qu'avec la grille du journal : sans journal l'enveloppe est dans « autres », pas dans les primes
    expect(get(zoomOf(src, ["2026-06", "2026-07"], "primes"))).toEqual({ A: 100000 });
    expect(get(zoomOf({ ...src, journal }, ["2026-06", "2026-07"], "primes"))).toEqual({ A: 100000, [HORS_SALARIE]: 20000 });
  });
  it("mois réalisé figé : détail du journal courant seulement s'il redonne le même total ; sinon n.d. avec la raison", () => {
    const frozen = { kind: "scenario" as const, base: { ...base, actuals: [{ month: "2026-05", kind: "value" as const, brut: 560000, cotisations: 210000, masse: 770000, headcount: 1, etp4: 10000, etpNd: null }] }, proj: proj([]), journal, filter: null };
    // brut du journal = 3 000 + 500 + 2 000 + 100 = 5 600 €, cotisations 1 200 + 900 = 2 100 € → masse 7 700 € : identique au réel figé
    expect(get(zoomOf(frozen, ["2026-05"], "masse"))).toEqual({ C1: 470000, C2: 290000, [HORS_SALARIE]: 10000 });
    const changed = zoomOf({ ...frozen, base: { ...frozen.base, actuals: [{ ...frozen.base.actuals[0], masse: 1 } as never] } }, ["2026-05"], "masse");
    expect(changed).toEqual({ kind: "nd", reason: "2026-05 : lecture PayFit modifiée depuis la création du scénario, détail courant différent du réel figé" });
  });
  it("coût chargé saisi sans brut ni charges : non ventilable par rubrique (n.d.), mais compté dans la masse", () => {
    const env: Hypothesis = { id: "e2", kind: "enveloppe", label: "Enveloppe X", axis: "service", target: "TECH", monthly: { "2026-06": 5000 }, chargesBps: null };
    const src = { kind: "scenario" as const, base, proj: proj([env]), journal: null, filter: null };
    expect(get(zoomOf(src, ["2026-06"], "masse"))).toEqual({ A: 420000, [HORS_SALARIE]: 5000 });
    expect(zoomOf(src, ["2026-06"], "brut")).toEqual({ kind: "nd", reason: "2026-06 : « Enveloppe X » saisi en coût chargé sans brut ni charges : non ventilable par rubrique" });
  });
});
