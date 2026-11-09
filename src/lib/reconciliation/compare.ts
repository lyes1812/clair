import { createHash } from "node:crypto";
import {
  CONTRACT_FIELDS, PERSON_FIELDS, type Cell, type ComparedField, type ComparedRow, type Comparison,
  type EntityKind, type EntityTarget, type Field, type FieldTarget, type Link, type Snapshot, type State,
} from "./types";

// Empreintes opaques et déterministes : ni libellé nominatif ni identifiant de source dans une cible d'action.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
export const initialState = (snapshot: Snapshot): State => ({ inputHash: snapshot.inputHash, revision: 0, personLinks: [], contractLinks: [], unmatched: [], resolutions: [] });
export const fieldsOf = (entity: EntityKind): readonly Field[] => entity === "person" ? PERSON_FIELDS : CONTRACT_FIELDS;
export function entityOf(snapshot: Snapshot, target: EntityTarget) {
  return target.entity === "person" ? snapshot[target.source].persons.find((row) => row.id === target.id) : snapshot[target.source].contracts.find((row) => row.id === target.id);
}
export const linksOf = (state: State, entity: EntityKind): Link[] => entity === "person" ? state.personLinks : state.contractLinks;
export const linkOf = (state: State, target: Pick<FieldTarget, "entity" | "dsnId" | "payfitId">): Link | undefined => linksOf(state, target.entity).find((row) => row.dsnId === target.dsnId && row.payfitId === target.payfitId);
const sameEntity = (left: EntityTarget, right: EntityTarget) => left.entity === right.entity && left.source === right.source && left.id === right.id;
export const sameField = (left: FieldTarget, right: FieldTarget) => left.entity === right.entity && left.dsnId === right.dsnId && left.payfitId === right.payfitId && left.field === right.field;
export const unmatchedOf = (state: State, target: EntityTarget) => state.unmatched.find((row) => sameEntity(row, target));
export function entityFingerprint(snapshot: Snapshot, target: EntityTarget, state: State = initialState(snapshot)): string {
  return hash({ inputHash: snapshot.inputHash, target, entity: entityOf(snapshot, target) ?? null, unmatchedRevision: unmatchedOf(state, target)?.revision ?? null });
}
export function pairFingerprint(snapshot: Snapshot, entity: EntityKind, dsnId: string, payfitId: string, state: State = initialState(snapshot)): string {
  const dsn = entityOf(snapshot, { entity, source: "dsn", id: dsnId });
  const payfit = entityOf(snapshot, { entity, source: "payfit", id: payfitId });
  let parentRevision: number | null = null;
  if (entity === "contract" && dsn && payfit && "personId" in dsn && "personId" in payfit && dsn.personId.kind === "value" && payfit.personId.kind === "value") {
    const dsnPerson = dsn.personId.value, payfitPerson = payfit.personId.value;
    parentRevision = state.personLinks.find((row) => row.dsnId === dsnPerson && row.payfitId === payfitPerson)?.revision ?? null;
  }
  return hash({ inputHash: snapshot.inputHash, entity, dsn: dsn ?? null, payfit: payfit ?? null, linkRevision: linkOf(state, { entity, dsnId, payfitId })?.revision ?? null, parentRevision });
}
function cellOf(snapshot: Snapshot, source: "dsn" | "payfit", target: FieldTarget): Cell | null {
  const row = entityOf(snapshot, { entity: target.entity, source, id: source === "dsn" ? target.dsnId : target.payfitId });
  return row && fieldsOf(target.entity).includes(target.field) ? (row.fields as Partial<Record<Field, Cell>>)[target.field] ?? null : null;
}
export function fieldFingerprint(snapshot: Snapshot, target: FieldTarget, state: State): string {
  return hash({ inputHash: snapshot.inputHash, target, dsn: cellOf(snapshot, "dsn", target), payfit: cellOf(snapshot, "payfit", target), linkRevision: linkOf(state, target)?.revision ?? null });
}
const missing = (): Cell => ({ kind: "nd", reason: "not-provided", provenance: [] });
export function compareCells(dsn: Cell, payfit: Cell, comparable = true): ComparedField["status"] {
  if (dsn.kind === "conflict" || payfit.kind === "conflict") return "conflict";
  if (dsn.kind === "nd" || payfit.kind === "nd") return "nd";
  if (!comparable) return "not-comparable";
  return dsn.value === payfit.value ? "equal" : "different";
}
function pairRow(snapshot: Snapshot, state: State, entity: EntityKind, link: Link): ComparedRow {
  const collection = entity === "person" ? "persons" : "contracts";
  const comparable = snapshot.dsn.coverage !== "blocked" && snapshot.dsn.coverage !== "missing" && snapshot.payfit.coverage !== "blocked" && snapshot.payfit.coverage !== "missing"
    && !snapshot.dsn.collectionsMissing?.includes(collection) && !snapshot.payfit.collectionsMissing?.includes(collection);
  const fields = fieldsOf(entity).map((field): ComparedField => {
    const target: FieldTarget = { entity, dsnId: link.dsnId, payfitId: link.payfitId, field };
    const fingerprint = fieldFingerprint(snapshot, target, state);
    const dsn = cellOf(snapshot, "dsn", target) ?? missing(), payfit = cellOf(snapshot, "payfit", target) ?? missing();
    return { field, dsn, payfit, status: compareCells(dsn, payfit, comparable), fingerprint, resolution: state.resolutions.find((row) => sameField(row, target) && row.fingerprint === fingerprint) ?? null };
  });
  const pending = fields.filter((row) => row.status !== "equal" && !row.resolution);
  const resolutions = fields.flatMap((row) => row.resolution ? [row.resolution] : []);
  const status = pending.length ? "to-reconcile" : resolutions.some((row) => row.disposition === "correction-requested") ? "correction-requested" : resolutions.length ? "explained" : "linked";
  return { entity, dsnId: link.dsnId, payfitId: link.payfitId, status, fields, fingerprint: pairFingerprint(snapshot, entity, link.dsnId, link.payfitId, state), unmatched: null };
}
function rowsOf(snapshot: Snapshot, state: State, entity: EntityKind): ComparedRow[] {
  const collection = entity === "person" ? "persons" : "contracts";
  const links = linksOf(state, entity);
  const rows = links.map((link) => pairRow(snapshot, state, entity, link));
  for (const source of ["dsn", "payfit"] as const) for (const row of snapshot[source][collection]) {
    if (links.some((link) => (source === "dsn" ? link.dsnId : link.payfitId) === row.id)) continue;
    const target = { source, entity, id: row.id };
    const unmatched = unmatchedOf(state, target) ?? null;
    rows.push({ entity, dsnId: source === "dsn" ? row.id : null, payfitId: source === "payfit" ? row.id : null, status: unmatched ? "unmatched" : "to-reconcile", fields: [], fingerprint: entityFingerprint(snapshot, target, state), unmatched });
  }
  return rows;
}
export function compareSnapshots(snapshot: Snapshot, state: State = initialState(snapshot)): Comparison {
  // Une décision d'une autre version ne qualifie aucune ligne du nouveau contrôle.
  const current = state.inputHash === snapshot.inputHash ? state : initialState(snapshot);
  return {
    inputHash: snapshot.inputHash, revision: current.revision,
    temporal: !snapshot.dsn.referenceDate || !snapshot.payfit.referenceDate ? "unknown" : snapshot.dsn.referenceDate === snapshot.payfit.referenceDate ? "same-date" : "different-dates",
    coverage: { dsn: snapshot.dsn.coverage, payfit: snapshot.payfit.coverage },
    persons: rowsOf(snapshot, current, "person"), contracts: rowsOf(snapshot, current, "contract"),
  };
}
