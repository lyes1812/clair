import { describe, expect, it } from "vitest";
import { annualList, headcountAt, monthlyList, movements, presenceAt } from "@/lib/rh/headcount";
import type { RhBuildData } from "@/lib/rh/referential/types";
import { DSN_EDGES, NIR, PAYFIT_EDGES } from "./helpers/edge-cases";
import { PROFILE_A, short } from "./helpers/reference";
import { dsnBuild, dsnFixtureBuild, edgeFiles, fixtureFiles, payfitEdgeBuild, payfitFixtureBuild } from "./helpers/rh";

const OPTS = { natures: [...PROFILE_A.headcountNaturesDefault] };
const exact = (r: ReturnType<typeof headcountAt>) => (r.kind === "nd" ? r : { kind: r.kind, persons: r.persons, contracts: r.contracts, byNature: r.byNature });
// Les clés DSN sont des empreintes : on repasse par l'identifiant de source (numéro de contrat) pour lire « 001 ».
const ext = (d: RhBuildData, key: string) => short(d.contracts.find((c) => c.contractKey === key)!.externalId);
const keys = (d: RhBuildData, r: ReturnType<typeof headcountAt>) => (r.kind === "nd" ? [] : r.contractKeys.map((k) => ext(d, k)).sort());

function referenceCases(name: string, data: () => RhBuildData, kindBefore: "exact" | "lower_bound") {
  describe(`règles d'effectif — ${name}`, () => {
    const d = data();
    it.each(Object.entries(PROFILE_A.headcount))("effectif au %s", (date, ref) => {
      const r = headcountAt(d, date, OPTS);
      // PayFit : borne basse jusqu'au mois charnière (lecture du 21/10/2026 − 12 mois = octobre 2025, inclus).
      expect(exact(r)).toEqual({ kind: date < "2025-11-01" ? kindBefore : "exact", persons: ref.persons, contracts: ref.contracts, byNature: ref.byNature });
      expect(keys(d, r)).toEqual([...ref.present]);
    });
    it("bornes incluses : 003 présent le 31/12/2025, absent le 01/01/2026 ; 004 absent le 01/02, présent le 28/02/2026", () => {
      expect(exact(headcountAt(d, "2025-12-31", OPTS))).toMatchObject({ persons: 7 });
      expect(exact(headcountAt(d, "2026-01-01", OPTS))).toMatchObject({ persons: 6 });
      expect(exact(headcountAt(d, "2026-02-01", OPTS))).toMatchObject({ persons: 6 });
      expect(exact(headcountAt(d, "2026-02-28", OPTS))).toMatchObject({ persons: 7 });
    });
    it("au-delà de la date de référence et avant la couverture : n.d. avec raison", () => {
      expect(headcountAt(d, "2026-11-01", OPTS)).toMatchObject({ kind: "nd", nd: { code: "after-reference" } });
      expect(headcountAt(d, "2024-09-15", OPTS)).toMatchObject({ kind: "nd", nd: { code: "before-coverage" } });
    });
    it.each(Object.entries(PROFILE_A.movements))("mouvements et présents au moins un jour en %s", (month, ref) => {
      const mv = movements(d, month, month, OPTS);
      expect(mv.entries.map((e) => short(e.contract.externalId))).toEqual([...ref.entries]);
      expect(mv.exits.map((e) => short(e.contract.externalId))).toEqual([...ref.exits]);
      const ml = monthlyList(d, month, OPTS);
      expect(ml.presentAnyDay).toMatchObject({ persons: ref.presentAnyDay, contracts: ref.presentAnyDay });
      // Mois PayFit en borne basse (avant octobre 2025) : entrées « au moins n », sorties n.d. ; sinon exact.
      const lower = kindBefore === "lower_bound" && month <= "2025-10";
      expect(ml.entriesCount).toMatchObject({ kind: lower ? "lower_bound" : "exact", value: ref.entries.length });
      if (lower) expect(ml.exitsCount).toMatchObject({ kind: "nd" });
      else expect(ml.exitsCount).toMatchObject({ kind: "exact", value: ref.exits.length });
    });
    it("liste mensuelle de février 2026 : 6 présents le 1er, 7 le dernier jour, 004 « entré le 15/02/2026 »", () => {
      const ml = monthlyList(d, "2026-02", OPTS);
      expect(exact(ml.headcountStart)).toMatchObject({ persons: 6 });
      expect(exact(ml.headcountEnd)).toMatchObject({ persons: 7 });
      expect(ml.rows.find((r) => short(r.contract.externalId) === "004")?.state).toEqual({ code: "entered", label: "entré le 15/02/2026" });
      expect(ml.rows).toHaveLength(7);
      expect(monthlyList(d, "2025-12", OPTS).rows.find((r) => short(r.contract.externalId) === "003")?.state.label).toBe("sorti le 31/12/2025");
    });
    it("liste annuelle 2025 : 7 personnes, 6 présents au 01/01, 7 au 31/12, 1 entrée, 1 sortie, 003 12 mois, 002 9 mois", () => {
      const al = annualList(d, 2025, OPTS);
      expect(al.rows).toHaveLength(7);
      expect(exact(al.headcountJan1)).toMatchObject({ persons: 6 });
      expect(exact(al.headcountDec31)).toMatchObject({ persons: 7 });
      expect(al.entriesCount).toMatchObject({ value: 1 });
      expect(al.exitsCount).toMatchObject({ value: 1 });
      const row = (id: string) => al.rows.find((r) => r.contracts.some((c) => short(c.externalId) === id))!;
      expect(row("003").monthsPresent).toBe(12);
      expect(row("002").monthsPresent).toBe(9);
      expect(row("002").presentJan1).toMatchObject({ state: "absent" });
      expect(row("002").strip[3]).toMatchObject({ month: "2025-04", state: "present" });
      expect(al.coveredMonths).toHaveLength(12);
    });
  });
}

// payfitFixtureBuild est asynchrone : on l'attend une fois pour les cas de référence.
const payfitData = await payfitFixtureBuild();
referenceCases("PayFit (borne basse avant octobre 2025)", () => payfitData, "lower_bound");
referenceCases("DSN (24 mois complets)", () => dsnFixtureBuild(), "exact");
describe("règles d'effectif — PayFit, qualificatifs", () => {
  it("borne basse : qualificatif explicite ; sorties des mois en borne basse n.d.", () => {
    const r = headcountAt(payfitData, "2024-10-15", OPTS);
    expect(r.kind).toBe("lower_bound");
    expect(r.kind === "lower_bound" && r.qualifiers[0]).toContain("borne basse");
    const ml = monthlyList(payfitData, "2024-10", OPTS);
    expect(ml.entriesCount).toMatchObject({ kind: "lower_bound", value: 6 });
    expect(ml.exitsCount).toMatchObject({ kind: "nd" });
    expect(movements(payfitData, "2024-10", "2025-09", OPTS).notes).toHaveLength(12);
  });
  it("B4 au jour près : effectif exact dès la date de lecture − 12 mois (21/10/2025), même dans le mois charnière en borne basse", () => {
    expect(headcountAt(payfitData, "2025-10-20", OPTS).kind).toBe("lower_bound");
    expect(exact(headcountAt(payfitData, "2025-10-21", OPTS))).toMatchObject({ kind: "exact", persons: 7 });
    expect(exact(headcountAt(payfitData, "2025-10-31", OPTS))).toMatchObject({ kind: "exact", persons: 7, contracts: 7 });
    const oct = monthlyList(payfitData, "2025-10", OPTS);
    expect(oct.headcountEnd.kind).toBe("exact");
    expect(oct.headcountStart.kind).toBe("lower_bound");
    expect(oct.presentAnyDay.kind).toBe("lower_bound");
    expect(oct.entriesCount.kind).toBe("lower_bound");
    expect(oct.exitsCount.kind).toBe("nd");
  });
  it("mois 2026-10 (mois de la lecture) : effectif fin de mois n.d., effectif au 21/10 exact, mouvements « au moins » ; 2026-11 : après la référence", () => {
    expect(headcountAt(payfitData, "2026-10-31", OPTS)).toMatchObject({ kind: "nd", nd: { code: "after-reference" } });
    expect(exact(headcountAt(payfitData, "2026-10-21", OPTS))).toMatchObject({ persons: 7 });
    const oct = monthlyList(payfitData, "2026-10", OPTS);
    expect(oct.entriesCount).toMatchObject({ kind: "lower_bound", value: 0 });
    expect(oct.entriesCount.kind === "lower_bound" && oct.entriesCount.qualifiers[0]).toContain("21/10/2026");
    expect(monthlyList(payfitData, "2026-11", OPTS).entriesCount).toMatchObject({ kind: "nd", nd: { code: "after-reference" } });
    expect(movements(payfitData, "2026-10", "2026-11", OPTS).notes.map((n) => n.month)).toEqual(["2026-10", "2026-11"]);
  });
  it("mois de la lecture : une entrée connue après la date de référence est « à venir », jamais comptée comme exacte", async () => {
    const d = await payfitEdgeBuild({ collaborators: [{ id: "P-A" }, { id: "P-B" }], contracts: [{ contractId: "C-A", collaboratorId: "P-A", startDate: "2026-10-25", endDate: null }, { contractId: "C-B", collaboratorId: "P-B", startDate: "2026-10-05", endDate: null }] }, ["2026-09", "2026-10"]);
    const oct = monthlyList(d, "2026-10", OPTS);
    expect(oct.entriesCount).toMatchObject({ kind: "lower_bound", value: 1 });
    expect(movements(d, "2026-01", "2026-10", OPTS).upcoming.map((e) => e.contract.externalId)).toEqual(["C-A"]);
  });
  it("liste annuelle : personne aux natures hors effectif ⇒ raison « hors natures comptées », n.d. au-delà de la date de référence", async () => {
    const d = await payfitEdgeBuild(PAYFIT_EDGES.natures);
    const al = annualList(d, 2026, OPTS);
    const stage = al.rows.find((r) => r.person.externalId === "P-STAGE")!;
    expect(stage.presentJan1).toMatchObject({ state: "absent", reason: expect.stringContaining("hors natures comptées") });
    expect(stage.strip[10]).toMatchObject({ month: "2026-11", state: "nd" });
    expect(stage.monthsCovered).toBe(9); // janvier → septembre 2026 ; octobre (fin de mois après la lecture du 21/10) et après : n.d.
    expect(al.rows.find((r) => r.person.externalId === "P-CDI")!.strip[9]).toMatchObject({ month: "2026-10", state: "nd" });
  });
  it("liste annuelle : les entrées et sorties d'une personne s'arrêtent à la date de référence (le reste est « à venir »)", async () => {
    const d = await payfitEdgeBuild({ collaborators: [{ id: "P-C" }], contracts: [{ contractId: "C-C", collaboratorId: "P-C", startDate: "2026-01-01", endDate: "2026-10-28", natureContratDsn: "02" }] });
    const row = annualList(d, 2026, OPTS).rows[0];
    expect(row.entries.map((e) => e.date)).toEqual(["2026-01-01"]);
    expect(row.exits).toEqual([]);
    expect(movements(d, "2026-01", "2026-10", OPTS).upcoming.map((e) => e.event.date)).toEqual(["2026-10-28"]);
  });
});

describe("règles d'effectif — DSN, couverture", () => {
  it("mois manquant ⇒ n.d. (month-not-covered) ; mois voisins exacts", () => {
    const d = dsnBuild(fixtureFiles(["2025-10", "2025-12"]));
    expect(headcountAt(d, "2025-11-15", OPTS)).toMatchObject({ kind: "nd", nd: { code: "month-not-covered" } });
    expect(exact(headcountAt(d, "2025-10-31", OPTS))).toMatchObject({ persons: 7 });
    expect(exact(headcountAt(d, "2025-12-31", OPTS))).toMatchObject({ persons: 7 });
    expect(monthlyList(d, "2025-11", OPTS).presentAnyDay).toMatchObject({ kind: "nd" });
    // Mouvements d'un mois non couvert : « au moins n », un contrat commencé et fini dans le mois serait invisible.
    expect(monthlyList(d, "2025-11", OPTS).entriesCount).toMatchObject({ kind: "lower_bound", value: 0 });
    expect(monthlyList(d, "2025-11", OPTS).exitsCount).toMatchObject({ kind: "lower_bound", value: 0 });
  });
  it("présence DSN : déclaré ce mois et mois complet ; non déclaré ⇒ absent", () => {
    const d = dsnBuild(edgeFiles([DSN_EDGES.renumbered("2025-01", "OLD-1"), DSN_EDGES.renumbered("2025-02", "NEW-1")]));
    const old = d.contracts.find((c) => c.externalId === "OLD-1")!;
    expect(presenceAt(d, old, "2025-01-31")).toEqual({ state: "present" });
    expect(presenceAt(d, old, "2025-02-28")).toEqual({ state: "absent", reason: "non déclaré ce mois" });
    expect(exact(headcountAt(d, "2025-02-28", OPTS))).toMatchObject({ persons: 1, contracts: 1 });
  });
  it("C5 : contrat déclaré par deux SIRET ⇒ une présence dans le total, une par établissement dans le détail ; filtre par établissement", () => {
    const d = dsnBuild(edgeFiles([{ ...DSN_EDGES.simultaneous("2025-06"), nic: "00011" }, { ...DSN_EDGES.simultaneous("2025-06"), nic: "00029" }]));
    const r = headcountAt(d, "2025-06-30", OPTS);
    expect(exact(r)).toMatchObject({ persons: 1, contracts: 2 });
    expect(r.kind !== "nd" && r.allContracts).toBe(2);
    expect(r.kind !== "nd" && r.bySiret).toEqual({ "00000000000011": { persons: 1, contracts: 2 }, "00000000000029": { persons: 1, contracts: 2 } });
    expect(exact(headcountAt(d, "2025-06-30", { ...OPTS, establishments: ["00000000000029"] }))).toMatchObject({ persons: 1, contracts: 2 });
    expect(annualList(d, 2025, { ...OPTS, establishments: ["00000000000029"] }).rows).toHaveLength(1);
    expect(annualList(d, 2025, { ...OPTS, establishments: ["00000000000099"] }).rows).toHaveLength(0);
  });
  it("mois incomplet ou bloqué ⇒ n.d. avec le message de couverture, y compris avant le premier mois complet", () => {
    const inc = dsnBuild(edgeFiles([{ ...DSN_EDGES.renamed("2025-04", "FICTIF"), fraction: "12" }, DSN_EDGES.renamed("2025-05", "FICTIF")]));
    expect(inc.build.presenceFrom).toBe("2025-05");
    expect(headcountAt(inc, "2025-04-30", OPTS)).toMatchObject({ kind: "nd", nd: { code: "coverage-incomplete", reason: expect.stringContaining("Fractions incomplètes") } });
    expect(monthlyList(inc, "2025-04", OPTS).entriesCount).toMatchObject({ kind: "lower_bound" });
    const normal = DSN_EDGES.renamed("2025-02", "FICTIF");
    const blocked = dsnBuild(edgeFiles([DSN_EDGES.renamed("2025-01", "FICTIF"), { ...normal, order: "5" }, { ...normal, type: "03", order: "4" }, DSN_EDGES.renamed("2025-03", "FICTIF")]));
    expect(headcountAt(blocked, "2025-02-28", OPTS)).toMatchObject({ kind: "nd", nd: { code: "coverage-blocked" } });
    expect(monthlyList(blocked, "2025-02", OPTS).entriesCount).toMatchObject({ kind: "nd", nd: { code: "coverage-blocked" } });
    expect(movements(blocked, "2025-01", "2025-03", OPTS).notes).toMatchObject([{ month: "2025-02", reason: expect.stringContaining("n.d.") }]);
  });
  it("contrat commencé et fini dans le mois : présent au moins un jour, absent en fin de mois, entrée et sortie comptées", () => {
    const d = dsnBuild(edgeFiles([{ month: "2025-05", people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-W", start: "2025-05-05", end: "2025-05-20", endReason: "031", gross: "500.00" }] }] }]));
    const ml = monthlyList(d, "2025-05", OPTS);
    expect(ml.presentAnyDay).toMatchObject({ persons: 1, contracts: 1 });
    expect(exact(ml.headcountEnd)).toMatchObject({ persons: 0, contracts: 0 });
    expect(ml.entriesCount).toMatchObject({ value: 1 });
    expect(ml.exitsCount).toMatchObject({ value: 1 });
    expect(ml.rows[0].state).toEqual({ code: "entered_exited", label: "entré le 05/05/2025, sorti le 20/05/2025" });
  });
  it("liste annuelle avec mois non couverts : mois n.d. nommés, jamais une plage reconstituée ; filtre établissement sur « à venir »", () => {
    const d = dsnBuild(fixtureFiles(["2025-04", "2025-05", "2025-06", "2025-07", "2025-08"]));
    const al = annualList(d, 2025, OPTS);
    expect(al.coveredMonths).toEqual(["2025-04", "2025-05", "2025-06", "2025-07", "2025-08"]);
    expect(al.entriesCount).toMatchObject({ kind: "lower_bound", value: 1 });
    expect(al.entriesCount.kind === "lower_bound" && al.entriesCount.qualifiers[0]).toBe("1 sur les mois couverts (5/12) ; n.d. : 2025-01 → 2025-03, 2025-09 → 2025-12");
    const two = dsnBuild(edgeFiles([{ month: "2025-01", nic: "00011", people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", gross: "1000.00" }] }] }, { month: "2025-01", nic: "00029", people: [{ nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-B", start: "2025-03-01", gross: "900.00" }] }] }]));
    expect(movements(two, "2025-01", "2025-01", { ...OPTS, establishments: ["00000000000011"] }).upcoming).toHaveLength(0);
    expect(movements(two, "2025-01", "2025-01", OPTS).upcoming.map((e) => e.contract.externalId)).toEqual(["K-B"]);
  });
  it("déclaré après sa fin : hors effectif, compté à part, effectif « ≥ » (la rupture peut être annulée)", () => {
    const d = dsnBuild(edgeFiles([DSN_EDGES.endInNextMonth("2025-05", "2025-05-31"), DSN_EDGES.endInNextMonth("2025-06", undefined)]));
    const r = headcountAt(d, "2025-06-30", OPTS);
    expect(exact(r)).toMatchObject({ kind: "lower_bound", persons: 0, contracts: 0 });
    expect(r.kind !== "nd" && r.declaredAfterEnd).toBe(1);
    expect(r.kind !== "nd" && r.qualifiers.join(" ")).toContain("1 contrat(s) déclaré(s) après leur fin (rupture annulée ?)");
    expect(presenceAt(d, d.contracts[0], "2025-06-30")).toEqual({ state: "absent", reason: "déclaré après sa fin" });
  });
});

describe("règles d'effectif — cas limites PayFit", () => {
  it("A1 : une personne, deux contrats", async () => {
    const d = await payfitEdgeBuild(PAYFIT_EDGES.simultaneous);
    expect(exact(headcountAt(d, "2025-12-31", OPTS))).toMatchObject({ persons: 1, contracts: 2 });
  });
  it("C11 : natures hors effectif ventilées à part", async () => {
    const d = await payfitEdgeBuild(PAYFIT_EDGES.natures);
    const r = headcountAt(d, "2025-12-31", OPTS);
    expect(exact(r)).toMatchObject({ persons: 1, contracts: 1 });
    expect(r.kind !== "nd" && r.outOfScope).toMatchObject({ byNature: { "29": 1, "80": 1 }, withoutPerson: 0 });
    expect(r.kind !== "nd" && r.allContracts).toBe(3);
  });
  it("B6/B3 : contrat sans personne compté dans les contrats, non positionnable compté à part", async () => {
    const d = await payfitEdgeBuild(PAYFIT_EDGES.incomplete);
    // Au 31/12/2025 : C-ORPHAN (sans personne) et C-CDDNULL présents ; C-PEND et C-CDDFUT commencent en 2026 ; C-NOSTART non positionnable.
    const r = headcountAt(d, "2025-12-31", OPTS);
    expect(exact(r)).toMatchObject({ persons: 1, contracts: 2 });
    expect(r.kind !== "nd" && r.outOfScope).toMatchObject({ withoutPerson: 1, unpositioned: 1 });
    expect(exact(headcountAt(d, "2026-01-31", OPTS))).toMatchObject({ persons: 2, contracts: 3 });
    const ml = monthlyList(d, "2025-12", OPTS);
    expect(ml.outOfScope.unpositioned.map((c) => c.externalId)).toEqual(["C-NOSTART"]);
    expect(ml.outOfScope.personsWithoutContract.map((p) => p.externalId)).toEqual(["P-ALONE"]);
    const mv = movements(d, "2025-01", "2026-10", OPTS);
    expect(mv.upcoming.map((e) => e.contract.externalId).sort()).toEqual(["C-CDDFUT", "C-PEND"]);
    expect(mv.unplaced.map((c) => c.externalId)).toEqual(["C-NOSTART"]);
  });
});
