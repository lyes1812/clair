import "@/styles/donnees.css";
import { Banknote, FileText, Gauge, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import { DATA_ITEM, STUDIO_RH_ITEMS } from "@/lib/nav";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { activeSync, getConnection, lastSync, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import { dsnCoverage, listDsnFiles } from "@/lib/dsn/import";
import { fecCoverage, listFecFiles } from "@/lib/fec/import";
import { PROVIDER_LABELS } from "@/lib/connectors/labels";
import { DOMAINS, resolveSource, SOURCE_MODE_LABELS, type SourceDomain, type SourceMode, type SourceResolution } from "@/lib/sources";
import { chooseSource } from "./actions";
import { PageHead, Pill, syncTone } from "./ui";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const SOURCES = [
  { id: "payfit", label: "PayFit", summary: "Collaborateurs, contrats, temps, absences, statut de paie et journal comptable." },
  { id: "pennylane", label: "Pennylane", summary: "Plan comptable et écritures des classes 6 et 7 et des comptes 421, 431, 437." },
] as const;

// Accès aux cinq familles du Studio RH (organisation figée). Textes : ce que l'écran fait aujourd'hui, rien de plus.
const FAMILY_ICONS: Record<string, LucideIcon> = {
  "studio-rh/collaborateurs": Users,
  "studio-rh/kpi": Gauge,
  "studio-rh/masse-salariale": Banknote,
  "studio-rh/hypotheses": SlidersHorizontal,
  "studio-rh/reporting-social": FileText,
};
const FAMILY_NOTES: Record<string, string> = {
  "studio-rh/collaborateurs": "Fiches individuelles, listes mensuelle et annuelle, entrées et sorties datées.",
  "studio-rh/kpi": "ETP, effectif moyen, turnover et absentéisme, avec leurs définitions.",
  "studio-rh/masse-salariale": "Brut, charges et coût chargé, rapprochés des comptes de paie.",
  "studio-rh/hypotheses": "Hypothèses datées, scénarios et projection traçable de la masse salariale.",
  "studio-rh/reporting-social": "Index égalité FH et BDESE : entrées prévues, pas encore construites.",
};

// Ce que chaque domaine demande pour devenir utilisable (texte de l'étape suivante).
const DOMAIN_WORDS: Record<SourceDomain, { api: string; files: string; anchor: string }> = {
  rh: { api: "PayFit", files: "des fichiers DSN", anchor: "domaine-rh" },
  accounting: { api: "Pennylane", files: "des fichiers FEC", anchor: "domaine-comptabilite" },
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
  const byId = Object.fromEntries(states.map((s) => [s.id, s]));
  // Dépôts additifs : « Appliquée » suffit, il n'y a pas de lecture « active » unique.
  const fileStatus = (status: string) => (status === "applied" ? "Appliquée" : SYNC_STATUS_LABELS[status as SyncStatus]);
  const lastRead = (row: SyncRow, label: (s: string) => string) =>
    row ? (
      <>
        {dateTimeFmt.format(row.startedAt)} <Pill tone={syncTone(row.status)}>{label(row.status)}</Pill>
      </>
    ) : (
      <span className="nd">n.d. — aucune lecture</span>
    );

  // « Où en suis-je » : une tuile par domaine (source retenue, dernière lecture, étape suivante).
  const domainTile = (domain: SourceDomain, r: SourceResolution, apiLast: SyncRow, filesLast: SyncRow) => {
    const w = DOMAIN_WORDS[domain];
    const candidates = [
      { label: w.api, row: apiLast, status: (s: string) => SYNC_STATUS_LABELS[s as SyncStatus] },
      { label: PROVIDER_LABELS[DOMAINS[domain].files], row: filesLast, status: fileStatus },
    ];
    const pending = candidates.find((c) => c.row?.status === "preview");
    const latest = candidates.filter((c) => c.row).sort((a, b) => b.row!.startedAt.getTime() - a.row!.startedAt.getTime())[0];
    return (
      <li key={domain} className="dn-tile" data-testid={`dn-tile-${domain}`}>
        <span className="label">{DOMAINS[domain].label}</span>
        <p className={r.chosen ? "dn-tile-main" : "dn-tile-main nd"}>{r.chosen ? PROVIDER_LABELS[r.chosen] : "n.d."}</p>
        <p className="desc">
          {r.chosen ? `Source retenue${r.appliedAt ? ` — lecture appliquée le ${dateTimeFmt.format(r.appliedAt)}` : ""}.` : r.reason}
        </p>
        <p className="dn-tile-last">
          <span className="desc">Dernière lecture</span>
          <span>
            {latest ? (
              <>
                {latest.label} · {dateTimeFmt.format(latest.row!.startedAt)} <Pill tone={syncTone(latest.row!.status)}>{latest.status(latest.row!.status)}</Pill>
              </>
            ) : (
              <span className="nd">n.d. — aucune lecture</span>
            )}
          </span>
        </p>
        <p className="dn-tile-next">
          {pending ? (
            <>
              <strong>À faire :</strong> un aperçu attend une validation ({pending.label}).{" "}
              <a href={`/e/${slug}/donnees/synchro/${pending.row!.id}`}>Ouvrir l'aperçu</a>
            </>
          ) : r.chosen ? (
            <>
              <strong>Prêt :</strong> une lecture est appliquée, les écrans du Studio RH qui dépendent de ce domaine l'utilisent.
            </>
          ) : (
            <>
              <strong>À faire :</strong>{" "}
              {isAdmin
                ? `${r.mode === "api" ? `connectez ${w.api}` : r.mode === "files" ? `déposez ${w.files}` : `connectez ${w.api} ou déposez ${w.files}`}, puis appliquez l'aperçu.`
                : `${r.mode === "api" ? `un administrateur connecte ${w.api}` : r.mode === "files" ? `un éditeur ou un administrateur dépose ${w.files}` : `un administrateur connecte ${w.api}, ou un éditeur dépose ${w.files}`}, puis l'aperçu est appliqué.`}{" "}
              <a href={`#${w.anchor}`}>Voir les sources</a>
            </>
          )}
        </p>
      </li>
    );
  };

  const sourceChoice = (domain: SourceDomain, r: SourceResolution) => (
    <section className="panel source-choice dn-choice" data-testid={`source-choice-${domain}`}>
      <div className="source-head">
        <div>
          <h3>Source retenue pour les modules</h3>
          <p data-testid={`source-chosen-${domain}`}>
            {r.chosen ? <strong>{PROVIDER_LABELS[r.chosen]}</strong> : <strong>n.d.</strong>} <span className="desc">— {r.reason}</span>
          </p>
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

  const apiCard = ({ id, label, summary, conn, last, active }: (typeof states)[number], chosen: boolean) => (
    <section key={id} className="panel dn-card" data-testid={`source-${id}`}>
      <div className="dn-card-head">
        <div>
          <h3>{label} <span className="tag">API</span></h3>
          <p className="desc">{summary}</p>
        </div>
        {chosen && <Pill tone="applied">Source retenue</Pill>}
      </div>
      <dl className="facts dn-facts">
        <div>
          <dt>Connexion</dt>
          <dd data-testid={`${id}-connection`}>
            {conn ? (
              <>
                <Pill tone="applied">Vérifiée</Pill>{` — ${conn.companyName ?? "société"}`}
              </>
            ) : (
              <Pill>Non connectée</Pill>
            )}
          </dd>
        </div>
        <div><dt>Dernière lecture</dt><dd>{lastRead(last, (s) => SYNC_STATUS_LABELS[s as SyncStatus])}</dd></div>
        <div>
          <dt>Source active</dt>
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
      </dl>
      <div className="dn-card-foot">
        <a className="btn" href={`/e/${slug}/donnees/${id}`} aria-label={`Gérer ${label}`}>Gérer</a>
      </div>
    </section>
  );

  const dsnCard = (
    <section className="panel dn-card" data-testid="source-dsn">
      <div className="dn-card-head">
        <div>
          <h3>Fichiers DSN <span className="tag">Fichier</span></h3>
          <p className="desc">Déclarations mensuelles déposées fichier par fichier : individus, contrats, rémunérations, activités.</p>
        </div>
        {rhSource.chosen === "dsn" && <Pill tone="applied">Source retenue</Pill>}
      </div>
      <dl className="facts dn-facts">
        <div>
          <dt>Fichiers conservés</dt>
          <dd data-testid="dsn-files-count">{dsnFiles.length === 0 ? "aucun" : dsnFiles.length}</dd>
        </div>
        <div>
          <dt>Dernier dépôt</dt>
          <dd>{lastRead(dsnLast, fileStatus)}</dd>
        </div>
        <div>
          <dt>Couverture</dt>
          <dd data-testid="dsn-coverage-summary">
            {coverage.length === 0 ? "n.d. — aucune déclaration appliquée" : `${complete} mois × établissement complet(s) sur ${coverage.length}`}
          </dd>
        </div>
      </dl>
      <div className="dn-card-foot">
        <a className="btn" href={`/e/${slug}/donnees/dsn`} aria-label="Gérer les fichiers DSN">Gérer</a>
      </div>
    </section>
  );

  const fecCard = (
    <section className="panel dn-card" data-testid="source-fec">
      <div className="dn-card-head">
        <div>
          <h3>Fichiers FEC <span className="tag">Fichier</span></h3>
          <p className="desc">Fichier des écritures comptables, un par exercice : toutes les écritures, journaux et comptes.</p>
        </div>
        {accountingSource.chosen === "fec" && <Pill tone="applied">Source retenue</Pill>}
      </div>
      <dl className="facts dn-facts">
        <div><dt>Fichiers conservés</dt><dd data-testid="fec-files-count">{fecFiles.length === 0 ? "aucun" : fecFiles.length}</dd></div>
        <div><dt>Dernier dépôt</dt><dd>{lastRead(fecLast, fileStatus)}</dd></div>
        <div>
          <dt>Exercices en vigueur</dt>
          <dd data-testid="fec-coverage-summary">{exercises.length === 0 ? "n.d. — aucun FEC appliqué" : exercises.map((e) => `${e.firstDate} → ${e.lastDate}`).join(" ; ")}</dd>
        </div>
      </dl>
      <div className="dn-card-foot">
        <a className="btn" href={`/e/${slug}/donnees/fec`} aria-label="Gérer les fichiers FEC">Gérer</a>
      </div>
    </section>
  );

  return (
    <>
      <PageHead kicker="Données" title={DATA_ITEM.label}>
        <p className="desc">Toutes les sources de l'espace, lues à la demande, en lecture seule. Chaque lecture passe par un aperçu avant d'être appliquée.</p>
      </PageHead>

      <section className="panel dn-overview" aria-labelledby="dn-where" data-testid="dn-overview">
        <div className="dn-section-head">
          <h2 id="dn-where">Où en suis-je</h2>
          <p className="desc">État des sources à l'instant de l'affichage. Rien n'est lu tant que vous ne lancez pas une synchronisation.</p>
        </div>
        <ul className="dn-tiles">
          {domainTile("rh", rhSource, byId.payfit.last, dsnLast)}
          {domainTile("accounting", accountingSource, byId.pennylane.last, fecLast)}
        </ul>
        <div className="dn-section-head">
          <h3>Poursuivre dans le Studio RH</h3>
        </div>
        <ul className="dn-families" data-testid="dn-families">
          {STUDIO_RH_ITEMS.map((item) => {
            const Icon = FAMILY_ICONS[item.path];
            return (
              <li key={item.path}>
                <a className="dn-family" href={`/e/${slug}/${item.path}`}>
                  <span className="dn-family-title">
                    {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
                    {item.label}
                    {item.path === "studio-rh/reporting-social" && <span className="tag">Prévu</span>}
                  </span>
                  <span className="desc">{FAMILY_NOTES[item.path] ?? item.summary}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="dn-domain" id="domaine-rh" aria-labelledby="dn-rh-title">
        <div className="dn-section-head">
          <h2 id="dn-rh-title" className="group-title">Ressources humaines</h2>
          <p className="desc">Par l'API PayFit, ou par les DSN que PayFit génère.</p>
        </div>
        {sourceChoice("rh", rhSource)}
        <div className="dn-cards">
          {apiCard(byId.payfit, rhSource.chosen === "payfit")}
          {dsnCard}
        </div>
      </section>

      <section className="dn-domain" id="domaine-comptabilite" aria-labelledby="dn-acc-title">
        <div className="dn-section-head">
          <h2 id="dn-acc-title" className="group-title">Comptabilité</h2>
          <p className="desc">Par l'API Pennylane, ou par le FEC que Pennylane génère.</p>
        </div>
        {sourceChoice("accounting", accountingSource)}
        <div className="dn-cards">
          {apiCard(byId.pennylane, accountingSource.chosen === "pennylane")}
          {fecCard}
        </div>
      </section>
    </>
  );
}
