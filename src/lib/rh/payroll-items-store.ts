import { and, eq, inArray, or, sql } from "drizzle-orm";
import { sourceRecord, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { isIsoDate, isMonth } from "@/lib/connectors/months";
import { dsnCoverageIn } from "@/lib/dsn/import";
import type { CollabContext } from "./view";
import { buildDsnPayrollItems, payrollItemsUnavailable, type DsnPayrollItemRecord, type PayrollItemsModel } from "./payroll-items";

// Le contexte a déjà vérifié l'accès à l'espace et chargé le référentiel RH.
// La lecture DSN reste dans une seule photographie transactionnelle, filtrée par
// couples exacts (dépôt appliqué, déclaration retenue). Aucune jointure au nom.
export async function loadDsnPayrollItems(ctx: CollabContext, month: string): Promise<PayrollItemsModel> {
  if (!isMonth(month)) return payrollItemsUnavailable("dsn", month, "Mois invalide.");
  const data = ctx.data;
  if (ctx.chosen !== "dsn" || !data || data.build.source !== "dsn" || data.build.inputs.source !== "dsn") {
    return payrollItemsUnavailable("dsn", month, "Référentiel DSN non disponible pour cette lecture.");
  }
  const inputs = data.build.inputs;
  return withWorkspace(ctx.workspace.id, async (tx) => {
    const coverage = (await dsnCoverageIn(tx)).filter((c) => c.month === month);
    // Le constructeur enrichit aussi la couverture des établissements manquants.
    // Ce garde empêche de calculer un total complet avec les seuls sites présents.
    const builtCoverage = data.coverage.filter((c) => c.month === month);
    const badBuild = builtCoverage.find((c) => c.presenceStatus !== "complete");
    if (badBuild) return payrollItemsUnavailable("dsn", month,
      "Couverture DSN incomplète ou bloquée dans le référentiel : les rémunérations partielles ne sont pas agrégées.",
      badBuild.presenceStatus === "blocked" ? "blocked" : "incomplete");
    const guard = buildDsnPayrollItems({ month, records: [], coverage, rh: null });
    if (guard.coverage.status !== "complete") return guard;
    const pairs = coverage.flatMap((c) => c.selected.map((d) => ({ syncId: d.sourceId, key: d.key })));
    const expectedPairs = inputs.coverage.filter((c) => c.month === month).flatMap((c) => c.selected.map((d) => ({ syncId: d.sourceId, key: d.key })));
    const signature = (list: { syncId: string; key: string }[]) => [...new Set(list.map((p) => `${p.syncId}\u0000${p.key}`))].sort().join("\n");
    if (signature(pairs) !== signature(expectedPairs)) return payrollItemsUnavailable("dsn", month, "La sélection DSN a changé depuis le chargement du référentiel. Recharge la page.");
    const syncIds = [...new Set(pairs.map((p) => p.syncId))];
    const syncs = await tx.select({ id: sourceSync.id, startedAt: sourceSync.startedAt }).from(sourceSync)
      .where(and(inArray(sourceSync.id, syncIds), eq(sourceSync.provider, "dsn"), eq(sourceSync.status, "applied")));
    if (syncs.length !== syncIds.length) return payrollItemsUnavailable("dsn", month, "Une déclaration retenue ne correspond plus à un dépôt DSN appliqué.");
    const records = await tx.select({
      id: sourceRecord.id,
      syncId: sourceRecord.syncId,
      declarationKey: sql<string>`${sourceRecord.data}->>'declarationKey'`,
      month: sourceRecord.period,
      personId: sql<string | null>`${sourceRecord.data}->>'personId'`,
      contractId: sql<string | null>`${sourceRecord.data}->>'contractId'`,
      type: sql<string | null>`${sourceRecord.data}->>'type'`,
      amountCents: sql<string | null>`${sourceRecord.data}->>'amountCents'`,
      paymentDate: sql<string | null>`${sourceRecord.data}->>'paymentDate'`,
      startDate: sql<string | null>`${sourceRecord.data}->>'startDate'`,
      endDate: sql<string | null>`${sourceRecord.data}->>'endDate'`,
    }).from(sourceRecord).where(and(
      eq(sourceRecord.collection, "remunerations"), eq(sourceRecord.period, month),
      or(...pairs.map((p) => and(eq(sourceRecord.syncId, p.syncId), sql`${sourceRecord.data}->>'declarationKey' = ${p.key}`))),
    )).orderBy(sourceRecord.syncId, sourceRecord.id);
    const date = (s: string | null) => isIsoDate(s) ? s : null;
    const minimal: DsnPayrollItemRecord[] = records.map((r) => ({ ...r, month: r.month!,
      paymentDate: date(r.paymentDate), startDate: date(r.startDate), endDate: date(r.endDate) }));
    const readAt = syncs.map((s) => s.startedAt.toISOString()).sort().at(-1) ?? null;
    return buildDsnPayrollItems({ month, records: minimal, coverage, rh: data, readAt });
  }, { isolationLevel: "repeatable read", accessMode: "read only" }).catch(() =>
    payrollItemsUnavailable("dsn", month, "Lecture des rémunérations DSN indisponible. Recharge la page."));
}
