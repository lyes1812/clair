import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { sourceRecord, sourceSync, workspaceEvent, workspaceSetting } from '@/db/schema';
import { withWorkspace, type WorkspaceTransaction } from '@/db/workspace-scope';
import { activeSync, configuredPayfitClient, getConnection } from '@/lib/connectors/sync';
import { ProviderError } from '@/lib/connectors/http';
import { isMonth, monthRange } from '@/lib/connectors/months';
import { parseRcPayslipScan, type RcPayslipScan } from './rc-payslips';
import { readRcCollaborator } from './rc-payslips-reader';

const RUN = 'rh.payroll.rcPayslips.run';
const SNAPSHOT = 'rh.payroll.rcPayslips.snapshot';
const JOB = 'rh.payroll.rcPayslips.job';
const LEASE_MS = 120_000;
const MAX_RECORDS = 2000;
const safeId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const jobSchema = z.object({
  scanId: z.string().uuid(), actorUserId: z.string().min(1).max(128), credentialVersion: z.string(),
  collaborators: z.array(safeId).max(1000), cursor: z.number().int().nonnegative().max(1000),
  worker: z.string().uuid().nullable(), leaseUntil: z.number().int().nonnegative(),
}).strict();
type Job = z.infer<typeof jobSchema>;
export class RcPayslipError extends Error {}

async function setting(tx: WorkspaceTransaction, key: string) {
  return (await tx.select({ value: workspaceSetting.value }).from(workspaceSetting).where(eq(workspaceSetting.key, key)).limit(1))[0]?.value;
}
async function put(tx: WorkspaceTransaction, workspaceId: string, actorUserId: string, key: string, value: unknown) {
  await tx.insert(workspaceSetting).values({ workspaceId, key, value, updatedBy: actorUserId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [workspaceSetting.workspaceId, workspaceSetting.key], set: { value, updatedBy: actorUserId, updatedAt: new Date() } });
}
async function lock(tx: WorkspaceTransaction, workspaceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`rc-payslips:${workspaceId}`}, 0))`);
}

export async function getRcPayslipScan(workspaceId: string): Promise<RcPayslipScan | null> {
  return withWorkspace(workspaceId, async tx => {
    const current = await setting(tx, RUN);
    // Un état récent illisible ne doit pas être masqué par un ancien résultat complet.
    return current === undefined ? parseRcPayslipScan(await setting(tx, SNAPSHOT)) : parseRcPayslipScan(current);
  });
}

const versionOf = (connection: Awaited<ReturnType<typeof getConnection>>) => connection?.updatedAt?.toISOString() ?? '';
const monthNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(new Date());

/** Une lecture auxiliaire ne remplace jamais source_sync/payfit, le journal ni une déclaration manuelle. */
export async function startRcPayslipScan(workspaceId: string, actorUserId: string, from: string, to: string) {
  if (!isMonth(from) || !isMonth(to) || from > to || to > monthNow() || monthRange(from, to).length > 24) throw new RcPayslipError('Choisis une période valide de 24 mois au plus, sans mois futur.');
  const [source, connection] = await Promise.all([activeSync(workspaceId, 'payfit'), getConnection(workspaceId, 'payfit')]);
  if (!source || !connection?.externalCompanyId) throw new RcPayslipError('Applique une lecture PayFit avant de lire les bulletins.');
  const configured = await configuredPayfitClient(workspaceId);
  const identity = await configured.client.introspect();
  if (identity.companyId !== configured.companyId || identity.companyId !== connection.externalCompanyId) throw new RcPayslipError('La société de la connexion PayFit a changé ; reconnecte la source.');
  const sourceCompany = (source.summary as { company?: { id?: string } }).company?.id;
  if (sourceCompany !== identity.companyId) throw new RcPayslipError('La société de la lecture de paie diffère de la connexion PayFit.');
  if (!identity.scopes.includes('contracts:payslips:read')) throw new RcPayslipError('Le droit PayFit contracts:payslips:read est nécessaire pour lire les bulletins.');
  const scan: RcPayslipScan = { version: 1, id: randomUUID(), payrollSyncId: source.id, companyId: identity.companyId, from, to, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, closedMonths: [], unavailableMonths: [], totalCollaborators: 0, completedCollaborators: 0, checkedPayslips: 0, records: [], issues: [] };
  const job: Job = { scanId: scan.id, actorUserId, credentialVersion: versionOf(connection), collaborators: [], cursor: 0, worker: null, leaseUntil: 0 };
  await withWorkspace(workspaceId, async tx => {
    await lock(tx, workspaceId);
    const previous = parseRcPayslipScan(await setting(tx, RUN));
    if (previous?.status === 'running' && previous.payrollSyncId === scan.payrollSyncId) throw new RcPayslipError('Une lecture des bulletins est déjà en cours ; utilise Reprendre si elle a été interrompue.');
    await put(tx, workspaceId, actorUserId, RUN, scan);
    await put(tx, workspaceId, actorUserId, JOB, job);
    await tx.insert(workspaceEvent).values({ workspaceId, actorUserId, kind: 'setting.changed', detail: { key: 'rh.payroll.rcPayslips', operation: 'started' } });
  });
  // Le bail reste reprenable si la base est momentanément indisponible avant son acquisition.
  void runRcPayslipScan(workspaceId, scan.id).catch(() => {});
  return scan.id;
}

export async function resumeRcPayslipScan(workspaceId: string) {
  const scan = await getRcPayslipScan(workspaceId);
  if (!scan || scan.status !== 'running') throw new RcPayslipError('Aucune lecture interrompue à reprendre.');
  void runRcPayslipScan(workspaceId, scan.id).catch(() => {});
}

const addIssue = (scan: RcPayslipScan, code: string) => {
  const found = scan.issues.find(issue => issue.code === code);
  if (found) found.count++; else scan.issues.push({ code, count: 1 });
};

async function acquire(workspaceId: string, scanId: string, worker: string) {
  return withWorkspace(workspaceId, async tx => {
    await lock(tx, workspaceId);
    const scan = parseRcPayslipScan(await setting(tx, RUN));
    const job = jobSchema.safeParse(await setting(tx, JOB));
    if (!scan || scan.id !== scanId || scan.status !== 'running' || !job.success || job.data.scanId !== scanId || job.data.leaseUntil > Date.now()) return null;
    job.data.worker = worker; job.data.leaseUntil = Date.now() + LEASE_MS;
    await put(tx, workspaceId, job.data.actorUserId, JOB, job.data);
    return { scan, job: job.data };
  });
}

async function checkpoint(workspaceId: string, scan: RcPayslipScan, job: Job) {
  if (!parseRcPayslipScan(scan)) throw new RcPayslipError('Résultat de lecture invalide ; aucune indemnité appliquée.');
  await withWorkspace(workspaceId, async tx => {
    await lock(tx, workspaceId);
    const currentJob = jobSchema.safeParse(await setting(tx, JOB));
    if (!currentJob.success || currentJob.data.scanId !== scan.id || currentJob.data.worker !== job.worker) throw new RcPayslipError('Lecture reprise par un autre traitement.');
    job.leaseUntil = Date.now() + LEASE_MS;
    await put(tx, workspaceId, job.actorUserId, RUN, scan);
    await put(tx, workspaceId, job.actorUserId, JOB, job);
    if (scan.status === 'complete') await put(tx, workspaceId, job.actorUserId, SNAPSHOT, scan);
  });
}

async function heartbeat(workspaceId: string, job: Job) {
  await withWorkspace(workspaceId, async tx => {
    await lock(tx, workspaceId);
    const current = jobSchema.safeParse(await setting(tx, JOB));
    if (!current.success || current.data.scanId !== job.scanId || current.data.worker !== job.worker) throw new RcPayslipError('Lecture reprise par un autre traitement.');
    job.leaseUntil = Date.now() + LEASE_MS;
    await put(tx, workspaceId, job.actorUserId, JOB, job);
  });
}

/** Curseur et bail persistés par collaborateur : une relance reprend le même scan sans ajouter de doublons. */
export async function runRcPayslipScan(workspaceId: string, scanId: string) {
  const lease = await acquire(workspaceId, scanId, randomUUID());
  if (!lease) return;
  const { scan, job } = lease;
  try {
    const [source, connection] = await Promise.all([activeSync(workspaceId, 'payfit'), getConnection(workspaceId, 'payfit')]);
    if (source?.id !== scan.payrollSyncId || versionOf(connection) !== job.credentialVersion || connection?.externalCompanyId !== scan.companyId) throw new RcPayslipError('source-changed');
    const { client, companyId } = await configuredPayfitClient(workspaceId);
    if (companyId !== scan.companyId) throw new RcPayslipError('source-changed');
    if (!job.collaborators.length && job.cursor === 0) {
      scan.closedMonths = []; scan.unavailableMonths = [];
      for (const month of monthRange(scan.from, scan.to)) {
        try {
          const value = await client.get(`/companies/${scan.companyId}/payroll-status?date=${month.replace('-', '')}`) as { status?: unknown };
          if (value?.status === 'completed') scan.closedMonths.push(month);
          else if (value?.status !== 'not_completed') scan.unavailableMonths.push(month);
        } catch (error) {
          if (error instanceof ProviderError && ['key_rejected', 'scope_denied', 'rate_limited'].includes(error.code)) throw error;
          scan.unavailableMonths.push(month);
        }
        await checkpoint(workspaceId, scan, job);
      }
      const known = await withWorkspace(workspaceId, tx => tx.select({ collaboratorId: sql<string>`case when ${sourceRecord.collection} = 'collaborators' then ${sourceRecord.data}->>'id' else ${sourceRecord.data}->>'collaboratorId' end` })
        .from(sourceRecord).innerJoin(sourceSync, eq(sourceRecord.syncId, sourceSync.id))
        .where(and(eq(sourceSync.provider, 'payfit'), inArray(sourceSync.status, ['applied', 'superseded']), sql`${sourceSync.summary}->'company'->>'id' = ${scan.companyId}`, inArray(sourceRecord.collection, ['collaborators', 'contracts']))));
      const ids = new Set(known.map(row => row.collaboratorId).filter(id => safeId.safeParse(id).success));
      try {
        const current = await client.paginate(scan.companyId, 'collaborators', 'collaborators', item => {
          const id = safeId.safeParse(item.id); if (!id.success) throw new ProviderError('invalid_response', 'identifiant collaborateur'); return id.data;
        });
        for (const item of current) if (safeId.safeParse(item.id).success) ids.add(item.id as string);
      } catch (error) {
        if (error instanceof ProviderError && ['key_rejected', 'scope_denied', 'rate_limited'].includes(error.code)) throw error;
        addIssue(scan, 'collaborators-unavailable');
      }
      if (!ids.size || ids.size > 1000 || !scan.closedMonths.length) throw new RcPayslipError('scope-unavailable');
      job.collaborators = [...ids].sort(); scan.totalCollaborators = ids.size;
      await checkpoint(workspaceId, scan, job);
    }
    for (; job.cursor < job.collaborators.length;) {
      try {
        const result = await readRcCollaborator(client, scan.companyId, job.collaborators[job.cursor], scan.closedMonths, undefined, () => heartbeat(workspaceId, job));
        if (scan.records.length + result.records.length > MAX_RECORDS) throw new RcPayslipError('document-limit');
        const candidate = parseRcPayslipScan({ ...scan, records: [...scan.records, ...result.records], checkedPayslips: scan.checkedPayslips + result.checkedPayslips });
        if (!candidate) { addIssue(scan, 'invalid-extraction'); }
        else { scan.records = candidate.records; scan.checkedPayslips = candidate.checkedPayslips; }
      } catch (error) {
        if (error instanceof RcPayslipError || error instanceof ProviderError && ['key_rejected', 'scope_denied', 'rate_limited'].includes(error.code)) throw error;
        addIssue(scan, error instanceof ProviderError ? `payslip-list-${error.code}` : 'payslip-list-unavailable');
      }
      job.cursor++; scan.completedCollaborators = job.cursor;
      await checkpoint(workspaceId, scan, job);
    }
    const [latest, credential] = await Promise.all([activeSync(workspaceId, 'payfit'), getConnection(workspaceId, 'payfit')]);
    if (latest?.id !== scan.payrollSyncId || versionOf(credential) !== job.credentialVersion) throw new RcPayslipError('source-changed');
    const previous = await withWorkspace(workspaceId, async tx => parseRcPayslipScan(await setting(tx, SNAPSHOT)));
    if (previous?.companyId === scan.companyId) {
      const identity = (row: RcPayslipScan['records'][number]) => JSON.stringify([row.collaboratorId, row.contractId, row.month, row.payslipId]);
      const hashes = new Map(previous.records.filter(row => row.pdfHash).map(row => [identity(row), row.pdfHash]));
      scan.records = scan.records.map(row => hashes.has(identity(row)) && row.pdfHash && hashes.get(identity(row)) !== row.pdfHash
        ? { ...row, status: 'review', code: 'pdf-content-changed', indemnityCents: null, components: [] } : row);
    }
    scan.status = scan.unavailableMonths.length || scan.issues.length || scan.records.some(row => row.status === 'review') ? 'partial' : 'complete';
    scan.finishedAt = new Date().toISOString();
    await checkpoint(workspaceId, scan, job);
    await withWorkspace(workspaceId, tx => tx.insert(workspaceEvent).values({ workspaceId, actorUserId: job.actorUserId, kind: 'setting.changed', detail: { key: 'rh.payroll.rcPayslips', operation: 'finished', status: scan.status, count: scan.records.filter(row => row.status === 'identified').length } }));
  } catch (error) {
    scan.status = 'failed'; scan.finishedAt = new Date().toISOString();
    addIssue(scan, error instanceof ProviderError ? error.code : error instanceof RcPayslipError && ['source-changed', 'scope-unavailable', 'document-limit'].includes(error.message) ? error.message : 'read-failed');
    // Ne jamais journaliser le texte PDF, la réponse fournisseur ou le message d’une bibliothèque PDF.
    await checkpoint(workspaceId, scan, job).catch(() => {});
  }
}
