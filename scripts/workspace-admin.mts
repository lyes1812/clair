// Administration ponctuelle d'un espace, à lancer en conteneur ponctuel (aucun serveur web, aucune session) :
//   scalingo --app clair-test run "npx tsx scripts/workspace-admin.mts <commande> <slug-espace> [options]"
// Commandes : absence-types, kpi-settings, pennylane-sync, probe (voir USAGE dans src/lib/admin/workspace-ops.ts).
// N'affiche jamais une clé, un identifiant de société, un nom, un montant ni un effectif. L'acteur des écritures est un
// administrateur de l'espace. Code de sortie : 0 réussi, 1 échec ou refus, 2 arguments invalides.
import { and, desc, eq, sql } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { member, organization, sourceRecord, workspaceEvent } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import {
  absenceTypeRows,
  buildContractServiceMap,
  parseArgs,
  planKpiSettings,
  probeKpis,
  probeServiceEtp,
  renderAbsenceTypes,
  renderPlan,
  renderProbe,
  resolveOldValue,
  syncCounterLines,
  USAGE,
  type OldValue,
  type ParsedArgs,
  type SettingOrigin,
} from "@/lib/admin/workspace-ops";
import { getCategoryNatures, getContractCategories } from "@/lib/budget/categories";
import { ProviderError } from "@/lib/connectors/http";
import { activeSync, applySync, getConnection, getSync, listSyncs, startSync, SYNC_STATUS_LABELS, SyncError, type SyncStatus, type SyncSummary } from "@/lib/connectors/sync";
import type { CollectionOutcome } from "@/lib/connectors/types";
import { formatDate } from "@/lib/dates";
import { axisOf, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import { getPayrollGrid, getServiceAxis } from "@/lib/payroll-settings";
import { getKpiSettings, KPI_KEYS, KPI_PARSERS, setKpiSettings, type KpiSettingValues } from "@/lib/rh-kpi-settings";
import { getHeadcountNatures, getPayfitHistoryMode } from "@/lib/rh-settings";
import { rawPayfitHistory } from "@/lib/rh/raw-history";
import { ensureRhBuild, loadAbsencesOfSync, loadAbsenceTypes, loadPayrollOpenMonths, loadRhBuild, type RhBuildRow } from "@/lib/rh/referential/store";
import { nd, type RhBuildData } from "@/lib/rh/referential/types";
import type { AbsenceInput, KpiInput } from "@/lib/rh/kpi/types";
import { resolveSource } from "@/lib/sources";

class AdminError extends Error {}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`[admin] ${parsed.error}`);
  console.error(USAGE);
  process.exit(2);
}

type Workspace = { id: string; adminId: string | null };
type Args<C extends Extract<ParsedArgs, { ok: true }>["command"]> = Extract<ParsedArgs, { ok: true; command: C }>;

const log = (line = "") => console.log(line);
const instant = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function resolveWorkspace(slug: string): Promise<Workspace> {
  const [ws] = await db.select().from(organization).where(eq(organization.slug, slug));
  if (!ws) throw new AdminError("Espace introuvable.");
  const [admin] = await db.select().from(member).where(and(eq(member.organizationId, ws.id), eq(member.role, "admin"))).limit(1);
  return { id: ws.id, adminId: admin?.userId ?? null };
}

function needAdmin(w: Workspace): string {
  if (!w.adminId) throw new AdminError("Aucun administrateur dans cet espace : écriture refusée.");
  return w.adminId;
}

// --- Lecture des absences active (lecture PayFit appliquée)

async function activeAbsenceRead(wsId: string) {
  const sync = await activeSync(wsId, "payfit");
  if (!sync) throw new AdminError("Aucune lecture PayFit appliquée : pas de lecture des absences active.");
  const outcome = ((sync.summary as SyncSummary).collections ?? []).find((c) => c.collection === "absences");
  if (!outcome) throw new AdminError("La lecture PayFit active ne contient pas la collection des absences.");
  if (outcome.status === "unavailable") throw new AdminError(`Absences non lues par la lecture PayFit active : ${outcome.reason}.`);
  return { syncId: sync.id, types: await loadAbsenceTypes(wsId, sync.id) };
}

async function rhSourceNote(wsId: string) {
  const r = await resolveSource(wsId, "rh");
  if (r.chosen !== "payfit") log(`Attention : la source RH retenue n'est pas PayFit (${r.chosen ?? "aucune"}) ; les KPI n'utilisent pas ces absences.`);
}

// --- absence-types

async function absenceTypes(w: Workspace): Promise<number> {
  const read = await activeAbsenceRead(w.id);
  const settings = await getKpiSettings(w.id);
  log("Lecture PayFit active : types d'absence présents (codes seulement).");
  await rhSourceNote(w.id);
  if (settings.origins.absenceTypes.origin === "invalid") log("Attention : le réglage des types d'absence retenus est illisible ; aucun code n'est retenu tant qu'il n'est pas réécrit.");
  const retained = settings.origins.absenceTypes.origin === "invalid" ? [] : settings.values.absenceTypes;
  for (const line of renderAbsenceTypes(absenceTypeRows(read.types, retained))) log(line);
  return 0;
}

// --- kpi-settings

async function kpiSettings(w: Workspace, a: Args<"kpi-settings">): Promise<number> {
  const actor = a.dryRun ? null : needAdmin(w);
  const settings = await getKpiSettings(w.id);
  const read = await activeAbsenceRead(w.id);
  await rhSourceNote(w.id);
  const origins = Object.fromEntries(Object.entries(settings.origins).map(([k, o]) => [k, o.origin])) as Record<string, SettingOrigin>;
  const plan = planKpiSettings({
    current: { excludedExitNatures: settings.values.excludedExitNatures, absenceTypes: settings.values.absenceTypes },
    origins,
    present: read.types.map((t) => t.type),
    absenceTypes: a.absenceTypes,
  });
  if (!plan.ok) {
    console.error(`[admin] Refus : ${plan.error}`);
    return 1;
  }
  for (const line of renderPlan(plan, (k) => KPI_KEYS[k])) log(line);
  if (a.dryRun) {
    log("Simulation (--dry-run) : aucune écriture.");
    return 0;
  }
  if (!plan.changedKeys.length) {
    log("Rien à écrire : les réglages sont déjà conformes.");
    return 0;
  }
  // Valeurs complètes : setKpiSettings n'écrit que les clés dont la valeur change, soit au plus les deux clés du plan.
  const next: KpiSettingValues = { ...settings.values, excludedExitNatures: [], absenceTypes: a.absenceTypes };
  const written = await setKpiSettings(w.id, next, actor!);
  const expected = [...plan.changedKeys].sort();
  if (JSON.stringify([...written].sort()) !== JSON.stringify(expected)) {
    console.error(`[admin] Écart entre le plan (${expected.join(", ") || "aucune clé"}) et les clés écrites (${written.join(", ") || "aucune clé"}).`);
    return 1;
  }
  const after = await getKpiSettings(w.id);
  const ok = after.invalid.length === 0 && JSON.stringify(after.values.excludedExitNatures) === "[]" && JSON.stringify(after.values.absenceTypes) === JSON.stringify([...new Set(a.absenceTypes)].sort());
  log(`Écrit : ${written.map((k) => KPI_KEYS[k]).join(", ")} (un événement d'audit par clé). Aucun autre réglage touché.`);
  if (!ok) {
    console.error("[admin] Relecture : les valeurs enregistrées ne correspondent pas au plan.");
    return 1;
  }
  log("Relecture : valeurs enregistrées conformes au plan.");
  return 0;
}

// --- pennylane-sync

const POLL_MS = 3_000;
const MAX_WAIT_MS = 14 * 60 * 1000; // en deçà du délai (15 minutes) après lequel une lecture est déclarée en échec

async function pennylaneSync(w: Workspace, a: Args<"pennylane-sync">): Promise<number> {
  const actor = needAdmin(w);
  const connection = await getConnection(w.id, "pennylane");
  if (!connection) throw new AdminError("Aucune connexion Pennylane enregistrée dans cet espace : aucune nouvelle clé n'est demandée, la source doit d'abord être connectée.");
  if (connection.status !== "verified") throw new AdminError(`Connexion Pennylane non vérifiée (statut ${connection.status}).`);
  const recent = await listSyncs(w.id, "pennylane", 20);
  if (recent.some((s) => s.status === "running")) throw new AdminError("Une synchronisation Pennylane est déjà en cours : refus.");
  const pending = recent.filter((s) => s.status === "preview").length;
  log(`Connexion Pennylane existante (statut ${connection.status}${connection.lastVerifiedAt ? `, vérifiée le ${instant.format(connection.lastVerifiedAt)}` : ""}). Lecture en GET seulement.`);
  log(`Période : ${a.from} → ${a.to} (${a.months.length} mois).`);
  if (pending) log(`Aperçu(s) Pennylane antérieur(s) en attente : ${pending} (non touchés). Les synchronisations PayFit ne sont jamais modifiées.`);

  // startSync lance déjà la lecture (runSync, détaché) : l'appeler une seconde fois la doublerait ; on attend sa fin.
  const id = await startSync(w.id, "pennylane", a.months, actor);
  const deadline = Date.now() + MAX_WAIT_MS;
  let waited = 0;
  let row = await getSync(w.id, id);
  while (row && row.status === "running" && Date.now() < deadline) {
    await sleep(POLL_MS);
    waited += POLL_MS;
    if (waited % 30_000 === 0) log("Lecture en cours…");
    row = await getSync(w.id, id);
  }
  if (!row) throw new AdminError("Synchronisation introuvable après son lancement.");
  if (row.provider !== "pennylane") throw new AdminError("La synchronisation lancée n'est pas une synchronisation Pennylane : arrêt.");
  if (row.status === "running") throw new AdminError("Lecture toujours en cours après 14 minutes : arrêt du script ; la lecture sera déclarée en échec au-delà de 15 minutes, relancer la commande.");

  const label = SYNC_STATUS_LABELS[row.status as SyncStatus] ?? row.status;
  log(`Statut final : ${label}.`);
  if (row.status === "failed") {
    console.error(`[admin] Échec de la lecture : ${row.errorCode ?? "inconnu"} — ${row.errorMessage ?? "sans message"}`);
    return 1;
  }
  const summary = row.summary as SyncSummary;
  log("Compteurs par collection (nombres seulement) :");
  for (const line of syncCounterLines(summary.diff)) log(line);
  for (const warning of (row.warnings ?? []).slice(0, 5)) log(`Avertissement : ${String(warning).slice(0, 200)}`);

  if (row.status === "unchanged") {
    log("Aucun changement par rapport à la lecture appliquée : rien à appliquer.");
    return 0;
  }
  if (row.status !== "preview") return 0;
  if (!a.apply) {
    log("Aperçu laissé en attente (sans --apply) : à appliquer depuis Données, ou en relançant avec --apply.");
    return 0;
  }
  // Seul l'aperçu Pennylane lancé ci-dessus est appliqué : applySync ne remplace que la lecture appliquée de son propre fournisseur.
  await applySync(w.id, id, actor);
  const after = await getSync(w.id, id);
  log(`Aperçu appliqué. Statut : ${SYNC_STATUS_LABELS[(after?.status ?? "") as SyncStatus] ?? after?.status ?? "inconnu"}.`);
  return after?.status === "applied" ? 0 : 1;
}

// --- probe

// Entrée des calculs KPI, construite comme l'écran KPI RH (loadCollabContext puis loadKpiContext) sans session de requête.
async function loadKpiInput(w: Workspace): Promise<{ input: KpiInput; source: string } | { refusal: string }> {
  const source = await resolveSource(w.id, "rh");
  const natures = await getHeadcountNatures(w.id);
  const chosen = source.chosen === "payfit" || source.chosen === "dsn" ? source.chosen : null;
  if (!chosen) return { refusal: "aucune source RH retenue" };
  const state = await ensureRhBuild(w.id, chosen, w.adminId);
  if (state.kind !== "ready") return { refusal: `référentiel Collaborateurs indisponible (${state.kind})` };
  const stored = await loadRhBuild(w.id, state.build.id);
  let data: RhBuildData & { build: RhBuildRow } = stored;
  if (stored.build.source === "payfit" && (await getPayfitHistoryMode(w.id)).mode === "raw") data = rawPayfitHistory(stored);
  const settings = await getKpiSettings(w.id);
  if (settings.invalid.length) return { refusal: `réglages KPI illisibles (${settings.invalid.map((k) => KPI_KEYS[k]).join(", ")}) : calcul refusé, comme sur l'écran` };
  let absences: AbsenceInput;
  if (data.build.inputs.source === "dsn") absences = { status: "not-extracted", nd: nd("not-extracted", "arrêts non extraits de la DSN") };
  else {
    const inputs = data.build.inputs;
    const outcome = inputs.collections.find((c) => c.collection === "absences");
    if (!outcome) absences = { status: "unavailable", nd: nd("not-provided", `collection absences absente de la lecture du ${formatDate(data.build.referenceDate)}`) };
    else if (outcome.status === "unavailable") absences = { status: "unavailable", nd: nd("scope-missing", outcome.reason) };
    else absences = { status: "read", syncId: inputs.syncId, rows: await loadAbsencesOfSync(w.id, inputs.syncId), months: inputs.scopeMonths };
  }
  const openMonths = data.build.inputs.source === "payfit" ? await loadPayrollOpenMonths(w.id, data.build.inputs.syncId) : [];
  return { input: { data, absences, params: { ...settings.values, natures: natures.codes }, scope: {}, openMonths }, source: chosen };
}

const safeInt = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

// Journal de paie et table « service d'un contrat par mois », comme loadPayrollContext (src/lib/payroll/context.ts).
async function loadJournal(w: Workspace, kpi: KpiInput): Promise<{ journal: JournalInput | null; contractService: Map<string, string | null> | null }> {
  const none = { journal: null, contractService: null };
  if (kpi.data.build.source !== "payfit") return none;
  const sync = await activeSync(w.id, "payfit");
  if (!sync) return none;
  const outcome = ((sync.summary as { collections?: CollectionOutcome[] }).collections ?? []).find((c) => c.collection === "ledger_lines");
  if (!outcome || outcome.status === "unavailable") return none;
  const rows = await withWorkspace(w.id, (tx) =>
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
      debitCents: safeInt(d.debitCents),
      creditCents: safeInt(d.creditCents),
      contractId: typeof d.contractId === "string" ? d.contractId : null,
      analytic: Array.isArray(d.analyticCodes) ? (d.analyticCodes as LedgerLine["analytic"]) : [],
    };
  });
  const grid = await getPayrollGrid(w.id);
  const axes = [...new Set(lines.flatMap((l) => (l.analytic ?? []).map(axisOf)))].sort();
  const service = await getServiceAxis(w.id, axes);
  const contractService = service.axis ? buildContractServiceMap(lines, grid.grid, service.axis) : null;
  const months = ((sync.scope as { months?: unknown }).months as string[] | undefined) ?? [];
  const openMonths = await loadPayrollOpenMonths(w.id, sync.id);
  return { journal: { lines, months, openMonths, grid: grid.grid, serviceAxis: service.axis }, contractService };
}

async function settingHistory(wsId: string, key: string): Promise<unknown[]> {
  const rows = await withWorkspace(wsId, (tx) =>
    tx
      .select({ detail: workspaceEvent.detail })
      .from(workspaceEvent)
      .where(sql`${workspaceEvent.kind} = 'setting.changed' and ${workspaceEvent.detail}->>'key' = ${key}`)
      .orderBy(desc(workspaceEvent.occurredAt))
      .limit(50),
  );
  return rows.map((r) => (r.detail as { value?: unknown }).value);
}

const OLD_SOURCE_TEXT: Record<OldValue["source"], string> = { option: "option de la commande", journal: "journal d'audit", introuvable: "introuvable dans le journal d'audit" };

async function probe(w: Workspace, a: Args<"probe">): Promise<number> {
  const loaded = await loadKpiInput(w);
  if ("refusal" in loaded) {
    console.error(`[admin] Refus : ${loaded.refusal}.`);
    return 1;
  }
  const { input } = loaded;
  log(`Source RH retenue : ${loaded.source}. Aucune valeur n'est affichée : genre (exact, lower_bound, nd) et code n.d. seulement.`);
  const [natures, overrides, { journal, contractService }] = await Promise.all([getCategoryNatures(w.id), getContractCategories(w.id), loadJournal(w, input)]);
  log(`Axe de service du journal : ${!journal ? "journal indisponible" : journal.serviceAxis ? "choisi" : "non choisi"}.`);

  const oldExcl = resolveOldValue(a.oldExclusions, await settingHistory(w.id, KPI_KEYS.excludedExitNatures), input.params.excludedExitNatures, KPI_PARSERS.excludedExitNatures);
  const oldTypes = resolveOldValue(a.oldAbsenceTypes, await settingHistory(w.id, KPI_KEYS.absenceTypes), input.params.absenceTypes, KPI_PARSERS.absenceTypes);
  log(`Anciens réglages : exclusions de sortie ${oldExcl.value ? `= ${oldExcl.value.join(", ") || "aucune"}` : "inconnues"} (${OLD_SOURCE_TEXT[oldExcl.source]}) ; types d'absence ${oldTypes.value ? `= ${oldTypes.value.join(", ") || "aucun"}` : "inconnus"} (${OLD_SOURCE_TEXT[oldTypes.source]}).`);

  const kpi = probeKpis(input, a.months, a.window, { excludedExitNatures: oldExcl.value, absenceTypes: oldTypes.value });
  const service = probeServiceEtp({ kpi: input, journal, contractService, natures: natures.natures, overrides, months: a.months });
  for (const line of renderProbe({ months: a.months, service, kpi })) log(line);
  return 0;
}

// --- Exécution

// Seuls les messages de nos propres erreurs sont affichés : une erreur de base de données peut citer ses paramètres.
const safeMessage = (e: unknown) => (e instanceof AdminError || e instanceof SyncError || e instanceof ProviderError || (e instanceof Error && e.message.startsWith("Valeur invalide pour ")) ? (e as Error).message : `erreur interne (${e instanceof Error ? e.name : "inconnue"})`);

let code = 1;
try {
  const w = await resolveWorkspace(parsed.slug);
  if (parsed.command === "absence-types") code = await absenceTypes(w);
  else if (parsed.command === "kpi-settings") code = await kpiSettings(w, parsed);
  else if (parsed.command === "pennylane-sync") code = await pennylaneSync(w, parsed);
  else code = await probe(w, parsed);
} catch (e) {
  console.error(`[admin] Échec : ${safeMessage(e)}`);
  code = 1;
} finally {
  await pool.end();
}
process.exitCode = code;
