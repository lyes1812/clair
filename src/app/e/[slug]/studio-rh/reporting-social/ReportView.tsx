import { GlossaryLink } from "@/components/GlossaryLink";
import { Money, MoneyUnitLabel } from "@/components/Money";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate, formatMonth } from "@/lib/dates";
import type { SocialCell, SocialMetric, SocialReport, SocialRow } from "@/lib/reporting/social";
import { PeriodModeFields } from "../kpi/PeriodModeFields";
import { PrintAction } from "./PrintAction";

const RH_COLUMNS = [
  ["headcount", "Effectif fin de mois"],
  ["etp", "ETP fin de mois"],
  ["entries", "Entrées"],
  ["exits", "Sorties"],
  ["absenteeism", "Absentéisme"],
] as const;
const PAYROLL_COLUMNS = [
  ["brut", "Brut"],
  ["cotisations", "Cotisations et taxes"],
  ["masse", "Masse chargée"],
] as const;
const ROW_CELLS = ["coverage", ...RH_COLUMNS.map(([key]) => key), ...PAYROLL_COLUMNS.map(([key]) => key)] as const;
const fullDateTime = (value: string | null) => value ? dateTimeFmt.format(new Date(value)) : "n.d.";
const periodLabel = (value: string) => value.replace(/\b\d{4}-\d{2}\b/g, (month) => formatMonth(month).toLowerCase());
const cellReasons = (cell: SocialCell) => [...new Set([cell.reason, ...cell.qualifiers].filter((reason): reason is string => !!reason))];

// Les notes sont des mentions du modèle, regroupées une seule fois. Les renvois restent visibles sur papier, même pour les n.d.
function reportNotes(report: SocialReport): string[] {
  return [...new Set([
    ...report.notices,
    ...report.limits,
    ...(report.previous.reason ? [report.previous.reason] : []),
    ...report.metrics.flatMap((metric) => [metric.current, metric.previous].flatMap(cellReasons)),
    ...report.rows.flatMap((row) => ROW_CELLS.flatMap((key) => cellReasons(row[key]))),
  ])];
}

function Value({ cell, notes, metric = false }: { cell: SocialCell; notes: string[]; metric?: boolean }) {
  const refs = cellReasons(cell).map((reason) => notes.indexOf(reason) + 1).filter((index) => index > 0);
  return (
    <span className={`${metric ? "rs-metric-value" : "rs-value"} ${cell.kind === "nd" ? "nd" : cell.kind === "lower" ? "lower" : ""}`.trim()} aria-describedby={refs.length ? refs.map((index) => `rs-note-${index}`).join(" ") : undefined} title={cell.kind === "nd" ? "Voir Vigilance et sources pour la raison de cette donnée indisponible" : undefined}>
      {cell.cents !== undefined ? <Money cents={cell.cents} /> : cell.text}
      {refs.length > 0 && <sup className="rs-note-ref">{refs.map((index) => <a key={index} href={`#rs-note-${index}`} aria-label={`Vigilance ${index}`}>[{index}]</a>)}</sup>}
    </span>
  );
}

function MetricCards({ metrics, notes, slug }: { metrics: SocialMetric[]; notes: string[]; slug: string }) {
  return (
    <dl className="rs-metrics">
      {metrics.map((metric) => (
        <div className="rs-metric" key={metric.id} data-testid={`rs-metric-${metric.id}`}>
          <dt>{metric.label}<GlossaryLink slug={slug} term={metric.term} /><span className="rs-metric-period">{periodLabel(metric.period)}</span>{metric.population && <span className="rs-metric-period" data-testid={`rs-metric-${metric.id}-population`}>Population : {metric.population}</span>}</dt>
          <dd>
            <Value cell={metric.current} notes={notes} metric />
            <span className="rs-previous"><span>N-1</span><Value cell={metric.previous} notes={notes} /></span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MonthlyTable({ rows, notes, kind }: { rows: SocialRow[]; notes: string[]; kind: "rh" | "payroll" }) {
  const columns = kind === "rh" ? RH_COLUMNS : PAYROLL_COLUMNS;
  const title = kind === "rh" ? "RH · mois par mois" : "Paie · mois par mois";
  return (
    <div className="rs-table-scroll" tabIndex={0} role="region" aria-label={title}>
      <table className="data-table rs-table" data-testid={`rs-${kind}-table`}>
        <caption>{title}{kind === "payroll" && <> · montants en <MoneyUnitLabel /></>}</caption>
        <thead><tr>
          <th scope="col">Mois</th>
          {kind === "rh" && <th scope="col" className="rs-coverage">Couverture RH</th>}
          {columns.map(([key, label]) => <th key={key} scope="col" className="num">{label}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month} data-month={row.month}>
              <th scope="row">{formatMonth(row.month)}</th>
              {kind === "rh" && <td className="rs-coverage"><Value cell={row.coverage} notes={notes} /></td>}
              {columns.map(([key]) => <td key={key} className="num"><Value cell={row[key]} notes={notes} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportView({ report, slug, workspaceName }: { report: SocialReport; slug: string; workspaceName: string }) {
  const base = `/e/${slug}/studio-rh/reporting-social`;
  const notes = reportNotes(report);
  const rh = report.metrics.filter((metric) => metric.unit !== "money");
  const payroll = report.metrics.filter((metric) => metric.unit === "money");
  const source = report.source.kind === "payfit" ? "PayFit" : report.source.kind === "dsn" ? "DSN" : "n.d.";
  return (
    <>
      {report.kind === "ready" && <form className="rs-period-controls rs-screen-only" method="get" action={base} data-testid="rs-filters">
        <input type="hidden" name="vue" value="rapport" />
        <PeriodModeFields
          initialMode={report.selection.mode}
          initialEnd={report.selection.fin}
          initialYear={String(report.selection.year)}
          ends={report.selection.closed.map((month) => ({ value: month, label: formatMonth(month) }))}
          years={report.selection.years.map((year) => ({ value: String(year.year), label: `${year.year}${year.closed ? "" : " (non close)"}` }))}
        />
        <div className="actions"><button className="btn primary" type="submit">Appliquer</button><a className="btn" href={base}>Réinitialiser</a></div>
      </form>}
      <article className="rs-report" data-testid="rs-report" aria-labelledby="rs-report-title">
        <header className="rs-report-head">
          <div>
            <span className="label">Clair · Studio RH</span>
            <h2 id="rs-report-title">Rapport de synthèse</h2>
            <p className="rs-workspace" data-testid="rs-workspace">Espace : {workspaceName}</p>
            <p className="rs-period" data-testid="rs-period">{report.window?.label ?? "Période : n.d."}</p>
            {report.previousWindow && <p className="desc" data-testid="rs-previous-period">N-1 : {report.previousWindow.label}</p>}
          </div>
          {report.kind === "ready" && <PrintAction />}
        </header>

        <details className="rs-context" data-testid="rs-context">
          <summary>Vigilance{notes.length > 0 ? ` (${notes.length})` : ""} et sources <span aria-hidden="true">?</span></summary>
          <div className="rs-context-body">
        <section className="rs-provenance" aria-label="Sources et date de référence" data-testid="rs-provenance">
          <dl className="facts">
            <div><dt>Source RH</dt><dd>{source}<small>Lecture : {fullDateTime(report.source.readAt)}</small></dd></div>
            <div><dt>Date de référence RH</dt><dd>{formatDate(report.source.referenceDate)}<small>{report.window ? `${formatMonth(report.window.from)} → ${formatMonth(report.window.to)}` : "Aucune période disponible"}</small></dd></div>
            <div><dt>Source paie</dt><dd>{report.source.payrollKind === "payfit" ? "Journal comptable PayFit" : "n.d."}<small>Lecture : {fullDateTime(report.source.payrollReadAt)}</small></dd></div>
          </dl>
        </section>
        {notes.length > 0 && <section className="rs-notes" aria-labelledby="rs-notes" data-testid="rs-notes">
          <h3 id="rs-notes">Points de vigilance</h3>
          <ol>{notes.map((note, index) => <li id={`rs-note-${index + 1}`} key={note}>{note}</li>)}</ol>
        </section>}
          </div>
        </details>

        {report.kind === "no-period" ? (
          <section className="placeholder rs-empty" data-testid="rs-no-period">
            <h3>n.d. — aucune période disponible</h3>
            <p className="desc">Les indicateurs nécessitent une lecture RH appliquée avec au moins un mois clos.</p>
            <a className="rs-screen-only" href={`/e/${slug}/donnees`}>Ouvrir Données</a>
          </section>
        ) : <>
          <section className="rs-section" aria-labelledby="rs-rh-title">
            <div className="rs-section-title"><h3 id="rs-rh-title">Repères RH</h3><span className="desc">Périmètre : tous les établissements · natures comptées de l’espace</span></div>
            <MetricCards metrics={rh} notes={notes} slug={slug} />
          </section>
          <section className="rs-section" aria-labelledby="rs-payroll-title">
            <div className="rs-section-title"><h3 id="rs-payroll-title">Masse salariale</h3><span className="desc">Réel · montants en <MoneyUnitLabel /></span></div>
            <MetricCards metrics={payroll} notes={notes} slug={slug} />
          </section>
          <section className="rs-section" aria-label="Détail mensuel du rapport" data-testid="rs-monthly">
            <MonthlyTable rows={report.rows} notes={notes} kind="rh" />
            <MonthlyTable rows={report.rows} notes={notes} kind="payroll" />
          </section>
        </>}

        <nav className="rs-links rs-screen-only" aria-label="Explorer les données du rapport">
          <a href={`/e/${slug}/studio-rh/kpi`}>Détail des KPI RH</a>
          <a href={`/e/${slug}/studio-rh/masse-salariale`}>Détail de la masse salariale</a>
          <a href={`/e/${slug}/donnees`}>Sources et lectures</a>
        </nav>
      </article>
    </>
  );
}
