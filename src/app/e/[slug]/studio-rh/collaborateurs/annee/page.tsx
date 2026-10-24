import "@/styles/collaborateurs.css";
import { Pager } from "@/components/Pager";
import { formatDate } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { annualList, type AnnualRow, type StripCell } from "@/lib/rh/headcount";
import { loadCollabContext, personLabel, showCount, showHeadcount, type Shown } from "@/lib/rh/view";
import { clearMonths, collectNotes, DEFAULT_PAGE_SIZE, groupMonthReasons, matchesQuery, pageHref, pageOf, pageSizeOf, paginate, plural, quarters, shortQualifier, stripCellTitle, stripLabel } from "@/lib/viz/collaborateurs";
import { CollabHeader, contractHref, FilterActions, FindingList, HiddenParams, ListToolbar, Nature, NdNote, NdShort, NdTableNote, personHref, ShortId, shownNdReasons, Tile, YesNoPill } from "../components";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Frise de présence en fin de mois : douze cases lues par trimestre ; le détail de chaque mois est au survol et à la lecture d'écran.
function Strip({ cells }: { cells: StripCell[] }) {
  return (
    <span className="collab-strip" role="img" aria-label={stripLabel(cells)}>
      {quarters(cells).map((q, i) => (
        <span key={i} className="q">
          {q.map((c) => <i key={c.month} className={c.state} title={stripCellTitle(c)} />)}
        </span>
      ))}
    </span>
  );
}

// Échelle des mois au-dessus de la frise (initiales, même découpage en trimestres).
const INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
function StripScale() {
  return (
    <span className="collab-strip collab-strip-scale" aria-hidden="true">
      {quarters(INITIALS).map((q, i) => (
        <span key={i} className="q">{q.map((l, j) => <span key={j}>{l}</span>)}</span>
      ))}
    </span>
  );
}

type Presence = AnnualRow["presentJan1"];
const presenceText = (p: Presence) => (p.state === "present" ? "oui" : p.state === "absent" ? "non" : `n.d. — ${p.nd.reason}`);
const dates = (list: { date: string }[]) => list.map((e) => `${formatDate(e.date)} ${e.date}`).join(" ");

// Texte de chaque colonne d'une ligne (sans balisage, mêmes mots que l'écran) : la recherche porte sur toutes les colonnes affichées, n.d. compris.
const ndName = (p: AnnualRow["person"]) => `n.d. — ${p.fieldsNd.familyName?.reason ?? "nom absent"}`;
const ndMatricule = (p: AnnualRow["person"]) => `n.d. — ${p.fieldsNd.employeeNumber?.reason ?? "valeur absente"}`;
function rowCells(r: AnnualRow): (string | number | null | undefined)[] {
  return [
    personLabel(r.person) ?? ndName(r.person),
    r.person.externalId,
    r.person.employeeNumber ?? ndMatricule(r.person),
    r.contracts.map((c) => `${c.externalId} ${c.nature === null ? "nature : n.d." : `${contractNatureLabel(c.nature)} ${c.nature}`}`).join(" "),
    presenceText(r.presentJan1),
    presenceText(r.presentDec31),
    r.entries.length ? dates(r.entries) : "—",
    r.exits.length ? dates(r.exits) : "—",
    `${r.monthsPresent} sur ${r.monthsCovered} couverts`,
    r.establishments.join(" "),
  ];
}

// Présence à une date : « oui » / « non », ou « n.d. » court (la raison est dite une fois sous le tableau).
function PresenceCell({ p }: { p: Presence }) {
  if (p.state === "nd") return <td><NdShort reason={p.nd.reason} /></td>;
  return <td><YesNoPill yes={p.state === "present"} title={p.state === "absent" ? p.reason : undefined} /></td>;
}

// Total annuel (entrées, sorties) : « au moins n » avec le qualificatif ; la liste des mois n.d. n'est retirée du pied de tuile que si
// chacun de ces mois a déjà sa raison écrite en tête de panneau (said), sinon elle reste.
const yearShown = (c: Parameters<typeof showCount>[0], said: readonly string[]): Shown => {
  const s = showCount(c);
  if (c.kind === "lower_bound" && c.qualifiers.length) return { ...s, foot: [...new Set(c.qualifiers.map((q) => shortQualifier(q, said)))].join(" · ") };
  return s;
};

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
  const q = one(sp.q).trim().slice(0, 80);
  const size = pageSizeOf(one(sp.taille));
  if (!year) {
    return (
      <CollabHeader ctx={ctx} tab="annee">
        <section className="placeholder" data-testid="year-nd"><h3>n.d. — aucune année couverte</h3></section>
      </CollabHeader>
    );
  }
  const al = annualList(d, year, { natures: ctx.natures.codes, establishments: etab ? [etab] : undefined });
  const rows = al.rows.filter((r) => (!nature || r.contracts.some((c) => c.nature === nature)) && matchesQuery(rowCells(r), q));
  const pg = paginate(rows, pageOf(one(sp.page)), size);
  const persons = new Map(d.persons.map((p) => [p.personKey, p]));
  const contracts = new Map(d.contracts.map((c) => [c.contractKey, c]));
  const natures = [...new Set(d.contracts.map((c) => c.nature).filter((n): n is string => n !== null))].sort();
  const covered = al.coveredMonths.length;

  // Tuiles de l'année ; les raisons n.d. déjà dites par la liste des mois non couverts ne sont pas répétées.
  const shownJan1 = showHeadcount(al.headcountJan1, "persons");
  const shownDec31 = showHeadcount(al.headcountDec31, "persons");
  const saidMonths = al.uncovered.map((u) => u.month);
  const shownEntries = yearShown(al.entriesCount, saidMonths);
  const shownExits = yearShown(al.exitsCount, saidMonths);
  // Mois non couverts : une ligne par raison, les mois regroupés (« oct. à déc. 2026 »).
  const uncoveredGroups = groupMonthReasons(al.uncovered);
  const saidReasons = new Set(uncoveredGroups.map((g) => clearMonths(g.reason)));
  const tileNd = shownNdReasons([shownJan1, shownDec31, shownEntries, shownExits]).filter((r) => !saidReasons.has(r));
  // Cellules n.d. du tableau : « n.d. » court, chaque raison dite une fois sous le tableau.
  const ndLog: { column: string; reason: string }[] = [];
  for (const r of pg.items) {
    if (r.person.employeeNumber === null) ndLog.push({ column: "Matricule", reason: r.person.fieldsNd.employeeNumber?.reason ?? "valeur absente" });
    if (r.presentJan1.state === "nd") ndLog.push({ column: "Présent au 01/01", reason: r.presentJan1.nd.reason });
    if (r.presentDec31.state === "nd") ndLog.push({ column: "Présent au 31/12", reason: r.presentDec31.nd.reason });
  }

  // Adresses : la barre de période (année, établissement) et la barre du tableau (recherche, nature, taille) se conservent l'une l'autre.
  const sizeParam = size === DEFAULT_PAGE_SIZE ? undefined : String(size);
  const listParams = { annee: String(year), etab: etab || undefined, nature: nature || undefined, q: q || undefined, taille: sizeParam };
  const resetHref = q || nature ? pageHref({ annee: String(year), etab: etab || undefined, taille: sizeParam }) : null;

  return (
    <CollabHeader ctx={ctx} tab="annee">
      <form method="get" className="filters bar collab-bar" data-testid="year-filters" aria-label="Période et périmètre">
        <HiddenParams values={{ nature: nature || undefined, q: q || undefined, taille: sizeParam }} />
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
        <FilterActions label="Afficher" />
      </form>

      <section className="panel collab-panel" data-testid="collab-year-panel">
        <h2>Année {year}</h2>
        {uncoveredGroups.length > 0 && (
          <div className="collab-ndnote" data-testid="year-uncovered">
            <ul>
              {uncoveredGroups.map((g) => <li key={g.reason}><strong>n.d.</strong> — {g.label} : {clearMonths(g.reason)}</li>)}
            </ul>
          </div>
        )}
        <NdNote reasons={tileNd} testid="year-tiles-nd" />
        <dl className="facts collab-tiles five">
          <Tile id="year-jan1" label={`Effectif au 01/01/${year} (personnes)`} shown={shownJan1} def="headcount-persons" />
          <Tile id="year-dec31" label={`Effectif au 31/12/${year} (personnes)`} shown={shownDec31} def="headcount-persons" />
          <Tile id="year-entries" label="Entrées de l'année" shown={shownEntries} def="movements" />
          <Tile id="year-exits" label="Sorties de l'année" shown={shownExits} def="movements" />
          <Tile
            id="year-covered"
            label="Mois couverts"
            shown={covered === 12 ? { text: "12/12", kind: "value" } : { text: `${covered}/12`, kind: "value", foot: covered === 0 ? undefined : `${12 - covered} mois non ${12 - covered > 1 ? "couverts" : "couvert"}` }}
            def="reference-date"
          />
        </dl>
      </section>

      <section className="panel collab-panel" data-testid="collab-annual-panel">
        <h2>Personnes <span className="desc">— {plural(rows.length, "ligne")}{rows.length !== al.rows.length ? ` sur ${al.rows.length}` : ""}</span></h2>
        <ListToolbar testid="year-toolbar" label="Recherche et filtres du tableau des personnes de l'année" hidden={{ annee: String(year), etab: etab || undefined }} q={q} size={size} resetHref={resetHref}>
          <div className="field-row">
            <label htmlFor="nature">Nature</label>
            <select className="select" id="nature" name="nature" defaultValue={nature}>
              <option value="">Toutes</option>
              {natures.map((n) => <option key={n} value={n}>{contractNatureLabel(n)}</option>)}
            </select>
          </div>
        </ListToolbar>
        <p className="collab-legend" data-testid="strip-legend">
          <span>Colonne « Fin de mois » : un carré par mois, par trimestre —</span>
          <span><i className="sw present" aria-hidden="true" />présent</span>
          <span><i className="sw" aria-hidden="true" />absent</span>
          <span><i className="sw nd" aria-hidden="true" />n.d. (raison au survol)</span>
        </p>
        <div className={pg.items.length > 12 ? "table-wrap scroll collab-scroll" : "table-wrap scroll collab-flat"}>
          <table className="data-table sticky sticky-first collab-table collab-who" data-testid="collab-annual-table">
            <caption className="collab-sr">Personnes de l'année {year}, une ligne par personne</caption>
            <thead>
              <tr>
                <th scope="col">Personne</th><th scope="col">Matricule</th><th scope="col">Contrats dans l'année</th><th scope="col">Présent au 01/01</th><th scope="col">Présent au 31/12</th><th scope="col">Entrées</th><th scope="col">Sorties</th>
                <th scope="col">Fin de mois<StripScale /></th>
                <th scope="col" className="num">Mois présents</th><th scope="col">Établissements</th><th scope="col" className="num">Constats</th>
              </tr>
            </thead>
            <tbody>
              {pg.items.map((r) => (
                <tr key={r.person.personKey}>
                  <td className="collab-who-cell">
                    <span className="collab-person-cell">
                      <a href={personHref(slug, r.person.personKey)}>{personLabel(r.person) ?? <span className="nd">{ndName(r.person)}</span>}</a>{" "}
                      <ShortId id={r.person.externalId} sub />
                    </span>
                  </td>
                  <td>
                    {r.person.employeeNumber ?? (
                      <NdShort reason={r.person.fieldsNd.employeeNumber?.reason ?? "valeur absente"} />
                    )}
                  </td>
                  <td>
                    <ul className="collab-contracts">
                      {r.contracts.map((c) => <li key={c.contractKey}><a href={contractHref(slug, c.contractKey)}><code>{c.externalId}</code></a> <Nature code={c.nature} /></li>)}
                    </ul>
                  </td>
                  <PresenceCell p={r.presentJan1} />
                  <PresenceCell p={r.presentDec31} />
                  <td className="collab-dates">{r.entries.length ? r.entries.map((e, i) => <span key={`${e.contractKey}-${e.date}`}><span className="col-date">{formatDate(e.date)}</span>{i < r.entries.length - 1 ? ", " : ""}</span>) : "—"}</td>
                  <td className="collab-dates">{r.exits.length ? r.exits.map((e, i) => <span key={`${e.contractKey}-${e.date}`}><span className="col-date">{formatDate(e.date)}</span>{i < r.exits.length - 1 ? ", " : ""}</span>) : "—"}</td>
                  <td><Strip cells={r.strip} /></td>
                  <td className="num">{r.monthsPresent} sur {r.monthsCovered} couverts</td>
                  <td>{r.establishments.map((e) => <code key={e} style={{ marginRight: 6 }}>{e}</code>)}</td>
                  <td className="num">{r.findings.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NdTableNote notes={collectNotes(ndLog)} testid="collab-annual-notes" />
        {rows.length === 0 && <p className="muted">Aucune personne pour ces filtres.</p>}
        <Pager page={pg.page} pageSize={size} total={pg.total} href={(p) => pageHref(listParams, p)} testid="collab-annual-pager" />
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
