import "@/styles/masse-salariale.css";
import "@/styles/hypotheses-saisie.css";
import "@/styles/restructuring.css";
import { Money, MoneyUnitLabel } from "@/components/Money";
import { ExportMenu } from "@/components/ExportMenu";
import { FamilyTabs } from "@/components/FamilyTabs";
import { formatDate } from "@/lib/dates";
import type { CashContext } from "@/lib/restructuring/crisis/cash-context";
import { DIRECTIONS, FLOW_CATEGORIES, INFLOW_NATURES, MAX_SCENARIOS, RECURRENCES, WEEK_COUNT, type CashFlow, type FlowCategoryId, type PlanValue, type ScenarioPlan } from "@/lib/restructuring/crisis/cashplan";
import { RESTRUCTURING_VIEWS as VIEWS } from "@/lib/restructuring/views";
import { PanelHead, ReadDetails, Tile } from "../studio-rh/masse-salariale/components";
import { ActionForm } from "../studio-rh/hypotheses/ActionForm";
import type { FormState } from "../studio-rh/hypotheses/actions";
import { decText, Field, Text } from "../studio-rh/hypotheses/shared";

export type CashAction = (previous: FormState, form: FormData) => Promise<FormState>;
export type ScenarioActions = { create: CashAction; remove: Record<string, CashAction>; addMeasure?: CashAction; removeMeasure: Record<string, CashAction> };
type Props = CashContext & { addFlow?: CashAction; saveStart?: CashAction; deleteFlow?: Record<string, CashAction>; scenarioActions?: ScenarioActions };
type Value = PlanValue;
type ScenarioValue = Extract<ScenarioPlan, { kind: "value" }>;

const categoryLabel = (id: FlowCategoryId) => FLOW_CATEGORIES.find((c) => c.id === id)!.label;
const dayMonth = (iso: string) => formatDate(iso).slice(0, 5);

function href(p: Props, view: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ vue: view });
  if (view === "crisis" || view === "cash") {
    if (p.exercise) query.set("exercice", p.exercise.filename);
    if (p.asOf) query.set("date", p.asOf);
    if (view === "cash" && p.scenarioPlan?.kind === "value") query.set("scenario", p.scenarioPlan.scenario.id);
  } else {
    if (p.reference) query.set("reference", p.reference);
    if (p.projet) query.set("projet", p.projet);
  }
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return `/e/${p.slug}/studio-restructuring?${query}`;
}
const exportHref = (p: Props) => href(p, "cash").replace("/studio-restructuring?", "/studio-restructuring/cap13-export?");
const planHref = (p: Props, label: string, cents: number, category: FlowCategoryId) => `${href(p, "cash", { pl: label.slice(0, 120), pm: String(cents), pc: category })}#cash-flow-form`;

function Reading({ p }: { p: Props }) {
  const start = p.plan.kind === "value" ? p.plan.start : null;
  return <div className="ms-read restructuring-read"><p className="source-badge"><span>Source :</span><strong>{start?.source === "saisi" ? "Solde bancaire saisi" : "FEC appliqué dans Données"} et flux saisis dans Clair</strong>{start ? <span>— départ au {formatDate(start.date)}</span> : null}</p><ReadDetails>
    <p><strong>Solde de départ</strong> : soldes nets des comptes de banque et de caisse à la date d’arrêté du FEC (51 hors 519, 53, 54, découverts compris), ou le solde bancaire que tu saisis avec sa date. Un solde saisi remplace celui du FEC.</p>
    <p><strong>Semaines</strong> : {WEEK_COUNT} semaines calendaires, du lundi au dimanche ; la première est celle de la date de départ. Seuls les flux datés après la date de départ comptent : le solde de départ contient déjà les mouvements antérieurs.</p>
    <p><strong>Flux</strong> : chaque montant est une ligne saisie dans Clair, avec sa date. Un flux mensuel revient le même jour du mois, ramené au dernier jour quand le mois est plus court. Clair ne déduit aucune échéance du FEC.</p>
    <p><strong>Rupture</strong> : première semaine dont le solde de fin passe sous le seuil. Le seuil est le découvert autorisé saisi ; s’il n’est pas saisi, c’est zéro. Le solde est lu en fin de semaine : un creux en cours de semaine n’apparaît pas.</p>
    <p><strong>Scénarios</strong> : un report décale chaque occurrence d’une ligne dans le plan ; un étalement la remplace par des échéances égales ; un encaissement exceptionnel n’existe que dans le scénario. Un montant décalé après la semaine {WEEK_COUNT} reste dû : il est affiché à part. Clair ne calcule ni majoration ni pénalité de retard.</p>
    <p>Ce plan est une projection à partir de tes hypothèses. Il ne constate pas un état de cessation des paiements, qui s’apprécie avec le conseil de l’entreprise.</p>
  </ReadDetails></div>;
}

function Filters({ p }: { p: Props }) {
  if (!p.exercise) return null;
  return <form method="get" className="filters bar restructuring-filters" data-testid="cash-filters" aria-label="Exercice et date d’arrêté du FEC">
    <input type="hidden" name="vue" value="cash" />
    {p.scenarioPlan?.kind === "value" ? <input type="hidden" name="scenario" value={p.scenarioPlan.scenario.id} /> : null}
    <div className="field-row"><label htmlFor="cash-exercise">Exercice (FEC appliqué)</label><select id="cash-exercise" name="exercice" className="select" defaultValue={p.exercise.filename}>{p.exercises.map((e) => <option key={e.filename} value={e.filename}>{formatDate(e.firstDate)} → {formatDate(e.lastDate)} · {e.filename}</option>)}</select></div>
    <div className="field-row"><label htmlFor="cash-date">Date d’arrêté du FEC</label><input id="cash-date" name="date" type="date" className="input" min={p.exercise.firstDate} max={p.exercise.lastDate} defaultValue={p.asOf ?? p.exercise.lastDate} /></div>
    <button type="submit" className="btn primary">Afficher</button>
  </form>;
}

function Start({ p }: { p: Props }) {
  const s = p.settings;
  return <section className="panel restructuring-section" data-testid="cash-start"><PanelHead title="Solde de départ et découvert autorisé" desc="Un solde saisi et daté remplace le solde du FEC ; aucun découvert n’est supposé" />
    <p className="desc" data-testid="cash-start-fec">Solde du FEC{p.fecStart ? <> au {formatDate(p.fecStart.date)} : <strong><Money cents={p.fecStart.cents} signed /></strong>{s.start ? " (non utilisé : un solde saisi le remplace)" : ""}</> : <> : <span className="nd">n.d.</span> — {p.fecReason}</>}</p>
    {p.saveStart ? <ActionForm action={p.saveStart} submit="Enregistrer" testid="cash-start-form" className="form">
      <div className="filters crisis-rank-fields">
        <Text key={`d-${s.start?.date ?? ""}`} id="cash-start-date" name="startDate" label="Date du solde saisi" type="date" defaultValue={s.start?.date ?? ""} hint="Vide = solde du FEC." />
        <Text key={`a-${s.start?.cents ?? ""}`} id="cash-start-amount" name="startAmount" label="Solde bancaire saisi (€)" inputMode="decimal" defaultValue={s.start ? decText(s.start.cents) : ""} hint="Négatif si le compte est à découvert." />
        <Text key={`o-${s.overdraftCents ?? ""}`} id="cash-overdraft" name="overdraft" label="Découvert autorisé (€)" inputMode="decimal" defaultValue={decText(s.overdraftCents)} hint="Vide = non saisi : la rupture se mesure par rapport à zéro." />
      </div>
    </ActionForm> : <p className="desc">{s.start ? <>Solde saisi au {formatDate(s.start.date)} : <Money cents={s.start.cents} signed />. </> : null}Découvert autorisé : {s.overdraftCents === null ? <span className="nd">n.d. — non saisi</span> : <Money cents={s.overdraftCents} />}.</p>}
  </section>;
}

function Tiles({ plan }: { plan: Value }) {
  const low = plan.weeks[plan.lowPoint.week - 1];
  return <dl className="facts ms-tiles four restructuring-tiles" data-testid="cash-tiles">
    <Tile testid="cash-tile-start" main label="Solde de départ" value={<Money cents={plan.start.cents} signed />} lead={`${plan.start.source === "saisi" ? "Saisi" : "FEC"} · au ${formatDate(plan.start.date)}`} />
    <Tile testid="cash-tile-low" label="Point bas" value={<Money cents={plan.lowPoint.cents} signed />} lead={`Fin de semaine ${plan.lowPoint.week} · ${formatDate(low.to)}`} />
    <Tile testid="cash-tile-rupture" label="Rupture" value={plan.rupture ? `Semaine ${plan.rupture.week}` : "Aucune"} lead={plan.rupture ? `Du ${formatDate(plan.rupture.from)} au ${formatDate(plan.rupture.to)}` : `Sur ${WEEK_COUNT} semaines, avec les flux saisis`} />
    <Tile testid="cash-tile-end" label={`Solde fin de semaine ${WEEK_COUNT}`} value={<Money cents={plan.weeks[WEEK_COUNT - 1].closing} signed />} lead={`Au ${formatDate(plan.horizonEnd)}`} />
  </dl>;
}

function Weeks({ plan, title = "Plan de trésorerie par semaine", testid = "cash-weeks" }: { plan: Value; title?: string; testid?: string }) {
  const ins = plan.rows.filter((r) => r.direction === "in");
  const outs = plan.rows.filter((r) => r.direction === "out");
  const sum = (pick: (w: Value["weeks"][number]) => number) => plan.weeks.reduce((total, w) => total + pick(w), 0);
  const cells = (values: number[], signed = false) => values.map((cents, i) => <td key={i} className="num">{cents === 0 && !signed ? "—" : <Money cents={cents} signed={signed} />}</td>);
  return <section className="panel restructuring-section" data-testid={testid}><PanelHead title={title} desc={<>Semaines du lundi au dimanche · montants en <MoneyUnitLabel /> · seuil de rupture : {plan.floor.source === "decouvert" ? <>découvert autorisé de <Money cents={-plan.floor.cents} /></> : "zéro (découvert autorisé non saisi)"}</>} />
    <div className="table-wrap scroll" tabIndex={0} role="region" aria-label={title}><table className="data-table sticky sticky-first cash-weeks" data-testid={`${testid}-table`}><thead><tr><th scope="col">Semaine</th>{plan.weeks.map((w) => <th key={w.index} scope="col" className="num">S{w.index}<small>{dayMonth(w.from)} → {dayMonth(w.to)}</small></th>)}<th scope="col" className="num">Total</th></tr></thead><tbody>
      {ins.map((row) => <tr key={`in-${row.category}`} data-row={`in-${row.category}`}><th scope="row">Encaissements · {row.label}</th>{cells(row.weeks)}<td className="num"><Money cents={row.total} /></td></tr>)}
      <tr className="cash-total" data-row="inflow"><th scope="row">Total encaissements</th>{cells(plan.weeks.map((w) => w.inflow))}<td className="num"><Money cents={sum((w) => w.inflow)} /></td></tr>
      {outs.map((row) => <tr key={`out-${row.category}`} data-row={`out-${row.category}`}><th scope="row">Décaissements · {row.label}</th>{cells(row.weeks)}<td className="num"><Money cents={row.total} /></td></tr>)}
      <tr className="cash-total" data-row="outflow"><th scope="row">Total décaissements</th>{cells(plan.weeks.map((w) => w.outflow))}<td className="num"><Money cents={sum((w) => w.outflow)} /></td></tr>
      <tr data-row="net"><th scope="row">Variation de la semaine</th>{cells(plan.weeks.map((w) => w.net), true)}<td className="num"><Money cents={sum((w) => w.net)} signed /></td></tr>
    </tbody><tfoot><tr className="cash-total" data-row="closing"><th scope="row">Solde de fin de semaine</th>{plan.weeks.map((w) => <td key={w.index} className={w.closing < plan.floor.cents ? "num trend-bad" : "num"} data-week={w.index}><Money cents={w.closing} signed /></td>)}<td /></tr></tfoot></table></div>
    <details className="crisis-detail" data-testid={testid === "cash-weeks" ? "cash-trace" : `${testid}-trace`}><summary>D’où vient chaque montant : détail des flux par semaine</summary><div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Semaine</th><th scope="col">Date</th><th scope="col">Ligne saisie</th><th scope="col" className="num">Montant</th></tr></thead><tbody>{plan.weeks.flatMap((w) => w.contributions.map((c, i) => <tr key={`${w.index}-${c.flowId ?? c.measureId}-${c.date}-${i}`}><th scope="row">S{w.index}</th><td>{formatDate(c.date)}</td><td>{c.label}</td><td className="num"><Money cents={c.cents} signed /></td></tr>))}</tbody></table></div></details>
  </section>;
}

const recurrenceText = (flow: CashFlow) => flow.recurrence === "once" ? `Le ${formatDate(flow.date)}` : `${RECURRENCES.find((r) => r.id === flow.recurrence)!.label} à partir du ${formatDate(flow.date)}${flow.until ? ` jusqu’au ${formatDate(flow.until)}` : ""}`;

function Flows({ p }: { p: Props }) {
  const flows = [...p.settings.flows].sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  const pre = p.prefill;
  return <section className="panel restructuring-section" data-testid="cash-flows"><PanelHead title="Flux saisis" desc={`${flows.length} ligne${flows.length === 1 ? "" : "s"} · une ligne se corrige en la supprimant puis en la ressaisissant`} />
    {flows.length ? <div className="table-wrap scroll restructuring-scroll" tabIndex={0} role="region" aria-label="Flux saisis"><table className="data-table cash-flows" data-testid="cash-flows-table"><thead><tr><th scope="col">Libellé</th><th scope="col">Catégorie</th><th scope="col">Sens</th><th scope="col">Dates</th><th scope="col" className="num">Montant</th>{p.deleteFlow ? <th scope="col"><span className="sr-only">Actions</span></th> : null}</tr></thead><tbody>{flows.map((flow) => <tr key={flow.id}><th scope="row">{flow.label}</th><td>{categoryLabel(flow.category)}</td><td>{DIRECTIONS.find((d) => d.id === flow.direction)!.label}</td><td>{recurrenceText(flow)}</td><td className="num"><Money cents={flow.amountCents} /></td>{p.deleteFlow?.[flow.id] ? <td><ActionForm action={p.deleteFlow[flow.id]} submit="Supprimer" srLabel={flow.label} testid={`cash-flow-delete-${flow.id}`} className="form inline" danger compact /></td> : null}</tr>)}</tbody></table></div> : <p className="desc" data-testid="cash-flows-empty">Aucun flux saisi : le plan affiche le solde de départ sur les {WEEK_COUNT} semaines.</p>}
    {p.addFlow ? <div id="cash-flow-form"><h3 className="ms-sub">Ajouter un flux</h3><ActionForm key={pre ? `${pre.label}-${pre.amountCents}-${pre.category}` : "empty"} action={p.addFlow} submit="Ajouter au plan" testid="cash-flow-form" className="form">
      <div className="filters crisis-rank-fields">
        <Text id="cash-flow-label" name="label" label="Libellé" required maxLength={120} defaultValue={pre?.label ?? ""} />
        <Field id="cash-flow-category" label="Catégorie"><select id="cash-flow-category" name="category" className="select" required defaultValue={pre?.category ?? ""}><option value="" disabled>Choisir…</option>{FLOW_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
        <Field id="cash-flow-direction" label="Sens"><select id="cash-flow-direction" name="direction" className="select" required defaultValue={pre ? "out" : ""}><option value="" disabled>Choisir…</option>{DIRECTIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></Field>
      </div>
      <div className="filters crisis-rank-fields">
        <Text id="cash-flow-amount" name="amount" label="Montant (€)" inputMode="decimal" required defaultValue={pre ? decText(pre.amountCents) : ""} hint="Toujours positif ; le sens fait le signe." />
        <Text id="cash-flow-date" name="date" label="Date (ou première date)" type="date" required />
        <Field id="cash-flow-recurrence" label="Fréquence"><select id="cash-flow-recurrence" name="recurrence" className="select" required defaultValue="once">{RECURRENCES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
        <Text id="cash-flow-until" name="until" label="Jusqu’au (facultatif)" type="date" hint="Pour un flux récurrent seulement." />
      </div>
      {pre ? <><input type="hidden" name="prefilled" value="1" /><input type="hidden" name="exercice" value={p.exercise?.filename ?? ""} /><input type="hidden" name="arrete" value={p.asOf ?? ""} /></> : null}
      {pre ? <p className="desc" data-testid="cash-prefill">Montant proposé depuis le FEC. La date est à choisir : Clair ne déduit aucune échéance.</p> : null}
    </ActionForm></div> : <p className="desc">Les flux sont saisis par un éditeur ou un administrateur de l’espace.</p>}
  </section>;
}

function ScenarioDetail({ p, sp }: { p: Props; sp: ScenarioValue }) {
  const base = p.plan as Value;
  const actions = p.scenarioActions;
  const rupture = (r: Value["rupture"]) => r ? `Semaine ${r.week}` : "Aucune";
  const targeted = new Set(sp.scenario.measures.flatMap((m) => m.kind === "encaissement" ? [] : [m.flowId]));
  const inPlan = new Set(base.weeks.flatMap((w) => w.contributions.map((c) => c.flowId)));
  const candidates = p.settings.flows.filter((f) => f.direction === "out" && inPlan.has(f.id) && !targeted.has(f.id)).sort((a, b) => a.label.localeCompare(b.label));
  const options = candidates.map((f) => <option key={f.id} value={f.id}>{f.label} · {recurrenceText(f)}</option>);
  return <div className="restructuring-section" id="cash-scenario" data-testid="cash-scenario">
    <h3 className="ms-sub">Scénario « {sp.scenario.name} » comparé au plan de base</h3>
    <dl className="facts ms-tiles four restructuring-tiles" data-testid="cash-scenario-tiles">
      <Tile testid="cash-scenario-low" main label="Point bas du scénario" value={<Money cents={sp.plan.lowPoint.cents} signed />} lead={<>Fin de semaine {sp.plan.lowPoint.week} · écart <Money cents={sp.lowPointDelta} signed /></>} />
      <Tile testid="cash-scenario-rupture" label="Rupture du scénario" value={rupture(sp.plan.rupture)} lead={`Plan de base : ${rupture(sp.baseRupture).toLowerCase()}`} />
      <Tile testid="cash-scenario-beyond" label={`Reporté après la semaine ${WEEK_COUNT}`} value={<Money cents={sp.beyondCents} />} lead="Toujours dû, hors de l’horizon" />
      <Tile testid="cash-scenario-end" label={`Solde fin de semaine ${WEEK_COUNT}`} value={<Money cents={sp.plan.weeks[WEEK_COUNT - 1].closing} signed />} lead={<>Écart <Money cents={sp.comparison[WEEK_COUNT - 1].delta} signed /></>} />
    </dl>
    <div className="table-wrap scroll" tabIndex={0} role="region" aria-label="Soldes de fin de semaine : plan de base et scénario"><table className="data-table sticky sticky-first cash-weeks" data-testid="cash-comparison-table"><thead><tr><th scope="col">Solde de fin de semaine</th>{sp.plan.weeks.map((w) => <th key={w.index} scope="col" className="num">S{w.index}<small>{dayMonth(w.from)} → {dayMonth(w.to)}</small></th>)}</tr></thead><tbody>
      <tr data-row="base"><th scope="row">Plan de base</th>{sp.comparison.map((c) => <td key={c.week} className={c.base < sp.plan.floor.cents ? "num trend-bad" : "num"} data-week={c.week}><Money cents={c.base} signed /></td>)}</tr>
      <tr className="cash-total" data-row="scenario"><th scope="row">Scénario</th>{sp.comparison.map((c) => <td key={c.week} className={c.scenario < sp.plan.floor.cents ? "num trend-bad" : "num"} data-week={c.week}><Money cents={c.scenario} signed /></td>)}</tr>
      <tr data-row="delta"><th scope="row">Écart</th>{sp.comparison.map((c) => <td key={c.week} className="num" data-week={c.week}>{c.delta === 0 ? "—" : <Money cents={c.delta} signed />}</td>)}</tr>
    </tbody></table></div>
    <h3 className="ms-sub">Mesures du scénario</h3>
    {sp.outcomes.length ? <div className="table-wrap"><table className="data-table cash-flows" data-testid="cash-measures-table"><thead><tr><th scope="col">Mesure</th><th scope="col">Effet</th><th scope="col" className="num">Reporté après S{WEEK_COUNT}</th>{actions ? <th scope="col"><span className="sr-only">Actions</span></th> : null}</tr></thead><tbody>{sp.outcomes.map((o) => <tr key={o.measureId}><th scope="row">{o.label}</th><td>{o.inapplicable ? <span className="nd">non appliquée — {o.inapplicable}</span> : "Appliquée"}</td><td className="num">{o.beyondCents ? <Money cents={o.beyondCents} /> : "—"}</td>{actions?.removeMeasure[o.measureId] ? <td><ActionForm action={actions.removeMeasure[o.measureId]} submit="Supprimer" srLabel={o.label} testid={`cash-measure-delete-${o.measureId}`} className="form inline" danger compact /></td> : null}</tr>)}</tbody></table></div> : <p className="desc" data-testid="cash-measures-empty">Aucune mesure : le scénario est identique au plan de base.</p>}
    {actions?.addMeasure ? <div className="crisis-details">
      <details className="crisis-detail" data-testid="cash-measure-report"><summary>Ajouter un report (moratoire)</summary>{candidates.length ? <ActionForm action={actions.addMeasure} submit="Ajouter le report" testid="cash-measure-report-form" className="form">
        <input type="hidden" name="kind" value="report" />
        <div className="filters crisis-rank-fields">
          <Field id="cash-report-flow" label="Décaissement du plan de base"><select id="cash-report-flow" name="flowId" className="select" required defaultValue=""><option value="" disabled>Choisir…</option>{options}</select></Field>
          <Text id="cash-report-weeks" name="weeks" label="Report (semaines)" inputMode="numeric" required hint="De 1 à 52. Chaque occurrence dans le plan est décalée." />
        </div>
      </ActionForm> : <p className="desc" style={{ margin: "0 16px 16px" }}>Aucun décaissement du plan de base disponible : chaque ligne ne porte qu’une mesure par scénario.</p>}</details>
      <details className="crisis-detail" data-testid="cash-measure-etalement"><summary>Ajouter un étalement (délais URSSAF, fiscaux ou fournisseurs)</summary>{candidates.length ? <ActionForm action={actions.addMeasure} submit="Ajouter l’étalement" testid="cash-measure-etalement-form" className="form">
        <input type="hidden" name="kind" value="etalement" />
        <div className="filters crisis-rank-fields">
          <Field id="cash-etal-flow" label="Décaissement du plan de base"><select id="cash-etal-flow" name="flowId" className="select" required defaultValue=""><option value="" disabled>Choisir…</option>{options}</select></Field>
          <Text id="cash-etal-count" name="count" label="Nombre d’échéances" inputMode="numeric" required hint="De 2 à 60, égales ; le reliquat d’arrondi va sur la dernière." />
          <Field id="cash-etal-frequency" label="Fréquence"><select id="cash-etal-frequency" name="frequency" className="select" required defaultValue="monthly"><option value="weekly">Chaque semaine</option><option value="monthly">Chaque mois</option></select></Field>
          <Text id="cash-etal-first" name="firstDate" label="Première échéance" type="date" required />
        </div>
        <p className="desc">L’échéancier est ton hypothèse : Clair ne calcule ni majoration ni pénalité, et ne dit pas si le délai sera accordé.</p>
      </ActionForm> : <p className="desc" style={{ margin: "0 16px 16px" }}>Aucun décaissement du plan de base disponible.</p>}</details>
      <details className="crisis-detail" data-testid="cash-measure-encaissement"><summary>Ajouter un encaissement exceptionnel (cession d’actif, apport)</summary><ActionForm action={actions.addMeasure} submit="Ajouter l’encaissement" testid="cash-measure-encaissement-form" className="form">
        <input type="hidden" name="kind" value="encaissement" />
        <div className="filters crisis-rank-fields">
          <Text id="cash-enc-label" name="label" label="Libellé" required maxLength={120} />
          <Field id="cash-enc-nature" label="Nature"><select id="cash-enc-nature" name="nature" className="select" required defaultValue=""><option value="" disabled>Choisir…</option>{INFLOW_NATURES.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></Field>
          <Text id="cash-enc-amount" name="amount" label="Montant (€)" inputMode="decimal" required />
          <Text id="cash-enc-date" name="date" label="Date d’encaissement" type="date" required />
        </div>
      </ActionForm></details>
    </div> : null}
    <Weeks plan={sp.plan} title={`Plan du scénario « ${sp.scenario.name} » par semaine`} testid="cash-scenario-weeks" />
  </div>;
}

function Scenarios({ p }: { p: Props }) {
  const list = p.settings.scenarios;
  const selected = p.scenarioPlan?.kind === "value" ? p.scenarioPlan : null;
  const actions = p.scenarioActions;
  const link = (id: string | null) => { const query = new URLSearchParams({ vue: "cash" }); if (p.exercise) query.set("exercice", p.exercise.filename); if (p.asOf) query.set("date", p.asOf); if (id) query.set("scenario", id); return `/e/${p.slug}/studio-restructuring?${query}${id ? "#cash-scenario" : ""}`; };
  return <section className="panel restructuring-section" data-testid="cash-scenarios"><PanelHead title="Scénarios" desc={`Des mesures appliquées par-dessus le plan de base, qui n’est jamais modifié · ${list.length} scénario${list.length > 1 ? "s" : ""} sur ${MAX_SCENARIOS}`} />
    {list.length ? <div className="table-wrap"><table className="data-table cash-flows" data-testid="cash-scenarios-table"><thead><tr><th scope="col">Scénario</th><th scope="col" className="num">Mesures</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{list.map((scenario) => <tr key={scenario.id}><th scope="row">{scenario.name}{selected?.scenario.id === scenario.id ? " · affiché" : ""}</th><td className="num">{scenario.measures.length}</td><td><div className="restructuring-actions">{selected?.scenario.id === scenario.id ? <a className="btn hs-compact" href={link(null)}>Revenir au plan de base</a> : <a className="btn hs-compact" href={link(scenario.id)}>Comparer au plan de base</a>}{actions?.remove[scenario.id] ? <ActionForm action={actions.remove[scenario.id]} submit="Supprimer" srLabel={`le scénario ${scenario.name}`} confirm={`Supprimer le scénario « ${scenario.name} » et ses mesures ?`} testid={`cash-scenario-delete-${scenario.id}`} className="form inline" danger compact /> : null}</div></td></tr>)}</tbody></table></div> : <p className="desc" data-testid="cash-scenarios-empty">Aucun scénario. Crée-en un pour tester un moratoire, un étalement ou une cession d’actif.</p>}
    {actions && list.length < MAX_SCENARIOS ? <ActionForm action={actions.create} submit="Créer le scénario" testid="cash-scenario-form" className="form">
      <input type="hidden" name="exercice" value={p.exercise?.filename ?? ""} /><input type="hidden" name="arrete" value={p.asOf ?? ""} />
      <div className="filters crisis-rank-fields"><Text id="cash-scenario-name" name="name" label="Nom du nouveau scénario" required maxLength={80} /></div>
    </ActionForm> : null}
    {selected ? <ScenarioDetail p={p} sp={selected} /> : null}
  </section>;
}

function ToPlan({ p }: { p: Props }) {
  const open = p.openItems;
  if (!p.exercise) return null;
  const mismatch = open.kind === "value" && p.supplierNet !== null && open.totalCents !== p.supplierNet;
  return <section className="panel restructuring-section" data-testid="cash-to-plan"><PanelHead title="Dettes du FEC à planifier" desc={`Soldes au ${formatDate(p.asOf ?? p.exercise.lastDate)} · Clair propose le montant, tu choisis la date`} />
    <h3 className="ms-sub">Factures fournisseurs non lettrées</h3>
    {open.kind === "nd" ? <p className="nd" data-testid="cash-open-nd">n.d. — {open.reason}</p> : open.count === 0 ? <p className="desc">Aucune écriture fournisseur non lettrée à cette date.</p> : <>
      <p className="desc" data-testid="cash-open-total">{open.count} écriture{open.count === 1 ? "" : "s"} non lettrée{open.count === 1 ? "" : "s"}, total <Money cents={open.totalCents} signed />.{mismatch ? <> Ce total diffère du solde net des comptes fournisseurs (<Money cents={p.supplierNet!} signed />) : le lettrage du FEC est partiel ou non soldé.</> : " Il est égal au solde net des comptes fournisseurs."}</p>
      <div className="table-wrap scroll restructuring-scroll" tabIndex={0} role="region" aria-label="Factures fournisseurs non lettrées"><table className="data-table" data-testid="cash-open-table"><thead><tr><th scope="col">Tiers</th><th scope="col">Pièce</th><th scope="col">Date de pièce</th><th scope="col" className="num">Reste dû</th>{p.addFlow ? <th scope="col"><span className="sr-only">Planifier</span></th> : null}</tr></thead><tbody>{open.items.slice(0, 100).map((item, i) => {
        const who = item.auxiliaryLabel ?? item.auxiliary ?? `Compte ${item.accountId}`;
        return <tr key={`${item.auxiliary}-${item.pieceRef}-${i}`}><th scope="row">{who}</th><td>{item.pieceRef ?? "—"}</td><td>{item.pieceDate ? formatDate(item.pieceDate) : <span className="nd">n.d.</span>}</td><td className="num"><Money cents={item.cents} signed /></td>{p.addFlow ? <td>{item.cents > 0 ? <a className="btn hs-compact" href={planHref(p, `${who}${item.pieceRef ? ` · ${item.pieceRef}` : ""}`, item.cents, "suppliers")}>Planifier</a> : <span className="desc">avoir ou règlement</span>}</td> : null}</tr>;
      })}</tbody></table></div>
      {open.count > 100 ? <p className="desc">Les 100 plus grands montants sont affichés sur {open.count}.</p> : null}
    </>}
    <h3 className="ms-sub">Autres dettes par nature</h3>
    {p.toPlan.length ? <div className="table-wrap"><table className="data-table" data-testid="cash-natures-table"><thead><tr><th scope="col">Nature</th><th scope="col" className="num">Dette comptabilisée</th>{p.addFlow ? <th scope="col"><span className="sr-only">Planifier</span></th> : null}</tr></thead><tbody>{p.toPlan.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td className="num"><Money cents={row.cents} /></td>{p.addFlow ? <td><a className="btn hs-compact" href={planHref(p, row.label, row.cents, row.category)}>Planifier</a></td> : null}</tr>)}</tbody></table></div> : <p className="desc">Aucune autre dette comptabilisée à cette date.</p>}
    <p className="desc">Une dette planifiée n’est pas retirée de cette liste : elle reste le solde du FEC. Vérifie que chaque dette n’est saisie qu’une fois dans le plan.</p>
  </section>;
}

export function CashPlanView(p: Props) {
  const plan = p.plan;
  return <div className="restructuring-view" data-testid="studio-restructuring-cash">
    <header className="restructuring-header"><div className="ms-head"><span className="label">Studio Restructuring</span><h1>{VIEWS.find((view) => view.id === "cash")?.label}</h1><p className="desc">La trésorerie tient-elle sur les treize prochaines semaines, et sinon quand rompt-elle ?</p></div>{p.canEdit && (plan.kind === "value" || p.position.kind === "value") ? <ExportMenu testid="cap13-export" options={[{ label: "Dossier de crise (Excel)", href: exportHref(p), testid: "cap13-export-xlsx" }]} /> : null}</header>
    <FamilyTabs current="cash" label="Vues du Studio Restructuring" testid="restructuring-tabs" tabs={VIEWS.map((view) => ({ key: view.id, label: view.label, href: href(p, view.id) }))} />
    <Reading p={p} />
    <Filters p={p} />
    {p.notices.length ? <ul className="restructuring-notices" data-testid="cash-notices">{p.notices.map((notice) => <li className="notice" key={notice}>{notice}</li>)}</ul> : null}
    {!p.settingsUnreadable ? <Start p={p} /> : null}
    {plan.kind === "nd" ? <section className="panel restructuring-section" data-testid="cash-unavailable"><h2>Plan non disponible</h2><p className="nd">n.d. — {plan.reason}</p></section> : <>
      <Tiles plan={plan} />
      {plan.startBelowFloor ? <ul className="restructuring-notices"><li className="notice" data-testid="cash-start-below">Le solde de départ est déjà sous le seuil de rupture, avant tout flux.</li></ul> : null}
      <Weeks plan={plan} />
      {plan.ignored.length ? <section className="panel restructuring-section" data-testid="cash-ignored"><PanelHead title="Lignes hors du plan" desc="Saisies mais sans occurrence dans les 13 semaines ; rien n’est reporté automatiquement" /><ul className="list">{plan.ignored.map((line) => <li key={line.flowId} className="desc"><strong>{line.label}</strong> · <Money cents={line.direction === "in" ? line.cents : -line.cents} signed /> — {line.reason}.</li>)}</ul></section> : null}
    </>}
    {!p.settingsUnreadable ? <Flows p={p} /> : null}
    {!p.settingsUnreadable && plan.kind === "value" ? <Scenarios p={p} /> : null}
    <ToPlan p={p} />
  </div>;
}

export default CashPlanView;
