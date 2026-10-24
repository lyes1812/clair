import "@/styles/donnees.css";
import { GlossaryLink } from "@/components/GlossaryLink";
import { DONNEES_TERMS } from "@/lib/glossary/donnees";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { listSyncs, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { dsnCoverage, listDsnFiles } from "@/lib/dsn/import";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { FileUploadForm } from "../Forms";
import { Empty, PageHead, Pill, sizeFmt, syncTone } from "../ui";
import { CoverageTable } from "./CoverageTable";

export const dynamic = "force-dynamic";

const statusLabel = (s: string) => (s === "applied" ? "Appliquée" : SYNC_STATUS_LABELS[s as SyncStatus]);

export default async function DsnPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const [files, syncs, coverage] = await Promise.all([listDsnFiles(workspace.id), listSyncs(workspace.id, "dsn"), dsnCoverage(workspace.id)]);

  return (
    <>
      <PageHead crumbs={[{ label: "Données", href: `/e/${slug}/donnees` }, { label: "Fichiers DSN" }]} title="Fichiers DSN">
        <p className="desc">Déclarations mensuelles, déposées fichier par fichier.<GlossaryLink slug={slug} term={DONNEES_TERMS.depotDsn} /></p>
      </PageHead>

      {hasAtLeast(workspace.role, "editor") ? (
        <section className="panel" id="deposer">
          <h2>Déposer</h2>
          <FileUploadForm slug={slug} kind="dsn" />
        </section>
      ) : (
        <p className="notice">Dépôt réservé aux éditeurs et aux administrateurs.</p>
      )}

      <section className="panel" id="couverture">
        <div className="dn-section-head">
          <h2>Couverture<GlossaryLink slug={slug} term={DONNEES_TERMS.couvertureDsn} /></h2>
          <p className="desc">Lecture partielle : cotisations et arrêts de travail non extraits.</p>
        </div>
        <CoverageTable rows={coverage} />
      </section>

      <section className="panel" id="fichiers">
        <h2>Fichiers conservés</h2>
        {files.length === 0 ? (
          <Empty>Aucun fichier.</Empty>
        ) : (
          <div className="table-wrap scroll">
            <table className="data-table sticky" data-testid="dsn-files">
              <thead><tr><th scope="col">Fichier</th><th scope="col">Déposé le</th><th scope="col" className="num">Taille</th><th scope="col">Empreinte</th><th scope="col">Lecture</th></tr></thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td>{f.filename}</td>
                    <td>{dateTimeFmt.format(f.createdAt)}</td>
                    <td className="num">{sizeFmt(f.sizeBytes)}</td>
                    <td><code>{f.sha256.slice(0, 12)}</code></td>
                    <td><a className="dn-pill-link" href={`/e/${slug}/donnees/synchro/${f.syncId}`}><Pill tone={syncTone(f.syncStatus)}>{statusLabel(f.syncStatus)}</Pill></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" id="historique">
        <h2>Historique des dépôts</h2>
        {syncs.length === 0 ? (
          <Empty>Aucun dépôt.</Empty>
        ) : (
          <div className="table-wrap scroll">
            <table className="data-table sticky" data-testid="dsn-history">
              <thead><tr><th scope="col">Déposé le</th><th scope="col">Fichiers</th><th scope="col">Mois</th><th scope="col">Statut</th><th scope="col"></th></tr></thead>
              <tbody>
                {syncs.map((s) => {
                  const scope = s.scope as { files?: string[]; months?: string[] };
                  return (
                    <tr key={s.id}>
                      <td>{dateTimeFmt.format(s.startedAt)}</td>
                      <td className="wrap">{scope.files?.join(", ") ?? "n.d."}</td>
                      <td className="wrap">{scope.months?.length ? scope.months.join(", ") : "—"}</td>
                      <td><Pill tone={syncTone(s.status)}>{statusLabel(s.status)}</Pill></td>
                      <td><a href={`/e/${slug}/donnees/synchro/${s.id}`} aria-label={`Détail du dépôt du ${dateTimeFmt.format(s.startedAt)}`}>Détail</a></td>
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
