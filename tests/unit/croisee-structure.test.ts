import { describe, expect, it } from "vitest";
import { maskCohorts, partitionCohorts, type CohortPartition } from "@/lib/croisee/cohortes";
import { confidentialiteReason, effectifStructure, maskGroups, maskReason, maskRelations, personOf, personsByGroup, SEUIL_NON_VERIFIABLE, type MaskCell, type StructureContract } from "@/lib/croisee/structure";

// Structure de l'effectif (chapitre 02) : cas de référence écrits à la main, valeurs fictives. Six contrats de cinq personnes (la
// personne p1 a deux contrats) :
//   contrat  personne  temps plein  modalité        cadre dirigeant
//   c1       p1        oui          standard        non
//   c2       p2        oui          standard        non
//   c3       p3        non          standard        non
//   c4       p4        oui          forfait_jours   oui
//   c5       p5        (absent)     (absent)        non
//   c6       p1        non          standard        non
// Décompte à la main :
//   temps plein   = c1, c2, c4 → 3 contrats, 3 personnes (p1, p2, p4)
//   temps partiel = c3, c6     → 2 contrats, 2 personnes (p3, p1)
//   non renseigné = c5         → 1 contrat, 1 personne
//   forfait jours = c4         → 1 contrat, 1 personne
//   autres modalités = c1, c2, c3, c6 → 4 contrats, 3 personnes (p1, p2, p3)
//   modalité non renseignée = c5 → 1 contrat, 1 personne
//   cadres dirigeants = c4 → 1 contrat, 1 personne ; hors cadres dirigeants = c1, c2, c3, c5, c6 → 5 contrats, 4 personnes
const DROIT = "droit contracts:time-information:read non accordé à la clé";
const c = (contractKey: string, personKey: string | null, isFullTimeAtRead: boolean | null, modalityAtRead: string | null, executive: boolean | null): StructureContract => ({
  contractKey,
  personKey,
  isFullTimeAtRead,
  modalityAtRead,
  executive,
  fieldsNd: {
    ...(isFullTimeAtRead === null ? { isFullTimeAtRead: { reason: DROIT } } : {}),
    ...(modalityAtRead === null ? { modalityAtRead: { reason: DROIT } } : {}),
    ...(executive === null ? { executive: { reason: "non renseigné dans PayFit" } } : {}),
  },
});
const POP: StructureContract[] = [
  c("c1", "p1", true, "standard", false),
  c("c2", "p2", true, "standard", false),
  c("c3", "p3", false, "standard", false),
  c("c4", "p4", true, "forfait_jours", true),
  c("c5", "p5", null, null, false),
  c("c6", "p1", false, "standard", false),
];
type Shown = Record<string, number | string>;
// Lecture à plat : libellé → nombre de contrats, ou « n.d. : raison ».
const flat = (s: ReturnType<typeof effectifStructure>): Shown => {
  if (s.kind === "nd") return { nd: s.reason };
  const out: Shown = { total: s.total };
  for (const d of s.dimensions) {
    if (d.nd !== null) out[d.label] = `n.d. : ${d.nd}`;
    for (const g of d.groups) out[g.label] = g.cell.kind === "value" ? g.cell.contracts : `n.d. : ${g.cell.reason}`;
  }
  return out;
};

describe("maskGroups : seuil de confidentialité et masquage secondaire (cas écrits à la main)", () => {
  const g = (size: number | null, value: number | null) => ({ size, value });
  it("une seule cellule sous le seuil dans un ensemble dont le total est affiché : la plus petite cellule affichée qui compte des personnes est masquée aussi", () => {
    // Seuil 2 : 1 personne < 2 → masquée ; plus petite affichée : 3 (et non 5) ; masquées ensemble : 1 + 3 = 4 personnes ≥ 2.
    expect(maskGroups([g(3, 3), g(1, 1), g(5, 5)], 2, true)).toEqual(["secondary", "masked", "shown"]);
    // À égalité, la première dans l'ordre.
    expect(maskGroups([g(3, 3), g(3, 3), g(1, 1)], 2, true)).toEqual(["secondary", "shown", "masked"]);
    // Un groupe vide ne protège personne : total − 5 donnerait 1 + 0, la valeur du groupe masqué. Le groupe de 5 est masqué.
    expect(maskGroups([g(0, 0), g(1, 1), g(5, 5)], 2, true)).toEqual(["shown", "masked", "secondary"]);
  });
  it("cas (b) : un groupe de taille 0 à valeur non nulle (lignes sans contrat) ne compte pas comme protection", () => {
    // Seuil 3 : 1 personne (40) masquée. Avant : le plus petit affiché, la ligne sans contrat (10), était masqué en second, et
    // total − 60 = 50 = 40 + 10 décrivait une seule personne. Désormais le groupe de 6 personnes (60) est masqué : 1 + 6 = 7 ≥ 3 ;
    // la ligne sans contrat reste affichée (total − 10 = 40 + 60, sept personnes).
    expect(maskGroups([g(1, 40), g(0, 10), g(6, 60)], 3, true)).toEqual(["masked", "shown", "secondary"]);
  });
  it("cas (c) : le secondaire minimal suffit — un seul groupe ajouté quand il porte l'ensemble masqué au seuil", () => {
    // Seuil 3 : 1 personne (40) masquée ; groupes affichés de 3 (25), 5 (15) et 9 (90) personnes. Plus petite valeur affichée : 15
    // (5 personnes) → 1 + 5 = 6 ≥ 3, deux groupes masqués : on s'arrête là, 25 et 90 restent affichés.
    expect(maskGroups([g(1, 40), g(3, 25), g(5, 15), g(9, 90)], 3, true)).toEqual(["masked", "shown", "secondary", "shown"]);
    // Deux groupes sous le seuil qui comptent ensemble 1 + 2 = 3 personnes : aucun secondaire.
    expect(maskGroups([g(1, 40), g(4, 25), g(2, 15), g(9, 90)], 3, true)).toEqual(["masked", "shown", "masked", "shown"]);
  });
  it("l'ensemble masqué compte au moins « seuil » personnes : deux groupes d'une personne ne suffisent pas à 3", () => {
    // Seuil 2 : 1 + 1 = 2 ≥ 2, rien de plus. Seuil 3 : 1 + 1 = 2 < 3 → le groupe de 4 est masqué aussi.
    expect(maskGroups([g(1, 1), g(1, 1), g(4, 4)], 2, true)).toEqual(["masked", "masked", "shown"]);
    expect(maskGroups([g(1, 1), g(1, 1), g(4, 4)], 3, true)).toEqual(["masked", "masked", "secondary"]);
  });
  it("personnes distinctes : une personne présente dans deux groupes masqués n'y compte qu'une fois (membres fournis)", () => {
    // Seuil 3. A = {p1, p2} (5), B = {p1} (3), C = {p3, p4, p5} (9), D = {p1, p2} (4) : A, B, D masqués (2, 1, 2 personnes).
    // Tailles additionnées : 2 + 1 + 2 = 5 ≥ 3 ; personnes distinctes : {p1, p2} = 2 < 3 → C est masqué en second.
    const m = (size: number, value: number, members: string[]) => ({ size, value, members });
    expect(maskGroups([m(2, 5, ["p1", "p2"]), m(1, 3, ["p1"]), m(3, 9, ["p3", "p4", "p5"]), m(2, 4, ["p1", "p2"])], 3, true)).toEqual(["masked", "masked", "secondary", "masked"]);
    // Sans les membres, les tailles sont additionnées (5 ≥ 3) : rien de plus n'est masqué.
    expect(maskGroups([g(2, 5), g(1, 3), g(3, 9), g(2, 4)], 3, true)).toEqual(["masked", "masked", "shown", "masked"]);
  });
  it("total non affiché : aucun masquage secondaire ; une cellule déjà n.d. apporte sa taille quand elle est connue", () => {
    expect(maskGroups([g(1, 1), g(4, 4)], 2, false)).toEqual(["masked", "shown"]);
    // n.d. de 3 personnes + 1 masquée = 4 ≥ 2, deux cellules cachées : rien de plus.
    expect(maskGroups([g(3, null), g(1, 1), g(4, 4)], 2, true)).toEqual(["nd", "masked", "shown"]);
    // n.d. de taille inconnue : n'apporte aucune personne comptée → le groupe de 4 est masqué.
    expect(maskGroups([g(null, null), g(1, 1), g(4, 4)], 2, true)).toEqual(["nd", "masked", "secondary"]);
  });
  it("effectif non dénombré : non vérifiable, protégé comme une cellule masquée ; groupe vide jamais masqué au premier tour", () => {
    expect(maskGroups([g(null, 7), g(4, 4), g(6, 6)], 2, true)).toEqual(["unverifiable", "secondary", "shown"]);
    expect(maskGroups([g(0, 0), g(4, 4)], 2, true)).toEqual(["shown", "shown"]);
    // Seul groupe : il vaut le total déjà publié, rien d'autre à masquer.
    expect(maskGroups([g(1, 1)], 2, true)).toEqual(["masked"]);
  });
  it("impossible d'atteindre le seuil avec les autres groupes : toute la relation est masquée (le total, de toute l'entreprise, reste)", () => {
    // Seuil 3 : 2 personnes masquées ; l'autre groupe est vide → aucune protection possible → masqué aussi.
    expect(maskGroups([g(2, 2), g(0, 0)], 3, true)).toEqual(["masked", "secondary"]);
  });
  it("raison : la même pour le masquage principal et secondaire ; une seule formulation, avec l'unité comptée", () => {
    expect(maskReason("masked", 2)).toBe(maskReason("secondary", 2));
    expect(confidentialiteReason(2)).toBe("non affiché (seuil de confidentialité : 2 personnes)");
    expect(confidentialiteReason(1)).toBe("non affiché (seuil de confidentialité : 1 personne)");
    expect(confidentialiteReason(3, "contrats")).toBe("non affiché (seuil de confidentialité : 3 contrats)");
    expect(confidentialiteReason(1, "contrats")).toBe("non affiché (seuil de confidentialité : 1 contrat)");
    expect(maskReason("secondary", 3, "contrats")).toBe(confidentialiteReason(3, "contrats"));
    expect(maskReason("unverifiable", 2)).toBe(SEUIL_NON_VERIFIABLE);
    expect(maskReason("shown", 2)).toBeNull();
  });
});

describe("maskRelations : plusieurs relations, total masquable, lignes en bloc (cas écrits à la main)", () => {
  // Tableau à lignes en bloc, forme des contrats observés (seuil 3) : lignes « N-1 seulement » (1 contrat), « N seulement »
  // (0 contrat), « les deux » (20 contrats), lignes sans contrat (0 contrat) ; colonnes Contrats, Coût N-1, Coût N, Contribution,
  // chacune avec son total affiché. Montants fictifs en centimes : la sortie 300 000 (3 000,00 €) en N-1 ; les deux 6 000 000 en N-1 et
  // 6 300 000 en N ; sans contrat 50 000 en N-1 et 70 000 en N.
  type Row = "sortie" | "entree" | "deux" | "hors";
  const SIZE: Record<Row, number> = { sortie: 1, entree: 0, deux: 20, hors: 0 };
  const COLUMNS: [Row, number][][] = [
    [["sortie", 1], ["entree", 0], ["deux", 20]],
    [["sortie", 300_000], ["deux", 6_000_000], ["hors", 50_000]],
    [["entree", 0], ["deux", 6_300_000], ["hors", 70_000]],
    [["sortie", 300_000], ["entree", 0], ["deux", 300_000], ["hors", 20_000]],
  ];
  const rowStatus = (cols: [Row, number][][], sizes: Record<Row, number>, seuil: number) => {
    const cells: (MaskCell & { row: Row })[] = [];
    const rels = cols.map((col) => ({ cells: col.map(([row, v]) => cells.push({ row, size: sizes[row], value: v, block: row }) - 1) }));
    const st = maskRelations(cells, rels, seuil);
    const out: Partial<Record<Row, string>> = {};
    cells.forEach((c, i) => {
      out[c.row] = out[c.row] === undefined || out[c.row] === "shown" ? st[i] : out[c.row];
    });
    return out;
  };

  it("cas (a) contrats observés, seuil 3, 1 sortie et aucune entrée : la sortie ne se lit plus, ni par la ligne vide ni par les lignes sans contrat", () => {
    // Contrats : sortie (1) masquée ; « N seulement » (vide) ne protège pas → « les deux » (20) masqué : 21 ≥ 3.
    // Coût N : « les deux » serait la seule ligne masquée ; « N seulement » et les lignes sans contrat ne décrivent personne →
    // protection impossible : toute la colonne est masquée, et chaque ligne l'est en bloc. Seul le total reste affiché.
    expect(rowStatus(COLUMNS, SIZE, 3)).toEqual({ sortie: "masked", entree: "secondary", deux: "secondary", hors: "secondary" });
    // Même résultat par maskCohorts (contrats observés du chapitre 06), sur la partition construite à la main.
    const prev = new Map<string, number>([["S", 300_000], ["hors", 50_000]]);
    const cur = new Map<string, number>([["hors", 70_000]]);
    for (let i = 1; i <= 20; i++) {
      prev.set(`B${i}`, 300_000);
      cur.set(`B${i}`, 315_000);
    }
    const p = partitionCohorts(prev, cur, "hors") as Extract<CohortPartition, { kind: "value" }>;
    expect([p.onlyPrev.count, p.onlyCur.count, p.both.count, p.onlyPrev.prev, p.both.prev, p.both.cur]).toEqual([1, 0, 20, 300_000, 6_000_000, 6_300_000]);
    expect(maskCohorts(p, 3)).toEqual({ onlyPrev: "masked", onlyCur: "secondary", both: "secondary", outside: "secondary" });
  });

  it("avec une entrée de 3 contrats : la sortie est protégée par la plus petite ligne qui compte des contrats, les lignes sans contrat restent", () => {
    // Contrats : sortie (1) masquée → « N seulement » (3, plus petit que 20) : 1 + 3 = 4 ≥ 3. Coût N-1 : sortie seule masquée →
    // « les deux » (seule ligne qui compte des contrats) : 21. Coût N et Contribution : deux lignes masquées, 23 contrats. Les lignes
    // sans contrat, qui ne protègent personne, ne sont jamais retenues.
    const cols: [Row, number][][] = [
      [["sortie", 1], ["entree", 3], ["deux", 20]],
      [["sortie", 300_000], ["deux", 6_000_000], ["hors", 50_000]],
      [["entree", 900_000], ["deux", 6_300_000], ["hors", 70_000]],
      [["sortie", 300_000], ["entree", 900_000], ["deux", 300_000], ["hors", 20_000]],
    ];
    expect(rowStatus(cols, { ...SIZE, entree: 3 }, 3)).toEqual({ sortie: "masked", entree: "secondary", deux: "secondary", hors: "shown" });
  });

  it("total masquable : quand rien d'autre ne protège la relation, le total est masqué (et non les autres cellules)", () => {
    // Seuil 3 : seule cellule de la relation, 2 personnes (14) ; total « tous motifs » (somme publiée) → masqué.
    const cells: MaskCell[] = [{ size: 2, value: 14 }, { size: null, value: 29, onlyAsTotal: true }, { size: 4, value: 15, exempt: true }];
    expect(maskRelations(cells, [{ cells: [0], total: 1 }], 3)).toEqual(["masked", "secondary", "shown"]);
    // Avec une autre cellule de 5 personnes : elle suffit, le total reste affiché.
    expect(maskRelations([...cells, { size: 5, value: 40 }], [{ cells: [0, 3], total: 1 }], 3)).toEqual(["masked", "shown", "shown", "secondary"]);
  });

  it("total masqué dont toutes les cellules sont affichées : la plus petite cellule qui décrit quelqu'un est masquée", () => {
    // Total non dénombré (15) ; cellules 6 (3 personnes), 0 (vide), 9 (4 personnes) → 6 masquée, la cellule vide reste.
    const cells: MaskCell[] = [{ size: 3, value: 6 }, { size: 0, value: 0 }, { size: 4, value: 9 }, { size: null, value: 15 }];
    expect(maskRelations(cells, [{ cells: [0, 1, 2], total: 3 }], 3)).toEqual(["secondary", "shown", "shown", "unverifiable"]);
  });

  it("une cellule secondaire seule dans une seconde relation est protégée à son tour (deux cellules qui décrivent quelqu'un)", () => {
    // Relation 1 : a (1 personne) + b (4) → b secondaire (5 ≥ 3). Relation 2 : b, c (5), d (6) : b seule masquée se lirait
    // (total − c − d), et avec elle a → c (10 < 12) masquée aussi.
    const cells: MaskCell[] = [
      { size: 1, value: 3 },
      { size: 4, value: 8 },
      { size: 5, value: 10 },
      { size: 6, value: 12 },
    ];
    expect(maskRelations(cells, [{ cells: [0, 1] }, { cells: [1, 2, 3] }], 3)).toEqual(["masked", "secondary", "secondary", "shown"]);
  });
});

describe("personsByGroup : effectif d'un groupe en personnes distinctes (cas écrits à la main)", () => {
  it("une personne avec deux contrats simultanés dans un groupe y compte une fois ; un contrat sans personne compte pour une personne", () => {
    // Groupe A : contrats a1 et a2 de la personne q1, contrat a3 de q2 → 3 contrats, 2 personnes.
    // Groupe B : contrat b1 de q1 (déjà comptée dans A : elle compte aussi dans B), contrats b2 et b3 sans personne → 3 personnes.
    // Groupe C : contrats c1 et c2 de la personne q3 → 2 contrats, 1 personne.
    const members = [
      { group: "A", person: personOf({ contractKey: "a1", personKey: "q1" }) },
      { group: "A", person: personOf({ contractKey: "a2", personKey: "q1" }) },
      { group: "A", person: personOf({ contractKey: "a3", personKey: "q2" }) },
      { group: "B", person: personOf({ contractKey: "b1", personKey: "q1" }) },
      { group: "B", person: personOf({ contractKey: "b2", personKey: null }) },
      { group: "B", person: personOf({ contractKey: "b3", personKey: null }) },
      { group: "C", person: personOf({ contractKey: "c1", personKey: "q3" }) },
      { group: "C", person: personOf({ contractKey: "c2", personKey: "q3" }) },
    ];
    expect(personsByGroup(members)).toEqual({ A: 2, B: 3, C: 1 });
    expect(personOf({ contractKey: "b2", personKey: null })).toBe("contrat:b2");
    expect(personsByGroup([])).toEqual({});
    // Seuil 2 : C (2 contrats, 1 personne) est masqué ; A (2 personnes, plus petite cellule affichée) l'est en secondaire.
    const sizes = personsByGroup(members);
    expect(maskGroups([{ size: sizes.A, value: 3 }, { size: sizes.B, value: 3 }, { size: sizes.C, value: 2 }], 2, true)).toEqual(["secondary", "shown", "masked"]);
  });
});

describe("effectifStructure : cas de référence", () => {
  it("seuil de confidentialité à 1 : tous les groupes affichés, chaque caractéristique somme au total", () => {
    expect(flat(effectifStructure({ contracts: POP, confidentialite: { kind: "set", value: 1 } }))).toEqual({
      total: 6,
      "Temps plein": 3,
      "Temps partiel": 2,
      "Temps de travail non renseigné": 1,
      "Forfait jours": 1,
      "Autres modalités du temps de travail": 4,
      "Modalité non renseignée": 1,
      "Cadres dirigeants": 1,
      "Salariés hors cadres dirigeants": 5,
    });
  });

  it("seuil à 2 : groupes d'une personne masqués, masquage secondaire dans chaque caractéristique, total inchangé", () => {
    const n2 = `n.d. : ${confidentialiteReason(2)}`;
    // Temps : « non renseigné » (1 personne) masqué, seul masqué → le plus petit affiché (temps partiel, 2) l'est aussi.
    // Modalité : forfait jours et modalité non renseignée (1 personne chacun) : deux masqués, rien de plus.
    // Statut : cadres dirigeants (1) masqué, seul autre groupe (hors cadres dirigeants) masqué aussi.
    expect(flat(effectifStructure({ contracts: POP, confidentialite: { kind: "set", value: 2 } }))).toEqual({
      total: 6,
      "Temps plein": 3,
      "Temps partiel": n2,
      "Temps de travail non renseigné": n2,
      "Forfait jours": n2,
      "Autres modalités du temps de travail": 4,
      "Modalité non renseignée": n2,
      "Cadres dirigeants": n2,
      "Salariés hors cadres dirigeants": n2,
    });
  });

  it("le seuil compte des personnes, pas des contrats : à 4, « autres modalités » (4 contrats, 3 personnes) est masqué", () => {
    const n4 = `n.d. : ${confidentialiteReason(4)}`;
    const s = flat(effectifStructure({ contracts: POP, confidentialite: { kind: "set", value: 4 } }));
    expect(s["Autres modalités du temps de travail"]).toBe(n4);
    expect(s["Temps plein"]).toBe(n4); // 3 personnes
    // Hors cadres dirigeants (4 personnes) atteint le seuil, mais c'est le seul autre groupe : masquage secondaire.
    expect(s["Salariés hors cadres dirigeants"]).toBe(n4);
    expect(s.total).toBe(6);
  });

  it("un groupe vide reste à 0 et ne protège jamais un autre groupe : le masquage secondaire retient un groupe qui compte des personnes", () => {
    const sans = POP.filter((x) => x.contractKey !== "c4");
    const s = flat(effectifStructure({ contracts: sans, confidentialite: { kind: "set", value: 3 } }));
    // Statut : cadres dirigeants 0, hors cadres dirigeants 5 contrats (4 personnes ≥ 3) : rien de masqué.
    expect(s["Cadres dirigeants"]).toBe(0);
    expect(s["Salariés hors cadres dirigeants"]).toBe(5);
    // Modalité : non renseignée (1 personne) masquée. Forfait jours (0) ne protège personne : total − 4 donnerait 1 + 0. Le groupe
    // « autres modalités » (4 contrats, 3 personnes) est masqué : 1 + 3 = 4 personnes ≥ 3 ; forfait jours reste à 0.
    expect(s["Forfait jours"]).toBe(0);
    expect(s["Autres modalités du temps de travail"]).toBe(`n.d. : ${confidentialiteReason(3)}`);
    expect(s["Modalité non renseignée"]).toBe(`n.d. : ${confidentialiteReason(3)}`);
    expect(s.total).toBe(5);
  });

  it("personnes distinctes : une personne dont deux contrats sont dans deux groupes masqués n'y compte qu'une fois", () => {
    // f1 (q1, partiel), f2 (q2, partiel), f3 (q1, temps non renseigné), f4 à f6 (q3, q4, q5, temps plein). Seuil 3 : partiel
    // ({q1, q2}, 2 personnes) et non renseigné ({q1}, 1 personne) masqués. Tailles additionnées : 2 + 1 = 3 ; personnes distinctes :
    // {q1, q2} = 2 < 3 → temps plein ({q3, q4, q5}) est masqué aussi. Modalité et statut : un seul groupe peuplé (6 contrats).
    const pop = [
      c("f1", "q1", false, "standard", false),
      c("f2", "q2", false, "standard", false),
      c("f3", "q1", null, "standard", false),
      c("f4", "q3", true, "standard", false),
      c("f5", "q4", true, "standard", false),
      c("f6", "q5", true, "standard", false),
    ];
    const n3 = `n.d. : ${confidentialiteReason(3)}`;
    const s = flat(effectifStructure({ contracts: pop, confidentialite: { kind: "set", value: 3 } }));
    expect([s["Temps plein"], s["Temps partiel"], s["Temps de travail non renseigné"]]).toEqual([n3, n3, n3]);
    expect([s["Forfait jours"], s["Autres modalités du temps de travail"], s["Cadres dirigeants"], s["Salariés hors cadres dirigeants"]]).toEqual([0, 6, 0, 6]);
    expect(s.total).toBe(6);
  });

  it("une caractéristique absente pour toute la population est n.d. avec la raison de la source (jamais « tout non renseigné »)", () => {
    const dsn: StructureContract[] = ["d1", "d2"].map((k, i) => ({
      contractKey: k,
      personKey: `q${i}`,
      isFullTimeAtRead: null,
      modalityAtRead: null,
      executive: null,
      fieldsNd: { isFullTimeAtRead: { reason: "quotités par mois sur la DSN (voir la table mensuelle)" }, modalityAtRead: { reason: "modalité par mois sur la DSN (voir la table mensuelle)" }, executive: { reason: "non porté par la DSN" } },
    }));
    const s = effectifStructure({ contracts: dsn, confidentialite: { kind: "set", value: 1 } });
    expect(s.kind).toBe("value");
    if (s.kind !== "value") return;
    expect(s.total).toBe(2);
    expect(s.dimensions.map((d) => [d.key, d.nd, d.groups.length])).toEqual([
      ["temps", "quotités par mois sur la DSN (voir la table mensuelle)", 0],
      ["modalite", "modalité par mois sur la DSN (voir la table mensuelle)", 0],
      ["statut", "non porté par la DSN", 0],
    ]);
  });

  it("un contrat sans personne rattachée compte pour une personne distincte", () => {
    const orphelins = [c("o1", null, false, "standard", false), c("o2", null, false, "standard", false)];
    const s = flat(effectifStructure({ contracts: orphelins, confidentialite: { kind: "set", value: 2 } }));
    expect(s["Temps partiel"]).toBe(2);
    expect(s["Temps plein"]).toBe(0);
  });

  it("sans seuil de confidentialité : toute la structure est n.d. avec la raison (aucun masquage par défaut)", () => {
    expect(effectifStructure({ contracts: POP, confidentialite: { kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" } })).toEqual({ kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" });
    expect(effectifStructure({ contracts: POP, confidentialite: { kind: "set", value: 0 } }).kind).toBe("nd");
    expect(effectifStructure({ contracts: POP, confidentialite: { kind: "set", value: 1.5 } }).kind).toBe("nd");
  });

  it("population vide : total 0, groupes à 0", () => {
    const s = flat(effectifStructure({ contracts: [], confidentialite: { kind: "set", value: 5 } }));
    expect(s).toEqual({ total: 0, "Temps plein": 0, "Temps partiel": 0, "Forfait jours": 0, "Autres modalités du temps de travail": 0, "Cadres dirigeants": 0, "Salariés hors cadres dirigeants": 0 });
  });
});
