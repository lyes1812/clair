import { isIsoDate, isMonth, monthBounds } from "@/lib/connectors/months";
import { loadPayrollContext } from "@/lib/payroll/context";
import { loadPayrollExplorationContext } from "@/lib/payroll/exploration-context";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { buildPayfitPayrollItems, payrollItemsUnavailable, type PayrollItemsModel } from "@/lib/rh/payroll-items";
import { loadDsnPayrollItems } from "@/lib/rh/payroll-items-store";

export type SalaryAnalysisSearch = Record<string, string | string[] | undefined>;
export type SalaryAnalysisData = {
  ctx: KpiContext;
  month: string;
  months: string[];
  payroll: PayrollItemsModel;
  notices: string[];
  rubricKey: string;
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// Les mêmes sources et rattachements que Collaborateurs > rubrique, sans filtre
// d'effectif de fin de mois : une rémunération après le départ reste dans l'analyse.
// Le contrôle PayFit réutilise les statuts explicites ; leur absence n'est jamais
// assimilée à une paie clôturée. Aucun appel au fournisseur ni écriture ici.
export async function loadSalaryAnalysis(slug: string, sp: SalaryAnalysisSearch): Promise<SalaryAnalysisData> {
  const context = await loadPayrollContext(slug);
  const ctx = context.kpi;
  const collab = ctx.collab;
  const source = collab.chosen;
  const data = collab.data;
  const notices: string[] = [];
  const requestedMonth = one(sp.mois);
  const monthParameter = requestedMonth.slice(0, 32);
  const requestedRubric = one(sp.rubrique).trim();
  const rubricKey = requestedRubric.slice(0, 180);
  if (requestedMonth.length > 32) notices.push("Le paramètre de mois est trop long : aucun mois de remplacement n’a été choisi.");
  if (requestedRubric.length > 180) notices.push("Le paramètre de rubrique est trop long : choisis une rubrique disponible.");
  // La couverture RH peut décrire des mois manquants en dehors de la lecture.
  // Pour PayFit, seuls les mois réellement demandés au journal sont proposés.
  const months = source ? [...new Set(source === "payfit"
    ? [...(context.input?.months ?? []), ...(context.read?.months ?? [])]
    : data?.coverage.map((c) => c.month) ?? [])].filter(isMonth).sort() : [];
  const reference = data?.build.referenceDate;
  const validReference = isIsoDate(reference) ? reference : null;
  const open = new Set([...(context.input?.openMonths ?? []), ...(ctx.input?.openMonths ?? [])]);
  const exploration = source === "payfit" ? await loadPayrollExplorationContext(context) : null;
  const explicitlyClosed = new Set(exploration?.read?.closedMonths ?? []);
  const closed = months.filter((m) => validReference && monthBounds(m).end <= validReference && !open.has(m)
    && (source !== "payfit" || explicitlyClosed.has(m)));
  const month = sp.mois !== undefined ? monthParameter : closed.at(-1) ?? "";
  const unavailable = (reason: string): SalaryAnalysisData => ({
    ctx, month, months, payroll: payrollItemsUnavailable(source, month, reason), notices, rubricKey,
  });

  if (!source) return unavailable("Aucune source RH retenue. Connecte PayFit ou applique des DSN dans Données.");
  if (!data || data.build.source !== source) return unavailable("Référentiel RH de la source retenue indisponible pour cette lecture.");
  if (!validReference) return unavailable("Date de référence RH absente ou invalide : aucun mois ne peut être présenté comme clos.");
  if (sp.mois !== undefined && !isMonth(requestedMonth)) return unavailable("Mois invalide : format AAAA-MM attendu. Aucun mois de remplacement n’a été choisi.");
  if (sp.mois !== undefined && !months.includes(month)) return unavailable("Mois hors de la lecture appliquée. Aucun mois de remplacement n’a été choisi.");
  if (month && monthBounds(month).end > validReference) return unavailable("Mois non terminé à la date de référence RH : analyse des rémunérations closes indisponible.");
  if (month && open.has(month)) return unavailable("Paie non clôturée à la lecture : analyse des rémunérations closes indisponible.");
  if (source === "payfit") {
    if (exploration?.unavailable) return unavailable(exploration.unavailable);
    if (!month) return unavailable("Aucun mois avec clôture PayFit explicite disponible à la date de référence RH.");
    if (!explicitlyClosed.has(month)) return unavailable(exploration?.read?.closureReasons?.[month] ?? "Clôture PayFit non vérifiable pour ce mois.");
    const payroll = buildPayfitPayrollItems({
      month, input: context.input, rh: data,
      readAt: exploration?.read?.readAt ?? context.read?.startedAt.toISOString() ?? null,
      syncId: exploration?.read?.syncId ?? context.read?.syncId ?? null,
      unavailable: context.unavailable,
    });
    return { ctx, month, months, payroll, notices, rubricKey };
  }
  if (!month) return unavailable("Aucun mois DSN clos disponible à la date de référence RH.");
  const payroll = await loadDsnPayrollItems(collab, month);
  return { ctx, month, months, payroll, notices, rubricKey };
}
