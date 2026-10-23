import { desc } from "drizzle-orm";
import { workspaceEvent } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";

export type EventKind =
  | "workspace.created"
  | "workspace.renamed"
  | "invitation.created"
  | "member.joined"
  | "member.role_changed"
  | "member.removed"
  | "connector.connected"
  | "connector.disconnected"
  | "source.applied"
  | "source.discarded"
  | "dsn.uploaded"
  | "fec.uploaded"
  | "setting.changed"
  | "rh.rebuilt"
  | "rh.rebuild_failed"
  | "budget.scenario_created"
  | "budget.scenario_duplicated"
  | "budget.scenario_frozen"
  | "budget.scenario_deleted"
  | "budget.hypothesis_added"
  | "budget.hypothesis_deleted"
  | "budget.bulk_departures"
  | "budget.bulk_raises"
  | "budget.hypotheses_imported"
  | "budget.reference_saved"
  | "budget.reference_deleted";

export async function recordEvent(
  workspaceId: string,
  actorUserId: string | null,
  kind: EventKind,
  detail: Record<string, unknown> = {},
) {
  await withWorkspace(workspaceId, (tx) =>
    tx.insert(workspaceEvent).values({ workspaceId, actorUserId, kind, detail }),
  );
}

export async function listEvents(workspaceId: string, limit = 50) {
  return withWorkspace(workspaceId, (tx) =>
    tx.select().from(workspaceEvent).orderBy(desc(workspaceEvent.occurredAt)).limit(limit),
  );
}
