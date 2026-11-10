import type { ReactNode } from "react";
import { BarChart, LineChart } from "@/components/charts";
import { Money, MoneyUnitLabel } from "@/components/Money";
import { DropdownMenu } from "@/components/DropdownMenu";
import { ViewSwitch } from "@/components/ViewSwitch";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { isMonth } from "@/lib/connectors/months";
import { formatMonth } from "@/lib/dates";
import { formatPayrollItemCents } from "@/lib/rh/payroll-items";
import { costTone, trendClass } from "@/lib/trend";
import { formatPayrollPercent, type ActualGapModel, type PayrollCell, type PayrollCompare, type PayrollDetailLine, type PayrollOrganisationModel, type PayrollTotals } from "@/lib/payroll/exploration";

export type PayrollExplorationFilters = { year: string; from: string; to: string; axis: string; referenceYear: string; display: "tout" | "graphique" | "tableau" };
export type PayrollExplorationOptions = { years: string[]; axes: { value: string; label: string }[]; referenceYears?: string[] };
export type PayrollExplorationProps = { slug: string; mode: "organisation" | "reel"; filters: PayrollExplorationFilters; options: PayrollExplorationOptions; organisation?: PayrollOrganisationModel; actualGap?: ActualGapModel };

const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const short = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const monthLabel = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? formatMonth(month) : "Mois n.d.";
const shortMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? short.format(new Date(`${month}-01T00:00:00Z`)) : "n.d.";
const periodLabel = (months: string[]) => !months.length ? "Période n.d." : months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} → ${monthLabel(months.at(-1)!)}`;
const METRICS = [{ key: "brut", label: "Brut" }, { key: "cotisations", label: "Cotisations et taxes" }, { key: "masse", label: "Coût chargé" }] as const;
const tone = (value: PayrollCell) => value.kind === "value" ? trendClass(costTone(value.cents)) : "";
type IdentityFields = { sourceContractId: string | null; contractKey: string | null; personKey: string | null; personLabel: string | null; contractLabel: string | null };

function Nd({ reason }: { reason?: string | null }) {
  return <span className="nd" title={reason ?? "Donnée non disponible dans la source."}>n.d.<span className="pye-sr"> — {reason ?? "Donnée non disponible dans la source."}</span></span>;
}
function Amount({ cell, signed = false }: { cell: PayrollCell; signed?: boolean }) {
  if (cell.kind === "nd") return <Nd reason={cell.reason} />;
  const money = <Money cents={cell.cents} signed={signed} exactText={`${signed && cell.cents > 0 ? "+" : ""}${formatPayrollItemCents(cell.cents)}`} />;
  return cell.occurrences === 0 ? <span title="Aucune ligne correspondante dans le journal complet." data-source-occurrences="0">{money}</span> : money;
}
function Percent({ compare }: { compare: PayrollCompare }) {
  return compare.pct ? <>{formatPayrollPercent(compare.pct)}</> : <Nd reason={compare.pctReason ?? "Pourcentage non calculable."} />;
}
function Help({ label, children }: { label: string; children: ReactNode }) {
  return <details className="pye-help"><summary aria-label={label}><span aria-hidden="true">?</span></summary><div>{children}</div></details>;
}
function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return <div className="pye-scroll" tabIndex={0} role="region" aria-label={label}>{children}</div>;
}
function Identity({ slug, row }: { slug: string; row: IdentityFields }) {
  const base = `/e/${slug}/studio-rh/collaborateurs`;
  return <span className="pye-identity">{row.personKey ? <a href={`${base}/p/${encodeURIComponent(row.personKey)}`}>{row.personLabel ?? "Nom non renseigné"}</a> : <span>{row.sourceContractId ? "Contrat non rattaché" : "Sans contrat dans la source"}</span>}{row.contractKey ? <a className="pye-small" href={`${base}/c/${encodeURIComponent(row.contractKey)}`}>{row.contractLabel ?? "Ouvrir le contrat"}</a> : row.sourceContractId && <span className="pye-small">{row.sourceContractId}</span>}</span>;
}
function GroupLabel({ group }: { group: { kind: string; label: string } }) {
  return <>{group.label}{group.kind !== "code" && <span className="pye-kind" title={group.kind === "ambiguous" ? "Plusieurs codes concurrents pour cet axe sur une même ligne." : "Aucun code de cet axe dans la ligne source."}>{group.kind === "ambiguous" ? "À vérifier" : "n.d."}</span>}</>;
}
function SourceLink({ slug, syncId, children = "Lecture source" }: { slug: string; syncId: string | null; children?: ReactNode }) {
  return syncId ? <a href={`/e/${slug}/donnees/synchro/${encodeURIComponent(syncId)}`}>{children}</a> : <Nd reason="Identifiant de lecture source indisponible." />;
}
function SourceLines({ slug, lines, label }: { slug: string; lines: PayrollDetailLine[]; label: string }) {
  return <details className="pye-detail pye-source-lines"><summary>{label} · {lines.length} ligne{lines.length === 1 ? "" : "s"}</summary><Scroll label={label}><table className="data-table pye-table"><thead><tr><th scope="col">Mois</th><th scope="col">Compte / rubrique comptable</th><th scope="col">Collaborateur / contrat</th><th scope="col" className="num">Montant source</th><th scope="col">Source</th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><th scope="row">{monthLabel(line.month)}</th><td>{line.accountId}{line.accountLabel && <span className="pye-small">{line.accountLabel}</span>}<span className="pye-small">{line.rubricLabel}</span></td><td><Identity slug={slug} row={line} /></td><td className="num"><Amount cell={line.amount} /></td><td><SourceLink slug={slug} syncId={line.provenance.syncId} /></td></tr>)}</tbody></table></Scroll></details>;
}

function Controls({ slug, mode, filters, options }: PayrollExplorationProps) {
  const base = `/e/${slug}/studio-rh/masse-salariale/${mode}`;
  const yearSelect = (label: string, name: string, value: string, years: string[]) => <label className="field-row"><span>{label}</span><select className="select" name={name} defaultValue={value}>{!years.includes(value) && <option value={value}>{value || "Choisir une année"}</option>}{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>;
  return <form action={base} method="get" className="pye-filters" data-testid="payroll-exploration-filters">
    {yearSelect(mode === "reel" ? "Période A · année" : "Année", "annee", filters.year, options.years)}
    {mode === "reel" && yearSelect("Référence B · année", "reference", filters.referenceYear, options.referenceYears ?? options.years)}
    <label className="field-row"><span>Premier mois</span><select className="select" name="de" defaultValue={filters.from}>{!MONTHS.includes(filters.from) && <option value={filters.from}>Mois indisponible</option>}{MONTHS.map((month) => <option key={month} value={month}>{shortMonth(`2000-${month}`)}</option>)}</select></label>
    <label className="field-row"><span>Dernier mois</span><select className="select" name="a" defaultValue={filters.to}>{!MONTHS.includes(filters.to) && <option value={filters.to}>Mois indisponible</option>}{MONTHS.map((month) => <option key={month} value={month}>{shortMonth(`2000-${month}`)}</option>)}</select></label>
    {mode === "organisation" && <label className="field-row pye-axis-field"><span>Axe d’organisation</span><select className="select" name="axe" defaultValue={filters.axis}><option value="">Choisir un axe</option>{filters.axis && !options.axes.some((a) => a.value === filters.axis) && <option value={filters.axis}>Axe indisponible</option>}{options.axes.map((axis) => <option key={axis.value} value={axis.value}>{axis.label}</option>)}</select></label>}
    <input type="hidden" name="affichage" value={filters.display} />
    <div className="pye-actions"><button className="btn" type="submit">Afficher</button><a href={base}>Réinitialiser</a></div>
  </form>;
}
function Empty({ slug, reason, chooseAxis = false }: { slug: string; reason?: string | null; chooseAxis?: boolean }) {
  return <section className="panel pye-panel" data-testid={chooseAxis ? "payroll-choose-axis" : "payroll-exploration-nd"}><h3>{chooseAxis ? "Choisir un axe d’organisation" : "n.d. — données indisponibles"}</h3><p className="desc">{reason ?? "Aucune lecture utilisable pour cette période."}</p><a href={`/e/${slug}/donnees`}>Vérifier la lecture dans Données</a></section>;
}
function TotalCards({ totals }: { totals: PayrollTotals }) {
  return <dl className="pye-cards" data-testid="payroll-organisation-totals">{METRICS.map((metric) => <div className="pye-card" key={metric.key} data-testid={`payroll-total-${metric.key}`}><dt>{metric.label}</dt><dd><Amount cell={totals[metric.key]} /></dd></div>)}</dl>;
}
function OrganisationDetails({ slug, model }: { slug: string; model: PayrollOrganisationModel }) {
  const lines = new Map(model.lines.map((line) => [line.id, line]));
  return <section className="panel pye-panel" data-testid="payroll-organisation-details"><div className="panel-head"><h3>Comptes, contrats et source</h3><Help label="Définition du détail par organisation"><p>Chaque ligne du journal appartient à un seul groupe de l’axe choisi. Les codes absents et les affectations ambiguës restent séparés. Les regroupements du journal ne certifient pas un organigramme ni un rattachement individuel historique.</p><p>Les rubriques sont celles de la grille comptable de l’espace ; aucune rubrique de bulletin n’est reconstituée.</p></Help></div>
    <div className="pye-groups">{model.groups.map((group, index) => <details className="pye-group" key={group.key} data-testid="payroll-organisation-group"><summary><span><GroupLabel group={group} /></span><span><Amount cell={group.totals.masse} /></span></summary><div className="pye-group-body" id={`pye-group-${index}`}>
      <Scroll label={`Brut, cotisations et coût mensuels — ${group.label}`}><table className="data-table pye-table" data-testid="payroll-group-monthly"><thead><tr><th scope="col">Mois</th>{METRICS.map((metric) => <th key={metric.key} scope="col" className="num">{metric.label}</th>)}</tr></thead><tbody>{group.monthly.map((row) => <tr key={row.month}><th scope="row">{monthLabel(row.month)}</th>{METRICS.map((metric) => <td key={metric.key} className="num"><Amount cell={row.totals[metric.key]} /></td>)}</tr>)}</tbody></table></Scroll>
      <details className="pye-detail"><summary>Par compte comptable</summary><Scroll label={`Comptes comptables — ${group.label}`}><table className="data-table pye-table"><thead><tr><th scope="col">Compte</th><th scope="col">Rubrique comptable</th><th scope="col" className="num">Montant</th></tr></thead><tbody>{group.accounts.map((account) => <tr key={account.key}><th scope="row">{account.accountId}<span className="pye-small">{account.label}</span></th><td>{account.rubricLabel}</td><td className="num"><Amount cell={account.amount} /></td></tr>)}</tbody></table></Scroll></details>
      <details className="pye-detail"><summary>Par contrat</summary><Scroll label={`Contrats — ${group.label}`}><table className="data-table pye-table"><thead><tr><th scope="col">Collaborateur / contrat</th>{METRICS.map((metric) => <th key={metric.key} scope="col" className="num">{metric.label}</th>)}</tr></thead><tbody>{group.contracts.map((contract) => <tr key={contract.key}><th scope="row"><Identity slug={slug} row={contract} /></th>{METRICS.map((metric) => <td key={metric.key} className="num"><Amount cell={contract.totals[metric.key]} /></td>)}</tr>)}</tbody></table></Scroll></details>
      <SourceLines slug={slug} lines={group.lineIds.flatMap((id) => lines.has(id) ? [lines.get(id)!] : [])} label={`Lignes source — ${group.label}`} />
    </div></details>)}</div>
  </section>;
}
function organisationChart(model: PayrollOrganisationModel) {
  const cells = model.groups.map((group) => model.months.map((month) => group.monthly.find((row) => row.month === month)?.totals.masse));
  const reasons = model.months.map((month, index) => {
    const total = model.monthly.find((row) => row.month === month)?.totals.masse;
    if (!total || total.kind === "nd") return total?.kind === "nd" ? total.reason : "Total mensuel absent du graphique.";
    let positive = 0n, negative = 0n;
    for (const group of cells) {
      const cell = group[index];
      if (!cell || cell.kind === "nd") return cell?.kind === "nd" ? cell.reason : "Donnée mensuelle d’un groupe absente.";
      if (!Number.isSafeInteger(cell.cents)) return "Amplitude des montants hors de la précision sûre du graphique empilé.";
      const cents = BigInt(cell.cents);
      if (cents >= 0n) positive += cents; else negative -= cents;
    }
    return positive > BigInt(Number.MAX_SAFE_INTEGER) || negative > BigInt(Number.MAX_SAFE_INTEGER) ? "Amplitude des montants hors de la précision sûre du graphique empilé." : null;
  });
  return { reasons, series: model.groups.map((group, index) => ({
    key: group.key, name: `${group.label}${group.kind === "code" ? "" : group.kind === "ambiguous" ? " · à vérifier" : " · n.d."}`,
    values: model.months.map((_, monthIndex) => { const cell = cells[index][monthIndex]; return reasons[monthIndex] === null && cell?.kind === "value" ? cell.cents : null; }), reasons,
  })) };
}
function OrganisationView({ slug, filters, model }: { slug: string; filters: PayrollExplorationFilters; model: PayrollOrganisationModel }) {
  const showGraph = filters.display !== "tableau", showTable = filters.display !== "graphique";
  const chart = organisationChart(model);
  return <><TotalCards totals={model.totals} />
    {showGraph && <section className="panel pye-panel" data-testid="payroll-organisation-graph"><div className="panel-head"><h3>Coût chargé par organisation et par mois</h3></div><BarChart testid="payroll-organisation-chart" label="Coût chargé mensuel par groupe de l’axe choisi, en euros" categories={model.months.map(shortMonth)} categoryTitles={model.months.map(monthLabel)} series={chart.series} unit="eur" mode="stacked" toggle height={280} /></section>}
    {showTable && <><section className="panel pye-panel" data-testid="payroll-organisation-table"><div className="panel-head"><h3>Répartition sur la période</h3></div><Scroll label="Masse salariale par organisation sur la période"><table className="data-table pye-table"><thead><tr><th scope="col">Organisation</th>{METRICS.map((metric) => <th key={metric.key} className="num" scope="col">{metric.label}</th>)}<th scope="col">Détail</th></tr></thead><tbody>{model.groups.map((group, index) => <tr key={group.key} data-group={group.kind}><th scope="row"><GroupLabel group={group} /></th>{METRICS.map((metric) => <td key={metric.key} className="num"><Amount cell={group.totals[metric.key]} /></td>)}<td><a href={`#pye-group-${index}`}>Voir les comptes et contrats</a></td></tr>)}</tbody><tfoot><tr><th scope="row">Total de la période</th>{METRICS.map((metric) => <td key={metric.key} className="num"><Amount cell={model.totals[metric.key]} /></td>)}<td /></tr></tfoot></table></Scroll></section>
      <section className="panel pye-panel"><h3>Mois par mois · tous les groupes</h3><Scroll label="Brut, cotisations et coût chargé mensuels"><table className="data-table pye-table" data-testid="payroll-organisation-monthly"><thead><tr><th scope="col">Mois</th>{METRICS.map((metric) => <th key={metric.key} scope="col" className="num">{metric.label}</th>)}</tr></thead><tbody>{model.monthly.map((row) => <tr key={row.month} data-month={row.month}><th scope="row">{monthLabel(row.month)}</th>{METRICS.map((metric) => <td key={metric.key} className="num"><Amount cell={row.totals[metric.key]} /></td>)}</tr>)}</tbody></table></Scroll></section>
      <OrganisationDetails slug={slug} model={model} /></>}
  </>;
}

function CompareCells({ compare }: { compare: PayrollCompare }) {
  return <><td className="num" data-col="a"><Amount cell={compare.a} /></td><td className="num" data-col="b"><Amount cell={compare.b} /></td><td className={`num ${tone(compare.delta)}`} data-col="delta"><Amount cell={compare.delta} signed /></td><td className={`num ${tone(compare.delta)}`} data-col="pct"><Percent compare={compare} /></td></>;
}
function GapCards({ model }: { model: ActualGapModel }) {
  return <dl className="pye-cards" data-testid="payroll-gap-totals">{METRICS.map((metric) => { const row = model.totals[metric.key]; return <div className="pye-card" key={metric.key} data-testid={`payroll-gap-${metric.key}`}><dt>{metric.label} · A − B</dt><dd className={tone(row.delta)}><Amount cell={row.delta} signed /></dd><div className="pye-card-foot"><span>A : <Amount cell={row.a} /></span><span>B : <Amount cell={row.b} /></span><span className={tone(row.delta)}><Percent compare={row} /></span></div></div>; })}</dl>;
}
function GapView({ slug, filters, model }: { slug: string; filters: PayrollExplorationFilters; model: ActualGapModel }) {
  const showGraph = filters.display !== "tableau", showTable = filters.display !== "graphique";
  return <><div className="pye-comparison-periods" data-testid="payroll-gap-periods"><span><strong>A</strong> {periodLabel(model.periodA.months)}</span><span><strong>B</strong> {periodLabel(model.periodB.months)}</span><span>Écart : A − B</span></div><GapCards model={model} />
    {showGraph && <section className="panel pye-panel" data-testid="payroll-gap-graph"><h3>Coût chargé mensuel · deux périodes réelles</h3><LineChart testid="payroll-gap-chart" label="Coût chargé mensuel des périodes réelles A et B, en euros" categories={model.monthly.map((row) => shortMonth(row.monthA))} categoryTitles={model.monthly.map((row) => `A : ${monthLabel(row.monthA)} · B : ${monthLabel(row.monthB)}`)} series={(["a", "b"] as const).map((side, index) => ({ key: side, name: `${side.toUpperCase()} · ${side === "a" ? filters.year : filters.referenceYear}`, dashed: index === 1, color: index === 0 ? "var(--chart-1)" : "var(--chart-5)", values: model.monthly.map((row) => row.totals.masse[side].kind === "value" ? row.totals.masse[side].cents : null), reasons: model.monthly.map((row) => row.totals.masse[side].kind === "nd" ? row.totals.masse[side].reason : null) }))} unit="eur" zero height={280} /></section>}
    {showTable && <>
      <section className="panel pye-panel"><div className="panel-head"><h3>Coût chargé mois par mois</h3><span className="pye-small">Hausse de coût en rouge · baisse en vert</span></div><Scroll label="Comparaison mensuelle des périodes réelles A et B"><table className="data-table pye-table" data-testid="payroll-gap-monthly"><thead><tr><th scope="col">Mois A</th><th scope="col">Mois B</th><th scope="col" className="num">Réel A</th><th scope="col" className="num">Référence B</th><th scope="col" className="num">Écart A − B</th><th scope="col" className="num">Écart % / B</th></tr></thead><tbody>{model.monthly.map((row) => <tr key={row.monthA} data-month={row.monthA}><th scope="row">{monthLabel(row.monthA)}</th><td>{monthLabel(row.monthB)}</td><CompareCells compare={row.totals.masse} /></tr>)}</tbody></table></Scroll></section>
      <section className="panel pye-panel"><div className="panel-head"><h3>Rubriques comptables</h3><Help label="Définition de l’écart réel"><p>Comparaison du journal de paie sur deux périodes de même longueur. Le sens de soustraction est A − B ; le pourcentage rapporte cet écart à B.</p><p>Les paies non clôturées et les mois non lus restent n.d. Les rubriques proviennent de la grille comptable de l’espace, sans reconstruction des rubriques de bulletin ni interprétation causale des variations.</p></Help></div><Scroll label="Écart réel par rubrique comptable"><table className="data-table pye-table" data-testid="payroll-gap-rubrics"><thead><tr><th scope="col">Rubrique comptable</th><th scope="col" className="num">Réel A</th><th scope="col" className="num">Référence B</th><th scope="col" className="num">Écart A − B</th><th scope="col" className="num">Écart % / B</th></tr></thead><tbody>{model.rubrics.map((row) => <tr key={row.key} data-rubric={row.key}><th scope="row">{row.label}</th><CompareCells compare={row} /></tr>)}</tbody></table></Scroll></section>
      <section className="panel pye-panel"><h3>Comptes, contrats et source</h3>
        <details className="pye-detail"><summary>Écart par compte comptable</summary><Scroll label="Écart réel par compte comptable"><table className="data-table pye-table" data-testid="payroll-gap-accounts"><thead><tr><th scope="col">Compte</th><th scope="col" className="num">Réel A</th><th scope="col" className="num">Référence B</th><th scope="col" className="num">Écart A − B</th><th scope="col" className="num">Écart % / B</th></tr></thead><tbody>{model.accounts.map((row) => <tr key={row.key}><th scope="row">{row.accountId}<span className="pye-small">{row.label} · {row.rubricLabel}</span></th><CompareCells compare={row} /></tr>)}</tbody></table></Scroll></details>
        <details className="pye-detail"><summary>Écart par contrat</summary><Scroll label="Écart réel de coût chargé par contrat"><table className="data-table pye-table" data-testid="payroll-gap-contracts"><thead><tr><th scope="col">Collaborateur / contrat</th><th scope="col" className="num">Réel A</th><th scope="col" className="num">Référence B</th><th scope="col" className="num">Écart A − B</th><th scope="col" className="num">Écart % / B</th></tr></thead><tbody>{model.contracts.map((row) => <tr key={row.key}><th scope="row"><Identity slug={slug} row={row} /></th><CompareCells compare={row.totals.masse} /></tr>)}</tbody></table></Scroll></details>
        <SourceLines slug={slug} lines={model.lines.filter((line) => model.periodA.months.includes(line.month))} label="Lignes source de la période A" />
        <SourceLines slug={slug} lines={model.lines.filter((line) => model.periodB.months.includes(line.month))} label="Lignes source de la référence B" />
      </section>
    </>}
  </>;
}
export function PayrollExplorationView(props: PayrollExplorationProps) {
  const { slug, mode, filters, organisation, actualGap } = props;
  const model = mode === "organisation" ? organisation : actualGap;
  const chartNotices = mode === "organisation" && organisation && filters.display !== "tableau" ? organisationChart(organisation).reasons.filter((reason): reason is string => reason !== null).map((reason) => `Graphique : ${reason}`) : [];
  const notices = [...new Set([...(model?.notices ?? []), ...(model?.reason ? [model.reason] : []), ...chartNotices])];
  const source = model?.source;
  const readAt = source?.readAt && !Number.isNaN(Date.parse(source.readAt)) ? dateTimeFmt.format(new Date(source.readAt)) : "n.d.";
  const sourceReady = source?.provider === "payfit" && !!source.syncId && !!source.readAt && !Number.isNaN(Date.parse(source.readAt));
  const partialReady = !!model?.lines.length && sourceReady && (mode === "organisation"
    ? !!organisation?.axis && organisation.axes.includes(organisation.axis) && organisation.months.length > 0 && organisation.months.every(isMonth)
    : !!actualGap?.periodA.months.length && actualGap.periodA.months.length === actualGap.periodB.months.length && actualGap.periodA.months.every((m, i) => isMonth(m) && isMonth(actualGap.periodB.months[i]) && m.slice(5) === actualGap.periodB.months[i].slice(5)));
  const query = (display: PayrollExplorationFilters["display"]) => { const p = new URLSearchParams({ annee: filters.year, de: filters.from, a: filters.to, affichage: display }); if (mode === "organisation") p.set("axe", filters.axis); else p.set("reference", filters.referenceYear); return `?${p.toString()}`; };
  return <div className="pye" data-testid={`payroll-exploration-${mode}`}>
    <div className="pye-head"><div><h2>{mode === "organisation" ? "Ventilation par organisation" : "Comparaison des périodes"}</h2><p className="pye-small">{mode === "organisation" ? "Ventilation du journal selon l’axe choisi" : "Comparaison de deux périodes réelles"} · <MoneyUnitLabel /></p></div>{notices.length > 0 && <DropdownMenu className="pye-vigilance" testid="payroll-exploration-vigilance" label={<>Vigilance ({notices.length}) <span aria-hidden="true">?</span></>}><ul className="pye-vigilance-list">{notices.map((notice) => <li key={notice}>{notice}</li>)}</ul></DropdownMenu>}</div>
    <Controls {...props} />
    <div className="pye-context"><span>Source : {source?.provider === "payfit" ? "journal comptable de paie PayFit" : source?.provider === "dsn" ? "DSN" : "n.d."} · lecture du {readAt}{source?.syncId && <> · <SourceLink slug={slug} syncId={source.syncId} /></>}</span><ViewSwitch testid="payroll-exploration-display" label="Affichage des résultats" current={filters.display} options={[{ key: "tout", label: "Afficher tout", href: query("tout") }, { key: "graphique", label: "Graphique", href: query("graphique") }, { key: "tableau", label: "Tableau", href: query("tableau") }]} /></div>
    {!model || (model.kind === "nd" && !partialReady) ? <Empty slug={slug} reason={model?.reason} chooseAxis={mode === "organisation" && !filters.axis && props.options.axes.length > 0} /> : mode === "organisation" && organisation ? <OrganisationView slug={slug} filters={filters} model={organisation} /> : actualGap && <GapView slug={slug} filters={filters} model={actualGap} />}
  </div>;
}
