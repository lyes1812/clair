import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollabHeader, FindingList, StatePill, Tile } from "@/app/e/[slug]/studio-rh/collaborateurs/components";
import { unitFormat } from "@/components/charts/units";
import { glossaryEntry } from "@/lib/glossary";
import { GLOSSARY_RH } from "@/lib/glossary/rh";
import { RH_DEFINITIONS } from "@/lib/rh/definitions";
import type { FindingDraft } from "@/lib/rh/referential/types";
import type { CollabContext } from "@/lib/rh/view";
import {
  atLeast,
  clearMonths,
  collectNotes,
  countedPhrase,
  DEFAULT_PAGE_SIZE,
  defaultMonth,
  fold,
  groupMonthReasons,
  matchesQuery,
  monthAxis,
  monthLabel,
  monthLongLabel,
  monthRangeLabel,
  monthsOfRanges,
  monthShortLabel,
  movementSeries,
  ndSummary,
  pageHref,
  pageOf,
  pageSizeOf,
  paginate,
  periodLabel,
  plural,
  quarters,
  shortQualifier,
  stripCellTitle,
  stripLabel,
  tileFoot,
  type MonthCountsIn,
  type StripCellIn,
} from "@/lib/viz/collaborateurs";

// Aides des écrans Collaborateurs : cas de référence écrits à la main.
const nd = (reason: string) => ({ nd: { reason } });

describe("axe des mois", () => {
  it("une seule année : mois seul ; deux années : l'année sur deux chiffres", () => {
    expect(monthAxis(["2026-01", "2026-02"])).toEqual({ categories: ["janv.", "févr."], titles: ["janvier 2026", "février 2026"] });
    expect(monthAxis(["2025-12", "2026-01"]).categories).toEqual(["déc. 25", "janv. 26"]);
  });
  it("libellés courts et longs", () => {
    expect(monthShortLabel("2026-08")).toBe("août");
    expect(monthLongLabel("2026-03")).toBe("mars 2026");
    expect(monthShortLabel("n'importe quoi")).toBe("n'importe quoi");
  });
});

describe("entrées et sorties par mois", () => {
  // Janvier : 2 entrées, 0 sortie (zéro réel). Février : borne basse sur les entrées, sorties n.d. Mars : tout n.d.
  const months: MonthCountsIn[] = [
    { month: "2026-01", entries: { kind: "exact", value: 2 }, exits: { kind: "exact", value: 0 } },
    { month: "2026-02", entries: { kind: "lower_bound", value: 1 }, exits: { kind: "nd", ...nd("sorties de 2026-02 inconnues") } },
    { month: "2026-03", entries: { kind: "nd", ...nd("période postérieure à la date de référence") }, exits: { kind: "nd", ...nd("période postérieure à la date de référence") } },
  ];
  const [entrees, sorties] = movementSeries(months);

  it("deux séries, un point par mois, dans l'ordre des mois", () => {
    expect(entrees.key).toBe("entrees");
    expect(entrees.name).toBe("Entrées");
    expect(sorties.key).toBe("sorties");
    expect(sorties.name).toBe("Sorties");
    expect(entrees.values).toHaveLength(3);
    expect(sorties.values).toHaveLength(3);
  });
  it("un mois exact est tracé, y compris le zéro réel", () => {
    expect(entrees.values[0]).toBe(2);
    expect(sorties.values[0]).toBe(0);
    expect(entrees.reasons?.[0]).toBeNull();
    expect(sorties.reasons?.[0]).toBeNull();
  });
  it("une borne basse n'est pas tracée comme une valeur exacte : null, la valeur est dans la raison", () => {
    expect(entrees.values[1]).toBeNull();
    expect(entrees.reasons?.[1]).toBe("borne basse (au moins 1) : source incomplète, non tracée comme valeur exacte");
  });
  it("une borne basse qualifiée par le moteur : les qualificatifs sont dans la raison, la valeur reste non tracée", () => {
    const [e, s] = movementSeries([
      { month: "2026-10", entries: { kind: "lower_bound", value: 3, qualifiers: ["mois en cours à la date de référence : connu jusqu'au 15/10/2026"] }, exits: { kind: "lower_bound", value: 0, qualifiers: ["A", "B"] } },
    ]);
    expect(e.values).toEqual([null]);
    expect(e.reasons).toEqual(["borne basse (au moins 3) : mois en cours à la date de référence : connu jusqu'au 15/10/2026 — non tracée comme valeur exacte"]);
    expect(s.values).toEqual([null]);
    expect(s.reasons).toEqual(["borne basse (au moins 0) : A · B — non tracée comme valeur exacte"]);
  });
  it("un n.d. reste null avec sa raison, jamais zéro", () => {
    expect(sorties.values[1]).toBeNull();
    expect(sorties.reasons?.[1]).toBe("sorties de févr. 2026 inconnues");
    expect(entrees.values[2]).toBeNull();
    expect(entrees.reasons?.[2]).toBe("période postérieure à la date de référence");
  });
  it("les séries sont sérialisables (aucune fonction)", () => {
    expect(JSON.parse(JSON.stringify([entrees, sorties]))).toEqual([entrees, sorties]);
  });
  it("l'unité « nombre » écrit les entiers à la française, graduations entières", () => {
    expect(unitFormat("nombre").fmt(1250).replace(/\s/g, " ")).toBe("1 250");
    expect(unitFormat("nombre").fmt(0)).toBe("0");
    expect(unitFormat("nombre").integer).toBe(true);
  });
  it("aucune série absente : pas de résumé n.d. ; toutes absentes : les raisons, sans doublon", () => {
    expect(ndSummary([entrees, sorties])).toBeNull();
    const all = movementSeries([
      { month: "2026-03", entries: { kind: "nd", ...nd("A") }, exits: { kind: "nd", ...nd("A") } },
      { month: "2026-04", entries: { kind: "nd", ...nd("B") }, exits: { kind: "nd", ...nd("A") } },
    ]);
    expect(ndSummary(all)).toBe("A ; B");
    expect(ndSummary([{ key: "x", name: "x", values: [] }])).toBe("aucune valeur disponible");
  });
  it("plus de trois raisons : les trois premières puis le nombre total", () => {
    const many = movementSeries(["A", "B", "C", "D"].map((r, i) => ({ month: `2026-0${i + 1}`, entries: { kind: "nd" as const, ...nd(r) }, exits: { kind: "nd" as const, ...nd(r) } })));
    expect(ndSummary(many)).toBe("A ; B ; C ; … (4 raisons)");
  });
});

describe("pagination par l'adresse", () => {
  const rows = Array.from({ length: 45 }, (_, i) => i + 1);
  it("taille : 20, 50 ou 100, sinon 20", () => {
    expect(pageSizeOf("50")).toBe(50);
    expect(pageSizeOf("100")).toBe(100);
    expect(pageSizeOf("20")).toBe(20);
    expect(pageSizeOf("30")).toBe(DEFAULT_PAGE_SIZE);
    expect(pageSizeOf("")).toBe(20);
    expect(pageSizeOf(undefined)).toBe(20);
    expect(pageSizeOf("abc")).toBe(20);
  });
  it("page demandée : entier ≥ 1, sinon 1", () => {
    expect(pageOf("3")).toBe(3);
    expect(pageOf("0")).toBe(1);
    expect(pageOf("-2")).toBe(1);
    expect(pageOf("2.5")).toBe(1);
    expect(pageOf("x")).toBe(1);
    expect(pageOf(undefined)).toBe(1);
    expect(pageOf("")).toBe(1);
  });
  it("45 lignes par 20 : trois pages, 20 + 20 + 5 ; la deuxième affiche 21 à 40", () => {
    const p1 = paginate(rows, 1, 20);
    const p2 = paginate(rows, 2, 20);
    const p3 = paginate(rows, 3, 20);
    expect([p1.pages, p1.total]).toEqual([3, 45]);
    expect(p1.items).toHaveLength(20);
    expect(p2.items[0]).toBe(21);
    expect(p2.items[19]).toBe(40);
    expect(p3.items).toEqual([41, 42, 43, 44, 45]);
  });
  it("une page trop grande est ramenée à la dernière, une liste vide a une page vide", () => {
    expect(paginate(rows, 99, 20).page).toBe(3);
    expect(paginate(rows, 99, 20).items[0]).toBe(41);
    expect(paginate([], 4, 20)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
    expect(paginate(rows, 1, 100).items).toHaveLength(45);
  });
  it("adresse d'une page : paramètres renseignés seulement, page 1 non écrite", () => {
    expect(pageHref({ mois: "2026-02", etab: "", nature: undefined, q: "Hélène", taille: "50" }, 3)).toBe("?mois=2026-02&q=H%C3%A9l%C3%A8ne&taille=50&page=3");
    expect(pageHref({ mois: "2026-02" }, 1)).toBe("?mois=2026-02");
    expect(pageHref({})).toBe("?");
  });
});

describe("recherche sur toutes les colonnes", () => {
  it("insensible à la casse et aux accents", () => {
    expect(fold("Hélène DUPONT")).toBe("helene dupont");
    expect(matchesQuery(["Hélène Dupont", "003"], "helene")).toBe(true);
    expect(matchesQuery(["Helene Dupont"], "HÉLÈNE")).toBe(true);
  });
  it("trouve dans n'importe quelle colonne : matricule, date, nature, état", () => {
    const cells = ["Fictif A-003", "003", "TEST-A-CONTRACT-003", "CDD (02)", "01/10/2024", "2024-10-01", "sorti le 31/12/2025"];
    expect(matchesQuery(cells, "cdd")).toBe(true);
    expect(matchesQuery(cells, "31/12/2025")).toBe(true);
    expect(matchesQuery(cells, "2024-10")).toBe(true);
    expect(matchesQuery(cells, "contract-003")).toBe(true);
    expect(matchesQuery(cells, "cdi")).toBe(false);
  });
  it("tous les mots doivent se trouver, dans l'ordre qu'on veut", () => {
    const cells = ["Fictif A-003", "CDD (02)", "sorti le 31/12/2025"];
    expect(matchesQuery(cells, "cdd sorti")).toBe(true);
    expect(matchesQuery(cells, "sorti cdd")).toBe(true);
    expect(matchesQuery(cells, "cdd entré")).toBe(false);
  });
  it("un mot ne chevauche pas deux colonnes", () => {
    expect(matchesQuery(["abc", "def"], "cd")).toBe(false);
    expect(matchesQuery(["abc", "def"], "abc def")).toBe(true);
  });
  it("recherche vide ou espaces : tout passe ; cellules vides ignorées", () => {
    expect(matchesQuery(["x"], "")).toBe(true);
    expect(matchesQuery(["x"], "   ")).toBe(true);
    expect(matchesQuery([null, undefined, "", 7], "7")).toBe(true);
    expect(matchesQuery([null, undefined, ""], "a")).toBe(false);
  });
});

describe("frise de présence", () => {
  const cells: StripCellIn[] = [
    { month: "2026-01", state: "present", reason: null },
    { month: "2026-02", state: "absent", reason: "aucun contrat" },
    { month: "2026-03", state: "nd", reason: "mois non couvert" },
  ];
  it("titre d'une case : mois et état, avec la raison", () => {
    expect(stripCellTitle(cells[0])).toBe("janv. 2026 : présent en fin de mois");
    expect(stripCellTitle(cells[1])).toBe("févr. 2026 : absent (aucun contrat)");
    expect(stripCellTitle(cells[2])).toBe("mars 2026 : n.d. — mois non couvert");
    expect(stripCellTitle({ month: "2026-04", state: "nd", reason: "couverture : 2024-10 → 2026-03" })).toBe("avr. 2026 : n.d. — couverture : oct. 2024 à mars 2026");
    expect(stripCellTitle({ month: "2026-05", state: "nd", reason: null })).toBe("mai 2026 : n.d.");
  });
  it("lecture à voix haute", () => {
    expect(stripLabel(cells)).toBe("Présence en fin de mois : janv. présent, févr. absent, mars n.d.");
  });
  it("trimestres : douze mois en quatre blocs de trois", () => {
    const year = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(quarters(year)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]);
    expect(quarters([1, 2, 3, 4])).toEqual([[1, 2, 3], [4]]);
    expect(quarters([])).toEqual([]);
  });
});

describe("mois en clair", () => {
  it("un seul format : « oct. 2026 », jamais « 2026-10 »", () => {
    expect(monthLabel("2026-10")).toBe("oct. 2026");
    expect(monthLabel("2026-08")).toBe("août 2026");
    expect(monthLabel("2026-03")).toBe("mars 2026");
    expect(periodLabel("2025-11", "2026-10")).toBe("nov. 2025 → oct. 2026");
    expect(periodLabel("2026-10", "2026-10")).toBe("oct. 2026");
  });
  it("plages contiguës : l'année n'est écrite qu'une fois si elle est commune, un trou coupe la plage", () => {
    expect(monthRangeLabel(["2026-10", "2026-11", "2026-12"])).toBe("oct. à déc. 2026");
    expect(monthRangeLabel(["2026-12", "2026-10", "2026-11"])).toBe("oct. à déc. 2026");
    expect(monthRangeLabel(["2025-11", "2025-12", "2026-01", "2026-02"])).toBe("nov. 2025 à févr. 2026");
    expect(monthRangeLabel(["2026-01", "2026-10", "2026-11"])).toBe("janv. 2026, oct. à nov. 2026");
    expect(monthRangeLabel(["2026-10"])).toBe("oct. 2026");
    expect(monthRangeLabel([])).toBe("");
  });
  it("mois ISO d'un texte du moteur écrits en clair ; les dates complètes restent intactes", () => {
    expect(clearMonths("2 sur les mois couverts (10/12) ; n.d. : 2026-11 → 2026-12")).toBe("2 sur les mois couverts (10/12) ; n.d. : nov. à déc. 2026");
    expect(clearMonths("mois 2025-03 non couvert")).toBe("mois mars 2025 non couvert");
    expect(clearMonths("connu jusqu'au 2026-10-24")).toBe("connu jusqu'au 2026-10-24");
    expect(clearMonths("TEST-A-CONTRACT-001")).toBe("TEST-A-CONTRACT-001");
    expect(clearMonths("2026-12 → 2026-10")).toBe("déc. 2026 → oct. 2026");
  });
});

describe("mois par défaut de la liste mensuelle", () => {
  const months = ["2026-08", "2026-09", "2026-10"];
  it("le dernier mois dont le dernier jour est couvert par la date de référence (pas le mois en cours)", () => {
    expect(defaultMonth(months, "2026-10-24", "2026-10")).toBe("2026-09");
    expect(defaultMonth(months, "2026-09-30", "2026-10")).toBe("2026-09");
    expect(defaultMonth(months, "2026-10-31", "2026-10")).toBe("2026-10");
  });
  it("aucun mois clos ou date absente : le repli donné", () => {
    expect(defaultMonth(months, "2026-08-15", "2026-10")).toBe("2026-10");
    expect(defaultMonth(months, null, "2026-10")).toBe("2026-10");
    expect(defaultMonth([], "2026-10-24", null)).toBeNull();
  });
});

describe("n.d. regroupés", () => {
  it("« ≥ n » écrit « au moins n » ; le reste est inchangé", () => {
    expect(atLeast("≥ 0")).toBe("au moins 0");
    expect(atLeast("≥ 12")).toBe("au moins 12");
    expect(atLeast("12")).toBe("12");
    expect(atLeast("n.d.")).toBe("n.d.");
  });
  it("trois mois n.d. pour la même raison : une seule ligne, les mois en plage", () => {
    const g = groupMonthReasons([
      { month: "2026-10", reason: "période postérieure" },
      { month: "2026-11", reason: "période postérieure" },
      { month: "2026-12", reason: "période postérieure" },
      { month: "2026-01", reason: "non couvert" },
    ]);
    expect(g).toEqual([
      { reason: "période postérieure", months: ["2026-10", "2026-11", "2026-12"], label: "oct. à déc. 2026" },
      { reason: "non couvert", months: ["2026-01"], label: "janv. 2026" },
    ]);
  });
  it("notes sous un tableau : une raison n'est écrite qu'une fois, avec ses colonnes dans l'ordre d'apparition", () => {
    expect(
      collectNotes([
        { column: "Présent au 01/01", reason: "R" },
        { column: "Présent au 31/12", reason: "R" },
        { column: "Matricule", reason: "Q" },
        { column: "Présent au 31/12", reason: "R" },
      ]),
    ).toEqual([
      { reason: "R", columns: ["Présent au 01/01", "Présent au 31/12"] },
      { reason: "Q", columns: ["Matricule"] },
    ]);
    expect(collectNotes([])).toEqual([]);
  });
  it("mois d'une liste du moteur : plages développées, format inconnu refusé", () => {
    expect(monthsOfRanges("2026-11 → 2026-12")).toEqual(["2026-11", "2026-12"]);
    expect(monthsOfRanges("2026-01, 2026-03 → 2026-05")).toEqual(["2026-01", "2026-03", "2026-04", "2026-05"]);
    expect(monthsOfRanges("2026-12 → 2026-10")).toBeNull();
    expect(monthsOfRanges("novembre")).toBeNull();
  });
  it("qualificatif de total annuel : la liste des mois n.d. n'est retirée que si chacun de ces mois est déjà dit ailleurs", () => {
    const q = "1 sur les mois couverts (10/12) ; n.d. : 2026-11 → 2026-12";
    // Mois n.d. tous déjà écrits en tête de panneau (oct. à déc.) : la liste est retirée.
    expect(shortQualifier(q, ["2026-10", "2026-11", "2026-12"])).toBe("1 sur les mois couverts (10/12)");
    // Un mois n.d. (déc.) n'est pas dit ailleurs : la liste reste, aucun mois n'est passé sous silence.
    expect(shortQualifier(q, ["2026-10", "2026-11"])).toBe(q);
    expect(shortQualifier(q)).toBe(q);
    expect(shortQualifier("2 sur les mois couverts (9/12) ; n.d. : 2025-01 → 2025-03", ["2026-10"])).toBe("2 sur les mois couverts (9/12) ; n.d. : 2025-01 → 2025-03");
    // Pas de liste de mois, ou liste illisible : texte inchangé.
    expect(shortQualifier("mois en cours à la date de référence", ["2026-10"])).toBe("mois en cours à la date de référence");
    expect(shortQualifier("1 sur les mois couverts (10/12) ; n.d. : plusieurs mois", ["2026-11"])).toBe("1 sur les mois couverts (10/12) ; n.d. : plusieurs mois");
  });
});

describe("accords", () => {
  it("« comptée » s'accorde, sans « (s) »", () => {
    expect(countedPhrase(1, 1)).toBe("1 comptée sur 1");
    expect(countedPhrase(2, 3)).toBe("2 comptées sur 3");
    expect(countedPhrase(0, 2)).toBe("aucune comptée sur 2");
    expect(countedPhrase(0, 0)).toBe("aucune sur la période");
  });
  it("zéro et un au singulier, milliers à la française", () => {
    expect(plural(0, "ligne")).toBe("0 ligne");
    expect(plural(1, "ligne")).toBe("1 ligne");
    expect(plural(7, "ligne")).toBe("7 lignes");
    expect(plural(3, "mois", "mois")).toBe("3 mois");
    expect(plural(1250, "ligne").replace(/\s/g, " ")).toBe("1 250 lignes");
  });
});

describe("pied de tuile", () => {
  it("la borne basse reste écrite, sans le renvoi « voir la couverture du mois »", () => {
    expect(tileFoot("borne basse (voir la couverture du mois)")).toBe("borne basse");
    expect(tileFoot("borne basse (voir la couverture du mois) · 2 déclaré(s) après leur fin, non compté(s)")).toBe("borne basse · 2 déclaré(s) après leur fin, non compté(s)");
  });
  it("les données qui qualifient le chiffre restent, mois en clair", () => {
    expect(tileFoot("1 sur les mois couverts (10/12) ; n.d. : 2026-11 → 2026-12")).toBe("1 sur les mois couverts (10/12) ; n.d. : nov. à déc. 2026");
    expect(tileFoot("3 contrats")).toBe("3 contrats");
  });
  it("rien à dire : null (« au moins » seul est un marqueur interne, pas un pied)", () => {
    expect(tileFoot(undefined)).toBeNull();
    expect(tileFoot("")).toBeNull();
    expect(tileFoot("au moins")).toBeNull();
    expect(tileFoot("(voir la couverture du mois)")).toBeNull();
  });
});

// --- Glossaire de la famille Collaborateurs et univers de couleurs de l'écran
const ZONE = join(process.cwd(), "src/app/e/[slug]/studio-rh/collaborateurs");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const zoneText = sources(ZONE).map((f) => readFileSync(f, "utf8")).join("\n");

describe("glossaire : famille Collaborateurs", () => {
  it("les définitions existantes gardent leur identifiant d'ancre et leur texte (à la mise en paragraphes et à une retouche de rédaction près)", () => {
    const flat = (t: string) => t.replace(/\s*\n\n\s*/g, " ");
    for (const d of RH_DEFINITIONS) {
      const e = GLOSSARY_RH.find((x) => x.id === d.id);
      expect(e, d.id).toBeDefined();
      expect(e!.term).toBe(d.title);
      const source = d.text.replace("constaté sur le compte pilote le 22/10/2026 :", "constat sur un compte PayFit :");
      expect(flat(e!.definition).startsWith(source), d.id).toBe(true);
    }
  });
  it("la borne basse est dite en français de produit : pas de « compte pilote », texte en paragraphes", () => {
    const e = GLOSSARY_RH.find((x) => x.id === "lower-bound")!;
    expect(e.definition).not.toMatch(/compte pilote|constaté sur/);
    expect(e.definition).toContain("constat sur un compte PayFit");
    expect(e.definition.split("\n\n").length).toBeGreaterThanOrEqual(3);
    // Le détail retiré de l'en-tête des écrans (contrat qui fait suite à un contrat non renvoyé, dénominateurs réduits) est ici.
    expect(e.definition).toContain("compte comme une entrée");
    expect(e.definition).toContain("dénominateurs sont réduits");
  });
  it("« Voir aussi » : des entrées qui existent, jamais l'entrée elle-même, sans doublon", () => {
    let withSee = 0;
    for (const e of GLOSSARY_RH) {
      const see = e.see ?? [];
      if (see.length) withSee++;
      expect(new Set(see).size, e.id).toBe(see.length);
      for (const id of see) {
        expect(id, e.id).not.toBe(e.id);
        expect(glossaryEntry(id), `${e.id} → ${id}`).toBeDefined();
      }
    }
    expect(withSee).toBeGreaterThan(10);
  });
  it("identifiants uniques, kebab-case, famille Collaborateurs, définition et terme non vides", () => {
    const ids = GLOSSARY_RH.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of GLOSSARY_RH) {
      expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.family).toBe("Collaborateurs");
      expect(e.term.trim()).not.toBe("");
      expect(e.definition.trim()).not.toBe("");
    }
  });
  it("le texte déplacé des écrans est au glossaire", () => {
    const def = (id: string) => GLOSSARY_RH.find((e) => e.id === id)!.definition;
    // Bloc « Ce qui est n.d. et pourquoi » : les sept cas.
    for (const cas of ["Période postérieure à la date de référence", "Période non couverte", "Mois DSN incomplet ou bloqué", "Borne basse (PayFit)", "Champ non porté par la source", "Champ non renseigné", "Droit non accordé"]) expect(def("collab-nd-raisons")).toContain(cas);
    // Natures comptées, note du graphique des mouvements, contrats continus, fiche, attributs lus à la date de lecture.
    expect(def("natures")).toContain("CDI et CDD");
    expect(def("movements-chart")).toContain("Un mois n.d. ou en borne basse n'est pas tracé");
    expect(def("movements")).toContain("ne sont pas neutralisés");
    expect(def("fiche-collaborateur")).toContain("droits d'accès aux données individuelles");
    expect(def("contract-read-attributes")).toContain("n'est jamais utilisé pour compter");
  });
  it("aucun vocabulaire interne ni tutoiement dans les définitions", () => {
    for (const e of GLOSSARY_RH) expect(`${e.term} ${e.definition}`, e.id).not.toMatch(/outil observé|cahier|webinaire|\btu\b|\btoi\b|\bton\b/i);
  });
  it("chaque « ? » ou définition de tuile des écrans pointe vers une entrée existante (sinon le lien disparaît en silence)", () => {
    const used = new Set<string>();
    for (const re of [/term="([a-z0-9-]+)"/g, /\bdef="([a-z0-9-]+)"/g, /\bdef: "([a-z0-9-]+)"/g]) for (const m of zoneText.matchAll(re)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(10);
    for (const id of used) expect(glossaryEntry(id), id).toBeDefined();
  });
  it("plus de bloc de définitions ni d'ancre locale morte dans les écrans", () => {
    expect(zoneText).not.toContain("rh-definitions");
    expect(zoneText).not.toMatch(/href="#def-/);
    expect(zoneText).not.toContain("Définitions, paramètres et raisons");
  });
});

describe("couleurs de l'écran Collaborateurs : bleu, blanc, noir, gris", () => {
  const css = readFileSync(join(process.cwd(), "src/styles/collaborateurs.css"), "utf8");
  const hsl = (hex: string): { h: number; s: number } => {
    const v = hex.length === 3 ? [...hex].map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r, g, b] = v.map((x) => x / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return { h: 0, s: 0 };
    const l = (max + min) / 2;
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s };
  };
  it("toute couleur codée en dur est un gris ou un bleu (teinte 200° à 260°)", () => {
    const hexes = [...css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map((m) => m[1]);
    expect(hexes.length).toBeGreaterThan(5);
    for (const h of hexes) {
      const c = hsl(h);
      expect(c.s < 0.25 || (c.h >= 200 && c.h <= 260), `#${h}`).toBe(true);
    }
  });
  it("le détecteur reconnaît un vert, un rouge et un ambre", () => {
    for (const h of ["138a55", "c4302b", "aa4051", "e8a317", "f1d6dc"]) {
      const c = hsl(h);
      expect(c.s < 0.25 || (c.h >= 200 && c.h <= 260), `#${h}`).toBe(false);
    }
  });
  it("aucune variable rouge, verte ou de statut vert : ni tendance ni erreur sur cet écran", () => {
    expect(css).not.toMatch(/var\(--(danger|danger-bg|bad|bad-soft|good|good-soft|ok)\)/);
  });
});

// --- Rendu des composants partagés des écrans : le « ? » du glossaire remplace « Définition » et les notes de tuiles
describe("rendu : tuiles, pastilles, constats", () => {
  const tile = (shown: Parameters<typeof Tile>[0]["shown"], def = "headcount-persons", slug: string | null = "demo") =>
    renderToStaticMarkup(h(Tile, { id: "headcount-persons", label: "Effectif fin de mois (personnes)", shown, def, slug: slug ?? undefined }));

  it("une tuile porte un « ? » vers le glossaire (même identifiant d'ancre), plus de lien « Définition » ni d'ancre locale", () => {
    const html = tile({ text: "7", kind: "value" });
    expect(html).toContain('data-testid="headcount-persons"');
    expect(html).toMatch(/<dt>Effectif fin de mois \(personnes\)<a class="gloss-link" href="\/e\/demo\/glossaire#def-headcount-persons"/);
    expect(html).toContain('aria-label="Définition : Effectif fin de mois (personnes)"');
    expect(html).toContain("<dd class=\"big\">7</dd>");
    expect(html).not.toMatch(/Définition<\/a>|href="#def-|tile-foot/);
  });
  it("borne basse : « au moins n » en grand, « borne basse » en pied de tuile, sans le renvoi narratif", () => {
    const html = tile({ text: "≥ 6", kind: "lower", foot: "borne basse (voir la couverture du mois)" });
    expect(html).toContain("au moins 6");
    expect(html).toContain('<span class="tile-foot">borne basse</span>');
    expect(html).not.toContain("voir la couverture");
  });
  it("n.d. : « n.d. » en grand, la raison reste au survol et pour les lecteurs d'écran, jamais un zéro", () => {
    const html = tile({ text: "n.d. — période postérieure à la date de référence", kind: "nd" });
    expect(html).toContain('title="période postérieure à la date de référence"');
    expect(html).toContain("n.d.<span class=\"collab-sr\"> — période postérieure à la date de référence</span>");
    expect(html).not.toMatch(/<dd[^>]*>0</);
  });
  it("un identifiant inconnu ne produit aucun lien mort ; sans espace (slug), pas de lien", () => {
    expect(tile({ text: "7", kind: "value" }, "inconnu")).not.toContain("glossaire");
    expect(tile({ text: "7", kind: "value" }, "headcount-persons", null)).not.toContain("gloss-link");
  });
  it("pastilles d'état : bleu pour présent / entré, bleu nuit pour sorti, pointillé noir pour une alerte (classes de la feuille de style)", () => {
    const cls = (code: Parameters<typeof StatePill>[0]["code"]) => renderToStaticMarkup(h(StatePill, { code, label: "x" })).match(/class="([^"]+)"/)![1];
    expect(cls("present")).toBe("collab-pill s-present");
    expect(cls("entered")).toBe("collab-pill s-entered");
    expect(cls("entered_exited")).toBe("collab-pill s-entered");
    expect(cls("exited")).toBe("collab-pill s-exited");
    expect(cls("declared_after_end")).toBe("collab-pill s-alert");
    expect(cls("before_start")).toBe("collab-pill s-alert");
    expect(cls("absent")).toBe("collab-pill");
  });
  it("constats : le niveau est écrit (texte pour lecteur d'écran), la couleur ne le porte pas seule", () => {
    const findings = [
      { code: "no-start-date", severity: "check", message: "m1", month: null, personKeys: [], contractKeys: [] },
      { code: "rehire", severity: "info", message: "m2", month: "2026-03", personKeys: [], contractKeys: [] },
    ] as unknown as FindingDraft[];
    const html = renderToStaticMarkup(h(FindingList, { findings, slug: "demo", persons: new Map(), contracts: new Map(), testId: "t" }));
    expect(html).toContain('class="finding-list collab-findings"');
    expect(html).toContain('<span class="finding check"><span class="collab-sr">À vérifier : </span>Contrat sans date de début');
    expect(html).toContain('<span class="finding info"><span class="collab-sr">Information : </span>Réembauche');
  });
});

describe("rendu : en-tête des écrans Collaborateurs", () => {
  const ctxOf = (over: Record<string, unknown> = {}) =>
    ({
      slug: "demo",
      source: { domain: "rh", chosen: "payfit", reason: "seule source appliquée", mode: "auto", modeSetAt: null, appliedAt: null },
      chosen: "payfit",
      natures: { codes: ["01", "02"], origin: "default" },
      state: null,
      data: {
        build: { source: "payfit", referenceDate: "2026-09-30", presenceFrom: null, presenceTo: null, builtAt: new Date("2026-10-01T08:00:00Z"), inputsHash: "0123456789abcdef", inputs: { source: "payfit", scopeMonths: ["2024-10", "2026-09"], company: { name: "Société fictive" } } },
        coverage: [],
      },
      switchedAt: null,
      establishments: [],
      payfitHistory: { mode: "raw", origin: "default", limit: { lowerFrom: "2025-01", lowerTo: "2025-09", exactFrom: "2025-10-01" } },
      ...over,
    }) as unknown as CollabContext;
  const render = (ctx: CollabContext) => renderToStaticMarkup(h(CollabHeader, { ctx, tab: "mois" }, h("p", { id: "contenu" }, "contenu")));

  it("titre et source seulement : plus de paragraphe de résumé, plus de bloc de définitions en bas", () => {
    const html = render(ctxOf());
    expect(html).toContain("<h1>Collaborateurs</h1>");
    expect(html).toContain('data-testid="source-badge-rh"');
    expect(html).not.toContain("Fiches individuelles, listes mensuelle et annuelle");
    expect(html).not.toMatch(/rh-definitions|Définitions, paramètres|Ce qui est « n\.d\. »|href="#def-|id="def-/);
    // Le contenu de la page est le dernier élément : rien n'est ajouté après lui.
    expect(html.endsWith('<p id="contenu">contenu</p>')).toBe(true);
  });
  it("limite de l'historique PayFit : une phrase courte, les textes des specs conservés, « ? » vers la borne basse", () => {
    const html = render(ctxOf());
    expect(html).toContain("Limites de la lecture (1)");
    expect(html).toContain('data-testid="payfit-history-notice"');
    expect(html).toContain("Données telles que remontées par l&#x27;API PayFit");
    expect(html).toContain("faussés dans un sens ou dans l&#x27;autre");
    expect(html).toContain('href="/e/demo/glossaire#def-lower-bound"');
    // Le détail (contrat qui fait suite à un contrat non renvoyé, dénominateurs réduits) n'est plus à l'écran.
    expect(html).not.toMatch(/dénominateurs|compte comme une entrée/);
  });
  it("natures comptées : une ligne dans le bloc de lecture, avec son « ? » et le lien vers les Paramètres", () => {
    const html = render(ctxOf());
    expect(html).toMatch(/data-testid="rh-natures">Natures comptées dans l&#x27;effectif : [^<]+ — valeur par défaut validée · <a href="\/e\/demo\/parametres">Paramètres<\/a><a class="gloss-link" href="\/e\/demo\/glossaire#def-natures"/);
    expect(render(ctxOf({ natures: { codes: ["01"], origin: "setting" } }))).toContain("modifiée par un administrateur");
  });
  it("sans mode brut : aucune limite, le bloc s'intitule « Détail de la lecture »", () => {
    const html = render(ctxOf({ payfitHistory: null }));
    expect(html).not.toContain("payfit-history-notice");
    expect(html).not.toContain("Limites de la lecture");
    expect(html).toContain("Détail de la lecture · date de référence 30/09/2026");
  });
  it("source non retenue : le refus est dit en une ligne, avec le lien vers Données", () => {
    const html = render(ctxOf({ data: null, source: { domain: "rh", chosen: null, reason: "aucune source appliquée", mode: "auto", modeSetAt: null, appliedAt: null } }));
    expect(html).toContain('data-testid="collaborateurs-nd"');
    expect(html).toContain("n.d. — aucune source RH retenue");
    expect(html).toContain('<a href="/e/demo/donnees">Données</a>');
  });
});
