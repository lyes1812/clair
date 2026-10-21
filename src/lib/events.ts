import { desc } from "drizzle-orm";
import { workspaceEvent } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";

export type EventKind =
  | "workspace.created"
  | "workspace.renamed"
  | "invitation.created"
  | "member.joined"
  | "member.role_changed"
  | "member.removed";

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
