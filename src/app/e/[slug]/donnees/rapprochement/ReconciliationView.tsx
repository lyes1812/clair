import { DropdownMenu } from "@/components/DropdownMenu";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate, formatMonth, isIsoDate } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { compareSnapshots } from "@/lib/reconciliation/compare";
import { CONTRACT_FIELDS, FIELD_LABELS, MISSING_LABELS, PERSON_FIELDS, type Cell, type ComparedField, type ComparedRow, type Comparison, type Decision, type EntityKind, type Field, type Person, type Snapshot, type Source, type SourceSnapshot, type State } from "@/lib/reconciliation/types";
import { ActionForm } from "../../studio-rh/hypotheses/ActionForm";
import { ControlFields, LinkForm, type ControlIdentity, type LinkChoice, type ReconciliationAction } from "./LinkForm";

export type ReconciliationRun = { id: string; controlMonth: string; inputHash: string; revision: number; createdAt: string; createdBy: string | null; snapshot: Snapshot; decisions: Decision[]; state: State; stale: boolean };
export type ReconciliationModel = {
  months: string[];
  sources: { dsn: { available: boolean }; payfit: { available: boolean } };
  actorNames?: Record<string, string>;
  runs: { id: string; controlMonth: string; createdAt: string }[];
  selected: ReconciliationRun | null;
};
export type ReconciliationActions = { create: ReconciliationAction; decide: ReconciliationAction };
const SOURCE_LABELS: Record<Source, string> = { dsn: "DSN", payfit: "PayFit" };
const COVERAGE: Record<SourceSnapshot["coverage"], string> = { complete: "Complète", incomplete: "Incomplète", blocked: "Bloquée", missing: "Manquante" };
const COMPARISON: Record<ComparedField["status"], string> = { equal: "Valeurs égales", different: "Écart", nd: "n.d.", conflict: "Conflit", "not-comparable": "Non comparable" };
const REVIEW = { "to-reconcile": "Champs à vérifier", linked: "Champs rapprochés", unmatched: "Sans correspondance constatée", explained: "Écarts expliqués", "correction-requested": "Correction à demander" } as const;
const dateTime = (value: string) => dateTimeFmt.format(new Date(value));
const entityLabel = (entity: EntityKind) => entity === "person" ? "Personne" : "Contrat";

function CellValue({ cell, field }: { cell: Cell; field?: Field }) {
  if (cell.kind === "nd") return <abbr className="nd" title={MISSING_LABELS[cell.reason]}>n.d.</abbr>;
  const text = (value: string) => field === "startDate" || field === "endDate" ? isIsoDate(value) ? formatDate(value) : value : field === "nature" ? contractNatureLabel(value) : value;
  if (cell.kind === "conflict") return <span className="rec-conflict-values"><b>Conflit</b>{cell.values.map((value, index) => <span key={`${value}-${index}`}>{text(value)}</span>)}{cell.missingReasons?.map((reason) => <span className="nd" key={reason}>n.d. — {MISSING_LABELS[reason]}</span>)}</span>;
  return <>{text(cell.value)}</>;
}

function Provenance({ cell, source }: { cell: Cell; source: Source }) {
  if (!cell.provenance.length) return null;
  return <details className="rec-provenance"><summary>Provenance {SOURCE_LABELS[source]}</summary><ul>{cell.provenance.map((provenance, index) => <li key={`${provenance.recordId}-${index}`}>
    <span>Champ : <code>{provenance.path}</code></span><span>Période : {provenance.period ?? "n.d."}</span>
    <span>Lecture : <code>{provenance.syncId}</code></span><span>Enregistrement : <code>{provenance.recordId}</code></span><span>Empreinte : <code>{provenance.recordHash}</code></span>
  </li>)}</ul></details>;
}

function personText(person: Person | undefined, fallback: string): string {
  if (!person) return fallback;
  const values = [person.fields.familyName, person.fields.givenNames].flatMap((cell) => cell.kind === "value" ? [cell.value] : []);
  return values.join(" ").trim() || fallback;
}
function choiceList(snapshot: Snapshot, source: Source, entity: EntityKind): LinkChoice[] {
  const data = snapshot[source];
  if (entity === "person") return data.persons.map((person, index) => ({ id: person.id, label: `${personText(person, "Nom n.d.")} · ${SOURCE_LABELS[source]} ${index + 1}`, parentId: null }));
  return data.contracts.map((contract, index) => ({ id: contract.id, parentId: contract.personId.kind === "value" ? contract.personId.value : null, label: `${entityLabel(entity)} ${SOURCE_LABELS[source]} ${index + 1} · ${personText(data.persons.find((person) => contract.personId.kind === "value" && person.id === contract.personId.value), "Personne n.d.")}${contract.fields.startDate.kind === "value" ? ` · ${isIsoDate(contract.fields.startDate.value) ? formatDate(contract.fields.startDate.value) : contract.fields.startDate.value}` : ""}` }));
}
function rowName(run: ReconciliationRun, source: Source, entity: EntityKind, id: string | null): string {
  if (!id) return "Non liée";
  return choiceList(run.snapshot, source, entity).find((choice) => choice.id === id)?.label ?? `${entityLabel(entity)} n.d.`;
}
function availableChoices(run: ReconciliationRun, source: Source, entity: EntityKind): LinkChoice[] {
  const links = entity === "person" ? run.state.personLinks : run.state.contractLinks;
  return choiceList(run.snapshot, source, entity).filter((choice) => !links.some((link) => (source === "dsn" ? link.dsnId : link.payfitId) === choice.id) && !run.state.unmatched.some((row) => row.entity === entity && row.source === source && row.id === choice.id));
}
function EntitySourceCell({ run, source, entity, id }: { run: ReconciliationRun; source: Source; entity: EntityKind; id: string | null }) {
  if (!id) return <span className="desc">Non liée</span>;
  const data = run.snapshot[source];
  const item = entity === "person" ? data.persons.find((row) => row.id === id) : data.contracts.find((row) => row.id === id);
  if (!item) return <span className="nd">n.d. — ligne absente du contrôle</span>;
  const fields = entity === "person" ? PERSON_FIELDS : CONTRACT_FIELDS;
  const values = item.fields as Partial<Record<Field, Cell>>;
  const relation = "periodRelation" in item ? { "in-period": "Dans le mois DSN contrôlé", "outside-period": "Hors du mois DSN contrôlé", unknown: "Position dans le mois : n.d.", conflict: "Dates en conflit" }[item.periodRelation] : null;
  return <div className="rec-source-cell"><span>{rowName(run, source, entity, id)}</span>{"origin" in item && item.origin === "contract-reference" && <small>Personne référencée par un contrat</small>}
    <details className="rec-entity-details"><summary>Voir la ligne {SOURCE_LABELS[source]}</summary><dl>{fields.map((field) => values[field] && <div key={field}><dt>{FIELD_LABELS[field]}</dt><dd><CellValue cell={values[field]} field={field} /><Provenance cell={values[field]} source={source} /></dd></div>)}{relation && <div><dt>Position dans le mois</dt><dd>{relation}</dd></div>}</dl></details>
  </div>;
}
function Status({ row }: { row: ComparedRow }) {
  const linked = !!row.dsnId && !!row.payfitId;
  return <span className="rec-row-status"><span className={`tag ${linked ? "rec-linked" : ""}`}>{linked ? "Liée" : row.unmatched ? "Sans correspondance constatée" : "À rapprocher"}</span>{linked && <small>{REVIEW[row.status]}</small>}</span>;
}
function Comment({ id }: { id: string }) {
  return <div className="field-row"><label htmlFor={id}>Commentaire</label><textarea className="input" id={id} name="comment" rows={2} maxLength={500} required /></div>;
}

function RowAction({ run, row, index, action }: { run: ReconciliationRun; row: ComparedRow; index: number; action: ReconciliationAction }) {
  if (run.stale) return null;
  const control: ControlIdentity = { runId: run.id, revision: run.revision, inputHash: run.inputHash };
  const paired = !!row.dsnId && !!row.payfitId;
  const kind = paired ? `unlink-${row.entity}` : row.unmatched ? "reopen-unmatched" : "mark-unmatched";
  const testid = `rec-${kind}${paired ? "" : `-${row.entity}`}-${index}`;
  return <details className="rec-row-action"><summary>{paired ? "Dissocier" : row.unmatched ? "Rouvrir" : "Sans correspondance ?"}</summary>
    <ActionForm action={action} submit={paired ? "Dissocier" : row.unmatched ? "Rouvrir le rapprochement" : "Constater l’absence de correspondance"} testid={testid} className="rec-decision-form" plain>
      <ControlFields control={control} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="fingerprint" value={row.fingerprint} />
      {paired ? <><input type="hidden" name="dsnId" value={row.dsnId!} /><input type="hidden" name="payfitId" value={row.payfitId!} /></> : <><input type="hidden" name="entity" value={row.entity} /><input type="hidden" name="source" value={row.dsnId ? "dsn" : "payfit"} /><input type="hidden" name="id" value={(row.dsnId ?? row.payfitId)!} /></>}
      {paired && <p className="desc">{row.entity === "person" ? "Dissocier retire aussi les liaisons de contrats et les décisions de champs qui en dépendent." : "Dissocier retire aussi les décisions de champs de cette liaison."}</p>}
      <Comment id={`${testid}-comment`} />
    </ActionForm>
  </details>;
}

function SourceFacts({ source }: { source: SourceSnapshot }) {
  return <section className="rec-source" data-testid={`rec-source-${source.source}`}><h3>{SOURCE_LABELS[source.source]}</h3><dl className="facts">
    <div><dt>{source.source === "dsn" ? "Mois déclaré" : "Date de la photographie"}</dt><dd>{source.source === "dsn" ? source.period ? formatMonth(source.period) : "n.d." : formatDate(source.referenceDate)}</dd></div>
    <div><dt>Couverture</dt><dd>{COVERAGE[source.coverage]}</dd></div>
  </dl><details className="rec-provenance"><summary>Détail de la source</summary><dl><div><dt>Date de référence</dt><dd>{formatDate(source.referenceDate)}</dd></div><div><dt>Version du contrôle</dt><dd><code>{source.version}</code></dd></div></dl></details></section>;
}

function EntityTable({ run, rows, entity, action }: { run: ReconciliationRun; rows: ComparedRow[]; entity: EntityKind; action: ReconciliationAction }) {
  return <section className="panel rec-entity-panel" id={`rec-${entity === "person" ? "personnes" : "contrats"}`}>
    <div className="rec-section-head"><h2>{entity === "person" ? "Personnes" : "Contrats"}</h2><span className="desc">{rows.length} ligne{rows.length > 1 ? "s" : ""}</span></div>
    {!run.stale && <details className="rec-link"><summary className="btn">{entity === "person" ? "Lier deux personnes" : "Lier deux contrats"}</summary><LinkForm entity={entity} dsn={availableChoices(run, "dsn", entity)} payfit={availableChoices(run, "payfit", entity)} parents={run.state.personLinks} control={{ runId: run.id, revision: run.revision, inputHash: run.inputHash }} action={action} /></details>}
    {rows.length > 0 ? <div className="rec-table-scroll" tabIndex={0} role="region" aria-label={entity === "person" ? "Correspondances des personnes" : "Correspondances des contrats"}><table className="data-table rec-table" data-testid={`rec-${entity}-table`}>
      <thead><tr><th scope="col">DSN</th><th scope="col">PayFit</th><th scope="col">Correspondance</th><th scope="col">Actions</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.dsnId ?? ""}-${row.payfitId ?? ""}`} data-testid={`rec-row-${entity}-${index}`}>
        <td><EntitySourceCell run={run} source="dsn" entity={entity} id={row.dsnId} /></td><td><EntitySourceCell run={run} source="payfit" entity={entity} id={row.payfitId} /></td>
        <td><Status row={row} />{row.unmatched && <p className="rec-comment">{row.unmatched.comment}</p>}</td>
        <td><div className="rec-row-tools">{row.fields.length > 0 && <a href={`#rec-fields-${entity}-${index}`}>Voir les champs</a>}<RowAction run={run} row={row} index={index} action={action} /></div></td>
      </tr>)}</tbody>
    </table></div> : <p className="desc">Aucune ligne dans ce contrôle.</p>}
  </section>;
}

function FieldAction({ run, row, field, index, action }: { run: ReconciliationRun; row: ComparedRow; field: ComparedField; index: string; action: ReconciliationAction }) {
  if (run.stale || !row.dsnId || !row.payfitId || field.status === "equal" && !field.resolution) return null;
  const kind = field.resolution ? "reopen-field" : "resolve-field";
  const testid = `rec-${kind}-${index}`;
  return <details className="rec-row-action"><summary>{field.resolution ? "Rouvrir" : "Qualifier"}</summary><ActionForm action={action} submit={field.resolution ? "Rouvrir le champ" : "Enregistrer la qualification"} testid={testid} className="rec-decision-form" plain>
    <ControlFields control={{ runId: run.id, revision: run.revision, inputHash: run.inputHash }} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="entity" value={row.entity} /><input type="hidden" name="dsnId" value={row.dsnId} /><input type="hidden" name="payfitId" value={row.payfitId} /><input type="hidden" name="field" value={field.field} /><input type="hidden" name="fingerprint" value={field.fingerprint} />
    {!field.resolution && <div className="field-row"><label htmlFor={`${testid}-disposition`}>Qualification</label><select className="select" id={`${testid}-disposition`} name="disposition" required defaultValue=""><option value="" disabled>Choisir une qualification</option><option value="explained">Écart expliqué</option><option value="correction-requested">Correction à demander</option></select></div>}
    <Comment id={`${testid}-comment`} />
  </ActionForm></details>;
}

function Fields({ run, comparison, action }: { run: ReconciliationRun; comparison: Comparison; action: ReconciliationAction }) {
  const groups = [...comparison.persons.map((row, index) => ({ row, index })), ...comparison.contracts.map((row, index) => ({ row, index }))].filter(({ row }) => row.fields.length > 0);
  return <section className="panel" id="rec-ecarts"><h2>Champs comparés</h2>{groups.length ? groups.map(({ row, index }) => <section key={`${row.entity}-${index}`} className="rec-field-group" id={`rec-fields-${row.entity}-${index}`}>
    <h3>{entityLabel(row.entity)} · {rowName(run, "dsn", row.entity, row.dsnId)} ↔ {rowName(run, "payfit", row.entity, row.payfitId)}</h3>
    <div className="rec-table-scroll" tabIndex={0} role="region" aria-label={`Champs de la liaison ${entityLabel(row.entity).toLowerCase()} ${index + 1}`}><table className="data-table rec-table rec-fields-table" data-testid={`rec-fields-${row.entity}-${index}`}><thead><tr><th scope="col">Champ</th><th scope="col">DSN</th><th scope="col">PayFit</th><th scope="col">Constat</th><th scope="col">Qualification</th></tr></thead><tbody>{row.fields.map((field) => <tr key={field.field} data-field={field.field} data-status={field.status}>
      <th scope="row">{FIELD_LABELS[field.field]}</th><td><CellValue cell={field.dsn} field={field.field} /><Provenance cell={field.dsn} source="dsn" /></td><td><CellValue cell={field.payfit} field={field.field} /><Provenance cell={field.payfit} source="payfit" /></td>
      <td><span className={`tag rec-comparison-${field.status}`}>{COMPARISON[field.status]}</span></td>
      <td>{field.resolution && <p className="rec-field-resolution"><strong>{field.resolution.disposition === "explained" ? "Écart expliqué" : "Correction à demander"}</strong><span>{field.resolution.comment}</span></p>}<FieldAction run={run} row={row} field={field} index={`${row.entity}-${index}-${field.field}`} action={action} /></td>
    </tr>)}</tbody></table></div>
  </section>) : <p className="desc">Lie des personnes ou des contrats pour comparer leurs champs.</p>}</section>;
}

function historyText(action: Decision["action"]): string {
  switch (action.kind) {
    case "link-person": return "Liaison de personnes";
    case "link-contract": return "Liaison de contrats";
    case "unlink-person": return "Dissociation de personnes";
    case "unlink-contract": return "Dissociation de contrats";
    case "mark-unmatched": return "Absence de correspondance constatée";
    case "reopen-unmatched": return "Rapprochement rouvert";
    case "resolve-field": return `${FIELD_LABELS[action.target.field]} · ${action.disposition === "explained" ? "écart expliqué" : "correction à demander"}`;
    case "reopen-field": return `${FIELD_LABELS[action.target.field]} · champ rouvert`;
  }
}

export function ReconciliationView({ slug, model, actions }: { slug: string; model: ReconciliationModel; actions: ReconciliationActions }) {
  const run = model.selected;
  const comparison = run ? compareSnapshots(run.snapshot, run.state) : null;
  const base = `/e/${slug}/donnees/rapprochement`;
  const sourcesReady = model.sources.dsn.available && model.sources.payfit.available;
  const limits: string[] = [];
  if (run?.stale) limits.push("Les sources ont changé. Ce contrôle reste consultable ; ouvre un nouveau contrôle pour décider.");
  if (comparison?.temporal === "different-dates") limits.push("La DSN décrit un mois déclaré ; PayFit est une photographie à sa date de lecture. Les écarts peuvent refléter des dates différentes.");
  if (comparison?.temporal === "unknown") limits.push("Une date de référence manque : la concordance temporelle n’est pas établie.");
  if (run?.snapshot.payfit.historyLimited) limits.push("Historique PayFit limité : des contrats archivés depuis plus de 12 mois peuvent manquer. Une absence de correspondance ne prouve pas une absence historique de contrat ni une sortie.");
  if (comparison) for (const source of ["dsn", "payfit"] as const) if (comparison.coverage[source] !== "complete") limits.push(`${SOURCE_LABELS[source]} : couverture ${COVERAGE[comparison.coverage[source]].toLowerCase()}.`);
  if (run) for (const source of ["dsn", "payfit"] as const) for (const collection of run.snapshot[source].collectionsMissing ?? []) limits.push(`${SOURCE_LABELS[source]} : ${collection === "persons" ? "personnes" : "contrats"} indisponibles dans le contrôle.`);
  return <div className="rec-page" data-testid="reconciliation">
    <header className="rec-head"><div><span className="label">Données</span><h1>Rapprochement DSN / PayFit</h1></div>{limits.length > 0 && <DropdownMenu label={<>Vigilance ({limits.length}) <span aria-hidden="true">?</span></>} testid="rec-vigilance"><div className="rec-vigilance-body"><ul>{limits.map((limit) => <li key={limit}>{limit}</li>)}</ul></div></DropdownMenu>}</header>

    <section className="panel rec-controls" aria-label="Choisir un contrôle">
      {sourcesReady && model.months.length > 0 && <ActionForm action={actions.create} submit="Créer un nouveau contrôle" testid="rec-create" className="rec-create-form">
        <div className="field-row"><label htmlFor="rec-month">Mois DSN à contrôler</label><select className="select" id="rec-month" name="controlMonth" defaultValue={run && model.months.includes(run.controlMonth) ? run.controlMonth : ""} required><option value="" disabled>Choisir un mois déclaré</option>{model.months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></div>
      </ActionForm>}
      {model.runs.length > 0 && <form method="get" action={base} className="rec-history-picker" data-testid="rec-history-picker"><div className="field-row"><label htmlFor="rec-run">Contrôles enregistrés</label><select className="select" id="rec-run" name="run" defaultValue={run?.id ?? ""} required><option value="" disabled>Choisir un contrôle</option>{model.runs.map((item) => <option key={item.id} value={item.id}>{formatMonth(item.controlMonth)} · {dateTime(item.createdAt)}</option>)}</select></div><button className="btn" type="submit">Ouvrir</button></form>}
    </section>

    {!sourcesReady && <section className="placeholder" data-testid="rec-sources-missing"><h2>Sources requises</h2><p className="desc">{!model.sources.dsn.available && "DSN appliquée manquante. "}{!model.sources.payfit.available && "Lecture PayFit appliquée manquante."}</p><a href={`/e/${slug}/donnees`}>Ouvrir Données</a></section>}
    {!run && sourcesReady && <section className="placeholder" data-testid="rec-no-control"><h2>Aucun contrôle sélectionné</h2><p className="desc">Choisis un mois et crée un contrôle, ou ouvre un contrôle enregistré.</p></section>}

    {run && comparison && <>
      <div className="rec-run-meta"><p data-testid="rec-control-period"><strong>{formatMonth(run.controlMonth)}</strong> · créé le {dateTime(run.createdAt)} · révision {run.revision}</p>{run.stale && <span className="tag" data-testid="rec-stale">Contrôle obsolète · consultation seule</span>}</div>
      <div className="rec-sources"><SourceFacts source={run.snapshot.dsn} /><SourceFacts source={run.snapshot.payfit} /></div>
      <nav className="rec-sections" aria-label="Sections du rapprochement"><a href="#rec-personnes">Personnes</a><a href="#rec-contrats">Contrats</a><a href="#rec-ecarts">Champs comparés</a><a href="#rec-journal">Journal des décisions</a></nav>
      <EntityTable run={run} rows={comparison.persons} entity="person" action={actions.decide} />
      <EntityTable run={run} rows={comparison.contracts} entity="contract" action={actions.decide} />
      <Fields run={run} comparison={comparison} action={actions.decide} />
      <section className="panel" id="rec-journal"><h2>Journal des décisions</h2>{run.decisions.length ? <div className="rec-table-scroll" tabIndex={0} role="region" aria-label="Historique des décisions du contrôle"><table className="data-table rec-table" data-testid="rec-journal"><thead><tr><th scope="col">Date</th><th scope="col">Auteur</th><th scope="col">Décision</th><th scope="col">Commentaire</th></tr></thead><tbody>{run.decisions.map((decision) => <tr key={decision.revision}><td>{dateTime(decision.createdAt)}</td><td>{model.actorNames?.[decision.actorId] ?? "Utilisateur"}</td><td>{historyText(decision.action)}<small className="rec-revision">Révision {decision.revision}</small></td><td>{"comment" in decision.action ? decision.action.comment : "—"}</td></tr>)}</tbody></table></div> : <p className="desc">Aucune décision enregistrée.</p>}</section>
    </>}
  </div>;
}
