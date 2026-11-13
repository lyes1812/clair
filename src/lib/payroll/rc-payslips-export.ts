import type { ExportCell, SheetSpec } from "@/lib/export/xlsx";
import type { ActualEvent } from "./non-recurring";
import { buildRcPayslipPeriod, type RcPayslipPeriod, type RcPayslipScan } from "./rc-payslips";

const statusLabel = (period: RcPayslipPeriod) => ({
  'not-read': 'Bulletins non lus', running: 'Lecture en cours', value: 'Indemnités identifiées',
  none: 'Aucune indemnité repérée', review: 'À vérifier',
})[period.status];
const costStatusLabel = (period: RcPayslipPeriod) => period.costStatus === 'value' ? 'Coût chargé identifié'
  : period.costStatus === 'none' ? 'Aucun coût RC identifié'
    : period.costStatus === 'not-read' ? 'Coût chargé non lu' : 'Coût chargé à vérifier';

/** Agrégats uniquement : aucun identifiant, libellé individuel ou référence documentaire dans le classeur. */
export function rcPayslipSheet(scan: RcPayslipScan, months: string[], syncId: string | null, events: ActualEvent[] = [], serviceFiltered = false): SheetSpec {
  const period = buildRcPayslipPeriod(scan, months, syncId, events, serviceFiltered);
  const row = (label: string, value: RcPayslipPeriod): ExportCell[] => {
    // Une lecture globale incomplète garde tous ses montants n.d., comme le détail de la Synthèse.
    const complete = period.status === 'value' || period.status === 'none';
    const reason = (complete ? value.reason : period.reason) ?? 'Montant du bulletin non confirmé.';
    const amount: ExportCell = complete && value.status === 'value' && value.amountCents !== null ? value.amountCents : { nd: reason };
    const count: ExportCell = complete ? value.identifiedCount : { nd: reason };
    const completeCost = complete && period.costStatus === 'value' && value.costStatus === 'value';
    const costReason = (period.costStatus === 'value' ? value.costReason : period.costReason) ?? 'Contributions patronales propres à la RC non isolées ; aucun coût chargé partiel.';
    const charges: ExportCell = completeCost && value.employerChargesCents !== null && value.employerChargesCents !== undefined ? value.employerChargesCents : { nd: costReason };
    const charged: ExportCell = completeCost && value.chargedCents !== null && value.chargedCents !== undefined ? value.chargedCents : { nd: costReason };
    return [label, count, amount, charges, charged, statusLabel(complete ? value : period), costStatusLabel(period.costStatus === 'value' ? value : period), [...new Set([complete ? value.reason : reason, costReason].filter(Boolean))].join(' · ')];
  };
  return {
    name: 'Indemnités RC bulletins',
    columns: [
      { key: 'month', header: 'Mois', kind: 'text', width: 18 },
      { key: 'count', header: 'Indemnités identifiées', kind: 'nombre', width: 24 },
      { key: 'amount', header: 'Indemnité RC · bulletin', kind: 'eur', width: 28 },
      { key: 'charges', header: 'Contributions patronales RC', kind: 'eur', width: 30 },
      { key: 'charged', header: 'Coût chargé RC', kind: 'eur', width: 25 },
      { key: 'status', header: 'Statut de lecture', kind: 'text', width: 30 },
      { key: 'costStatus', header: 'Statut du coût chargé', kind: 'text', width: 30 },
      { key: 'reason', header: 'Source et limites', kind: 'text', width: 70 },
    ],
    rows: [...months.map((month) => row(month, buildRcPayslipPeriod(scan, [month], syncId, events, serviceFiltered))), row('Période', period)],
    note: `Source : bulletins PayFit, période demandée ${scan.from} → ${scan.to} ; lecture ${scan.finishedAt ?? scan.startedAt}. Coût chargé RC = indemnité + contributions patronales explicitement rattachées à la RC dans le bulletin. Aucun taux reconstitué à partir des cotisations totales ; un coût incomplet reste n.d., sans cumul partiel. Les indemnités restent lisibles quand leur coût chargé ne peut pas être confirmé. Ces montants sont déjà inclus dans la paie : aucun ajout au journal. Aucun nom, contrat, identifiant de bulletin, empreinte ou note individuelle exporté.`,
  };
}
