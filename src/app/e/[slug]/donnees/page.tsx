import { DATA_ITEM } from "@/lib/nav";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { activeSync, getConnection, lastSync, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { dsnCoverage, listDsnFiles } from "@/lib/dsn/import";
import { fecCoverage, listFecFiles } from "@/lib/fec/import";
import { PROVIDER_LABELS } from "@/lib/connectors/labels";
import { resolveSource, SOURCE_MODE_LABELS, type SourceDomain, type SourceMode } from "@/lib/sources";
import { chooseSource } from "./actions";
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
  const [rhSource, accountingSource] = await Promise.all([resolveSource(workspace.id, "rh"), resolveSource(workspace.id, "accounting")]);
  const isAdmin = workspace.role === "admin";
  const sourceChoice = (domain: SourceDomain, r: typeof rhSource) => (
    <section className="panel source-choice" data-testid={`source-choice-${domain}`}>
      <div className="source-head">
        <div>
          <h3>Source retenue pour les modules</h3>
          <p data-testid={`source-chosen-${domain}`}>
            {r.chosen ? <strong>{PROVIDER_LABELS[r.chosen]}</strong> : <strong>n.d.</strong>} <span className="desc">— {r.reason}</span>
          </p>
        </div>
        {isAdmin ? (
          <form action={chooseSource.bind(null, slug, domain)} className="inline-form">
            <div className="field-row" style={{ flex: "0 1 320px" }}>
              <label htmlFor={`mode-${domain}`}>Règle</label>
              <select className="select" id={`mode-${domain}`} name="mode" defaultValue={r.mode}>
                {(Object.keys(SOURCE_MODE_LABELS) as SourceMode[]).map((m) => <option key={m} value={m}>{SOURCE_MODE_LABELS[m]}</option>)}
              </select>
            </div>
            <button className="btn" type="submit">Appliquer</button>
          </form>
        ) : (
          <span className="tag">{SOURCE_MODE_LABELS[r.mode]}</span>
        )}
      </div>
    </section>
  );
  // Dépôts additifs : « Appliquée » suffit, il n'y a pas de lecture « active » unique.
  const fileStatus = (status: string) => (status === "applied" ? "Appliquée" : SYNC_STATUS_LABELS[status as SyncStatus]);
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
      {sourceChoice("rh", rhSource)}
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
            <dd>{dsnLast ? `${dateTimeFmt.format(dsnLast.startedAt)} — ${fileStatus(dsnLast.status)}` : "n.d. — aucun dépôt"}</dd>
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
      {sourceChoice("accounting", accountingSource)}
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
          <div><dt>Dernier dépôt</dt><dd>{fecLast ? `${dateTimeFmt.format(fecLast.startedAt)} — ${fileStatus(fecLast.status)}` : "n.d. — aucun dépôt"}</dd></div>
          <div>
            <dt>Exercices en vigueur</dt>
            <dd data-testid="fec-coverage-summary">{exercises.length === 0 ? "n.d. — aucun FEC appliqué" : exercises.map((e) => `${e.firstDate} → ${e.lastDate}`).join(" ; ")}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
