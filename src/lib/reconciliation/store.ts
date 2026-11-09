import { and, desc, eq, inArray } from "drizzle-orm";
import { reconciliationDecision, reconciliationRun, user } from "@/db/schema";
import { withWorkspace, type WorkspaceTransaction } from "@/db/workspace-scope";
import { parseDecisionCommand, reduceDecision, replayDecisions } from "./reduce";
import { COMPARATOR_VERSION, snapshotInputHash, snapshotOf } from "./snapshot";
import { sourceInputsIn, type Sources } from "./source-snapshot";
import type { Decision, DecisionError, Snapshot, State } from "./types";

export type StoreErrorCode = "invalid_month" | "not_found" | "stale" | "revision_conflict" | "invalid_decision" | "invalid_history" | "unavailable" | "storage_error";
export class ReconciliationStoreError extends Error {
  constructor(public readonly code: StoreErrorCode, public readonly decisionReason?: DecisionError) {
    super(code); this.name = "ReconciliationStoreError";
  }
}
export type RunSummary = { id: string; controlMonth: string; inputHash: string; revision: number; createdAt: string; createdBy: string };
export type RunDetail = RunSummary & { snapshot: Snapshot; decisions: Decision[]; state: State; stale: boolean };
export type ReconciliationData = { months: string[]; sources: Sources; runs: RunSummary[]; selected: RunDetail | null; actorNames: Record<string, string> };
const REPEATABLE_READ = { isolationLevel: "repeatable read" as const };
const monthValid = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && v >= "1900-01" && v <= "2199-12";
const uuid = (v: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const actorValid = (v: string) => typeof v === "string" && v.trim() && v.length <= 128;
const summaryOf = (r: { id: string; controlMonth: string; inputHash: string; revision: number; createdAt: Date; createdBy: string }): RunSummary => ({ id: r.id, controlMonth: r.controlMonth, inputHash: r.inputHash, revision: r.revision, createdAt: r.createdAt.toISOString(), createdBy: r.createdBy });
function storedError(error: unknown): ReconciliationStoreError {
  if (error instanceof ReconciliationStoreError) return error;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  // Drizzle encapsule l'erreur PostgreSQL ; aucune requête ni valeur SQL n'est exposée.
  const causeCode = error && typeof error === "object" && "cause" in error && error.cause && typeof error.cause === "object" && "code" in error.cause ? error.cause.code : undefined;
  return new ReconciliationStoreError(code === "40001" || causeCode === "40001" || code === "40P01" || causeCode === "40P01" ? "revision_conflict" : "storage_error");
}
async function decisionsIn(tx: WorkspaceTransaction, runId: string): Promise<Decision[]> {
  const rows = await tx.select({ revision: reconciliationDecision.revision, inputHash: reconciliationDecision.inputHash, actorId: reconciliationDecision.actorId,
    createdAt: reconciliationDecision.createdAt, action: reconciliationDecision.action }).from(reconciliationDecision).where(eq(reconciliationDecision.runId, runId)).orderBy(reconciliationDecision.revision);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
function replay(snapshot: Snapshot, decisions: Decision[], expectedRevision: number): State {
  const result = replayDecisions(snapshot, decisions);
  if (!result.ok || result.state.revision !== expectedRevision) throw new ReconciliationStoreError("invalid_history");
  return result.state;
}

// Appelants : requireWorkspace(slug, EDITOR) avant toute lecture nominative ou écriture.
export async function loadReconciliation(workspaceId: string, runId?: string): Promise<ReconciliationData> {
  if (runId && !uuid(runId)) throw new ReconciliationStoreError("not_found");
  try {
    return await withWorkspace(workspaceId, async (tx) => {
      // L'historique charge ses métadonnées ; seul le contrôle ouvert charge le snapshot nominatif.
      const rows = await tx.select({ id: reconciliationRun.id, controlMonth: reconciliationRun.controlMonth, inputHash: reconciliationRun.inputHash, revision: reconciliationRun.revision,
        createdAt: reconciliationRun.createdAt, createdBy: reconciliationRun.createdBy }).from(reconciliationRun).orderBy(desc(reconciliationRun.createdAt), desc(reconciliationRun.id));
      const selectedId = runId ?? rows[0]?.id;
      const [selected] = selectedId ? await tx.select().from(reconciliationRun).where(eq(reconciliationRun.id, selectedId)).limit(1) : [];
      if (runId && !selected) throw new ReconciliationStoreError("not_found");
      const probe = await sourceInputsIn(tx, workspaceId, selected?.controlMonth ?? "");
      let detail: RunDetail | null = null;
      if (selected) {
        const decisions = await decisionsIn(tx, selected.id);
        detail = { ...summaryOf(selected), snapshot: selected.snapshot, decisions, state: replay(selected.snapshot, decisions, selected.revision),
          stale: selected.comparatorVersion !== COMPARATOR_VERSION || selected.inputHash !== snapshotInputHash(probe.inputs) };
      }
      // La table d'authentification n'est pas une table métier RLS. Sa liste d'IDs vient
      // exclusivement des décisions du contrôle déjà autorisé par l'espace ci-dessus.
      // Aucun identifiant libre, autre compte ni e-mail n'est lu ou renvoyé.
      const actorIds = [...new Set(detail?.decisions.map((d) => d.actorId) ?? [])];
      const actors = actorIds.length ? await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, actorIds)) : [];
      const actorNames = Object.fromEntries(actors.filter((actor) => actor.name.trim()).map((actor) => [actor.id, actor.name]));
      return { months: probe.months, sources: probe.sources, runs: rows.map(summaryOf), selected: detail, actorNames };
    }, REPEATABLE_READ);
  } catch (e) { throw storedError(e); }
}

export async function createReconciliationRun(workspaceId: string, actorId: string, controlMonth: string): Promise<string> {
  if (!monthValid(controlMonth)) throw new ReconciliationStoreError("invalid_month");
  if (!actorValid(actorId)) throw new ReconciliationStoreError("invalid_decision");
  try {
    return await withWorkspace(workspaceId, async (tx) => {
      const probe = await sourceInputsIn(tx, workspaceId, controlMonth);
      if (!probe.sources.dsn.available || !probe.sources.payfit.available) throw new ReconciliationStoreError("unavailable");
      if (!probe.months.includes(controlMonth)) throw new ReconciliationStoreError("invalid_month");
      const snapshot = snapshotOf(probe.inputs);
      const [existing] = await tx.select({ id: reconciliationRun.id }).from(reconciliationRun).where(eq(reconciliationRun.inputHash, snapshot.inputHash)).limit(1);
      if (existing) return existing.id;
      const [created] = await tx.insert(reconciliationRun).values({ workspaceId, controlMonth, inputHash: snapshot.inputHash, comparatorVersion: COMPARATOR_VERSION, snapshot, createdBy: actorId }).returning({ id: reconciliationRun.id });
      return created.id;
    }, REPEATABLE_READ);
  } catch (e) {
    // Deux créations simultanées du même contrôle renvoient le contrôle déjà créé.
    const cause = e && typeof e === "object" && "cause" in e ? e.cause : e;
    if (cause && typeof cause === "object" && "code" in cause && (cause.code === "23505" || cause.code === "40001")) {
      try {
        return await withWorkspace(workspaceId, async (tx) => {
          const probe = await sourceInputsIn(tx, workspaceId, controlMonth);
          if (!probe.sources.dsn.available || !probe.sources.payfit.available) throw new ReconciliationStoreError("unavailable");
          const [existing] = await tx.select({ id: reconciliationRun.id }).from(reconciliationRun).where(eq(reconciliationRun.inputHash, snapshotInputHash(probe.inputs))).limit(1);
          if (!existing) throw new ReconciliationStoreError("revision_conflict");
          return existing.id;
        }, REPEATABLE_READ);
      } catch (retryError) { throw storedError(retryError); }
    }
    throw storedError(e);
  }
}

export async function appendReconciliationDecision(workspaceId: string, actorId: string, runId: string, expectedRevision: number, inputHash: string, rawCommand: unknown): Promise<void> {
  const command = parseDecisionCommand(rawCommand);
  if (!uuid(runId) || !actorValid(actorId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[a-f0-9]{64}$/.test(inputHash) || !command) throw new ReconciliationStoreError("invalid_decision");
  try {
    await withWorkspace(workspaceId, async (tx) => {
      const [run] = await tx.select().from(reconciliationRun).where(eq(reconciliationRun.id, runId)).for("update");
      if (!run) throw new ReconciliationStoreError("not_found");
      const probe = await sourceInputsIn(tx, workspaceId, run.controlMonth);
      if (run.comparatorVersion !== COMPARATOR_VERSION || run.inputHash !== snapshotInputHash(probe.inputs) || inputHash !== run.inputHash) throw new ReconciliationStoreError("stale");
      if (run.revision !== expectedRevision) throw new ReconciliationStoreError("revision_conflict");
      const decisions = await decisionsIn(tx, run.id);
      const state = replay(run.snapshot, decisions, run.revision);
      const decision: Decision = { revision: expectedRevision + 1, inputHash: run.inputHash, actorId, createdAt: new Date().toISOString(), action: command };
      const next = reduceDecision(run.snapshot, state, decision);
      if (!next.ok) throw new ReconciliationStoreError("invalid_decision", next.reason);
      await tx.update(reconciliationRun).set({ revision: next.state.revision }).where(and(eq(reconciliationRun.id, run.id), eq(reconciliationRun.revision, expectedRevision)));
      await tx.insert(reconciliationDecision).values({ workspaceId, runId: run.id, revision: decision.revision, inputHash: run.inputHash, actorId, createdAt: new Date(decision.createdAt), action: command });
    }, REPEATABLE_READ);
  } catch (e) { throw storedError(e); }
}
