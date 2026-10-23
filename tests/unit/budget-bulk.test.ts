import { describe, expect, it } from "vitest";
import { expandHires, hireProfiles, planImport } from "@/lib/budget/bulk";
import { hireKey, project } from "@/lib/budget/engine";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";

// Lot 4 : saisies groupées — cas écrits à la main.
type Hire = Extract<Hypothesis, { kind: "embauche" }>;
const hire = (over: Partial<Hire> = {}): Hire => ({
  id: "h1", kind: "embauche", label: "Développeur", service: "TECH", start: "2026-11-01", end: null, grossFullTimeCents: 400000, quotaBps: 10000, chargesBps: 4200, counted: true, category: "cdi", replaces: null, ...over,
});
const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe("nombre de postes", () => {
  it("3 postes : trois hypothèses numérotées (1/3) à (3/3), la première garde l'identifiant de la fiche, les autres en reçoivent un nouveau", () => {
    const out = expandHires(hire(), 3, ids());
    expect(out.map((h) => h.label)).toEqual(["Développeur (1/3)", "Développeur (2/3)", "Développeur (3/3)"]);
    expect(out.map((h) => h.id)).toEqual(["h1", "n1", "n2"]);
    expect(out.every((h) => h.grossFullTimeCents === 400000 && h.service === "TECH" && h.category === "cdi")).toBe(true);
  });
  it("1 poste : la fiche telle quelle, sans numéro ; 0, 51 ou 2,5 postes refusés ; un remplacement avec plusieurs postes refusé", () => {
    expect(expandHires(hire(), 1, ids())).toEqual([hire()]);
    for (const bad of [0, 51, 2.5, -1]) expect(() => expandHires(hire(), bad, ids())).toThrow("Nombre de postes entre 1 et 50");
    expect(() => expandHires(hire({ replaces: "d1" }), 2, ids())).toThrow("un seul poste");
    expect(expandHires(hire({ replaces: "d1" }), 1, ids())[0].replaces).toBe("d1");
  });
  it("coût : 3 postes à 4 000 € brut + 42 % de charges, 1er novembre → 3 × 5 680,00 € = 17 040,00 € en novembre (même total que 3 hypothèses saisies à la main)", () => {
    const base: BaseSnapshot = { currency: "EUR", refMonth: "2026-10", syncId: "s", readAt: "2026-11-05", contracts: [], actuals: [], refMasse: 0, refBaseCost: 0, etpNote: null };
    const p = project(base, "2026-11", "2026-11", expandHires(hire(), 3, ids()), { prorata: "calendaire" });
    expect(p.kind === "value" && p.months[0]).toMatchObject({ kind: "value", cost: 1704000, headcount: 3, etp4: 30000 });
  });
  it("motif, métier et profil recopié sont descriptifs : le coût est identique", () => {
    const base: BaseSnapshot = { currency: "EUR", refMonth: "2026-10", syncId: "s", readAt: "2026-11-05", contracts: [], actuals: [], refMasse: 0, refBaseCost: 0, etpNote: null };
    const plain = project(base, "2026-11", "2026-12", [hire()], { prorata: "calendaire" });
    const described = project(base, "2026-11", "2026-12", [hire({ motif: "Création de poste", metier: "Développeur back", copiedFrom: "A" })], { prorata: "calendaire" });
    expect(described).toEqual(plain);
  });
});

describe("reprise d'hypothèses d'un autre scénario", () => {
  const dep: Hypothesis = { id: "d1", kind: "depart", label: "Départ A", contractKey: "A", lastPaidDate: "2026-11-15", exitCost: null };
  const rep = hire({ id: "h1", replaces: "d1", label: "Remplaçant A" });
  const augHire: Hypothesis = { id: "a1", kind: "augmentation", label: "Augmentation remplaçant", from: "2026-12", rateBps: 300, scope: { kind: "contrat", key: hireKey("h1") } };
  const augAll: Hypothesis = { id: "a2", kind: "augmentation", label: "Générale", from: "2026-12", rateBps: 100, scope: { kind: "global" } };
  const pon: Hypothesis = { id: "p1", kind: "ponctuel", label: "Prime remplaçant", month: "2026-12", amount: { mode: "charge", costCents: 100000 }, service: null, contractKey: hireKey("h1") };
  const src = [augAll, augHire, pon, rep, dep];

  it("tout reprendre : nouveaux identifiants, ordre départ → embauche → augmentations → ponctuel, liens remplacés", () => {
    const { items, dropped } = planImport(src, new Set(["depart", "embauche", "augmentation", "ponctuel"]), ids());
    expect(dropped).toEqual([]);
    expect(items.map((h) => h.label)).toEqual(["Départ A", "Remplaçant A", "Générale", "Augmentation remplaçant", "Prime remplaçant"]);
    // identifiants attribués dans l'ordre d'enregistrement : départ n1, embauche n2, générale n3, augmentation n4, prime n5
    const [d, h, , ah, pn] = items as [Hypothesis, Hire, Hypothesis, Extract<Hypothesis, { kind: "augmentation" }>, Extract<Hypothesis, { kind: "ponctuel" }>];
    expect(d.id).toBe("n1");
    expect(h.id).toBe("n2");
    expect(h.replaces).toBe("n1");
    expect(ah.scope).toEqual({ kind: "contrat", key: "embauche:n2" });
    expect(pn.contractKey).toBe("embauche:n2");
    expect(new Set(items.map((x) => x.id)).size).toBe(5);
  });
  it("augmentations seules : celle de l'embauche non reprise est écartée avec sa raison, la générale est reprise", () => {
    const { items, dropped } = planImport(src, new Set(["augmentation"]), ids());
    expect(items.map((h) => h.label)).toEqual(["Générale"]);
    expect(dropped).toEqual([{ label: "Augmentation remplaçant", reason: "l'embauche visée n'est pas reprise" }]);
  });
  it("embauches sans les départs : le lien « remplace » est retiré, l'embauche reprise", () => {
    const { items, dropped } = planImport(src, new Set(["embauche"]), ids());
    expect(dropped).toEqual([]);
    expect(items).toHaveLength(1);
    expect((items[0] as Hire).replaces).toBeNull();
  });
  it("aucun type choisi : rien", () => {
    expect(planImport(src, new Set(), ids())).toEqual({ items: [], dropped: [] });
  });
});

describe("profil recopié dans le formulaire d'embauche", () => {
  const contract = (over: Partial<BaseContract>): BaseContract => ({
    contractKey: "A", externalId: "A", label: "Salarié A", service: "TECH", serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 8000, etpNd: null, category: "cdi",
    base: { salaryCents: 240000, refBrutCents: 240000, refCotisationsCents: 100000 }, baseNd: null, ...over,
  });
  const base = (cs: BaseContract[]): BaseSnapshot => ({ currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05", contracts: cs, actuals: [], refMasse: 0, refBaseCost: null, etpNote: null });

  it("80 % d'ETP, salaire 2 400,00 €, cotisations 1 000,00 € : brut temps plein 3 000,00 € (2 400 ÷ 0,8), quotité 80,00 %, charges 41,67 % (1 000 ÷ 2 400 = 0,416666… arrondi au centième de %)", () => {
    const [p] = hireProfiles(base([contract({})]), []);
    expect(p).toMatchObject({ key: "A", service: "TECH", category: "cdi", counted: true, grossFullTime: "3000.00", quotaPct: "80.00", chargesPct: "41.67" });
  });
  it("ETP n.d. ou base n.d. : les champs concernés restent à saisir (null), rien n'est supposé", () => {
    const [noEtp, noBase] = hireProfiles(base([contract({ etp4: null }), contract({ contractKey: "B", base: null, baseNd: "entrée en cours de mois" })]), []);
    expect(noEtp).toMatchObject({ grossFullTime: null, quotaPct: null, chargesPct: "41.67" });
    expect(noBase).toMatchObject({ grossFullTime: null, quotaPct: "80.00", chargesPct: null });
    expect(noBase.note).toContain("à saisir");
  });
  it("une embauche déjà saisie se recopie telle quelle : 4 000,00 €, 100,00 %, 42,00 %", () => {
    const profiles = hireProfiles(base([]), [hire()]);
    expect(profiles[0]).toMatchObject({ key: "embauche:h1", label: "Développeur (embauche)", grossFullTime: "4000.00", quotaPct: "100.00", chargesPct: "42.00", counted: true });
  });
});
