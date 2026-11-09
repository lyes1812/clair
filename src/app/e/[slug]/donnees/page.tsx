import "@/styles/donnees.css";
import { ArrowDown, ArrowRight, BookOpen, Check, Cloud, Files, UsersRound } from "lucide-react";
import { GlossaryLink } from "@/components/GlossaryLink";
import { DONNEES_TERMS } from "@/lib/glossary/donnees";
import { DATA_ITEM, STUDIO_RH_ITEMS } from "@/lib/nav";
import { dateTimeFmt, PROVIDER_LABELS } from "@/lib/connectors/labels";
import { activeSync, getConnection, lastSync, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { dsnCoverage, listDsnFiles } from "@/lib/dsn/import";
import { fecCoverage, listFecFiles } from "@/lib/fec/import";
import { resolveSource, SOURCE_MODE_LABELS, type SourceDomain, type SourceMode, type SourceResolution } from "@/lib/sources";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { chooseSource } from "./actions";
import { PageHead, Pill, primaryAction, syncTone, type SourceAction } from "./ui";

export const dynamic = "force-dynamic";

const SOURCES = [
  { id: "payfit", label: "PayFit", summary: "Collaborateurs, contrats, temps, absences, statut de paie et journal comptable." },
  { id: "pennylane", label: "Pennylane", summary: "Plan comptable et écritures des classes 6 et 7 et des comptes 421, 431, 437." },
] as const;

// Ce que chaque domaine demande pour devenir utilisable (texte de l'étape suivante).
const DOMAIN_WORDS: Record<SourceDomain, { api: string; files: string }> = {
  rh: { api: "PayFit", files: "des fichiers DSN" },
  accounting: { api: "Pennylane", files: "des fichiers FEC" },
};

type SyncRow = Awaited<ReturnType<typeof lastSync>>;

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
  const canWrite = hasAtLeast(workspace.role, "editor");
  const byId = Object.fromEntries(states.map((s) => [s.id, s]));
  // Dépôts additifs : « Appliquée » suffit, il n'y a pas de lecture « active » unique.
  const fileStatus = (status: string) => (status === "applied" ? "Appliquée" : SYNC_STATUS_LABELS[status as SyncStatus]);

  // Un aperçu en attente de validation (API ou fichiers) : seule exception signalée dans l'état du domaine.
  type Candidate = { label: string; row: SyncRow };
  const pendingOf = (api: Candidate, files: Candidate) => [api, files].find((c) => c.row?.status === "preview") ?? null;

  // Dernière ligne d'une carte de fichiers : date du dernier dépôt et son statut, ou n.d. avec la raison.
  const lastDeposit = (row: SyncRow) =>
    row ? (
      <>
        {dateTimeFmt.format(row.startedAt)} <Pill tone={syncTone(row.status)}>{fileStatus(row.status)}</Pill>
      </>
    ) : (
      <span className="nd">n.d. — aucun dépôt</span>
    );

  // Action principale de la carte, puis accès aux détails et à l'historique de la source.
  const cardFoot = (action: SourceAction, href: string, label: string) => (
    <div className="dn-card-foot">
      {action && (
        <a className="btn primary" href={`${href}#${action.anchor}`} aria-label={`${action.label} : ${label}`}>
          {action.label}
        </a>
      )}
      <a className="btn dn-manage" href={href} aria-label={`Gérer ${label}`}>
        Gérer {label}<ArrowRight size={15} aria-hidden="true" />
      </a>
    </div>
  );

  const retained = (chosen: boolean) => chosen ? (
    <span className="dn-retained"><Check size={13} aria-hidden="true" />Source retenue</span>
  ) : null;

  // Synthèse du domaine : source retenue, règle de choix et, au besoin, étape suivante.
  const sourceChoice = (domain: SourceDomain, r: SourceResolution, pending: Candidate | null) => {
    const w = DOMAIN_WORDS[domain];
    return (
      <section className="panel source-choice dn-choice" data-testid={`source-choice-${domain}`}>
        <div className="source-head">
          <div className="dn-choice-copy">
            <h3>Source retenue pour les modules<GlossaryLink slug={slug} term={DONNEES_TERMS.sourceRetenue} /></h3>
            <p data-testid={`source-chosen-${domain}`}>
              {r.chosen ? <strong>{PROVIDER_LABELS[r.chosen]}</strong> : <strong>n.d.</strong>} <span className="desc">— {r.reason}</span>
            </p>
            {pending ? (
              <p className="dn-next">
                Un aperçu attend une validation ({pending.label}). <a href={`/e/${slug}/donnees/synchro/${pending.row!.id}`}>Ouvrir l'aperçu</a>
              </p>
            ) : (
              !r.chosen && (
                <p className="dn-next">
                  <strong>À faire :</strong>{" "}
                  {isAdmin
                    ? `${r.mode === "api" ? `connectez ${w.api}` : r.mode === "files" ? `déposez ${w.files}` : `connectez ${w.api} ou déposez ${w.files}`}, puis appliquez l'aperçu.`
                    : `${r.mode === "api" ? `un administrateur connecte ${w.api}` : r.mode === "files" ? `un éditeur ou un administrateur dépose ${w.files}` : `un administrateur connecte ${w.api}, ou un éditeur dépose ${w.files}`}, puis l'aperçu est appliqué.`}
                </p>
              )
            )}
          </div>
          {isAdmin ? (
            <form action={chooseSource.bind(null, slug, domain)} className="inline-form dn-rule">
              <div className="field-row">
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
  };

  // Carte d'une source API : connexion, dernière lecture appliquée (une seule ligne), lecture plus récente seulement si elle diffère.
  const apiCard = ({ id, label, summary, conn, last, active }: (typeof states)[number], chosen: boolean) => (
    <section key={id} className="panel dn-card" data-testid={`source-${id}`} data-chosen={chosen ? "true" : undefined}>
      <div className="dn-card-head">
        <span className="dn-source-icon"><Cloud size={21} strokeWidth={1.7} aria-hidden="true" /></span>
        <div>
          <h3>{label} <span className="tag">API</span></h3>
          {retained(chosen)}
        </div>
      </div>
      <p className="desc dn-card-summary">{summary}</p>
      <dl className="facts dn-facts">
        <div>
          <dt>Connexion</dt>
          <dd data-testid={`${id}-connection`}>
            {conn ? (
              <span className="dn-conn">
                <Pill tone="applied">Vérifiée</Pill>
                {conn.companyName ? <span>{conn.companyName}</span> : <span className="nd">n.d. — nom de société non enregistré</span>}
              </span>
            ) : (
              <Pill>Non connectée</Pill>
            )}
          </dd>
        </div>
        <div>
          <dt>Dernière lecture</dt>
          <dd data-testid={`${id}-active`}>
            {active?.decidedAt ? (
              <>
                <Pill tone="applied">Appliquée</Pill>{` le ${dateTimeFmt.format(active.decidedAt)}`}
              </>
            ) : (
              <span className="nd">n.d. — aucune lecture appliquée</span>
            )}
          </dd>
        </div>
        {last && last.id !== active?.id && (
          <div>
            <dt>Lecture plus récente</dt>
            <dd>
              {dateTimeFmt.format(last.startedAt)} <Pill tone={syncTone(last.status)}>{SYNC_STATUS_LABELS[last.status as SyncStatus]}</Pill>
            </dd>
          </div>
        )}
      </dl>
      {cardFoot(primaryAction("api", { connected: Boolean(conn), isAdmin, canWrite }), `/e/${slug}/donnees/${id}`, label)}
    </section>
  );

  const dsnCard = (
    <section className="panel dn-card" data-testid="source-dsn" data-chosen={rhSource.chosen === "dsn" ? "true" : undefined}>
      <div className="dn-card-head">
        <span className="dn-source-icon"><Files size={21} strokeWidth={1.7} aria-hidden="true" /></span>
        <div>
          <h3>Fichiers DSN <span className="tag">Fichier</span></h3>
          {retained(rhSource.chosen === "dsn")}
        </div>
      </div>
      <p className="desc dn-card-summary">Déclarations mensuelles déposées fichier par fichier : individus, contrats, rémunérations, activités.</p>
      <dl className="facts dn-facts">
        <div>
          <dt>Fichiers conservés</dt>
          <dd data-testid="dsn-files-count">{dsnFiles.length === 0 ? "aucun" : dsnFiles.length}</dd>
        </div>
        <div>
          <dt>Dernier dépôt</dt>
          <dd>{lastDeposit(dsnLast)}</dd>
        </div>
        <div>
          <dt>Couverture</dt>
          <dd data-testid="dsn-coverage-summary">
            {coverage.length === 0 ? <span className="nd">n.d. — aucune déclaration appliquée</span> : `${complete} mois × établissement complet(s) sur ${coverage.length}`}
          </dd>
        </div>
      </dl>
      {cardFoot(primaryAction("files", { connected: true, isAdmin, canWrite }), `/e/${slug}/donnees/dsn`, "les fichiers DSN")}
    </section>
  );

  const fecCard = (
    <section className="panel dn-card" data-testid="source-fec" data-chosen={accountingSource.chosen === "fec" ? "true" : undefined}>
      <div className="dn-card-head">
        <span className="dn-source-icon"><Files size={21} strokeWidth={1.7} aria-hidden="true" /></span>
        <div>
          <h3>Fichiers FEC <span className="tag">Fichier</span></h3>
          {retained(accountingSource.chosen === "fec")}
        </div>
      </div>
      <p className="desc dn-card-summary">Fichier des écritures comptables, un par exercice : toutes les écritures, journaux et comptes.</p>
      <dl className="facts dn-facts">
        <div><dt>Fichiers conservés</dt><dd data-testid="fec-files-count">{fecFiles.length === 0 ? "aucun" : fecFiles.length}</dd></div>
        <div><dt>Dernier dépôt</dt><dd>{lastDeposit(fecLast)}</dd></div>
        <div>
          <dt>Exercices en vigueur</dt>
          <dd data-testid="fec-coverage-summary">
            {exercises.length === 0 ? <span className="nd">n.d. — aucun FEC appliqué</span> : exercises.map((e) => `${e.firstDate} → ${e.lastDate}`).join(" ; ")}
          </dd>
        </div>
      </dl>
      {cardFoot(primaryAction("files", { connected: true, isAdmin, canWrite }), `/e/${slug}/donnees/fec`, "les fichiers FEC")}
    </section>
  );

  return (
    <>
      <div className="dn-overview">
        <PageHead kicker="Sources de l'espace" title={DATA_ITEM.label}>
          <p className="desc">
            Connexions et fichiers, en lecture seule.<GlossaryLink slug={slug} term={DONNEES_TERMS.lecture} />
          </p>
        </PageHead>
        <nav className="dn-quick-nav" aria-label="Accès rapide aux sources">
          <a href="#domaine-rh"><UsersRound size={16} aria-hidden="true" />Ressources humaines<ArrowDown size={14} aria-hidden="true" /></a>
          <a href="#domaine-comptabilite"><BookOpen size={16} aria-hidden="true" />Comptabilité<ArrowDown size={14} aria-hidden="true" /></a>
        </nav>
      </div>

      <section className="dn-domain" id="domaine-rh" aria-labelledby="dn-rh-title">
        <div className="dn-section-head">
          <h2 id="dn-rh-title" className="group-title">Ressources humaines</h2>
        </div>
        {sourceChoice("rh", rhSource, pendingOf({ label: "PayFit", row: byId.payfit.last }, { label: PROVIDER_LABELS.dsn, row: dsnLast }))}
        <div className="dn-cards">
          {apiCard(byId.payfit, rhSource.chosen === "payfit")}
          {dsnCard}
        </div>
      </section>

      <section className="dn-domain" id="domaine-comptabilite" aria-labelledby="dn-acc-title">
        <div className="dn-section-head">
          <h2 id="dn-acc-title" className="group-title">Comptabilité</h2>
        </div>
        {sourceChoice("accounting", accountingSource, pendingOf({ label: "Pennylane", row: byId.pennylane.last }, { label: PROVIDER_LABELS.fec, row: fecLast }))}
        <div className="dn-cards">
          {apiCard(byId.pennylane, accountingSource.chosen === "pennylane")}
          {fecCard}
        </div>
      </section>

      <nav className="dn-studio" aria-label="Aller au Studio RH">
        <span className="label">Studio RH</span>
        <ul>
          {STUDIO_RH_ITEMS.map((item) => (
            <li key={item.path}><a href={`/e/${slug}/${item.path}`}>{item.label}</a></li>
          ))}
        </ul>
      </nav>
    </>
  );
}
