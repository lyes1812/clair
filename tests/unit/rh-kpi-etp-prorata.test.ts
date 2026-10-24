import { describe, expect, it } from "vitest";
import { compareWindows, etpProratedValue } from "@/lib/rh/kpi/compare";
import { kpiDashboard, kpiDetail, KPI_DETAIL_IDS } from "@/lib/rh/kpi/dashboard";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { ETP_PRORATED_LABEL, etpProratedMonth, etpProratedQualifier } from "@/lib/rh/kpi/etp-prorata";
import { same } from "@/lib/rh/kpi/fraction";
import { monthWindow } from "@/lib/rh/kpi/period";
import type { EtpProrated } from "@/lib/rh/kpi/types";
import { NIR, type DsnDeclarationSpec } from "./helpers/edge-cases";
import { DSN_ABSENCES, fixtureAbsences, kpiInput } from "./helpers/kpi";
import { dsnBuild, edgeFiles, payfitEdgeBuild, payfitFixtureBuild } from "./helpers/rh";

// ETP contractuel proratisé : Σ quotité × jours sous contrat du mois ÷ jours du mois, en fraction exacte (quotités en dix-millièmes).
// Données fictives construites à la main. Avril 2026 : 30 jours calendaires, 22 jours du lundi au vendredi (1er avril = mercredi).
const PAYFIT_QUALIFIER = "ETP contractuel proratisé : quotité à la date de lecture (21/10/2026), proratisée sur les jours sous contrat du mois ; ni ETP payé ni historique exact";
const DSN_QUALIFIER = "ETP contractuel proratisé : quotité déclarée dans la DSN du mois, proratisée sur les jours sous contrat du mois ; ni ETP payé ni historique exact";

type Prorated = Extract<EtpProrated, { kind: "exact" | "lower_bound" }>;
const valued = (e: EtpProrated): Prorated => {
  if (e.kind === "nd") throw new Error(`n.d. inattendu : ${e.nd.reason}`);
  return e;
};

// A : 1 ETP tout le mois ; B : 0,5 ETP du 16 au 30 avril ; C : 0,8 ETP jusqu'au 10 avril.
const THREE = {
  collaborators: [{ id: "P-A" }, { id: "P-B" }, { id: "P-C" }],
  contracts: [
    { contractId: "C-A", collaboratorId: "P-A", startDate: "2025-01-01", endDate: null },
    { contractId: "C-B", collaboratorId: "P-B", startDate: "2026-04-16", endDate: null, isFullTime: false, fullTimeEquivalent: 0.5 },
    { contractId: "C-C", collaboratorId: "P-C", startDate: "2025-01-01", endDate: "2026-04-10", isFullTime: false, fullTimeEquivalent: 0.8 },
  ],
};

describe("ETP contractuel proratisé — PayFit (lecture du 21/10/2026, avril 2026)", async () => {
  const data = await payfitEdgeBuild(THREE);
  it("libellé et qualifieur", () => {
    expect(ETP_PRORATED_LABEL).toBe("ETP contractuel proratisé — quotité actuelle");
    expect(etpProratedQualifier(kpiInput(data, DSN_ABSENCES))).toBe(PAYFIT_QUALIFIER);
  });
  it("base calendrier : 1 × 30/30 + 0,5 × 15/30 + 0,8 × 10/30 = 91/60, fraction exacte sans arrondi", () => {
    // Dix-millièmes × jours : 10000 × 30 + 5000 × 15 + 8000 × 10 = 300 000 + 75 000 + 80 000 = 455 000 ; dénominateur 10 000 × 30.
    // 455 000 / 300 000 = 91/60 (1 + 1/4 + 4/15 = 60/60 + 15/60 + 16/60).
    const e = valued(etpProratedMonth(kpiInput(data, DSN_ABSENCES), "2026-04"));
    expect(e.kind).toBe("exact");
    expect(e.ratio).toEqual({ num: 455000, den: 300000 });
    expect(same(e.ratio, { num: 91, den: 60 })).toBe(true);
    expect(e.monthDays).toBe(30);
    expect(e.dayBasis).toBe("calendar");
    expect(Object.fromEntries(e.contributions.map((c) => [c.externalId, `${c.etp4}:${c.from}:${c.to}:${c.days}:${c.weighted}`]))).toEqual({
      "C-A": "10000:2026-04-01:2026-04-30:30:300000",
      "C-B": "5000:2026-04-16:2026-04-30:15:75000",
      "C-C": "8000:2026-04-01:2026-04-10:10:80000",
    });
    expect(e.missing).toEqual([]);
    expect(e.qualifiers).toEqual([PAYFIT_QUALIFIER]);
  });
  it("jours ouvrés (lundi–vendredi) : 22 jours dans le mois ; A 22, B 11, C 8 ⇒ 339/220", () => {
    // 10000 × 22 + 5000 × 11 + 8000 × 8 = 220 000 + 55 000 + 64 000 = 339 000 ; dénominateur 10 000 × 22 = 220 000 ⇒ 339/220.
    const e = valued(etpProratedMonth(kpiInput(data, DSN_ABSENCES, { dayBasis: "weekdays" }), "2026-04"));
    expect(e.ratio).toEqual({ num: 339000, den: 220000 });
    expect(same(e.ratio, { num: 339, den: 220 })).toBe(true);
    expect(e.monthDays).toBe(22);
    expect(e.dayBasis).toBe("weekdays");
    expect(e.contributions.map((c) => c.days)).toEqual([22, 11, 8]);
  });
  it("le stock de fin de mois reste inchangé : A + B = 1,5 (C est parti le 10 avril)", () => {
    const stock = etpMonthEnd(kpiInput(data, DSN_ABSENCES), "2026-04");
    expect(stock).toMatchObject({ kind: "exact", etp4: 15000 });
  });
  it("la quotité est arrondie par le paramètre de décimales avant le prorata, puis aucun autre arrondi", async () => {
    // Un seul contrat de 0,8333 ETP sur tout le mois : 4 décimales ⇒ 8 333 × 30 ÷ 300 000 = 8333/10000 ; 2 décimales ⇒ 8 300 × 30 ÷ 300 000 = 83/100.
    const one = await payfitEdgeBuild({
      collaborators: [{ id: "P-D" }],
      contracts: [{ contractId: "C-D", collaboratorId: "P-D", startDate: "2025-01-01", endDate: null, isFullTime: false, fullTimeEquivalent: 0.8333 }],
    });
    expect(same(valued(etpProratedMonth(kpiInput(one, DSN_ABSENCES, { etpDecimals: 4 }), "2026-04")).ratio, { num: 8333, den: 10000 })).toBe(true);
    expect(same(valued(etpProratedMonth(kpiInput(one, DSN_ABSENCES, { etpDecimals: 2 }), "2026-04")).ratio, { num: 83, den: 100 })).toBe(true);
  });
  it("écart N-1 entre deux valeurs exactes : la valeur de comparaison est la fraction elle-même", () => {
    const input = kpiInput(data, DSN_ABSENCES);
    const cmp = compareWindows<EtpProrated>(input, monthWindow("2026-04"), (i, w) => etpProratedMonth(i, w.to), etpProratedValue, "etp");
    expect(cmp.current).toMatchObject({ kind: "exact", ratio: { num: 455000, den: 300000 } });
    // Avril 2025 est avant la limite de conservation (21/10/2025) : borne basse, écart n.d.
    expect(cmp.previous.kind).toBe("lower_bound");
    expect(cmp.delta).toMatchObject({ kind: "nd", nd: { code: "previous-lower-bound" } });
    expect(etpProratedValue({ ratio: { num: 3, den: 7 } })).toEqual({ num: 3, den: 7 });
  });
});

describe("ETP contractuel proratisé — contrat sans date de début ou sans quotité : borne basse", async () => {
  it("contrat présent sans date de début (ligne de temps en avril) : listé, jamais compté, total « ≥ » = A seul = 1", async () => {
    const data = await payfitEdgeBuild({
      collaborators: [{ id: "P-A" }, { id: "P-N" }],
      contracts: [
        { contractId: "C-A", collaboratorId: "P-A", startDate: "2025-01-01", endDate: null },
        { contractId: "C-N", collaboratorId: "P-N", startDate: null, endDate: null },
      ],
      timeByMonth: { "2026-04": [{ contractId: "C-N", payed: 100, effective: 100 }] },
    });
    const e = valued(etpProratedMonth(kpiInput(data, DSN_ABSENCES), "2026-04"));
    expect(e.kind).toBe("lower_bound");
    expect(e.ratio).toEqual({ num: 300000, den: 300000 }); // 10000 × 30 ÷ (10000 × 30) = 1 : A seul
    expect(e.missing).toMatchObject([{ externalId: "C-N", nd: { code: "no-start-date" } }]);
    expect(e.contributions.map((c) => c.externalId)).toEqual(["C-A"]);
    expect(e.qualifiers).toEqual([PAYFIT_QUALIFIER, "1 contrat(s) présent(s) sans date de début : total en borne basse"]);
  });
  it("contrat sans quotité lisible : « missing » avec raison, total en borne basse ; seul ⇒ n.d. avec la raison du moteur existant", async () => {
    const noQuota = { contractId: "C-Q", collaboratorId: "P-Q", startDate: "2025-01-01", endDate: null, isFullTime: false, fullTimeEquivalent: null };
    const both = await payfitEdgeBuild({ collaborators: [{ id: "P-A" }, { id: "P-Q" }], contracts: [THREE.contracts[0], noQuota] });
    const e = valued(etpProratedMonth(kpiInput(both, DSN_ABSENCES), "2026-04"));
    expect(e.kind).toBe("lower_bound");
    expect(same(e.ratio, { num: 1, den: 1 })).toBe(true);
    expect(e.missing).toMatchObject([{ externalId: "C-Q", nd: { code: "not-provided" } }]); // fullTimeEquivalent nul à la lecture : code de la source
    expect(e.qualifiers).toContain("1 contrat(s) présent(s) sans quotité : total en borne basse");
    const alone = await payfitEdgeBuild({ collaborators: [{ id: "P-Q" }], contracts: [noQuota] });
    const input = kpiInput(alone, DSN_ABSENCES);
    const nd = etpProratedMonth(input, "2026-04");
    expect(nd).toMatchObject({ kind: "nd", nd: { code: "quota-missing", reason: expect.stringContaining("aucune quotité lisible") } });
    // Même raison que l'ETP fin de mois (« aucune quotité lisible : … »).
    const stock = etpMonthEnd(input, "2026-04");
    expect(nd.kind === "nd" && stock.kind === "nd" && nd.nd.reason).toBe(stock.kind === "nd" ? stock.nd.reason : "");
  });
});

describe("ETP contractuel proratisé — n.d. : mois non couvert", async () => {
  const input = kpiInput(await payfitEdgeBuild(THREE), DSN_ABSENCES);
  it("après la date de référence et avant la couverture : n.d. avec la raison du moteur existant (jamais zéro)", () => {
    const after = etpProratedMonth(input, "2026-11");
    expect(after).toMatchObject({ kind: "nd", nd: { code: "after-reference" } });
    const before = etpProratedMonth(input, "2024-09");
    expect(before).toMatchObject({ kind: "nd", nd: { code: "before-coverage" } });
    for (const m of ["2026-11", "2024-09"]) {
      const stock = etpMonthEnd(input, m);
      const mine = etpProratedMonth(input, m);
      expect(mine.kind === "nd" && stock.kind === "nd" && mine.nd.reason === stock.nd.reason).toBe(true);
    }
  });
});

describe("ETP contractuel proratisé — lecture PayFit fictive (profil A)", async () => {
  const data = await payfitFixtureBuild();
  const input = kpiInput(data, await fixtureAbsences());
  it("février 2026 : six contrats toute la période (5,1 ETP) + 004 du 15 au 28 (1 ETP, 14 jours) = 28/5 ; fin de mois 6,1 inchangé", () => {
    // 51 000 × 28 + 10 000 × 14 = 1 428 000 + 140 000 = 1 568 000 ; dénominateur 10 000 × 28 = 280 000 ⇒ 28/5 = 5,6.
    const e = valued(etpProratedMonth(input, "2026-02"));
    expect(e.kind).toBe("exact");
    expect(same(e.ratio, { num: 28, den: 5 })).toBe(true);
    expect(e.contributions.find((c) => c.externalId.endsWith("004"))).toMatchObject({ from: "2026-02-15", to: "2026-02-28", days: 14 });
    expect(etpMonthEnd(input, "2026-02")).toMatchObject({ kind: "exact", etp4: 61000 });
  });
  it("historique signalé : avant la limite de conservation (21/10/2025) le mois est en borne basse, ensuite exact", () => {
    for (const m of ["2024-10", "2025-09", "2025-10"]) {
      const e = valued(etpProratedMonth(input, m));
      expect(e.kind, m).toBe("lower_bound");
      expect(e.qualifiers, m).toContain("mois en borne basse (PayFit) : contrats archivés inconnus");
    }
    expect(valued(etpProratedMonth(input, "2025-11")).kind).toBe("exact");
  });
});

describe("ETP contractuel proratisé — DSN (quotité déclarée du mois)", () => {
  // Janvier 2025 (31 jours) : K-1 0,5 ETP (75,84 / 151,67) tout le mois ; K-2 1 ETP dès le 11 (21 jours) ; K-3 0,8 ETP (121,34 / 151,67)
  // jusqu'au 10 (10 jours). 5 000 × 31 + 10 000 × 21 + 8 000 × 10 = 155 000 + 210 000 + 80 000 = 445 000 ; dénominateur 10 000 × 31 = 310 000.
  // 445 000 / 310 000 = 89/62 (0,5 + 21/31 + 8/31 = 31/62 + 42/62 + 16/62).
  const spec: DsnDeclarationSpec = {
    month: "2025-01",
    people: [
      { nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2024-01-01", quota: "75.84", gross: "1000.00" }] },
      { nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-2", start: "2025-01-11", gross: "1000.00" }] },
      { nir: NIR.c, employeeNumber: "C", contracts: [{ number: "K-3", start: "2024-06-01", end: "2025-01-10", endReason: "059", quota: "121.34", gross: "1000.00" }] },
    ],
  };
  const input = kpiInput(dsnBuild(edgeFiles([spec])), DSN_ABSENCES);
  it("89/62 en base calendrier, qualifieur DSN ; stock de fin de mois 1,5 inchangé", () => {
    const e = valued(etpProratedMonth(input, "2025-01"));
    expect(e.kind).toBe("exact");
    expect(e.ratio).toEqual({ num: 445000, den: 310000 });
    expect(same(e.ratio, { num: 89, den: 62 })).toBe(true);
    expect(e.contributions.map((c) => `${c.externalId}:${c.etp4}:${c.days}`)).toEqual(["K-1:5000:31", "K-2:10000:21", "K-3:8000:10"]);
    expect(e.qualifiers).toEqual([DSN_QUALIFIER]);
    expect(etpMonthEnd(input, "2025-01")).toMatchObject({ kind: "exact", etp4: 15000 });
  });
  it("tableau de bord : ligne du mois, tuile (N-1 avant la couverture ⇒ écart n.d.), détail « etp-prorated »", () => {
    const w = monthWindow("2025-01");
    const d = kpiDashboard(input, w);
    expect(d.rows[0].etpProrated).toMatchObject({ kind: "exact", ratio: { num: 445000, den: 310000 } });
    expect(d.tiles.etpProrated.current).toMatchObject({ kind: "exact", ratio: { num: 445000, den: 310000 } });
    expect(d.tiles.etpProrated.previous).toMatchObject({ kind: "nd", nd: { code: "before-coverage" } });
    expect(d.tiles.etpProrated.delta).toMatchObject({ kind: "nd", nd: { code: "previous-nd" } });
    expect(d.tiles.etpEnd.current).toMatchObject({ kind: "exact", etp4: 15000 });
    expect(KPI_DETAIL_IDS).toContain("etp-prorated");
    const detail = kpiDetail(input, w, "etp-prorated", "2025-01");
    expect(detail?.id === "etp-prorated" && detail.value).toMatchObject({ kind: "exact", ratio: { num: 445000, den: 310000 } });
    expect(kpiDetail(input, w, "etp-prorated", null)).toBeNull();
    expect(kpiDetail(input, w, "etp-prorated", "2020-01")).toBeNull();
  });
});
