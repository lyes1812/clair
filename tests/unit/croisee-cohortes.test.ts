import { describe, expect, it } from "vitest";
import { partitionCohorts } from "@/lib/croisee/cohortes";

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
