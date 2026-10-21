import { formatDate } from "@/lib/dates";
import { annualList, type StripCell } from "@/lib/rh/headcount";
import { loadCollabContext, personLabel, showCount, showHeadcount } from "@/lib/rh/view";
import { CollabHeader, contractHref, FindingList, Nature, personHref, ShortId, Tile } from "../components";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Strip({ cells }: { cells: StripCell[] }) {
  return (
    <span className="strip" aria-label="présence en fin de mois">
      {cells.map((c) => (
        <span key={c.month} className={c.state} title={`${c.month} : ${c.state === "present" ? "présent en fin de mois" : c.state === "absent" ? `absent (${c.reason})` : `n.d. — ${c.reason}`}`} />
      ))}
    </span>
  );
}

export default async function CollaborateursAnneePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadCollabContext(slug);
  const d = ctx.data;
  if (!d) return <CollabHeader ctx={ctx} tab={null} />;
  const b = d.build;
  const years = [...new Set(d.coverage.map((c) => Number(c.month.slice(0, 4))))].sort();
  const requested = Number(one(sp.annee));
  const year = years.includes(requested) ? requested : (b.presenceTo ? Number(b.presenceTo.slice(0, 4)) : years[years.length - 1]);
  const etab = ctx.establishments.some((e) => e.id === one(sp.etab)) ? one(sp.etab) : "";
  const nature = /^\d{2}$/.test(one(sp.nature)) ? one(sp.nature) : "";
  if (!year) {
    return (
      <CollabHeader ctx={ctx} tab="annee">
        <section className="placeholder" data-testid="year-nd"><h3>n.d. — aucune année couverte</h3></section>
      </CollabHeader>
    );
  }
  const al = annualList(d, year, { natures: ctx.natures.codes, establishments: etab ? [etab] : undefined });
  const rows = nature ? al.rows.filter((r) => r.contracts.some((c) => c.nature === nature)) : al.rows;
  const persons = new Map(d.persons.map((p) => [p.personKey, p]));
  const contracts = new Map(d.contracts.map((c) => [c.contractKey, c]));
  const natures = [...new Set(d.contracts.map((c) => c.nature).filter((n): n is string => n !== null))].sort();
  const covered = al.coveredMonths.length;
  const presence = (p: { state: string; reason?: string; nd?: { reason: string } }) => (p.state === "present" ? "oui" : p.state === "absent" ? "non" : `n.d. — ${p.nd?.reason ?? ""}`);

  return (
    <CollabHeader ctx={ctx} tab="annee">
      <form method="get" className="filters" data-testid="year-filters">
        <div className="field-row">
          <label htmlFor="annee">Année</label>
          <select className="select" id="annee" name="annee" defaultValue={String(year)}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {ctx.establishments.length > 1 && (
          <div className="field-row">
            <label htmlFor="etab">Établissement</label>
            <select className="select" id="etab" name="etab" defaultValue={etab}>
              <option value="">Tous</option>
              {ctx.establishments.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
        )}
        <div className="field-row">
          <label htmlFor="nature">Nature</label>
          <select className="select" id="nature" name="nature" defaultValue={nature}>
            <option value="">Toutes</option>
            {natures.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button className="btn" type="submit">Afficher</button>
      </form>

      <section className="panel">
        <h2>Année {year}</h2>
        <dl className="facts">
          <Tile id="year-jan1" label={`Effectif au 01/01/${year} (personnes)`} shown={showHeadcount(al.headcountJan1, "persons")} def="headcount-persons" />
          <Tile id="year-dec31" label={`Effectif au 31/12/${year} (personnes)`} shown={showHeadcount(al.headcountDec31, "persons")} def="headcount-persons" />
          <Tile id="year-entries" label="Entrées de l'année" shown={showCount(al.entriesCount)} def="movements" />
          <Tile id="year-exits" label="Sorties de l'année" shown={showCount(al.exitsCount)} def="movements" />
          <Tile
            id="year-covered"
            label="Mois couverts"
            shown={covered === 12 ? { text: "12/12", kind: "value" } : { text: `${covered}/12`, kind: covered === 0 ? "nd" : "lower", foot: al.uncovered.map((u) => `${u.month} : ${u.reason}`).join(" · ") }}
            def="reference-date"
          />
        </dl>
      </section>

      <section className="panel">
        <h2>Personnes <span className="desc">— {rows.length} ligne(s)</span></h2>
        <div className="table-wrap">
          <table className="data-table" data-testid="collab-annual-table">
            <thead>
              <tr>
                <th>Personne</th><th>Matricule</th><th className="wrap">Contrats dans l'année</th><th>Présent au 01/01</th><th>Présent au 31/12</th><th className="wrap">Entrées</th><th className="wrap">Sorties</th><th>Fin de mois</th><th className="wrap">Mois présents</th><th className="wrap">Établissements</th><th className="num">Constats</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.person.personKey}>
                  <td><a href={personHref(slug, r.person.personKey)}>{personLabel(r.person) ?? <span className="nd">n.d.</span>}</a> <ShortId id={r.person.externalId} /></td>
                  <td>{r.person.employeeNumber ?? <span className="nd">n.d.</span>}</td>
                  <td className="wrap">{r.contracts.map((c) => <span key={c.contractKey} style={{ marginRight: 8 }}><a href={contractHref(slug, c.contractKey)}><code>{c.externalId}</code></a> <Nature code={c.nature} /></span>)}</td>
                  <td>{presence(r.presentJan1)}</td>
                  <td>{presence(r.presentDec31)}</td>
                  <td className="wrap">{r.entries.length ? r.entries.map((e) => formatDate(e.date)).join(", ") : "—"}</td>
                  <td className="wrap">{r.exits.length ? r.exits.map((e) => formatDate(e.date)).join(", ") : "—"}</td>
                  <td><Strip cells={r.strip} /></td>
                  <td className="wrap">{r.monthsPresent} sur {r.monthsCovered} couverts</td>
                  <td className="wrap">{r.establishments.map((e) => <code key={e} style={{ marginRight: 6 }}>{e}</code>)}</td>
                  <td className="num">{r.findings.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="muted">Aucune personne pour ces filtres.</p>}
      </section>

      {(al.withoutPerson.length > 0 || al.personsWithoutContract.length > 0) && (
        <details className="panel">
          <summary>Contrats sans personne ({al.withoutPerson.length}) · personnes sans contrat ({al.personsWithoutContract.length})</summary>
          <ul className="list">
            {al.withoutPerson.map((c) => <li key={c.contractKey}><a href={contractHref(slug, c.contractKey)}><code>{c.externalId}</code></a><span className="nd">personne : n.d. — {c.fieldsNd.personKey?.reason}</span></li>)}
            {al.personsWithoutContract.map((p) => <li key={p.personKey}><a href={personHref(slug, p.personKey)}>{personLabel(p) ?? p.externalId}</a><span className="muted">aucun contrat connu</span></li>)}
          </ul>
        </details>
      )}

      <details className="panel">
        <summary>Constats concernant l'année ({d.findings.filter((f) => f.month?.startsWith(`${year}-`)).length})</summary>
        <FindingList findings={d.findings.filter((f) => f.month?.startsWith(`${year}-`))} slug={slug} persons={persons} contracts={contracts} />
      </details>
    </CollabHeader>
  );
}
