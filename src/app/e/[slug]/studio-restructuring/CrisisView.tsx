import "@/styles/masse-salariale.css";
import "@/styles/restructuring.css";
import { Money, MoneyUnitLabel } from "@/components/Money";
import { FamilyTabs } from "@/components/FamilyTabs";
import { formatDate } from "@/lib/dates";
import type { CrisisContext } from "@/lib/restructuring/crisis/context";
import { DEBT_NATURES, RANKS, type Amount, type CrisisItem, type CrisisPosition } from "@/lib/restructuring/crisis/model";
import { RESTRUCTURING_VIEWS as VIEWS } from "@/lib/restructuring/views";
import { PanelHead, ReadDetails, Tile } from "../studio-rh/masse-salariale/components";
import { ActionForm } from "../studio-rh/hypotheses/ActionForm";
import type { FormState } from "../studio-rh/hypotheses/actions";
import { Field } from "../studio-rh/hypotheses/shared";

export type CrisisRanksAction = (previous: FormState, form: FormData) => Promise<FormState>;
type Props = CrisisContext & { saveRanks?: CrisisRanksAction };
type Value = Extract<CrisisPosition, { kind: "value" }>;

const rankLabel = (id: string | null) => RANKS.find((rank) => rank.id === id)?.label ?? null;

function tabHref(p: Props, view: string) {
  const query = new URLSearchParams({ vue: view });
  if (view === "crisis" || view === "cash") {
    if (p.exercise) query.set("exercice", p.exercise.filename);
    if (p.asOf) query.set("date", p.asOf);
  } else {
    if (p.reference) query.set("reference", p.reference);
    if (p.projet) query.set("projet", p.projet);
  }
  return `/e/${p.slug}/studio-restructuring?${query}`;
}

function Cell({ amount }: { amount: Amount }) {
  if (amount.cents === null) return <><span className="nd" title={amount.reason ?? undefined}>n.d.</span><small className="restructuring-nd-reason">{amount.reason}</small></>;
  return <Money cents={amount.cents} />;
}
const tile = (amount: Amount) => amount.cents === null ? "n.d." : <Money cents={amount.cents} />;

function Filters({ p }: { p: Props }) {
  if (!p.exercise) return null;
  return <form method="get" className="filters bar restructuring-filters" data-testid="crisis-filters" aria-label="Exercice et date d’arrêté">
    <input type="hidden" name="vue" value="crisis" />
    <div className="field-row"><label htmlFor="crisis-exercise">Exercice (FEC appliqué)</label><select id="crisis-exercise" name="exercice" className="select" defaultValue={p.exercise.filename}>{p.exercises.map((e) => <option key={e.filename} value={e.filename}>{formatDate(e.firstDate)} → {formatDate(e.lastDate)} · {e.filename}</option>)}</select></div>
    <div className="field-row"><label htmlFor="crisis-date">Date d’arrêté</label><input id="crisis-date" name="date" type="date" className="input" min={p.exercise.firstDate} max={p.exercise.lastDate} defaultValue={p.asOf ?? p.exercise.lastDate} /></div>
    <button type="submit" className="btn primary">Afficher</button>
  </form>;
}

function Reading({ p }: { p: Props }) {
  return <div className="ms-read restructuring-read"><p className="source-badge"><span>Source :</span><strong>FEC appliqué dans Données</strong>{p.exercise && p.asOf ? <span>— exercice du {formatDate(p.exercise.firstDate)} au {formatDate(p.exercise.lastDate)}, arrêté au {formatDate(p.asOf)}</span> : null}</p><ReadDetails>
    <p>Chaque montant est le solde d’un compte, ou d’un compte auxiliaire, calculé sur les écritures de l’exercice jusqu’à la date d’arrêté, à-nouveaux compris. Un seul exercice est lu à la fois.</p>
    <p><strong>Disponibilités</strong> : soldes débiteurs des comptes de banque, d’établissements financiers et de caisse (51 hors 519, 53, 54). Un compte de trésorerie créditeur est un découvert, classé en dette bancaire.</p>
    <p><strong>Dettes comptabilisées</strong> : soldes créditeurs par nature — {DEBT_NATURES.map((n) => `${n.label.toLowerCase()} (${n.accounts})`).join(" ; ")}. Les soldes débiteurs de ces comptes (acomptes, avances, crédits de TVA) sont affichés à part et ne sont jamais déduits.</p>
    <p><strong>Ce n’est pas encore le passif exigible.</strong> Le FEC ne contient aucune date d’échéance : Clair ne sait pas dire, à partir de lui seul, quelle part de ces dettes est échue. L’échéancier sera saisi dans la trésorerie à 13 semaines.</p>
    <p><strong>Rang</strong> : choisi par toi pour chaque nature de dette. Clair ne qualifie aucune créance et ne suppose aucun rang ; ce classement par nature est une simplification à valider avec le conseil de l’entreprise.</p>
    <p>Non lus ici : clients (41 hors 419), comptes d’attente et de régularisation (47, 48), dépréciations (49, 59), virements internes (58). La lecture Pennylane par API n’est pas utilisée pour ces soldes.</p>
  </ReadDetails></div>;
}

function Items({ items, label }: { items: CrisisItem[]; label: string }) {
  return <div className="table-wrap scroll restructuring-scroll" tabIndex={0} role="region" aria-label={label}><table className="data-table"><thead><tr><th scope="col">Compte</th><th scope="col">Libellé</th><th scope="col">Tiers</th><th scope="col" className="num">Solde</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.accountId}|${item.auxiliary ?? ""}`}><th scope="row">{item.accountId}</th><td>{item.accountName ?? <span className="nd">n.d.</span>}</td><td>{item.auxiliary ? `${item.auxiliaryLabel ?? ""} ${item.auxiliaryLabel ? `(${item.auxiliary})` : item.auxiliary}`.trim() : "—"}</td><td className="num"><Money cents={item.cents} /></td></tr>)}</tbody></table></div>;
}

function Natures({ position }: { position: Value }) {
  return <section className="panel restructuring-section" data-testid="crisis-natures"><PanelHead title="Dettes comptabilisées par nature" desc={<>Soldes créditeurs à la date d’arrêté · montants en <MoneyUnitLabel /></>} />
    <div className="table-wrap scroll" tabIndex={0} role="region" aria-label="Dettes comptabilisées par nature"><table className="data-table sticky sticky-first crisis-natures" data-testid="crisis-natures-table"><thead><tr><th scope="col">Nature</th><th scope="col">Rang choisi</th><th scope="col" className="num">Dette</th><th scope="col" className="num">Soldes débiteurs non déduits</th></tr></thead><tbody>
      {position.natures.map((nature) => <tr key={nature.id} data-testid={`crisis-nature-${nature.id}`}><th scope="row">{nature.label}<small>{nature.accounts}</small></th><td>{rankLabel(nature.rank) ?? <span className="nd">n.d. — non choisi</span>}</td><td className="num"><Cell amount={nature.debt} /></td><td className="num"><Cell amount={nature.debitBalances} /></td></tr>)}
    </tbody><tfoot><tr><th scope="row">Total des dettes comptabilisées</th><td /><td className="num" data-testid="crisis-total-debt"><Cell amount={position.totalDebt} /></td><td /></tr></tfoot></table></div>
    <div className="crisis-details">{position.natures.filter((nature) => nature.items.length || nature.debitItems.length).map((nature) => <details className="crisis-detail" key={nature.id}><summary>{nature.label} : {nature.items.length} solde{nature.items.length === 1 ? "" : "s"} créditeur{nature.items.length === 1 ? "" : "s"}{nature.debitItems.length ? `, ${nature.debitItems.length} débiteur${nature.debitItems.length === 1 ? "" : "s"}` : ""}</summary>
      {nature.items.length ? <Items items={nature.items} label={`Soldes créditeurs — ${nature.label}`} /> : null}
      {nature.debitItems.length ? <><p className="desc" style={{ margin: "0 16px 8px" }}>Soldes débiteurs, non déduits de la dette :</p><Items items={nature.debitItems} label={`Soldes débiteurs — ${nature.label}`} /></> : null}
    </details>)}</div>
  </section>;
}

function Ranks({ p, position }: { p: Props; position: Value }) {
  return <section className="panel restructuring-section" data-testid="crisis-ranks"><PanelHead title="Dettes par rang" desc="Selon les rangs choisis pour cet espace ; aucun rang n’est supposé" />
    {position.ranks.kind === "nd" ? <p className="nd" data-testid="crisis-ranks-nd">n.d. — {position.ranks.reason}</p>
      : <div className="table-wrap"><table className="data-table crisis-ranks" data-testid="crisis-ranks-table"><thead><tr><th scope="col">Rang</th><th scope="col">Natures classées</th><th scope="col" className="num">Dette</th></tr></thead><tbody>{position.ranks.totals.map((rank) => <tr key={rank.id}><th scope="row">{rank.label}</th><td>{rank.natures.length ? rank.natures.join(", ") : "—"}</td><td className="num"><Cell amount={rank.total} /></td></tr>)}</tbody></table></div>}
    {p.saveRanks ? <ActionForm action={p.saveRanks} submit="Enregistrer les rangs" testid="crisis-ranks-form" className="form">
      <div className="filters crisis-rank-fields">{DEBT_NATURES.map((nature) => <Field key={nature.id} id={`rank-${nature.id}`} label={nature.label}><select key={p.ranks?.[nature.id] ?? "none"} id={`rank-${nature.id}`} name={`rank-${nature.id}`} className="select" defaultValue={p.ranks?.[nature.id] ?? ""}><option value="">Non choisi</option>{RANKS.map((rank) => <option key={rank.id} value={rank.id}>{rank.label}</option>)}</select></Field>)}</div>
      <p className="desc">Le rang s’applique à toute la nature. Une nature laissée « Non choisi » rend la répartition par rang n.d. dès qu’elle porte une dette.</p>
    </ActionForm> : <p className="desc">Les rangs sont choisis par un éditeur ou un administrateur de l’espace.</p>}
  </section>;
}

export function CrisisView(p: Props) {
  const position = p.position;
  return <div className="restructuring-view" data-testid="studio-restructuring-crisis">
    <header className="restructuring-header"><div className="ms-head"><span className="label">Studio Restructuring</span><h1>{VIEWS.find((view) => view.id === "crisis")?.label}</h1><p className="desc">De quelle trésorerie l’entreprise dispose-t-elle, et que doit-elle, à une date donnée ?</p></div></header>
    <FamilyTabs current="crisis" label="Vues du Studio Restructuring" testid="restructuring-tabs" tabs={VIEWS.map((view) => ({ key: view.id, label: view.label, href: tabHref(p, view.id) }))} />
    <Reading p={p} />
    <Filters p={p} />
    {p.notices.length ? <ul className="restructuring-notices" data-testid="crisis-notices">{p.notices.map((notice) => <li className="notice" key={notice}>{notice}</li>)}</ul> : null}
    {position.kind === "nd" ? <section className="panel restructuring-section" data-testid="crisis-unavailable"><h2>Position non disponible</h2><p className="nd">n.d. — {position.reason}</p><a className="btn" href={`/e/${p.slug}/donnees`}>Ouvrir Données</a></section> : <>
      <dl className="facts ms-tiles four restructuring-tiles" data-testid="crisis-tiles">
        <Tile testid="crisis-tile-cash" main label="Disponibilités" value={tile(position.cash.available)} nd={position.cash.available.cents === null} lead={position.cash.available.reason ?? `${position.cash.items.length} compte${position.cash.items.length === 1 ? "" : "s"} débiteur${position.cash.items.length === 1 ? "" : "s"}`} />
        <Tile testid="crisis-tile-debt" label="Dettes comptabilisées" value={tile(position.totalDebt)} nd={position.totalDebt.cents === null} lead={position.totalDebt.reason ?? "Échues et non échues confondues"} />
        <Tile testid="crisis-tile-coverage" label="Disponibilités − dettes" value={position.coverage.cents === null ? "n.d." : <Money cents={position.coverage.cents} signed />} nd={position.coverage.cents === null} lead={position.coverage.reason ?? "Indicateur de couverture, pas une prévision"} />
        {position.securities.cents !== 0 ? <Tile testid="crisis-tile-securities" label="Valeurs mobilières de placement" value={tile(position.securities)} nd={position.securities.cents === null} lead={position.securities.reason ?? "Comptes 50, hors disponibilités"} /> : null}
      </dl>
      {position.warnings.length ? <ul className="restructuring-notices" data-testid="crisis-warnings">{position.warnings.map((warning) => <li className="notice" key={warning}>{warning}</li>)}</ul> : null}
      {position.cash.items.length ? <section className="panel restructuring-section" data-testid="crisis-cash"><PanelHead title="Disponibilités par compte" desc={`${position.lineCount} écriture${position.lineCount === 1 ? "" : "s"} de trésorerie et de dette lue${position.lineCount === 1 ? "" : "s"} jusqu’à la date d’arrêté`} /><Items items={position.cash.items} label="Disponibilités par compte" /></section> : null}
      <Natures position={position} />
      <Ranks p={p} position={position} />
    </>}
  </div>;
}

export default CrisisView;
