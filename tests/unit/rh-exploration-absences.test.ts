import { describe, expect, it } from "vitest";
import { buildExplorationAbsences, explorationAbsencesForContract } from "@/lib/rh/exploration-absences";
import type { ExplorationModel, ExplorationRow } from "@/lib/rh/exploration";
import type { AbsenceRow } from "@/lib/rh/referential/types";
import type { AbsenceInput } from "@/lib/rh/kpi/types";

// Événements fictifs, aucun appel de base ou de connecteur. On vérifie uniquement
// le nombre d'occurrences source : jamais une durée d'absence reconstituée.
const M = "2026-10", SYNC = "lecture-fictive";
function row(id = "C-1"): ExplorationRow {
  const category = { key: "fixture", label: "Fictif", value: "fixture" };
  const measure = { value: 150, reason: null, trace: null };
  return { id, contractKey: `payfit:${id}`, contractLabel: id, personKey: `payfit:P-${id}`, personName: `Personne fictive ${id}`, startDate: "2025-01-01", endDate: null,
    team: category, nature: category, establishment: category, state: category, inScope: true, paidTime: measure, workedTime: { ...measure, value: 120 }, timeUnit: "hours", timeUnitLabel: "h", fteAtRead: { ...measure, value: 1 }, notes: [] };
}
function model(month = M, rows = [row()]): ExplorationModel {
  return { source: "payfit", month, referenceDate: "2026-11-05", gate: null, coverageKind: "exact", notices: [], rows,
    total: { contracts: rows.length, persons: rows.length, withoutPerson: 0, observations: rows.length, rowIds: rows.map((r) => r.id) }, teams: [], natures: [] };
}
function absence(id = "absence-fixture", change: Partial<AbsenceRow> = {}): AbsenceRow {
  return { id, contractId: "C-1", type: "fr_maladie_ordinaire", status: "approved",
    start: { date: "2026-10-06", moment: "beginning-of-day" }, end: { date: "2026-10-07", moment: "end-of-day" }, ...change };
}
const input = (rows: AbsenceRow[] = []): AbsenceInput => ({ status: "read", syncId: SYNC, months: ["2026-09", M, "2026-11"], rows });
const build = (rows: AbsenceRow[], m = model()) => buildExplorationAbsences(m, input(rows), SYNC);

describe("Pointage : événements d'absence mensuels", () => {
  it("conserve type, statut, dates et moments sources sans calculer de durée", () => {
    const result = build([absence()]);
    const contract = explorationAbsencesForContract(result, "payfit:C-1");
    expect(contract).toMatchObject({ kind: "value", count: 1, label: "1 événement remonté" });
    expect(contract.events[0]).toMatchObject({ contractKey: "payfit:C-1", personKey: "payfit:P-C-1", type: "fr_maladie_ordinaire", typeLabel: "Maladie ordinaire (fr_maladie_ordinaire)",
      status: "approved", statusLabel: "approuvée", start: { date: "2026-10-06", moment: "beginning-of-day", momentLabel: "début de journée" }, end: { date: "2026-10-07", moment: "end-of-day" }, position: "overlap" });
    expect(JSON.stringify(result)).not.toMatch(/"duration"|"days"|"half"|"hours"/);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  it("une absence chevauchante apparaît dans chacun des mois, avec les bornes originales", () => {
    const a = absence("cross", { start: { date: "2026-09-29", moment: "middle-of-day" }, end: { date: "2026-11-02", moment: "middle-of-day" } });
    for (const month of ["2026-09", M, "2026-11"]) {
      const contract = explorationAbsencesForContract(build([a], model(month)), "payfit:C-1");
      expect(contract.count).toBe(1); expect(contract.events[0].start.date).toBe("2026-09-29"); expect(contract.events[0].end.date).toBe("2026-11-02");
    }
  });
  it("déduplique seulement l'identifiant source, sans confondre deux événements égaux", () => {
    const first = absence("one");
    const contract = explorationAbsencesForContract(build([first, { ...first }, absence("two")]), "payfit:C-1");
    expect(contract.count).toBe(2); expect(contract.events.map((e) => e.id)).toEqual(["one", "two"]);
  });
  it("les statuts refusé, annulé ou absent restent visibles, sans attestation d'absence effective", () => {
    const result = build([absence("declined", { status: "declined" }), absence("cancelled", { status: "cancelled" }), absence("missing", { status: null })]);
    const contract = explorationAbsencesForContract(result, "payfit:C-1");
    expect(contract.count).toBe(3);
    expect(contract.events.map((e) => e.statusLabel)).toEqual(["refusée", "annulée", "Statut n.d."]);
    expect(contract.events[2].notes.join(" ")).toContain("Statut non renseigné");
  });
  it("la demi-journée source reste un moment, sans demi-journée calculée ni arrondi", () => {
    const contract = explorationAbsencesForContract(build([absence("half", { start: { date: "2026-10-06", moment: "middle-of-day" }, end: { date: "2026-10-06", moment: "end-of-day" } })]), "payfit:C-1");
    expect(contract.count).toBe(1); expect(contract.events[0].start.momentLabel).toBe("mi-journée");
    expect(JSON.stringify(contract)).not.toContain("0.5");
  });
  it("une borne inconnue ne devient ni une date artificielle ni un zéro d'événement", () => {
    const result = build([absence("unknown", { start: { date: null, moment: null }, end: { date: "2026-11-10", moment: "end-of-day" } })]);
    const contract = explorationAbsencesForContract(result, "payfit:C-1");
    expect(contract).toMatchObject({ kind: "uncertain", count: null });
    expect(contract.events).toEqual([]); expect(contract.unpositioned).toHaveLength(1);
    expect(result.unpositioned[0]).toMatchObject({ id: "unknown", position: "unpositioned", start: { date: null, moment: null } });
    expect(contract.label).not.toContain("Aucune absence");
  });
  it("dates invalides, fin avant début et versions contradictoires sont non positionnables", () => {
    const invalid = absence("invalid", { start: { date: "2026-02-30", moment: "beginning-of-day" } });
    const reversed = absence("reversed", { start: { date: "2026-11-10", moment: "beginning-of-day" }, end: { date: "2026-09-01", moment: "end-of-day" } });
    const conflict = absence("conflict");
    const result = build([invalid, reversed, conflict, { ...conflict, end: { date: "2026-11-02", moment: "end-of-day" } }]);
    expect(result.unpositioned.map((e) => e.id)).toEqual(["invalid", "reversed", "conflict"]);
    expect(explorationAbsencesForContract(result, "payfit:C-1").count).toBeNull();
    expect(result.unpositioned.find((e) => e.id === "conflict")?.start.date).toBeNull();
  });
  it("un moment absent ou incohérent reste explicite mais n'efface pas l'événement daté", () => {
    const result = build([absence("moment", { start: { date: "2026-10-06", moment: "uninterpreted" }, end: { date: "2026-10-06", moment: null } }),
      absence("reversed-moments", { start: { date: "2026-10-06", moment: "end-of-day" }, end: { date: "2026-10-06", moment: "beginning-of-day" } })]);
    const contract = explorationAbsencesForContract(result, "payfit:C-1");
    expect(contract.count).toBe(2); expect(contract.events[0].notes.join(" ")).toContain("non interprété");
    expect(contract.events[1].notes.join(" ")).toContain("Moments contradictoires");
  });
  it("le libellé aucune absence remontée concerne la source, jamais l'écart payé/travaillé", () => {
    const m = model(); m.notices = ["Historique PayFit en borne basse : contrats archivés inconnus"];
    const before = JSON.stringify(m);
    const result = build([], m);
    expect(explorationAbsencesForContract(result, "payfit:C-1")).toMatchObject({ count: 0, label: "Aucune absence remontée" });
    expect(result.notices).toContain(m.notices[0]);
    expect(result.notices.join(" ")).toContain("ne prouve pas l’absence d’absences");
    expect(JSON.stringify(m)).toBe(before);
  });
  it("ignore une occurrence strictement hors mois, y compris avec une borne inconnue qui l'exclut", () => {
    const result = build([absence("before", { start: { date: "2026-09-01", moment: null }, end: { date: "2026-09-30", moment: null } }),
      absence("before-undated", { start: { date: null, moment: null }, end: { date: "2026-09-30", moment: null } }),
      absence("after-undated", { start: { date: "2026-11-01", moment: null }, end: { date: null, moment: null } })]);
    expect(result.unpositioned).toEqual([]); expect(explorationAbsencesForContract(result, "payfit:C-1").count).toBe(0);
  });
});

describe("Pointage : périmètre, rattachement et disponibilité des absences", () => {
  it("ne perd pas les contrats inconnus ou les événements non positionnables orphelins", () => {
    const result = build([absence("orphan", { contractId: "C-unknown" }), absence("orphan-undated", { contractId: "C-other", start: { date: null, moment: null } })]);
    expect(result.unlinked[0]).toMatchObject({ id: "orphan", context: "unlinked", contractKey: null, personKey: null, personName: null, sourceContractId: "C-unknown" });
    expect(result.unpositioned[0]).toMatchObject({ id: "orphan-undated", context: "unlinked", contractKey: null, personKey: null });
    expect(explorationAbsencesForContract(result, "payfit:C-unknown").kind).toBe("nd");
  });
  it("exclut les collaborateurs filtrés et distingue un contrat connu hors observations du mois", () => {
    const result = buildExplorationAbsences(model(), input([absence("selected"), absence("filtered", { contractId: "C-2" }), absence("outside", { contractId: "C-3" }), absence("unknown", { contractId: "C-4" })]), SYNC,
      { knownContractKeys: ["payfit:C-1", "payfit:C-2", "payfit:C-3"], observedContractKeys: ["payfit:C-1", "payfit:C-2"] });
    expect(explorationAbsencesForContract(result, "payfit:C-1").events.map((e) => e.id)).toEqual(["selected"]);
    expect(result.unlinked.map((e) => [e.id, e.context])).toEqual([["outside", "outside-observed"], ["unknown", "unlinked"]]);
    expect(JSON.stringify(result)).not.toContain("filtered"); expect(JSON.stringify(result)).not.toContain("knownContractKeys");
  });
  it("DSN, collection indisponible ou absente ne deviennent jamais zéro", () => {
    const ds = model(); ds.source = "dsn";
    const unavailable: AbsenceInput = { status: "unavailable", nd: { code: "scope-missing", reason: "Droit fictif manquant" } };
    for (const result of [buildExplorationAbsences(ds, input(), SYNC), buildExplorationAbsences(model(), unavailable, SYNC), buildExplorationAbsences(model(), null, SYNC)]) {
      expect(result.kind).toBe("nd"); expect(explorationAbsencesForContract(result, "payfit:C-1").count).toBeNull();
      expect(result.unlinked).toEqual([]); expect(result.unpositioned).toEqual([]);
    }
  });
  it("refuse une autre photographie, un mois non lu ou un mois bloqué", () => {
    const outside = model("2026-08");
    const blocked = model(); blocked.gate = { code: "month-not-covered", reason: "Couverture fictive bloquée" };
    const invalid = model("not-a-month");
    for (const result of [buildExplorationAbsences(model(), input(), "other-sync"), buildExplorationAbsences(model(), input(), null), buildExplorationAbsences(outside, input(), SYNC), buildExplorationAbsences(blocked, input(), SYNC), buildExplorationAbsences(invalid, input(), SYNC)]) {
      expect(result.kind).toBe("nd"); expect(explorationAbsencesForContract(result, "payfit:C-1").count).toBeNull();
    }
  });
  it("une observation multisite n'affiche pas deux fois la même absence du contrat", () => {
    const result = build([], model(M, [row(), { ...row(), id: "second-establishment" }]));
    expect(result.contracts).toHaveLength(1);
    expect(explorationAbsencesForContract(undefined, "payfit:C-1").kind).toBe("nd");
  });
});
