import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import GlossairePage from "@/app/e/[slug]/glossaire/page";
import { GlossaryView } from "@/app/e/[slug]/glossaire/GlossaryView";
import {
  definitionParagraphs,
  familyAnchor,
  foldText,
  GLOSSARY,
  GLOSSARY_FAMILIES,
  glossaryEntry,
  glossaryHref,
  groupByFamily,
  normalizeQuery,
  searchGlossary,
  type GlossaryEntry,
} from "@/lib/glossary";
import { GLOSSARY_ECRAN } from "@/lib/glossary/ecran";
import { DONNEES_TERMS } from "@/lib/glossary/donnees";
import { CONFIDENTIALITE_TERM, confidentialiteReason, isHidden, maskGroups, SEUIL_ILLISIBLE, SEUIL_NON_DEFINI, SEUIL_NON_VERIFIABLE } from "@/lib/confidentialite";
import { canonicalCompare, maskColumn, stockColumn, windowStatus } from "@/lib/confidentialite/columns";
import { projectedGroupCell } from "@/lib/confidentialite/groups";
import { crossKey, crossMask } from "@/lib/confidentialite/splits";
import { SPLIT_AXES } from "@/lib/budget/monthly";
import { provisionValue } from "@/lib/payroll/lot2";
import type { ActualEvent } from "@/lib/payroll/non-recurring";
import { maskNonRecurring, natureMonthMask } from "@/lib/payroll/non-recurring-mask";
import type { AbsencePeriodGroups } from "@/lib/rh/kpi/absence-motifs";
import { maskCascade } from "@/lib/viz/ecart";
import { periodCountMask, seuilText, typeCountMask } from "@/lib/viz/kpi";
import { ActualNonRecurringCount } from "@/app/e/[slug]/studio-rh/hypotheses/LandingView";

// Accès : la page demande l'espace comme les autres pages (un non-membre est refusé, 404 côté application).
const access = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock("@/lib/workspace", () => ({
  requireWorkspace: async (slug: string) => {
    access.asked.push(slug);
    if (slug === "autre") throw new Error("NEXT_NOT_FOUND");
    return { session: {}, workspace: { id: "w1", name: "Démo", slug, role: "reader" } };
  },
}));

// --- Le glossaire (état final : toutes les familles) ---------------------------------------------------------------------------
describe("Glossaire : cohérence des entrées", () => {
  it("identifiants uniques et en kebab-case, terme et définition non vides, famille connue", () => {
    const seen = new Set<string>();
    for (const e of GLOSSARY) {
      expect(e.id, `id ${e.id}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seen.has(e.id), `id en double : ${e.id}`).toBe(false);
      seen.add(e.id);
      expect(e.id, `« ${e.id} » entrerait en collision avec l'ancre du titre d'une autre entrée (def-<id>-terme)`).not.toMatch(/-terme$/);
      expect(e.term.trim(), `terme vide : ${e.id}`).not.toBe("");
      expect(e.definition.trim(), `définition vide : ${e.id}`).not.toBe("");
      expect(GLOSSARY_FAMILIES as readonly string[], `famille de ${e.id}`).toContain(e.family);
    }
  });

  it("aucun vocabulaire interne : « outil observé », « cahier », « webinaire », « capture », « avec toi »", () => {
    const bad = ["outil observé", "cahier", "webinaire", "capture", "avec toi"].map(foldText);
    for (const e of GLOSSARY) {
      const text = foldText([e.term, e.definition, e.formula ?? ""].join(" \n "));
      for (const b of bad) expect(text.includes(b), `« ${b} » dans ${e.id}`).toBe(false);
    }
  });

  it("les familles ne sont pas vides, sauf Données", () => {
    for (const f of GLOSSARY_FAMILIES) {
      if (f === "Données") continue;
      expect(GLOSSARY.filter((e) => e.family === f).length, `famille « ${f} » vide`).toBeGreaterThan(0);
    }
  });

  it("les entrées voisines (« Voir aussi ») existent et ne se citent pas elles-mêmes", () => {
    for (const e of GLOSSARY) for (const id of e.see ?? []) {
      expect(glossaryEntry(id), `${e.id} → ${id}`).toBeDefined();
      expect(id, `${e.id} se cite lui-même`).not.toBe(e.id);
    }
  });
});

// --- Chaque identifiant cité dans le code existe ------------------------------------------------------------------------------
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

// Identifiants cités par <GlossaryLink term="…">, glossaryHref(slug, "…"), un lien /glossaire#def-… écrit en toutes lettres, ou une
// table « XXX_TERMS = { clé: "identifiant" } » dont les écrans reprennent les valeurs (term={KPI_TERMS.etp}).
function citedIds(): Map<string, string[]> {
  const root = path.resolve(__dirname, "../../src");
  const cited = new Map<string, string[]>();
  const add = (id: string | undefined, file: string) => {
    if (!id) return;
    cited.set(id, [...(cited.get(id) ?? []), path.relative(root, file)]);
  };
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    if (file.endsWith(".tsx")) {
      for (const m of src.matchAll(/<GlossaryLink\b([\s\S]*?)\/>/g)) {
        const t = /\bterm=(?:"([^"]+)"|\{\s*"([^"]+)"\s*\}|\{\s*'([^']+)'\s*\})/.exec(m[1]);
        if (t) add(t[1] ?? t[2] ?? t[3], file);
      }
    }
    for (const m of src.matchAll(/glossaryHref\(\s*[^,()]+,\s*(?:"([^"]+)"|'([^']+)'|`([^`$]+)`)\s*\)/g)) add(m[1] ?? m[2] ?? m[3], file);
    for (const m of src.matchAll(/\/glossaire#def-([a-z0-9-]+)/g)) add(m[1], file);
    for (const m of src.matchAll(/export const \w*TERMS\w*\s*(?::[^=]+)?=\s*\{([\s\S]*?)\}/g)) for (const v of m[1].matchAll(/:\s*"([a-z0-9]+(?:-[a-z0-9]+)*)"/g)) add(v[1], file);
  }
  return cited;
}

describe("Glossaire : les liens du code mènent à une définition", () => {
  it("chaque identifiant cité dans src/** existe dans le glossaire", () => {
    const cited = citedIds();
    expect(cited.size, "le balayage du code ne trouve aucun identifiant").toBeGreaterThan(10);
    for (const [id, files] of cited) expect(glossaryEntry(id), `« ${id} » cité dans ${[...new Set(files)].join(", ")}`).toBeDefined();
  });
});

// --- Famille « Lecture des écrans » ---------------------------------------------------------------------------------------------
describe("Glossaire : Lecture des écrans", () => {
  it("les douze notions transversales sont écrites, dans la famille, avec leur identifiant", () => {
    expect(GLOSSARY_ECRAN.map((e) => e.id)).toEqual([
      "lecture-nd",
      "lecture-hachure",
      "lecture-axe",
      "lecture-tableau",
      "lecture-empiler",
      "lecture-versions",
      "lecture-mois",
      "lecture-tendances",
      "lecture-unites",
      "lecture-perimetre",
      "lecture-prevu",
      "lecture-source",
    ]);
    for (const e of GLOSSARY_ECRAN) {
      expect(e.family).toBe("Lecture des écrans");
      expect(glossaryEntry(e.id)).toBe(e);
    }
  });

  it("la convention des tendances : coût en hausse rouge, coût en baisse vert, jamais sur un effectif ni un ETP", () => {
    const d = glossaryEntry("lecture-tendances")!.definition;
    expect(d).toContain("une hausse est une tendance défavorable, en rouge");
    expect(d).toContain("une baisse est une tendance favorable, en vert");
    expect(d).toContain("Les effectifs, les ETP, les entrées et les sorties ne sont jamais colorés en rouge ou en vert");
    expect(d).toContain("La couleur n'est jamais seule");
  });

  it("n.d. n'est jamais un zéro ; Clair refuse de calculer quand une règle manque", () => {
    const d = glossaryEntry("lecture-nd")!.definition;
    expect(d).toContain("Un n.d. n'est jamais un zéro");
    expect(d).toContain("Clair refuse de calculer");
  });

  it("les règles de lecture des graphiques disent ce que les composants font (seuil de 30 %, cascades colorées, mois non clôturé)", () => {
    // Axe tronqué : même règle que WaterfallChart (écart entre le niveau le plus bas et le plus haut < 30 % du plus haut).
    expect(glossaryEntry("lecture-axe")!.definition).toContain("inférieur à 30 % du niveau le plus haut");
    // Seules les cascades d'écart en euros sont colorées ; atterrissage et ETP restent bleus et gris.
    const t = glossaryEntry("lecture-tendances")!.definition;
    expect(t).toContain("celles qui décomposent un total (atterrissage) ou des ETP restent bleues et grises");
    expect(t).toContain("écart de rapprochement");
    // Un mois de paie non clôturée est « provisoire » en masse salariale, mais n.d. dans les KPI RH et les hypothèses budgétaires.
    const m = glossaryEntry("lecture-mois")!.definition;
    expect(m).toContain("« provisoire »");
    expect(m).toContain("sont n.d., avec la raison « paie non clôturée à la lecture »");
    // Les ETP des tableaux et des infobulles ont deux décimales : l'entrée ne promet pas une valeur « exacte » au dix-millième.
    expect(glossaryEntry("lecture-tableau")!.definition).not.toContain("dix-millième");
    expect(glossaryEntry("lecture-unites")!.definition).toContain("Sur l'écran KPI RH, la valeur au dix-millième se lit au survol");
  });
});

// --- Règle de confidentialité : une entrée générale, les entrées d'écran y renvoient -----------------------------------------------
describe("Glossaire : Seuil de confidentialité (règle de l'application)", () => {
  const general = glossaryEntry(CONFIDENTIALITE_TERM)!;

  it("l'entrée « confidentialite » existe (identifiant cité par les écrans), dans la famille KPI RH, et cite les raisons du code", () => {
    expect(general).toBeDefined();
    expect(general.id).toBe("confidentialite");
    expect(general.family).toBe("KPI RH");
    expect(general.term).toBe("Seuil de confidentialité");
    const d = general.definition;
    // Cas de référence écrit à la main : seuil de 2 → « non affiché (seuil de confidentialité : 2 personnes) » ; l'entrée écrit « N ».
    expect(confidentialiteReason(2)).toBe("non affiché (seuil de confidentialité : 2 personnes)");
    expect(d).toContain(`« ${confidentialiteReason(2).replace("2 personnes", "N personnes")} »`);
    expect(d).toContain(`« ${SEUIL_NON_VERIFIABLE} »`);
    expect(d).toContain(`« ${SEUIL_NON_DEFINI} »`);
    expect(d).toContain(`« ${SEUIL_ILLISIBLE} »`);
    expect(d).toContain("Paramètres › Confidentialité");
    expect(d).toContain("au moins égal à 1 (avec 1, aucun groupe dénombré n'est masqué)");
    expect(d).toContain("aucune valeur par défaut");
  });

  it("la règle : personnes distinctes, contrat non relié, portée, totaux non masqués, masquage secondaire, exception unique, exports, écrans nominatifs", () => {
    const d = general.definition;
    expect(d).toContain("Unité : les personnes distinctes du référentiel Collaborateurs");
    expect(d).toContain("une personne qui a deux contrats dans un même groupe y compte une fois");
    expect(d).toContain("ne protège jamais");
    expect(d).toContain("de 1 à (seuil − 1) personnes distinctes");
    expect(d).toContain("Un groupe vide ne désigne personne");
    expect(d).toContain("Les totaux de toute l'entreprise et les indicateurs globaux");
    expect(d).toContain("Masquage secondaire");
    expect(d).toContain("zéro compris");
    expect(d).toContain("au moins « seuil » personnes distinctes");
    expect(d).toContain("Masquage principal et masquage secondaire portent la même raison");
    expect(d).toContain("Une seule exception : la ligne du motif retenu quand c'est le seul motif retenu présent dans la lecture");
    expect(d).toContain("Les exports Excel et CSV des tableaux concernés portent exactement les mêmes cellules n.d. que l'écran, avec la même raison");
    expect(d).toContain("« Retirer le filtre Service »");
    // Écrans nominatifs : ouverts à tous les rôles (constat de relecture), seuls les détails par salarié de l'Écart et de l'Analyse et le
    // détail des éléments non récurrents du réel sont réservés aux éditeurs.
    expect(d).toContain("ouverts à tous les rôles de l'espace (Collaborateurs, détails par contrat des indicateurs de KPI RH, saisie des Hypothèses budgétaires, mesures du Studio Restructuring)");
    expect(d).toContain("le détail par salarié de l'Écart budgétaire et de l'Analyse des écarts et le détail des éléments non récurrents du réel sont réservés aux éditeurs");
    expect(d).toContain("les éléments non récurrents du réel par nature et par mois");
  });

  it("les entrées d'écran renvoient à l'entrée générale (« Voir aussi ») sans la recopier ; la croisée ne garde que ses groupes", () => {
    const citing = [
      "croisee-confidentialite",
      "croisee-vue-ensemble",
      "croisee-periode-filtres",
      "croisee-charges-personnel",
      "croisee-personnes-observees",
      "croisee-conges-pris",
      "croisee-repartition-effectifs",
      "service",
      "primes",
      "provision",
      "fixe-variable",
      "cascade",
      "pont-volume-cout",
      "analyse-ecarts",
      "absence-par-motif",
      "absence-all-motifs",
      "kpi-types-absence",
      "effectifs-ventilation",
      "effectifs-repartition",
      "effectifs-graphiques",
      "lecture-nd",
    ];
    for (const id of citing) expect(glossaryEntry(id)!.see, id).toContain("confidentialite");
    for (const id of general.see ?? []) expect(glossaryEntry(id), `confidentialite → ${id}`).toBeDefined();
    const croisee = glossaryEntry("croisee-confidentialite")!;
    expect(croisee.term).toBe("Seuil de confidentialité dans la Masse salariale croisée");
    expect(croisee.definition).toContain("Cette entrée dit seulement comment chaque chapitre forme ses groupes.");
    for (const chapter of ["Synthèse (01) et Services (05)", "Effectifs & mouvements (02)", "Absences & congés (03)", "Fixe & variable (04)", "Budget & prévisions (06)", "Paie & comptabilité (07)", "Effets d'évolution (08)"]) expect(croisee.definition, chapter).toContain(chapter);
    // La règle n'est écrite qu'une fois : aucune autre entrée ne la recopie ni ne décrit une exception supprimée ou un comptage en contrats.
    const others = GLOSSARY.filter((e) => e.id !== CONFIDENTIALITE_TERM);
    for (const e of others) {
      expect(e.definition, e.id).not.toContain("Masquage secondaire :");
      for (const gone of ["suit une autre règle", "compté en contrats", "contrats par service et par mois", "dont les contrats ne sont pas comptés", "comptés en contrats distincts"]) expect(e.definition, `${e.id} : ${gone}`).not.toContain(gone);
    }
  });

  it("les entrées d'écran disent ce que leur écran fait (ligne « Confidentialité », filtre Service, carte Atterrissage du Studio RH, catégories filtrées)", () => {
    // Analyse des écarts : la ligne de l'écran est « Confidentialité : seuil de N personnes » (seuilText du module KPI, partagé).
    expect(seuilText({ kind: "set", value: 2, updatedAt: null, updatedBy: null })).toBe("seuil de 2 personnes");
    expect(seuilText({ kind: "set", value: 1, updatedAt: null, updatedBy: null })).toBe("seuil de 1 personne");
    expect(glossaryEntry("analyse-ecarts")!.definition).toContain("« Confidentialité : seuil de N personnes »");
    // Masse salariale : sous le filtre, un service masqué (principal ou secondaire) rend l'écran du service n.d.
    expect(glossaryEntry("service")!.definition).toContain("au masquage principal ou secondaire, rend tout l'écran du service n.d. (« — service retenu par le filtre »)");
    expect(glossaryEntry("provision")!.definition).toContain("ligne de dotation « Mois courant »");
    expect(glossaryEntry("primes")!.definition).toContain("« Brut par libellé de paie »");
    // Cascade d'ETP : un palier masqué empêche de tracer la cascade ; départ, arrivée, écart total et résiduel restent affichés.
    expect(glossaryEntry("cascade")!.definition).toContain("Un palier n.d. empêche de tracer la cascade ; départ, arrivée, écart total et résiduel restent affichés.");
    expect(glossaryEntry("pont-volume-cout")!.definition).toContain("Sans filtre de service, le pont porte sur toute l'entreprise et n'est jamais masqué.");
    // Atterrissage : la carte de la Synthèse du Studio RH suit la règle de la croisée (scénario qui couvre l'année, mois dotés d'un budget).
    expect(glossaryEntry("atterrissage")!.definition).toContain("le scénario le plus récemment créé parmi ceux qui couvrent l'année de la période");
    expect(glossaryEntry("atterrissage")!.definition).toContain("« aucun scénario ne couvre »");
    expect(glossaryEntry("atterrissage")!.definition).toContain("atterrissage des mois comparés − budget des mois comparés = écart");
    expect(glossaryEntry("croisee-atterrissage")!.definition).toContain("La carte « Atterrissage » de la Synthèse du Studio RH suit la même règle");
    expect(glossaryEntry("croisee-atterrissage")!.definition).not.toContain("Ses chiffres peuvent donc différer");
    // KPI RH : le tableau par catégorie suit les filtres de l'écran ; une catégorie sans contrat est sans objet, jamais 0.
    const cat = glossaryEntry("kpi-categories")!.definition;
    expect(cat).toContain("Les filtres Établissement et Nature de l'écran s'appliquent au tableau, au graphique et à l'export Excel");
    expect(cat).toContain("n'a pas de colonne ; la mention sous le tableau la nomme");
    expect(cat).toContain("sans objet (tiret à l'écran, cellule vide dans l'export), jamais 0");
    expect(cat).not.toContain("vaut 0");
    // Effectifs mensuels : cellules masquées, total du mois conservé ; motifs : exception du seul motif retenu.
    expect(glossaryEntry("effectifs-ventilation")!.definition).toContain("le total du mois reste affiché");
    expect(glossaryEntry("absence-par-motif")!.definition).toContain("seule la ligne du motif retenu reste affichée quand c'est le seul motif retenu présent dans la lecture");
    expect(glossaryEntry("absence-all-motifs")!.definition).toContain("n'est masqué par le seuil de confidentialité que lorsqu'il donnerait par différence un motif masqué");
  });

  // Lot 12 : le glossaire décrit la règle canonique en place (src/lib/confidentialite/columns.ts) et les corrections du lot. Chaque phrase
  // est vérifiée sur la fonction qui la met en œuvre, avec un cas écrit à la main (valeurs fictives).
  it("règle canonique : colonne du mois, ordre des libellés, groupe vide hors de la colonne, fenêtre déduite de ses mois", () => {
    const d = general.definition;
    expect(d).toContain("se jugent sur la seule colonne de leur mois, les groupes pris dans l'ordre de leur libellé (« Non ventilé », « Non classé », « Hors salarié » et les groupes « … n.d. » en dernier)");
    // Ordre écrit à la main : libellés ordinaires par points de code, puis les groupes « reste » (« N » = 0x4E avant « É » = 0xC9).
    expect(["Non ventilé", "Service B", "Établissement n.d.", "Service A"].sort(canonicalCompare)).toEqual(["Service A", "Service B", "Non ventilé", "Établissement n.d."]);
    expect(d).toContain("Un groupe qui ne décrit rien ce mois-là (aucun contrat, aucune embauche, aucun montant) reste hors de la colonne et s'affiche à 0");
    // Seuil 3 : A (1 personne) et C (1 personne) masqués, B vide (0, personne). Ensemble : 2 personnes < 3, impossible à protéger.
    // Colonne du mois (maskColumn) : B reste hors de la relation et s'affiche à 0. Moteur seul sur toute la liste (maskGroups) : B
    // serait masqué avec le reste.
    const a = { size: 1, value: 1, members: ["a"] };
    const b = { size: 0, value: 0 };
    const c = { size: 1, value: 1, members: ["c"] };
    const col = maskColumn([{ key: "A", label: "A", cell: a }, { key: "B", label: "B", cell: b }, { key: "C", label: "C", cell: c }], 3, true);
    expect([col.get("A"), col.get("B"), col.get("C")]).toEqual(["masked", "shown", "masked"]);
    expect(maskGroups([a, b, c], 3, true)).toEqual(["masked", "secondary", "masked"]);
    expect(d).toContain("il n'est affiché que si aucun de ses mois n'est masqué ni non dénombré");
    expect(windowStatus(["shown", "secondary", "shown"])).toBe("secondary");
    expect(windowStatus(["shown", "unverifiable"])).toBe("unverifiable");
    expect(windowStatus(["shown", "shown"])).toBe("shown");
    // Stock de fin de mois, seuil 2 : X (2 personnes, 2 contrats), Y (4, 4), Z (1, 1). Z est masqué ; la plus petite cellule par
    // l'effectif, X, l'est en second ; Y reste affiché.
    expect(d).toContain("l'effectif ordonne le masquage et les deux sont masqués ensemble");
    const stock = stockColumn({ X: { persons: ["a", "b"], unlinked: 0, contracts: 2 }, Y: { persons: ["c", "d", "e", "f"], unlinked: 0, contracts: 4 }, Z: { persons: ["g"], unlinked: 0, contracts: 1 } }, 2);
    expect([stock.get("X"), stock.get("Y"), stock.get("Z")]).toEqual(["secondary", "shown", "masked"]);
  });

  it("embauche prévue : affichée, jamais protectrice, masquée seulement avec toute sa répartition ; un contrat sans personne est non relié", () => {
    const d = general.definition;
    expect(d).toContain("une cellule portée seulement par des embauches prévues est affichée, ne protège jamais une autre cellule et n'est masquée qu'avec toute sa répartition quand celle-ci ne peut pas être protégée");
    expect(d).not.toContain("embauche prévue d'un scénario) ne protège jamais");
    // Seuil 3. H : 2 embauches prévues, 7 €. Avec A (1 personne, 1 €) et C (5 personnes, 50 €) : A masqué, C masqué en second
    // (H n'apporte personne), H affiché. Avec A seul : 1 personne, impossible à protéger : H est masqué avec la colonne.
    const h = projectedGroupCell({ persons: [], unlinked: 0, hires: 2 }, 3, 7);
    expect(h).toEqual({ size: 0, value: 7, members: [] });
    const a = { size: 1, value: 1, members: ["a"] };
    const c = { size: 5, value: 50, members: ["c1", "c2", "c3", "c4", "c5"] };
    const three = maskColumn([{ key: "A", label: "A", cell: a }, { key: "C", label: "C", cell: c }, { key: "H", label: "H", cell: h }], 3, true);
    expect([three.get("A"), three.get("C"), three.get("H")]).toEqual(["masked", "secondary", "shown"]);
    const two = maskColumn([{ key: "A", label: "A", cell: a }, { key: "H", label: "H", cell: h }], 3, true);
    expect([two.get("A"), two.get("H")]).toEqual(["masked", "secondary"]);
    for (const id of ["cascade", "effectifs-ventilation"]) expect(glossaryEntry(id)!.definition, id).toMatch(/seulement par des embauches prév\w+ est affiché.*qu'avec toute/);
    expect(glossaryEntry("cascade")!.definition).not.toContain("(embauche prévue) est non vérifiable");
    // Un contrat sans personne rattachée n'est jamais compté comme une personne (règle de persons.ts) : aucune entrée ne dit l'inverse.
    for (const e of GLOSSARY) expect(e.definition, e.id).not.toContain("compte pour une personne");
  });

  it("filtres : service masqué en secondaire, périmètre Établissement ou Nature de KPI RH, tableau par catégorie", () => {
    const d = general.definition;
    expect(d).toContain("est masqué sans filtre, en principal ou en secondaire, ou n'est pas dénombré");
    expect(d).toContain("Filtres Établissement et Nature de KPI RH : tout l'écran est n.d.");
    expect(d).toContain("les entrées et les sorties du périmètre sont n.d., mois par mois, quand la cellule de la répartition des mouvements du mois par nature (ou par établissement) l'est");
    expect(d).toContain("la ligne Période et le turnover qui contiennent un tel mois le sont aussi");
    const cat = glossaryEntry("kpi-categories")!;
    expect(cat.see).toContain("confidentialite");
    expect(cat.definition).toContain("Sous un filtre Établissement ou Nature, tout l'écran est n.d. quand le périmètre retenu est masqué.");
    for (const id of ["croisee-personnes-observees", "pont-volume-cout"]) expect(glossaryEntry(id)!.definition, id).toContain("en principal ou en secondaire");
  });

  it("provision par service : le total, à défaut la part connue ; éléments non récurrents du réel soumis au seuil", () => {
    expect(glossaryEntry("provision")!.definition).toContain("le total de la provision du service ou, quand une part manque, la part connue (congés payés, à défaut charges sociales)");
    // Cas écrits à la main : 100,00 € + 40,00 € = 140,00 € ; congés seuls 100,00 € ; charges seules 40,00 € ; mois n.d. : aucune valeur.
    const m = "2026-01";
    expect(provisionValue({ month: m, kind: "value", conges: 10_000, charges: 4_000, total: 14_000, missing: [] })).toBe(14_000);
    expect(provisionValue({ month: m, kind: "value", conges: 10_000, charges: null, total: null, missing: ["charges"] })).toBe(10_000);
    expect(provisionValue({ month: m, kind: "value", conges: null, charges: 4_000, total: null, missing: ["congés"] })).toBe(4_000);
    expect(provisionValue({ month: m, kind: "nd", reason: "mois non lu" })).toBeNull();
    expect(glossaryEntry("primes")!.definition).toContain("La répartition par nature (nombre d'éléments et coût) suit le seuil de confidentialité");
    // Finition du lot 12 : familles de prime et éléments non récurrents n'ont plus de relation « mois → période » (règle canonique).
    expect(general.definition).toContain("les mois d'une ligne et son total, pour les absences posées à venir d'un motif");
    expect(general.definition).toContain("le brut d'un libellé de paie ou d'une famille de prime, la provision de congés payés d'un service, le nombre et le coût d'une nature d'éléments non récurrents du réel se jugent sur la seule colonne de leur mois");
  });

  // Finition du lot 12 : le glossaire suit le code final des correctifs. Chaque phrase est vérifiée sur la fonction qui la met en œuvre,
  // avec un cas écrit à la main (valeurs fictives, seuil indiqué dans chaque cas).
  it("primes et provision : statut de chaque mois dans sa colonne ; aucune relation « mois → période » ne subsiste", () => {
    for (const e of GLOSSARY) {
      for (const gone of ["les mois d'une ligne et son total, pour une famille de prime", "la période d'une famille de prime, le taux", "vers la cellule de période de la famille", "brut par libellé, paliers"]) expect(e.definition, `${e.id} : ${gone}`).not.toContain(gone);
    }
    expect(glossaryEntry("primes")!.definition).toContain("Chaque mois d'un libellé (une famille est un libellé de la rubrique « Primes ») est jugé dans la colonne de sa rubrique du brut ce mois-là");
    expect(glossaryEntry("primes")!.definition).toContain("une prime d'un mois garde le même statut quelle que soit la période choisie");
    expect(glossaryEntry("provision")!.definition).toContain("avec masquage secondaire dans la colonne de la fin de mois, dont la provision de l'entreprise, qui reste affichée, est le total");
    // Fenêtre déduite de ses mois (windowStatus) : janvier masqué, février affiché → la période janvier → février est n.d. (secondary).
    expect(windowStatus(["masked", "shown"])).toBe("secondary");
  });

  it("éléments non récurrents du réel : colonne de chaque mois, total « Coûts identifiés » ; nature vide gardée dans la colonne", () => {
    const masse = glossaryEntry("primes")!.definition;
    expect(masse).toContain("Chaque mois d'une nature est jugé dans la colonne de son mois, dont les « Coûts identifiés » du mois sont le total");
    expect(masse).toContain("toute la répartition de ce mois est n.d., zéros compris");
    expect(general.definition).toContain("seuls un motif d'absence sans demi-journée et une nature sans élément restent dans la colonne de leur mois");
    // Seuil 3. Janvier : un licenciement (p1, 100,00 €) et trois ruptures (p2, p3, p4, 30,00 € chacune). Ordre canonique des libellés :
    // Autres (vide), Licenciements (1 personne), Ruptures (3), Tuilages (vide). Licenciements masqué ; Ruptures masqué en second (1 + 3 =
    // 4 personnes ≥ 3) ; les natures vides n'apportent personne et restent affichées. Février : un seul licenciement (p5), seule nature
    // non vide : impossible à protéger, toute la répartition du mois est n.d., natures vides comprises.
    const ev = (id: string, month: string, kind: ActualEvent["kind"], contract: string, cents: number): { event: ActualEvent } => ({ event: { id, syncId: "s", month, kind, chargedCents: cents, contractKeys: [contract], note: "" } });
    const items = [ev("e1", "2026-01", "licenciement", "c1", 10_000), ev("e2", "2026-01", "rupture-conventionnelle", "c2", 3_000), ev("e3", "2026-01", "rupture-conventionnelle", "c3", 3_000), ev("e4", "2026-01", "rupture-conventionnelle", "c4", 3_000), ev("e5", "2026-02", "licenciement", "c5", 10_000)];
    const link = new Map([1, 2, 3, 4, 5].map((i) => [`c${i}`, `p${i}`] as const));
    const jan = natureMonthMask(items, "2026-01", link, 3);
    expect([jan.get("licenciement"), jan.get("rupture-conventionnelle"), jan.get("tuilage"), jan.get("autre")]).toEqual(["masked", "secondary", "shown", "shown"]);
    const feb = natureMonthMask(items, "2026-02", link, 3);
    for (const k of ["licenciement", "rupture-conventionnelle", "tuilage", "autre"] as const) expect(isHidden(feb.get(k)!), k).toBe(true);
    // Période janvier → février : les ruptures, masquées en janvier, sont n.d. sur la période ; le mois de janvier garde son statut.
    const conf = { kind: "set", value: 3, updatedAt: null, updatedBy: null } as const;
    const win = maskNonRecurring(items, ["2026-01", "2026-02"], link, conf);
    expect(win["rupture-conventionnelle"].reason).toBe(confidentialiteReason(3));
    expect(win["rupture-conventionnelle"].months["2026-01"]).toBe(confidentialiteReason(3));
  });

  it("Hypothèses › Atterrissage : lignes du Réel au seuil, liste des déclarations réservée aux éditeurs ; croisée 06 : totaux de l'entreprise", () => {
    const r = glossaryEntry("retraite")!;
    expect(r.see).toContain("confidentialite");
    expect(r.definition).toContain("suivent le seuil de confidentialité avec les statuts de la Masse salariale, sur janvier → mois de la base");
    expect(r.definition).toContain("La liste des déclarations reprises (nature et mois de chacune) est réservée aux éditeurs ; un lecteur n'en voit que le nombre");
    // Ce que voit un lecteur (composant de l'écran) : 2 déclarations de janvier à mars 2026, sans nature ni mois de chacune.
    const html = renderToStaticMarkup(h(ActualNonRecurringCount, { count: 2, from: "2026-01", to: "2026-03" }));
    expect(html).toContain("2 déclarations à reprendre");
    expect(html).toContain("Le détail par élément est réservé aux éditeurs.");
    expect(general.definition).toContain("« Coûts identifiés » du réel et totaux « Déjà comptabilisés » et « Prévus » de l'atterrissage retraité");
    expect(general.definition).toContain("(dans Hypothèses budgétaires › Atterrissage, un lecteur ne voit que le nombre de déclarations reprises)");
    expect(general.definition).not.toContain("les contrats observés et les éléments non récurrents (Budget & prévisions)");
  });

  it("nombres d'absences par motif : colonne de tous les motifs de la lecture (KPI RH et Paramètres) ; absences de la période sur leurs propres personnes", () => {
    expect(glossaryEntry("kpi-types-absence")!.definition).toContain("avec masquage secondaire entre tous les motifs de la lecture, dont le total est le nombre d'absences que publie la lecture dans Données ; Paramètres › Définitions des KPI affiche le même nombre avec le même statut");
    expect(glossaryEntry(DONNEES_TERMS.absenceTypes)!.definition).toContain("qui a le statut du même nombre dans KPI RH");
    // Seuil 3. Motif A : 2 absences, 1 personne ; B : 5 absences, 3 personnes ; C : 4 absences, 4 personnes. Total de la colonne publié
    // (Données). A masqué ; le plus petit autre nombre, C (4 < 5), masqué en second (1 + 4 = 5 personnes) ; B affiché. Un nombre qui
    // n'est pas celui de la colonne (B affiché à 6) n'est pas vérifiable.
    const g = (persons: string[], count: number) => ({ persons, unlinked: 0, count });
    const sizes = { A: g(["p1"], 2), B: g(["p2", "p3", "p4"], 5), C: g(["p5", "p6", "p7", "p8"], 4) };
    expect([typeCountMask(sizes, "A", 2, 3), typeCountMask(sizes, "B", 5, 3), typeCountMask(sizes, "C", 4, 3)]).toEqual([confidentialiteReason(3), null, confidentialiteReason(3)]);
    expect(typeCountMask(sizes, "B", 6, 3)).toBe(SEUIL_NON_VERIFIABLE);
    // Absences de la période, seuil 3 : motif A, 3 absences de la période (p1, p2, p3, toutes en janvier) et 1 absence hors de la période
    // (p4) ; le reste (1 personne) se déduit du nombre de la lecture : la période est masquée en second. Motif B : 3 absences de la
    // période (p5, p6, p7), aucun reste, janvier à 3 personnes : affiché.
    expect(glossaryEntry("absence-par-motif")!.definition).toContain("quand le reste de la lecture (absences du motif hors de la période), qui s'en déduit, est sous le seuil ou non dénombré, ou dès qu'un de ses mois est masqué");
    const none = g([], 0);
    const period: AbsencePeriodGroups = {
      months: ["2026-01", "2026-02"],
      types: {
        A: { window: g(["p1", "p2", "p3"], 3), months: [g(["p1", "p2", "p3"], 3), none], rest: g(["p4"], 1), offMonths: 0 },
        B: { window: g(["p5", "p6", "p7"], 3), months: [g(["p5", "p6", "p7"], 3), none], rest: none, offMonths: 0 },
      },
    };
    const st = periodCountMask(period, 3);
    expect([st("A", 3), st("B", 3)]).toEqual(["secondary", "shown"]);
  });

  it("filtres : garde Service sur la masse et l'ETP ; Établissement + Nature en une passe ; valeur affichée comparée à la cellule contrôlée", () => {
    const d = general.definition;
    expect(d).toContain("dans la colonne des masses du mois et, quand l'écran publie aussi l'ETP de fin de mois du service (ETP et coût par ETP, ETP des versions réelles), dans celle de l'ETP de fin de mois par service, la même que les Effectifs mensuels");
    expect(glossaryEntry("service")!.definition).toContain("dans la répartition de l'ETP de fin de mois par service (KPI RH › Effectifs mensuels), l'écran publiant aussi son ETP et son coût par ETP");
    expect(glossaryEntry("pont-volume-cout")!.definition).toContain("dans celle de l'ETP de fin de mois par service (effectif et ETP masqués ensemble");
    expect(d).toContain("ou quand le nombre affiché sous le filtre diffère de celui de cette cellule");
    expect(d).toContain("Avec les deux filtres, la cellule examinée est un croisement du tableau établissement × nature du mois (effectif ou mouvements), masqué en une seule passe");
    // Seuil 2. E1 : CDD 1 personne (a), CDI 3 ; E2 : CDD 3, CDI 4 ; les quatre marges (E1 = 4, E2 = 7, CDD = 4, CDI = 7) sont publiées
    // par les filtres seuls. Masquées partition par partition, E2 × CDI resterait affichée : 7 − 4 = 3 (E2 × CDD), puis 4 − 3 = 1 (E1 ×
    // CDD). En une passe : E1 × CDD masqué, E1 × CDI (ligne E1) et E2 × CDD (colonne CDD) en second, puis E2 × CDI (colonne CDI).
    const cell = (members: string[]) => ({ size: members.length, value: members.length, members });
    const cells = {
      [crossKey("E1", "CDD")]: cell(["a"]),
      [crossKey("E1", "CDI")]: cell(["b", "c", "d"]),
      [crossKey("E2", "CDD")]: cell(["e", "f", "g"]),
      [crossKey("E2", "CDI")]: cell(["h", "i", "j", "k"]),
    };
    const shown = (labels: string[]) => new Map(labels.map((l) => [l, "shown" as const]));
    const st = crossMask(cells, { etablissement: shown(["E1", "E2"]), nature: shown(["CDD", "CDI"]) }, 2);
    expect([st.get(crossKey("E1", "CDD")), st.get(crossKey("E1", "CDI")), st.get(crossKey("E2", "CDD")), st.get(crossKey("E2", "CDI"))]).toEqual(["masked", "secondary", "secondary", "secondary"]);
  });

  it("cascade d'ETP : un palier de la période est n.d. dès qu'il l'est dans la cascade d'un seul de ses mois (règle « union »)", () => {
    expect(general.definition).toContain("un palier d'une période est n.d. dès qu'il l'est dans la cascade de la période ou dans celle d'un seul de ses mois");
    // Seuil 2, chaque contrat relié à sa propre personne. Période : entrées nouvelles a, b, c ; sorties x, y, z : tous affichés dans la
    // cascade de la période. Janvier : sorties x seule (masquée) et entrées a, b, c (masquées en second) ; février : sorties y, z et
    // entrées a, b, c, affichées. Union : les deux paliers de la période sont n.d. (secondary).
    const step = (id: "entrees-new" | "sorties", keys: string[]) => ({ id, label: id, etp4: (id === "sorties" ? -1 : 1) * keys.length * 10_000, people: keys.map((key) => ({ key, etp4: 10_000 })) });
    const link = new Map(["a", "b", "c", "x", "y", "z"].map((k) => [k, `P-${k}`] as const));
    const own = maskCascade({ steps: [step("entrees-new", ["a", "b", "c"]), step("sorties", ["x", "y", "z"])], byMonth: [[step("entrees-new", ["a", "b", "c"]), step("sorties", ["x", "y", "z"])]] }, link, 2);
    expect(own.status).toEqual(["shown", "shown"]);
    const union = maskCascade(
      { steps: [step("entrees-new", ["a", "b", "c"]), step("sorties", ["x", "y", "z"])], byMonth: [[step("entrees-new", ["a", "b", "c"]), step("sorties", ["x"])], [step("entrees-new", ["a", "b", "c"]), step("sorties", ["y", "z"])]] },
      link,
      2,
    );
    expect(union.status).toEqual(["secondary", "secondary"]);
  });

  it("Effectifs mensuels par nature et par établissement : groupes des filtres ; seul un contrat déclaré par deux établissements diverge", () => {
    const d = glossaryEntry("effectifs-ventilation")!.definition;
    expect(SPLIT_AXES).toEqual({ contrat: "nature", etablissement: "etablissement" });
    expect(d).toContain("un mouvement est rangé sous sa propre nature et l'établissement qui le déclare, un inscrit et son ETP sous la nature et l'établissement déclarés ce mois-là");
    expect(d).toContain("un contrat que deux établissements déclarent le même mois compte sous chacun des deux filtres mais une seule fois dans la grille");
    expect(d).not.toContain("nature transformée, mutation");
  });
});

// --- Charte : la feuille de style du glossaire reste dans l'univers bleu / blanc / noir ------------------------------------------
describe("Glossaire : univers bleu, blanc, noir", () => {
  const css = readFileSync(path.resolve(__dirname, "../../src/styles/glossaire.css"), "utf8");

  it("aucune couleur codée en dur hors du blanc, du noir, des gris et des bleus", () => {
    const hex = [...css.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)].map((m) => m[1]);
    expect(hex.length).toBeGreaterThan(0);
    for (const h of hex) {
      const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
      const grey = Math.max(r, g, b) - Math.min(r, g, b) <= 24;
      const blue = b >= r && b >= g;
      expect(grey || blue, `#${h} hors de l'univers bleu / blanc / noir`).toBe(true);
    }
  });

  it("ni rouge, ni vert, ni teinte d'état : le glossaire n'est pas un écran de chiffres", () => {
    for (const v of ["--bad", "--good", "--danger", "--ok", "--warn", "trend-"]) expect(css.includes(v), v).toBe(false);
    expect(css).not.toMatch(/\b(red|green|orange|amber|purple|violet|teal|turquoise)\b/i);
  });

  it("une ancre ciblée reste visible sous la barre du haut collante (marge de défilement d'au moins 56 px)", () => {
    const margins = [...css.matchAll(/scroll-margin-top:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(margins.length).toBeGreaterThanOrEqual(3); // sommaire, famille, définition
    for (const px of margins) expect(px).toBeGreaterThanOrEqual(56);
  });
});

// --- Recherche : cas écrits à la main -----------------------------------------------------------------------------------------
const E = (id: string, term: string, family: GlossaryEntry["family"], definition: string): GlossaryEntry => ({ id, term, family, definition });
const SAMPLE: GlossaryEntry[] = [
  E("a-ecart", "Écart budgétaire", "Écarts", "Différence entre deux versions, à période comparable.\n\nUn écart est n.d. dès que l'une des valeurs l'est."),
  E("b-etp", "ETP moyen", "KPI RH", "Moyenne des équivalents temps plein de fin de mois."),
  E("c-turnover", "Turnover", "KPI RH", "Taux de rotation : sorties de l'année ÷ effectif moyen."),
  E("d-lecture", "Colonne hachurée", "Lecture des écrans", "Un mois n.d. n'est jamais dessiné comme zéro."),
];

describe("Glossaire : recherche, regroupement, ancres", () => {
  it("foldText : sans accent ni casse, apostrophes et espaces insécables ramenées à la forme simple", () => {
    expect(foldText("Écart BUDGÉTAIRE")).toBe("ecart budgetaire");
    expect(foldText("d’un  mois")).toBe("d'un mois");
    expect(foldText("fin de mois")).toBe("fin de mois");
    expect(foldText("Cœur")).toBe("coeur");
  });

  it("normalizeQuery : première valeur, espaces réduits, 100 caractères au plus, tout ce qui n'est pas un texte donne vide", () => {
    expect(normalizeQuery(undefined)).toBe("");
    expect(normalizeQuery(["etp", "autre"])).toBe("etp");
    expect(normalizeQuery("  ETP   fin   de mois ")).toBe("ETP fin de mois");
    expect(normalizeQuery("x".repeat(150))).toHaveLength(100);
    expect(normalizeQuery(42)).toBe("");
  });

  it("searchGlossary : terme et définition, sans accent ni casse, tous les mots dans n'importe quel ordre", () => {
    const ids = (q: string) => searchGlossary(q, SAMPLE).map((e) => e.id);
    expect(ids("ECART")).toEqual(["a-ecart"]); // terme, sans accent ni casse
    expect(ids("équivalents TEMPS")).toEqual(["b-etp"]); // définition
    expect(ids("versions différence")).toEqual(["a-ecart"]); // ordre indifférent
    expect(ids("n.d.")).toEqual(["a-ecart", "d-lecture"]); // point littéral, pas un joker
    expect(ids("l’une")).toEqual(["a-ecart"]); // apostrophe typographique
    expect(ids("moyen")).toEqual(["b-etp", "c-turnover"]);
    expect(ids("moyen turnover")).toEqual(["c-turnover"]);
    expect(ids("zzzz")).toEqual([]);
    expect(ids("")).toEqual(["a-ecart", "b-etp", "c-turnover", "d-lecture"]); // recherche vide : tout
    expect(ids("   ")).toEqual(["a-ecart", "b-etp", "c-turnover", "d-lecture"]);
  });

  it("groupByFamily : dans l'ordre des familles, sans famille vide", () => {
    const g = groupByFamily(SAMPLE);
    expect(g.map((x) => [x.family, x.entries.map((e) => e.id)])).toEqual([
      ["Lecture des écrans", ["d-lecture"]],
      ["KPI RH", ["b-etp", "c-turnover"]],
      ["Écarts", ["a-ecart"]],
    ]);
    expect(groupByFamily([])).toEqual([]);
  });

  it("familyAnchor : sans accent, en kebab-case, une ancre par famille", () => {
    expect(familyAnchor("Lecture des écrans")).toBe("famille-lecture-des-ecrans");
    expect(familyAnchor("KPI RH")).toBe("famille-kpi-rh");
    expect(familyAnchor("Hypothèses budgétaires")).toBe("famille-hypotheses-budgetaires");
    expect(new Set(GLOSSARY_FAMILIES.map(familyAnchor)).size).toBe(GLOSSARY_FAMILIES.length);
  });

  it("definitionParagraphs : un paragraphe par ligne vide", () => {
    expect(definitionParagraphs("Un.\n\nDeux.\n  \nTrois.")).toEqual(["Un.", "Deux.", "Trois."]);
    expect(definitionParagraphs("Seul.")).toEqual(["Seul."]);
  });

  it("glossaryHref : ancre #def-<id> du glossaire de l'espace", () => {
    expect(glossaryHref("demo", "lecture-nd")).toBe("/e/demo/glossaire#def-lecture-nd");
  });
});

// --- La page ------------------------------------------------------------------------------------------------------------------
const view = (entries: GlossaryEntry[], query = "", total = entries.length) => renderToStaticMarkup(h(GlossaryView, { slug: "demo", query, entries, total }));
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("Page Glossaire", () => {
  it("en-tête : sur-titre « Aide », H1 « Glossaire », une ligne ; recherche étiquetée, envoyée par l'adresse (q)", () => {
    const html = view(SAMPLE);
    expect(html).toContain('<span class="label">Aide</span><h1>Glossaire</h1><p class="desc">');
    const form = /<form [^>]*>/.exec(html)![0];
    expect(form).toContain('role="search"');
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/e/demo/glossaire"');
    expect(html).toContain('<label for="gl-q">Rechercher une définition</label>');
    expect(html).toContain('name="q"');
    expect(html).not.toContain("glossaire-effacer");
  });

  it("sommaire par famille avec compteurs (Lecture des écrans 1, KPI RH 2, Écarts 1) et une section par famille", () => {
    const html = view(SAMPLE);
    expect(html).toContain('<a href="#famille-lecture-des-ecrans"><span>Lecture des écrans</span>');
    expect(html).toContain('<a href="#famille-kpi-rh"><span>KPI RH</span><span class="gl-count"><span aria-hidden="true">2</span><span class="gl-sr">, 2 définitions</span>');
    expect(html).toContain('<a href="#famille-ecarts"><span>Écarts</span><span class="gl-count"><span aria-hidden="true">1</span><span class="gl-sr">, 1 définition</span>');
    expect(count(html, /<section /g)).toBe(3);
    expect(html).toContain('<section id="famille-kpi-rh"');
    expect(html).toContain("4 définitions");
  });

  it("chaque entrée a son ancre def-<id>, son terme (titre 3) et sa définition en paragraphes ; la formule vient avant le texte", () => {
    const withFormula: GlossaryEntry[] = [{ ...SAMPLE[0], formula: "écart = version suivante − version précédente" }, SAMPLE[1]];
    const html = view(withFormula);
    expect(count(html, /<article /g)).toBe(2);
    expect(html).toContain('<article id="def-a-ecart" class="gl-entry"');
    expect(html).toContain('<h3 id="def-a-ecart-terme">Écart budgétaire</h3>');
    expect(html).toContain('<div class="gl-def"><p>Différence entre deux versions, à période comparable.</p><p>Un écart est n.d. dès que l&#x27;une des valeurs l&#x27;est.</p></div>');
    expect(html).toContain('<span class="gl-formula-label">Formule</span><span class="gl-formula-text">écart = version suivante − version précédente</span>');
    const first = html.slice(html.indexOf('<article id="def-a-ecart"'));
    expect(first.indexOf("gl-formula-text")).toBeLessThan(first.indexOf('class="gl-def"'));
    expect(count(html, /gl-formula-label/g)).toBe(1); // l'entrée sans formule n'en affiche pas
    expect(html).toContain('href="#def-a-ecart" aria-label="Lien vers la définition : Écart budgétaire"');
  });

  it("recherche active : compteur « n sur N, pour « q » », bouton Effacer, valeur reprise dans le champ", () => {
    const html = view(searchGlossary("moyen", SAMPLE), "moyen", SAMPLE.length);
    expect(html).toContain("2 définitions sur 4, pour « moyen »");
    expect(html).toContain('value="moyen"');
    expect(html).toContain('<a class="btn" href="/e/demo/glossaire" data-testid="glossaire-effacer">Effacer</a>');
    expect(count(html, /<article /g)).toBe(2);
    expect(html).not.toContain('id="famille-ecarts"');
  });

  it("aucun résultat : « Aucune définition ne correspond », ni sommaire ni section ; la saisie est échappée", () => {
    const q = "<script>alert(1)</script>";
    const html = view(searchGlossary(q, SAMPLE), q, SAMPLE.length);
    expect(html).toContain('<p class="gl-empty-title">Aucune définition ne correspond</p>');
    expect(html).toContain("0 définition sur 4");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("glossaire-sommaire");
    expect(count(html, /<section /g)).toBe(0);
  });

  it("« Voir aussi » : lien d'ancre quand la cible est affichée, lien vers le glossaire entier sinon ; entrée inconnue ignorée", () => {
    const nd = glossaryEntry("lecture-nd")!;
    const hachure = glossaryEntry("lecture-hachure")!;
    const prevu = glossaryEntry("lecture-prevu")!;
    const alone = view([nd]);
    expect(alone).toContain(`<a href="/e/demo/glossaire#def-lecture-hachure">${hachure.term}</a>`);
    expect(alone).toContain(`<a href="/e/demo/glossaire#def-lecture-prevu">${prevu.term}</a>`);
    const together = view([nd, hachure, prevu]);
    expect(together).toContain(`<a href="#def-lecture-hachure">${hachure.term}</a>`);
    const unknown = view([{ ...SAMPLE[0], see: ["n-existe-pas", "b-etp"] }]);
    expect(unknown).not.toContain("gl-see");
  });

  it("le glossaire entier : une ancre par entrée, une section par famille non vide, aucune valeur invalide", () => {
    const html = view(GLOSSARY);
    expect(count(html, /<article /g)).toBe(GLOSSARY.length);
    for (const e of GLOSSARY) expect(html, e.id).toContain(`<article id="def-${e.id}"`);
    expect(count(html, /<section /g)).toBe(groupByFamily(GLOSSARY).length);
    for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
  });
});

describe("Page Glossaire : accès et filtre côté serveur", () => {
  const page = async (slug: string, q?: string | string[]) =>
    renderToStaticMarkup(await GlossairePage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(q === undefined ? {} : { q }) }));

  it("l'espace est vérifié avant tout affichage ; un non-membre est refusé", async () => {
    access.asked.length = 0;
    await expect(page("autre")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(access.asked).toEqual(["autre"]);
    expect(await page("demo")).toContain("<h1>Glossaire</h1>");
    expect(access.asked).toEqual(["autre", "demo"]);
  });

  it("q filtre sur le terme et la définition, sans accent ni casse ; sans q, tout le glossaire", async () => {
    const all = await page("demo");
    expect(count(all, /<article /g)).toBe(GLOSSARY.length);
    const found = await page("demo", "N.D. ET SA RAISON");
    expect(found).toContain('id="def-lecture-nd"');
    expect(count(found, /<article /g)).toBe(searchGlossary("n.d. et sa raison").length);
    expect(count(found, /<article /g)).toBeLessThan(GLOSSARY.length);
    expect(await page("demo", ["lecture-source-introuvable-zz"])).toContain("Aucune définition ne correspond");
  });
});
