import { describe, expect, it } from "vitest";
import { monthRange } from "@/lib/connectors/months";
import { monthEnd } from "@/lib/dates";
import { headcountAt } from "@/lib/rh/headcount";
import { headcountAverage } from "@/lib/rh/kpi/average";
import { same } from "@/lib/rh/kpi/fraction";
import { countedOpts, lastClosedMonth, rollingWindow } from "@/lib/rh/kpi/period";
import { turnover } from "@/lib/rh/kpi/turnover";
import { NIR, type DsnDeclarationSpec, type DsnPerson } from "./helpers/edge-cases";
import { DSN_ABSENCES, kpiInput } from "./helpers/kpi";
import { dsnBuild, edgeFiles } from "./helpers/rh";

// Établissements DSN qui ferment, déménagent ou déposent en décalé (cas fictifs écrits à la main).
const people = (): DsnPerson[] => [
  { nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-A", start: "2023-01-01", nature: "01", gross: "2000.00" }] },
  { nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-B", start: "2023-01-01", nature: "01", gross: "2000.00" }] },
  { nir: NIR.c, employeeNumber: "C", contracts: [{ number: "K-C", start: "2023-06-01", nature: "01", gross: "2000.00" }] },
];
const files = (specs: DsnDeclarationSpec[]) => edgeFiles(specs).map((f, i) => ({ ...f, filename: `${i}-${f.filename}` }));
const isAvg = (a: ReturnType<typeof headcountAverage>, num: number, den: number) => a.kind === "exact" && same(a.ratio, { num, den });

describe("établissement réputé fermé (plus de déclaration, contrats terminés ou transférés)", () => {
  it("déménagement : NIC 00011 jusqu'en juin 2025, NIC 00029 ensuite, mêmes contrats ⇒ effectif exact 3, aucun mouvement", () => {
    const d = dsnBuild(files(monthRange("2024-07", "2026-09").map((month) => ({ month, nic: month < "2025-07" ? "00011" : "00029", people: people() }))));
    const i = kpiInput(d, DSN_ABSENCES);
    expect(headcountAt(d, monthEnd("2026-09"), countedOpts(i))).toMatchObject({ kind: "exact", persons: 3 });
    // 12 mois × 3 personnes = 36 ⇒ 36/12 = 3 ; aucune entrée ni sortie (même contrat sous le nouveau SIRET).
    expect(isAvg(headcountAverage(i, rollingWindow("2026-09")), 36, 12)).toBe(true);
    expect(turnover(i, rollingWindow("2026-09"))).toMatchObject({ kind: "exact", entries: 0, exits: 0 });
    expect(d.findings.some((f) => f.code === "establishment-closed" && f.month === "2025-07")).toBe(true);
  });
  it("site secondaire dont le dernier salarié sort le 31/03/2025 : plus manquant ensuite", () => {
    const spec = (month: string): DsnDeclarationSpec[] => {
      const main: DsnDeclarationSpec = { month, nic: "00011", people: people() };
      if (month > "2025-03") return [main];
      const leaver: DsnPerson = { nir: "2990175100040", employeeNumber: "D", contracts: [{ number: "K-D", start: "2023-01-01", nature: "01", gross: "1800.00", ...(month === "2025-03" ? { end: "2025-03-31", endReason: "059" } : {}) }] };
      return [main, { month, nic: "00022", people: [leaver] }];
    };
    const d = dsnBuild(files(monthRange("2024-07", "2026-06").flatMap(spec)));
    const i = kpiInput(d, DSN_ABSENCES);
    expect(headcountAt(d, monthEnd("2026-06"), countedOpts(i))).toMatchObject({ kind: "exact", persons: 3 });
    expect(isAvg(headcountAverage(i, rollingWindow("2026-06")), 36, 12)).toBe(true);
  });
  it("site qui cesse de déposer avec un salarié toujours sous contrat : reste manquant ⇒ n.d. (jamais un total exact sans lui)", () => {
    const spec = (month: string): DsnDeclarationSpec[] => {
      const main: DsnDeclarationSpec = { month, nic: "00011", people: people() };
      if (month > "2025-03") return [main];
      return [main, { month, nic: "00022", people: [{ nir: "2990175100040", employeeNumber: "D", contracts: [{ number: "K-D", start: "2023-01-01", nature: "01", gross: "1800.00" }] }] }];
    };
    const d = dsnBuild(files(monthRange("2024-07", "2026-06").flatMap(spec)));
    expect(headcountAt(d, monthEnd("2026-06"), countedOpts(kpiInput(d, DSN_ABSENCES)))).toMatchObject({ kind: "nd", nd: { code: "month-not-covered" } });
    expect(d.findings.some((f) => f.code === "establishment-closed")).toBe(false);
  });
});

describe("dernier mois clos DSN : complet pour tous les établissements", () => {
  it("site A déposé jusqu'en septembre 2026, site B jusqu'en août ⇒ fenêtre par défaut à fin août, exacte", () => {
    const spec = (month: string, nic: string): DsnDeclarationSpec => ({ month, nic, people: [{ nir: nic === "00011" ? NIR.a : NIR.b, employeeNumber: nic, contracts: [{ number: `K-${nic}`, start: "2023-01-01", nature: "01", gross: "2000.00" }] }] });
    const d = dsnBuild(files([...monthRange("2024-07", "2026-09").map((m) => spec(m, "00011")), ...monthRange("2024-07", "2026-08").map((m) => spec(m, "00022"))]));
    expect(lastClosedMonth(d)).toBe("2026-08");
    expect(isAvg(headcountAverage(kpiInput(d, DSN_ABSENCES), rollingWindow("2026-08")), 24, 12)).toBe(true);
  });
});
