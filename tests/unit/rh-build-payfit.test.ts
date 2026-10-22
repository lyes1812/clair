import { describe, expect, it } from "vitest";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";
import { canonicalJson } from "@/lib/crypto";
import { buildFromPayFit } from "@/lib/rh/referential/build-payfit";
import { PAYFIT_EDGES, payfitEdgeFetch } from "./helpers/edge-cases";
import { PROFILE_A } from "./helpers/reference";
import { byKey, PAYFIT_MONTHS, PAYFIT_STARTED_AT, payfitBuild, payfitEdgeBuild, payfitFixtureBuild } from "./helpers/rh";

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
    // La provenance cite le champ de l'enregistrement conservé (executive), pas le nom brut de l'API.
    expect(c1.provenance.executive?.path).toBe("executive");
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

  it("couverture : borne basse jusqu'au mois charnière (octobre 2025 inclus), complète ensuite, temps hors périmètre en 2026-10", () => {
    const status = (m: string) => b.coverage.find((c) => c.month === m)!;
    expect(b.coverage).toHaveLength(25);
    expect(status("2024-10")).toMatchObject({ presenceStatus: "lower_bound", timeStatus: "read" });
    expect(status("2025-09").presenceStatus).toBe("lower_bound");
    // Lecture du 21/10/2026 − 12 mois = 2025-10 : un contrat archivé début octobre 2025 peut déjà manquer.
    expect(status("2025-10").presenceStatus).toBe("lower_bound");
    expect(status("2025-11").presenceStatus).toBe("complete");
    expect(b.coverage.filter((c) => c.presenceStatus === "lower_bound")).toHaveLength(13);
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

  it("D2 : date de référence au fuseau Europe/Paris (23:30 UTC le 31/10 = 1er novembre à Paris)", async () => {
    const late = await payfitBuild("fixture-A-1", createFixtureFetch("fixture-A-1"), PAYFIT_MONTHS, new Date("2026-10-31T23:30:00Z"));
    expect(late.build.referenceDate).toBe("2026-11-01");
    expect(late.build.presenceTo).toBe("2026-11");
    expect(late.coverage).toHaveLength(26);
    const early = await payfitBuild("fixture-A-1", createFixtureFetch("fixture-A-1"), PAYFIT_MONTHS, new Date("2026-10-31T22:30:00Z"));
    expect(early.build.referenceDate).toBe("2026-10-31");
  });

  it("B2 : statut en attente avec date de début passée ⇒ constat « check », sans drapeau « à venir » ; sans début ⇒ raison explicite", async () => {
    const b = await payfitEdgeBuild({
      collaborators: [{ id: "P-PAST" }, { id: "P-NODATE" }],
      contracts: [
        { contractId: "C-PEND-PAST", collaboratorId: "P-PAST", startDate: "2026-09-01", endDate: null, status: "PENDING" },
        { contractId: "C-PEND-NODATE", collaboratorId: "P-NODATE", startDate: null, endDate: null, status: "PENDING" },
      ],
    });
    const past = b.findings.find((f) => f.code === "pending" && f.contractKeys.includes("payfit:C-PEND-PAST"))!;
    expect(past.severity).toBe("check");
    expect(past.message).toContain("date de début passée");
    expect(b.events.find((e) => e.contractKey === "payfit:C-PEND-PAST")!.flags).toEqual(["pending"]);
    const nodate = b.contracts.find((c) => c.contractKey === "payfit:C-PEND-NODATE")!;
    expect(nodate.fieldsNd.startDate?.reason).toContain("en attente chez PayFit");
    expect(b.findings.find((f) => f.code === "pending" && f.contractKeys.includes("payfit:C-PEND-NODATE"))?.severity).toBe("info");
  });

  it("B3 : fin renseignée sans date de début ⇒ fin conservée et tracée, contrat non positionnable", async () => {
    const b = await payfitEdgeBuild({ collaborators: [{ id: "P1" }], contracts: [{ contractId: "C1", collaboratorId: "P1", startDate: null, endDate: "2026-03-31", natureContratDsn: "02" }] });
    expect(b.contracts[0]).toMatchObject({ endDate: "2026-03-31", endStatus: "unpositioned" });
    expect(b.contracts[0].provenance.endDate?.path).toBe("endDate");
    expect(b.months).toHaveLength(0);
    expect(b.events).toHaveLength(0);
  });

  it("B6 bis : deux contrats d'un collaborateur absent de la collection ⇒ un seul constat portant les deux contrats", async () => {
    const b = await payfitEdgeBuild({ collaborators: [], contracts: [{ contractId: "C1", collaboratorId: "P-X", startDate: "2026-01-01", endDate: null }, { contractId: "C2", collaboratorId: "P-X", startDate: "2026-03-01", endDate: null }] });
    const f = b.findings.filter((x) => x.code === "person-not-in-collaborators");
    expect(f).toHaveLength(1);
    expect(f[0].contractKeys).toEqual(["payfit:C1", "payfit:C2"]);
    expect(b.persons).toHaveLength(1);
    expect(b.persons[0].fieldsNd.familyName?.code).toBe("not-provided");
  });

  it("E1 : unité de temps absente ⇒ n.d. avec raison ; ligne de temps hors période du contrat conservée et signalée", async () => {
    const fetchImpl: ReturnType<typeof payfitEdgeFetch> = async (url, init) => {
      const res = await payfitEdgeFetch("cle-fictive-edge-1234", { collaborators: [{ id: "P1" }], contracts: [{ contractId: "C1", collaboratorId: "P1", startDate: "2025-06-01", endDate: "2026-01-31", natureContratDsn: "02" }], timeByMonth: { "2026-01": [{ contractId: "C1", payed: 10, effective: 10 }], "2026-03": [{ contractId: "C1", payed: -8, effective: 0 }] } })(url, init);
      if (!String(url).includes("contracts/time")) return res;
      const body = (await res.json()) as { contracts: Record<string, unknown>[] };
      return new Response(JSON.stringify({ ...body, contracts: body.contracts.map((c) => ({ ...c, workTimeUnit: null })) }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const b = await payfitBuild("cle-fictive-edge-1234", fetchImpl, ["2026-01", "2026-02", "2026-03"]);
    const jan = b.months.find((m) => m.month === "2026-01")!;
    expect(jan).toMatchObject({ paidTime: 10, timeUnit: null, presentAnyDay: true });
    expect(jan.fieldsNd.timeUnit).toMatchObject({ code: "not-provided" });
    const mar = b.months.find((m) => m.month === "2026-03")!;
    expect(mar).toMatchObject({ presentAnyDay: false, presentMonthEnd: false, paidTime: -8, workedTime: 0 });
    expect(mar.flags.sort()).toEqual(["negative_time", "time_outside_contract"]);
    expect(b.findings.filter((f) => f.code === "time-outside-contract")).toMatchObject([{ month: "2026-03" }]);
    expect(b.findings.filter((f) => f.code === "negative-time")).toHaveLength(1);
  });

  it("D4 : contrat à venir dans le mois de la lecture ⇒ cellules n.d. sans constat ; mois en cours sans ligne ⇒ pas de constat", async () => {
    const b = await payfitEdgeBuild({ collaborators: [{ id: "P-F" }, { id: "P-N" }], contracts: [{ contractId: "C-F", collaboratorId: "P-F", startDate: "2026-10-25", endDate: null }, { contractId: "C-N", collaboratorId: "P-N", startDate: "2026-10-01", endDate: null }] }, ["2026-09", "2026-10"]);
    const future = b.months.find((m) => m.contractKey === "payfit:C-F")!;
    expect(future.month).toBe("2026-10");
    expect(future.fieldsNd.paidTime?.code).toBe("after-reference");
    expect(future.flags).toEqual([]);
    const current = b.months.find((m) => m.contractKey === "payfit:C-N")!;
    expect(current.fieldsNd.paidTime?.reason).toContain("mois en cours");
    expect(current.flags).toEqual([]);
    expect(b.findings.filter((f) => f.code === "time-missing")).toHaveLength(0);
  });

  it("entrées malformées : enregistrement sans identifiant ⇒ erreur claire, jamais une clé inventée", async () => {
    const base = await payfitFixtureBuild();
    const sync = { id: "s", startedAt: PAYFIT_STARTED_AT, decidedAt: null, scope: { months: [] }, summary: { collections: base.build.inputs.source === "payfit" ? base.build.inputs.collections : [] }, contentHash: null };
    expect(() => buildFromPayFit({ sync, records: [{ collection: "collaborators", key: "k1", period: null, data: { lastName: "X" } }] })).toThrow(/sans identifiant/);
    expect(() => buildFromPayFit({ sync, records: [{ collection: "contracts", key: "c1", period: null, data: { collaboratorId: "P" } }] })).toThrow(/sans identifiant/);
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
