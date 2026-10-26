import { describe, expect, it } from "vitest";
import type { Contribution, ContributionKind, Hypothesis, ProjectedMonth, Projection } from "@/lib/budget/types";
import { maskCohorts, maskNonRecurring, nonRecurringContributors, partitionCohorts, type CohortPartition } from "@/lib/croisee/cohortes";

// Partition des personnes observées (chapitre 06) : valeurs fictives écrites à la main, résultats calculés à la main (centimes).
const HORS = "hors-salarie";
const map = (o: Record<string, number>) => new Map(Object.entries(o));

describe("partitionCohorts — cas de référence", () => {
  // N-1 : A 1 000,00 € ; B 2 000,00 € ; C 500,00 € ; lignes sans contrat 10,00 €.
  // N   : B 2 100,00 € ; C 450,00 € ; D 1 200,00 € ; E 300,00 € ; lignes sans contrat 25,00 €.
  const prev = map({ A: 100_000, B: 200_000, C: 50_000, [HORS]: 1_000 });
  const cur = map({ B: 210_000, C: 45_000, D: 120_000, E: 30_000, [HORS]: 2_500 });
  const p = partitionCohorts(prev, cur, HORS);

  it("trois groupes, nombres et montants calculés à la main", () => {
    if (p.kind !== "value") throw new Error(p.reason);
    // Seulement N-1 : A → 1 personne, 1 000,00 €, contribution −1 000,00 €.
    expect(p.onlyPrev).toEqual({ count: 1, prev: 100_000, cur: 0, delta: -100_000 });
    // Seulement N : D et E → 2 personnes, 1 500,00 €, contribution +1 500,00 €.
    expect(p.onlyCur).toEqual({ count: 2, prev: 0, cur: 150_000, delta: 150_000 });
    // Les deux : B et C → 2 personnes, 2 500,00 € puis 2 550,00 €, contribution +50,00 €.
    expect(p.both).toEqual({ count: 2, prev: 250_000, cur: 255_000, delta: 5_000 });
    // Lignes sans contrat : 10,00 € puis 25,00 €, +15,00 €.
    expect(p.outside).toEqual({ prev: 1_000, cur: 2_500, delta: 1_500 });
    // Total : 5 personnes ; 3 510,00 € → 4 075,00 € ; écart +565,00 €.
    expect(p.total).toEqual({ count: 5, prev: 351_000, cur: 407_500, delta: 56_500 });
  });

  it("la somme des contributions est égale à l'écart total", () => {
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.onlyPrev.delta + p.onlyCur.delta + p.both.delta + (p.outside?.delta ?? 0)).toBe(p.total.delta);
  });

  it("aucune clé ne sort de la fonction (nombres et montants seulement)", () => {
    const text = JSON.stringify(p);
    for (const k of ["A", "B", "C", "D", "E", HORS]) expect(text).not.toContain(`"${k}"`);
  });
});

describe("partitionCohorts — cas limites", () => {
  it("une clé dont les lignes se compensent à 0 est observée (dans les deux périodes)", () => {
    const p = partitionCohorts(map({ X: 0 }), map({ X: 30_000 }));
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.both).toEqual({ count: 1, prev: 0, cur: 30_000, delta: 30_000 });
    expect(p.onlyPrev.count + p.onlyCur.count).toBe(0);
    expect(p.outside).toBeNull();
  });

  it("lignes sans contrat présentes dans une seule période : l'autre côté est null, jamais 0 inventé", () => {
    const p = partitionCohorts(map({ A: 10_000 }), map({ A: 10_000, [HORS]: -2_000 }), HORS);
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.outside).toEqual({ prev: null, cur: -2_000, delta: -2_000 });
    expect(p.total).toEqual({ count: 1, prev: 10_000, cur: 8_000, delta: -2_000 });
  });

  it("sans clé de lignes hors personne, une clé « hors-salarie » est comptée comme une autre", () => {
    const p = partitionCohorts(map({ [HORS]: 1_000 }), map({}));
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.onlyPrev.count).toBe(1);
    expect(p.outside).toBeNull();
  });

  it("deux périodes vides : groupes vides, total nul (aucune ligne observée)", () => {
    const p = partitionCohorts(map({}), map({}), HORS);
    expect(p).toEqual({ kind: "value", onlyPrev: { count: 0, prev: 0, cur: 0, delta: 0 }, onlyCur: { count: 0, prev: 0, cur: 0, delta: 0 }, both: { count: 0, prev: 0, cur: 0, delta: 0 }, outside: null, total: { count: 0, prev: 0, cur: 0, delta: 0 } });
  });

  it("un montant qui n'est pas un entier de centimes rend la partition n.d.", () => {
    expect(partitionCohorts(map({ A: 10.5 }), map({}))).toEqual({ kind: "nd", reason: "montant hors des entiers de centimes" });
    expect(partitionCohorts(map({}), map({ A: Number.NaN }))).toEqual({ kind: "nd", reason: "montant hors des entiers de centimes" });
    expect(partitionCohorts(map({ A: Number.MAX_SAFE_INTEGER, B: 1 }), map({}))).toEqual({ kind: "nd", reason: "somme hors des entiers de centimes" });
  });
});

// Seuil de confidentialité : chaque ligne (nombre et montants) est masquée d'un bloc ; masquage secondaire dans chaque colonne dont le
// total est affiché (fonction partagée maskGroups), jusqu'à ce que plus rien ne change. Cas calculés à la main.
describe("maskCohorts — seuil de confidentialité", () => {
  const ref = partitionCohorts(map({ A: 100_000, B: 200_000, C: 50_000, [HORS]: 1_000 }), map({ B: 210_000, C: 45_000, D: 120_000, E: 30_000, [HORS]: 2_500 }), HORS) as Extract<CohortPartition, { kind: "value" }>;

  it("seuil 1 : aucun groupe n'est sous le seuil, rien n'est masqué", () => {
    expect(maskCohorts(ref, 1)).toEqual({ onlyPrev: "shown", onlyCur: "shown", both: "shown", outside: "shown" });
  });

  it("seuil 2 : « seulement N-1 » (1 contrat) masqué ; colonne Contrats → « seulement N » (2, premier des plus petits) ; colonne N-1 → « les deux » (les lignes sans contrat ne protègent personne)", () => {
    // Colonne Contrats : 1 masqué ; plus petit affiché qui compte des contrats : « seulement N » (2) avant « les deux » (2) → 1 + 2 ≥ 2.
    // Colonne Coût N-1 : « seulement N-1 » masqué ; les lignes sans contrat (10,00 €) ne décrivent personne → « les deux » secondaire.
    // Colonne Coût N : « seulement N » et « les deux » arrivent masqués en second (passés en effectif non dénombré : aucune personne
    // comptée) ; les lignes sans contrat ne peuvent pas les protéger → protection impossible, toute la colonne est masquée.
    expect(maskCohorts(ref, 2)).toEqual({ onlyPrev: "masked", onlyCur: "secondary", both: "secondary", outside: "secondary" });
  });

  it("seuil 3 : les trois groupes (1, 2, 2 contrats) masqués ; chaque colonne a déjà deux lignes masquées, les lignes sans contrat restent", () => {
    expect(maskCohorts(ref, 3)).toEqual({ onlyPrev: "masked", onlyCur: "masked", both: "masked", outside: "shown" });
  });

  it("sans lignes sans contrat : un groupe masqué entraîne l'autre groupe de sa colonne", () => {
    // N-1 : A 1 000,00 € ; N : A 1 100,00 €, B 900,00 €. Seulement N : B (1 contrat) ; les deux : A (1 contrat). Seuil 2 : les deux
    // groupes sont sous le seuil. Colonne Contrats : deux masqués. Colonne Coût N-1 : « les deux » masqué, seul ; « seulement N-1 »
    // (0,00 €, vide) affiché donnerait N-1 des « deux » par différence → secondaire.
    const p = partitionCohorts(map({ A: 100_000 }), map({ A: 110_000, B: 90_000 })) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(p, 2)).toEqual({ onlyPrev: "secondary", onlyCur: "masked", both: "masked", outside: "shown" });
    // Seulement N : B (1) ; les deux : A, C, D (3). Seuil 2 : B masqué. Colonne Contrats : plus petit affiché = « seulement N-1 »
    // (0) → secondaire. Colonne Coût N : B masqué, seul → « les deux » secondaire (seule autre ligne). Colonne N-1 : « seulement
    // N-1 » (secondaire) et « les deux » (secondaire) → deux lignes masquées. Tout est masqué, sauf le total.
    const q = partitionCohorts(map({ A: 1_000, C: 1_000, D: 1_000 }), map({ A: 1_000, B: 5_000, C: 1_000, D: 1_000 })) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(q, 2)).toEqual({ onlyPrev: "secondary", onlyCur: "masked", both: "secondary", outside: "shown" });
  });

  it("le masquage secondaire choisit la plus petite valeur absolue (une contribution négative n'est pas « la plus petite »)", () => {
    // N-1 : A 5 000,00 € (sort), B, C, D 1 000,00 € chacun ; N : B, C, D 1 000,00 € ; E 800,00 € (entre) ; sans contrat −20,00 € en N.
    // Seuil 2 : « seulement N-1 » (A) et « seulement N » (E) masqués. Colonne Contrats : 2 masqués (2 contrats). Colonne N-1 : A
    // masqué, seul ; affichés : les deux 3 000,00 € ; → les deux secondaire. Colonne N : E (1 contrat) et les deux (masqués en second,
    // passés en effectif non dénombré) ne comptent qu'un contrat ; les lignes sans contrat (−20,00 €) ne protègent personne →
    // protection impossible, elles sont masquées aussi.
    const p = partitionCohorts(map({ A: 500_000, B: 100_000, C: 100_000, D: 100_000 }), map({ B: 100_000, C: 100_000, D: 100_000, E: 80_000, [HORS]: -2_000 }), HORS) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(p, 2)).toEqual({ onlyPrev: "masked", onlyCur: "masked", both: "secondary", outside: "secondary" });
  });
});

// Éléments non récurrents de l'atterrissage retraité : contributeurs (contrat, à défaut hypothèse), mêmes éléments que retraite
// (lot3.ts). Projection écrite à la main, sans moteur ; résultats comptés à la main.
describe("nonRecurringContributors — cas de référence", () => {
  const C = (o: { hyp: string | null; contract: string | null; nr?: number; kind?: ContributionKind }): Contribution => ({
    hypothesisId: o.hyp,
    kind: o.kind ?? "ponctuel",
    label: "fictif",
    contractKey: o.contract,
    who: "fictif",
    service: null,
    brut: null,
    charges: null,
    cost: o.nr ?? 1_000,
    ...(o.nr !== undefined ? { nonRecurringCents: o.nr } : {}),
  });
  const month = (m: string, contributions: Contribution[]): ProjectedMonth => ({ month: m, kind: "value", brut: null, charges: null, cost: 0, headcount: 0, etp4: null, etpNd: null, contributions });
  const R = (id: string, m: string, cents: number): Hypothesis => ({ id, kind: "realise", label: "fictif", category: "Catégorie fictive", month: m, costCents: cents });
  const base = { refMonth: "2026-03" };
  // Déjà comptabilisés (2026, jusqu'à mars inclus) : r1 1 200,00 € et r5 −100,00 € comptés ; r2 (0,00 €) ne contribue pas ; r3 (mai,
  // après la bascule) et r4 (2025) hors du total → 2 contributeurs.
  const hyps = [R("r1", "2026-01", 120_000), R("r2", "2026-02", 0), R("r3", "2026-05", 50_000), R("r4", "2025-12", 70_000), R("r5", "2026-03", -10_000)];
  // Prévus : c1 porte un coût de sortie (3 000,00 €) et un ponctuel (200,00 €) → 1 contributeur ; l'embauche e1 (tuilage 400,00 €)
  // → 1 ; l'enveloppe v1 (100,00 € en avril, −100,00 € en mai) se compense → 0 ; la contribution de base (sans part non récurrente)
  // et 2027 sont hors du total ; un mois n.d. n'a pas de contribution → 2 contributeurs.
  const proj: Projection = {
    kind: "value",
    months: [
      month("2026-04", [C({ hyp: "d1", contract: "c1", nr: 300_000, kind: "sortie" }), C({ hyp: "p1", contract: "c1", nr: 20_000 }), C({ hyp: "e1", contract: "embauche:e1", nr: 40_000, kind: "embauche" }), C({ hyp: "v1", contract: null, nr: 10_000, kind: "enveloppe" }), C({ hyp: null, contract: "c2", kind: "base" })]),
      month("2026-05", [C({ hyp: "v1", contract: null, nr: -10_000, kind: "enveloppe" })]),
      { month: "2026-06", kind: "nd", reasons: ["raison fictive"] },
      month("2027-01", [C({ hyp: "d9", contract: "c9", nr: 900_000, kind: "sortie" })]),
    ],
  };

  it("2 hypothèses « réalisé » ; 2 contributeurs prévus (c1 une fois, l'embauche ; l'enveloppe compensée ne compte pas)", () => {
    expect(nonRecurringContributors(base, proj, hyps, "2026")).toEqual({ realised: 2, projected: 2 });
  });

  it("aucune clé ne sort de la fonction ; une autre année ne lit que ses éléments", () => {
    expect(JSON.stringify(nonRecurringContributors(base, proj, hyps, "2026"))).not.toMatch(/c1|e1|v1|r1/);
    // 2027 : aucune hypothèse « réalisé » avant la bascule de mars 2026 ; c9 → 1 contributeur prévu.
    expect(nonRecurringContributors(base, proj, hyps, "2027")).toEqual({ realised: 0, projected: 1 });
  });

  it("une part non récurrente sans contrat ni hypothèse : contributeurs prévus non dénombrés (null), jamais devinés", () => {
    const p: Projection = { kind: "value", months: [month("2026-04", [C({ hyp: null, contract: null, nr: 5_000 })])] };
    expect(nonRecurringContributors(base, p, [], "2026")).toEqual({ realised: 0, projected: null });
  });
});

describe("maskNonRecurring — seuil de confidentialité sur les deux totaux (leur somme est affichée)", () => {
  const amounts = { realised: 80_000, projected: 150_000 };

  it("seuil 1 : rien n'est masqué", () => {
    expect(maskNonRecurring({ realised: 1, projected: 1 }, amounts, 1)).toEqual({ realised: "shown", projected: "shown" });
  });

  it("seuil 2 : 1 contributeur déjà comptabilisé masqué, l'autre total (3 contributeurs) masqué en second", () => {
    expect(maskNonRecurring({ realised: 1, projected: 3 }, amounts, 2)).toEqual({ realised: "masked", projected: "secondary" });
  });

  it("seuil 2 : 2 et 3 contributeurs, rien n'est masqué ; seuil 3 : 2 sous le seuil, l'autre en second", () => {
    expect(maskNonRecurring({ realised: 2, projected: 3 }, amounts, 2)).toEqual({ realised: "shown", projected: "shown" });
    expect(maskNonRecurring({ realised: 2, projected: 3 }, amounts, 3)).toEqual({ realised: "masked", projected: "secondary" });
  });

  it("un total vide (0 contributeur, 0,00 €) n'est masqué qu'en second ; deux totaux vides restent affichés", () => {
    expect(maskNonRecurring({ realised: 0, projected: 1 }, { realised: 0, projected: 150_000 }, 3)).toEqual({ realised: "secondary", projected: "masked" });
    expect(maskNonRecurring({ realised: 0, projected: 0 }, { realised: 0, projected: 0 }, 3)).toEqual({ realised: "shown", projected: "shown" });
  });

  it("contributeurs non dénombrés : total non vérifiable, l'autre masqué en second", () => {
    expect(maskNonRecurring({ realised: 4, projected: null }, amounts, 2)).toEqual({ realised: "secondary", projected: "unverifiable" });
  });
});
