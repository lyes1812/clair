import { DATA_ITEM } from "@/lib/nav";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { activeSync, getConnection, lastSync, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const SOURCES = [
  { id: "payfit", label: "PayFit", summary: "Collaborateurs, contrats, temps, absences, statut de paie et journal comptable." },
  { id: "pennylane", label: "Pennylane", summary: "Plan comptable et écritures des classes 6 et 7 et des comptes 421, 431, 437." },
] as const;

const UPCOMING = [
  { label: "Fichiers DSN", step: "1c", summary: "Import des DSN P25V01 / P26V01, avec aperçu et détection des réimports." },
  { label: "Rapprochement DSN–PayFit", step: "1d", summary: "Personnes et contrats rapprochés, écarts par champ, décisions tracées." },
];

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

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Données</span>
        <h1>{DATA_ITEM.label}</h1>
        <p className="desc">Toutes les sources de l'espace, lues à la demande, en lecture seule. Chaque lecture passe par un aperçu avant d'être appliquée.</p>
      </div>

      {states.map(({ id, label, summary, conn, last, active }) => (
        <section key={id} className="panel" data-testid={`source-${id}`}>
          <div className="source-head">
            <div>
              <h2>{label}</h2>
              <p className="desc">{summary}</p>
            </div>
            <a className="btn" href={`/e/${slug}/donnees/${id}`}>Gérer</a>
          </div>
          <dl className="facts">
            <div>
              <dt>Connexion</dt>
              <dd data-testid={`${id}-connection`}>{conn ? `Vérifiée — ${conn.companyName ?? "société"}` : "Non connectée"}</dd>
            </div>
            <div>
              <dt>Dernière lecture</dt>
              <dd>{last ? `${dateTimeFmt.format(last.startedAt)} — ${SYNC_STATUS_LABELS[last.status as SyncStatus]}` : "n.d. — aucune lecture"}</dd>
            </div>
            <div>
              <dt>Source active</dt>
              <dd data-testid={`${id}-active`}>{active?.decidedAt ? `Appliquée le ${dateTimeFmt.format(active.decidedAt)}` : "n.d. — aucune lecture appliquée"}</dd>
            </div>
          </dl>
        </section>
      ))}

      {UPCOMING.map((s) => (
        <section key={s.label} className="placeholder">
          <h3>{s.label} <span className="tag">étape {s.step} — à venir</span></h3>
          <p className="muted">{s.summary}</p>
        </section>
      ))}
    </>
  );
}
