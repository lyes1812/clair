import { Money } from "@/components/Money";
import { AutoRefresh } from "@/components/AutoRefresh";
import { formatMonth } from "@/lib/dates";
import type { RcPayslipPeriod, RcPayslipRecord, RcPayslipScan } from "@/lib/payroll/rc-payslips";
import { PanelHead, ScrollTable } from "./components";
import { rcPayslipIssueLabel } from '@/lib/payroll/rc-payslip-issues';

type Props = { slug: string; period: RcPayslipPeriod; scan: RcPayslipScan | null; editable: boolean; contracts: { key: string; label: string }[] };
const costIssues: Record<string, string> = {
  "multiple-payslip-versions": "Plusieurs versions du coût de la RC à rapprocher",
  "conflicting-cost-versions": "Plusieurs versions du coût de la RC à rapprocher",
  "invalid-cost": "Composantes du coût de la RC incohérentes",
  "rc-exemption-unconfirmed": "Traitement social de l’indemnité à vérifier",
  "ambiguous-rc-charge-label": "Libellé de contribution RC à vérifier",
  "mixed-rc-charge-label": "Ligne de contribution mêlant plusieurs indemnités",
  "employee-rc-charge-label": "Contribution salariale ne permettant pas d’isoler le coût employeur",
  "signed-or-corrected-rc-charge": "Régularisation de contribution RC à vérifier",
  "duplicate-rc-charge": "Lignes de contribution RC à rapprocher",
  "charge-column-unrecognized": "Colonnes de contributions du bulletin non reconnues",
  "employer-column-unrecognized": "Colonne patronale du bulletin non reconnue",
  "employer-amount-ambiguous": "Plusieurs montants patronaux possibles pour la RC",
  "rc-charge-base-ambiguous": "Plusieurs assiettes possibles pour la contribution RC",
  "rc-charge-base-mismatch": "Assiette de contribution différente de l’indemnité identifiée",
};
const costIssueLabel = (code?: string) => code && costIssues[code] || "Contributions patronales propres à la RC non isolées";
const exactSum = (rows: RcPayslipRecord[], pick: (row: RcPayslipRecord) => number | null | undefined) => {
  const amounts = rows.map(pick);
  if (amounts.some((amount) => amount === null || amount === undefined || !Number.isSafeInteger(amount))) return null;
  const value = amounts.reduce<bigint>((sum, amount) => sum + BigInt(amount!), 0n);
  return value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(value);
};
const shown = (amount: number | null, reason?: string | null) => amount === null ? <span className="nd" title={reason ?? undefined}>n.d.</span> : <Money cents={amount} />;

/** Les lecteurs reçoivent des agrégats ; les références des bulletins restent réservées aux éditeurs. */
export function RcPayslipDetails({ slug, period, scan, editable, contracts }: Props) {
  const months = [...new Set(period.rows.map((row) => row.month))].sort();
  const sourceHref = `/e/${slug}/donnees/payfit#indemnites-rc`;
  return <section className="panel" id="rc-payslip-details" data-testid="rc-payslip-details">
    {scan?.status === "running" && <AutoRefresh everyMs={5000} />}
    <PanelHead title="Indemnités de RC · bulletins PayFit" desc="Indemnité, contributions patronales propres à la RC et coût chargé" tools={<a className="btn small" href={sourceHref}>Synchronisation et couverture</a>} />
    <p className={period.status === "review" ? "notice" : "tile-foot"} data-testid="rc-payslip-period-status">{period.reason ?? "Bulletins non lus."}</p>
    {period.costStatus !== "value" && period.status !== "none" && <p className="tile-foot" data-testid="rc-payslip-cost-status">{period.costReason ?? costIssueLabel()}</p>}
    {scan && <p className="tile-foot" data-testid="rc-payslip-scan-progress">{scan.checkedPayslips} bulletin{scan.checkedPayslips > 1 ? "s" : ""} parcouru{scan.checkedPayslips > 1 ? "s" : ""} · {scan.completedCollaborators}/{scan.totalCollaborators} collaborateurs · lecture {scan.status === "running" ? "en cours" : scan.status === "complete" ? "terminée" : scan.status === "partial" ? "partielle" : "échouée"}</p>}
    {months.length > 0 && <ScrollTable label="Indemnités et coûts chargés de RC des bulletins par mois"><table className="data-table" data-testid="rc-payslip-monthly"><thead><tr><th scope="col">Mois</th><th scope="col" className="num">Indemnités identifiées</th><th scope="col" className="num">Indemnité RC · bulletin</th><th scope="col" className="num">Contributions patronales RC</th><th scope="col" className="num">Coût chargé RC</th></tr></thead><tbody>{months.map((month) => {
      const rows = period.rows.filter((row) => row.month === month);
      const identified = rows.filter((row) => row.status === "identified");
      const value = period.status === "value" ? exactSum(identified, (row) => row.indemnityCents) : null;
      const completeCost = period.status === "value" && period.costStatus === "value" && identified.every((row) => row.cost?.status === "value");
      const charges = completeCost ? exactSum(identified, (row) => row.cost?.employerChargesCents) : null;
      const charged = completeCost ? exactSum(identified, (row) => row.cost?.chargedCents) : null;
      return <tr key={month}><th scope="row">{formatMonth(month)}</th><td className="num">{identified.length}</td><td className="num">{shown(value, period.reason)}</td><td className="num">{shown(charges, period.costReason)}</td><td className="num">{shown(charged, period.costReason)}</td></tr>;
    })}</tbody></table></ScrollTable>}
    {editable && period.rows.length > 0 && <ScrollTable label="Provenance des indemnités et coûts chargés de RC dans les bulletins"><table className="data-table sticky sticky-first" data-testid="rc-payslip-sources"><thead><tr><th scope="col">Mois</th><th scope="col">Contrat</th><th scope="col">Bulletin source</th><th scope="col">Lecture du bulletin</th><th scope="col" className="num">Indemnité observée</th><th scope="col" className="num">Contributions patronales RC</th><th scope="col" className="num">Coût chargé RC</th></tr></thead><tbody>{period.rows.map((row) => <tr key={`${row.contractId}-${row.month}-${row.payslipId}`} data-rc-read-code={row.status === 'review' ? row.code : undefined}>
      <th scope="row">{formatMonth(row.month)}</th>
      <td className="wrap">{contracts.find((contract) => contract.key === `payfit:${row.contractId}`)?.label ?? "Contrat absent du référentiel courant"}</td>
      <td className="wrap">{row.pdfHash ? <a href={`/e/${slug}/studio-rh/masse-salariale/bulletins/${encodeURIComponent(row.payslipId)}`} target="_blank" rel="noreferrer">Consulter le bulletin PayFit</a> : 'Bulletin à vérifier'}<details><summary>Traçabilité technique</summary><code>{row.payslipId}</code>{row.pdfHash && <p className="tile-foot">Empreinte {row.pdfHash.slice(0, 12)}</p>}</details></td>
      <td className="wrap">{row.status === "identified" ? <>{row.components.map((part, index) => <p className="tile-foot" key={`indemnity-${index}`}>{part.label} · p. {part.page}, ligne {part.line}</p>)}{row.cost?.status === "value" && row.cost.components.map((part, index) => <p className="tile-foot" key={`cost-${index}`}>{part.label} · p. {part.page}, ligne {part.line}</p>)}</> : rcPayslipIssueLabel(row.code)}</td>
      <td className="num">{row.status === "identified" && row.indemnityCents !== null ? <Money cents={row.indemnityCents} /> : <span className="nd">n.d.</span>}</td>
      <td className="num">{shown(row.status === "identified" && row.cost?.status === "value" ? row.cost.employerChargesCents : null)}{(!row.cost || row.cost.status !== "value") && <p className="tile-foot">{costIssueLabel(row.cost?.code)}</p>}</td>
      <td className="num">{shown(row.status === "identified" && row.cost?.status === "value" ? row.cost.chargedCents : null)}</td>
    </tr>)}</tbody></table></ScrollTable>}
    <p className="tile-foot">Coût chargé = indemnité + contributions patronales explicitement rattachées à la RC dans le bulletin. Aucun taux n’est reconstitué à partir des cotisations totales. Ces montants sont déjà inclus dans la paie.</p>
  </section>;
}
