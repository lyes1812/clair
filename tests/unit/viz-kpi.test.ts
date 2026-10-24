import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AbsenceTypeNotes, KpiCharts, KpiHeader, KpiParams, KpiTile, NdReasons, PanelTitle } from "@/app/e/[slug]/studio-rh/kpi/components";
import { unitFormat } from "@/components/charts/units";
import { GLOSSARY } from "@/lib/glossary";
import { GLOSSARY_KPI, KPI_TERMS } from "@/lib/glossary/kpi";
import { GLOSSARY_RH } from "@/lib/glossary/rh";
import { KPI_DEFINITIONS, KPI_ND_EXPLANATIONS, SOURCE_GAPS } from "@/lib/rh/kpi/definitions";
import { fmtPercent } from "@/lib/rh/kpi/format";
import {
  absenceTypeLabel,
  absenceTypeText,
  absenteeismSeries,
  allZero,
  barNote,
  categorySeries,
  comparedRate,
  deltaExact,
  donutNote,
  etpSeries,
  gridSeries,
  groupColor,
  headcountSeries,
  monthAxis,
  movementSeries,
  ndSummary,
  ratioBps,
  readingQualifiers,
  repartition,
  splitAxisLabel,
  typoMinus,
  unitLabel,
  zeroRateNote,
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

// --- Lot 10 : moins de narratif, glossaire, univers bleu / blanc / noir

describe("remarques de tuile (lot 10)", () => {
  it("garde ce qui change la lecture (borne basse, neutralisés), retire les deux phrases d'explication du moteur, dédoublonne", () => {
    const q = [
      "quotités à la date de lecture (24/10/2026), non historisées par PayFit",
      "1 contrat(s) présent(s) sans quotité : total en borne basse",
      "entrées et sorties en contrats, effectif en personnes",
      "2 mouvement(s) de contrats continus neutralisé(s)",
      "1 contrat(s) présent(s) sans quotité : total en borne basse",
    ];
    expect(readingQualifiers(q)).toEqual(["1 contrat(s) présent(s) sans quotité : total en borne basse", "2 mouvement(s) de contrats continus neutralisé(s)"]);
    expect(readingQualifiers(["quotités à la date de lecture, non historisées par PayFit"])).toEqual([]);
    expect(readingQualifiers([])).toEqual([]);
  });
});

describe("contexte et légendes des effectifs mensuels (lot 10)", () => {
  it("unité de la rubrique", () => {
    expect([unitLabel("eur"), unitLabel("etp"), unitLabel("nombre")]).toEqual(["euros", "ETP", "nombre"]);
  });
  it("légende des barres : rien à dire = rien d'affiché ; mois projetés, aucun groupe, plus de huit groupes", () => {
    expect(barNote([], 3)).toBeUndefined();
    expect(barNote(["2026-10", "2026-11"], 2)).toBe("Mois projetés (scénario) : oct., nov.");
    expect(barNote(["2026-03", "2026-05"], 2)).toBe("Mois projetés (scénario) : mars, mai.");
    expect(barNote([], 0)).toBe("Aucune valeur sur les mois connus : total à 0.");
    expect(barNote(["2026-12"], 9)).toBe("Mois projetés (scénario) : déc. Plus de huit groupes : les teintes se répètent.");
  });
  it("anneau : les groupes à valeur nulle sont nommés, sinon aucune note", () => {
    expect(donutNote([])).toBeUndefined();
    expect(donutNote(["CDD", "Stagiaire"])).toBe("Valeur nulle, absents de l'anneau : CDD, Stagiaire.");
  });
  it("taux tous à zéro : une phrase ; un taux non nul ou aucune valeur connue : rien", () => {
    const s = (values: (number | null)[]) => ({ key: "k", name: "k", values });
    expect(zeroRateNote([s([0, 0, null])])).toBe("Tous les taux tracés valent 0,00 %.");
    expect(zeroRateNote([s([0, 691])])).toBeUndefined();
    expect(zeroRateNote([s([null, null])])).toBeUndefined();
  });
});

describe("glossaire KPI RH (lot 10)", () => {
  const ids = GLOSSARY_KPI.map((e) => e.id);
  const entry = (id: string) => GLOSSARY_KPI.find((e) => e.id === id)!;
  it("identifiants uniques, famille « KPI RH », terme et définition renseignés", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of GLOSSARY_KPI) {
      expect(e.family, e.id).toBe("KPI RH");
      expect(e.term.trim(), e.id).not.toBe("");
      expect(e.definition.trim(), e.id).not.toBe("");
      expect(e.id, e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
  it("aucun de ces identifiants n'est défini dans une autre famille", () => {
    for (const id of ids) expect(GLOSSARY.filter((e) => e.id === id), id).toHaveLength(1);
  });
  it("chaque « ? » des écrans KPI RH mène à une entrée existante", () => {
    const known = new Set([...GLOSSARY_KPI, ...GLOSSARY_RH].map((e) => e.id));
    for (const [nom, id] of Object.entries(KPI_TERMS)) expect(known.has(id), `${nom} → ${id}`).toBe(true);
  });
  it("les anciennes ancres #def-… des définitions de l'écran sont conservées comme identifiants", () => {
    for (const d of KPI_DEFINITIONS) expect(ids, d.id).toContain(d.id);
    expect(ids).toContain("lecture-graphique");
    expect(ids).toContain("effectifs-mensuels");
  });
  it("le texte retiré des écrans est au glossaire (phrases repères écrites à la main)", () => {
    const has = (id: string, phrase: string) => expect(entry(id).definition, `${id} : ${phrase}`).toContain(phrase);
    has("etp-month-end", "borne basse « ≥ x »");
    has("etp-average", "prorata journalier");
    has("headcount-average", "aux mêmes conditions que l'ETP moyen");
    has("turnover", "((entrées + sorties) ÷ 2) ÷ effectif moyen");
    has("turnover", "il n'existe pas de taux mensuel");
    has("turnover", "contrats continus");
    has("absenteeism", "jamais une moyenne de taux mensuels");
    has("absenteeism", "fr_maladie_ordinaire");
    has("absenteeism", "les arrêts de travail ne sont pas extraits");
    has("previous-period", "valeur − N-1");
    has("previous-period", "jamais coloré en rouge ou en vert");
    has("rounding", "demi vers le haut");
    has("lecture-graphique", "ne part pas de zéro");
    has("lecture-graphique", "colonne hachurée");
    has("lecture-graphique", "jamais une moyenne de taux mensuels");
    has("kpi-mois-par-mois", "jamais une moyenne de colonne recalculée par l'écran");
    has("kpi-categories", "ETP contractuel de fin de mois");
    has("kpi-types-absence", "nombre d'absences dans toute la lecture");
    has("kpi-limites-lecture", "n'historise pas les quotités");
    has("effectifs-mesures", "Les stocks (ETP, inscrit) ne s'additionnent pas dans le temps");
    has("effectifs-ventilation", "code analytique");
    has("effectifs-version", "réel PayFit courant");
    has("effectifs-version", "« proj. »");
    has("effectifs-repartition", "jusqu'à huit parts");
    has("effectifs-graphiques", "« Empiler » superpose les groupes");
  });
  it("raisons des n.d. et écarts PayFit / DSN : une ligne par cas, reprise de la source", () => {
    expect(entry("kpi-nd-raisons").definition.split("\n\n")).toHaveLength(KPI_ND_EXPLANATIONS.length);
    expect(entry("kpi-nd-raisons").definition.startsWith("Période non close : la période dépasse le dernier mois clos")).toBe(true);
    expect(entry("kpi-ecarts-sources").definition.split("\n\n")).toHaveLength(SOURCE_GAPS.length);
    expect(entry("kpi-ecarts-sources").definition.startsWith("Quotités — PayFit : à la date de lecture, non historisées. DSN : déclarées pour chaque mois (S21.G00.40.012 / .013).")).toBe(true);
  });
  it("formules d'une ligne, écrites à la main", () => {
    expect(entry("turnover").formula).toBe("((entrées + sorties) ÷ 2) ÷ effectif moyen");
    expect(entry("absenteeism").formula).toBe("jours d'absence ÷ jours théoriques");
    expect(entry("previous-period").formula).toBe("écart = valeur − N-1");
    for (const e of GLOSSARY_KPI) if (e.formula) expect(e.formula, e.id).not.toContain("\n");
  });
  it("français de produit : ni vocabulaire interne, ni tutoiement", () => {
    for (const e of GLOSSARY_KPI) expect(`${e.term} ${e.definition}`, e.id).not.toMatch(/outil observé|webinaire|\bcahier\b|compte pilote|\btu\b|\btoi\b|\bton\b|\bta\b/i);
  });
});

describe("univers bleu / blanc / noir de l'écran KPI RH (lot 10)", () => {
  // Fichiers de la zone : aucune couleur codée en dur hors blanc, noir, gris et bleu (le rouge et le vert viennent de --bad / --good,
  // réservés aux tendances d'un coût : cet écran n'en a pas).
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  const zone = [...files(join(process.cwd(), "src/app/e/[slug]/studio-rh/kpi")), join(process.cwd(), "src/styles/kpi.css"), join(process.cwd(), "src/lib/viz/kpi.ts"), join(process.cwd(), "src/lib/glossary/kpi.ts")];
  const hsl = (hex: string): { h: number; s: number } => {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0 };
    const d = max - min;
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s };
  };
  it("le calcul de teinte reconnaît le bleu, le gris, le rouge et le vert (cas écrits à la main)", () => {
    expect(hsl("155cff").h).toBeCloseTo(222, 0);
    expect(hsl("6c7280").s).toBeLessThan(0.1);
    expect(hsl("c4302b").h).toBeLessThan(10);
    expect(hsl("138a55").h).toBeCloseTo(153, 0);
  });
  it("chaque couleur hexadécimale est blanche, grise ou bleue", () => {
    let seen = 0;
    for (const f of zone.filter((x) => /\.(css|tsx?)$/.test(x))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
        seen += 1;
        const { h, s } = hsl(m[1]);
        expect(s < 0.2 || (h >= 200 && h <= 250), `${f} : #${m[1]}`).toBe(true);
      }
      expect(src, f).not.toMatch(/\brgba?\(|\bhsla?\(/);
    }
    expect(seen).toBeGreaterThan(0);
  });
  it("aucun rouge / vert de tendance sur cet écran (effectifs, ETP, taux, mouvements ne sont pas des montants)", () => {
    for (const f of zone.filter((x) => /\.(css|tsx?)$/.test(x) && !/glossary\/kpi\.ts$/.test(x) && !/viz-kpi/.test(x))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/trend-(good|bad)|--bad\b|--good\b|costTone|trendClass/);
    }
  });
});

describe("écrans KPI RH : tuile, titres, graphiques sans note (lot 10)", () => {
  const render = (el: React.ReactElement) => {
    const html = renderToStaticMarkup(el);
    for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
    return html;
  };
  const tile = (over: Record<string, unknown> = {}) =>
    render(
      h(KpiTile, {
        id: "turnover", slug: "demo", label: "Turnover", shown: { text: "14,46 %", kind: "value" }, n1: "53,85 %", n1Title: "12 mois glissants : octobre 2024 → septembre 2025",
        delta: "−39,39 pts", term: "turnover", detail: "?detail=turnover#kpi-detail", detailN1: "?detail=turnover&periode=n1#kpi-detail", ...over,
      }),
    );
  it("tuile : valeur, N-1, écart, « ? » vers le glossaire, détails ; ni formule ni paramètres ni définition", () => {
    const html = tile({ qualifiers: ["entrées et sorties en contrats, effectif en personnes", "1 sortie(s) exclue(s) : natures 02"] });
    expect(html).toContain('data-testid="kpi-tile-turnover"');
    expect(html).toContain('href="/e/demo/glossaire#def-turnover"');
    expect(html).toContain("14,46 %");
    expect(html).toContain("N-1 : 53,85 %");
    expect(html).toContain("Écart : −39,39 pts");
    expect(html).toContain('data-testid="kpi-tile-turnover-detail-n1"');
    expect(html).toContain("1 sortie(s) exclue(s) : natures 02"); // limite qui change la lecture : conservée
    expect(html).not.toContain("entrées et sorties en contrats, effectif en personnes"); // explication : au glossaire
    expect(html).not.toMatch(/delta-calc|Paramètres et périmètre|Définition<|÷ 2|×/);
    expect(html).not.toMatch(/trend-(good|bad)/); // un écart de taux n'est pas un montant
  });
  it("tuile n.d. : la raison reste affichée, jamais zéro", () => {
    const html = tile({ shown: { text: "n.d. — arrêts non extraits de la DSN", kind: "nd" }, n1: "n.d. — contrats continus non vérifiables", delta: "n.d." });
    expect(html).toContain("n.d. — arrêts non extraits de la DSN");
    expect(html).toContain("N-1 : n.d. — contrats continus non vérifiables");
  });
  it("tuile : un identifiant de glossaire inconnu ne produit aucun lien mort", () => {
    expect(tile({ term: "inconnu" })).not.toContain("glossaire#def-inconnu");
  });
  it("titre de panneau : titre court suivi du « ? » (libellé accessible)", () => {
    const html = render(h(PanelTitle, { slug: "demo", term: "lecture-graphique", label: "Lecture des graphiques KPI RH", children: "Lecture graphique" }));
    expect(html).toContain("<h2>Lecture graphique</h2>");
    expect(html).toContain('href="/e/demo/glossaire#def-lecture-graphique"');
    expect(html).toContain('aria-label="Définition : Lecture des graphiques KPI RH"');
  });
  it("types d'absence : listes de la lecture conservées, phrase d'explication retirée", () => {
    const html = render(h(AbsenceTypeNotes, { chosen: [{ type: "fr_maladie_ordinaire", count: 3 }], other: [{ type: "test_maternity", count: 1 }], missing: [{ type: "fr_conges_x" }], slug: "demo" }));
    expect(html).toContain("Types comptés</strong> : <span>");
    expect(html).toContain("Maladie ordinaire");
    expect(html).toContain("test_maternity</code> (1)");
    expect(html).toContain("Types comptés absents de la lecture</strong>");
    expect(html).not.toContain("Entre parenthèses");
    expect(html).toContain("glossaire#def-kpi-types-absence");
  });
  it("paramètres en vigueur : valeur et origine de chaque règle, lien vers l'explication de l'origine", () => {
    const html = render(h(KpiParams, { slug: "demo", params: [{ label: "Un temps plein vaut 1 ETP", value: "oui", origin: "valeur par défaut validée le 22/10/2026", testId: "fullTimeIsOne" }] }));
    expect(html).toContain('data-testid="kpi-param-fullTimeIsOne"');
    expect(html).toContain("oui");
    expect(html).toContain("valeur par défaut validée le 22/10/2026");
    expect(html).toContain("glossaire#def-kpi-parametres");
    expect(html).not.toContain("kpi-definitions");
  });
  it("graphiques : plus aucune note de lecture ; seule la phrase « tous les taux valent 0,00 % » reste, quand elle est vraie", () => {
    const row = (month: string, prev: string, ratio: { num: number; den: number }): RowIn => ({
      month, headcount: { kind: "exact", persons: 7 }, etp: { kind: "exact", etp4: 61000 }, movements: { entries: { kind: "exact", value: 1 }, exits: { kind: "exact", value: 0 } },
      absenteeism: { kind: "exact", ratio }, previous: { month: prev, etp: { kind: "exact", etp4: 50000 }, absenteeism: { kind: "exact", ratio } },
    });
    const compared = (num: number) => ({ window: { label: "12 mois au 30/09/2026" }, previousWindow: { label: "12 mois au 30/09/2025" }, current: { kind: "exact", ratio: { num, den: 83 } }, previous: { kind: "exact", ratio: { num, den: 83 } } }) as never;
    const draw = (num: number, ratio: { num: number; den: number }) =>
      render(h(KpiCharts, { slug: "demo", vue: "suivi", rows: [row("2026-08", "2025-08", ratio), row("2026-09", "2025-09", ratio)] as never, turnover: compared(num), absenteeism: compared(num) }));
    const zero = draw(0, { num: 0, den: 434 });
    expect(zero.match(/class="chart-note"/g)?.length ?? 0).toBeGreaterThanOrEqual(2); // taux tous à zéro : courbe d'absentéisme et barres de période
    expect(zero).toContain("Tous les taux tracés valent 0,00 %.");
    expect(zero).toContain('href="/e/demo/glossaire#def-lecture-graphique"');
    const nonZero = draw(12, { num: 30, den: 434 });
    expect(nonZero).not.toContain("Tous les taux tracés");
    expect(nonZero).not.toMatch(/Taux du mois seul|Mouvements comptés selon|Quotités à la date de lecture|jamais une moyenne/);
  });
});

describe("relecture du lot 10 : traçabilité de l'écart, liens du glossaire, limites conservées", () => {
  const render = (el: React.ReactElement) => renderToStaticMarkup(el);
  const tile = (over: Record<string, unknown> = {}) =>
    render(h(KpiTile, { id: "turnover", slug: "demo", label: "Turnover", shown: { text: "14,46 %", kind: "value" }, n1: "53,85 %", delta: "−39,39 pts", term: "turnover", detail: "?d", detailN1: "?n", ...over }));

  it("écart exact : valeur − N-1 en fractions, avec le vrai signe moins (cas écrits à la main)", () => {
    // 12/83 − 7/13 = (156 − 581)/1079 = −425/1079 ; × 100 = −42500/1079 (écart de taux, en points).
    expect(deltaExact({ num: 12, den: 83 }, { num: 7, den: 13 }, { num: -42500, den: 1079 }, true)).toBe("(12/83 − 7/13) × 100 = \u221242500/1079");
    // ETP : 61 000 et 56 000 dix-millièmes → 61/10 − 28/5 = 1/2 (fractions réduites).
    expect(deltaExact({ num: 61000, den: 10000 }, { num: 56000, den: 10000 }, { num: 5000, den: 10000 })).toBe("61/10 − 28/5 = 1/2");
  });
  it("tuile : l'écart exact est au survol seulement, jamais écrit sur la tuile", () => {
    const html = tile({ deltaTitle: "(12/83 − 7/13) × 100 = \u221242500/1079" });
    expect(html).toContain('title="(12/83 − 7/13) × 100 = \u221242500/1079"');
    expect(html.replace(/ title="[^"]*"/g, "")).not.toMatch(/×|1079/); // rien de visible
    expect(tile()).not.toMatch(/data-testid="kpi-tile-turnover-delta"[^>]*title=|title="[^"]*"[^>]*data-testid="kpi-tile-turnover-delta"/);
  });
  it("tuile : un bloc replié des remarques (types d'absence) reste du HTML valide, dans une division et non dans un span", () => {
    const html = tile({ children: h("details", { className: "tile-more" }, h("summary", null, "Types d'absence")) });
    expect(html).toContain('<div class="tile-notes">');
    expect(html).not.toContain('<span class="tile-notes">');
    expect(html.indexOf('<details class="tile-more">')).toBeGreaterThan(html.indexOf('<div class="tile-notes">'));
  });
  it("raisons des n.d. : le « ? » mène à l'entrée du glossaire quand l'espace est connu, la liste des raisons est conservée", () => {
    const items = [{ month: "2025-12", shown: { text: "n.d. — mois non couvert par la DSN", kind: "nd" as const } }, { month: "2026-01", shown: { text: "n.d. — mois non couvert par la DSN", kind: "nd" as const } }];
    const withLink = render(h(NdReasons, { items, slug: "demo" }));
    expect(withLink).toContain('href="/e/demo/glossaire#def-kpi-nd-raisons"');
    expect(withLink).toContain("mois non couvert par la DSN");
    expect(render(h(NdReasons, { items }))).not.toContain("glossaire#def-kpi-nd-raisons");
    expect(render(h(NdReasons, { items: [{ month: "2026-01", shown: { text: "6,10", kind: "value" as const } }], slug: "demo" }))).toBe("");
  });
  it("en-tête : un « ? » vers les écarts entre PayFit et DSN quand une source est retenue, aucun sinon", () => {
    const ctx = (chosen: string | null) => ({ collab: { slug: "demo", source: { domain: "rh", chosen, appliedAt: null, reason: "raison", mode: "auto", modeSetAt: null }, state: null, switchedAt: null, data: null }, input: null }) as never;
    expect(render(h(KpiHeader, { ctx: ctx("payfit"), closedMonth: null }))).toContain('href="/e/demo/glossaire#def-kpi-ecarts-sources"');
    expect(render(h(KpiHeader, { ctx: ctx(null), closedMonth: null }))).not.toContain("glossaire#def-kpi-ecarts-sources");
  });
  it("glossaire : chaque « Voir aussi » mène à une entrée existante autre que la sienne ; les notions sans « ? » d'écran sont atteintes par un renvoi", () => {
    const all = new Set(GLOSSARY.map((e) => e.id));
    for (const e of GLOSSARY_KPI) for (const id of e.see ?? []) {
      expect(all.has(id), `${e.id} → ${id}`).toBe(true);
      expect(id, e.id).not.toBe(e.id);
    }
    // Aucun « ? » d'écran ne pointe vers ces notions : le renvoi est leur seul accès depuis un indicateur.
    const seen = new Set(GLOSSARY_KPI.flatMap((e) => e.see ?? []));
    for (const id of ["etp-contract", "rounding", "movements", "reference-date", "lecture-hachure", "lecture-axe"]) expect(seen.has(id), id).toBe(true);
  });
  it("limite de lecture conservée au glossaire : la limite de conservation PayFit reste un constat à vérifier pour chaque espace", () => {
    expect(GLOSSARY_KPI.find((e) => e.id === "kpi-limites-lecture")!.definition).toContain("constat sur un compte PayFit, à vérifier pour chaque espace");
    expect(GLOSSARY_KPI.find((e) => e.id === "previous-period")!.definition).toContain("au survol de « Écart »");
  });
});
