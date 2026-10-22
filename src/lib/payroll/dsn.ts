import { and, eq, inArray, sql } from "drizzle-orm";
import { sourceRecord } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { dsnCoverage } from "@/lib/dsn/import";

// Contrôle par la DSN : rémunérations S21.G00.51 des déclarations qui font foi (sélection du module Données), par mois,
// tous établissements. Type 001 = rémunération brute non plafonnée ; les autres types sont gardés séparément, jamais
// additionnés entre eux. Un mois dont un établissement est bloqué ou incomplet est signalé.
export type DsnMonth = { month: string; status: "complete" | "incomplete" | "blocked"; sirets: string[]; byType: Record<string, number>; messages: string[] };

export async function dsnRemunerationsByMonth(workspaceId: string): Promise<Map<string, DsnMonth>> {
  const coverage = await dsnCoverage(workspaceId);
  const out = new Map<string, DsnMonth>();
  for (const r of coverage) {
    const m = out.get(r.month) ?? { month: r.month, status: "complete" as DsnMonth["status"], sirets: [], byType: {}, messages: [] };
    m.sirets.push(r.siret);
    if (r.status === "blocked" || (r.status === "incomplete" && m.status === "complete")) m.status = r.status;
    m.messages.push(...r.messages.map((x) => `SIRET ${r.siret} : ${x}`));
    out.set(r.month, m);
  }
  const selected = coverage.flatMap((r) => (r.status === "blocked" ? [] : r.selected.map((d) => ({ syncId: d.sourceId, key: d.key }))));
  if (!selected.length) return out;
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ period: sourceRecord.period, type: sql<string | null>`${sourceRecord.data}->>'type'`, cents: sql<string>`sum((${sourceRecord.data}->>'amountCents')::bigint)` })
      .from(sourceRecord)
      .where(
        and(
          inArray(sourceRecord.syncId, [...new Set(selected.map((s) => s.syncId))]),
          eq(sourceRecord.collection, "remunerations"),
          inArray(sql`${sourceRecord.data}->>'declarationKey'`, [...new Set(selected.map((s) => s.key))]),
        ),
      )
      .groupBy(sourceRecord.period, sql`${sourceRecord.data}->>'type'`),
  );
  for (const r of rows) {
    if (!r.period) continue;
    const m = out.get(r.period);
    if (!m) continue;
    m.byType[r.type ?? "n.d."] = (m.byType[r.type ?? "n.d."] ?? 0) + Number(r.cents);
  }
  return out;
}

// Brut déclaré (type 001) d'une période : n.d. si un mois n'a pas de déclaration retenue, est bloqué ou n'a pas de
// rémunération de type 001 ; un mois incomplet (établissement manquant) est compté et signalé.
export type DsnWindow =
  | { kind: "value"; brutCents: number; incompleteMonths: string[] }
  | { kind: "nd"; reason: string; months: string[] };
export function dsnBrutWindow(byMonth: Map<string, DsnMonth>, months: string[]): DsnWindow {
  const missing: string[] = [];
  const reasons: string[] = [];
  let sum = 0;
  for (const m of months) {
    const d = byMonth.get(m);
    if (!d) { missing.push(m); reasons.push(`${m} : aucune DSN retenue`); continue; }
    if (d.status === "blocked") { missing.push(m); reasons.push(`${m} : déclaration bloquée`); continue; }
    const b = d.byType["001"];
    if (b === undefined) { missing.push(m); reasons.push(`${m} : aucune rémunération de type 001`); continue; }
    sum += b;
  }
  if (missing.length) return { kind: "nd", reason: reasons.join(" ; "), months: missing };
  return { kind: "value", brutCents: sum, incompleteMonths: months.filter((m) => byMonth.get(m)?.status === "incomplete") };
}
