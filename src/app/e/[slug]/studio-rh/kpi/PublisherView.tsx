import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate, formatMonth } from "@/lib/dates";
import { definitionParagraphs } from "@/lib/glossary";
import { PUBLISHER_BLOCKS, publisherNotes, type PublisherColumn, type PublisherReport } from "@/lib/reporting/publisher";
import { MetricCards, ReportMonthlyTable } from "../reporting-social/ReportView";
import { PeriodModeFields } from "./PeriodModeFields";
import { PublisherDraftObserver, PublisherDraftProvider, PublisherPrintAction } from "./PublisherDraft";

const COLUMN_LABELS: Record<PublisherColumn, string> = {
  headcount: "Effectif fin de mois", etp: "ETP fin de mois", entries: "Entrées", exits: "Sorties", absenteeism: "Absentéisme",
};
const fullDateTime = (value: string | null) => value ? dateTimeFmt.format(new Date(value)) : "n.d.";

export function PublisherView({ report, slug, workspaceName }: { report: PublisherReport; slug: string; workspaceName: string }) {
  const notes = publisherNotes(report);
  const source = report.source.kind === "payfit" ? "PayFit" : report.source.kind === "dsn" ? "DSN" : "n.d.";
  const key = JSON.stringify([report.selection.blocks, report.selection.monthly, report.period]);
  return <PublisherDraftProvider key={key}>
    <section className="publisher-intro rs-screen-only"><h2>Publisher</h2><p className="desc">Compose un rapport KPI RH interne, puis imprime-le ou enregistre-le en PDF.</p></section>
    <PublisherDraftObserver>
    <form method="get" className="publisher-controls rs-screen-only" data-testid="publisher-form" aria-label="Composer le rapport KPI RH" key={key}>
      <input type="hidden" name="vue" value="publisher" />
      <input type="hidden" name="composition" value="1" />
      {report.period && <div className="publisher-period"><PeriodModeFields
        initialMode={report.period.mode} initialEnd={report.period.fin} initialYear={String(report.period.year)}
        ends={[...report.period.closed].reverse().map((month) => ({ value: month, label: formatMonth(month) }))}
        years={[...report.period.years].reverse().map((year) => ({ value: String(year.year), label: `${year.year}${year.closed ? "" : " (non close)"}` }))}
      /></div>}
      <fieldset><legend>Blocs du rapport</legend><div className="publisher-choices">{PUBLISHER_BLOCKS.map((block) => <label key={block.key}>
        <input type="checkbox" name="bloc" value={block.key} defaultChecked={report.selection.blocks.includes(block.key)} />
        <span>{block.label}</span>
      </label>)}</div></fieldset>
      <label className="publisher-monthly"><input type="checkbox" name="mensuel" value="1" defaultChecked={report.selection.monthly} /><span>Inclure le détail mensuel</span></label>
      <p className="desc">Périmètre : tous les établissements · population paramétrée de l’espace. Sources, vigilance et définitions sont toujours incluses.</p>
      <div className="actions"><button className="btn primary" type="submit">Prévisualiser</button><a className="btn" href="?vue=publisher">Réinitialiser</a></div>
      <p className="desc" id="publisher-apply-help">Prévisualise pour appliquer tes choix. Le PDF reprend l’aperçu ci-dessous.</p>
    </form>
    </PublisherDraftObserver>

    <article className="rs-report publisher-report" data-testid="publisher-report" aria-labelledby="publisher-title">
      <header className="rs-report-head"><div><span className="label">Clair · Studio RH</span><h2 id="publisher-title">Rapport KPI RH</h2>
        <p className="rs-workspace">Espace : {workspaceName}</p>
        <p className="rs-period" data-testid="publisher-period">{report.window?.label ?? "Période : n.d."}</p>
        {report.previousWindow && <p className="desc">N-1 : {report.previousWindow.label}</p>}
        <p className="desc" data-testid="publisher-composition">Blocs : {PUBLISHER_BLOCKS.filter((b) => report.selection.blocks.includes(b.key)).map((b) => b.label).join(" · ") || "aucun"}{report.selection.monthly ? " · détail mensuel inclus" : " · sans détail mensuel"}</p>
      </div>{report.kind === "ready" && <PublisherPrintAction />}</header>

      <details className="rs-context" data-testid="publisher-context"><summary>Vigilance{notes.length ? ` (${notes.length})` : ""} et sources <span aria-hidden="true">?</span></summary><div className="rs-context-body">
        <section className="rs-provenance" aria-label="Sources et date de référence" data-testid="publisher-provenance"><dl className="facts">
          <div><dt>Source RH</dt><dd>{source}<small>Lecture : {fullDateTime(report.source.readAt)}</small></dd></div>
          <div><dt>Date de référence RH</dt><dd>{formatDate(report.source.referenceDate)}<small>Population paramétrée de l’espace · tous les établissements</small></dd></div>
        </dl></section>
        {notes.length > 0 && <section className="rs-notes" aria-labelledby="publisher-notes" data-testid="publisher-notes"><h3 id="publisher-notes">Points de vigilance</h3><ol>{notes.map((note, index) => <li id={`rs-note-${index + 1}`} key={note}>{note}</li>)}</ol></section>}
      </div></details>

      {report.kind !== "ready" ? <section className="placeholder rs-empty" data-testid="publisher-unavailable"><h3>{report.kind === "empty" ? "Aucun bloc sélectionné" : "n.d. — rapport indisponible"}</h3><p>{report.reason}</p>
        {report.kind === "settings-invalid" ? <a className="rs-screen-only" href={`/e/${slug}/parametres#kpi`}>Vérifier les définitions des KPI</a> : report.kind !== "empty" && <a className="rs-screen-only" href={`/e/${slug}/donnees`}>Vérifier les sources</a>}
      </section> : <>
        {PUBLISHER_BLOCKS.filter((block) => report.selection.blocks.includes(block.key)).map((block) => <section className="rs-section" aria-labelledby={`publisher-${block.key}`} key={block.key} data-testid={`publisher-block-${block.key}`}>
          <div className="rs-section-title"><h3 id={`publisher-${block.key}`}>{block.label}</h3></div>
          <MetricCards metrics={report.metrics.filter((metric) => (block.metrics as readonly string[]).includes(metric.id))} notes={notes} slug={slug} />
        </section>)}
        {report.selection.monthly && <section className="rs-section" aria-label="Détail mensuel du rapport" data-testid="publisher-monthly">
          <ReportMonthlyTable rows={report.rows} notes={notes} title="RH · mois par mois" testid="publisher-rh-table" columns={report.columns.map((column) => [column, COLUMN_LABELS[column]] as const)} />
        </section>}
        <details className="rs-context publisher-definitions" data-testid="publisher-definitions"><summary>Définitions et paramètres <span aria-hidden="true">?</span></summary><div className="rs-context-body">
          <section aria-labelledby="publisher-definitions-title"><h3 id="publisher-definitions-title">Définitions des indicateurs</h3><div className="publisher-definition-list">{report.definitions.map((entry) => <section key={entry.id}>
            <h4>{entry.term}</h4>{entry.formula && <p className="publisher-formula">{entry.formula}</p>}{definitionParagraphs(entry.definition).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </section>)}</div></section>
          <section aria-labelledby="publisher-parameters-title"><h3 id="publisher-parameters-title">Paramètres en vigueur</h3><dl className="publisher-parameter-list">{report.parameters.map((parameter) => <div key={parameter.label}><dt>{parameter.label}</dt><dd>{parameter.value}<small>{parameter.origin}</small></dd></div>)}</dl></section>
        </div></details>
      </>}
      <nav className="rs-links rs-screen-only" aria-label="Explorer les données du rapport"><a href={`/e/${slug}/studio-rh/kpi`}>Détail des KPI RH</a><a href={`/e/${slug}/parametres#kpi`}>Définitions des KPI</a><a href={`/e/${slug}/donnees`}>Sources et lectures</a></nav>
    </article>
  </PublisherDraftProvider>;
}
