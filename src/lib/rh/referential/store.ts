import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { rhBuild, rhContract, rhContractMonth, rhEvent, rhFinding, rhMonthCoverage, rhPerson, sourceRecord, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import type { SyncSummary } from "@/lib/connectors/sync";
import { dsnCoverageIn } from "@/lib/dsn/import";
import { recordEvent } from "@/lib/events";
import { buildFromDsn } from "./build-dsn";
import { buildFromPayFit } from "./build-payfit";
import { RH_BUILDER_VERSION, rhInputsHash } from "./hash";
import { absenceOrder, absenceRowOf, type AbsenceRow, type RhBuildData, type RhBuildResult, type RhSource } from "./types";

export type { AbsenceRow };

// Persistance du référentiel Collaborateurs (§ 5) : un build « current » par (espace, source), reconstruit quand
// l'empreinte des entrées (lectures appliquées, déclarations retenues) ou la version des règles change.
export type RhBuildRow = typeof rhBuild.$inferSelect;
export type RhBuildState =
  | { kind: "ready"; build: RhBuildRow }
  | { kind: "unavailable"; build: RhBuildRow; reason: string } // F5 : collection contracts indisponible
  | { kind: "none"; reason: string }; // aucune lecture appliquée pour cette source


type Tx = Parameters<Parameters<typeof withWorkspace>[1]>[0];
type SyncRow = typeof sourceSync.$inferSelect;
type Probe = { kind: "payfit"; hash: string; sync: SyncRow } | { kind: "dsn"; hash: string; syncs: SyncRow[]; coverage: Awaited<ReturnType<typeof dsnCoverageIn>> };

const NONE_REASON: Record<RhSource, string> = { payfit: "aucune lecture PayFit appliquée", dsn: "aucun dépôt DSN appliqué" };
const BATCH = 500;

async function probe(tx: Tx, source: RhSource): Promise<Probe | null> {
  if (source === "payfit") {
    const [sync] = await tx
      .select()
      .from(sourceSync)
      .where(and(eq(sourceSync.provider, "payfit"), eq(sourceSync.status, "applied")))
      .orderBy(desc(sourceSync.decidedAt))
      .limit(1);
    if (!sync) return null;
    return { kind: "payfit", hash: rhInputsHash({ source, syncs: [{ id: sync.id, contentHash: sync.contentHash }] }), sync };
  }
  const syncs = await tx.select().from(sourceSync).where(and(eq(sourceSync.provider, "dsn"), eq(sourceSync.status, "applied")));
  if (!syncs.length) return null;
  const coverage = await dsnCoverageIn(tx);
  const selected = coverage.flatMap((r) => (r.status === "blocked" ? [] : r.selected.map((d) => ({ syncId: d.sourceId, key: d.key }))));
  return { kind: "dsn", hash: rhInputsHash({ source, syncs: syncs.map((s) => ({ id: s.id, contentHash: s.contentHash })), selected }), syncs, coverage };
}

async function currentBuild(tx: Tx, source: RhSource): Promise<RhBuildRow | null> {
  const [row] = await tx.select().from(rhBuild).where(and(eq(rhBuild.source, source), eq(rhBuild.status, "current"))).limit(1);
  return row ?? null;
}

const upToDate = (b: RhBuildRow | null, hash: string) => b !== null && b.inputsHash === hash && b.builderVersion === RH_BUILDER_VERSION;
const stateOf = (b: RhBuildRow): RhBuildState => (b.unavailableReason ? { kind: "unavailable", build: b, reason: b.unavailableReason } : { kind: "ready", build: b });

async function construct(tx: Tx, p: Probe): Promise<RhBuildResult> {
  if (p.kind === "payfit") {
    const rows = await tx
      .select({ collection: sourceRecord.collection, key: sourceRecord.recordKey, period: sourceRecord.period, data: sourceRecord.data })
      .from(sourceRecord)
      .where(and(eq(sourceRecord.syncId, p.sync.id), inArray(sourceRecord.collection, ["company", "collaborators", "contracts", "worked_time"])))
      .orderBy(sourceRecord.collection, sourceRecord.recordKey);
    const scope = p.sync.scope as { months?: string[] };
    return buildFromPayFit({
      sync: { id: p.sync.id, startedAt: p.sync.startedAt, decidedAt: p.sync.decidedAt, scope, summary: p.sync.summary as SyncSummary, contentHash: p.sync.contentHash },
      records: rows,
    });
  }
  const syncIds = [...new Set(p.coverage.flatMap((r) => (r.status === "blocked" ? [] : r.selected.map((d) => d.sourceId))))];
  const keys = [...new Set(p.coverage.flatMap((r) => (r.status === "blocked" ? [] : r.selected.map((d) => d.key))))];
  const rows = syncIds.length
    ? await tx
        .select({ syncId: sourceRecord.syncId, collection: sourceRecord.collection, key: sourceRecord.recordKey, period: sourceRecord.period, data: sourceRecord.data })
        .from(sourceRecord)
        .where(
          and(
            inArray(sourceRecord.syncId, syncIds),
            inArray(sourceRecord.collection, ["declarations", "people", "contracts", "remunerations", "activities"]),
            inArray(sql`coalesce(${sourceRecord.data}->>'declarationKey', ${sourceRecord.data}->>'key')`, keys),
          ),
        )
        .orderBy(sourceRecord.period, sourceRecord.recordKey)
    : [];
  return buildFromDsn({ coverage: p.coverage, syncs: p.syncs.map((s) => ({ id: s.id, decidedAt: s.decidedAt, contentHash: s.contentHash })), records: rows });
}

async function insertRows<T>(tx: Tx, table: Parameters<Tx["insert"]>[0], rows: T[]) {
  for (let i = 0; i < rows.length; i += BATCH) await tx.insert(table).values(rows.slice(i, i + BATCH) as never);
}

// Reconstruction sous verrou : l'ancien « current » reste en place si le constructeur échoue ; au plus deux builds
// (courant et précédent) sont conservés par (espace, source).
export async function rebuildRh(workspaceId: string, source: RhSource, actorUserId: string | null): Promise<RhBuildRow> {
  let outcome: { row: RhBuildRow; rebuilt: boolean };
  try {
    outcome = await withWorkspace(workspaceId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${workspaceId}:rh:${source}`}))`);
      const p = await probe(tx, source);
      if (!p) throw new Error(NONE_REASON[source]);
      const current = await currentBuild(tx, source);
      if (upToDate(current, p.hash)) return { row: current!, rebuilt: false };
      const result = await construct(tx, p);
      if (result.build.inputsHash !== p.hash) throw new Error("empreinte des entrées incohérente entre la sonde et le constructeur");
      await tx.delete(rhBuild).where(and(eq(rhBuild.source, source), eq(rhBuild.status, "superseded")));
      if (current) await tx.update(rhBuild).set({ status: "superseded" }).where(eq(rhBuild.id, current.id));
      const b = result.build;
      const [row] = await tx
        .insert(rhBuild)
        .values({
          workspaceId,
          source,
          status: "current",
          builderVersion: b.builderVersion,
          inputsHash: b.inputsHash,
          inputs: b.inputs,
          referenceDate: b.referenceDate,
          presenceFrom: b.presenceFrom,
          presenceTo: b.presenceTo,
          summary: b.summary,
          unavailableReason: b.unavailableReason,
          builtBy: actorUserId,
        })
        .returning();
      const stamp = <T extends object>(r: T) => ({ workspaceId, buildId: row.id, ...r });
      await insertRows(tx, rhPerson, result.persons.map(stamp));
      await insertRows(tx, rhContract, result.contracts.map(stamp));
      await insertRows(tx, rhContractMonth, result.months.map(stamp));
      await insertRows(tx, rhEvent, result.events.map(stamp));
      await insertRows(tx, rhMonthCoverage, result.coverage.map(stamp));
      await insertRows(tx, rhFinding, result.findings.map(stamp));
      return { row, rebuilt: true };
    });
  } catch (e) {
    await recordEvent(workspaceId, actorUserId, "rh.rebuild_failed", { source, reason: e instanceof Error ? e.message : "erreur inconnue" }).catch(() => {});
    throw e;
  }
  if (outcome.rebuilt) {
    await recordEvent(workspaceId, actorUserId, "rh.rebuilt", { source, buildId: outcome.row.id, inputsHash: outcome.row.inputsHash, summary: outcome.row.summary, unavailable: outcome.row.unavailableReason });
  }
  return outcome.row;
}

// Garantit un build à jour pour la source : empreinte seulement si rien n'a changé, reconstruction sinon.
export async function ensureRhBuild(workspaceId: string, source: RhSource, actorUserId: string | null): Promise<RhBuildState> {
  const probed = await withWorkspace(workspaceId, async (tx) => {
    const p = await probe(tx, source);
    if (!p) return null;
    return { hash: p.hash, current: await currentBuild(tx, source) };
  });
  if (!probed) return { kind: "none", reason: NONE_REASON[source] };
  if (upToDate(probed.current, probed.hash)) return stateOf(probed.current!);
  return stateOf(await rebuildRh(workspaceId, source, actorUserId));
}

export async function loadRhBuild(workspaceId: string, buildId: string): Promise<RhBuildData & { build: RhBuildRow }> {
  return withWorkspace(workspaceId, async (tx) => {
    const [build] = await tx.select().from(rhBuild).where(eq(rhBuild.id, buildId));
    if (!build) throw new Error("Référentiel introuvable.");
    // Une transaction = une connexion : lectures séquentielles.
    const persons = await tx.select().from(rhPerson).where(eq(rhPerson.buildId, buildId)).orderBy(rhPerson.personKey);
    const contracts = await tx.select().from(rhContract).where(eq(rhContract.buildId, buildId)).orderBy(rhContract.contractKey);
    const months = await tx.select().from(rhContractMonth).where(eq(rhContractMonth.buildId, buildId)).orderBy(rhContractMonth.contractKey, rhContractMonth.month, rhContractMonth.establishmentId);
    const events = await tx.select().from(rhEvent).where(eq(rhEvent.buildId, buildId)).orderBy(rhEvent.date, rhEvent.kind, rhEvent.contractKey);
    const coverage = await tx.select().from(rhMonthCoverage).where(eq(rhMonthCoverage.buildId, buildId)).orderBy(rhMonthCoverage.establishmentId, rhMonthCoverage.month);
    const findings = await tx.select().from(rhFinding).where(eq(rhFinding.buildId, buildId)).orderBy(rhFinding.code, rhFinding.month);
    return { build, persons, contracts, months, events, coverage, findings };
  });
}

// Fiche PayFit : absences des contrats d'une personne, lues à la demande dans la lecture active.
export async function loadAbsences(workspaceId: string, syncId: string, contractIds: string[]): Promise<AbsenceRow[]> {
  if (!contractIds.length) return [];
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ key: sourceRecord.recordKey, data: sourceRecord.data })
      .from(sourceRecord)
      .where(and(eq(sourceRecord.syncId, syncId), eq(sourceRecord.collection, "absences"), inArray(sql`${sourceRecord.data}->>'contractId'`, contractIds)))
      .orderBy(sourceRecord.recordKey),
  );
  return rows.map((r) => absenceRowOf(r.key, r.data)).sort(absenceOrder);
}

// KPI : toutes les absences d'une lecture (absentéisme), et leurs types avec leur nombre (Paramètres).
export async function loadAbsencesOfSync(workspaceId: string, syncId: string): Promise<AbsenceRow[]> {
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ key: sourceRecord.recordKey, data: sourceRecord.data })
      .from(sourceRecord)
      .where(and(eq(sourceRecord.syncId, syncId), eq(sourceRecord.collection, "absences")))
      .orderBy(sourceRecord.recordKey),
  );
  return rows.map((r) => absenceRowOf(r.key, r.data)).sort(absenceOrder);
}

export async function loadAbsenceTypes(workspaceId: string, syncId: string): Promise<{ type: string; count: number }[]> {
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ type: sql<string>`${sourceRecord.data}->>'type'`, count: sql<number>`count(*)::int` })
      .from(sourceRecord)
      .where(and(eq(sourceRecord.syncId, syncId), eq(sourceRecord.collection, "absences")))
      .groupBy(sql`${sourceRecord.data}->>'type'`)
      .orderBy(sql`${sourceRecord.data}->>'type'`),
  );
  return rows.filter((r) => typeof r.type === "string").map((r) => ({ type: r.type, count: r.count }));
}

// Mois dont la paie n'est pas clôturée à la lecture (statut de paie PayFit « not_completed ») ; un mois sans statut lu n'y figure pas.
export async function loadPayrollOpenMonths(workspaceId: string, syncId: string): Promise<string[]> {
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ month: sql<string>`${sourceRecord.data}->>'month'` })
      .from(sourceRecord)
      .where(and(eq(sourceRecord.syncId, syncId), eq(sourceRecord.collection, "payroll_status"), sql`${sourceRecord.data}->>'status' = 'not_completed'`)),
  );
  return rows.map((r) => r.month).filter((m): m is string => typeof m === "string").sort();
}

export async function activePayFitSync(workspaceId: string): Promise<{ id: string; startedAt: Date } | null> {
  const [row] = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ id: sourceSync.id, startedAt: sourceSync.startedAt })
      .from(sourceSync)
      .where(and(eq(sourceSync.provider, "payfit"), eq(sourceSync.status, "applied")))
      .orderBy(desc(sourceSync.decidedAt))
      .limit(1),
  );
  return row ?? null;
}
