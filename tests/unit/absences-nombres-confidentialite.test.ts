import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbsenceMotifsDetail, AbsenceTypeNotes } from "@/app/e/[slug]/studio-rh/kpi/components";
import type { KpiFormProps } from "@/app/e/[slug]/parametres/KpiForm";
import { monthRange } from "@/lib/connectors/months";
import { confidentialiteReason, linkFromReferential, SEUIL_NON_DEFINI, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting } from "@/lib/confidentialite";
import { motifWindow } from "@/lib/croisee/conges";
import { absenceTypeChoices } from "@/lib/rh/kpi/absence";
import { absenceByMotif, absenceTypeGroups, absenceTypePersons, type AbsencePeriodGroups } from "@/lib/rh/kpi/absence-motifs";
import type { KpiInput, Window } from "@/lib/rh/kpi/types";
import type { AbsenceRow } from "@/lib/rh/referential/types";
import { maskMotifRows, motifRows, periodCountMask, typeCountMask, type MotifLineIn } from "@/lib/viz/kpi";
import { absence, kpiInput, readAbsences } from "./helpers/kpi";
import { payfitEdgeBuild } from "./helpers/rh";

// Lot 12, finition : nombres d'absences par motif. Données entièrement fictives ; cas de référence calculés à la main en commentaire.
//  1. « Absences de la lecture » (tuile Absentéisme de KPI RH, détail par motif, Paramètres › Définitions des KPI › Absentéisme) : une
//     seule colonne, tous les motifs de la lecture, dont Données › lecture publie le total (nombre d'éléments de la collection absences) :
//     masquage principal et secondaire, même statut sur les trois blocs, quel que soit le rôle.
//  2. « Absences de la période » (détail par motif) : ses propres personnes (absences du motif qui touchent la fenêtre), la relation
//     « lecture = période + reste » de sa ligne, et la règle canonique des fenêtres (n.d. dès qu'un de ses mois est masqué).

// --- Doubles de la page Paramètres (aucune base) : réglages, accès, lecture PayFit active, référentiel, formulaires -----------------
const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  rows: [] as unknown[],
  data: null as unknown,
  kpiForm: { props: null as unknown },
}));
vi.mock("@/lib/settings", () => ({
  getSetting: async () => null,
  getSettingMeta: async () => null,
  getSettingsMeta: async (_ws: string, keys: string[]) =>
    new Map(keys.filter((k) => k in mocks.settings).map((k) => [k, { value: mocks.settings[k], updatedAt: new Date("2026-10-01T08:00:00Z"), updatedBy: null }])),
  setSetting: async () => undefined,
}));
vi.mock("@/db/workspace-scope", () => ({ withWorkspace: async () => [] }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async (slug: string) => ({ session: {}, workspace: { id: "w1", name: "Espace fictif", slug, role: "reader" } }) }));
vi.mock("@/lib/payroll/context", async (orig) => ({ ...(await orig<typeof import("@/lib/payroll/context")>()), journalAxes: async () => [] }));
// Lecture PayFit active : ses absences (loadAbsencesOfSync) et leurs motifs avec leur nombre (loadAbsenceTypes, comme la requête SQL).
vi.mock("@/lib/rh/referential/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/rh/referential/store")>()),
  activePayFitSync: async () => ({ id: "sync-fictif", startedAt: new Date("2026-10-21T08:00:00Z") }),
  loadAbsencesOfSync: async () => mocks.rows,
  loadAbsenceTypes: async () => {
    const counts = new Map<string, number>();
    for (const r of mocks.rows as AbsenceRow[]) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([type, count]) => ({ type, count }));
  },
}));
vi.mock("@/lib/rh/view", async (orig) => ({ ...(await orig<typeof import("@/lib/rh/view")>()), loadCollabContext: async () => ({ data: mocks.data }) }));
vi.mock("@/app/e/[slug]/parametres/actions", () =>
  Object.fromEntries(
    ["saveHeadcountNatures", "savePayfitHistory", "savePayrollGrid", "saveServiceAxis", "saveKpiSettings", "saveProrata", "saveCategoryNatures", "saveContractCategories", "saveConfidentialite", "saveCroiseeSettings"].map((k) => [k, async () => undefined]),
  ),
);
// Le formulaire des KPI est un composant client : ses propriétés sont transmises au navigateur. Elles sont relevées ici pour vérifier
// qu'un nombre n.d. n'y figure pas.
vi.mock("@/app/e/[slug]/parametres/KpiForm", async (orig) => {
  const m = await orig<typeof import("@/app/e/[slug]/parametres/KpiForm")>();
  const { createElement } = await import("react");
  return { ...m, KpiForm: (p: KpiFormProps) => ((mocks.kpiForm.props = p), createElement(m.KpiForm, p)) };
});

const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const R5 = confidentialiteReason(5); // « non affiché (seuil de confidentialité : 5 personnes) »
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/<!-- -->/g, "");
// Valeur publiée d'un nombre : le nombre, ou la raison de son n.d. (abbr au survol, ou cellule « n.d. — raison »).
const shown = (fragment: string): string => {
  const abbr = /<abbr class="nd" title="([^"]*)">n\.d\.<\/abbr>/.exec(fragment);
  if (abbr) return unescape(abbr[1]);
  const nd = /n\.d\. — ([^<]*)/.exec(unescape(fragment));
  return nd ? nd[1].trim() : unescape(fragment).replace(/<[^>]*>/g, "").trim();
};
const rowOf = (html: string, type: string) => new RegExp(`<tr data-motif="${type}"[\\s\\S]*?</tr>`).exec(html)![0];
// Détail par motif : deuxième et troisième cellules (« Absences de la lecture », « Absences de la période ») ; une seule cellule fusionnée
// quand les deux sont n.d. pour la même raison.
const tds = (html: string, type: string) => [...rowOf(html, type).matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => ({ attrs: m[1], body: m[2] }));
const detailCount = (html: string, type: string) => shown(tds(html, type)[1].body);
const detailPeriod = (html: string, type: string) => {
  const t = tds(html, type);
  return shown(/colspan="2"/i.test(t[1].attrs) ? t[1].body : t[2].body);
};
// Tuile Absentéisme (« Motifs de la lecture ») et Paramètres (« N absences » ou « absences : n.d. »).
const notesCount = (html: string, type: string) => shown(new RegExp(`${type}</code> \\(([\\s\\S]*?)\\)</span>`).exec(unescape(html))![1]);
const paramCount = (html: string, type: string) =>
  shown(new RegExp(`<code>${type}</code></span><span class="desc" data-testid="setting-kpi-types-count">([\\s\\S]*?)</span></span>`).exec(unescape(html))![1]).replace(/^absences : /, "");

// --- 1. Colonne « Absences de la lecture » : cas de la relecture ---------------------------------------------------------------------
describe("nombre d'absences par motif de la lecture : une colonne dont Données publie le total", () => {
  it("cas de la relecture, seuil 5 : paternité (2 absences, 1 personne) et maladie (30 absences, 6 personnes), total 32 publié", () => {
    // Avant : paternité n.d., maladie 30 affichée, et 32 − 30 = 2 se lisait par différence. Maintenant : paternité masquée (1 personne) ;
    // la seule autre cellule, la maladie, l'est en second (1 + 6 = 7 personnes ≥ 5, deux cellules). Le total 32 reste publié.
    const sizes = { paternite: { persons: ["P1"], unlinked: 0, count: 2 }, maladie: { persons: ["P2", "P3", "P4", "P5", "P6", "P7"], unlinked: 0, count: 30 } };
    expect(typeCountMask(sizes, "paternite", 2, 5)).toBe(R5);
    expect(typeCountMask(sizes, "maladie", 30, 5)).toBe(R5);
  });
  it("une absence sans motif lu (motif « n.d. » d'absenceRowOf) fait partie de la colonne : elle compte dans le total de Données", () => {
    // Maladie : 6 absences de six contrats reliés (6 personnes) ; « n.d. » : 1 absence (C-M1, 1 personne). Total 7 publié. « n.d. »
    // (en dernier dans l'ordre canonique) est masqué ; seule autre cellule, la maladie l'est en second (6 personnes ≥ 5).
    const link = new Map([1, 2, 3, 4, 5, 6].map((k) => [`C-M${k}`, `P${k}`]));
    const rows = [1, 2, 3, 4, 5, 6].map((k) => ({ type: "test_maladie", contractId: `C-M${k}` })).concat({ type: "n.d.", contractId: "C-M1" });
    const groups = absenceTypeGroups(rows, link);
    expect(groups["n.d."]).toEqual({ persons: ["P1"], unlinked: 0, count: 1 });
    expect(typeCountMask(groups, "test_maladie", 6, 5)).toBe(R5);
    expect(typeCountMask(groups, "n.d.", 1, 5)).toBe(R5);
    // Sans l'absence sans motif, rien n'est à protéger : la maladie (6 personnes) est affichée.
    expect(typeCountMask(absenceTypeGroups(rows.slice(0, 6), link), "test_maladie", 6, 5)).toBeNull();
  });
});

// --- Test croisé KPI RH / Paramètres, référentiel PayFit fictif ----------------------------------------------------------------------
// Seuil 5. Contrats reliés : C-A1 (paternité), C-M1 à C-M6 (maladie), C-C1 à C-C7 (congés).
//   test_paternite : 2 absences (C-A1, mars 2026)                                  → 1 personne
//   test_maladie   : 30 absences (C-M1 à C-M6, une par mois de janvier à mai 2026)   → 6 personnes
//   test_conges    : 12 absences (C-C1 à C-C5 deux fois, C-C6 et C-C7 une fois, juin) → 7 personnes
// Données › lecture publie 44 absences. Colonne (ordre canonique : congés, maladie, paternité) : paternité masquée (1 personne) ; plus
// petite cellule affichée qui apporte une personne : congés (12 < 30), masqués en second (1 + 7 = 8 ≥ 5). Maladie affichée : 30.
// Avant la correction : KPI RH masquait la paternité seule (44 − 12 − 30 = 2 se lisait) ; Paramètres affichait les trois nombres à
// tous les rôles.
const person = (id: string) => ({ contractId: `C-${id}`, collaboratorId: `P-${id}`, startDate: "2025-01-01", endDate: null });
const IDS = ["A1", ...[1, 2, 3, 4, 5, 6].map((k) => `M${k}`), ...[1, 2, 3, 4, 5, 6, 7].map((k) => `C${k}`)];
const edge = { collaborators: IDS.map((id) => ({ id: `P-${id}` })), contracts: IDS.map((id) => person(id)) };
const day = (id: string, contract: string, date: string, type: string, status?: string) => absence(id, contract, date, "beginning-of-day", date, "end-of-day", { type, status });
const ABS: AbsenceRow[] = [
  day("pa1", "C-A1", "2026-03-02", "test_paternite"),
  day("pa2", "C-A1", "2026-03-03", "test_paternite"),
  ...[1, 2, 3, 4, 5, 6].flatMap((k) => [1, 2, 3, 4, 5].map((m) => day(`m${k}-${m}`, `C-M${k}`, `2026-0${m}-${10 + k}`, "test_maladie"))),
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((k) => (k <= 5 ? [1, 2] : [1]).map((n) => day(`c${k}-${n}`, `C-C${k}`, `2026-06-${String(n * 10 + k).padStart(2, "0")}`, "test_conges"))),
];
const TYPES = ["test_conges", "test_maladie", "test_paternite"];
const W: Window = { mode: "civil", from: "2026-04", to: "2026-05", months: ["2026-04", "2026-05"], label: "avril → mai 2026" };

describe("test croisé : nombres d'absences de la lecture, KPI RH (tuile et détail par motif) et Paramètres (seuil 5)", async () => {
  const data = await payfitEdgeBuild(edge);
  const kin: KpiInput = kpiInput(data, readAbsences(ABS, monthRange("2024-10", "2026-10")), { absenceTypes: ["test_maladie"] });
  const kpiTile = (setting: ConfidentialiteSetting) => {
    const all = absenceTypeChoices(kin).filter((x) => x.inRead);
    return renderToStaticMarkup(h(AbsenceTypeNotes, { chosen: all.filter((x) => x.chosen), other: all.filter((x) => !x.chosen), missing: [], slug: "demo", mask: { setting, sizes: absenceTypePersons(kin) } }));
  };
  const kpiDetail = (setting: ConfidentialiteSetting) =>
    renderToStaticMarkup(h(AbsenceMotifsDetail, { motifs: absenceByMotif(kin, W), cells: motifWindow(kin, W), slug: "demo", confidentialite: setting, typeSizes: absenceTypePersons(kin) }));
  const parametres = async () => {
    const { default: Page } = await import("@/app/e/[slug]/parametres/page");
    return renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "demo" }) }));
  };
  beforeEach(() => {
    mocks.rows = ABS;
    mocks.data = data;
    mocks.settings = { "rh.confidentialite.seuil": 5 };
    mocks.kpiForm.props = null;
  });

  it("lecture : 44 absences, le nombre que publie Données ; chaque motif avec ses personnes reliées", () => {
    const g = absenceTypePersons(kin);
    expect(Object.values(g).reduce((s, x) => s + x.count, 0)).toBe(44);
    expect(Object.entries(g).map(([t, x]) => [t, x.count, x.persons.length, x.unlinked])).toEqual([
      ["test_conges", 12, 7, 0],
      ["test_maladie", 30, 6, 0],
      ["test_paternite", 2, 1, 0],
    ]);
    // Paramètres lit les mêmes absences et le même référentiel : mêmes groupes.
    expect(absenceTypeGroups(ABS, linkFromReferential(data))).toEqual(g);
  });

  it("seuil 5 : congés n.d. (en second), maladie 30, paternité n.d. — mêmes statuts dans la tuile, le détail par motif et Paramètres", async () => {
    const expected = [R5, "30", R5];
    const tile = kpiTile(set(5));
    expect(TYPES.map((t) => notesCount(tile, t))).toEqual(expected);
    const detail = kpiDetail(set(5));
    expect(TYPES.map((t) => detailCount(detail, t))).toEqual(expected);
    const page = await parametres();
    expect(TYPES.map((t) => paramCount(page, t))).toEqual([R5, "30 absences", R5]);
    // Le formulaire (composant client) ne reçoit jamais un nombre n.d. : il n'est pas transmis au navigateur.
    const props = mocks.kpiForm.props as KpiFormProps;
    expect(props.types.map((t) => [t.type, t.count, t.countNd])).toEqual([
      ["fr_maladie_ordinaire", 0, null], // motif retenu par défaut, absent de la lecture : « sans effet », aucun nombre affiché
      ["test_conges", null, R5],
      ["test_maladie", 30, null],
      ["test_paternite", null, R5],
    ]);
    expect(page).not.toMatch(/\b12 absences\b|\b2 absences\b/);
    expect(props.countsNote).toBeNull();
  });

  it("seuil non défini : chaque nombre est n.d. avec la raison, et Paramètres renvoie à la section Confidentialité ; aucun nombre transmis", async () => {
    mocks.settings = {};
    const absent: ConfidentialiteSetting = { kind: "absent" };
    expect(TYPES.map((t) => notesCount(kpiTile(absent), t))).toEqual([SEUIL_NON_DEFINI, SEUIL_NON_DEFINI, SEUIL_NON_DEFINI]);
    const page = await parametres();
    expect(TYPES.map((t) => paramCount(page, t))).toEqual([SEUIL_NON_DEFINI, SEUIL_NON_DEFINI, SEUIL_NON_DEFINI]);
    const note = /<p[^>]*data-testid="setting-kpi-types-confidentialite"[\s\S]*?<\/p>/.exec(page)![0];
    expect(unescape(note).replace(/<[^>]+>/g, "")).toBe(`Nombres d'absences : n.d. — ${SEUIL_NON_DEFINI}`);
    expect(note).toContain('href="/e/demo/parametres#confidentialite"');
    expect((mocks.kpiForm.props as KpiFormProps).types.every((t) => t.count === null || t.count === 0)).toBe(true);
  });

  it("seuil 1 : rien n'est masqué, les trois blocs affichent les mêmes nombres", async () => {
    mocks.settings = { "rh.confidentialite.seuil": 1 };
    const expected = ["12", "30", "2"];
    expect(TYPES.map((t) => notesCount(kpiTile(set(1)), t))).toEqual(expected);
    expect(TYPES.map((t) => detailCount(kpiDetail(set(1)), t))).toEqual(expected);
    const page = await parametres();
    expect(TYPES.map((t) => paramCount(page, t))).toEqual(["12 absences", "30 absences", "2 absences"]);
  });
});

// --- 2. « Absences de la période » : ses propres personnes ---------------------------------------------------------------------------
// Cas pur, fenêtre avril → mai 2026, seuil 5 (personnes en jetons ; « reste » : absences du motif qui ne touchent pas la fenêtre).
//   a : 2 absences en attente en avril (A1, A2 : 0 demi-journée comptée) ; reste 5 absences (A2 à A6)
//       → période de 2 personnes : masquée (avant : « 2 » affiché sur une ligne à 0 demi-journée).
//   b : 7 absences en avril (B1 à B5) ; reste 1 absence (B6)
//       → période de 5 personnes affichée seule, mais lecture − période = 1 absence de B6 : masquée en second.
//   c : 6 absences (C1 à C5 en avril, C6 en mai) ; aucun reste
//       → période de 6 personnes, mais mai ne compte que C6 (colonne de mai : masqué) : n.d. dès qu'un mois est masqué.
//   d : 10 absences (D1 à D5 en avril et en mai) ; aucun reste → affichée.
//   e : 5 absences en avril, 4 personnes reliées et un contrat non relié → non vérifiable.
const g = (persons: string[], count: number, unlinked = 0) => ({ persons, unlinked, count });
const none = g([], 0);
const P = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
const PERIOD: AbsencePeriodGroups = {
  months: ["2026-04", "2026-05"],
  types: {
    a: { window: g(P("A", 1, 2), 2), months: [g(P("A", 1, 2), 2), none], rest: g(P("A", 2, 6), 5), offMonths: 0 },
    b: { window: g(P("B", 1, 5), 7), months: [g(P("B", 1, 5), 7), none], rest: g(["B6"], 1), offMonths: 0 },
    c: { window: g(P("C", 1, 6), 6), months: [g(P("C", 1, 5), 5), g(["C6"], 1)], rest: none, offMonths: 0 },
    d: { window: g(P("D", 1, 5), 10), months: [g(P("D", 1, 5), 5), g(P("D", 1, 5), 5)], rest: none, offMonths: 0 },
    e: { window: g(P("E", 1, 4), 5, 1), months: [g(P("E", 1, 4), 5, 1), none], rest: none, offMonths: 0 },
  },
};

describe("absences de la période : personnes de la période, reste de la lecture, mois de la période (cas écrit à la main)", () => {
  it("statuts : a masqué, b et c masqués en second, d affiché, e non vérifiable", () => {
    const st = periodCountMask(PERIOD, 5);
    expect([st("a", 2), st("b", 7), st("c", 6), st("d", 10), st("e", 5)]).toEqual(["masked", "secondary", "secondary", "shown", "unverifiable"]);
  });
  it("aucune absence : rien à protéger ; nombre différent de la période, motif absent, personnes non transmises, mois incohérents : non vérifiable", () => {
    const st = periodCountMask(PERIOD, 5);
    expect(st("inconnu", 0)).toBe("shown");
    expect(st("d", 9)).toBe("unverifiable");
    expect(st("inconnu", 2)).toBe("unverifiable");
    expect(periodCountMask(undefined, 5)("d", 10)).toBe("unverifiable");
    expect(periodCountMask({ ...PERIOD, types: { d: { ...PERIOD.types.d, offMonths: 1 } } }, 5)("d", 10)).toBe("unverifiable");
  });
  it("seuil 1 : seul le contrat non relié sans personne reliée reste non vérifiable", () => {
    const st = periodCountMask({ ...PERIOD, types: { ...PERIOD.types, f: { window: g([], 1, 1), months: [g([], 1, 1), none], rest: none, offMonths: 0 } } }, 1);
    expect(["a", "b", "c", "d", "e"].map((t) => st(t, PERIOD.types[t].window.count))).toEqual(["shown", "shown", "shown", "shown", "shown"]);
    expect(st("f", 1)).toBe("unverifiable");
  });
  it("lignes du détail : « Absences de la période » prend ce statut quand la ligne et le nombre de la lecture sont affichés", () => {
    // Nombres de la lecture : a 7 (A1 à A6), b 8 (B1 à B6), c 6, d 10 : tous ≥ 5 personnes, total 31 : rien n'est masqué.
    const sizes = { a: g(P("A", 1, 6), 7), b: g(P("B", 1, 6), 8), c: g(P("C", 1, 6), 6), d: g(P("D", 1, 5), 10) };
    const line = (type: string, count: number, inWindow: number, half: number): MotifLineIn => ({ type, count, inWindow, chosen: type === "d", kind: "exact", half, ratio: { num: half, den: 400 } });
    const rows = motifRows([line("a", 7, 2, 0), line("b", 8, 7, 14), line("c", 6, 6, 10), line("d", 10, 10, 20)]);
    const masked = maskMotifRows(rows, null, 5, null, sizes, PERIOD);
    expect(masked.map((r) => [r.type, r.countMasked, r.inWindowMasked])).toEqual([
      ["a", null, R5],
      ["b", null, R5],
      ["c", null, R5],
      ["d", null, null],
    ]);
    // Sans les personnes de la période : un nombre non nul n'est pas vérifiable (aucune valeur de repli).
    expect(maskMotifRows(rows, null, 5, null, sizes).map((r) => r.inWindowMasked)).toEqual([SEUIL_NON_VERIFIABLE, SEUIL_NON_VERIFIABLE, SEUIL_NON_VERIFIABLE, SEUIL_NON_VERIFIABLE]);
  });
});

// Même cas lu de bout en bout (référentiel PayFit fictif, détail par motif de KPI RH sur avril → mai 2026, seuil 5). Statuts PayFit
// comptés : approuvées (défaut) ; une absence en attente touche la période sans demi-journée comptée. Motif retenu : test_d (seul retenu
// présent : sa ligne égale la tuile). Demi-journées : aucune cellule de mois sous le seuil (test_a : 0 ; test_b, test_c, test_d : 5
// personnes en avril ; mai : test_d 5, les autres 0), aucune ligne masquée. Nombres de la lecture : 7, 8, 6, 10, tous ≥ 5 personnes.
const IDS2 = [...P("A", 1, 6), ...P("B", 1, 6), ...P("C", 1, 6), ...P("D", 1, 5)];
const edge2 = { collaborators: IDS2.map((id) => ({ id: `P-${id}` })), contracts: IDS2.map((id) => person(id)) };
const ABS2: AbsenceRow[] = [
  day("a1", "C-A1", "2026-04-06", "test_a", "pending_approval"),
  day("a2", "C-A2", "2026-04-07", "test_a", "pending_approval"),
  ...P("A", 2, 6).map((id, i) => day(`a-r${i}`, `C-${id}`, `2025-06-0${i + 2}`, "test_a")),
  ...P("B", 1, 5).map((id, i) => day(`b${i}`, `C-${id}`, `2026-04-1${i}`, "test_b")),
  day("b-bis1", "C-B1", "2026-04-20", "test_b"),
  day("b-bis2", "C-B2", "2026-04-21", "test_b"),
  day("b-r", "C-B6", "2025-06-10", "test_b"),
  ...P("C", 1, 5).map((id, i) => day(`c${i}`, `C-${id}`, `2026-04-2${i}`, "test_c")),
  day("c6", "C-C6", "2026-05-12", "test_c", "pending_approval"),
  ...P("D", 1, 5).flatMap((id, i) => [day(`d${i}-4`, `C-${id}`, `2026-04-0${i + 1}`, "test_d"), day(`d${i}-5`, `C-${id}`, `2026-05-0${i + 1}`, "test_d")]),
];

describe("absences de la période de bout en bout : détail par motif de KPI RH (seuil 5)", async () => {
  const data = await payfitEdgeBuild(edge2);
  const kin: KpiInput = kpiInput(data, readAbsences(ABS2, monthRange("2024-10", "2026-10")), { absenceTypes: ["test_d"] });
  const types2 = ["test_a", "test_b", "test_c", "test_d"];
  const render = (w: Window) => renderToStaticMarkup(h(AbsenceMotifsDetail, { motifs: absenceByMotif(kin, w), cells: motifWindow(kin, w), slug: "demo", confidentialite: set(5), typeSizes: absenceTypePersons(kin) }));

  it("personnes de la période lues dans le moteur : celles du cas écrit à la main", () => {
    const p = absenceByMotif(kin, W).period;
    const view = (x: { persons: string[]; unlinked: number; count: number }) => `${x.count}/${x.persons.length}+${x.unlinked}`;
    expect(types2.map((t) => [view(p.types[t].window), ...p.types[t].months.map(view), view(p.types[t].rest), p.types[t].offMonths])).toEqual([
      ["2/2+0", "2/2+0", "0/0+0", "5/5+0", 0],
      ["7/5+0", "7/5+0", "0/0+0", "1/1+0", 0],
      ["6/6+0", "5/5+0", "1/1+0", "0/0+0", 0],
      ["10/5+0", "5/5+0", "5/5+0", "0/0+0", 0],
    ]);
  });

  it("avril → mai : lignes et nombres de la lecture affichés ; « Absences de la période » : a, b, c n.d. ; d 10", () => {
    const html = render(W);
    expect(html).not.toContain("data-masque");
    expect(types2.map((t) => detailCount(html, t))).toEqual(["7", "8", "6", "10"]);
    expect(types2.map((t) => detailPeriod(html, t))).toEqual([R5, R5, R5, "10"]);
    // La ligne de test_a affiche 0 demi-journée (absences en attente) : son nombre d'absences de la période (2) n'est plus publié.
    expect(unescape(rowOf(html, "test_a")).replace(/<[^>]+>/g, " ").replace(/[\u00a0\u202f]/g, " ")).toMatch(/\b0 \(0 j\)/);
  });

  it("une fenêtre d'un mois : avril (c n.d. par son reste, C6 en mai), mai (a, b à 0 ; c : C6 seul, masqué ; d 5)", () => {
    const april: Window = { mode: "month", from: "2026-04", to: "2026-04", months: ["2026-04"], label: "avril 2026" };
    expect(types2.map((t) => detailPeriod(render(april), t))).toEqual([R5, R5, R5, "5"]);
    const may: Window = { mode: "month", from: "2026-05", to: "2026-05", months: ["2026-05"], label: "mai 2026" };
    expect(types2.map((t) => detailPeriod(render(may), t))).toEqual(["0", "0", R5, "5"]);
  });
});
