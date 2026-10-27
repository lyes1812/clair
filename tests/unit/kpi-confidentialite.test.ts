import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbsenceMotifsDetail, AbsenceTypeNotes, AbsenteeismWindowDetail, ConfidentialiteNote } from "@/app/e/[slug]/studio-rh/kpi/components";
import { effectifsShareOf, loadEffectifs } from "@/app/e/[slug]/studio-rh/kpi/effectifs-data";
import { effectifsGridSheet, effectifsShareSheet } from "@/app/e/[slug]/studio-rh/kpi/export/sheets";
import { confidentialiteReason, SEUIL_ILLISIBLE, SEUIL_NON_DEFINI, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting } from "@/lib/confidentialite";
import { KPI_DEFAULTS } from "@/lib/rh-kpi-settings";
import { ABSENCE_ALL_MOTIFS_LABEL, absenceByMotif, absenceTypePersons } from "@/lib/rh/kpi/absence-motifs";
import { monthWindow } from "@/lib/rh/kpi/period";
import type { AbsenceMotifs, KpiInput } from "@/lib/rh/kpi/types";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { gridMask, maskedCount, maskedGrid, maskMotifRows, motifMask, motifRows, repartitionMasked, seuilFilterText, seuilOf, seuilText, typeCountMask, type GridIn, type GridSizes, type MotifMaskLine } from "@/lib/viz/kpi";
import { absence, DSN_ABSENCES, kpiInput, readAbsences } from "./helpers/kpi";
import { dsnFixtureBuild, payfitEdgeBuild } from "./helpers/rh";

// Seuil de confidentialité de KPI RH (lot 12) : détail de l'absentéisme par motif, motifs de la lecture de la tuile, effectifs
// mensuels par axe et leur export Excel. Unité : personnes distinctes (clé de personne du référentiel) ; moteur partagé
// src/lib/confidentialite (jamais recodé). Données entièrement fictives, cas de référence calculés à la main dans les commentaires.

// --- Doubles : seuil de l'espace, contexte de paie (journal absent), catégories et scénarios, accès à l'espace -------------------
const mocks = vi.hoisted(() => ({
  conf: { value: { kind: "absent" } as unknown },
  kpiCtx: { value: null as unknown },
}));
vi.mock("@/lib/confidentialite", async (orig) => ({ ...(await orig<typeof import("@/lib/confidentialite")>()), getConfidentialite: async () => mocks.conf.value }));
vi.mock("@/lib/payroll/context", () => ({
  loadPayrollContext: async () => ({ input: null, etp: (months: string[]) => months.map((month) => ({ month, etp4: null, reason: "journal de paie absent (test)" })) }),
}));
vi.mock("@/lib/budget/categories", async (orig) => ({
  ...(await orig<typeof import("@/lib/budget/categories")>()),
  getCategoryNatures: async () => ({ natures: (await orig<typeof import("@/lib/budget/categories")>()).DEFAULT_CATEGORY_NATURES, origin: "default" }),
  getContractCategories: async () => ({}),
}));
vi.mock("@/lib/budget/store", async (orig) => ({ ...(await orig<typeof import("@/lib/budget/store")>()), getScenario: async () => null, listScenarios: async () => [], listBudgets: async () => [] }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async (slug: string) => ({ session: {}, workspace: { id: "w1", name: "Espace fictif", slug, role: "reader" } }) }));
vi.mock("@/lib/rh/kpi-context", () => ({ loadKpiContext: async () => mocks.kpiCtx.value }));
vi.mock("@/lib/connectors/sync", () => ({
  lastSync: async () => ({ status: "applied", startedAt: new Date("2026-01-15T09:00:00Z"), finishedAt: new Date("2026-01-15T09:12:00Z") }),
  activeSync: async () => ({ decidedAt: new Date("2026-01-15T09:30:00Z") }),
  SYNC_STATUS_LABELS: { applied: "Appliquée (active)" },
}));

const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const ABSENT: ConfidentialiteSetting = { kind: "absent" };
const INVALID: ConfidentialiteSetting = { kind: "invalid", raw: "5" };
const R2 = confidentialiteReason(2); // « non affiché (seuil de confidentialité : 2 personnes) »
const R3 = confidentialiteReason(3);
const render = (el: React.ReactElement) => {
  const html = renderToStaticMarkup(el);
  for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
  return html;
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const P = (...persons: string[]) => ({ persons, unlinked: 0 });

// --- Lecture du paramètre -----------------------------------------------------------------------------------------------------
describe("lecture du seuil par l'écran", () => {
  it("défini : seuil utilisable ; absent, illisible ou non transmis : raison du paramètre, jamais une valeur de repli", () => {
    expect(seuilOf(set(5))).toEqual({ seuil: 5, reason: null });
    expect(seuilOf(ABSENT)).toEqual({ seuil: null, reason: SEUIL_NON_DEFINI });
    expect(seuilOf(INVALID)).toEqual({ seuil: null, reason: SEUIL_ILLISIBLE });
    expect(seuilOf(undefined)).toEqual({ seuil: null, reason: SEUIL_NON_DEFINI });
  });
  it("textes de la ligne « Confidentialité » et de l'onglet Filtres (mêmes mots que la Masse salariale)", () => {
    expect(seuilText(set(5))).toBe("seuil de 5 personnes");
    expect(seuilText(set(1))).toBe("seuil de 1 personne");
    expect(seuilText(ABSENT)).toBe("seuil non défini");
    expect(seuilText(INVALID)).toBe("seuil illisible, à ré-enregistrer");
    expect(seuilFilterText(set(2))).toBe("seuil de 2 personnes distinctes");
    expect(seuilFilterText(undefined)).toBe("seuil non défini (Paramètres)");
    expect(seuilFilterText(INVALID)).toBe("seuil illisible : à ré-enregistrer (Paramètres)");
  });
});

// --- Moteur : personnes distinctes de chaque motif --------------------------------------------------------------------------------
// Trois contrats, avril 2026 ; C-3 n'a aucun collaborateur dans PayFit (contrat non relié).
//   a1  C-1  test_sickness    06/04 → 10/04      a2  C-1  test_paid_leave  08/04 → 14/04
//   a3  C-2  test_paid_leave  20/04 → 21/04      a5  C-3  test_paid_leave  02/04 → 03/04
//   a4  C-1  test_sickness    02/03 → 03/03 (hors fenêtre)
const edge = {
  collaborators: [{ id: "P-1" }, { id: "P-2" }],
  contracts: [
    { contractId: "C-1", collaboratorId: "P-1", startDate: "2025-01-01", endDate: null },
    { contractId: "C-2", collaboratorId: "P-2", startDate: "2025-01-01", endDate: null },
    { contractId: "C-3", collaboratorId: null, startDate: "2025-01-01", endDate: null },
  ],
};
const day = (id: string, contract: string, from: string, to: string, type: string) => absence(id, contract, from, "beginning-of-day", to, "end-of-day", { type });
const rows = [
  day("a1", "C-1", "2026-04-06", "2026-04-10", "test_sickness"),
  day("a2", "C-1", "2026-04-08", "2026-04-14", "test_paid_leave"),
  day("a3", "C-2", "2026-04-20", "2026-04-21", "test_paid_leave"),
  day("a4", "C-1", "2026-03-02", "2026-03-03", "test_sickness"),
  day("a5", "C-3", "2026-04-02", "2026-04-03", "test_paid_leave"),
];

describe("moteur : personnes distinctes par motif (avril 2026)", async () => {
  const data = await payfitEdgeBuild(edge);
  const input = kpiInput(data, readAbsences(rows), { absenceTypes: ["test_sickness"] });
  const key = (ext: string) => data.contracts.find((c) => c.externalId === ext)!.personKey!;
  it("test_sickness : une personne (C-1) ; test_paid_leave : deux personnes reliées (C-1, C-2) et un contrat non relié (C-3)", () => {
    const m = absenceByMotif(input, monthWindow("2026-04"));
    const sick = m.lines.find((l) => l.type === "test_sickness")!;
    const leave = m.lines.find((l) => l.type === "test_paid_leave")!;
    expect(sick).toMatchObject({ kind: "exact", half: 10, persons: [key("C-1")], unlinked: 0 });
    expect(leave.persons).toEqual([key("C-1"), key("C-2")].sort());
    expect(leave.unlinked).toBe(1);
    // Aucun nom : une clé de personne du référentiel, jamais une clé de contrat parmi les personnes.
    expect(leave.persons!.every((p) => data.persons.some((x) => x.personKey === p))).toBe(true);
  });
  it("mois non lu : la ligne est n.d. et ne porte aucune personne", () => {
    const m = absenceByMotif(kpiInput(data, readAbsences(rows, ["2026-03"]), { absenceTypes: ["test_sickness"] }), monthWindow("2026-04"));
    for (const l of m.lines) expect(l).toMatchObject({ kind: "nd" });
    expect(m.lines.every((l) => l.persons === undefined)).toBe(true);
  });
  it("motifs de toute la lecture (tuile) : contrats des absences reliés par le référentiel ; C-3 non relié", () => {
    const by = absenceTypePersons(input);
    expect(Object.keys(by)).toEqual(["test_paid_leave", "test_sickness"]);
    expect(by.test_sickness).toEqual({ persons: [key("C-1")], unlinked: 0 });
    expect(by.test_paid_leave).toEqual({ persons: [key("C-1"), key("C-2")].sort(), unlinked: 1 });
    expect(absenceTypePersons(kpiInput(data, DSN_ABSENCES))).toEqual({});
  });
});

// --- Masquage du tableau par motif (cas écrits à la main) -----------------------------------------------------------------------
const line = (chosen: boolean, half: number | null, who: { persons: string[]; unlinked: number } | null, kind: "exact" | "lower_bound" | "nd" = half === null ? "nd" : "exact"): MotifMaskLine =>
  kind === "nd" ? { chosen, kind: "nd", half: null } : { chosen, kind, half: half!, ...(who ?? {}) };
const PUB = { tile: true, all: true };

describe("tableau par motif : masquage principal, exception du motif retenu unique, masquage secondaire, taux tous motifs", () => {
  it("seuil 3 : un autre motif de 2 personnes est masqué ; le taux tous motifs étant publié, l'autre motif affiché le plus petit (4 personnes) l'est aussi ; le motif retenu unique n'est jamais masqué", () => {
    const m = motifMask([line(true, 10, P("p1", "p2", "p3")), line(false, 18, P("p1", "p2")), line(false, 30, P("p4", "p5", "p6", "p7"))], PUB, 3);
    expect(m.exempt).toBe(0);
    expect(m.lines).toEqual(["shown", "masked", "secondary"]);
    expect(m.all).toBe("shown");
  });
  it("seuil 3 : un seul autre motif, sous le seuil : rien ne peut le protéger, le taux tous motifs est masqué (secondaire)", () => {
    const m = motifMask([line(true, 10, P("p1", "p2", "p3")), line(false, 4, P("p1"))], PUB, 3);
    expect(m.lines).toEqual(["shown", "masked"]);
    expect(m.all).toBe("secondary");
  });
  it("seuil 3 : deux motifs retenus (la tuile est leur somme publiée) : celui d'une personne est masqué, l'autre le protège (secondaire) ; le taux tous motifs reste", () => {
    const m = motifMask([line(true, 10, P("p1", "p2", "p3")), line(true, 2, P("p4"))], PUB, 3);
    expect(m.exempt).toBeNull();
    expect(m.lines).toEqual(["secondary", "masked"]);
    expect(m.all).toBe("shown");
  });
  it("le motif retenu unique (égal à la tuile) n'est pas masqué même sous le seuil ; tuile et taux non publiés : masquage principal seul", () => {
    expect(motifMask([line(true, 2, P("p1")), line(false, 4, P("p2", "p3", "p4"))], PUB, 3).lines).toEqual(["shown", "shown"]);
    const m = motifMask([line(false, 2, P("p1")), line(false, 4, P("p2", "p3", "p4"))], { tile: false, all: false }, 3);
    expect(m.lines).toEqual(["masked", "shown"]);
    expect(m.all).toBe("nd");
  });
  it("contrat non relié : il ne protège jamais (non vérifiable sous le seuil, affiché dès que les personnes reliées suffisent) ; borne basse sans personne comptée : non vérifiable ; ligne vide : affichée ; ligne n.d. : n.d.", () => {
    const m = motifMask([line(true, 10, P("p1", "p2", "p3")), line(false, 4, { persons: ["p1"], unlinked: 1 }), line(false, 6, { persons: ["p4", "p5", "p6"], unlinked: 2 }), line(false, 0, P(), "lower_bound"), line(false, 0, P()), line(false, null, null)], { tile: true, all: false }, 3);
    expect(m.lines).toEqual(["shown", "unverifiable", "shown", "unverifiable", "shown", "nd"]);
  });
  it("une valeur sans aucune personne (lignes sans personnes transmises) est non vérifiable, jamais affichée", () => {
    expect(motifMask([line(true, 10, P("p1")), line(false, 8, null)], PUB, 1).lines).toEqual(["shown", "unverifiable"]);
  });
  it("lignes après masquage : motif et « retenu » conservés, les quatre nombres n.d. avec la raison du seuil ; paramètre absent : toutes les lignes n.d. avec sa raison", () => {
    const rows = motifRows([
      { type: "test_sickness", count: 2, inWindow: 1, chosen: true, kind: "exact", half: 10, ratio: { num: 10, den: 120 } },
      { type: "test_paid_leave", count: 3, inWindow: 2, chosen: false, kind: "exact", half: 4, ratio: { num: 4, den: 120 } },
    ]);
    const masked = maskMotifRows(rows, { lines: ["shown", "masked"], all: "secondary", exempt: 0 }, 3, null);
    expect(masked[0].masked).toBeNull();
    expect(masked[0].halfText.replace(/\s+/g, " ")).toBe("10 (5 j)");
    expect(masked[1]).toMatchObject({ type: "test_paid_leave", retained: false, masked: R3, kind: "nd", halfText: "n.d.", rateText: "n.d.", reason: R3 });
    const nd = maskMotifRows(rows, null, null, SEUIL_NON_DEFINI);
    expect(nd.map((r) => r.masked)).toEqual([SEUIL_NON_DEFINI, SEUIL_NON_DEFINI]);
  });
  it("nombre d'absences d'un motif de la lecture : masquage principal seul ; non relié sous le seuil : non vérifiable ; nombre non nul sans personne : non vérifiable", () => {
    const sizes = { a: P("p1", "p2"), b: P("p1"), c: { persons: ["p1"], unlinked: 1 }, d: P() };
    expect(typeCountMask(sizes, "a", 5, 2)).toBeNull();
    expect(typeCountMask(sizes, "b", 1, 2)).toBe(R2);
    expect(typeCountMask(sizes, "c", 2, 2)).toBe(SEUIL_NON_VERIFIABLE);
    expect(typeCountMask(sizes, "d", 3, 2)).toBe(SEUIL_NON_VERIFIABLE);
    expect(typeCountMask(sizes, "e", 0, 2)).toBeNull(); // aucune absence : rien à protéger
    expect(typeCountMask(sizes, "b", 1, 1)).toBeNull();
  });
});

// --- Écran : détail par motif, motifs de la lecture, ligne Confidentialité ------------------------------------------------------
describe("détail de l'absentéisme : tableau par motif sous le seuil", () => {
  const win = { from: "2026-04", to: "2026-04", label: "avril 2026", months: ["2026-04"] };
  // Maladie (retenue, 2 personnes) ; congés (non retenu, 1 personne : masqué) ; le taux tous motifs, seul à pouvoir révéler les congés
  // par différence avec la tuile, est masqué à son tour.
  const motifs: AbsenceMotifs = {
    window: win as never,
    label: ABSENCE_ALL_MOTIFS_LABEL,
    lines: [
      { type: "fr_maladie_ordinaire", count: 2, inWindow: 1, chosen: true, kind: "exact", half: 10, ratio: { num: 10, den: 120 }, qualifiers: [], persons: ["P1", "P2"], unlinked: 0 },
      { type: "test_paid_leave", count: 3, inWindow: 2, chosen: false, kind: "exact", half: 18, ratio: { num: 18, den: 120 }, qualifiers: [], persons: ["P1"], unlinked: 0 },
    ],
    all: { kind: "exact", ratio: { num: 22, den: 120 }, months: [], qualifiers: [] },
    emptyReason: null,
  };
  const rowOf = (html: string, type: string) => /<tr data-motif="TYPE"[\s\S]*?<\/tr>/.source.replace("TYPE", type);
  it("seuil 2 : la ligne des congés est n.d. (quatre nombres, motif et « retenu » conservés), la maladie reste ; le taux tous motifs est n.d. avec la même raison ; ligne Confidentialité", () => {
    const html = render(h(AbsenceMotifsDetail, { motifs, slug: "demo", confidentialite: set(2) }));
    const leave = new RegExp(rowOf(html, "test_paid_leave")).exec(html)![0];
    expect(leave).toContain('data-masque="oui"');
    expect(text(leave)).toBe(`test_paid_leave n.d. — ${R2} non n.d. — ${R2}`);
    expect(text(leave)).not.toMatch(/\b3\b|\b18\b|15,00/);
    const sick = new RegExp(rowOf(html, "fr_maladie_ordinaire")).exec(html)![0];
    expect(sick).not.toContain("data-masque");
    expect(text(sick)).toContain("2 1 oui 10 (5 j) 8,33 %");
    expect(text(/<p[^>]*data-testid="kpi-detail-motifs-all"[\s\S]*?<\/p>/.exec(html)![0])).toBe(`n.d. — ${R2}`);
    expect(html).not.toContain("18,33");
    const note = /<p[^>]*data-testid="kpi-detail-motifs-confidentialite"[\s\S]*?<\/p>/.exec(html)![0];
    expect(text(note)).toBe("Confidentialité : seuil de 2 personnes");
    expect(note).not.toContain("parametres#confidentialite");
  });
  it("seuil 1 : rien n'est masqué (deux lignes, taux tous motifs 18,33 %)", () => {
    const html = render(h(AbsenceMotifsDetail, { motifs, slug: "demo", confidentialite: set(1) }));
    expect(html).not.toContain("data-masque");
    expect(text(html)).toContain("18 (9 j) 15,00 %");
    expect(text(html)).toContain("22 demi-journées = 11 j ÷ 60 j = 18,33 %");
  });
  it("seuil absent ou non transmis : chaque ligne n.d. « non défini » avec le lien vers Paramètres › Confidentialité ; le taux tous motifs (entreprise entière) reste affiché", () => {
    for (const conf of [ABSENT, undefined]) {
      const html = render(h(AbsenceMotifsDetail, { motifs, slug: "demo", confidentialite: conf }));
      expect(html.match(/data-masque="oui"/g)).toHaveLength(2);
      expect(html.match(/href="\/e\/demo\/parametres#confidentialite"/g)!.length).toBeGreaterThanOrEqual(3);
      expect(text(html)).toContain(`n.d. — ${SEUIL_NON_DEFINI} ( Paramètres )`);
      expect(text(html)).toContain("22 demi-journées = 11 j ÷ 60 j = 18,33 %");
      expect(text(html)).toContain("Confidentialité : seuil non défini ( Paramètres )");
      expect(text(html)).not.toMatch(/(^|[^\d])8,33 %|15,00 %/);
    }
    const bad = render(h(AbsenceMotifsDetail, { motifs, slug: "demo", confidentialite: INVALID }));
    expect(text(bad)).toContain(`n.d. — ${SEUIL_ILLISIBLE}`);
  });
  it("le détail de la période transmet le seuil et l'état de la tuile au tableau par motif", () => {
    const v = { kind: "exact", ratio: { num: 10, den: 120 }, months: [], qualifiers: [] } as never;
    const theoretical = { kind: "exact", half: 120, months: [], contributions: [] } as never;
    const html = render(h(AbsenteeismWindowDetail, { v, theoretical, detailHref: () => "?", motifs, slug: "demo", confidentialite: set(2) }));
    expect(html.match(/data-masque="oui"/g)).toHaveLength(1);
    expect(text(html)).toContain("Confidentialité : seuil de 2 personnes");
    // Sans seuil transmis par la page : non défini (jamais une valeur de repli).
    const none = render(h(AbsenteeismWindowDetail, { v, theoretical, detailHref: () => "?", motifs, slug: "demo" }));
    expect(text(none)).toContain(SEUIL_NON_DEFINI);
  });
  it("motifs de la lecture (tuile) : un nombre sous le seuil est n.d. avec la raison, les autres restent ; ligne Confidentialité dans la tuile (HTML valide : aucun paragraphe dans un span)", () => {
    const sizes = { test_sickness: P("P1", "P2"), test_paid_leave: P("P1") };
    const html = render(h(AbsenceTypeNotes, { chosen: [{ type: "test_sickness", count: 3 }], other: [{ type: "test_paid_leave", count: 5 }], missing: [], slug: "demo", mask: { setting: set(2), sizes } }));
    const t = text(html);
    expect(t).toContain("Retenus : test_sickness (3)");
    expect(t).toContain("non retenus : test_paid_leave ( n.d. )");
    expect(html).toContain(`<abbr class="nd" title="${R2}">n.d.</abbr>`);
    expect(t).toContain("Confidentialité : seuil de 2 personnes");
    expect(html).not.toContain("<p");
    // Sans masque transmis : nombres n.d. « non défini », motifs conservés.
    const none = text(render(h(AbsenceTypeNotes, { chosen: [{ type: "test_sickness", count: 3 }], other: [], missing: [], slug: "demo" })));
    expect(none).toContain("test_sickness ( n.d. )");
    expect(none).toContain("Confidentialité : seuil non défini ( Paramètres )");
  });
  it("ligne Confidentialité : seuil, ou lien vers Paramètres ; « ? » vers l'entrée générale du glossaire dès qu'elle existe", () => {
    expect(text(render(h(ConfidentialiteNote, { slug: "demo", setting: set(5) })))).toBe("Confidentialité : seuil de 5 personnes");
    const html = render(h(ConfidentialiteNote, { slug: "demo", setting: INVALID }));
    expect(text(html)).toBe("Confidentialité : seuil illisible, à ré-enregistrer ( Paramètres )");
    expect(html).toContain('href="/e/demo/parametres#confidentialite"');
  });
});

// --- Effectifs mensuels : grille, répartition, export (cas écrits à la main) ---------------------------------------------------------
// Trois groupes, trois mois : A (3 personnes), B (1 personne en janvier, aucune en février), D (2 personnes) ; mars n.d.
//   janvier : A 3, B 1, D 2 (total 6)   février : A 3, B 0, D 2 (total 5)
const who: Record<string, Record<string, string[]>> = { "2026-01": { A: ["p1", "p2", "p3"], B: ["p4"], D: ["p5", "p6"] }, "2026-02": { A: ["p1", "p2", "p3"], B: [], D: ["p5", "p6"] } };
const values: Record<string, Record<string, number>> = { "2026-01": { A: 3, B: 1, D: 2 }, "2026-02": { A: 3, B: 0, D: 2 } };
const grid: GridIn = {
  months: ["2026-01", "2026-02", "2026-03"],
  groups: ["A", "B", "D"],
  cell: (g, m) => (m === "2026-03" ? { kind: "nd", reason: "mois non lu" } : { kind: "value", v: values[m][g] }),
  total: (m) => (m === "2026-03" ? { kind: "nd", reason: "mois non lu" } : { kind: "value", v: Object.values(values[m]).reduce((s, x) => s + x, 0) }),
};
const sizes: GridSizes = (g, m) => (m === "2026-03" ? null : { persons: who[m][g], unlinked: 0 });

describe("effectifs mensuels : masquage par colonne (total du mois publié)", () => {
  it("seuil 2 : en janvier B (1 personne) est masqué et D (2 personnes, plus petit que A) le protège ; février : B vide reste 0, rien n'est masqué ; mars n.d. : aucune colonne", () => {
    const mask = gridMask(grid, sizes, 2);
    expect(mask.get("2026-01")).toEqual(["shown", "masked", "secondary"]);
    expect(mask.get("2026-02")).toEqual(["shown", "shown", "shown"]);
    expect(mask.has("2026-03")).toBe(false);
    expect(maskedCount(mask)).toBe(2);
    const g = maskedGrid(grid, mask, 2, null);
    expect(g.cell("B", "2026-01")).toEqual({ kind: "nd", reason: R2 });
    expect(g.cell("D", "2026-01")).toEqual({ kind: "nd", reason: R2 });
    expect(g.cell("A", "2026-01")).toEqual({ kind: "value", v: 3 });
    expect(g.cell("B", "2026-02")).toEqual({ kind: "value", v: 0 });
    expect(g.cell("A", "2026-03")).toEqual({ kind: "nd", reason: "mois non lu" });
    expect(g.total("2026-01")).toEqual({ kind: "value", v: 6 }); // le total du mois n'est jamais masqué
  });
  it("seuil 4 : A (3 personnes) et D sont masqués, B aussi : les trois réunies font 6 personnes ≥ 4", () => {
    expect(gridMask(grid, sizes, 4).get("2026-01")).toEqual(["masked", "masked", "masked"]);
  });
  it("seuil 1 : rien n'est masqué ; groupe à valeur non nulle sans personne dénombrée : non vérifiable, même avec un seuil de 1", () => {
    expect(gridMask(grid, sizes, 1).get("2026-01")).toEqual(["shown", "shown", "shown"]);
    const m = gridMask(grid, (g, mo) => (g === "B" ? { persons: [], unlinked: 0 } : sizes(g, mo)), 1);
    expect(m.get("2026-01")![1]).toBe("unverifiable");
    expect(maskedGrid(grid, m, 1, null).cell("B", "2026-01")).toEqual({ kind: "nd", reason: SEUIL_NON_VERIFIABLE });
    // Effectif non dénombré pour tout le mois : chaque groupe est non vérifiable, même vide (rien ne permet de vérifier le seuil).
    expect(gridMask(grid, () => null, 1).get("2026-02")).toEqual(["unverifiable", "unverifiable", "unverifiable"]);
  });
  it("seuil absent : toute cellule de groupe d'un mois connu est n.d. avec la raison du paramètre, les totaux restent", () => {
    const g = maskedGrid(grid, null, null, SEUIL_NON_DEFINI);
    expect(g.cell("A", "2026-01")).toEqual({ kind: "nd", reason: SEUIL_NON_DEFINI });
    expect(g.cell("B", "2026-02")).toEqual({ kind: "nd", reason: SEUIL_NON_DEFINI });
    expect(g.cell("A", "2026-03")).toEqual({ kind: "nd", reason: "mois non lu" });
    expect(g.total("2026-02")).toEqual({ kind: "value", v: 5 });
  });
  it("répartition : un stock se lit au dernier mois connu (février : rien de masqué) ; un flux cumule janvier et février, B (1 personne) masqué et D (4) le protège ; total conservé", () => {
    const stock = repartitionMasked(grid, true, sizes, 2, null);
    expect(stock.used).toEqual(["2026-02"]);
    expect(stock.items).toEqual([{ group: "A", v: 3, reason: null }, { group: "B", v: 0, reason: null }, { group: "D", v: 2, reason: null }]);
    const flux = repartitionMasked(grid, false, sizes, 2, null);
    expect(flux.items).toEqual([{ group: "A", v: 6, reason: null }, { group: "B", v: null, reason: R2 }, { group: "D", v: null, reason: R2 }]);
    expect(flux.total).toBe(11);
    // Seuil absent : chaque groupe n.d., total conservé.
    const nd = repartitionMasked(grid, false, sizes, null, SEUIL_NON_DEFINI);
    expect(nd.items.map((it) => it.v)).toEqual([null, null, null]);
    expect(nd.items[0].reason).toBe(SEUIL_NON_DEFINI);
    expect(nd.total).toBe(11);
  });
  it("feuilles Excel : mêmes cellules n.d. que l'écran, raison en commentaire ; répartition masquée n.d. (valeur et part)", () => {
    const g = maskedGrid(grid, gridMask(grid, sizes, 2), 2, null);
    const sheet = effectifsGridSheet({ ...g, layers: new Map() }, "nombre");
    expect(sheet.rows[1]).toEqual(["B", { nd: R2 }, 0, { nd: "mois non lu" }, ""]);
    expect(sheet.rows[2]).toEqual(["D", { nd: R2 }, 2, { nd: "mois non lu" }, ""]);
    expect(sheet.rows[3]).toEqual(["Total", 6, 5, { nd: "mois non lu" }, ""]);
    const share = effectifsShareSheet(repartitionMasked(grid, false, sizes, 2, null), "nombre", "cumul");
    expect(share.rows[1]).toEqual(["B", { nd: R2 }, { nd: R2 }, ""]);
    expect(share.rows[0]).toEqual(["A", 6, { exact: 6 / 11 }, ""]);
    expect(share.rows[3]).toEqual(["Total", 11, { exact: 1 }, ""]);
  });
});

// --- Chargement de l'écran et export sur le référentiel fictif DSN (2025 : CDI et CDD) -----------------------------------------------
// Décembre 2025 : 7 contrats, 6 CDI (6 personnes) et 1 CDD (1 personne). Janvier 2026 : 6 CDI, plus aucun CDD.
const dsn = dsnFixtureBuild();
const input: KpiInput = { ...kpiInput(dsn, DSN_ABSENCES), openMonths: [] };
const kpiCtx = {
  collab: { workspace: { id: "w1", name: "Espace fictif", slug: "demo", role: "reader" }, establishments: [], natures: { codes: ["01", "02"], origin: "default" }, payfitHistory: null, state: null },
  settings: { values: KPI_DEFAULTS, origins: {}, invalid: [] },
  input,
  readTypes: [],
} as unknown as KpiContext;
const search = { mesure: "inscrit", axe: "categorie", version: "reel", annee: "2025" };

describe("effectifs mensuels par axe (référentiel fictif) : seuil de l'espace lu par loadEffectifs", () => {
  beforeEach(() => {
    mocks.kpiCtx.value = kpiCtx;
  });
  it("seuil 2 : décembre 2025, CDD (1 personne) n.d. et CDI (seule autre ligne) n.d. avec la même raison ; total 7 conservé ; janvier 2026 sans CDD : rien de masqué", async () => {
    mocks.conf.value = set(2);
    const e = await loadEffectifs("demo", "w1", input, search);
    expect(e.seuil).toBe(2);
    expect(e.grid.kind).toBe("value");
    if (e.grid.kind !== "value" || e.raw.kind !== "value") return;
    expect(e.grid.groups).toEqual(["CDD", "CDI"]);
    expect(e.raw.cell("CDD", "2025-12")).toEqual({ kind: "value", v: 1 });
    expect(e.grid.cell("CDD", "2025-12")).toEqual({ kind: "nd", reason: R2 });
    expect(e.grid.cell("CDI", "2025-12")).toEqual({ kind: "nd", reason: R2 });
    expect(e.grid.total("2025-12")).toEqual({ kind: "value", v: 7 });
    expect(e.masked).toBe(24); // douze mois de 2025 : CDD présent chaque mois, les deux lignes masquées
    expect(e.sizes("CDD", "2025-12")).toEqual({ persons: [dsn.contracts.find((c) => c.nature === "02")!.personKey], unlinked: 0 });
    expect(e.sizes("CDI", "2025-12")!.persons).toHaveLength(6);
    const y26 = await loadEffectifs("demo", "w1", input, { ...search, annee: "2026" });
    if (y26.grid.kind !== "value") throw new Error("grille 2026 attendue");
    expect(y26.grid.groups).toEqual(["CDI"]);
    expect(y26.grid.cell("CDI", "2026-01")).toEqual({ kind: "value", v: 6 });
    expect(y26.masked).toBe(0);
    // Répartition (stock : dernier mois connu de 2025, décembre) : les deux groupes n.d., total 7.
    const { repart } = effectifsShareOf(e);
    expect(repart!.items).toEqual([{ group: "CDD", v: null, reason: R2 }, { group: "CDI", v: null, reason: R2 }]);
    expect(repart!.total).toBe(7);
  });
  it("seuil 1 : rien n'est masqué (CDD 1, CDI 6) ; seuil absent : lignes n.d. « non défini », totaux conservés", async () => {
    mocks.conf.value = set(1);
    const one = await loadEffectifs("demo", "w1", input, search);
    if (one.grid.kind !== "value") throw new Error("grille attendue");
    expect([one.grid.cell("CDD", "2025-12"), one.grid.cell("CDI", "2025-12")]).toEqual([{ kind: "value", v: 1 }, { kind: "value", v: 6 }]);
    expect(one.masked).toBe(0);
    mocks.conf.value = ABSENT;
    const none = await loadEffectifs("demo", "w1", input, search);
    if (none.grid.kind !== "value") throw new Error("grille attendue");
    expect(none.seuil).toBeNull();
    expect(none.grid.cell("CDI", "2025-12")).toEqual({ kind: "nd", reason: SEUIL_NON_DEFINI });
    expect(none.grid.total("2025-12")).toEqual({ kind: "value", v: 7 });
    expect(effectifsShareOf(none).repart!.items.every((it) => it.v === null && it.reason === SEUIL_NON_DEFINI)).toBe(true);
  });
  it("export Excel : mêmes cellules n.d. que l'écran avec la raison en commentaire, total conservé ; onglet Filtres : ligne Confidentialité", async () => {
    mocks.conf.value = set(2);
    const { GET } = await import("@/app/e/[slug]/studio-rh/kpi/export/route");
    const res = await GET(new NextRequest("http://localhost/e/demo/studio-rh/kpi/export?vue=effectifs&mesure=inscrit&axe=categorie&annee=2025&format=xlsx"), { params: Promise.resolve({ slug: "demo" }) });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Répartition mensuelle")!;
    const noteOf = (c: ExcelJS.Cell): string | null => (c.note ? (typeof c.note === "string" ? c.note : (c.note.texts?.map((t) => t.text).join("") ?? "")) : null);
    // Ligne 6 : CDD ; ligne 7 : CDI ; ligne 8 : Total ; colonne 13 : décembre 2025.
    expect([ws.getCell(6, 1).value, ws.getCell(6, 13).value, ws.getCell(7, 13).value, ws.getCell(8, 1).value, ws.getCell(8, 13).value]).toEqual(["CDD", "n.d.", "n.d.", "Total", 7]);
    expect(noteOf(ws.getCell(6, 13))).toContain(R2);
    expect(noteOf(ws.getCell(7, 13))).toContain(R2);
    const share = wb.getWorksheet("Répartition")!;
    expect([share.getCell(6, 2).value, share.getCell(7, 2).value, share.getCell(8, 2).value]).toEqual(["n.d.", "n.d.", 7]);
    const filtres = wb.getWorksheet("Filtres")!;
    const filterOf = (label: string) => {
      for (let r = 1; r <= 20; r++) if (filtres.getCell(r, 1).value === label) return String(filtres.getCell(r, 2).value);
      return null;
    };
    expect(filterOf("Confidentialité")).toBe("seuil de 2 personnes distinctes ; 24 cellules non affichées");
    mocks.conf.value = ABSENT;
    const nd = await GET(new NextRequest("http://localhost/e/demo/studio-rh/kpi/export?vue=effectifs&mesure=inscrit&axe=categorie&annee=2025&format=xlsx"), { params: Promise.resolve({ slug: "demo" }) });
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(Buffer.from(await nd.arrayBuffer()) as unknown as ExcelJS.Buffer);
    expect(noteOf(wb2.getWorksheet("Répartition mensuelle")!.getCell(7, 13))).toContain(SEUIL_NON_DEFINI);
    expect(wb2.getWorksheet("Répartition mensuelle")!.getCell(8, 13).value).toBe(7);
  });
});
