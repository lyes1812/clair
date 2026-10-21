import { describe, expect, it } from "vitest";
import { annualList, headcountAt, monthlyList, movements, presenceAt } from "@/lib/rh/headcount";
import type { RhBuildData } from "@/lib/rh/referential/types";
import { DSN_EDGES } from "./helpers/edge-cases";
import { PAYFIT_EDGES } from "./helpers/edge-cases";
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
      expect(exact(r)).toEqual({ kind: date < "2025-10-01" ? kindBefore : "exact", persons: ref.persons, contracts: ref.contracts, byNature: ref.byNature });
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
      const lower = kindBefore === "lower_bound" && month < "2025-10";
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
  it("mois 2026-10 (mois de la lecture) : effectif fin de mois n.d., effectif au 21/10 exact", () => {
    expect(headcountAt(payfitData, "2026-10-31", OPTS)).toMatchObject({ kind: "nd", nd: { code: "after-reference" } });
    expect(exact(headcountAt(payfitData, "2026-10-21", OPTS))).toMatchObject({ persons: 7 });
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
  it("déclaré après sa fin : hors effectif, compté à part", () => {
    const d = dsnBuild(edgeFiles([DSN_EDGES.endInNextMonth("2025-05", "2025-05-31"), DSN_EDGES.endInNextMonth("2025-06", undefined)]));
    const r = headcountAt(d, "2025-06-30", OPTS);
    expect(exact(r)).toMatchObject({ persons: 0, contracts: 0 });
    expect(r.kind !== "nd" && r.declaredAfterEnd).toBe(1);
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
