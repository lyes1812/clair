import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FixeVariableChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChFixeVariable";
import { ServicesChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChServices";
import { CHAPTERS } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/chapitres";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { Affichage } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import { syntheseOf } from "@/app/e/[slug]/studio-rh/masse-salariale/synthese-data";
import { confidentialiteReason, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting, type PersonLink } from "@/lib/confidentialite";
import { readCroiseeSettings, type CroiseeSettings } from "@/lib/croisee-settings";
import { glossaryEntry } from "@/lib/glossary";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES, type RubricId } from "@/lib/payroll/grid";
import { windowPayroll } from "@/lib/payroll/engine";
import { labelTotals, maskLabels } from "@/lib/payroll/lot2";
import { serviceRows as sharedServiceRows } from "@/lib/payroll/service-rows";
import { cellView, croiseeHref, sortRows, type CroiseeCell, type CroiseeTable } from "@/lib/viz/croisee";
import {
  BRUT_NUL,
  buildFixeVariable,
  buildServices,
  FIXE_VARIABLE_IDS as FV,
  fixeVariableModel,
  labelMaskOf,
  loadFixeVariableInput,
  loadServicesInput,
  monthReason,
  N1_NEGATIF,
  N1_NUL,
  periodHeads,
  PREVU_FIXE_VARIABLE,
  SANS_CONTRAT,
  SANS_LIGNE,
  serviceLabel,
  serviceRows,
  serviceRowsIn,
  servicesModel,
  servicesSort,
  TOTAL_NUL,
  windowReason,
  type FixeVariableData,
  type FixeVariableModel,
  type LabelIn,
  type ServiceRowIn,
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
// Seuil 1 (cas de base) : rien n'est masqué, le masque de maskLabels est vide ; les cas de masquage sont plus bas (labelMaskOf sur un
// journal fictif).
const NO_MASK = { labels: {}, families: {} };
const CONF_HREF = "/e/demo/parametres#confidentialite";
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
  confidentialite: { kind: "set", value: 1 },
  mask: NO_MASK,
  links: { confidentialite: CONF_HREF },
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
// Lien contrat → jeton de personne du référentiel (contexte) : chaque contrat fictif a sa personne, sauf lien fourni.
const linkOf = (pairs: Record<string, string>): PersonLink => new Map(Object.entries(pairs));
const LINK = linkOf({ c1: "p1", c2: "p2", c3: "p3", c7: "p7", c8: "p8", c9: "p9" });
function fakeCtx(o: { pay?: PayStub; service?: string | null; chapitre?: string; period?: boolean; reason?: string | null; settings?: CroiseeSettings; link?: PersonLink } = {}): CroiseeContext {
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
    // Seuil de confidentialité 1 par défaut (aucun groupe dénombré n'est masqué) ; les cas de masquage passent un autre réglage.
    settings: o.settings ?? seuilSettings(1),
    affichage: "tout",
    href: (patch: Record<string, string | null> = {}, hash?: string) => croiseeHref(BASE, { ...state, ...patch }, hash),
    load: { payroll: async () => o.pay ?? PAY, persons: async () => o.link ?? LINK },
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
    const payCtx = { input: JOURNAL, kpi: { input: null }, service: { axis: "Service", origin: "single-axis", updatedAt: null }, axes: ["Service"], etp: (ms: string[]) => ms.map((m) => ({ month: m, etp4: 10000, reason: null })), dsn: new Map() };
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
      confidentialite: { kind: "set", value: 1 },
      links: { confidentialite: CONF_HREF },
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
    expect(await at(NO_SETTINGS)).toEqual({ nd: { reason: "seuil de confidentialité non défini (Paramètres)", action: { href: CONF_HREF, label: "Paramètres" } }, data: null });
    expect((await at(seuilSettings("5"))).nd?.reason).toBe("seuil de confidentialité illisible : à ré-enregistrer (Paramètres)");
    // Seuil 2 : A n'a qu'une personne rémunérée en janvier 2026 → masqué, avec la seule raison du seuil ; le lien retire le filtre.
    expect(await at(seuilSettings(2))).toEqual({
      nd: { reason: "non affiché (seuil de confidentialité : 2 personnes)", action: { href: `${BASE}?chapitre=fixe-variable&annee=2026&de=01&a=01`, label: "Retirer le filtre Service" } },
      data: null,
    });
    // Non ventilé : un contrat (c3) en janvier 2026, aucune ligne en janvier 2025 (groupe vide, non masqué) → masqué au seuil 2.
    expect((await at(seuilSettings(2), null)).nd?.reason).toBe(confidentialiteReason(2));
    // Sans filtre Service : les totaux de toute l'entreprise sont affichés ; sans seuil défini, les répartitions par libellé et par
    // famille sont n.d. avec la raison et le lien vers Paramètres › Confidentialité.
    const noSeuil = await loadFixeVariableInput(fakeCtx({ chapitre: "fixe-variable", settings: NO_SETTINGS }));
    expect(noSeuil.nd).toBeNull();
    expect(noSeuil.data!.confidentialite).toEqual({ kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" });
    expect(noSeuil.data!.mask).toEqual({ labels: {}, families: {} });
    const mNo = buildFixeVariable(noSeuil);
    expect(sp(tile(mNo, "fixe").value.text)).toBe("1 500,00 €");
    expect(mNo.blocks.find((b) => b.id === "libelles")!.nd).toEqual([{ label: "Brut par libellé de paie", reason: "seuil de confidentialité non défini (Paramètres)", action: { href: CONF_HREF, label: "Paramètres" } }]);
    expect(table(mNo, FV.libelles).rows).toEqual([{ cells: ["Brut par libellé de paie", { nd: "seuil de confidentialité non défini (Paramètres)" }] }]);
    // Seuil 2 sans filtre : masque de maskLabels (lot2.ts) sur le journal entier, personnes lues par le lien (c1 : salaires A ; c2 :
    // salaires B ; c3 : primes), une colonne par rubrique et par mois (total de la rubrique du mois publié). Janvier 2026 : Salaires
    // {p1, p2} 1 500 € affiché ; Primes {p3} 100 € masqué, seul de sa colonne (le total des primes de janvier, publié, reste affiché).
    // Janvier 2025 : Salaires {p1} 900 € masqué, seul de sa colonne ; aucune prime (0 €, affiché). N et N-1 se déduisent de leur mois.
    // Famille « compte 641300 » en janvier : p3 masqué (sa cellule de période est celle du libellé).
    const two = await loadFixeVariableInput(fakeCtx({ chapitre: "fixe-variable", settings: seuilSettings(2) }));
    const R2 = confidentialiteReason(2);
    expect(two.data!.mask).toEqual({ labels: { "salaires\u0000compte 641100": { cur: null, prev: R2 }, "primes\u0000compte 641300": { cur: R2, prev: null } }, families: { "primes\u0000compte 641300": [R2] } });
    const m2 = buildFixeVariable(two);
    // Chaque cellule porte son propre statut (le même que l'onglet Fixe & variable) ; l'écart d'une ligne qui en masque une est n.d.
    expect(table(m2, FV.libelles).rows.map((r) => [r.cells[0], r.cells[1], r.cells[2], r.cells[3]])).toEqual([
      ["compte 641100", 150000, { nd: R2 }, { nd: R2 }],
      ["compte 641300", { nd: R2 }, 0, { nd: R2 }],
    ]);
    expect(table(m2, FV.primesFamilles).rows[0].cells).toEqual(["Janvier 2026", 10000, { nd: R2 }]);
    expect(table(m2, FV.libelles).foot!.cells.slice(0, 3)).toEqual(["Brut", 160000, 90000]);
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

describe("loadFixeVariableInput sous filtre Service : la taille se compte sur toute ligne de masse, pas seulement le brut", () => {
  // Journal fictif, axe « Service », janvier 2026 (janvier 2025 : une seule ligne, du service E) :
  // - C : cotisations 300 € portées par le contrat c7, aucun brut (l'ancien décompte sur le brut donnait 0 contrat : affiché) ;
  // - D : cotisations 120 € sans contrat rattaché, aucun brut ;
  // - E : salaires 800 € (c8) et dotation de provision de congés payés 50 € (c9, compte 6412, hors masse : c9 ne compte pas).
  const J2: JournalInput = {
    lines: [
      ln("m1", "2026-01", "645000", 30000, "c7", "C"),
      ln("m2", "2026-01", "645000", 12000, null, "D"),
      ln("m3", "2026-01", "641100", 80000, "c8", "E"),
      ln("m4", "2026-01", "641200", 5000, "c9", "E"),
      ln("m5", "2025-01", "641100", 70000, "c8", "E"),
    ],
    months: ["2025-01", "2026-01"],
    openMonths: [],
    grid: DEFAULT_PREFIXES,
    serviceAxis: "Service",
  };
  const at = (service: string, seuil: number, link?: PersonLink) => loadFixeVariableInput(fakeCtx({ chapitre: "fixe-variable", service, settings: seuilSettings(seuil), pay: { ...PAY, input: J2 }, link }));
  it("C (1 contrat qui ne porte que des cotisations) : masqué au seuil 2 ; au seuil 1, masqué en second (D, non dénombré, se lirait seul par différence du total publié)", async () => {
    expect((await at("C", 2)).nd?.reason).toBe("non affiché (seuil de confidentialité : 2 personnes)");
    // Garde unique (mêmes cellules que le tableau Services) : au seuil 1, C (p7) est dénombré, mais D (120 € sans contrat) est non
    // vérifiable et seul masqué de janvier 2026 dont le total est publié : la plus petite valeur affichée, C (300 €), est masquée aussi.
    expect((await at("C", 1)).nd?.reason).toBe(confidentialiteReason(1));
    // Sans la ligne de D, C est affiché au seuil 1 (cotisations 300 €, brut 0).
    const noD = { ...J2, lines: J2.lines.filter((l) => l.key !== "m2") };
    const one = await loadFixeVariableInput(fakeCtx({ chapitre: "fixe-variable", service: "C", settings: seuilSettings(1), pay: { ...PAY, input: noD } }));
    expect(one.nd).toBeNull();
    expect(one.data!.cur).toMatchObject({ kind: "value", brut: 0, cotisations: 30000, masse: 30000 });
  });
  it("D (cotisations non nulles, aucun contrat) : non vérifiable, même au seuil 1", async () => {
    expect((await at("D", 1)).nd?.reason).toBe(SEUIL_NON_VERIFIABLE);
  });
  it("E : la dotation de provision (hors masse) n'ajoute pas c9 ; 1 contrat → masqué au seuil 2", async () => {
    expect((await at("E", 2)).nd?.reason).toBe(confidentialiteReason(2));
    expect((await at("E", 1)).nd).toBeNull();
  });
  it("C, contrat c7 non relié à une personne : non vérifiable au seuil 1 (un contrat non relié ne protège jamais)", async () => {
    expect((await at("C", 1, linkOf({ c8: "p8" }))).nd?.reason).toBe(SEUIL_NON_VERIFIABLE);
  });
});

// --- Seuil de confidentialité en personnes distinctes : lignes par service (05), primes par famille et brut par libellé (04) --------

describe("serviceRowsIn + buildServices : lignes par service masquées par maskServiceRows (les cellules n.d. du tableau Services de la Masse salariale)", () => {
  // Trois services, janvier 2026 ; janvier 2025 : une seule contrepartie (421, ignorée) : le mois est connu, chaque service y vaut 0 €
  // sans aucun contrat. A : 1 400 € (contrat a1 → p1) ; B : 700 € (b1 → p1 aussi : la même personne a un second contrat dans B) ;
  // C : 2 000 € (c1 → p2, c2 → p3). Total 4 100 €.
  const journalOf = (b: { contract: string; person: string | null }): { journal: JournalInput; link: PersonLink } => ({
    journal: {
      lines: [ln("a", "2026-01", "641100", 140000, "a1", "A"), ln("b", "2026-01", "641100", 70000, b.contract, "B"), ln("c", "2026-01", "641100", 100000, "c1", "C"), ln("d", "2026-01", "641100", 100000, "c2", "C"), ln("z", "2025-01", "421000", null, null, undefined, 100)],
      months: ["2025-01", "2026-01"],
      openMonths: [],
      grid: DEFAULT_PREFIXES,
      serviceAxis: "Service",
    },
    link: linkOf({ a1: "p1", c1: "p2", c2: "p3", ...(b.person === null ? {} : { [b.contract]: b.person }) }),
  });
  const conf = (seuil: number | null): ConfidentialiteSetting => (seuil === null ? { kind: "absent" } : { kind: "set", value: seuil, updatedAt: null, updatedBy: null });
  const modelOf = (b: { contract: string; person: string | null }, seuil: number | null): ServicesModel => {
    const { journal, link } = journalOf(b);
    const setting = conf(seuil);
    const rows = serviceRowsIn(sharedServiceRows(journal, ["2026-01"], ["2025-01"]), link, setting);
    const data: ServicesData = {
      year: 2026,
      prevYear: 2025,
      labels: { period: "janvier 2026", prev: "janvier 2025" },
      axis: "Service",
      axisMissing: false,
      rows,
      total: { cur: windowPayroll(journal, ["2026-01"]), prev: windowPayroll(journal, ["2025-01"]), evo: { kind: "value", deltaCents: 410000, ratio: null } },
      selected: null,
      confidentialite: seuil === null ? { kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" } : { kind: "set", value: seuil },
      links: { confidentialite: CONF_HREF },
    };
    return buildServices({ nd: null, data });
  };
  // Lignes dans l'ordre des lignes partagées (coût de la période décroissant : C, A, B) ; les n.d. gardent cet ordre.
  const cellsOf = (m: ServicesModel) => table(m, "services").rows.map((r) => [r.cells[0], r.cells[1], r.cells[2], r.cells[3]]);

  it("une personne à deux contrats dans deux services compte une fois : A (p1) et B (p1) masqués ne décrivent qu'une personne, C est masqué en second ; N-1 (0 €, personne) reste affiché", () => {
    const R2 = { nd: confidentialiteReason(2) };
    const m = modelOf({ contract: "b1", person: "p1" }, 2);
    // Colonne N : A et B (1 personne chacun) masqués ; ensemble ils ne décrivent que p1 (1 < 2) : C (2 000 €, seul autre affiché) est
    // masqué aussi, sinon A + B = 4 100 − 2 000 se lirait pour une seule personne. N-1 (0 €, aucun contrat) ne décrit personne : affiché,
    // comme dans le tableau Services de la Masse salariale ; l'écart d'une valeur masquée est masqué.
    expect(cellsOf(m)).toEqual([
      ["C", R2, 0, R2],
      ["A", R2, 0, R2],
      ["B", R2, 0, R2],
    ]);
    // Le total (toute l'entreprise) n'est jamais masqué.
    expect(table(m, "services").foot!.cells.slice(0, 2)).toEqual(["Total", 410000]);
    expect(raw(table(m, "services"), 0, "cout-pm")).toEqual(R2);
    expect(chart(m, "services-contribution").series[0].values).toEqual([null, null, null]);
    expect(chart(m, "services-repartition").series.map((s) => s.values[0])).toEqual([null, null, null]);
    expect(m.limits).toContain("Confidentialité : seuil de 2 personnes distinctes par service, sur la période, sur N-1 et sur chacun de leurs mois ; masquage secondaire ; mêmes cellules n.d. que le tableau Services de la Masse salariale ; la ligne « Total » reste complète.");
    // B porté par une autre personne (p4) : A + B décrivent deux personnes (2 ≥ 2), C reste affiché.
    const m2 = modelOf({ contract: "b1", person: "p4" }, 2);
    expect(cellsOf(m2)).toEqual([
      ["C", 200000, 0, 200000],
      ["A", R2, 0, R2],
      ["B", R2, 0, R2],
    ]);
  });

  it("un contrat non relié ne protège pas : B (contrat b1 sans personne) est non dénombré ; A (p1) et C (p2, p3) masqués au seuil 3 ; au seuil 1, B reste non dénombré", () => {
    const m = modelOf({ contract: "b1", person: null }, 3);
    // Seuil 3 : B compte 0 personne reliée et 1 contrat non relié : non vérifiable ; A (1 personne) masqué ; C (2 personnes) masqué ;
    // {p1, p2, p3} = 3 ≥ 3. Raison de B : effectif non dénombré ; des autres : le seuil.
    expect(cellsOf(m)).toEqual([
      ["C", { nd: confidentialiteReason(3) }, 0, { nd: confidentialiteReason(3) }],
      ["A", { nd: confidentialiteReason(3) }, 0, { nd: confidentialiteReason(3) }],
      ["B", { nd: SEUIL_NON_VERIFIABLE }, 0, { nd: SEUIL_NON_VERIFIABLE }],
    ]);
    // Seuil 1 : A (p1) et C (p2, p3) affichés ; B (aucune personne reliée, un contrat non relié) reste non dénombré, et, seul masqué
    // d'une colonne au total publié, il entraîne le plus petit service affiché (A) en second.
    const m1 = modelOf({ contract: "b1", person: null }, 1);
    expect(cellsOf(m1).map((c) => [c[0], c[1]])).toEqual([
      ["C", 200000],
      ["A", { nd: confidentialiteReason(1) }],
      ["B", { nd: SEUIL_NON_VERIFIABLE }],
    ]);
  });

  it("mêmes cellules que le tableau Services de la Masse salariale : serviceRowsIn rend les fenêtres de maskServiceRows, sans leurs mois quand le seuil les masque", () => {
    const { journal, link } = journalOf({ contract: "b1", person: "p1" });
    const rows = serviceRowsIn(sharedServiceRows(journal, ["2026-01"], ["2025-01"]), link, conf(2), (v) => `/x?service=${v}`);
    expect(rows.map((r) => [r.value, r.cur.kind, r.cur.kind === "nd" ? r.cur.nd.reason : null, r.cur.months.length, r.prev.kind, r.evo.kind, r.href])).toEqual([
      ["C", "nd", confidentialiteReason(2), 0, "value", "nd", "/x?service=C"],
      ["A", "nd", confidentialiteReason(2), 0, "value", "nd", "/x?service=A"],
      ["B", "nd", confidentialiteReason(2), 0, "value", "nd", "/x?service=B"],
    ]);
    // Seuil 1 : aucune fenêtre masquée, les fenêtres du moteur passent telles quelles (mois compris).
    const shown = serviceRowsIn(sharedServiceRows(journal, ["2026-01"], ["2025-01"]), link, conf(1));
    expect(shown.map((r) => [r.value, r.cur.kind, r.cur.months.length, r.href])).toEqual([
      ["C", "value", 1, undefined],
      ["A", "value", 1, undefined],
      ["B", "value", 1, undefined],
    ]);
    // Seuil non défini : chaque fenêtre n.d. avec la raison du paramètre, sans ses mois.
    const nd = serviceRowsIn(sharedServiceRows(journal, ["2026-01"], ["2025-01"]), link, conf(null));
    expect(nd.map((r) => [r.cur.kind === "nd" ? r.cur.nd.reason : null, r.cur.months.length])).toEqual(Array(3).fill(["seuil de confidentialité non défini (Paramètres)", 0]));
  });

  it("seuil non défini : chaque ligne n.d. avec la raison et le lien vers Paramètres › Confidentialité ; le total reste affiché", () => {
    const why = { nd: "seuil de confidentialité non défini (Paramètres)" };
    const m = modelOf({ contract: "b1", person: "p1" }, null);
    expect(cellsOf(m)).toEqual([
      ["C", why, why, why],
      ["A", why, why, why],
      ["B", why, why, why],
    ]);
    expect(table(m, "services").foot!.cells[1]).toBe(410000);
    expect(m.blocks.find((b) => b.id === "tableau")!.nd).toEqual([{ reason: "seuil de confidentialité non défini (Paramètres)", action: { href: CONF_HREF, label: "Paramètres" } }]);
    expect(m.limits.some((l) => l.startsWith("Confidentialité"))).toBe(false);
  });
});

describe("loadServicesInput : personnes de chaque service lues par le lien du contexte", () => {
  // Journal fictif, janvier 2026 : A = c1 (1 000 €), B = c2 (500 €), C = c4 (800 €) + c5 (700 €). Janvier 2025 : une contrepartie
  // (421, ignorée) seulement : fenêtres N-1 connues, à 0 €, aucune personne.
  const J3: JournalInput = {
    lines: [ln("q1", "2026-01", "641100", 100000, "c1", "A"), ln("q2", "2026-01", "641100", 50000, "c2", "B"), ln("q3", "2026-01", "641100", 80000, "c4", "C"), ln("q4", "2026-01", "641100", 70000, "c5", "C"), ln("q5", "2025-01", "421000", null, null, undefined, 100)],
    months: ["2025-01", "2026-01"],
    openMonths: [],
    grid: DEFAULT_PREFIXES,
    serviceAxis: "Service",
  };
  const at = async (link: PersonLink) => buildServices(await loadServicesInput(fakeCtx({ settings: seuilSettings(2), pay: { ...PAY, input: J3 }, link })));
  const by = (m: ServicesModel) => Object.fromEntries(table(m, "services").rows.map((r) => [r.cells[0], r.cells[1]]));
  it("c1 et c2 portés par la même personne : A, B et C masqués ; c2 porté par une autre personne : C affiché (1 500 €)", async () => {
    const same = await at(linkOf({ c1: "p1", c2: "p1", c4: "p4", c5: "p5" }));
    expect(by(same)).toEqual({ A: { nd: confidentialiteReason(2) }, B: { nd: confidentialiteReason(2) }, C: { nd: confidentialiteReason(2) } });
    const other = await at(linkOf({ c1: "p1", c2: "p2", c4: "p4", c5: "p5" }));
    expect(by(other)).toEqual({ A: { nd: confidentialiteReason(2) }, B: { nd: confidentialiteReason(2) }, C: 150000 });
  });
  it("c2 non relié : B non dénombré, A masqué, C masqué en second (une seule personne masquée)", async () => {
    const m = await at(linkOf({ c1: "p1", c4: "p4", c5: "p5" }));
    expect(by(m)).toEqual({ A: { nd: confidentialiteReason(2) }, B: { nd: SEUIL_NON_VERIFIABLE }, C: { nd: confidentialiteReason(2) } });
  });
});

describe("buildFixeVariable : primes par famille et brut par libellé suivent le seuil (maskLabels, statut canonique du mois, personnes distinctes, masquage secondaire)", () => {
  // Cas de référence de la relecture. Journal fictif d'un seul mois (janvier 2026 ; janvier 2025 sans aucune ligne : 0 €, personne),
  // libellés du brut et personnes reliées aux contrats qui les portent :
  //   Salaire de base        6 000,00 €   six contrats s1…s6 → p1…p6 (1 000 € chacun) ;
  //   Prime A                  300,00 €   a1 → p1, a2 → p2 (150 € chacun) ;
  //   Prime B                  100,02 €   b1 → p3, b2 → p4, b3 → p5 (33,34 € chacun) ;
  //   Prime C                  500,00 €   c1…c5 → p1…p5 (100 € chacun) ;
  //   Gratification de stage    80,00 €   g1 → p7.
  // Janvier 2025 : les six salaires seulement (6 000 €, p1…p6) ; les autres libellés sont à 0 € en N-1 (aucun contrat, personne).
  // Seuil 3. Une colonne par rubrique et par mois, total de la rubrique du mois publié (Fixe, dont primes, Gratifications de stage).
  // Janvier 2026, Primes (900,02 €) : Prime A {p1, p2} masquée (2 < 3) ; seule, elle se lirait par différence → la plus petite valeur
  // affichée qui ajoute des personnes, Prime B (100,02 €, p3-p5), est masquée aussi : {p1..p5} = 5 ≥ 3 ; Prime C affichée.
  // Gratifications de stage (80 €) : la gratification {p7} masquée, seule de sa colonne. Salaires : {p1..p6} affiché. Janvier 2025 :
  // salaires affichés, les autres libellés à 0 € (hors de la colonne, affichés). N et N-1 se déduisent de leur seul mois : A, B et la
  // gratification n.d. en N, affichés à 0 € en N-1 (même cellule que N d'une période janvier 2025) ; leur écart est n.d.
  const lb = (key: string, accountId: string, name: string, cents: number, contractId: string): LedgerLine => ({ ...ln(key, "2026-01", accountId, cents, contractId), accountName: name });
  const J4: JournalInput = {
    lines: [
      ...[1, 2, 3, 4, 5, 6].map((i) => lb(`s${i}`, "641100", "Salaire de base", 100000, `s${i}`)),
      ...[1, 2, 3, 4, 5, 6].map((i) => ({ ...lb(`t${i}`, "641100", "Salaire de base", 100000, `s${i}`), month: "2025-01" })),
      lb("a1", "641300", "Prime A", 15000, "a1"),
      lb("a2", "641300", "Prime A", 15000, "a2"),
      lb("b1", "641300", "Prime B", 3334, "b1"),
      lb("b2", "641300", "Prime B", 3334, "b2"),
      lb("b3", "641300", "Prime B", 3334, "b3"),
      ...[1, 2, 3, 4, 5].map((i) => lb(`c${i}`, "641300", "Prime C", 10000, `c${i}`)),
      lb("g1", "641370", "Gratification de stage", 8000, "g1"),
    ],
    months: ["2025-01", "2026-01"],
    openMonths: [],
    grid: DEFAULT_PREFIXES,
    serviceAxis: "Service",
  };
  const LINK4 = linkOf({ s1: "p1", s2: "p2", s3: "p3", s4: "p4", s5: "p5", s6: "p6", a1: "p1", a2: "p2", b1: "p3", b2: "p4", b3: "p5", c1: "p1", c2: "p2", c3: "p3", c4: "p4", c5: "p5", g1: "p7" });
  const conf = (seuil: number): ConfidentialiteSetting => ({ kind: "set", value: seuil, updatedAt: null, updatedBy: null });
  const dataOf = (seuil: number): FixeVariableData => {
    const months = ["2026-01"];
    const prevMonths = ["2025-01"];
    const cur = windowPayroll(J4, months);
    const prev = windowPayroll(J4, prevMonths);
    const labels = { months, prevMonths, prev, labelsN: labelTotals(J4, months), labelsN1: labelTotals(J4, prevMonths), labelsByMonth: { "2026-01": labelTotals(J4, months) } };
    return { ...DATA, ...labels, cur, labels: { period: "janvier 2026", prev: "janvier 2025" }, confidentialite: { kind: "set", value: seuil }, mask: labelMaskOf(J4, labels, LINK4, conf(seuil)) };
  };
  const m = buildFixeVariable({ nd: null, data: dataOf(3) });
  const R3 = { nd: confidentialiteReason(3) };

  it("brut par libellé : Prime A (2 personnes) et la gratification (1) masquées ; Prime B masquée en second dans la colonne des primes de janvier ; N-1 garde son propre statut ; le brut reste affiché", () => {
    const t = table(m, FV.libelles);
    expect(t.rows.map((r) => [r.cells[0], r.cells[1], r.cells[2], r.cells[3], r.cells[4]])).toEqual([
      ["Salaire de base", 600000, 600000, 0, { exact: 0 }],
      ["Prime A", R3, 0, R3, R3],
      ["Prime B", R3, 0, R3, R3],
      ["Prime C", 50000, 0, 50000, { nd: N1_NUL }],
      ["Gratification de stage", R3, 0, R3, R3],
    ]);
    expect(t.foot!.cells.slice(0, 5)).toEqual(["Brut", 698002, 600000, 98002, { exact: 98002 / 600000 }]);
    expect(t.terms).toContain("croisee-confidentialite");
  });

  it("primes par famille et par mois : janvier A et B n.d., C 500 € ; « Total primes » 900,02 € publié ; même période ; mêmes points au graphique", () => {
    const t = table(m, FV.primesFamilles);
    expect(t.columns.map((c) => c.header)).toEqual(["Mois", "Total primes", "Prime A", "Prime B", "Prime C"]);
    expect(t.rows.map((r) => r.cells.slice(1))).toEqual([[90002, R3, R3, 50000]]);
    expect(t.foot!.cells).toEqual(["Période", 90002, R3, R3, 50000]);
    const c = chart(m, FV.primesFamilles);
    expect(c.series.map((s) => s.values)).toEqual([[null], [null], [50000]]);
    expect(c.series.map((s) => s.reasons)).toEqual([[confidentialiteReason(3)], [confidentialiteReason(3)], [null]]);
    // Les cartes et les composantes (totaux de l'entreprise) ne sont pas masquées.
    expect(sp(tile(m, "primes").value.text)).toBe("900,02 €");
    expect(m.blocks.find((b) => b.id === "primes")!.nd).toEqual([]);
  });

  it("mask = la passe de maskLabels (clés de libellé, raison de N et de N-1 ; familles par mois)", () => {
    const k = (label: string) => `primes\u0000${label}`;
    expect(dataOf(3).mask).toEqual({
      labels: {
        "salaires\u0000salaire de base": { cur: null, prev: null },
        [k("prime a")]: { cur: confidentialiteReason(3), prev: null },
        [k("prime b")]: { cur: confidentialiteReason(3), prev: null },
        [k("prime c")]: { cur: null, prev: null },
        "stages\u0000gratification de stage": { cur: confidentialiteReason(3), prev: null },
      },
      families: { [k("prime a")]: [confidentialiteReason(3)], [k("prime b")]: [confidentialiteReason(3)], [k("prime c")]: [null] },
    });
  });

  it("seuil 2 : seule la gratification (1 personne) est masquée ; les primes (A : 2 personnes, B : 3, C : 5) restent affichées dans leur propre colonne", () => {
    // Colonne des primes de janvier (900,02 € publié) : A {p1, p2}, B {p3, p4, p5} et C {p1..p5} comptent chacune au moins 2 personnes,
    // rien n'est masqué. Colonne des gratifications de stage (80 € publié) : la gratification {p7} (1 < 2) est masquée, seule de sa
    // colonne ; masquer une prime ne la protégerait pas, son montant étant le total des gratifications de janvier, publié comme total
    // de l'entreprise (tableau « Brut par nature et par mois »).
    const two = buildFixeVariable({ nd: null, data: dataOf(2) });
    const R2 = { nd: confidentialiteReason(2) };
    expect(table(two, FV.libelles).rows.map((r) => [r.cells[0], r.cells[1]])).toEqual([
      ["Salaire de base", 600000],
      ["Prime A", 30000],
      ["Prime B", 10002],
      ["Prime C", 50000],
      ["Gratification de stage", R2],
    ]);
    expect(table(two, FV.primesFamilles).rows.map((r) => r.cells.slice(1))).toEqual([[90002, 30000, 10002, 50000]]);
    expect(table(two, FV.primesFamilles).foot!.cells).toEqual(["Période", 90002, 30000, 10002, 50000]);
  });

  it("seuil 1 : rien n'est masqué (cas de base) ; seuil non défini : les deux tableaux n.d. avec la raison et le lien, totaux affichés", () => {
    const base = fv();
    expect(table(base, FV.libelles).rows.every((r) => typeof r.cells[1] === "number")).toBe(true);
    expect(buildFixeVariable({ nd: null, data: dataOf(1) }).tables.flatMap((t) => t.rows.flatMap((r) => r.cells)).some((c) => typeof c === "object" && c !== null && "nd" in c && c.nd === confidentialiteReason(1))).toBe(false);
    const why = "seuil de confidentialité non défini (Paramètres)";
    const no = fv({ confidentialite: { kind: "nd", reason: why }, mask: NO_MASK });
    expect(table(no, FV.libelles).rows).toEqual([{ cells: ["Brut par libellé de paie", { nd: why }] }]);
    expect(table(no, FV.primesFamilles).rows).toEqual([{ cells: ["Primes par famille et par mois", { nd: why }] }]);
    expect(no.charts.some((c) => c.id === FV.primesFamilles)).toBe(false);
    expect(no.blocks.find((b) => b.id === "primes")!.nd).toEqual([{ label: "Primes par famille et par mois", reason: why, action: { href: CONF_HREF, label: "Paramètres" } }]);
    expect(no.blocks.find((b) => b.id === "primes")!.tables).toEqual([FV.primesMois]);
    expect(no.blocks.find((b) => b.id === "libelles")!.tables).toEqual([]);
    expect(sp(tile(no, "fixe").value.text)).toBe("8 000,00 €");
    expect(table(no, FV.primesMois).foot!.cells).toEqual(["Période", 100000, 50000, 50000]);
  });
});

describe("chapitre 04 sur plusieurs périodes : une prime d'un mois garde son statut, comme dans l'onglet Fixe & variable", () => {
  // Cas v1 de la relecture rv13, seuil 3. Salaire de base k1..k10 (p1..p10), 3 000 € en janvier et février 2026. Prime P : k1,
  // janvier 500 €. Prime Q : k2..k4, janvier 3 × 100 €, février 3 × 1 000 €. Prime R : k5..k7, janvier 3 × 200 €.
  // Calcul à la main : primes de janvier (1 400 € publié) → P {p1} masqué, Q {p2..p4} 300 € masqué en second ({p1..p4} = 4 ≥ 3), R
  // 600 € affiché ; primes de février (3 000 €) → Q seul, 3 personnes, affiché. Périodes déduites de leurs mois.
  const lv = (key: string, month: string, name: string, cents: number, contractId: string): LedgerLine => ({ ...ln(key, month, name === "Salaire de base" ? "641100" : "641300", cents, contractId), accountName: name });
  const lines: LedgerLine[] = [];
  for (const m of ["2026-01", "2026-02"]) for (let i = 1; i <= 10; i++) lines.push(lv(`s${m}${i}`, m, "Salaire de base", 300000, `k${i}`));
  lines.push(lv("p1", "2026-01", "Prime P", 50000, "k1"));
  for (const i of [2, 3, 4]) lines.push(lv(`qj${i}`, "2026-01", "Prime Q", 10000, `k${i}`), lv(`qf${i}`, "2026-02", "Prime Q", 100000, `k${i}`));
  for (const i of [5, 6, 7]) lines.push(lv(`r${i}`, "2026-01", "Prime R", 20000, `k${i}`));
  const J: JournalInput = { lines, months: ["2026-01", "2026-02"], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "Service" };
  const LINKV = linkOf(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i + 1}`, `p${i + 1}`])));
  const CONF3: ConfidentialiteSetting = { kind: "set", value: 3, updatedAt: null, updatedBy: null };
  const R3 = { nd: confidentialiteReason(3) };
  const modelOf = (months: string[]) => {
    const prevMonths = months.map((m) => m.replace("2026", "2025"));
    const cur = windowPayroll(J, months);
    const prev = windowPayroll(J, prevMonths);
    const labelsByMonth = Object.fromEntries(months.map((m) => [m, labelTotals(J, [m])]));
    const labels = { months, prevMonths, prev, labelsN: labelTotals(J, months), labelsN1: null, labelsByMonth };
    const mask = labelMaskOf(J, labels, LINKV, CONF3);
    // L'onglet Fixe & variable appelle la même fonction avec ses propres listes : mêmes raisons.
    const n = labelTotals(J, months);
    const tab = maskLabels({ input: J, months, prevMonths, keys: n.map((t) => t.key), families: n.filter((t) => t.rubric === "primes").map((t) => t.key), link: LINKV, conf: CONF3, prevNd: true });
    expect(tab).toEqual(mask);
    return buildFixeVariable({ nd: null, data: { ...DATA, ...labels, cur, labels: { period: "période", prev: "N-1" }, confidentialite: { kind: "set", value: 3 }, mask } });
  };
  it("janvier, janvier → février, février : Q de janvier n.d. partout, Q de février 3 000 € partout ; la période qui contient janvier est n.d.", () => {
    const fam = (months: string[]) => {
      const t = table(modelOf(months), FV.primesFamilles);
      return { head: t.columns.map((c) => c.header), rows: t.rows.map((r) => r.cells.slice(1)), foot: t.foot!.cells.slice(1) };
    };
    expect(fam(["2026-01"])).toEqual({ head: ["Mois", "Total primes", "Prime P", "Prime Q", "Prime R"], rows: [[140000, R3, R3, 60000]], foot: [140000, R3, R3, 60000] });
    expect(fam(["2026-01", "2026-02"])).toEqual({ head: ["Mois", "Total primes", "Prime P", "Prime Q", "Prime R"], rows: [[140000, R3, R3, 60000], [300000, 0, 300000, 0]], foot: [440000, R3, R3, 60000] });
    expect(fam(["2026-02"])).toEqual({ head: ["Mois", "Total primes", "Prime Q"], rows: [[300000, 300000]], foot: [300000, 300000] });
    // Tableau par libellé : la cellule N de Q (période janvier → février, 3 300 €) n'est pas publiée.
    const lib = table(modelOf(["2026-01", "2026-02"]), FV.libelles);
    expect(lib.rows.map((r) => [r.cells[0], r.cells[1]])).toEqual([["Salaire de base", 6000000], ["Prime P", R3], ["Prime Q", R3], ["Prime R", 60000]]);
  });
});

describe("glossaire atteignable : part des primes et contribution des services", () => {
  it("la carte et le tableau « Parts du brut » renvoient à la part des primes ; le bloc de contribution et le tableau des services, à la contribution", async () => {
    const m = fv();
    expect(tile(m, "part-primes").term).toBe("croisee-part-primes");
    expect(table(m, FV.parts).terms).toEqual(["croisee-rigidite", "croisee-part-primes"]);
    expect(m.terms).toContain("croisee-part-primes");
    const s = buildServices(await loadServicesInput(fakeCtx()));
    expect(s.blocks.find((b) => b.id === "contribution")!.term).toBe("croisee-contribution-services");
    expect(table(s, "services").terms).toContain("croisee-contribution-services");
    expect(CHAPTERS.find((c) => c.id === "services")!.terms).toContain("croisee-contribution-services");
    for (const id of ["croisee-part-primes", "croisee-contribution-services"]) expect(glossaryEntry(id), id).toBeTruthy();
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
      confidentialite: { kind: "set", value: 1 },
      links: { confidentialite: CONF_HREF },
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
    confidentialite: { kind: "set", value: 1 },
    links: { confidentialite: CONF_HREF },
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
