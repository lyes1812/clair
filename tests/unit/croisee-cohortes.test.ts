import { describe, expect, it } from "vitest";
import { maskCohorts, partitionCohorts, type CohortPartition } from "@/lib/croisee/cohortes";

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

  it("seuil 2 : « seulement N-1 » (1 contrat) masqué ; colonne Contrats → « seulement N » (2, premier des plus petits) ; colonne N-1 → lignes sans contrat (10,00 €)", () => {
    // Colonne Contrats : 1 masqué ; plus petit affiché : « seulement N » (2) avant « les deux » (2) → secondaire.
    // Colonne Coût N-1 : « seulement N-1 » masqué ; affichés : les deux 2 500,00 €, sans contrat 10,00 € → sans contrat secondaire.
    // Colonne Coût N : « seulement N » et sans contrat masqués (2) ; colonne Contribution : 3 masqués → rien de plus.
    expect(maskCohorts(ref, 2)).toEqual({ onlyPrev: "masked", onlyCur: "secondary", both: "shown", outside: "secondary" });
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
    // Seuil 2 : « seulement N-1 » (A) et « seulement N » (E) masqués. Colonne Contrats : 2 masqués. Colonne N-1 : A masqué, seul ;
    // affichés : les deux 3 000,00 € ; → les deux secondaire. Colonne N : E masqué, les deux secondaire → 2. Colonne Contribution :
    // A, E, les deux masqués → 3. Les lignes sans contrat (−20,00 €) restent affichées.
    const p = partitionCohorts(map({ A: 500_000, B: 100_000, C: 100_000, D: 100_000 }), map({ B: 100_000, C: 100_000, D: 100_000, E: 80_000, [HORS]: -2_000 }), HORS) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(p, 2)).toEqual({ onlyPrev: "masked", onlyCur: "masked", both: "secondary", outside: "shown" });
  });
});
