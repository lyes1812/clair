import { isMonth } from "@/lib/connectors/months";
import { formatDate, formatMonth, monthsBetween } from "@/lib/dates";
import { contractNatureLabel, quotaUnitLabel } from "@/lib/dsn/labels";
import { monthlyList, type MonthlyRow } from "@/lib/rh/headcount";
import { fmtNumber, loadCollabContext, MONTH_FLAG_LABELS, personLabel, showCount, showHeadcount, timeUnitLabel } from "@/lib/rh/view";
import { CollabHeader, contractHref, EndCell, EventsTable, Field, FindingList, FlagTags, MonthSelect, Nature, PersonCell, personHref, ProvenanceDetails, Tile } from "./components";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATES = { present: "Présents en fin de mois", entres: "Entrés dans le mois", sortis: "Sortis dans le mois", hors: "Hors effectif / non déclarés" } as const;

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
  const month = isMonth(requested) ? requested : (b.presenceTo ?? coverageMonths[coverageMonths.length - 1] ?? null);
  const etab = ctx.establishments.some((e) => e.id === one(sp.etab)) ? one(sp.etab) : "";
  const nature = /^\d{2}$/.test(one(sp.nature)) ? one(sp.nature) : "";
  const etat = one(sp.etat) in STATES ? (one(sp.etat) as keyof typeof STATES) : "";
  const q = one(sp.q).trim().slice(0, 80);
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
  const matches = (r: MonthlyRow) => {
    if (nature && r.contract.nature !== nature) return false;
    if (etat === "present" && !["present", "entered", "exited", "entered_exited"].includes(r.state.code)) return false;
    if (etat === "entres" && !["entered", "entered_exited"].includes(r.state.code)) return false;
    if (etat === "sortis" && !["exited", "entered_exited"].includes(r.state.code)) return false;
    if (etat === "hors" && ["present", "entered", "exited", "entered_exited"].includes(r.state.code)) return false;
    if (q) {
      const hay = [personLabel(r.person), r.person?.employeeNumber, r.person?.externalId, r.contract.externalId].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  };
  const rows = ml.rows.filter(matches);
  const isPayfit = b.source === "payfit";
  const badCoverage = ml.coverage.filter((c) => c.presenceStatus !== "complete");

  return (
    <CollabHeader ctx={ctx} tab="mois">
      <form method="get" className="filters" data-testid="month-filters">
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
        <div className="field-row">
          <label htmlFor="q">Recherche</label>
          <input className="input" id="q" name="q" defaultValue={q} placeholder="nom, matricule, identifiant" />
        </div>
        <button className="btn" type="submit">Afficher</button>
      </form>

      {badCoverage.map((c) => (
        <p key={`${c.establishmentId}-${c.month}`} className="notice" data-testid="coverage-notice">
          {formatMonth(c.month)} · {c.establishmentId} : {c.presenceStatus === "lower_bound" ? "borne basse" : c.presenceStatus === "missing" ? "mois non couvert" : c.presenceStatus === "incomplete" ? "mois incomplet" : "mois bloqué"} — {c.presenceReason ?? "n.d."}
        </p>
      ))}
      {ml.coverage.length === 0 && ml.gate && (
        <p className="notice" data-testid="coverage-notice">{formatMonth(month)} : n.d. — {ml.gate.reason}</p>
      )}

      <section className="panel">
        <h2>{formatMonth(month)}</h2>
        <dl className="facts">
          <Tile id="headcount-persons" label="Effectif fin de mois (personnes)" shown={showHeadcount(ml.headcountEnd, "persons")} def="headcount-persons" />
          <Tile id="headcount-contracts" label="Effectif fin de mois (contrats)" shown={showHeadcount(ml.headcountEnd, "contracts")} def="headcount-contracts" />
          <Tile
            id="present-any-day"
            label="Présents au moins un jour (personnes)"
            shown={ml.presentAnyDay.kind === "nd" ? { text: `n.d. — ${ml.presentAnyDay.nd.reason}`, kind: "nd" } : ml.presentAnyDay.kind === "lower_bound" ? { text: `≥ ${ml.presentAnyDay.persons}`, kind: "lower", foot: ml.presentAnyDay.qualifiers.join(" · ") } : { text: String(ml.presentAnyDay.persons), kind: "value", foot: `${ml.presentAnyDay.contracts} contrat(s)` }}
            def="month-end"
          />
          <Tile id="entries-count" label="Entrées" shown={showCount(ml.entriesCount)} def="movements" />
          <Tile id="exits-count" label="Sorties" shown={showCount(ml.exitsCount)} def="movements" />
          <Tile id="all-contracts" label="Contrats présents, toutes natures" shown={showHeadcount(ml.headcountEnd, "allContracts")} def="all-contracts" />
          <Tile
            id="out-of-scope"
            label="Hors effectif (par nature)"
            shown={
              ml.headcountEnd.kind === "nd"
                ? { text: `n.d. — ${ml.headcountEnd.nd.reason}`, kind: "nd" }
                : {
                    text: Object.entries(ml.headcountEnd.outOfScope.byNature).map(([n, c]) => `${n === "nd" ? "nature n.d." : contractNatureLabel(n)} : ${c}`).join(" · ") || "0",
                    kind: "value",
                    foot: [ml.headcountEnd.outOfScope.withoutPerson ? `contrats sans personne : ${ml.headcountEnd.outOfScope.withoutPerson}` : null, ml.headcountEnd.outOfScope.unpositioned ? `non positionnables : ${ml.headcountEnd.outOfScope.unpositioned}` : null].filter(Boolean).join(" · ") || undefined,
                  }
            }
            def="all-contracts"
          />
        </dl>
        {ml.headcountEnd.kind !== "nd" && Object.keys(ml.headcountEnd.bySiret).length > 1 && (
          <p className="desc">
            Par établissement : {Object.entries(ml.headcountEnd.bySiret).map(([s, v]) => `${s} : ${v.persons} personne(s), ${v.contracts} contrat(s)`).join(" · ")}
          </p>
        )}
      </section>

      {ml.gate ? (
        <section className="placeholder" data-testid="month-nd">
          <h3>n.d. — {ml.gate.reason}</h3>
          <p className="muted">
            La liste du mois n'est pas affichée : aucune valeur n'est reconstituée. Voir <a href={`/e/${slug}/donnees/${isPayfit ? "payfit" : "dsn"}`}>Données › {isPayfit ? "PayFit" : "DSN"}</a>.
          </p>
        </section>
      ) : (
        <section className="panel">
          <h2>Contrats du mois <span className="desc">— {rows.length} ligne(s){rows.length !== ml.rows.length ? ` sur ${ml.rows.length}` : ""}</span></h2>
          <div className="table-wrap">
            <table className="data-table" data-testid="collab-monthly-table">
              <thead>
                <tr>
                  <th>Personne</th><th>Matricule</th><th>Contrat</th><th>Établissement</th><th>Nature</th><th>Début</th><th className="wrap">Fin</th><th className="wrap">État fin de mois</th>
                  <th className="wrap">Quotité</th><th className="wrap">Temps payé / travaillé</th>
                  {isPayfit ? <th>Statut source</th> : <th className="num">Versements</th>}
                  <th>Drapeaux</th><th>Provenance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = r.month;
                  const c = r.contract;
                  return (
                    <tr key={`${m.contractKey}-${m.establishmentId}`} data-contract={c.externalId}>
                      <td><PersonCell person={r.person} contract={c} slug={slug} /></td>
                      <td>{r.person ? <Field row={r.person} field="employeeNumber" value={r.person.employeeNumber} slug={slug} prov={false} /> : "—"}</td>
                      <td><a href={contractHref(slug, c.contractKey)}><code>{c.externalId}</code></a></td>
                      <td><code>{m.establishmentId}</code></td>
                      <td><Nature code={c.nature} /></td>
                      <td>{c.startDate ? formatDate(c.startDate) : <span className="nd">n.d. — {c.fieldsNd.startDate?.reason ?? "date absente"}</span>}</td>
                      <td className="wrap"><EndCell c={c} slug={slug} prov={false} /></td>
                      <td className="wrap">{r.state.label}</td>
                      <td title={isPayfit ? "valeur à la date de lecture (non historisée par PayFit)" : `quotité du contrat / de référence, ${quotaUnitLabel(m.quotaUnit)}, déclarée pour ${m.month}`}>
                        {isPayfit ? (
                          c.fteAtRead !== null ? `${fmtNumber(c.fteAtRead)} ETP (à la lecture)` : <span className="nd">n.d. — {c.fieldsNd.fteAtRead?.reason ?? "non renseigné"}</span>
                        ) : m.contractQuota !== null || m.referenceQuota !== null ? (
                          `${m.contractQuota === null ? "n.d." : fmtNumber(m.contractQuota)} / ${m.referenceQuota === null ? "n.d." : fmtNumber(m.referenceQuota)} ${timeUnitLabel(m.quotaUnit, "dsn")} (${m.month})`
                        ) : (
                          <span className="nd">n.d. — {m.fieldsNd.contractQuota?.reason ?? "non déclaré"}</span>
                        )}
                      </td>
                      <td className="wrap">
                        {m.paidTime !== null ? (m.paidTime === 0 ? "0 — sous contrat, aucun temps payé" : `${fmtNumber(m.paidTime)} ${timeUnitLabel(m.timeUnit, b.source)}`) : <span className="nd">n.d. — {m.fieldsNd.paidTime?.reason ?? "absent"}</span>}
                        {" / "}
                        {m.workedTime !== null ? (m.workedTime === 0 ? "0" : `${fmtNumber(m.workedTime)} ${timeUnitLabel(m.timeUnit, b.source)}`) : <span className="nd">n.d. — {m.fieldsNd.workedTime?.reason ?? "absent"}</span>}
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
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="muted">Aucune ligne pour ces filtres.</p>}
        </section>
      )}

      {!ml.gate && (
        <>
          <section className="panel">
            <h2>Entrées et sorties de {formatMonth(month)}</h2>
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
                  <li key={r.contract.contractKey}><span><PersonCell person={r.person} contract={r.contract} slug={slug} /> · <code>{r.contract.externalId}</code></span><span><Nature code={r.contract.nature} /></span></li>
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
