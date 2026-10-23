import "@/styles/collaborateurs.css";
import { Pager } from "@/components/Pager";
import { formatDate } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import type { ContractDraft } from "@/lib/rh/referential/types";
import { loadCollabContext, personLabel } from "@/lib/rh/view";
import { DEFAULT_PAGE_SIZE, matchesQuery, pageHref, pageOf, pageSizeOf, paginate } from "@/lib/viz/collaborateurs";
import { CollabHeader, contractHref, Field, ListToolbar, personHref } from "../components";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Dates d'un contrat dans la liste : une fin absente n'est jamais écrite « en cours » (CDI : sans terme ; sinon n.d., raison au survol).
const startText = (c: ContractDraft) => (c.startDate ? formatDate(c.startDate) : "n.d.");
const endShort = (c: ContractDraft) => (c.endDate ? formatDate(c.endDate) : c.endStatus === "none_cdi" ? "sans terme (CDI)" : "fin n.d.");
const startNode = (c: ContractDraft) => (c.startDate ? formatDate(c.startDate) : <span className="nd" title={c.fieldsNd.startDate?.reason ?? "date absente"}>n.d.</span>);
const endNode = (c: ContractDraft) => (c.endDate || c.endStatus === "none_cdi" ? endShort(c) : <span className="nd" title={c.fieldsNd.endDate?.reason ?? (c.endStatus === "unpositioned" ? "contrat non positionnable" : "fin non renseignée")}>fin n.d.</span>);

// Fiche collaborateur : on cherche un collaborateur (nom, matricule, contrat, nature, date…) puis on ouvre sa fiche.
export default async function FichePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadCollabContext(slug);
  const d = ctx.data;
  if (!d) return <CollabHeader ctx={ctx} tab={null} />;
  const q = one(sp.q).trim().slice(0, 80);
  const size = pageSizeOf(one(sp.taille));
  const byPerson = new Map<string, typeof d.contracts>();
  for (const c of d.contracts) {
    const k = c.personKey ?? `sans-personne:${c.contractKey}`;
    byPerson.set(k, [...(byPerson.get(k) ?? []), c]);
  }
  const persons = new Map(d.persons.map((p) => [p.personKey, p]));
  const rows = [...byPerson].map(([key, contracts]) => {
    const p = persons.get(key);
    const label = (p ? personLabel(p) : null) ?? contracts[0]?.externalId ?? key;
    return { key, p, label, contracts };
  });
  // Toutes les colonnes (mêmes mots que l'écran) : nom, matricule, identifiant de la personne, et pour chaque contrat identifiant, nature, dates.
  const cells = (r: (typeof rows)[number]) => [
    r.label,
    r.p ? (r.p.employeeNumber ?? `n.d. — ${r.p.fieldsNd.employeeNumber?.reason ?? "valeur absente"}`) : null,
    r.p?.externalId,
    ...r.contracts.map((c) => `${c.externalId} ${c.nature ? `${contractNatureLabel(c.nature)} ${c.nature}` : "nature n.d."} ${startText(c)} ${c.startDate ?? ""} ${endShort(c)} ${c.endDate ?? ""}`),
  ];
  const shown = rows.filter((r) => matchesQuery(cells(r), q)).sort((a, b) => a.label.localeCompare(b.label));
  const pg = paginate(shown, pageOf(one(sp.page)), size);
  const sizeParam = size === DEFAULT_PAGE_SIZE ? undefined : String(size);
  const listParams = { q: q || undefined, taille: sizeParam };
  return (
    <CollabHeader ctx={ctx} tab="fiche">
      <section className="panel collab-panel" data-testid="fiche-search">
        <h2>Fiche collaborateur <span className="desc">— cherchez un collaborateur, puis ouvrez sa fiche</span></h2>
        <ListToolbar testid="fiche-toolbar" label="Filtres de la liste des collaborateurs" hidden={{}} q={q} size={size} resetHref={q ? pageHref({ taille: sizeParam }) : null} submitLabel="Rechercher" />
        <div className="table-wrap scroll collab-scroll">
          <table className="data-table sticky sticky-first collab-table collab-who" data-testid="fiche-table">
            <caption className="collab-sr">Collaborateurs, une ligne par personne</caption>
            <thead><tr><th scope="col">Collaborateur</th><th scope="col">Matricule</th><th scope="col">Contrats</th><th scope="col"><span className="collab-sr">Fiche</span></th></tr></thead>
            <tbody>
              {pg.items.map((r) => (
                <tr key={r.key} data-person={r.label}>
                  <td>{r.p ? <a href={personHref(slug, r.p.personKey)}>{r.label}</a> : r.label}</td>
                  <td className="col-nd">{r.p ? <Field row={r.p} field="employeeNumber" value={r.p.employeeNumber} slug={slug} prov={false} /> : "—"}</td>
                  <td>
                    <ul className="collab-contracts">
                      {r.contracts.map((c) => (
                        <li key={c.contractKey}>
                          <a href={contractHref(slug, c.contractKey)}>{c.externalId}</a>
                          <span>({c.nature ? contractNatureLabel(c.nature) : <span className="nd" title={c.fieldsNd.nature?.reason ?? "nature non renseignée"}>nature n.d.</span>}, <span className="col-date">{startNode(c)}</span> → <span className="col-date">{endNode(c)}</span>)</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{r.p ? <a href={personHref(slug, r.p.personKey)}>Ouvrir la fiche</a> : "—"}</td>
                </tr>
              ))}
              {pg.items.length === 0 && <tr><td colSpan={4} className="desc">Aucun collaborateur ne correspond.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={pg.page} pageSize={size} total={pg.total} href={(p) => pageHref(listParams, p)} testid="fiche-pager" />
        <p className="tile-foot">Une fiche regroupe les contrats d'une même personne ; les droits d'accès aux données individuelles restent ceux de l'espace.</p>
      </section>
    </CollabHeader>
  );
}
