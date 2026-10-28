import { describe, expect, it } from "vitest";
import { glossaryEntry } from "@/lib/glossary";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { maskNonRecurring, maskCohorts, partitionCohorts } from "@/lib/croisee/cohortes";
import { KEY_FIGURES_TITLE, keyFiguresTable, ND_SHEET, REFERENCE_TITLE, WATCH_SHEET } from "@/lib/croisee/export";
import { confidentialiteReason, maskGroups, personOf, SEUIL_NON_VERIFIABLE, type PersonLink, type PersonsOfContracts } from "@/lib/confidentialite";
import { groupsOfContracts } from "@/lib/croisee/structure";
import { personsByGroup } from "@/lib/croisee/structure";
import { congesMask } from "@/lib/viz/croisee-absences";
import { publicProjectionReasons } from "@/lib/viz/croisee-budget";
import { exitMotifRows } from "@/lib/viz/croisee-effectifs";
import { N1_NEGATIF, N1_NUL } from "@/lib/viz/croisee-masse";
import { maskServices, SEUIL_NON_VERIFIABLE as PAIE_NON_VERIFIABLE, sousSeuil } from "@/lib/viz/croisee-paie";

// Groupe en personnes reliées distinctes et contrats non reliés ; pour les éléments non récurrents (cohortes), un groupe relié sans
// embauche prévisionnelle (hires 0).
const G = (persons: string[], unlinked = 0): PersonsOfContracts & { hires: number } => ({ persons, unlinked, hires: 0 });
const link = (o: Record<string, string>): PersonLink => new Map(Object.entries(o));

// Règle 6 : les définitions de la Masse salariale croisée disent ce que le code fait. Chaque phrase vérifiée ici l'est sur la fonction
// qui la met en œuvre, avec un cas écrit à la main (valeurs fictives, aucune donnée réelle).
const def = (id: string) => glossaryEntry(id)!.definition;

describe("glossaire de la Masse salariale croisée ↔ code", () => {
  it("seuil de confidentialité : une seule raison dans toute l'application, en personnes ; groupe non dénombré « non vérifiable »", () => {
    const conf = def(T.confidentialite);
    expect(conf).toContain(`« ${confidentialiteReason(2).replace("2 personnes", "N personnes")} »`);
    // Paie & comptabilité ne porte plus de raison propre : la même que partout (module partagé).
    expect(sousSeuil(3)).toBe(confidentialiteReason(3));
    expect(PAIE_NON_VERIFIABLE).toBe(SEUIL_NON_VERIFIABLE);
    for (const r of [confidentialiteReason(3), sousSeuil(3)]) expect(r.startsWith("non affiché")).toBe(true);
    expect(SEUIL_NON_VERIFIABLE).toContain("seuil de confidentialité non vérifiable");
    expect(conf).toContain("« seuil de confidentialité non vérifiable »");
    // Groupe vide (0) : affiché ; effectif non dénombré (null) : non vérifiable ; 1 personne avec un seuil de 3 : masqué.
    expect(maskGroups([{ size: 0, value: 0 }, { size: null, value: 4 }, { size: 1, value: 1 }, { size: 5, value: 5 }], 3, false)).toEqual(["shown", "unverifiable", "masked", "shown"]);
  });

  it("seuil de 1 : aucun groupe dénombré n'est masqué ; un service sans contrat rattaché de valeur non nulle n'est pas dénombré (non vérifiable)", () => {
    expect(def(T.confidentialite)).toContain("avec 1, aucun groupe dénombré n'est masqué");
    expect(maskGroups([{ size: 1, value: 1 }, { size: 9, value: 9 }], 1, true)).toEqual(["shown", "shown"]);
    expect(maskServices([{ group: G(["p1"]), value: 100 }, { group: G(["p2"]), value: 900 }], 1)).toEqual(["shown", "shown"]);
    expect(maskServices([{ group: G([]), value: 500, nonZero: true }, { group: G(["p1"]), value: 100 }], 1)).toEqual(["unverifiable", "secondary"]);
  });

  it("Paie & comptabilité : un service sans contrat rattaché de valeur non nulle n'est pas vérifiable ; une personne à deux contrats dans deux services compte une fois ; un contrat non relié ne protège pas", () => {
    const conf = def(T.confidentialite);
    expect(conf).toContain("un service sans contrat rattaché (« Non ventilé », par exemple) ne suffit jamais à en protéger un autre");
    // Seuil 2 : « Non ventilé » (0 personne, 500 €) non vérifiable ; il n'apporte personne, le service suivant (5 personnes) est masqué
    // aussi.
    const P = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
    expect(maskServices([{ group: G([]), value: 50_000, nonZero: true }, { group: G(P(5)), value: 100_000 }], 2)).toEqual(["unverifiable", "secondary"]);
    // Sans contrat et de valeur nulle : rien à protéger.
    expect(maskServices([{ group: G([]), value: 0, nonZero: false }, { group: G(P(5)), value: 100_000 }], 2)).toEqual(["shown", "shown"]);
    // Seuil 2 : deux services d'un contrat chacun, portés par la MÊME personne « q1 » : une seule personne masquée, le troisième service
    // (3 personnes) est masqué à son tour.
    expect(maskServices([{ group: G(["q1"]), value: 10_000 }, { group: G(["q1"]), value: 20_000 }, { group: G(["p2", "p3", "p4"]), value: 30_000 }], 2)).toEqual(["masked", "masked", "secondary"]);
    // Le second service porté par un contrat non relié : non dénombré, il n'apporte personne non plus.
    expect(maskServices([{ group: G(["q1"]), value: 10_000 }, { group: G([], 1), value: 20_000 }, { group: G(["p2", "p3", "p4"]), value: 30_000 }], 2)).toEqual(["masked", "unverifiable", "secondary"]);
  });

  it("Effectifs & mouvements : groupes comptés en personnes distinctes ; un contrat sans personne est non relié (jamais une personne, il ne protège pas)", () => {
    const conf = def(T.confidentialite);
    expect(conf).toContain("une personne qui a deux contrats dans un même groupe y compte une fois");
    expect(def(T.repartitionEffectifs)).toContain("une personne qui a deux contrats simultanés dans le groupe y compte une fois");
    // Personne « p1 » avec deux contrats dans le groupe A : 1 personne ; deux contrats sans personne dans B : 0 personne, 2 contrats non
    // reliés (règle du module partagé : maskSize rend le groupe non dénombré sous le seuil).
    const c = (group: string, contract: string, personKey: string | null) => ({ group, contract, person: personOf({ contractKey: contract, personKey }) });
    const g = groupsOfContracts([c("A", "k1", "p1"), c("A", "k2", "p1"), c("B", "k3", null), c("B", "k4", null)]);
    expect(g).toEqual({ A: { persons: ["p1"], unlinked: 0 }, B: { persons: [], unlinked: 2 } });
    expect(personsByGroup(Object.entries(g).flatMap(([group, x]) => x.persons.map((person) => ({ group, person }))))).toEqual({ A: 1 });
  });

  it("motifs de sortie : un motif sous le seuil rejoint « Autres motifs (k motifs) », masqué avec masquage secondaire", () => {
    expect(def(T.journalMouvements)).toContain("« Autres motifs (k motifs) », lui-même masqué s'il concerne de 1 à (seuil − 1) personnes, avec masquage secondaire");
    // Seuil 2 : motif « X1 » pour 3 personnes, motif « X2 » pour 1 personne. X2 n'est pas nommé ; « Autres motifs (1 motif) » est masqué
    // et X1, seul autre groupe affiché, l'est au masquage secondaire ; le total (4) reste affiché.
    const ev = (endReason: string, person: string) => ({ month: "2026-01", kind: "exit" as const, nature: "cdi", endReason, contract: `k-${person}`, person });
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
    const cell = { kind: "exact" as const, half: 4, persons: 1, unlinked: 0, who: [0] };
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

  it("éléments non récurrents : quand l'un des deux totaux est masqué, l'autre l'est aussi (zéro compris) ; une hypothèse sans contrat n'est pas une personne", () => {
    expect(def(T.confidentialite)).toContain("quand l'un est masqué, l'autre l'est aussi, et la cascade du retraité n'est pas tracée");
    expect(def(T.atterrissage)).toContain("quand l'un est masqué, l'autre l'est aussi et la cascade du retraité n'est pas tracée");
    // Seuil 2 : 1 personne déjà comptabilisée (50 €) ; 4 personnes prévues (200 €).
    expect(maskNonRecurring({ realised: G(["q1"]), projected: G(["p1", "p2", "p3", "p4"]) }, { realised: 5_000, projected: 20_000 }, 2)).toEqual({ realised: "masked", projected: "secondary" });
    // Aucun contributeur déjà comptabilisé (0 €) ; 1 personne prévue (30 €) : le total nul est masqué au masquage secondaire.
    expect(maskNonRecurring({ realised: G([]), projected: G(["p1"]) }, { realised: 0, projected: 3_000 }, 2)).toEqual({ realised: "secondary", projected: "masked" });
    // Une hypothèse « réalisé » saisie sans contrat n'est reliée à personne : non dénombrée (non vérifiable), l'autre total en second.
    expect(maskNonRecurring({ realised: G([], 1), projected: G(["p1", "p2", "p3", "p4"]) }, { realised: 5_000, projected: 20_000 }, 2)).toEqual({ realised: "unverifiable", projected: "secondary" });
    // Contribution sans contrat ni hypothèse : non vérifiable.
    expect(maskNonRecurring({ realised: G(["q1", "q2"]), projected: null }, { realised: 5_000, projected: 3_000 }, 2).projected).toBe("unverifiable");
  });

  it("contrats observés : les lignes sans contrat d'un montant non nul sont « non vérifiables », avec masquage secondaire", () => {
    expect(def(T.confidentialite)).toContain("La ligne « Lignes du journal sans contrat » des contrats observés ne décrit aucun contrat dénombré : d'un montant non nul, elle est n.d. « seuil de confidentialité non vérifiable », quel que soit le seuil, avec masquage secondaire dans chaque colonne.");
    // N-1 : a = 100 (N-1 seulement), b = 200 et d = 50 (les deux), x = 10 (sans contrat) ; N : b = 250, d = 60, c = 80 (N seulement),
    // x = 30 ; chaque contrat relié à sa personne. Seuil 2 : « N-1 seulement » et « N seulement » (1 personne chacun) masqués ; la ligne
    // sans contrat (10 et 30) n'est pas vérifiable. Colonne N-1 : « N-1 seulement » (1 personne) et la ligne sans contrat (personne) →
    // « les deux » (2 personnes) masqué en second.
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
      link({ a: "p-a", b: "p-b", c: "p-c", d: "p-d" }),
    );
    expect(p.kind).toBe("value");
    if (p.kind !== "value") return;
    expect(maskCohorts(p, 2)).toEqual({ onlyPrev: "masked", onlyCur: "masked", both: "secondary", outside: "unverifiable" });
    // Seuil 1 : la ligne sans contrat reste non vérifiable ; colonne N-1 : « N-1 seulement » (100 < 250) masqué en second ; colonne N :
    // « N seulement » (80 < 310). « Les deux » reste affiché.
    expect(maskCohorts(p, 1)).toEqual({ onlyPrev: "secondary", onlyCur: "secondary", both: "shown", outside: "unverifiable" });
  });

  it("atterrissage : une raison de projection qui nomme un contrat devient un nombre, et l'écart avec la carte du Studio RH est écrit", () => {
    const d = def(T.atterrissage);
    const [line] = publicProjectionReasons(["Prénom FICTIF : base n.d. (aucune paie lue) — saisir une correction de base"]);
    expect(line).toBe("1 contrat sans base de projection (détail dans Hypothèses budgétaires)");
    expect(line).not.toContain("FICTIF");
    expect(d).toContain("« 1 contrat sans base de projection »");
    // Règle unique (lot 12) : la carte de la Synthèse du Studio RH suit la même règle que la croisée (landing-compare.ts).
    expect(d).toContain("La carte « Atterrissage » de la Synthèse du Studio RH suit la même règle");
    for (const s of ["aucun scénario ne couvre", "mois comparés", "mois exclus nommés"]) expect(d).toContain(s);
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
