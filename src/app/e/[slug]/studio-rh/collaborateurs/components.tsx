import { FamilyTabs } from "@/components/FamilyTabs";
import type { ReactNode } from "react";
import { SourceBadge } from "@/components/SourceBadge";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate, formatMonth } from "@/lib/dates";
import { contractNatureLabel, endReasonLabel } from "@/lib/dsn/labels";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { RH_DEFINITIONS } from "@/lib/rh/definitions";
import { findingLabel } from "@/lib/rh/findings";
import type { EventRow, RowState } from "@/lib/rh/headcount";
import { fieldView, type ContractDraft, type FieldView, type FindingDraft, type PersonDraft, type Provenance, type Traced as TracedRow } from "@/lib/rh/referential/types";
import { EVENT_FLAG_LABELS, personLabel, type CollabContext, type Shown } from "@/lib/rh/view";
import { PAGE_SIZES } from "@/lib/viz/collaborateurs";

// Composants partagés des écrans Collaborateurs : en-tête (source, base de calcul, définitions), valeurs tracées, constats.
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/collaborateurs")!;
import { TABS, type TabId } from "./tabs";
export { TABS, type TabId };

export const base = (slug: string) => `/e/${slug}/studio-rh/collaborateurs`;
export const personHref = (slug: string, key: string) => `${base(slug)}/p/${encodeURIComponent(key)}`;
export const contractHref = (slug: string, key: string) => `${base(slug)}/c/${encodeURIComponent(key)}`;

const ND_EXPLANATIONS: [string, string][] = [
  ["Période postérieure à la date de référence", "l'effectif n'est jamais projeté ; les entrées et sorties futures connues sont listées dans Mouvements › À venir."],
  ["Période non couverte", "aucune lecture ni déclaration appliquée pour ce mois : rien n'est reconstitué entre deux mois."],
  ["Mois DSN incomplet ou bloqué", "fractions manquantes ou conflit de numéro d'ordre : les faits sont lus, l'effectif du mois est n.d."],
  ["Borne basse (PayFit)", "historique PayFit en mode « signalé » (Paramètres) : mois antérieurs à la fenêtre de conservation des contrats archivés en « ≥ n », sorties inconnues. En mode « brut » (défaut), ces mois sont calculés sur ce que l'API renvoie et la limite est dite une fois en tête d'écran."],
  ["Champ non porté par la source", "motif de fin et temps travaillé (DSN), nom d'usage, équipe ou versements (PayFit) : n.d. et non devinés."],
  ["Champ non renseigné", "valeur nulle dans la source (temps, matricule, nature) : n.d., jamais zéro."],
  ["Droit non accordé", "collection ou champ refusé par la clé API : n.d. avec le droit manquant."],
];

// Mode « brut » de l'historique PayFit : une seule mention en tête d'écran à la place des « ≥ » et « n.d. » par mois.
export function PayfitHistoryNotice({ ctx }: { ctx: CollabContext }) {
  const h = ctx.payfitHistory;
  const d = ctx.data;
  if (!h || h.mode !== "raw" || !d) return null;
  return (
    <p className="notice" data-testid="payfit-history-notice">
      Données telles que remontées par l'API PayFit (lecture du {formatDate(d.build.referenceDate)}).{" "}
      {h.limit ? (
        <>
          PayFit ne renvoie plus les contrats archivés depuis plus de 12 mois : pour les mois {(h.limit.lowerFrom === h.limit.lowerTo ? formatMonth(h.limit.lowerFrom) : `${formatMonth(h.limit.lowerFrom)} à ${formatMonth(h.limit.lowerTo)}`).toLowerCase()}
          {h.limit.exactFrom ? ` (avant le ${formatDate(h.limit.exactFrom)})` : ""}, les chiffres ne comptent pas les salariés sortis avant cette
          limite : les effectifs, l'ETP et les sorties peuvent être sous-estimés ; les entrées, le turnover et l'absentéisme peuvent être faussés dans un sens ou dans l'autre (un contrat qui fait suite à un contrat non renvoyé compte comme une entrée, et les dénominateurs sont réduits).
        </>
      ) : (
        <>Aucun mois de la lecture n'est antérieur à la limite de conservation des contrats archivés.</>
      )}{" "}
      <a href={`/e/${ctx.slug}/parametres#payfit-historique`}>Paramètre : historique PayFit brut</a>
    </p>
  );
}

export function BuildInfo({ ctx }: { ctx: CollabContext }) {
  const d = ctx.data;
  if (!d) return null;
  const b = d.build;
  const parts: string[] = [];
  if (b.inputs.source === "payfit") {
    parts.push(`Lecture appliquée le ${ctx.source.appliedAt ? dateTimeFmt.format(ctx.source.appliedAt) : "n.d."}`);
    parts.push(`date de référence ${formatDate(b.referenceDate)}`);
    parts.push(`mois lus ${b.inputs.scopeMonths.length ? `${b.inputs.scopeMonths[0]} → ${b.inputs.scopeMonths[b.inputs.scopeMonths.length - 1]}` : "aucun"}`);
    parts.push(`société PayFit : ${b.inputs.company?.name ?? "n.d."} (une société par espace)`);
  } else {
    const n = b.inputs.syncs.length;
    const last = b.inputs.syncs.map((s) => s.decidedAt).filter((x): x is string => !!x).sort().pop();
    parts.push(`${n} dépôt${n > 1 ? "s" : ""} appliqué${n > 1 ? "s" : ""}${last ? `, dernier le ${dateTimeFmt.format(new Date(last))}` : ""}`);
    const sirets = [...new Set(d.coverage.map((c) => c.establishmentId))].sort();
    parts.push(b.presenceFrom ? `couverture complète ${b.presenceFrom} → ${b.presenceTo} (SIRET ${sirets.join(", ")})` : "aucun mois complet");
    const nd = d.coverage.filter((c) => c.presenceStatus !== "complete").map((c) => c.month);
    if (nd.length) parts.push(`mois n.d. : ${[...new Set(nd)].sort().join(", ")}`);
  }
  parts.push(`référentiel reconstruit le ${dateTimeFmt.format(b.builtAt)} (empreinte ${b.inputsHash.slice(0, 8)})`);
  return <p className="desc" data-testid="rh-build-info">{parts.join(" · ")}</p>;
}

export function CollabHeader({ ctx, tab, children }: { ctx: CollabContext; tab: TabId | null; children?: ReactNode }) {
  const { slug, source, state } = ctx;
  return (
    <>
      <div className="collab-head">
        <span className="label">Studio RH</span>
        <h1>{ITEM.label}</h1>
        <p className="desc">{ITEM.summary}</p>
        <SourceBadge resolution={source} slug={slug} />
        {ctx.data && (
          <details className="collab-read-details" data-testid="collab-read-details">
            <summary>Détail de la lecture{ctx.data.build.referenceDate ? ` · date de référence ${formatDate(ctx.data.build.referenceDate)}` : ""}</summary>
            <BuildInfo ctx={ctx} />
          </details>
        )}
        <PayfitHistoryNotice ctx={ctx} />
        {ctx.switchedAt && (
          <p className="notice" data-testid="source-switch-notice">
            Source RH changée le {dateTimeFmt.format(ctx.switchedAt)} par un administrateur ({source.reason}). Les identifiants PayFit et DSN sont distincts : aucun lien n'est conservé entre les deux référentiels.
          </p>
        )}
      </div>
      {!source.chosen && (
        <section className="placeholder" data-testid="collaborateurs-nd">
          <h3>n.d. — aucune source RH retenue</h3>
          <p className="muted">
            Connectez PayFit ou déposez des DSN dans <a href={`/e/${slug}/donnees`}>Données</a>, appliquez une lecture, puis revenez ici.
          </p>
        </section>
      )}
      {state?.kind === "unavailable" && (
        <section className="placeholder" data-testid="collaborateurs-unavailable">
          <h3>n.d. — référentiel indisponible</h3>
          <p className="muted">{state.reason}. Corrigez la clé dans <a href={`/e/${slug}/donnees`}>Données</a> et relancez une lecture.</p>
        </section>
      )}
      {ctx.data && tab && (
        <FamilyTabs label="Entrées Collaborateurs" testid="collab-tabs" current={tab} tabs={TABS.map((t) => ({ key: t.id, label: t.label, href: `${base(slug)}${t.path}`, soon: "soon" in t ? t.soon : false }))} />
      )}
      {children}
      {ctx.data && <Definitions ctx={ctx} />}
    </>
  );
}

export function Definitions({ ctx }: { ctx: CollabContext }) {
  return (
    <details className="panel" data-testid="rh-definitions" id="definitions">
      <summary>Définitions, paramètres et raisons des « n.d. »</summary>
      <dl className="defs">
        {RH_DEFINITIONS.map((d) => (
          <div key={d.id} id={`def-${d.id}`}>
            <dt>{d.title}</dt>
            <dd>{d.text}</dd>
          </div>
        ))}
        <div id="def-natures">
          <dt>Natures comptées dans l'effectif (paramètre de l'espace)</dt>
          <dd data-testid="rh-natures">
            {ctx.natures.codes.map((c) => contractNatureLabel(c)).join(", ")} — {ctx.natures.origin === "default" ? "valeur par défaut validée" : "modifié par un administrateur"} ·{" "}
            <a href={`/e/${ctx.slug}/parametres`}>Paramètres</a>
          </dd>
        </div>
      </dl>
      <h3>Ce qui est « n.d. » et pourquoi</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Cas</th><th className="wrap">Règle</th></tr></thead>
          <tbody>
            {ND_EXPLANATIONS.map(([k, v]) => (
              <tr key={k}><td>{k}</td><td className="wrap">{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function Prov({ p, slug }: { p: Provenance | null | undefined; slug: string }) {
  if (!p) return null;
  return (
    <a className="prov" href={`/e/${slug}/donnees/synchro/${p.syncId}`} title={p.label}>{p.label}</a>
  );
}

// Valeur tracée : la valeur et sa provenance, ou « n.d. — raison ».
export function Traced<T>({ view, slug, format, prov = true }: { view: FieldView<T>; slug: string; format?: (v: T) => ReactNode; prov?: boolean }) {
  if (view.nd !== null) return <span className="nd" title={view.nd.code}>n.d. — {view.nd.reason}</span>;
  return (
    <>
      <span>{format ? format(view.value) : String(view.value)}</span>
      {prov && view.provenance && <> <Prov p={view.provenance} slug={slug} /></>}
    </>
  );
}

export function Field<T>({ row, field, value, slug, format, prov }: { row: TracedRow; field: string; value: T | null | undefined; slug: string; format?: (v: T) => ReactNode; prov?: boolean }) {
  return <Traced view={fieldView(row, field, value)} slug={slug} format={format} prov={prov} />;
}

// Tuile d'indicateur : la valeur courte est écrite en grand, une raison (n.d.) ou un texte long en texte courant.
export function Tile({ id, label, shown, def }: { id: string; label: string; shown: Shown; def: string }) {
  const big = shown.kind !== "nd" && shown.text.length <= 12;
  const cls = [shown.kind === "nd" ? "nd" : shown.kind === "lower" ? "lower" : "", big ? "big" : ""].filter(Boolean).join(" ");
  return (
    <div data-testid={id} className="collab-tile">
      <dt>{label}</dt>
      <dd className={cls || undefined}>{shown.text}</dd>
      <span className="tile-foot">
        {shown.foot ? <>{shown.foot} · </> : null}
        <a href={`#def-${def}`}>Définition</a>
      </span>
    </div>
  );
}

// Section repliable (ouverte par défaut) : le titre reste visible, le contenu se replie. `data-fold` permet « Tout replier ».
export function Fold({ title, count, open = true, sub = false, testid, children }: { title: ReactNode; count?: number; open?: boolean; sub?: boolean; testid?: string; children: ReactNode }) {
  return (
    <details className={sub ? "collab-fold sub" : "collab-fold"} open={open} data-fold="" data-testid={testid}>
      <summary>
        <h3>{title}{count !== undefined && <span className="desc"> ({count})</span>}</h3>
      </summary>
      <div className="collab-fold-body">{children}</div>
    </details>
  );
}

// Pastilles d'état : le libellé est celui du moteur (« entré le 01/04/2025 »), la couleur le renforce sans le remplacer.
const STATE_CLASS: Record<RowState["code"], string> = {
  present: "s-present",
  entered: "s-entered",
  entered_exited: "s-entered",
  exited: "s-exited",
  declared_after_end: "s-alert",
  before_start: "s-alert",
  not_declared: "",
  absent: "",
  out_of_scope: "",
};
export function StatePill({ code, label }: { code: RowState["code"]; label: string }) {
  return <span className={`collab-pill ${STATE_CLASS[code]}`.trim()}>{label}</span>;
}
export function YesNoPill({ yes, title }: { yes: boolean; title?: string }) {
  return <span className={yes ? "collab-pill s-present" : "collab-pill"} title={title}>{yes ? "oui" : "non"}</span>;
}

// Paramètres d'adresse conservés par un formulaire GET qui ne les montre pas (filtres de l'autre barre, taille de page).
export function HiddenParams({ values }: { values: Record<string, string | undefined> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
    </>
  );
}

// Barre d'outils au-dessus d'un tableau : recherche sur toutes les colonnes, filtres du tableau (children), lignes par page.
// Un formulaire GET : l'état est dans l'adresse (lien partageable) ; valider revient à la première page.
export function ListToolbar({ testid, label, hidden, q, size, resetHref, submitLabel = "Appliquer", children }: { testid: string; label: string; hidden: Record<string, string | undefined>; q: string; size: number; resetHref: string | null; submitLabel?: string; children?: ReactNode }) {
  return (
    <form method="get" className="filters collab-toolbar" data-testid={testid} aria-label={label}>
      <HiddenParams values={hidden} />
      <div className="field-row collab-search">
        <label htmlFor="q">Rechercher dans toutes les colonnes</label>
        <input className="input" id="q" name="q" type="search" defaultValue={q} maxLength={80} placeholder="nom, matricule, contrat, nature, date…" />
      </div>
      {children}
      <div className="field-row collab-size">
        <label htmlFor="taille">Lignes par page</label>
        <select className="select" id="taille" name="taille" defaultValue={String(size)}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <button className="btn" type="submit">{submitLabel}</button>
      {resetHref && <a className="collab-reset" href={resetHref}>Réinitialiser</a>}
    </form>
  );
}

export function PersonCell({ person, contract, slug }: { person: PersonDraft | null; contract: ContractDraft; slug: string }) {
  if (!person) {
    return (
      <span>
        <span className="nd">n.d. — {contract.fieldsNd.personKey?.reason ?? "contrat sans collaborateur"}</span>{" "}
        <a href={contractHref(slug, contract.contractKey)}>fiche contrat</a>
      </span>
    );
  }
  const label = personLabel(person);
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <a href={personHref(slug, person.personKey)}>{label ?? <span className="nd">n.d. — {person.fieldsNd.familyName?.reason ?? "nom absent"}</span>}</a> <ShortId id={person.externalId} />
    </span>
  );
}

// Identifiant de source : affiché en entier s'il est lisible, tronqué (avec la valeur complète au survol) si c'est une empreinte.
export function ShortId({ id }: { id: string }) {
  return id.length > 24 ? <code title={id}>{id.slice(0, 8)}…</code> : <code>{id}</code>;
}

export function Nature({ code }: { code: string | null }) {
  return code === null ? <span className="nd">nature : n.d.</span> : <span>{contractNatureLabel(code)}</span>;
}

// Texte de la colonne « Fin » (mêmes mots que EndCell, sans balisage ni provenance) : sert à la recherche sur toutes les colonnes.
export function endText(c: ContractDraft): string {
  if (c.endDate) return `${formatDate(c.endDate)} ${c.endReason ? endReasonLabel(c.endReason) : `motif : n.d. — ${c.fieldsNd.endReason?.reason ?? "non renseigné"}`}`;
  if (c.endStatus === "none_cdi") return "sans terme (CDI)";
  return `n.d. — ${c.fieldsNd.endDate?.reason ?? (c.endStatus === "unpositioned" ? "contrat non positionnable" : "fin non renseignée")}`;
}

export function EndCell({ c, slug, prov = true }: { c: ContractDraft; slug: string; prov?: boolean }) {
  if (c.endDate) {
    return (
      <span>
        {formatDate(c.endDate)}{prov && <> <Prov p={c.provenance.endDate} slug={slug} /></>}
        {c.endReason ? <> · {endReasonLabel(c.endReason)}</> : <> · <span className="nd">motif : n.d. — {c.fieldsNd.endReason?.reason ?? "non renseigné"}</span></>}
      </span>
    );
  }
  if (c.endStatus === "none_cdi") return <span>sans terme (CDI)</span>;
  return <span className="nd">n.d. — {c.fieldsNd.endDate?.reason ?? (c.endStatus === "unpositioned" ? "contrat non positionnable" : "fin non renseignée")}</span>;
}

export function FlagTags({ flags, labels }: { flags: readonly string[]; labels: Record<string, string> }) {
  if (!flags.length) return <span className="muted">—</span>;
  return <>{flags.map((f) => <span key={f} className="tag" style={{ marginRight: 4 }}>{labels[f] ?? f}</span>)}</>;
}

export function ProvenanceDetails({ row, slug }: { row: TracedRow; slug: string }) {
  const entries = Object.entries(row.provenance);
  const missing = Object.entries(row.fieldsNd);
  if (!entries.length && !missing.length) return <span className="muted">—</span>;
  return (
    <details>
      <summary>Provenance ({entries.length})</summary>
      <ul>
        {entries.map(([field, p]) => (
          <li key={field}>{field} → <Prov p={p} slug={slug} /></li>
        ))}
        {missing.map(([field, nd]) => (
          <li key={`nd-${field}`}>{field} → <span className="nd">n.d. — {nd.reason}</span></li>
        ))}
      </ul>
    </details>
  );
}

export function FindingList({ findings, slug, persons, contracts, testId }: { findings: FindingDraft[]; slug: string; persons: Map<string, PersonDraft>; contracts: Map<string, ContractDraft>; testId?: string }) {
  if (!findings.length) return <p className="muted">Aucun constat.</p>;
  return (
    <ul className="finding-list" data-testid={testId}>
      {findings.map((f, i) => (
        <li key={`${f.code}-${i}`}>
          <span className={`finding ${f.severity}`}>{findingLabel(f.code)}</span>
          <span>{f.message}</span>
          {f.month && <span className="tag">{f.month}</span>}
          {f.personKeys.map((k) => (
            <a key={k} href={personHref(slug, k)}>{personLabel(persons.get(k)) ?? persons.get(k)?.externalId ?? k}</a>
          ))}
          {f.contractKeys.map((k) => (
            <a key={k} href={contractHref(slug, k)}><code>{contracts.get(k)?.externalId ?? k}</code></a>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function EventsTable({ rows, slug, kind, testId, source }: { rows: EventRow[]; slug: string; kind: "entry" | "exit"; testId: string; source: "payfit" | "dsn" }) {
  if (!rows.length) return <p className="muted" data-testid={`${testId}-empty`}>Aucune {kind === "entry" ? "entrée" : "sortie"} sur la période.</p>;
  return (
    <div className="table-wrap scroll collab-scroll">
      <table className="data-table sticky collab-table" data-testid={testId}>
        <caption className="collab-sr">{kind === "entry" ? "Entrées" : "Sorties"} datées, une ligne par contrat</caption>
        <thead>
          <tr>
            <th scope="col">Date</th><th scope="col">Personne</th><th scope="col">Contrat</th><th scope="col">Établissement</th><th scope="col">Nature</th>
            {kind === "exit" && <th scope="col" className="wrap">Motif</th>}
            <th scope="col">Effectif</th><th scope="col">Drapeaux</th><th scope="col">Provenance de la date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.event.contractKey}-${r.event.kind}`}>
              <td className="col-date">{formatDate(r.event.date)}</td>
              <td><PersonCell person={r.person} contract={r.contract} slug={slug} /></td>
              <td><a href={contractHref(slug, r.contract.contractKey)}><code>{r.contract.externalId}</code></a></td>
              <td><code>{r.event.establishmentId ?? "n.d."}</code></td>
              <td><Nature code={r.event.nature} /></td>
              {kind === "exit" && (
                <td className="col-wide">
                  {r.event.endReason ? endReasonLabel(r.event.endReason) : <span className="nd">n.d. — {r.event.fieldsNd.endReason?.reason ?? (source === "payfit" ? "PayFit n'expose pas le motif" : "motif absent")}</span>}
                </td>
              )}
              <td>{r.inScope ? <span className="collab-pill s-counted">compté</span> : <span className="collab-pill">hors effectif</span>}</td>
              <td><FlagTags flags={r.event.flags} labels={EVENT_FLAG_LABELS} /></td>
              <td><Prov p={r.event.provenance.date} slug={slug} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MonthSelect({ name, id, label, months, value, nd }: { name: string; id: string; label: string; months: string[]; value: string; nd: Set<string> }) {
  const options = months.includes(value) ? months : [value, ...months];
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <select className="select" id={id} name={name} defaultValue={value}>
        {options.map((m) => (
          <option key={m} value={m}>{m}{nd.has(m) ? " — n.d." : ""}</option>
        ))}
      </select>
    </div>
  );
}
