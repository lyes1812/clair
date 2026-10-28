import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AbsenceMotifsDetail } from "@/app/e/[slug]/studio-rh/kpi/components";
import { suiviSheet } from "@/app/e/[slug]/studio-rh/kpi/export/sheets";
import { flowGuard } from "@/app/e/[slug]/studio-rh/kpi/flow-guard";
import { kpiSuiviOf } from "@/app/e/[slug]/studio-rh/kpi/suivi-data";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { monthRange } from "@/lib/connectors/months";
import { confidentialiteReason, type ConfidentialiteSetting } from "@/lib/confidentialite";
import { countedMovements } from "@/lib/confidentialite/flows";
import { motifWindow, motifWindowMask, type CongeCell, type MotifWindow } from "@/lib/croisee/conges";
import { readCroiseeSettings } from "@/lib/croisee-settings";
import { KPI_DEFAULTS } from "@/lib/rh-kpi-settings";
import { absenceByMotif } from "@/lib/rh/kpi/absence-motifs";
import { kpiDashboard } from "@/lib/rh/kpi/dashboard";
import { monthMovements } from "@/lib/rh/kpi/turnover";
import type { KpiInput, Window } from "@/lib/rh/kpi/types";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { cellView, type CroiseeTable } from "@/lib/viz/croisee";
import { buildAbsences, congesMask, loadAbsencesInput, TABLE_IDS } from "@/lib/viz/croisee-absences";
import { countByNature, natureCells, type JournalEventIn } from "@/lib/viz/croisee-effectifs";
import { motifMask } from "@/lib/viz/kpi";
import { absence, DSN_ABSENCES, kpiInput, readAbsences } from "./helpers/kpi";
import { dsnBuild, dsnFixtureBuild, edgeFiles, payfitEdgeBuild } from "./helpers/rh";

// Lot 12, seconde relecture (revue 0, issues importantes n° 1 et n° 3) : une même cellule a le même statut sur tous les écrans qui la
// publient. Données entièrement fictives ; cas de référence calculés à la main dans les commentaires. Seuil de 5 personnes distinctes.
const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const R5 = confidentialiteReason(5); // « non affiché (seuil de confidentialité : 5 personnes) »
const R2 = confidentialiteReason(2);

// --- 1. Motifs d'absence : une seule fonction pour la colonne d'une fenêtre (KPI RH › détail de l'absentéisme et croisée 03) ----------
//
// Cas de la relecture, fenêtre avril → mai 2026, seuil 5 :
//   R  motif retenu, seul retenu de la lecture : exempt (sa ligne égale la tuile Absentéisme).
//   X  5 personnes et 1 contrat non relié présent chaque mois, 14 demi-journées : avril x1, x2, x3 + non relié (8), mai x4, x5 + non
//      relié (6). Chaque mois : moins de 5 personnes reliées et un contrat non relié → mois non dénombré (non vérifiable). Total de la
//      fenêtre : 5 personnes reliées → dénombré, 5 ≥ 5.
//   Y  2 personnes, 4 demi-journées (avril) → masqué (principal).
//   Z  6 personnes, 6 demi-journées : avril z1, z2, z3, mai z4, z5, z6 (une demi-journée chacune) ; chaque mois 3 personnes (masqué),
//      la fenêtre 6 personnes.
// Relations (motifWindowMask) : les mois de X sont non vérifiables et ne se protègent pas entre eux (aucune personne dénombrée) : le
// total de X, qui les redonnerait, est masqué en second. Les mois de Z (3 + 3 personnes distinctes = 6 ≥ 5) se protègent entre eux :
// le total de Z reste. Colonne de la fenêtre, autres motifs (total : tous motifs − tuile) : X (secondaire, 5 personnes) et Y (2) masqués
// comptent 7 personnes distinctes ≥ 5 : Z reste affiché. Statuts des totaux : R affiché, X secondaire, Y masqué, Z affiché.
// Avant la correction, KPI RH ne lisait que la colonne de la fenêtre : Y masqué, puis la plus petite valeur affichée, Z (6 < 14), en
// second, X affiché (14) ; la croisée affichait Z (6) : Y = (tous motifs − R) − 14 − 6 se lisait en croisant les deux écrans.
let seq = 0;
const tokens = (n: number): number[] => Array.from({ length: n }, () => seq++);
const xs = tokens(5);
const ys = tokens(2);
const zs = tokens(6);
const c = (half: number, who: number[], unlinked = 0): CongeCell => ({ kind: "exact", half, persons: who.length, unlinked, who });
const RXYZ: MotifWindow = {
  lines: [
    { chosen: true, months: [c(2, [99]), c(0, [])], total: c(2, [99]) },
    { chosen: false, months: [c(8, xs.slice(0, 3), 1), c(6, xs.slice(3), 1)], total: c(14, xs, 1) },
    { chosen: false, months: [c(4, ys), c(0, [])], total: c(4, ys) },
    { chosen: false, months: [c(3, zs.slice(0, 3)), c(3, zs.slice(3))], total: c(6, zs) },
  ],
  published: { months: [true, true], tile: true, all: true },
};

describe("motifs d'absence : même cellule, même statut dans KPI RH et dans la croisée 03 (cas R / X / Y / Z écrit à la main)", () => {
  it("fonction partagée : mois de X non vérifiables, total de X secondaire ; Y masqué ; Z et ses mois protégés entre eux ; R exempt", () => {
    const m = motifWindowMask(RXYZ, 5);
    expect(m.exempt).toBe(0);
    expect(m.total).toEqual(["shown", "secondary", "masked", "shown"]);
    expect(m.months).toEqual([
      ["shown", "shown"],
      ["unverifiable", "unverifiable"],
      ["masked", "shown"],
      ["masked", "masked"],
    ]);
    expect(m.all).toBe("shown");
  });
  it("KPI RH (motifMask) et croisée 03 (congesMask) : mêmes statuts de la fenêtre ; la croisée lit N-1 avec la même fonction", () => {
    const kpi = motifMask(RXYZ, 5);
    const croisee = congesMask({ current: RXYZ, previous: RXYZ }, 5);
    expect(kpi.lines).toEqual(croisee.cur);
    expect(croisee.prev).toEqual(croisee.cur);
    expect(kpi.all).toBe(croisee.allCur);
    // Y n'est pas reconstituable : les autres motifs affichés sur les deux écrans se réduisent à Z ; (tous motifs − R) − Z = X + Y,
    // somme de deux cellules masquées qui décrit 7 personnes distinctes (≥ 5).
    const shownOthers = kpi.lines.flatMap((s, i) => (i > 0 && s === "shown" ? [i] : []));
    expect(shownOthers).toEqual([3]);
    expect(croisee.cur.flatMap((s, i) => (i > 0 && s === "shown" ? [i] : []))).toEqual(shownOthers);
  });
});

// Même cas lu de bout en bout dans un référentiel PayFit fictif : les deux écrans partent du moteur (KPI RH : absenceByMotif et
// motifWindow sur la fenêtre de son détail ; croisée : loadAbsencesInput puis buildAbsences sur la période avril → mai 2026).
const person = (id: string) => ({ contractId: `C-${id}`, collaboratorId: `P-${id}`, startDate: "2025-01-01", endDate: null });
const edge = {
  collaborators: ["R1", "X1", "X2", "X3", "X4", "X5", "Y1", "Y2", "Z1", "Z2", "Z3", "Z4", "Z5", "Z6"].map((id) => ({ id: `P-${id}` })),
  contracts: [...["R1", "X1", "X2", "X3", "X4", "X5", "Y1", "Y2", "Z1", "Z2", "Z3", "Z4", "Z5", "Z6"].map(person), { contractId: "C-XU", collaboratorId: null, startDate: "2025-01-01", endDate: null }],
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
const masque = (html: string, type: string) => /data-masque="oui"/.test(new RegExp(`<tr data-motif="${type}"[\\s\\S]*?</tr>`).exec(html)![0]);

describe("motifs d'absence de bout en bout : KPI RH et croisée 03 sur le même référentiel fictif (seuil 5)", async () => {
  const data = await payfitEdgeBuild(edge);
  const kin = kpiInput(data, readAbsences(ABS, monthRange("2024-10", "2026-10")), { absenceTypes: ["test_r"] });

  it("cellules lues dans le moteur : celles du cas écrit à la main (demi-journées, personnes, contrat non relié)", () => {
    const g = motifWindow(kin, W);
    expect(g.published).toEqual({ months: [true, true], tile: true, all: true });
    const view = g.lines.map((l) => [l.chosen, ...l.months, l.total].map((x) => (typeof x === "boolean" ? x : x && x.kind !== "nd" ? `${x.half}/${x.persons}+${x.unlinked}` : "nd")));
    expect(view).toEqual([
      [true, "2/1+0", "0/0+0", "2/1+0"],
      [false, "8/3+1", "6/2+1", "14/5+1"],
      [false, "4/2+0", "0/0+0", "4/2+0"],
      [false, "3/3+0", "3/3+0", "6/6+0"],
    ]);
    expect(motifMask(g, 5).lines).toEqual(["shown", "secondary", "masked", "shown"]);
  });

  it("KPI RH (détail par motif) et croisée 03 (tableau par motif, demi-journées prises) : X et Y n.d., Z affiché à 6, R affiché", async () => {
    const html = renderToStaticMarkup(h(AbsenceMotifsDetail, { motifs: absenceByMotif(kin, W), cells: motifWindow(kin, W), slug: "demo", confidentialite: set(5) }));
    expect(["test_r", "test_x", "test_y", "test_z"].map((t) => masque(html, t))).toEqual([false, true, true, false]);
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(fakeKpi(kin), MONTHS, 5)));
    const motifs = tableOf(m.tables, TABLE_IDS.motifs);
    expect([0, 1, 2, 3].map((i) => rowText(motifs, i).slice(0, 3))).toEqual([
      ["test_r", "oui", "2"],
      ["test_x", "non", "n.d."],
      ["test_y", "non", "n.d."],
      ["test_z", "non", "6"],
    ]);
    expect(motifs.rows[1].cells[2]).toEqual({ nd: R5 });
    // Demi-journées prises : mêmes totaux que le tableau par motif ; mois de X non vérifiables, mois de Z masqués.
    const conges = tableOf(m.tables, TABLE_IDS.conges);
    expect([0, 1, 2, 3].map((i) => rowText(conges, i).slice(0, 4))).toEqual([
      ["test_r", "2", "0", "2"],
      ["test_x", "n.d.", "n.d.", "n.d."],
      ["test_y", "n.d.", "0", "n.d."],
      ["test_z", "n.d.", "n.d.", "6"],
    ]);
  });
});

// --- 2. Entrées et sorties du périmètre retenu par un filtre : même partition et mêmes statuts que la croisée 02 -----------------------
//
// DSN fictives d'octobre 2025 à septembre 2026 (mois tous complets), trois natures comptées : CDI (01), CDD (02) et une troisième nature
// (« 07 », tenue ici pour les apprentis du cas de la relecture), cinq personnes chacune depuis le 01/01/2025 (chaque nature compte au
// moins 5 personnes à chaque fin de mois : la garde des effectifs ne masque rien). Avril 2026 : 2 entrées CDI (K-6 le 01/04, K-7 le
// 15/04), 1 entrée CDD (K-16 le 10/04), aucune pour la troisième nature ; total des entrées d'avril publié : 3 ; aucune sortie. Seuil 5.
// Croisée 02, « dont » d'avril : CDI 2 personnes et CDD 1 (masqués) comptent 3 personnes < 5 ; la troisième nature (0 entrée) ne
// protège personne : impossible, toute la répartition est n.d. KPI RH, filtre Nature : l'entrée d'avril du périmètre est cette cellule,
// donc n.d. (CDI, CDD et troisième nature). La ligne « Période » des entrées et le turnover de la période (moyenne des entrées et des
// sorties, défaut), qui la contiennent, sont n.d. ; les autres mois (0 entrée) et les sorties (0) restent affichés.
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

  it("croisée 02 (journal des mouvements) : « dont CDI », « dont CDD » et « dont 07 » d'avril 2026 n.d. ; total 3 publié", () => {
    // Mouvements comptés d'avril, tels que loadEffectifsInput les forme (jetons de contrat et de personne, aucune clé de la source).
    const mv = monthMovements(base, "2026-04");
    expect(mv.entries).toMatchObject({ kind: "exact", value: 3 });
    const tok = new Map<string, string>();
    const t = (key: string) => tok.get(key) ?? (tok.set(key, `t${tok.size}`), tok.get(key)!);
    const events: JournalEventIn[] = countedMovements(mv).map((x) => ({ month: "2026-04", kind: x.row.event.kind, nature: x.row.event.nature, endReason: x.row.event.endReason, contract: t(x.row.contract.contractKey), person: x.row.contract.personKey && t(x.row.contract.personKey) }));
    const counts = countByNature(events, "2026-04", "entry");
    expect(Object.fromEntries(Object.entries(counts).map(([n, x]) => [n, x.contracts]))).toEqual({ "01": 2, "02": 1 });
    expect(natureCells(counts, NATURES, mv.entries, 5)).toEqual([{ nd: R5 }, { nd: R5 }, { nd: R5 }]);
  });

  it("KPI RH, filtres CDI puis CDD puis 07 : entrées d'avril n.d. (raison du seuil), ligne Période et turnover n.d. ; mars et les sorties restent", () => {
    for (const nature of NATURES) {
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
    // Sans masquage, la valeur filtrée serait celle que la croisée masque : 2 (CDI), 1 (CDD), 0 (07).
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
