import { createHash } from "node:crypto";
import { createPayFitClient, readPayFit } from "@/lib/connectors/payfit/client";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";
import type { CollectionOutcome, SourceRecordInput } from "@/lib/connectors/types";
import { monthRange } from "@/lib/connectors/months";
import { fixtureDsnBytes } from "@/lib/dsn/fixture";
import { parseDsn, type DsnDeclaration } from "@/lib/dsn/parser";
import { selectDeclarations, type SelectableDeclaration } from "@/lib/dsn/selection";
import { canonicalJson, sha256 } from "@/lib/crypto";
import { buildFromDsn, type DsnBuildInput } from "@/lib/rh/referential/build-dsn";
import { buildFromPayFit } from "@/lib/rh/referential/build-payfit";
import type { RhBuildResult } from "@/lib/rh/referential/types";
import { dsnBytes, payfitEdgeFetch, type DsnDeclarationSpec, type PayFitEdgeCase } from "./edge-cases";

// Construit un référentiel PayFit depuis un transport (fictif ou cas limite) sans base de données.
export const PAYFIT_STARTED_AT = new Date("2026-10-21T08:00:00Z");
export const PAYFIT_MONTHS = monthRange("2024-10", "2026-09");

export async function payfitBuild(key: string, fetchImpl: Parameters<typeof createPayFitClient>[1] extends infer O ? (O extends { fetchImpl?: infer F } ? F : never) : never, months = PAYFIT_MONTHS, startedAt = PAYFIT_STARTED_AT): Promise<RhBuildResult> {
  const result = await readPayFit(createPayFitClient(key, { fetchImpl, minIntervalMs: 0 }), months);
  const records = result.records.filter((r) => ["company", "collaborators", "contracts", "worked_time"].includes(r.collection));
  return buildFromPayFit({
    sync: {
      id: `sync-${key}`,
      startedAt,
      decidedAt: startedAt,
      scope: { months },
      summary: { company: { id: result.company.id, name: result.company.name, identificationNumber: result.company.identificationNumber }, scopes: result.scopes, collections: result.collections, months },
      contentHash: sha256(canonicalJson(records)),
    },
    records,
  });
}

export const payfitFixtureBuild = (key = "fixture-A-1", months = PAYFIT_MONTHS) => payfitBuild(key, createFixtureFetch(key), months);
export const payfitEdgeBuild = (edge: PayFitEdgeCase, months = PAYFIT_MONTHS) => payfitBuild("cle-fictive-edge-1234", payfitEdgeFetch("cle-fictive-edge-1234", edge), months);

// Référentiel DSN depuis des déclarations analysées : mêmes enregistrements que l'import, couverture par la sélection.
const fp = (v: string) => createHash("sha256").update(`ws-test|${v}`).digest("hex").slice(0, 32);

export function declarationRecords(d: DsnDeclaration, filename: string, syncId: string): (SourceRecordInput & { syncId: string })[] {
  const content = sha256(canonicalJson({ people: d.people, contracts: d.contracts, remunerations: d.remunerations, activities: d.activities }));
  const out: (SourceRecordInput & { syncId: string })[] = [
    { syncId, collection: "declarations", key: d.key, period: d.month, data: { key: d.key, siret: d.siret, siren: d.siren, month: d.month, nature: d.nature, type: d.type, fraction: d.fraction, order: d.order, eligible: d.eligible, blocking: d.blocking, warnings: d.warnings, contentHash: content, filename } },
  ];
  for (const p of d.people) out.push({ syncId, collection: "people", key: `${d.key}|${p.personId}`, period: d.month, data: { ...p, declarationKey: d.key, siret: d.siret } });
  for (const c of d.contracts) out.push({ syncId, collection: "contracts", key: `${d.key}|${c.contractId}`, period: d.month, data: { ...c, declarationKey: d.key, siret: d.siret } });
  d.remunerations.forEach((r, i) => out.push({ syncId, collection: "remunerations", key: `${d.key}|${String(i).padStart(5, "0")}`, period: d.month, data: { ...r, declarationKey: d.key, siret: d.siret } }));
  d.activities.forEach((a, i) => out.push({ syncId, collection: "activities", key: `${d.key}|${String(i).padStart(5, "0")}`, period: d.month, data: { ...a, declarationKey: d.key, siret: d.siret } }));
  return out;
}

export type DsnFile = { bytes: Uint8Array; filename: string; syncId?: string };

export function dsnInput(files: DsnFile[]): DsnBuildInput {
  const records: DsnBuildInput["records"] = [];
  const selectable: SelectableDeclaration[] = [];
  const syncIds = new Set<string>();
  for (const f of files) {
    const syncId = f.syncId ?? "sync-dsn-1";
    syncIds.add(syncId);
    const parsed = parseDsn(f.bytes, { fingerprint: fp });
    for (const d of parsed.declarations) {
      const recs = declarationRecords(d, f.filename, syncId);
      records.push(...recs);
      selectable.push({ key: d.key, siret: d.siret, month: d.month, nature: d.nature, type: d.type, fraction: d.fraction, order: d.order, eligible: d.eligible, blocking: d.blocking, sourceId: syncId, contentHash: String(recs[0].data.contentHash) });
    }
  }
  return { coverage: selectDeclarations(selectable), syncs: [...syncIds].sort().map((id) => ({ id, decidedAt: new Date("2026-10-21T09:00:00Z"), contentHash: `hash-${id}` })), records };
}

export const dsnBuild = (files: DsnFile[]) => buildFromDsn(dsnInput(files));
export const fixtureFiles = (months: string[]) => months.map((month) => ({ bytes: fixtureDsnBytes({ month }), filename: `${month}.dsn` }));
export const dsnFixtureBuild = (months = monthRange("2024-10", "2026-09")) => dsnBuild(fixtureFiles(months));
export const edgeFiles = (specs: DsnDeclarationSpec[]) => specs.map((s) => ({ bytes: dsnBytes(s), filename: `${s.month}-edge.dsn` }));

export const byKey = <T extends { contractKey: string }>(rows: T[], shortId: string) => rows.find((r) => r.contractKey.endsWith(shortId))!;
export const emptyOutcomes: CollectionOutcome[] = [];
