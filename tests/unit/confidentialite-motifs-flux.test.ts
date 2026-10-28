import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AbsenceMotifsDetail, AbsenceTypeNotes } from "@/app/e/[slug]/studio-rh/kpi/components";
import { suiviSheet } from "@/app/e/[slug]/studio-rh/kpi/export/sheets";
import { flowGuard } from "@/app/e/[slug]/studio-rh/kpi/flow-guard";
import { kpiSuiviOf } from "@/app/e/[slug]/studio-rh/kpi/suivi-data";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { monthRange } from "@/lib/connectors/months";
import { confidentialiteReason, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting } from "@/lib/confidentialite";
import { countedMovements } from "@/lib/confidentialite/flows";
import { csvCell, exportCell, screenTables } from "@/lib/croisee/export";
import { motifMonthMask, motifWindow, motifWindowMask, type CongeCell, type MotifWindow } from "@/lib/croisee/conges";
import { readCroiseeSettings } from "@/lib/croisee-settings";
import { KPI_DEFAULTS } from "@/lib/rh-kpi-settings";
import { absenceTypeChoices } from "@/lib/rh/kpi/absence";
import { absenceByMotif, absenceTypePersons } from "@/lib/rh/kpi/absence-motifs";
import { kpiDashboard } from "@/lib/rh/kpi/dashboard";
import { civilWindow, previousWindow } from "@/lib/rh/kpi/period";
import { rawPayfitHistory } from "@/lib/rh/raw-history";
import { monthMovements } from "@/lib/rh/kpi/turnover";
import type { KpiInput, Window } from "@/lib/rh/kpi/types";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { cellView, type CroiseeTable } from "@/lib/viz/croisee";
import { buildAbsences, congesMask, loadAbsencesInput, TABLE_IDS } from "@/lib/viz/croisee-absences";
import { countByNature, natureCells, type JournalEventIn } from "@/lib/viz/croisee-effectifs";
import { motifMask } from "@/lib/viz/kpi";
import { windowOf } from "@/lib/viz/synthese";
import { absence, DSN_ABSENCES, kpiInput, readAbsences } from "./helpers/kpi";
import { dsnBuild, dsnFixtureBuild, edgeFiles, payfitEdgeBuild } from "./helpers/rh";

// Lot 12, seconde relecture (revue 0, issues importantes n° 1 et n° 3) : une même cellule a le même statut sur tous les écrans qui la
// publient. Données entièrement fictives ; cas de référence calculés à la main dans les commentaires. Seuil de 5 personnes distinctes.
const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const R5 = confidentialiteReason(5); // « non affiché (seuil de confidentialité : 5 personnes) »
const R2 = confidentialiteReason(2);

// --- 1. Motifs d'absence : une seule fonction pour la colonne d'un mois (KPI RH › détail de l'absentéisme et croisée 03) ------------
//
// Cas de la relecture, fenêtre avril → mai 2026, seuil 5 :
//   R  motif retenu, seul retenu de la lecture : exempt (sa ligne égale la tuile Absentéisme).
//   X  5 personnes et 1 contrat non relié présent chaque mois, 14 demi-journées : avril x1, x2, x3 + non relié (8), mai x4, x5 + non
//      relié (6). Chaque mois : moins de 5 personnes reliées et un contrat non relié → mois non dénombré (non vérifiable).
//   Y  2 personnes, 4 demi-journées (avril) → masqué (principal) ; mai : 0.
//   Z  6 personnes, 6 demi-journées : avril z1, z2, z3, mai z4, z5, z6 (une demi-journée chacune) ; chaque mois 3 personnes (masqué).
// Règle canonique (lot 12, troisième relecture) : le statut d'un mois se calcule sur la seule colonne de son mois, le total de la
// fenêtre et le taux tous motifs se déduisent de leurs mois (windowStatus), sans relation propre.
//   Avril, autres motifs (somme publiée : tous motifs d'avril − absentéisme d'avril) : X (non vérifiable, aucune personne comptée),
//   Y (2) et Z (3) masqués comptent 2 + 3 = 5 personnes distinctes ≥ 5 et trois cellules : rien de plus ; tous motifs d'avril affiché.
//   Mai, autres motifs : X (non vérifiable) et Z (3) masqués ne comptent que 3 personnes ; Y (0) ne protège personne : impossible, le
//   taux tous motifs de mai (somme masquable) est masqué à son tour.
//   Fenêtre : R affiché ; X non vérifiable (ses deux mois le sont) ; Y et Z n.d. (un mois masqué) ; tous motifs n.d. (mai masqué).
// Pourquoi les attentes changent (avant : relations « mois d'un motif → son total » et colonne de la fenêtre, propres à la fenêtre) :
//   - total de X : « secondary » → « unverifiable ». Il n'est plus masqué par sa ligne mais déduit de ses mois, tous deux non
//     vérifiables : la raison affichée devient « effectif du groupe non dénombré » au lieu de celle du seuil (toujours n.d.) ;
//   - total de Y : « masked » → « secondary ». Un total de fenêtre n'a plus de masquage principal propre : il est n.d. parce qu'un de
//     ses mois est masqué (même raison du seuil à l'écran) ;
//   - total de Z : « shown » → « secondary ». Ses deux mois (3 personnes chacun) se protégeaient l'un l'autre dans la relation de la
//     ligne, qui n'existait que pour cette fenêtre ; pour avril → juin, la même ligne aurait donné un autre partage et Z(juin) =
//     Z(avril → juin) − Z(avril → mai). Un total qui contient un mois masqué est désormais n.d. pour toute fenêtre ;
//   - taux tous motifs : « shown » → « secondary ». Le taux tous motifs de mai (fenêtre d'un mois) est masqué : affiché sur avril →
//     mai, il se lirait par différence avec celui d'avril ;
//   - mois : inchangés (X non vérifiable, Y avril masqué, Z masqué, Y mai 0 affiché), mais ils valent pour toute fenêtre.
let seq = 0;
const tokens = (n: number): number[] => Array.from({ length: n }, () => seq++);
const xs = tokens(5);
const ys = tokens(2);
const zs = tokens(6);
const c = (half: number, who: number[], unlinked = 0): CongeCell => ({ kind: "exact", half, persons: who.length, unlinked, who });
const RXYZ: MotifWindow = {
  lines: [
    { type: "test_r", chosen: true, months: [c(2, [99]), c(0, [])], total: c(2, [99]) },
    { type: "test_x", chosen: false, months: [c(8, xs.slice(0, 3), 1), c(6, xs.slice(3), 1)], total: c(14, xs, 1) },
    { type: "test_y", chosen: false, months: [c(4, ys), c(0, [])], total: c(4, ys) },
    { type: "test_z", chosen: false, months: [c(3, zs.slice(0, 3)), c(3, zs.slice(3))], total: c(6, zs) },
  ],
  published: { months: [true, true], allMonths: [true, true], all: true },
};

describe("motifs d'absence : même cellule, même statut dans KPI RH et dans la croisée 03 (cas R / X / Y / Z écrit à la main)", () => {
  it("fonction partagée : mois de X non vérifiables, Y avril masqué, Z masqué chaque mois ; totaux déduits des mois ; R exempt", () => {
    const m = motifWindowMask(RXYZ, 5);
    expect(m.exempt).toBe(0);
    expect(m.months).toEqual([
      ["shown", "shown"],
      ["unverifiable", "unverifiable"],
      ["masked", "shown"],
      ["masked", "masked"],
    ]);
    expect(m.total).toEqual(["shown", "unverifiable", "secondary", "secondary"]);
    expect(m.all).toBe("secondary");
    // Colonnes des mois lues seules : celles de la fenêtre (le statut d'un mois ne dépend que de son mois).
    const col = (j: number) => motifMonthMask({ lines: RXYZ.lines.map((l) => ({ type: l.type, chosen: l.chosen, cell: l.months[j] })), published: { absenteeism: true, all: true } }, 5);
    expect(col(0)).toEqual({ lines: ["shown", "unverifiable", "masked", "masked"], all: "shown", exempt: 0 });
    expect(col(1)).toEqual({ lines: ["shown", "unverifiable", "shown", "masked"], all: "secondary", exempt: 0 });
  });
  it("KPI RH (motifMask) et croisée 03 (congesMask) : mêmes statuts de la fenêtre ; la croisée lit N-1 avec la même fonction", () => {
    const kpi = motifMask(RXYZ, 5);
    const croisee = congesMask({ current: RXYZ, previous: RXYZ }, 5);
    expect(kpi.lines).toEqual(croisee.cur);
    expect(croisee.prev).toEqual(croisee.cur);
    expect(kpi.all).toBe(croisee.allCur);
    // Aucun autre motif ni le taux tous motifs ne sont affichés sur la fenêtre : rien ne se lit par différence. En avril, seule somme
    // publiée des autres motifs, X + Y + Z = tous motifs − R couvre trois cellules masquées et 5 personnes distinctes comptées.
    expect(kpi.lines.flatMap((s, i) => (i > 0 && s === "shown" ? [i] : []))).toEqual([]);
    expect(croisee.cur.flatMap((s, i) => (i > 0 && s === "shown" ? [i] : []))).toEqual([]);
  });
  it("ordre canonique : les lignes reçues dans un autre ordre donnent les mêmes statuts à chaque motif", () => {
    const reversed: MotifWindow = { ...RXYZ, lines: [...RXYZ.lines].reverse() };
    const m = motifWindowMask(reversed, 5);
    expect([...m.total].reverse()).toEqual(motifWindowMask(RXYZ, 5).total);
    expect([...m.months].reverse()).toEqual(motifWindowMask(RXYZ, 5).months);
  });
});

// Même cas lu de bout en bout dans un référentiel PayFit fictif : les deux écrans partent du moteur (KPI RH : absenceByMotif et
// motifWindow sur la fenêtre de son détail ; croisée : loadAbsencesInput puis buildAbsences sur la période avril → mai 2026).
const person = (id: string, startDate = "2025-01-01") => ({ contractId: `C-${id}`, collaboratorId: `P-${id}`, startDate, endDate: null });
const edge = {
  collaborators: ["R1", "X1", "X2", "X3", "X4", "X5", "Y1", "Y2", "Z1", "Z2", "Z3", "Z4", "Z5", "Z6"].map((id) => ({ id: `P-${id}` })),
  contracts: [...["R1", "X1", "X2", "X3", "X4", "X5", "Y1", "Y2", "Z1", "Z2", "Z3", "Z4", "Z5", "Z6"].map((id) => person(id)), { contractId: "C-XU", collaboratorId: null, startDate: "2025-01-01", endDate: null }],
};
// Base calendaire (défaut) : une journée = 2 demi-journées ; « début de journée → mi-journée » le même jour = 1 demi-journée.
const day = (id: string, contract: string, date: string, type: string) => absence(id, contract, date, "beginning-of-day", date, "end-of-day", { type });
const half = (id: string, contract: string, date: string, type: string) => absence(id, contract, date, "beginning-of-day", date, "middle-of-day", { type });
const ABS = [
  day("r1", "C-R1", "2026-04-01", "test_r"),
  day("x1", "C-X1", "2026-04-06", "test_x"),
  day("x2", "C-X2", "2026-04-07", "test_x"),
  day("x3", "C-X3", "2026-04-08", "test_x"),
  day("xu1", "C-XU", "2026-04-09", "test_x"),
  day("x4", "C-X4", "2026-05-04", "test_x"),
  day("x5", "C-X5", "2026-05-05", "test_x"),
  day("xu2", "C-XU", "2026-05-06", "test_x"),
  day("y1", "C-Y1", "2026-04-14", "test_y"),
  day("y2", "C-Y2", "2026-04-15", "test_y"),
  half("z1", "C-Z1", "2026-04-20", "test_z"),
  half("z2", "C-Z2", "2026-04-21", "test_z"),
  half("z3", "C-Z3", "2026-04-22", "test_z"),
  half("z4", "C-Z4", "2026-05-11", "test_z"),
  half("z5", "C-Z5", "2026-05-12", "test_z"),
  half("z6", "C-Z6", "2026-05-13", "test_z"),
];
const MONTHS = ["2026-04", "2026-05"];
const W: Window = { mode: "civil", from: "2026-04", to: "2026-05", months: MONTHS, label: "avril → mai 2026" };

function fakeCtx(kpi: KpiContext, months: string[], seuil: number): CroiseeContext {
  const prevMonths = months.map((m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`);
  return {
    slug: "demo",
    canEdit: false,
    period: { year: Number(months[0].slice(0, 4)), from: months[0].slice(5), to: months[months.length - 1].slice(5), years: [], last: "", months, notices: [] },
    periodNd: null,
    prevMonths,
    labels: { period: "avril → mai 2026", prev: "avril → mai 2025" },
    service: { options: [], axis: null, reason: null, value: undefined, label: "Tous les services" },
    settings: readCroiseeSettings(new Map([["rh.croisee.confidentialite", { value: seuil }]])),
    affichage: "tout",
    href: () => "/e/demo/studio-rh/masse-salariale/croisee?chapitre=absences",
    load: { kpi: async () => kpi },
  } as unknown as CroiseeContext;
}
const fakeKpi = (input: KpiInput): KpiContext => ({ collab: { source: { chosen: "payfit", reason: "source retenue" }, state: null }, settings: { invalid: [] }, input, readTypes: [] }) as unknown as KpiContext;
const tableOf = (tables: CroiseeTable[], id: string): CroiseeTable => tables.find((t) => t.id === id)!;
const rowText = (t: CroiseeTable, i: number) => t.columns.map((col, j) => cellView(t.rows[i].cells[j], col, t.rows[i]).text.replace(/[  ]/g, " "));
const rowOf = (html: string, type: string) => new RegExp(`<tr data-motif="${type}"[\\s\\S]*?</tr>`).exec(html)![0];
const masque = (html: string, type: string) => /data-masque="oui"/.test(rowOf(html, type));
// Valeur publiée d'un nombre d'absences : le nombre, ou la raison de son n.d. (abbr au survol, ou cellule « n.d. — raison »).
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/<!-- -->/g, "");
const shownCount = (fragment: string): string => {
  const abbr = /<abbr class="nd" title="([^"]*)">n\.d\.<\/abbr>/.exec(fragment);
  if (abbr) return unescape(abbr[1]);
  const nd = /n\.d\. — ([^<]*)/.exec(unescape(fragment));
  return nd ? nd[1].trim() : unescape(fragment).replace(/<[^>]*>/g, "").trim();
};
// « Absences de la lecture » du détail par motif : la deuxième cellule de la ligne. Nombre du bloc « Motifs de la lecture » de la tuile.
const detailCount = (html: string, type: string) => shownCount([...rowOf(html, type).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)][1][1]);
const notesCount = (html: string, type: string) => shownCount(new RegExp(`${type}</code> \\(([\\s\\S]*?)\\)</span>`).exec(unescape(html))![1]);
const notesOf = (kin: KpiInput, seuil: number) => {
  const all = absenceTypeChoices(kin).filter((x) => x.inRead);
  return renderToStaticMarkup(h(AbsenceTypeNotes, { chosen: all.filter((x) => x.chosen), other: all.filter((x) => !x.chosen), missing: [], slug: "demo", mask: { setting: set(seuil), sizes: absenceTypePersons(kin) } }));
};

describe("motifs d'absence de bout en bout : KPI RH et croisée 03 sur le même référentiel fictif (seuil 5)", async () => {
  const data = await payfitEdgeBuild(edge);
  const kin = kpiInput(data, readAbsences(ABS, monthRange("2024-10", "2026-10")), { absenceTypes: ["test_r"] });

  it("cellules lues dans le moteur : celles du cas écrit à la main (demi-journées, personnes, contrat non relié)", () => {
    const g = motifWindow(kin, W);
    // Absentéisme et taux tous motifs publiés pour chaque mois et pour la fenêtre (avant : tuile et taux tous motifs de la fenêtre).
    expect(g.published).toEqual({ months: [true, true], allMonths: [true, true], all: true });
    expect(g.lines.map((l) => l.type)).toEqual(["test_r", "test_x", "test_y", "test_z"]);
    const view = g.lines.map((l) => [l.chosen, ...l.months, l.total].map((x) => (typeof x === "boolean" ? x : x && x.kind !== "nd" ? `${x.half}/${x.persons}+${x.unlinked}` : "nd")));
    expect(view).toEqual([
      [true, "2/1+0", "0/0+0", "2/1+0"],
      [false, "8/3+1", "6/2+1", "14/5+1"],
      [false, "4/2+0", "0/0+0", "4/2+0"],
      [false, "3/3+0", "3/3+0", "6/6+0"],
    ]);
    // Statuts du cas écrit à la main (voir plus haut pourquoi X, Y, Z et le taux tous motifs changent).
    expect(motifMask(g, 5)).toEqual({ lines: ["shown", "unverifiable", "secondary", "secondary"], all: "secondary", exempt: 0 });
  });

  it("KPI RH (détail par motif) et croisée 03 (tableau par motif, demi-journées prises, tous motifs) : X, Y, Z n.d., R affiché", async () => {
    const html = renderToStaticMarkup(h(AbsenceMotifsDetail, { motifs: absenceByMotif(kin, W), cells: motifWindow(kin, W), slug: "demo", confidentialite: set(5), typeSizes: absenceTypePersons(kin) }));
    // Avant : Z affiché (6). Z(avril) et Z(mai) sont masqués dans leur colonne : son total est n.d. pour toute fenêtre.
    expect(["test_r", "test_x", "test_y", "test_z"].map((t) => masque(html, t))).toEqual([false, true, true, true]);
    expect(/<p[^>]*data-testid="kpi-detail-motifs-all"[^>]*>([\s\S]*?)<\/p>/.exec(html)![1].replace(/<!-- -->/g, "")).toBe(`n.d. — ${R5}`);
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(fakeKpi(kin), MONTHS, 5)));
    const motifs = tableOf(m.tables, TABLE_IDS.motifs);
    expect([0, 1, 2, 3].map((i) => rowText(motifs, i).slice(0, 3))).toEqual([
      ["test_r", "oui", "2"],
      ["test_x", "non", "n.d."],
      ["test_y", "non", "n.d."],
      ["test_z", "non", "n.d."],
    ]);
    // X : total déduit de deux mois non vérifiables (avant : masqué en second, raison du seuil) ; Y et Z : un mois masqué.
    expect(motifs.rows.slice(1).map((r) => r.cells[2])).toEqual([{ nd: SEUIL_NON_VERIFIABLE }, { nd: R5 }, { nd: R5 }]);
    // Demi-journées prises : mêmes totaux que le tableau par motif ; mois de X non vérifiables, Y(avril) et mois de Z masqués.
    const conges = tableOf(m.tables, TABLE_IDS.conges);
    expect([0, 1, 2, 3].map((i) => rowText(conges, i).slice(0, 4))).toEqual([
      ["test_r", "2", "0", "2"],
      ["test_x", "n.d.", "n.d.", "n.d."],
      ["test_y", "n.d.", "0", "n.d."],
      ["test_z", "n.d.", "n.d.", "n.d."],
    ]);
    // Taux tous motifs de la période : n.d. (celui de mai est masqué), comme dans le détail de KPI RH.
    expect(tableOf(m.tables, TABLE_IDS.tousMotifs).rows[0].cells.slice(1, 3)).toEqual([{ nd: R5 }, { nd: R5 }]);
  });

  it("nombres d'absences par motif : même statut dans le détail par motif et dans la tuile (typeCountMask), quelle que soit la fenêtre", () => {
    // Toute la lecture : R 1 absence (R1, 1 personne : masqué) ; X 7 absences (X1 à X5 reliés, 5 ≥ 5, et le contrat non relié :
    // affiché, la ligne restant n.d.) ; Y 2 absences (2 personnes : masqué) ; Z 6 absences (6 personnes). Une seule colonne, dont
    // Données › lecture publie le total (1 + 7 + 2 + 6 = 16) : R et Y masqués ne comptent que 3 personnes ; la plus petite cellule
    // affichée qui en apporte, Z (6 < 7), est masquée en second (3 + 6 = 9 ≥ 5). Avant (masquage principal seul) : Z affiché, et
    // R + Y = 16 − 7 − 6 = 3 se lisait par différence. Avant le lot 12, le détail affichait R (1) et Y masqué avec sa ligne, la tuile
    // masquait R : une même cellule avait deux statuts.
    const html = renderToStaticMarkup(h(AbsenceMotifsDetail, { motifs: absenceByMotif(kin, W), cells: motifWindow(kin, W), slug: "demo", confidentialite: set(5), typeSizes: absenceTypePersons(kin) }));
    const notes = notesOf(kin, 5);
    const types = ["test_r", "test_x", "test_y", "test_z"];
    expect(types.map((t) => detailCount(html, t))).toEqual([R5, "7", R5, R5]);
    expect(types.map((t) => notesCount(notes, t))).toEqual(types.map((t) => detailCount(html, t)));
    // Une autre fenêtre (avril seul) : mêmes nombres, mêmes statuts.
    const april: Window = { mode: "civil", from: "2026-04", to: "2026-04", months: ["2026-04"], label: "avril 2026" };
    const html1 = renderToStaticMarkup(h(AbsenceMotifsDetail, { motifs: absenceByMotif(kin, april), cells: motifWindow(kin, april), slug: "demo", confidentialite: set(5), typeSizes: absenceTypePersons(kin) }));
    expect(types.map((t) => detailCount(html1, t))).toEqual([R5, "7", R5, R5]);
  });
});

// --- 1 bis. Un mois masqué pour une période l'est pour toute période qui le contient (janvier → mars, janvier → juin, l'année) ------
//
// Année 2025, seuil 5, quatre motifs présents dans la lecture ; absentéisme et taux tous motifs publiés chaque mois.
//   test_a  non retenu ; A1, 2 demi-journées en mars (1 personne).
//   test_b  non retenu ; B1 à B5 chaque mois de janvier à juin : 8, 7, 6, 5, 9, 9 demi-journées (5 personnes chaque mois), rien ensuite.
//   test_c  non retenu ; C1 à C6, 12 demi-journées chaque mois de janvier à juin (6 personnes), rien ensuite.
//   test_r  retenu, seul retenu de la lecture : exempt ; R1, 2 demi-journées en mars.
// Colonne de mars, autres motifs (somme publiée : tous motifs de mars − absentéisme de mars) : A (1 personne) est masqué ; l'ensemble
// masqué doit compter au moins 5 personnes : la plus petite cellule affichée qui en apporte, B (6 demi-journées, 5 personnes), est masquée
// en second (1 + 5 = 6 ≥ 5, deux cellules) ; C (12) reste affiché. Aucun autre mois ne contient de cellule sous le seuil.
// Attendu, pour janvier → mars comme pour janvier → juin et pour l'année : A(mars) masqué, B(mars) masqué en second, tous les autres mois
// affichés ; totaux de A et de B n.d. (un mois masqué), C et R affichés ; taux tous motifs affiché (aucun mois masqué).
// Avant la correction, B(mars) n'était masqué que sur janvier → mars : le total de B, masqué en second dans la colonne de la fenêtre
// (B : 21 < C : 36 ; 44 < 72 sur six mois et sur l'année), faisait masquer le plus petit mois de B dans la fenêtre : mars (6) sur
// janvier → mars, avril (5) sur janvier → juin et sur l'année. B(mars) affiché sur janvier → juin donnait alors
// A(mars) = tous motifs de mars − R(mars) − B(mars) − C(mars), la valeur d'une personne.
let jeton = 1000;
const who = (n: number): number[] => Array.from({ length: n }, () => jeton++);
const PLAN: Record<string, { chosen: boolean; who: number[]; half: number[] }> = {
  test_a: { chosen: false, who: who(1), half: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  test_b: { chosen: false, who: who(5), half: [8, 7, 6, 5, 9, 9, 0, 0, 0, 0, 0, 0] },
  test_c: { chosen: false, who: who(6), half: [12, 12, 12, 12, 12, 12, 0, 0, 0, 0, 0, 0] },
  test_r: { chosen: true, who: who(1), half: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
};
// Fenêtre des n premiers mois : la cellule d'un mois porte les personnes du motif quand il a des demi-journées ; total = somme.
const firstMonths = (n: number): MotifWindow => ({
  lines: Object.entries(PLAN).map(([type, p]) => {
    const half = p.half.slice(0, n);
    const sum = half.reduce((s, x) => s + x, 0);
    return { type, chosen: p.chosen, months: half.map((x) => c(x, x ? p.who : [])), total: c(sum, sum ? p.who : []) };
  }),
  published: { months: Array(n).fill(true), allMonths: Array(n).fill(true), all: true },
});
const statusesOf = (n: number) => {
  const shown = Array<string>(n).fill("shown");
  const at = (j: number, s: string) => shown.map((x, i) => (i === j ? s : x));
  return { months: [at(2, "masked"), at(2, "secondary"), shown, shown], total: ["secondary", "secondary", "shown", "shown"], all: "shown", exempt: 3 };
};

describe("motifs d'absence : un mois masqué pour janvier → mars l'est aussi pour janvier → juin et pour l'année (cas écrit à la main)", () => {
  it("fonction partagée : mêmes statuts de mars et des totaux sur les trois fenêtres", () => {
    for (const n of [3, 6, 12]) expect(motifWindowMask(firstMonths(n), 5), `${n} mois`).toEqual(statusesOf(n));
  });
  it("colonne de mars lue seule : A masqué, B masqué en second, C et R affichés, taux tous motifs de mars affiché", () => {
    const march = motifMonthMask({ lines: firstMonths(3).lines.map((l) => ({ type: l.type, chosen: l.chosen, cell: l.months[2] })), published: { absenteeism: true, all: true } }, 5);
    expect(march).toEqual({ lines: ["masked", "secondary", "shown", "shown"], all: "shown", exempt: 3 });
  });
});

// Même cas lu de bout en bout dans un référentiel PayFit fictif en mode brut (historique sans limite de conservation : tous les mois
// de 2025 sont exacts) : KPI RH (détail de l'absentéisme sur la fenêtre et sur N-1) et croisée 03 (période janvier → mars, janvier →
// juin, année 2025 ; colonne N-1 de l'année 2026), tableau et export (mêmes cellules du modèle).
const ids = ["R1", "A1", "B1", "B2", "B3", "B4", "B5", "C1", "C2", "C3", "C4", "C5", "C6"];
const edge2025 = { collaborators: ids.map((id) => ({ id: `P-${id}` })), contracts: ids.map((id) => person(id, "2024-06-01")) };
const D = (month: number, d: number) => `2025-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
// B, chaque mois de janvier à juin : [jours entiers, demi-journées] répartis sur B1 à B5 → 8, 7, 6, 5, 9, 9 demi-journées.
const B_PLAN: [number, number][] = [
  [3, 2],
  [2, 3],
  [1, 4],
  [0, 5],
  [4, 1],
  [4, 1],
];
const ABS_2025 = [
  day("r1", "C-R1", "2025-03-03", "test_r"),
  day("a1", "C-A1", "2025-03-04", "test_a"),
  ...B_PLAN.flatMap(([days], i) => [1, 2, 3, 4, 5].map((k) => (k <= days ? day : half)(`b${k}-${i + 1}`, `C-B${k}`, D(i + 1, 10 + k), "test_b"))),
  ...[1, 2, 3, 4, 5, 6].flatMap((month) => [1, 2, 3, 4, 5, 6].map((k) => day(`c${k}-${month}`, `C-C${k}`, D(month, 20 + k), "test_c"))),
];
const months2025 = (n: number) => monthRange("2025-01", "2025-12").slice(0, n);

describe("motifs d'absence de bout en bout : mars masqué pour toute période de 2025 et pour N-1, sur les deux écrans (seuil 5)", async () => {
  const data = rawPayfitHistory(await payfitEdgeBuild(edge2025));
  const kin = kpiInput(data, readAbsences(ABS_2025, monthRange("2024-10", "2026-10")), { absenceTypes: ["test_r"] });
  const TYPES = ["test_a", "test_b", "test_c", "test_r"];

  it("cellules lues dans le moteur : celles du cas écrit à la main ; KPI RH (détail) : mêmes statuts sur les trois fenêtres", () => {
    for (const n of [3, 6, 12]) {
      const g = motifWindow(kin, windowOf(months2025(n)));
      expect(g.lines.map((l) => l.type)).toEqual(TYPES);
      expect(g.lines.map((l) => l.months.map((x) => (x && x.kind !== "nd" ? `${x.half}/${x.persons}` : "nd"))), `${n} mois`).toEqual(
        TYPES.map((t) => PLAN[t].half.slice(0, n).map((x) => `${x}/${x ? PLAN[t].who.length : 0}`)),
      );
      expect(g.published).toEqual({ months: Array(n).fill(true), allMonths: Array(n).fill(true), all: true });
      expect(motifWindowMask(g, 5), `${n} mois`).toEqual(statusesOf(n));
      const html = renderToStaticMarkup(h(AbsenceMotifsDetail, { motifs: absenceByMotif(kin, windowOf(months2025(n))), cells: g, slug: "demo", confidentialite: set(5), typeSizes: absenceTypePersons(kin) }));
      expect(TYPES.map((t) => masque(html, t)), `${n} mois`).toEqual([true, true, false, false]);
    }
  });

  it("croisée 03 : B(mars) n.d. pour janvier → mars, janvier → juin et l'année ; totaux de A et B n.d. ; C, R et tous motifs affichés", async () => {
    for (const n of [3, 6, 12]) {
      const m = buildAbsences(await loadAbsencesInput(fakeCtx(fakeKpi(kin), months2025(n), 5)));
      const conges = tableOf(m.tables, TABLE_IDS.conges);
      // Colonne 3 : mars 2025 (colonne 0 : le motif).
      expect([0, 1, 2, 3].map((i) => conges.rows[i].cells[3]), `${n} mois`).toEqual([{ nd: R5 }, { nd: R5 }, 12, 2]);
      expect(conges.rows[1].cells.slice(1, n + 1).map((x) => (typeof x === "number" ? x : "n.d.")), `${n} mois`).toEqual(PLAN.test_b.half.slice(0, n).map((x, j) => (j === 2 ? "n.d." : x)));
      // Export Excel et CSV : le tableau de l'écran, la même cellule n.d. avec la même raison.
      expect(screenTables(m).map((t) => t.id)).toContain(TABLE_IDS.conges);
      expect(exportCell(conges.rows[1].cells[3], conges.columns[3])).toEqual({ nd: R5 });
      expect(csvCell(conges.rows[1].cells[3], conges.columns[3])).toBe(`n.d. (${R5})`);
      const motifs = tableOf(m.tables, TABLE_IDS.motifs);
      expect([0, 1, 2, 3].map((i) => rowText(motifs, i).slice(0, 3)), `${n} mois`).toEqual([
        ["test_a", "non", "n.d."],
        ["test_b", "non", "n.d."],
        ["test_c", "non", `${12 * Math.min(n, 6)}`],
        ["test_r", "oui", "2"],
      ]);
      expect(rowText(tableOf(m.tables, TABLE_IDS.tousMotifs), 0)[1], `${n} mois`).not.toBe("n.d.");
    }
  });

  it("N-1 : la colonne N-1 de la croisée (année 2026) et le détail N-1 de KPI RH (année 2025) donnent les mêmes statuts que la période 2025", async () => {
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(fakeKpi(kin), monthRange("2026-01", "2026-12"), 5)));
    const motifs = tableOf(m.tables, TABLE_IDS.motifs);
    // Colonnes 4 et 5 : demi-journées et taux N-1 (année 2025).
    expect([0, 1, 2, 3].map((i) => rowText(motifs, i)[4])).toEqual(["n.d.", "n.d.", "72", "2"]);
    expect(motifs.rows[1].cells[4]).toEqual({ nd: R5 });
    const conges = tableOf(m.tables, TABLE_IDS.conges);
    const n1 = conges.columns.findIndex((col) => col.key === "n1");
    expect([0, 1, 2, 3].map((i) => conges.rows[i].cells[n1])).toEqual([{ nd: R5 }, { nd: R5 }, 72, 2]);
    // KPI RH, détail N-1 de l'année 2026 : la fenêtre précédente (année 2025), la même fonction.
    const prev = previousWindow(civilWindow(2026));
    expect(prev.months).toEqual(monthRange("2025-01", "2025-12"));
    expect(motifMask(motifWindow(kin, prev), 5).lines).toEqual(statusesOf(12).total);
  });
});

// --- 2. Entrées et sorties du périmètre retenu par un filtre : même partition et mêmes statuts que la croisée 02 -----------------------
//
// DSN fictives d'octobre 2025 à septembre 2026 (mois tous complets), trois natures comptées : CDI (01), CDD (02) et une troisième nature
// (« 07 », tenue ici pour les apprentis du cas de la relecture), cinq personnes chacune depuis le 01/01/2025 (chaque nature compte au
// moins 5 personnes à chaque fin de mois : la garde des effectifs ne masque rien). Avril 2026 : 2 entrées CDI (K-6 le 01/04, K-7 le
// 15/04), 1 entrée CDD (K-16 le 10/04), aucune pour la troisième nature ; total des entrées d'avril publié : 3 ; aucune sortie. Seuil 5.
// Croisée 02, « dont » d'avril : CDI 2 personnes et CDD 1 (masqués) comptent 3 personnes < 5 ; la troisième nature (0 entrée) ne
// protège personne : impossible, toute la relation (CDI, CDD) est n.d. ; la cellule 07 (0 entrée) ne décrit personne et reste hors de la
// relation, affichée à 0 (règle canonique des colonnes, lot 12 : avant, la croisée la masquait aussi, alors que la grille des Effectifs
// mensuels, sans groupe 07 cette année-là, publiait déjà CDI + CDD = 3 = le total). KPI RH, filtre Nature : l'entrée d'avril du
// périmètre est cette cellule, donc n.d. pour CDI et CDD, 0 pour la troisième nature. La ligne « Période » des entrées et le turnover
// de la période (moyenne des entrées et des sorties, défaut), qui la contiennent, sont n.d. ; les autres mois (0 entrée) et les sorties
// (0) restent affichés.
const NATURES = ["01", "02", "07"];
const worker = (i: number, nature: string, start = "2025-01-01") => ({ start, person: { nir: `2990175${100000 + i}`, employeeNumber: `E${i}`, contracts: [{ number: `K-${i}`, start, nature, gross: "1000.00" }] } });
const PEOPLE = [
  ...[1, 2, 3, 4, 5].map((i) => worker(i, "01")),
  worker(6, "01", "2026-04-01"),
  worker(7, "01", "2026-04-15"),
  ...[11, 12, 13, 14, 15].map((i) => worker(i, "02")),
  worker(16, "02", "2026-04-10"),
  ...[21, 22, 23, 24, 25].map((i) => worker(i, "07")),
];
const natureSpecs = monthRange("2025-10", "2026-09").map((month) => ({ month, people: PEOPLE.filter((p) => p.start <= `${month}-31`).map((p) => p.person) }));
const ctxOf = (input: KpiInput, establishments: { id: string; label: string }[], codes: string[]) =>
  ({
    collab: { workspace: { id: "w1", name: "Espace fictif", slug: "demo", role: "reader" }, establishments, natures: { codes, origin: "default" }, payfitHistory: null, state: null },
    settings: { values: KPI_DEFAULTS, origins: {}, invalid: [] },
    input: { ...input, openMonths: [] },
    readTypes: [],
  }) as unknown as KpiContext;
const ready = (ctx: KpiContext, sp: Record<string, string>, conf: ConfidentialiteSetting) => {
  const s = kpiSuiviOf(ctx, sp, conf);
  if (s.kind !== "ready") throw new Error("contexte fictif incomplet");
  return s;
};

describe("flux du périmètre sous le filtre Nature : n.d. comme la cellule « dont <nature> » de la croisée 02 (seuil 5)", async () => {
  const data = await dsnBuild(edgeFiles(natureSpecs));
  const base = kpiInput(data, DSN_ABSENCES, { natures: NATURES });
  const ctx = ctxOf(base, [], NATURES);

  it("croisée 02 (journal des mouvements) : « dont CDI » et « dont CDD » d'avril 2026 n.d., « dont 07 » à 0 ; total 3 publié", () => {
    // Mouvements comptés d'avril, tels que loadEffectifsInput les forme (jetons de contrat et de personne, aucune clé de la source).
    const mv = monthMovements(base, "2026-04");
    expect(mv.entries).toMatchObject({ kind: "exact", value: 3 });
    const tok = new Map<string, string>();
    const t = (key: string) => tok.get(key) ?? (tok.set(key, `t${tok.size}`), tok.get(key)!);
    const events: JournalEventIn[] = countedMovements(mv).map((x) => ({ month: "2026-04", kind: x.row.event.kind, nature: x.row.event.nature, endReason: x.row.event.endReason, contract: t(x.row.contract.contractKey), person: x.row.contract.personKey && t(x.row.contract.personKey) }));
    const counts = countByNature(events, "2026-04", "entry");
    expect(Object.fromEntries(Object.entries(counts).map(([n, x]) => [n, x.contracts]))).toEqual({ "01": 2, "02": 1 });
    expect(natureCells(counts, NATURES, mv.entries, 5)).toEqual([{ nd: R5 }, { nd: R5 }, 0]);
  });

  it("KPI RH, filtres CDI puis CDD : entrées d'avril n.d. (raison du seuil), ligne Période et turnover n.d. ; mars et les sorties restent ; 07 : 0 affiché", () => {
    for (const nature of ["01", "02"]) {
      const s = ready(ctx, { nature }, set(5));
      expect(s.guard, nature).toBeNull(); // effectifs du périmètre affichés (au moins 5 personnes à chaque fin de mois)
      expect(s.flows?.months.get("2026-04"), nature).toEqual({ entries: R5 });
      const april = s.dash.rows.find((r) => r.month === "2026-04")!;
      expect(april.movements.entries, nature).toEqual({ kind: "nd", nd: { code: "confidentialite", reason: R5 } });
      expect(april.movements.exits, nature).toMatchObject({ kind: "exact", value: 0 });
      expect(s.dash.rows.find((r) => r.month === "2026-03")!.movements.entries, nature).toMatchObject({ kind: "exact", value: 0 });
      expect(s.dash.movements.entries, nature).toMatchObject({ kind: "nd", nd: { reason: R5 } });
      expect(s.dash.movements.exits, nature).toMatchObject({ kind: "exact", value: 0 });
      // Turnover de la période (moyenne des entrées et des sorties, défaut) : il contient avril, n.d. ; l'écart avec N-1 aussi.
      const raw = kpiDashboard(s.input, s.w).tiles.turnover.current;
      expect(raw.kind, nature).toBe("exact");
      expect(s.dash.tiles.turnover.current, nature).toMatchObject({ kind: "nd", nd: { reason: R5 } });
      expect(s.dash.tiles.turnover.delta.kind, nature).toBe("nd");
    }
    // Filtre 07 : 0 entrée en avril, comme la cellule « dont 07 » de la croisée ; rien n'est masqué.
    const s07 = ready(ctx, { nature: "07" }, set(5));
    expect(s07.flows?.months.size).toBe(0);
    expect(s07.dash.rows.find((r) => r.month === "2026-04")!.movements.entries).toMatchObject({ kind: "exact", value: 0 });
    // Sans masquage, la valeur filtrée serait celle que la croisée masque : 2 (CDI), 1 (CDD) ; 0 (07), affiché partout.
    const raw = NATURES.map((nature) => {
      const s = ready(ctx, { nature }, set(5));
      return kpiDashboard(s.input, s.w).rows.find((r) => r.month === "2026-04")!.movements.entries;
    });
    expect(raw.map((x) => (x.kind === "nd" ? null : x.value))).toEqual([2, 1, 0]);
  });

  it("export du Suivi : la cellule « Entrées » d'avril porte la même raison que l'écran", () => {
    const s = ready(ctx, { nature: "02" }, set(5));
    const sh = suiviSheet({ dash: s.dash, data: s.data, establishments: s.input.scope.establishments, rawLimit: s.rawLimit, vue: "suivi" });
    const col = sh.columns.findIndex((x) => x.header === "Entrées");
    expect(col).toBeGreaterThan(0);
    expect(sh.rows.find((r) => r[0] === "2026-04")![col]).toEqual({ nd: R5 });
    expect(sh.rows.find((r) => r[0] === "2026-03")![col]).toBe(0);
  });

  it("sans filtre : aucune garde des flux, entrées d'avril affichées (3) ; seuil 1 : rien n'est masqué sous le filtre", () => {
    const s = ready(ctx, {}, set(5));
    expect(s.flows).toBeNull();
    expect(s.dash.rows.find((r) => r.month === "2026-04")!.movements.entries).toMatchObject({ kind: "exact", value: 3 });
    const one = ready(ctx, { nature: "01" }, set(1));
    expect(one.flows?.months.size).toBe(0);
    expect(one.dash.rows.find((r) => r.month === "2026-04")!.movements.entries).toMatchObject({ kind: "exact", value: 2 });
  });
});

// Filtre Établissement (même règle, partition par établissement, total de l'entreprise publié). DSN fictive à un établissement : le
// contrat 002 entre le 01/04/2025 (1 personne). Seuil 2 : l'établissement compte 6 à 7 personnes à chaque fin de mois (effectifs
// affichés) ; son entrée d'avril 2025 est une cellule de 1 personne, seule de sa répartition : n.d. avec la raison du seuil.
describe("flux du périmètre sous le filtre Établissement (DSN fictive, seuil 2)", () => {
  const dsn = dsnFixtureBuild();
  const ETAB = "00000000000011";
  const ctx = ctxOf(kpiInput(dsn, DSN_ABSENCES), [{ id: ETAB, label: "SIRET fictif" }], ["01", "02"]);
  it("entrée d'avril 2025 n.d. ; les mois sans mouvement restent ; fonction pure : même résultat", () => {
    const s = ready(ctx, { fin: "2025-12", etab: ETAB }, set(2));
    expect(s.guard).toBeNull();
    expect(s.dash.rows.find((r) => r.month === "2025-04")!.movements.entries).toEqual({ kind: "nd", nd: { code: "confidentialite", reason: R2 } });
    expect(s.dash.movements.entries).toMatchObject({ kind: "nd", nd: { reason: R2 } });
    const g = flowGuard({ base: ctx.input!, scope: s.input.scope, months: ["2025-04", "2025-05"], establishments: [ETAB], natures: ["01", "02"], seuil: 2 });
    expect(g?.months.get("2025-04")?.entries).toBe(R2);
    expect(g?.months.get("2025-05")).toBeUndefined();
  });
});
