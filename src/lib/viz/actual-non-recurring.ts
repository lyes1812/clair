import { isMonth } from "@/lib/connectors/months";
import type { JournalInput } from "@/lib/payroll/engine";
import { buildActualNonRecurring, parseActualEvent, type ActualEvent, type ActualNonRecurring } from "@/lib/payroll/non-recurring";

export const ACTUAL_NON_RECURRING_CATEGORIES = [
  { kind: "licenciement", label: "Licenciements" },
  { kind: "rupture-conventionnelle", label: "Ruptures conventionnelles" },
  { kind: "tuilage", label: "Tuilages passés" },
  { kind: "autre", label: "Autres éléments non récurrents" },
] as const;
export const ACTUAL_NON_RECURRING_QUALIFICATION = "Montants déjà compris dans la masse salariale réelle, à ne pas ajouter. Liste non exhaustive : 0 signifie aucun coût identifié, pas l’absence de coûts non récurrents. Les tuilages calculés sont des estimations calendaires.";

export type ActualNonRecurringPoint = { month: string; amount: number | null; count: number; reason: string | null };
export type ActualNonRecurringPublicRow = ActualNonRecurringPoint & { kind: ActualEvent["kind"]; label: string; estimatedCount: number };
export type ActualNonRecurringChart = {
  points: ActualNonRecurringPoint[];
  rows: ActualNonRecurringPublicRow[];
  total: number | null;
  count: number;
  reasons: string[];
  qualification: string;
};

// Une raison du journal peut contenir une référence de ligne. Le graphique reçoit seulement une raison agrégée.
const publicReasons = (model: ActualNonRecurring): string[] => [...new Set(model.reasons.map((reason) =>
  reason.startsWith("Réel source n.d.") ? "Journal de paie réel indisponible ou incomplet pour la période." : reason))];
const rowReasons = (rows: ActualNonRecurring["rows"]) => [...new Set(rows.flatMap((row) => row.reason ? [row.reason] : []))];

/** Lecture publique du modèle existant : aucun identifiant, contrat, note libre ni provenance individuelle transmis au graphique. */
export function buildActualNonRecurringChart(input: JournalInput | null, events: ActualEvent[], months: string[], syncId: string | null): ActualNonRecurringChart {
  const period = buildActualNonRecurring(input, events, months, syncId);
  const result: ActualNonRecurringChart = { points: [], rows: [], total: period.nonRecurring, count: period.rows.length, reasons: publicReasons(period), qualification: ACTUAL_NON_RECURRING_QUALIFICATION };
  if (!months.length || months.some((month) => !isMonth(month)) || new Set(months).size !== months.length) return result;
  for (const month of months) {
    const selected = period.rows.filter((row) => row.event.month === month);
    const monthly = buildActualNonRecurring(input, events, [month], syncId);
    // Les doublons détectés sur toute la période restent bloquants, même si chaque mois seul paraît unique.
    const inherited = rowReasons(selected);
    const reasons = inherited.length ? inherited : monthly.nonRecurring === null ? publicReasons(monthly) : [];
    result.points.push({ month, amount: inherited.length ? null : monthly.nonRecurring, count: selected.length, reason: reasons.length ? reasons.join(" · ") : null });
    for (const category of ACTUAL_NON_RECURRING_CATEGORIES) {
      const selectedKind = selected.filter((row) => row.event.kind === category.kind);
      if (!selectedKind.length) continue;
      const model = buildActualNonRecurring(input, selectedKind.map((row) => row.event), [month], syncId);
      const inheritedKind = rowReasons(selectedKind);
      const kindReasons = inheritedKind.length ? inheritedKind : model.nonRecurring === null ? publicReasons(model) : [];
      result.rows.push({ month, kind: category.kind, label: category.label, amount: inheritedKind.length ? null : model.nonRecurring, count: selectedKind.length,
        estimatedCount: selectedKind.filter((row) => parseActualEvent(row.event)?.calculation).length,
        reason: kindReasons.length ? kindReasons.join(" · ") : null });
    }
  }
  return result;
}
