import { and, eq } from "drizzle-orm";
import { sourceRecord } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { activeSync } from "@/lib/connectors/sync";
import type { CollectionOutcome } from "@/lib/connectors/types";
import { getPayrollGrid, type PayrollGrid } from "@/lib/payroll-settings";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { loadKpiContext, type KpiContext } from "@/lib/rh/kpi-context";
import { loadPayrollOpenMonths } from "@/lib/rh/referential/store";
import type { EtpMonth, JournalInput, LedgerLine } from "./engine";

// Contexte de l'écran Masse salariale : journal de paie de la lecture PayFit appliquée, grille de comptes de l'espace,
// ETP fin de mois du module KPI RH (même référentiel que Collaborateurs et KPI RH).
export type PayrollContext = {
  kpi: KpiContext;
  grid: PayrollGrid;
  read: { syncId: string; startedAt: Date; months: string[] } | null;
  unavailable: string | null; // journal non lu (droit refusé, collection absente) : raison affichée
  input: JournalInput | null;
  etp: (months: string[]) => EtpMonth[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

export async function loadPayrollContext(slug: string): Promise<PayrollContext> {
  const kpi = await loadKpiContext(slug, {});
  const ws = kpi.collab.workspace.id;
  const [grid, sync] = await Promise.all([getPayrollGrid(ws), activeSync(ws, "payfit")]);
  const etp = (months: string[]): EtpMonth[] =>
    months.map((month) => {
      if (!kpi.input) return { month, etp4: null, reason: "référentiel RH indisponible (Collaborateurs)" };
      const e = etpMonthEnd(kpi.input, month);
      if (e.kind === "exact") return { month, etp4: e.etp4, reason: null };
      return { month, etp4: null, reason: e.kind === "nd" ? e.nd.reason : `ETP en borne basse (${e.qualifiers.join(" ; ")})` };
    });
  if (!sync) return { kpi, grid, read: null, unavailable: "aucune lecture PayFit appliquée : connectez PayFit dans Données", input: null, etp };
  const months = ((sync.scope as { months?: unknown }).months as string[] | undefined) ?? [];
  const read = { syncId: sync.id, startedAt: sync.startedAt, months };
  const outcome = ((sync.summary as { collections?: CollectionOutcome[] }).collections ?? []).find((c) => c.collection === "ledger_lines");
  if (!outcome) return { kpi, grid, read, unavailable: "journal comptable absent de la lecture PayFit appliquée", input: null, etp };
  if (outcome.status === "unavailable") return { kpi, grid, read, unavailable: `journal comptable non lu : ${outcome.reason}`, input: null, etp };
  const rows = await withWorkspace(ws, (tx) =>
    tx
      .select({ key: sourceRecord.recordKey, data: sourceRecord.data })
      .from(sourceRecord)
      .where(and(eq(sourceRecord.syncId, sync.id), eq(sourceRecord.collection, "ledger_lines")))
      .orderBy(sourceRecord.recordKey),
  );
  const lines: LedgerLine[] = rows.map((r) => {
    const d = r.data as Record<string, unknown>;
    return {
      key: r.key,
      month: String(d.month),
      accountId: String(d.accountId),
      accountName: typeof d.accountName === "string" ? d.accountName : null,
      debitCents: num(d.debitCents),
      creditCents: num(d.creditCents),
      contractId: typeof d.contractId === "string" ? d.contractId : null,
    };
  });
  const openMonths = await loadPayrollOpenMonths(ws, sync.id);
  return { kpi, grid, read, unavailable: null, input: { lines, months, openMonths, grid: grid.grid }, etp };
}
