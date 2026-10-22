import { and, eq, inArray, sql } from "drizzle-orm";
import { sourceRecord } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { activeSync } from "@/lib/connectors/sync";
import type { CollectionOutcome } from "@/lib/connectors/types";
import { getPayrollGrid, getServiceAxis, type PayrollGrid, type ServiceAxis } from "@/lib/payroll-settings";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { loadKpiContext, type KpiContext } from "@/lib/rh/kpi-context";
import { loadPayrollOpenMonths } from "@/lib/rh/referential/store";
import { dsnRemunerationsByMonth, type DsnMonth } from "./dsn";
import { fecCoverage, pennylaneCoverage, type ComptaLine } from "./lot2";
import type { FecSyncSummary } from "@/lib/fec/import";
import { resolveSource } from "@/lib/sources";
import { sourceSync } from "@/db/schema";
import { classify, gridRubrics } from "./grid";
import { axisOf, NO_TYPE, serviceOf, type Analytic, type EtpMonth, type JournalInput, type LedgerLine } from "./engine";

// Contexte de l'écran Masse salariale : journal de paie de la lecture PayFit appliquée, grille de comptes de l'espace,
// ETP fin de mois du module KPI RH (même référentiel que Collaborateurs et KPI RH).
export type PayrollContext = {
  kpi: KpiContext;
  source: "payfit" | "dsn" | null; // source RH retenue dans Données (API PayFit ou fichiers DSN), choix du client
  grid: PayrollGrid;
  read: { syncId: string; startedAt: Date; months: string[] } | null;
  unavailable: string | null; // journal non lu (droit refusé, collection absente) : raison affichée
  input: JournalInput | null;
  etp: (months: string[], service?: { value: string | null }) => EtpMonth[];
  axes: string[]; // types de codes analytiques présents dans le journal
  service: ServiceAxis;
  dsn: Map<string, DsnMonth>; // contrôle : rémunérations DSN des déclarations qui font foi, par mois
  etpQualifiers: string[]; // limites des ETP utilisés (quotités PayFit non historisées, historique brut)
  compta: () => Promise<ComptaSource>; // source comptable retenue (FEC ou API Pennylane), lue seulement par l'onglet qui la montre
  axisMissing: boolean; // axe enregistré dans Paramètres absent du journal courant
};

const num = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

export async function loadPayrollContext(slug: string): Promise<PayrollContext> {
  const kpi = await loadKpiContext(slug, {});
  const ws = kpi.collab.workspace.id;
  const [grid, sync, dsn] = await Promise.all([getPayrollGrid(ws), activeSync(ws, "payfit"), dsnRemunerationsByMonth(ws)]);
  let comptaOnce: Promise<ComptaSource> | null = null;
  const compta = () => (comptaOnce ??= loadCompta(ws));
  // Service d'un contrat pour un mois : celui de ses lignes de journal ce mois-là (null : non ventilé).
  let contractService: Map<string, string | null> | null = null;
  let axisForEtp: string | null = null;
  const etp = (months: string[], service?: { value: string | null }): EtpMonth[] =>
    months.map((month) => {
      if (!kpi.input) return { month, etp4: null, reason: "référentiel RH indisponible (Collaborateurs)" };
      const e = etpMonthEnd(kpi.input, month);
      if (e.kind === "exact" && service && contractService) {
        const etp4 = e.contributions.filter((c) => (contractService!.get(`${month}|${c.externalId}`) ?? null) === service.value).reduce((s, c) => s + c.etp4, 0);
        return { month, etp4, reason: null };
      }
      if (e.kind === "exact" && service && !contractService) return { month, etp4: null, reason: `ETP par service indisponible (axe ${axisForEtp ?? "non choisi"})` };
      if (e.kind === "exact") return { month, etp4: e.etp4, reason: null };
      return { month, etp4: null, reason: e.kind === "nd" ? e.nd.reason : `ETP en borne basse (${e.qualifiers.join(" ; ")})` };
    });
  const none: ServiceAxis = { axis: null, origin: "none", updatedAt: null };
  const source = kpi.collab.chosen;
  const d0 = kpi.collab.data;
  const etpQualifiers: string[] = [];
  if (d0?.build.source === "payfit") etpQualifiers.push(`quotités PayFit à la date de lecture (${d0.build.referenceDate ?? "n.d."}), non historisées`);
  const lim = kpi.collab.payfitHistory?.mode === "raw" ? kpi.collab.payfitHistory.limit : null;
  if (lim) etpQualifiers.push(`historique PayFit brut : ETP des mois ${lim.lowerFrom} → ${lim.lowerTo} sans les contrats archivés depuis plus de 12 mois`);
  const extra = { etpQualifiers, axisMissing: false, compta };
  if (source !== "payfit") return { kpi, source, grid, read: null, unavailable: source === "dsn" ? null : `aucune source RH retenue (${kpi.collab.source.reason}) : connectez PayFit ou déposez des DSN dans Données`, input: null, etp, axes: [], service: none, dsn, ...extra };
  if (!sync) return { kpi, source, grid, read: null, unavailable: "aucune lecture PayFit appliquée : connectez PayFit dans Données", input: null, etp, axes: [], service: none, dsn, ...extra };
  const months = ((sync.scope as { months?: unknown }).months as string[] | undefined) ?? [];
  const read = { syncId: sync.id, startedAt: sync.startedAt, months };
  const outcome = ((sync.summary as { collections?: CollectionOutcome[] }).collections ?? []).find((c) => c.collection === "ledger_lines");
  if (!outcome) return { kpi, source, grid, read, unavailable: "journal comptable absent de la lecture PayFit appliquée", input: null, etp, axes: [], service: none, dsn, ...extra };
  if (outcome.status === "unavailable") return { kpi, source, grid, read, unavailable: `journal comptable non lu : ${outcome.reason}`, input: null, etp, axes: [], service: none, dsn, ...extra };
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
      analytic: Array.isArray(d.analyticCodes) ? (d.analyticCodes as Analytic[]) : [],
    };
  });
  const axes = [...new Set(lines.flatMap((l) => (l.analytic ?? []).map(axisOf)))].sort();
  const service = await getServiceAxis(ws, axes);
  if (service.axis) {
    axisForEtp = service.axis;
    // Service d'un contrat pour un mois : celui de ses lignes de brut, à défaut de ses autres lignes de charges de
    // personnel ; les contreparties (42/43…) ne comptent pas. Sans ligne : non ventilé.
    contractService = new Map();
    const rank = new Map<string, number>();
    const rubrics = gridRubrics(grid.grid);
    for (const l of lines) {
      if (!l.contractId) continue;
      const c = classify(l.accountId, rubrics);
      const r = c.rubric?.role === "brut" ? 2 : c.rubric || c.payroll ? 1 : 0;
      const k = `${l.month}|${l.contractId}`;
      if (r > (rank.get(k) ?? 0)) {
        rank.set(k, r);
        contractService.set(k, serviceOf(l, service.axis));
      }
    }
  }
  const openMonths = await loadPayrollOpenMonths(ws, sync.id);
  return { kpi, source, grid, read, unavailable: null, input: { lines, months, openMonths, grid: grid.grid, serviceAxis: service.axis }, etp, axes, service, dsn, ...extra, axisMissing: Boolean(service.axis && !axes.includes(service.axis)) };
}

// Axes analytiques présents dans le journal de la lecture PayFit appliquée (Paramètres).
export async function journalAxes(workspaceId: string): Promise<string[]> {
  const sync = await activeSync(workspaceId, "payfit");
  if (!sync) return [];
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx.execute(sql`select distinct coalesce(nullif(x->>'type', ''), ${NO_TYPE}) t from source_record, jsonb_array_elements(coalesce(data->'analyticCodes', '[]'::jsonb)) x where sync_id = ${sync.id} and collection = 'ledger_lines' order by 1`),
  );
  return (rows.rows as { t: string }[]).map((r) => r.t);
}

// Comptabilité retenue (Données) : API Pennylane (dernière lecture appliquée) ou FEC (exercices appliqués). Lignes des
// classes 6 et 7 seulement (charges de personnel et produits d'exploitation), mois = mois de la date d'écriture.
// Un mois n'est « lu » que s'il est complet et compté une seule fois ; sinon il est n.d. avec sa raison (nd).
export type ComptaSource = { source: "pennylane" | "fec" | null; reason: string; lines: ComptaLine[]; months: string[]; nd: Record<string, string> };
async function loadCompta(workspaceId: string): Promise<ComptaSource> {
  try {
    return await readCompta(workspaceId);
  } catch (e) {
    return { source: null, reason: `lecture de la comptabilité en erreur (${e instanceof Error ? e.message : String(e)})`, lines: [], months: [], nd: {} };
  }
}
async function readCompta(workspaceId: string): Promise<ComptaSource> {
  const r = await resolveSource(workspaceId, "accounting");
  const source = r.chosen === "pennylane" || r.chosen === "fec" ? r.chosen : null;
  if (!source) return { source: null, reason: r.reason, lines: [], months: [], nd: {} };
  let nd: Record<string, string> = {};
  let syncIds: string[] = [];
  let covered: string[] = [];
  if (source === "pennylane") {
    const pl = await activeSync(workspaceId, "pennylane");
    if (pl) {
      syncIds = [pl.id];
      ({ months: covered, nd } = pennylaneCoverage(((pl.scope as { months?: string[] }).months ?? []) as string[], (pl.finishedAt ?? pl.startedAt).toISOString().slice(0, 10)));
    }
  } else {
    const fec = await withWorkspace(workspaceId, (tx) => tx.select({ id: sourceSync.id, summary: sourceSync.summary }).from(sourceSync).where(and(eq(sourceSync.provider, "fec"), eq(sourceSync.status, "applied"))));
    syncIds = fec.map((x) => x.id);
    ({ months: covered, nd } = fecCoverage(fec.flatMap((x) => (x.summary as FecSyncSummary).exercises ?? [])));
  }
  if (!syncIds.length) return { source, reason: r.reason, lines: [], months: [], nd };
  const rows = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ data: sourceRecord.data })
      .from(sourceRecord)
      .where(and(inArray(sourceRecord.syncId, syncIds), eq(sourceRecord.collection, "ledger_lines"), sql`${sourceRecord.data}->>'accountId' ~ '^[67]'`)),
  );
  const lines: ComptaLine[] = rows.map((x) => {
    const d = x.data as Record<string, unknown>;
    return { month: String(d.month), accountId: String(d.accountId), debitCents: num(d.debitCents), creditCents: num(d.creditCents) };
  });
  return { source, reason: r.reason, lines, months: covered, nd };
}
