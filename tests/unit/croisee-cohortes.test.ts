import { describe, expect, it } from "vitest";
import type { Contribution, ContributionKind, Hypothesis, ProjectedMonth, Projection } from "@/lib/budget/types";
import type { PersonLink, PersonsOfContracts } from "@/lib/confidentialite";
import { maskCohorts, maskNonRecurring, nonRecurringContributors, partitionCohorts, type CohortPartition } from "@/lib/croisee/cohortes";

// Partition des contrats observés (chapitre 06) : valeurs fictives écrites à la main, résultats calculés à la main (centimes).
const HORS = "hors-salarie";
const map = (o: Record<string, number>) => new Map(Object.entries(o));
// Lien contrat → jeton de personne : chaque clé est sa propre personne (« p-A »…), sauf lien explicite.
const link = (o: Record<string, string>): PersonLink => new Map(Object.entries(o));
const OWN = link({ A: "p-A", B: "p-B", C: "p-C", D: "p-D", E: "p-E", X: "p-X" });
const G = (persons: string[], unlinked = 0): PersonsOfContracts => ({ persons, unlinked });

describe("partitionCohorts — cas de référence", () => {
  // N-1 : A 1 000,00 € ; B 2 000,00 € ; C 500,00 € ; lignes sans contrat 10,00 €.
  // N   : B 2 100,00 € ; C 450,00 € ; D 1 200,00 € ; E 300,00 € ; lignes sans contrat 25,00 €.
  const prev = map({ A: 100_000, B: 200_000, C: 50_000, [HORS]: 1_000 });
  const cur = map({ B: 210_000, C: 45_000, D: 120_000, E: 30_000, [HORS]: 2_500 });
  const p = partitionCohorts(prev, cur, HORS, OWN);

  it("trois groupes, nombres, montants et personnes reliées calculés à la main", () => {
    if (p.kind !== "value") throw new Error(p.reason);
    // Seulement N-1 : A → 1 contrat (personne p-A), 1 000,00 €, contribution −1 000,00 €.
    expect(p.onlyPrev).toEqual({ count: 1, prev: 100_000, cur: 0, delta: -100_000, persons: ["p-A"], unlinked: 0 });
    // Seulement N : D et E → 2 contrats, 1 500,00 €, contribution +1 500,00 €.
    expect(p.onlyCur).toEqual({ count: 2, prev: 0, cur: 150_000, delta: 150_000, persons: ["p-D", "p-E"], unlinked: 0 });
    // Les deux : B et C → 2 contrats, 2 500,00 € puis 2 550,00 €, contribution +50,00 €.
    expect(p.both).toEqual({ count: 2, prev: 250_000, cur: 255_000, delta: 5_000, persons: ["p-B", "p-C"], unlinked: 0 });
    // Lignes sans contrat : 10,00 € puis 25,00 €, +15,00 €.
    expect(p.outside).toEqual({ prev: 1_000, cur: 2_500, delta: 1_500 });
    // Total : 5 contrats, 5 personnes ; 3 510,00 € → 4 075,00 € ; écart +565,00 €.
    expect(p.total).toEqual({ count: 5, prev: 351_000, cur: 407_500, delta: 56_500, persons: ["p-A", "p-B", "p-C", "p-D", "p-E"], unlinked: 0 });
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
    expect(u.onlyCur).toEqual({ count: 2, prev: 0, cur: 150_000, delta: 150_000, persons: [], unlinked: 2 });
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
    expect(p.both).toEqual({ count: 1, prev: 0, cur: 30_000, delta: 30_000, persons: ["p-X"], unlinked: 0 });
    expect(p.onlyPrev.count + p.onlyCur.count).toBe(0);
    expect(p.outside).toBeNull();
  });

  it("lignes sans contrat présentes dans une seule période : l'autre côté est null, jamais 0 inventé", () => {
    const p = partitionCohorts(map({ A: 10_000 }), map({ A: 10_000, [HORS]: -2_000 }), HORS, OWN);
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.outside).toEqual({ prev: null, cur: -2_000, delta: -2_000 });
    expect(p.total).toEqual({ count: 1, prev: 10_000, cur: 8_000, delta: -2_000, persons: ["p-A"], unlinked: 0 });
  });

  it("sans clé de lignes hors personne, une clé « hors-salarie » est comptée comme une autre", () => {
    const p = partitionCohorts(map({ [HORS]: 1_000 }), map({}));
    if (p.kind !== "value") throw new Error(p.reason);
    expect(p.onlyPrev.count).toBe(1);
    expect(p.outside).toBeNull();
  });

  it("deux périodes vides : groupes vides, total nul (aucune ligne observée)", () => {
    const p = partitionCohorts(map({}), map({}), HORS);
    const empty = { count: 0, prev: 0, cur: 0, delta: 0, persons: [], unlinked: 0 };
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
    expect(part.both).toEqual({ count: 2, prev: 250_000, cur: 255_000, delta: 5_000, persons: ["p-B"], unlinked: 1 });
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

  // Jetons de personne sans la clé du contrat (le test vérifie qu'aucune clé ne sort de la fonction).
  const LINK = link({ c1: "personne-un", c2: "personne-deux", c9: "personne-neuf" });

  it("2 hypothèses « réalisé » (sans contrat : non reliées) ; 2 contributeurs prévus : c1 (relié, une fois) et l'embauche (non reliée) ; l'enveloppe compensée ne compte pas", () => {
    expect(nonRecurringContributors(base, proj, hyps, "2026", LINK)).toEqual({ realised: G([], 2), projected: G(["personne-un"], 1) });
    // Sans lien : c1 est un contrat non relié.
    expect(nonRecurringContributors(base, proj, hyps, "2026")).toEqual({ realised: G([], 2), projected: G([], 2) });
  });

  it("aucune clé ne sort de la fonction ; une autre année ne lit que ses éléments", () => {
    expect(JSON.stringify(nonRecurringContributors(base, proj, hyps, "2026", LINK))).not.toMatch(/c1|e1|v1|r1/);
    // 2027 : aucune hypothèse « réalisé » avant la bascule de mars 2026 ; c9 → 1 contributeur prévu (relié).
    expect(nonRecurringContributors(base, proj, hyps, "2027", LINK)).toEqual({ realised: G([]), projected: G(["personne-neuf"]) });
  });

  it("une part non récurrente sans contrat ni hypothèse : contributeurs prévus non dénombrés (null), jamais devinés", () => {
    const p: Projection = { kind: "value", months: [month("2026-04", [C({ hyp: null, contract: null, nr: 5_000 })])] };
    expect(nonRecurringContributors(base, p, [], "2026", LINK)).toEqual({ realised: G([]), projected: null });
  });
});

describe("maskNonRecurring — seuil de confidentialité sur les deux totaux (leur somme est affichée), en personnes distinctes", () => {
  const amounts = { realised: 80_000, projected: 150_000 };
  const P = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

  it("seuil 1 : rien n'est masqué quand chaque total compte une personne reliée", () => {
    expect(maskNonRecurring({ realised: G(["q1"]), projected: G(["p1"]) }, amounts, 1)).toEqual({ realised: "shown", projected: "shown" });
  });

  it("seuil 2 : 1 personne déjà comptabilisée masquée, l'autre total (3 personnes) masqué en second", () => {
    expect(maskNonRecurring({ realised: G(["q1"]), projected: G(P(3)) }, amounts, 2)).toEqual({ realised: "masked", projected: "secondary" });
  });

  it("seuil 2 : 2 et 3 personnes, rien n'est masqué ; seuil 3 : 2 sous le seuil, l'autre en second", () => {
    expect(maskNonRecurring({ realised: G(["q1", "q2"]), projected: G(P(3)) }, amounts, 2)).toEqual({ realised: "shown", projected: "shown" });
    expect(maskNonRecurring({ realised: G(["q1", "q2"]), projected: G(P(3)) }, amounts, 3)).toEqual({ realised: "masked", projected: "secondary" });
  });

  it("un total vide (0 contributeur, 0,00 €) n'est masqué qu'en second ; deux totaux vides restent affichés", () => {
    expect(maskNonRecurring({ realised: G([]), projected: G(["p1"]) }, { realised: 0, projected: 150_000 }, 3)).toEqual({ realised: "secondary", projected: "masked" });
    expect(maskNonRecurring({ realised: G([]), projected: G([]) }, { realised: 0, projected: 0 }, 3)).toEqual({ realised: "shown", projected: "shown" });
  });

  it("contributeurs non reliés (hypothèses sans contrat, embauche prévue) : total non dénombré sous le seuil, l'autre masqué en second ; au moins « seuil » personnes reliées suffisent", () => {
    // Déjà comptabilisés : 2 hypothèses, aucune personne → non vérifiable (seuil 2) ; prévus (4 personnes) masqués en second.
    expect(maskNonRecurring({ realised: G([], 2), projected: G(P(4)) }, amounts, 2)).toEqual({ realised: "unverifiable", projected: "secondary" });
    // Prévus : 2 personnes reliées + 1 embauche non reliée : 2 ≥ 2, affiché.
    expect(maskNonRecurring({ realised: G(["q1", "q2"]), projected: G(P(2), 1) }, amounts, 2)).toEqual({ realised: "shown", projected: "shown" });
    expect(maskNonRecurring({ realised: G(["q1", "q2"]), projected: G(P(2), 1) }, amounts, 3)).toEqual({ realised: "masked", projected: "unverifiable" });
  });

  it("contributeurs non dénombrés (contribution sans contrat ni hypothèse) : total non vérifiable, l'autre masqué en second", () => {
    expect(maskNonRecurring({ realised: G(P(4)), projected: null }, amounts, 2)).toEqual({ realised: "secondary", projected: "unverifiable" });
  });
});
