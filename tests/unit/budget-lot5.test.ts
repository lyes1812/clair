import { describe, expect, it } from "vitest";
import { hireKey, project } from "@/lib/budget/engine";
import type { BaseContract, BaseSnapshot, Hypothesis, ProjectedMonth } from "@/lib/budget/types";

// Lot 5 — enveloppes, constantes, changements de service ou de quotité, présents en fin de mois : cas écrits à la main.
// A : salaire 3 000,00 €, cotisations 1 200,00 € (taux 40 %), temps plein, TECH. B : 2 000,00 €, 45 %, mi-temps, SALES.
const contract = (key: string, over: Partial<BaseContract>): BaseContract => ({
  contractKey: key, externalId: key, label: key, service: null, serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, base: null, baseNd: null, ...over,
});
const A = contract("A", { service: "TECH", base: { salaryCents: 300000, refBrutCents: 300000, refCotisationsCents: 120000 } });
const B = contract("B", { service: "SALES", etp4: 5000, base: { salaryCents: 200000, refBrutCents: 200000, refCotisationsCents: 90000 } });
const mk = (...contracts: BaseContract[]): BaseSnapshot => ({ currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05", contracts, actuals: [], refMasse: 0, refBaseCost: null, etpNote: null });
const conv = { prorata: "calendaire" as const };
type Val = Extract<ProjectedMonth, { kind: "value" }>;
const run = (base: BaseSnapshot, hyps: Hypothesis[]) => project(base, "2026-10", "2026-12", hyps, conv);
const month = (p: ReturnType<typeof run>, m: string): Val => {
  if (p.kind !== "value") throw new Error(p.errors.join(" ; "));
  return p.months.find((x) => x.month === m) as Val;
};
const lines = (pm: Val, id: string) => pm.contributions.filter((c) => c.hypothesisId === id);
const chg = (over: Partial<Extract<Hypothesis, { kind: "changement" }>>): Hypothesis => ({ id: "c1", kind: "changement", label: "Changement", contractKey: "A", from: "2026-11", ...over });

describe("changement de quotité", () => {
  it("A passe de 100 % à 80 % le 1er novembre : salaire 3 000 → 2 400 €, charges 1 200 → 960 € ; ligne « quotité » −840,00 € ; ETP 1,50 → 1,30", () => {
    const p = run(mk(A, B), [chg({ quotaBps: 8000, label: "Passage à 80 %" })]);
    expect(month(p, "2026-10")).toMatchObject({ cost: 710000, etp4: 15000 });
    const nov = month(p, "2026-11");
    expect(lines(nov, "c1")).toEqual([expect.objectContaining({ kind: "quotite", label: "Passage à 80 %", brut: -60000, charges: -24000, cost: -84000, contractKey: "A" })]);
    expect(nov).toMatchObject({ brut: 440000, charges: 186000, cost: 626000, headcount: 2, etp4: 13000 });
    expect(month(p, "2026-12").cost).toBe(626000);
  });
  it("combiné à un départ le 15 novembre (15/30) : 3 360 € × 15/30 = 1 680,00 € pour A, réductions successives qui se somment", () => {
    const dep: Hypothesis = { id: "d1", kind: "depart", label: "Départ A", contractKey: "A", lastPaidDate: "2026-11-15", exitCost: null };
    const nov = month(run(mk(A), [chg({ quotaBps: 8000 }), dep]), "2026-11");
    expect(lines(nov, "c1")[0].cost).toBe(-84000);
    expect(lines(nov, "d1")[0]).toMatchObject({ kind: "depart", brut: -120000, charges: -48000, cost: -168000 });
    expect(nov.cost).toBe(168000);
  });
  it("embauche à 50 % de 4 000 € brut temps plein passant à 100 % en décembre : 2 400 € puis 2 400 + 2 400 = 4 800 € ; ETP 0,5 puis 1", () => {
    const hire: Hypothesis = { id: "h1", kind: "embauche", label: "Dév", service: "TECH", start: "2026-11-01", end: null, grossFullTimeCents: 400000, quotaBps: 5000, chargesBps: 2000, counted: true, category: "cdi", replaces: null };
    const p = run(mk(A), [hire, chg({ contractKey: hireKey("h1"), from: "2026-12", quotaBps: 10000 })]);
    expect(month(p, "2026-11")).toMatchObject({ cost: 660000, etp4: 15000 });
    const dec = month(p, "2026-12");
    expect(lines(dec, "c1")[0]).toMatchObject({ kind: "quotite", brut: 200000, charges: 40000, cost: 240000 });
    expect(dec).toMatchObject({ cost: 900000, etp4: 20000 });
  });
  it("refus : quotité actuelle n.d., deux changements le même mois, rien à changer, mois hors horizon, salarié inconnu", () => {
    const refused = (b: BaseSnapshot, hs: Hypothesis[]) => {
      const p = run(b, hs);
      return p.kind === "error" ? p.errors.join(" | ") : "ok";
    };
    expect(refused(mk(contract("N", { etp4: null, base: A.base })), [chg({ contractKey: "N", quotaBps: 8000 })])).toContain("quotité actuelle du salarié n.d.");
    expect(refused(mk(A), [chg({ quotaBps: 8000 }), chg({ id: "c2", service: "SALES" })])).toContain("deux changements le même mois");
    expect(refused(mk(A), [chg({})])).toContain("nouveau service ou nouvelle quotité requis");
    expect(refused(mk(A), [chg({ quotaBps: 8000, from: "2027-01" })])).toContain("hors de l'horizon");
    expect(refused(mk(A), [chg({ contractKey: "Z", quotaBps: 8000 })])).toContain("salarié inconnu");
    expect(refused(mk(A), [chg({ quotaBps: 12000 })])).toContain("quotité entre 0,01 et 100 %");
  });
});

describe("changement de service", () => {
  it("A passe de TECH à SALES le 1er novembre : octobre en TECH, novembre et décembre en SALES, coût inchangé", () => {
    const p = run(mk(A), [chg({ service: "SALES" })]);
    const oct = month(p, "2026-10");
    const nov = month(p, "2026-11");
    expect(oct.contributions.map((c) => c.service)).toEqual(["TECH"]);
    expect(nov.contributions.map((c) => c.service)).toEqual(["SALES"]);
    expect(nov.cost).toBe(oct.cost);
    expect(nov.people?.A).toEqual({ etp4: 10000, category: null, service: "SALES" });
    expect(oct.people?.A.service).toBe("TECH");
  });
});

describe("enveloppes", () => {
  const env = (over: Partial<Extract<Hypothesis, { kind: "enveloppe" }>>): Hypothesis => ({ id: "e1", kind: "enveloppe", label: "Enveloppe TECH", axis: "service", target: "TECH", monthly: { "2026-11": 100000, "2026-12": 50000 }, chargesBps: 4000, ...over });
  it("enveloppe de service en brut + 40 % : novembre 1 000 € + 400 € = 1 400 € rattachés à TECH ; octobre sans enveloppe", () => {
    const p = run(mk(A), [env({})]);
    expect(month(p, "2026-10").cost).toBe(420000);
    const nov = month(p, "2026-11");
    expect(lines(nov, "e1")).toEqual([expect.objectContaining({ kind: "enveloppe", service: "TECH", brut: 100000, charges: 40000, cost: 140000, contractKey: null })]);
    expect(nov).toMatchObject({ brut: 400000, charges: 160000, cost: 560000 });
    expect(month(p, "2026-12").cost).toBe(420000 + 70000);
  });
  it("enveloppe de rubrique saisie en coût chargé : la rubrique est portée, brut et charges du mois deviennent n.d. (null), le coût total reste exact", () => {
    const p = run(mk(A), [env({ id: "e2", label: "Primes 2026", axis: "rubrique", target: "Primes variables", chargesBps: null, monthly: { "2026-12": 123456 }, nonRecurring: true })]);
    const dec = month(p, "2026-12");
    expect(lines(dec, "e2")).toEqual([expect.objectContaining({ kind: "enveloppe", rubric: "Primes variables", service: null, brut: null, charges: null, cost: 123456, nonRecurringCents: 123456 })]);
    expect(dec).toMatchObject({ brut: null, charges: null, cost: 543456 });
  });
  it("refus : deux enveloppes pour la même cible, mois hors horizon, aucun montant, cible vide", () => {
    const refused = (hs: Hypothesis[]) => {
      const p = run(mk(A), hs);
      return p.kind === "error" ? p.errors.join(" | ") : "ok";
    };
    expect(refused([env({ id: "e1" }), env({ id: "e2", label: "Doublon", target: "tech" })])).toContain("déjà l'enveloppe du centre de coûts tech");
    expect(refused([env({ monthly: { "2027-01": 1 } })])).toContain("hors de l'horizon");
    expect(refused([env({ monthly: {} })])).toContain("aucun montant renseigné");
    expect(refused([env({ target: "  " })])).toContain("centre de coûts requis");
    expect(refused([env({ axis: "rubrique", target: "TECH" }), env({ id: "e3" })])).toBe("ok");
  });
});

describe("constantes de référence et présents en fin de mois", () => {
  it("une constante ne change aucun coût et n'est refusée que pour un mois invalide", () => {
    const k: Hypothesis = { id: "k1", kind: "constante", label: "Plafond mensuel SS", unit: "eur", values: { "2026-10": 400500, "2026-11": 400500 }, source: "saisie" };
    expect(run(mk(A), [k])).toEqual(run(mk(A), []));
    const bad = run(mk(A), [{ ...k, values: { "2026-13": 1 } } as Hypothesis]);
    expect(bad.kind === "error" && bad.errors[0]).toContain("mois 2026-13 invalide");
  });
  it("présents en fin de mois : B part le 15 novembre, une embauche arrive le 16 novembre → octobre {A, B}, novembre {A, embauche} ; entrées et sorties par différence", () => {
    const dep: Hypothesis = { id: "d1", kind: "depart", label: "Départ B", contractKey: "B", lastPaidDate: "2026-11-15", exitCost: null };
    const hire: Hypothesis = { id: "h1", kind: "embauche", label: "Remplaçant", service: "SALES", start: "2026-11-16", end: null, grossFullTimeCents: 300000, quotaBps: 10000, chargesBps: 4000, counted: true, category: "cdi", replaces: "d1" };
    const p = run(mk(A, B), [dep, hire]);
    const keys = (m: string) => Object.keys(month(p, m).people!).sort();
    expect(keys("2026-10")).toEqual(["A", "B"]);
    expect(keys("2026-11")).toEqual(["A", "embauche:h1"]);
    expect(month(p, "2026-11")).toMatchObject({ headcount: 2, etp4: 20000 });
    expect(month(p, "2026-11").people!["embauche:h1"]).toEqual({ etp4: 10000, category: "cdi", service: "SALES" });
  });
  it("un salarié non compté n'est pas dans la liste des présents", () => {
    const p = run(mk(A, contract("S", { counted: false, etp4: null, etpNd: "stagiaire non compté", base: B.base, service: "SALES" })), []);
    expect(Object.keys(month(p, "2026-10").people!)).toEqual(["A"]);
  });
});
