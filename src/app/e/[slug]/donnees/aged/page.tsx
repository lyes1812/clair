import "@/styles/donnees.css";
import { GlossaryLink } from "@/components/GlossaryLink";
import { DONNEES_TERMS } from "@/lib/glossary/donnees";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { listSyncs, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { listAgedFiles } from "@/lib/aged/import";
import { readAgedBalance } from "@/lib/aged/store";
import { formatDate } from "@/lib/dates";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { FileUploadForm } from "../Forms";
import { Empty, PageHead, Pill, sizeFmt, syncTone } from "../ui";
import { AgedTable } from "./AgedTable";

export const dynamic = "force-dynamic";

const statusLabel = (s: string) => (s === "applied" ? "Appliquée" : SYNC_STATUS_LABELS[s as SyncStatus]);

export default async function AgedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const [files, syncs, balance] = await Promise.all([listAgedFiles(workspace.id), listSyncs(workspace.id, "aged"), readAgedBalance(workspace.id)]);

  return (
    <>
      <PageHead crumbs={[{ label: "Données", href: `/e/${slug}/donnees` }, { label: "Balance âgée fournisseurs" }]} title="Balance âgée fournisseurs">
        <p className="desc">Factures fournisseurs restant dues à une date, une ligne par facture. Une seule balance est en vigueur : la dernière appliquée.<GlossaryLink slug={slug} term={DONNEES_TERMS.depotBalanceAgee} /></p>
      </PageHead>

      {hasAtLeast(workspace.role, "editor") ? (
        <section className="panel" id="deposer">
          <h2>Déposer</h2>
          <FileUploadForm slug={slug} kind="aged" />
        </section>
      ) : (
        <p className="notice">Dépôt réservé aux éditeurs et aux administrateurs.</p>
      )}

      <section className="panel" id="balance">
        <h2>Balance en vigueur</h2>
        {balance ? (
          <>
            <p className="desc" data-testid="aged-in-force">{balance.filename} · arrêtée au {formatDate(balance.asOf)} · {balance.invoices.length} facture(s)</p>
            <AgedTable invoices={balance.invoices} asOf={balance.asOf} />
          </>
        ) : <Empty>n.d. — aucune balance âgée appliquée.</Empty>}
      </section>

      <section className="panel" id="fichiers">
        <h2>Fichiers conservés</h2>
        {files.length === 0 ? (
          <Empty>Aucun fichier.</Empty>
        ) : (
          <div className="table-wrap scroll">
            <table className="data-table sticky" data-testid="aged-files">
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
            <table className="data-table sticky" data-testid="aged-history">
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
