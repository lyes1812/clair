import "@/styles/donnees.css";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { listSyncs, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { fecCoverage, listFecFiles } from "@/lib/fec/import";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { FileUploadForm } from "../Forms";
import { Empty, PageHead, Pill, sizeFmt, syncTone } from "../ui";
import { ExercisesTable } from "./ExercisesTable";

export const dynamic = "force-dynamic";

const statusLabel = (s: string) => (s === "applied" ? "Appliquée" : SYNC_STATUS_LABELS[s as SyncStatus]);

export default async function FecPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const [files, syncs, exercises] = await Promise.all([listFecFiles(workspace.id), listSyncs(workspace.id, "fec"), fecCoverage(workspace.id)]);

  return (
    <>
      <PageHead crumbs={[{ label: "Données", href: `/e/${slug}/donnees` }, { label: "Fichiers FEC" }]} title="Fichiers FEC">
        <p className="desc">
          Fichier des écritures comptables (art. A47 A-1 du LPF), exporté depuis Pennylane ou tout autre logiciel comptable. Un fichier par exercice ;
          toutes les écritures sont conservées telles quelles, en centimes exacts. Les montants ne sont ni retraités ni interprétés.
        </p>
      </PageHead>

      {hasAtLeast(workspace.role, "editor") ? (
        <section className="panel" id="deposer">
          <h2>Déposer</h2>
          <FileUploadForm slug={slug} kind="fec" />
        </section>
      ) : (
        <p className="notice">Le dépôt de fichiers est réservé aux éditeurs et aux administrateurs de l'espace.</p>
      )}

      <section className="panel" id="exercices">
        <h2>Exercices en vigueur</h2>
        <ExercisesTable rows={exercises} />
      </section>

      <section className="panel" id="fichiers">
        <h2>Fichiers conservés</h2>
        {files.length === 0 ? (
          <Empty>Aucun fichier.</Empty>
        ) : (
          <div className="table-wrap scroll">
            <table className="data-table sticky" data-testid="fec-files">
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
            <table className="data-table sticky" data-testid="fec-history">
              <thead><tr><th scope="col">Déposé le</th><th scope="col">Fichiers</th><th scope="col">Période</th><th scope="col">Statut</th><th scope="col"></th></tr></thead>
              <tbody>
                {syncs.map((s) => {
                  const scope = s.scope as { files?: string[]; months?: string[] };
                  const months = scope.months ?? [];
                  return (
                    <tr key={s.id}>
                      <td>{dateTimeFmt.format(s.startedAt)}</td>
                      <td className="wrap">{scope.files?.join(", ") ?? "n.d."}</td>
                      <td>{months.length ? `${months[0]} → ${months[months.length - 1]}` : "—"}</td>
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
