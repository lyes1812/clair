import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChartGuard, GraphFoot, MsHead, NdKey, PanelHead, Tile, TrendLegend } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import { onColor } from "@/components/charts/shared";
import { unitFormat } from "@/components/charts/units";
import { GLOSSARY } from "@/lib/glossary";
import { GLOSSARY_MASSE, MASSE_TERMS } from "@/lib/glossary/masse";
import { formatEuros } from "@/lib/money";
import { PAYROLL_DEFINITIONS } from "@/lib/payroll/definitions";
import { monthPayroll, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { roundHalfUp } from "@/lib/rh/kpi/fraction";
import {
  brutCotisationsSeries,
  brutParts,
  capital,
  COLORS,
  costPerEtpCents,
  costSeries,
  dsnPoint,
  dsnSeries,
  euros,
  eurosSigned,
  FAMILY_HUES,
  familyColor,
  fixeVariableMonths,
  fixeVariableSeries,
  evoDelta,
  evoPctDelta,
  hasData,
  hasNd,
  masseSeries,
  monthLongLabel,
  monthShortLabel,
  monthShortYear,
  monthsAxis,
  ndGroups,
  ndLines,
  ndShape,
  noPeriod,
  numTrend,
  pluriel,
  primesSeries,
  provisionParts,
  provisionTotals,
  reasonText,
  reconMonthSeries,
  reconRubricChart,
  serviceColor,
  seriesReasons,
  serviceMonthSeries,
  sourceReason,
  servicesParts,
  trendOf,
  type DsnIn,
  type EtpIn,
  type MonthIn,
  type ProvisionIn,
} from "@/lib/viz/masse";

// Adaptateurs « résultat du moteur de masse salariale → série de graphique » : cas de référence écrits à la main.
const ND = (month: string, reason: string, open = false): MonthIn => ({ month, kind: "nd", open, nd: { reason } });
const value = (month: string, r: { salaires: number; primes: number; stages: number; indemnites: number }, cotisations: number, open = false): MonthIn => {
  const brut = r.salaires + r.primes + r.stages + r.indemnites;
  return { month, kind: "value", open, brut, cotisations, masse: brut + cotisations, byRubric: r };
};

// 2026 : janvier connu, février connu mais provisoire (paie non clôturée), mars n.d. ; 2025 : janvier connu, février n.d., mars connu.
const cur: MonthIn[] = [
  value("2026-01", { salaires: 300000, primes: 50000, stages: 0, indemnites: 3000 }, 120000), // brut 3 530,00 €, masse 4 730,00 €
  value("2026-02", { salaires: 300000, primes: 0, stages: 20000, indemnites: 0 }, 110000, true), // brut 3 200,00 €, masse 4 300,00 €
  ND("2026-03", "journal de paie 2026-03 non renvoyé par PayFit"),
];
const prev: MonthIn[] = [
  value("2025-01", { salaires: 280000, primes: 0, stages: 0, indemnites: 0 }, 120000), // masse 4 000,00 €
  ND("2025-02", "mois 2025-02 hors de la lecture PayFit appliquée"),
  value("2025-03", { salaires: 290000, primes: 0, stages: 0, indemnites: 0 }, 120000), // masse 4 100,00 €
];

describe("axe des mois", () => {
  it("étiquettes courtes, intitulés longs avec N-1 et mention « provisoire »", () => {
    expect(monthShortLabel("2026-09")).toBe("sept.");
    expect(monthLongLabel("2026-09")).toBe("septembre 2026");
    expect(monthShortYear("2025-03")).toBe("mars 2025");
    expect(monthsAxis(["2026-01", "2026-02"], ["2025-01", "2025-02"], ["2026-02"])).toEqual({
      categories: ["janv.", "févr."],
      titles: ["janvier 2026 · N-1 : janvier 2025", "février 2026 (provisoire) · N-1 : février 2025"],
    });
    // Sans N-1 (graphique d'une seule année) : aucun « N-1 » dans l'intitulé.
    expect(monthsAxis(["2026-01"]).titles).toEqual(["janvier 2026"]);
  });
});

describe("masse chargée N face à N-1 (Synthèse)", () => {
  const s = masseSeries(cur, prev, { cur: "Masse chargée 2026", prev: "Masse chargée 2025 (N-1)" });
  it("N : 4 730,00 €, 4 300,00 €, n.d. ; N-1 : 4 000,00 €, n.d., 4 100,00 € (centimes)", () => {
    expect(s.map((x) => x.values)).toEqual([[473000, 430000, null], [400000, null, 410000]]);
  });
  it("un mois n.d. garde sa raison, jamais un zéro", () => {
    expect(s[0].reasons).toEqual([null, null, "journal de paie 2026-03 non renvoyé par PayFit"]);
    expect(s[1].reasons).toEqual([null, "mois 2025-02 hors de la lecture PayFit appliquée", null]);
    expect(s.flatMap((x) => x.values)).not.toContain(0);
  });
});

describe("brut et cotisations patronales empilés", () => {
  it("brut 3 530,00 € + cotisations 1 200,00 € = masse 4 730,00 € ; le mois n.d. reste n.d. dans les deux séries", () => {
    const [brut, cotis] = brutCotisationsSeries(cur);
    expect(brut.values).toEqual([353000, 320000, null]);
    expect(cotis.values).toEqual([120000, 110000, null]);
    expect(brut.values[0]! + cotis.values[0]!).toBe(473000);
    expect(brut.reasons?.[2]).toBe(cotis.reasons?.[2]);
  });
});

describe("coût par ETP d'un mois", () => {
  it("19 530,00 € ÷ 6 ETP = 3 255,00 € ; 10 000,00 € ÷ 3 ETP = 3 333,33 € (arrondi au centime)", () => {
    expect(costPerEtpCents(1953000, 60000)).toBe(325500);
    expect(costPerEtpCents(1000000, 30000)).toBe(333333);
  });
  it("demi-centime : arrondi vers le haut (2,5 → 3), 1/3 de centime → 0 ; comme le tableau (eurosOf)", () => {
    expect(costPerEtpCents(5, 20000)).toBe(3);
    expect(costPerEtpCents(1, 30000)).toBe(0);
    // Le tableau écrit fmtFixed({ num: masse × 10 000, den: etp4 × 100 }, 2) : mêmes centimes.
    for (const [masse, etp4] of [[1953000, 60000], [1000000, 30000], [5, 20000], [473000, 60000], [4900, 70001]]) {
      expect(costPerEtpCents(masse, etp4)).toBe(Number(roundHalfUp({ num: masse * 10000, den: etp4 * 100 }, 2)));
    }
  });
  it("ETP nul ou négatif : non défini (null), jamais zéro", () => {
    expect(costPerEtpCents(1953000, 0)).toBeNull();
    expect(costPerEtpCents(1953000, -10000)).toBeNull();
  });
  it("hors des entiers sûrs : null", () => {
    expect(costPerEtpCents(Number.MAX_SAFE_INTEGER, 10000)).toBeNull();
  });
  const etpCur: EtpIn[] = [
    { month: "2026-01", etp4: 60000, reason: null },
    { month: "2026-02", etp4: null, reason: "quotité absente" },
    { month: "2026-03", etp4: 60000, reason: null },
  ];
  const etpPrev: EtpIn[] = [
    { month: "2025-01", etp4: 50000, reason: null },
    { month: "2025-02", etp4: 50000, reason: null },
    { month: "2025-03", etp4: 0, reason: null },
  ];
  const s = costSeries(cur, etpCur, prev, etpPrev, { cur: "Coût 2026", prev: "Coût 2025 (N-1)" });
  it("N : 4 730,00 € ÷ 6 ETP = 788,33 € ; février sans ETP et mars sans journal : n.d. avec raison", () => {
    // 473 000 × 10 000 ÷ 60 000 = 78 833,33… centimes → 78 833.
    expect(s[0].values).toEqual([78833, null, null]);
    expect(s[0].reasons).toEqual([null, "ETP fin 2026-02 : quotité absente", "journal de paie 2026-03 non renvoyé par PayFit"]);
  });
  it("N-1 : 4 000,00 € ÷ 5 ETP = 800,00 € ; mois n.d. ; ETP nul : non défini", () => {
    expect(s[1].values).toEqual([80000, null, null]);
    expect(s[1].reasons).toEqual([null, "mois 2025-02 hors de la lecture PayFit appliquée", "ETP fin 2025-03 nul : coût par ETP non défini"]);
    expect(s[1].dashed).toBe(true);
    expect(s[0].dashed).toBeUndefined();
  });
});

describe("répartition par service", () => {
  it("parts en centimes ; service n.d. listé avec sa raison ; service sans coût positif nommé, pas d'anneau", () => {
    const { parts, omitted } = servicesParts([
      { value: "A", cur: { kind: "value", masse: 700000 } },
      { value: "B", cur: { kind: "value", masse: 300000 } },
      { value: "C", cur: { kind: "nd", nd: { reason: "ligne 2026-01#7 du compte 641100 sans montant" } } },
      { value: null, cur: { kind: "value", masse: 0 } },
    ]);
    expect(parts).toEqual([
      { key: "A", name: "A", value: 700000, color: "var(--chart-4)" },
      { key: "B", name: "B", value: 300000, color: "var(--chart-6)" },
      { key: "C", name: "C", value: null, reason: "ligne 2026-01#7 du compte 641100 sans montant", color: "var(--chart-5)" },
    ]);
    expect(omitted).toEqual([`Non ventilé (${formatEuros(0)})`]);
  });
  it("« non ventilé » à coût positif : une part nommée comme dans le tableau, teinte de son rang", () => {
    const { parts } = servicesParts([{ value: "A", cur: { kind: "value", masse: 5 } }, { value: null, cur: { kind: "value", masse: 1000 } }]);
    expect(parts[1]).toEqual({ key: "__nv__", name: "Non ventilé", value: 1000, color: "var(--chart-6)" });
  });
  it("teintes : huit teintes de la charte, puis retour à la première ; le rang compte même pour un service sans secteur", () => {
    expect([0, 1, 7, 8, 9].map(serviceColor)).toEqual(["var(--chart-4)", "var(--chart-6)", "var(--chart-1)", "var(--chart-4)", "var(--chart-6)"]);
    // Le service de rang 2 garde sa teinte (5) même si celui de rang 1 (masse nulle) n'a pas de secteur.
    const { parts } = servicesParts([
      { value: "A", cur: { kind: "value", masse: 10 } },
      { value: "B", cur: { kind: "value", masse: 0 } },
      { value: "C", cur: { kind: "value", masse: 5 } },
    ]);
    expect(parts.map((p) => [p.key, p.color])).toEqual([["A", "var(--chart-4)"], ["C", "var(--chart-5)"]]);
  });
  it("par mois et par service : une série par service, la somme des services égale le total du mois, un mois n.d. reste n.d.", () => {
    const a = [value("2026-01", { salaires: 1000, primes: 0, stages: 0, indemnites: 0 }, 300), value("2026-02", { salaires: 1100, primes: 0, stages: 0, indemnites: 0 }, 330)];
    const b = [value("2026-01", { salaires: 500, primes: 0, stages: 0, indemnites: 0 }, 150), ND("2026-02", "ligne 2026-02#3 du compte 641100 sans montant")];
    const s = serviceMonthSeries([{ value: "A", months: a }, { value: null, months: b }]);
    expect(s.map((x) => [x.key, x.name, x.color])).toEqual([["A", "A", "var(--chart-4)"], ["__nv__", "Non ventilé", "var(--chart-6)"]]);
    expect(s[0].values).toEqual([1300, 1430]);
    expect(s[1].values).toEqual([650, null]);
    expect(s[1].reasons).toEqual([null, "ligne 2026-02#3 du compte 641100 sans montant"]);
    // Janvier : 1 300 + 650 = 1 950 = masse du mois pour tous les services.
    expect(s[0].values[0]! + s[1].values[0]!).toBe(1950);
  });
});

describe("fixe et variable", () => {
  const fv = fixeVariableMonths(cur);
  it("janvier : fixe 3 000,00 €, variable 500,00 + 30,00 = 530,00 €, dont primes 500,00 €, stages 0 ; la somme égale le brut", () => {
    expect(fv[0]).toEqual({ month: "2026-01", kind: "value", fixe: 300000, variable: 53000, primes: 50000, stages: 0, brut: 353000 });
    for (const m of fv) if (m.kind === "value") expect(m.fixe + m.variable + m.stages).toBe(m.brut);
  });
  it("février : variable nul (zéro réel d'un mois connu), gratifications de stage 200,00 € ; mars n.d. avec sa raison", () => {
    expect(fv[1]).toMatchObject({ kind: "value", fixe: 300000, variable: 0, stages: 20000, brut: 320000 });
    expect(fv[2]).toEqual({ month: "2026-03", kind: "nd", reason: "journal de paie 2026-03 non renvoyé par PayFit" });
  });
  it("séries : une par nature, mois n.d. à null avec la raison", () => {
    const [fixe, variable, stages] = fixeVariableSeries(fv);
    expect(fixe.values).toEqual([300000, 300000, null]);
    expect(variable.values).toEqual([53000, 0, null]);
    expect(stages.values).toEqual([0, 20000, null]);
    expect(fixe.reasons?.[2]).toBe("journal de paie 2026-03 non renvoyé par PayFit");
  });
  it("répartition du brut de la période : trois parts aux teintes des séries", () => {
    expect(brutParts({ fixe: 600000, variable: 53000, stages: 20000 }).map((p) => [p.key, p.value])).toEqual([["fixe", 600000], ["variable", 53000], ["stages", 20000]]);
    expect(brutParts({ fixe: 1, variable: 2, stages: 3 }).map((p) => p.color)).toEqual(fixeVariableSeries([]).map((s) => s.color));
  });
});

describe("primes par famille et par mois", () => {
  it("une série par famille ; un mois connu sans ligne de la famille est un zéro réel, un mois n.d. reste n.d.", () => {
    const s = primesSeries(
      [{ label: "Primes sur objectif" }, { label: "Primes de vacances" }],
      [
        { month: "2026-01", kind: "value", byFamily: [30000, 20000] },
        { month: "2026-02", kind: "value", byFamily: [0, 0] },
        { month: "2026-03", kind: "nd", reason: "journal de paie 2026-03 non renvoyé par PayFit" },
      ],
    );
    expect(s.map((x) => x.name)).toEqual(["Primes sur objectif", "Primes de vacances"]);
    expect(s[0].values).toEqual([30000, 0, null]);
    expect(s[1].values).toEqual([20000, 0, null]);
    expect(s[0].key).not.toBe(s[1].key);
    // Total empilé de janvier = 500,00 € = « dont primes » du mois.
    expect(s[0].values[0]! + s[1].values[0]!).toBe(50000);
  });
  it("une famille absente d'un mois (tableau trop court) n'est pas complétée par un zéro", () => {
    const s = primesSeries([{ label: "A" }, { label: "B" }], [{ month: "2026-01", kind: "value", byFamily: [1] }]);
    expect(s[1].values).toEqual([null]);
    expect(s[1].reasons?.[0]).toMatch(/absente/);
  });
});

describe("provision de congés payés", () => {
  const list: ProvisionIn[] = [
    { kind: "value", conges: 100000, charges: 40000, total: 140000, missing: [] },
    { kind: "value", conges: 120000, charges: null, total: null, missing: ["charges sociales : aucune ligne hors 6412 « Mois courant » en 2026-02"] },
    { kind: "nd", reason: "journal de paie 2026-03 non renvoyé par PayFit" },
  ];
  it("congés payés et charges sociales : une part n.d. n'est pas tracée et garde sa raison", () => {
    const [conges, charges] = provisionParts(list);
    expect(conges.values).toEqual([100000, 120000, null]);
    expect(charges.values).toEqual([40000, null, null]);
    expect(charges.reasons).toEqual([null, "charges sociales : aucune ligne hors 6412 « Mois courant » en 2026-02", "journal de paie 2026-03 non renvoyé par PayFit"]);
  });
  it("totaux N et N-1 : 1 400,00 € ; un total n.d. est coupé, avec la part manquante comme raison", () => {
    const prevList: ProvisionIn[] = [{ kind: "value", conges: 90000, charges: 36000, total: 126000, missing: [] }, { kind: "nd", reason: "x" }, { kind: "nd", reason: "y" }];
    const [n, n1] = provisionTotals(list, prevList, { cur: "N", prev: "N-1" });
    expect(n.values).toEqual([140000, null, null]);
    expect(n.reasons?.[1]).toBe("charges sociales : aucune ligne hors 6412 « Mois courant » en 2026-02");
    expect(n1.values).toEqual([126000, null, null]);
    expect(n1.dashed).toBe(true);
  });
});

describe("rapprochement journal de paie / comptabilité", () => {
  it("par mois : deux séries, centimes tels que le tableau", () => {
    const [j, c] = reconMonthSeries([{ month: "2026-01", journal: 468000, compta: 468000 }, { month: "2026-02", journal: 430000, compta: 429454 }]);
    expect(j.values).toEqual([468000, 430000]);
    expect(c.values).toEqual([468000, 429454]);
    // Écart de février = journal − comptabilité = +5,46 € (546 centimes), lu dans le tableau.
    expect(j.values[1]! - c.values[1]!).toBe(546);
  });
  it("par rubrique : libellés courts de l'axe, noms complets en infobulle, libellé inconnu conservé", () => {
    const g = reconRubricChart([
      { key: "salaires", label: "Salaires et appointements", journal: 300000, compta: 306555 },
      { key: "provisions-cp", label: "Provisions de congés payés", journal: 10000, compta: 9454 },
      { key: "inconnue", label: "Rubrique future", journal: 1, compta: 1 },
    ]);
    expect(g.categories).toEqual(["Salaires", "Prov. CP", "Rubrique future"]);
    expect(g.titles).toEqual(["Salaires et appointements", "Provisions de congés payés", "Rubrique future"]);
    expect(g.series[0].values).toEqual([300000, 10000, 1]);
    expect(g.series[1].values).toEqual([306555, 9454, 1]);
  });
});

describe("source DSN : brut déclaré type 001", () => {
  const complete: DsnIn = { status: "complete", byType: { "001": 1483000, "002": 5000 } };
  it("quatre issues : valeur, DSN bloquée, DSN absente, type 001 absent (mêmes raisons que le contrôle du journal)", () => {
    expect(dsnPoint(complete)).toEqual({ v: 1483000, reason: null });
    expect(dsnPoint({ status: "blocked", byType: { "001": 5 } })).toEqual({ v: null, reason: "déclaration bloquée" });
    expect(dsnPoint(undefined)).toEqual({ v: null, reason: "aucune DSN retenue" });
    expect(dsnPoint({ status: "complete", byType: { "002": 1 } })).toEqual({ v: null, reason: "aucune rémunération de type 001" });
  });
  it("un mois incomplet est tracé (comme le tableau, qui le signale ⚠) ; les autres types ne sont pas additionnés", () => {
    const s = dsnSeries([complete, { status: "incomplete", byType: { "001": 100 } }, undefined], [undefined, undefined, complete], { cur: "2026", prev: "2025 (N-1)" });
    expect(s[0].values).toEqual([1483000, 100, null]);
    expect(s[1].values).toEqual([null, null, 1483000]);
  });
});

describe("série entièrement n.d. : graphique non tracé", () => {
  const nd = (key: string, reasons: string[]) => ({ key, name: key, values: reasons.map(() => null), reasons });
  it("aucune valeur connue : pas de données ; un zéro réel d'un mois connu est une valeur connue", () => {
    expect(hasData([])).toBe(false);
    expect(hasData([nd("a", ["x", "y"]), nd("b", ["x", "z"])])).toBe(false);
    expect(hasData([nd("a", ["x"]), { key: "b", name: "b", values: [0] }])).toBe(true);
    expect(hasData([{ key: "c", name: "c", values: [null, 12000] }])).toBe(true);
  });
  it("raisons distinctes dans l'ordre d'apparition, valeurs sans raison ignorées", () => {
    expect(seriesReasons([nd("a", ["x", "y"]), nd("b", ["x", "z"])])).toEqual(["x", "y", "z"]);
    expect(seriesReasons([{ key: "d", name: "d", values: [null, null], reasons: [null, ""] }, { key: "e", name: "e", values: [null] }])).toEqual([]);
  });
  it("sur les adaptateurs : N-1 entièrement n.d. mais N connu → tracé ; les deux n.d. → pas tracé, avec les deux raisons", () => {
    expect(hasData(masseSeries(cur, [ND("2025-01", "a"), ND("2025-02", "b"), ND("2025-03", "c")], { cur: "N", prev: "N-1" }))).toBe(true);
    const allNd = masseSeries([ND("2026-01", "a")], [ND("2025-01", "b")], { cur: "N", prev: "N-1" });
    expect(hasData(allNd)).toBe(false);
    expect(seriesReasons(allNd)).toEqual(["a", "b"]);
  });
});

describe("raisons des n.d. regroupées", () => {
  const groups = ndGroups([
    { month: "2026-03", reason: "quotité absente" },
    { month: "2025-03", reason: "journal absent" },
    { month: "2026-04", reason: "quotité absente" },
    { month: "2026-03", reason: "quotité absente" },
    { month: "2026-05", reason: null },
    { month: "2026-06", reason: "" },
  ]);
  it("même raison : une ligne, mois sans doublon, dans l'ordre d'apparition ; raison vide ignorée", () => {
    expect(groups).toEqual([
      { reason: "quotité absente", months: ["2026-03", "2026-04"] },
      { reason: "journal absent", months: ["2025-03"] },
    ]);
  });
  it("lignes lisibles avec l'année de chaque mois", () => {
    expect(ndLines(groups)).toEqual(["mars 2026, avr. 2026 : quotité absente", "mars 2025 : journal absent"]);
  });
});

describe("branchement sur le moteur et sur les graphiques", () => {
  let n = 0;
  const line = (month: string, accountId: string, debit: number | null, credit: number | null, contractId: string | null = null): LedgerLine => ({
    key: `${month}#${String(n++).padStart(5, "0")}`,
    month,
    accountId,
    accountName: `Compte ${accountId}`,
    debitCents: debit,
    creditCents: credit,
    contractId,
  });
  // Même journal que tests/unit/payroll.test.ts : janvier 2026 = brut 3 500,00 €, cotisations 1 180,00 €, masse 4 680,00 € ; mars provisoire.
  const input: JournalInput = {
    lines: [
      line("2026-01", "641100", 300000, null, "C1"),
      line("2026-01", "641300", 50000, null, "C1"),
      line("2026-01", "645100", 120000, null, "C1"),
      line("2026-01", "645100", null, 2000, "C1"),
      line("2026-01", "641200", 10000, null),
      line("2026-03", "641100", 1000, null),
    ],
    months: ["2026-01", "2026-02", "2026-03"],
    openMonths: ["2026-03"],
    grid: DEFAULT_PREFIXES,
  };
  const months = ["2026-01", "2026-02", "2026-03"].map((m) => monthPayroll(input, m));
  it("les mois du moteur sont acceptés tels quels : janvier connu, février n.d. (journal non renvoyé), mars provisoire", () => {
    const [s] = masseSeries(months, months, { cur: "N", prev: "N-1" });
    expect(s.values).toEqual([468000, null, 1000]);
    expect(s.reasons?.[1]).toBe("journal de paie 2026-02 non renvoyé par PayFit (mois non clôturé ou hors historique)");
    const fv = fixeVariableMonths(months);
    expect(fv[0]).toMatchObject({ kind: "value", fixe: 300000, variable: 50000, primes: 50000, stages: 0, brut: 350000 });
    const [brut, cotis] = brutCotisationsSeries(months);
    expect(brut.values).toEqual([350000, null, 1000]);
    expect(cotis.values).toEqual([118000, null, 0]);
  });
  it("les séries sont sérialisables (composants client) : ni fonction ni valeur indéfinie", () => {
    const all = [
      ...masseSeries(months, months, { cur: "N", prev: "N-1" }),
      ...brutCotisationsSeries(months),
      ...fixeVariableSeries(fixeVariableMonths(months)),
      ...costSeries(months, [], months, [], { cur: "N", prev: "N-1" }),
    ];
    for (const s of all) {
      expect(s.values.every((v) => v === null || typeof v === "number")).toBe(true);
      expect((s.reasons ?? []).every((r) => r === null || typeof r === "string")).toBe(true);
      expect(Object.values(s).some((v) => typeof v === "function" || v === undefined)).toBe(false);
    }
  });
  it("l'infobulle d'un montant en centimes écrit les mêmes euros que le tableau", () => {
    expect(unitFormat("eur").fmt(468000)).toBe(formatEuros(468000));
  });
});

// Les colonnes empilées écrivent leur montant dans le segment : chaque teinte de série empilée doit rester lisible sous le texte choisi
// par onColor (blanc sur les teintes 1, 2, 4 et 5, encre sur 3, 6, 7 et 8 ; RGAA : 4,5:1). Calcul de la luminance relative WCAG, teintes
// lues dans charts.css (palette bleu / gris-bleu / noir : aucune teinte de série n'est verte, ambre, violette ni turquoise).
describe("teintes des colonnes empilées : contraste du montant écrit dans la colonne", () => {
  const css = readFileSync(fileURLToPath(new URL("../../src/styles/charts.css", import.meta.url)), "utf8");
  const hexOfVar = (name: string) => {
    const m = new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`).exec(css);
    if (!m) throw new Error(`teinte introuvable : ${name}`);
    return m[1];
  };
  const hexOf = (token: string) => hexOfVar(/var\(--([a-z0-9-]+)\)/.exec(token)![1]);
  const channel = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = (hex: string) => 0.2126 * channel(parseInt(hex.slice(0, 2), 16)) + 0.7152 * channel(parseInt(hex.slice(2, 4), 16)) + 0.0722 * channel(parseInt(hex.slice(4, 6), 16));
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  it("valeurs de référence : blanc sur #155cff ≈ 5,3:1 ; blanc sur le bleu moyen #5f8cff ≈ 3,2:1 (insuffisant : encre) ; noir sur blanc = 21:1", () => {
    expect(contrast("ffffff", "155cff")).toBeGreaterThan(5.2);
    expect(contrast("ffffff", "155cff")).toBeLessThan(5.4);
    expect(contrast("ffffff", "5f8cff")).toBeLessThan(3.3);
    expect(contrast("ffffff", "5f8cff")).toBeGreaterThan(3.1);
    expect(contrast("ffffff", "000000")).toBeCloseTo(21, 5);
  });
  const stacked = () => [
    ...brutCotisationsSeries([]),
    ...fixeVariableSeries([]),
    ...provisionParts([]),
    ...primesSeries([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ label: `F${i}` })), []),
    ...serviceMonthSeries([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ value: `S${i}`, months: [] }))),
  ];
  it("brut, cotisations, fixe, variable, gratifications, congés payés, charges, familles de prime, services : texte blanc ou encre à 4,5:1 au moins", () => {
    const list = stacked();
    expect(list.length).toBe(2 + 3 + 2 + 8 + 8);
    for (const s of list) {
      const text = onColor(s.color!) === "#fff" ? "ffffff" : hexOfVar("chart-ink");
      expect(contrast(text, hexOf(s.color!)), `${s.key} ${s.color}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("le texte blanc n'est posé que sur les teintes 1, 2, 4 et 5 ; les teintes 3, 6, 7 et 8 portent de l'encre", () => {
    for (const s of stacked()) {
      const n = Number(/--chart-(\d)/.exec(s.color!)![1]);
      expect(onColor(s.color!), `${s.key} chart-${n}`).toBe([1, 2, 4, 5].includes(n) ? "#fff" : "var(--chart-ink)");
    }
  });
  it("toutes les séries sont des teintes de la charte (var(--chart-N)), aucune couleur libre", () => {
    for (const s of stacked()) expect(s.color, s.key).toMatch(/^var\(--chart-[1-8]\)$/);
    for (const [nom, c] of Object.entries(COLORS)) expect(c, nom).toMatch(/^var\(--chart-[1-8]\)$/);
  });
  it("les deux notions comparées dans un même graphique (N et N-1, brut et cotisations, journal et comptabilité, congés payés et charges) sont à 3:1 au moins sur fond blanc", () => {
    for (const c of [COLORS.now, COLORS.before, COLORS.brut, COLORS.cotisations, COLORS.journal, COLORS.compta, COLORS.conges, COLORS.charges]) {
      expect(contrast("ffffff", hexOf(c)), c).toBeGreaterThanOrEqual(3);
    }
  });
});

// Une teinte = une notion métier d'un écran : aucune teinte reprise pour une notion voisine.
describe("teintes : une par notion métier d'un écran", () => {
  const hues = (list: { color?: string }[]) => list.map((s) => s.color);
  it("Synthèse : N et N-1 (bleu, gris-bleu) ; brut, cotisations et services ont des teintes toutes différentes tant qu'il y a au plus quatre services", () => {
    const masse = hues(masseSeries([], [], { cur: "N", prev: "N-1" }));
    const bc = hues(brutCotisationsSeries([]));
    const services = [0, 1, 2, 3].map(serviceColor);
    const all = [...masse, ...bc, ...services];
    expect(new Set(all).size).toBe(all.length);
    expect(masse).toEqual([COLORS.now, COLORS.before]);
  });
  it("Fixe & variable : fixe, variable, gratifications et cinq familles de prime : huit teintes différentes ; l'anneau reprend celles des colonnes", () => {
    const fv = hues(fixeVariableSeries([]));
    const fam = [0, 1, 2, 3, 4].map(familyColor);
    const all = [...fv, ...fam];
    expect(new Set(all).size).toBe(all.length);
    expect(hues(primesSeries([{ label: "A" }, { label: "B" }], [])).concat()).toEqual([familyColor(0), familyColor(1)]);
    expect(brutParts({ fixe: 1, variable: 1, stages: 1 }).map((p) => p.color)).toEqual(fv);
  });
  it("Paie & comptabilité : congés payés, charges, journal de paie et comptabilité ont chacun leur teinte ; N en bleu, N-1 en gris-bleu", () => {
    const all = [COLORS.conges, COLORS.charges, COLORS.journal, COLORS.compta, COLORS.now, COLORS.before];
    expect(new Set(all).size).toBe(all.length);
    expect(hues(provisionParts([]))).toEqual([COLORS.conges, COLORS.charges]);
    expect(hues(reconMonthSeries([]))).toEqual([COLORS.journal, COLORS.compta]);
    expect(hues(provisionTotals([], [], { cur: "N", prev: "N-1" }))).toEqual([COLORS.now, COLORS.before]);
  });
});

// La clé de lecture « n.d. » n'est écrite que si le graphique contient réellement un n.d.
describe("n.d. d'un graphique", () => {
  const s = (key: string, values: (number | null)[]) => ({ key, name: key, values });
  it("aucun n.d. : pas de clé de lecture", () => {
    expect(ndShape([s("a", [1, 2]), s("b", [3, 0])])).toEqual({ columns: 0, values: 0 });
    expect(hasNd([s("a", [1, 2]), s("b", [3, 0])])).toBe(false);
    expect(hasNd([])).toBe(false);
  });
  it("un mois où aucune série n'a de valeur : colonne hachurée (une colonne), la valeur absente d'une seule série est comptée à part", () => {
    // Colonne 2 : toutes les séries n.d. (hachurée) ; colonne 1 : une seule série n.d. (non tracée, pas hachurée).
    const list = [s("a", [10, null, null]), s("b", [20, 5, null])];
    expect(ndShape(list)).toEqual({ columns: 1, values: 1 });
    expect(hasNd(list)).toBe(true);
  });
  it("valeur n.d. sans colonne entièrement n.d. : pas de hachure, mais la valeur absente est un n.d.", () => {
    const list = [s("a", [10, null]), s("b", [20, 5])];
    expect(ndShape(list)).toEqual({ columns: 0, values: 1 });
    expect(hasNd(list)).toBe(true);
  });
  it("un zéro réel n'est pas un n.d.", () => {
    expect(hasNd([s("a", [0, 0, 0])])).toBe(false);
  });
  it("sur les adaptateurs : 2026 avec mars n.d. et 2025 avec février n.d. → deux valeurs n.d., aucune colonne hachurée ; janvier seul connu partout → rien", () => {
    expect(ndShape(masseSeries(cur, prev, { cur: "N", prev: "N-1" }))).toEqual({ columns: 0, values: 2 });
    expect(hasNd(masseSeries([cur[0]], [prev[0]], { cur: "N", prev: "N-1" }))).toBe(false);
    // Mars 2026 n.d. et mars 2025 n.d. : colonne hachurée.
    expect(ndShape(masseSeries([cur[2]], [ND("2025-03", "x")], { cur: "N", prev: "N-1" })).columns).toBe(1);
  });
});

describe("montants signés et raisons", () => {
  it("vrai signe moins (U+2212), « + » devant un écart positif, rien devant zéro ; centimes entiers", () => {
    expect(eurosSigned(-17500)).toBe(`\u2212${formatEuros(17500)}`);
    expect(eurosSigned(54600)).toBe(`+${formatEuros(54600)}`);
    expect(eurosSigned(0)).toBe(formatEuros(0));
    expect(euros(-655550)).toBe(`\u2212${formatEuros(655550)}`);
    // Référence écrite à la main : −6 555,50 € (espaces insécables de la mise en forme française).
    expect(euros(-655550)).toMatch(/^\u22126[\s\u202f\u00a0]555,50[\s\u00a0]€$/);
    expect(euros(-655550).startsWith("-")).toBe(false);
    // Un montant positif n'est pas modifié.
    expect(euros(1234)).toBe(formatEuros(1234));
  });
  it("raison de source : sans point final, première lettre en minuscule sauf sigle ; nom propre en tête préservé par noPeriod", () => {
    expect(reasonText("Aucune source appliquée pour ce domaine.")).toBe("aucune source appliquée pour ce domaine");
    expect(reasonText("API choisie par l'administrateur, mais aucune lecture API appliquée.")).toBe("API choisie par l'administrateur, mais aucune lecture API appliquée");
    expect(reasonText("Fichiers choisis par l'administrateur, mais aucun dépôt appliqué.")).toBe("fichiers choisis par l'administrateur, mais aucun dépôt appliqué");
    expect(noPeriod("Pennylane non lu pour 2026-09. ")).toBe("Pennylane non lu pour 2026-09");
    expect(capital("ventilation par service désactivée")).toBe("Ventilation par service désactivée");
  });
  it("pluriel : « 1 famille », « 2 familles », « 0 famille »", () => {
    expect([0, 1, 2].map((n) => pluriel(n, "famille"))).toEqual(["0 famille", "1 famille", "2 familles"]);
  });
});

// Jusqu'à huit familles de prime (limite du graphique) : huit teintes différentes dans le même graphique ; au-delà de cinq, les
// teintes reprises le sont en dernier.
describe("familles de prime au-delà de cinq, reprise des teintes", () => {
  it("huit familles : huit teintes toutes différentes, les cinq premières sans reprise du fixe, du variable ni des gratifications", () => {
    const hues = [0, 1, 2, 3, 4, 5, 6, 7].map(familyColor);
    expect(new Set(hues).size).toBe(8);
    expect(FAMILY_HUES.length).toBe(8);
    const taken = new Set(fixeVariableSeries([]).map((s) => s.color));
    for (const h of hues.slice(0, 5)) expect(taken.has(h)).toBe(false);
    // Dans le graphique : une série par famille, chacune avec sa teinte.
    const families = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ label: `F${i}` }));
    const list = primesSeries(families, [{ month: "2026-01", kind: "value", byFamily: families.map(() => 100) }]);
    expect(new Set(list.map((s) => s.color)).size).toBe(8);
  });
  it("raison d'une source en parenthèses : sans capitale ni point final ; le début de la phrase et la suite sont conservés", () => {
    expect(sourceReason("aucune source RH retenue (Aucune source appliquée pour ce domaine.) : connectez PayFit ou déposez des DSN dans Données")).toBe("aucune source RH retenue (aucune source appliquée pour ce domaine) : connectez PayFit ou déposez des DSN dans Données");
    // Un sigle en tête garde ses capitales.
    expect(sourceReason("aucune source RH retenue (API choisie par l'administrateur, mais aucune lecture API appliquée.) : connectez PayFit")).toBe("aucune source RH retenue (API choisie par l'administrateur, mais aucune lecture API appliquée) : connectez PayFit");
    // Une autre raison n'est pas touchée.
    expect(sourceReason("journal comptable non lu : droit refusé (Lecture seule.)")).toBe("journal comptable non lu : droit refusé (Lecture seule.)");
  });
});

// --- Lot 10 : tendances financières d'un coût, glossaire, univers bleu / blanc / noir, écrans sans narratif.

describe("tendance d'un écart de montant (lot 10)", () => {
  it("hausse du coût : rouge ; baisse : vert ; écart nul ou n.d. : neutre (cas écrits à la main)", () => {
    // Masse N = 4 730,00 €, N-1 = 4 000,00 € : +730,00 € de coût, tendance négative.
    expect(trendOf(473000 - 400000)).toBe("trend-bad");
    // Provision 1 400,00 € contre 1 460,00 € : −60,00 €, tendance positive.
    expect(trendOf(140000 - 146000)).toBe("trend-good");
    expect(trendOf(0)).toBe("");
    expect(trendOf(null)).toBe("");
    expect(trendOf(undefined)).toBe("");
  });
  it("classes d'une cellule de tableau : « num » seul quand rien à colorer, « num trend-… » sinon", () => {
    expect(numTrend(54600)).toBe("num trend-bad");
    expect(numTrend(-655550)).toBe("num trend-good");
    expect(numTrend(0)).toBe("num");
    expect(numTrend(null)).toBe("num");
  });
  it("évolution N / N-1 : l'écart en euros dès qu'il est connu ; le % n'est coloré que s'il est défini (N-1 nul : % n.d., neutre)", () => {
    expect(evoDelta({ kind: "value", deltaCents: 3739000, ratio: { num: 3739000, den: 17387000 } })).toBe(3739000);
    expect(evoPctDelta({ kind: "value", deltaCents: 3739000, ratio: { num: 3739000, den: 17387000 } })).toBe(3739000);
    // N-1 nul : l'écart en euros reste un écart connu, le pourcentage ne l'est pas.
    expect(evoDelta({ kind: "value", deltaCents: 500, ratio: null })).toBe(500);
    expect(evoPctDelta({ kind: "value", deltaCents: 500, ratio: null })).toBeNull();
    expect(evoDelta({ kind: "nd" })).toBeNull();
    expect(evoPctDelta({ kind: "nd" })).toBeNull();
    expect(numTrend(evoPctDelta({ kind: "value", deltaCents: 500, ratio: null }))).toBe("num");
  });
});

describe("glossaire de la Masse salariale (lot 10)", () => {
  const ids = GLOSSARY_MASSE.map((e) => e.id);
  const entry = (id: string) => GLOSSARY_MASSE.find((e) => e.id === id)!;
  it("identifiants uniques en kebab-case, famille « Masse salariale », terme et définition renseignés", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of GLOSSARY_MASSE) {
      expect(e.family, e.id).toBe("Masse salariale");
      expect(e.term.trim(), e.id).not.toBe("");
      expect(e.definition.trim(), e.id).not.toBe("");
      expect(e.id, e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
  it("aucun de ces identifiants n'est défini dans une autre famille", () => {
    for (const id of ids) expect(GLOSSARY.filter((e) => e.id === id), id).toHaveLength(1);
  });
  it("chaque « ? » des écrans de la Masse salariale mène à une entrée existante", () => {
    for (const [nom, id] of Object.entries(MASSE_TERMS)) expect(ids, `${nom} → ${id}`).toContain(id);
  });
  it("les anciennes ancres #def-… de l'écran sont conservées comme identifiants (sauf « nd », devenu « ms-nd »)", () => {
    for (const d of PAYROLL_DEFINITIONS) expect(ids, d.id).toContain(d.id);
    for (const id of ["brut-dsn", "masse-dsn", "mois-dsn", "ms-nd"]) expect(ids).toContain(id);
  });
  it("formules d'une ligne, écrites à la main", () => {
    expect(entry("masse").formula).toBe("masse chargée = brut + cotisations patronales");
    expect(entry("evolution").formula).toBe("écart = N − N-1 ; écart (%) = (N − N-1) ÷ N-1");
    expect(entry("cout-etp").formula).toBe("masse chargée de la période ÷ somme des ETP de fin de mois");
    expect(entry("rapprochement").formula).toBe("écart = journal de paie − comptabilité");
    for (const e of GLOSSARY_MASSE) if (e.formula) expect(e.formula, e.id).not.toContain("\n");
  });
  it("chaque explication retirée des écrans est au glossaire (déplacée, non supprimée)", () => {
    const text = (id: string) => `${entry(id).term} ${entry(id).formula ?? ""} ${entry(id).definition}`;
    const moved: [string, string][] = [
      ["ms-graphiques", "Brut + cotisations patronales = masse chargée du mois"], // note sous le graphique brut / cotisations
      ["ms-graphiques", "le tableau correspondant, exact à l'euro près, fait foi"], // pied des zones de graphiques
      ["ms-graphiques", "Congés payés + charges sociales = provision du mois"],
      ["ms-graphiques", "colonne hachurée"],
      ["ms-graphiques", "une teinte est reprise d'une autre notion de l'écran"], // anciennes notes de reprise de teinte sous les graphiques
      ["ms-graphiques", "une même teinte sert à deux services"],
      ["service", "filtre l'écran sur ce service"], // ancien sous-titre « cliquer un service pour filtrer l'écran »
      ["ms-nd", "jamais remplacée par zéro"], // ancienne définition « n.d. »
      ["fixe-variable", "« Salaires et appointements »"], // lead de la tuile Fixe
      ["fixe-variable", "« Primes » et « Indemnités et avantages »"], // lead de la tuile Variable
      ["gratifications-stage", "comptée dans le brut"], // lead de la tuile Gratifications de stage
      ["primes", "Une famille de prime est un libellé de ligne de prime du journal PayFit"],
      ["primes", "ne sont pas distingués par le journal PayFit"],
      ["service", "ce n'est pas un coût par ETP"], // note sous le tableau Services (texte d'origine)
      ["service", "Total affiché"],
      ["service", "le filtre Service ne s'applique pas aux graphiques par service"],
      ["montants-journal", "Aucun montant n'est recalculé ni reconstitué"], // ancien bandeau « montants tels que renvoyés »
      ["montants-journal", "les contreparties (comptes de tiers, produits) sont ignorées"], // ancien sous-titre du détail par compte
      ["hors-masse", "provisions de congés payés"], // ancienne ligne « hors masse chargée »
      ["controle-dsn", "S21.G00.51 de type 001"], // ancienne note du contrôle DSN
      ["rapprochement", "libellés complets des rubriques"],
      ["evolution", "(N − N-1) ÷ N-1"], // formule affichée dans la tuile « Évolution vs N-1 »
      ["evolution", "N-1 nul"],
      ["ratio-produits", "comptes 70 à 75"],
      ["ms-tendances", "une hausse est une tendance défavorable (rouge)"],
    ];
    for (const [id, fragment] of moved) expect(text(id).toLowerCase(), `${id} : ${fragment}`).toContain(fragment.toLowerCase());
  });
  it("français de produit : ni vocabulaire interne, ni tutoiement", () => {
    for (const e of GLOSSARY_MASSE) expect(`${e.term} ${e.definition}`, e.id).not.toMatch(/outil observé|webinaire|\bcahier\b|compte pilote|\btu\b|\btoi\b|\bton\b|\bta\b/i);
  });
});

describe("univers bleu / blanc / noir de la Masse salariale (lot 10)", () => {
  // Fichiers de la zone : aucune couleur codée en dur hors blanc, noir, gris et bleu ; le rouge et le vert viennent de --bad / --good
  // (classes trend-bad / trend-good), réservés aux tendances d'un coût.
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const dir = "src/app/e/[slug]/studio-rh/masse-salariale";
  const zone = [`${dir}/page.tsx`, `${dir}/Lot2Views.tsx`, `${dir}/components.tsx`, `${dir}/DsnView.tsx`, "src/styles/masse-salariale.css", "src/lib/viz/masse.ts", "src/lib/glossary/masse.ts"];
  const read = (f: string) => readFileSync(`${root}${f}`, "utf8");
  const hsl = (hex: string): { h: number; s: number } => {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0 };
    const d = max - min;
    const sat = d / (1 - Math.abs(2 * l - 1));
    const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (hue * 60 + 360) % 360, s: sat };
  };
  it("le calcul de teinte reconnaît le bleu, le gris, le rouge, le vert et l'ambre (cas écrits à la main)", () => {
    expect(hsl("155cff").h).toBeCloseTo(222, 0);
    expect(hsl("6c7280").s).toBeLessThan(0.1);
    expect(hsl("c4302b").h).toBeLessThan(10);
    expect(hsl("138a55").h).toBeCloseTo(153, 0);
    expect(hsl("d9a34a").h).toBeCloseTo(37, 0);
  });
  it("chaque couleur hexadécimale des fichiers de la zone est blanche, grise ou bleue ; aucune couleur rgb() / hsl()", () => {
    let seen = 0;
    for (const f of zone) {
      const src = read(f);
      for (const m of src.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
        seen += 1;
        const { h: hue, s: sat } = hsl(m[1]);
        expect(sat < 0.35 || (hue >= 200 && hue <= 250), `${f} : #${m[1]}`).toBe(true);
      }
      expect(src, f).not.toMatch(/\brgba?\(|\bhsla?\(/);
    }
    expect(seen).toBeGreaterThan(0);
  });
  it("le rouge et le vert ne sont posés que par les classes de tendance et leurs variables (--bad, --good)", () => {
    const css = read("src/styles/masse-salariale.css");
    // Toute règle qui nomme --bad ou --good concerne une classe trend-bad / trend-good.
    for (const rule of css.split("}").filter((r) => /--(bad|good)\b/.test(r))) expect(rule, rule).toMatch(/trend-(bad|good)/);
    // Aucune autre couleur « nommée » rouge, verte, orange, jaune, violette ou turquoise.
    for (const f of zone.filter((x) => !x.includes("glossary"))) expect(read(f), f).not.toMatch(/\b(red|green|orange|yellow|purple|teal|amber)\b\s*[;,)]|--danger|--ok\b/i);
  });
  it("les anciens blocs de narratif ne sont plus dans les écrans : définitions du bas, formules des tuiles, notes de lecture, ancres #def-", () => {
    for (const f of zone.slice(0, 4)) {
      const src = read(f);
      expect(src, f).not.toMatch(/ms-definitions|PAYROLL_DEFINITIONS|Définitions et règles de calcul|href=\{?"?#def-|id="def-|id=\{`def-/);
      expect(src, f).not.toMatch(/Un graphique est une lecture|Sens de « n\.d\. »|hueReuseNote|ndNote|\(N − N-1\) ÷ N-1 =|Montants tels que (renvoyés|déclarés)|Coût = masse chargée \(brut/);
    }
  });
});

describe("écrans de la Masse salariale : composants sans narratif (lot 10)", () => {
  const render = (el: React.ReactElement) => {
    const html = renderToStaticMarkup(el);
    for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
    return html;
  };
  it("tuile : libellé suivi du « ? » vers le glossaire, valeur en tendance, N-1 ; ni formule ni lien « Définition » en pied", () => {
    const html = render(h(Tile, { testid: "ms-tile-evolution", label: "Évolution vs N-1", value: "+21,50 %", trend: "trend-bad", lead: "+37 390,00 €", compare: "N-1 : 173 870,00 €", def: "evolution", slug: "demo" }));
    expect(html).toContain('data-testid="ms-tile-evolution"');
    expect(html).toContain('href="/e/demo/glossaire#def-evolution"');
    expect(html).toContain('<dd class="trend-bad">+21,50 %</dd>');
    const visible = html.replace(/<[^>]*>/g, "").replace(/\s/g, " ");
    expect(visible).toContain("+37 390 €");
    expect(visible).toContain("N-1 : 173 870 €");
    expect(html).toContain('data-money-cents="3739000"');
    expect(html).toContain('data-money-cents="17387000"');
    expect(html).not.toMatch(/ms-tile-def|href="#def-|÷/);
  });
  it("tuile n.d. : la valeur n.d. n'est jamais colorée en tendance, même si une tendance est transmise", () => {
    const html = render(h(Tile, { testid: "t", label: "Évolution vs N-1", value: "n.d. — N-1 nul : % non défini", nd: true, ndLong: true, trend: "trend-good", def: "evolution", slug: "demo" }));
    expect(html).toContain('<dd class="nd long">n.d. — N-1 nul : % non défini</dd>');
    expect(html).not.toContain("trend-good");
  });
  it("tuile sans slug : pas de lien (jamais de lien mort)", () => {
    expect(render(h(Tile, { testid: "t", label: "Brut", value: "1 000,00 €", def: "brut" }))).not.toContain("glossaire");
  });
  it("une seule légende de tendance : rouge = coût en hausse, vert = coût en baisse, avec son « ? »", () => {
    const html = render(h(TrendLegend, { slug: "demo" }));
    expect(html.match(/class="trend-legend"/g)).toHaveLength(1);
    expect(html).toContain('class="dot bad"');
    expect(html).toContain('class="dot good"');
    expect(html).toContain("Coût en hausse");
    expect(html).toContain("Coût en baisse");
    expect(html).toContain('href="/e/demo/glossaire#def-ms-tendances"');
  });
  it("pied des graphiques : seulement l'accès au tableau exact, et seulement quand l'affichage ne montre que les graphiques", () => {
    expect(renderToStaticMarkup(h(GraphFoot, { aff: "tout", tableHref: "?affichage=tableau" }))).toBe("");
    expect(renderToStaticMarkup(h(GraphFoot, { aff: "tableau", tableHref: "?affichage=tableau" }))).toBe("");
    const html = render(h(GraphFoot, { aff: "graphique", tableHref: "?affichage=tableau" }));
    expect(html).toContain('href="?affichage=tableau"');
    expect(html).not.toMatch(/lecture|définitions/);
  });
  it("clé de lecture des n.d. : une ligne, hachures et libellé, aucune phrase d'explication", () => {
    const html = render(h(NdKey, {}));
    expect(html).toContain('class="swatch hatch"');
    // Même libellé que la clé des Hypothèses budgétaires : une valeur absente d'une seule série est une barre absente, sans hachure.
    expect(html).toContain("n.d. : colonne hachurée, barre absente ou courbe interrompue (raison au survol)");
  });
  it("en-tête : titre seul ; titre de panneau avec « ? » ; une ligne de contexte seulement si fournie", () => {
    expect(render(h(MsHead, { title: "Masse salariale" }))).not.toContain('class="desc"');
    const panel = render(h(PanelHead, { title: "Services", slug: "demo", term: "service" }));
    expect(panel).toContain("<h2>Services</h2>");
    expect(panel).toContain('href="/e/demo/glossaire#def-service"');
    expect(panel).not.toContain('class="desc"');
    expect(render(h(PanelHead, { title: "Services", desc: "Code analytique « Service » du journal PayFit (seul axe présent)" }))).toContain("seul axe présent");
    // Sans identifiant d'entrée, aucun lien.
    expect(render(h(PanelHead, { title: "Graphiques", slug: "demo" }))).not.toContain("glossaire");
  });
  it("graphique sans aucune valeur connue : non tracé, avec la raison courte et les raisons des mois ; jamais zéro", () => {
    const allNd = masseSeries([ND("2026-01", "journal absent")], [ND("2025-01", "mois hors lecture")], { cur: "N", prev: "N-1" });
    const html = render(h(ChartGuard, { testid: "ms-trend", title: "Masse chargée par mois", series: allNd, children: h("p", {}, "SOUS-ENFANT") }));
    expect(html).toContain("Aucune valeur connue sur la période : graphique non tracé.");
    expect(html).toContain("journal absent");
    expect(html).toContain("mois hors lecture");
    expect(html).not.toMatch(/SOUS-ENFANT|axe à zéro/);
    // Une valeur connue : le graphique est tracé (l'enfant est rendu tel quel).
    expect(render(h(ChartGuard, { testid: "ms-trend", title: "t", series: masseSeries(cur, prev, { cur: "N", prev: "N-1" }), children: h("p", {}, "SOUS-ENFANT") }))).toContain("SOUS-ENFANT");
  });
});
