import { describe, expect, it } from "vitest";
import { compareCells, compareSnapshots, entityFingerprint, fieldFingerprint, initialState, pairFingerprint } from "@/lib/reconciliation/compare";
import { parseDecisionCommand, reduceDecision, replayDecisions } from "@/lib/reconciliation/reduce";
import type { Action, Cell, Decision, FieldTarget, Snapshot, State } from "@/lib/reconciliation/types";

// Tous les noms et identifiants ci-dessous sont fictifs. Aucun lecteur de source ni accès à la base.
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const value = (value: string): Cell => ({ kind: "value", value, provenance: [] });
const nd = (): Cell => ({ kind: "nd", reason: "not-provided", provenance: [] });
function fixture(): Snapshot {
  return {
    schemaVersion: 1, inputHash: "a".repeat(64),
    dsn: { source: "dsn", version: "d".repeat(64), period: "2026-03", referenceDate: "2026-03-31", coverage: "complete",
      persons: [{ id: uuid(1), origin: "source", fields: { familyName: value("FICTIF ALPHA"), givenNames: value("Exemple") } }, { id: uuid(2), origin: "source", fields: { familyName: value("FICTIF ALPHA"), givenNames: value("Autre") } }],
      contracts: [{ id: uuid(11), personId: value(uuid(1)), periodRelation: "in-period", fields: { startDate: value("2025-01-01"), endDate: nd(), nature: value("01") } }, { id: uuid(12), personId: nd(), periodRelation: "unknown", fields: { startDate: nd(), endDate: nd(), nature: nd() } }],
    },
    payfit: { source: "payfit", version: "p".repeat(64), period: null, referenceDate: "2026-06-02", coverage: "complete",
      persons: [{ id: uuid(3), origin: "source", fields: { familyName: value("FICTIF ALPHA"), givenNames: value("Exemple") } }, { id: uuid(4), origin: "source", fields: { familyName: value("FICTIF BETA"), givenNames: value("Autre") } }],
      contracts: [{ id: uuid(13), personId: value(uuid(3)), periodRelation: "in-period", fields: { startDate: value("2025-01-01"), endDate: value("2026-04-30"), nature: value("02") } }, { id: uuid(14), personId: value(uuid(4)), periodRelation: "outside-period", fields: { startDate: value("2026-05-01"), endDate: nd(), nature: value("01") } }],
    },
  };
}
function envelope(snapshot: Snapshot, state: State, action: Action): Decision {
  return { revision: state.revision + 1, inputHash: snapshot.inputHash, actorId: "fixture-editor", createdAt: "2026-06-03T12:00:00.000Z", action };
}
function apply(snapshot: Snapshot, state: State, action: Action): State {
  const result = reduceDecision(snapshot, state, envelope(snapshot, state, action));
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
function linkPerson(snapshot: Snapshot, state: State, dsnId = uuid(1), payfitId = uuid(3)): State {
  return apply(snapshot, state, { kind: "link-person", dsnId, payfitId, fingerprint: pairFingerprint(snapshot, "person", dsnId, payfitId, state) });
}
function linkContract(snapshot: Snapshot, state: State): State {
  return apply(snapshot, state, { kind: "link-contract", dsnId: uuid(11), payfitId: uuid(13), fingerprint: pairFingerprint(snapshot, "contract", uuid(11), uuid(13), state) });
}
const nature: FieldTarget = { entity: "contract", dsnId: uuid(11), payfitId: uuid(13), field: "nature" };

describe("Rapprochement manuel, sans fusion des sources", () => {
  it("garde toute ligne à rapprocher, même noms identiques, orphelin et contrat hors période", () => {
    const snapshot = fixture(), comparison = compareSnapshots(snapshot);
    expect(comparison.persons).toHaveLength(4);
    expect(comparison.contracts).toHaveLength(4);
    expect([...comparison.persons, ...comparison.contracts].every((row) => row.status === "to-reconcile" && (!row.dsnId || !row.payfitId))).toBe(true);
    expect(comparison.contracts.some((row) => row.dsnId === uuid(12))).toBe(true);
    expect(comparison.contracts.some((row) => row.payfitId === uuid(14))).toBe(true);
    expect(comparison.temporal).toBe("different-dates");
    expect(snapshot.payfit.contracts[1].periodRelation).toBe("outside-period");
  });
  it("compare les champs exacts après liaison manuelle et garde dates, nature et absence distinctes", () => {
    const snapshot = fixture();
    const state = linkContract(snapshot, linkPerson(snapshot, initialState(snapshot)));
    const comparison = compareSnapshots(snapshot, state);
    expect(comparison.persons[0].status).toBe("linked");
    expect(comparison.contracts[0].status).toBe("to-reconcile");
    expect(comparison.contracts[0].fields.map(({ field, status }) => [field, status])).toEqual([["startDate", "equal"], ["endDate", "nd"], ["nature", "different"]]);
    expect(comparison.contracts).toHaveLength(3); // un lien = une ligne, et deux lignes sans correspondance conservées
    expect(compareCells(nd(), nd())).toBe("nd");
    expect(compareCells({ kind: "conflict", values: ["01", "02"], provenance: [] }, value("01"))).toBe("conflict");
    expect(compareCells(value("Exemple"), value("exemple"))).toBe("different");
  });
  it("ne qualifie pas des valeurs identiques si une source ou collection est indisponible", () => {
    const snapshot = fixture();
    snapshot.payfit.coverage = "missing";
    let state = linkPerson(snapshot, initialState(snapshot));
    expect(compareSnapshots(snapshot, state).persons[0].fields.map((row) => row.status)).toEqual(["not-comparable", "not-comparable"]);
    snapshot.payfit.coverage = "complete";
    snapshot.payfit.collectionsMissing = ["persons"];
    state = linkPerson(snapshot, initialState(snapshot));
    expect(compareSnapshots(snapshot, state).persons[0].fields[0].status).toBe("not-comparable");
    expect(compareSnapshots(snapshot, state).coverage.payfit).toBe("complete");
  });
  it("refuse les liaisons contrat sans parents liés, avec mauvais parent ou identité déjà liée", () => {
    const snapshot = fixture(), empty = initialState(snapshot);
    const action: Action = { kind: "link-contract", dsnId: uuid(11), payfitId: uuid(13), fingerprint: pairFingerprint(snapshot, "contract", uuid(11), uuid(13), empty) };
    expect(reduceDecision(snapshot, empty, envelope(snapshot, empty, action))).toEqual({ ok: false, reason: "wrong-parent" });
    const wrong = linkPerson(snapshot, empty, uuid(1), uuid(4));
    expect(reduceDecision(snapshot, wrong, envelope(snapshot, wrong, { ...action, fingerprint: pairFingerprint(snapshot, "contract", uuid(11), uuid(13), wrong) }))).toEqual({ ok: false, reason: "wrong-parent" });
    const linked = linkPerson(snapshot, empty);
    expect(reduceDecision(snapshot, linked, envelope(snapshot, linked, { kind: "link-person", dsnId: uuid(1), payfitId: uuid(4), fingerprint: pairFingerprint(snapshot, "person", uuid(1), uuid(4), linked) }))).toEqual({ ok: false, reason: "already-linked" });
    expect(empty.personLinks).toEqual([]);
  });
  it("refuse parents contradictoires ou absents sans retirer les contrats du contrôle", () => {
    const snapshot = fixture();
    snapshot.payfit.contracts[0].personId = { kind: "conflict", values: [uuid(3), uuid(4)], provenance: [] };
    const state = linkPerson(snapshot, initialState(snapshot));
    expect(reduceDecision(snapshot, state, envelope(snapshot, state, { kind: "link-contract", dsnId: uuid(11), payfitId: uuid(13), fingerprint: pairFingerprint(snapshot, "contract", uuid(11), uuid(13), state) }))).toEqual({ ok: false, reason: "wrong-parent" });
    expect(compareSnapshots(snapshot, state).contracts).toHaveLength(4);
  });
  it("enregistre sans correspondance avec commentaire puis rouvre la ligne", () => {
    const snapshot = fixture(), empty = initialState(snapshot), target = { entity: "contract", source: "dsn", id: uuid(12) } as const;
    const marked = apply(snapshot, empty, { kind: "mark-unmatched", target, fingerprint: entityFingerprint(snapshot, target, empty), comment: "Contrat non retrouvé dans la photo datée." });
    expect(compareSnapshots(snapshot, marked).contracts.find((row) => row.dsnId === uuid(12))?.status).toBe("unmatched");
    const reopened = apply(snapshot, marked, { kind: "reopen-unmatched", target, fingerprint: entityFingerprint(snapshot, target, marked), comment: "Contrôle complémentaire demandé." });
    expect(compareSnapshots(snapshot, reopened).contracts.find((row) => row.dsnId === uuid(12))?.status).toBe("to-reconcile");
    expect(marked.unmatched).toHaveLength(1);
  });
  it("conserve un écart expliqué comme écart et permet demande de correction puis réouverture", () => {
    const snapshot = fixture();
    let state = linkContract(snapshot, linkPerson(snapshot, initialState(snapshot)));
    const fingerprint = fieldFingerprint(snapshot, nature, state);
    state = apply(snapshot, state, { kind: "resolve-field", target: nature, fingerprint, disposition: "explained", comment: "Nature modifiée après le mois déclaré." });
    let row = compareSnapshots(snapshot, state).contracts[0].fields.find((field) => field.field === "nature")!;
    expect(row.status).toBe("different");
    expect(row.resolution?.disposition).toBe("explained");
    state = apply(snapshot, state, { kind: "resolve-field", target: nature, fingerprint, disposition: "correction-requested", comment: "Vérification demandée à la source." });
    row = compareSnapshots(snapshot, state).contracts[0].fields.find((field) => field.field === "nature")!;
    expect(row.resolution?.disposition).toBe("correction-requested");
    state = apply(snapshot, state, { kind: "reopen-field", target: nature, fingerprint, comment: "Nouvelle vérification nécessaire." });
    expect(state.resolutions).toEqual([]);
    expect(snapshot.dsn.contracts[0].fields.nature).toEqual(value("01"));
    expect(snapshot.payfit.contracts[0].fields.nature).toEqual(value("02"));
  });
  it("dissocier une personne retire les liens et décisions dépendants, relier ne les réactive pas", () => {
    const snapshot = fixture();
    let state = linkContract(snapshot, linkPerson(snapshot, initialState(snapshot)));
    const oldFingerprint = fieldFingerprint(snapshot, nature, state);
    state = apply(snapshot, state, { kind: "resolve-field", target: nature, fingerprint: oldFingerprint, disposition: "explained", comment: "Évolution datée identifiée." });
    const before = state;
    state = apply(snapshot, state, { kind: "unlink-person", dsnId: uuid(1), payfitId: uuid(3), fingerprint: pairFingerprint(snapshot, "person", uuid(1), uuid(3), state), comment: "Identité à revoir." });
    expect(state.personLinks).toEqual([]);
    expect(state.contractLinks).toEqual([]);
    expect(state.resolutions).toEqual([]);
    expect(before.contractLinks).toHaveLength(1);
    expect(before.resolutions).toHaveLength(1);
    state = linkContract(snapshot, linkPerson(snapshot, state));
    expect(fieldFingerprint(snapshot, nature, state)).not.toBe(oldFingerprint);
    expect(reduceDecision(snapshot, state, envelope(snapshot, state, { kind: "resolve-field", target: nature, fingerprint: oldFingerprint, disposition: "explained", comment: "Ancienne décision rejouée." }))).toEqual({ ok: false, reason: "stale-fingerprint" });
    expect(state.resolutions).toEqual([]);
  });
  it("refuse révision périmée, source changée, cible inconnue et mauvais type de champ", () => {
    const snapshot = fixture(), empty = initialState(snapshot);
    const action: Action = { kind: "link-person", dsnId: uuid(1), payfitId: uuid(3), fingerprint: pairFingerprint(snapshot, "person", uuid(1), uuid(3), empty) };
    expect(reduceDecision(snapshot, empty, { ...envelope(snapshot, empty, action), revision: 2 })).toEqual({ ok: false, reason: "invalid-revision" });
    expect(reduceDecision(snapshot, empty, { ...envelope(snapshot, empty, action), inputHash: "b".repeat(64) })).toEqual({ ok: false, reason: "stale-source" });
    expect(reduceDecision(snapshot, empty, envelope(snapshot, empty, { ...action, dsnId: uuid(99) }))).toEqual({ ok: false, reason: "unknown-target" });
    const state = linkPerson(snapshot, empty);
    const target: FieldTarget = { entity: "person", dsnId: uuid(1), payfitId: uuid(3), field: "nature" };
    expect(reduceDecision(snapshot, state, envelope(snapshot, state, { kind: "resolve-field", target, fingerprint: fieldFingerprint(snapshot, target, state), disposition: "explained", comment: "Champ inadapté." }))).toEqual({ ok: false, reason: "unknown-target" });
    const updated = { ...snapshot, inputHash: "c".repeat(64) };
    expect(compareSnapshots(updated, state).revision).toBe(0);
    expect(compareSnapshots(updated, state).persons).toHaveLength(4);
  });
  it("refuse commandes libres, commentaires vides/trop longs et empreintes obsolètes", () => {
    const snapshot = fixture(), empty = initialState(snapshot), target = { entity: "person", source: "dsn", id: uuid(1) } as const;
    const action: Action = { kind: "mark-unmatched", target, fingerprint: entityFingerprint(snapshot, target, empty), comment: "Pas de correspondance établie." };
    expect(parseDecisionCommand({ ...action, sourcePayload: { unknown: "interdit" } })).toBeNull();
    expect(parseDecisionCommand({ ...action, target: { ...target, rawKey: "interdit" } })).toBeNull();
    for (const comment of ["", "  ", "x".repeat(501), "texte\u0000masqué"]) expect(reduceDecision(snapshot, empty, envelope(snapshot, empty, { ...action, comment }))).toEqual({ ok: false, reason: "invalid-comment" });
    expect(reduceDecision(snapshot, empty, envelope(snapshot, empty, { ...action, fingerprint: "0".repeat(64) }))).toEqual({ ok: false, reason: "stale-fingerprint" });
  });
  it("rejoue une suite ordonnée sans muter les snapshots et s'arrête avant une révision invalide", () => {
    const snapshot = fixture(), copy = structuredClone(snapshot), empty = initialState(snapshot);
    const first = envelope(snapshot, empty, { kind: "link-person", dsnId: uuid(1), payfitId: uuid(3), fingerprint: pairFingerprint(snapshot, "person", uuid(1), uuid(3), empty) });
    const replay = replayDecisions(snapshot, [first]);
    expect(replay.ok).toBe(true);
    expect(replay.state.personLinks).toHaveLength(1);
    const invalid = replayDecisions(snapshot, [first, { ...first, revision: 3 }]);
    expect(invalid.ok).toBe(false);
    expect(invalid.state.revision).toBe(1);
    expect(snapshot).toEqual(copy);
  });
});
