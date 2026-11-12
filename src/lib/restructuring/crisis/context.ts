import { isIsoDate } from "@/lib/dates";
import { fecCoverage } from "@/lib/fec/import";
import { hasAtLeast } from "@/lib/roles";
import { getSetting } from "@/lib/settings";
import { requireWorkspace } from "@/lib/workspace";
import { buildCrisisPosition, type CrisisPosition, type RankSettings } from "./model";
import { CRISIS_RANKS_KEY, parseRanks } from "./ranks";
import { readCrisisLines } from "./store";

export type CrisisQuery = Record<string, string | undefined>;
export type CrisisExercise = { filename: string; firstDate: string; lastDate: string };

// Cap 13 lit les exercices FEC appliqués dans Données. La lecture Pennylane par API n'est pas utilisée ici :
// ses à-nouveaux ne sont pas garantis, donc un solde de bilan n'y serait pas exact.
export async function loadCrisisContext(slug: string, query: CrisisQuery) {
  const { workspace } = await requireWorkspace(slug);
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
    return { ...base, exercise: null as CrisisExercise | null, asOf: null as string | null, ranks: null as RankSettings | null, ranksUnreadable: false, position, notices };
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
  return {
    ...base, exercise: { filename: exercise.filename, firstDate: exercise.firstDate, lastDate: exercise.lastDate } as CrisisExercise | null, asOf: asOf as string | null,
    ranks, ranksUnreadable, position: buildCrisisPosition(lines, asOf, ranks), notices,
  };
}
export type CrisisContext = Awaited<ReturnType<typeof loadCrisisContext>>;
