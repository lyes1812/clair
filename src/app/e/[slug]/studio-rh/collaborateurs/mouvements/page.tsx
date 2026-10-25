import { SearchableSelect } from "@/components/SearchableSelect";
import "@/styles/collaborateurs.css";
import { BarChart } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { isMonth } from "@/lib/connectors/months";
import { addMonths, formatDate, monthsBetween } from "@/lib/dates";
import { monthlyList, movements, type Count } from "@/lib/rh/headcount";
import { loadCollabContext, personLabel, showCount } from "@/lib/rh/view";
import { atLeast, clearMonths, countedPhrase, groupMonthReasons, monthAxis, monthLabel, monthLongLabel, movementSeries, ndSummary, periodLabel } from "@/lib/viz/collaborateurs";
import { CollabHeader, contractHref, EventsTable, FilterActions, MonthSelect, NdShort, PersonCell } from "../components";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Une cellule du tableau des mois : le nombre, « au moins n » (borne basse) ou « n.d. » (raison au survol et dans la note sous le tableau) ;
// jamais zéro à la place d'un n.d.
function CountCell({ c }: { c: Count }) {
  const s = showCount(c);
  if (s.kind === "nd") return <td className="num"><NdShort reason={clearMonths(s.text.replace(/^n\.d\. — /, ""))} /></td>;
  if (s.kind === "lower") {
    const why = s.foot ? clearMonths(s.foot) : null;
    return (
      <td className="num">
        <span className="lower" title={why ?? undefined}>
          {atLeast(s.text)}
          {why && <span className="collab-sr"> — {why}</span>}
        </span>
      </td>
    );
  }
  return <td className="num">{s.text}</td>;
}

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
  // La période reste dans les mois couverts (ceux que proposent les listes) : une adresse forgée ne peut pas demander des siècles de mois.
  const within = (m: string) => (m < first ? first : m > last ? last : m);
  let from = within(isMonth(one(sp.de)) ? one(sp.de) : defaultFrom);
  let to = within(isMonth(one(sp.a)) ? one(sp.a) : last);
  if (from > to) [from, to] = [to, from];
  const etab = ctx.establishments.some((e) => e.id === one(sp.etab)) ? one(sp.etab) : "";
  const mv = movements(d, from, to, { natures: ctx.natures.codes, establishments: etab ? [etab] : undefined });
  const ndMonths = new Set(months.filter((m) => !d.coverage.some((c) => c.month === m && c.presenceStatus === "complete")));
  const persons = new Map(d.persons.map((p) => [p.personKey, p]));
  const provisional = mv.exits.filter((r) => r.event.flags.includes("provisional"));
  // Entrées et sorties de chaque mois de la période : les comptes de la liste mensuelle (mêmes règles de couverture, n.d. conservé).
  const span = monthsBetween(from, to);
  const perMonth = span.map((m) => {
    const ml = monthlyList(d, m, { natures: ctx.natures.codes, establishments: etab ? [etab] : undefined });
    // Les qualificatifs du moteur (mois en cours, source incomplète) suivent jusque dans l'infobulle du graphique.
    return { month: m, entries: ml.entriesCount, exits: ml.exitsCount };
  });
  const series = movementSeries(perMonth);
  const chartNd = ndSummary(series);
  const axis = monthAxis(span);
  // Raisons identiques regroupées : « oct. à déc. 2026 : n.d. — période postérieure à la date de référence ».
  const noteGroups = groupMonthReasons(mv.notes);

  return (
    <CollabHeader ctx={ctx} tab="mouvements">
      <form method="get" className="filters bar collab-bar" data-testid="movements-filters" aria-label="Période et périmètre">
        <MonthSelect name="de" id="de" label="Du mois" months={months} value={from} nd={ndMonths} />
        <MonthSelect name="a" id="a" label="Au mois" months={months} value={to} nd={ndMonths} />
        {ctx.establishments.length > 1 && (
          <div className="field-row">
            <label htmlFor="etab">Établissement</label>
            <SearchableSelect className="select" id="etab" name="etab" defaultValue={etab} searchLabel="Établissement" options={[
              { value: "", label: "Tous" },
              ...ctx.establishments.map((establishment) => ({ value: establishment.id, label: establishment.label })),
            ]} />
          </div>
        )}
        <FilterActions label="Afficher" />
      </form>

      <section className="panel collab-panel" data-testid="movements-chart-panel">
        <div className="panel-head">
          <div className="collab-title">
            <h2>Entrées et sorties par mois</h2>
            <p className="desc">{periodLabel(from, to)} · nombre de contrats, natures comptées<GlossaryLink slug={slug} term="movements-chart" /></p>
          </div>
        </div>
        <div className="collab-chart-grid">
          <div className="collab-chart">
            {chartNd ? (
              <p className="nd" data-testid="movements-chart-nd">n.d. — {chartNd}</p>
            ) : (
              <>
                <BarChart
                  testid="movements-chart"
                  label={`Entrées et sorties comptées par mois, en nombre de contrats, période ${monthLongLabel(from)} → ${monthLongLabel(to)}`}
                  categories={axis.categories}
                  categoryTitles={axis.titles}
                  series={series}
                  unit="nombre"
                  height={280}
                />
                <p className="collab-legend" data-testid="movements-legend">
                  <span><i className="sw nd" aria-hidden="true" />Mois n.d. ou borne basse : non tracé</span>
                </p>
              </>
            )}
          </div>
          <div className="table-wrap scroll collab-months">
            <table className="data-table sticky collab-table" data-testid="movements-months">
              <caption className="collab-sr">Entrées et sorties comptées par mois, valeurs exactes du graphique</caption>
              <thead><tr><th scope="col">Mois</th><th scope="col" className="num">Entrées</th><th scope="col" className="num">Sorties</th></tr></thead>
              <tbody>
                {perMonth.map((m) => (
                  <tr key={m.month} data-month={m.month}>
                    <th scope="row">{monthLabel(m.month)}</th>
                    <CountCell c={m.entries} />
                    <CountCell c={m.exits} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {noteGroups.length > 0 && (
          <div className="collab-ndnote" data-testid="movements-notes">
            <p><strong>Mois non exacts sur la période</strong></p>
            <ul>
              {noteGroups.map((g) => <li key={`${g.label}-${g.reason}`}><strong>{g.label}</strong> : {clearMonths(g.reason)}</li>)}
            </ul>
          </div>
        )}
      </section>

      <section className="panel collab-panel">
        <h2>Entrées<GlossaryLink slug={slug} term="movements" /> <span className="desc">— {periodLabel(from, to)} · {countedPhrase(mv.entries.filter((r) => r.inScope).length, mv.entries.length)}</span></h2>
        <EventsTable rows={mv.entries} slug={slug} kind="entry" testId="movements-entries" source={b.source} />
      </section>
      <section className="panel collab-panel">
        <h2>Sorties<GlossaryLink slug={slug} term="movements" /> <span className="desc">— {periodLabel(from, to)} · {countedPhrase(mv.exits.filter((r) => r.inScope).length, mv.exits.length)}</span></h2>
        <EventsTable rows={mv.exits} slug={slug} kind="exit" testId="movements-exits" source={b.source} />
      </section>

      <details className="panel" data-testid="upcoming-section" open={mv.upcoming.length > 0}>
        <summary>À venir — après la date de référence {formatDate(b.referenceDate)} ({mv.upcoming.length})</summary>
        {mv.upcoming.length === 0 ? <p className="muted">Aucun mouvement futur connu.</p> : (
          <ul className="list">
            {mv.upcoming.map((r) => (
              <li key={`${r.event.contractKey}-${r.event.kind}`}>
                <span>{r.event.kind === "entry" ? "Entrée" : "Sortie"} le {formatDate(r.event.date)} · <PersonCell person={r.person} contract={r.contract} slug={slug} inline /> · <code>{r.contract.externalId}</code></span>
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
