import { DATA_ITEM } from "@/lib/nav";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { activeSync, getConnection, lastSync, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const UPCOMING = [
  { label: "Pennylane", step: "1b", summary: "Plan comptable et écritures (classes 6 et 7, comptes 421, 431, 437)." },
  { label: "Fichiers DSN", step: "1c", summary: "Import des DSN P25V01 / P26V01, avec aperçu et détection des réimports." },
  { label: "Rapprochement DSN–PayFit", step: "1d", summary: "Personnes et contrats rapprochés, écarts par champ, décisions tracées." },
];

export default async function DonneesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const [conn, last, active] = await Promise.all([
    getConnection(workspace.id, "payfit"),
    lastSync(workspace.id, "payfit"),
    activeSync(workspace.id, "payfit"),
  ]);

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Données</span>
        <h1>{DATA_ITEM.label}</h1>
        <p className="desc">Toutes les sources de l'espace, lues à la demande, en lecture seule. Chaque lecture passe par un aperçu avant d'être appliquée.</p>
      </div>

      <section className="panel" data-testid="source-payfit">
        <div className="source-head">
          <div>
            <h2>PayFit</h2>
            <p className="desc">Collaborateurs, contrats, temps, absences, statut de paie et journal comptable.</p>
          </div>
          <a className="btn" href={`/e/${slug}/donnees/payfit`}>Gérer</a>
        </div>
        <dl className="facts">
          <div>
            <dt>Connexion</dt>
            <dd data-testid="payfit-connection">{conn ? `Vérifiée — ${conn.companyName ?? "société"}` : "Non connectée"}</dd>
          </div>
          <div>
            <dt>Dernière lecture</dt>
            <dd>{last ? `${dateTimeFmt.format(last.startedAt)} — ${SYNC_STATUS_LABELS[last.status as SyncStatus]}` : "n.d. — aucune lecture"}</dd>
          </div>
          <div>
            <dt>Source active</dt>
            <dd data-testid="payfit-active">{active?.decidedAt ? `Appliquée le ${dateTimeFmt.format(active.decidedAt)}` : "n.d. — aucune lecture appliquée"}</dd>
          </div>
        </dl>
      </section>

      {UPCOMING.map((s) => (
        <section key={s.label} className="placeholder">
          <h3>{s.label} <span className="tag">étape {s.step} — à venir</span></h3>
          <p className="muted">{s.summary}</p>
        </section>
      ))}
    </>
  );
}
