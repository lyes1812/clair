import { DropdownMenu } from "@/components/DropdownMenu";
import { GlossaryLink } from "@/components/GlossaryLink";
import { Money, MoneyUnitLabel } from "@/components/Money";
import { ViewSwitch } from "@/components/ViewSwitch";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatMonth } from "@/lib/dates";
import { ECART_TERMS } from "@/lib/glossary/ecart";
import { fmtPercent } from "@/lib/rh/kpi/format";
import { costTone, trendClass } from "@/lib/trend";
import type { SuiviCell, SuiviGap, SuiviModel } from "@/lib/viz/suivi-budget";
import { SuiviChart } from "./SuiviChart";

function Amount({ value, href, signed = false }: { value: SuiviCell | SuiviGap; href?: string | null; signed?: boolean }) {
  if (value.kind === "nd") return <abbr className="nd" title={value.reason}>n.d.</abbr>;
  const content = <Money cents={value.cents} signed={signed} />;
  return href ? <a href={href}>{content}</a> : content;
}

function Percent({ value }: { value: SuiviGap }) {
  if (value.kind === "nd") return <abbr className="nd" title={value.reason}>n.d.</abbr>;
  if (!value.pct) return <abbr className="nd" title={value.pctReason ?? "pourcentage non défini"}>n.d.</abbr>;
  return <>{value.pct.num > 0 ? "+" : ""}{fmtPercent(value.pct)}</>;
}

function vigilanceOf(model: SuiviModel): string[] {
  const notes = new Set<string>([...model.notices, ...(model.reason ? [model.reason] : [])]);
  for (const [label, value] of [["Cumul réel", model.totals.actual], ["Cumul de référence", model.totals.reference], ["Écart cumulé", model.totals.gap]] as const)
    if (value.kind === "nd") notes.add(`${label} : ${value.reason}`);
  if (model.totals.gap.kind === "value" && model.totals.gap.pctReason) notes.add(`Écart cumulé (%) : ${model.totals.gap.pctReason}`);
  const groups = new Map<string, string[]>();
  for (const row of model.rows) {
    for (const [label, value] of [["Réel", row.actual], ["Référence", row.reference], ["Écart", row.gap]] as const) {
      if (value.kind !== "nd") continue;
      const key = `${label} : ${value.reason}`;
      groups.set(key, [...(groups.get(key) ?? []), formatMonth(row.month)]);
    }
    if (row.gap.kind === "value" && row.gap.pctReason) {
      const key = `Écart (%) : ${row.gap.pctReason}`;
      groups.set(key, [...(groups.get(key) ?? []), formatMonth(row.month)]);
    }
  }
  for (const [reason, months] of groups) notes.add(`${months.join(", ")} — ${reason}`);
  return [...notes];
}

export function SuiviView({ model }: { model: SuiviModel }) {
  const base = `/e/${model.slug}/studio-rh/masse-salariale/suivi`;
  const href = (affichage: string) => `${base}?${new URLSearchParams({ annee: model.state.annee, reference: model.state.reference, cloture: model.state.cloture, affichage })}`;
  const notes = vigilanceOf(model);
  const tone = model.totals.gap.kind === "value" ? trendClass(costTone(model.totals.gap.cents)) : "";
  const cumulative = model.cutoff ? `Janvier → ${formatMonth(model.cutoff).toLowerCase()}` : `Année ${model.state.annee || "n.d."} · clôture n.d.`;
  const showChart = model.state.affichage !== "tableau";
  const showTable = model.state.affichage !== "graphique";
  const drawn = [...model.chart.actual, ...model.chart.reference].some((value) => value !== null);
  return (
    <div className="suivi-page" data-testid="suivi-budget">
      <header className="suivi-head">
        <div><h2>Suivi réel / budget</h2><p className="desc">Masse salariale chargée · tous les services</p></div>
        {notes.length > 0 && <DropdownMenu testid="suivi-vigilance" className="suivi-vigilance" label={<>Vigilance ({notes.length}) <span className="suivi-help" aria-hidden="true">?</span></>}>
          <div className="suivi-vigilance-body"><h3>Points à vérifier</h3><ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul></div>
        </DropdownMenu>}
      </header>

      <form className="suivi-filters" method="get" action={base} data-testid="suivi-filters">
        <input type="hidden" name="affichage" value={model.state.affichage} />
        <div className="field-row"><label htmlFor="suivi-annee">Année</label><select className="select" id="suivi-annee" name="annee" defaultValue={model.state.annee}>
          {(!model.years.length || !model.state.annee) && <option value="">{model.years.length ? "Choisir une année" : "Aucune année disponible"}</option>}
          {model.years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select></div>
        <div className="field-row suivi-reference-field"><label htmlFor="suivi-reference">Budget ou scénario de référence</label><select className="select" id="suivi-reference" name="reference" defaultValue={model.state.reference} data-testid="suivi-reference">
          <option value="">Choisir une référence</option>
          {(["budget", "scenario"] as const).map((kind) => {
            const options = model.options.filter((option) => option.kind === kind);
            return options.length > 0 ? <optgroup key={kind} label={kind === "budget" ? "Budgets saisis" : "Scénarios"}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup> : null;
          })}
        </select></div>
        <div className="field-row"><label htmlFor="suivi-cloture">Dernier mois clos retenu</label><select className="select" id="suivi-cloture" name="cloture" defaultValue={model.state.cloture}>
          <option value="">{model.cutoffOptions.length ? "Choisir un mois clos" : "Aucun mois clos"}</option>
          {model.cutoffOptions.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
        </select></div>
        <div className="actions"><button className="btn primary" type="submit">Appliquer</button><a className="btn" href={base}>Réinitialiser</a></div>
      </form>

      <div className="suivi-context">
        <p className="desc" data-testid="suivi-source">Source : <a href={model.source.href}>{model.source.label}</a> · lecture : {model.source.readAt ? dateTimeFmt.format(new Date(model.source.readAt)) : "n.d."}</p>
        {model.reference && <a className="suivi-reference-link" href={model.reference.href}>{model.reference.kind === "budget" ? "Budget" : "Scénario"} : {model.reference.label}</a>}
      </div>
      {!model.reference && <p className="notice" data-testid="suivi-choose-reference">Choisis un budget ou un scénario de référence pour calculer les écarts.</p>}

      <section className="suivi-summary" aria-labelledby="suivi-cumulative-title">
        <div className="suivi-section-head"><h3 id="suivi-cumulative-title">Cumul à la clôture</h3><span className="desc" data-testid="suivi-period">{cumulative} · montants en <MoneyUnitLabel /></span></div>
        <dl className="suivi-tiles">
          <div className="suivi-tile" data-testid="suivi-total-actual"><dt>Réel PayFit</dt><dd><Amount value={model.totals.actual} /></dd></div>
          <div className="suivi-tile" data-testid="suivi-total-reference"><dt>Référence</dt><dd><Amount value={model.totals.reference} /></dd><span className="suivi-tile-foot">{model.reference?.label ?? "Non choisie"}</span></div>
          <div className="suivi-tile" data-testid="suivi-total-gap"><dt>Écart · réel − référence<GlossaryLink slug={model.slug} term={ECART_TERMS.ecart} /></dt><dd className={tone}><Amount value={model.totals.gap} signed /></dd><span className={`suivi-tile-foot ${tone}`.trim()}><Percent value={model.totals.gap} /></span></div>
        </dl>
      </section>

      <section className="panel suivi-monthly" aria-labelledby="suivi-monthly-title">
        <div className="suivi-section-head"><h3 id="suivi-monthly-title">Mois par mois · {model.state.annee || "n.d."}</h3><ViewSwitch testid="suivi-affichage" current={model.state.affichage} label="Affichage du suivi" options={[
          { key: "tout", label: "Afficher tout", href: href("tout") },
          { key: "graphique", label: "Graphique", href: href("graphique") },
          { key: "tableau", label: "Tableau", href: href("tableau") },
        ]} /></div>
        {showChart && (drawn ? <SuiviChart model={model} /> : <p className="nd" data-testid="suivi-chart-nd">n.d. — aucune valeur à tracer avec cette sélection.</p>)}
        {showTable && <div className="suivi-table-scroll" tabIndex={0} role="region" aria-label="Suivi mensuel du réel et de la référence">
          <table className="data-table suivi-table" data-testid="suivi-table">
            <caption className="suivi-sr">Masse salariale chargée mensuelle, montants en <MoneyUnitLabel />. Les montants liés ouvrent leur détail.</caption>
            <thead><tr><th scope="col">Mois</th><th scope="col" className="num">Réel PayFit</th><th scope="col" className="num">Référence</th><th scope="col" className="num">Écart</th><th scope="col" className="num">Écart (%)</th><th scope="col">Origine de la référence</th></tr></thead>
            <tbody>{model.rows.map((row) => {
              const rowTone = row.gap.kind === "value" ? trendClass(costTone(row.gap.cents)) : "";
              return <tr key={row.month} data-month={row.month} className={row.afterCutoff ? "suivi-after-cutoff" : undefined}>
                <th scope="row">{formatMonth(row.month)}{row.afterCutoff && <span className="suivi-after-label">Après clôture</span>}</th>
                <td className="num" data-col="actual"><Amount value={row.actual} href={row.actualHref} /></td>
                <td className="num" data-col="reference"><Amount value={row.reference} href={row.referenceHref} /></td>
                <td className={`num ${rowTone}`.trim()} data-col="gap"><Amount value={row.gap} signed /></td>
                <td className={`num ${rowTone}`.trim()} data-col="pct"><Percent value={row.gap} /></td>
                <td data-col="origin">{row.origin ?? "—"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        <p className="suivi-trend-key desc">Écart de coût : <span className="trend-bad">hausse</span> · <span className="trend-good">baisse</span></p>
      </section>
    </div>
  );
}
