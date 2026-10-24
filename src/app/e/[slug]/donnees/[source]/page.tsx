import "@/styles/donnees.css";
import { notFound } from "next/navigation";
import { GlossaryLink } from "@/components/GlossaryLink";
import { DONNEES_TERMS } from "@/lib/glossary/donnees";
import { dateTimeFmt, PROVIDER_LABELS } from "@/lib/connectors/labels";
import { isProviderId } from "@/lib/connectors/providers";
import { getConnection, listSyncs, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { disconnectSource } from "../actions";
import { ConnectForm, SyncForm } from "../Forms";
import { Empty, PageHead, Pill, syncTone } from "../ui";

export const dynamic = "force-dynamic";

function monthsAgo(n: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
  return d.toISOString().slice(0, 7);
}

const INTRO = {
  payfit: "API PayFit, en lecture seule.",
  pennylane: "API Pennylane, en lecture seule.",
};

type StepState = "done" | "current" | "todo";

export default async function SourcePage({ params }: { params: Promise<{ slug: string; source: string }> }) {
  const { slug, source } = await params;
  if (!isProviderId(source)) notFound();
  const label = PROVIDER_LABELS[source];
  const { workspace } = await requireWorkspace(slug);
  const isAdmin = workspace.role === "admin";
  const canSync = hasAtLeast(workspace.role, "editor");
  const [conn, syncs] = await Promise.all([getConnection(workspace.id, source), listSyncs(workspace.id, source)]);

  // Où en est la source : d'après la connexion et l'historique, rien d'autre.
  const running = syncs.some((s) => s.status === "running");
  const preview = syncs.find((s) => s.status === "preview");
  const applied = syncs.some((s) => s.status === "applied");
  const read = syncs.some((s) => s.status !== "running" && s.status !== "failed");
  const steps: { label: string; state: StepState; note: string }[] = [
    { label: "Connexion", state: conn ? "done" : "current", note: conn ? "Clé vérifiée" : "Clé API à enregistrer" },
    { label: "Lecture", state: !conn ? "todo" : read && !running ? "done" : "current", note: !conn ? "Après la connexion" : running ? "En cours" : read ? "Au moins une lecture faite" : "À lancer" },
    { label: "Aperçu", state: preview ? "current" : read ? "done" : "todo", note: preview ? "À valider" : read ? "Aucun aperçu en attente" : "Après une lecture" },
    { label: "Application", state: applied ? "done" : "todo", note: applied ? "Une lecture est active" : "Aucune lecture appliquée" },
  ];

  return (
    <>
      <PageHead crumbs={[{ label: "Données", href: `/e/${slug}/donnees` }, { label }]} title={label}>
        <p className="desc">{INTRO[source]}<GlossaryLink slug={slug} term={DONNEES_TERMS.lecture} /></p>
      </PageHead>

      <p className="dn-steps-head"><span className="label">Avancement</span><GlossaryLink slug={slug} term={DONNEES_TERMS.etapes} /></p>
      <ol className="dn-steps" aria-label="Avancement de la source" data-testid="dn-steps">
        {steps.map((s, i) => (
          <li key={s.label} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
            <span className="dn-step-no" aria-hidden="true">{s.state === "done" ? "✓" : i + 1}</span>
            <span className="dn-step-text">
              <strong>{s.label}</strong>
              <span className="desc">{s.note}</span>
            </span>
          </li>
        ))}
      </ol>

      {preview && (
        <p className="notice" data-testid="dn-preview-waiting">
          Un aperçu attend une validation (lancé le {dateTimeFmt.format(preview.startedAt)}). <a href={`/e/${slug}/donnees/synchro/${preview.id}`}>Ouvrir l'aperçu</a>
        </p>
      )}

      <div className="dn-split">
        <section className="panel" id="connexion">
          <h2>Connexion<GlossaryLink slug={slug} term={DONNEES_TERMS.cleApi} /></h2>
          {conn ? (
            <dl className="facts dn-facts" data-testid="connection-detail">
              <div><dt>Société</dt><dd>{conn.companyName ?? "n.d."}</dd></div>
              <div><dt>Vérifiée le</dt><dd>{conn.lastVerifiedAt ? dateTimeFmt.format(conn.lastVerifiedAt) : "n.d."}</dd></div>
              {source === "payfit" ? (
                <div><dt>Droits de la clé</dt><dd>{conn.scopes.length ? conn.scopes.join(", ") : "aucun droit en lecture"}</dd></div>
              ) : (
                <div><dt>Identifiant de société</dt><dd>{conn.externalCompanyId ?? "n.d."}</dd></div>
              )}
            </dl>
          ) : (
            <Empty>Aucune clé enregistrée pour cet espace.</Empty>
          )}
          {isAdmin ? (
            <>
              <ConnectForm slug={slug} source={source} label={label} connected={Boolean(conn)} />
              {conn && (
                <form action={disconnectSource.bind(null, slug, source)} className="dn-danger-zone">
                  <button className="btn danger" type="submit">Déconnecter (supprime la clé enregistrée)</button>
                </form>
              )}
            </>
          ) : (
            <p className="desc">Connexion réservée aux administrateurs.</p>
          )}
        </section>

        {conn && canSync && (
          <section className="panel" id="synchroniser">
            <h2>Synchroniser<GlossaryLink slug={slug} term={DONNEES_TERMS.periode} /></h2>
            <SyncForm slug={slug} source={source} defaultFrom={monthsAgo(12)} defaultTo={monthsAgo(1)} />
          </section>
        )}
      </div>

      <section className="panel" id="historique">
        <h2>Historique des lectures</h2>
        {syncs.length === 0 ? (
          <Empty>Aucune lecture.</Empty>
        ) : (
          <div className="table-wrap scroll">
            <table className="data-table sticky" data-testid="sync-history">
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
                      <td><Pill tone={syncTone(s.status)}>{SYNC_STATUS_LABELS[s.status as SyncStatus]}</Pill></td>
                      <td><code>{s.contentHash ? s.contentHash.slice(0, 12) : "—"}</code></td>
                      <td><a href={`/e/${slug}/donnees/synchro/${s.id}`} aria-label={`Détail de la lecture du ${dateTimeFmt.format(s.startedAt)}`}>Détail</a></td>
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
