import { and, eq, sql } from "drizzle-orm";
import { sourceRecord, workspaceEvent, workspaceSetting } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { CASH_PLAN_KEY, emptyCashPlan, parseCashPlan, type CashPlanSettings, type SupplierLine } from "./cashplan";
import type { CrisisLine } from "./model";

const cents = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const text = (value: unknown): string | null => typeof value === "string" && value !== "" ? value : null;

/**
 * Écritures de bilan (comptes 16, 17, 4 et 5) d'un fichier FEC appliqué, jusqu'à la date d'arrêté incluse.
 * Un seul exercice est lu : additionner deux exercices compterait deux fois les à-nouveaux.
 */
export async function readCrisisLines(workspaceId: string, syncId: string, filename: string, asOf: string): Promise<CrisisLine[]> {
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx.select({ data: sourceRecord.data }).from(sourceRecord).where(and(
      eq(sourceRecord.syncId, syncId), eq(sourceRecord.collection, "ledger_lines"),
      sql`${sourceRecord.data}->>'filename' = ${filename}`,
      sql`${sourceRecord.data}->>'accountId' ~ '^(1[67]|4|5)'`,
      sql`${sourceRecord.data}->>'operationDate' <= ${asOf}`,
    )),
  );
  return rows.map((row) => {
    const d = row.data as Record<string, unknown>;
    return {
      accountId: String(d.accountId), accountName: text(d.accountName), auxiliary: text(d.auxiliaryAccount), auxiliaryLabel: text(d.auxiliaryLabel),
      date: String(d.operationDate), debitCents: cents(d.debitCents), creditCents: cents(d.creditCents),
    };
  });
}

/** Écritures des comptes fournisseurs (40) d'un FEC appliqué jusqu'à une date, avec leur lettrage tel qu'il a été lu. */
export async function readSupplierLines(workspaceId: string, syncId: string, filename: string, asOf: string): Promise<SupplierLine[]> {
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx.select({ data: sourceRecord.data }).from(sourceRecord).where(and(
      eq(sourceRecord.syncId, syncId), eq(sourceRecord.collection, "ledger_lines"),
      sql`${sourceRecord.data}->>'filename' = ${filename}`,
      sql`${sourceRecord.data}->>'accountId' ~ '^40'`,
      sql`${sourceRecord.data}->>'operationDate' <= ${asOf}`,
    )),
  );
  return rows.map((row) => {
    const d = row.data as Record<string, unknown>;
    return {
      accountId: String(d.accountId), auxiliary: text(d.auxiliaryAccount), auxiliaryLabel: text(d.auxiliaryLabel), date: String(d.operationDate),
      pieceRef: text(d.pieceRef), pieceDate: text(d.pieceDate), debitCents: cents(d.debitCents), creditCents: cents(d.creditCents),
      letteringKnown: Object.hasOwn(d, "lettering"), lettering: text(d.lettering), letteringDate: text(d.letteringDate),
    };
  });
}

export class CashPlanError extends Error {}

export async function getCashPlan(workspaceId: string): Promise<CashPlanSettings> {
  const [row] = await withWorkspace(workspaceId, (tx) => tx.select({ value: workspaceSetting.value }).from(workspaceSetting)
    .where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, CASH_PLAN_KEY))));
  if (!row) return emptyCashPlan();
  const parsed = parseCashPlan(row.value);
  if (!parsed) throw new CashPlanError("Plan de trésorerie illisible. Aucune valeur n’a été remplacée.");
  return parsed;
}

/**
 * Modifie le plan sous verrou : la valeur relue dans la transaction est transformée puis réécrite, donc deux saisies
 * simultanées ne s'écrasent pas. Le journal ne reçoit aucun libellé ni montant.
 */
export async function updateCashPlan(workspaceId: string, actor: string, change: (current: CashPlanSettings) => CashPlanSettings, operation: string): Promise<CashPlanSettings> {
  return withWorkspace(workspaceId, async (tx) => {
    await tx.insert(workspaceSetting).values({ workspaceId, key: CASH_PLAN_KEY, value: emptyCashPlan(), updatedBy: actor }).onConflictDoNothing();
    const [row] = await tx.select({ value: workspaceSetting.value }).from(workspaceSetting)
      .where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, CASH_PLAN_KEY))).for("update");
    const current = row ? parseCashPlan(row.value) : null;
    if (!current) throw new CashPlanError("Plan de trésorerie illisible. Aucune valeur n’a été remplacée.");
    const next = parseCashPlan({ ...change(current), revision: current.revision + 1 });
    if (!next) throw new CashPlanError("Plan de trésorerie invalide après modification. Rien n’a été enregistré.");
    await tx.update(workspaceSetting).set({ value: next, updatedBy: actor, updatedAt: new Date() })
      .where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, CASH_PLAN_KEY)));
    await tx.insert(workspaceEvent).values({ workspaceId, actorUserId: actor, kind: "setting.changed", detail: { key: CASH_PLAN_KEY, revision: next.revision, operation, flowCount: next.flows.length } });
    return next;
  });
}
