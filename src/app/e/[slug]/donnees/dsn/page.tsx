import { dateTimeFmt } from "@/lib/connectors/labels";
import { listSyncs, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { dsnCoverage, listDsnFiles } from "@/lib/dsn/import";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { FileUploadForm } from "../Forms";
import { CoverageTable } from "./CoverageTable";

export const dynamic = "force-dynamic";

const sizeFmt = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);

export default async function DsnPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const [files, syncs, coverage] = await Promise.all([listDsnFiles(workspace.id), listSyncs(workspace.id, "dsn"), dsnCoverage(workspace.id)]);

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label"><a href={`/e/${slug}/donnees`}>Données</a> / Fichiers DSN</span>
        <h1>Fichiers DSN</h1>
        <p className="desc">
          Déclarations sociales nominatives mensuelles, déposées fichier par fichier. Les lectures appliquées s'additionnent ; pour chaque
          établissement et chaque mois, la déclaration qui fait foi est déterminée par les règles de la norme (numéro d'ordre, annule et remplace, fractions).
        </p>
      </div>

      {hasAtLeast(workspace.role, "editor") && (
        <section className="panel">
          <h2>Déposer</h2>
          <FileUploadForm slug={slug} kind="dsn" />
        </section>
      )}

      <section className="panel">
        <h2>Couverture</h2>
        <p className="desc">Lecture partielle : individus, contrats, rémunérations et activités. Cotisations et arrêts de travail ne sont pas extraits.</p>
        <CoverageTable rows={coverage} />
      </section>

      <section className="panel">
        <h2>Fichiers conservés</h2>
        {files.length === 0 ? (
          <p className="muted">Aucun fichier.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="dsn-files">
              <thead><tr><th>Fichier</th><th>Déposé le</th><th className="num">Taille</th><th>Empreinte</th><th>Lecture</th></tr></thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td>{f.filename}</td>
                    <td>{dateTimeFmt.format(f.createdAt)}</td>
                    <td className="num">{sizeFmt(f.sizeBytes)}</td>
                    <td><code>{f.sha256.slice(0, 12)}</code></td>
                    <td><a href={`/e/${slug}/donnees/synchro/${f.syncId}`}><span className={`status-pill ${f.syncStatus}`}>{f.syncStatus === "applied" ? "Appliquée" : SYNC_STATUS_LABELS[f.syncStatus as SyncStatus]}</span></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Historique des dépôts</h2>
        {syncs.length === 0 ? (
          <p className="muted">Aucun dépôt.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="dsn-history">
              <thead><tr><th>Déposé le</th><th>Fichiers</th><th>Mois</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {syncs.map((s) => {
                  const scope = s.scope as { files?: string[]; months?: string[] };
                  return (
                    <tr key={s.id}>
                      <td>{dateTimeFmt.format(s.startedAt)}</td>
                      <td>{scope.files?.join(", ") ?? "n.d."}</td>
                      <td>{scope.months?.length ? scope.months.join(", ") : "—"}</td>
                      <td><span className={`status-pill ${s.status}`}>{s.status === "applied" ? "Appliquée" : SYNC_STATUS_LABELS[s.status as SyncStatus]}</span></td>
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
