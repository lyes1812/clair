import { SearchableSelect } from "@/components/SearchableSelect";
import { MoneyText } from "@/components/Money";
import { Fragment } from "react";
import { GlossaryLink } from "@/components/GlossaryLink";
import { Pager } from "@/components/Pager";
import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { hireKey, roundDiv } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import { CATEGORY_IDS, CATEGORY_LABELS, type BaseContract, type BaseSnapshot, type CategoryId, type Hypothesis, type Projection } from "@/lib/budget/types";
import { BUDGET_TERMS } from "@/lib/glossary/budget";
import { fmtEtp4 } from "@/lib/rh/kpi/format";
import { dateFr, matchesQuery, pageNumber, paginate } from "@/lib/viz/hyp-saisie";
import { frDates } from "@/lib/viz/hyp-saisie-fmt";
import { ActionForm } from "./ActionForm";
import { addHypothesisAction, bulkDeparturesAction, bulkRaisesAction, deleteHypothesisAction } from "./actions";
import { AmountFields, CardTitle, Field, FieldGroup, pct, trendOf } from "./shared";

type Row = { key: string; label: string; kind: "base" | "embauche"; service: string | null; category: CategoryId | null; etp4: number | null; monthly: number | null; entry: string | null; contract: BaseContract | null };
type Depart = Extract<Hypothesis, { kind: "depart" }>;

const PAGE_SIZE = 20;
const NO_SERVICE = "__nd"; // valeur du filtre « Non ventilé »
const catText = (c: CategoryId | null) => (c ? CATEGORY_LABELS[c] : "Non classé");
const lower = (m: string) => formatMonth(m).toLowerCase();
const fr = (t: string | null | undefined) => (t ? frDates(t) : undefined);

// Hypothèses qui concernent un salarié (contrat de la base ou embauche).
export function eventsOf(key: string, hyps: Hypothesis[]): Hypothesis[] {
  return hyps.filter((h) => {
    if (h.kind === "depart" || h.kind === "absence" || h.kind === "categorie" || h.kind === "base" || h.kind === "changement") return h.contractKey === key;
    if (h.kind === "augmentation") return h.scope.kind === "contrat" && h.scope.key === key;
    if (h.kind === "ponctuel") return h.contractKey === key;
    if (h.kind === "embauche") return hireKey(h.id) === key;
    return false;
  });
}

const KIND_TEXT: Record<string, string> = { augmentation: "Augmentation", depart: "Départ", absence: "Congé non payé", categorie: "Catégorie", base: "Correction de base", ponctuel: "Prime / élément ponctuel", embauche: "Embauche", changement: "Changement de service / quotité" };
// Détail d'un événement : taux en français (virgule), dates en JJ/MM/AAAA comme dans le tableau.
const dmy = (iso: string) => dateFr(iso) ?? iso;
const detail = (h: Hypothesis): string => {
  switch (h.kind) {
    case "augmentation": return `${h.rateBps > 0 ? "+" : ""}${pct(h.rateBps)} à compter de ${lower(h.from)}`;
    case "depart": return `${h.motif ? `${h.motif} · ` : ""}dernier jour payé ${dmy(h.lastPaidDate)}${h.exitCost ? ` · sortie ${h.exitCost.mode === "brut" ? `${formatEuros(h.exitCost.brutCents)} brut + ${pct(h.exitCost.chargesBps)}` : `${formatEuros(h.exitCost.costCents)} chargés`}` : ""}`;
    case "absence": return `du ${dmy(h.from)} au ${dmy(h.to)} · payé à ${pct(h.paidBps)}`;
    case "categorie": return CATEGORY_LABELS[h.category];
    case "base": return `salaire ${formatEuros(h.salaryCents)} · charges ${pct(h.chargesBps)}`;
    case "ponctuel": return `${formatMonth(h.month)} · ${h.amount.mode === "brut" ? `${formatEuros(h.amount.brutCents)} brut + ${pct(h.amount.chargesBps)}` : `${formatEuros(h.amount.costCents)} chargés`}${h.nonRecurring ? " · non récurrent" : ""}`;
    case "embauche": return `${dmy(h.start)}${h.end ? ` → ${dmy(h.end)}` : ""} · ${formatEuros(h.grossFullTimeCents)} × ${pct(h.quotaBps)}`;
    case "changement": return `à compter de ${lower(h.from)}${h.service ? ` · service ${h.service}` : ""}${h.quotaBps !== undefined ? ` · quotité ${pct(h.quotaBps)}` : ""}${h.poste ? ` · poste ${h.poste}` : ""}`;
    default: return "";
  }
};

// Ce que les hypothèses du scénario changent pour un salarié (colonnes colorées du tableau) : rien n'est écrit tant qu'aucune
// hypothèse n'existe (« — »), jamais une valeur par défaut.
type Raise = { text: string; rateBps: number };
type Effect = { exitDate: string | null; exitMotif: string | null; raises: Raise[]; changes: string[]; recategorised: boolean; events: Hypothesis[] };
function effectOf(key: string, hyps: Hypothesis[]): Effect {
  const events = eventsOf(key, hyps);
  const dep = events.find((h): h is Depart => h.kind === "depart");
  return {
    exitDate: dep?.lastPaidDate ?? null,
    exitMotif: dep?.motif ?? null,
    raises: events.flatMap((h) => (h.kind === "augmentation" ? [{ text: `${h.rateBps > 0 ? "+" : ""}${pct(h.rateBps)} dès ${lower(h.from)}`, rateBps: h.rateBps }] : [])),
    changes: events.flatMap((h) => (h.kind === "changement" ? [`${[h.service ? `service ${h.service}` : null, h.quotaBps !== undefined ? `quotité ${pct(h.quotaBps)}` : null, h.poste ? `poste ${h.poste}` : null].filter(Boolean).join(" · ") || "sans effet saisi"} dès ${lower(h.from)}`] : [])),
    recategorised: events.some((h) => h.kind === "categorie"),
    events,
  };
}

// Fin connue : fin de contrat lue dans PayFit, ou dernier jour payé d'une embauche à durée déterminée.
function knownEnd(r: Row, hyps: Hypothesis[]): string | null {
  if (r.kind === "embauche") return hyps.find((x): x is Extract<Hypothesis, { kind: "embauche" }> => x.kind === "embauche" && hireKey(x.id) === r.key)?.end ?? null;
  return r.contract?.endDate ?? null;
}

const MOTIFS = ["Licenciement", "Licenciement pour faute grave", "Rupture conventionnelle", "Démission", "Fin de CDD", "Fin de stage"];

// Saisie en masse : une ligne par salarié de la base, lignes vides ignorées, lot enregistré en entier ou pas du tout.
function BulkSection({ slug, scenario, base, hyps }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hyps: Hypothesis[] }) {
  const departing = new Set(hyps.flatMap((h) => (h.kind === "depart" ? [h.contractKey] : [])));
  const leavers = base.contracts.filter((c) => !departing.has(c.contractKey));
  return (
    <section className="panel hs-events" id="sal-bulk" data-testid="sal-bulk">
      <CardTitle title="Saisie en masse" help={<GlossaryLink slug={slug} term={BUDGET_TERMS.saisieMasse} />} />
      <details>
        <summary>Départs ({leavers.length} salarié{leavers.length > 1 ? "s" : ""} sans départ saisi)</summary>
        <ActionForm action={bulkDeparturesAction.bind(null, slug, scenario.id)} submit="Enregistrer les départs renseignés" testid="sal-bulk-departs">
          <input type="hidden" name="n" value={leavers.length} />
          <div className="table-wrap scroll">
            <table className="data-table sticky sticky-first hs-table">
              <thead><tr><th>Salarié</th><th>Service</th><th>Dernier jour payé</th><th>Motif</th><th>Coûts de sortie chargés (€)</th></tr></thead>
              <tbody>
                {leavers.map((c, i) => (
                  <tr key={c.contractKey} data-salarie={c.label}>
                    <td>{c.label}<input type="hidden" name={`key_${i}`} value={c.contractKey} /></td>
                    <td>{c.service ?? "Non ventilé"}</td>
                    <td><input className="input" type="date" name={`date_${i}`} aria-label={`Dernier jour payé de ${c.label}`} /></td>
                    <td><input className="input" name={`motif_${i}`} list="bulk-motifs" maxLength={100} aria-label={`Motif de départ de ${c.label}`} /></td>
                    <td><input className="input" name={`cost_${i}`} inputMode="decimal" aria-label={`Coûts de sortie chargés de ${c.label}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="bulk-motifs">{MOTIFS.map((m) => <option key={m} value={m} />)}</datalist>
        </ActionForm>
      </details>
      <details>
        <summary>Augmentations ({base.contracts.length} salarié{base.contracts.length > 1 ? "s" : ""})</summary>
        <ActionForm action={bulkRaisesAction.bind(null, slug, scenario.id)} submit="Enregistrer les augmentations renseignées" testid="sal-bulk-raises">
          <input type="hidden" name="n" value={base.contracts.length} />
          <div className="filters">
            <Field id="bulk-from" label="À compter de (mois), commun à toutes les lignes" hint={`Entre ${lower(scenario.firstMonth)} et ${lower(scenario.lastMonth)}.`}><input className="input" id="bulk-from" name="from" type="month" min={scenario.firstMonth} max={scenario.lastMonth} /></Field>
          </div>
          <div className="table-wrap scroll">
            <table className="data-table sticky sticky-first hs-table">
              <thead><tr><th>Salarié</th><th>Service</th><th>Catégorie</th><th>Taux d'augmentation (%)</th></tr></thead>
              <tbody>
                {base.contracts.map((c, i) => (
                  <tr key={c.contractKey} data-salarie={c.label}>
                    <td>{c.label}<input type="hidden" name={`key_${i}`} value={c.contractKey} /></td>
                    <td>{c.service ?? "Non ventilé"}</td>
                    <td>{catText(c.category ?? null)}</td>
                    <td><input className="input" name={`rate_${i}`} inputMode="decimal" aria-label={`Taux d'augmentation de ${c.label}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </details>
    </section>
  );
}

export function PostesView({ slug, scenario, base, hyps, proj, q, selected, canEdit, page, forme, service }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hyps: Hypothesis[]; proj: Projection; q: string; selected: string; canEdit: boolean; page?: string; forme?: string; service?: string }) {
  const catOver = new Map(hyps.flatMap((h) => (h.kind === "categorie" ? [[h.contractKey, h.category] as const] : [])));
  const rows: Row[] = [
    ...base.contracts.map((c): Row => ({
      key: c.contractKey, label: c.label, kind: "base", service: c.service, category: catOver.get(c.contractKey) ?? c.category ?? null, etp4: c.etp4, entry: c.startDate, contract: c,
      monthly: c.base ? c.base.salaryCents + roundDiv(BigInt(c.base.salaryCents) * BigInt(c.base.refCotisationsCents), BigInt(c.base.refBrutCents)) : null,
    })),
    ...hyps.flatMap((h): Row[] => (h.kind === "embauche" ? [{ key: hireKey(h.id), label: `${h.label} (embauche)`, kind: "embauche", service: h.service, category: catOver.get(hireKey(h.id)) ?? h.category ?? null, etp4: h.counted ? h.quotaBps : null, entry: h.start, contract: null, monthly: null }] : [])),
  ];
  const line = rows.map((r) => {
    const fx = effectOf(r.key, hyps);
    const end = knownEnd(r, hyps);
    const etp = r.etp4 === null ? "n.d." : fmtEtp4(r.etp4);
    const cost = r.monthly === null ? (r.kind === "embauche" ? "—" : "n.d.") : formatEuros(r.monthly);
    return { r, fx, end, etp, cost };
  });
  const services = [...new Set([...base.contracts.map((c) => c.service), ...hyps.map((h) => (h.kind === "embauche" ? h.service : null))].filter((x): x is string => x !== null))].sort();
  const hasNoService = rows.some((r) => r.service === null);
  // Filtre par service : une valeur inconnue (lien ancien) est ignorée plutôt que de vider la liste.
  const svc = service === NO_SERVICE && hasNoService ? NO_SERVICE : service && services.includes(service) ? service : "";
  // Recherche « toutes les colonnes » : chaque mot saisi doit se retrouver dans au moins une colonne du tableau.
  const shown = line.filter(({ r }) => svc === "" || (svc === NO_SERVICE ? r.service === null : r.service === svc)).filter(({ r, fx, end, etp, cost }) => matchesQuery([
    r.label, catText(r.category), r.contract?.nature, r.service ?? "Non ventilé", r.entry, dateFr(r.entry), end, dateFr(end), etp, cost,
    fx.exitDate, dateFr(fx.exitDate), fx.exitMotif, ...fx.raises.map((r) => r.text), ...fx.changes, String(fx.events.length),
  ], q));
  const paged = paginate(shown, pageNumber(page), PAGE_SIZE);
  const sel = rows.find((r) => r.key === selected) ?? null;
  const base_ = `/e/${slug}/studio-rh/hypotheses?scenario=${scenario.id}&vue=postes`;
  const qPart = `${q ? `&q=${encodeURIComponent(q)}` : ""}${svc ? `&service=${encodeURIComponent(svc)}` : ""}`;
  const pagePart = (p: number) => (p > 1 ? `&page=${p}` : "");
  const ficheHref = (key: string, anchor: string) => `${base_}&salarie=${encodeURIComponent(key)}${qPart}${pagePart(paged.page)}#${anchor}`;
  const pageHref = (p: number) => `${base_}${selected ? `&salarie=${encodeURIComponent(selected)}` : ""}${qPart}${pagePart(p)}`;
  const add = (kind: Hypothesis["kind"]) => addHypothesisAction.bind(null, slug, scenario.id, kind);
  const horizon = `Entre ${lower(scenario.firstMonth)} et ${lower(scenario.lastMonth)}.`;
  const open = (k: string) => forme === k;
  const COLS = 13;
  return (
    <MoneyText><>
      <section className="panel" data-testid="sal-list">
        <div className="panel-head">
          <CardTitle title="Modifications de postes" help={<GlossaryLink slug={slug} term={BUDGET_TERMS.postes} />} />
          {canEdit && <div className="panel-tools"><a className="btn" href="#sal-bulk" data-testid="sal-bulk-link">Aller à la saisie en masse</a></div>}
        </div>
        <form method="get" action={`/e/${slug}/studio-rh/hypotheses`} className="hs-search" data-testid="sal-search" role="search" aria-label="Recherche des salariés">
          <input type="hidden" name="scenario" value={scenario.id} />
          <input type="hidden" name="vue" value="postes" />
          <div className="field-row">
            <label htmlFor="sal-q">Recherche</label>
            <input className="input" id="sal-q" name="q" type="search" defaultValue={q} placeholder="Toutes les colonnes : nom, service, motif, date…" aria-label="Rechercher (nom, service) dans toutes les colonnes" autoComplete="off" />
          </div>
          <div className="field-row hs-narrow">
            <label htmlFor="sal-service">Service</label>
            <SearchableSelect className="select" id="sal-service" name="service" defaultValue={svc} searchLabel="Service" options={[
              { value: "", label: "Tous les services" },
              ...services.map((service) => ({ value: service, label: service })),
              ...(hasNoService ? [{ value: NO_SERVICE, label: "Non ventilé" }] : []),
            ]} />
          </div>
          <button className="btn" type="submit">Rechercher</button>
          {(q || svc) && <a className="btn" href={base_} data-testid="sal-search-clear">Effacer la recherche</a>}
        </form>
        {paged.pages > 1 && <Pager page={paged.page} pageSize={PAGE_SIZE} total={shown.length} href={pageHref} testid="sal-pager-top" />}
        <div className="table-wrap scroll">
          <table className="data-table sticky sticky-first hs-table" data-testid="sal-table">
            <thead>
              <tr>
                <th>Salarié</th><th>Catégorie</th><th>Service</th><th>Entrée</th>
                <th title="Fin de contrat lue dans PayFit, ou dernier jour payé d'une embauche à durée déterminée">Fin connue</th>
                <th className="num">ETP</th><th className="num">Coût mensuel de base</th>
                <th className="changed" title="Départ saisi dans ce scénario : dernier jour payé">Sortie (hypothèse)</th>
                <th className="changed">Motif de sortie (hypothèse)</th>
                <th className="changed" title="Augmentations saisies sur ce contrat seul (celles d'un service ou de toute l'entreprise sont dans Hypothèses globales)">Augmentation (hypothèse)</th>
                <th className="changed">Changement (hypothèse)</th>
                <th className="num">Événements</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map(({ r, fx, end, etp, cost }) => (
                <tr key={r.key} data-salarie={r.label} aria-current={r.key === selected ? "true" : undefined}>
                  <td><a href={ficheHref(r.key, "sal-fiche")}>{r.label}</a></td>
                  <td className={fx.recategorised ? "changed" : undefined}>
                    {catText(r.category)}
                    {fx.recategorised ? <span className="tile-foot"> (hypothèse)</span> : null}
                    {r.category === null && r.contract?.nature ? <span className="tile-foot"> nature {r.contract.nature}</span> : null}
                  </td>
                  <td>{r.service ?? "Non ventilé"}</td>
                  <td>{dateFr(r.entry) ?? "n.d."}</td>
                  <td>{dateFr(end) ?? "—"}</td>
                  <td className="num" title={etp === "n.d." ? (fr(r.contract?.etpNd) ?? (r.kind === "embauche" ? "Poste non compté dans l'effectif : pas d'ETP" : undefined)) : undefined}>{etp}</td>
                  <td className="num" title={cost === "n.d." ? fr(r.contract?.baseNd) : undefined}>{cost}</td>
                  <td className={fx.exitDate ? "changed" : undefined} data-col="sortie">{dateFr(fx.exitDate) ?? "—"}</td>
                  <td className={fx.exitDate ? "changed wrap" : "wrap"}>{fx.exitDate ? fx.exitMotif ?? "non précisé" : "—"}</td>
                  <td className={fx.raises.length ? "changed wrap" : "wrap"} data-col="augmentation">{fx.raises.length ? fx.raises.map((x, i) => <Fragment key={i}>{i > 0 ? " ; " : ""}<span className={trendOf(x.rateBps).cls} data-sign={trendOf(x.rateBps).sign}>{x.text}</span></Fragment>) : "—"}</td>
                  <td className={fx.changes.length ? "changed wrap" : "wrap"}>{fx.changes.length ? fx.changes.join(" ; ") : "—"}</td>
                  <td className="num" title={fx.events.map((h) => KIND_TEXT[h.kind]).join(" ; ") || undefined}>{fx.events.length}</td>
                  <td className="hs-row-actions">
                    <a href={ficheHref(r.key, "sal-fiche")} aria-label={`Ouvrir la fiche de ${r.label}`}>Fiche</a>
                    {canEdit && <a href={ficheHref(r.key, "sal-add")} aria-label={`Créer un événement pour ${r.label}`}>Événement</a>}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={COLS} className="desc">{q || svc ? `Aucun salarié ne correspond à ${q ? `« ${q} »` : "ce service"}${q && svc ? " dans ce service" : ""}.` : "Aucun salarié dans la base figée de ce scénario."}</td></tr>}
            </tbody>
          </table>
        </div>
        {paged.pages > 1 ? <Pager page={paged.page} pageSize={PAGE_SIZE} total={shown.length} href={pageHref} testid="sal-pager" /> : shown.length > 0 ? <p className="tile-foot" data-testid="sal-pager">{paged.from}–{paged.to} sur {shown.length}</p> : null}
      </section>

      {sel && (
        <section className="panel" id="sal-fiche" data-testid="sal-fiche">
          <div className="panel-head">
            <div className="hs-title">
              <h2>{sel.label} <span className="tag">{catText(sel.category)}</span></h2>
              <p className="desc">
                {sel.service ?? "Non ventilé"} · entrée {dateFr(sel.entry) ?? "n.d."} · ETP {sel.etp4 === null ? "n.d." : fmtEtp4(sel.etp4)}
                {sel.contract?.baseNote ? ` · base : ${frDates(sel.contract.baseNote)}` : ""}
                {sel.contract?.baseNd ? ` · base n.d. : ${frDates(sel.contract.baseNd)}` : ""}
              </p>
            </div>
            <div className="panel-tools"><a className="btn" href={`${base_}${qPart}${pagePart(paged.page)}`} data-testid="sal-fiche-close">Fermer la fiche</a></div>
          </div>
          <h3>Événements<GlossaryLink slug={slug} term={BUDGET_TERMS.evenement} /></h3>
          {eventsOf(sel.key, hyps).filter((h) => h.kind !== "embauche").length === 0 ? (
            <p className="desc">Aucun événement pour ce salarié.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table" data-testid="sal-events">
                <thead><tr><th>Type</th><th>Libellé</th><th>Détail</th>{canEdit && <th><span className="sr-only">Supprimer</span></th>}</tr></thead>
                <tbody>
                  {eventsOf(sel.key, hyps).filter((h) => h.kind !== "embauche").map((h) => (
                    <tr key={h.id} data-hyp={h.label}>
                      <td>{KIND_TEXT[h.kind]}</td><td>{frDates(h.label)}</td><td className="wrap">{detail(h)}</td>
                      {canEdit && <td><ActionForm action={deleteHypothesisAction.bind(null, slug, scenario.id, h.id)} submit="Supprimer" testid={`sal-del-${h.id}`} className="inline-form" danger compact confirm={`Supprimer l'événement « ${frDates(h.label)} » ?`} hint={`Supprimer l'événement « ${frDates(h.label)} »`} srLabel={`l'événement « ${frDates(h.label)} »`} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>Coût mensuel projeté<GlossaryLink slug={slug} term={BUDGET_TERMS.contribution} /></h3>
          {proj.kind === "error" ? (
            <p className="nd">n.d. — projection refusée : {frDates(proj.errors.join(" ; "))}</p>
          ) : (
            <div className="table-wrap scroll" role="region" aria-label="Coût mensuel projeté du salarié" tabIndex={0}>
              <table className="data-table sticky" data-testid="sal-months">
                <thead><tr><th>Mois</th><th>Détail</th><th className="num">Coût chargé</th></tr></thead>
                <tbody>
                  {proj.months.map((m) => {
                    const lines = m.kind === "value" ? m.contributions.filter((c) => c.contractKey === sel.key) : [];
                    return (
                      <tr key={m.month} data-month={m.month}>
                        <td>{formatMonth(m.month)}</td>
                        <td className="wrap">{m.kind === "nd" ? <span className="nd">n.d. — {frDates(m.reasons.join(" ; "))}</span> : lines.length ? lines.map((c) => `${c.label} ${formatEuros(c.cost)}`).join(" · ") : "—"}</td>
                        <td className="num" data-col="cost">{m.kind === "nd" ? "n.d." : formatEuros(lines.reduce((s, c) => s + c.cost, 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {canEdit && (
            <div id="sal-add" className="hs-events" data-testid="sal-add">
              <h3>Créer un événement pour {sel.label}<GlossaryLink slug={slug} term={BUDGET_TERMS.evenement} /></h3>
              <details open={open("augmentation")}>
                <summary>Augmentation de salaire</summary>
                <ActionForm action={add("augmentation")} submit="Ajouter l'augmentation" testid="sal-form-augmentation">
                  <input type="hidden" name="scope" value={`contrat:${sel.key}`} />
                  <FieldGroup title="Augmentation">
                    <Field id="s-aug-l" label="Libellé"><input className="input" id="s-aug-l" name="label" defaultValue={`Augmentation ${sel.label}`} maxLength={200} required /></Field>
                    <Field id="s-aug-r" label="Taux (%)" hint="Ex. 2,5 pour +2,5 %."><input className="input" id="s-aug-r" name="rate" inputMode="decimal" required /></Field>
                    <Field id="s-aug-f" label="À compter de (mois)" hint={horizon}><input className="input" id="s-aug-f" name="from" type="month" min={scenario.firstMonth} max={scenario.lastMonth} required /></Field>
                  </FieldGroup>
                </ActionForm>
              </details>
              {sel.kind === "base" && (
                <>
                  <details open={open("depart")}>
                    <summary>Départ (licenciement, rupture conventionnelle, démission, fin de CDD…)</summary>
                    <ActionForm action={add("depart")} submit="Ajouter le départ" testid="sal-form-depart">
                      <input type="hidden" name="contractKey" value={sel.key} />
                      <FieldGroup title="Départ">
                        <Field id="s-dep-l" label="Libellé"><input className="input" id="s-dep-l" name="label" defaultValue={`Départ ${sel.label}`} maxLength={200} required /></Field>
                        <Field id="s-dep-m" label="Motif"><input className="input" id="s-dep-m" name="motif" list="sal-motifs" maxLength={100} /></Field>
                        <Field id="s-dep-d" label="Dernier jour payé"><input className="input" id="s-dep-d" name="lastPaidDate" type="date" required /></Field>
                      </FieldGroup>
                      <FieldGroup title="Coûts de sortie (mois du départ, facultatif)">
                        <AmountFields prefix="exit" idp="s-dep-e" optional />
                      </FieldGroup>
                      <datalist id="sal-motifs">{MOTIFS.map((m) => <option key={m} value={m} />)}</datalist>
                    </ActionForm>
                  </details>
                  <details open={open("absence")}>
                    <summary>Congé non payé ou partiellement payé (congé sans solde, congé supplémentaire de naissance…)</summary>
                    <ActionForm action={add("absence")} submit="Ajouter le congé" testid="sal-form-absence">
                      <input type="hidden" name="contractKey" value={sel.key} />
                      <FieldGroup title="Congé">
                        <Field id="s-abs-l" label="Libellé"><input className="input" id="s-abs-l" name="label" defaultValue={`Congé ${sel.label}`} maxLength={200} required /></Field>
                        <Field id="s-abs-f" label="Du"><input className="input" id="s-abs-f" name="from" type="date" required /></Field>
                        <Field id="s-abs-t" label="Au (inclus)"><input className="input" id="s-abs-t" name="to" type="date" required /></Field>
                        <Field id="s-abs-p" label="Part du salaire payée (%) — 0 : aucun salaire"><input className="input" id="s-abs-p" name="paid" inputMode="decimal" required /></Field>
                      </FieldGroup>
                    </ActionForm>
                  </details>
                  {sel.contract && !sel.contract.base && (
                    <details open>
                      <summary>Base du salarié (n.d. : à saisir)</summary>
                      <ActionForm action={add("base")} submit="Enregistrer la base" testid="sal-form-base">
                        <input type="hidden" name="contractKey" value={sel.key} />
                        <FieldGroup title="Base du contrat" hint="La projection est n.d. pour ce contrat tant que sa base n'est pas saisie.">
                          <Field id="s-b-l" label="Libellé"><input className="input" id="s-b-l" name="label" defaultValue="Base saisie" maxLength={200} required /></Field>
                          <Field id="s-b-s" label="Salaire mensuel de base (€, 0 si non payé)"><input className="input" id="s-b-s" name="salary" inputMode="decimal" required /></Field>
                          <Field id="s-b-c" label="Taux de charges (%)" hint="Ex. 42,5."><input className="input" id="s-b-c" name="charges" inputMode="decimal" required /></Field>
                        </FieldGroup>
                      </ActionForm>
                    </details>
                  )}
                </>
              )}
              <details open={open("ponctuel")}>
                <summary>Prime ou élément ponctuel</summary>
                <ActionForm action={add("ponctuel")} submit="Ajouter l'élément" testid="sal-form-ponctuel">
                  <input type="hidden" name="contractKey" value={sel.key} />
                  <input type="hidden" name="service" value={sel.service ?? ""} />
                  <FieldGroup title="Élément ponctuel">
                    <Field id="s-p-l" label="Libellé"><input className="input" id="s-p-l" name="label" defaultValue={`Prime ${sel.label}`} maxLength={200} required /></Field>
                    <Field id="s-p-m" label="Mois" hint={horizon}><input className="input" id="s-p-m" name="month" type="month" min={scenario.firstMonth} max={scenario.lastMonth} required /></Field>
                  </FieldGroup>
                  <FieldGroup title="Montant">
                    <AmountFields prefix="amount" idp="s-p-amount" />
                  </FieldGroup>
                  <label className="check"><input type="checkbox" name="nonRecurring" value="oui" /><span>Non récurrent</span></label>
                </ActionForm>
              </details>
              <details open={open("changement")}>
                <summary>Changement de service ou de quotité (à compter d'un mois)</summary>
                <ActionForm action={add("changement")} submit="Ajouter le changement" testid="sal-form-changement">
                  <input type="hidden" name="contractKey" value={sel.key} />
                  <FieldGroup title="Changement" hint="Service, quotité, ou les deux.">
                    <Field id="s-ch-l" label="Libellé"><input className="input" id="s-ch-l" name="label" defaultValue={`Changement ${sel.label}`} maxLength={200} required /></Field>
                    <Field id="s-ch-f" label="À compter de (mois)" hint={horizon}><input className="input" id="s-ch-f" name="from" type="month" min={scenario.firstMonth} max={scenario.lastMonth} required /></Field>
                    <Field id="s-ch-s" label="Nouveau service (facultatif)"><input className="input" id="s-ch-s" name="service" list="sal-services" maxLength={200} /></Field>
                    <Field id="s-ch-q" label="Nouvelle quotité (%, facultatif)" hint="Entre 0 et 100 %."><input className="input" id="s-ch-q" name="quota" inputMode="decimal" /></Field>
                    <Field id="s-ch-p" label="Poste (facultatif, descriptif)"><input className="input" id="s-ch-p" name="poste" maxLength={200} /></Field>
                  </FieldGroup>
                  <datalist id="sal-services">{services.map((x) => <option key={x} value={x} />)}</datalist>
                </ActionForm>
              </details>
              <details open={open("categorie")}>
                <summary>Catégorie (CDI, CDD, apprenti, stagiaire)</summary>
                <ActionForm action={add("categorie")} submit="Enregistrer la catégorie" testid="sal-form-categorie">
                  <input type="hidden" name="contractKey" value={sel.key} />
                  <FieldGroup title="Catégorie">
                    <Field id="s-c-l" label="Libellé"><input className="input" id="s-c-l" name="label" defaultValue={`Catégorie ${sel.label}`} maxLength={200} required /></Field>
                    <Field id="s-c-c" label="Catégorie">
                      <select className="select" id="s-c-c" name="category" defaultValue={sel.category ?? ""}><option value="" disabled>Choisir…</option>{CATEGORY_IDS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select>
                    </Field>
                  </FieldGroup>
                </ActionForm>
              </details>
            </div>
          )}
        </section>
      )}

      {canEdit && <BulkSection slug={slug} scenario={scenario} base={base} hyps={hyps} />}
    </></MoneyText>
  );
}
