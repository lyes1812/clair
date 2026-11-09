import { monthRange, isMonth } from "@/lib/connectors/months";
import { isIsoDate, monthEnd } from "@/lib/dates";
import { project } from "@/lib/budget/engine";
import { budgetSeries, liveSeries, scenarioSeries, type Series } from "@/lib/budget/series";
import { getBudget, getScenario, KIND_LABELS, listBudgets, listScenarios } from "@/lib/budget/store";
import { loadPayrollContext, type PayrollContext } from "@/lib/payroll/context";
import { classify, gridRubrics } from "@/lib/payroll/grid";
import type { JournalInput } from "@/lib/payroll/engine";
import { publicProjectionReasons } from "@/lib/viz/croisee-budget";
import { buildSuivi, type SuiviAffichage, type SuiviModel, type SuiviReferenceOption } from "@/lib/viz/suivi-budget";
import { requireWorkspace } from "@/lib/workspace";

export type SuiviSearch = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const validYear = (v: string) => /^\d{4}$/.test(v) && Number(v) >= 1900 && Number(v) <= 2200;
const emptySeries = (label: string): Series => ({ key: "indisponible", label, points: new Map() });
const UNSAFE_SOURCE = "Montants source hors de la précision exacte en centimes : mois non publiable.";
// monthPayroll additionne en Number. Une petite valeur finale peut cacher une annulation après un dépassement
// intermédiaire : borner les valeurs absolues en BigInt, par mois et sur la même grille de comptes que le moteur.
function unsafeSourceMonths(journal: JournalInput): Set<string> {
  const MAX = BigInt(Number.MAX_SAFE_INTEGER);
  const rubrics = gridRubrics(journal.grid);
  const bounds = new Map<string, bigint>();
  const unsafe = new Set<string>();
  for (const line of journal.lines) {
    if (!journal.months.includes(line.month) || !classify(line.accountId, rubrics).rubric || unsafe.has(line.month)) continue;
    for (const value of [line.debitCents, line.creditCents]) {
      if (value === null) continue;
      if (!Number.isSafeInteger(value)) { unsafe.add(line.month); break; }
      const n = BigInt(value);
      const bound = (bounds.get(line.month) ?? 0n) + (n < 0n ? -n : n);
      bounds.set(line.month, bound);
      if (bound > MAX) { unsafe.add(line.month); break; }
    }
  }
  return unsafe;
}
const paris = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const dateOf = (d: Date | undefined): string | null => {
  if (!d || !Number.isFinite(d.getTime())) return null;
  const p = Object.fromEntries(paris.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

// La garde précède toute lecture. Les sélections et lectures restent bornées à cet espace ; aucun appel de synchronisation.
export async function loadSuivi(slug: string, sp: SuiviSearch): Promise<SuiviModel> {
  const { workspace } = await requireWorkspace(slug);
  const [payResult, scenariosResult, budgetsResult] = await Promise.allSettled([
    loadPayrollContext(slug), listScenarios(workspace.id), listBudgets(workspace.id),
  ]);
  const ctx: PayrollContext | null = payResult.status === "fulfilled" ? payResult.value : null;
  const scenarios = scenariosResult.status === "fulfilled" ? scenariosResult.value : [];
  const budgets = budgetsResult.status === "fulfilled" ? budgetsResult.value : [];
  const notices: string[] = [];
  if (scenariosResult.status === "rejected") notices.push("Liste des scénarios indisponible.");
  if (budgetsResult.status === "rejected") notices.push("Liste des budgets saisis indisponible.");
  const base = `/e/${encodeURIComponent(slug)}/studio-rh`;
  const options: SuiviReferenceOption[] = [
    ...budgets.map((b) => ({ value: `budget:${b.id}`, label: `Budget saisi « ${b.name} » (${b.year})`, kind: "budget" as const, years: [b.year], href: `${base}/hypotheses` })),
    ...scenarios.map(({ scenario: s, refMonth }) => ({
      value: `scenario:${s.id}`, label: `Scénario « ${s.name} » (${KIND_LABELS[s.kind]}, ${s.status === "fige" ? "figé" : "brouillon"})`, kind: "scenario" as const,
      years: [...new Set([refMonth.slice(0, 4), ...monthRange(s.firstMonth, s.lastMonth).map((m) => m.slice(0, 4))])].filter(validYear).sort(),
      href: `${base}/hypotheses?scenario=${encodeURIComponent(s.id)}`,
    })),
  ];
  const rawReference = one(sp.reference);
  const selected = options.find((o) => o.value === rawReference) ?? null;
  let referenceReason = rawReference ? "Référence indisponible dans cet espace : choisis un budget ou un scénario." : "Choisis un budget ou un scénario de référence.";

  const journal = ctx?.input ?? null;
  const readAt = ctx?.read?.startedAt;
  const readAtIso = readAt && Number.isFinite(readAt.getTime()) ? readAt.toISOString() : null;
  const referenceDate = ctx?.kpi.input?.data.build.referenceDate;
  // La lecture du journal peut être plus récente que celle du référentiel RH : sa propre date fait foi pour le calendrier.
  const sourceDate = dateOf(readAt) ?? (isIsoDate(referenceDate) ? referenceDate : null);
  const actualReason = !ctx ? "Lecture du réel indisponible." : !journal ? ctx.unavailable ?? (ctx.source === "dsn" ? "Source RH retenue : DSN — journal de paie PayFit non lu." : "Journal de paie indisponible.") : !sourceDate ? "Date de référence de la lecture indisponible : clôture non vérifiable." : "Choisis une clôture valide pour le suivi.";
  const unsafeMonths = journal ? unsafeSourceMonths(journal) : new Set<string>();
  const actual = journal ? liveSeries("reel", "Réel courant", journal, ctx?.kpi.input ?? null) : emptySeries("Réel courant");
  // liveSeries exclut les paies ouvertes. La date conservée avec la lecture exclut aussi un mois calendaire encore en cours.
  for (const [m, p] of actual.points) {
    if (unsafeMonths.has(m)) actual.points.set(m, { month: m, kind: "nd", reason: UNSAFE_SOURCE });
    else if (sourceDate && monthEnd(m) > sourceDate) actual.points.set(m, { month: m, kind: "nd", reason: "mois non clos à la date de référence de la lecture" });
    else if (p.kind === "nd") actual.points.set(m, { ...p, reason: p.reason.startsWith("ligne ") && p.reason.endsWith("sans montant (ni débit ni crédit)") ? "Une ligne comptable n'a aucun montant (ni débit ni crédit)." : p.reason });
  }
  const allClosed = [...actual.points].filter(([, p]) => sourceDate !== null && p.kind === "value").map(([m]) => m).sort();
  const years = [...new Set([...(journal?.months ?? []).filter(isMonth).map((m) => m.slice(0, 4)), ...options.flatMap((o) => o.years)])].filter(validYear).sort();
  const rawYear = one(sp.annee);
  const year = rawYear ? validYear(rawYear) && years.includes(rawYear) ? rawYear : "" : allClosed.at(-1)?.slice(0, 4) ?? years.at(-1) ?? "";
  if (rawYear && !year) notices.push("Année indisponible : choisis une année proposée.");
  const cutoffOptions = allClosed.filter((m) => m.startsWith(`${year}-`));
  const rawCutoff = one(sp.cloture);
  const cutoff = rawCutoff ? cutoffOptions.includes(rawCutoff) ? rawCutoff : null : cutoffOptions.at(-1) ?? null;
  if (rawCutoff && !cutoff) notices.push("Clôture indisponible ou non close à la lecture : choisis un mois clos proposé.");
  const rawAffichage = one(sp.affichage);
  const affichage: SuiviAffichage = rawAffichage === "graphique" || rawAffichage === "tableau" ? rawAffichage : "tout";
  if (rawAffichage && !["tout", "graphique", "tableau"].includes(rawAffichage)) notices.push("Affichage inconnu : tous les éléments sont affichés.");

  let planned: Series | null = null;
  if (selected && !selected.years.includes(year)) {
    referenceReason = "La référence choisie ne couvre pas cette année.";
  } else if (selected) {
    try {
      const id = selected.value.slice(selected.value.indexOf(":") + 1);
      if (selected.kind === "budget") {
        const b = await getBudget(workspace.id, id);
        if (b && b.year === year) planned = budgetSeries(selected.value, selected.label, b.year, b.amounts);
        else referenceReason = "Le budget choisi n'est plus disponible pour cette année.";
      } else {
        const full = await getScenario(workspace.id, id);
        if (!full) referenceReason = "Le scénario choisi n'est plus disponible.";
        else {
          const s = full.scenario;
          const projection = project(full.base, s.firstMonth, s.lastMonth, full.hypotheses, s.conventions);
          if (projection.kind === "error") referenceReason = "Projection indisponible : consulte les contrôles du scénario dans Hypothèses budgétaires.";
          else {
            const pubProjection = { ...projection, months: projection.months.map((m) => m.kind === "nd" ? { ...m, reasons: publicProjectionReasons(m.reasons) } : m) };
            const pubBase = { ...full.base, actuals: full.base.actuals.map((m) => m.kind === "nd" ? { ...m, reason: "Mois réel figé indisponible dans la base du scénario." } : m), prior: full.base.prior?.map((m) => m.kind === "nd" ? { ...m, reason: publicProjectionReasons(m.reason.split(" ; ")).join(" ; ") } : m) };
            planned = scenarioSeries(selected.value, selected.label, pubBase, pubProjection);
          }
        }
      }
    } catch {
      referenceReason = "Lecture de la référence indisponible : consulte Hypothèses budgétaires.";
    }
  }
  const cutoffReason = !journal || !sourceDate ? actualReason : !year ? "Choisis une année disponible." : cutoffOptions.length === 0 ? "Aucun mois de paie clos disponible pour cette année." : "Choisis une clôture valide pour le suivi.";
  const reason = !selected || !planned ? referenceReason : !cutoff ? cutoffReason : null;
  return buildSuivi({
    slug, years, options, selected, actual, planned, cutoffOptions, cutoff, notices, reason, actualReason: cutoffReason, referenceReason,
    state: { annee: year, reference: selected?.value ?? "", cloture: cutoff ?? "", affichage },
    source: { label: ctx?.source === "dsn" ? "DSN — journal de paie non lu" : ctx?.source === "payfit" ? "PayFit" : "Source RH non disponible", readAt: readAtIso, href: `/e/${encodeURIComponent(slug)}/donnees` },
  });
}
