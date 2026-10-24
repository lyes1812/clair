import "@/styles/collaborateurs.css";
import { GlossaryLink } from "@/components/GlossaryLink";
import { Pager } from "@/components/Pager";
import { isMonth } from "@/lib/connectors/months";
import { formatDate, formatMonth, monthsBetween } from "@/lib/dates";
import { contractNatureLabel, quotaUnitLabel } from "@/lib/dsn/labels";
import { monthlyList, type MonthlyRow } from "@/lib/rh/headcount";
import { fmtNumber, loadCollabContext, MONTH_FLAG_LABELS, personLabel, showCount, showHeadcount, timeUnitLabel, type Shown } from "@/lib/rh/view";
import { clearMonths, collectNotes, DEFAULT_PAGE_SIZE, defaultMonth, matchesQuery, pageHref, pageOf, pageSizeOf, paginate, plural } from "@/lib/viz/collaborateurs";
import { CollabHeader, contractHref, EndCell, endNd, endText, EventsTable, FilterActions, FindingList, FlagTags, HiddenParams, ListToolbar, MonthSelect, NdNote, NdShort, NdTableNote, Nature, PersonCell, personHref, ProvenanceDetails, shownNdReasons, StatePill, Tile } from "./components";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATES = { present: "Présents en fin de mois", entres: "Entrés dans le mois", sortis: "Sortis dans le mois", hors: "Hors effectif / non déclarés" } as const;

// Texte de chaque colonne d'une ligne (sans balisage, mêmes mots que l'écran) : la recherche porte sur toutes les colonnes affichées, n.d. compris.
function rowCells(r: MonthlyRow, source: "payfit" | "dsn"): (string | number | null | undefined)[] {
  const m = r.month;
  const c = r.contract;
  const p = r.person;
  const isPayfit = source === "payfit";
  const nd = (reason: string | undefined, fallback: string) => `n.d. — ${reason ?? fallback}`;
  const time = (v: number | null, key: "paidTime" | "workedTime") =>
    v !== null ? (v === 0 ? (key === "paidTime" ? "0 — sous contrat, aucun temps payé" : "0") : `${fmtNumber(v)} ${timeUnitLabel(m.timeUnit, source)}`) : nd(m.fieldsNd[key]?.reason, "absent");
  const quota = isPayfit
    ? c.fteAtRead !== null ? `${fmtNumber(c.fteAtRead)} ETP (à la lecture)` : nd(c.fieldsNd.fteAtRead?.reason, "non renseigné")
    : m.contractQuota !== null || m.referenceQuota !== null ? `${m.contractQuota === null ? "n.d." : fmtNumber(m.contractQuota)} / ${m.referenceQuota === null ? "n.d." : fmtNumber(m.referenceQuota)} ${timeUnitLabel(m.quotaUnit, "dsn")} (${m.month})` : nd(m.fieldsNd.contractQuota?.reason, "non déclaré");
  return [
    p ? (personLabel(p) ?? nd(p.fieldsNd.familyName?.reason, "nom absent")) : nd(c.fieldsNd.personKey?.reason, "contrat sans collaborateur"),
    p?.externalId,
    p ? (p.employeeNumber ?? nd(p.fieldsNd.employeeNumber?.reason, "valeur absente")) : null,
    c.externalId,
    m.establishmentId,
    c.nature === null ? "nature : n.d." : `${contractNatureLabel(c.nature)} ${c.nature}`,
    c.startDate ? `${formatDate(c.startDate)} ${c.startDate}` : nd(c.fieldsNd.startDate?.reason, "date absente"),
    c.endDate ? `${c.endDate} ${endText(c)}` : endText(c),
    r.state.label,
    quota,
    `${time(m.paidTime, "paidTime")} / ${time(m.workedTime, "workedTime")}`,
    isPayfit ? (c.statusSource ?? "n.d.") : m.paymentCount === null ? "n.d." : m.paymentCount === 0 ? "0 — aucun versement" : String(m.paymentCount),
    m.flags.map((f) => MONTH_FLAG_LABELS[f] ?? f).join(" "),
  ];
}

export default async function CollaborateursMoisPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadCollabContext(slug);
  const d = ctx.data;
  if (!d) return <CollabHeader ctx={ctx} tab={null} />;

  const b = d.build;
  const coverageMonths = [...new Set(d.coverage.map((c) => c.month))].sort();
  const months = b.presenceFrom && b.presenceTo ? monthsBetween(b.presenceFrom, b.presenceTo) : coverageMonths;
  const requested = one(sp.mois);
  // Sans mois demandé : le dernier mois entièrement couvert par la date de référence (le mois en cours à cette date n'a pas encore
  // d'effectif de fin de mois) ; à défaut, le dernier mois couvert. Un mois demandé dans l'adresse est toujours respecté.
  const lastCovered = b.presenceTo ?? coverageMonths[coverageMonths.length - 1] ?? null;
  const month = isMonth(requested) ? requested : defaultMonth(months, b.referenceDate, lastCovered);
  const etab = ctx.establishments.some((e) => e.id === one(sp.etab)) ? one(sp.etab) : "";
  const nature = /^\d{2}$/.test(one(sp.nature)) ? one(sp.nature) : "";
  const etat = one(sp.etat) in STATES ? (one(sp.etat) as keyof typeof STATES) : "";
  const q = one(sp.q).trim().slice(0, 80);
  const size = pageSizeOf(one(sp.taille));
  const ndMonths = new Set(months.filter((m) => !d.coverage.some((c) => c.month === m && (c.presenceStatus === "complete" || c.presenceStatus === "lower_bound"))));
  const opts = { natures: ctx.natures.codes, establishments: etab ? [etab] : undefined };
  const persons = new Map(d.persons.map((p) => [p.personKey, p]));
  const contracts = new Map(d.contracts.map((c) => [c.contractKey, c]));

  if (!month) {
    return (
      <CollabHeader ctx={ctx} tab="mois">
        <section className="placeholder" data-testid="month-nd"><h3>n.d. — aucun mois couvert</h3><p className="muted">Aucune déclaration ni lecture appliquée ne couvre un mois.</p></section>
      </CollabHeader>
    );
  }
  const ml = monthlyList(d, month, opts);
  const natures = [...new Set(d.contracts.map((c) => c.nature).filter((n): n is string => n !== null))].sort();
  const isPayfit = b.source === "payfit";
  const matches = (r: MonthlyRow) => {
    if (nature && r.contract.nature !== nature) return false;
    if (etat === "present" && !["present", "entered", "exited", "entered_exited"].includes(r.state.code)) return false;
    if (etat === "entres" && !["entered", "entered_exited"].includes(r.state.code)) return false;
    if (etat === "sortis" && !["exited", "entered_exited"].includes(r.state.code)) return false;
    if (etat === "hors" && ["present", "entered", "exited", "entered_exited"].includes(r.state.code)) return false;
    return matchesQuery(rowCells(r, b.source), q);
  };
  const rows = ml.rows.filter(matches);
  const pg = paginate(rows, pageOf(one(sp.page)), size);
  const badCoverage = ml.coverage.filter((c) => c.presenceStatus !== "complete");

  // Cellules n.d. du tableau : « n.d. » court (raison au survol), chaque raison dite une fois sous le tableau.
  const ndLog: { column: string; reason: string }[] = [];
  const nd = (reason: string, column: string) => {
    ndLog.push({ column, reason });
    return <NdShort reason={reason} />;
  };
  const body = pg.items.map((r) => {
    const m = r.month;
    const c = r.contract;
    ndLog.push(...endNd(c));
    return (
      <tr key={`${m.contractKey}-${m.establishmentId}`} data-contract={c.externalId}>
        <td><PersonCell person={r.person} contract={c} slug={slug} /></td>
        <td>{r.person ? (r.person.employeeNumber ?? nd(r.person.fieldsNd.employeeNumber?.reason ?? "valeur absente", "Matricule")) : "—"}</td>
        <td><a href={contractHref(slug, c.contractKey)}><code>{c.externalId}</code></a></td>
        <td><code>{m.establishmentId}</code></td>
        <td><Nature code={c.nature} /></td>
        <td className="col-date">{c.startDate ? formatDate(c.startDate) : nd(c.fieldsNd.startDate?.reason ?? "date absente", "Début")}</td>
        <td className="col-wide"><EndCell c={c} slug={slug} prov={false} short /></td>
        <td className="col-state"><StatePill code={r.state.code} label={r.state.label} /></td>
        <td className="col-qty" title={isPayfit ? "valeur à la date de lecture (non historisée par PayFit)" : `quotité du contrat / de référence, ${quotaUnitLabel(m.quotaUnit)}, déclarée pour ${m.month}`}>
          {isPayfit ? (
            c.fteAtRead !== null ? `${fmtNumber(c.fteAtRead)} ETP (à la lecture)` : nd(c.fieldsNd.fteAtRead?.reason ?? "non renseigné", "Quotité")
          ) : m.contractQuota !== null || m.referenceQuota !== null ? (
            `${m.contractQuota === null ? "n.d." : fmtNumber(m.contractQuota)} / ${m.referenceQuota === null ? "n.d." : fmtNumber(m.referenceQuota)} ${timeUnitLabel(m.quotaUnit, "dsn")} (${m.month})`
          ) : (
            nd(m.fieldsNd.contractQuota?.reason ?? "non déclaré", "Quotité")
          )}
        </td>
        <td className="col-qty">
          {m.paidTime !== null ? (m.paidTime === 0 ? "0 — sous contrat, aucun temps payé" : `${fmtNumber(m.paidTime)} ${timeUnitLabel(m.timeUnit, b.source)}`) : nd(m.fieldsNd.paidTime?.reason ?? "absent", "Temps payé")}
          {" / "}
          {m.workedTime !== null ? (m.workedTime === 0 ? "0" : `${fmtNumber(m.workedTime)} ${timeUnitLabel(m.timeUnit, b.source)}`) : nd(m.fieldsNd.workedTime?.reason ?? "absent", "Temps travaillé")}
        </td>
        {isPayfit ? (
          <td>{c.statusSource ?? <span className="nd">n.d.</span>}</td>
        ) : (
          <td className="num">{m.paymentCount === null ? <span className="nd">n.d.</span> : m.paymentCount === 0 ? <span title={m.fieldsNd.paymentCount?.reason}>0 — aucun versement</span> : m.paymentCount}</td>
        )}
        <td><FlagTags flags={m.flags} labels={MONTH_FLAG_LABELS} /></td>
        <td><ProvenanceDetails row={m} slug={slug} /></td>
      </tr>
    );
  });

  // Tuiles du mois : les valeurs viennent du moteur ; les raisons n.d. identiques sont dites une fois en tête de panneau.
  const present = ml.presentAnyDay;
  const tiles: { id: string; label: string; shown: Shown; def: string }[] = [
    { id: "headcount-persons", label: "Effectif fin de mois (personnes)", shown: showHeadcount(ml.headcountEnd, "persons"), def: "headcount-persons" },
    { id: "headcount-contracts", label: "Effectif fin de mois (contrats)", shown: showHeadcount(ml.headcountEnd, "contracts"), def: "headcount-contracts" },
    {
      id: "present-any-day",
      label: "Présents au moins un jour (personnes)",
      shown: present.kind === "nd" ? { text: `n.d. — ${present.nd.reason}`, kind: "nd" } : present.kind === "lower_bound" ? { text: `≥ ${present.persons}`, kind: "lower", foot: present.qualifiers.join(" · ") } : { text: String(present.persons), kind: "value", foot: plural(present.contracts, "contrat") },
      def: "month-end",
    },
    { id: "entries-count", label: "Entrées", shown: showCount(ml.entriesCount), def: "movements" },
    { id: "exits-count", label: "Sorties", shown: showCount(ml.exitsCount), def: "movements" },
    { id: "all-contracts", label: "Contrats présents, toutes natures", shown: showHeadcount(ml.headcountEnd, "allContracts"), def: "all-contracts" },
    {
      id: "out-of-scope",
      label: "Hors effectif (par nature)",
      shown:
        ml.headcountEnd.kind === "nd"
          ? { text: `n.d. — ${ml.headcountEnd.nd.reason}`, kind: "nd" }
          : {
              text: Object.entries(ml.headcountEnd.outOfScope.byNature).map(([n, c]) => `${n === "nd" ? "nature n.d." : contractNatureLabel(n)} : ${c}`).join(" · ") || "0",
              kind: "value",
              foot: [ml.headcountEnd.outOfScope.withoutPerson ? `contrats sans personne : ${ml.headcountEnd.outOfScope.withoutPerson}` : null, ml.headcountEnd.outOfScope.unpositioned ? `non positionnables : ${ml.headcountEnd.outOfScope.unpositioned}` : null].filter(Boolean).join(" · ") || undefined,
            },
      def: "all-contracts",
    },
  ];
  // La raison du blocage du mois est toujours écrite (en tête), puis les autres raisons n.d. des tuiles, sans doublon.
  const tileNd = [...new Set([...(ml.gate ? [clearMonths(ml.gate.reason)] : []), ...shownNdReasons(tiles.map((t) => t.shown))])];

  // Adresses : la barre de période (mois, établissement) et la barre du tableau (recherche, nature, état, taille) se conservent l'une l'autre.
  const sizeParam = size === DEFAULT_PAGE_SIZE ? undefined : String(size);
  const listParams = { mois: month, etab: etab || undefined, nature: nature || undefined, etat: etat || undefined, q: q || undefined, taille: sizeParam };
  const resetHref = q || nature || etat ? pageHref({ mois: month, etab: etab || undefined, taille: sizeParam }) : null;

  return (
    <CollabHeader ctx={ctx} tab="mois">
      <form method="get" className="filters bar collab-bar" data-testid="month-filters" aria-label="Période et périmètre">
        <HiddenParams values={{ nature: nature || undefined, etat: etat || undefined, q: q || undefined, taille: sizeParam }} />
        <MonthSelect name="mois" id="mois" label="Mois" months={months} value={month} nd={ndMonths} />
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

      {badCoverage.map((c) => (
        <p key={`${c.establishmentId}-${c.month}`} className="notice" data-testid="coverage-notice">
          {formatMonth(c.month)} · {c.establishmentId} : {c.presenceStatus === "lower_bound" ? "borne basse" : c.presenceStatus === "missing" ? "mois non couvert" : c.presenceStatus === "incomplete" ? "mois incomplet" : "mois bloqué"} — {c.presenceReason ?? "n.d."}
        </p>
      ))}

      <section className="panel collab-panel" data-testid="collab-month-panel">
        <h2>{formatMonth(month)}</h2>
        {/* Une seule explication n.d. en tête de panneau ; les tuiles disent « n.d. » (raison au survol). */}
        {ml.gate ? (
          <NdNote reasons={tileNd} testid="month-nd">
            <p className="muted">
              Liste du mois non affichée. Voir <a href={`/e/${slug}/donnees/${isPayfit ? "payfit" : "dsn"}`}>Données › {isPayfit ? "PayFit" : "DSN"}</a>.
            </p>
          </NdNote>
        ) : (
          <NdNote reasons={tileNd} testid="month-tiles-nd" />
        )}
        <dl className="facts collab-tiles">
          {tiles.map((t) => <Tile key={t.id} id={t.id} label={t.label} shown={t.shown} def={t.def} slug={slug} />)}
        </dl>
        {ml.headcountEnd.kind !== "nd" && Object.keys(ml.headcountEnd.bySiret).length > 1 && (
          <p className="desc">
            Par établissement : {Object.entries(ml.headcountEnd.bySiret).map(([s, v]) => `${s} : ${v.persons} personne${v.persons > 1 ? "s" : ""}, ${v.contracts} contrat${v.contracts > 1 ? "s" : ""}`).join(" · ")}
          </p>
        )}
      </section>

      {!ml.gate && (
        <section className="panel collab-panel" data-testid="collab-monthly-panel">
          <h2>Contrats du mois <span className="desc">— {plural(rows.length, "ligne")}{rows.length !== ml.rows.length ? ` sur ${ml.rows.length}` : ""}</span></h2>
          <ListToolbar testid="month-toolbar" label="Recherche et filtres du tableau des contrats du mois" hidden={{ mois: month, etab: etab || undefined }} q={q} size={size} resetHref={resetHref}>
            <div className="field-row">
              <label htmlFor="nature">Nature</label>
              <select className="select" id="nature" name="nature" defaultValue={nature}>
                <option value="">Toutes</option>
                {natures.map((n) => <option key={n} value={n}>{contractNatureLabel(n)}</option>)}
              </select>
            </div>
            <div className="field-row">
              <label htmlFor="etat">État</label>
              <select className="select" id="etat" name="etat" defaultValue={etat}>
                <option value="">Tous</option>
                {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </ListToolbar>
          <div className={pg.items.length > 12 ? "table-wrap scroll collab-scroll" : "table-wrap scroll collab-flat"}>
            <table className="data-table sticky sticky-first collab-table collab-who" data-testid="collab-monthly-table">
              <caption className="collab-sr">Contrats du mois — {formatMonth(month)} : une ligne par contrat et par établissement</caption>
              <thead>
                <tr>
                  <th scope="col">Personne</th><th scope="col">Matricule</th><th scope="col">Contrat</th><th scope="col">Établissement</th><th scope="col">Nature</th><th scope="col">Début</th><th scope="col" className="col-wide">Fin</th><th scope="col" className="col-state">État fin de mois<GlossaryLink slug={slug} term="month-states" /></th>
                  <th scope="col" className="col-qty">Quotité<GlossaryLink slug={slug} term="quota-and-time" /></th><th scope="col" className="col-qty">Temps payé / travaillé</th>
                  {isPayfit ? <th scope="col">Statut source</th> : <th scope="col" className="num">Versements</th>}
                  <th scope="col">Drapeaux</th><th scope="col">Provenance</th>
                </tr>
              </thead>
              <tbody>{body}</tbody>
            </table>
          </div>
          <NdTableNote notes={collectNotes(ndLog)} testid="collab-monthly-notes" />
          {rows.length === 0 && <p className="muted">Aucune ligne pour ces filtres.</p>}
          <Pager page={pg.page} pageSize={size} total={pg.total} href={(p) => pageHref(listParams, p)} testid="collab-monthly-pager" />
        </section>
      )}

      {!ml.gate && (
        <>
          <section className="panel collab-panel">
            <h2>Entrées et sorties — {formatMonth(month)}<GlossaryLink slug={slug} term="movements" /></h2>
            <h3>Entrées</h3>
            <EventsTable rows={ml.entries} slug={slug} kind="entry" testId="month-entries" source={b.source} />
            <h3>Sorties</h3>
            <EventsTable rows={ml.exits} slug={slug} kind="exit" testId="month-exits" source={b.source} />
          </section>

          <details className="panel" data-testid="out-of-scope-section">
            <summary>Hors effectif — natures non comptées ({ml.outOfScope.otherNatures.length}), contrats sans personne ({ml.outOfScope.withoutPerson.length}), non positionnables ({ml.outOfScope.unpositioned.length}), personnes sans contrat ({ml.outOfScope.personsWithoutContract.length})</summary>
            {ml.outOfScope.otherNatures.length > 0 && (
              <ul className="list">
                {ml.outOfScope.otherNatures.map((r) => (
                  <li key={r.contract.contractKey}><span><PersonCell person={r.person} contract={r.contract} slug={slug} inline /> · <code>{r.contract.externalId}</code></span><span><Nature code={r.contract.nature} /></span></li>
                ))}
              </ul>
            )}
            {ml.outOfScope.withoutPerson.length > 0 && (
              <ul className="list">
                {ml.outOfScope.withoutPerson.map((c) => (
                  <li key={c.contractKey}><a href={contractHref(slug, c.contractKey)}><code>{c.externalId}</code></a><span className="nd">personne : n.d. — {c.fieldsNd.personKey?.reason}</span></li>
                ))}
              </ul>
            )}
            {ml.outOfScope.unpositioned.length > 0 && (
              <ul className="list">
                {ml.outOfScope.unpositioned.map((c) => (
                  <li key={c.contractKey}><a href={contractHref(slug, c.contractKey)}><code>{c.externalId}</code></a><span className="nd">date de début : n.d. — {c.fieldsNd.startDate?.reason}</span></li>
                ))}
              </ul>
            )}
            {ml.outOfScope.personsWithoutContract.length > 0 && (
              <ul className="list">
                {ml.outOfScope.personsWithoutContract.map((p) => (
                  <li key={p.personKey}><a href={personHref(slug, p.personKey)}>{personLabel(p) ?? p.externalId}</a><span className="muted">aucun contrat connu</span></li>
                ))}
              </ul>
            )}
          </details>

          {ml.disappeared.length > 0 && (
            <details className="panel" data-testid="disappeared-section">
              <summary>Disparus sans fin déclarée ({ml.disappeared.length})</summary>
              <ul className="list">
                {ml.disappeared.map((c) => (
                  <li key={c.contractKey}><a href={contractHref(slug, c.contractKey)}><code>{c.externalId}</code></a><span className="nd">fin : n.d. — {c.fieldsNd.endDate?.reason}</span></li>
                ))}
              </ul>
            </details>
          )}

          <details className="panel" data-testid="findings-section" open={ml.findings.some((f) => f.severity === "check")}>
            <summary>Constats du mois ({ml.findings.length})</summary>
            <FindingList findings={ml.findings} slug={slug} persons={persons} contracts={contracts} testId="month-findings" />
          </details>
        </>
      )}
    </CollabHeader>
  );
}
