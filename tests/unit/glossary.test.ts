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
import { CONFIDENTIALITE_TERM, confidentialiteReason, SEUIL_ILLISIBLE, SEUIL_NON_DEFINI, SEUIL_NON_VERIFIABLE } from "@/lib/confidentialite";
import { seuilText } from "@/lib/viz/kpi";

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
