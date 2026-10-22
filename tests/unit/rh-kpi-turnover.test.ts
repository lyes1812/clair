import { describe, expect, it } from "vitest";
import { monthRange } from "@/lib/connectors/months";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";
import { compareWindows } from "@/lib/rh/kpi/compare";
import { same } from "@/lib/rh/kpi/fraction";
import { civilWindow, countedOpts, rollingWindow } from "@/lib/rh/kpi/period";
import { headcountAt } from "@/lib/rh/headcount";
import { monthMovements, turnover, windowMovements } from "@/lib/rh/kpi/turnover";
import type { Turnover } from "@/lib/rh/kpi/types";
import { NIR, PAYFIT_EDGES, payfitEdgeFetch, type DsnDeclarationSpec, type DsnPerson } from "./helpers/edge-cases";
import { DSN_ABSENCES, fixtureAbsences, kpiInput } from "./helpers/kpi";
import { dsnBuild, dsnFixtureBuild, edgeFiles, payfitBuild, payfitFixtureBuild } from "./helpers/rh";

const isRatio = (t: Turnover, num: number, den: number) => t.kind === "exact" && same(t.ratio, { num, den });

describe("turnover — DSN (24 mois)", () => {
  const data = dsnFixtureBuild();
  it("D4 : 12/83 = 14,46 % ; N-1 n.d. (six entrées le 01/10/2024, premier jour couvert : continuité non vérifiable) ; sans neutralisation N-1 7/13 et écart −42500/1079 points", () => {
    const cmp = compareWindows(kpiInput(data, DSN_ABSENCES), rollingWindow("2026-09"), turnover, (t) => t.ratio, "points");
    expect(isRatio(cmp.current, 12, 83)).toBe(true);
    expect(cmp.current).toMatchObject({ entries: 1, exits: 1 });
    expect(cmp.previous).toMatchObject({ kind: "nd", nd: { code: "month-nd", months: ["2024-10"], reason: expect.stringContaining("contrats continus non vérifiables") } });
    expect(cmp.delta).toMatchObject({ kind: "nd", nd: { code: "previous-nd" } });
    const off = compareWindows(kpiInput(data, DSN_ABSENCES, { neutralizeContinuity: false }), rollingWindow("2026-09"), turnover, (t) => t.ratio, "points");
    expect(isRatio(off.current, 12, 83)).toBe(true);
    expect(isRatio(off.previous, 7, 13)).toBe(true);
    expect(off.previous).toMatchObject({ entries: 7, exits: 0 });
    expect(off.delta.kind === "exact" && same(off.delta.value, { num: -42500, den: 1079 })).toBe(true);
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

describe("turnover — couple un pour un (une sortie, deux entrées le lendemain, lecture du 31/01/2026)", async () => {
  // P-X : C-A du 01/06/2024 au 30/06/2025, puis C-B et C-C dès le 01/07/2025 ; P-Y : C-Y depuis 2024. Natures 01.
  // Effectif fin de mois : 2 personnes sur les 12 mois de 2025-02 → 2026-01 (Σ = 24). Couple neutralisé : C-A ↔ C-B
  // (ordre des contrats) ; C-C est une vraie entrée. E = 1, S = 0 ⇒ (12 × 1) ÷ (2 × 24) = 12/48 = 25 %.
  const edge = {
    collaborators: [{ id: "P-X" }, { id: "P-Y" }],
    contracts: [
      { contractId: "C-A", collaboratorId: "P-X", startDate: "2024-06-01", endDate: "2025-06-30", natureContratDsn: "01" },
      { contractId: "C-B", collaboratorId: "P-X", startDate: "2025-07-01", endDate: null, natureContratDsn: "01" },
      { contractId: "C-C", collaboratorId: "P-X", startDate: "2025-07-01", endDate: null, natureContratDsn: "01" },
      { contractId: "C-Y", collaboratorId: "P-Y", startDate: "2024-01-01", endDate: null, natureContratDsn: "01" },
    ],
  };
  const data = await payfitBuild("cle-fictive-edge-1234", payfitEdgeFetch("cle-fictive-edge-1234", edge as never), monthRange("2024-10", "2026-01"), new Date("2026-01-31T08:00:00Z"));
  it("une sortie ne neutralise qu'une entrée : E = 1, S = 0, 12/48", () => {
    const input = kpiInput(data, DSN_ABSENCES);
    const t = turnover(input, rollingWindow("2026-01"));
    expect(isRatio(t, 12, 48)).toBe(true);
    expect(t).toMatchObject({ entries: 1, exits: 0 });
    const july = monthMovements(input, "2025-07").events.map((e) => `${e.row.contract.externalId}:${e.why}`).sort();
    expect(july).toEqual(["C-B:neutralized", "C-C:counted"]);
    expect(monthMovements(input, "2025-06").events.map((e) => `${e.row.contract.externalId}:${e.why}`)).toEqual(["C-A:neutralized"]);
  });
});

describe("turnover — appariement indépendant des filtres (C-B en CDD, C-C en CDI, lecture du 31/01/2026)", async () => {
  // La sortie CDI C-A s'apparie à l'entrée de même nature C-C, quels que soient les filtres ; C-B (CDD) est une vraie entrée.
  // Sans filtre : E = 1 (C-B), 12/48. CDI : P-Y + P-X = 2 personnes × 12 mois, E = 0 ⇒ 0/48. CDD : P-X de 2025-07 à 2026-01
  // (7 mois, Σ = 7), E = 1 ⇒ 12/14 = 6/7. Les deux vues filtrées s'additionnent à la vue complète (0 + 1 = 1 entrée).
  const edge = {
    collaborators: [{ id: "P-X" }, { id: "P-Y" }],
    contracts: [
      { contractId: "C-A", collaboratorId: "P-X", startDate: "2024-06-01", endDate: "2025-06-30", natureContratDsn: "01" },
      { contractId: "C-B", collaboratorId: "P-X", startDate: "2025-07-01", endDate: null, natureContratDsn: "02" },
      { contractId: "C-C", collaboratorId: "P-X", startDate: "2025-07-01", endDate: null, natureContratDsn: "01" },
      { contractId: "C-Y", collaboratorId: "P-Y", startDate: "2024-01-01", endDate: null, natureContratDsn: "01" },
    ],
  };
  const data = await payfitBuild("cle-fictive-edge-1234", payfitEdgeFetch("cle-fictive-edge-1234", edge as never), monthRange("2024-10", "2026-01"), new Date("2026-01-31T08:00:00Z"));
  const w = rollingWindow("2026-01");
  const july = (scope = {}) => monthMovements(kpiInput(data, DSN_ABSENCES, {}, scope), "2025-07").events.map((e) => `${e.row.contract.externalId}:${e.why}`).sort();
  it("même couple dans toutes les vues ; totaux cohérents", () => {
    expect(july()).toEqual(["C-B:counted", "C-C:neutralized"]);
    expect(july({ nature: "01" })).toEqual(["C-B:out-of-scope", "C-C:neutralized"]);
    expect(july({ nature: "02" })).toEqual(["C-B:counted", "C-C:out-of-scope"]);
    const all = turnover(kpiInput(data, DSN_ABSENCES), w);
    expect(isRatio(all, 12, 48)).toBe(true);
    expect(all).toMatchObject({ entries: 1, exits: 0 });
    expect(isRatio(turnover(kpiInput(data, DSN_ABSENCES, {}, { nature: "01" }), w), 0, 48)).toBe(true);
    const cdd = turnover(kpiInput(data, DSN_ABSENCES, {}, { nature: "02" }), w);
    expect(isRatio(cdd, 12, 14)).toBe(true);
    expect(cdd).toMatchObject({ entries: 1, exits: 0 });
  });
});

describe("turnover — partenaire de nature comptée prioritaire (Paramètres), lecture du 31/01/2026", async () => {
  // P-X : CDI C-A jusqu'au 30/06/2025 ; le 01/07/2025, C-B (29, stage, nature non comptée) et C-C (02, CDD). Le couple
  // neutralisé est C-A ↔ C-C, les deux de natures comptées ; C-B est hors effectif. P-X compté chaque mois, P-Y aussi :
  // Σ = 24 ; E = 0, S = 0 ⇒ 0/48 (une sortie appariée au stage aurait donné E = 1, S = 1, 24/48).
  const edge = {
    collaborators: [{ id: "P-X" }, { id: "P-Y" }],
    contracts: [
      { contractId: "C-A", collaboratorId: "P-X", startDate: "2024-06-01", endDate: "2025-06-30", natureContratDsn: "01" },
      { contractId: "C-B", collaboratorId: "P-X", startDate: "2025-07-01", endDate: null, natureContratDsn: "29" },
      { contractId: "C-C", collaboratorId: "P-X", startDate: "2025-07-01", endDate: null, natureContratDsn: "02" },
      { contractId: "C-Y", collaboratorId: "P-Y", startDate: "2024-01-01", endDate: null, natureContratDsn: "01" },
    ],
  };
  it("CDI → CDD neutralisé malgré un stage commencé le même jour", async () => {
    const data = await payfitBuild("cle-fictive-edge-1234", payfitEdgeFetch("cle-fictive-edge-1234", edge as never), monthRange("2024-10", "2026-01"), new Date("2026-01-31T08:00:00Z"));
    const input = kpiInput(data, DSN_ABSENCES);
    expect(monthMovements(input, "2025-07").events.map((e) => `${e.row.contract.externalId}:${e.why}`).sort()).toEqual(["C-B:out-of-scope", "C-C:neutralized"]);
    expect(monthMovements(input, "2025-06").events.map((e) => `${e.row.contract.externalId}:${e.why}`)).toEqual(["C-A:neutralized"]);
    const t = turnover(input, rollingWindow("2026-01"));
    expect(isRatio(t, 0, 48)).toBe(true);
    expect(t).toMatchObject({ entries: 0, exits: 0 });
  });
});

describe("turnover — sortie de nature comptée prioritaire quand un stage finit le même jour (lecture du 31/01/2026)", async () => {
  // P-X : stage C-S (29) du 01/01/2024 au 30/06/2025 et CDI C-A (01) du 01/06/2024 au 30/06/2025 ; CDD C-C (02) dès le
  // 01/07/2025. Le référentiel ne marque que la sortie du stage (commencé en premier) : le couple compté reste C-A ↔ C-C.
  // P-X et P-Y comptés chaque mois : Σ = 24 ; E = 0, S = 0 ⇒ 0/48.
  const edge = {
    collaborators: [{ id: "P-X" }, { id: "P-Y" }],
    contracts: [
      { contractId: "C-S", collaboratorId: "P-X", startDate: "2024-01-01", endDate: "2025-06-30", natureContratDsn: "29" },
      { contractId: "C-A", collaboratorId: "P-X", startDate: "2024-06-01", endDate: "2025-06-30", natureContratDsn: "01" },
      { contractId: "C-C", collaboratorId: "P-X", startDate: "2025-07-01", endDate: null, natureContratDsn: "02" },
      { contractId: "C-Y", collaboratorId: "P-Y", startDate: "2024-01-01", endDate: null, natureContratDsn: "01" },
    ],
  };
  it("CDI ↔ CDD neutralisé, stage hors effectif", async () => {
    const data = await payfitBuild("cle-fictive-edge-1234", payfitEdgeFetch("cle-fictive-edge-1234", edge as never), monthRange("2024-10", "2026-01"), new Date("2026-01-31T08:00:00Z"));
    const input = kpiInput(data, DSN_ABSENCES);
    expect(monthMovements(input, "2025-06").events.map((e) => `${e.row.contract.externalId}:${e.why}`).sort()).toEqual(["C-A:neutralized", "C-S:out-of-scope"]);
    expect(monthMovements(input, "2025-07").events.map((e) => `${e.row.contract.externalId}:${e.why}`)).toEqual(["C-C:neutralized"]);
    const t = turnover(input, rollingWindow("2026-01"));
    expect(isRatio(t, 0, 48)).toBe(true);
    expect(t).toMatchObject({ entries: 0, exits: 0 });
  });
});

describe("turnover — contrats continus aux bords de la couverture DSN (jour voisin non déposé)", () => {
  // A : CDD K-A1 jusqu'au 30/09/2025 puis CDI K-A2 dès le 01/10/2025 ; B : CDI stable. 2 personnes × 12 mois : Σ = 24.
  const right = (month: string): DsnDeclarationSpec => {
    const people: DsnPerson[] = [{ nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-B", start: "2024-01-01", nature: "01", gross: "2000.00" }] }];
    const a: DsnPerson["contracts"] = [];
    if (month <= "2025-09") a.push({ number: "K-A1", start: "2024-03-01", nature: "02", gross: "1500.00", ...(month === "2025-09" ? { end: "2025-09-30", endReason: "031" } : {}) });
    if (month >= "2025-10") a.push({ number: "K-A2", start: "2025-10-01", nature: "01", gross: "1500.00" });
    people.push({ nir: NIR.a, employeeNumber: "A", contracts: a });
    return { month, people };
  };
  // C : CDD K-C1 jusqu'au 30/09/2024 puis CDI K-C2 dès le 01/10/2024 ; B : CDI stable.
  const left = (month: string): DsnDeclarationSpec => {
    const people: DsnPerson[] = [{ nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-B", start: "2024-01-01", nature: "01", gross: "2000.00" }] }];
    const c: DsnPerson["contracts"] = [];
    if (month <= "2024-09") c.push({ number: "K-C1", start: "2024-03-01", nature: "02", gross: "1500.00", ...(month === "2024-09" ? { end: "2024-09-30", endReason: "031" } : {}) });
    if (month >= "2024-10") c.push({ number: "K-C2", start: "2024-10-01", nature: "01", gross: "1500.00" });
    people.push({ nir: NIR.c, employeeNumber: "C", contracts: c });
    return { month, people };
  };
  const w = rollingWindow("2025-09");
  it("sortie le dernier jour du dernier mois déposé : n.d. (jamais deux valeurs « exactes ») ; octobre déposé : neutralisée, 0/48 ; sans neutralisation : 12/48", () => {
    const before = dsnBuild(edgeFiles(monthRange("2024-10", "2025-09").map(right)));
    const t = turnover(kpiInput(before, DSN_ABSENCES), w);
    expect(t).toMatchObject({ kind: "nd", nd: { code: "month-nd", months: ["2025-09"], reason: expect.stringContaining("K-A1 le 30/09/2025") } });
    expect(monthMovements(kpiInput(before, DSN_ABSENCES), "2025-09").events.map((e) => e.why)).toEqual(["continuity-unknown"]);
    expect(isRatio(turnover(kpiInput(before, DSN_ABSENCES, { neutralizeContinuity: false }), w), 12, 48)).toBe(true);
    // La variante « sorties ÷ effectif au premier jour » dépend aussi de cette sortie : n.d.
    expect(turnover(kpiInput(before, DSN_ABSENCES, { turnoverFormula: "exits_over_start" }), w).kind).toBe("nd");
    const after = dsnBuild(edgeFiles(monthRange("2024-10", "2025-10").map(right)));
    const t2 = turnover(kpiInput(after, DSN_ABSENCES), w);
    expect(isRatio(t2, 0, 48)).toBe(true);
    const exit = monthMovements(kpiInput(after, DSN_ABSENCES), "2025-09").events[0];
    expect(exit.why).toBe("neutralized");
    expect(exit.label).toBe("contrat continu neutralisé (avec K-A2 le 01/10/2025)");
  });
  it("entrée le premier jour du premier mois déposé : n.d. ; septembre 2024 déposé : neutralisée, 0/48 ; sans neutralisation : 12/48", () => {
    const first = dsnBuild(edgeFiles(monthRange("2024-10", "2025-09").map(left)));
    expect(turnover(kpiInput(first, DSN_ABSENCES), w)).toMatchObject({ kind: "nd", nd: { months: ["2024-10"], reason: expect.stringContaining("K-C2 le 01/10/2024") } });
    expect(isRatio(turnover(kpiInput(first, DSN_ABSENCES, { neutralizeContinuity: false }), w), 12, 48)).toBe(true);
    // Les entrées n'interviennent pas dans « sorties ÷ effectif au premier jour » : 0 sortie ÷ 2 personnes, exact ; total des entrées non publié.
    const start = turnover(kpiInput(first, DSN_ABSENCES, { turnoverFormula: "exits_over_start" }), w);
    expect(isRatio(start, 0, 2)).toBe(true);
    expect(start).toMatchObject({ entries: null, exits: 0 });
    const withSept = dsnBuild(edgeFiles(monthRange("2024-09", "2025-09").map(left)));
    expect(isRatio(turnover(kpiInput(withSept, DSN_ABSENCES), w), 0, 48)).toBe(true);
    // Ligne « Période » : sorties exactes (0) même si les entrées sont n.d., chacune avec sa propre raison.
    const totals = windowMovements(kpiInput(first, DSN_ABSENCES), w);
    expect(totals.exits).toEqual({ kind: "exact", value: 0 });
    expect(totals.entries).toMatchObject({ kind: "nd", nd: { months: ["2024-10"], reason: expect.stringContaining("K-C2 le 01/10/2024") } });
  });
  it("sortie de nature exclue au dernier jour déposé : jamais comptée ⇒ exact (0/48), sans incertitude", () => {
    const before = dsnBuild(edgeFiles(monthRange("2024-10", "2025-09").map(right)));
    const t = turnover(kpiInput(before, DSN_ABSENCES, { excludedExitNatures: ["02"] }), w);
    expect(isRatio(t, 0, 48)).toBe(true);
    expect(monthMovements(kpiInput(before, DSN_ABSENCES, { excludedExitNatures: ["02"] }), "2025-09").events.map((e) => e.why)).toEqual(["excluded-nature"]);
  });
  it("deux SIRET : partenaire non compté trouvé (stage) mais l'autre SIRET n'a pas déposé le lendemain ⇒ n.d. ; déposé avec un CDI ⇒ neutralisé", () => {
    // A : CDI K-A1 au SIRET 1 jusqu'au 30/09/2025, stage K-A2 (29) au SIRET 1 dès le 01/10/2025 ; le SIRET 2 dépose (ou non)
    // octobre 2025 avec un CDI K-A3 de A commençant le 01/10/2025. B (SIRET 1) et C (SIRET 2) stables : 3 personnes, Σ = 36.
    const spec = (month: string, nic: string, withA3: boolean): DsnDeclarationSpec => {
      const people: DsnPerson[] = [];
      if (nic === "00011") {
        people.push({ nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-B", start: "2024-01-01", nature: "01", gross: "2000.00" }] });
        const a: DsnPerson["contracts"] = [];
        if (month <= "2025-09") a.push({ number: "K-A1", start: "2024-03-01", nature: "01", gross: "1500.00", ...(month === "2025-09" ? { end: "2025-09-30", endReason: "059" } : {}) });
        if (month >= "2025-10") a.push({ number: "K-A2", start: "2025-10-01", nature: "29", gross: "600.00" });
        people.push({ nir: NIR.a, employeeNumber: "A", contracts: a });
      } else {
        people.push({ nir: NIR.c, employeeNumber: "C", contracts: [{ number: "K-C", start: "2024-01-01", nature: "01", gross: "2000.00" }] });
        if (withA3 && month >= "2025-10") people.push({ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-A3", start: "2025-10-01", nature: "01", gross: "900.00" }] });
      }
      return { month, nic, people };
    };
    const s1 = monthRange("2024-10", "2025-10").map((m) => spec(m, "00011", false));
    const files = (specs: DsnDeclarationSpec[]) => edgeFiles(specs).map((f, i) => ({ ...f, filename: `${i}-${f.filename}` }));
    const partial = dsnBuild(files([...s1, ...monthRange("2024-10", "2025-09").map((m) => spec(m, "00022", false))]));
    const full = dsnBuild(files([...s1, ...monthRange("2024-10", "2025-10").map((m) => spec(m, "00022", true))]));
    expect(turnover(kpiInput(partial, DSN_ABSENCES), w)).toMatchObject({ kind: "nd", nd: { months: ["2025-09"], reason: expect.stringContaining("K-A1 le 30/09/2025") } });
    const t = turnover(kpiInput(full, DSN_ABSENCES), w);
    expect(isRatio(t, 0, 72)).toBe(true);
    expect(monthMovements(kpiInput(full, DSN_ABSENCES), "2025-09").events.map((e) => e.label)).toEqual(["contrat continu neutralisé (avec K-A3 le 01/10/2025)"]);
  });
});

describe("turnover — révisions DSN : aucune valeur « exacte » qui changerait au dépôt suivant", () => {
  const S1 = "00000000000011";
  it("écran filtré sur un SIRET : neutralisation seulement si le lendemain est déposé partout ; sinon n.d., puis 24/48 une fois déposé", () => {
    // A quitte K-A1 (CDI, SIRET 1) le 30/06/2025 ; le 01/07, K-A2 (CDD, SIRET 1) et K-A3 (CDI, SIRET 2). B (SIRET 1), C (SIRET 2) stables.
    const spec = (month: string, nic: string): DsnDeclarationSpec => {
      const people: DsnPerson[] = [];
      if (nic === "00011") {
        people.push({ nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-B", start: "2024-01-01", nature: "01", gross: "2000.00" }] });
        if (month <= "2025-06") people.push({ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-A1", start: "2024-01-01", nature: "01", gross: "1500.00", ...(month === "2025-06" ? { end: "2025-06-30", endReason: "059" } : {}) }] });
        else people.push({ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-A2", start: "2025-07-01", nature: "02", gross: "700.00" }] });
      } else {
        people.push({ nir: NIR.c, employeeNumber: "C", contracts: [{ number: "K-C", start: "2024-01-01", nature: "01", gross: "2000.00" }] });
        if (month >= "2025-07") people.push({ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-A3", start: "2025-07-01", nature: "01", gross: "800.00" }] });
      }
      return { month, nic, people };
    };
    const files = (specs: DsnDeclarationSpec[]) => edgeFiles(specs).map((f, i) => ({ ...f, filename: `${i}-${f.filename}` }));
    const base = [...monthRange("2024-08", "2025-07").map((m) => spec(m, "00011")), ...monthRange("2024-08", "2025-06").map((m) => spec(m, "00022"))];
    const w = rollingWindow("2025-07");
    // SIRET 2 n'a pas encore déposé juillet : le couple K-A1 ↔ K-A2 n'est pas certain (K-A3 pourrait apparaître) ⇒ n.d.
    const before = dsnBuild(files(base));
    expect(turnover(kpiInput(before, DSN_ABSENCES, {}, { establishments: [S1] }), w).kind).toBe("nd");
    expect(monthMovements(kpiInput(before, DSN_ABSENCES, {}, { establishments: [S1] }), "2025-06").events.map((e) => e.why)).toEqual(["continuity-unknown"]);
    // Juillet déposé : K-A1 ↔ K-A3 (même nature), hors du SIRET filtré ⇒ K-A1 sortie comptée, K-A2 entrée comptée : E = S = 1, Σ = 24.
    const after = dsnBuild(files([...base, spec("2025-07", "00022")]));
    const t = turnover(kpiInput(after, DSN_ABSENCES, {}, { establishments: [S1] }), w);
    expect(isRatio(t, 24, 48)).toBe(true);
    expect(t).toMatchObject({ entries: 1, exits: 1 });
  });
  it("contrat redéclaré sans fin après sa fin (versement après départ présumé) : sortie comptée, effectif exact ; limite écrite si la rupture était annulée", () => {
    // K-A : fin au 30/06/2025 déclarée en juin, redéclaré sans fin en juillet et août (régularisation ?), fin au 30/09 en septembre.
    const spec = (month: string): DsnDeclarationSpec => {
      const people: DsnPerson[] = [{ nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-B", start: "2024-01-01", nature: "01", gross: "2000.00" }] }];
      const a = { number: "K-A", start: "2024-01-01", nature: "01", gross: "1500.00" };
      if (month === "2025-06") people.push({ nir: NIR.a, employeeNumber: "A", contracts: [{ ...a, end: "2025-06-30", endReason: "059" }] });
      else if (month === "2025-09") people.push({ nir: NIR.a, employeeNumber: "A", contracts: [{ ...a, end: "2025-09-30", endReason: "059" }] });
      else if (month <= "2025-09") people.push({ nir: NIR.a, employeeNumber: "A", contracts: [a] });
      return { month, people };
    };
    const w = rollingWindow("2025-07");
    // Jusqu'en juillet : sortie du 30/06 comptée (S = 1), effectif fin juillet 1 (K-B), K-A compté à part.
    // Σ effectifs 2024-08 → 2025-07 = 11 × 2 + 1 = 23 ⇒ (12 × 1) ÷ (2 × 23) = 12/46.
    const july = dsnBuild(edgeFiles(monthRange("2024-08", "2025-07").map(spec)));
    const i1 = kpiInput(july, DSN_ABSENCES);
    expect(monthMovements(i1, "2025-06").exits).toMatchObject({ kind: "exact", value: 1 });
    expect(headcountAt(july, "2025-07-31", countedOpts(i1))).toMatchObject({ kind: "exact", persons: 1, declaredAfterEndKeys: [expect.stringContaining("dsn:")] });
    expect(isRatio(turnover(i1, w), 12, 46)).toBe(true);
    // La DSN de septembre déclare une nouvelle fin : la rupture de juin était annulée ; les chiffres sont corrigés (limite écrite).
    const sept = dsnBuild(edgeFiles(monthRange("2024-08", "2025-09").map(spec)));
    expect(isRatio(turnover(kpiInput(sept, DSN_ABSENCES), w), 0, 48)).toBe(true);
  });
});
