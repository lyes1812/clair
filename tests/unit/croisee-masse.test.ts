import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FixeVariableChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChFixeVariable";
import { ServicesChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChServices";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { Affichage } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import { syntheseOf } from "@/app/e/[slug]/studio-rh/masse-salariale/synthese-data";
import { readCroiseeSettings, type CroiseeSettings } from "@/lib/croisee-settings";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES, type RubricId } from "@/lib/payroll/grid";
import { serviceRows as sharedServiceRows } from "@/lib/payroll/service-rows";
import { cellView, croiseeHref, sortRows, type CroiseeCell, type CroiseeTable } from "@/lib/viz/croisee";
import {
  BRUT_NUL,
  buildFixeVariable,
  buildServices,
  FIXE_VARIABLE_IDS as FV,
  fixeVariableModel,
  loadFixeVariableInput,
  loadServicesInput,
  monthReason,
  N1_NEGATIF,
  N1_NUL,
  periodHeads,
  PREVU_FIXE_VARIABLE,
  SANS_CONTRAT,
  SANS_LIGNE,
  serviceConfidentiality,
  serviceLabel,
  serviceRows,
  servicesModel,
  servicesSort,
  TOTAL_NUL,
  windowReason,
  type FixeVariableData,
  type FixeVariableModel,
  type LabelIn,
  type ServicesData,
  type ServicesModel,
  type WindowIn,
} from "@/lib/viz/croisee-masse";
import type { MonthIn } from "@/lib/viz/masse";

// La chaîne d'import (contexte de la page → paramètres de l'espace → client de base) exige une DATABASE_URL à l'import ; aucun test de
// ce fichier n'ouvre de connexion. Sans variable fournie, une adresse factice suffit.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://factice:factice@localhost:5432/factice";
});

// Masse salariale croisée, chapitres 04 · Fixe & variable et 05 · Services. Données fictives écrites à la main ; chaque résultat
// attendu est calculé à la main (commentaires). Un n.d. reste n.d. jusqu'au tableau et au graphique, jamais un zéro.

const sp = (s: string) => s.replace(/\s/g, " ");
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const col = (t: CroiseeTable, key: string) => {
  const i = t.columns.findIndex((c) => c.key === key);
  if (i < 0) throw new Error(`colonne ${key} absente de ${t.id}`);
  return i;
};
const raw = (t: CroiseeTable, row: number | "foot", key: string): CroiseeCell | undefined => (row === "foot" ? t.foot! : t.rows[row]).cells[col(t, key)];
const shown = (t: CroiseeTable, row: number | "foot", key: string) => {
  const r = row === "foot" ? t.foot! : t.rows[row];
  const i = col(t, key);
  return sp(cellView(r.cells[i], t.columns[i], r).text);
};
const table = (m: { tables: CroiseeTable[] }, id: string) => {
  const t = m.tables.find((x) => x.id === id);
  if (!t) throw new Error(`tableau ${id} absent`);
  return t;
};
const chart = (m: FixeVariableModel | ServicesModel, id: string) => {
  const c = m.charts.find((x) => x.id === id);
  if (!c) throw new Error(`graphique ${id} absent`);
  return c;
};
const tile = (m: FixeVariableModel, id: string) => m.tiles.find((t) => t.id === id)!;

// --- Jeu fictif : deux mois (janvier et février), N = 2026, N-1 = 2025 ------------------------------------------------------------
// N : janvier salaires 4 000 €, primes 600 € (brut 4 600 €, cotisations 1 840 €, masse 6 440 €) ;
//     février salaires 4 000 €, primes 400 €, indemnités 500 € (brut 4 900 €, cotisations 1 960 €, masse 6 860 €).
//     Période : salaires 8 000 €, primes 1 000 €, stages 0 €, indemnités 500 € ; brut 9 500 € ; cotisations 3 800 € ; masse 13 300 €.
// N-1 : janvier salaires 3 750 €, primes 500 €, stages 100 € (brut 4 350 €, cotisations 1 740 €, masse 6 090 €) ;
//       février salaires 3 750 €, stages 100 € (brut 3 850 €, cotisations 1 540 €, masse 5 390 €).
//       Période : salaires 7 500 €, primes 500 €, stages 200 €, indemnités 0 € ; brut 8 200 € ; cotisations 3 280 € ; masse 11 480 €.
const R = (salaires: number, primes: number, stages: number, indemnites: number) => ({ salaires, primes, stages, indemnites });
const N_JAN: MonthIn = { month: "2026-01", kind: "value", open: false, brut: 460000, cotisations: 184000, masse: 644000, byRubric: R(400000, 60000, 0, 0) };
const N_FEB: MonthIn = { month: "2026-02", kind: "value", open: false, brut: 490000, cotisations: 196000, masse: 686000, byRubric: R(400000, 40000, 0, 50000) };
const P_JAN: MonthIn = { month: "2025-01", kind: "value", open: false, brut: 435000, cotisations: 174000, masse: 609000, byRubric: R(375000, 50000, 10000, 0) };
const P_FEB: MonthIn = { month: "2025-02", kind: "value", open: false, brut: 385000, cotisations: 154000, masse: 539000, byRubric: R(375000, 0, 10000, 0) };
const CUR: WindowIn = { kind: "value", brut: 950000, cotisations: 380000, masse: 1330000, byRubric: R(800000, 100000, 0, 50000), months: [N_JAN, N_FEB], paidContractMonths: 4 };
const PREV: WindowIn = { kind: "value", brut: 820000, cotisations: 328000, masse: 1148000, byRubric: R(750000, 50000, 20000, 0), months: [P_JAN, P_FEB], paidContractMonths: 4 };
const L = (rubric: RubricId, label: string, cents: number): LabelIn => ({ rubric, key: `${rubric}|${label.toLowerCase()}`, label, cents });
const LABELS_N = [L("salaires", "Salaire de base", 800000), L("primes", "Prime sur objectifs", 70000), L("primes", "Prime exceptionnelle", 30000), L("indemnites", "Indemnité transport", 50000)];
const LABELS_N1 = [L("salaires", "Salaire de base", 750000), L("primes", "Prime sur objectifs", 50000), L("stages", "Gratification de stage", 20000)];
const BY_MONTH: Record<string, LabelIn[]> = {
  "2026-01": [L("salaires", "Salaire de base", 400000), L("primes", "Prime sur objectifs", 60000)],
  "2026-02": [L("salaires", "Salaire de base", 400000), L("primes", "Prime sur objectifs", 10000), L("primes", "Prime exceptionnelle", 30000), L("indemnites", "Indemnité transport", 50000)],
};
const DATA: FixeVariableData = {
  year: 2026,
  prevYear: 2025,
  months: ["2026-01", "2026-02"],
  prevMonths: ["2025-01", "2025-02"],
  labels: { period: "janvier → février 2026", prev: "janvier → février 2025" },
  cur: CUR,
  prev: PREV,
  labelsN: LABELS_N,
  labelsN1: LABELS_N1,
  labelsByMonth: BY_MONTH,
};
const fv = (over: Partial<FixeVariableData> = {}) => buildFixeVariable({ nd: null, data: { ...DATA, ...over } });

// Février 2026 hors de la lecture : la période est n.d. (raison du moteur), janvier reste connu.
const N_FEB_ND: MonthIn = { month: "2026-02", kind: "nd", open: false, nd: { reason: "mois 2026-02 hors de la lecture PayFit appliquée" } };
const CUR_ND: WindowIn = { kind: "nd", nd: { reason: "2026-02 : mois 2026-02 hors de la lecture PayFit appliquée" }, months: [N_JAN, N_FEB_ND] };
const FEB_WHY = "févr. 2026 : mois hors de la lecture PayFit appliquée";

describe("raisons des n.d. du journal", () => {
  it("le mois est écrit en clair et regroupé par raison identique", () => {
    expect(monthReason(N_FEB_ND as Extract<MonthIn, { kind: "nd" }>)).toBe(FEB_WHY);
    expect(windowReason(CUR_ND as Extract<WindowIn, { kind: "nd" }>)).toBe(FEB_WHY);
    const two = { nd: { reason: "x" }, months: [{ ...N_FEB_ND, month: "2026-03", nd: { reason: "mois 2026-03 hors de la lecture PayFit appliquée" } } as MonthIn, N_FEB_ND] };
    expect(windowReason(two)).toBe("mars 2026, févr. 2026 : mois hors de la lecture PayFit appliquée");
  });
});

describe("buildFixeVariable : cartes", () => {
  const m = fv();
  const vars = (id: string) => tile(m, id).variations!.map((v) => [v.label, v.text === null ? null : sp(v.text), v.tone]);
  it("six cartes, dans l'ordre, période écrite sur chacune ; montants, écart et écart en % calculés à la main", () => {
    expect(m.nd).toBeNull();
    expect(m.tiles.map((t) => t.id)).toEqual(["fixe", "variable", "primes", "stages", "part-primes", "part-salaires"]);
    // Ligne de période : le libellé du contexte, jamais l'année seule.
    expect(m.tiles.map((t) => t.sub)).toEqual(Array(6).fill("janvier → février 2026"));
    // Fixe : 8 000 € face à 7 500 € ; écart +500 € ; 500 ÷ 7 500 = 6,666… % → +6,67 %.
    const f = tile(m, "fixe");
    expect(sp(f.value.text)).toBe("8 000,00 €");
    expect(vars("fixe")).toEqual([
      ["N-1", "7 500,00 €", "flat"],
      ["Écart", "+500,00 €", "bad"],
      ["Écart (%)", "+6,67 %", "bad"],
    ]);
    expect(f.cost).toBe(true);
    // Variable : primes + indemnités = 1 000 + 500 = 1 500 € face à 500 € ; +1 000 € ; +200,00 %.
    expect(sp(tile(m, "variable").value.text)).toBe("1 500,00 €");
    expect(vars("variable").slice(1)).toEqual([
      ["Écart", "+1 000,00 €", "bad"],
      ["Écart (%)", "+200,00 %", "bad"],
    ]);
    // dont primes : 1 000 € face à 500 € ; deux familles (deux libellés de prime sur la période).
    expect(vars("primes").slice(1)).toEqual([
      ["Écart", "+500,00 €", "bad"],
      ["Écart (%)", "+100,00 %", "bad"],
    ]);
    expect(tile(m, "primes").note).toBe("2 familles de prime");
    // Gratifications : 0 € face à 200 € ; −200 € ; −100,00 % ; baisse de coût (vert) ; aucune ligne de stage en N.
    const s = tile(m, "stages");
    expect(sp(s.value.text)).toBe("0,00 €");
    expect(vars("stages").slice(1)).toEqual([
      ["Écart", "−200,00 €", "good"],
      ["Écart (%)", "−100,00 %", "good"],
    ]);
    expect(s.note).toBe("aucune ligne dans le journal sur la période");
  });
  it("N-1 nul : l'écart en euros garde son ton, l'écart en % est n.d. avec sa raison et sans couleur", () => {
    // Indemnités seules en variable : N 500 €, N-1 0 € (écart +500 €, % non défini).
    const w = fv({ prev: { ...PREV, byRubric: R(750000, 0, 20000, 0) } as WindowIn });
    // Variable N-1 = primes 0 + indemnités 0 = 0 € ; N = 1 500 € ; écart +1 500 €.
    expect(w.tiles.find((t) => t.id === "variable")!.variations!.map((v) => [v.label, v.text === null ? null : sp(v.text), v.reason ?? null, v.tone])).toEqual([
      ["N-1", "0,00 €", null, "flat"],
      ["Écart", "+1 500,00 €", null, "bad"],
      ["Écart (%)", null, N1_NUL, "flat"],
    ]);
    // Raisons listées une fois sous les cartes, regroupées par raison identique (dont primes : 1 000 € face à 0 €, % non défini).
    expect(w.tileNd).toEqual([`Variable (primes et indemnités) — écart (%), dont primes — écart (%) : ${N1_NUL}`]);
  });
  it("parts du brut : sous le nom « Part des salaires dans le brut », écart en points, sans ton de coût", () => {
    // Primes : 1 000 ÷ 9 500 = 10,526… % → 10,53 % ; N-1 500 ÷ 8 200 = 6,097… % → 6,10 % ; écart 4,428… pts → +4,43 pts.
    const pp = tile(m, "part-primes");
    expect(pp.label).toBe("Part des primes dans le brut");
    expect(sp(pp.value.text)).toBe("10,53 %");
    expect(sp(pp.variations![0].text!)).toBe("6,10 %");
    expect(sp(pp.variations![1].text!)).toBe("+4,43 pts");
    // Salaires : 8 000 ÷ 9 500 = 84,210… % → 84,21 % ; N-1 7 500 ÷ 8 200 = 91,463… % → 91,46 % ; écart −7,252… pts → −7,25 pts.
    const ps = tile(m, "part-salaires");
    expect(ps.label).toBe("Part des salaires dans le brut");
    expect(ps.term).toBe("croisee-rigidite");
    expect(sp(ps.value.text)).toBe("84,21 %");
    expect(sp(ps.variations![0].text!)).toBe("91,46 %");
    expect(sp(ps.variations![1].text!)).toBe("−7,25 pts");
    expect(ps.sub).toBe("janvier → février 2026");
    expect(ps.cost).toBeUndefined();
    expect(ps.variations!.every((v) => v.tone === "flat")).toBe(true);
    expect(m.tiles.some((t) => /rigidit/i.test(t.label))).toBe(false);
  });
  it("aucune raison de n.d. sur ce jeu complet ; légende des tendances affichée", () => {
    expect(m.tileNd).toEqual([]);
    expect(m.trend).toBe(true);
  });
});

describe("buildFixeVariable : tableaux exacts", () => {
  const m = fv();
  it("en-têtes de période : libellés du contexte, jamais l'année seule", () => {
    expect(periodHeads({ period: "janvier → février 2026", prev: "janvier → février 2025" })).toEqual({ n: "Janvier → février 2026", n1: "N-1 (janvier → février 2025)" });
    for (const id of [FV.composantes, FV.parts, FV.primesMois, FV.libelles]) {
      const heads = table(m, id).columns.filter((c) => c.key === "n" || c.key === "n1").map((c) => c.header);
      expect(heads, id).toEqual(["Janvier → février 2026", "N-1 (janvier → février 2025)"]);
    }
    for (const t of m.tables) for (const c of t.columns) expect(c.header, `${t.id}.${c.key}`).not.toMatch(/^\d{4}( \(N-1\))?$/);
  });
  it("composantes : N, N-1, écart et écart (%) ; la somme des natures est le brut, brut + cotisations = masse", () => {
    const t = table(m, FV.composantes);
    expect(t.rows.map((r) => r.cells[0])).toEqual(["Fixe (salaires et congés payés)", "Variable (primes et indemnités)", "dont primes", "dont indemnités et avantages", "Gratifications de stage", "Brut", "dont brut hors primes", "Cotisations patronales"]);
    expect(t.rows.map((r) => r.style ?? null)).toEqual([null, null, "child", "child", null, "subtotal", "child", null]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => raw(t, i, "n"))).toEqual([800000, 150000, 100000, 50000, 0, 950000, 850000, 380000]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => raw(t, i, "n1"))).toEqual([750000, 50000, 50000, 0, 20000, 820000, 770000, 328000]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => raw(t, i, "ecart"))).toEqual([50000, 100000, 50000, 50000, -20000, 130000, 80000, 52000]);
    // 1 300 ÷ 8 200 = 15,853… % ; 800 ÷ 7 700 = 10,389… % ; 520 ÷ 3 280 = 15,853… %.
    expect([0, 1, 2, 4, 5, 6, 7].map((i) => shown(t, i, "ecart-pct"))).toEqual(["+6,67 %", "+200,00 %", "+100,00 %", "−100,00 %", "+15,85 %", "+10,39 %", "+15,85 %"]);
    // Indemnités : N-1 nul → % n.d. avec sa raison (jamais 0 % ni l'infini).
    expect(raw(t, 3, "ecart-pct")).toEqual({ nd: N1_NUL });
    expect(raw(t, "foot", "n")).toBe(1330000);
    expect(raw(t, "foot", "n1")).toBe(1148000);
    expect(raw(t, "foot", "ecart")).toBe(182000);
    expect(shown(t, "foot", "ecart-pct")).toBe("+15,85 %");
    expect(shown(t, 0, "ecart")).toBe("+500,00 €");
    expect(cellView(raw(t, 4, "ecart"), t.columns[col(t, "ecart")]).tone).toBe("good");
  });
  it("parts du brut : mêmes valeurs que les cartes", () => {
    const t = table(m, FV.parts);
    expect(t.rows.map((r) => r.cells[0])).toEqual(["Part des salaires dans le brut", "Part des primes dans le brut"]);
    expect([shown(t, 0, "n"), shown(t, 0, "n1"), shown(t, 0, "ecart")]).toEqual(["84,21 %", "91,46 %", "−7,25 pts"]);
    expect([shown(t, 1, "n"), shown(t, 1, "n1"), shown(t, 1, "ecart")]).toEqual(["10,53 %", "6,10 %", "+4,43 pts"]);
  });
  it("brut par nature et par mois : variable = primes + indemnités du mois", () => {
    const t = table(m, FV.mois);
    expect(t.rows.map((r) => r.cells[0])).toEqual(["Janvier 2026", "Février 2026"]);
    expect(t.rows[0].cells.slice(1)).toEqual([460000, 400000, 60000, 60000, 0]);
    expect(t.rows[1].cells.slice(1)).toEqual([490000, 400000, 90000, 40000, 0]);
    expect(t.foot!.cells).toEqual(["Période", 950000, 800000, 150000, 100000, 0]);
  });
  it("primes par mois, N face aux mêmes mois de N-1", () => {
    const t = table(m, FV.primesMois);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Janvier", 60000, 50000, 10000],
      ["Février", 40000, 0, 40000],
    ]);
    expect(t.foot!.cells).toEqual(["Période", 100000, 50000, 50000]);
  });
  it("primes par famille (libellés de la rubrique Primes) et par mois ; la somme des familles est le total des primes du mois", () => {
    const t = table(m, FV.primesFamilles);
    expect(t.columns.map((c) => c.header)).toEqual(["Mois", "Total primes", "Prime exceptionnelle", "Prime sur objectifs"]);
    expect(t.rows.map((r) => r.cells.slice(1))).toEqual([
      [60000, 0, 60000],
      [40000, 30000, 10000],
    ]);
    expect(t.foot!.cells).toEqual(["Période", 100000, 30000, 70000]);
  });
  it("brut par libellé de paie : union N et N-1, ordre des rubriques puis libellé, N-1 nul → % n.d.", () => {
    const t = table(m, FV.libelles);
    expect(t.rows.map((r) => [r.cells[0], r.cells[1], r.cells[2], r.cells[3], r.cells[5]])).toEqual([
      ["Salaire de base", 800000, 750000, 50000, "Salaires et appointements"],
      ["Prime exceptionnelle", 30000, 0, 30000, "Primes"],
      ["Prime sur objectifs", 70000, 50000, 20000, "Primes"],
      ["Gratification de stage", 0, 20000, -20000, "Gratifications de stage"],
      ["Indemnité transport", 50000, 0, 50000, "Indemnités et avantages"],
    ]);
    // 200 ÷ 500 = 40 %.
    expect(shown(t, 2, "ecart-pct")).toBe("+40,00 %");
    expect(raw(t, 1, "ecart-pct")).toEqual({ nd: N1_NUL });
    expect(t.foot!.cells.slice(0, 4)).toEqual(["Brut", 950000, 820000, 130000]);
  });
});

describe("buildFixeVariable : graphiques (séries = valeurs des tableaux)", () => {
  const m = fv();
  it("répartition du brut, structure N-1 / N, brut par mois, primes N / N-1, primes par famille", () => {
    const ring = chart(m, FV.repartition);
    expect(ring.kind).toBe("anneau");
    expect(ring.series.map((s) => [s.key, s.values[0]])).toEqual([
      ["fixe", 800000],
      ["variable", 150000],
      ["stages", 0],
    ]);
    expect(sp(ring.note!)).toBe("Hors anneau (montant nul ou négatif) : Gratifications de stage (0,00 €). Parts calculées sur les natures tracées.");
    const st = chart(m, FV.structure);
    expect(st.categories).toEqual(["N-1", "N"]);
    expect(st.categoryTitles).toEqual(["N-1 (janvier → février 2025)", "Janvier → février 2026"]);
    expect(st.series.map((s) => s.values)).toEqual([
      [750000, 800000],
      [50000, 150000],
      [20000, 0],
    ]);
    expect(chart(m, FV.mois).series.map((s) => s.values)).toEqual([
      [400000, 400000],
      [60000, 90000],
      [0, 0],
    ]);
    const pm = chart(m, FV.primesMois);
    expect(pm.series.map((s) => s.values)).toEqual([
      [60000, 40000],
      [50000, 0],
    ]);
    expect(pm.series.map((s) => s.color)).toEqual(["var(--chart-1)", "var(--chart-7)"]);
    expect(pm.series.map((s) => s.name)).toEqual(["Primes, janvier → février 2026", "Primes, N-1 (janvier → février 2025)"]);
    expect(chart(m, FV.primesFamilles).series.map((s) => [s.name, s.values])).toEqual([
      ["Prime exceptionnelle", [0, 30000]],
      ["Prime sur objectifs", [60000, 10000]],
    ]);
    // Chaque graphique renvoie à un tableau exact du modèle.
    for (const c of m.charts) expect(m.tables.some((t) => t.id === c.tableId)).toBe(true);
    for (const c of m.charts) for (const s of c.series) expect(s.color ?? "").toMatch(/^var\(--chart-\d\)$/);
  });
  it("blocs, « Prévu » et limites", () => {
    expect(m.blocks.map((b) => b.id)).toEqual(["composition", "mois", "primes", "libelles"]);
    expect(m.prevu.map((p) => p.id)).toEqual(["fixe-variable-indemnites", "fixe-variable-calendrier", "fixe-variable-heures-sup", "fixe-variable-fixe-contractuel", "fixe-variable-rigidite"]);
    expect(m.prevu).toBe(PREVU_FIXE_VARIABLE);
    // Rigidité : « Prévu » avec sa raison, renvoi au glossaire ; la carte reste « Part des salaires dans le brut ».
    expect(m.prevu.at(-1)).toEqual({
      id: "fixe-variable-rigidite",
      label: "Rigidité de la rémunération (fixe contractuel et avantages obligatoires)",
      reason: "classification fixe / avantages obligatoires absente des sources ; seule la part des salaires dans le brut est calculée",
      term: "croisee-rigidite",
    });
    expect(m.limits.join(" ")).toMatch(/non distinguées par le journal PayFit/);
  });
});

describe("buildFixeVariable : un n.d. reste n.d. jusqu'au tableau et au graphique", () => {
  const m = fv({ cur: CUR_ND, labelsN: null, labelsByMonth: { "2026-01": BY_MONTH["2026-01"] } });
  it("cartes n.d. avec la raison du mois ; N-1 reste connu", () => {
    const f = tile(m, "fixe");
    expect(f.value).toEqual({ text: "n.d.", kind: "nd", reason: FEB_WHY });
    expect(sp(f.variations![0].text!)).toBe("7 500,00 €");
    expect(f.variations![1]).toMatchObject({ text: null, reason: FEB_WHY });
    expect(f.variations![2]).toMatchObject({ text: null, reason: FEB_WHY, tone: "flat" });
    expect(tile(m, "part-salaires").value.kind).toBe("nd");
    expect(m.tileNd).toEqual([`Période (janvier → février 2026) : ${FEB_WHY}`]);
  });
  it("tableaux : cellules N n.d. (jamais 0), N-1 lu, mois connu conservé", () => {
    const t = table(m, FV.composantes);
    for (let i = 0; i < t.rows.length; i++) {
      expect(raw(t, i, "n")).toEqual({ nd: FEB_WHY });
      expect(raw(t, i, "ecart")).toEqual({ nd: FEB_WHY });
    }
    expect(raw(t, 0, "n1")).toBe(750000);
    const mois = table(m, FV.mois);
    expect(mois.rows[0].cells.slice(1)).toEqual([460000, 400000, 60000, 60000, 0]);
    expect(mois.rows[1].cells.slice(1)).toEqual(Array(5).fill({ nd: FEB_WHY }));
    expect(mois.foot!.cells.slice(1)).toEqual(Array(5).fill({ nd: FEB_WHY }));
    expect(table(m, FV.primesMois).rows[1].cells).toEqual(["Février", { nd: FEB_WHY }, 0, { nd: FEB_WHY }]);
    // Familles des mois connus ; total de période n.d.
    const fam = table(m, FV.primesFamilles);
    expect(fam.columns.map((c) => c.header)).toEqual(["Mois", "Total primes", "Prime sur objectifs"]);
    expect(fam.rows[1].cells.slice(1)).toEqual([{ nd: FEB_WHY }, { nd: FEB_WHY }]);
    expect(fam.foot!.cells.slice(1)).toEqual([{ nd: FEB_WHY }, { nd: FEB_WHY }]);
    // Libellés : bloc n.d. (aucune liste partielle), forme exportable d'une ligne.
    expect(table(m, FV.libelles).rows).toEqual([{ cells: ["Brut par libellé de paie", { nd: FEB_WHY }] }]);
    expect(m.blocks.find((b) => b.id === "libelles")).toMatchObject({ tables: [], nd: [{ reason: FEB_WHY }] });
  });
  it("graphiques : null avec la raison, jamais 0", () => {
    expect(chart(m, FV.mois).series[0].values).toEqual([400000, null]);
    expect(chart(m, FV.mois).series[0].reasons).toEqual([null, FEB_WHY]);
    expect(chart(m, FV.primesMois).series[0].values).toEqual([60000, null]);
    expect(chart(m, FV.repartition).series.map((s) => s.values[0])).toEqual([null, null, null]);
    expect(chart(m, FV.repartition).series[0].reasons).toEqual([FEB_WHY]);
    expect(chart(m, FV.structure).series[0].values).toEqual([750000, null]);
    expect(chart(m, FV.primesFamilles).series[0].values).toEqual([60000, null]);
  });
  it("N-1 n.d. : colonne N-1 et écarts n.d. ; la raison est listée une fois sous les cartes", () => {
    const P_ND: WindowIn = { kind: "nd", nd: { reason: "2025-01 : mois 2025-01 hors de la lecture PayFit appliquée ; 2025-02 : mois 2025-02 hors de la lecture PayFit appliquée" }, months: [
      { month: "2025-01", kind: "nd", open: false, nd: { reason: "mois 2025-01 hors de la lecture PayFit appliquée" } },
      { month: "2025-02", kind: "nd", open: false, nd: { reason: "mois 2025-02 hors de la lecture PayFit appliquée" } },
    ] };
    const w = fv({ prev: P_ND, labelsN1: null });
    const why = "janv. 2025, févr. 2025 : mois hors de la lecture PayFit appliquée";
    expect(raw(table(w, FV.libelles), 0, "n1")).toEqual({ nd: why });
    expect(raw(table(w, FV.libelles), 0, "n")).toBe(800000);
    expect(tile(w, "fixe").variations![0]).toMatchObject({ text: null, reason: why });
    expect(w.tileNd).toEqual([`N-1 (janvier → février 2025) : ${why}`]);
  });
  it("chapitre entier n.d. : la raison et l'action, aucun tableau", () => {
    const nd = buildFixeVariable({ nd: { reason: "source RH retenue : DSN — journal de paie PayFit non lu", action: { href: "/e/demo/donnees", label: "Données" } }, data: null });
    expect(nd.nd?.reason).toMatch(/DSN/);
    expect(nd.tables).toEqual([]);
    expect(nd.tiles).toEqual([]);
  });
});

// --- Chapitre 05 · Services ------------------------------------------------------------------------------------------------------

// Journal fictif, axe « Service » : janvier 2026 et janvier 2025.
// 2026-01 : A salaires 1 000 € (contrat c1) + cotisations 400 € ; B salaires 500 € (c2) + cotisations 200 € ; sans code : prime 100 € (c3) ;
//           une contrepartie (compte 421) ignorée. 2025-01 : A salaires 900 € (c1) + cotisations 360 €.
const an = (code: string) => [{ type: "Service", code, value: code }];
const ln = (key: string, month: string, accountId: string, debit: number | null, contractId: string | null, svc?: string, credit: number | null = null): LedgerLine => ({
  key,
  month,
  accountId,
  accountName: null,
  debitCents: debit,
  creditCents: credit,
  contractId,
  analytic: svc ? an(svc) : [],
});
const JOURNAL: JournalInput = {
  lines: [
    ln("l1", "2026-01", "641100", 100000, "c1", "A"),
    ln("l2", "2026-01", "645000", 40000, null, "A"),
    ln("l3", "2026-01", "641100", 50000, "c2", "B"),
    ln("l4", "2026-01", "645000", 20000, null, "B"),
    ln("l5", "2026-01", "641300", 10000, "c3"),
    ln("l6", "2026-01", "421000", null, null, undefined, 220000),
    ln("l7", "2025-01", "641100", 90000, "c1", "A"),
    ln("l8", "2025-01", "645000", 36000, null, "A"),
  ],
  months: ["2025-01", "2026-01"],
  openMonths: [],
  grid: DEFAULT_PREFIXES,
  serviceAxis: "Service",
};
const BASE = "/e/demo/studio-rh/masse-salariale/croisee";
type PayStub = { input: JournalInput | null; unavailable: string | null; source: "payfit" | "dsn" | null; service: { axis: string | null }; axisMissing: boolean };
const PAY: PayStub = { input: JOURNAL, unavailable: null, source: "payfit", service: { axis: "Service" }, axisMissing: false };
// Paramètres de l'espace : aucun enregistré, ou un seuil de confidentialité (valeur brute telle qu'enregistrée).
const NO_SETTINGS = readCroiseeSettings(new Map());
const seuilSettings = (value: unknown): CroiseeSettings => readCroiseeSettings(new Map([["rh.croisee.confidentialite", { value }]]));
function fakeCtx(o: { pay?: PayStub; service?: string | null; chapitre?: string; period?: boolean; reason?: string | null; settings?: CroiseeSettings } = {}): CroiseeContext {
  const state = { chapitre: o.chapitre ?? "services", annee: "2026", de: "01", a: "01", service: o.service === undefined ? null : o.service === null ? "__nv__" : o.service };
  return {
    slug: "demo",
    canEdit: true,
    period: o.period === false ? null : { year: 2026, from: "01", to: "01", years: [2025, 2026], last: "01", months: ["2026-01"], notices: [] },
    periodNd: o.period === false ? "Aucun mois clos à la date de référence" : null,
    prevMonths: ["2025-01"],
    labels: { period: "janvier 2026", prev: "janvier 2025" },
    service: { axis: "Service", value: o.service, label: o.service === undefined ? "Tous les services" : (o.service ?? "Non ventilé"), options: [], reason: o.reason ?? null },
    query: { tri: null, sens: null },
    settings: o.settings ?? NO_SETTINGS,
    affichage: "tout",
    href: (patch: Record<string, string | null> = {}, hash?: string) => croiseeHref(BASE, { ...state, ...patch }, hash),
    load: { payroll: async () => o.pay ?? PAY },
  } as unknown as CroiseeContext;
}

describe("serviceRows : mêmes lignes que le tableau Services de l'écran Masse salariale", () => {
  it("masse N et N-1 par service, classées par coût décroissant, non ventilé en dernier ; somme des services = total", () => {
    const rows = serviceRows(JOURNAL, ["2026-01"], ["2025-01"]);
    expect(rows.map((r) => r.value)).toEqual(["A", "B", null]);
    // A : 1 000 + 400 = 1 400 € ; N-1 900 + 360 = 1 260 € ; écart +140 €. B : 700 € face à 0 € (ratio non défini). Sans code : 100 €.
    expect(rows.map((r) => (r.cur.kind === "value" ? r.cur.masse : null))).toEqual([140000, 70000, 10000]);
    expect(rows.map((r) => (r.prev.kind === "value" ? r.prev.masse : null))).toEqual([126000, 0, 0]);
    expect(rows[0].evo).toEqual({ kind: "value", deltaCents: 14000, ratio: { num: 14000, den: 126000 } });
    expect(rows[1].evo).toEqual({ kind: "value", deltaCents: 70000, ratio: null });
    expect(rows.reduce((s, r) => s + (r.cur.kind === "value" ? r.cur.masse : 0), 0)).toBe(220000);
  });
  it("sans axe de service : aucune ligne", () => {
    expect(serviceRows({ ...JOURNAL, serviceAxis: null }, ["2026-01"], ["2025-01"])).toEqual([]);
  });
  it("une seule règle : la fonction partagée, appelée aussi par l'écran Masse salariale (syntheseOf), mêmes lignes et même ordre", () => {
    expect(serviceRows).toBe(sharedServiceRows);
    expect(serviceLabel(null)).toBe("Non ventilé");
    expect(serviceLabel("A")).toBe("A");
    const payCtx = { input: JOURNAL, service: { axis: "Service", origin: "single-axis", updatedAt: null }, axes: ["Service"], etp: (ms: string[]) => ms.map((m) => ({ month: m, etp4: 10000, reason: null })), dsn: new Map() };
    const s = syntheseOf(payCtx as never, { annee: "2026", de: "01", a: "01" });
    if (s.kind !== "ready") throw new Error("contexte fictif incomplet");
    expect(s.months).toEqual(["2026-01"]);
    expect(s.serviceRows).toEqual(serviceRows(JOURNAL, ["2026-01"], ["2025-01"]));
    expect(s.serviceRows.map((r) => r.value)).toEqual(["A", "B", null]);
  });
});

describe("loadServicesInput + buildServices : tableau par service (colonnes de l'écran Masse salariale)", () => {
  it("cellules calculées à la main ; lien de filtre par service ; total en pied", async () => {
    const input = await loadServicesInput(fakeCtx());
    expect(input.nd).toBeNull();
    expect(input.data!.rows.map((r) => r.href)).toEqual([`${BASE}?chapitre=services&annee=2026&de=01&a=01&service=A`, `${BASE}?chapitre=services&annee=2026&de=01&a=01&service=B`, `${BASE}?chapitre=services&annee=2026&de=01&a=01&service=__nv__`]);
    const m = buildServices(input);
    const t = table(m, "services");
    expect(t.columns.map((c) => c.header)).toEqual(["Service", "Coût janvier 2026", "Coût N-1 (janvier 2025)", "Écart", "Écart (%)", "Part du coût", "Hors primes", "Primes", "Cotisations", "Coût / personne-mois"]);
    expect(t.columns.every((c) => c.sortable)).toBe(true);
    expect(t.rows.map((r) => r.cells[0])).toEqual(["A", "B", "Non ventilé"]);
    // A : 1 400 € ; 1 260 € ; +140 € ; 140 ÷ 1 260 = 11,11 % ; part 1 400 ÷ 2 200 = 63,64 % ; hors primes 1 000 € ; primes 0 € ;
    // cotisations 400 € ; 1 400 € ÷ 1 personne-mois = 1 400,00 €.
    expect(["n", "n1", "ecart", "ecart-pct", "part", "hors-primes", "primes", "cotisations", "cout-pm"].map((k) => shown(t, 0, k))).toEqual(["1 400,00 €", "1 260,00 €", "+140,00 €", "+11,11 %", "63,64 %", "1 000,00 €", "0,00 €", "400,00 €", "1 400,00 €"]);
    // B : N-1 nul → % n.d. ; part 700 ÷ 2 200 = 31,82 %.
    expect(raw(t, 1, "ecart-pct")).toEqual({ nd: N1_NUL });
    expect(shown(t, 1, "part")).toBe("31,82 %");
    // Sans code : prime de 100 € → hors primes 0 € ; part 100 ÷ 2 200 = 4,55 %.
    expect(["n", "hors-primes", "primes", "part", "cout-pm"].map((k) => shown(t, 2, k))).toEqual(["100,00 €", "0,00 €", "100,00 €", "4,55 %", "100,00 €"]);
    // Total : 2 200 € ; 1 260 € ; +940 € ; 940 ÷ 1 260 = 74,60 % ; part sans objet ; 2 200 € ÷ 3 personnes-mois = 733,33 €.
    expect(["n", "n1", "ecart", "ecart-pct", "part", "hors-primes", "primes", "cotisations", "cout-pm"].map((k) => shown(t, "foot", k))).toEqual(["2 200,00 €", "1 260,00 €", "+940,00 €", "+74,60 %", "—", "1 500,00 €", "100,00 €", "600,00 €", "733,33 €"]);
    expect(m.count).toBe(3);
    expect(m.trend).toBe(true);
    expect(m.selected).toBeNull();
  });
  it("contribution à l'écart (barres signées) et répartition (anneau) : valeurs du tableau", async () => {
    const m = buildServices(await loadServicesInput(fakeCtx()));
    const c = chart(m, "services-contribution");
    expect(c.categories).toEqual(["A", "B", "Non ventilé"]);
    expect(c.series[0].values).toEqual([14000, 70000, 10000]);
    expect(c.series[0].name).toBe("Écart à N-1, janvier 2026");
    expect(c.tableId).toBe("services");
    const ring = chart(m, "services-repartition");
    expect(ring.series.map((s) => [s.name, s.values[0]])).toEqual([
      ["A", 140000],
      ["B", 70000],
      ["Non ventilé", 10000],
    ]);
    expect(ring.note).toBeUndefined();
  });
  it("tri par l'adresse : écart croissant, n.d. en dernier, total jamais trié", async () => {
    const t = table(buildServices(await loadServicesInput(fakeCtx())), "services");
    expect(sortRows(t, "ecart", "asc").map((r) => r.cells[0])).toEqual(["Non ventilé", "A", "B"]);
    expect(sortRows(t, "ecart-pct", "desc").map((r) => r.cells[0])).toEqual(["A", "B", "Non ventilé"]);
  });
  it("filtre Service : le tableau garde tous les services (mêmes chiffres), le service retenu est rappelé", async () => {
    const m = buildServices(await loadServicesInput(fakeCtx({ service: "B" })));
    expect(table(m, "services").rows).toHaveLength(3);
    expect(m.selected).toEqual({ label: "B", clearHref: `${BASE}?chapitre=services&annee=2026&de=01&a=01` });
  });
  it("sans axe, sans journal (DSN) ou sans période : chapitre n.d. avec la raison et l'action", async () => {
    const noAxis = await loadServicesInput(fakeCtx({ pay: { ...PAY, service: { axis: null } }, reason: "aucun code analytique dans le journal PayFit" }));
    expect(noAxis.nd).toEqual({ reason: "aucun code analytique dans le journal PayFit", action: { href: "/e/demo/parametres#masse-salariale", label: "Choisir l'axe du service dans Paramètres" } });
    const dsn = await loadServicesInput(fakeCtx({ pay: { ...PAY, input: null, source: "dsn" } }));
    expect(dsn.nd?.reason).toBe("source RH retenue : DSN — journal de paie PayFit non lu");
    expect(dsn.nd?.action?.href).toBe("/e/demo/donnees");
    const none = await loadServicesInput(fakeCtx({ period: false }));
    expect(none.nd?.reason).toBe("Aucun mois clos à la date de référence");
    expect(buildServices(dsn).nd?.reason).toMatch(/DSN/);
  });
  it("un service n.d. : n.d. dans le tableau et dans les deux graphiques, jamais 0 ; personne-mois sans contrat → n.d.", () => {
    const C_ND: WindowIn = { kind: "nd", nd: { reason: "x" }, months: [{ month: "2026-01", kind: "nd", open: false, nd: { reason: "ligne l9 du compte 641100 sans montant (ni débit ni crédit)" } }] };
    const A: WindowIn = { kind: "value", brut: 100000, cotisations: 40000, masse: 140000, byRubric: R(100000, 0, 0, 0), months: [N_JAN], paidContractMonths: 0 };
    const A1: WindowIn = { kind: "value", brut: 90000, cotisations: 36000, masse: 126000, byRubric: R(90000, 0, 0, 0), months: [P_JAN], paidContractMonths: 1 };
    const data: ServicesData = {
      year: 2026,
      prevYear: 2025,
      labels: { period: "janvier 2026", prev: "janvier 2025" },
      axis: "Service",
      axisMissing: true,
      rows: [
        { value: "A", cur: A, prev: A1, evo: { kind: "value", deltaCents: 14000, ratio: { num: 14000, den: 126000 } } },
        { value: "C", cur: C_ND, prev: A1, evo: { kind: "nd", nd: { reason: "période n.d. (x)" } } },
      ],
      total: { cur: C_ND, prev: A1, evo: { kind: "nd", nd: { reason: "période n.d. (x)" } } },
      selected: null,
    };
    const m = buildServices({ nd: null, data });
    const t = table(m, "services");
    const why = "janv. 2026 : ligne l9 du compte 641100 sans montant (ni débit ni crédit)";
    expect(raw(t, 1, "n")).toEqual({ nd: why });
    expect(raw(t, 1, "ecart")).toEqual({ nd: why });
    expect(raw(t, 0, "part")).toEqual({ nd: why });
    expect(raw(t, 0, "cout-pm")).toEqual({ nd: SANS_CONTRAT });
    expect(chart(m, "services-contribution").series[0].values).toEqual([14000, null]);
    expect(chart(m, "services-contribution").series[0].reasons).toEqual([null, why]);
    const ring = chart(m, "services-repartition");
    expect(ring.series.map((s) => s.values[0])).toEqual([140000, null]);
    expect(ring.series[1].reasons).toEqual([why]);
    expect(ring.note).toBe("Parts calculées sur les services tracés.");
    expect(m.limits[0]).toBe("L'axe « Service » choisi dans Paramètres n'existe plus dans le journal appliqué : toutes les lignes sont « Non ventilé ».");
  });
});

describe("loadFixeVariableInput : mêmes fonctions que l'onglet Fixe & variable", () => {
  it("journal entier, puis restreint au service retenu", async () => {
    const all = await loadFixeVariableInput(fakeCtx({ chapitre: "fixe-variable" }));
    expect(all.data!.cur).toMatchObject({ kind: "value", brut: 160000, cotisations: 60000, masse: 220000 });
    expect(all.data!.prev).toMatchObject({ kind: "value", brut: 90000, masse: 126000 });
    expect(all.data!.labelsN!.map((l) => [l.rubric, l.label, l.cents])).toEqual([
      ["primes", "compte 641300", 10000],
      ["salaires", "compte 641100", 150000],
    ]);
    expect(Object.keys(all.data!.labelsByMonth)).toEqual(["2026-01"]);
    // Service A : un contrat rémunéré en janvier 2026 (c1) et en janvier 2025 (c1) ; seuil de confidentialité 1 → affiché.
    const a = await loadFixeVariableInput(fakeCtx({ chapitre: "fixe-variable", service: "A", settings: seuilSettings(1) }));
    expect(a.data!.cur).toMatchObject({ kind: "value", brut: 100000, masse: 140000 });
    const m = buildFixeVariable(a);
    expect(sp(tile(m, "fixe").value.text)).toBe("1 000,00 €");
    expect(tile(m, "fixe").variations!.slice(1).map((v) => sp(v.text!))).toEqual(["+100,00 €", "+11,11 %"]);
  });
  it("service retenu : seuil de confidentialité absent, illisible ou non atteint → chapitre n.d. avec la raison et l'action", async () => {
    const at = (settings: CroiseeSettings, service: string | null = "A") => loadFixeVariableInput(fakeCtx({ chapitre: "fixe-variable", service, settings }));
    expect(await at(NO_SETTINGS)).toEqual({ nd: { reason: "seuil de confidentialité non défini (Paramètres)", action: { href: "/e/demo/parametres#croisee", label: "Paramètres" } }, data: null });
    expect((await at(seuilSettings("5"))).nd?.reason).toBe("seuil de confidentialité illisible : à ré-enregistrer (Paramètres)");
    // Seuil 2 : A n'a qu'un contrat rémunéré en janvier 2026 → masqué ; le lien retire le filtre Service.
    expect(await at(seuilSettings(2))).toEqual({
      nd: { reason: "non affiché (seuil de confidentialité : 2 personnes) — service retenu par le filtre", action: { href: `${BASE}?chapitre=fixe-variable&annee=2026&de=01&a=01`, label: "Retirer le filtre Service" } },
      data: null,
    });
    // Non ventilé : un contrat (c3) en janvier 2026, aucune ligne en janvier 2025 (groupe vide, non masqué) → masqué au seuil 2.
    expect((await at(seuilSettings(2), null)).nd?.reason).toMatch(/^non affiché \(seuil de confidentialité : 2 personnes\)/);
    // Sans filtre Service : chiffres de toute l'entreprise, jamais masqués (le paramètre n'est pas lu).
    expect((await loadFixeVariableInput(fakeCtx({ chapitre: "fixe-variable", settings: NO_SETTINGS }))).nd).toBeNull();
  });
  it("sans journal ou sans période : n.d. avec la raison", async () => {
    const dsn = await loadFixeVariableInput(fakeCtx({ pay: { ...PAY, input: null, source: "dsn" } }));
    expect(dsn).toEqual({ nd: { reason: "source RH retenue : DSN — journal de paie PayFit non lu", action: { href: "/e/demo/donnees", label: "Choisir ou lire une source dans Données" } }, data: null });
    expect((await loadFixeVariableInput(fakeCtx({ period: false }))).nd?.reason).toBe("Aucun mois clos à la date de référence");
  });
});

// --- Rendu -----------------------------------------------------------------------------------------------------------------------

const TABLEAU = `${BASE}?chapitre=fixe-variable&affichage=tableau`;
const renderFv = (m: FixeVariableModel, affichage: Affichage = "tout") => unescape(renderToStaticMarkup(h(FixeVariableChapter, { model: m, slug: "demo", affichage, tableauHref: TABLEAU })));

describe("FixeVariableChapter : rendu du modèle", () => {
  it("afficher tout : six cartes, graphiques, tableaux, « Prévu », limites ; « rigidité » seulement dans la liste « Prévu »", () => {
    const html = renderFv(fv());
    for (const id of ["fixe", "variable", "primes", "stages", "part-primes", "part-salaires"]) expect(html).toContain(`data-testid="cx-tile-fixe-variable-${id}"`);
    for (const id of Object.values(FV)) if (id !== FV.repartition && id !== FV.structure) expect(html).toContain(`data-testid="cx-table-${id}"`);
    for (const id of [FV.repartition, FV.structure, FV.mois, FV.primesMois, FV.primesFamilles]) expect(html).toContain(`data-testid="cx-chart-${id}"`);
    for (const p of PREVU_FIXE_VARIABLE) expect(html).toContain(`data-testid="cx-prevu-${p.id}"`);
    for (const b of ["cartes", "composition", "mois", "primes", "libelles", "prevu", "limites"]) expect(html).toContain(`id="cx-fixe-variable-${b}"`);
    expect(html).toContain("Part des salaires dans le brut");
    // La rigidité est un indicateur « Prévu » (avec sa raison) ; hors de cette ligne, le mot n'apparaît que dans l'ancre du glossaire
    // (croisee-rigidite) : ni carte ni tableau ne l'affichent.
    const prevu = html.match(/<li data-testid="cx-prevu-fixe-variable-rigidite">.*?<\/li>/s)?.[0] ?? "";
    expect(prevu).toContain("Rigidité de la rémunération (fixe contractuel et avantages obligatoires)");
    expect(prevu).toContain("classification fixe / avantages obligatoires absente des sources ; seule la part des salaires dans le brut est calculée");
    expect(html.replace(prevu, "").replace(/href="[^"]*"/g, "")).not.toMatch(/rigidit/i);
    expect(html).toContain('data-testid="ms-trend-legend"');
    expect(html).toContain('href="/e/demo/glossaire#def-croisee-rigidite"');
  });
  it("graphiques seuls : aucun tableau, un lien vers chaque tableau exact ; tableaux seuls : aucun graphique", () => {
    const g = renderFv(fv(), "graphique");
    expect(g).not.toContain('data-testid="cx-table-');
    expect(g).toContain(`href="${TABLEAU}#cx-table-${FV.mois}"`);
    expect(g).not.toContain('data-testid="cx-fixe-variable-prevu"');
    const t = renderFv(fv(), "tableau");
    expect(t).not.toContain('data-testid="cx-chart-');
    expect(t).toContain(`data-testid="cx-table-${FV.libelles}"`);
    expect(t).toContain('data-testid="cx-fixe-variable-prevu"');
  });
  it("période n.d. : « n.d. » et sa raison, jamais un montant à zéro inventé ; chapitre n.d. : bloc n.d. avec action", () => {
    const html = renderFv(fv({ cur: CUR_ND, labelsN: null, labelsByMonth: { "2026-01": BY_MONTH["2026-01"] } }));
    expect(html).toContain("n.d.");
    expect(html).toContain('data-testid="cx-fixe-variable-libelles-nd"');
    expect(sp(html)).toContain("mois hors de la lecture PayFit appliquée");
    const nd = renderFv(buildFixeVariable({ nd: { reason: "aucun mois clos", action: { href: "/e/demo/donnees", label: "Données" } }, data: null }));
    expect(nd).toContain('data-testid="cx-fixe-variable-nd"');
    expect(nd).toContain("Aucun mois clos");
    expect(nd).toContain('href="/e/demo/donnees"');
  });
});

describe("ServicesChapter : rendu du modèle", () => {
  it("tableau trié par l'adresse (aria-sort, en-têtes en liens), services en liens de filtre, deux graphiques", async () => {
    const m = buildServices(await loadServicesInput(fakeCtx({ service: "B" })));
    const base = `${BASE}?chapitre=services&annee=2026&de=01&a=01&service=B&tri=services.ecart&sens=asc`;
    const html = unescape(renderToStaticMarkup(h(ServicesChapter, { model: m, slug: "demo", affichage: "tout", tableauHref: `${BASE}?chapitre=services&affichage=tableau`, sort: { base, tri: "services.ecart", sens: "asc" } })));
    expect(html).toContain('data-testid="cx-table-services"');
    expect(html).toMatch(/aria-sort="ascending"[^>]*>\s*<a class="cx-sort" href="[^"]*tri=services\.ecart&sens=desc#cx-table-services"/);
    expect(html).toContain('href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=services&annee=2026&de=01&a=01&service=A"');
    // Ordre croissant de l'écart : sans code (+100 €), A (+140 €), B (+700 €).
    const order = [...html.matchAll(/<th scope="row"[^>]*>(?:<a href="[^"]*">)?([^<]+)/g)].map((x) => x[1]);
    expect(order.slice(0, 3)).toEqual(["Non ventilé", "A", "B"]);
    expect(html).toContain('data-testid="cx-chart-services-contribution"');
    expect(html).toContain('data-testid="cx-chart-services-repartition"');
    expect(html).toContain('data-testid="cx-services-filtre"');
    expect(html).toContain("3 services");
    expect(html).toContain('href="#cx-table-services"');
  });
  it("graphiques seuls : pas de tableau, lien vers le tableau exact ; tableaux seuls : pas de graphique", async () => {
    const m = buildServices(await loadServicesInput(fakeCtx()));
    const g = renderToStaticMarkup(h(ServicesChapter, { model: m, slug: "demo", affichage: "graphique", tableauHref: "/t" }));
    expect(g).not.toContain('data-testid="cx-table-services"');
    expect(g).toContain('href="/t#cx-table-services"');
    const t = renderToStaticMarkup(h(ServicesChapter, { model: m, slug: "demo", affichage: "tableau", tableauHref: "/t" }));
    expect(t).not.toContain('data-testid="cx-chart-');
    expect(t).toContain('data-testid="cx-table-services"');
  });
  it("chapitre n.d. (sans axe) : raison et lien vers Paramètres", async () => {
    const m = buildServices(await loadServicesInput(fakeCtx({ pay: { ...PAY, service: { axis: null } }, reason: "aucun code analytique dans le journal PayFit" })));
    const html = renderToStaticMarkup(h(ServicesChapter, { model: m, slug: "demo", affichage: "tout", tableauHref: "/t" }));
    expect(html).toContain('data-testid="cx-services-nd"');
    expect(html).toContain("Aucun code analytique dans le journal PayFit");
    expect(html).toContain('href="/e/demo/parametres#masse-salariale"');
  });
});

// --- Seuil de confidentialité sous le filtre Service (cas écrits à la main) -------------------------------------------------------

describe("serviceConfidentiality : chaque mois connu du service retenu est un groupe de contrats rémunérés", () => {
  const v = (brut: number, ...paid: string[]) => ({ kind: "value" as const, brut, paidContracts: paid });
  const ND = { kind: "nd" as const };
  it("seuil absent : n.d. avec la raison du paramètre", () => {
    expect(serviceConfidentiality({ kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" }, [v(1000, "a")])).toEqual({ cause: "parametre", reason: "seuil de confidentialité non défini (Paramètres)" });
  });
  it("seuil 3 : trois et quatre contrats → affiché ; un mois n.d. ne compte pas ; un mois vide (aucun brut, aucun contrat) n'est pas masqué", () => {
    expect(serviceConfidentiality({ kind: "set", value: 3 }, [v(1000, "a", "b", "c"), v(500, "a", "b", "c", "d"), ND, v(0)])).toBeNull();
  });
  it("seuil 3 : un mois à deux contrats → tout le chapitre n.d.", () => {
    expect(serviceConfidentiality({ kind: "set", value: 3 }, [v(1000, "a", "b", "c"), v(400, "a", "b")])).toEqual({ cause: "seuil", reason: "non affiché (seuil de confidentialité : 3 personnes) — service retenu par le filtre" });
  });
  it("brut sans contrat rattaché : effectif non dénombré, seuil non vérifiable ; un mois sous le seuil l'emporte", () => {
    expect(serviceConfidentiality({ kind: "set", value: 3 }, [v(1000, "a", "b", "c"), v(200)])).toEqual({ cause: "seuil", reason: "effectif du groupe non dénombré : seuil de confidentialité non vérifiable — service retenu par le filtre" });
    expect(serviceConfidentiality({ kind: "set", value: 3 }, [v(200), v(400, "a")])!.reason).toMatch(/^non affiché/);
  });
  it("seuil 1 : un seul contrat suffit", () => {
    expect(serviceConfidentiality({ kind: "set", value: 1 }, [v(1000, "a")])).toBeNull();
  });
});

// --- Cas limites des parts et des écarts (cas écrits à la main) ----------------------------------------------------------------

describe("N-1 négatif, brut nul, coût total nul : n.d. avec leur raison, jamais un pourcentage", () => {
  it("chapitre 04 : indemnités N-1 négatives (régularisation de −100 €) → écart +600 €, % n.d. « N-1 négatif »", () => {
    // N : indemnités 500 € ; N-1 : −100 € ; écart 500 − (−100) = +600 €.
    const m = fv({ prev: { ...PREV, byRubric: R(750000, 50000, 20000, -10000) } as WindowIn });
    const t = table(m, FV.composantes);
    expect([raw(t, 3, "n"), raw(t, 3, "n1"), raw(t, 3, "ecart"), raw(t, 3, "ecart-pct")]).toEqual([50000, -10000, 60000, { nd: N1_NEGATIF }]);
  });
  it("chapitre 04 : brut nul sur la période → parts du brut n.d. « brut nul », listées sous les cartes", () => {
    const Z: MonthIn = { ...N_JAN, brut: 0, cotisations: 0, masse: 0, byRubric: R(0, 0, 0, 0) };
    const m = fv({ cur: { kind: "value", brut: 0, cotisations: 0, masse: 0, byRubric: R(0, 0, 0, 0), months: [Z, { ...Z, month: "2026-02" }], paidContractMonths: 0 }, labelsN: [] });
    expect(tile(m, "part-salaires").value).toEqual({ text: "n.d.", kind: "nd", reason: BRUT_NUL });
    expect(table(m, FV.parts).rows.map((r) => r.cells[1])).toEqual([{ nd: BRUT_NUL }, { nd: BRUT_NUL }]);
    // L'écart en points est n.d. lui aussi (raison de N) ; N-1 reste lu : 7 500 ÷ 8 200 = 91,46 %.
    expect(table(m, FV.parts).rows[0].cells.slice(2)).toEqual([{ exact: 750000 / 820000 }, { nd: BRUT_NUL }]);
    expect(m.tileNd).toEqual([`Part des primes dans le brut, Part des salaires dans le brut : ${BRUT_NUL}`]);
  });
  it("chapitre 05 : N-1 négatif → % n.d. ; coût total nul (A +100 €, B −100 €) → parts n.d. « coût total nul »", () => {
    const w = (masse: number): WindowIn => ({ kind: "value", brut: masse, cotisations: 0, masse, byRubric: R(masse, 0, 0, 0), months: [{ ...N_JAN, brut: masse, cotisations: 0, masse, byRubric: R(masse, 0, 0, 0) }], paidContractMonths: 1 });
    const data: ServicesData = {
      year: 2026,
      prevYear: 2025,
      labels: { period: "janvier 2026", prev: "janvier 2025" },
      axis: "Service",
      axisMissing: false,
      rows: [
        // A : 100 € face à −200 € → écart +300 €, N-1 négatif. B : −100 € face à 0 € → écart −100 €, N-1 nul.
        { value: "A", cur: w(10000), prev: w(-20000), evo: { kind: "value", deltaCents: 30000, ratio: { num: 30000, den: -20000 } } },
        { value: "B", cur: w(-10000), prev: w(0), evo: { kind: "value", deltaCents: -10000, ratio: null } },
      ],
      total: { cur: w(0), prev: w(-20000), evo: { kind: "value", deltaCents: 20000, ratio: { num: 20000, den: -20000 } } },
      selected: null,
    };
    const t = table(buildServices({ nd: null, data }), "services");
    expect(t.rows.map((r) => r.cells[0])).toEqual(["A", "B"]);
    expect([raw(t, 0, "ecart"), raw(t, 0, "ecart-pct"), raw(t, 0, "part")]).toEqual([30000, { nd: N1_NEGATIF }, { nd: TOTAL_NUL }]);
    expect([raw(t, 1, "ecart"), raw(t, 1, "ecart-pct"), raw(t, 1, "part")]).toEqual([-10000, { nd: N1_NUL }, { nd: TOTAL_NUL }]);
    expect([raw(t, "foot", "ecart"), raw(t, "foot", "ecart-pct")]).toEqual([20000, { nd: N1_NEGATIF }]);
  });
});

describe("légende des tendances : un ton écrit dans n'importe quel tableau suffit", () => {
  it("totaux identiques à N-1 mais libellés différents → légende affichée", () => {
    // Mêmes montants N et N-1, mois par mois ; seuls les libellés de salaire diffèrent : « Salaire de base » 8 000 € face à 7 000 €
    // (+1 000 €, rouge), « Complément de salaire » 0 € face à 1 000 € (−1 000 €, vert).
    const same: WindowIn = { ...CUR, months: [{ ...N_JAN, month: "2025-01" }, { ...N_FEB, month: "2025-02" }] } as WindowIn;
    const m = fv({ prev: same, labelsN1: [L("salaires", "Salaire de base", 700000), L("salaires", "Complément de salaire", 100000), ...LABELS_N.slice(1)] });
    expect(m.tiles.every((t) => (t.variations ?? []).every((v) => v.tone === "flat"))).toBe(true);
    expect(table(m, FV.composantes).rows.every((r) => r.cells[3] === 0)).toBe(true);
    const lib = table(m, FV.libelles);
    expect(lib.rows.slice(0, 2).map((r, i) => [r.cells[0], shown(lib, i, "ecart")])).toEqual([
      ["Complément de salaire", "−1 000,00 €"],
      ["Salaire de base", "+1 000,00 €"],
    ]);
    expect(m.trend).toBe(true);
  });
});

describe("plus de huit familles de prime : pas de graphique par famille, lien vers le tableau en « Graphiques »", () => {
  // Neuf familles de 100 € chacune, toutes versées en janvier 2026.
  const nine = Array.from({ length: 9 }, (_, i) => L("primes", `Prime fictive ${i + 1}`, 10000));
  const m = fv({ labelsN: nine, labelsByMonth: { "2026-01": nine, "2026-02": [] } });
  it("tableau par famille gardé, graphique non tracé, note d'une ligne", () => {
    expect(table(m, FV.primesFamilles).columns).toHaveLength(11);
    expect(m.charts.some((c) => c.id === FV.primesFamilles)).toBe(false);
    expect(m.blocks.find((b) => b.id === "primes")!.graphLinks).toEqual([FV.primesFamilles]);
  });
  it("rendu : le lien n'existe qu'en « Graphiques » et mène au tableau exact", () => {
    const g = renderFv(m, "graphique");
    expect(g).toContain(`data-testid="cx-fixe-variable-primes-lien-${FV.primesFamilles}"`);
    expect(g).toContain(`href="${TABLEAU}#cx-table-${FV.primesFamilles}"`);
    expect(g).not.toContain(`data-testid="cx-chart-${FV.primesFamilles}"`);
    expect(renderFv(m, "tout")).not.toContain(`data-testid="cx-fixe-variable-primes-lien-`);
  });
});

describe("services : ordre par défaut = tri annoncé par aria-sort (coût de la période décroissant)", () => {
  // Même journal, prime sans code portée à 1 000 € : sans code 1 000 € > B 700 €.
  const J2: JournalInput = { ...JOURNAL, lines: JOURNAL.lines.map((l) => (l.key === "l5" ? { ...l, debitCents: 100000 } : l)) };
  const ctx2 = () => fakeCtx({ pay: { ...PAY, input: J2 } });
  it("l'écran Masse salariale garde « Non ventilé » en dernier ; le chapitre range par coût, comme son tri par défaut", async () => {
    expect(serviceRows(J2, ["2026-01"], ["2025-01"]).map((r) => r.value)).toEqual(["A", "B", null]);
    const m = buildServices(await loadServicesInput(ctx2()));
    const t = table(m, "services");
    expect(t.rows.map((r) => r.cells[0])).toEqual(["A", "Non ventilé", "B"]);
    expect(sortRows(t, "n", "desc")).toEqual(t.rows);
    expect(chart(m, "services-contribution").categories).toEqual(["A", "Non ventilé", "B"]);
    expect(chart(m, "services-repartition").series.map((x) => x.name)).toEqual(["A", "Non ventilé", "B"]);
  });
  it("servicesSort : tri de l'adresse s'il vise une colonne triable du tableau, sinon coût de la période décroissant", async () => {
    const t = table(buildServices(await loadServicesInput(ctx2())), "services");
    expect(servicesSort(t, null, null)).toEqual({ tri: "services.n", sens: "desc" });
    expect(servicesSort(t, "services.ecart", "asc")).toEqual({ tri: "services.ecart", sens: "asc" });
    expect(servicesSort(t, "services.inconnue", "asc")).toEqual({ tri: "services.n", sens: "desc" });
    expect(servicesSort(t, "autre.n", "asc")).toEqual({ tri: "services.n", sens: "desc" });
  });
  it("rendu sans tri dans l'adresse : aria-sort « descending » sur le coût de la période, flèche, lien vers le sens croissant", async () => {
    const m = buildServices(await loadServicesInput(ctx2()));
    const base = `${BASE}?chapitre=services&annee=2026&de=01&a=01`;
    const html = unescape(renderToStaticMarkup(h(ServicesChapter, { model: m, slug: "demo", affichage: "tableau", tableauHref: "/t", sort: { base, tri: null, sens: null } })));
    const sorts = [...html.matchAll(/aria-sort="(\w+)"/g)].map((x) => x[1]);
    expect(sorts.filter((x) => x !== "none")).toEqual(["descending"]);
    expect(html).toMatch(/aria-sort="descending"[^>]*>\s*<a class="cx-sort" href="[^"]*tri=services\.n&sens=asc#cx-table-services"/);
    const order = [...html.matchAll(/<th scope="row"[^>]*>(?:<a href="[^"]*">)?([^<]+)/g)].map((x) => x[1]);
    expect(order.slice(0, 3)).toEqual(["A", "Non ventilé", "B"]);
  });
});

describe("services sans aucune ligne : la phrase est écrite une fois, sans graphique vide", () => {
  const data: ServicesData = {
    year: 2026,
    prevYear: 2025,
    labels: { period: "janvier 2026", prev: "janvier 2025" },
    axis: "Service",
    axisMissing: false,
    rows: [],
    total: { cur: CUR, prev: PREV, evo: { kind: "value", deltaCents: 182000, ratio: { num: 182000, den: 1148000 } } },
    selected: null,
  };
  const m = buildServices({ nd: null, data });
  it.each(["tout", "graphique", "tableau"] as Affichage[])("affichage %s", (affichage) => {
    expect(m.charts).toEqual([]);
    expect(m.blocks.map((b) => b.id)).toEqual(["tableau"]);
    const html = renderToStaticMarkup(h(ServicesChapter, { model: m, slug: "demo", affichage, tableauHref: "/t" }));
    expect(html.split(SANS_LIGNE).length - 1).toBe(1);
  });
});

describe("un seul calcul par affichage : le modèle du chapitre est mémoïsé par contexte", () => {
  it("fixeVariableModel et servicesModel renvoient la même promesse pour un même contexte, et le modèle de l'écran", async () => {
    const ctx = fakeCtx({ chapitre: "fixe-variable" });
    const p1 = fixeVariableModel(ctx);
    expect(fixeVariableModel(ctx)).toBe(p1);
    expect(await p1).toEqual(buildFixeVariable(await loadFixeVariableInput(ctx)));
    const sctx = fakeCtx();
    const s1 = servicesModel(sctx);
    expect(servicesModel(sctx)).toBe(s1);
    expect(servicesModel(fakeCtx())).not.toBe(s1);
    expect(await s1).toEqual(buildServices(await loadServicesInput(sctx)));
  });
});
