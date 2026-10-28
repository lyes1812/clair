import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbsenceMotifsDetail, AbsenceTypeNotes, AbsenteeismWindowDetail, ConfidentialiteNote } from "@/app/e/[slug]/studio-rh/kpi/components";
import { effectifsShareOf, loadEffectifs } from "@/app/e/[slug]/studio-rh/kpi/effectifs-data";
import { effectifsGridSheet, effectifsShareSheet } from "@/app/e/[slug]/studio-rh/kpi/export/sheets";
import { confidentialiteReason, SEUIL_ILLISIBLE, SEUIL_NON_DEFINI, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting } from "@/lib/confidentialite";
import { KPI_DEFAULTS, KPI_KEYS } from "@/lib/rh-kpi-settings";
import { ABSENCE_ALL_MOTIFS_LABEL, absenceByMotif, absenceTypePersons } from "@/lib/rh/kpi/absence-motifs";
import { monthWindow } from "@/lib/rh/kpi/period";
import type { AbsenceMotifs, KpiInput } from "@/lib/rh/kpi/types";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { gridMask, maskedCount, maskedGrid, maskMotifRows, motifMask, motifRows, repartitionMasked, seuilFilterText, seuilOf, seuilText, typeCountMask, type GridIn, type GridSizes } from "@/lib/viz/kpi";
import type { CongeCell, MotifWindow, MotifWindowLine } from "@/lib/croisee/conges";
import { absence, DSN_ABSENCES, kpiInput, readAbsences } from "./helpers/kpi";
import { payfitHistoryLimit, rawPayfitHistory } from "@/lib/rh/raw-history";
import { dsnFixtureBuild, payfitEdgeBuild } from "./helpers/rh";

// Seuil de confidentialité de KPI RH (lot 12) : détail de l'absentéisme par motif, motifs de la lecture de la tuile, page câblée au
// seuil de l'espace, effectifs mensuels par axe (grille et répartition masquées en une seule passe) et leur export Excel, garde du
// périmètre à l'export du Suivi. Unité : personnes distinctes (clé de personne du référentiel) ; moteur partagé src/lib/confidentialite
// (jamais recodé). Données entièrement fictives, cas de référence calculés à la main dans les commentaires.

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
const R5 = confidentialiteReason(5);
const render = (el: React.ReactElement) => {
  const html = renderToStaticMarkup(el);
  for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
  return html;
};
// Texte lisible : le « ? » du glossaire (GlossaryLink) est retiré, comme dans croisee-titres.test.ts ; son lien est vérifié à part.
const text = (html: string) => html.replace(/<a class="gloss-link"[^>]*>\?<\/a>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const rowOf = (type: string) => new RegExp(/<tr data-motif="TYPE"[\s\S]*?<\/tr>/.source.replace("TYPE", type));
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
// Lot 12 (relecture) : motifMask lit la colonne de la fenêtre de motifWindowMask, la fonction partagée avec la croisée 03 ; ses cellules
// sont celles de la fenêtre (motifs × mois, et total). Ces cas portent sur la colonne de la fenêtre seule : fenêtre d'un mois dont
// l'absentéisme n'est pas publié (aucune relation de colonne de mois), chaque ligne portant la même cellule pour son mois et son total.
// Jeton de personne : le numéro de « pN ».
const tok = (p: string) => Number(p.replace(/\D/g, ""));
const line = (chosen: boolean, half: number | null, who: { persons: string[]; unlinked: number } | null, kind: "exact" | "lower_bound" | "nd" = half === null ? "nd" : "exact"): MotifWindowLine => {
  const c: CongeCell = kind === "nd" ? { kind: "nd", reason: "n.d. (test)" } : { kind, half: half!, persons: who?.persons.length ?? 0, unlinked: who?.unlinked ?? 0, who: (who?.persons ?? []).map(tok) };
  return { chosen, months: [c], total: c };
};
const win1 = (lines: MotifWindowLine[], published: { tile: boolean; all: boolean }): MotifWindow => ({ lines, published: { months: [false], ...published } });
const PUB = { tile: true, all: true };

describe("tableau par motif : masquage principal, exception du motif retenu unique, masquage secondaire, taux tous motifs", () => {
  it("seuil 3 : un autre motif de 2 personnes est masqué ; le taux tous motifs étant publié, l'autre motif affiché le plus petit (4 personnes) l'est aussi ; le motif retenu unique n'est jamais masqué", () => {
    const m = motifMask(win1([line(true, 10, P("p1", "p2", "p3")), line(false, 18, P("p1", "p2")), line(false, 30, P("p4", "p5", "p6", "p7"))], PUB), 3);
    expect(m.exempt).toBe(0);
    expect(m.lines).toEqual(["shown", "masked", "secondary"]);
    expect(m.all).toBe("shown");
  });
  it("seuil 3 : un seul autre motif, sous le seuil : rien ne peut le protéger, le taux tous motifs est masqué (secondaire)", () => {
    const m = motifMask(win1([line(true, 10, P("p1", "p2", "p3")), line(false, 4, P("p1"))], PUB), 3);
    expect(m.lines).toEqual(["shown", "masked"]);
    expect(m.all).toBe("secondary");
  });
  it("seuil 3 : deux motifs retenus (la tuile est leur somme publiée) : celui d'une personne est masqué, l'autre le protège (secondaire) ; le taux tous motifs reste", () => {
    const m = motifMask(win1([line(true, 10, P("p1", "p2", "p3")), line(true, 2, P("p4"))], PUB), 3);
    expect(m.exempt).toBeNull();
    expect(m.lines).toEqual(["secondary", "masked"]);
    expect(m.all).toBe("shown");
  });
  it("le motif retenu unique (égal à la tuile) n'est pas masqué même sous le seuil ; tuile et taux non publiés : masquage principal seul", () => {
    expect(motifMask(win1([line(true, 2, P("p1")), line(false, 4, P("p2", "p3", "p4"))], PUB), 3).lines).toEqual(["shown", "shown"]);
    const m = motifMask(win1([line(false, 2, P("p1")), line(false, 4, P("p2", "p3", "p4"))], { tile: false, all: false }), 3);
    expect(m.lines).toEqual(["masked", "shown"]);
    expect(m.all).toBe("nd");
  });
  it("contrat non relié : il ne protège jamais (non vérifiable sous le seuil, affiché dès que les personnes reliées suffisent) ; borne basse sans personne comptée : non vérifiable ; ligne vide : affichée ; ligne n.d. : n.d.", () => {
    const m = motifMask(win1([line(true, 10, P("p1", "p2", "p3")), line(false, 4, { persons: ["p1"], unlinked: 1 }), line(false, 6, { persons: ["p4", "p5", "p6"], unlinked: 2 }), line(false, 0, P(), "lower_bound"), line(false, 0, P()), line(false, null, null)], { tile: true, all: false }), 3);
    expect(m.lines).toEqual(["shown", "unverifiable", "shown", "unverifiable", "shown", "nd"]);
  });
  it("une valeur sans aucune personne (lignes sans personnes transmises) est non vérifiable, jamais affichée", () => {
    expect(motifMask(win1([line(true, 10, P("p1")), line(false, 8, null)], PUB), 1).lines).toEqual(["shown", "unverifiable"]);
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
// Cellules de la fenêtre (motifWindow) d'un détail écrit à la main : fenêtre d'un mois, chaque ligne du moteur donne la cellule de son
// mois et de son total (personnes : jetons communs à toutes les lignes) ; absentéisme du mois et tuile publiés, taux tous motifs publié
// quand il n'est pas n.d. Lot 12 (relecture) : le détail reçoit ces cellules de la page, comme la croisée 03.
const cellsOf = (m: AbsenceMotifs): MotifWindow => {
  const ids = [...new Set(m.lines.flatMap((l) => l.persons ?? []))].sort();
  return {
    lines: m.lines.map((l) => {
      const c: CongeCell = l.kind === "nd" ? { kind: "nd", reason: l.nd.reason } : { kind: l.kind, half: l.half, persons: l.persons?.length ?? 0, unlinked: l.unlinked ?? 0, who: (l.persons ?? []).map((p) => ids.indexOf(p)) };
      return { chosen: l.chosen, months: [c], total: c };
    }),
    published: { months: [true], tile: true, all: m.all.kind !== "nd" },
  };
};
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
  it("seuil 2 : la ligne des congés est n.d. (quatre nombres, motif et « retenu » conservés), la maladie reste ; le taux tous motifs est n.d. avec la même raison ; ligne Confidentialité", () => {
    const html = render(h(AbsenceMotifsDetail, { motifs, cells: cellsOf(motifs), slug: "demo", confidentialite: set(2) }));
    const leave = rowOf("test_paid_leave").exec(html)![0];
    expect(leave).toContain('data-masque="oui"');
    expect(text(leave)).toBe(`test_paid_leave n.d. — ${R2} non n.d. — ${R2}`);
    expect(text(leave)).not.toMatch(/\b3\b|\b18\b|15,00/);
    const sick = rowOf("fr_maladie_ordinaire").exec(html)![0];
    expect(sick).not.toContain("data-masque");
    expect(text(sick)).toContain("2 1 oui 10 (5 j) 8,33 %");
    expect(text(/<p[^>]*data-testid="kpi-detail-motifs-all"[\s\S]*?<\/p>/.exec(html)![0])).toBe(`n.d. — ${R2}`);
    expect(html).not.toContain("18,33");
    const note = /<p[^>]*data-testid="kpi-detail-motifs-confidentialite"[\s\S]*?<\/p>/.exec(html)![0];
    expect(text(note)).toBe("Confidentialité : seuil de 2 personnes");
    expect(note).not.toContain("parametres#confidentialite");
  });
  it("seuil 1 : rien n'est masqué (deux lignes, taux tous motifs 18,33 %)", () => {
    const html = render(h(AbsenceMotifsDetail, { motifs, cells: cellsOf(motifs), slug: "demo", confidentialite: set(1) }));
    expect(html).not.toContain("data-masque");
    expect(text(html)).toContain("18 (9 j) 15,00 %");
    expect(text(html)).toContain("22 demi-journées = 11 j ÷ 60 j = 18,33 %");
  });
  it("seuil absent ou non transmis : chaque ligne n.d. « non défini » avec le lien vers Paramètres › Confidentialité ; le taux tous motifs (entreprise entière) reste affiché", () => {
    for (const conf of [ABSENT, undefined]) {
      const html = render(h(AbsenceMotifsDetail, { motifs, cells: cellsOf(motifs), slug: "demo", confidentialite: conf }));
      expect(html.match(/data-masque="oui"/g)).toHaveLength(2);
      expect(html.match(/href="\/e\/demo\/parametres#confidentialite"/g)!.length).toBeGreaterThanOrEqual(3);
      expect(text(html)).toContain(`n.d. — ${SEUIL_NON_DEFINI} ( Paramètres )`);
      expect(text(html)).toContain("22 demi-journées = 11 j ÷ 60 j = 18,33 %");
      expect(text(html)).toContain("Confidentialité : seuil non défini ( Paramètres )");
      expect(text(html)).not.toMatch(/(^|[^\d])8,33 %|15,00 %/);
    }
    const bad = render(h(AbsenceMotifsDetail, { motifs, cells: cellsOf(motifs), slug: "demo", confidentialite: INVALID }));
    expect(text(bad)).toContain(`n.d. — ${SEUIL_ILLISIBLE}`);
  });
  it("le détail de la période transmet le seuil et l'état de la tuile au tableau par motif", () => {
    const v = { kind: "exact", ratio: { num: 10, den: 120 }, months: [], qualifiers: [] } as never;
    const theoretical = { kind: "exact", half: 120, months: [], contributions: [] } as never;
    const html = render(h(AbsenteeismWindowDetail, { v, theoretical, detailHref: () => "?", motifs, cells: cellsOf(motifs), slug: "demo", confidentialite: set(2) }));
    expect(html.match(/data-masque="oui"/g)).toHaveLength(1);
    expect(text(html)).toContain("Confidentialité : seuil de 2 personnes");
    // Sans seuil transmis par la page : non défini (jamais une valeur de repli).
    const none = render(h(AbsenteeismWindowDetail, { v, theoretical, detailHref: () => "?", motifs, cells: cellsOf(motifs), slug: "demo" }));
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
  it("ligne Confidentialité : seuil, ou lien vers Paramètres ; « ? » vers l'entrée générale du glossaire (elle existe : lien rendu)", () => {
    const five = render(h(ConfidentialiteNote, { slug: "demo", setting: set(5) }));
    expect(text(five)).toBe("Confidentialité : seuil de 5 personnes");
    expect(five).toContain('class="gloss-link" href="/e/demo/glossaire#def-confidentialite"');
    expect(five).toMatch(/<a class="gloss-link"[^>]*>\?<\/a>/);
    const html = render(h(ConfidentialiteNote, { slug: "demo", setting: INVALID }));
    expect(text(html)).toBe("Confidentialité : seuil illisible, à ré-enregistrer ( Paramètres )");
    expect(html).toContain('href="/e/demo/parametres#confidentialite"');
  });
});

// --- Page KPI RH : le seuil de l'espace est lu par la page (getConfidentialite) et transmis aux deux répartitions par motif ------------
// Référentiel fictif « edge » (deux personnes reliées, C-3 sans collaborateur), absences d'avril 2026, motif retenu test_sickness.
// Seuil 5 (double de getConfidentialite) : motifs de la lecture → test_sickness (C-1, une personne) n.d. « non affiché (seuil de
// confidentialité : 5 personnes) », test_paid_leave (deux personnes reliées + C-3 non relié) non vérifiable ; détail par motif → la ligne
// de test_sickness reste (seul motif retenu présent : elle égale la tuile), test_paid_leave n.d. non vérifiable, et le taux tous motifs,
// seul à pouvoir la révéler par différence, n.d. avec la raison du seuil. Nulle part « non défini » : le seuil est bien lu.
// Historique PayFit en mode brut (défaut des espaces) : les mois de plus de douze mois ne sont pas en borne basse, la fenêtre de douze
// mois glissants (octobre 2025 → septembre 2026) est calculable.
const pageCtx = (input: KpiInput, limit: ReturnType<typeof payfitHistoryLimit>): KpiContext =>
  ({
    collab: {
      slug: "demo", workspace: { id: "w1", name: "Espace fictif", slug: "demo", role: "reader" },
      source: { domain: "rh", chosen: "payfit", appliedAt: null, reason: "raison fictive", mode: "auto", modeSetAt: null },
      state: null, switchedAt: null, data: null, establishments: [], natures: { codes: ["01", "02"], origin: "default" }, payfitHistory: { mode: "raw", origin: "default", limit },
    },
    settings: { values: KPI_DEFAULTS, origins: Object.fromEntries(Object.keys(KPI_KEYS).map((k) => [k, { origin: "default" }])), invalid: [] },
    input,
    readTypes: [],
  }) as unknown as KpiContext;

describe("page KPI RH : seuil de l'espace lu par la page (double à 5) et transmis aux motifs de la lecture et au détail par motif", async () => {
  const built = await payfitEdgeBuild(edge);
  const input = kpiInput(rawPayfitHistory(built), readAbsences(rows), { absenceTypes: ["test_sickness"] });
  const page = async (sp: Record<string, string>) => {
    const { default: Page } = await import("@/app/e/[slug]/studio-rh/kpi/page");
    return render(await Page({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve(sp) }));
  };
  beforeEach(() => {
    mocks.kpiCtx.value = pageCtx(input, payfitHistoryLimit(built));
    mocks.conf.value = set(5);
  });
  it("motifs de la lecture : nombres n.d. avec la raison du seuil (1 personne) ou non vérifiable (contrat non relié) ; ligne Confidentialité à 5 ; jamais « non défini »", async () => {
    const html = await page({});
    expect(html).not.toContain(SEUIL_NON_DEFINI);
    expect(html).not.toContain("parametres#confidentialite");
    const types = /<span[^>]*data-testid="kpi-absence-types"[\s\S]*?<\/details>/.exec(html)![0];
    expect(text(types)).toContain("Retenus : test_sickness ( n.d. )");
    expect(text(types)).toContain("non retenus : test_paid_leave ( n.d. )");
    expect(types).toContain(`<abbr class="nd" title="${R5}">n.d.</abbr>`);
    expect(types).toContain(`<abbr class="nd" title="${SEUIL_NON_VERIFIABLE}">n.d.</abbr>`);
    expect(text(types)).toContain("Confidentialité : seuil de 5 personnes");
    // Tableau par catégorie : la ligne Confidentialité de la page dit le même seuil.
    expect(html).toContain('data-testid="kpi-categories-confidentialite"');
  });
  it("détail de l'absentéisme : le tableau par motif reçoit le seuil de la page", async () => {
    const html = await page({ detail: "absenteeism" });
    expect(html).toContain('data-testid="kpi-detail-motifs"');
    expect(html).not.toContain(SEUIL_NON_DEFINI);
    const leave = rowOf("test_paid_leave").exec(html)![0];
    expect(leave).toContain('data-masque="oui"');
    expect(text(leave)).toContain(`n.d. — ${SEUIL_NON_VERIFIABLE}`);
    const sick = rowOf("test_sickness").exec(html)![0];
    expect(sick).not.toContain("data-masque");
    expect(text(sick)).toContain("oui");
    expect(text(/<p[^>]*data-testid="kpi-detail-motifs-all"[\s\S]*?<\/p>/.exec(html)![0])).toBe(`n.d. — ${R5}`);
    expect(text(/<p[^>]*data-testid="kpi-detail-motifs-confidentialite"[\s\S]*?<\/p>/.exec(html)![0])).toBe("Confidentialité : seuil de 5 personnes");
  });
  it("seuil absent sur l'espace : les deux répartitions sont n.d. « non défini » avec le lien vers Paramètres (aucun masquage par défaut)", async () => {
    mocks.conf.value = ABSENT;
    const html = await page({ detail: "absenteeism" });
    expect(html.match(/href="\/e\/demo\/parametres#confidentialite"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(text(/<span[^>]*data-testid="kpi-absence-types"[\s\S]*?<\/details>/.exec(html)![0])).toContain("test_sickness ( n.d. )");
    expect(text(rowOf("test_sickness").exec(html)![0])).toContain(`n.d. — ${SEUIL_NON_DEFINI}`);
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

describe("effectifs mensuels : masquage par colonne (total du mois publié), une seule passe pour la grille et la répartition", () => {
  it("stock, seuil 2 : en janvier B (1 personne) est masqué et D (2 personnes, plus petit que A) le protège ; février : B vide reste 0, rien n'est masqué ; mars n.d. : aucune colonne ; aucun cumul", () => {
    const mask = gridMask(grid, sizes, 2, true);
    expect(mask.months.get("2026-01")).toEqual(["shown", "masked", "secondary"]);
    expect(mask.months.get("2026-02")).toEqual(["shown", "shown", "shown"]);
    expect(mask.months.has("2026-03")).toBe(false);
    expect(mask.share).toBeNull();
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
    expect(gridMask(grid, sizes, 4, true).months.get("2026-01")).toEqual(["masked", "masked", "masked"]);
  });
  it("seuil 1 : rien n'est masqué ; groupe à valeur non nulle sans personne dénombrée : non vérifiable, même avec un seuil de 1", () => {
    expect(gridMask(grid, sizes, 1, true).months.get("2026-01")).toEqual(["shown", "shown", "shown"]);
    const m = gridMask(grid, (g, mo) => (g === "B" ? { persons: [], unlinked: 0 } : sizes(g, mo)), 1, true);
    expect(m.months.get("2026-01")![1]).toBe("unverifiable");
    expect(maskedGrid(grid, m, 1, null).cell("B", "2026-01")).toEqual({ kind: "nd", reason: SEUIL_NON_VERIFIABLE });
    // Effectif non dénombré pour tout le mois : chaque groupe est non vérifiable, même vide (rien ne permet de vérifier le seuil).
    expect(gridMask(grid, () => null, 1, true).months.get("2026-02")).toEqual(["unverifiable", "unverifiable", "unverifiable"]);
  });
  it("seuil absent : toute cellule de groupe d'un mois connu est n.d. avec la raison du paramètre, les totaux restent", () => {
    const g = maskedGrid(grid, null, null, SEUIL_NON_DEFINI);
    expect(g.cell("A", "2026-01")).toEqual({ kind: "nd", reason: SEUIL_NON_DEFINI });
    expect(g.cell("B", "2026-02")).toEqual({ kind: "nd", reason: SEUIL_NON_DEFINI });
    expect(g.cell("A", "2026-03")).toEqual({ kind: "nd", reason: "mois non lu" });
    expect(g.total("2026-02")).toEqual({ kind: "value", v: 5 });
  });
  it("répartition : un stock se lit au dernier mois connu (février : rien de masqué) ; un flux cumule janvier et février : le cumul de B et de D, masqués en janvier, est n.d. ; total conservé", () => {
    const stock = repartitionMasked(grid, true, { seuil: 2, mask: gridMask(grid, sizes, 2, true) });
    expect(stock.used).toEqual(["2026-02"]);
    expect(stock.items).toEqual([{ group: "A", v: 3, reason: null }, { group: "B", v: 0, reason: null }, { group: "D", v: 2, reason: null }]);
    // Flux : cellules jan A 3 / B 1 (masqué) / D 2, fév A 3 / B 0 / D 2. Colonne de janvier : D (plus petit affiché) protège B.
    // Statut canonique (lot 12 révisé) : le cumul n'a pas de relation propre, il se déduit de ses mois (n.d. dès qu'un mois est masqué,
    // raison du seuil) : B et D sont n.d., A (aucun mois masqué) est affiché. Avant, une colonne des cumuls donnait « masked » à B.
    const mask = gridMask(grid, sizes, 2, false);
    expect(mask.months.get("2026-01")).toEqual(["shown", "masked", "secondary"]);
    expect(mask.months.get("2026-02")).toEqual(["shown", "shown", "shown"]);
    expect(mask.share).toEqual(["shown", "secondary", "secondary"]);
    const flux = repartitionMasked(grid, false, { seuil: 2, mask });
    expect(flux.items).toEqual([{ group: "A", v: 6, reason: null }, { group: "B", v: null, reason: R2 }, { group: "D", v: null, reason: R2 }]);
    expect(flux.total).toBe(11);
    // Seuil absent : chaque groupe n.d., total conservé.
    const nd = repartitionMasked(grid, false, { seuil: null, reason: SEUIL_NON_DEFINI });
    expect(nd.items.map((it) => it.v)).toEqual([null, null, null]);
    expect(nd.items[0].reason).toBe(SEUIL_NON_DEFINI);
    expect(nd.total).toBe(11);
  });
  it("flux, cas de la relecture (G = 1 / 5 / 5 personnes, seuil 5) : janvier masqué dans sa seule colonne ; les cumuls qui le contiennent sont n.d. ; janvier ne se lit pas par différence", () => {
    // G : janvier p1 (1), février p1…p5 (5), mars p1…p5 (5) → cumul 11 (5 personnes) ; H : p6…p10 chaque mois (5) → cumul 15.
    // Statut canonique (lot 12 révisé) : un mois ne se juge que sur sa colonne. Janvier : G (1 < 5) masqué, H masqué à son tour (le
    // total du mois étant publié). Février et mars : 5 personnes chacun, affichés. Le cumul n'ajoute aucune relation : G et H ont un
    // mois masqué, leurs cumuls sont n.d. Janvier de G : seul « G + H de janvier » (le total du mois) est publié. Avant, la relation
    // « mois → cumul » masquait aussi février, qui changeait alors de statut selon la fenêtre (fuite entre écrans de la relecture).
    const who: Record<string, Record<string, string[]>> = {
      G: { "2026-01": ["p1"], "2026-02": ["p1", "p2", "p3", "p4", "p5"], "2026-03": ["p1", "p2", "p3", "p4", "p5"] },
      H: { "2026-01": ["p6", "p7", "p8", "p9", "p10"], "2026-02": ["p6", "p7", "p8", "p9", "p10"], "2026-03": ["p6", "p7", "p8", "p9", "p10"] },
    };
    const g: GridIn = {
      months: ["2026-01", "2026-02", "2026-03"],
      groups: ["G", "H"],
      cell: (grp, m) => ({ kind: "value", v: who[grp][m].length }),
      total: (m) => ({ kind: "value", v: who.G[m].length + who.H[m].length }),
    };
    const mask = gridMask(g, (grp, m) => ({ persons: who[grp][m], unlinked: 0 }), 5, false);
    expect(mask.months.get("2026-01")).toEqual(["masked", "secondary"]);
    expect(mask.months.get("2026-02")).toEqual(["shown", "shown"]);
    expect(mask.months.get("2026-03")).toEqual(["shown", "shown"]);
    expect(mask.share).toEqual(["secondary", "secondary"]);
    const R5 = confidentialiteReason(5);
    const flux = repartitionMasked(g, false, { seuil: 5, mask });
    expect(flux.items).toEqual([{ group: "G", v: null, reason: R5 }, { group: "H", v: null, reason: R5 }]);
    expect(flux.total).toBe(26);
    expect(maskedCount(mask)).toBe(2);
    expect(maskedGrid(g, mask, 5, null).cell("G", "2026-02")).toEqual({ kind: "value", v: 5 });
    expect(maskedGrid(g, mask, 5, null).cell("G", "2026-01")).toEqual({ kind: "nd", reason: R5 });
  });
  it("flux : le cumul est masqué quand ses mois ne peuvent pas être protégés (janvier non vérifiable, février sous le seuil, mars vide) ; anneau, tableau et feuille lisent le même statut", () => {
    // G : janvier p1, p2, p3 + un contrat non relié (4 contrats : non vérifiable, aucune personne comptée), février p4, p5 (2 : masqué),
    // mars personne (0) → cumul 6, 5 personnes reliées + 1 non relié (affiché au premier tour). Relation G : l'ensemble masqué compte
    // 2 personnes, et même tous les mois réunis n'en comptent que 2 (< 5) : impossible, le cumul (total masquable) est masqué.
    // H (p6…p10, 5 chaque mois, cumul 15) protège G dans les colonnes de janvier, de février et des cumuls.
    const whoG: Record<string, { persons: string[]; unlinked: number }> = { "2026-01": { persons: ["p1", "p2", "p3"], unlinked: 1 }, "2026-02": { persons: ["p4", "p5"], unlinked: 0 }, "2026-03": { persons: [], unlinked: 0 } };
    const vG: Record<string, number> = { "2026-01": 4, "2026-02": 2, "2026-03": 0 };
    const H = ["p6", "p7", "p8", "p9", "p10"];
    const g: GridIn = {
      months: ["2026-01", "2026-02", "2026-03"],
      groups: ["G", "H"],
      cell: (grp, m) => ({ kind: "value", v: grp === "G" ? vG[m] : 5 }),
      total: (m) => ({ kind: "value", v: vG[m] + 5 }),
    };
    const mask = gridMask(g, (grp, m) => (grp === "G" ? whoG[m] : { persons: H, unlinked: 0 }), 5, false);
    expect(mask.months.get("2026-01")).toEqual(["unverifiable", "secondary"]);
    expect(mask.months.get("2026-02")).toEqual(["masked", "secondary"]);
    expect(mask.months.get("2026-03")).toEqual(["shown", "shown"]);
    expect(mask.share).toEqual(["secondary", "secondary"]);
    const R5 = confidentialiteReason(5);
    const flux = repartitionMasked(g, false, { seuil: 5, mask });
    expect(flux.items).toEqual([{ group: "G", v: null, reason: R5 }, { group: "H", v: null, reason: R5 }]);
    expect(flux.total).toBe(21);
    expect(effectifsShareSheet(flux, "nombre", "cumul").rows[0]).toEqual(["G", { nd: R5 }, { nd: R5 }, ""]);
  });
  it("embauches prévisionnelles (décision à soumettre à Lyes) : une cellule portée seulement par des embauches est affichée et ne protège personne ; mêlée à des contrats réels, elle se juge sur eux", () => {
    // Seuil 5, flux (entrées). Groupes : « Embauche prévisionnelle » (janvier : 2 embauches, février : 1 embauche + le contrat réel de
    // p1), CDD (janvier : p2, 1 personne), CDI (p3…p7, 5 personnes chaque mois).
    // Janvier : CDD masqué ; l'embauche (taille 0) n'apporte personne : CDI (5) protège CDD. Février : la cellule mêlée se juge sur p1
    // (1 < 5) : masquée ; CDI protège. Cumuls déduits des mois (aucune relation propre) : chaque groupe a un mois masqué, n.d.
    const who: Record<string, Record<string, { persons: string[]; unlinked: number; hires: number }>> = {
      "Embauche prévisionnelle": { "2026-01": { persons: [], unlinked: 0, hires: 2 }, "2026-02": { persons: ["p1"], unlinked: 0, hires: 1 } },
      CDD: { "2026-01": { persons: ["p2"], unlinked: 0, hires: 0 }, "2026-02": { persons: [], unlinked: 0, hires: 0 } },
      CDI: { "2026-01": { persons: ["p3", "p4", "p5", "p6", "p7"], unlinked: 0, hires: 0 }, "2026-02": { persons: ["p3", "p4", "p5", "p6", "p7"], unlinked: 0, hires: 0 } },
    };
    const v = (grp: string, m: string) => who[grp][m].persons.length + who[grp][m].unlinked + who[grp][m].hires;
    const g: GridIn = {
      months: ["2026-01", "2026-02"],
      groups: ["Embauche prévisionnelle", "CDD", "CDI"],
      cell: (grp, m) => ({ kind: "value", v: v(grp, m) }),
      total: (m) => ({ kind: "value", v: g.groups.reduce((s, grp) => s + v(grp, m), 0) }),
    };
    const mask = gridMask(g, (grp, m) => who[grp][m], 5, false);
    expect(mask.months.get("2026-01")).toEqual(["shown", "masked", "secondary"]);
    expect(mask.months.get("2026-02")).toEqual(["masked", "shown", "secondary"]);
    expect(mask.share).toEqual(["secondary", "secondary", "secondary"]);
    const R5 = confidentialiteReason(5);
    const masked = maskedGrid(g, mask, 5, null);
    expect(masked.cell("Embauche prévisionnelle", "2026-01")).toEqual({ kind: "value", v: 2 });
    expect(masked.cell("Embauche prévisionnelle", "2026-02")).toEqual({ kind: "nd", reason: R5 });
    // Un groupe d'embauches seules sur tous les mois : affiché partout (rien d'autre n'est masqué en février), cumul compris.
    const only = gridMask(g, (grp, m) => (grp === "Embauche prévisionnelle" ? { persons: [], unlinked: 0, hires: 2 } : who[grp][m]), 5, false);
    expect(only.months.get("2026-02")![0]).toBe("shown");
    expect(only.months.get("2026-01")![0]).toBe("shown");
    expect(only.share![0]).toBe("shown");
  });
  it("embauches prévisionnelles, cas « impossible » (relecture du lot 12, seuil 5) : mois projeté, Cadres = 1 salarié réel (1,00 ETP), Non-cadres = 2 embauches seules (2,00 ETP), total 3,00 publié : toute la colonne est n.d.", () => {
    // Avant, les embauches étaient exemptes : Non-cadres restait affiché et Cadres se lisait par différence (3,00 − 2,00 = 1,00).
    // Désormais la cellule des embauches (taille 0) ne protège pas et, rien ne pouvant protéger Cadres, elle est masquée avec lui.
    const M = "2026-09";
    const vals: Record<string, number> = { Cadres: 10_000, "Non-cadres": 20_000 };
    const g: GridIn = { months: [M], groups: ["Cadres", "Non-cadres"], cell: (grp) => ({ kind: "value", v: vals[grp] }), total: () => ({ kind: "value", v: 30_000 }) };
    const sz: GridSizes = (grp) => (grp === "Cadres" ? { persons: ["p1"], unlinked: 0, hires: 0, contracts: 1 } : { persons: [], unlinked: 0, hires: 2, contracts: 0 });
    for (const stockMeasure of [true, false]) {
      const mask = gridMask(g, sz, 5, stockMeasure);
      expect(mask.months.get(M), `stock ${stockMeasure}`).toEqual(["masked", "secondary"]);
      const out = maskedGrid(g, mask, 5, null);
      expect(out.cell("Non-cadres", M)).toEqual({ kind: "nd", reason: confidentialiteReason(5) });
      expect(out.total(M)).toEqual({ kind: "value", v: 30_000 }); // le total publié reste
    }
  });
  it("feuilles Excel : mêmes cellules n.d. que l'écran, raison en commentaire ; répartition masquée n.d. (valeur et part)", () => {
    const g = maskedGrid(grid, gridMask(grid, sizes, 2, true), 2, null);
    const sheet = effectifsGridSheet({ ...g, layers: new Map() }, "nombre");
    expect(sheet.rows[1]).toEqual(["B", { nd: R2 }, 0, { nd: "mois non lu" }, ""]);
    expect(sheet.rows[2]).toEqual(["D", { nd: R2 }, 2, { nd: "mois non lu" }, ""]);
    expect(sheet.rows[3]).toEqual(["Total", 6, 5, { nd: "mois non lu" }, ""]);
    const share = effectifsShareSheet(repartitionMasked(grid, false, { seuil: 2, mask: gridMask(grid, sizes, 2, false) }), "nombre", "cumul");
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
    // contracts : l'effectif du groupe (nombre de contrats), valeur d'ordre du masquage d'un stock (stockColumn, partagée avec le Suivi).
    expect(e.sizes("CDD", "2025-12")).toEqual({ persons: [dsn.contracts.find((c) => c.nature === "02")!.personKey], unlinked: 0, hires: 0, contracts: 1 });
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

// --- Export du Suivi : feuille « Par catégorie » masquée, garde du périmètre sous un filtre Nature ----------------------------------
// Fixture DSN, fenêtre janvier → décembre 2025 (fin=2025-12) : CDI 5 puis 6 personnes, CDD une personne (contrat 003) chaque mois.
describe("export du Suivi (référentiel fictif) : catégories masquées et garde du périmètre", () => {
  const noteOf = (c: ExcelJS.Cell): string | null => (c.note ? (typeof c.note === "string" ? c.note : (c.note.texts?.map((t) => t.text).join("") ?? "")) : null);
  const filterOf = (wb: ExcelJS.Workbook, label: string) => {
    const ws = wb.getWorksheet("Filtres")!;
    for (let r = 1; r <= 20; r++) if (ws.getCell(r, 1).value === label) return String(ws.getCell(r, 2).value);
    return null;
  };
  const wbOf = async (query: string) => {
    const { GET } = await import("@/app/e/[slug]/studio-rh/kpi/export/route");
    const res = await GET(new NextRequest(`http://localhost/e/demo/studio-rh/kpi/export?${query}&format=xlsx`), { params: Promise.resolve({ slug: "demo" }) });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
    return wb;
  };
  beforeEach(() => {
    mocks.kpiCtx.value = kpiCtx;
  });
  it("seuil 2, sans filtre : « Par catégorie » n.d. (CDD une personne, CDI masqué à son tour), totaux conservés ; « Mois par mois » (entreprise) intact ; Filtres : 24 cellules", async () => {
    mocks.conf.value = set(2);
    const wb = await wbOf("fin=2025-12");
    const cat = wb.getWorksheet("Par catégorie")!;
    // Ligne 6 : janvier 2025 ; colonnes 2-3 CDI, 4-5 CDD, 6-7 Total (6 contrats, 4,80 ETP) ; ligne 17 : décembre (7 contrats, 5,60 ETP).
    for (const c of [2, 3, 4, 5]) {
      expect(cat.getCell(6, c).value, String(c)).toBe("n.d.");
      expect(noteOf(cat.getCell(6, c)), String(c)).toContain(R2);
    }
    expect([cat.getCell(6, 6).value, cat.getCell(6, 7).value, cat.getCell(17, 6).value, cat.getCell(17, 7).value]).toEqual([6, 4.8, 7, 5.6]);
    expect(wb.getWorksheet("Mois par mois")!.getCell(6, 3).value).toBe(6); // effectif de l'entreprise : jamais masqué
    expect(filterOf(wb, "Confidentialité")).toBe("seuil de 2 personnes distinctes ; 24 cellules non affichées (par catégorie)");
    expect(filterOf(wb, "Périmètre retenu")).toBeNull();
    expect(wb.getWorksheet("Définitions")!.getCell(4 + 11, 1).value).toBe("Seuil de confidentialité");
  });
  it("seuil 2, filtre Nature CDD (une personne) : chaque feuille n.d. avec la raison de la garde, couverture et libellés conservés ; Filtres : Périmètre retenu", async () => {
    mocks.conf.value = set(2);
    const wb = await wbOf("fin=2025-12&nature=02");
    const ws = wb.getWorksheet("Mois par mois")!;
    expect(ws.getCell(6, 1).value).toBe("2025-01");
    expect(ws.getCell(6, 2).value).not.toBe("n.d."); // couverture du mois : un fait de la source
    for (const c of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(ws.getCell(6, c).value, String(c)).toBe("n.d.");
      expect(noteOf(ws.getCell(6, c)), String(c)).toBe(R2);
    }
    expect(ws.getCell(18, 3).value).toBe("n.d."); // ligne « Période — moyennes »
    const cat = wb.getWorksheet("Par catégorie")!;
    expect([cat.getCell(6, 2).value, cat.getCell(6, 4).value]).toEqual(["n.d.", "n.d."]);
    expect(noteOf(cat.getCell(6, 4))).toBe(R2);
    expect(filterOf(wb, "Périmètre retenu")).toBe(`n.d. — ${R2}`);
    expect(filterOf(wb, "Confidentialité")).toBe("seuil de 2 personnes distinctes");
    // Filtre Nature CDI : masqué à son tour sans filtre (il protège le CDD) → gardé aussi ; seuil 1 : rien n'est gardé.
    expect(filterOf(await wbOf("fin=2025-12&nature=01"), "Périmètre retenu")).toBe(`n.d. — ${R2}`);
    mocks.conf.value = set(1);
    const one = await wbOf("fin=2025-12&nature=02");
    expect(filterOf(one, "Périmètre retenu")).toBeNull();
    expect(one.getWorksheet("Par catégorie")!.getCell(17, 2).value).toBe(1);
    // Seuil absent : garde « non défini », feuilles n.d. avec cette raison.
    mocks.conf.value = ABSENT;
    const nd = await wbOf("fin=2025-12&nature=02");
    expect(filterOf(nd, "Périmètre retenu")).toBe(`n.d. — ${SEUIL_NON_DEFINI}`);
    expect(noteOf(nd.getWorksheet("Mois par mois")!.getCell(6, 3))).toBe(SEUIL_NON_DEFINI);
  });
});
