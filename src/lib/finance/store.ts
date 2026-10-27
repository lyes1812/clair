import { and, eq, inArray, sql } from "drizzle-orm";
import { budgetScenario, workspaceEvent, workspaceSetting } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { emptyFinanceSettings, FINANCE_SETTINGS_KEY, FinanceError, parseFinanceSettings } from "./plans";
import type { FinanceSettings } from "./types";

export { FinanceError } from "./plans";

export async function getFinanceSettings(workspaceId: string): Promise<FinanceSettings> {
  const [row] = await withWorkspace(workspaceId, (tx) => tx.select({ value: workspaceSetting.value }).from(workspaceSetting)
    .where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, FINANCE_SETTINGS_KEY))));
  if (!row) return emptyFinanceSettings();
  const parsed = parseFinanceSettings(row.value);
  if (!parsed) throw new FinanceError("Paramètres financiers illisibles. Aucune valeur n’a été remplacée.");
  return parsed;
}

export async function saveFinanceSettings(workspaceId: string, actor: string, expectedRevision: number, next: FinanceSettings): Promise<void> {
  const parsed = parseFinanceSettings(next);
  if (!parsed || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER || parsed.revision !== expectedRevision) {
    throw new FinanceError("Paramètres financiers ou révision invalides.");
  }
  const value: FinanceSettings = { ...parsed, revision: expectedRevision + 1 };
  await withWorkspace(workspaceId, async (tx) => {
    const [current] = await tx.select({ value: workspaceSetting.value }).from(workspaceSetting)
      .where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, FINANCE_SETTINGS_KEY))).for("update");
    const stored = current ? parseFinanceSettings(current.value) : null;
    if (current && !stored) throw new FinanceError("Paramètres financiers illisibles. Aucune valeur n’a été remplacée.");
    if ((stored?.revision ?? 0) !== expectedRevision || (!current && expectedRevision !== 0)) {
      throw new FinanceError("Les paramètres financiers ont changé. Recharge la page avant d’enregistrer.", "conflict");
    }
    const rhIds = [...new Set(value.plans.flatMap((plan) => plan.personnelSource === "rh" && plan.rhScenarioId ? [plan.rhScenarioId.toLowerCase()] : []))];
    if (rhIds.length) {
      const rows = await tx.select({ id: budgetScenario.id }).from(budgetScenario)
        .where(and(eq(budgetScenario.workspaceId, workspaceId), inArray(budgetScenario.id, rhIds)));
      if (rows.length !== rhIds.length) throw new FinanceError("Un scénario RH n’est pas accessible dans cet espace.", "rh-unavailable");
    }
    const now = new Date();
    const updated = await tx.insert(workspaceSetting).values({ workspaceId, key: FINANCE_SETTINGS_KEY, value, updatedBy: actor, updatedAt: now })
      .onConflictDoUpdate({
        target: [workspaceSetting.workspaceId, workspaceSetting.key],
        set: { value, updatedBy: actor, updatedAt: now },
        setWhere: and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, FINANCE_SETTINGS_KEY), sql`${workspaceSetting.value}->>'revision' = ${String(expectedRevision)}`),
      }).returning({ id: workspaceSetting.id });
    if (!updated.length) throw new FinanceError("Les paramètres financiers ont changé. Recharge la page avant d’enregistrer.", "conflict");
    await tx.insert(workspaceEvent).values({
      workspaceId, actorUserId: actor, kind: "setting.changed",
      detail: {
        key: FINANCE_SETTINGS_KEY, revision: value.revision,
        mappingCount: value.mappings.length, planCount: value.plans.length,
        cellCount: value.plans.reduce((count, plan) => count + Object.values(plan.cells).reduce((n, row) => n + Object.keys(row).length, 0), 0),
      },
    });
  });
}
