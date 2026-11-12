import { Money } from "@/components/Money";
import { AutoRefresh } from "@/components/AutoRefresh";
import { formatMonth } from "@/lib/dates";
import type { RcPayslipPeriod, RcPayslipScan } from "@/lib/payroll/rc-payslips";
import { PanelHead, ScrollTable } from "./components";

type Props = { slug: string; period: RcPayslipPeriod; scan: RcPayslipScan | null; editable: boolean; contracts: { key: string; label: string }[] };

/** Les lecteurs reçoivent des agrégats ; les références des bulletins restent réservées aux éditeurs. */
export function RcPayslipDetails({ slug, period, scan, editable, contracts }: Props) {
  const months = [...new Set(period.rows.map((row) => row.month))].sort();
  const sourceHref = `/e/${slug}/donnees/payfit#indemnites-rc`;
  return <section className="panel" id="rc-payslip-details" data-testid="rc-payslip-details">
    {scan?.status === "running" && <AutoRefresh everyMs={5000} />}
    <PanelHead title="Indemnités de RC · bulletins PayFit" desc="Montant de l’indemnité lu sur le bulletin, distinct du coût chargé" tools={<a className="btn small" href={sourceHref}>Synchronisation et couverture</a>} />
    <p className={period.status === "review" ? "notice" : "tile-foot"} data-testid="rc-payslip-period-status">{period.reason ?? "Bulletins non lus."}</p>
    {scan && <p className="tile-foot" data-testid="rc-payslip-scan-progress">{scan.checkedPayslips} bulletin{scan.checkedPayslips > 1 ? "s" : ""} parcouru{scan.checkedPayslips > 1 ? "s" : ""} · {scan.completedCollaborators}/{scan.totalCollaborators} collaborateurs · lecture {scan.status === "running" ? "en cours" : scan.status === "complete" ? "terminée" : scan.status === "partial" ? "partielle" : "échouée"}</p>}
    {months.length > 0 && <ScrollTable label="Indemnités de RC des bulletins par mois"><table className="data-table" data-testid="rc-payslip-monthly"><thead><tr><th scope="col">Mois</th><th scope="col" className="num">Indemnités identifiées</th><th scope="col" className="num">Montant bulletin</th></tr></thead><tbody>{months.map((month) => {
      const rows = period.rows.filter((row) => row.month === month);
      const identified = rows.filter((row) => row.status === "identified");
      const value = period.status === "value" ? identified.reduce((sum, row) => sum + BigInt(row.indemnityCents!), 0n) : null;
      return <tr key={month}><th scope="row">{formatMonth(month)}</th><td className="num">{identified.length}</td><td className="num">{value !== null ? <Money cents={Number(value)} /> : <span className="nd">n.d.</span>}</td></tr>;
    })}</tbody></table></ScrollTable>}
    {editable && period.rows.length > 0 && <ScrollTable label="Provenance des indemnités de RC dans les bulletins"><table className="data-table sticky sticky-first" data-testid="rc-payslip-sources"><thead><tr><th scope="col">Mois</th><th scope="col">Contrat</th><th scope="col">Bulletin source</th><th scope="col">Lecture du bulletin</th><th scope="col" className="num">Indemnité observée</th></tr></thead><tbody>{period.rows.map((row) => <tr key={`${row.contractId}-${row.month}-${row.payslipId}`}>
      <th scope="row">{formatMonth(row.month)}</th>
      <td className="wrap">{contracts.find((contract) => contract.key === `payfit:${row.contractId}`)?.label ?? "Contrat absent du référentiel courant"}</td>
      <td className="wrap">{row.pdfHash ? <a href={`/e/${slug}/studio-rh/masse-salariale/bulletins/${encodeURIComponent(row.payslipId)}`} target="_blank" rel="noreferrer">Consulter le bulletin PayFit</a> : 'Bulletin à vérifier'}<details><summary>Traçabilité technique</summary><code>{row.payslipId}</code>{row.pdfHash && <p className="tile-foot">Empreinte {row.pdfHash.slice(0, 12)}</p>}</details></td>
      <td className="wrap">{row.status === "identified" ? <>{row.components.map((part, index) => <p className="tile-foot" key={index}>{part.label} · p. {part.page}, ligne {part.line}</p>)}</> : "À vérifier : montant non confirmé"}</td>
      <td className="num">{row.status === "identified" && row.indemnityCents !== null ? <Money cents={row.indemnityCents} /> : <span className="nd">n.d.</span>}</td>
    </tr>)}</tbody></table></ScrollTable>}
    <p className="tile-foot">Les indemnités des bulletins ne sont pas ajoutées à la paie. Les cotisations propres à la RC ne sont pas déduites des cotisations totales du bulletin.</p>
  </section>;
}
