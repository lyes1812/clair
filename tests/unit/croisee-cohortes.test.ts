import { describe, expect, it } from "vitest";
import type { PersonLink } from "@/lib/confidentialite";
import { projectedGroupCell } from "@/lib/confidentialite/groups";
import { linkedGroupCell, maskCohorts, partitionCohorts, type CohortPartition, type LinkedGroup } from "@/lib/croisee/cohortes";

// Partition des contrats observés (chapitre 06) : valeurs fictives écrites à la main, résultats calculés à la main (centimes).
const HORS = "hors-salarie";
const map = (o: Record<string, number>) => new Map(Object.entries(o));
// Lien contrat → jeton de personne : chaque clé est sa propre personne (« p-A »…), sauf lien explicite.
const link = (o: Record<string, string>): PersonLink => new Map(Object.entries(o));
const OWN = link({ A: "p-A", B: "p-B", C: "p-C", D: "p-D", E: "p-E", X: "p-X" });
// Groupe relié : personnes (jetons), contrats non reliés, embauches prévisionnelles.
const G = (persons: string[], unlinked = 0, hires = 0): LinkedGroup => ({ persons, unlinked, hires });

describe("partitionCohorts — cas de référence", () => {
  // N-1 : A 1 000,00 € ; B 2 000,00 € ; C 500,00 € ; lignes sans contrat 10,00 €.
  // N   : B 2 100,00 € ; C 450,00 € ; D 1 200,00 € ; E 300,00 € ; lignes sans contrat 25,00 €.
  const prev = map({ A: 100_000, B: 200_000, C: 50_000, [HORS]: 1_000 });
  const cur = map({ B: 210_000, C: 45_000, D: 120_000, E: 30_000, [HORS]: 2_500 });
  const p = partitionCohorts(prev, cur, HORS, OWN);

  it("trois groupes, nombres, montants et personnes reliées calculés à la main", () => {
    if (p.kind !== "value") throw new Error(p.reason);
    // Seulement N-1 : A → 1 contrat (personne p-A), 1 000,00 €, contribution −1 000,00 €.
    expect(p.onlyPrev).toEqual({ count: 1, prev: 100_000, cur: 0, delta: -100_000, persons: ["p-A"], unlinked: 0, hires: 0 });
    // Seulement N : D et E → 2 contrats, 1 500,00 €, contribution +1 500,00 €.
    expect(p.onlyCur).toEqual({ count: 2, prev: 0, cur: 150_000, delta: 150_000, persons: ["p-D", "p-E"], unlinked: 0, hires: 0 });
    // Les deux : B et C → 2 contrats, 2 500,00 € puis 2 550,00 €, contribution +50,00 €.
    expect(p.both).toEqual({ count: 2, prev: 250_000, cur: 255_000, delta: 5_000, persons: ["p-B", "p-C"], unlinked: 0, hires: 0 });
    // Lignes sans contrat : 10,00 € puis 25,00 €, +15,00 €.
    expect(p.outside).toEqual({ prev: 1_000, cur: 2_500, delta: 1_500 });
    // Total : 5 contrats, 5 personnes ; 3 510,00 € → 4 075,00 € ; écart +565,00 €.
    expect(p.total).toEqual({ count: 5, prev: 351_000, cur: 407_500, delta: 56_500, persons: ["p-A", "p-B", "p-C", "p-D", "p-E"], unlinked: 0, hires: 0 });
  });

  it("une personne qui change de contrat entre les deux périodes est dans deux groupes, comptée une fois au total ; sans lien, les contrats sont non reliés", () => {
    // A (seulement N-1) et D (seulement N) portés par la même personne p-AD.
    const q = partitionCohorts(prev, cur, HORS, link({ A: "p-AD", D: "p-AD", B: "p-B", C: "p-C", E: "p-E" }));
    if (q.kind !== "value") throw new Error(q.reason);
    expect(q.onlyPrev.persons).toEqual(["p-AD"]);
    expect(q.onlyCur.persons).toEqual(["p-AD", "p-E"]);
    expect(q.total.persons).toEqual(["p-AD", "p-B", "p-C", "p-E"]);
    const u = partitionCohorts(prev, cur, HORS);
    if (u.kind !== "value") throw new Error(u.reason);
    expect(u.onlyCur).toEqual({ count: 2, prev: 0, cur: 150_000, delta: 150_000, persons: [], unlinked: 2, hires: 0 });
  });

  it("la somme des contributions est égale à l'écart total", () => {
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.onlyPrev.delta + p.onlyCur.delta + p.both.delta + (p.outside?.delta ?? 0)).toBe(p.total.delta);
  });

  it("aucune clé de contrat ne sort de la fonction (nombres, montants et jetons de personne seulement)", () => {
    const text = JSON.stringify(p);
    for (const k of ["A", "B", "C", "D", "E", HORS]) expect(text).not.toContain(`"${k}"`);
  });
});

describe("partitionCohorts — cas limites", () => {
  it("une clé dont les lignes se compensent à 0 est observée (dans les deux périodes)", () => {
    const p = partitionCohorts(map({ X: 0 }), map({ X: 30_000 }), undefined, OWN);
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.both).toEqual({ count: 1, prev: 0, cur: 30_000, delta: 30_000, persons: ["p-X"], unlinked: 0, hires: 0 });
    expect(p.onlyPrev.count + p.onlyCur.count).toBe(0);
    expect(p.outside).toBeNull();
  });

  it("lignes sans contrat présentes dans une seule période : l'autre côté est null, jamais 0 inventé", () => {
    const p = partitionCohorts(map({ A: 10_000 }), map({ A: 10_000, [HORS]: -2_000 }), HORS, OWN);
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.outside).toEqual({ prev: null, cur: -2_000, delta: -2_000 });
    expect(p.total).toEqual({ count: 1, prev: 10_000, cur: 8_000, delta: -2_000, persons: ["p-A"], unlinked: 0, hires: 0 });
  });

  it("sans clé de lignes hors personne, une clé « hors-salarie » est comptée comme une autre", () => {
    const p = partitionCohorts(map({ [HORS]: 1_000 }), map({}));
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.onlyPrev.count).toBe(1);
    expect(p.outside).toBeNull();
  });

  it("deux périodes vides : groupes vides, total nul (aucune ligne observée)", () => {
    const p = partitionCohorts(map({}), map({}), HORS);
    const empty = { count: 0, prev: 0, cur: 0, delta: 0, persons: [], unlinked: 0, hires: 0 };
    expect(p).toEqual({ kind: "value", onlyPrev: empty, onlyCur: empty, both: empty, outside: null, total: empty });
  });

  it("un montant qui n'est pas un entier de centimes rend la partition n.d.", () => {
    expect(partitionCohorts(map({ A: 10.5 }), map({}))).toEqual({ kind: "nd", reason: "montant hors des entiers de centimes" });
    expect(partitionCohorts(map({}), map({ A: Number.NaN }))).toEqual({ kind: "nd", reason: "montant hors des entiers de centimes" });
    expect(partitionCohorts(map({ A: Number.MAX_SAFE_INTEGER, B: 1 }), map({}))).toEqual({ kind: "nd", reason: "somme hors des entiers de centimes" });
  });
});

// Seuil de confidentialité : chaque ligne (nombre et montants) est masquée d'un bloc ; chaque groupe est compté en personnes distinctes
// (contrats reliés par le lien) ; les lignes du journal sans contrat d'un montant non nul ne sont pas vérifiables (aucun contrat
// dénombré) ; masquage secondaire dans chaque colonne dont le total est affiché (fonction partagée maskRelations), jusqu'à ce que plus
// rien ne change. Cas calculés à la main.
describe("maskCohorts — seuil de confidentialité", () => {
  // Seulement N-1 : A (1 personne, 1 000,00 €) ; seulement N : D, E (2 personnes, 1 500,00 €) ; les deux : B, C (2 personnes,
  // 2 500,00 € en N-1, 2 550,00 € en N) ; lignes sans contrat : 10,00 € en N-1, 25,00 € en N.
  const ref = partitionCohorts(map({ A: 100_000, B: 200_000, C: 50_000, [HORS]: 1_000 }), map({ B: 210_000, C: 45_000, D: 120_000, E: 30_000, [HORS]: 2_500 }), HORS, OWN) as Extract<CohortPartition, { kind: "value" }>;

  it("seuil 1 : lignes sans contrat non vérifiables ; la plus petite ligne qui compte un contrat est masquée en second dans les colonnes N-1 et N", () => {
    // Coût N-1 : lignes sans contrat seules masquées, elles se liraient par 3 510,00 − 1 000,00 − 2 500,00 → « seulement N-1 »
    // (1 000,00 € < 2 500,00 €) masqué en second. Coût N : « seulement N » (1 500,00 € < 2 550,00 €). Contrats et contribution : deux
    // lignes masquées ou plus, 3 contrats ≥ 1. « Les deux » reste affiché.
    expect(maskCohorts(ref, 1)).toEqual({ onlyPrev: "secondary", onlyCur: "secondary", both: "shown", outside: "unverifiable" });
    // Sans lignes sans contrat : rien n'est masqué.
    const clean = partitionCohorts(map({ A: 100_000, B: 200_000, C: 50_000 }), map({ B: 210_000, C: 45_000, D: 120_000, E: 30_000 }), HORS, OWN) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(clean, 1)).toEqual({ onlyPrev: "shown", onlyCur: "shown", both: "shown", outside: "shown" });
    // Lignes sans contrat qui se compensent (0,00 € en N-1 et en N) : elles ne désignent personne, rien n'est masqué.
    const zero = partitionCohorts(map({ A: 100_000, B: 200_000, [HORS]: 0 }), map({ B: 210_000, D: 120_000, [HORS]: 0 }), HORS, OWN) as Extract<CohortPartition, { kind: "value" }>;
    expect(zero.outside).toEqual({ prev: 0, cur: 0, delta: 0 });
    expect(maskCohorts(zero, 1)).toEqual({ onlyPrev: "shown", onlyCur: "shown", both: "shown", outside: "shown" });
  });

  it("seuil 2 : « seulement N-1 » (1 personne) masqué ; colonne Contrats → « seulement N » (2, premier des plus petits) ; colonne N-1 → « les deux » (les lignes sans contrat ne protègent personne)", () => {
    // Colonne Contrats : 1 masqué ; plus petit affiché qui compte quelqu'un : « seulement N » (2) avant « les deux » (2) → 1 + 2 ≥ 2.
    // Colonne Coût N-1 : « seulement N-1 » (1 personne) et lignes sans contrat (personne) → « les deux » secondaire.
    // Colonnes Coût N et contribution : toutes les lignes sont déjà masquées.
    expect(maskCohorts(ref, 2)).toEqual({ onlyPrev: "masked", onlyCur: "secondary", both: "secondary", outside: "unverifiable" });
  });

  it("seuil 3 : les trois groupes (1, 2, 2 personnes) masqués ; lignes sans contrat non vérifiables", () => {
    expect(maskCohorts(ref, 3)).toEqual({ onlyPrev: "masked", onlyCur: "masked", both: "masked", outside: "unverifiable" });
  });

  it("une personne à deux contrats dans deux groupes compte une fois ; un contrat non relié ne protège pas", () => {
    // Seuil 2. Seulement N-1 : A ; seulement N : D ; les deux : B, C (2 personnes ≥ 2 : affiché pour lui-même). A et D portés par la
    // même personne p-AD : colonne Contrats, A (1) et D (1) masqués ne décrivent qu'une personne (1 < 2) → « les deux » (p-B, p-C)
    // masqué en second : 3 ≥ 2. Additionner les tailles (1 + 1 = 2) l'aurait laissé affiché.
    const same = partitionCohorts(map({ A: 100_000, B: 200_000, C: 50_000 }), map({ B: 210_000, C: 45_000, D: 120_000 }), HORS, link({ A: "p-AD", D: "p-AD", B: "p-B", C: "p-C" })) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(same, 2)).toEqual({ onlyPrev: "masked", onlyCur: "masked", both: "secondary", outside: "shown" });
    // Seuil 2, mêmes groupes, personnes toutes distinctes : colonne Contrats, A (1) et D (1) masqués décrivent 2 personnes ≥ 2 ; mais
    // dans la colonne Coût N-1, A est seul masqué avec « les deux » (de même D en coût N) : « les deux » est masqué en second dans les
    // deux cas. Le compte en personnes distinctes se lit sur la partition (total.persons), jamais sur une ligne affichée de plus.
    const own = partitionCohorts(map({ A: 100_000, B: 200_000, C: 50_000 }), map({ B: 210_000, C: 45_000, D: 120_000 }), HORS, OWN) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(own, 2)).toEqual({ onlyPrev: "masked", onlyCur: "masked", both: "secondary", outside: "shown" });
    expect(same.total.persons).toEqual(["p-AD", "p-B", "p-C"]);
    expect(own.total.persons).toEqual(["p-A", "p-B", "p-C", "p-D"]);
    // « Les deux » = B (p-B) + C non relié : 1 personne reliée < 2 et un contrat non relié → non dénombré (non vérifiable), quel que
    // soit le seuil ≥ 2 ; A et D masqués, 2 ≥ 2.
    const part = partitionCohorts(map({ A: 100_000, B: 200_000, C: 50_000 }), map({ B: 210_000, C: 45_000, D: 120_000 }), HORS, link({ A: "p-A", D: "p-D", B: "p-B" })) as Extract<CohortPartition, { kind: "value" }>;
    expect(part.both).toEqual({ count: 2, prev: 250_000, cur: 255_000, delta: 5_000, persons: ["p-B"], unlinked: 1, hires: 0 });
    expect(maskCohorts(part, 2)).toEqual({ onlyPrev: "masked", onlyCur: "masked", both: "unverifiable", outside: "shown" });
    // Sans aucun lien : le groupe est non dénombré (contrat non relié), même au seuil 1 ; aucune personne comptée ne pouvant le
    // protéger dans ses colonnes (les lignes vides ne décrivent personne), la protection est impossible : toute la partition est n.d.,
    // les lignes vides comprises (raison du seuil) ; seul le total reste affiché.
    const none = partitionCohorts(map({ A: 100_000 }), map({ A: 110_000 })) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(none, 1)).toEqual({ onlyPrev: "secondary", onlyCur: "secondary", both: "unverifiable", outside: "shown" });
  });

  it("sans lignes sans contrat : un groupe masqué entraîne l'autre groupe de sa colonne", () => {
    // N-1 : A 1 000,00 € ; N : A 1 100,00 €, B 900,00 €. Seulement N : B (1 contrat) ; les deux : A (1 contrat). Seuil 2 : les deux
    // groupes sont sous le seuil. Colonne Contrats : deux masqués, 2 contrats. Colonne Coût N-1 : « les deux » masqué, seul ;
    // « seulement N-1 » (0,00 €, vide) ne décrit personne : protection impossible, il est masqué aussi (sinon N-1 des « deux » se lirait
    // par différence).
    const p = partitionCohorts(map({ A: 100_000 }), map({ A: 110_000, B: 90_000 }), undefined, OWN) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(p, 2)).toEqual({ onlyPrev: "secondary", onlyCur: "masked", both: "masked", outside: "shown" });
    // Seulement N : B (1) ; les deux : A, C, D (3). Seuil 2 : B masqué. Colonne Contrats : « seulement N-1 » (vide) ne protège pas →
    // « les deux » (3) secondaire. Colonne Coût N-1 : « les deux » masqué, seule ligne qui décrit quelqu'un → « seulement N-1 » masqué
    // aussi. Tout est masqué, sauf le total.
    const q = partitionCohorts(map({ A: 1_000, C: 1_000, D: 1_000 }), map({ A: 1_000, B: 5_000, C: 1_000, D: 1_000 }), undefined, OWN) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(q, 2)).toEqual({ onlyPrev: "secondary", onlyCur: "masked", both: "secondary", outside: "shown" });
  });

  it("contribution négative et lignes sans contrat négatives : masquées en bloc ; lignes sans contrat non vérifiables", () => {
    // N-1 : A 5 000,00 € (sort), B, C, D 1 000,00 € chacun ; N : B, C, D 1 000,00 € ; E 800,00 € (entre) ; sans contrat −20,00 € en N.
    // Seuil 2 : « seulement N-1 » (A) et « seulement N » (E) masqués ; lignes sans contrat (−20,00 €) non vérifiables. Colonne
    // Contrats : 2 masqués (2 contrats). Colonne N-1 : A masqué, seul ; affichés : les deux 3 000,00 € → les deux secondaire (4 contrats).
    // Colonne N et contribution : déjà trois lignes masquées.
    const p = partitionCohorts(map({ A: 500_000, B: 100_000, C: 100_000, D: 100_000 }), map({ B: 100_000, C: 100_000, D: 100_000, E: 80_000, [HORS]: -2_000 }), HORS, OWN) as Extract<CohortPartition, { kind: "value" }>;
    expect(maskCohorts(p, 2)).toEqual({ onlyPrev: "masked", onlyCur: "masked", both: "secondary", outside: "unverifiable" });
  });
});

// Cellule d'un groupe relié (linkedGroupCell, celle du module partagé) et embauches prévues dans la partition. Les éléments non
// récurrents de l'atterrissage retraité (« Déjà comptabilisés », « Prévus ») ne sont plus des groupes de la croisée 06 : ce sont des
// totaux de l'entreprise publiés ailleurs (décision par défaut du lot 12, voir croisee-budget.test.ts).
describe("linkedGroupCell et embauches prévues", () => {
  it("cellule du module : embauches seules de taille 0, sans membre, jamais exemptes ; sinon les contrats réels", () => {
    // Cellule du module : celle du module partagé (projectedGroupCell) ; embauches seules : taille 0, sans membre, JAMAIS exempte ;
    // sinon l'entrée du module partagé sur les contrats réels (valeur absolue).
    expect(linkedGroupCell(G([], 0, 2), 2, -300)).toEqual({ size: 0, value: 300, members: [] });
    expect(linkedGroupCell(G([], 0, 2), 2, -300)).toEqual(projectedGroupCell(G([], 0, 2), 2, -300));
    expect(linkedGroupCell(G(["p1"], 0, 1), 2, 300)).toEqual({ size: 1, value: 300, members: ["p1"] });
    expect(linkedGroupCell(G(["p1"], 1, 1), 2, 300)).toEqual({ size: null, value: 300, members: [] });
    expect(linkedGroupCell(G([], 0, 0), 2, 300)).toEqual({ size: null, value: 300, members: [] });
  });

  it("partition : une clé d'embauche prévue (« embauche:… ») compte dans les contrats et les embauches, jamais comme contrat non relié", () => {
    const p = partitionCohorts(map({ A: 100_000 }), map({ A: 100_000, "embauche:e1": 50_000 }), HORS, OWN);
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.onlyCur).toEqual({ count: 1, prev: 0, cur: 50_000, delta: 50_000, persons: [], unlinked: 0, hires: 1 });
    expect(p.total).toEqual({ count: 2, prev: 100_000, cur: 150_000, delta: 50_000, persons: ["p-A"], unlinked: 0, hires: 1 });
    // Seuil 2 : « les deux » (p-A, 1 personne) masqué ; « seulement N » (embauche seule) : taille 0, n'apporte personne. Aucune
    // colonne ne peut atteindre le seuil : le moteur masque toute la relation, la ligne des embauches comprise (elle n'est plus
    // exempte : sinon « les deux » se lirait par différence du total publié et de la ligne des embauches, limite levée au lot 12).
    expect(maskCohorts(p, 2)).toEqual({ onlyPrev: "secondary", onlyCur: "secondary", both: "masked", outside: "shown" });
  });
});
