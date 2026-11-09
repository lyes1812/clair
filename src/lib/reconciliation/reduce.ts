import { z } from "zod";
import { entityFingerprint, entityOf, fieldFingerprint, fieldsOf, initialState, linkOf, linksOf, pairFingerprint, sameField, unmatchedOf } from "./compare";
import type { Action, Decision, DecisionError, EntityKind, EntityTarget, FieldTarget, ReduceResult, Snapshot, State } from "./types";

const id = z.string().uuid();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const comment = z.string().trim().min(1).max(500).refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value));
const entity = z.enum(["person", "contract"]);
const target = z.object({ entity, source: z.enum(["dsn", "payfit"]), id }).strict();
const fieldTarget = z.object({ entity, dsnId: id, payfitId: id, field: z.enum(["familyName", "givenNames", "startDate", "endDate", "nature"]) }).strict();
const pair = { dsnId: id, payfitId: id, fingerprint };
const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link-person"), ...pair }).strict(),
  z.object({ kind: z.literal("link-contract"), ...pair }).strict(),
  z.object({ kind: z.literal("unlink-person"), ...pair, comment }).strict(),
  z.object({ kind: z.literal("unlink-contract"), ...pair, comment }).strict(),
  z.object({ kind: z.literal("mark-unmatched"), target, fingerprint, comment }).strict(),
  z.object({ kind: z.literal("reopen-unmatched"), target, fingerprint, comment }).strict(),
  z.object({ kind: z.literal("resolve-field"), target: fieldTarget, fingerprint, disposition: z.enum(["explained", "correction-requested"]), comment }).strict(),
  z.object({ kind: z.literal("reopen-field"), target: fieldTarget, fingerprint, comment }).strict(),
]);
// Frontière serveur : toutes les clés inconnues sont refusées, jamais recopiées dans l'historique.
export function parseDecisionCommand(value: unknown): Action | null {
  const parsed = command.safeParse(value);
  return parsed.success ? parsed.data : null;
}
const sameEntity = (left: EntityTarget, right: EntityTarget) => left.entity === right.entity && left.source === right.source && left.id === right.id;
const withoutUnmatched = (state: State, targets: EntityTarget[]) => state.unmatched.filter((row) => !targets.some((target) => sameEntity(row, target)));
const fail = (reason: DecisionError): ReduceResult => ({ ok: false, reason });
const belongsToLinkedParents = (snapshot: Snapshot, state: State, dsnId: string, payfitId: string): boolean => {
  const left = snapshot.dsn.contracts.find((row) => row.id === dsnId)?.personId;
  const right = snapshot.payfit.contracts.find((row) => row.id === payfitId)?.personId;
  return left?.kind === "value" && right?.kind === "value" && state.personLinks.some((row) => row.dsnId === left.value && row.payfitId === right.value);
};
export function reduceDecision(snapshot: Snapshot, state: State, decision: Decision): ReduceResult {
  if (decision.inputHash !== snapshot.inputHash || state.inputHash !== snapshot.inputHash) return fail("stale-source");
  if (!Number.isSafeInteger(decision.revision) || decision.revision !== state.revision + 1) return fail("invalid-revision");
  if (typeof decision.actorId !== "string" || !decision.actorId.trim() || decision.actorId.length > 128 || typeof decision.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(decision.createdAt) || !Number.isFinite(Date.parse(decision.createdAt))) return fail("invalid-decision");
  const raw = decision.action as unknown;
  if (raw && typeof raw === "object" && "kind" in raw && typeof raw.kind === "string" && !["link-person", "link-contract"].includes(raw.kind) && !comment.safeParse("comment" in raw ? raw.comment : undefined).success) return fail("invalid-comment");
  const action = parseDecisionCommand(raw);
  if (!action) return fail("invalid-decision");
  const next: State = { ...state, revision: decision.revision };
  if (action.kind === "link-person" || action.kind === "link-contract" || action.kind === "unlink-person" || action.kind === "unlink-contract") {
    const kind: EntityKind = action.kind.endsWith("person") ? "person" : "contract";
    const dsnTarget: EntityTarget = { entity: kind, source: "dsn", id: action.dsnId }, payfitTarget: EntityTarget = { entity: kind, source: "payfit", id: action.payfitId };
    if (!entityOf(snapshot, dsnTarget) || !entityOf(snapshot, payfitTarget)) return fail("unknown-target");
    if (action.fingerprint !== pairFingerprint(snapshot, kind, action.dsnId, action.payfitId, state)) return fail("stale-fingerprint");
    const links = linksOf(state, kind);
    const key = kind === "person" ? "personLinks" : "contractLinks";
    if (action.kind.startsWith("link-")) {
      if (links.some((row) => row.dsnId === action.dsnId || row.payfitId === action.payfitId)) return fail("already-linked");
      if (kind === "contract" && !belongsToLinkedParents(snapshot, state, action.dsnId, action.payfitId)) return fail("wrong-parent");
      next[key] = [...links, { dsnId: action.dsnId, payfitId: action.payfitId, revision: decision.revision }];
      next.unmatched = withoutUnmatched(state, [dsnTarget, payfitTarget]);
    } else {
      if (!linkOf(state, { entity: kind, dsnId: action.dsnId, payfitId: action.payfitId })) return fail("not-linked");
      next[key] = links.filter((row) => !(row.dsnId === action.dsnId && row.payfitId === action.payfitId));
      const removedContracts = kind === "person" ? state.contractLinks.filter((row) => {
        const dsn = snapshot.dsn.contracts.find((contract) => contract.id === row.dsnId)?.personId;
        const payfit = snapshot.payfit.contracts.find((contract) => contract.id === row.payfitId)?.personId;
        return (dsn?.kind === "value" && dsn.value === action.dsnId) || (payfit?.kind === "value" && payfit.value === action.payfitId);
      }) : [{ dsnId: action.dsnId, payfitId: action.payfitId }];
      if (kind === "person") next.contractLinks = state.contractLinks.filter((row) => !removedContracts.some((removed) => removed.dsnId === row.dsnId && removed.payfitId === row.payfitId));
      next.resolutions = state.resolutions.filter((row) => !((row.entity === kind && row.dsnId === action.dsnId && row.payfitId === action.payfitId) || (row.entity === "contract" && removedContracts.some((removed) => removed.dsnId === row.dsnId && removed.payfitId === row.payfitId))));
    }
  } else if (action.kind === "mark-unmatched" || action.kind === "reopen-unmatched") {
    if (!entityOf(snapshot, action.target)) return fail("unknown-target");
    if (action.fingerprint !== entityFingerprint(snapshot, action.target, state)) return fail("stale-fingerprint");
    if (action.kind === "mark-unmatched") {
      if (linksOf(state, action.target.entity).some((row) => (action.target.source === "dsn" ? row.dsnId : row.payfitId) === action.target.id)) return fail("already-linked");
      next.unmatched = [...withoutUnmatched(state, [action.target]), { ...action.target, comment: action.comment, revision: decision.revision }];
    } else {
      if (!unmatchedOf(state, action.target)) return fail("not-unmatched");
      next.unmatched = withoutUnmatched(state, [action.target]);
    }
  } else {
    if (action.kind !== "resolve-field" && action.kind !== "reopen-field") return fail("invalid-decision");
    const target: FieldTarget = action.target;
    if (!fieldsOf(target.entity).includes(target.field) || !entityOf(snapshot, { entity: target.entity, source: "dsn", id: target.dsnId }) || !entityOf(snapshot, { entity: target.entity, source: "payfit", id: target.payfitId })) return fail("unknown-target");
    if (!linkOf(state, target)) return fail("not-linked");
    if (action.fingerprint !== fieldFingerprint(snapshot, target, state)) return fail("stale-fingerprint");
    if (action.kind === "resolve-field") {
      next.resolutions = [...state.resolutions.filter((row) => !sameField(row, target)), { ...target, fingerprint: action.fingerprint, disposition: action.disposition, comment: action.comment, revision: decision.revision }];
    } else {
      if (!state.resolutions.some((row) => sameField(row, target))) return fail("not-resolved");
      next.resolutions = state.resolutions.filter((row) => !sameField(row, target));
    }
  }
  return { ok: true, state: next };
}
export type ReplayResult = { ok: true; state: State } | { ok: false; state: State; reason: DecisionError; revision: number };
export function replayDecisions(snapshot: Snapshot, decisions: readonly Decision[]): ReplayResult {
  let state = initialState(snapshot);
  for (const decision of decisions) {
    const result = reduceDecision(snapshot, state, decision);
    if (!result.ok) return { ...result, state, revision: decision.revision };
    state = result.state;
  }
  return { ok: true, state };
}
