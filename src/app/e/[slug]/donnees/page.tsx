import { DATA_ITEM } from "@/lib/nav";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { activeSync, getConnection, lastSync, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { dsnCoverage, listDsnFiles } from "@/lib/dsn/import";
import { fecCoverage, listFecFiles } from "@/lib/fec/import";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const SOURCES = [
  { id: "payfit", label: "PayFit", summary: "Collaborateurs, contrats, temps, absences, statut de paie et journal comptable." },
  { id: "pennylane", label: "Pennylane", summary: "Plan comptable et écritures des classes 6 et 7 et des comptes 421, 431, 437." },
] as const;

export default async function DonneesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const states = await Promise.all(
    SOURCES.map(async (src) => {
      const [conn, last, active] = await Promise.all([
        getConnection(workspace.id, src.id),
        lastSync(workspace.id, src.id),
        activeSync(workspace.id, src.id),
      ]);
      return { ...src, conn, last, active };
    }),
  );

  const [dsnFiles, dsnLast, coverage, fecFiles, fecLast, exercises] = await Promise.all([
    listDsnFiles(workspace.id), lastSync(workspace.id, "dsn"), dsnCoverage(workspace.id),
    listFecFiles(workspace.id), lastSync(workspace.id, "fec"), fecCoverage(workspace.id),
  ]);
  const complete = coverage.filter((c) => c.status === "complete").length;
  const byId = Object.fromEntries(states.map((s) => [s.id, s]));
  const apiCard = ({ id, label, summary, conn, last, active }: (typeof states)[number]) => (
    <section key={id} className="panel" data-testid={`source-${id}`}>
      <div className="source-head">
        <div>
          <h2>{label} <span className="tag">API</span></h2>
          <p className="desc">{summary}</p>
        </div>
        <a className="btn" href={`/e/${slug}/donnees/${id}`}>Gérer</a>
      </div>
      <dl className="facts">
        <div><dt>Connexion</dt><dd data-testid={`${id}-connection`}>{conn ? `Vérifiée — ${conn.companyName ?? "société"}` : "Non connectée"}</dd></div>
        <div><dt>Dernière lecture</dt><dd>{last ? `${dateTimeFmt.format(last.startedAt)} — ${SYNC_STATUS_LABELS[last.status as SyncStatus]}` : "n.d. — aucune lecture"}</dd></div>
        <div><dt>Source active</dt><dd data-testid={`${id}-active`}>{active?.decidedAt ? `Appliquée le ${dateTimeFmt.format(active.decidedAt)}` : "n.d. — aucune lecture appliquée"}</dd></div>
      </dl>
    </section>
  );

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Données</span>
        <h1>{DATA_ITEM.label}</h1>
        <p className="desc">Toutes les sources de l'espace, lues à la demande, en lecture seule. Chaque lecture passe par un aperçu avant d'être appliquée.</p>
      </div>

      <h2 className="group-title">Ressources humaines <span className="desc">— par l'API PayFit, ou par les DSN que PayFit génère</span></h2>
      {apiCard(byId.payfit)}

      <section className="panel" data-testid="source-dsn">
        <div className="source-head">
          <div>
            <h2>Fichiers DSN</h2>
            <p className="desc">Déclarations mensuelles déposées fichier par fichier : individus, contrats, rémunérations, activités.</p>
          </div>
          <a className="btn" href={`/e/${slug}/donnees/dsn`}>Gérer</a>
        </div>
        <dl className="facts">
          <div>
            <dt>Fichiers conservés</dt>
            <dd data-testid="dsn-files-count">{dsnFiles.length === 0 ? "aucun" : dsnFiles.length}</dd>
          </div>
          <div>
            <dt>Dernier dépôt</dt>
            <dd>{dsnLast ? `${dateTimeFmt.format(dsnLast.startedAt)} — ${SYNC_STATUS_LABELS[dsnLast.status as SyncStatus]}` : "n.d. — aucun dépôt"}</dd>
          </div>
          <div>
            <dt>Couverture</dt>
            <dd data-testid="dsn-coverage-summary">
              {coverage.length === 0 ? "n.d. — aucune déclaration appliquée" : `${complete} mois × établissement complet(s) sur ${coverage.length}`}
            </dd>
          </div>
        </dl>
      </section>

      <h2 className="group-title">Comptabilité <span className="desc">— par l'API Pennylane, ou par le FEC que Pennylane génère</span></h2>
      {apiCard(byId.pennylane)}

      <section className="panel" data-testid="source-fec">
        <div className="source-head">
          <div>
            <h2>Fichiers FEC</h2>
            <p className="desc">Fichier des écritures comptables, un par exercice : toutes les écritures, journaux et comptes.</p>
          </div>
          <a className="btn" href={`/e/${slug}/donnees/fec`}>Gérer</a>
        </div>
        <dl className="facts">
          <div><dt>Fichiers conservés</dt><dd data-testid="fec-files-count">{fecFiles.length === 0 ? "aucun" : fecFiles.length}</dd></div>
          <div><dt>Dernier dépôt</dt><dd>{fecLast ? `${dateTimeFmt.format(fecLast.startedAt)} — ${SYNC_STATUS_LABELS[fecLast.status as SyncStatus]}` : "n.d. — aucun dépôt"}</dd></div>
          <div>
            <dt>Exercices en vigueur</dt>
            <dd data-testid="fec-coverage-summary">{exercises.length === 0 ? "n.d. — aucun FEC appliqué" : exercises.map((e) => `${e.firstDate} → ${e.lastDate}`).join(" ; ")}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
