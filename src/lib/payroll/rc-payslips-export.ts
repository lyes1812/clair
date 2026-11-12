import type { ExportCell, SheetSpec } from "@/lib/export/xlsx";
import type { ActualEvent } from "./non-recurring";
import { buildRcPayslipPeriod, type RcPayslipPeriod, type RcPayslipScan } from "./rc-payslips";

const statusLabel = (period: RcPayslipPeriod) => ({
  'not-read': 'Bulletins non lus', running: 'Lecture en cours', value: 'Indemnités identifiées',
  none: 'Aucune indemnité repérée', review: 'À vérifier',
})[period.status];

/** Agrégats uniquement : aucun identifiant, libellé individuel ou référence documentaire dans le classeur. */
export function rcPayslipSheet(scan: RcPayslipScan, months: string[], syncId: string | null, events: ActualEvent[] = [], serviceFiltered = false): SheetSpec {
  const period = buildRcPayslipPeriod(scan, months, syncId, events, serviceFiltered);
  const row = (label: string, value: RcPayslipPeriod): ExportCell[] => {
    // Une lecture globale incomplète garde tous ses montants n.d., comme le détail de la Synthèse.
    const complete = period.status === 'value' || period.status === 'none';
    const reason = (complete ? value.reason : period.reason) ?? 'Montant du bulletin non confirmé.';
    const amount: ExportCell = complete && value.status === 'value' && value.amountCents !== null ? value.amountCents : { nd: reason };
    const count: ExportCell = complete ? value.identifiedCount : { nd: reason };
    return [label, count, amount, statusLabel(complete ? value : period), complete ? value.reason ?? '' : reason];
  };
  return {
    name: 'Indemnités RC bulletins',
    columns: [
      { key: 'month', header: 'Mois', kind: 'text', width: 18 },
      { key: 'count', header: 'Indemnités identifiées', kind: 'nombre', width: 24 },
      { key: 'amount', header: 'Indemnité RC · bulletin', kind: 'eur', width: 28 },
      { key: 'status', header: 'Statut de lecture', kind: 'text', width: 30 },
      { key: 'reason', header: 'Source et limites', kind: 'text', width: 70 },
    ],
    rows: [...months.map((month) => row(month, buildRcPayslipPeriod(scan, [month], syncId, events, serviceFiltered))), row('Période', period)],
    note: `Source : bulletins PayFit, période demandée ${scan.from} → ${scan.to} ; lecture ${scan.finishedAt ?? scan.startedAt}. Indemnité du bulletin distincte du coût chargé ; cotisations propres à la RC non isolées. Aucun montant ajouté au journal ni aux retraitements chargés. Aucun nom, contrat, identifiant de bulletin, empreinte ou note individuelle exporté.`,
  };
}
