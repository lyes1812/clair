import { describe, expect, it } from "vitest";
import { unitFormat } from "@/components/charts/units";
import { fmtPercent } from "@/lib/rh/kpi/format";
import {
  absenceTypeLabel,
  absenceTypeText,
  absenteeismSeries,
  allZero,
  categorySeries,
  comparedRate,
  etpSeries,
  gridSeries,
  groupColor,
  headcountSeries,
  monthAxis,
  movementSeries,
  ndSummary,
  ratioBps,
  repartition,
  splitAxisLabel,
  typoMinus,
  type CategoryMonthIn,
  type GridIn,
  type RowIn,
} from "@/lib/viz/kpi";

// Adaptateurs « résultat du moteur → série de graphique » de l'écran KPI RH : cas de référence écrits à la main.
const nd = (reason: string) => ({ nd: { reason } });
// fmtPercent écrit une espace insécable avant « % » (tableaux) ; l'unité « bps » des graphiques une espace ordinaire.
const sp = (t: string) => t.replace(/\u00a0/g, " ");

// Trois mois d'une fenêtre : janvier tout exact ; février en borne basse partout (sauf les sorties) ; mars n.d.
const rows: RowIn[] = [
  {
    month: "2026-01",
    headcount: { kind: "exact", persons: 7 },
    etp: { kind: "exact", etp4: 61000 },
    movements: { entries: { kind: "exact", value: 1 }, exits: { kind: "exact", value: 0 } },
    absenteeism: { kind: "exact", ratio: { num: 30, den: 434 } },
    previous: { month: "2025-01", etp: { kind: "nd", ...nd("mois antérieur à la lecture") }, absenteeism: { kind: "nd", ...nd("absences non lues") } },
  },
  {
    month: "2026-02",
    headcount: { kind: "lower_bound", persons: 6 },
    etp: { kind: "lower_bound", etp4: 55000 },
    movements: { entries: { kind: "lower_bound", value: 2 }, exits: { kind: "exact", value: 1 } },
    absenteeism: { kind: "lower_bound", ratio: { num: 1, den: 32 } },
    previous: { month: "2025-02", etp: { kind: "exact", etp4: 50000 }, absenteeism: { kind: "exact", ratio: { num: 0, den: 400 } } },
  },
  {
    month: "2026-03",
    headcount: { kind: "nd", ...nd("mois non clos à la date de référence") },
    etp: { kind: "nd", ...nd("quotité absente") },
    movements: { entries: { kind: "nd", ...nd("couverture incomplète") }, exits: { kind: "nd", ...nd("couverture incomplète") } },
    absenteeism: { kind: "nd", ...nd("types d'absence non choisis") },
    previous: { month: "2025-03", etp: { kind: "exact", etp4: 48000 }, absenteeism: { kind: "nd", ...nd("absences non lues") } },
  },
];

describe("taux en points de base", () => {
  it("30 demi-journées ÷ 434 = 6,91 % : 691 pb, comme fmtPercent", () => {
    expect(ratioBps({ num: 30, den: 434 })).toBe(691);
    expect(unitFormat("bps").fmt(691)).toBe(fmtPercent({ num: 30, den: 434 }));
    expect(sp(fmtPercent({ num: 30, den: 434 }))).toBe("6,91 %");
  });
  it("1/32 = 3,125 % : le demi remonte, 313 pb (« 3,13 % »)", () => {
    expect(ratioBps({ num: 1, den: 32 })).toBe(313);
    expect(unitFormat("bps").fmt(313)).toBe(fmtPercent({ num: 1, den: 32 }));
    expect(sp(fmtPercent({ num: 1, den: 32 }))).toBe("3,13 %");
  });
  it("12/83 = 14,46 % et 7/13 = 53,85 % (turnover de la période et de N-1) ; zéro réel reste 0", () => {
    expect(ratioBps({ num: 12, den: 83 })).toBe(1446);
    expect(ratioBps({ num: 7, den: 13 })).toBe(5385);
    expect(ratioBps({ num: 0, den: 400 })).toBe(0);
  });
});

describe("axe des mois", () => {
  it("deux années (12 mois glissants) : l'année sur deux chiffres, infobulle avec le mois N-1", () => {
    expect(monthAxis(["2025-11", "2025-12", "2026-01"], ["2024-11", "2024-12", "2025-01"])).toEqual({
      categories: ["nov. 25", "déc. 25", "janv. 26"],
      titles: ["novembre 2025 · N-1 : novembre 2024", "décembre 2025 · N-1 : décembre 2024", "janvier 2026 · N-1 : janvier 2025"],
    });
  });
  it("une seule année : mois seul", () => {
    expect(monthAxis(["2026-01", "2026-02", "2026-08"])).toEqual({ categories: ["janv.", "févr.", "août"], titles: ["janvier 2026", "février 2026", "août 2026"] });
  });
});

describe("séries mensuelles du suivi des effectifs", () => {
  it("effectif : exact tracé, borne basse et n.d. non tracés avec leur raison", () => {
    const [s] = headcountSeries(rows);
    expect(s.values).toEqual([7, null, null]);
    expect(s.reasons?.[0]).toBeNull();
    expect(s.reasons?.[1]).toContain("borne basse (≥ 6)");
    expect(s.reasons?.[2]).toBe("mois non clos à la date de référence");
  });
  it("ETP : période et N-1 (pointillé), jamais d'ETP tracé pour un mois en borne basse", () => {
    const [cur, prev] = etpSeries(rows);
    expect(cur.values).toEqual([61000, null, null]);
    expect(cur.reasons?.[1]).toContain("≥ 5,50 ETP");
    expect(cur.reasons?.[2]).toBe("quotité absente");
    expect(prev.dashed).toBe(true);
    expect(prev.values).toEqual([null, 50000, 48000]);
    expect(prev.reasons?.[0]).toBe("mois antérieur à la lecture");
  });
  it("mouvements : une sortie à 0 est un vrai zéro, une entrée en borne basse n'est pas tracée", () => {
    const [entries, exits] = movementSeries(rows);
    expect(entries.values).toEqual([1, null, null]);
    expect(entries.reasons?.[1]).toContain("borne basse (≥ 2)");
    expect(exits.values).toEqual([0, 1, null]);
    expect(exits.reasons?.[2]).toBe("couverture incomplète");
  });
  it("absentéisme : 30/434 → 691 pb ; 1/32 en borne basse non tracé (≥ 3,13 %) ; N-1 à 0/400 reste 0", () => {
    const [cur, prev] = absenteeismSeries(rows);
    expect(cur.values).toEqual([691, null, null]);
    expect(sp(cur.reasons?.[1] ?? "")).toContain("borne basse (≥ 3,13 %)");
    expect(cur.reasons?.[2]).toBe("types d'absence non choisis");
    expect(prev.values).toEqual([null, 0, null]);
    expect(prev.dashed).toBe(true);
  });
  it("dénominateur nul : jamais tracé (ni 0 ni erreur), la raison le dit", () => {
    const zero: RowIn = { ...rows[0], absenteeism: { kind: "exact", ratio: { num: 0, den: 0 } } };
    const [cur] = absenteeismSeries([zero]);
    expect(cur.values).toEqual([null]);
    expect(cur.reasons?.[0]).toBe("dénominateur nul : taux non défini");
    const c = comparedRate("Turnover", { label: "N-1", value: { kind: "exact", ratio: { num: 3, den: 0 } } }, { label: "P", value: { kind: "exact", ratio: { num: 12, den: 83 } } });
    expect(c.series[0].values).toEqual([null, 1446]);
  });
  it("séries sérialisables vers un composant client (aucune fonction)", () => {
    for (const list of [headcountSeries(rows), etpSeries(rows), movementSeries(rows), absenteeismSeries(rows)]) expect(() => structuredClone(list)).not.toThrow();
  });
});

describe("taux par période (turnover, absentéisme)", () => {
  it("N-1 puis période : 7/13 → 5385 pb, 12/83 → 1446 pb", () => {
    const c = comparedRate("Turnover", { label: "12 mois au 30/09/2025", value: { kind: "exact", ratio: { num: 7, den: 13 } } }, { label: "12 mois au 30/09/2026", value: { kind: "exact", ratio: { num: 12, den: 83 } } });
    expect(c.categories).toEqual(["N-1", "Période"]);
    expect(c.titles).toEqual(["N-1 : 12 mois au 30/09/2025", "Période : 12 mois au 30/09/2026"]);
    expect(c.series[0].values).toEqual([5385, 1446]);
  });
  it("période précédente n.d. : colonne n.d. avec sa raison, jamais 0", () => {
    const c = comparedRate("Turnover", { label: "N-1", value: { kind: "nd", ...nd("1 mois n.d. : couverture incomplète") } }, { label: "P", value: { kind: "exact", ratio: { num: 12, den: 83 } } });
    expect(c.series[0].values).toEqual([null, 1446]);
    expect(c.series[0].reasons?.[0]).toBe("1 mois n.d. : couverture incomplète");
  });
});

describe("n.d. d'un graphique entier", () => {
  it("aucune valeur connue : les raisons (dédoublonnées) remplacent le graphique", () => {
    const [cur] = absenteeismSeries([rows[2], rows[2]]);
    expect(ndSummary([cur])).toBe("types d'absence non choisis");
  });
  it("une seule valeur connue suffit à garder le graphique", () => {
    expect(ndSummary(headcountSeries(rows))).toBeNull();
  });
  it("aucune série : message neutre", () => {
    expect(ndSummary([])).toBe("aucune valeur disponible");
  });
});

describe("effectif et ETP par catégorie", () => {
  const months: CategoryMonthIn[] = [
    { kind: "value", month: "2026-01", lowerBound: false, byCategory: { cdi: { headcount: 5, etp4: 50000 }, cdd: { headcount: 1, etp4: null } } },
    { kind: "nd", month: "2026-02", reason: "mois non lu" },
    { kind: "value", month: "2026-03", lowerBound: true, byCategory: { cdi: { headcount: 4, etp4: 40000 } } },
    { kind: "value", month: "2026-04", lowerBound: false, byCategory: { cdi: { headcount: 4, etp4: 40000 } } },
  ];
  const labels = { cdi: "CDI", cdd: "CDD", apprenti: "Apprenti" };
  it("ETP : catégorie absente d'un mois connu = 0 réel ; ETP n.d. d'une catégorie, mois n.d. et borne basse non tracés", () => {
    const [cdi, cdd, apprenti] = categorySeries(months, ["cdi", "cdd", "apprenti"], labels, "etp");
    expect(cdi.values).toEqual([50000, null, null, 40000]);
    expect(cdd.values).toEqual([null, null, null, 0]);
    expect(cdd.reasons?.[0]).toContain("ETP n.d.");
    expect(apprenti.values).toEqual([0, null, null, 0]);
    expect(apprenti.reasons?.[1]).toBe("mois non lu");
    expect(apprenti.reasons?.[2]).toContain("borne basse");
    expect([cdi.name, cdd.name, apprenti.name]).toEqual(["CDI", "CDD", "Apprenti"]);
    expect([cdi.color, cdd.color, apprenti.color]).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"]);
  });
  it("effectif : le nombre de contrats de la catégorie, même quand l'ETP est n.d.", () => {
    const [, cdd] = categorySeries(months, ["cdi", "cdd"], labels, "headcount");
    expect(cdd.values).toEqual([1, null, null, 0]);
  });
  it("aucune catégorie lue : une série « Total » (raisons des mois n.d., 0 pour un mois connu sans contrat)", () => {
    const [t] = categorySeries([{ kind: "nd", month: "2026-01", reason: "mois non lu" }, { kind: "value", month: "2026-02", lowerBound: false, byCategory: {} }], [], labels, "etp");
    expect(t.name).toBe("Total");
    expect(t.values).toEqual([null, 0]);
    expect(t.reasons?.[0]).toBe("mois non lu");
  });
});

// Grille d'effectifs mensuels écrite à la main : CDD 1, 0 ; CDI 5, 5 ; mars n.d.
const cells: Record<string, Record<string, number>> = { CDD: { "2026-01": 1, "2026-02": 0 }, CDI: { "2026-01": 5, "2026-02": 5 } };
const grid: GridIn = {
  months: ["2026-01", "2026-02", "2026-03"],
  groups: ["CDD", "CDI"],
  cell: (g, m) => (m in cells[g] ? { kind: "value", v: cells[g][m] } : { kind: "nd", reason: "mois non lu" }),
  total: (m) => (m === "2026-03" ? { kind: "nd", reason: "mois non lu" } : { kind: "value", v: (cells.CDD[m] ?? 0) + (cells.CDI[m] ?? 0) }),
};

describe("grille des effectifs mensuels", () => {
  it("une série par groupe, la teinte du groupe, un mois n.d. reste n.d. avec sa raison", () => {
    const [cdd, cdi] = gridSeries(grid);
    expect(cdd).toMatchObject({ key: "CDD", name: "CDD", values: [1, 0, null], color: "var(--chart-1)" });
    expect(cdi).toMatchObject({ key: "CDI", values: [5, 5, null], color: "var(--chart-2)" });
    expect(cdi.reasons).toEqual([null, null, "mois non lu"]);
  });
  it("aucun groupe : une série « Total » avec les zéros réels des mois connus", () => {
    const [t] = gridSeries({ months: grid.months, groups: [], cell: grid.cell, total: (m) => (m === "2026-03" ? { kind: "nd", reason: "mois non lu" } : { kind: "value", v: 0 }) });
    expect(t).toMatchObject({ name: "Total", values: [0, 0, null] });
  });
  it("stock : dernier mois connu (février) ; mars n.d. n'est pas compté", () => {
    const r = repartition(grid, true);
    expect(r.known).toEqual(["2026-01", "2026-02"]);
    expect(r.used).toEqual(["2026-02"]);
    expect(r.items).toEqual([{ group: "CDD", v: 0 }, { group: "CDI", v: 5 }]);
    expect(r.total).toBe(5);
  });
  it("flux : cumul des mois connus, 1 + 0 pour le CDD et 5 + 5 pour le CDI", () => {
    const r = repartition(grid, false);
    expect(r.used).toEqual(["2026-01", "2026-02"]);
    expect(r.items).toEqual([{ group: "CDD", v: 1 }, { group: "CDI", v: 10 }]);
    expect(r.total).toBe(11);
  });
  it("huit teintes de la charte, puis le cycle reprend", () => {
    expect([groupColor(0), groupColor(7), groupColor(8)]).toEqual(["var(--chart-1)", "var(--chart-8)", "var(--chart-1)"]);
  });
  it("séries sérialisables", () => {
    expect(() => structuredClone(gridSeries(grid))).not.toThrow();
  });
});

describe("libellés et typographie d'affichage", () => {
  it("le type d'absence connu a son libellé français, les autres restent tels que reçus", () => {
    expect(absenceTypeLabel("fr_maladie_ordinaire")).toBe("Maladie ordinaire");
    expect(absenceTypeLabel("test_maternity")).toBeNull();
    expect(absenceTypeText("fr_maladie_ordinaire")).toBe("Maladie ordinaire (fr_maladie_ordinaire)");
    expect(absenceTypeText("test_maternity")).toBe("test_maternity");
  });
  it("formule d'écart : 12/83 − 7/13 = −425/1079, soit −42500/1079 après × 100, avec le vrai signe moins", () => {
    // 12 × 13 = 156 ; 7 × 83 = 581 ; (156 − 581) / (83 × 13 = 1079) = −425/1079.
    expect(typoMinus("(12/83 − 7/13) × 100 = -42500/1079")).toBe("(12/83 − 7/13) × 100 = \u221242500/1079");
    expect(typoMinus("-5")).toBe("\u22125");
    // 0/1 − 7/13 = −7/13 ; × 100 = −700/13 ; un terme négatif en tête ou après le signe moins est converti aussi.
    expect(typoMinus("(0/1 − 7/13) × 100 = -700/13")).toBe("(0/1 − 7/13) × 100 = \u2212700/13");
    expect(typoMinus("-1/2 − -3/4 = 1/4")).toBe("\u22121/2 − \u22123/4 = 1/4");
  });
  it("un tiret de nom, de date ou d'opération espacée n'est pas remplacé", () => {
    expect(typoMinus("N-1 (12 mois glissants : octobre 2024 → septembre 2025)")).toBe("N-1 (12 mois glissants : octobre 2024 → septembre 2025)");
    expect(typoMinus("2025-10 - 2025-09")).toBe("2025-10 - 2025-09");
    expect(typoMinus("0/1 = 0/1")).toBe("0/1 = 0/1");
  });
  it("axe de répartition : nom court et précision entre parenthèses", () => {
    expect(splitAxisLabel("Catégorie (CDI, CDD, apprenti, stagiaire)")).toEqual({ name: "Catégorie", detail: "CDI, CDD, apprenti, stagiaire" });
    expect(splitAxisLabel("Service (code analytique du journal)")).toEqual({ name: "Service", detail: "code analytique du journal" });
    expect(splitAxisLabel("Direction")).toEqual({ name: "Direction", detail: null });
  });
});

describe("série toute à zéro", () => {
  const s = (values: (number | null)[]) => ({ key: "k", name: "k", values });
  it("des zéros connus (et un mois n.d.) : tout à zéro", () => {
    expect(allZero([s([0, 0, null])])).toBe(true);
    expect(allZero([s([0, 0]), s([0, null])])).toBe(true);
  });
  it("une valeur non nulle, ou aucune valeur connue : pas « tout à zéro »", () => {
    expect(allZero([s([0, 691])])).toBe(false);
    expect(allZero([s([null, null])])).toBe(false);
    expect(allZero([])).toBe(false);
  });
});
