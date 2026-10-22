import { describe, expect, it } from "vitest";
import { monthRange } from "@/lib/connectors/months";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";
import { absenteeism, absenteeismMonth, absenceTypeChoices, theoreticalMonth, theoreticalWindow } from "@/lib/rh/kpi/absence";
import { same } from "@/lib/rh/kpi/fraction";
import { rollingWindow } from "@/lib/rh/kpi/period";
import type { AbsenteeismMonth, KpiInput } from "@/lib/rh/kpi/types";
import { nd } from "@/lib/rh/referential/types";
import { payfitEdgeFetch } from "./helpers/edge-cases";
import { absence, DSN_ABSENCES, fixtureAbsences, kpiInput, readAbsences } from "./helpers/kpi";
import { dsnFixtureBuild, payfitBuild, payfitFixtureBuild } from "./helpers/rh";

// Jours en demi-journées : 30 demi-journées = 15 j. Mars 2026 : 7 contrats × 31 j = 217 j = 434 demi-journées.
const r = (m: AbsenteeismMonth) => (m.kind === "nd" ? m.nd.code : `${m.kind}:${m.ratio.num}/${m.ratio.den}`);

describe("absentéisme — PayFit, lecture du 21/10/2026, absences du transport fictif", async () => {
  const data = await payfitFixtureBuild();
  const abs = await fixtureAbsences();
  const input = kpiInput(data, abs);
  it("P6 : mois exacts — 2025-11 60/420 ; 2025-12 30/434 (ABS-2 du 01 au 15 = 15 j) ; 2026-01 0/372 ; 2026-02 0/364", () => {
    expect(r(absenteeismMonth(input, "2025-11"))).toBe("exact:60/420");
    const dec = absenteeismMonth(input, "2025-12");
    expect(r(dec)).toBe("exact:30/434");
    if (dec.kind !== "nd") expect(dec.slices).toMatchObject([{ absenceId: "TEST-A-ABSENCE-2", half: 30, from: "2025-12-01", to: "2025-12-31" }]);
    expect(r(absenteeismMonth(input, "2026-01"))).toBe("exact:0/372");
    expect(r(absenteeismMonth(input, "2026-02"))).toBe("exact:0/364");
    expect(r(absenteeismMonth(input, "2026-03"))).toBe("exact:0/434");
  });
  it("P6w : base lundi–vendredi — 2025-11 40/280 ; 2025-12 22/322", () => {
    const w = kpiInput(data, abs, { dayBasis: "weekdays" });
    expect(r(absenteeismMonth(w, "2025-11"))).toBe("exact:40/280");
    expect(r(absenteeismMonth(w, "2025-12"))).toBe("exact:22/322");
  });
  it("P6n : mois en borne basse, après la référence, période contenant 2025-10, types non choisis, maladie seule", () => {
    expect(r(absenteeismMonth(input, "2025-10"))).toBe("month-lower-bound");
    expect(r(absenteeismMonth(input, "2026-10"))).toBe("after-reference");
    expect(absenteeism(input, rollingWindow("2026-09"))).toMatchObject({ kind: "nd", nd: { code: "month-lower-bound", months: ["2025-10"] } });
    expect(r(absenteeismMonth(kpiInput(data, abs, { absenceTypes: [] }), "2025-11"))).toBe("absence-types-unset");
    const sick = absenteeismMonth(kpiInput(data, abs, { absenceTypes: ["test_sickness"] }), "2025-11");
    expect(r(sick)).toBe("exact:0/420");
    if (sick.kind !== "nd") expect(sick.excluded).toMatchObject([{ absenceId: "TEST-A-ABSENCE-2", why: "type", label: "type test_maternity non choisi" }]);
  });
  it("P7 : jours théoriques — 2025-12 = 217 j (7 × 31) ; 2026-02 = 182 j (004 du 15 au 28)", () => {
    const dec = theoreticalMonth(input, "2025-12");
    expect(dec.kind === "exact" && dec.half).toBe(434);
    const feb = theoreticalMonth(input, "2026-02");
    expect(feb.kind === "exact" && feb.half).toBe(364);
    expect(feb.kind === "exact" && feb.contributions.find((c) => c.externalId.endsWith("004"))).toMatchObject({ from: "2026-02-15", to: "2026-02-28", days: 14 });
  });
  it("types présents dans la lecture, avec leur nombre", () => {
    expect(absenceTypeChoices(kpiInput(data, abs, { absenceTypes: ["test_sickness", "ancien_type"] }))).toEqual([
      { type: "ancien_type", count: 0, chosen: true, inRead: false },
      { type: "test_maternity", count: 1, chosen: false, inRead: true },
      { type: "test_paid_leave", count: 1, chosen: false, inRead: true },
      { type: "test_sickness", count: 1, chosen: true, inRead: true },
    ]);
  });
});

describe("absentéisme — DSN et lecture de fin de mois", () => {
  it("D7 : DSN ⇒ n.d. « arrêts non extraits », même sans type choisi ; jours théoriques calculés", () => {
    const input = kpiInput(dsnFixtureBuild(), DSN_ABSENCES, { absenceTypes: [] });
    expect(r(absenteeismMonth(input, "2025-12"))).toBe("not-extracted");
    expect(absenteeism(input, rollingWindow("2026-09"))).toMatchObject({ kind: "nd", nd: { code: "not-extracted", reason: "arrêts non extraits de la DSN" } });
    const t = theoreticalMonth(input, "2025-12");
    expect(t.kind === "exact" && t.half).toBe(434);
  });
  it("Q4 : lecture du 31/01/2026 — 116/2465 sur 12 mois ; maternité seule 106/2465 ; lundi–vendredi 86/1757 ; mois", async () => {
    const q = await payfitBuild("fixture-A-1", createFixtureFetch("fixture-A-1"), monthRange("2024-10", "2026-01"), new Date("2026-01-31T08:00:00Z"));
    const abs = await fixtureAbsences("fixture-A-1", monthRange("2024-10", "2026-01"));
    const w = rollingWindow("2026-01");
    const all = absenteeism(kpiInput(q, abs), w);
    expect(all.kind === "exact" && same(all.ratio, { num: 116, den: 2465 })).toBe(true);
    const mat = absenteeism(kpiInput(q, abs, { absenceTypes: ["test_maternity"] }), w);
    expect(mat.kind === "exact" && same(mat.ratio, { num: 106, den: 2465 })).toBe(true);
    const wd = absenteeism(kpiInput(q, abs, { dayBasis: "weekdays" }), w);
    expect(wd.kind === "exact" && same(wd.ratio, { num: 86, den: 1757 })).toBe(true);
    const month = (m: string) => absenteeismMonth(kpiInput(q, abs), m);
    for (const [m, num, den] of [["2025-03", 5, 186], ["2025-08", 5, 217], ["2025-09", 30, 210], ["2025-10", 31, 217], ["2025-12", 15, 217], ["2026-01", 0, 186]] as const) {
      const x = month(m);
      expect(x.kind === "exact" && same(x.ratio, { num, den }), m).toBe(true);
    }
  });
});

describe("absentéisme — cas construits (contrat 005, mars 2026)", async () => {
  const data = await payfitFixtureBuild();
  const run = (rows: Parameters<typeof readAbsences>[0], month = "2026-03", over = {}): AbsenteeismMonth => absenteeismMonth(kpiInput(data, readAbsences(rows), over), month);
  it("A1–A4 : demi-journées, deux matinées le même jour = 0,5 j, matin + après-midi = 1 j", () => {
    expect(r(run([absence("a", "005", "2026-03-02", "middle-of-day", "2026-03-04", "middle-of-day")]))).toBe("exact:4/434");
    expect(r(run([absence("a", "005", "2026-03-02", "beginning-of-day", "2026-03-02", "middle-of-day")]))).toBe("exact:1/434");
    const twice = run([absence("a", "005", "2026-03-02", "beginning-of-day", "2026-03-02", "middle-of-day"), absence("b", "005", "2026-03-02", "beginning-of-day", "2026-03-02", "middle-of-day")]);
    expect(r(twice)).toBe("exact:1/434");
    if (twice.kind !== "nd") expect(twice.slices.find((s) => s.absenceId === "b")).toMatchObject({ half: 0, overlap: 1 });
    expect(r(run([absence("a", "005", "2026-03-02", "beginning-of-day", "2026-03-02", "middle-of-day"), absence("b", "005", "2026-03-02", "middle-of-day", "2026-03-02", "end-of-day")]))).toBe("exact:2/434");
  });
  it("A5–A8 : union de chevauchements, base, découpage par mois", () => {
    const rows = [absence("a", "005", "2026-03-02", "beginning-of-day", "2026-03-06", "end-of-day"), absence("b", "005", "2026-03-04", "beginning-of-day", "2026-03-10", "end-of-day")];
    expect(r(run(rows))).toBe("exact:18/434");
    expect(r(run(rows, "2026-03", { dayBasis: "weekdays" }))).toBe("exact:14/308");
    expect(r(run([absence("a", "005", "2026-03-06", "beginning-of-day", "2026-03-09", "end-of-day")]))).toBe("exact:8/434");
    expect(r(run([absence("a", "005", "2026-03-07", "beginning-of-day", "2026-03-08", "end-of-day")], "2026-03", { dayBasis: "weekdays" }))).toBe("exact:0/308");
    const across = [absence("a", "005", "2026-03-30", "beginning-of-day", "2026-04-02", "end-of-day")];
    expect(r(run(across, "2026-03"))).toBe("exact:4/434");
    expect(r(run(across, "2026-04"))).toBe("exact:4/420");
  });
  it("A9–A10 : absence bornée à la période du contrat, jours hors contrat signalés", () => {
    const end = [absence("a", "003", "2025-12-29", "beginning-of-day", "2026-01-05", "end-of-day")];
    expect(r(run(end, "2025-12"))).toBe("exact:6/434");
    const jan = run(end, "2026-01");
    expect(r(jan)).toBe("exact:0/372");
    if (jan.kind !== "nd") expect(jan.slices[0].outsideContract).toBe(5);
    if (jan.kind !== "nd") expect(run(end, "2026-01", { dayBasis: "weekdays" }).kind !== "nd" && (run(end, "2026-01", { dayBasis: "weekdays" }) as Extract<AbsenteeismMonth, { slices: unknown }>).slices[0].outsideContract).toBe(3);
    const start = [absence("a", "004", "2026-02-10", "beginning-of-day", "2026-02-20", "end-of-day")];
    expect(r(run(start, "2026-02"))).toBe("exact:12/364");
    expect(r(run(start, "2026-02", { dayBasis: "weekdays" }))).toBe("exact:10/260");
    const feb = run(start, "2026-02");
    if (feb.kind !== "nd") expect(feb.slices[0].outsideContract).toBe(5);
  });
  it("A11–A14 : moments incertains ⇒ « ≥ » ; couverts par une autre absence ⇒ exact", () => {
    const nul = run([absence("a", "005", "2026-03-02", null, "2026-03-04", "end-of-day")]);
    expect(r(nul)).toBe("lower_bound:4/434");
    if (nul.kind !== "nd") expect(nul.qualifiers.join(" ")).toContain("2 demi-journée(s) incertaine(s)");
    expect(r(run([absence("a", "005", "2026-03-02", "end-of-day", "2026-03-04", "end-of-day")]))).toBe("lower_bound:4/434");
    expect(r(run([absence("a", "005", "2026-03-02", "beginning-of-day", "2026-03-04", "beginning-of-day")]))).toBe("lower_bound:4/434");
    expect(r(run([absence("a", "005", "2026-03-02", "middle-of-day", "2026-03-02", "middle-of-day")]))).toBe("lower_bound:0/434");
    expect(r(run([absence("a", "005", "2026-03-02", null, "2026-03-04", "end-of-day"), absence("b", "005", "2026-03-02", "beginning-of-day", "2026-03-02", "end-of-day")]))).toBe("exact:6/434");
  });
  it("A15–A16 : statuts et types", () => {
    const pending = run([absence("a", "005", "2026-03-02", "beginning-of-day", "2026-03-02", "end-of-day", { status: "pending_approval" })]);
    expect(r(pending)).toBe("exact:0/434");
    if (pending.kind !== "nd") expect(pending.excluded[0].label).toBe("statut en attente d'approbation non retenu");
    expect(r(run([absence("a", "005", "2026-03-02", "beginning-of-day", "2026-03-02", "end-of-day", { status: null })]))).toBe("lower_bound:0/434");
    expect(r(run([absence("a", "005", "2026-03-02", "beginning-of-day", "2026-03-02", "end-of-day", { status: "pending_approval" })], "2026-03", { absenceStatuses: ["approved", "pending_approval"] }))).toBe("exact:2/434");
    expect(r(run([absence("a", "005", "2026-03-02", "beginning-of-day", "2026-03-02", "end-of-day", { type: "test_other" })]))).toBe("exact:0/434");
  });
  it("A15b : statut nul — seuls les créneaux possibles (moments compris) sont incertains", () => {
    // b sans statut, 02/03 mi-journée → fin : seul l'après-midi est possible ; déjà couvert par a ⇒ exact 1/434.
    const both = [absence("a", "005", "2026-03-02", "middle-of-day", "2026-03-02", "end-of-day"), absence("b", "005", "2026-03-02", "middle-of-day", "2026-03-02", "end-of-day", { status: null })];
    expect(r(run(both))).toBe("exact:1/434");
    const alone = run([absence("b", "005", "2026-03-02", "middle-of-day", "2026-03-02", "end-of-day", { status: null })]);
    expect(r(alone)).toBe("lower_bound:0/434");
    if (alone.kind !== "nd") {
      expect(alone.qualifiers.join(" ")).toContain("1 demi-journée(s) incertaine(s)");
      expect(alone.excluded[0]).toMatchObject({ why: "status-nd", uncertain: 1 });
    }
  });
  it("A18b : date absente — seuls les mois de la période du contrat sont n.d.", () => {
    // 003 se termine le 31/12/2025 : une absence sans fin commencée le 29/12/2025 ne touche aucun jour compté ensuite.
    const noEnd = [absence("a", "003", "2025-12-29", "beginning-of-day", null, null)];
    expect(r(run(noEnd, "2025-12"))).toBe("absence-date-nd");
    expect(r(run(noEnd, "2026-01"))).toBe("exact:0/372");
    expect(r(run(noEnd, "2026-03"))).toBe("exact:0/434");
    // 004 commence le 15/02/2026 : une absence sans début ne touche aucun jour compté avant février.
    const noStart = [absence("a", "004", null, null, "2026-02-20", "end-of-day")];
    expect(r(run(noStart, "2026-01"))).toBe("exact:0/372");
    expect(r(run(noStart, "2026-02"))).toBe("absence-date-nd");
    // Au jour près : une absence sans début qui finit le 10/02/2026, avant le début de 004 (15/02), ne touche aucun jour compté.
    const before = run([absence("a", "004", null, null, "2026-02-10", "end-of-day")], "2026-02");
    expect(r(before)).toBe("exact:0/364");
    if (before.kind !== "nd") expect(before.excluded).toMatchObject([{ absenceId: "a", why: "contract-out-of-scope", label: expect.stringContaining("aucune demi-journée comptée possible") }]);
    // Lundi–vendredi : fin le dimanche 15/02/2026, jour de début de 004 ⇒ aucune demi-journée comptée possible ⇒ exact.
    expect(r(run([absence("a", "004", null, null, "2026-02-15", "end-of-day")], "2026-02", { dayBasis: "weekdays" }))).toBe("exact:0/260");
    // Mois où le contrat n'est pas actif : l'absence est écartée et listée, avec un libellé exact quand les deux dates manquent.
    const jan = run([absence("a", "004", null, null, "2026-01-20", "end-of-day"), absence("b", "004", null, null, null, null)], "2026-01");
    expect(r(jan)).toBe("exact:0/372");
    if (jan.kind !== "nd") {
      expect(jan.excluded.map((x) => x.label)).toEqual([
        "aucune demi-journée comptée possible dans la période du contrat (date de début non renseignée, fin le 20/01/2026)",
        "aucune demi-journée comptée possible dans la période du contrat (dates de début et de fin non renseignées)",
      ]);
    }
    // Même borne en calendaire : le dimanche 15/02 est compté ⇒ l'absence peut le toucher ⇒ n.d.
    expect(r(run([absence("a", "004", null, null, "2026-02-15", "end-of-day")], "2026-02"))).toBe("absence-date-nd");
  });
  it("A17–A18 : contrat inconnu ⇒ mois n.d. ; date absente ⇒ mois touchés n.d., jamais de fin supposée", () => {
    const ghost = [absence("a", "TEST-A-CONTRACT-999", "2026-03-02", "beginning-of-day", "2026-03-03", "end-of-day")];
    expect(r(run(ghost, "2026-03"))).toBe("absence-unknown-contract");
    expect(r(run(ghost, "2026-04"))).toBe("exact:0/420");
    const noStart = [absence("a", "005", null, null, "2026-03-04", "end-of-day")];
    expect(r(run(noStart, "2026-02"))).toBe("absence-date-nd");
    expect(r(run(noStart, "2026-03"))).toBe("absence-date-nd");
    expect(r(run(noStart, "2026-04"))).toBe("exact:0/420");
  });
  it("A19–A20 : ordre des gardes et absences non lues", () => {
    const mk = (absences: KpiInput["absences"]) => kpiInput(data, absences);
    const outOfScope = mk(readAbsences([], monthRange("2025-11", "2026-08")));
    expect(r(absenteeismMonth(outOfScope, "2026-09"))).toBe("month-out-of-scope");
    expect(r(absenteeismMonth(outOfScope, "2026-10"))).toBe("after-reference");
    expect(r(absenteeismMonth(mk({ status: "unavailable", nd: nd("scope-missing", "accès refusé par le fournisseur pour cette clé") }), "2026-03"))).toBe("absences-unavailable");
  });
});

describe("jours théoriques d'une fenêtre (indépendants des absences)", async () => {
  // DSN, 2025-10 → 2026-09 en calendaire : 217 + 210 + 217 + 186 + 182 + 217 + 210 + 217 + 210 + 217 + 217 + 210 = 2 510 j.
  it("DSN : 2 510 j exacts alors que l'absentéisme est n.d. (arrêts non extraits)", () => {
    const input = kpiInput(dsnFixtureBuild(), DSN_ABSENCES);
    expect(theoreticalWindow(input, rollingWindow("2026-09"))).toMatchObject({ kind: "exact", half: 5020 });
    expect(absenteeism(input, rollingWindow("2026-09"))).toMatchObject({ kind: "nd", nd: { code: "not-extracted" } });
  });
  it("PayFit lu le 21/10/2026 : n.d. à cause du mois charnière 2025-10, même raison que la colonne", async () => {
    const input = kpiInput(await payfitFixtureBuild(), await fixtureAbsences());
    const t = theoreticalWindow(input, rollingWindow("2026-09"));
    expect(t).toMatchObject({ kind: "nd", nd: { code: "month-nd", months: ["2025-10"] } });
    if (t.kind === "nd") expect(t.nd.reason).toBe(`2025-10 : ${(theoreticalMonth(input, "2025-10") as { nd: { reason: string } }).nd.reason}`);
  });
});

describe("absentéisme — dates inconnues couvertes, statut nul sans date, jours sous un autre contrat de la personne", async () => {
  // C-A : CDI depuis 2024 ; P-C : CDD C-C1 jusqu'au 15/03/2025 puis CDI C-C2 dès le 16/03/2025. Lecture du 31/01/2026.
  // Mai 2025 : C-A 31 j + C-C2 31 j = 62 j = 124 demi-journées. Mars 2025 : C-A 31 + C-C1 15 + C-C2 16 = 62 j = 124.
  const edge = {
    collaborators: [{ id: "P-A" }, { id: "P-C" }],
    contracts: [
      { contractId: "C-A", collaboratorId: "P-A", startDate: "2024-01-01", endDate: null, natureContratDsn: "01" },
      { contractId: "C-C1", collaboratorId: "P-C", startDate: "2024-06-01", endDate: "2025-03-15", natureContratDsn: "02" },
      { contractId: "C-C2", collaboratorId: "P-C", startDate: "2025-03-16", endDate: null, natureContratDsn: "01" },
    ],
  };
  const MONTHS = monthRange("2024-10", "2026-01");
  const data = await payfitBuild("cle-fictive-edge-1234", payfitEdgeFetch("cle-fictive-edge-1234", edge as never), MONTHS, new Date("2026-01-31T08:00:00Z"));
  const run = (rows: Parameters<typeof readAbsences>[0], month: string) => absenteeismMonth(kpiInput(data, readAbsences(rows, MONTHS)), month);
  const A = absence("A", "C-A", "2025-05-01", "beginning-of-day", "2025-05-31", "end-of-day");
  it("date inconnue mais toutes les demi-journées possibles déjà comptées : exact, absence listée", () => {
    expect(r(run([A], "2025-05"))).toBe("exact:62/124");
    const both = run([A, absence("B", "C-A", null, null, "2025-05-10", "end-of-day")], "2025-05");
    expect(r(both)).toBe("exact:62/124");
    if (both.kind !== "nd") expect(both.excluded).toMatchObject([{ absenceId: "B", why: "date-nd-covered" }]);
    // B sans fin, commencée le 20/05, A du 15/05 au 10/06 : 20 → 31/05 déjà comptés ⇒ 17 j = 34 demi-journées, exact.
    expect(r(run([absence("A", "C-A", "2025-05-15", "beginning-of-day", "2025-06-10", "end-of-day"), absence("B", "C-A", "2025-05-20", "beginning-of-day", null, null)], "2025-05"))).toBe("exact:34/124");
    // Une demi-journée possible non couverte ⇒ n.d.
    expect(r(run([absence("B", "C-A", null, null, "2025-05-10", "end-of-day")], "2025-05"))).toBe("absence-date-nd");
  });
  it("statut nul et date inconnue : jamais comptée ⇒ « ≥ » (20 demi-journées incertaines), exact si couvertes", () => {
    const b = run([absence("B", "C-A", null, null, "2025-05-10", "end-of-day", { status: null })], "2025-05");
    expect(r(b)).toBe("lower_bound:0/124");
    if (b.kind !== "nd") expect(b.qualifiers.join(" ")).toContain("20 demi-journée(s) incertaine(s)");
    expect(r(run([A, absence("B", "C-A", null, null, "2025-05-10", "end-of-day", { status: null })], "2025-05"))).toBe("exact:62/124");
  });
  it("jours d'absence sous le contrat suivant de la même personne : « ≥ », jamais exact par omission", () => {
    // Absence rattachée à C-C1 du 10 au 20/03/2025 : 10 → 15 comptés (12 demi-journées) ; 16 → 20 sous C-C2 : incertains.
    const m = run([absence("X", "C-C1", "2025-03-10", "beginning-of-day", "2025-03-20", "end-of-day")], "2025-03");
    expect(r(m)).toBe("lower_bound:12/124");
    if (m.kind !== "nd") expect(m.slices[0].notes.join(" ")).toContain("10 demi-journée(s) sous le contrat C-C2 de la même personne");
    // Sans statut : 12 demi-journées sous C-C1 et 10 sous C-C2, toutes incertaines et tracées sur la ligne écartée.
    const ns = run([absence("X", "C-C1", "2025-03-10", "beginning-of-day", "2025-03-20", "end-of-day", { status: null })], "2025-03");
    expect(r(ns)).toBe("lower_bound:0/124");
    if (ns.kind !== "nd") expect(ns.excluded[0]).toMatchObject({ why: "status-nd", uncertain: 22, label: expect.stringContaining("sous le contrat C-C2") });
    // Absence ouverte (sans fin) sur le CDD terminé le 15/03 : en avril, elle peut couvrir tout le CDI C-C2 ⇒ « ≥ ».
    // Avril : C-A 30 j + C-C2 30 j = 60 j = 120 demi-journées ; 60 demi-journées incertaines sous C-C2.
    const open = run([absence("X", "C-C1", "2025-03-10", "beginning-of-day", null, null)], "2025-04");
    expect(r(open)).toBe("lower_bound:0/120");
    if (open.kind !== "nd") expect(open.excluded[0].label).toContain("60 demi-journée(s) sous le contrat C-C2");
    // Natures comptées = CDI seul : l'absence rattachée au CDD (non compté) n'est pas comptée, mais ses jours sous le CDI le sont
    // en incertain. Mars : C-A 31 j + C-C2 16 j = 47 j = 94 demi-journées ; 10 incertaines (16 → 20/03).
    const cdi = absenteeismMonth(kpiInput(data, readAbsences([absence("X", "C-C1", "2025-03-10", "beginning-of-day", "2025-03-20", "end-of-day")], MONTHS), { natures: ["01"] }), "2025-03");
    expect(r(cdi)).toBe("lower_bound:0/94");
    if (cdi.kind !== "nd") expect(cdi.excluded[0]).toMatchObject({ why: "contract-out-of-scope", uncertain: 10, label: expect.stringContaining("sous le contrat C-C2") });
    // Une absence rattachée à C-C2 qui couvre ces jours lève l'incertitude.
    expect(r(run([absence("X", "C-C1", "2025-03-10", "beginning-of-day", "2025-03-20", "end-of-day"), absence("Y", "C-C2", "2025-03-16", "beginning-of-day", "2025-03-20", "end-of-day")], "2025-03"))).toBe("exact:22/124");
  });
});

describe("absentéisme — contrat sans date de début ou sans collaborateur : rattachement non vérifiable ⇒ « ≥ »", async () => {
  const MONTHS = monthRange("2024-10", "2026-01");
  const build = (edge: unknown) => payfitBuild("cle-fictive-edge-1234", payfitEdgeFetch("cle-fictive-edge-1234", edge as never), MONTHS, new Date("2026-01-31T08:00:00Z"));
  it("absence sur un contrat sans date de début : ses jours sous le CDI compté de la même personne sont incertains", async () => {
    // P-C : CDI C-C1 depuis 2024-06-01 ; C-C2 en attente, sans date de début. Absence sur C-C2 du 10 au 14/03/2025.
    // Mars : C-C1 seul, 31 j = 62 demi-journées ; 10 demi-journées incertaines sous C-C1.
    const data = await build({ collaborators: [{ id: "P-C" }], contracts: [{ contractId: "C-C1", collaboratorId: "P-C", startDate: "2024-06-01", endDate: null, natureContratDsn: "01" }, { contractId: "C-C2", collaboratorId: "P-C", status: "PENDING", startDate: null, endDate: null, natureContratDsn: "02" }] });
    const m = absenteeismMonth(kpiInput(data, readAbsences([absence("A", "C-C2", "2025-03-10", "beginning-of-day", "2025-03-14", "end-of-day")], MONTHS)), "2025-03");
    expect(r(m)).toBe("lower_bound:0/62");
    if (m.kind !== "nd") expect(m.excluded[0]).toMatchObject({ why: "contract-out-of-scope", uncertain: 10, label: expect.stringContaining("contrat non positionnable (sans date de début) ; 10 demi-journée(s) sous le contrat C-C1") });
  });
  it("absence sur un contrat sans collaborateur : ses jours hors contrat ne sont pas « non comptés » en exact", async () => {
    // C-C1 : CDD de P-C jusqu'au 15/03/2025 ; C-C2 : CDI sans collaborateur dès le 16/03. Absence sur C-C2 du 10 au 20/03.
    // Mars : 15 j + 16 j = 31 j = 62 demi-journées ; 16 → 20/03 comptés (10) ; 10 → 15/03 (6 j) hors contrat, personne inconnue.
    const data = await build({ collaborators: [{ id: "P-C" }], contracts: [{ contractId: "C-C1", collaboratorId: "P-C", startDate: "2024-06-01", endDate: "2025-03-15", natureContratDsn: "02" }, { contractId: "C-C2", collaboratorId: null, startDate: "2025-03-16", endDate: null, natureContratDsn: "01" }] });
    const m = absenteeismMonth(kpiInput(data, readAbsences([absence("A", "C-C2", "2025-03-10", "beginning-of-day", "2025-03-20", "end-of-day")], MONTHS)), "2025-03");
    expect(r(m)).toBe("lower_bound:10/62");
    if (m.kind !== "nd") expect(m.qualifiers.join(" ")).toContain("6 jour(s) d'absence hors contrat d'un contrat sans collaborateur");
  });
});
