import { describe, expect, it } from "vitest";
import { monthRange } from "@/lib/connectors/months";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";
import { etpAverage, headcountAverage } from "@/lib/rh/kpi/average";
import { compareWindows, etpValue } from "@/lib/rh/kpi/compare";
import { etp4FromFte, etp4FromQuotas, etpMonthEnd } from "@/lib/rh/kpi/etp";
import { same } from "@/lib/rh/kpi/fraction";
import { civilWindow, monthWindow, rollingWindow } from "@/lib/rh/kpi/period";
import type { EtpMonthEnd } from "@/lib/rh/kpi/types";
import { NIR, type DsnDeclarationSpec } from "./helpers/edge-cases";
import { DSN_ABSENCES, fixtureAbsences, kpiInput } from "./helpers/kpi";
import { dsnBuild, dsnFixtureBuild, edgeFiles, fixtureFiles, payfitBuild, payfitEdgeBuild, payfitFixtureBuild } from "./helpers/rh";

// Cas de référence écrits à la main (profil A) : quotités 1 / 0,8 / 0,5 ; ETP fin de mois 4,8 → 5,6 → 5,1 → 6,1.
const e4 = (e: EtpMonthEnd) => (e.kind === "nd" ? e.nd.code : `${e.kind}:${e.etp4}`);

describe("ETP contractuel fin de mois — PayFit (lecture du 21/10/2026)", async () => {
  const data = await payfitFixtureBuild();
  const input = kpiInput(data, await fixtureAbsences());
  it("P2 : 6,1 exact fin septembre 2026, sept contributions ; N-1 en borne basse ⇒ écart n.d.", () => {
    const e = etpMonthEnd(input, "2026-09");
    expect(e4(e)).toBe("exact:61000");
    if (e.kind === "nd") return;
    const byExt = Object.fromEntries(e.contributions.map((c) => [c.externalId.slice(-3), `${c.etp4}:${c.basis}`]));
    expect(byExt).toEqual({ "001": "10000:payfit_full_time", "002": "8000:payfit_fte", "004": "10000:payfit_full_time", "005": "10000:payfit_full_time", "006": "10000:payfit_full_time", "007": "8000:payfit_fte", "008": "5000:payfit_fte" });
    expect(e.qualifiers).toContain("quotités à la date de lecture (21/10/2026), non historisées par PayFit");
    const cmp = compareWindows<EtpMonthEnd>(input, monthWindow("2026-09"), (i, w) => etpMonthEnd(i, w.to), etpValue, "etp");
    expect(e4(cmp.previous)).toBe("lower_bound:56000");
    expect(cmp.delta).toMatchObject({ kind: "nd", nd: { code: "previous-lower-bound" } });
  });
  it("P3 : mois charnière exact en fin de mois (B4 au jour près), borne basse avant, n.d. après la référence et avant la couverture", () => {
    expect(e4(etpMonthEnd(input, "2025-10"))).toBe("exact:56000");
    expect(e4(etpMonthEnd(input, "2025-11"))).toBe("exact:56000");
    expect(e4(etpMonthEnd(input, "2025-12"))).toBe("exact:56000");
    expect(e4(etpMonthEnd(input, "2026-01"))).toBe("exact:51000");
    expect(e4(etpMonthEnd(input, "2026-02"))).toBe("exact:61000");
    expect(e4(etpMonthEnd(input, "2025-09"))).toBe("lower_bound:56000");
    expect(e4(etpMonthEnd(input, "2024-10"))).toBe("lower_bound:48000");
    expect(e4(etpMonthEnd(input, "2026-10"))).toBe("after-reference");
    expect(e4(etpMonthEnd(input, "2024-09"))).toBe("before-coverage");
  });
  it("P4 : ETP moyen et effectif moyen 12 mois glissants exacts (707/120, 83/12) ; N-1 et année 2025 n.d. (borne basse) ; 2026 non close", () => {
    const w = rollingWindow("2026-09");
    const avg = etpAverage(input, w);
    expect(avg.kind === "exact" && same(avg.ratio, { num: 707, den: 120 })).toBe(true);
    const hc = headcountAverage(input, w);
    expect(hc.kind === "exact" && same(hc.ratio, { num: 83, den: 12 })).toBe(true);
    const prev = etpAverage(input, rollingWindow("2025-09"));
    expect(prev).toMatchObject({ kind: "nd", nd: { code: "month-lower-bound", months: monthRange("2024-10", "2025-09") } });
    expect(etpAverage(input, civilWindow(2025))).toMatchObject({ kind: "nd", nd: { code: "month-lower-bound", months: monthRange("2025-01", "2025-09") } });
    expect(headcountAverage(input, civilWindow(2026))).toMatchObject({ kind: "nd", nd: { code: "period-not-closed" } });
    const cmp = compareWindows(input, w, etpAverage, (a) => a.ratio, "etp");
    expect(cmp.delta).toMatchObject({ kind: "nd", nd: { code: "previous-nd" } });
  });
});

describe("ETP contractuel — DSN (24 mois complets)", () => {
  const input = kpiInput(dsnFixtureBuild(), DSN_ABSENCES);
  it("D1 : 6,1 fin 2026-09 (0,8000346 → 0,8000), N-1 5,6, écart +0,50 ; contrôle « modalité absente »", () => {
    const e = etpMonthEnd(input, "2026-09");
    expect(e4(e)).toBe("exact:61000");
    if (e.kind !== "nd") {
      expect(e.contributions.every((c) => c.basis === "dsn_ratio" && c.checks.includes("modalité S21.G00.40.014 absente : rapport des quotités"))).toBe(true);
      expect(e.contributions.find((c) => c.externalId.endsWith("002"))?.etp4).toBe(8000);
    }
    const cmp = compareWindows<EtpMonthEnd>(input, monthWindow("2026-09"), (i, w) => etpMonthEnd(i, w.to), etpValue, "etp");
    expect(e4(cmp.previous)).toBe("exact:56000");
    expect(cmp.delta).toEqual({ kind: "exact", unit: "etp", value: { num: 1, den: 2 } });
  });
  it("D1b : 4,8 / 5,6 / 5,1 ; 2026-10 n.d. après la référence", () => {
    expect(e4(etpMonthEnd(input, "2024-10"))).toBe("exact:48000");
    expect(e4(etpMonthEnd(input, "2025-04"))).toBe("exact:56000");
    expect(e4(etpMonthEnd(input, "2026-01"))).toBe("exact:51000");
    expect(e4(etpMonthEnd(input, "2026-10"))).toBe("after-reference");
  });
  it("D2/D3 : moyennes 12 mois glissants et N-1 avec écarts exacts", () => {
    const w = rollingWindow("2026-09");
    const etp = compareWindows(input, w, etpAverage, (a) => a.ratio, "etp");
    expect(etp.current.kind === "exact" && same(etp.current.ratio, { num: 707, den: 120 })).toBe(true);
    expect(etp.previous.kind === "exact" && same(etp.previous.ratio, { num: 26, den: 5 })).toBe(true);
    expect(etp.delta.kind === "exact" && same(etp.delta.value, { num: 83, den: 120 })).toBe(true);
    const hc = compareWindows(input, w, headcountAverage, (a) => a.ratio, "persons");
    expect(hc.current.kind === "exact" && same(hc.current.ratio, { num: 83, den: 12 })).toBe(true);
    expect(hc.previous.kind === "exact" && same(hc.previous.ratio, { num: 13, den: 2 })).toBe(true);
    expect(hc.delta.kind === "exact" && same(hc.delta.value, { num: 5, den: 12 })).toBe(true);
  });
  it("D6 : année civile 2025 — ETP moyen 27/5, effectif moyen 27/4, N-1 2024 n.d. (avant la couverture)", () => {
    const etp = compareWindows(input, civilWindow(2025), etpAverage, (a) => a.ratio, "etp");
    expect(etp.current.kind === "exact" && same(etp.current.ratio, { num: 27, den: 5 })).toBe(true);
    expect(etp.previous).toMatchObject({ kind: "nd", nd: { code: "month-nd" } });
    const hc = headcountAverage(input, civilWindow(2025));
    expect(hc.kind === "exact" && same(hc.ratio, { num: 27, den: 4 })).toBe(true);
    expect(e4(etpMonthEnd(input, "2025-12"))).toBe("exact:56000");
  });
  it("D8 : un mois manquant rend les moyennes de la fenêtre n.d. en citant le mois", () => {
    const hole = kpiInput(dsnBuild(fixtureFiles(monthRange("2024-10", "2026-09").filter((m) => m !== "2025-11"))), DSN_ABSENCES);
    const avg = etpAverage(hole, rollingWindow("2026-09"));
    expect(avg).toMatchObject({ kind: "nd", nd: { code: "month-nd", months: ["2025-11"] } });
    expect(avg.kind === "nd" && avg.nd.reason).toContain("2025-11");
    expect(etpMonthEnd(hole, "2025-11")).toMatchObject({ kind: "nd", nd: { code: "month-not-covered" } });
  });
});

describe("ETP — lecture PayFit le dernier jour d'un mois (Q)", async () => {
  const q = await payfitBuild("fixture-A-1", createFixtureFetch("fixture-A-1"), monthRange("2024-10", "2026-01"), new Date("2026-01-31T08:00:00Z"));
  const input = kpiInput(q, await fixtureAbsences("fixture-A-1", monthRange("2024-10", "2026-01")));
  it("Q2 : ETP moyen 217/40 (« 5,43 »), effectif moyen 27/4 sur 2025-02 → 2026-01", () => {
    const w = rollingWindow("2026-01");
    const avg = etpAverage(input, w);
    expect(avg.kind === "exact" && same(avg.ratio, { num: 217, den: 40 })).toBe(true);
    const hc = headcountAverage(input, w);
    expect(hc.kind === "exact" && same(hc.ratio, { num: 27, den: 4 })).toBe(true);
  });
});

describe("Quotités construites (cas E)", () => {
  const decl = (contracts: DsnDeclarationSpec["people"][number]["contracts"], extra: Partial<DsnDeclarationSpec> = {}): DsnDeclarationSpec => ({ month: "2025-01", people: [{ nir: NIR.a, employeeNumber: "A", contracts }], ...extra });
  const one = (c: Partial<DsnDeclarationSpec["people"][number]["contracts"][number]>) => decl([{ number: "K-1", start: "2025-01-01", gross: "1000.00", ...c }]);
  const etpOf = (specs: DsnDeclarationSpec[], over = {}, scope = {}) => etpMonthEnd(kpiInput(dsnBuild(edgeFiles(specs)), DSN_ABSENCES, over, scope), "2025-01");
  it("E1 : modalité temps plein ⇒ 1 avec contrôle ; désactivé ⇒ 0,7912 / 0,791 / 0,79", () => {
    const e = etpOf([one({ modality: "10", quota: "120.00" })]);
    expect(e4(e)).toBe("exact:10000");
    if (e.kind !== "nd") {
      expect(e.contributions[0].basis).toBe("dsn_full_time_modality");
      expect(e.contributions[0].checks.join(" ")).toContain("rapport 0,7912 : 1 retenu");
    }
    expect(e4(etpOf([one({ modality: "10", quota: "120.00" })], { fullTimeIsOne: false }))).toBe("exact:7912");
    expect(e4(etpOf([one({ modality: "10", quota: "120.00" })], { fullTimeIsOne: false, etpDecimals: 3 }))).toBe("exact:7910");
    expect(e4(etpOf([one({ modality: "10", quota: "120.00" })], { fullTimeIsOne: false, etpDecimals: 2 }))).toBe("exact:7900");
  });
  it("E2 : 169 / 151,67 ⇒ 1 (plafond, signalé) ; sans plafond 1,1143", () => {
    const e = etpOf([one({ quota: "169.00" })]);
    expect(e4(e)).toBe("exact:10000");
    if (e.kind !== "nd") expect(e.contributions[0].checks.join(" ")).toContain("ramené à 1");
    expect(e4(etpOf([one({ quota: "169.00" })], { capAtOne: false }))).toBe("exact:11143");
  });
  it("E3 : référence absente ⇒ contrat n.d. ; avec un autre contrat ⇒ « ≥ 1 » ; seul ⇒ n.d. « aucune quotité lisible »", () => {
    const alone = etpOf([one({ reference: null })]);
    expect(alone).toMatchObject({ kind: "nd", nd: { code: "quota-missing", reason: expect.stringContaining("aucune quotité lisible : S21.G00.40.012 absente") } });
    const two = etpOf([decl([{ number: "K-1", start: "2025-01-01", reference: null, gross: "1000.00" }, { number: "K-2", start: "2025-01-01", gross: "1000.00" }])]);
    expect(e4(two)).toBe("lower_bound:10000");
    expect(two.missing.map((m) => m.externalId)).toEqual(["K-1"]);
  });
  it("E3c : modalité temps plein et quotité négative ⇒ 1 retenu, signalé ; arrondi ⌊⌋ exact pour une valeur négative", () => {
    const e = etpOf([one({ modality: "10", quota: "-75.84" })]);
    expect(e4(e)).toBe("exact:10000");
    if (e.kind !== "nd") expect(e.contributions[0].checks.join(" ")).toContain("quotité du contrat négative (S21.G00.40.013 = -75,84) : 1 retenu");
    // ⌊(2 × −10000 + 1) ÷ 2⌋ = −10000 ; ⌊(2 × −5000 + 100) ÷ 200⌋ × 100 = −5000 ; ⌊(2 × −758350 × 10⁴ + 1516700) ÷ 3033400⌋ = −5000.
    const ref0 = etpOf([one({ modality: "10", reference: "0" })]);
    expect(e4(ref0)).toBe("exact:10000");
    if (ref0.kind !== "nd") expect(ref0.contributions[0].checks.join(" ")).toContain("quotité de référence nulle ou négative (S21.G00.40.012 = 0)");
    expect(etp4FromFte(-1, 4)).toBe(-10000);
    expect(etp4FromFte(-0.5, 2)).toBe(-5000);
    expect(etp4FromQuotas(-75.835, 151.67, 4)).toBe(-5000);
  });
  it("E3b : quotité négative (S21.G00.40.013 = -75,84) ⇒ contrat n.d., jamais soustrait ; avec un autre contrat ⇒ « ≥ 1 »", () => {
    const alone = etpOf([one({ quota: "-75.84" })]);
    expect(alone).toMatchObject({ kind: "nd", nd: { code: "quota-missing", reason: expect.stringContaining("quotité du contrat négative") } });
    const two = etpOf([decl([{ number: "K-1", start: "2025-01-01", quota: "-75.84", gross: "1000.00" }, { number: "K-2", start: "2025-01-01", gross: "1000.00" }])]);
    expect(e4(two)).toBe("lower_bound:10000");
    expect(two.missing.map((m) => m.externalId)).toEqual(["K-1"]);
  });
  it("E4 : forfait jours 218/218 ⇒ 1 ; unités 90 et 99 non interprétées ⇒ n.d.", () => {
    expect(e4(etpOf([one({ unit: "20", quota: "218", reference: "218" })]))).toBe("exact:10000");
    expect(etpOf([one({ unit: "90" })])).toMatchObject({ kind: "nd", nd: { reason: expect.stringContaining("autre unité (90) non interprétée") } });
    expect(etpOf([one({ unit: "99" })])).toMatchObject({ kind: "nd", nd: { reason: expect.stringContaining("sans objet (99)") } });
  });
  it("E5 : quotités divergentes entre deux SIRET ⇒ n.d. ; filtre sur un SIRET ⇒ sa quotité", () => {
    const specs = [{ ...one({}), nic: "00011" }, { ...one({ quota: "75.84" }), nic: "00022" }];
    expect(etpOf(specs)).toMatchObject({ kind: "nd", nd: { code: "quota-missing", reason: expect.stringContaining("quotités divergentes") } });
    expect(e4(etpOf(specs, {}, { establishments: ["00000000000011"] }))).toBe("exact:10000");
  });
  it("E6–E10 : quotités PayFit (temps plein, ETP nul, plafond, arrondi, droit absent)", async () => {
    const contract = (o: Record<string, unknown>) => ({ collaborators: [{ id: "P1" }], contracts: [{ contractId: "C1", collaboratorId: "P1", startDate: "2026-01-01", endDate: null, ...o }] });
    const at = async (edge: Parameters<typeof payfitEdgeBuild>[0], over = {}) => etpMonthEnd(kpiInput(await payfitEdgeBuild(edge), DSN_ABSENCES, over), "2026-03");
    expect(e4(await at(contract({ isFullTime: true, fullTimeEquivalent: 0.97 })))).toBe("exact:10000");
    expect(e4(await at(contract({ isFullTime: true, fullTimeEquivalent: 0.97 }), { fullTimeIsOne: false }))).toBe("exact:9700");
    expect(await at(contract({ isFullTime: false, fullTimeEquivalent: null }))).toMatchObject({ kind: "nd", nd: { code: "quota-missing" } });
    expect(e4(await at(contract({ isFullTime: false, fullTimeEquivalent: 1.2 })))).toBe("exact:10000");
    expect(e4(await at(contract({ isFullTime: false, fullTimeEquivalent: 0.8333 })))).toBe("exact:8333");
    expect(e4(await at(contract({ isFullTime: false, fullTimeEquivalent: 0.8333 }), { etpDecimals: 2 }))).toBe("exact:8300");
    const noScope = await at({ ...contract({}), scopes: "accounting:read collaborators:read contracts:read time:read" });
    expect(noScope).toMatchObject({ kind: "nd", nd: { code: "quota-missing", reason: expect.stringContaining("contracts:time-information:read") } });
  });
});
