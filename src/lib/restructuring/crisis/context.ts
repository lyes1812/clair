import { isIsoDate, todayParis } from "@/lib/dates";
import { freshnessCheck } from "@/lib/fec/controls";
import { fecCoverage } from "@/lib/fec/import";
import { hasAtLeast } from "@/lib/roles";
import { getSetting } from "@/lib/settings";
import { requireWorkspace } from "@/lib/workspace";
import { buildCrisisPosition, type CrisisPosition, type RankSettings } from "./model";
import { CRISIS_RANKS_KEY, parseRanks } from "./ranks";
import { readBankLedger } from "@/lib/bank/store";
import { readAgedBalance } from "@/lib/aged/store";
import { buildClaims, CLAIMS_KEY, parseClaimOverrides, type BankDebit, type ClaimFecLine, type ClaimsView } from "./claims";
import { readCrisisLines, readSupplierLines } from "./store";

export type CrisisQuery = Record<string, string | undefined>;
export type CrisisExercise = { filename: string; firstDate: string; lastDate: string };

// Cap 13 lit les exercices FEC appliqués dans Données. La lecture Pennylane par API n'est pas utilisée ici :
// ses à-nouveaux ne sont pas garantis, donc un solde de bilan n'y serait pas exact.
export async function loadCrisisContext(slug: string, query: CrisisQuery) {
  const { workspace } = await requireWorkspace(slug);
  const { source, ...context } = await readCrisis(workspace, slug, query);
  return { ...context, ...(await readClaims(workspace.id, source, context)) };
}

/**
 * Lot L3 : passif par créance. La balance âgée n'est utilisée que si elle est arrêtée à la date d'arrêté affichée ;
 * sinon les créances viennent du seul FEC et l'écran propose la date de la balance.
 */
async function readClaims(workspaceId: string, source: { syncId: string; filename: string } | null, crisis: Pick<Awaited<ReturnType<typeof readCrisis>>, "asOf" | "position" | "ranks" | "exercise">) {
  const empty = { claims: { kind: "nd", reason: "Position non disponible." } as ClaimsView, aged: null as AgedInfo | null, claimNotices: [] as string[], claimsUnreadable: false };
  if (!source || !crisis.asOf || crisis.position.kind === "nd") return empty;
  const asOf = crisis.asOf;
  const [aged, stored, supplierLines, bank] = await Promise.all([
    readAgedBalance(workspaceId),
    getSetting(workspaceId, CLAIMS_KEY, (value) => ({ parsed: parseClaimOverrides(value) })),
    readSupplierLines(workspaceId, source.syncId, source.filename, asOf),
    readBankLedger(workspaceId),
  ]);
  const claimNotices: string[] = [];
  const claimsUnreadable = stored !== null && stored.parsed === null;
  if (claimsUnreadable) claimNotices.push("Saisies par créance enregistrées illisibles : aucune n’est appliquée et aucune ne peut être enregistrée. Contacte l’administrateur de l’espace.");
  const usable = aged !== null && aged.asOf === asOf;
  const inExercise = aged !== null && crisis.exercise !== null && aged.asOf >= crisis.exercise.firstDate && aged.asOf <= crisis.exercise.lastDate;
  const info: AgedInfo | null = aged ? { asOf: aged.asOf, filename: aged.filename, count: aged.invoices.length, used: usable, dateInExercise: inExercise } : null;
  const bankDebits: BankDebit[] = bank.flatMap((account) => account.movements.filter((m) => m.amountCents < 0)
    .map((m) => ({ date: m.bookingDate, amountCents: m.amountCents, label: m.label, counterparty: m.counterparty, reference: m.reference })));
  const lines: ClaimFecLine[] = supplierLines.map((l) => ({ accountId: l.accountId, auxiliary: l.auxiliary, auxiliaryLabel: l.auxiliaryLabel, date: l.date, pieceRef: l.pieceRef, label: l.label ?? null, debitCents: l.debitCents, creditCents: l.creditCents }));
  const claims = buildClaims({ asOf, position: crisis.position, invoices: usable ? aged.invoices : null, supplierLines: lines, bankDebits, ranks: crisis.ranks, overrides: claimsUnreadable ? {} : stored?.parsed ?? {} });
  return { claims, aged: info, claimNotices, claimsUnreadable };
}
export type AgedInfo = { asOf: string; filename: string; count: number; used: boolean; dateInExercise: boolean };

type Workspace = { id: string; name: string; role: Parameters<typeof hasAtLeast>[0] };
/** Lecture du lot 1 pour un espace déjà vérifié ; `source` désigne la lecture FEC utilisée (jamais renvoyée à l'écran). */
export async function readCrisis(workspace: Workspace, slug: string, query: CrisisQuery) {
  const applied = (await fecCoverage(workspace.id)).filter((exercise) => !exercise.pending);
  const exercises: (CrisisExercise & { syncId: string })[] = applied
    .map((e) => ({ filename: e.filename, firstDate: e.firstDate, lastDate: e.lastDate, syncId: e.syncId }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  const base = {
    slug, workspaceName: workspace.name, canEdit: hasAtLeast(workspace.role, "editor"),
    exercises: exercises.map(({ filename, firstDate, lastDate }) => ({ filename, firstDate, lastDate })),
    reference: query.reference, projet: query.projet,
  };
  const notices: string[] = [];
  if (!exercises.length) {
    const position: CrisisPosition = { kind: "nd", reason: "Aucun FEC appliqué dans Données. Dépose le FEC de l’exercice en cours pour lire la trésorerie et les dettes." };
    return { ...base, exercise: null as CrisisExercise | null, asOf: null as string | null, ranks: null as RankSettings | null, ranksUnreadable: false, position, notices, fecAlerts: [] as string[], source: null as { syncId: string; filename: string } | null };
  }
  // L'exercice affiché par défaut est le plus récent ; il est toujours nommé à l'écran.
  let exercise = exercises[0];
  if (query.exercice) {
    const chosen = exercises.find((e) => e.filename === query.exercice);
    if (chosen) exercise = chosen;
    else notices.push("Exercice demandé indisponible dans cet espace : le plus récent est affiché.");
  }
  let asOf = exercise.lastDate;
  if (query.date) {
    if (isIsoDate(query.date) && query.date >= exercise.firstDate && query.date <= exercise.lastDate) asOf = query.date;
    else notices.push("Date d’arrêté hors de l’exercice lu : la dernière date d’écriture est affichée.");
  }
  const [lines, storedRanks] = await Promise.all([
    readCrisisLines(workspace.id, exercise.syncId, exercise.filename, asOf),
    getSetting(workspace.id, CRISIS_RANKS_KEY, (value) => ({ parsed: parseRanks(value) })),
  ]);
  const ranksUnreadable = storedRanks !== null && storedRanks.parsed === null;
  if (ranksUnreadable) notices.push("Rangs enregistrés illisibles : aucun rang n’est appliqué tant qu’ils ne sont pas ressaisis.");
  const ranks = storedRanks?.parsed ?? null;
  // F06 (avertissement fort) : fraîcheur du FEC lu, mesurée à la date du jour.
  const freshness = freshnessCheck(exercise.lastDate, todayParis());
  const fecAlerts = freshness.status === "fail" ? [`F06 · ${freshness.detail}`] : [];
  return {
    ...base, exercise: { filename: exercise.filename, firstDate: exercise.firstDate, lastDate: exercise.lastDate } as CrisisExercise | null, asOf: asOf as string | null,
    ranks, ranksUnreadable, position: buildCrisisPosition(lines, asOf, ranks), notices, fecAlerts,
    source: { syncId: exercise.syncId, filename: exercise.filename } as { syncId: string; filename: string } | null,
  };
}
export type CrisisContext = Awaited<ReturnType<typeof loadCrisisContext>>;
