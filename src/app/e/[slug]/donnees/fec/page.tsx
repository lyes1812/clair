import { dateTimeFmt } from "@/lib/connectors/labels";
import { listSyncs, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { fecCoverage, listFecFiles } from "@/lib/fec/import";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { FileUploadForm } from "../Forms";
import { ExercisesTable } from "./ExercisesTable";

export const dynamic = "force-dynamic";

const sizeFmt = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);
const statusLabel = (s: string) => (s === "applied" ? "Appliquée" : SYNC_STATUS_LABELS[s as SyncStatus]);

export default async function FecPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const [files, syncs, exercises] = await Promise.all([listFecFiles(workspace.id), listSyncs(workspace.id, "fec"), fecCoverage(workspace.id)]);

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label"><a href={`/e/${slug}/donnees`}>Données</a> / Fichiers FEC</span>
        <h1>Fichiers FEC</h1>
        <p className="desc">
          Fichier des écritures comptables (art. A47 A-1 du LPF), exporté depuis Pennylane ou tout autre logiciel comptable. Un fichier par exercice ;
          toutes les écritures sont conservées telles quelles, en centimes exacts. Les montants ne sont ni retraités ni interprétés.
        </p>
      </div>

      {hasAtLeast(workspace.role, "editor") && (
        <section className="panel">
          <h2>Déposer</h2>
          <FileUploadForm slug={slug} kind="fec" />
        </section>
      )}

      <section className="panel">
        <h2>Exercices en vigueur</h2>
        <ExercisesTable rows={exercises} />
      </section>

      <section className="panel">
        <h2>Fichiers conservés</h2>
        {files.length === 0 ? (
          <p className="muted">Aucun fichier.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="fec-files">
              <thead><tr><th>Fichier</th><th>Déposé le</th><th className="num">Taille</th><th>Empreinte</th><th>Lecture</th></tr></thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td>{f.filename}</td>
                    <td>{dateTimeFmt.format(f.createdAt)}</td>
                    <td className="num">{sizeFmt(f.sizeBytes)}</td>
                    <td><code>{f.sha256.slice(0, 12)}</code></td>
                    <td><a href={`/e/${slug}/donnees/synchro/${f.syncId}`}><span className={`status-pill ${f.syncStatus}`}>{statusLabel(f.syncStatus)}</span></a></td>
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
            <table className="data-table" data-testid="fec-history">
              <thead><tr><th>Déposé le</th><th>Fichiers</th><th>Période</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {syncs.map((s) => {
                  const scope = s.scope as { files?: string[]; months?: string[] };
                  const months = scope.months ?? [];
                  return (
                    <tr key={s.id}>
                      <td>{dateTimeFmt.format(s.startedAt)}</td>
                      <td>{scope.files?.join(", ") ?? "n.d."}</td>
                      <td>{months.length ? `${months[0]} → ${months[months.length - 1]}` : "—"}</td>
                      <td><span className={`status-pill ${s.status}`}>{statusLabel(s.status)}</span></td>
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
