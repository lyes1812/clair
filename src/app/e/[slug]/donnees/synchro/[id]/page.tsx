import { MoneyText } from "@/components/Money";
import "@/styles/donnees.css";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { GlossaryLink } from "@/components/GlossaryLink";
import { DONNEES_TERMS } from "@/lib/glossary/donnees";
import { COLLECTION_LABELS, dateTimeFmt, PROVIDER_LABELS } from "@/lib/connectors/labels";
import { getSync, sampleRecords, SYNC_STATUS_LABELS, type SyncStatus, type SyncSummary } from "@/lib/connectors/sync";
import { ledgerTotals } from "@/lib/connectors/views";
import { dsnCoverage, type DsnSyncSummary } from "@/lib/dsn/import";
import { fecCoverage, type FecSyncSummary } from "@/lib/fec/import";
import { CoverageTable } from "../../dsn/CoverageTable";
import { ExercisesTable } from "../../fec/ExercisesTable";
import { formatEuros } from "@/lib/money";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { DecisionButtons } from "../../Forms";
import { PageHead, Pill, syncTone } from "../../ui";

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
  const [collaborators, contracts, ledger, dsnPeople] = hasRecords
    ? await Promise.all([
        sampleRecords(workspace.id, id, "collaborators", 10),
        sampleRecords(workspace.id, id, "contracts", 10),
        ledgerTotals(workspace.id, id, sync.provider === "fec" ? /^(?:[67]|421|431|437)/ : undefined),
        sampleRecords(workspace.id, id, "people", 200),
      ])
    : [[], [], [], []];
  const canDecide = status === "preview" && hasAtLeast(workspace.role, "editor");
  const additive = summary.mode === "additive";
  const statusLabel = additive && status === "applied" ? "Appliquée" : SYNC_STATUS_LABELS[status];
  const dsn = sync.provider === "dsn" ? (summary as DsnSyncSummary) : null;
  const fec = sync.provider === "fec" ? (summary as FecSyncSummary) : null;
  const uploaded = dsn ?? fec;
  const coverage = dsn && (status === "preview" || status === "applied") ? await dsnCoverage(workspace.id, status === "preview" ? id : undefined) : null;
  const exercises = fec && (status === "preview" || status === "applied") ? await fecCoverage(workspace.id, status === "preview" ? id : undefined) : null;
  const providerLabel = PROVIDER_LABELS[sync.provider as keyof typeof PROVIDER_LABELS];

  return (
    <MoneyText><>
      {status === "running" && <AutoRefresh />}
      <PageHead
        crumbs={[
          { label: "Données", href: `/e/${slug}/donnees` },
          { label: providerLabel, href: `/e/${slug}/donnees/${sync.provider}` },
          { label: additive ? "Dépôt" : "Lecture" },
        ]}
        title={`${additive ? "Dépôt" : "Lecture"} du ${dateTimeFmt.format(sync.startedAt)}`}
      >
        <dl className="dn-meta">
          <div><dt>Période</dt><dd>{months.length ? `${months[0]} → ${months[months.length - 1]}` : "n.d."}</dd></div>
          <div><dt>Statut</dt><dd><Pill tone={syncTone(status)} testid="sync-status">{statusLabel}</Pill></dd></div>
          {sync.contentHash && <div><dt>Empreinte</dt><dd><code>{sync.contentHash.slice(0, 12)}</code></dd></div>}
        </dl>
      </PageHead>

      {status === "running" && <p className="notice">Lecture en cours auprès de la source… La page se met à jour seule.</p>}
      {status === "failed" && <p className="error" data-testid="sync-error">{sync.errorMessage ?? "Échec de la lecture."}</p>}
      {status === "applied" && (
        <p className="notice ok" data-testid="sync-active">
          {additive
            ? `Appliqué le ${sync.decidedAt ? dateTimeFmt.format(sync.decidedAt) : "n.d."}.`
            : `Active depuis le ${sync.decidedAt ? dateTimeFmt.format(sync.decidedAt) : "n.d."}.`}
          <GlossaryLink slug={slug} term={DONNEES_TERMS.lecture} />
        </p>
      )}
      {status === "superseded" && <p className="notice">Remplacée par une application plus récente.</p>}
      {status === "unchanged" && (
        <p className="notice" data-testid="sync-unchanged">
          {additive ? "Fichier(s) déjà déposé(s) : rien à appliquer, aucun doublon créé." : "Contenu identique à la source active : rien à appliquer, aucun doublon créé."}
        </p>
      )}

      {uploaded && (
        <section className="panel">
          <h2>Fichiers du dépôt</h2>
          <div className="table-wrap scroll">
            <table className="data-table sticky" data-testid="dsn-upload-files">
              <thead><tr><th scope="col">Fichier</th><th scope="col">Résultat</th><th scope="col">Détail</th></tr></thead>
              <tbody>
                {uploaded.files.map((f) => (
                  <tr key={`${f.filename}-${f.status}`}>
                    <td>{f.filename}</td>
                    <td>
                      <Pill tone={f.status === "read" ? "applied" : f.status === "duplicate" ? "neutral" : "failed"}>
                        {f.status === "read" ? "lu" : f.status === "duplicate" ? "déjà déposé" : "refusé"}
                      </Pill>
                    </td>
                    <td className="wrap">
                      {f.status === "read" && `${f.detail} · ${f.encoding} · empreinte ${f.sha256.slice(0, 12)}`}
                      {f.status === "duplicate" && `Même empreinte qu'un fichier déposé ${f.importedAt === "ce dépôt" ? "dans ce dépôt" : `le ${dateTimeFmt.format(new Date(f.importedAt))}`} ; non importé.`}
                      {f.status === "rejected" && f.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fec && fec.exercises.length > 0 && (
            <>
              <h3>Exercices lus</h3>
              <ExercisesTable rows={fec.exercises.map((e) => ({ ...e, syncId: id, pending: status === "preview" }))} showWarnings />
            </>
          )}
          {dsn && dsn.declarations.length > 0 && (
            <>
              <h3>Déclarations lues</h3>
              <div className="table-wrap scroll">
                <table className="data-table sticky" data-testid="dsn-declarations">
                  <thead>
                    <tr><th scope="col">Fichier</th><th scope="col">Mois</th><th scope="col">SIRET</th><th scope="col">Type</th><th scope="col">Fraction</th><th scope="col">Ordre</th><th scope="col" className="num">Individus</th><th scope="col" className="num">Contrats</th><th scope="col" className="num">Rémunérations</th><th scope="col">État</th></tr>
                  </thead>
                  <tbody>
                    {dsn.declarations.map((d) => (
                      <tr key={d.key}>
                        <td>{d.filename}</td><td>{d.month ?? "n.d."}</td><td><code>{d.siret ?? "n.d."}</code></td>
                        <td>{d.type === "01" ? "normale" : d.type === "03" ? "annule et remplace" : d.type ?? "n.d."}</td>
                        <td>{d.fraction ? `${d.fraction[0]}/${d.fraction[1]}` : "n.d."}</td><td>{d.order ?? "n.d."}</td>
                        <td className="num">{d.counts.people}</td><td className="num">{d.counts.contracts}</td><td className="num">{d.counts.remunerations}</td>
                        <td className="wrap">
                          {d.eligible ? <Pill tone="applied">éligible</Pill> : <Pill tone="failed">non éligible</Pill>}
                          {d.blocking.length > 0 && <span className="desc"> {d.blocking.join(" ")}</span>}
                          {d.warnings.length > 0 && <span className="desc"> {d.warnings.join(" ")}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {coverage && (
        <section className="panel">
          <h2>{status === "preview" ? "Couverture après application" : "Couverture"}</h2>
          <CoverageTable rows={coverage} />
        </section>
      )}

      {exercises && (
        <section className="panel">
          <h2>{status === "preview" ? "Exercices en vigueur après application" : "Exercices en vigueur"}</h2>
          <ExercisesTable rows={exercises} />
        </section>
      )}

      {summary.collections && (
        <section className="panel">
          <div className="dn-section-head">
            <h2>{status === "preview" ? "Aperçu avant application" : "Contenu lu"}<GlossaryLink slug={slug} term={DONNEES_TERMS.lecture} /></h2>
            {summary.company && <p className="desc">Société : {summary.company.name}</p>}
          </div>
          <div className="table-wrap">
            <table className="data-table" data-testid="sync-summary">
              <thead>
                <tr>
                  <th scope="col">Collection</th><th scope="col">Lecture</th><th scope="col" className="num">Éléments</th>
                  {!additive && (<><th scope="col" className="num">Nouveaux</th><th scope="col" className="num">Modifiés</th><th scope="col" className="num">Retirés</th></>)}
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
                        <td className={c.status === "read" ? undefined : "wrap"}>{c.status === "read" ? "lue" : <span className="nd">{`n.d. — ${c.reason}`}</span>}</td>
                        <td className="num">{c.status === "read" ? c.count : "n.d."}</td>
                        {!additive && (
                          <>
                            <td className="num">{d?.added ?? (c.status === "read" ? 0 : "—")}</td>
                            <td className="num">{d?.changed ?? (c.status === "read" ? 0 : "—")}</td>
                            <td className="num">{d?.removed ?? (c.status === "read" ? 0 : "—")}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {sync.warnings.length > 0 && (
            <div className="dn-warnings">
              <h3>Points d'attention</h3>
              <ul data-testid="sync-warnings">
                {sync.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}
          {canDecide && <DecisionButtons slug={slug} syncId={id} additive={additive} />}
        </section>
      )}

      {collaborators.length > 0 && (
        <section className="panel">
          <div className="dn-section-head">
            <h2>Collaborateurs (extrait)<GlossaryLink slug={slug} term={DONNEES_TERMS.extraits} /></h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th scope="col">Identifiant PayFit</th><th scope="col">Matricule</th><th scope="col">Prénom</th><th scope="col">Nom</th><th scope="col">Équipe</th></tr></thead>
              <tbody>
                {collaborators.map((r) => (
                  <tr key={r.key}><td><code>{r.key}</code></td><td>{nd(r.data.employeeNumber)}</td><td>{nd(r.data.firstName)}</td><td>{nd(r.data.lastName)}</td><td>{nd(r.data.teamName)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {contracts.length > 0 && additive && (
        <section className="panel">
          <h2>Contrats déclarés (extrait)<GlossaryLink slug={slug} term={DONNEES_TERMS.extraits} /></h2>
          <div className="table-wrap scroll">
            <table className="data-table sticky">
              <thead><tr><th scope="col">Mois</th><th scope="col">SIRET</th><th scope="col">N° de contrat</th><th scope="col">Matricule</th><th scope="col">Début</th><th scope="col">Fin</th><th scope="col">Nature</th><th scope="col" className="num">Quotité contrat / référence</th></tr></thead>
              <tbody>
                {contracts.map((r) => {
                  const d = r.data as { contractNumber?: string; startDate?: string; endDate?: string | null; nature?: string | null; contractQuota?: number | null; referenceQuota?: number | null; siret?: string | null; personId?: string };
                  const person = dsnPeople.find((p) => p.data.personId === d.personId && p.period === r.period);
                  return (
                    <tr key={r.key}>
                      <td>{r.period ?? "n.d."}</td><td><code>{d.siret ?? "n.d."}</code></td><td><code>{d.contractNumber ?? "n.d."}</code></td>
                      <td>{nd(person?.data.employeeNumber)}</td><td>{nd(d.startDate)}</td><td>{d.endDate ? d.endDate : "ouvert"}</td><td>{nd(d.nature)}</td>
                      <td className="num">{d.contractQuota === null || d.contractQuota === undefined ? "n.d." : String(d.contractQuota).replace(".", ",")} / {d.referenceQuota === null || d.referenceQuota === undefined ? "n.d." : String(d.referenceQuota).replace(".", ",")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {contracts.length > 0 && !additive && (
        <section className="panel">
          <h2>Contrats (extrait)<GlossaryLink slug={slug} term={DONNEES_TERMS.extraits} /></h2>
          <div className="table-wrap scroll">
            <table className="data-table sticky">
              <thead><tr><th scope="col">Contrat</th><th scope="col">Collaborateur</th><th scope="col">Début</th><th scope="col">Fin</th><th scope="col">Statut</th><th scope="col">Nature DSN</th><th scope="col" className="num">Quotité (ETP contractuel)</th></tr></thead>
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
          <div className="dn-section-head">
            <h2>{fec ? "Écritures : totaux par mois et par compte (classes 6 et 7, comptes 421, 431, 437)" : "Journal comptable : totaux par mois et par compte"}</h2>
            <p className="desc">« — » : aucune ligne de ce côté du compte.{fec && " Autres classes non affichées."}<GlossaryLink slug={slug} term={DONNEES_TERMS.extraits} /></p>
          </div>
          <div className="table-wrap scroll">
            <table className="data-table sticky" data-testid="ledger-totals">
              <thead><tr><th scope="col">Mois</th><th scope="col">Compte</th><th scope="col">Libellé</th><th scope="col" className="num">Lignes</th><th scope="col" className="num">Débit</th><th scope="col" className="num">Crédit</th></tr></thead>
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
    </></MoneyText>
  );
}
