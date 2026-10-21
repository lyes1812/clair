import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/crypto";
import { PAYFIT_EDGES } from "./helpers/edge-cases";
import { PROFILE_A } from "./helpers/reference";
import { byKey, payfitEdgeBuild, payfitFixtureBuild } from "./helpers/rh";

// Cas de référence écrits à la main (PROFILE_A) sur le transport PayFit fictif, lecture du 21/10/2026.
describe("référentiel PayFit — profil A, photographie 1", async () => {
  const b = await payfitFixtureBuild();
  const cell = (id: string, month: string) => b.months.find((m) => m.contractKey === `payfit:TEST-A-CONTRACT-${id}` && m.month === month)!;

  it("date de référence, bornes de présence et résumé", () => {
    expect(b.build.referenceDate).toBe("2026-10-21");
    expect(b.build.presenceFrom).toBe("2024-10");
    expect(b.build.presenceTo).toBe("2026-10");
    expect(b.build.unavailableReason).toBeNull();
    expect(b.build.summary).toMatchObject({ persons: 8, contracts: 8, events: 9 });
    expect(b.build.inputs).toMatchObject({ source: "payfit", company: { id: "test-a-1" } });
  });

  it("contrats : dates, natures et attributs de la fixture, statut copié mais jamais utilisé", () => {
    for (const [id, ref] of Object.entries(PROFILE_A.contracts)) {
      const c = b.contracts.find((x) => x.externalId === id)!;
      expect(c).toMatchObject({ personKey: `payfit:${ref.person}`, nature: ref.nature, startDate: ref.start, endDate: ref.end, establishmentId: "test-a-1" });
      expect(c.provenance.startDate?.label).toBe(`PayFit · lecture du 21/10/2026 · contracts · ${id} · startDate`);
    }
    const c1 = byKey(b.contracts, "CONTRACT-001");
    expect(c1).toMatchObject({ fteAtRead: 1, weeklyHoursAtRead: 40, isFullTimeAtRead: true, modalityAtRead: "standard", executive: false, statusSource: "ACTIVE", endStatus: "none_cdi" });
    const c3 = byKey(b.contracts, "CONTRACT-003");
    expect(c3).toMatchObject({ statusSource: "ARCHIVED", endStatus: "known", nature: "02", endDate: "2025-12-31", endReason: null });
    expect(c3.fieldsNd.endReason).toMatchObject({ code: "not-in-source" });
  });

  it("personnes : libellés d'affichage avec provenance, équipe n.d. (non renseignée)", () => {
    const p = b.persons.find((x) => x.personKey === "payfit:TEST-A-PERSON-001")!;
    expect(p).toMatchObject({ identifierKind: "payfit", externalId: "TEST-A-PERSON-001", familyName: "Fictif A-001", givenNames: "TEST", employeeNumber: "001", hasContract: true, siren: "000000000" });
    expect(p.provenance.familyName?.path).toBe("lastName");
    expect(p.fieldsNd.teamName).toMatchObject({ code: "not-provided" });
    expect(p.fieldsNd.usageName).toMatchObject({ code: "not-in-source" });
  });

  it("événements : 8 entrées et la sortie du 003 au 31/12/2025, motif n.d.", () => {
    expect(b.events.filter((e) => e.kind === "entry")).toHaveLength(8);
    const exits = b.events.filter((e) => e.kind === "exit");
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ contractKey: "payfit:TEST-A-CONTRACT-003", date: "2025-12-31", month: "2025-12", nature: "02", endReason: null });
    expect(exits[0].fieldsNd.endReason?.code).toBe("not-in-source");
    expect(exits[0].flags).toEqual([]);
    const e4 = b.events.find((e) => e.contractKey === "payfit:TEST-A-CONTRACT-004")!;
    expect(e4).toMatchObject({ kind: "entry", date: "2026-02-15", flags: [] });
    expect(b.events.find((e) => e.contractKey === "payfit:TEST-A-CONTRACT-001")!.flags).toEqual(["lower_bound_window"]);
  });

  it("couverture : borne basse avant octobre 2025, complète ensuite, temps hors périmètre en 2026-10", () => {
    const status = (m: string) => b.coverage.find((c) => c.month === m)!;
    expect(b.coverage).toHaveLength(25);
    expect(status("2024-10")).toMatchObject({ presenceStatus: "lower_bound", timeStatus: "read" });
    expect(status("2025-09").presenceStatus).toBe("lower_bound");
    expect(status("2025-10").presenceStatus).toBe("complete");
    expect(status("2026-09")).toMatchObject({ presenceStatus: "complete", timeStatus: "read" });
    expect(status("2026-10")).toMatchObject({ presenceStatus: "complete", timeStatus: "out_of_scope" });
    expect(status("2024-10").presenceReason).toContain("hypothèse à confirmer");
    expect(b.findings.filter((f) => f.code === "lower-bound-window")).toHaveLength(1);
  });

  it("cellules de temps : 0 conservé, null ⇒ n.d., ligne absente ⇒ n.d., mois hors périmètre ⇒ n.d.", () => {
    expect(cell("001", "2025-06")).toMatchObject({ paidTime: 0, workedTime: 0, timeUnit: "hours", presentMonthEnd: true, presentAnyDay: true });
    expect(cell("002", "2025-07").paidTime).toBe(128);
    expect(cell("002", "2025-07").workedTime).toBeNull();
    expect(cell("002", "2025-07").fieldsNd.workedTime).toMatchObject({ code: "not-provided" });
    expect(cell("005", "2025-11").paidTime).toBeNull();
    expect(cell("005", "2025-11").fieldsNd.paidTime?.code).toBe("not-provided");
    expect(cell("005", "2025-11").workedTime).toBe(0);
    expect(cell("004", "2026-02").fieldsNd.paidTime?.code).toBe("not-provided");
    expect(cell("004", "2026-02").fieldsNd.workedTime?.code).toBe("not-provided");
    expect(cell("003", "2025-11")).toMatchObject({ paidTime: 80, workedTime: 75 });
    expect(cell("003", "2025-11").provenance.paidTime?.label).toBe("PayFit · lecture du 21/10/2026 · worked_time · TEST-A-CONTRACT-003@2025-11 · paidWorkedTime");
    expect(b.months.find((m) => m.contractKey === "payfit:TEST-A-CONTRACT-003" && m.month === "2026-01")).toBeUndefined();
    expect(cell("001", "2026-10").fieldsNd.paidTime).toMatchObject({ code: "month-out-of-scope" });
    expect(cell("001", "2026-10").presentMonthEnd).toBe(true);
    expect(cell("001", "2024-10").fieldsNd.nature?.code).toBe("not-in-source");
  });

  it("présence par mois : 003 présent en 2025-12, absent de 2026-01 ; 004 présent depuis 2026-02", () => {
    expect(cell("003", "2025-12").presentMonthEnd).toBe(true);
    expect(cell("004", "2026-02")).toMatchObject({ presentAnyDay: true, presentMonthEnd: true });
    expect(b.months.find((m) => m.contractKey === "payfit:TEST-A-CONTRACT-004" && m.month === "2026-01")).toBeUndefined();
    expect(b.findings.filter((f) => f.code === "time-missing")).toHaveLength(0);
  });

  it("déterminisme : deux constructions donnent le même JSON canonique", async () => {
    const again = await payfitFixtureBuild();
    expect(canonicalJson(again)).toBe(canonicalJson(b));
  });

  it("photographie 2 : libellé corrigé et temps 005@2025-11 renseigné à 0", async () => {
    const b2 = await payfitFixtureBuild("fixture-A-2");
    expect(b2.persons.find((p) => p.personKey === "payfit:TEST-A-PERSON-001")?.familyName).toBe("Fictif A-001 — libellé corrigé");
    expect(b2.months.find((m) => m.contractKey === "payfit:TEST-A-CONTRACT-005" && m.month === "2025-11")?.paidTime).toBe(0);
    expect(b2.build.inputsHash).not.toBe(b.build.inputsHash);
  });
});

describe("référentiel PayFit — cas limites", () => {
  it("A1 : deux contrats simultanés, une personne, constat", async () => {
    const b = await payfitEdgeBuild(PAYFIT_EDGES.simultaneous);
    expect(b.persons).toHaveLength(1);
    expect(b.contracts).toHaveLength(2);
    expect(b.findings.filter((f) => f.code === "simultaneous-contracts")).toMatchObject([{ contractKeys: ["payfit:C-SIM-1", "payfit:C-SIM-2"], personKeys: ["payfit:P-SIM"] }]);
  });

  it("A2/A3 : réembauche marquée, continuité J/J+1 marquée sur la sortie et l'entrée", async () => {
    const b = await payfitEdgeBuild(PAYFIT_EDGES.rehire);
    const ev = (key: string, kind: string) => b.events.find((e) => e.contractKey === `payfit:${key}` && e.kind === kind)!;
    expect(ev("C-REH-2", "entry").flags).toContain("rehire");
    expect(ev("C-CONT-1", "exit").flags).toContain("continuity_same_person");
    expect(ev("C-CONT-2", "entry").flags).toContain("continuity_same_person");
    expect(ev("C-CONT-2", "entry").flags).not.toContain("rehire");
    // Le transport des cas limites ne renvoie aucune ligne de temps : les constats « time-missing » (F2) s'ajoutent.
    const codes = new Set(b.findings.map((f) => f.code));
    expect(codes).toEqual(new Set(["continuity-same-person", "lower-bound-window", "rehire", "time-missing"]));
    expect(b.findings.filter((f) => f.code === "rehire")).toHaveLength(1);
  });

  it("B2/B3/B5/B6/B7/B8 : en attente, sans début, sans contrat, sans personne, fin future, CDD sans fin", async () => {
    const b = await payfitEdgeBuild(PAYFIT_EDGES.incomplete);
    const c = (key: string) => b.contracts.find((x) => x.contractKey === `payfit:${key}`)!;
    const ev = (key: string, kind: string) => b.events.find((e) => e.contractKey === `payfit:${key}` && e.kind === kind);
    expect(ev("C-PEND", "entry")).toMatchObject({ date: "2026-12-01" });
    expect(ev("C-PEND", "entry")!.flags.sort()).toEqual(["future", "pending"]);
    expect(c("C-NOSTART").endStatus).toBe("unpositioned");
    expect(ev("C-NOSTART", "entry")).toBeUndefined();
    expect(b.months.some((m) => m.contractKey === "payfit:C-NOSTART")).toBe(false);
    expect(c("C-ORPHAN").personKey).toBeNull();
    expect(c("C-ORPHAN").fieldsNd.personKey?.code).toBe("no-person");
    expect(b.persons.find((p) => p.personKey === "payfit:P-ALONE")?.hasContract).toBe(false);
    expect(ev("C-CDDFUT", "exit")).toMatchObject({ date: "2027-03-31", flags: ["future"] });
    expect(c("C-CDDNULL").endStatus).toBe("none_other_nature");
    expect(c("C-CDDNULL").fieldsNd.endDate?.code).toBe("not-provided");
    const codes = b.findings.map((f) => f.code);
    for (const code of ["pending", "no-start-date", "person-without-contract", "contract-without-person", "end-not-provided"]) expect(codes).toContain(code);
    expect(b.findings.find((f) => f.code === "pending")?.severity).toBe("info");
  });

  it("C11 : natures 01, 29 et 80 conservées telles quelles", async () => {
    const b = await payfitEdgeBuild(PAYFIT_EDGES.natures);
    expect(b.contracts.map((c) => c.nature).sort()).toEqual(["01", "29", "80"]);
  });

  it("F5 : sans droit contracts:read, le référentiel est indisponible avec sa raison", async () => {
    const b = await payfitEdgeBuild({ ...PAYFIT_EDGES.natures, scopes: "accounting:read" });
    expect(b.build.unavailableReason).toContain("contracts:read");
    expect(b.contracts).toHaveLength(0);
    expect(b.persons).toHaveLength(0);
  });

  it("F5 bis : sans droit time:read, les cellules de temps sont n.d. (droit manquant) et la couverture le dit", async () => {
    const b = await payfitEdgeBuild({ ...PAYFIT_EDGES.natures, scopes: "collaborators:read contracts:read" });
    const m = b.months.find((x) => x.contractKey === "payfit:C-CDI" && x.month === "2025-06")!;
    expect(m.fieldsNd.paidTime).toMatchObject({ code: "scope-missing" });
    expect(b.coverage.every((c) => c.timeStatus === "unavailable")).toBe(true);
    expect(b.contracts[0].fieldsNd.fteAtRead?.code).toBe("scope-missing");
  });

  it("F2/E1 : contrat présent sans ligne de temps dans un mois lu ⇒ constat ; temps négatif conservé et signalé", async () => {
    const b = await payfitEdgeBuild({ collaborators: [{ id: "P-T" }], contracts: [{ contractId: "C-T", collaboratorId: "P-T", startDate: "2026-01-01", endDate: null }], timeByMonth: { "2026-02": [{ contractId: "C-T", payed: -8, effective: 0 }] } }, ["2026-01", "2026-02"]);
    const jan = b.months.find((m) => m.month === "2026-01")!;
    expect(jan.flags).toContain("time_missing");
    expect(jan.fieldsNd.paidTime?.code).toBe("no-time-line");
    const feb = b.months.find((m) => m.month === "2026-02")!;
    expect(feb.paidTime).toBe(-8);
    expect(feb.flags).toContain("negative_time");
    expect(b.findings.filter((f) => f.code === "negative-time")).toHaveLength(1);
    expect(b.findings.filter((f) => f.code === "time-missing")).toHaveLength(1);
    expect(b.months.find((m) => m.month === "2026-10")?.fieldsNd.paidTime?.code).toBe("month-out-of-scope");
  });
});
