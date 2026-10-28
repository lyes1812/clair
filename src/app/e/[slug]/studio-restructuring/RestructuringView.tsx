import "@/styles/masse-salariale.css";
import "@/styles/restructuring.css";
import { Money, MoneyText, MoneyUnitLabel } from "@/components/Money";
import { SearchableSelect } from "@/components/SearchableSelect";
import { FamilyTabs } from "@/components/FamilyTabs";
import { ExportMenu } from "@/components/ExportMenu";
import { BarChart, LineChart, type ChartSeries } from "@/components/charts";
import { formatDate, formatMonth } from "@/lib/dates";
import { fmtEtp4 } from "@/lib/rh/kpi/format";
import type { Amount, Hypothesis } from "@/lib/budget/types";
import type { RestructuringContext } from "@/lib/restructuring/context";
import type { Metric } from "@/lib/restructuring/model";
import { RESTRUCTURING_VIEWS as VIEWS } from "@/lib/restructuring/views";
import { ChartGuard, PanelHead, ReadDetails, Tile } from "../studio-rh/masse-salariale/components";
import { detailOf, KIND, pct } from "../studio-rh/hypotheses/shared";

const QUESTIONS = {
  overview: "Quelles économies le projet apporte-t-il, et quand absorbe-t-il ses coûts ?",
  measures: "Quelles hypothèses expliquent le projet comparé à la référence ?",
  monthly: "Comment les coûts, les économies et les ETP évoluent-ils chaque mois ?",
};
type Scenario = NonNullable<RestructuringContext["proposal"]>;
const statusLabel = (status: string) => status === "fige" ? "Figé" : status === "brouillon" ? "Brouillon" : status;
const missingReason = (metric: Metric) => metric.reason ?? "Valeur non disponible dans les scénarios comparés.";

function href(p: RestructuringContext, view = p.view, path = "", format?: string) {
  const query = new URLSearchParams({ vue: view });
  if (p.reference) query.set("reference", p.reference.id);
  if (p.proposal) query.set("projet", p.proposal.id);
  if (format) query.set("format", format);
  return `/e/${p.slug}/studio-restructuring${path}?${query}`;
}
function hypothesesHref(slug: string, scenario: Scenario | null, view?: string) {
  const query = new URLSearchParams();
  if (scenario) query.set("scenario", scenario.id);
  if (scenario && view) query.set("vue", view);
  return `/e/${slug}/studio-rh/hypotheses${query.size ? `?${query}` : ""}`;
}
function MetricValue({ metric, etp = false, signed = false }: { metric: Metric; etp?: boolean; signed?: boolean }) {
  if (metric.value === null) return <span className="nd" title={missingReason(metric)}>n.d.</span>;
  return etp ? <>{signed && metric.value > 0 ? "+" : ""}{fmtEtp4(metric.value)} ETP</> : <Money cents={metric.value} signed={signed} />;
}
function Cell({ metric, etp = false, signed = false }: { metric: Metric; etp?: boolean; signed?: boolean }) {
  return <><MetricValue metric={metric} etp={etp} signed={signed} />{metric.value === null ? <small className="restructuring-nd-reason">{missingReason(metric)}</small> : null}</>;
}

function Filters({ p }: { p: RestructuringContext }) {
  const options = p.options.map((scenario) => ({
    value: scenario.id,
    label: `${scenario.name} · ${formatMonth(scenario.firstMonth)} → ${formatMonth(scenario.lastMonth)} · ${statusLabel(scenario.status)}`,
  }));
  const chosen = (id?: string) => options.find((option) => option.value.toLowerCase() === id?.toLowerCase())?.value ?? "";
  return <form method="get" className="filters bar restructuring-filters" data-testid="restructuring-filters" aria-label="Scénarios à comparer">
    <input type="hidden" name="vue" value={p.view} />
    <div className="field-row"><label htmlFor="restructuring-reference">Scénario de référence</label><SearchableSelect id="restructuring-reference" name="reference" className="select" defaultValue={chosen(p.reference?.id)} required searchLabel="Scénario de référence" options={[{ value: "", label: "Choisir la référence…", disabled: true }, ...options]} /></div>
    <div className="field-row"><label htmlFor="restructuring-proposal">Scénario du projet</label><SearchableSelect id="restructuring-proposal" name="projet" className="select" defaultValue={chosen(p.proposal?.id)} required searchLabel="Scénario du projet" options={[{ value: "", label: "Choisir le projet…", disabled: true }, ...options]} /></div>
    <button type="submit" className="btn primary">Comparer</button>
  </form>;
}

function Reading({ p }: { p: RestructuringContext }) {
  return <div className="ms-read restructuring-read"><p className="source-badge"><span>Source :</span><strong>Scénarios des Hypothèses budgétaires</strong>{p.reference && p.proposal ? <span>— {formatMonth(p.reference.firstMonth)} → {formatMonth(p.reference.lastMonth)}</span> : null}</p><ReadDetails>
    <p>La comparaison exige la même base figée, le même horizon et les mêmes conventions de calcul.</p>
    {p.reference ? <p>Référence : <strong>{p.reference.name}</strong> · {statusLabel(p.reference.status)} · base de {formatMonth(p.reference.base.refMonth).toLowerCase()}.</p> : <p>Référence : non choisie.</p>}
    {p.proposal ? <p>Projet : <strong>{p.proposal.name}</strong> · {statusLabel(p.proposal.status)} · {p.proposal.hypotheses.length} hypothèse{p.proposal.hypotheses.length === 1 ? "" : "s"}.</p> : <p>Projet : non choisi.</p>}
    <p>Économie nette = coût de référence − coût du projet. Les coûts ponctuels sont déjà inclus ; ils ne sont pas soustraits une seconde fois.</p>
    <p>L’écart comprend toutes les différences d’hypothèses ; il ne démontre pas à lui seul l’effet des départs. Les coûts projetés ne constituent pas un calendrier de trésorerie.</p>
    <p>Les coûts de sortie sont ceux saisis dans Clair. Aucune indemnité légale ou conventionnelle n’est estimée ici.</p>
  </ReadDetails></div>;
}

function Overview({ p }: { p: RestructuringContext }) {
  const model = p.model;
  const costs: ChartSeries[] = [
    { key: "reference", name: "Référence", color: "var(--chart-2)", values: model.months.map((month) => month.referenceCost.value), reasons: model.months.map((month) => month.referenceCost.reason) },
    { key: "proposal", name: "Projet", color: "var(--chart-1)", values: model.months.map((month) => month.proposalCost.value), reasons: model.months.map((month) => month.proposalCost.reason) },
  ];
  const cumulative: ChartSeries[] = [{ key: "cumulative", name: "Économie nette cumulée", values: model.months.map((month) => month.cumulative.value), reasons: model.months.map((month) => month.cumulative.reason), color: "var(--chart-1)" }];
  const axis = model.months.map((month) => formatMonth(month.month).split(" ")[0]);
  const titles = model.months.map((month) => formatMonth(month.month));
  return <>
    <dl className="facts ms-tiles four restructuring-tiles" data-testid="restructuring-kpis">
      <Tile testid="restructuring-net-savings" label="Économie nette sur l’horizon" main nd={model.totals.savings.value === null} value={<MetricValue metric={model.totals.savings} signed />} lead="Σ (coût de référence − coût du projet)" compare={model.totals.savings.value === null ? missingReason(model.totals.savings) : "Coûts ponctuels déjà inclus"} sparkline={model.months.map((month) => month.savings.value)} />
      <Tile testid="restructuring-transition-cost" label="Coûts ponctuels supplémentaires" nd={model.totals.transitionCost.value === null} value={<MetricValue metric={model.totals.transitionCost} signed />} lead="Coûts ponctuels du projet − référence" compare={model.totals.transitionCost.value === null ? missingReason(model.totals.transitionCost) : "Déjà inclus dans l’économie nette"} />
      <Tile testid="restructuring-etp-delta" label="Écart ETP au dernier mois" nd={model.endEtpDelta.value === null} value={<MetricValue metric={model.endEtpDelta} etp signed />} lead="ETP de référence − ETP du projet" compare={model.endEtpDelta.value === null ? missingReason(model.endEtpDelta) : model.months.length ? formatMonth(model.months[model.months.length - 1].month) : undefined} />
      <Tile testid="restructuring-payback" label="Équilibre cumulé" nd={!model.payback.month} value={model.payback.month ? formatMonth(model.payback.month) : "n.d."} lead="Premier cumul ≥ 0 après un déficit, sans rechute sur l’horizon" compare={model.payback.reason} />
    </dl>
    <div className="restructuring-charts">
      <section className="panel restructuring-section"><PanelHead title="Coût employeur : référence et projet" desc="Même base figée et même horizon" /><ChartGuard testid="restructuring-costs" title="Coût employeur mensuel" series={costs}><LineChart testid="restructuring-costs" label="Coût employeur mensuel de référence et du projet" categories={axis} categoryTitles={titles} series={costs} unit="eur" height={280} /></ChartGuard></section>
      <section className="panel restructuring-section"><PanelHead title="Économie nette cumulée" desc="Cumul des écarts mensuels, coûts ponctuels inclus" /><ChartGuard testid="restructuring-cumulative" title="Économie nette cumulée" series={cumulative}><BarChart testid="restructuring-cumulative" label="Économie nette cumulée de la référence moins le projet" categories={axis} categoryTitles={titles} series={cumulative} unit="eur" height={280} /></ChartGuard></section>
    </div>
  </>;
}

function AmountInput({ amount }: { amount: Amount }) {
  return amount.mode === "charge" ? <><Money cents={amount.costCents} /> chargés</> : <><Money cents={amount.brutCents} /> brut + charges {pct(amount.chargesBps)}</>;
}
function datesOf(h: Hypothesis): string {
  switch (h.kind) {
    case "depart": return `Dernier jour payé : ${formatDate(h.lastPaidDate)}`;
    case "embauche": return `${formatDate(h.start)} → ${h.end ? formatDate(h.end) : "sans fin déclarée"}`;
    case "changement": case "augmentation": return `À partir de ${formatMonth(h.from).toLowerCase()}`;
    case "absence": return `${formatDate(h.from)} → ${formatDate(h.to)}`;
    case "ponctuel": case "realise": return formatMonth(h.month);
    case "enveloppe": case "constante": {
      const months = Object.keys(h.kind === "enveloppe" ? h.monthly : h.values).sort();
      return months.length ? `${formatMonth(months[0])} → ${formatMonth(months[months.length - 1])}` : "Aucun mois saisi";
    }
    default: return "Horizon du scénario";
  }
}
function MeasureValue({ h, proposal }: { h: Hypothesis; proposal: Scenario }) {
  switch (h.kind) {
    case "depart": return h.exitCost === null ? <span className="nd">n.d. — coût de sortie non saisi</span> : <><span>Coût de sortie saisi : </span><AmountInput amount={h.exitCost} /></>;
    case "embauche": return <><span><Money cents={h.grossFullTimeCents} /> brut mensuel temps plein × {pct(h.quotaBps)} ; charges {pct(h.chargesBps)}.</span>{h.replaces ? <small>Remplacement lié à : {proposal.hypotheses.find((item) => item.id === h.replaces && item.kind === "depart")?.label ?? "départ non disponible"}.</small> : <small>Embauche sans départ lié.</small>}</>;
    case "ponctuel": return <><AmountInput amount={h.amount} /><small>{h.nonRecurring ? "Marqué non récurrent." : "Coût ponctuel saisi."}</small></>;
    case "enveloppe": return <><span>{h.axis === "service" ? "Service" : "Rubrique"} : {h.target}</span><ul className="restructuring-values">{Object.entries(h.monthly).sort(([a], [b]) => a.localeCompare(b)).map(([month, cents]) => <li key={month}>{formatMonth(month)} : <Money cents={cents} />{h.chargesBps === null ? " chargés" : ` brut + charges ${pct(h.chargesBps)}`}</li>)}</ul>{!Object.keys(h.monthly).length ? <span className="nd">n.d. — aucun montant saisi</span> : null}</>;
    default: return <MoneyText>{detailOf(h, proposal.base, proposal.hypotheses)}</MoneyText>;
  }
}
function Measures({ p }: { p: RestructuringContext }) {
  const proposal = p.proposal;
  if (!proposal) return <p className="notice">Choisis le scénario du projet pour lire ses mesures.</p>;
  if (!p.canEdit) return <section className="panel restructuring-section" data-testid="restructuring-measures-readonly"><PanelHead title="Mesures du projet" /><p>{proposal.hypotheses.length} hypothèse{proposal.hypotheses.length === 1 ? "" : "s"} dans le projet. Ton rôle donne accès à la synthèse agrégée ; les détails individuels des mesures ne sont pas affichés.</p></section>;
  return <section className="panel restructuring-section"><PanelHead title="Hypothèses du projet" desc={`${proposal.hypotheses.length} mesure${proposal.hypotheses.length === 1 ? "" : "s"} · montants saisis, sans estimation d’indemnité`} tools={<a className="btn" href={hypothesesHref(p.slug, proposal, "postes")}>{proposal.status === "brouillon" ? "Modifier dans Hypothèses" : "Ouvrir ou dupliquer dans Hypothèses"}</a>} />
    {proposal.hypotheses.length ? <div className="table-wrap scroll restructuring-scroll" tabIndex={0} role="region" aria-label="Mesures saisies dans le scénario du projet"><table className="data-table sticky sticky-first restructuring-measures" data-testid="restructuring-measures-table"><thead><tr><th scope="col">Type</th><th scope="col">Mesure</th><th scope="col">Dates</th><th scope="col">Coûts et paramètres saisis</th></tr></thead><tbody>{proposal.hypotheses.map((h) => <tr key={h.id}><th scope="row">{h.kind === "embauche" && h.replaces ? "Remplacement" : KIND[h.kind]}</th><td>{h.label}</td><td>{datesOf(h)}</td><td><MeasureValue h={h} proposal={proposal} /></td></tr>)}</tbody></table></div> : <p className="desc">Aucune hypothèse dans ce projet. Prépare les mesures dans les Hypothèses budgétaires.</p>}
  </section>;
}

function Monthly({ p }: { p: RestructuringContext }) {
  return <section className="panel restructuring-section"><PanelHead title="Coûts et économies par mois" desc={<>Montants en <MoneyUnitLabel /> · ETP de fin de mois</>} />
    <p className="desc">Économie nette = référence − projet ; cumul = somme des économies mensuelles. Les coûts ponctuels supplémentaires sont déjà inclus dans cet écart. Sorties et remplacements liés sont les coûts du projet, chacun déjà inclus dans son coût total ; ils ne s’ajoutent pas. Un remplacement n’est pas nécessairement non récurrent.</p>
    <div className="table-wrap scroll restructuring-scroll" tabIndex={0} role="region" aria-label="Comparaison mensuelle de la référence et du projet"><table className="data-table sticky sticky-first restructuring-monthly" data-testid="restructuring-monthly-table"><thead><tr><th scope="col">Mois</th><th scope="col" className="num">Coût référence</th><th scope="col" className="num">Coût projet</th><th scope="col" className="num">Économie nette</th><th scope="col" className="num">Cumul</th><th scope="col" className="num">Ponctuels supplémentaires</th><th scope="col" className="num">Sorties du projet</th><th scope="col" className="num">Remplacements liés du projet</th><th scope="col" className="num">ETP référence</th><th scope="col" className="num">ETP projet</th></tr></thead><tbody>{p.model.months.map((row) => <tr key={row.month} data-testid={`restructuring-month-${row.month}`}><th scope="row">{formatMonth(row.month)}</th><td className="num"><Cell metric={row.referenceCost} /></td><td className="num"><Cell metric={row.proposalCost} /></td><td className="num"><Cell metric={row.savings} signed /></td><td className="num"><Cell metric={row.cumulative} signed /></td><td className="num"><Cell metric={row.transitionCost} signed /></td><td className="num"><Cell metric={row.exitCost} signed /></td><td className="num"><Cell metric={row.replacementCost} signed /></td><td className="num"><Cell metric={row.referenceEtp4} etp /></td><td className="num"><Cell metric={row.proposalEtp4} etp /></td></tr>)}</tbody></table></div>
  </section>;
}

export function RestructuringView(p: RestructuringContext) {
  const valid = p.model.kind === "value";
  const notices = [...new Set([...p.notices, ...p.model.warnings])];
  return <div className="restructuring-view" data-testid="studio-restructuring">
    <header className="restructuring-header"><div className="ms-head"><span className="label">Studio Restructuring</span><h1>{VIEWS.find((view) => view.id === p.view)?.label}</h1><p className="desc">{QUESTIONS[p.view]}</p></div>{valid && p.reference && p.proposal ? <ExportMenu testid="restructuring-export" options={[{ label: "Excel — comparaison agrégée", href: href(p, p.view, "/export", "xlsx") }, { label: "CSV — comparaison agrégée", href: href(p, p.view, "/export", "csv") }]} /> : null}</header>
    <FamilyTabs current={p.view} label="Vues du Studio Restructuring" testid="restructuring-tabs" tabs={VIEWS.map((view) => ({ key: view.id, label: view.label, href: href(p, view.id) }))} />
    <Reading p={p} />
    <Filters p={p} />
    {notices.length ? <ul className="restructuring-notices" data-testid="restructuring-notices">{notices.map((notice) => <li className="notice" key={notice}>{notice}</li>)}</ul> : null}
    {!valid ? <section className="panel restructuring-section" data-testid="restructuring-unavailable"><h2>Comparaison non disponible</h2><p className="nd">n.d. — {p.model.reason ?? "Choisis une référence et un projet comparables."}</p><a className="btn" href={hypothesesHref(p.slug, p.reference)}>{p.canEdit ? "Préparer ou dupliquer un scénario dans Hypothèses" : "Consulter les scénarios dans Hypothèses"}</a></section> : p.view === "overview" ? <Overview p={p} /> : p.view === "measures" ? <Measures p={p} /> : <Monthly p={p} />}
    {valid ? <div className="restructuring-actions"><a className="btn" href={hypothesesHref(p.slug, p.reference, "postes")}>Lire la référence dans Hypothèses</a><a className="btn" href={hypothesesHref(p.slug, p.proposal, "postes")}>{p.canEdit && p.proposal?.status === "brouillon" ? "Modifier le projet dans Hypothèses" : "Lire le projet dans Hypothèses"}</a>{p.canEdit && p.proposal ? <a className="btn" href={hypothesesHref(p.slug, p.proposal, "embauches")}>Préparer les remplacements</a> : null}</div> : null}
  </div>;
}

export default RestructuringView;
