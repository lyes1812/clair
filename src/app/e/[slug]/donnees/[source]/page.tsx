import { notFound } from "next/navigation";
import { dateTimeFmt, PROVIDER_LABELS } from "@/lib/connectors/labels";
import { isProviderId } from "@/lib/connectors/providers";
import { getConnection, listSyncs, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { disconnectSource } from "../actions";
import { ConnectForm, SyncForm } from "../Forms";

export const dynamic = "force-dynamic";

function monthsAgo(n: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
  return d.toISOString().slice(0, 7);
}

const INTRO = {
  payfit: "Lecture seule de l'API PayFit. Clair ne modifie jamais rien dans PayFit.",
  pennylane: "Lecture seule de l'API Pennylane. Clair ne modifie jamais rien dans Pennylane.",
};

export default async function SourcePage({ params }: { params: Promise<{ slug: string; source: string }> }) {
  const { slug, source } = await params;
  if (!isProviderId(source)) notFound();
  const label = PROVIDER_LABELS[source];
  const { workspace } = await requireWorkspace(slug);
  const isAdmin = workspace.role === "admin";
  const canSync = hasAtLeast(workspace.role, "editor");
  const [conn, syncs] = await Promise.all([getConnection(workspace.id, source), listSyncs(workspace.id, source)]);

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label"><a href={`/e/${slug}/donnees`}>Données</a> / {label}</span>
        <h1>{label}</h1>
        <p className="desc">{INTRO[source]}</p>
      </div>

      <section className="panel">
        <h2>Connexion</h2>
        {conn ? (
          <dl className="facts" data-testid="connection-detail">
            <div><dt>Société</dt><dd>{conn.companyName ?? "n.d."}</dd></div>
            <div><dt>Vérifiée le</dt><dd>{conn.lastVerifiedAt ? dateTimeFmt.format(conn.lastVerifiedAt) : "n.d."}</dd></div>
            {source === "payfit" ? (
              <div><dt>Droits de la clé</dt><dd>{conn.scopes.length ? conn.scopes.join(", ") : "aucun droit en lecture"}</dd></div>
            ) : (
              <div><dt>Identifiant de société</dt><dd>{conn.externalCompanyId ?? "n.d."}</dd></div>
            )}
          </dl>
        ) : (
          <p className="muted">Aucune clé enregistrée pour cet espace.</p>
        )}
        {isAdmin ? (
          <>
            <ConnectForm slug={slug} source={source} label={label} connected={Boolean(conn)} />
            {conn && (
              <form action={disconnectSource.bind(null, slug, source)}>
                <button className="btn danger" type="submit">Déconnecter (supprime la clé enregistrée)</button>
              </form>
            )}
          </>
        ) : (
          <p className="desc">Seul un administrateur de l'espace peut connecter ou déconnecter la source.</p>
        )}
      </section>

      {conn && canSync && (
        <section className="panel">
          <h2>Synchroniser</h2>
          <SyncForm slug={slug} source={source} defaultFrom={monthsAgo(12)} defaultTo={monthsAgo(1)} />
        </section>
      )}

      <section className="panel">
        <h2>Historique des lectures</h2>
        {syncs.length === 0 ? (
          <p className="muted">Aucune lecture.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="sync-history">
              <thead>
                <tr><th>Lancée le</th><th>Période</th><th>Statut</th><th>Empreinte</th><th></th></tr>
              </thead>
              <tbody>
                {syncs.map((s) => {
                  const months = (s.scope as { months?: string[] }).months ?? [];
                  return (
                    <tr key={s.id}>
                      <td>{dateTimeFmt.format(s.startedAt)}</td>
                      <td>{months.length ? `${months[0]} → ${months[months.length - 1]}` : "n.d."}</td>
                      <td><span className={`status-pill ${s.status}`}>{SYNC_STATUS_LABELS[s.status as SyncStatus]}</span></td>
                      <td><code>{s.contentHash ? s.contentHash.slice(0, 12) : "—"}</code></td>
                      <td><a href={`/e/${slug}/donnees/synchro/${s.id}`}>Détail</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
