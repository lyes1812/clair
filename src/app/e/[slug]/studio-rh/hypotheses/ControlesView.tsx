import { Pager } from "@/components/Pager";
import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { enteredAfter, hireKey } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseSnapshot, Hypothesis, PresentPerson, Projection } from "@/lib/budget/types";
import { fmtEtp4 } from "@/lib/rh/kpi/format";
import { matchesQuery, pageNumber, paginate } from "@/lib/viz/hyp-saisie";
import { ActionForm } from "./ActionForm";
import { deleteHypothesisAction, importHypothesesAction } from "./actions";
import { detailOf, Field, KIND } from "./shared";

export type OtherScenario = { id: string; name: string; label: string };
const IMPORT_KINDS: { kind: Hypothesis["kind"]; label: string }[] = [
  { kind: "depart", label: "Départs" }, { kind: "embauche", label: "Embauches" }, { kind: "augmentation", label: "Augmentations" },
  { kind: "absence", label: "Congés non payés" }, { kind: "categorie", label: "Catégories" }, { kind: "changement", label: "Changements de service ou de quotité" },
  { kind: "base", label: "Corrections de base" }, { kind: "ponctuel", label: "Éléments ponctuels" }, { kind: "enveloppe", label: "Enveloppes" },
  { kind: "constante", label: "Constantes de référence" }, { kind: "realise", label: "Non récurrents réalisés" },
];

const nameOf = (base: BaseSnapshot, hyps: Hypothesis[], key: string) => base.contracts.find((c) => c.contractKey === key)?.label ?? hyps.find((h) => h.kind === "embauche" && hireKey(h.id) === key)?.label ?? key;

// Contrôles effectifs : à chaque mois, effectif de début + entrées − sorties = effectif de fin, les entrées et sorties
// étant les salariés comptés présents en fin de mois et non présents (ou l'inverse) le mois précédent ; contrôle de la
// base contre le réel du mois de référence.
export function ControlesEffectifs({ base, hypotheses, proj }: { base: BaseSnapshot; hypotheses: Hypothesis[]; proj: Projection }) {
  if (proj.kind === "error") return <section className="panel"><h2>Contrôles effectifs</h2><ul className="list">{proj.errors.map((e) => <li key={e} className="nd">{e}</li>)}</ul></section>;
  const start: Record<string, PresentPerson> = Object.fromEntries(base.contracts.filter((c) => c.counted && !enteredAfter(base, c)).map((c) => [c.contractKey, { etp4: c.etp4, category: c.category ?? null, service: c.service }]));
  const refReal = base.actuals.find((a) => a.month === base.refMonth);
  const refHeadcount = refReal?.kind === "value" ? refReal.headcount : null;
  const baseCount = Object.keys(start).length;
  let prev = start;
  const rows = proj.months.map((m) => {
    if (m.kind === "nd") return { month: m.month, nd: m.reasons.join(" ; ") };
    const cur = m.people ?? {};
    const entrees = Object.keys(cur).filter((k) => !(k in prev));
    const sorties = Object.keys(prev).filter((k) => !(k in cur));
    const row = { month: m.month, debut: Object.keys(prev).length, entrees, sorties, fin: Object.keys(cur).length, headcount: m.headcount, etp4: m.etp4, etpNd: m.etpNd };
    prev = cur;
    return row;
  });
  return (
    <>
      <section className="panel" data-testid="ctrl-base">
        <h2>Contrôle de la base <span className="desc">— <a href="#def-controles">règle</a></span></h2>
        <p data-testid="ctrl-base-line">
          Effectif compté fin {formatMonth(base.refMonth).toLowerCase()} : {refHeadcount === null ? <span className="nd">n.d. — réel du mois de référence non disponible</span> : <strong>{refHeadcount} (réel)</strong>} · contrats comptés de la base : <strong>{baseCount}</strong>
          {refHeadcount !== null && <> · {refHeadcount === baseCount ? <span data-testid="ctrl-base-ok">concordant</span> : <span className="nd" data-testid="ctrl-base-gap">écart de {baseCount - refHeadcount}</span>}</>}
        </p>
        {refHeadcount !== null && refHeadcount !== baseCount && <p className="tile-foot">Un écart vient d'un contrat présent à la date de lecture mais pas fin {formatMonth(base.refMonth).toLowerCase()} (ou l'inverse), ou d'une nature non comptée dans l'effectif (Paramètres › KPI).</p>}
      </section>
      <section className="panel" data-testid="ctrl-effectifs">
        <h2>Contrôles effectifs <span className="desc">— effectif de début + entrées − sorties = effectif de fin · <a href="#def-controles">règle</a></span></h2>
        <div className="table-wrap scroll" role="region" aria-label="Contrôle de l'effectif par mois" tabIndex={0}>
          <table className="data-table sticky sticky-first" data-testid="ctrl-eff-table">
            <thead><tr><th>Mois</th><th className="num">Effectif début</th><th className="num">Entrées</th><th className="num">Sorties</th><th className="num">Effectif fin</th><th className="num">ETP fin</th><th>Contrôle</th></tr></thead>
            <tbody>
              {rows.map((r) => ("nd" in r ? (
                <tr key={r.month} data-month={r.month}><td>{formatMonth(r.month)}</td><td colSpan={6} className="nd">n.d. — {r.nd}</td></tr>
              ) : (
                <tr key={r.month} data-month={r.month}>
                  <td>{formatMonth(r.month)}</td>
                  <td className="num">{r.debut}</td>
                  <td className="num" data-col="entrees" title={r.entrees.map((k) => nameOf(base, hypotheses, k)).join(", ")}>{r.entrees.length || "—"}</td>
                  <td className="num" data-col="sorties" title={r.sorties.map((k) => nameOf(base, hypotheses, k)).join(", ")}>{r.sorties.length || "—"}</td>
                  <td className="num" data-col="fin">{r.fin}</td>
                  <td className="num">{r.etp4 === null ? <span title={r.etpNd ?? undefined}>n.d.</span> : fmtEtp4(r.etp4)}</td>
                  <td data-col="controle">{r.debut + r.entrees.length - r.sorties.length === r.fin && r.fin === r.headcount ? "✓ égalité vérifiée" : <span className="nd">écart</span>}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
        <details>
          <summary>Qui entre, qui sort</summary>
          <ul className="list" data-testid="ctrl-eff-movements">
            {rows.flatMap((r) => ("nd" in r ? [] : [
              ...r.entrees.map((k) => <li key={`${r.month}-e-${k}`} className="desc">{formatMonth(r.month)} — entrée : {nameOf(base, hypotheses, k)}</li>),
              ...r.sorties.map((k) => <li key={`${r.month}-s-${k}`} className="desc">{formatMonth(r.month)} — sortie : {nameOf(base, hypotheses, k)}</li>),
            ]))}
          </ul>
        </details>
        <p className="tile-foot">Compté présent en fin de mois : contrat dont la nature est comptée dans l'effectif (ou embauche déclarée « comptée »), commencé et non terminé le dernier jour du mois. Un salarié en congé non payé reste dans l'effectif. Un contrat dont l'ETP est n.d. rend l'ETP du mois n.d.</p>
      </section>
    </>
  );
}

// Contrôles des changements : toutes les hypothèses du scénario avec leur effet sur le coût projeté, suppression, reprise
// d'hypothèses d'un autre scénario. Recherche, filtre par type et pagination : une grille mensuelle peut créer des dizaines
// d'hypothèses (une par cellule renseignée).
const CHANGES_PAGE = 25;
export function ControlesChangements({ slug, scenario, base, hypotheses, proj, canEdit, others, q = "", type = "", page }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hypotheses: Hypothesis[]; proj: Projection; canEdit: boolean; others: OtherScenario[]; q?: string; type?: string; page?: string }) {
  const effect = (id: string): number | null => {
    if (proj.kind === "error") return null;
    return proj.months.reduce((s, m) => s + (m.kind === "value" ? m.contributions.filter((c) => c.hypothesisId === id).reduce((t, c) => t + c.cost, 0) : 0), 0);
  };
  const ndMonths = proj.kind === "value" ? proj.months.filter((m) => m.kind === "nd").length : 0;
  const kinds = (Object.keys(KIND) as Hypothesis["kind"][]).map((k) => ({ kind: k, count: hypotheses.filter((h) => h.kind === k).length })).filter((k) => k.count > 0);
  const kind = kinds.some((k) => k.kind === type) ? (type as Hypothesis["kind"]) : null;
  const rows = hypotheses
    .map((h) => ({ h, detail: detailOf(h, base, hypotheses) }))
    .filter(({ h, detail }) => (kind === null || h.kind === kind) && matchesQuery([KIND[h.kind], h.label, detail], q));
  const paged = paginate(rows, pageNumber(page), CHANGES_PAGE);
  const filtered = kind !== null || q !== "";
  const here = `/e/${slug}/studio-rh/hypotheses?scenario=${scenario.id}&vue=ctrl-changements`;
  const pageHref = (p: number) => `${here}${kind ? `&type=${kind}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${p > 1 ? `&page=${p}` : ""}`;
  return (
    <>
      <section className="panel" data-testid="hyp-list-hyps">
        <div className="hs-title">
          <h2>Contrôles des changements <span className="desc">— {hypotheses.length} hypothèse{hypotheses.length > 1 ? "s" : ""} du scénario</span></h2>
          <p className="desc">Chaque hypothèse avec son effet sur le coût projeté : de quoi vérifier d'un coup d'œil ce que le scénario change. <a href="#def-controles">Règle</a></p>
        </div>
        {proj.kind === "error" && <ul className="list" data-testid="hyp-errors">{proj.errors.map((e) => <li key={e} className="nd">{e}</li>)}</ul>}
        {ndMonths > 0 && <p className="notice">{ndMonths} mois projeté(s) n.d. : leurs contributions ne sont pas comptées dans la colonne « Coût attribué sur l'horizon ».</p>}
        {hypotheses.length > CHANGES_PAGE / 2 && (
          <form method="get" action={`/e/${slug}/studio-rh/hypotheses`} className="hs-search" data-testid="hyp-filter" role="search" aria-label="Filtre des hypothèses">
            <input type="hidden" name="scenario" value={scenario.id} />
            <input type="hidden" name="vue" value="ctrl-changements" />
            <div className="field-row">
              <label htmlFor="hyp-q">Rechercher</label>
              <input className="input" id="hyp-q" name="q" type="search" defaultValue={q} placeholder="Libellé, détail, type…" autoComplete="off" />
            </div>
            <div className="field-row">
              <label htmlFor="hyp-type">Type</label>
              <select className="select" id="hyp-type" name="type" defaultValue={kind ?? ""}>
                <option value="">Tous les types</option>
                {kinds.map((k) => <option key={k.kind} value={k.kind}>{KIND[k.kind]} ({k.count})</option>)}
              </select>
            </div>
            <button className="btn" type="submit">Filtrer</button>
            {filtered && <a className="btn" href={here}>Effacer le filtre</a>}
          </form>
        )}
        {hypotheses.length === 0 ? (
          <p className="desc">Aucune hypothèse : la projection reconduit la base figée (avec les fins de contrat connues).</p>
        ) : rows.length === 0 ? (
          <p className="desc">Aucune hypothèse ne correspond à ce filtre.</p>
        ) : (
          <>
            {paged.pages > 1 && <Pager page={paged.page} pageSize={CHANGES_PAGE} total={rows.length} href={pageHref} testid="hyp-pager-top" />}
            <div className="table-wrap scroll" role="region" aria-label="Hypothèses du scénario" tabIndex={0}>
              <table className="data-table sticky" data-testid="hyp-hypotheses">
                <thead><tr><th>Type</th><th>Libellé</th><th>Détail</th><th className="num">Coût attribué sur l'horizon</th>{canEdit && <th><span className="sr-only">Supprimer</span></th>}</tr></thead>
                <tbody>
                  {paged.items.map(({ h, detail }) => {
                    const e = effect(h.id);
                    return (
                      <tr key={h.id} data-hyp={h.label}>
                        <td>{KIND[h.kind]}</td>
                        <td>{h.label}</td>
                        <td className="wrap">{detail}</td>
                        <td className="num" data-col="effet">{h.kind === "realise" || h.kind === "constante" ? "—" : e === null ? "n.d." : formatEuros(e)}</td>
                        {canEdit && <td><ActionForm action={deleteHypothesisAction.bind(null, slug, scenario.id, h.id)} submit="Supprimer" testid={`hyp-delete-${h.id}`} className="inline-form" danger /></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={paged.page} pageSize={CHANGES_PAGE} total={rows.length} href={pageHref} testid="hyp-pager" />
          </>
        )}
        <p className="tile-foot">Coût attribué : somme, sur les mois projetés, des lignes de la projection rattachées à l'hypothèse (pour une correction de base : le coût du contrat qu'elle porte ; pour un départ : la réduction de paie et les coûts de sortie). Les éléments « réalisés » et les constantes n'entrent pas dans la projection.</p>
      </section>
      {canEdit && others.length > 0 && (
        <section className="panel" data-testid="hyp-import">
          <h2>Reprendre des hypothèses d'un autre scénario <span className="desc">— <a href="#def-recopie">règle</a></span></h2>
          <p className="desc">Copie, dans ce scénario, les hypothèses du type choisi d'un autre scénario. Chacune est contrôlée contre la base et l'horizon de ce scénario : celles qui ne sont plus calculables (date hors horizon, contrat absent de la base…) ne sont pas reprises et sont listées avec leur raison.</p>
          <ActionForm action={importHypothesesAction.bind(null, slug, scenario.id)} submit="Reprendre ces hypothèses" testid="hyp-import-form">
            <div className="filters">
              <Field id="imp-source" label="Scénario source">
                <select className="select" id="imp-source" name="source" defaultValue="" required>
                  <option value="" disabled>Choisir…</option>
                  {others.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </Field>
            </div>
            <fieldset className="check-group">
              <legend className="label">Types à reprendre</legend>
              {IMPORT_KINDS.map((k) => <label key={k.kind} className="check"><input type="checkbox" name="kind" value={k.kind} /><span>{k.label}</span></label>)}
            </fieldset>
          </ActionForm>
        </section>
      )}
    </>
  );
}

