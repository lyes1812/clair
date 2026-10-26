import { describe, expect, it } from "vitest";
import { confidentialiteReason, effectifStructure, maskGroups, maskReason, SEUIL_NON_VERIFIABLE, type StructureContract } from "@/lib/croisee/structure";

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
  it("une seule cellule sous le seuil dans un ensemble dont le total est affiché : la plus petite cellule affichée est masquée aussi", () => {
    // Seuil 2 : 1 personne < 2 → masquée ; plus petite affichée : 3 (et non 5).
    expect(maskGroups([g(3, 3), g(1, 1), g(5, 5)], 2, true)).toEqual(["secondary", "masked", "shown"]);
    // À égalité, la première dans l'ordre.
    expect(maskGroups([g(3, 3), g(3, 3), g(1, 1)], 2, true)).toEqual(["secondary", "shown", "masked"]);
    // Un groupe vide peut être retenu comme cellule secondaire (la plus petite affichée).
    expect(maskGroups([g(0, 0), g(1, 1), g(5, 5)], 2, true)).toEqual(["secondary", "masked", "shown"]);
  });
  it("deux cellules masquées, ou total non affiché : aucun masquage secondaire", () => {
    expect(maskGroups([g(1, 1), g(1, 1), g(4, 4)], 2, true)).toEqual(["masked", "masked", "shown"]);
    expect(maskGroups([g(1, 1), g(4, 4)], 2, false)).toEqual(["masked", "shown"]);
    // Une cellule déjà n.d. (raison propre) compte comme cachée : avec une cellule masquée, deux cellules cachées.
    expect(maskGroups([g(3, null), g(1, 1), g(4, 4)], 2, true)).toEqual(["nd", "masked", "shown"]);
  });
  it("effectif non dénombré : non vérifiable, protégé comme une cellule masquée ; groupe vide jamais masqué au premier tour", () => {
    expect(maskGroups([g(null, 7), g(4, 4), g(6, 6)], 2, true)).toEqual(["unverifiable", "secondary", "shown"]);
    expect(maskGroups([g(0, 0), g(4, 4)], 2, true)).toEqual(["shown", "shown"]);
    // Seul groupe : il vaut le total déjà publié, rien d'autre à masquer.
    expect(maskGroups([g(1, 1)], 2, true)).toEqual(["masked"]);
  });
  it("raison : la même pour le masquage principal et secondaire (rien ne dit laquelle des deux cellules est sous le seuil)", () => {
    expect(maskReason("masked", 2)).toBe(maskReason("secondary", 2));
    expect(confidentialiteReason(2)).toBe("non affiché (seuil de confidentialité : 2 personnes)");
    expect(confidentialiteReason(1)).toBe("non affiché (seuil de confidentialité : 1 personne)");
    expect(maskReason("unverifiable", 2)).toBe(SEUIL_NON_VERIFIABLE);
    expect(maskReason("shown", 2)).toBeNull();
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

  it("un groupe vide reste à 0 quand rien n'est à protéger ; il peut être retenu par le masquage secondaire", () => {
    const sans = POP.filter((x) => x.contractKey !== "c4");
    const s = flat(effectifStructure({ contracts: sans, confidentialite: { kind: "set", value: 3 } }));
    // Statut : cadres dirigeants 0, hors cadres dirigeants 5 contrats (4 personnes ≥ 3) : rien de masqué.
    expect(s["Cadres dirigeants"]).toBe(0);
    expect(s["Salariés hors cadres dirigeants"]).toBe(5);
    // Modalité : non renseignée (1 personne) masquée, seule ; la plus petite affichée est forfait jours (0).
    expect(s["Forfait jours"]).toBe(`n.d. : ${confidentialiteReason(3)}`);
    expect(s["Autres modalités du temps de travail"]).toBe(4);
    expect(s.total).toBe(5);
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
