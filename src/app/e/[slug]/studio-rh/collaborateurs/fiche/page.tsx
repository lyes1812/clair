import { formatDate } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { loadCollabContext, personLabel } from "@/lib/rh/view";
import { CollabHeader, contractHref, personHref } from "../components";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MAX = 50;

// Fiche collaborateur : on cherche un collaborateur (nom, matricule, identifiant de contrat) puis on ouvre sa fiche.
export default async function FichePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadCollabContext(slug);
  const d = ctx.data;
  if (!d) return <CollabHeader ctx={ctx} tab={null} />;
  const q = one(sp.q).trim();
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
  const shown = (q ? rows.filter((r) => fold(`${r.label} ${r.p?.employeeNumber ?? ""} ${r.contracts.map((c) => c.externalId).join(" ")}`).includes(fold(q))) : rows).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <CollabHeader ctx={ctx} tab="fiche">
      <section className="panel" data-testid="fiche-search">
        <h2>Fiche collaborateur <span className="desc">— cherchez un collaborateur, puis ouvrez sa fiche</span></h2>
        <form method="get" className="filters">
          <div className="field-row">
            <label htmlFor="q">Rechercher (nom, matricule, identifiant de contrat)</label>
            <input className="input" id="q" name="q" defaultValue={q} />
          </div>
          <button className="btn" type="submit">Rechercher</button>
        </form>
        <div className="table-wrap">
          <table className="data-table" data-testid="fiche-table">
            <thead><tr><th>Collaborateur</th><th>Matricule</th><th>Contrats</th><th /></tr></thead>
            <tbody>
              {shown.slice(0, MAX).map((r) => (
                <tr key={r.key} data-person={r.label}>
                  <td>{r.label}</td>
                  <td>{r.p?.employeeNumber ?? "—"}</td>
                  <td className="wrap">{r.contracts.map((c) => <span key={c.contractKey}><a href={contractHref(slug, c.contractKey)}>{c.externalId}</a> ({c.nature ? contractNatureLabel(c.nature) : "nature n.d."}, {c.startDate ? formatDate(c.startDate) : "n.d."} → {c.endDate ? formatDate(c.endDate) : "en cours"}){" "}</span>)}</td>
                  <td>{r.p ? <a href={personHref(slug, r.p.personKey)}>Ouvrir la fiche</a> : "—"}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={4} className="desc">Aucun collaborateur ne correspond.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="tile-foot">{shown.length > MAX ? `${MAX} premiers résultats sur ${shown.length} : précisez la recherche. ` : `${shown.length} collaborateur${shown.length > 1 ? "s" : ""}. `}Une fiche regroupe les contrats d'une même personne ; les droits d'accès aux données individuelles restent ceux de l'espace.</p>
      </section>
    </CollabHeader>
  );
}
