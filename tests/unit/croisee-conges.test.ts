import { describe, expect, it } from "vitest";
import { monthRange } from "@/lib/connectors/months";
import { absencesEnCause, allMotifsInput, aVenirStatut, congesAVenir, congesPris, issueReason, motifInput, personTokens, publicMonthReason, publicWindowReason, type CongesAVenir } from "@/lib/croisee/conges";
import { absenteeism, absenteeismMonth } from "@/lib/rh/kpi/absence";
import { absenceByMotif } from "@/lib/rh/kpi/absence-motifs";
import type { Window } from "@/lib/rh/kpi/types";
import { absence, DSN_ABSENCES, kpiInput, readAbsences } from "./helpers/kpi";
import { dsnFixtureBuild, payfitEdgeBuild } from "./helpers/rh";

// Congés par motif (Masse salariale croisée, chapitre 03) : cas de référence écrits à la main, valeurs fictives.
// Trois contrats ouverts depuis le 01/01/2025, un collaborateur chacun (C-1 → P-1, C-2 → P-2, C-3 → P-3). Lecture PayFit fictive du
// 21/10/2026, mois lus 2024-10 → 2026-09 sauf mention. Base calendaire (défaut) sauf mention. Motif retenu pour l'absentéisme :
// « test_sickness » seulement.
const edge = {
  collaborators: [{ id: "P-1" }, { id: "P-2" }, { id: "P-3" }],
  contracts: [
    { contractId: "C-1", collaboratorId: "P-1", startDate: "2025-01-01", endDate: null },
    { contractId: "C-2", collaboratorId: "P-2", startDate: "2025-01-01", endDate: null },
    { contractId: "C-3", collaboratorId: "P-3", startDate: "2025-01-01", endDate: null },
  ],
};
const full = (id: string, contract: string, from: string, to: string, type: string, status: string | null = "approved") => absence(id, contract, from, "beginning-of-day", to, "end-of-day", { type, status });
const win = (months: string[]): Window => ({ mode: "civil", from: months[0], to: months[months.length - 1], months, label: "fenêtre de test" });

//   a1  C-1  test_paid_leave  lun. 06/04 → ven. 10/04            5 j = 10 demi-journées
//   a2  C-1  test_paid_leave  jeu. 09/04 → mar. 14/04            recouvre a1 les 9 et 10 : ajoute 11 → 14 = 4 j = 8 demi-journées
//   a3  C-2  test_paid_leave  jeu. 30/04 (début de journée) → lun. 04/05 (mi-journée)
//                              avril : le 30 = 2 demi-journées ; mai : 1er, 2, 3 = 6 + matin du 4 = 1 → 7 demi-journées (3,5 j)
//   a4  C-3  test_sickness    lun. 11/05 → mar. 12/05            2 j = 4 demi-journées
//   a5  C-2  test_paid_leave  18/05 → 19/05, statut « refusée » : non compté (statut non retenu)
const ROWS = [
  full("a1", "C-1", "2026-04-06", "2026-04-10", "test_paid_leave"),
  full("a2", "C-1", "2026-04-09", "2026-04-14", "test_paid_leave"),
  absence("a3", "C-2", "2026-04-30", "beginning-of-day", "2026-05-04", "middle-of-day", { type: "test_paid_leave" }),
  full("a4", "C-3", "2026-05-11", "2026-05-12", "test_sickness"),
  full("a5", "C-2", "2026-05-18", "2026-05-19", "test_paid_leave", "declined"),
];
const AVRIL_MAI = win(["2026-04", "2026-05"]);

describe("congesPris : jours pris par motif et par mois (moteur de l'absentéisme, une copie par motif)", async () => {
  const data = await payfitEdgeBuild(edge);
  const input = kpiInput(data, readAbsences(ROWS), { absenceTypes: ["test_sickness"] });

  it("cas de référence : demi-journées et personnes concernées par mois, total de la fenêtre", () => {
    const c = congesPris(input, AVRIL_MAI);
    expect(c.emptyReason).toBeNull();
    expect(c.lines.map((l) => l.type)).toEqual(["test_paid_leave", "test_sickness"]);
    const [leave, sick] = c.lines;
    // Congés : avril = C-1 du 6 au 14 (18) + C-2 le 30 (2) = 20 demi-journées, 2 personnes ; mai = C-2 (7), 1 personne (a5 refusée).
    // Jetons de personne : rang parmi les personnes des contrats (P-1 → 0, P-2 → 1, P-3 → 2), le même d'un mois à l'autre.
    expect(leave).toEqual({
      type: "test_paid_leave",
      chosen: false,
      months: [
        { kind: "exact", half: 20, persons: 2, who: [0, 1] },
        { kind: "exact", half: 7, persons: 1, who: [1] },
      ],
      total: { kind: "exact", half: 27, persons: 2, who: [0, 1] },
    });
    // Maladie : aucun jour en avril (zéro réel : mois lu, contrats présents), 4 demi-journées en mai pour une personne.
    expect(sick).toEqual({
      type: "test_sickness",
      chosen: true,
      months: [
        { kind: "exact", half: 0, persons: 0, who: [] },
        { kind: "exact", half: 4, persons: 1, who: [2] },
      ],
      total: { kind: "exact", half: 4, persons: 1, who: [2] },
    });
  });

  it("jetons de personne : rang parmi les personnes des contrats de l'entrée, le même pour toute fenêtre et toute copie ; aucun identifiant", () => {
    const token = personTokens(input);
    expect(["payfit:P-1", "payfit:P-2", "payfit:P-3"].map(token)).toEqual([0, 1, 2]);
    // Personne absente des contrats : le rang suivant, toujours le même.
    expect(token("contrat:inconnu")).toBe(3);
    expect(token("contrat:inconnu")).toBe(3);
    // Mai seul : C-2 (congés) garde le jeton 1, C-3 (maladie) le jeton 2.
    const may = congesPris(input, win(["2026-05"]));
    expect(may.lines.map((l) => (l.months[0].kind === "nd" ? null : l.months[0].who))).toEqual([[1], [2]]);
  });

  it("le total de chaque motif est celui de l'absentéisme par motif (même moteur, même copie de l'entrée)", () => {
    const c = congesPris(input, AVRIL_MAI);
    const m = absenceByMotif(input, AVRIL_MAI);
    for (const l of c.lines) {
      const line = m.lines.find((x) => x.type === l.type)!;
      expect(l.total.kind === "nd" ? null : l.total.half).toBe(line.half);
    }
  });

  it("base lundi–vendredi : a1 = 5 j, a2 ajoute lun. 13 et mar. 14 ; a3 : jeu. 30/04, puis ven. 1er et matin du lun. 4 mai", () => {
    const c = congesPris(kpiInput(data, readAbsences(ROWS), { absenceTypes: ["test_sickness"], dayBasis: "weekdays" }), AVRIL_MAI);
    const leave = c.lines[0];
    // Avril : C-1 = 6, 7, 8, 9, 10, 13, 14 = 7 j = 14 + C-2 le 30 = 2 → 16 ; mai : C-2 = 1er (2) + matin du 4 (1) = 3.
    expect(leave.months).toEqual([
      { kind: "exact", half: 16, persons: 2, who: [0, 1] },
      { kind: "exact", half: 3, persons: 1, who: [1] },
    ]);
    expect(leave.total).toEqual({ kind: "exact", half: 19, persons: 2, who: [0, 1] });
  });

  it("demi-journée incertaine (moment de début absent) : « ≥ » sur le mois et le total ; la personne sans jour compté n'est pas comptée", () => {
    // a6 : C-1, test_sickness, le 20/05 sans moment de début, fin de journée : le 20 est incertain, aucun jour compté.
    const a6 = absence("a6", "C-1", "2026-05-20", null, "2026-05-20", "end-of-day", { type: "test_sickness" });
    const c = congesPris(kpiInput(data, readAbsences([...ROWS, a6]), { absenceTypes: ["test_sickness"] }), AVRIL_MAI);
    const sick = c.lines.find((l) => l.type === "test_sickness")!;
    expect(sick.months[1]).toEqual({ kind: "lower_bound", half: 4, persons: 1, who: [2] });
    expect(sick.total).toEqual({ kind: "lower_bound", half: 4, persons: 1, who: [2] });
  });

  it("mois hors des mois lus : n.d. avec la raison du moteur, jamais zéro ; le total de la fenêtre devient n.d.", () => {
    const c = congesPris(kpiInput(data, readAbsences(ROWS, monthRange("2024-10", "2026-04")), { absenceTypes: ["test_sickness"] }), AVRIL_MAI);
    for (const l of c.lines) {
      expect(l.months[0].kind).toBe("exact");
      expect(l.months[1]).toEqual({ kind: "nd", reason: expect.stringContaining("absences non lues pour 2026-05") });
      expect(l.total.kind).toBe("nd");
    }
  });

  it("mois lus sans absence (novembre–décembre 2025) : zéros réels, aucune personne", () => {
    const c = congesPris(input, win(["2025-11", "2025-12"]));
    for (const l of c.lines) expect(l.total).toEqual({ kind: "exact", half: 0, persons: 0, who: [] });
  });

  it("mois que le moteur rend n.d. (avril 2025 : borne basse de l'historique PayFit) : la raison du moteur passe telle quelle", () => {
    const c = congesPris(input, win(["2025-04"]));
    for (const l of c.lines) {
      expect(l.months[0]).toEqual({ kind: "nd", reason: expect.stringContaining("mois en borne basse (PayFit)") });
      expect(l.total.kind).toBe("nd");
    }
  });

  it("aucune absence lue, ou source DSN : aucune ligne, la raison du moteur", () => {
    expect(congesPris(kpiInput(data, readAbsences([]), { absenceTypes: ["test_sickness"] }), AVRIL_MAI)).toEqual({ window: AVRIL_MAI, lines: [], emptyReason: "aucune absence dans la lecture : aucun motif à détailler" });
    const dsn = congesPris(kpiInput(dsnFixtureBuild(), DSN_ABSENCES), win(["2026-04"]));
    expect(dsn.lines).toEqual([]);
    expect(dsn.emptyReason).toBe("arrêts non extraits de la DSN");
  });

  it("aucun nom ni identifiant dans le résultat : des nombres", () => {
    const json = JSON.stringify(congesPris(input, AVRIL_MAI));
    expect(json).not.toMatch(/\b[CP]-\d|\ba[1-5]\b/);
  });

  it("copies de l'entrée : celle d'un motif garde ses seules absences et le retient seul ; celle du taux tous motifs retient tous les motifs lus", () => {
    const m = motifInput(input, "test_paid_leave");
    expect(m.params.absenceTypes).toEqual(["test_paid_leave"]);
    expect(m.absences.status === "read" && m.absences.rows.map((r) => r.id)).toEqual(["a1", "a2", "a3", "a5"]);
    expect(allMotifsInput(input).params.absenceTypes).toEqual(["test_paid_leave", "test_sickness"]);
    // Même résultat que le moteur par motif et que le taux tous motifs.
    expect(absenteeism(m, AVRIL_MAI)).toMatchObject({ kind: "exact", ratio: { num: 27 } });
    expect(absenteeism(allMotifsInput(input), AVRIL_MAI)).toEqual(absenceByMotif(input, AVRIL_MAI).all);
  });
});

// Raisons sans identifiant (D2). Le moteur nomme l'absence et le contrat en cause ; la page croisée garde le mois et le nombre.
//   x1, x2  C-9 (inconnu du référentiel)  test_paid_leave  avril, approuvées      deux absences en cause en avril
//   x3      C-9                            test_paid_leave  avril, refusée          statut non retenu : jamais en cause
//   x4      C-2                            test_sickness    sans date de début, fin le 20/05 : une absence en cause chaque mois jusqu'en mai
describe("raisons publiques : aucun identifiant d'absence ni de contrat", async () => {
  const data = await payfitEdgeBuild(edge);
  const X = [
    full("x1", "C-9", "2026-04-14", "2026-04-15", "test_paid_leave"),
    full("x2", "C-9", "2026-04-21", "2026-04-22", "test_paid_leave"),
    full("x3", "C-9", "2026-04-23", "2026-04-23", "test_paid_leave", "declined"),
    absence("x4", "C-2", null, null, "2026-05-20", "end-of-day", { type: "test_sickness" }),
  ];
  const input = kpiInput(data, readAbsences([...ROWS, ...X]), { absenceTypes: ["test_sickness"] });
  const leave = motifInput(input, "test_paid_leave");
  const sick = motifInput(input, "test_sickness");
  const UNKNOWN_AVRIL = "2 absences rattachées à un contrat inconnu du référentiel en 2026-04 (détail dans KPI RH)";

  it("le moteur nomme l'absence et le contrat (raison brute, jamais affichée)", () => {
    const r = absenteeismMonth(leave, "2026-04");
    expect(r).toMatchObject({ kind: "nd", nd: { code: "absence-unknown-contract", reason: "absence x1 rattachée au contrat C-9 inconnu du référentiel" } });
  });

  it("absencesEnCause : le moteur s'arrête à la première ; on la retire et on recompte (x1, x2 ; x3 refusée n'est pas en cause)", () => {
    expect(absencesEnCause(leave, "2026-04")).toEqual({ code: "absence-unknown-contract", count: 2 });
    expect(absencesEnCause(sick, "2026-05")).toEqual({ code: "absence-date-nd", count: 1 });
    expect(absencesEnCause(leave, "2026-05")).toBeNull(); // mai : aucune absence en cause, valeur exacte
    // Tous motifs, avril : les deux absences du contrat inconnu (raison du moteur), x4 relève d'un autre code et n'est pas comptée.
    expect(absencesEnCause(allMotifsInput(input), "2026-04")).toEqual({ code: "absence-unknown-contract", count: 2 });
  });

  it("issueReason : le mois et le nombre ; « au moins une » quand le nombre n'est pas établi", () => {
    expect(issueReason("absence-unknown-contract", 1, "2026-04")).toBe("1 absence rattachée à un contrat inconnu du référentiel en 2026-04 (détail dans KPI RH)");
    expect(issueReason("absence-date-nd", 3, "2026-05")).toBe("3 absences sans date de début ou de fin dans PayFit en 2026-05 (détail dans KPI RH)");
    expect(issueReason("absence-unknown-contract", null, "2026-04")).toBe("au moins une absence rattachée à un contrat inconnu du référentiel en 2026-04 (détail dans KPI RH)");
  });

  it("raisons de mois et de période : même forme que le moteur (mois en cause, puis le premier), sans identifiant", () => {
    const m = absenteeismMonth(sick, "2026-04");
    if (m.kind !== "nd") throw new Error("avril devrait être n.d.");
    expect(publicMonthReason(sick, "2026-04", m.nd)).toBe("1 absence sans date de début ou de fin dans PayFit en 2026-04 (détail dans KPI RH)");
    const w = absenteeism(sick, AVRIL_MAI);
    if (w.kind !== "nd") throw new Error("la période devrait être n.d.");
    expect(w.nd.reason).toContain("absence x4"); // raison brute du moteur
    expect(publicWindowReason(sick, w.nd)).toBe("2 mois n.d. (2026-04 → 2026-05) ; 1 absence sans date de début ou de fin dans PayFit en 2026-04 (détail dans KPI RH)");
    // Une raison sans absence en cause passe telle quelle.
    expect(publicMonthReason(sick, "2026-04", { code: "month-out-of-scope", reason: "absences non lues pour 2026-04" })).toBe("absences non lues pour 2026-04");
  });

  it("congesPris : cellules et totaux n.d. avec la raison publique ; aucun identifiant, même dans une raison", () => {
    const c = congesPris(input, AVRIL_MAI);
    const [l, s] = c.lines;
    expect(l.months).toEqual([{ kind: "nd", reason: UNKNOWN_AVRIL }, { kind: "exact", half: 7, persons: 1, who: [1] }]);
    expect(l.total).toEqual({ kind: "nd", reason: UNKNOWN_AVRIL });
    expect(s.months).toEqual([
      { kind: "nd", reason: "1 absence sans date de début ou de fin dans PayFit en 2026-04 (détail dans KPI RH)" },
      { kind: "nd", reason: "1 absence sans date de début ou de fin dans PayFit en 2026-05 (détail dans KPI RH)" },
    ]);
    expect(JSON.stringify(c)).not.toMatch(/\bx[1-4]\b|\bC-\d/);
  });
});

// Congés posés et demandes en attente après le dernier mois clos (septembre 2026). Mois lus : 2024-10 → 2026-11.
//   b1  C-1  test_paid_leave  approuvée   lun. 26/10 → ven. 30/10           5 j = 10 demi-journées
//   b2  C-1  test_paid_leave  approuvée   jeu. 29/10 → lun. 02/11           octobre : ajoute le 31 (2) ; novembre : 1er et 2 = 4
//   b3  C-2  test_paid_leave  en attente  lun. 16/11 → mar. 17/11 (mi-journée)   2 + 1 = 3 demi-journées
//   b4  C-3  test_paid_leave  approuvée   lun. 30/11 → ven. 04/12           novembre : le 30 = 2 ; décembre non lu : non rattaché
//   b5  C-2  test_rtt         approuvée   sans date de début                 non rattachée
//   b6  C-3  test_paid_leave  refusée     05/10 → 06/10                     ignorée
//   b7  C-1  test_paid_leave  approuvée   01/09 → 03/09                     avant les mois à venir : ignorée
//   b8  C-9  test_paid_leave  approuvée   12/10 → 13/10, contrat inconnu    non rattachée
const FUTURE = [
  full("b1", "C-1", "2026-10-26", "2026-10-30", "test_paid_leave"),
  full("b2", "C-1", "2026-10-29", "2026-11-02", "test_paid_leave"),
  absence("b3", "C-2", "2026-11-16", "beginning-of-day", "2026-11-17", "middle-of-day", { type: "test_paid_leave", status: "pending_approval" }),
  full("b4", "C-3", "2026-11-30", "2026-12-04", "test_paid_leave"),
  absence("b5", "C-2", null, null, "2026-11-20", "end-of-day", { type: "test_rtt" }),
  full("b6", "C-3", "2026-10-05", "2026-10-06", "test_paid_leave", "declined"),
  full("b7", "C-1", "2026-09-01", "2026-09-03", "test_paid_leave"),
  full("b8", "C-9", "2026-10-12", "2026-10-13", "test_paid_leave"),
];
const READ_NOV = monthRange("2024-10", "2026-11");
const value = (x: CongesAVenir) => {
  if (x.kind !== "value") throw new Error(`n.d. : ${x.reason}`);
  return x;
};

describe("congesAVenir : congés posés et demandes en attente, en jours par mois lu", async () => {
  const data = await payfitEdgeBuild(edge);

  it("cas de référence : posés et en attente par motif et par mois ; jours hors des mois lus non rattachés", () => {
    const r = value(congesAVenir(kpiInput(data, readAbsences(FUTURE, READ_NOV)), "2026-09"));
    expect(r.after).toBe("2026-09");
    expect(r.months).toEqual(["2026-10", "2026-11"]);
    expect(r.lines).toEqual([
      // Posés : octobre = C-1 du 26 au 31 = 12 ; novembre = C-1 1er et 2 (4) + C-3 le 30 (2) = 6, deux personnes.
      // Jetons : C-1 → 0, C-2 → 1, C-3 → 2 (personnes P-1, P-2, P-3).
      { type: "test_paid_leave", statut: "pose", months: [{ kind: "exact", half: 12, persons: 1, who: [0] }, { kind: "exact", half: 6, persons: 2, who: [0, 2] }], total: { kind: "exact", half: 18, persons: 2, who: [0, 2] } },
      // En attente : aucun jour en octobre (zéro réel, mois lu), 3 demi-journées en novembre.
      { type: "test_paid_leave", statut: "en-attente", months: [{ kind: "exact", half: 0, persons: 0, who: [] }, { kind: "exact", half: 3, persons: 1, who: [1] }], total: { kind: "exact", half: 3, persons: 1, who: [1] } },
    ]);
    // b4 (décembre non lu), b5 (sans date de début), b8 (contrat inconnu).
    expect(r.nonRattachees).toBe(3);
  });

  it("base lundi–vendredi : le samedi 31/10 et le dimanche 1er/11 ne comptent pas", () => {
    const r = value(congesAVenir(kpiInput(data, readAbsences(FUTURE, READ_NOV), { dayBasis: "weekdays" }), "2026-09"));
    const pose = r.lines.find((l) => l.statut === "pose")!;
    // Octobre : 26 → 30 = 10 ; novembre : lun. 2 (2) + lun. 30 (2) = 4.
    expect(pose.months).toEqual([
      { kind: "exact", half: 10, persons: 1, who: [0] },
      { kind: "exact", half: 4, persons: 2, who: [0, 2] },
    ]);
  });

  it("statuts : « en attente d'approbation » toujours à part ; posé = statut retenu dans les Définitions des KPI ; refusé ou sans statut ignoré", () => {
    expect(aVenirStatut("pending_approval", ["approved"])).toBe("en-attente");
    expect(aVenirStatut("pending_approval", ["approved", "pending_approval"])).toBe("en-attente");
    expect(aVenirStatut("approved", ["approved"])).toBe("pose");
    expect(aVenirStatut("pending_cancellation", ["approved"])).toBeNull();
    expect(aVenirStatut("pending_cancellation", ["approved", "pending_cancellation"])).toBe("pose");
    expect(aVenirStatut("declined", ["approved"])).toBeNull();
    expect(aVenirStatut(null, ["approved"])).toBeNull();
  });

  it("moment incertain : « ≥ » sur le mois et le total", () => {
    const b9 = absence("b9", "C-2", "2026-10-19", null, "2026-10-20", "end-of-day", { type: "test_paid_leave" });
    const r = value(congesAVenir(kpiInput(data, readAbsences([...FUTURE, b9], READ_NOV)), "2026-09"));
    const pose = r.lines.find((l) => l.statut === "pose")!;
    // Le 19 est incertain (non compté) ; le 20 compte 2 demi-journées : octobre 12 + 2 = 14, deux personnes.
    expect(pose.months[0]).toEqual({ kind: "lower_bound", half: 14, persons: 2, who: [0, 1] });
    expect(pose.total).toEqual({ kind: "lower_bound", half: 20, persons: 3, who: [0, 1, 2] });
  });

  it("mois non lu entre deux mois lus : n.d. avec la raison, et le total de la ligne est n.d.", () => {
    const read = [...monthRange("2024-10", "2026-10"), "2026-12"];
    const r = value(congesAVenir(kpiInput(data, readAbsences(FUTURE, read)), "2026-09"));
    expect(r.months).toEqual(["2026-10", "2026-11", "2026-12"]);
    const pose = r.lines.find((l) => l.statut === "pose")!;
    expect(pose.months[1]).toEqual({ kind: "nd", reason: "absences non lues pour 2026-11 (mois lus : 2024-10 → 2026-12)" });
    expect(pose.total.kind).toBe("nd");
    // Décembre lu : le 1er → 4 de b4 = 8 demi-journées.
    expect(pose.months[2]).toEqual({ kind: "exact", half: 8, persons: 1, who: [2] });
  });

  it("aucun mois lu après le dernier mois clos, ou source DSN : n.d. avec la raison", () => {
    expect(congesAVenir(kpiInput(data, readAbsences(FUTURE)), "2026-09")).toEqual({ kind: "nd", reason: "aucun mois lu après 2026-09 (mois lus : 2024-10 → 2026-09)" });
    expect(congesAVenir(kpiInput(dsnFixtureBuild(), DSN_ABSENCES), "2026-09")).toEqual({ kind: "nd", reason: "arrêts non extraits de la DSN" });
  });

  it("aucun nom ni identifiant dans le résultat : des nombres", () => {
    const json = JSON.stringify(congesAVenir(kpiInput(data, readAbsences(FUTURE, READ_NOV)), "2026-09"));
    expect(json).not.toMatch(/\b[CP]-\d|\bb\d\b/);
  });

  it("absence commencée avant les mois à venir, fin inconnue : ni comptée ni « hors des mois lus »", () => {
    // b10 : C-3, arrêt approuvé depuis le 02/03, sans date de fin.
    const b10 = absence("b10", "C-3", "2026-03-02", "beginning-of-day", null, null, { type: "test_sickness" });
    const r = value(congesAVenir(kpiInput(data, readAbsences([...FUTURE, b10], READ_NOV)), "2026-09"));
    expect(r.nonRattachees).toBe(3);
    expect(r.lines.map((l) => l.type)).toEqual(["test_paid_leave", "test_paid_leave"]);
  });

  it("population vérifiée avant le décompte : hors natures comptées, b5 (sans date) n'est pas compté ; le contrat inconnu b8 l'est", () => {
    const r = value(congesAVenir(kpiInput(data, readAbsences(FUTURE, READ_NOV), { natures: ["99"] }), "2026-09"));
    expect(r.lines).toEqual([]);
    expect(r.nonRattachees).toBe(1);
  });
});
