import { isMonth } from "@/lib/connectors/months";
import { addMonths, formatDate, monthsBetween } from "@/lib/dates";
import { movements } from "@/lib/rh/headcount";
import { loadCollabContext, personLabel } from "@/lib/rh/view";
import { CollabHeader, contractHref, EventsTable, MonthSelect, PersonCell } from "../components";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CollaborateursMouvementsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadCollabContext(slug);
  const d = ctx.data;
  if (!d) return <CollabHeader ctx={ctx} tab={null} />;
  const b = d.build;
  const coverageMonths = [...new Set(d.coverage.map((c) => c.month))].sort();
  const first = b.presenceFrom ?? coverageMonths[0] ?? null;
  const last = b.presenceTo ?? coverageMonths[coverageMonths.length - 1] ?? null;
  if (!first || !last) {
    return (
      <CollabHeader ctx={ctx} tab="mouvements">
        <section className="placeholder" data-testid="movements-nd"><h3>n.d. — aucun mois couvert</h3></section>
      </CollabHeader>
    );
  }
  const months = monthsBetween(first, last);
  const defaultFrom = addMonths(last, -11) < first ? first : addMonths(last, -11);
  let from = isMonth(one(sp.de)) ? one(sp.de) : defaultFrom;
  let to = isMonth(one(sp.a)) ? one(sp.a) : last;
  if (from > to) [from, to] = [to, from];
  const etab = ctx.establishments.some((e) => e.id === one(sp.etab)) ? one(sp.etab) : "";
  const mv = movements(d, from, to, { natures: ctx.natures.codes, establishments: etab ? [etab] : undefined });
  const ndMonths = new Set(months.filter((m) => !d.coverage.some((c) => c.month === m && c.presenceStatus === "complete")));
  const persons = new Map(d.persons.map((p) => [p.personKey, p]));
  const provisional = mv.exits.filter((r) => r.event.flags.includes("provisional"));

  return (
    <CollabHeader ctx={ctx} tab="mouvements">
      <form method="get" className="filters" data-testid="movements-filters">
        <MonthSelect name="de" id="de" label="Du mois" months={months} value={from} nd={ndMonths} />
        <MonthSelect name="a" id="a" label="Au mois" months={months} value={to} nd={ndMonths} />
        {ctx.establishments.length > 1 && (
          <div className="field-row">
            <label htmlFor="etab">Établissement</label>
            <select className="select" id="etab" name="etab" defaultValue={etab}>
              <option value="">Tous</option>
              {ctx.establishments.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
        )}
        <button className="btn" type="submit">Afficher</button>
      </form>

      {mv.notes.length > 0 && (
        <section className="notice" data-testid="movements-notes">
          <strong>Mois non exacts sur la période :</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {mv.notes.map((n) => <li key={`${n.month}-${n.reason}`}>{n.month} : {n.reason}</li>)}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Entrées <span className="desc">— {from} → {to} · {mv.entries.filter((r) => r.inScope).length} comptée(s), {mv.entries.length} au total</span></h2>
        <EventsTable rows={mv.entries} slug={slug} kind="entry" testId="movements-entries" source={b.source} />
      </section>
      <section className="panel">
        <h2>Sorties <span className="desc">— {from} → {to} · {mv.exits.filter((r) => r.inScope).length} comptée(s), {mv.exits.length} au total</span></h2>
        <EventsTable rows={mv.exits} slug={slug} kind="exit" testId="movements-exits" source={b.source} />
      </section>

      <details className="panel" data-testid="upcoming-section" open={mv.upcoming.length > 0}>
        <summary>À venir — après la date de référence {formatDate(b.referenceDate)} ({mv.upcoming.length})</summary>
        {mv.upcoming.length === 0 ? <p className="muted">Aucun mouvement futur connu.</p> : (
          <ul className="list">
            {mv.upcoming.map((r) => (
              <li key={`${r.event.contractKey}-${r.event.kind}`}>
                <span>{r.event.kind === "entry" ? "Entrée" : "Sortie"} le {formatDate(r.event.date)} · <PersonCell person={r.person} contract={r.contract} slug={slug} /> · <code>{r.contract.externalId}</code></span>
                <span className="tag">{r.event.flags.includes("pending") ? "en attente chez PayFit" : "à venir"}</span>
              </li>
            ))}
          </ul>
        )}
      </details>

      {provisional.length > 0 && (
        <details className="panel" data-testid="provisional-section">
          <summary>Sorties provisoires — le mois suivant n'est pas complet ({provisional.length})</summary>
          <ul className="list">
            {provisional.map((r) => <li key={r.event.contractKey}><span>{formatDate(r.event.date)} · {personLabel(r.person) ?? r.contract.externalId}</span><code>{r.contract.externalId}</code></li>)}
          </ul>
        </details>
      )}

      {(mv.unplaced.length > 0 || mv.disappeared.length > 0) && (
        <details className="panel" data-testid="unplaced-section" open>
          <summary>Non positionnables ({mv.unplaced.length}) · disparus sans fin déclarée ({mv.disappeared.length})</summary>
          <ul className="list">
            {mv.unplaced.map((c) => <li key={c.contractKey}><a href={contractHref(slug, c.contractKey)}><code>{c.externalId}</code></a><span className="nd">date de début : n.d. — {c.fieldsNd.startDate?.reason}</span></li>)}
            {mv.disappeared.map((c) => <li key={c.contractKey}><a href={contractHref(slug, c.contractKey)}><code>{c.externalId}</code> {personLabel(persons.get(c.personKey ?? "")) ?? ""}</a><span className="nd">fin : n.d. — {c.fieldsNd.endDate?.reason}</span></li>)}
          </ul>
        </details>
      )}
    </CollabHeader>
  );
}
