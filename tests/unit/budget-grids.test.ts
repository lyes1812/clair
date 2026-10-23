import { describe, expect, it } from "vitest";
import { planBases, planConstants, planEnvelopes, planRates, scopeKeyOf, scopeLabelOf } from "@/lib/budget/grids";
import type { Hypothesis } from "@/lib/budget/types";

// Lot 5 : lecture des grilles de saisie — cas écrits à la main.
const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};
const aug = (id: string, from: string, rateBps: number, scope: Extract<Hypothesis, { kind: "augmentation" }>["scope"], label = `Aug ${id}`): Hypothesis => ({ id, kind: "augmentation", label, from, rateBps, scope });

describe("grille des taux d'augmentation", () => {
  const existing: Hypothesis[] = [
    aug("a1", "2026-11", 200, { kind: "global" }, "Générale 2 %"),
    aug("a2", "2026-12", 300, { kind: "service", service: "TECH" }),
    aug("a3", "2026-11", 500, { kind: "contrat", key: "A" }),
  ];
  it("2 % → 2,5 % conserve l'hypothèse et son libellé ; 1 % en décembre est créé ; 0 retire la ligne du service ; cellule vide sans hypothèse : rien", () => {
    const r = planRates(existing, [
      { scope: "global", month: "2026-11", raw: "2,5" },
      { scope: "global", month: "2026-12", raw: "1" },
      { scope: "service:TECH", month: "2026-12", raw: "0" },
      { scope: "service:TECH", month: "2026-11", raw: "" },
    ], ids());
    expect(r.put).toEqual([
      aug("a1", "2026-11", 250, { kind: "global" }, "Générale 2 %"),
      { id: "n1", kind: "augmentation", label: "Augmentation toute l'entreprise 2026-12", from: "2026-12", rateBps: 100, scope: { kind: "global" } },
    ]);
    expect(r.remove).toEqual(["a2"]);
  });
  it("valeur inchangée : aucune écriture ; l'augmentation ciblant un contrat n'est jamais touchée par la grille", () => {
    expect(planRates(existing, [{ scope: "global", month: "2026-11", raw: "2" }, { scope: "global", month: "2026-12", raw: "" }], ids())).toEqual({ put: [], remove: [] });
  });
  it("taux illisible ou périmètre inconnu : la grille entière est refusée avec la cellule en cause", () => {
    expect(() => planRates(existing, [{ scope: "service:SALES", month: "2026-10", raw: "abc" }], ids())).toThrow("service SALES, 2026-10 : taux en pourcentage requis");
    expect(() => planRates(existing, [{ scope: "contrat:A", month: "2026-10", raw: "1" }], ids())).toThrow("Périmètre de la grille invalide");
  });
  it("statuts : cadres dirigeants 4 % créé, autres 3,5 % → 3,6 % en conservant le libellé, cadres dirigeants décembre 0 retiré ; statut inconnu refusé", () => {
    const withStatut: Hypothesis[] = [...existing, aug("s1", "2026-11", 350, { kind: "statut", executive: false }, "Hors dirigeants 3,5 %"), aug("s2", "2026-12", 100, { kind: "statut", executive: true })];
    const r = planRates(withStatut, [
      { scope: "statut:dirigeant", month: "2026-11", raw: "4" },
      { scope: "statut:autres", month: "2026-11", raw: "3,6" },
      { scope: "statut:dirigeant", month: "2026-12", raw: "0" },
    ], ids());
    expect(r.put).toEqual([
      { id: "n1", kind: "augmentation", label: "Augmentation cadres dirigeants 2026-11", from: "2026-11", rateBps: 400, scope: { kind: "statut", executive: true } },
      aug("s1", "2026-11", 360, { kind: "statut", executive: false }, "Hors dirigeants 3,5 %"),
    ]);
    expect(r.remove).toEqual(["s2"]);
    expect(() => planRates(withStatut, [{ scope: "statut:autre", month: "2026-11", raw: "1" }], ids())).toThrow("Périmètre de la grille invalide");
    expect(scopeKeyOf({ kind: "statut", executive: true })).toBe("statut:dirigeant");
    expect(scopeKeyOf({ kind: "statut", executive: false })).toBe("statut:autres");
    expect(scopeLabelOf("statut:autres")).toBe("hors cadres dirigeants");
  });
});

describe("grille des enveloppes", () => {
  const env: Hypothesis = { id: "e1", kind: "enveloppe", label: "Enveloppe SALES", axis: "service", target: "SALES", monthly: { "2026-11": 1 }, chargesBps: null };
  const row = (over: Partial<Parameters<typeof planEnvelopes>[1][number]>) => ({ id: null, target: "", mode: "charge" as const, taux: "", nonRecurring: false, del: false, cells: {}, ...over });
  it("ligne neuve en brut + 40 % : novembre 1 000 €, décembre 500,50 € → 100 000 et 50 050 centimes ; ligne vide ignorée ; case « supprimer » retire l'existante", () => {
    const r = planEnvelopes("service", [
      row({ target: " TECH ", mode: "brut", taux: "40", cells: { "2026-11": "1 000", "2026-12": "500,5", "2026-10": "" } }),
      row({}),
      row({ id: "e1", del: true }),
    ], [env], ids());
    expect(r.put).toEqual([{ id: "n1", kind: "enveloppe", label: "Enveloppe TECH", axis: "service", target: "TECH", monthly: { "2026-11": 100000, "2026-12": 50050 }, chargesBps: 4000 }]);
    expect(r.remove).toEqual(["e1"]);
  });
  it("modification d'une ligne existante : même identifiant, montants remplacés, non récurrent coché", () => {
    const r = planEnvelopes("service", [row({ id: "e1", target: "SALES", cells: { "2026-12": "250" }, nonRecurring: true })], [env], ids());
    expect(r.put).toEqual([{ id: "e1", kind: "enveloppe", label: "Enveloppe SALES", axis: "service", target: "SALES", monthly: { "2026-12": 25000 }, chargesBps: null, nonRecurring: true }]);
  });
  it("refus : cible manquante, aucun montant, brut sans taux, montant illisible, ligne inconnue", () => {
    expect(() => planEnvelopes("rubrique", [row({ cells: { "2026-11": "10" } })], [], ids())).toThrow("Ligne 1 : rubrique requis");
    expect(() => planEnvelopes("service", [row({ target: "TECH" })], [], ids())).toThrow("TECH : aucun montant renseigné");
    expect(() => planEnvelopes("service", [row({ target: "TECH", mode: "brut", cells: { "2026-11": "10" } })], [], ids())).toThrow("taux de charges requis");
    expect(() => planEnvelopes("service", [row({ target: "TECH", cells: { "2026-11": "dix" } })], [], ids())).toThrow("TECH, 2026-11 : montant en euros requis");
    expect(() => planEnvelopes("service", [row({ id: "zz", target: "X", cells: { "2026-11": "1" } })], [env], ids())).toThrow("enveloppe inconnue");
    // une enveloppe d'un autre axe n'est pas modifiable depuis cette grille
    expect(() => planEnvelopes("rubrique", [row({ id: "e1", target: "X", cells: { "2026-11": "1" } })], [env], ids())).toThrow("enveloppe inconnue");
  });
});

describe("grille des constantes de référence", () => {
  const row = (over: Partial<Parameters<typeof planConstants>[0][number]>) => ({ id: null, label: "", unit: "eur" as const, source: "", del: false, cells: {}, ...over });
  it("plafond 4 005,00 € (400 500 centimes) et taux 2,5 % (250 points de base)", () => {
    const r = planConstants([
      row({ label: "Plafond mensuel SS", unit: "eur", source: "Arrêté 2026", cells: { "2026-10": "4 005", "2026-11": "4005,00" } }),
      row({ label: "Taux AT", unit: "pct", source: "Notification CARSAT", cells: { "2026-10": "2,5" } }),
    ], [], ids());
    expect(r.put).toEqual([
      { id: "n1", kind: "constante", label: "Plafond mensuel SS", unit: "eur", values: { "2026-10": 400500, "2026-11": 400500 }, source: "Arrêté 2026" },
      { id: "n2", kind: "constante", label: "Taux AT", unit: "pct", values: { "2026-10": 250 }, source: "Notification CARSAT" },
    ]);
  });
  it("refus : source manquante (une constante sans source n'est pas utilisable), valeur illisible, libellé manquant", () => {
    expect(() => planConstants([row({ label: "Horaire", cells: { "2026-10": "151,67" } })], [], ids())).toThrow("Horaire : source requise");
    expect(() => planConstants([row({ label: "Horaire", source: "s", cells: { "2026-10": "x" } })], [], ids())).toThrow("Horaire, 2026-10 : valeur numérique requise");
    expect(() => planConstants([row({ source: "s", cells: { "2026-10": "1" } })], [], ids())).toThrow("Ligne 1 : libellé requis");
  });
});

describe("grille des bases individuelles", () => {
  const prior: Hypothesis = { id: "b1", kind: "base", label: "Base saisie", contractKey: "A", salaryCents: 250000, chargesBps: 4200 };
  it("salaire 3 200,00 € et charges 42,5 % pour B ; A inchangé ; C sans correction existante et vide : rien ; D vide avec correction : retirée", () => {
    const r = planBases([
      { contractKey: "B", label: "Salarié B", salary: "3 200,00", charges: "42,5" },
      { contractKey: "A", label: "Salarié A", salary: "2500", charges: "42" },
      { contractKey: "C", label: "Salarié C", salary: "", charges: "" },
      { contractKey: "D", label: "Salarié D", salary: " ", charges: "" },
    ], [prior, { ...prior, id: "b2", contractKey: "D" }], ids());
    expect(r.put).toEqual([{ id: "n1", kind: "base", label: "Base de Salarié B", contractKey: "B", salaryCents: 320000, chargesBps: 4250 }]);
    expect(r.remove).toEqual(["b2"]);
  });
  it("salaire modifié : même identifiant et même libellé ; 0 € accepté (contrat non payé) ; un seul des deux champs refusé", () => {
    expect(planBases([{ contractKey: "A", label: "Salarié A", salary: "0", charges: "0" }], [prior], ids()).put).toEqual([{ ...prior, salaryCents: 0, chargesBps: 0 }]);
    expect(() => planBases([{ contractKey: "A", label: "Salarié A", salary: "100", charges: "" }], [], ids())).toThrow("Salarié A : salaire et taux de charges vont ensemble");
    expect(() => planBases([{ contractKey: "A", label: "Salarié A", salary: "-5", charges: "10" }], [], ids())).toThrow("salaire mensuel de base en euros requis");
  });
});
