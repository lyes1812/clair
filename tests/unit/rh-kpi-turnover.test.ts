import { describe, expect, it } from "vitest";
import { monthRange } from "@/lib/connectors/months";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";
import { compareWindows } from "@/lib/rh/kpi/compare";
import { same } from "@/lib/rh/kpi/fraction";
import { civilWindow, rollingWindow } from "@/lib/rh/kpi/period";
import { monthMovements, turnover } from "@/lib/rh/kpi/turnover";
import type { Turnover } from "@/lib/rh/kpi/types";
import { PAYFIT_EDGES, payfitEdgeFetch } from "./helpers/edge-cases";
import { DSN_ABSENCES, fixtureAbsences, kpiInput } from "./helpers/kpi";
import { dsnFixtureBuild, payfitBuild, payfitFixtureBuild } from "./helpers/rh";

const isRatio = (t: Turnover, num: number, den: number) => t.kind === "exact" && same(t.ratio, { num, den });

describe("turnover — DSN (24 mois)", () => {
  const data = dsnFixtureBuild();
  it("D4 : 12/83 = 14,46 % ; N-1 7/13 = 53,85 % ; écart −42500/1079 points", () => {
    const cmp = compareWindows(kpiInput(data, DSN_ABSENCES), rollingWindow("2026-09"), turnover, (t) => t.ratio, "points");
    expect(isRatio(cmp.current, 12, 83)).toBe(true);
    expect(cmp.current).toMatchObject({ entries: 1, exits: 1 });
    expect(isRatio(cmp.previous, 7, 13)).toBe(true);
    expect(cmp.previous).toMatchObject({ entries: 7, exits: 0 });
    expect(cmp.delta.kind === "exact" && same(cmp.delta.value, { num: -42500, den: 1079 })).toBe(true);
  });
  it("D5 : variantes — fins de CDD exclues 6/83 ; sorties ÷ effectif de début 1/7, N-1 0/6 ; les deux 0/7", () => {
    const w = rollingWindow("2026-09");
    const excl = turnover(kpiInput(data, DSN_ABSENCES, { excludedExitNatures: ["02"] }), w);
    expect(isRatio(excl, 6, 83)).toBe(true);
    expect(excl.months.flatMap((m) => m.events).find((e) => e.why === "excluded-nature")?.label).toBe("sortie exclue : nature CDD (02) (Paramètres)");
    const start = compareWindows(kpiInput(data, DSN_ABSENCES, { turnoverFormula: "exits_over_start" }), w, turnover, (t) => t.ratio, "points");
    expect(isRatio(start.current, 1, 7)).toBe(true);
    expect(isRatio(start.previous, 0, 6)).toBe(true);
    expect(start.delta.kind === "exact" && same(start.delta.value, { num: 100, den: 7 })).toBe(true);
    expect(isRatio(turnover(kpiInput(data, DSN_ABSENCES, { turnoverFormula: "exits_over_start", excludedExitNatures: ["02"] }), w), 0, 7)).toBe(true);
  });
  it("D6 : année civile 2025 — 4/27 ; exclusion 02 : 2/27 ; sorties ÷ début : 1/6 ; N-1 2024 n.d. ; 2026 non close", () => {
    expect(isRatio(turnover(kpiInput(data, DSN_ABSENCES), civilWindow(2025)), 4, 27)).toBe(true);
    expect(isRatio(turnover(kpiInput(data, DSN_ABSENCES, { excludedExitNatures: ["02"] }), civilWindow(2025)), 2, 27)).toBe(true);
    expect(isRatio(turnover(kpiInput(data, DSN_ABSENCES, { turnoverFormula: "exits_over_start" }), civilWindow(2025)), 1, 6)).toBe(true);
    expect(turnover(kpiInput(data, DSN_ABSENCES), civilWindow(2024))).toMatchObject({ kind: "nd", nd: { code: "month-nd" } });
    expect(turnover(kpiInput(data, DSN_ABSENCES), civilWindow(2026))).toMatchObject({ kind: "nd", nd: { code: "period-not-closed" } });
  });
});

describe("turnover — PayFit", async () => {
  it("P5 : lecture du 21/10/2026 — n.d. (sorties du mois charnière 2025-10 inconnues) ; mouvements connus listés", async () => {
    const input = kpiInput(await payfitFixtureBuild(), await fixtureAbsences());
    const t = turnover(input, rollingWindow("2026-09"));
    expect(t).toMatchObject({ kind: "nd", nd: { code: "month-nd", months: ["2025-10"] } });
    expect(t.kind === "nd" && t.nd.reason).toContain("sorties n.d.");
    const counted = t.months.flatMap((m) => m.events).filter((e) => e.why === "counted").map((e) => `${e.row.event.kind}:${e.row.contract.externalId.slice(-3)}:${e.row.event.date}`);
    expect(counted).toEqual(["exit:003:2025-12-31", "entry:004:2026-02-15"]);
    expect(turnover(kpiInput(await payfitFixtureBuild(), await fixtureAbsences(), { turnoverFormula: "exits_over_start" }), rollingWindow("2026-09")).kind).toBe("nd");
  });
  it("Q3 : lecture du 31/01/2026 — 4/27 ; sorties ÷ début 1/6 ; N-1 n.d. (avant la couverture)", async () => {
    const q = await payfitBuild("fixture-A-1", createFixtureFetch("fixture-A-1"), monthRange("2024-10", "2026-01"), new Date("2026-01-31T08:00:00Z"));
    const abs = await fixtureAbsences("fixture-A-1", monthRange("2024-10", "2026-01"));
    const cmp = compareWindows(kpiInput(q, abs), rollingWindow("2026-01"), turnover, (t) => t.ratio, "points");
    expect(isRatio(cmp.current, 4, 27)).toBe(true);
    expect(cmp.previous).toMatchObject({ kind: "nd", nd: { code: "month-nd" } });
    expect(isRatio(turnover(kpiInput(q, abs, { turnoverFormula: "exits_over_start" }), rollingWindow("2026-01")), 1, 6)).toBe(true);
  });
});

describe("turnover — contrats continus (PAYFIT_EDGES.rehire, lecture du 31/01/2026)", async () => {
  const data = await payfitBuild("cle-fictive-edge-1234", payfitEdgeFetch("cle-fictive-edge-1234", PAYFIT_EDGES.rehire), monthRange("2024-10", "2026-01"), new Date("2026-01-31T08:00:00Z"));
  const w = rollingWindow("2026-01");
  const run = (over = {}, scope = {}) => turnover(kpiInput(data, DSN_ABSENCES, over, scope), w);
  it("T1 : neutralisation par défaut — 6/23 ; la sortie CONT-1 et l'entrée CONT-2 sont neutralisées", () => {
    const t = run();
    expect(isRatio(t, 6, 23)).toBe(true);
    expect(t).toMatchObject({ entries: 1, exits: 0 });
    const neutral = t.months.flatMap((m) => m.events).filter((e) => e.why === "neutralized").map((e) => e.row.contract.externalId).sort();
    expect(neutral).toEqual(["C-CONT-1", "C-CONT-2"]);
  });
  it("T2/T3/T4 : sans neutralisation 18/23 ; plus exclusion 02 : 12/23 ; sorties ÷ début 0 % puis 100 %", () => {
    expect(isRatio(run({ neutralizeContinuity: false }), 18, 23)).toBe(true);
    expect(isRatio(run({ neutralizeContinuity: false, excludedExitNatures: ["02"] }), 12, 23)).toBe(true);
    expect(isRatio(run({ turnoverFormula: "exits_over_start" }), 0, 1)).toBe(true);
    expect(isRatio(run({ turnoverFormula: "exits_over_start", neutralizeContinuity: false }), 1, 1)).toBe(true);
  });
  it("T5 : filtre nature 02 — le partenaire CDI n'est pas compté, la sortie CDD l'est : 6/5", () => {
    const t = run({}, { nature: "02" });
    expect(isRatio(t, 6, 5)).toBe(true);
    expect(t).toMatchObject({ entries: 0, exits: 1 });
  });
  it("mouvements d'un mois : entrées et sorties après règles, avec la raison de chaque événement", () => {
    const mv = monthMovements(kpiInput(data, DSN_ABSENCES), "2025-07");
    expect(mv.entries).toMatchObject({ kind: "exact", value: 0 });
    expect(mv.events.map((e) => e.why)).toEqual(["neutralized"]);
  });
});
