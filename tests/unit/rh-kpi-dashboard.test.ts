import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/crypto";
import { delta } from "@/lib/rh/kpi/compare";
import { kpiDashboard, kpiDetail } from "@/lib/rh/kpi/dashboard";
import { fmtEtp4, fmtPercent } from "@/lib/rh/kpi/format";
import { same } from "@/lib/rh/kpi/fraction";
import { civilWindow, rollingWindow } from "@/lib/rh/kpi/period";
import { kpiNd } from "@/lib/rh/kpi/types";
import { DSN_ABSENCES, fixtureAbsences, kpiInput } from "./helpers/kpi";
import { dsnFixtureBuild, payfitFixtureBuild } from "./helpers/rh";

describe("écart N-1 (W2)", () => {
  type V = { kind: "exact" | "lower_bound"; v: { num: number; den: number } } | { kind: "nd"; nd: ReturnType<typeof kpiNd> };
  const v = (n: number, kind: "exact" | "lower_bound" = "exact"): V => ({ kind, v: { num: n, den: 1 } });
  const val = (x: Extract<V, { v: unknown }>) => x.v;
  it("n.d. dès qu'une valeur n'est pas exacte ; fraction exacte sinon", () => {
    expect(delta<V>(v(1, "lower_bound"), v(1), val, "etp", "N-1")).toMatchObject({ kind: "nd", nd: { code: "current-not-exact" } });
    expect(delta<V>(v(2), { kind: "nd", nd: kpiNd("month-nd", "trou") }, val, "etp", "N-1")).toMatchObject({ kind: "nd", nd: { code: "previous-nd", reason: "N-1 (N-1) : trou" } });
    expect(delta<V>(v(2), v(1, "lower_bound"), val, "etp", "N-1")).toMatchObject({ kind: "nd", nd: { code: "previous-lower-bound" } });
    expect(delta<V>(v(2), v(1), val, "points", "N-1")).toEqual({ kind: "exact", unit: "points", value: { num: 100, den: 1 } });
  });
});

describe("tableau de bord KPI (S4)", async () => {
  const dsn = dsnFixtureBuild();
  it("DSN : 12 lignes, tuiles de référence, déterminisme", () => {
    const d1 = kpiDashboard(kpiInput(dsn, DSN_ABSENCES), rollingWindow("2026-09"));
    const d2 = kpiDashboard(kpiInput(dsn, DSN_ABSENCES), rollingWindow("2026-09"));
    expect(canonicalJson(d1)).toBe(canonicalJson(d2));
    expect(d1.rows.map((r) => r.month)).toEqual(["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(d1.rows[3].headcount).toMatchObject({ kind: "exact", persons: 6 });
    expect(d1.closedMonth).toBe("2026-09");
    const t = d1.tiles;
    expect(t.etpEnd.current.kind !== "nd" && fmtEtp4(t.etpEnd.current.etp4)).toBe("6,10");
    expect(t.turnover.current.kind === "exact" && same(t.turnover.current.ratio, { num: 12, den: 83 })).toBe(true);
    expect(t.turnover.current.kind === "exact" && fmtPercent(t.turnover.current.ratio)).toBe("14,46 %");
    expect(t.absenteeism.current).toMatchObject({ kind: "nd", nd: { code: "not-extracted" } });
    expect(d1.rows[2].previous.month).toBe("2024-12");
    expect(d1.rows[2].theoretical).toMatchObject({ kind: "exact", half: 434 });
  });
  it("année civile 2025 : 5,40 / 6,75 / 14,81 %", () => {
    const d = kpiDashboard(kpiInput(dsn, DSN_ABSENCES), civilWindow(2025));
    expect(d.tiles.etpAverage.current.kind === "exact" && same(d.tiles.etpAverage.current.ratio, { num: 27, den: 5 })).toBe(true);
    expect(d.tiles.headcountAverage.current.kind === "exact" && same(d.tiles.headcountAverage.current.ratio, { num: 27, den: 4 })).toBe(true);
    expect(d.tiles.turnover.current.kind === "exact" && fmtPercent(d.tiles.turnover.current.ratio)).toBe("14,81 %");
  });
  it("PayFit avec types : déterministe ; ETP moyen exact, turnover et absentéisme de période n.d. (mois charnière)", async () => {
    const data = await payfitFixtureBuild();
    const abs = await fixtureAbsences();
    const a = kpiDashboard(kpiInput(data, abs), rollingWindow("2026-09"));
    expect(canonicalJson(a)).toBe(canonicalJson(kpiDashboard(kpiInput(data, abs), rollingWindow("2026-09"))));
    expect(a.tiles.etpAverage.current.kind === "exact" && same(a.tiles.etpAverage.current.ratio, { num: 707, den: 120 })).toBe(true);
    expect(a.tiles.turnover.current.kind).toBe("nd");
    expect(a.tiles.absenteeism.current).toMatchObject({ kind: "nd", nd: { code: "month-lower-bound" } });
    expect(a.rows.find((r) => r.month === "2025-12")?.absenteeism).toMatchObject({ kind: "exact", ratio: { num: 30, den: 434 } });
  });
  it("détail d'un chiffre : contributions, ou null si l'identifiant ou le mois est invalide", () => {
    const input = kpiInput(dsn, DSN_ABSENCES);
    const w = rollingWindow("2026-09");
    const etp = kpiDetail(input, w, "etp-end", "2026-09");
    expect(etp?.id === "etp-end" && etp.value.kind !== "nd" && etp.value.contributions).toHaveLength(7);
    expect(kpiDetail(input, w, "etp-end", "2020-01")).toBeNull();
    expect(kpiDetail(input, w, "etp-end", null)).toBeNull();
    expect(kpiDetail(input, w, "turnover", null)?.id).toBe("turnover");
    expect(kpiDetail(input, w, "absenteeism", null)?.id).toBe("absenteeism-window");
    expect(kpiDetail(input, w, "exits", "2025-12")).toMatchObject({ id: "exits", value: { exits: { kind: "exact", value: 1 } } });
  });
});
