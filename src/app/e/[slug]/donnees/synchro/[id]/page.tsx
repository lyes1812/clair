import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { COLLECTION_LABELS, dateTimeFmt, PROVIDER_LABELS } from "@/lib/connectors/labels";
import { getSync, sampleRecords, SYNC_STATUS_LABELS, type SyncStatus, type SyncSummary } from "@/lib/connectors/sync";
import { ledgerTotals } from "@/lib/connectors/views";
import { formatEuros } from "@/lib/money";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { DecisionButtons } from "../../Forms";

export const dynamic = "force-dynamic";

const ORDER = ["company", "accounts", "collaborators", "contracts", "worked_time", "absences", "payroll_status", "ledger_lines"];
const nd = (v: unknown) => (v === null || v === undefined || v === "" ? "n.d." : String(v));

export default async function SyncPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { workspace } = await requireWorkspace(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sync = await getSync(workspace.id, id);
  if (!sync) notFound();
  const status = sync.status as SyncStatus;
  const summary = sync.summary as SyncSummary;
  const months = (sync.scope as { months?: string[] }).months ?? [];
  const hasRecords = status === "preview" || status === "applied" || status === "superseded";
  const [collaborators, contracts, ledger] = hasRecords
    ? await Promise.all([
        sampleRecords(workspace.id, id, "collaborators", 10),
        sampleRecords(workspace.id, id, "contracts", 10),
        ledgerTotals(workspace.id, id),
      ])
    : [[], [], []];
  const canDecide = status === "preview" && hasAtLeast(workspace.role, "editor");

  return (
    <>
      {status === "running" && <AutoRefresh />}
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">
          <a href={`/e/${slug}/donnees`}>Données</a> / <a href={`/e/${slug}/donnees/${sync.provider}`}>{PROVIDER_LABELS[sync.provider as keyof typeof PROVIDER_LABELS]}</a> / Lecture
        </span>
        <h1>Lecture du {dateTimeFmt.format(sync.startedAt)}</h1>
        <p className="desc">
          Période {months.length ? `${months[0]} → ${months[months.length - 1]}` : "n.d."} · <span className={`status-pill ${status}`} data-testid="sync-status">{SYNC_STATUS_LABELS[status]}</span>
          {sync.contentHash && <> · empreinte <code>{sync.contentHash.slice(0, 12)}</code></>}
        </p>
      </div>

      {status === "running" && <p className="notice">Lecture en cours auprès de la source… La page se met à jour automatiquement.</p>}
      {status === "failed" && <p className="error" data-testid="sync-error">{sync.errorMessage ?? "Échec de la lecture."}</p>}
      {status === "applied" && (
        <p className="notice" data-testid="sync-active">
          Source active depuis le {sync.decidedAt ? dateTimeFmt.format(sync.decidedAt) : "n.d."} : c'est cette lecture que les modules Studio RH utiliseront.
        </p>
      )}
      {status === "superseded" && <p className="notice">Lecture remplacée par une application plus récente ; conservée dans l'historique.</p>}
      {status === "unchanged" && (
        <p className="notice" data-testid="sync-unchanged">Contenu identique à la source active : rien à appliquer, aucun doublon créé.</p>
      )}

      {summary.collections && (
        <section className="panel">
          <h2>{status === "preview" ? "Aperçu avant application" : "Contenu lu"}</h2>
          {summary.company && <p className="desc">Société : {summary.company.name}</p>}
          <div className="table-wrap">
            <table className="data-table" data-testid="sync-summary">
              <thead>
                <tr>
                  <th>Collection</th><th>Lecture</th><th className="num">Éléments</th><th className="num">Nouveaux</th><th className="num">Modifiés</th><th className="num">Retirés</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.collections]
                  .sort((a, b) => ORDER.indexOf(a.collection) - ORDER.indexOf(b.collection))
                  .map((c) => {
                    const d = summary.diff?.[c.collection];
                    return (
                      <tr key={c.collection}>
                        <td>{COLLECTION_LABELS[c.collection] ?? c.collection}</td>
                        <td>{c.status === "read" ? "lue" : `n.d. — ${c.reason}`}</td>
                        <td className="num">{c.status === "read" ? c.count : "n.d."}</td>
                        <td className="num">{d?.added ?? (c.status === "read" ? 0 : "—")}</td>
                        <td className="num">{d?.changed ?? (c.status === "read" ? 0 : "—")}</td>
                        <td className="num">{d?.removed ?? (c.status === "read" ? 0 : "—")}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {sync.warnings.length > 0 && (
            <ul className="desc" data-testid="sync-warnings">
              {sync.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          {canDecide && <DecisionButtons slug={slug} syncId={id} />}
        </section>
      )}

      {collaborators.length > 0 && (
        <section className="panel">
          <h2>Collaborateurs (extrait)</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Identifiant PayFit</th><th>Matricule</th><th>Prénom</th><th>Nom</th><th>Équipe</th></tr></thead>
              <tbody>
                {collaborators.map((r) => (
                  <tr key={r.key}><td><code>{r.key}</code></td><td>{nd(r.data.employeeNumber)}</td><td>{nd(r.data.firstName)}</td><td>{nd(r.data.lastName)}</td><td>{nd(r.data.teamName)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {contracts.length > 0 && (
        <section className="panel">
          <h2>Contrats (extrait)</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Contrat</th><th>Collaborateur</th><th>Début</th><th>Fin</th><th>Statut</th><th>Nature DSN</th><th className="num">Quotité (ETP contractuel)</th></tr></thead>
              <tbody>
                {contracts.map((r) => (
                  <tr key={r.key}>
                    <td><code>{r.key}</code></td><td><code>{nd(r.data.collaboratorId)}</code></td><td>{nd(r.data.startDate)}</td>
                    <td>{r.data.endDate ? String(r.data.endDate) : "ouvert"}</td><td>{nd(r.data.status)}</td><td>{nd(r.data.natureContratDsn)}</td>
                    <td className="num">{r.data.fullTimeEquivalent === null ? (r.data.timeInformation === "scope-missing" ? "n.d. — droit non accordé" : "n.d.") : String(r.data.fullTimeEquivalent).replace(".", ",")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ledger.length > 0 && (
        <section className="panel">
          <h2>Journal comptable : totaux par mois et par compte</h2>
          <p className="desc">Montants tels que lus à la source, sans retraitement. « — » : aucune ligne de ce côté du compte.</p>
          <div className="table-wrap">
            <table className="data-table" data-testid="ledger-totals">
              <thead><tr><th>Mois</th><th>Compte</th><th>Libellé</th><th className="num">Lignes</th><th className="num">Débit</th><th className="num">Crédit</th></tr></thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={`${r.period}-${r.accountId}`}>
                    <td>{r.period}</td><td><code>{r.accountId}</code></td><td>{nd(r.accountName)}</td><td className="num">{r.lines}</td>
                    <td className="num">{r.missing > 0 ? `n.d. — ${r.missing} ligne(s) sans montant` : r.debitCents === null ? "—" : formatEuros(r.debitCents)}</td>
                    <td className="num">{r.missing > 0 ? "n.d." : r.creditCents === null ? "—" : formatEuros(r.creditCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
