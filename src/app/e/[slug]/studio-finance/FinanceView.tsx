import "@/styles/finance.css";
import { Money, MoneyUnitLabel } from "@/components/Money";
import { FamilyTabs } from "@/components/FamilyTabs";
import { ExportMenu } from "@/components/ExportMenu";
import { SourceBadge } from "@/components/SourceBadge";
import { BarChart, LineChart, type ChartSeries } from "@/components/charts";
import { formatMonth } from "@/lib/dates";
import { FINANCE_ROWS, type FinanceCell, type FinanceMonth, type FinancePlan, type FinanceRowId } from "@/lib/finance/types";
import { FINANCE_VIEWS, type FinanceViewProps } from "@/lib/finance/view-types";
import { ActionForm } from "../studio-rh/hypotheses/ActionForm";
import { Field } from "../studio-rh/hypotheses/shared";
import { FinancePlanGrid } from "./FinancePlanGrid";

const QUESTIONS = {
  overview: "Où en est le résultat, et que prévoit-on pour la fin de l’année ?",
  pnl: "Quels produits et quelles charges expliquent le résultat mois par mois ?",
  mapping: "À quelle ligne de gestion chaque compte comptable est-il rattaché ?",
  plans: "Quelles hypothèses retenir pour le budget et les mois à venir ?",
  variance: "Quelles lignes s’écartent du budget, et de combien ?",
};
const notAvailable = (reason: string): FinanceCell => ({ cents: null, reason });
const absent = notAvailable("Mois absent de cette lecture.");
const wholeYear = (year: number) => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
const previousMonth = (month: string) => `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
const labelOfPlan = (plan: FinancePlan) => `${plan.name} · ${plan.kind === "budget" ? "Budget" : "Prévision"} ${plan.year}`;

// Une période incomplète ne devient jamais un cumul partiel présenté comme complet.
function total(cells: FinanceCell[]): FinanceCell {
  if (!cells.length) return notAvailable("Aucun mois dans cette période.");
  const missing = cells.filter((cell) => cell.cents === null);
  if (missing.length) return notAvailable([...new Set(missing.map((cell) => cell.reason ?? "Montant non renseigné."))].join(" · "));
  const sum = cells.reduce((value, cell) => value + BigInt(cell.cents!), 0n);
  return sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < BigInt(Number.MIN_SAFE_INTEGER)
    ? notAvailable("Cumul hors des limites des centimes entiers sûrs.") : { cents: Number(sum), reason: null };
}
function difference(actual: FinanceCell, reference: FinanceCell): FinanceCell {
  if (actual.cents === null || reference.cents === null) return notAvailable([actual.cents === null ? `Réel : ${actual.reason ?? "non renseigné"}` : null, reference.cents === null ? `Référence : ${reference.reason ?? "non renseignée"}` : null].filter(Boolean).join(" · "));
  return total([actual, { cents: -reference.cents, reason: null }]);
}
function valueAt(rows: FinanceMonth[], month: string, row: FinanceRowId | "result"): FinanceCell {
  const found = rows.find((value) => value.month === month);
  return found ? row === "result" ? found.result : found.cells[row] : absent;
}
function periodTotal(rows: FinanceMonth[], months: string[], row: FinanceRowId | "result"): FinanceCell {
  return total(months.map((month) => valueAt(rows, month, row)));
}
function Amount({ cell, signed = false }: { cell: FinanceCell; signed?: boolean }) {
  return cell.cents === null ? <span className="nd" title={cell.reason ?? "Montant non renseigné"}>n.d.<span className="finance-nd-reason"> — {cell.reason ?? "Montant non renseigné"}</span></span> : <span title={cell.reason ?? undefined}><Money cents={cell.cents} signed={signed} /></span>;
}
function series(rows: FinanceMonth[], months: string[], row: FinanceRowId | "result", key: string, name: string, previous = false): ChartSeries {
  const cells = months.map((month) => valueAt(rows, previous ? previousMonth(month) : month, row));
  return { key, name, values: cells.map((cell) => cell.cents), reasons: cells.map((cell) => cell.reason), dashed: previous };
}
function href(p: FinanceViewProps, overrides: Record<string, string | null> = {}, path = "") {
  const params = new URLSearchParams({ vue: p.view, annee: String(p.year), debut: p.from, fin: p.to });
  if (p.selectedPlan) params.set("plan", p.selectedPlan.id);
  if (p.selectedBudget) params.set("budget", p.selectedBudget.id);
  for (const [key, value] of Object.entries(overrides)) value === null ? params.delete(key) : params.set(key, value);
  return `/e/${p.slug}/studio-finance${path}?${params}`;
}

function Filters({ p }: { p: FinanceViewProps }) {
  const years = [...new Set([...p.years, p.year])].sort((a, b) => a - b);
  return <form method="get" className="filters bar finance-filters" data-testid="finance-filters">
    <input type="hidden" name="vue" value={p.view} />
    <Field id="finance-year" label="Année"><select id="finance-year" name="annee" className="select" defaultValue={p.year}>{years.map((year) => <option key={year}>{year}</option>)}</select></Field>
    <Field id="finance-from" label="Premier mois"><select id="finance-from" name="debut" className="select" defaultValue={p.from}>{wholeYear(p.year).map((month) => <option key={month} value={month}>{formatMonth(month).split(" ")[0]}</option>)}</select></Field>
    <Field id="finance-to" label="Dernier mois"><select id="finance-to" name="fin" className="select" defaultValue={p.to}>{wholeYear(p.year).map((month) => <option key={month} value={month}>{formatMonth(month).split(" ")[0]}</option>)}</select></Field>
    <Field id="finance-selected-plan" label="Plan affiché"><select id="finance-selected-plan" name="plan" className="select" defaultValue={p.selectedPlan?.id ?? ""}><option value="">Aucun plan sélectionné</option>{p.plans.filter((plan) => plan.year === p.year).map((plan) => <option key={plan.id} value={plan.id}>{labelOfPlan(plan)}</option>)}</select></Field>
    <Field id="finance-selected-budget" label="Budget de comparaison"><select id="finance-selected-budget" name="budget" className="select" defaultValue={p.selectedBudget?.id ?? ""}><option value="">Aucun budget sélectionné</option>{p.plans.filter((plan) => plan.year === p.year && plan.kind === "budget").map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></Field>
    <button className="btn primary" type="submit">Appliquer</button>
  </form>;
}

function MonthlyTable({ rows, months, title, testid }: { rows: FinanceMonth[]; months: string[]; title: string; testid: string }) {
  return <div className="table-wrap scroll" tabIndex={0} role="region" aria-label={title}>
    <table className="data-table finance-table" data-testid={testid}>
      <caption>{title} · <MoneyUnitLabel /></caption>
      <thead><tr><th scope="col">Ligne financière</th>{months.map((month) => <th scope="col" className="num" key={month}>{formatMonth(month)}</th>)}<th scope="col" className="num">Cumul</th></tr></thead>
      <tbody>{[...FINANCE_ROWS, { id: "result" as const, label: "Résultat", kind: "income" }].map((row) => <tr key={row.id} className={row.id === "result" ? "finance-result" : undefined}><th scope="row">{row.label}</th>{months.map((month) => <td className="num" key={month}><Amount cell={valueAt(rows, month, row.id)} /></td>)}<td className="num"><Amount cell={periodTotal(rows, months, row.id)} /></td></tr>)}</tbody>
    </table>
  </div>;
}

function Overview({ p }: { p: FinanceViewProps }) {
  const cards = [FINANCE_ROWS[0], FINANCE_ROWS[2], FINANCE_ROWS[3], { id: "result" as const, label: "Résultat" }];
  const previousMonths = p.months.map(previousMonth);
  return <>
    <dl className="finance-kpis" data-testid="finance-overview-kpis">{cards.map((row) => {
      const current = periodTotal(p.actuals.months, p.months, row.id);
      const prior = periodTotal(p.previous.months, previousMonths, row.id);
      return <div key={row.id} className="finance-kpi"><dt>{row.label}</dt><dd><Amount cell={current} /></dd><p className="desc">N−1 : <Amount cell={prior} /></p><div className="finance-spark"><LineChart testid={`finance-spark-${row.id}`} label={`${row.label}, réel et année précédente`} categories={p.months.map((month) => formatMonth(month).split(" ")[0])} series={[series(p.actuals.months, p.months, row.id, "actual", "Réel"), series(p.previous.months, p.months, row.id, "previous", "N−1", true)]} unit="eur" height={100} /></div></div>;
    })}</dl>
    <section className="panel finance-section"><h2>Produits et charges par mois</h2><BarChart testid="finance-overview-months" label="Produits et charges comptables par mois" categories={p.months.map((month) => formatMonth(month).split(" ")[0])} categoryTitles={p.months.map(formatMonth)} series={FINANCE_ROWS.map((row) => series(p.actuals.months, p.months, row.id, row.id, row.label))} unit="eur" mode="grouped" note="Les charges sont présentées positives ; elles sont soustraites des produits pour calculer le résultat." /></section>
    <section className="panel finance-section"><h2>Résultat : réel, plan et budget</h2><LineChart testid="finance-result-chart" label="Résultat réel, plan et budget sélectionnés" categories={p.months.map((month) => formatMonth(month).split(" ")[0])} categoryTitles={p.months.map(formatMonth)} series={[series(p.actuals.months, p.months, "result", "actual", "Réel"), ...(p.projection ? [series(p.projection, p.months, "result", "plan", p.selectedPlan?.name ?? "Plan")] : []), ...(p.budgetMonths ? [series(p.budgetMonths, p.months, "result", "budget", p.selectedBudget?.name ?? "Budget")] : [])]} unit="eur" />{!p.selectedPlan ? <p className="desc">Sélectionne un plan pour afficher la prévision ; aucune hypothèse n’est choisie à ta place.</p> : <p className="desc">{p.selectedPlan.name} : {p.selectedPlan.kind === "forecast" ? `réel comptable avant ${formatMonth(p.selectedPlan.firstForecastMonth!)}, hypothèses ensuite.` : "hypothèses budgétaires sur les douze mois."} Personnel projeté : {p.selectedPlan.personnelSource === "rh" ? p.rhOptions.find((option) => option.id === p.selectedPlan!.rhScenarioId)?.name ?? "scénario RH sélectionné indisponible" : "saisie du plan"}.</p>}</section>
  </>;
}

function Pnl({ p }: { p: FinanceViewProps }) {
  return <>
    <section className="panel finance-section"><h2>Compte de résultat réel</h2><MonthlyTable rows={p.actuals.months} months={p.months} title={`Réel ${p.year}`} testid="finance-pnl-table" /><p className="desc">Résultat = chiffre d’affaires + autres produits − charges de personnel − autres charges.</p></section>
    <section className="panel finance-section"><h2>Comparaison avec {p.year - 1}</h2><MonthlyTable rows={p.previous.months} months={p.months.map(previousMonth)} title={`Réel ${p.year - 1}, mêmes mois`} testid="finance-previous-table" /></section>
    {p.projection && p.selectedPlan ? <section className="panel finance-section"><h2>{p.selectedPlan.name}</h2><MonthlyTable rows={p.projection} months={p.months} title={labelOfPlan(p.selectedPlan)} testid="finance-projection-table" /></section> : null}
    <section className="panel finance-section"><h2>Détail par compte</h2>{p.actuals.accounts.length ? <div className="table-wrap scroll" tabIndex={0} role="region" aria-label="Détail comptable par mois"><table className="data-table finance-table" data-testid="finance-accounts-table"><thead><tr><th scope="col">Compte</th><th scope="col">Ligne de gestion</th>{p.months.map((month) => <th scope="col" className="num" key={month}>{formatMonth(month)}</th>)}<th scope="col" className="num">Cumul</th></tr></thead><tbody>{p.actuals.accounts.map((account) => <tr key={account.account}><th scope="row">{account.account}</th><td>{FINANCE_ROWS.find((row) => row.id === account.row)?.label}</td>{p.months.map((month) => <td key={month} className="num"><Amount cell={account.months[month] ?? absent} /></td>)}<td className="num"><Amount cell={total(p.months.map((month) => account.months[month] ?? absent))} /></td></tr>)}</tbody></table></div> : <p className="desc">Aucun compte de produits ou de charges dans la lecture retenue. Vérifie la source dans <a href={`/e/${p.slug}/donnees`}>Données</a>.</p>}</section>
  </>;
}

function Mapping({ p }: { p: FinanceViewProps }) {
  const overrides = new Map(p.mappings.map((mapping) => [mapping.account, mapping.row]));
  const accounts = [...new Set([...p.actuals.accounts.map((account) => account.account), ...p.mappings.map((mapping) => mapping.account)])].sort();
  const shown = accounts.slice(0, 256);
  const content = <><p className="desc">Correspondance initiale : 70 → chiffre d’affaires, autres 7 → autres produits, 64 → personnel, autres 6 → autres charges. La correspondance s’applique aux lectures affichées, sans modifier les écritures.</p>{accounts.length > 256 ? <p className="notice">Seuls les 256 premiers comptes peuvent être modifiés ici ; les {accounts.length - 256} autres correspondances sont conservées.</p> : null}
    <div className="table-wrap"><table className="data-table" data-testid="finance-mappings"><thead><tr><th scope="col">Compte</th><th scope="col">Ligne de gestion</th><th scope="col">Correspondance</th></tr></thead><tbody>{shown.map((account) => {
      const effective = overrides.get(account) ?? p.actuals.accounts.find((item) => item.account === account)?.row ?? (account.startsWith("70") ? "revenue" : account.startsWith("64") ? "personnel" : account.startsWith("6") ? "other-expenses" : "other-income");
      return <tr key={account}><th scope="row">{account}</th><td>{p.canAdmin ? <><input type="hidden" name="account" value={account} /><select className="select" name="row" defaultValue={effective} aria-label={`Ligne de gestion du compte ${account}`}>{FINANCE_ROWS.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></> : FINANCE_ROWS.find((row) => row.id === effective)?.label}</td><td>{overrides.has(account) ? "Personnalisée" : "PCG initiale"}</td></tr>;
    })}</tbody></table></div></>;
  return <section className="panel finance-section"><h2>Comptes PCG → lignes de gestion</h2>{accounts.length ? p.canAdmin ? <ActionForm action={p.saveMappings} submit="Enregistrer les correspondances" testid="finance-mapping-save"><input type="hidden" name="revision" value={p.revision} />{content}</ActionForm> : <>{content}<p className="desc">Seul un administrateur peut modifier les correspondances.</p></> : <p className="desc">Aucun compte à affecter : applique d’abord une lecture Pennylane ou un FEC dans <a href={`/e/${p.slug}/donnees`}>Données</a>.</p>}</section>;
}

function Plans({ p }: { p: FinanceViewProps }) {
  const plan = p.selectedPlan;
  return <>
    <section className="panel finance-section"><div className="panel-head"><h2>Budgets et prévisions enregistrés</h2>{p.canEdit ? <a className="btn" href={href(p, { vue: "plans", plan: "new" })}>Nouveau budget ou prévision</a> : null}</div>{p.plans.length ? <ul className="finance-plans">{p.plans.map((item) => <li key={item.id}><a href={href(p, { vue: "plans", plan: item.id, annee: String(item.year) })} aria-current={plan?.id === item.id ? "page" : undefined}><strong>{item.name}</strong><span>{item.kind === "budget" ? "Budget" : "Prévision"} · {item.year} · personnel {item.personnelSource === "rh" ? "issu du Studio RH" : "saisi"}</span></a></li>)}</ul> : <p className="desc">Aucun plan enregistré : saisis un budget ou une prévision sur douze mois.</p>}</section>
    <section className="panel finance-section"><h2>{plan ? plan.name : "Nouveau budget ou prévision"}</h2>{p.canEdit ? <ActionForm action={p.savePlan} submit={plan ? "Enregistrer le plan" : "Créer le plan"} testid="finance-plan-save"><input type="hidden" name="revision" value={p.revision} /><input type="hidden" name="id" value={plan?.id ?? "new"} /><FinancePlanGrid key={plan?.id ?? `new-${p.year}`} plan={plan} year={plan?.year ?? p.year} rhOptions={p.rhOptions} /></ActionForm> : <p className="desc">Lecture seule : ton rôle ne permet pas de saisir les hypothèses financières.</p>}</section>
    {plan && p.canEdit ? <section className="panel finance-section"><h2>Dupliquer ce plan</h2><ActionForm action={p.duplicatePlan} submit="Créer une copie" testid="finance-plan-duplicate" plain><input type="hidden" name="revision" value={p.revision} /><input type="hidden" name="id" value={plan.id} /><Field id="finance-duplicate-name" label="Nom de la copie"><input className="input" id="finance-duplicate-name" name="name" maxLength={120} required defaultValue={`${plan.name} — copie`.slice(0, 120)} /></Field></ActionForm></section> : null}
    {p.projection && plan ? <section className="panel finance-section"><h2>Lecture calculée du plan</h2><MonthlyTable rows={p.projection} months={wholeYear(plan.year)} title={labelOfPlan(plan)} testid="finance-plan-result" /></section> : null}
  </>;
}

function Variance({ p }: { p: FinanceViewProps }) {
  if (!p.selectedBudget || !p.budgetMonths) return <section className="panel finance-section"><h2>Réel / budget</h2><p className="notice">n.d. — sélectionne un budget de comparaison dans les filtres. Un budget saisi dans Clair n’est pas une source comptable manquante.</p></section>;
  const budget = p.budgetMonths;
  const allRows = [...FINANCE_ROWS, { id: "result" as const, label: "Résultat", kind: "income" }];
  return <>
    <section className="panel finance-section"><h2>Réel / {p.selectedBudget.name}</h2><p className="desc">Même période pour les deux lectures. Écart = réel − budget ; une hausse des charges est défavorable, une hausse des produits favorable.</p><div className="table-wrap"><table className="data-table finance-table" data-testid="finance-variance-table"><thead><tr><th scope="col">Ligne</th><th scope="col" className="num">Réel</th><th scope="col" className="num">Budget</th><th scope="col" className="num">Écart</th></tr></thead><tbody>{allRows.map((row) => {
      const actual = periodTotal(p.actuals.months, p.months, row.id), reference = periodTotal(budget, p.months, row.id);
      return <tr key={row.id} className={row.id === "result" ? "finance-result" : undefined}><th scope="row">{row.label}</th><td className="num"><Amount cell={actual} /></td><td className="num"><Amount cell={reference} /></td><td className="num"><Amount cell={difference(actual, reference)} signed /></td></tr>;
    })}</tbody></table></div></section>
    <section className="panel finance-section"><h2>Écart de résultat par mois</h2><BarChart testid="finance-variance-chart" label="Écart de résultat réel moins budget par mois" categories={p.months.map((month) => formatMonth(month).split(" ")[0])} categoryTitles={p.months.map(formatMonth)} series={[{ key: "variance", name: "Réel − budget", values: p.months.map((month) => difference(valueAt(p.actuals.months, month, "result"), valueAt(budget, month, "result")).cents), reasons: p.months.map((month) => difference(valueAt(p.actuals.months, month, "result"), valueAt(budget, month, "result")).reason) }]} unit="eur" /></section>
    <section className="panel finance-section"><h2>Écarts détaillés par mois</h2><div className="table-wrap scroll" tabIndex={0} role="region" aria-label="Écarts par ligne et par mois"><table className="data-table finance-table" data-testid="finance-variance-months"><thead><tr><th scope="col">Ligne</th>{p.months.map((month) => <th scope="col" className="num" key={month}>{formatMonth(month)}</th>)}</tr></thead><tbody>{allRows.map((row) => <tr key={row.id}><th scope="row">{row.label}</th>{p.months.map((month) => <td className="num" key={month}><Amount cell={difference(valueAt(p.actuals.months, month, row.id), valueAt(budget, month, row.id))} signed /></td>)}</tr>)}</tbody></table></div></section>
  </>;
}

export function FinanceView(p: FinanceViewProps) {
  return <div className="finance-view" data-testid="studio-finance">
    <header className="finance-header"><div><span className="label">Studio Finance · {p.workspaceName}</span><h1>{FINANCE_VIEWS.find((view) => view.id === p.view)?.label}</h1><p className="desc">{QUESTIONS[p.view]}</p></div><ExportMenu testid="finance-export" options={[{ label: "Excel — données et plans", href: href(p, { format: "xlsx" }, "/export") }, { label: "CSV — données et plans", href: href(p, { format: "csv" }, "/export") }]} /></header>
    <FamilyTabs current={p.view} label="Vues du Studio Finance" testid="finance-tabs" tabs={FINANCE_VIEWS.map((view) => ({ key: view.id, label: view.label, href: href(p, { vue: view.id }) }))} />
    <SourceBadge resolution={p.source} slug={p.slug} />
    {p.sourceNotice ? <p className="notice">{p.sourceNotice}</p> : null}
    <Filters p={p} />
    <p className="finance-coverage desc">Période : {p.months.length ? `${formatMonth(p.months[0])} → ${formatMonth(p.months[p.months.length - 1])}` : "n.d."}. Une période couverte par une lecture ne prouve pas la clôture comptable.</p>
    {p.view === "overview" ? <Overview p={p} /> : p.view === "pnl" ? <Pnl p={p} /> : p.view === "mapping" ? <Mapping p={p} /> : p.view === "plans" ? <Plans p={p} /> : <Variance p={p} />}
  </div>;
}

export default FinanceView;
