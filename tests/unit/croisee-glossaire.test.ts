import { describe, expect, it } from "vitest";
import { glossaryEntry } from "@/lib/glossary";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { maskNonRecurring, maskCohorts, partitionCohorts } from "@/lib/croisee/cohortes";
import { KEY_FIGURES_TITLE, keyFiguresTable, ND_SHEET, REFERENCE_TITLE, WATCH_SHEET } from "@/lib/croisee/export";
import { confidentialiteReason, maskGroups, personOf, personsByGroup, SEUIL_NON_VERIFIABLE } from "@/lib/croisee/structure";
import { congesMask } from "@/lib/viz/croisee-absences";
import { publicProjectionReasons, serviceSousSeuil } from "@/lib/viz/croisee-budget";
import { exitMotifRows } from "@/lib/viz/croisee-effectifs";
import { N1_NEGATIF, N1_NUL } from "@/lib/viz/croisee-masse";
import { maskServices, SEUIL_NON_VERIFIABLE as PAIE_NON_VERIFIABLE, sousSeuil } from "@/lib/viz/croisee-paie";

// Règle 6 : les définitions de la Masse salariale croisée disent ce que le code fait. Chaque phrase vérifiée ici l'est sur la fonction
// qui la met en œuvre, avec un cas écrit à la main (valeurs fictives, aucune donnée réelle).
const def = (id: string) => glossaryEntry(id)!.definition;

describe("glossaire de la Masse salariale croisée ↔ code", () => {
  it("seuil de confidentialité : raisons citées, toutes en « non affiché » ; groupe non dénombré « non vérifiable »", () => {
    const conf = def(T.confidentialite);
    expect(conf).toContain(`« ${confidentialiteReason(2).replace("2 personnes", "N personnes")} »`);
    expect(conf).toContain(`« ${sousSeuil(2).replace("2 contrats", "N contrats")} »`);
    for (const r of [confidentialiteReason(3), sousSeuil(3), serviceSousSeuil(3)]) expect(r.startsWith("non affiché")).toBe(true);
    for (const r of [SEUIL_NON_VERIFIABLE, PAIE_NON_VERIFIABLE]) expect(r).toContain("seuil de confidentialité non vérifiable");
    expect(conf).toContain("« seuil de confidentialité non vérifiable »");
    // Groupe vide (0) : affiché ; effectif non dénombré (null) : non vérifiable ; 1 personne avec un seuil de 3 : masqué.
    expect(maskGroups([{ size: 0, value: 0 }, { size: null, value: 4 }, { size: 1, value: 1 }, { size: 5, value: 5 }], 3, false)).toEqual(["shown", "unverifiable", "masked", "shown"]);
  });

  it("seuil de 1 : aucun groupe dénombré n'est masqué, pas même un service sans contrat rattaché", () => {
    expect(def(T.confidentialite)).toContain("avec 1, aucun groupe dénombré n'est masqué");
    expect(maskGroups([{ size: 1, value: 1 }, { size: 9, value: 9 }], 1, true)).toEqual(["shown", "shown"]);
    expect(maskServices([{ size: 0, order: 500, nonZero: true }, { size: 1, order: 100 }], 1)).toEqual(["shown", "shown"]);
  });

  it("Paie & comptabilité : un service sans contrat rattaché de valeur non nulle est masqué (seuil ≥ 2) ; un contrat présent dans deux services masqués compte une fois", () => {
    const conf = def(T.confidentialite);
    expect(conf).toContain("un contrat présent dans deux services masqués ne compte qu'une fois");
    expect(conf).toContain("un service sans contrat rattaché (« Non ventilé », par exemple) ne suffit jamais à en protéger un autre");
    // Seuil 2 : « Non ventilé » (0 contrat, 500 €) masqué ; il n'ajoute aucun contrat, le service suivant (5 contrats) est masqué aussi.
    expect(maskServices([{ size: 0, order: 50_000, nonZero: true }, { size: 5, order: 100_000 }], 2)).toEqual(["masked", "secondary"]);
    // Sans contrat et de valeur nulle : rien à protéger.
    expect(maskServices([{ size: 0, order: 0, nonZero: false }, { size: 5, order: 100_000 }], 2)).toEqual(["shown", "shown"]);
    // Seuil 2 : deux services d'un contrat chacun, le MÊME contrat « c1 » : un seul contrat distinct masqué, le troisième service
    // (3 contrats) est masqué à son tour.
    const st = maskServices(
      [
        { size: 1, order: 10_000, contracts: ["c1"] },
        { size: 1, order: 20_000, contracts: ["c1"] },
        { size: 3, order: 30_000, contracts: ["c2", "c3", "c4"] },
      ],
      2,
    );
    expect(st).toEqual(["masked", "masked", "secondary"]);
  });

  it("Effectifs & mouvements : groupes comptés en personnes distinctes ; un contrat sans personne compte pour une personne", () => {
    const conf = def(T.confidentialite);
    expect(conf).toContain("une personne qui a deux contrats dans un même groupe y compte une fois");
    expect(def(T.repartitionEffectifs)).toContain("une personne qui a deux contrats simultanés dans le groupe y compte une fois");
    // Personne « p1 » avec deux contrats dans le groupe A : 1 personne ; deux contrats sans personne : 2 personnes.
    const m = [
      { group: "A", person: personOf({ contractKey: "k1", personKey: "p1" }) },
      { group: "A", person: personOf({ contractKey: "k2", personKey: "p1" }) },
      { group: "B", person: personOf({ contractKey: "k3", personKey: null }) },
      { group: "B", person: personOf({ contractKey: "k4", personKey: null }) },
    ];
    expect(personsByGroup(m)).toEqual({ A: 1, B: 2 });
  });

  it("motifs de sortie : un motif sous le seuil rejoint « Autres motifs (k motifs) », masqué avec masquage secondaire", () => {
    expect(def(T.journalMouvements)).toContain("« Autres motifs (k motifs) », lui-même masqué s'il concerne de 1 à (seuil − 1) personnes, avec masquage secondaire");
    // Seuil 2 : motif « X1 » pour 3 personnes, motif « X2 » pour 1 personne. X2 n'est pas nommé ; « Autres motifs (1 motif) » est masqué
    // et X1, seul autre groupe affiché, l'est au masquage secondaire ; le total (4) reste affiché.
    const ev = (endReason: string, person: string) => ({ month: "2026-01", kind: "exit" as const, nature: "cdi", endReason, person });
    const out = exitMotifRows([ev("X1", "p1"), ev("X1", "p2"), ev("X1", "p3"), ev("X2", "p4")], 2);
    expect(out.rows.map((r) => r.label)).toHaveLength(2);
    expect(out.rows[1].label).toBe("Autres motifs (1 motif)");
    expect(out.rows.map((r) => typeof r.cell === "object" && r.cell !== null && "nd" in r.cell)).toEqual([true, true]);
    expect(out.total).toBe(4);
  });

  it("absences : la ligne du seul motif retenu présent dans la lecture n'est pas masquée ; un autre cas l'est", () => {
    const conf = def(T.confidentialite);
    expect(conf).toContain("la ligne du motif retenu quand c'est le seul motif retenu présent dans la lecture (elle égale alors la tuile Absentéisme)");
    expect(def(T.congesPris)).toContain("Un motif dont toutes les valeurs sont masquées garde sa ligne et son nom.");
    // Un motif retenu, 1 personne, 4 demi-journées en janvier ; seuil 3.
    const cell = { kind: "exact" as const, half: 4, persons: 1 };
    const grid = (exempt: number | null) => ({
      lines: [{ chosen: true, months: [cell], total: cell, prev: undefined }],
      exempt,
      published: { months: [true], retainedCur: true, allCur: true, retainedPrev: false, allPrev: false },
    });
    const free = congesMask(grid(0), 3);
    expect([free.months[0][0], free.cur[0]]).toEqual(["shown", "shown"]);
    const hidden = congesMask(grid(null), 3);
    expect([hidden.months[0][0], hidden.cur[0]]).toEqual(["masked", "masked"]);
  });

  it("éléments non récurrents : quand l'un des deux totaux est masqué, l'autre l'est aussi (zéro compris)", () => {
    expect(def(T.confidentialite)).toContain("quand l'un est masqué, l'autre l'est aussi, et la cascade du retraité n'est pas tracée");
    expect(def(T.atterrissage)).toContain("quand l'un est masqué, l'autre l'est aussi et la cascade du retraité n'est pas tracée");
    // Seuil 2 : 1 hypothèse déjà comptabilisée (50 €) ; 4 contrats prévus (200 €).
    expect(maskNonRecurring({ realised: 1, projected: 4 }, { realised: 5_000, projected: 20_000 }, 2)).toEqual({ realised: "masked", projected: "secondary" });
    // Aucun contributeur déjà comptabilisé (0 €) ; 1 contrat prévu (30 €) : le total nul est masqué au masquage secondaire.
    expect(maskNonRecurring({ realised: 0, projected: 1 }, { realised: 0, projected: 3_000 }, 2)).toEqual({ realised: "secondary", projected: "masked" });
    // Contribution sans contrat ni hypothèse : non vérifiable.
    expect(maskNonRecurring({ realised: 2, projected: null }, { realised: 5_000, projected: 3_000 }, 2).projected).toBe("unverifiable");
  });

  it("contrats observés : la ligne des lignes sans contrat n'est masquée qu'au masquage secondaire", () => {
    expect(def(T.confidentialite)).toContain("La ligne « Lignes du journal sans contrat » des contrats observés ne décrit aucune personne : elle n'est masquée qu'au masquage secondaire.");
    // N-1 : a = 100 (N-1 seulement), b = 200 et d = 50 (les deux), x = 10 (sans contrat) ; N : b = 250, d = 60, c = 80 (N seulement),
    // x = 30. Seuil 2 : « N-1 seulement » et « N seulement » (1 contrat chacun) masqués ; dans la colonne N-1, la ligne sans contrat
    // (10, plus petite valeur affichée) protège « N-1 seulement ».
    const p = partitionCohorts(
      new Map([
        ["a", 100],
        ["b", 200],
        ["d", 50],
        ["x", 10],
      ]),
      new Map([
        ["b", 250],
        ["d", 60],
        ["c", 80],
        ["x", 30],
      ]),
      "x",
    );
    expect(p.kind).toBe("value");
    if (p.kind !== "value") return;
    expect(maskCohorts(p, 2)).toEqual({ onlyPrev: "masked", onlyCur: "masked", both: "shown", outside: "secondary" });
    // Sans groupe masqué, la ligne sans contrat (valeur non nulle, aucun contrat) reste affichée.
    expect(maskCohorts(p, 1)).toEqual({ onlyPrev: "shown", onlyCur: "shown", both: "shown", outside: "shown" });
  });

  it("atterrissage : une raison de projection qui nomme un contrat devient un nombre, et l'écart avec la carte du Studio RH est écrit", () => {
    const d = def(T.atterrissage);
    const [line] = publicProjectionReasons(["Prénom FICTIF : base n.d. (aucune paie lue) — saisir une correction de base"]);
    expect(line).toBe("1 contrat sans base de projection (détail dans Hypothèses budgétaires)");
    expect(line).not.toContain("FICTIF");
    expect(d).toContain("« 1 contrat sans base de projection »");
    expect(d).toContain("La carte « Atterrissage » de la Synthèse du Studio RH suit une autre règle");
  });

  it("écart au budget, services, période : libellés repris du code", () => {
    const e = def(T.ecartBudget);
    for (const s of ["« Budget des n mois avec budget »", "« Budget du mois avec budget »", "« Réalisé des mois comparés »"]) expect(e).toContain(s);
    const c = def(T.contributionServices);
    expect(c).toContain(`« ${N1_NUL} »`);
    expect(c).toContain(`« ${N1_NEGATIF} »`);
    expect(def(T.periodeFiltres)).toContain("avril 2025 → mars 2026, comparé à avril 2024 → mars 2025");
  });

  it("exports : feuilles citées par leur nom ; « Chiffres clés » seulement quand le chapitre a des cartes", () => {
    const x = def(T.export);
    for (const s of [KEY_FIGURES_TITLE, WATCH_SHEET, ND_SHEET, REFERENCE_TITLE]) expect(x).toContain(`« ${s} »`);
    expect(x).toContain("Quand le chapitre a des cartes, le classeur commence par la feuille « Chiffres clés »");
    expect(x).toContain("dans chacun des autres chapitres chiffrés");
    expect(keyFiguresTable([])).toBeNull();
  });
});
