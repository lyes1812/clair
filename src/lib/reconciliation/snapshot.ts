import { canonicalJson, sha256 } from "@/lib/crypto";
import { monthEnd } from "@/lib/dates";
import { RH_BUILDER_VERSION } from "@/lib/rh/referential/hash";
import { payfitRetentionLimit } from "@/lib/rh/headcount";
import type { Cell, Contract, MissingReason, Person, Provenance, Snapshot, Source, SourceSnapshot } from "./types";
import { RECONCILIATION_VERSION } from "./types";

export const SNAPSHOT_VERSION = 1;
export const COMPARATOR_VERSION = RECONCILIATION_VERSION;
export type SnapshotRecord = {
  id: string; syncId: string; recordHash: string; collection: string; period: string | null;
  data: { entityId: unknown; personId?: unknown; familyName?: unknown; givenNames?: unknown; startDate?: unknown; endDate?: unknown; nature?: unknown };
};
export type SnapshotCoverage = {
  id: string; month: string; status: "complete" | "incomplete" | "blocked";
  selected: { syncId: string; keyHash: string }[];
};
export type SnapshotInputs = {
  workspaceId: string; controlMonth: string;
  dsnSyncs: { id: string; contentHash: string | null }[];
  coverage: SnapshotCoverage[];
  dsnRecords: SnapshotRecord[];
  payfitSync: { id: string; contentHash: string | null; referenceDate: string; missingCollections: ("persons" | "contracts")[] } | null;
  payfitRecords: SnapshotRecord[];
};

const syncStamp = (input: SnapshotInputs) => input.dsnSyncs.map((s) => ({ id: s.id, contentHash: s.contentHash })).sort((a, b) => a.id.localeCompare(b.id));
const coverageStamp = (input: SnapshotInputs) => input.coverage.map((c) => ({ id: c.id, month: c.month, status: c.status,
  selected: c.selected.map((s) => ({ syncId: s.syncId, keyHash: s.keyHash })).sort((a, b) => a.syncId.localeCompare(b.syncId) || a.keyHash.localeCompare(b.keyHash)),
})).sort((a, b) => a.month.localeCompare(b.month) || a.id.localeCompare(b.id));
const payfitStamp = (input: SnapshotInputs) => input.payfitSync ? { id: input.payfitSync.id, contentHash: input.payfitSync.contentHash,
  referenceDate: input.payfitSync.referenceDate, missingCollections: [...input.payfitSync.missingCollections].sort(),
} : null;
function historyLimited(input: SnapshotInputs): boolean {
  const limit = payfitRetentionLimit({ build: { source: "payfit", referenceDate: input.payfitSync?.referenceDate ?? null } });
  // Le mois anniversaire reste incomplet pour ses mouvements et ses contrats terminés.
  return limit !== null && input.controlMonth <= limit.slice(0, 7);
}

// Une empreinte UUID ne révèle ni la clé source, ni les empreintes d'identité DSN.
export function opaqueId(workspaceId: string, source: Source, entity: "person" | "contract" | "coverage", key: string): string {
  const hex = sha256(canonicalJson(["reconciliation", SNAPSHOT_VERSION, workspaceId, source, entity, key]));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const clean = (v: unknown): string | null => typeof v === "string" && v.trim() && v.length <= 300 && !/[\u0000-\u001f\u007f]/.test(v) ? v : null;
const date = (v: unknown): string | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
};
const cell = (value: string | null, provenance: Provenance, reason: MissingReason = "not-provided"): Cell => value === null ? { kind: "nd", reason, provenance: [provenance] } : { kind: "value", value, provenance: [provenance] };
const prov = (row: SnapshotRecord, path: string): Provenance => ({ recordId: row.id, recordHash: row.recordHash, syncId: row.syncId, path, period: row.period });
function merged(cells: Cell[]): Cell {
  const provenance = cells.flatMap((c) => c.provenance).sort((a, b) => a.recordId.localeCompare(b.recordId) || a.path.localeCompare(b.path));
  const values = [...new Set(cells.flatMap((c) => c.kind === "value" ? [c.value] : c.kind === "conflict" ? c.values : []))].sort();
  const missingReasons = [...new Set(cells.flatMap((c) => c.kind === "nd" ? [c.reason] : []))].sort();
  if (values.length === 0) return { kind: "nd", reason: missingReasons[0] ?? "not-provided", provenance };
  if (values.length === 1 && missingReasons.length === 0) return { kind: "value", value: values[0], provenance };
  return { kind: "conflict", values, missingReasons, provenance };
}
function relation(fields: Contract["fields"], month: string): Contract["periodRelation"] {
  if (fields.startDate.kind === "conflict" || fields.endDate.kind === "conflict") return "conflict";
  if (fields.startDate.kind !== "value") return "unknown";
  const start = fields.startDate.value;
  const end = fields.endDate.kind === "value" ? fields.endDate.value : null;
  if (end && end < start) return "conflict";
  if (start > monthEnd(month) || (end && end < `${month}-01`)) return "outside-period";
  return end ? "in-period" : "unknown";
}
function buildSource(input: SnapshotInputs, source: Source, version: string): SourceSnapshot {
  const records = source === "dsn" ? input.dsnRecords : input.payfitRecords;
  const persons = new Map<string, SnapshotRecord[]>();
  const contracts = new Map<string, SnapshotRecord[]>();
  for (const row of records) {
    const entity = row.collection === "people" || row.collection === "collaborators" ? "person" : "contract";
    const id = opaqueId(input.workspaceId, source, entity, clean(row.data.entityId) ?? `row:${row.id}`);
    const map = entity === "person" ? persons : contracts;
    map.set(id, [...(map.get(id) ?? []), row]);
  }
  const personRows: Person[] = [...persons].map(([id, rows]) => ({ id, origin: "source", fields: {
    familyName: merged(rows.map((r) => cell(clean(r.data.familyName), prov(r, source === "dsn" ? "S21.G00.30.002" : "lastName")))),
    givenNames: merged(rows.map((r) => cell(clean(r.data.givenNames), prov(r, source === "dsn" ? "S21.G00.30.004" : "firstName")))),
  } }));
  const knownPeople = new Set(personRows.map((p) => p.id));
  const contractRows: Contract[] = [...contracts].map(([id, rows]) => {
    const parentCells = rows.map((r) => {
      const ref = clean(r.data.personId);
      if (!ref) return cell(null, prov(r, source === "dsn" ? "S21.G00.30" : "collaboratorId"), "parent-missing");
      const parentId = opaqueId(input.workspaceId, source, "person", ref);
      if (!knownPeople.has(parentId)) {
        const missing: Cell = { kind: "nd", reason: "parent-missing", provenance: [] };
        personRows.push({ id: parentId, origin: "contract-reference", fields: { familyName: missing, givenNames: missing } });
        knownPeople.add(parentId);
      }
      return cell(parentId, prov(r, source === "dsn" ? "S21.G00.30" : "collaboratorId"));
    });
    const fields: Contract["fields"] = {
      startDate: merged(rows.map((r) => cell(date(r.data.startDate), prov(r, source === "dsn" ? "S21.G00.40.001" : "startDate"), r.data.startDate == null ? "not-provided" : "invalid-value"))),
      endDate: merged(rows.map((r) => cell(date(r.data.endDate), prov(r, source === "dsn" ? "S21.G00.62.001" : "endDate"), r.data.endDate == null ? "not-provided" : "invalid-value"))),
      nature: merged(rows.map((r) => cell(typeof r.data.nature === "string" && /^\d{2}$/.test(r.data.nature) ? r.data.nature : null, prov(r, source === "dsn" ? "S21.G00.40.007" : "natureContratDsn"), r.data.nature == null ? "not-provided" : "invalid-value"))),
    };
    return { id, personId: merged(parentCells), periodRelation: relation(fields, input.controlMonth), fields };
  });
  const coverage = input.coverage.filter((c) => c.month === input.controlMonth);
  const dsnCoverage = coverage.length === 0 ? "missing" : coverage.some((c) => c.status === "blocked") ? "blocked" : coverage.some((c) => c.status === "incomplete") ? "incomplete" : "complete";
  return {
    source, version, period: source === "dsn" ? input.controlMonth : null,
    referenceDate: source === "dsn" ? (coverage.length ? monthEnd(input.controlMonth) : null) : input.payfitSync?.referenceDate ?? null,
    coverage: source === "dsn" ? dsnCoverage : !input.payfitSync ? "missing" : input.payfitSync.missingCollections.length || historyLimited(input) ? "incomplete" : "complete",
    ...(source === "payfit" ? { historyLimited: historyLimited(input) } : {}),
    collectionsMissing: source === "payfit" ? payfitStamp(input)?.missingCollections ?? ["persons", "contracts"] : [],
    persons: personRows.sort((a, b) => a.id.localeCompare(b.id)), contracts: contractRows.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export function snapshotInputHash(input: SnapshotInputs): string {
  const syncs = syncStamp(input);
  const coverage = coverageStamp(input);
  const records = (rows: SnapshotRecord[]) => rows.map((r) => ({ id: r.id, recordHash: r.recordHash })).sort((a, b) => a.id.localeCompare(b.id));
  return sha256(canonicalJson({ schemaVersion: SNAPSHOT_VERSION, comparatorVersion: COMPARATOR_VERSION, importBuilderVersion: RH_BUILDER_VERSION,
    controlMonth: input.controlMonth, dsnSyncs: syncs, coverage, dsnRecords: records(input.dsnRecords), payfitSync: payfitStamp(input), historyLimited: historyLimited(input), payfitRecords: records(input.payfitRecords) }));
}
export function snapshotOf(input: SnapshotInputs): Snapshot {
  const inputHash = snapshotInputHash(input);
  const dsn = buildSource(input, "dsn", sha256(canonicalJson({ syncs: syncStamp(input), coverage: coverageStamp(input), controlMonth: input.controlMonth })));
  const payfit = buildSource(input, "payfit", sha256(canonicalJson({ ...payfitStamp(input), historyLimited: historyLimited(input) })));
  return { schemaVersion: SNAPSHOT_VERSION, inputHash, dsn, payfit };
}
