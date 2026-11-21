import type { ReactNode } from "react";
import { Money, MoneyUnitLabel } from "@/components/Money";
import { isMonth } from "@/lib/connectors/months";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatMonth } from "@/lib/dates";
import { sumPayrollItemAmounts, type PayrollItemMoney, type PayrollItemsModel } from "@/lib/rh/payroll-items";
import { salaryAnalysis } from "@/lib/rh/salary-analysis";

export type SalaryAnalysisViewProps = {
  slug: string;
  month: string;
  months: string[];
  rubricKey: string;
  payroll: PayrollItemsModel;
  notices: string[];
};
const count = (n: number) => new Intl.NumberFormat("fr-FR").format(n);
const monthLabel = (month: string) => isMonth(month) ? formatMonth(month) : "Mois indisponible";

function Amount({ value }: { value: PayrollItemMoney }) {
  return value.kind === "value" ? <Money cents={value.cents} /> : <span className="nd" title={value.reason}>n.d.</span>;
}

function Tile({ id, label, children, note, reason }: { id: string; label: string; children: ReactNode; note: string; reason?: string }) {
  return <div className="kpi-tile" data-testid={`salary-tile-${id}`}>
    <dt>{label}</dt>
    <dd className={reason ? "nd" : undefined}>{children}</dd>
    <dd className="salary-tile-note">{note}{reason && <details className="salary-help"><summary>Pourquoi n.d. ?</summary><p>{reason}</p></details>}</dd>
  </div>;
}

// Vue agrégée uniquement : les identités du référentiel ne sont pas transmises à
// un nouveau tableau. Le détail reste dans la destination Rubriques existante.
export function SalaryAnalysisView({ slug, month, months, rubricKey, payroll, notices }: SalaryAnalysisViewProps) {
  const analysis = salaryAnalysis(payroll, rubricKey);
  const relevantKeys = new Set(analysis.rubrics.map((r) => r.key));
  const selected = payroll.rows.filter((r) => relevantKeys.has(r.rubricKey) && (!rubricKey || r.rubricKey === rubricKey));
  const reasons = [...new Set([...notices, ...payroll.notices, ...(analysis.reason ? [analysis.reason] : [])])];
  const source = payroll.source === "payfit" ? "Journal de paie PayFit" : payroll.source === "dsn" ? "Rémunérations DSN · type 001" : "Source indisponible";
  const readDate = payroll.readAt ? new Date(payroll.readAt) : null;
  const readLabel = readDate && Number.isFinite(readDate.getTime()) ? dateTimeFmt.format(readDate) : null;
  const personsKnown = analysis.coverage.selectedRows > 0 && payroll.kind === "value" && payroll.coverage.status === "complete";
  const detailHref = (key: string) => `/e/${slug}/studio-rh/collaborateurs/rubrique?${new URLSearchParams({ mois: month, rubrique: key }).toString()}`;
  const reasonOf = (value: PayrollItemMoney) => value.kind === "nd" ? value.reason : undefined;

  return <div className="salary-analysis" data-testid="salary-analysis">
    <div className="salary-heading">
      <div><h2>Analyse des salaires</h2><p className="desc">Brut observé · {monthLabel(month)}</p></div>
      <details className="kpi-vigilance" data-testid="salary-vigilance">
        <summary>Vigilance <span aria-hidden="true">?</span></summary>
        <div className="kpi-vigilance-body">
          <p>Rémunérations observées, sans reconstitution d’un salaire de base ni conversion en équivalent temps plein. Les contrats d’une même personne sont réunis.</p>
          <p>Les paiements après départ, les régularisations et les montants négatifs restent dans le mois source. Une personne sans occurrence n’est pas ajoutée avec un montant nul.</p>
          {reasons.map((reason) => <p key={reason}>{reason}</p>)}
        </div>
      </details>
    </div>

    <form method="get" className="filters bar kpi-bar salary-filters" aria-label="Mois et rémunérations analysées" data-testid="salary-filters">
      <input type="hidden" name="vue" value="salaires" />
      <div className="field-row"><label htmlFor="salary-month">Mois</label><select className="select" name="mois" id="salary-month" defaultValue={month}>
        {!months.includes(month) && <option value={month}>{monthLabel(month)}</option>}
        {[...months].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select></div>
      {payroll.source === "payfit" && <div className="field-row"><label htmlFor="salary-rubric">Rémunérations</label><select className="select" name="rubrique" id="salary-rubric" defaultValue={rubricKey}>
        <option value="">Toutes les rubriques de brut</option>
        {rubricKey && !analysis.rubrics.some((r) => r.key === rubricKey) && <option value={rubricKey}>Rubrique indisponible</option>}
        {analysis.rubrics.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select></div>}
      <div className="salary-actions"><button className="btn" type="submit">Afficher</button><a href="?vue=salaires">Dernier mois clos</a></div>
    </form>

    <div className="salary-context"><p>{source}{readLabel && <> · lecture du {readLabel}</>}</p><a href="#salary-definition">Définition des indicateurs</a></div>
    {analysis.kind !== "value" && <p className="notice salary-status" data-testid="salary-status">{analysis.kind === "partial" ? "Couverture à vérifier : moyenne et médiane indisponibles." : analysis.reason ?? "Données indisponibles pour ce mois."}</p>}

    <dl className="facts kpi-tiles salary-tiles" aria-label="Repères des rémunérations observées">
      <Tile id="persons" label="Personnes rattachées" note="Avec au moins une occurrence de brut ; tous contrats réunis." reason={personsKnown ? undefined : analysis.reason ?? "Aucune occurrence exploitable."}>{personsKnown ? count(analysis.coverage.persons) : "n.d."}</Tile>
      <Tile id="total" label="Total brut observé" note={analysis.label} reason={reasonOf(analysis.totalSource)}><Amount value={analysis.totalSource} /></Tile>
      <Tile id="mean" label="Brut moyen par personne" note="Total brut ÷ personnes distinctes rémunérées." reason={reasonOf(analysis.mean)}><Amount value={analysis.mean} /></Tile>
      <Tile id="median" label="Brut médian par personne" note="Valeur centrale des bruts individuels du mois." reason={reasonOf(analysis.median)}><Amount value={analysis.median} /></Tile>
    </dl>

    <section className="panel salary-panel" aria-labelledby="salary-source-title">
      <div className="salary-panel-heading"><h2 id="salary-source-title">Rémunérations retenues</h2><span className="desc">Montants en <MoneyUnitLabel /></span></div>
      {selected.length > 0 ? <>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Rubriques du brut observé">
          <table className="data-table kpi-table salary-table" data-testid="salary-source-table"><caption className="salary-sr">{monthLabel(month)} — rubriques et montants retenus dans l’analyse.</caption>
            <thead><tr><th scope="col">{payroll.source === "dsn" ? "Type de rémunération" : "Rubrique comptable"}</th><th scope="col" className="num">Occurrences</th><th scope="col" className="num">Brut observé</th><th scope="col">Source</th></tr></thead>
            <tbody>{analysis.rubrics.filter((r) => !rubricKey || r.key === rubricKey).map((rubric) => {
              const rows = selected.filter((r) => r.rubricKey === rubric.key);
              if (!rows.length) return null;
              return <tr key={rubric.key}><th scope="row">{rubric.label}</th><td className="num">{count(rows.length)}</td><td className="num"><Amount value={sumPayrollItemAmounts(rows)} /></td><td><a href={detailHref(rubric.key)}>Voir les lignes</a></td></tr>;
            })}</tbody>
          </table>
        </div>
        <p className="salary-coverage" data-testid="salary-coverage">{count(analysis.coverage.linkedRows)} occurrence(s) rattachée(s) · {count(analysis.coverage.unlinkedRows)} non rattachée(s) · {count(analysis.coverage.missingAmountRows)} sans montant exploitable.{analysis.coverage.unknownTypeRows > 0 && <> {count(analysis.coverage.unknownTypeRows)} occurrence(s) DSN avec un type absent, hors total 001.</>}</p>
      </> : <p className="desc">Aucune rémunération exploitable pour cette sélection. <a href={`/e/${slug}/donnees`}>Vérifier les sources</a></p>}
    </section>

    <details className="panel salary-method" id="salary-definition" data-testid="salary-definition"><summary>Définition des indicateurs <span aria-hidden="true">?</span></summary><div>
      <dl>
        <div><dt>Périmètre</dt><dd>{payroll.source === "dsn" ? "Occurrences S21.G00.51 de type 001 des déclarations retenues. Les autres types, qui peuvent se recouvrir, ne sont pas additionnés." : "Débit moins crédit des rubriques de brut de la grille de l’espace : salaires, primes, gratifications de stage, indemnités et avantages. Les cotisations, provisions et charges non classées sont exclues."}</dd></div>
        <div><dt>Personnes rattachées</dt><dd>Personnes distinctes ayant au moins une occurrence retenue, y compris un montant nul explicite. Ce nombre peut être partiel si des lignes ne sont pas rattachées. Il diffère de l’effectif en fin de mois.</dd></div>
        <div><dt>Moyenne</dt><dd>Somme des rémunérations individuelles du périmètre divisée par le nombre de personnes distinctes. Chaque personne compte une fois, même avec plusieurs contrats.</dd></div>
        <div><dt>Médiane</dt><dd>Bruts individuels triés par montant : valeur centrale si le nombre de personnes est impair, moyenne des deux valeurs centrales s’il est pair.</dd></div>
        <div><dt>Précision et couverture</dt><dd>Calculs en centimes ; moyenne et médiane arrondies au centime le plus proche, les demi-centimes en s’éloignant de zéro. Les statistiques par personne sont indisponibles si une occurrence retenue manque de montant ou de rattachement certain. L’affichage € / k€ suit la préférence de lecture.</dd></div>
      </dl>
    </div></details>
  </div>;
}
