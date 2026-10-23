import { describe, expect, it } from "vitest";
import { unitFormat } from "@/components/charts/units";
import {
  DEFAULT_PAGE_SIZE,
  fold,
  matchesQuery,
  monthAxis,
  monthLongLabel,
  monthShortLabel,
  movementSeries,
  ndSummary,
  pageHref,
  pageOf,
  pageSizeOf,
  paginate,
  quarters,
  stripCellTitle,
  stripLabel,
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
    expect(entrees.reasons?.[1]).toBe("borne basse (≥ 1) : source incomplète, non tracée comme valeur exacte");
  });
  it("une borne basse qualifiée par le moteur : les qualificatifs sont dans la raison, la valeur reste non tracée", () => {
    const [e, s] = movementSeries([
      { month: "2026-10", entries: { kind: "lower_bound", value: 3, qualifiers: ["mois en cours à la date de référence : connu jusqu'au 15/10/2026"] }, exits: { kind: "lower_bound", value: 0, qualifiers: ["A", "B"] } },
    ]);
    expect(e.values).toEqual([null]);
    expect(e.reasons).toEqual(["borne basse (≥ 3) : mois en cours à la date de référence : connu jusqu'au 15/10/2026 — non tracée comme valeur exacte"]);
    expect(s.values).toEqual([null]);
    expect(s.reasons).toEqual(["borne basse (≥ 0) : A · B — non tracée comme valeur exacte"]);
  });
  it("un n.d. reste null avec sa raison, jamais zéro", () => {
    expect(sorties.values[1]).toBeNull();
    expect(sorties.reasons?.[1]).toBe("sorties de 2026-02 inconnues");
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
    expect(stripCellTitle(cells[0])).toBe("2026-01 : présent en fin de mois");
    expect(stripCellTitle(cells[1])).toBe("2026-02 : absent (aucun contrat)");
    expect(stripCellTitle(cells[2])).toBe("2026-03 : n.d. — mois non couvert");
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
