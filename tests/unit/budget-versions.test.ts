import { describe, expect, it } from "vitest";
import { ecartServiceGuard, maskProjectedServices } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart-data";
import { hireKey, project } from "@/lib/budget/engine";
import { flowsOf } from "@/lib/budget/flows";
import { aggregate, budgetVersion, diff, monthsOfYear, nd, scenarioVersion, val, type ServiceFilter, type Version } from "@/lib/budget/versions";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import type { ZoomSource } from "@/lib/budget/zoom";
import { confidentialiteReason, SEUIL_NON_DEFINI, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting, type MaskStatus } from "@/lib/confidentialite";
import { croiseeLink } from "@/lib/croisee/confidentialite";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";

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

// --- Garde du filtre Service de l'Écart budgétaire et de l'Analyse des écarts (ecartServiceGuard : la garde unique, appliquée aux
// versions comparées). Cas écrits à la main sur la base fictive ci-dessus (A : TECH, B : SALES), un référentiel fictif qui relie A et B à
// deux personnes, et un journal fictif de 2026 (janvier) pour les mois réels.
describe("garde du filtre Service sur les versions comparées (seuil de confidentialité)", () => {
  const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
  const data = { build: { source: "payfit" }, contracts: [{ contractKey: "A", externalId: "A", personKey: "PA" }, { contractKey: "B", externalId: "B", personKey: "PB" }] };
  // Journal 2026 : janvier, A (TECH) salaire 3 000 € + cotisations 1 200 € ; B (SALES) 2 000 € + 900 €.
  let n = 0;
  const line = (month: string, accountId: string, debit: number, contractId: string, svc: string): LedgerLine => ({ key: `${month}#${n++}`, month, accountId, accountName: null, debitCents: debit, creditCents: null, contractId, analytic: [{ type: "Service", code: svc, value: svc }] });
  const j26: JournalInput = { lines: [line("2026-01", "641100", 300000, "A", "TECH"), line("2026-01", "645100", 120000, "A", "TECH"), line("2026-01", "641100", 200000, "B", "SALES"), line("2026-01", "645100", 90000, "B", "SALES")], months: ["2026-01"], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "Service" };
  const loadedOf = (versions: Version[], sources: ZoomSource[], filter: ServiceFilter, journal: JournalInput | null = j26, withRef = true) =>
    ({ ctx: { input: journal, kpi: { input: withRef ? { data } : null } }, versions, sources, filter, months: (year: string) => monthsOfYear(year, "01", "12") }) as never;
  const scenario = (hyps: Hypothesis[], filter: ServiceFilter, journal: JournalInput | null = j26) => {
    const proj = project(base, "2026-10", "2026-12", hyps, conv);
    return { v: scenarioVersion("s", "Révisé", "2026", base, proj, journal, null, filter), src: { kind: "scenario", base, proj, journal, filter } as ZoomSource };
  };

  it("sans filtre : rien à garder ; seuil absent : n.d. « non défini » avec le lien (cause paramètre)", () => {
    const { v, src } = scenario([], null);
    expect(ecartServiceGuard(loadedOf([v], [src], null), set(2))).toBeNull();
    expect(ecartServiceGuard(loadedOf([v], [src], { value: "TECH" }), { kind: "absent" })).toEqual({ cause: "parametre", reason: SEUIL_NON_DEFINI });
  });
  it("scénario, filtre TECH : les mois projetés décrivent A seul (1 personne) ⇒ masqué au seuil 2, affiché au seuil 1", () => {
    const { v, src } = scenario([], { value: "TECH" });
    expect(v.months.get("2026-10")!.people).toEqual({ kind: "value", map: { A: 10000 } });
    expect(ecartServiceGuard(loadedOf([v], [src], { value: "TECH" }), set(2))).toEqual({ cause: "seuil", reason: confidentialiteReason(2) });
    expect(ecartServiceGuard(loadedOf([v], [src], { value: "TECH" }), set(1))).toBeNull();
    // Sans référentiel : A n'est relié à personne, le service est non vérifiable quel que soit le seuil.
    expect(ecartServiceGuard(loadedOf([v], [src], { value: "TECH" }, j26, false), set(1))).toEqual({ cause: "seuil", reason: SEUIL_NON_VERIFIABLE });
  });
  // Revue du lot 12 : ce cas affichait OPS au seuil 5 (embauche exempte, masquage principal seul). Les mois projetés sont désormais
  // masqués colonne par colonne avec le total du scénario, publié sans filtre : en novembre, TECH (A) et SALES (B) ne décrivent que
  // 2 personnes, la colonne ne peut pas être protégée et toute la répartition est n.d., OPS compris (sinon TECH + SALES = total − OPS).
  // Au seuil 2, TECH et SALES se protègent l'un l'autre : OPS, porté par la seule embauche, est affiché sans protéger personne.
  it("embauche prévue seule dans un service (OPS, de novembre) : affichée au seuil 2 sans protéger personne, n.d. au seuil 5 (colonne impossible à protéger) ; mêlée à A dans TECH : jugée sur A (masqué au seuil 2)", () => {
    const hyps: Hypothesis[] = [
      { id: "h1", kind: "embauche", label: "Recrue OPS", service: "OPS", start: "2026-11-01", end: null, grossFullTimeCents: 250000, quotaBps: 10000, chargesBps: 4000, counted: true, category: "cdi", replaces: null },
      { id: "h2", kind: "embauche", label: "Recrue TECH", service: "TECH", start: "2026-11-01", end: null, grossFullTimeCents: 250000, quotaBps: 10000, chargesBps: 4000, counted: true, category: "cdi", replaces: null },
    ];
    const ops = scenario(hyps, { value: "OPS" });
    expect(ops.v.months.get("2026-11")!.people).toEqual({ kind: "value", map: { [hireKey("h1")]: 10000 } });
    expect(ops.v.months.get("2026-11")!.masse).toEqual(val(350000)); // 2 500 + 40 % : la masse d'une embauche prévue reste lisible
    expect(ecartServiceGuard(loadedOf([ops.v], [ops.src], { value: "OPS" }), set(2))).toBeNull();
    expect(ecartServiceGuard(loadedOf([ops.v], [ops.src], { value: "OPS" }), set(5))).toEqual({ cause: "seuil", reason: confidentialiteReason(5) });
    const tech = scenario(hyps, { value: "TECH" });
    expect(Object.keys(tech.v.months.get("2026-11")!.people.kind === "value" ? (tech.v.months.get("2026-11")!.people as { map: Record<string, number> }).map : {}).sort()).toEqual(["A", hireKey("h2")]);
    expect(ecartServiceGuard(loadedOf([tech.v], [tech.src], { value: "TECH" }), set(2))).toEqual({ cause: "seuil", reason: confidentialiteReason(2) });
    expect(ecartServiceGuard(loadedOf([tech.v], [tech.src], { value: "TECH" }), set(1))).toBeNull();
  });
  it("mois réels : les lignes par service du journal (TECH = A, SALES = B, une personne chacun) ⇒ masqués au seuil 2 ; budget saisi : rien à protéger", () => {
    const { v, src } = scenario([], { value: "SALES" });
    // Janvier 2026 est un mois réel figé du scénario : la garde passe par les lignes par service du journal entier.
    expect(v.months.get("2026-01")!.layer).toBe("reel");
    expect(ecartServiceGuard(loadedOf([v], [src], { value: "SALES" }), set(2))).toEqual({ cause: "seuil", reason: confidentialiteReason(2) });
    const bv = budgetVersion("b", "Budget 2026", "2026", { "2026-01": 700000 });
    expect(ecartServiceGuard(loadedOf([bv], [{ kind: "budget" }], { value: "SALES" }), set(2))).toBeNull();
    // Journal absent : les mois réels ne décrivent personne (n.d. pour leur propre raison) ; seuls les mois projetés comptent.
    const none = scenario([], { value: "SALES" }, null);
    expect(ecartServiceGuard(loadedOf([none.v], [none.src], { value: "SALES" }, null), set(2))).toEqual({ cause: "seuil", reason: confidentialiteReason(2) });
    expect(ecartServiceGuard(loadedOf([none.v], [none.src], { value: "SALES" }, null), set(1))).toBeNull();
  });
});

// --- Mois projetés d'un scénario sous le filtre Service (revue du lot 12) : chaque mois projeté est une colonne par grandeur (masse,
// effectif et ETP, entrées) dont le total est publié par l'Écart budgétaire sans filtre ; le moteur unique y applique le masquage
// secondaire (maskProjectedServices), et la garde rend n.d. le service retenu dès qu'une de ses cellules est masquée. Scénario 2027
// entièrement projeté (mois de référence décembre 2026), salaires sans charges (taux observé 0 %) : coût du mois = salaire. Chaque
// contrat est relié à une personne distincte par un référentiel fictif.
describe("garde du filtre Service : mois projetés d'un scénario, masquage secondaire dans chaque colonne de mois", () => {
  const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
  const R5 = { cause: "seuil", reason: confidentialiteReason(5) };
  const staff = (svc: string, n: number, salary: number): BaseContract[] =>
    Array.from({ length: n }, (_, i) => contract(`${svc}-${i + 1}`, { service: svc, base: { salaryCents: salary, refBrutCents: salary, refCotisationsCents: 0 } }));
  const hire = (id: string, service: string, gross: number): Hypothesis => ({ id, kind: "embauche", label: `Recrue ${service}`, service, start: "2027-01-01", end: null, grossFullTimeCents: gross, quotaBps: 10000, chargesBps: 0, counted: true, category: "cdi", replaces: null });
  const run = (contracts: BaseContract[], hyps: Hypothesis[] = []) => {
    const b: BaseSnapshot = { currency: "EUR", refMonth: "2026-12", syncId: "s", readAt: "2027-01-05", contracts, refMasse: 0, refBaseCost: 0, etpNote: null, actuals: [] };
    const proj = project(b, "2027-01", "2027-12", hyps, conv);
    const data = { build: { source: "payfit" }, contracts: contracts.map((c) => ({ contractKey: c.contractKey, externalId: c.externalId, personKey: `P-${c.contractKey}` })) };
    const version = (filter: ServiceFilter) => scenarioVersion("scenario:s27:2027", "Révisé 2027", "2027", b, proj, null, null, filter);
    const guard = (service: string, seuil: number) =>
      ecartServiceGuard({ ctx: { input: null, kpi: { input: { data } } }, versions: [version({ value: service })], sources: [{ kind: "scenario", base: b, proj, journal: null, filter: { value: service } }], filter: { value: service }, months: (y: string) => monthsOfYear(y, "01", "12") } as never, set(seuil));
    // Statut de chaque service dans les colonnes d'un mois (masse, effectif, entrées).
    const column = (month: string, seuil: number): Record<string, MaskStatus[]> => {
      const i = proj.kind === "value" ? proj.months.findIndex((x) => x.month === month) : -1;
      const pm = proj.kind === "value" ? proj.months[i] : undefined;
      if (!pm || pm.kind !== "value") throw new Error("projection n.d.");
      return Object.fromEntries([...maskProjectedServices(pm, flowsOf(b, proj)[i], croiseeLink(data as never), seuil)].map(([k, st]) => [k ?? "Non ventilé", st]));
    };
    const january = (seuil: number) => column("2027-01", seuil);
    return { version, guard, column, january };
  };

  it("cas de la revue (seuil 5) : S1 = 1 salarié à 4 000 €, S2 = 6 salariés à 18 000 € ; total 22 000 € publié sans filtre ⇒ S1 masqué, S2 masqué en secondaire, aucune reconstitution", () => {
    const s = run([...staff("S1", 1, 400000), ...staff("S2", 6, 300000)]);
    // Ce que l'écran publierait : 22 000 € sans filtre, 18 000 € sous S2, donc S1 = 22 000 − 18 000 = 4 000 € sans la garde.
    expect(s.version(null).months.get("2027-01")!.masse).toEqual(val(2200000));
    expect(s.version({ value: "S2" }).months.get("2027-01")!.masse).toEqual(val(1800000));
    expect(s.version({ value: "S1" }).months.get("2027-01")!.masse).toEqual(val(400000));
    // Janvier : masse S1 (1 personne) masquée, S2 (6) masqué pour la protéger ; même chose pour l'effectif ; aucune entrée.
    expect(s.january(5)).toEqual({ S1: ["masked", "masked", "shown"], S2: ["secondary", "secondary", "shown"] });
    expect(s.guard("S1", 5)).toEqual(R5);
    expect(s.guard("S2", 5)).toEqual(R5);
    // Seuil 1 : rien n'est masqué.
    expect(s.guard("S1", 1)).toBeNull();
    expect(s.guard("S2", 1)).toBeNull();
  });

  it("S1 = 1 personne (4 000 €), S2 = 6 (18 000 €), S3 = 8 (20 000 €), seuil 5 : S1 masqué, S2 (la plus petite cellule) masqué en secondaire, S3 affiché", () => {
    const s = run([...staff("S1", 1, 400000), ...staff("S2", 6, 300000), ...staff("S3", 8, 250000)]);
    // 1 + 6 = 7 personnes masquées ≥ 5 : S3 reste affiché ; total 42 000 € − S3 20 000 € = 22 000 €, somme de 7 personnes.
    expect(s.january(5)).toEqual({ S1: ["masked", "masked", "shown"], S2: ["secondary", "secondary", "shown"], S3: ["shown", "shown", "shown"] });
    expect(s.guard("S1", 5)).toEqual(R5);
    expect(s.guard("S2", 5)).toEqual(R5);
    expect(s.guard("S3", 5)).toBeNull();
  });

  it("deux colonnes, deux secondaires : S3 à 8 × 2 000 € (16 000 €) est la plus petite masse, S2 (6 personnes) le plus petit effectif ⇒ les deux sont n.d. sous leur filtre", () => {
    const s = run([...staff("S1", 1, 400000), ...staff("S2", 6, 300000), ...staff("S3", 8, 200000)]);
    expect(s.january(5)).toEqual({ S1: ["masked", "masked", "shown"], S2: ["shown", "secondary", "shown"], S3: ["secondary", "shown", "shown"] });
    expect(s.guard("S2", 5)).toEqual(R5);
    expect(s.guard("S3", 5)).toEqual(R5);
  });

  it("embauche prévue seule dans OPS (2 500 €, dès janvier) : affichée, jamais protectrice — S1 est protégé par S2 (18 000 €), pas par OPS, pourtant plus petite", () => {
    const s = run([...staff("S1", 1, 400000), ...staff("S2", 6, 300000)], [hire("h1", "OPS", 250000)]);
    expect(s.version({ value: "OPS" }).months.get("2027-01")!.masse).toEqual(val(250000));
    // Entrées de janvier : la seule embauche (OPS), qui ne décrit personne : rien à masquer dans cette colonne.
    expect(s.january(5)).toEqual({ S1: ["masked", "masked", "shown"], S2: ["secondary", "secondary", "shown"], OPS: ["shown", "shown", "shown"] });
    expect(s.guard("OPS", 5)).toBeNull();
    expect(s.guard("S1", 5)).toEqual(R5);
    expect(s.guard("S2", 5)).toEqual(R5);
  });

  it("entrée réelle dans un mois projeté (contrat connu qui commence en mars dans S2) : sa cellule d'entrées décrit 1 personne ⇒ S2 n.d. sous son filtre ; S3, sans entrée (0, ne désigne personne), reste affiché", () => {
    const late = contract("S2-7", { service: "S2", startDate: "2027-03-01", base: { salaryCents: 300000, refBrutCents: 300000, refCotisationsCents: 0 } });
    const s = run([...staff("S2", 6, 300000), late, ...staff("S3", 8, 250000)]);
    // Janvier : S2 (6 personnes) et S3 (8) affichés dans les trois colonnes ; aucune entrée.
    expect(s.january(5)).toEqual({ S2: ["shown", "shown", "shown"], S3: ["shown", "shown", "shown"] });
    // Mars : masse et effectif de S2 (7 personnes) affichés, mais 1 entrée réelle. La colonne des entrées ne peut pas être protégée
    // (S3 n'a aucune entrée : une cellule vide reste hors de la relation, règle canonique de maskColumn).
    expect(s.version({ value: "S2" }).months.get("2027-03")!.entrees).toEqual(val(1));
    expect(s.column("2027-03", 5)).toEqual({ S2: ["shown", "shown", "masked"], S3: ["shown", "shown", "shown"] });
    expect(s.guard("S2", 5)).toEqual(R5);
    expect(s.guard("S3", 5)).toBeNull();
  });
});
