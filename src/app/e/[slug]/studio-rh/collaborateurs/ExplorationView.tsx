import type { ReactNode } from "react";
import { Money, MoneyUnitLabel } from "@/components/Money";
import { formatDate, formatMonth, isIsoDate } from "@/lib/dates";
import { explorationPivot, explorationTree, explorationTimeGap, type ExplorationAxis, type ExplorationCategory, type ExplorationCount, type ExplorationMeasure, type ExplorationModel, type ExplorationRow, type ExplorationTreeNode } from "@/lib/rh/exploration";
import { explorationAbsencesForContract, type ExplorationAbsenceEvent, type ExplorationAbsencesModel } from "@/lib/rh/exploration-absences";
import { filterPayrollItems, formatPayrollItemCents, type PayrollItemMoney, type PayrollItemsModel } from "@/lib/rh/payroll-items";

export type ExplorationMode = "tree" | "pivot" | "pointage" | "rubrique";
export type ExplorationViewFilters = {
  month: string; q: string; establishment: string; nature: string; team: string;
  rowAxis: ExplorationAxis; colAxis: ExplorationAxis; measure: "persons" | "contracts"; rubric: string;
};
type Option = { value: string; label: string };
export type ExplorationViewOptions = { months: string[]; establishments: Option[]; natures: Option[]; teams: Option[]; rubrics?: Option[] };
export type ExplorationViewProps = { slug: string; mode: ExplorationMode; filters: ExplorationViewFilters; options: ExplorationViewOptions; exploration?: ExplorationModel; payroll?: PayrollItemsModel; absences?: ExplorationAbsencesModel; showVigilance?: boolean };

const TITLES: Record<ExplorationMode, string> = { tree: "Vue en arbre", pivot: "Liste mensuelle croisée", pointage: "Pointage des collaborateurs", rubrique: "Collaborateurs par rubrique" };
const AXES: { value: ExplorationAxis; label: string }[] = [{ value: "team", label: "Équipe" }, { value: "nature", label: "Type de contrat" }, { value: "establishment", label: "Établissement / périmètre source" }, { value: "state", label: "Situation dans le mois" }];
const axisLabel = (axis: ExplorationAxis) => AXES.find((a) => a.value === axis)?.label ?? axis;
const number = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 20 }).format(value);
const plural = (n: number, word: string) => `${number(n)} ${word}${n === 1 ? "" : "s"}`;
const monthLabel = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? formatMonth(month) : "Mois non disponible";
const personHref = (slug: string, key: string) => `/e/${slug}/studio-rh/collaborateurs/p/${encodeURIComponent(key)}`;
const contractHref = (slug: string, key: string) => `/e/${slug}/studio-rh/collaborateurs/c/${encodeURIComponent(key)}`;
const categoryText = (category: ExplorationCategory) => `${category.label}${category.value === null ? " · n.d." : ""}`;
function CategoryLabel({ category }: { category: ExplorationCategory }) {
  return <>{category.label}{category.value === null && <span className="cxp-category-nd" title="Valeur absente de la source">n.d.</span>}</>;
}

function Nd({ reason }: { reason?: string | null }) {
  return <span className="nd" title={reason ?? "Donnée absente de la source."}>n.d.<span className="collab-sr"> — {reason ?? "Donnée absente de la source."}</span></span>;
}
function Help({ label, children }: { label: string; children: ReactNode }) {
  return <details className="cxp-help"><summary aria-label={label}><span aria-hidden="true">?</span></summary><div>{children}</div></details>;
}
function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return <div className="cxp-scroll" tabIndex={0} role="region" aria-label={label}>{children}</div>;
}
function MoneyCellValue({ value }: { value: PayrollItemMoney }) {
  if (value.kind === "nd") return <Nd reason={value.reason} />;
  return <Money cents={value.cents} exactText={formatPayrollItemCents(value.cents)} />;
}
function Person({ slug, row }: { slug: string; row: ExplorationRow }) {
  return <span className="cxp-person">{row.personKey ? <a href={personHref(slug, row.personKey)}>{row.personName ?? "Nom non renseigné"}</a> : <Nd reason="Contrat sans collaborateur rattaché." />}<a className="cxp-contract" href={contractHref(slug, row.contractKey)}>{row.contractLabel}</a></span>;
}
function Constituents({ slug, rows, ids }: { slug: string; rows: ExplorationRow[]; ids: string[] }) {
  const selected = new Set(ids);
  return <ul className="cxp-constituents" aria-label="Observations par contrat et périmètre source">{rows.filter((r) => selected.has(r.id)).map((row) => <li key={row.id}><Person slug={slug} row={row} /><span className="cxp-small">{row.establishment.label}<span className="cxp-small">{row.state.label}</span></span></li>)}</ul>;
}
function CountSummary({ count, qualifier }: { count: ExplorationCount; qualifier: string }) {
  return <dl className="cxp-counts" data-testid="exploration-counts"><div><dt>Collaborateurs distincts</dt><dd>{number(count.persons)}</dd></div><div><dt>Contrats observés</dt><dd>{number(count.contracts)}</dd></div><div><dt>Périmètre</dt><dd className="cxp-count-note">{qualifier}{count.withoutPerson > 0 && <span>{plural(count.withoutPerson, "contrat")} sans collaborateur rattaché</span>}</dd></div></dl>;
}

function FilterForm({ slug, mode, filters, options, payroll }: ExplorationViewProps) {
  const base = `/e/${slug}/studio-rh/collaborateurs/${mode}`;
  const select = (label: string, name: string, value: string, list: Option[], all: string) => <label className="field-row"><span>{label}</span><select name={name} defaultValue={value}><option value="">{all}</option>{value && !list.some((item) => item.value === value) && <option value={value}>Filtre indisponible</option>}{list.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>;
  return <form className="cxp-filters" action={base} method="get" data-testid="exploration-filters">
    <label className="field-row"><span>Mois</span><select name="mois" defaultValue={filters.month}>{!options.months.includes(filters.month) && <option value={filters.month}>{monthLabel(filters.month)}</option>}{options.months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
    <label className="field-row cxp-search"><span>Rechercher</span><input name="q" type="search" defaultValue={filters.q} maxLength={80} placeholder={mode === "rubrique" ? "Collaborateur, contrat, compte…" : "Collaborateur, contrat, équipe…"} /></label>
    {mode !== "rubrique" && <>{select("Établissement / périmètre source", "etab", filters.establishment, options.establishments, "Tous les périmètres")}{select("Type de contrat", "nature", filters.nature, options.natures, "Tous les types")}{select("Équipe", "equipe", filters.team, options.teams, "Toutes les équipes")}</>}
    {mode === "rubrique" && select(payroll?.source === "dsn" ? "Type de rémunération DSN" : "Rubrique comptable", "rubrique", filters.rubric, options.rubrics ?? payroll?.rubrics.map((r) => ({ value: r.key, label: r.label })) ?? [], "Choisir une rubrique")}
    {mode === "pivot" && <>
      <label className="field-row"><span>Lignes</span><select name="lignes" defaultValue={filters.rowAxis}>{AXES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
      <label className="field-row"><span>Colonnes</span><select name="colonnes" defaultValue={filters.colAxis}>{AXES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
      <label className="field-row"><span>Mesure</span><select name="mesure" defaultValue={filters.measure}><option value="persons">Collaborateurs distincts</option><option value="contracts">Contrats distincts</option></select></label>
    </>}
    <div className="cxp-actions"><button className="btn" type="submit">Afficher</button><a href={base}>Réinitialiser</a></div>
  </form>;
}

function TreeBranch({ node, rows, slug, depth = 0 }: { node: ExplorationTreeNode; rows: ExplorationRow[]; slug: string; depth?: number }) {
  if (!node.category) return <>{node.children.map((child) => <TreeBranch key={child.category?.key ?? child.axis} node={child} rows={rows} slug={slug} />)}</>;
  return <li><details className="cxp-branch" open={depth === 0} data-testid="exploration-tree-node"><summary><span className="cxp-branch-label"><CategoryLabel category={node.category} /></span><span className="cxp-branch-count">{plural(node.count.persons, "collaborateur")} · {plural(node.count.contracts, "contrat")}</span></summary><div className="cxp-branch-body">{node.children.length ? <ul>{node.children.map((child) => <TreeBranch key={child.category?.key ?? child.axis} node={child} rows={rows} slug={slug} depth={depth + 1} />)}</ul> : <Constituents slug={slug} rows={rows} ids={node.rowIds} />}</div></details></li>;
}
function TreeView({ slug, model }: { slug: string; model: ExplorationModel }) {
  const tree = explorationTree(model);
  return <section className="panel cxp-panel" data-testid="exploration-tree"><div className="panel-head"><h2>Équipes et types de contrat</h2><Help label="Définition de la vue en arbre"><p>Regroupement des contrats observés dans le mois par équipe, puis type de contrat. L’équipe PayFit correspond à la photographie de lecture ; elle ne certifie pas un rattachement historique.</p><p>Cette vue ne déduit ni manager ni lien hiérarchique. Une personne avec plusieurs contrats est comptée une seule fois à chaque niveau.</p></Help></div><ul className="cxp-tree"><TreeBranch node={tree} rows={model.rows} slug={slug} /></ul></section>;
}
function PivotView({ slug, model, filters }: { slug: string; model: ExplorationModel; filters: ExplorationViewFilters }) {
  const pivot = explorationPivot(model, filters.rowAxis, filters.colAxis);
  const metric = filters.measure === "contracts" ? "contracts" : "persons";
  const label = metric === "persons" ? "collaborateurs distincts" : "contrats distincts";
  const counts = (count: ExplorationCount | undefined, accessible: string) => {
    if (!count || count.rowIds.length === 0) return <span title="Aucune ligne observée dans cette cellule.">0</span>;
    const missingIdentity = metric === "persons" && count.persons === 0 ? " — identité manquante" : "";
    return <details className="cxp-cell-detail"><summary title={missingIdentity ? "Contrat observé avec identité manquante : ouvrir pour consulter la source." : undefined} aria-label={`${number(count[metric])} ${label}, ${accessible}${missingIdentity} — voir les contrats`}>{number(count[metric])}</summary><Constituents slug={slug} rows={model.rows} ids={count.rowIds} /></details>;
  };
  const params = new URLSearchParams({ mois: filters.month, q: filters.q, etab: filters.establishment, nature: filters.nature, equipe: filters.team, lignes: filters.colAxis, colonnes: filters.rowAxis, mesure: filters.measure });
  return <section className="panel cxp-panel" data-testid="exploration-pivot"><div className="panel-head"><h2>{axisLabel(filters.rowAxis)} × {axisLabel(filters.colAxis)}</h2><div className="cxp-panel-actions"><a href={`?${params.toString()}`} data-testid="exploration-swap">Inverser les axes</a><Help label="Définition du tableau croisé"><p>Chaque cellule ouvre les contrats qui la composent. Les personnes sont dédupliquées dans chaque cellule et chaque total : les totaux ne sont pas la somme des cellules lorsque plusieurs contrats concernent la même personne.</p><p>Une dimension absente reste dans un groupe « non renseigné ». Aucun ETP ni montant n’est déduit de ces effectifs.</p></Help></div></div>
    <Scroll label="Tableau croisé mensuel des collaborateurs"><table className="data-table cxp-table cxp-pivot-table" data-testid="exploration-pivot-table"><caption className="collab-sr">{monthLabel(model.month)} — {label}, lignes {axisLabel(filters.rowAxis)}, colonnes {axisLabel(filters.colAxis)}</caption><thead><tr><th scope="col">{axisLabel(filters.rowAxis)}</th>{pivot.columnCategories.map((col) => <th className="num" scope="col" key={col.key}><CategoryLabel category={col} /></th>)}<th className="num cxp-total" scope="col">Total distinct</th></tr></thead><tbody>{pivot.rowCategories.map((row) => <tr key={row.key}><th scope="row"><CategoryLabel category={row} /></th>{pivot.columnCategories.map((col) => <td className="num" key={col.key}>{counts(pivot.cells.find((c) => c.rowKey === row.key && c.columnKey === col.key), `${categoryText(row)}, ${categoryText(col)}`)}</td>)}<td className="num cxp-total">{counts(pivot.rowTotals.find((r) => r.key === row.key), `total ${categoryText(row)}`)}</td></tr>)}</tbody><tfoot><tr><th scope="row">Total distinct</th>{pivot.columnCategories.map((col) => <td className="num" key={col.key}>{counts(pivot.columnTotals.find((r) => r.key === col.key), `total ${categoryText(col)}`)}</td>)}<td className="num cxp-total">{counts(pivot.total, "périmètre filtré")}</td></tr></tfoot></table></Scroll>
    <p className="cxp-small cxp-table-foot">{metric === "persons" ? "Personnes distinctes dans chaque total." : "Contrats distincts dans chaque total."} Ouvre un nombre pour consulter ses contrats.</p>
  </section>;
}

function TimeValue({ measure, signed = false }: { measure: ExplorationMeasure; signed?: boolean }) {
  return measure.value === null ? <Nd reason={measure.reason} /> : <span>{signed && measure.value > 0 ? "+" : ""}{number(measure.value)}</span>;
}
function AbsenceEvents({ events }: { events: ExplorationAbsenceEvent[] }) {
  return <ul className="cxp-absence-events">{events.map((event) => <li key={event.id} data-testid="pointage-absence-event">
    <strong>{event.typeLabel}</strong><span>{event.statusLabel ?? <Nd reason="Statut de l’événement absent de la source." />}</span>
    {(event.personName || event.contractLabel) && <span className="cxp-small">{[event.personName, event.contractLabel].filter(Boolean).join(" · ")}</span>}
    <span>Début : {isIsoDate(event.start.date) ? formatDate(event.start.date) : <Nd reason="Date de début absente ou non interprétable." />}{event.start.momentLabel && ` · ${event.start.momentLabel}`}</span>
    <span>Fin : {isIsoDate(event.end.date) ? formatDate(event.end.date) : <Nd reason="Date de fin absente ou non interprétable." />}{event.end.momentLabel && ` · ${event.end.momentLabel}`}</span>
    {event.position === "unpositioned" && <span className="cxp-small">Rattachement au mois non déterminé</span>}
    {event.notes.map((note) => <span className="cxp-small" key={note}>{note}</span>)}
  </li>)}</ul>;
}
function AbsenceCell({ slug, absences, contractKey }: { slug: string; absences?: ExplorationAbsencesModel; contractKey: string }) {
  const observed = absences ? explorationAbsencesForContract(absences, contractKey) : null;
  if (!observed || observed.kind === "nd") return <Nd reason={observed?.reason ?? "Absences non disponibles dans la lecture source."} />;
  const label = observed.count === null ? "n.d. — dates à vérifier" : `${plural(observed.count, "événement")} remonté${observed.count === 1 ? "" : "s"}`;
  if (!observed.events.length && !observed.unpositioned.length) return <span>{label}</span>;
  return <details className="cxp-row-details cxp-absence-cell" data-testid="pointage-absence-details"><summary title={observed.reason ?? undefined}>{label}</summary><div>
    {observed.reason && <p>{observed.reason}</p>}
    <AbsenceEvents events={observed.events} />
    {observed.unpositioned.length > 0 && <div><p><strong>Période non déterminée</strong></p><AbsenceEvents events={observed.unpositioned} /></div>}
    {absences?.syncId && <a href={`/e/${slug}/donnees/synchro/${encodeURIComponent(absences.syncId)}`}>Lecture des absences</a>}
  </div></details>;
}
function AbsenceExceptions({ absences }: { absences?: ExplorationAbsencesModel }) {
  if (!absences || (!absences.unlinked.length && !absences.unpositioned.length)) return null;
  return <div className="cxp-absence-exceptions" data-testid="pointage-absence-exceptions">
    <p className="cxp-small">Événements à vérifier dans la lecture source</p>
    {absences.unlinked.length > 0 && <details className="cxp-row-details"><summary>{plural(absences.unlinked.length, "événement")} sans contrat affiché</summary><div><AbsenceEvents events={absences.unlinked} /></div></details>}
    {absences.unpositioned.length > 0 && <details className="cxp-row-details"><summary>{plural(absences.unpositioned.length, "événement")} avec période non déterminée</summary><div><p>Le rattachement de ces événements au mois choisi reste inconnu.</p><AbsenceEvents events={absences.unpositioned} /></div></details>}
  </div>;
}
function PointageView({ slug, model, absences }: { slug: string; model: ExplorationModel; absences?: ExplorationAbsencesModel }) {
  return <section className="panel cxp-panel" data-testid="exploration-pointage">
    <div className="panel-head"><h2>Temps et absences par contrat</h2><Help label="Définition du pointage"><p>Temps payé et temps travaillé tels que transmis par la source pour le mois. L’écart vaut travaillé − payé, uniquement si les deux valeurs et leur unité sont comparables.</p><p>Les absences sont les événements remontés par la source, avec leurs types, statuts et bornes d’origine. Le compteur décrit des événements, sans calcul de durée ni taux d’absentéisme. Un événement traversant plusieurs mois conserve sa période complète.</p><p>Ce contrôle mensuel ne constitue pas une feuille de présence quotidienne. Les unités ne sont pas converties et les temps ne sont pas additionnés entre collaborateurs.</p></Help></div>
    <Scroll label="Pointage mensuel des collaborateurs"><table className="data-table cxp-table" data-testid="exploration-pointage-table"><caption className="collab-sr">Temps et événements d’absence observés par contrat — {monthLabel(model.month)}</caption><thead><tr><th scope="col">Collaborateur / contrat</th><th scope="col">Situation</th><th scope="col" className="num">Temps payé</th><th scope="col" className="num">Temps travaillé</th><th scope="col" className="num">Écart travaillé − payé</th><th scope="col">Unité source</th><th scope="col">Absences</th><th scope="col">Lecture</th></tr></thead>
      <tbody>{model.rows.map((row) => <tr key={row.id} data-row={row.id}>
        <th scope="row"><Person slug={slug} row={row} /></th><td>{row.state.label}</td>
        <td className="num" data-col="paid"><TimeValue measure={row.paidTime} /></td><td className="num" data-col="worked"><TimeValue measure={row.workedTime} /></td><td className="num" data-col="gap"><TimeValue measure={explorationTimeGap(row)} signed /></td><td>{row.timeUnit ? row.timeUnitLabel : <Nd reason="Unité de temps absente de la source." />}</td>
        <td data-col="absences"><AbsenceCell slug={slug} absences={absences} contractKey={row.contractKey} /></td>
        <td><details className="cxp-row-details"><summary>Source et limites</summary><div><p>{model.source === "payfit" ? "PayFit" : "DSN"} · {monthLabel(model.month)} · lecture du {formatDate(model.referenceDate)}</p>{row.paidTime.trace && <p>Temps payé : {row.paidTime.trace.path}</p>}{row.workedTime.trace && <p>Temps travaillé : {row.workedTime.trace.path}</p>}{row.notes.map((note) => <p key={note}>{note}</p>)}{row.paidTime.reason && <p>Temps payé : {row.paidTime.reason}</p>}{row.workedTime.reason && <p>Temps travaillé : {row.workedTime.reason}</p>}</div></details></td>
      </tr>)}</tbody></table></Scroll>
    <AbsenceExceptions absences={absences} />
  </section>;
}

function RubriqueView({ slug, filters, payroll }: { slug: string; filters: ExplorationViewFilters; payroll?: PayrollItemsModel }) {
  if (!payroll || payroll.kind === "nd") return <Empty slug={slug} reason={payroll?.reason ?? "Aucune lecture de rémunération disponible pour ce mois."} />;
  const selected = payroll.rubrics.find((r) => r.key === filters.rubric);
  if (filters.rubric && !selected) return <Empty slug={slug} reason="Rubrique absente de la source pour ce mois. Choisis une rubrique disponible." />;
  if (!selected) return <section className="panel cxp-panel" data-testid="exploration-choose-rubric"><h2>Choisir une rubrique</h2><p className="desc">Sélectionne {payroll.source === "dsn" ? "un type de rémunération DSN" : "une rubrique comptable"} pour consulter ses lignes et son total.</p></section>;
  const filtered = filterPayrollItems(payroll, { q: filters.q, rubricKey: selected.key });
  const total = filtered.totals.find((t) => t.rubricKey === selected.key);
  return <section className="panel cxp-panel" data-testid="exploration-rubrique"><div className="panel-head"><div><h2>{selected.label}</h2><p className="cxp-small">{payroll.source === "dsn" ? "Rémunérations déclarées en DSN" : "Journal comptable de paie PayFit"} · <MoneyUnitLabel /></p></div><Help label="Définition des rubriques et de leur total">{payroll.source === "dsn" ? <p>Une ligne par occurrence de rémunération du type DSN choisi. Les types de rémunération peuvent se recouvrir ; ils ne sont jamais additionnés entre eux. Aucune rubrique de bulletin PayFit n’est reconstituée.</p> : <p>Une ligne par écriture du journal de paie, classée selon la grille de comptes de l’espace. Ces regroupements comptables ne représentent pas les rubriques des bulletins. Le montant vaut débit − crédit.</p>}<p>Le total concerne les lignes affichées après recherche, pour cette seule rubrique. Une ligne sans montant rend le total non disponible ; un zéro explicite reste zéro.</p></Help></div>
    <dl className="cxp-rubric-total"><div><dt>Total des lignes affichées</dt><dd data-testid="exploration-rubric-total">{total ? <MoneyCellValue value={total.amount} /> : <Nd reason="Aucune occurrence de cette rubrique dans le périmètre filtré." />}</dd></div><div><dt>Occurrences source</dt><dd>{number(filtered.rows.length)}</dd></div></dl>
    <Scroll label="Lignes de paie de la rubrique sélectionnée"><table className="data-table cxp-table" data-testid="exploration-rubrique-table"><caption className="collab-sr">{selected.label} — {monthLabel(payroll.month)}, après recherche, montants en euros</caption><thead><tr><th scope="col">Collaborateur / contrat</th><th scope="col">{payroll.source === "dsn" ? "Type DSN" : "Compte"}</th><th scope="col" className="num">Montant</th><th scope="col">Période / date</th><th scope="col">Rattachement et source</th></tr></thead><tbody>{filtered.rows.map((row) => <tr key={row.id} data-row={row.id}><th scope="row"><span className="cxp-person">{row.personKey ? <a href={personHref(slug, row.personKey)}>{row.personLabel ?? "Nom non renseigné"}</a> : <Nd reason={row.attachment === "no-contract" ? "Ligne source sans contrat." : "Aucun collaborateur rattaché de manière certaine."} />}{row.contractKey ? <a className="cxp-contract" href={contractHref(slug, row.contractKey)}>{row.contractLabel ?? "Ouvrir le contrat"}</a> : <span className="cxp-small">{row.attachment === "no-contract" ? "Sans contrat dans la source" : "Contrat non rattaché"}</span>}</span></th><td>{row.accountId ? <><span>{row.accountId}</span>{row.accountLabel && <span className="cxp-small">{row.accountLabel}</span>}</> : row.rubricLabel}</td><td className="num"><MoneyCellValue value={row.amount} /></td><td>{row.operationDate ? formatDate(row.operationDate) : row.startDate || row.endDate ? `${formatDate(row.startDate)} → ${formatDate(row.endDate)}` : <Nd reason="Période détaillée absente de la source." />}{row.paymentDate && <span className="cxp-small">Versement : {formatDate(row.paymentDate)}</span>}</td><td><details className="cxp-row-details"><summary>{row.attachment === "linked" ? "Rattachée" : row.attachment === "no-contract" ? "Sans contrat" : "Non rattachée"}</summary><div>{row.provenance.map((p) => <p key={`${p.recordId}:${p.path}`}>{p.syncId ? <a href={`/e/${slug}/donnees/synchro/${encodeURIComponent(p.syncId)}`}>Lecture source</a> : "Lecture source non renseignée"} · {p.period ?? "période n.d."} · {p.path}</p>)}</div></details></td></tr>)}</tbody></table></Scroll>
    {filtered.rows.length === 0 && <p className="desc cxp-table-foot" data-testid="exploration-no-payroll-row">Aucune ligne ne correspond à cette recherche.</p>}
  </section>;
}

function Empty({ slug, reason }: { slug: string; reason: string }) {
  return <section className="panel cxp-panel cxp-empty" data-testid="exploration-nd"><h2>n.d. — données indisponibles</h2><p>{reason}</p><a href={`/e/${slug}/donnees`}>Vérifier les sources dans Données</a></section>;
}
export function ExplorationView(props: ExplorationViewProps) {
  const { slug, mode, filters, exploration: model, payroll, absences } = props;
  const notices = [...new Set([...(model?.notices ?? []), ...(payroll?.notices ?? []), ...(mode === "pointage" ? [...(absences?.notices ?? []), ...(absences?.reason ? [absences.reason] : [])] : [])])];
  const gate = mode !== "rubrique" ? model?.gate : null;
  const unavailable = mode !== "rubrique" && (!model || !!gate);
  return <div className="cxp" data-testid={`collab-exploration-${mode}`}><div className="cxp-view-head"><div><h2>{TITLES[mode]}</h2><p className="cxp-small">{monthLabel(filters.month)}{mode === "rubrique" && payroll?.source ? ` · ${payroll.source === "payfit" ? "Rubriques comptables PayFit" : "Types de rémunération DSN"}` : ""}</p></div>{props.showVigilance !== false && notices.length > 0 && <details className="cxp-vigilance" data-testid="exploration-vigilance"><summary>Vigilance ({notices.length}) <span aria-hidden="true">?</span></summary><ul>{notices.map((n) => <li key={n}>{n}</li>)}</ul></details>}</div>
    <FilterForm {...props} />
    {unavailable ? <Empty slug={slug} reason={gate?.reason ?? "Aucun référentiel disponible pour ce mois."} /> : mode === "rubrique" ? <RubriqueView slug={slug} filters={filters} payroll={payroll} /> : model && <>
      <CountSummary count={model.total} qualifier={model.coverageKind === "lower_bound" ? "Observation partielle · après filtres" : "Observation du mois · après filtres"} />
      {model.rows.length === 0 ? <section className="panel cxp-panel" data-testid="exploration-empty"><h2>Aucun contrat observé</h2><p className="desc">Aucune ligne ne correspond au mois et aux filtres choisis.</p>{mode === "pointage" && <AbsenceExceptions absences={absences} />}</section> : mode === "tree" ? <TreeView slug={slug} model={model} /> : mode === "pivot" ? <PivotView slug={slug} model={model} filters={filters} /> : <PointageView slug={slug} model={model} absences={absences} />}
    </>}
  </div>;
}
