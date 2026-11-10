import { and, eq, sql } from "drizzle-orm";
import { sourceRecord, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { isMonth, monthBounds } from "@/lib/connectors/months";
import type { PayrollContext } from "./context";
import type { PayrollExplorationInput } from "./exploration";

// Ce loader complète uniquement le contexte déjà autorisé. Il ne synchronise rien
// et ne modifie pas les moteurs globaux : un statut absent n'est pas une clôture.
export async function loadPayrollExplorationContext(ctx: PayrollContext): Promise<PayrollExplorationInput> {
  const base: PayrollExplorationInput = { source: ctx.source, journal: ctx.input, read: null, rh: ctx.kpi.collab.data, unavailable: ctx.unavailable };
  if (ctx.source !== "payfit" || !ctx.input || !ctx.read) return base;
  const read = ctx.read;
  return withWorkspace(ctx.kpi.collab.workspace.id, async (tx) => {
    const [active] = await tx.select({ id: sourceSync.id, startedAt: sourceSync.startedAt }).from(sourceSync)
      .where(and(eq(sourceSync.id, read.syncId), eq(sourceSync.provider, "payfit"), eq(sourceSync.status, "applied"))).limit(1);
    if (!active) return { ...base, unavailable: "La lecture PayFit a été remplacée ou n’est plus appliquée. Recharge la page." };
    const date = active.startedAt;
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return { ...base, unavailable: "Date de la lecture PayFit non disponible." };
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const readDate = `${part("year")}-${part("month")}-${part("day")}`;
    const statuses = await tx.select({ period: sourceRecord.period,
      month: sql<string | null>`${sourceRecord.data}->>'month'`, status: sql<string | null>`${sourceRecord.data}->>'status'`,
    }).from(sourceRecord).where(and(eq(sourceRecord.syncId, active.id), eq(sourceRecord.collection, "payroll_status"))).orderBy(sourceRecord.recordKey);
    const values = new Map<string, Set<string>>();
    const closureReasons: Record<string, string> = {};
    for (const row of statuses) {
      if (!isMonth(row.month) || row.period !== row.month) {
        if (isMonth(row.period)) closureReasons[row.period] = "Statut de clôture incohérent avec le mois source.";
        if (isMonth(row.month)) closureReasons[row.month] = "Statut de clôture incohérent avec le mois source.";
        continue;
      }
      const set = values.get(row.month) ?? new Set<string>();
      set.add(row.status ?? "missing"); values.set(row.month, set);
    }
    const closedMonths: string[] = [];
    for (const month of ctx.input!.months) {
      const statuses = values.get(month);
      if (closureReasons[month]) continue;
      if (!statuses?.size) closureReasons[month] = "Statut de clôture absent : aucun completed explicite pour ce mois.";
      else if (statuses.size !== 1) closureReasons[month] = "Statuts de clôture contradictoires pour ce mois.";
      else if (statuses.has("completed")) {
        if (monthBounds(month).end <= readDate) closedMonths.push(month);
        else closureReasons[month] = "Mois non terminé à la date de lecture PayFit (calendrier de Paris).";
      }
      else closureReasons[month] = statuses.has("not_completed") ? "Paie non clôturée à la lecture." : "Statut de clôture non interprété.";
    }
    return { ...base, read: { syncId: active.id, readAt: date.toISOString(), closedMonths: [...new Set(closedMonths)].sort(), closureReasons } };
  }, { isolationLevel: "repeatable read", accessMode: "read only" }).catch(() => ({ ...base, unavailable: "Lecture des statuts de clôture PayFit indisponible." }));
}
