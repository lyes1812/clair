import { describe, expect, it } from "vitest";
import { absenteeism } from "@/lib/rh/kpi/absence";
import { ABSENCE_ALL_MOTIFS_LABEL, absenceByMotif } from "@/lib/rh/kpi/absence-motifs";
import { kpiDashboard } from "@/lib/rh/kpi/dashboard";
import { same } from "@/lib/rh/kpi/fraction";
import { monthWindow, rollingWindow } from "@/lib/rh/kpi/period";
import { absence, DSN_ABSENCES, kpiInput, readAbsences } from "./helpers/kpi";
import { dsnFixtureBuild, payfitEdgeBuild } from "./helpers/rh";

// Absentéisme par motif, avril 2026 (30 jours). Deux contrats toute la période : 2 × 30 j = 60 j = 120 demi-journées.
// La tuile principale ne retient que « test_sickness » (liste choisie dans Paramètres) ; tous les motifs de la lecture sont détaillés.
//   a1  C-1  test_sickness    06/04 → 10/04  5 j = 10 demi-journées
//   a2  C-1  test_paid_leave  08/04 → 14/04  7 j = 14 demi-journées (les 8, 9 et 10 avril recouvrent a1 : 6 demi-journées)
//   a3  C-2  test_paid_leave  20/04 → 21/04  2 j =  4 demi-journées
//   a4  C-1  test_sickness    02/03 → 03/03  hors fenêtre (compté dans la lecture, pas dans la fenêtre)
const edge = {
  collaborators: [{ id: "P-1" }, { id: "P-2" }],
  contracts: [
    { contractId: "C-1", collaboratorId: "P-1", startDate: "2025-01-01", endDate: null },
    { contractId: "C-2", collaboratorId: "P-2", startDate: "2025-01-01", endDate: null },
  ],
};
const day = (id: string, contract: string, from: string, to: string, type: string) => absence(id, contract, from, "beginning-of-day", to, "end-of-day", { type });
const rows = [
  day("a1", "C-1", "2026-04-06", "2026-04-10", "test_sickness"),
  day("a2", "C-1", "2026-04-08", "2026-04-14", "test_paid_leave"),
  day("a3", "C-2", "2026-04-20", "2026-04-21", "test_paid_leave"),
  day("a4", "C-1", "2026-03-02", "2026-03-03", "test_sickness"),
];
const w = monthWindow("2026-04");
const ratioOf = (x: { ratio: { num: number; den: number } | null }, num: number, den: number) => x.ratio !== null && same(x.ratio, { num, den });

describe("absentéisme par motif — fenêtre d'avril 2026", async () => {
  const data = await payfitEdgeBuild(edge);
  const input = kpiInput(data, readAbsences(rows), { absenceTypes: ["test_sickness"] });
  it("une ligne par motif de la lecture : demi-journées et taux sur 120 ; seul « test_sickness » est retenu pour la tuile", () => {
    const m = absenceByMotif(input, w);
    expect(m.lines.map((l) => l.type)).toEqual(["test_paid_leave", "test_sickness"]);
    const [leave, sick] = m.lines;
    // test_sickness : a1 seule en avril = 10 demi-journées ; a4 (mars) hors fenêtre. test_paid_leave : a2 14 + a3 4 = 18.
    expect(sick).toMatchObject({ type: "test_sickness", count: 2, inWindow: 1, chosen: true, kind: "exact", half: 10 });
    expect(ratioOf(sick, 10, 120)).toBe(true);
    expect(leave).toMatchObject({ type: "test_paid_leave", count: 2, inWindow: 2, chosen: false, kind: "exact", half: 18 });
    expect(ratioOf(leave, 18, 120)).toBe(true);
    expect(m.emptyReason).toBeNull();
  });
  it("taux « tous motifs » : a1 ∪ a2 sur C-1 = du 06 au 14 avril = 9 j = 18 demi-journées, plus a3 (4) = 22/120 ; la somme des motifs (28) le dépasse", () => {
    const m = absenceByMotif(input, w);
    expect(m.label).toBe(ABSENCE_ALL_MOTIFS_LABEL);
    expect(ABSENCE_ALL_MOTIFS_LABEL).toBe("Taux d'absence, tous motifs");
    expect(m.all.kind).toBe("exact");
    expect(m.all.kind !== "nd" && same(m.all.ratio, { num: 22, den: 120 })).toBe(true);
    const sum = m.lines.reduce((s, l) => s + (l.half ?? 0), 0);
    expect(sum).toBe(28);
    expect(sum).toBeGreaterThan(m.all.kind !== "nd" ? m.all.ratio.num : 0);
  });
  it("la tuile principale n'est pas modifiée par le détail : 10/120 avec la liste choisie, avant et après", () => {
    const before = absenteeism(input, w);
    absenceByMotif(input, w);
    const after = absenteeism(input, w);
    expect(before.kind === "exact" && same(before.ratio, { num: 10, den: 120 })).toBe(true);
    expect(after).toBe(before);
    const d = kpiDashboard(input, w);
    expect(d.tiles.absenteeism.current.kind === "exact" && same(d.tiles.absenteeism.current.ratio, { num: 10, den: 120 })).toBe(true);
    expect(d.motifs?.lines.map((l) => l.type)).toEqual(["test_paid_leave", "test_sickness"]);
    expect(d.motifs?.all.kind === "exact" && same(d.motifs.all.ratio, { num: 22, den: 120 })).toBe(true);
    expect(d.motifs?.label.toLowerCase().replace("taux d'absence", "")).not.toContain("absentéisme");
  });
  it("base lundi–vendredi : motifs recalculés par le même moteur (a1 : 5 jours ouvrés ; a2 du mercredi 8 au mardi 14 : 5 jours ouvrés)", () => {
    // Avril 2026 : 22 jours ouvrés par contrat, 44 jours = 88 demi-journées. a1 = lun. 6 → ven. 10 = 10 demi-journées.
    // a2 = mer. 8 → mar. 14 = 8, 9, 10, 13, 14 = 5 jours = 10 demi-journées ; a3 = lun. 20 et mar. 21 = 4. Tous motifs : 6 → 14 avril
    // = 6, 7, 8, 9, 10, 13, 14 = 7 jours = 14 demi-journées + a3 4 = 18.
    const wk = absenceByMotif(kpiInput(data, readAbsences(rows), { absenceTypes: ["test_sickness"], dayBasis: "weekdays" }), w);
    const byType = Object.fromEntries(wk.lines.map((l) => [l.type, l]));
    expect(byType.test_sickness).toMatchObject({ half: 10 });
    expect(ratioOf(byType.test_sickness, 10, 88)).toBe(true);
    expect(byType.test_paid_leave).toMatchObject({ half: 14 });
    expect(ratioOf(byType.test_paid_leave, 14, 88)).toBe(true);
    expect(wk.all.kind !== "nd" && same(wk.all.ratio, { num: 18, den: 88 })).toBe(true);
  });
  it("résultat mémorisé par entrée et fenêtre (une seule exécution du moteur par motif)", () => {
    expect(absenceByMotif(input, w)).toBe(absenceByMotif(input, w));
  });
  it("motif incertain : « ≥ » sur sa ligne et sur le taux tous motifs, jamais un exact", async () => {
    // a5 : test_other, C-2, début le 27/04 sans moment (jour non interprété, 2 demi-journées incertaines), fin le 28/04 en fin de journée
    // (2 demi-journées comptées) ⇒ 2/120 en borne basse ; tous motifs 22 + 2 = 24/120 en borne basse.
    const a5 = absence("a5", "C-2", "2026-04-27", null, "2026-04-28", "end-of-day", { type: "test_other" });
    const m = absenceByMotif(kpiInput(data, readAbsences([...rows, a5]), { absenceTypes: ["test_sickness"] }), w);
    const other = m.lines.find((l) => l.type === "test_other")!;
    expect(other).toMatchObject({ kind: "lower_bound", half: 2, chosen: false });
    expect(ratioOf(other, 2, 120)).toBe(true);
    expect(m.lines.find((l) => l.type === "test_sickness")).toMatchObject({ kind: "exact", half: 10 });
    expect(m.all.kind).toBe("lower_bound");
    expect(m.all.kind !== "nd" && same(m.all.ratio, { num: 24, den: 120 })).toBe(true);
  });
  it("mois non lu par la lecture d'absences : chaque ligne et le taux tous motifs sont n.d. avec la raison, jamais zéro", () => {
    const m = absenceByMotif(kpiInput(data, readAbsences(rows, ["2026-03"]), { absenceTypes: ["test_sickness"] }), w);
    expect(m.lines).toHaveLength(2);
    for (const l of m.lines) {
      expect(l).toMatchObject({ kind: "nd", half: null, ratio: null, nd: { code: "month-nd", reason: expect.stringContaining("absences non lues pour 2026-04") } });
    }
    expect(m.all).toMatchObject({ kind: "nd", nd: { code: "month-nd" } });
  });
});

describe("absentéisme par motif — aucun motif lisible", async () => {
  const data = await payfitEdgeBuild(edge);
  it("lecture sans aucune absence : ligne vide et raison, pas de zéro", () => {
    const m = absenceByMotif(kpiInput(data, readAbsences([]), { absenceTypes: ["test_sickness"] }), w);
    expect(m.lines).toEqual([]);
    expect(m.all).toMatchObject({ kind: "nd", nd: { code: "no-absence-motif", reason: "aucune absence dans la lecture : aucun motif à détailler" } });
    expect(m.emptyReason).toBe("aucune absence dans la lecture : aucun motif à détailler");
  });
  it("DSN (arrêts non extraits) : ligne vide, raison du moteur existant", () => {
    const m = absenceByMotif(kpiInput(dsnFixtureBuild(), DSN_ABSENCES), rollingWindow("2026-09"));
    expect(m.lines).toEqual([]);
    expect(m.all).toMatchObject({ kind: "nd", nd: { code: "not-extracted", reason: "arrêts non extraits de la DSN" } });
    expect(m.emptyReason).toBe("arrêts non extraits de la DSN");
  });
});
