import { describe, expect, it } from "vitest";
import { compareWindows } from "@/lib/rh/kpi/compare";
import { absenteeism, theoreticalWindow } from "@/lib/rh/kpi/absence";
import { same } from "@/lib/rh/kpi/fraction";
import { rollingWindow } from "@/lib/rh/kpi/period";
import { turnover } from "@/lib/rh/kpi/turnover";
import type { Absenteeism, Turnover } from "@/lib/rh/kpi/types";
import { payfitHistoryLimit, rawPayfitHistory } from "@/lib/rh/raw-history";
import { DSN_ABSENCES, fixtureAbsences, kpiInput } from "./helpers/kpi";
import { dsnFixtureBuild, payfitEdgeBuild, payfitFixtureBuild } from "./helpers/rh";

// Mode « brut » de l'historique PayFit (décision de Lyes, 22/10/2026) : les mois antérieurs à la limite de conservation sont
// calculés sur ce que l'API renvoie. Le transport fictif renvoie tous les contrats : les chiffres bruts égalent ceux de la DSN.
const isRatio = (t: Turnover | Absenteeism, num: number, den: number) => t.kind === "exact" && same(t.ratio, { num, den });

describe("historique PayFit brut — transformation du référentiel", async () => {
  const stored = await payfitFixtureBuild();
  it("limite constatée : mois 2024-10 à 2025-10 en borne basse, effectif complet à partir du 21/10/2025 (lecture du 21/10/2026 − 12 mois)", () => {
    expect(payfitHistoryLimit(stored)).toEqual({ lowerFrom: "2024-10", lowerTo: "2025-10", exactFrom: "2025-10-21" });
  });
  it("brut : plus aucun mois en borne basse, ni drapeau ni constat ; le référentiel stocké n'est pas modifié", () => {
    const raw = rawPayfitHistory(stored);
    expect(raw.coverage.filter((c) => c.presenceStatus !== "complete")).toEqual([]);
    expect(raw.coverage.every((c) => c.presenceReason === null)).toBe(true);
    expect(raw.events.some((e) => e.flags.includes("lower_bound_window"))).toBe(false);
    expect(raw.findings.some((f) => f.code === "lower-bound-window")).toBe(false);
    expect(raw.contracts).toBe(stored.contracts);
    expect(stored.coverage.filter((c) => c.presenceStatus === "lower_bound")).toHaveLength(13);
    expect(payfitHistoryLimit(raw)).toBeNull();
  });
  it("sans effet sur une DSN ni sur une lecture PayFit sans mois limité", async () => {
    const dsn = dsnFixtureBuild();
    expect(rawPayfitHistory(dsn)).toBe(dsn);
    const recent = await payfitEdgeBuild({ collaborators: [{ id: "P1" }], contracts: [{ contractId: "C1", collaboratorId: "P1", startDate: "2026-01-01", endDate: null }] }, ["2026-01", "2026-09"]);
    expect(payfitHistoryLimit(recent)).toBeNull();
    expect(rawPayfitHistory(recent)).toBe(recent);
  });
});

describe("historique PayFit brut — KPI sur la lecture fictive du 21/10/2026", async () => {
  const raw = rawPayfitHistory(await payfitFixtureBuild());
  const abs = await fixtureAbsences();
  const w = rollingWindow("2026-09");
  it("turnover 10/2025 → 09/2026 : 12/83 = 14,46 % (1 entrée, 1 sortie), comme la DSN ; N-1 7/13 (sept entrées, aucune sortie)", () => {
    const cmp = compareWindows(kpiInput(raw, abs), w, turnover, (t) => t.ratio, "points");
    expect(isRatio(cmp.current, 12, 83)).toBe(true);
    expect(cmp.current).toMatchObject({ entries: 1, exits: 1 });
    expect(isRatio(cmp.previous, 7, 13)).toBe(true);
    expect(cmp.previous).toMatchObject({ entries: 7, exits: 0 });
    expect(cmp.delta.kind === "exact" && same(cmp.delta.value, { num: -42500, den: 1079 })).toBe(true);
  });
  it("absentéisme 10/2025 → 09/2026, trois types de test : 76 j ÷ 2 510 j (ABS-2 : 31 j en octobre, 30 en novembre, 15 en décembre)", () => {
    const a = absenteeism(kpiInput(raw, abs), w);
    expect(isRatio(a, 152, 5020)).toBe(true);
  });
  it("absentéisme N-1 10/2024 → 09/2025 : 40 j (ABS-1 5 j en mars, ABS-3 5 j en août, ABS-2 30 j en septembre) ÷ jours théoriques de la DSN", () => {
    const n1 = rollingWindow("2025-09");
    const theo = theoreticalWindow(kpiInput(dsnFixtureBuild(), DSN_ABSENCES), n1);
    expect(theo.kind).toBe("exact");
    const a = absenteeism(kpiInput(raw, abs), n1);
    expect(theo.kind === "exact" && isRatio(a, 80, theo.half)).toBe(true);
  });
  it("type par défaut (maladie ordinaire) absent de la lecture fictive : 0 j ÷ 2 510 j, exact", () => {
    const a = absenteeism(kpiInput(raw, abs, { absenceTypes: ["fr_maladie_ordinaire"] }), w);
    expect(isRatio(a, 0, 5020)).toBe(true);
  });
});
