import { FamilyTabs } from "@/components/FamilyTabs";
import type { ReactNode } from "react";
import { GlossaryLink } from "@/components/GlossaryLink";
import { SourceBadge } from "@/components/SourceBadge";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate, formatMonth, monthsBetween } from "@/lib/dates";
import { contractNatureLabel, endReasonLabel } from "@/lib/dsn/labels";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { findingLabel } from "@/lib/rh/findings";
import type { EventRow, RowState } from "@/lib/rh/headcount";
import { fieldView, type ContractDraft, type FieldView, type FindingDraft, type PersonDraft, type Provenance, type Traced as TracedRow } from "@/lib/rh/referential/types";
import { EVENT_FLAG_LABELS, personLabel, type CollabContext, type Shown } from "@/lib/rh/view";
import { atLeast, clearMonths, monthRangeLabel, PAGE_SIZES, tileFoot } from "@/lib/viz/collaborateurs";

// Composants partagés des écrans Collaborateurs : en-tête (source, limites de la lecture), valeurs tracées, constats. Les définitions sont au glossaire.
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/collaborateurs")!;
import { TABS, type TabId } from "./tabs";
export { TABS, type TabId };

export const base = (slug: string) => `/e/${slug}/studio-rh/collaborateurs`;
export const personHref = (slug: string, key: string) => `${base(slug)}/p/${encodeURIComponent(key)}`;
export const contractHref = (slug: string, key: string) => `${base(slug)}/c/${encodeURIComponent(key)}`;

// Mode « brut » de l'historique PayFit : une seule mention en tête d'écran à la place des « ≥ » et « n.d. » par mois.
const rawHistory = (ctx: CollabContext) => (ctx.payfitHistory && ctx.payfitHistory.mode === "raw" && ctx.data ? { h: ctx.payfitHistory, d: ctx.data } : null);

function PayfitHistoryText({ ctx }: { ctx: CollabContext }) {
  const r = rawHistory(ctx);
  if (!r) return null;
  const { h, d } = r;
  return (
    <>
      Données telles que remontées par l'API PayFit (lecture du {formatDate(d.build.referenceDate)}).{" "}
      {h.limit ? (
        <>
          Pour les mois {(h.limit.lowerFrom === h.limit.lowerTo ? formatMonth(h.limit.lowerFrom) : `${formatMonth(h.limit.lowerFrom)} à ${formatMonth(h.limit.lowerTo)}`).toLowerCase()}
          {h.limit.exactFrom ? ` (avant le ${formatDate(h.limit.exactFrom)})` : ""}, les contrats archivés depuis plus de 12 mois ne sont pas renvoyés : effectifs, ETP et sorties peuvent être sous-estimés ; entrées, turnover et absentéisme faussés dans un sens ou dans l'autre.
        </>
      ) : (
        <>Aucun mois de la lecture n'est antérieur à la limite de conservation des contrats archivés.</>
      )}
      <GlossaryLink slug={ctx.slug} term="lower-bound" />{" "}
      <a href={`/e/${ctx.slug}/parametres#payfit-historique`}>Paramètre : historique PayFit brut</a>
    </>
  );
}

export function PayfitHistoryNotice({ ctx }: { ctx: CollabContext }) {
  if (!rawHistory(ctx)) return null;
  return (
    <p className="notice" data-testid="payfit-history-notice">
      <PayfitHistoryText ctx={ctx} />
    </p>
  );
}

// Résumé d'une ligne de chaque limite de lecture (visible quand le bloc est replié).
function limitResumes(ctx: CollabContext): string[] {
  const out: string[] = [];
  const r = rawHistory(ctx);
  if (r) {
    const l = r.h.limit;
    out.push(
      l
        ? `Historique PayFit tel que renvoyé par l'API : pour ${monthRangeLabel(monthsBetween(l.lowerFrom, l.lowerTo))}, les contrats archivés depuis plus de 12 mois manquent ; effectifs, ETP et sorties peuvent être sous-estimés, entrées, turnover et absentéisme faussés.`
        : "Historique PayFit tel que renvoyé par l'API : aucun mois de la lecture n'est antérieur à la limite de conservation.",
    );
  }
  if (ctx.switchedAt) out.push(`Source RH changée le ${dateTimeFmt.format(ctx.switchedAt)}.`);
  return out;
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

// En-tête des écrans Collaborateurs. Les limites de la lecture tiennent dans un seul bloc repliable (résumé visible) ; une
// page « Prévu » (prevu) n'affiche aucune donnée : ni limites de lecture, ni définitions.
export function CollabHeader({ ctx, tab, prevu = false, children }: { ctx: CollabContext; tab: TabId | null; prevu?: boolean; children?: ReactNode }) {
  const { slug, source } = ctx;
  const state = ctx.state;
  const resumes = limitResumes(ctx);
  const n = resumes.length;
  return (
    <>
      <div className="collab-head">
        <span className="label">Studio RH</span>
        <h1>{ITEM.label}</h1>
        <SourceBadge resolution={source} slug={slug} />
        {ctx.data && !prevu && (
          <details className={n ? "collab-read-details collab-limits" : "collab-read-details"} data-testid="collab-read-details" open={!!ctx.switchedAt}>
            <summary>
              {n ? (
                <>
                  <span className="collab-limits-title">Limites de la lecture ({n})</span>
                  <span className="collab-limits-resume" data-testid="collab-limits-resume">{resumes.join(" ")}</span>
                </>
              ) : (
                <>Détail de la lecture{ctx.data.build.referenceDate ? ` · date de référence ${formatDate(ctx.data.build.referenceDate)}` : ""}</>
              )}
            </summary>
            <div className="collab-limits-body">
              {rawHistory(ctx) && (
                <p className="collab-limit" data-testid="payfit-history-notice">
                  <PayfitHistoryText ctx={ctx} />
                </p>
              )}
              {ctx.switchedAt && (
                <p className="collab-limit" data-testid="source-switch-notice">
                  Source RH changée le {dateTimeFmt.format(ctx.switchedAt)} par un administrateur ({source.reason}). Les identifiants PayFit et DSN sont distincts : aucun lien n'est conservé entre les deux référentiels.
                </p>
              )}
              {n > 0 && <strong className="collab-limits-sub">Détail de la lecture{ctx.data.build.referenceDate ? ` · date de référence ${formatDate(ctx.data.build.referenceDate)}` : ""}</strong>}
              <BuildInfo ctx={ctx} />
              <p className="desc" data-testid="rh-natures">
                Natures comptées dans l'effectif : {ctx.natures.codes.map((c) => contractNatureLabel(c)).join(", ")} — {ctx.natures.origin === "default" ? "valeur par défaut validée" : "modifiée par un administrateur"} · <a href={`/e/${ctx.slug}/parametres`}>Paramètres</a>
                <GlossaryLink slug={ctx.slug} term="natures" />
              </p>
            </div>
          </details>
        )}
      </div>
      {!source.chosen && (
        <section className="placeholder" data-testid="collaborateurs-nd">
          <h3>n.d. — aucune source RH retenue</h3>
          <p className="muted">
            Connectez PayFit ou déposez des DSN dans <a href={`/e/${slug}/donnees`}>Données</a>, puis appliquez une lecture.
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
    </>
  );
}

export function Prov({ p, slug }: { p: Provenance | null | undefined; slug: string }) {
  if (!p) return null;
  return (
    <a className="prov" href={`/e/${slug}/donnees/synchro/${p.syncId}`} title={p.label}>{p.label}</a>
  );
}

// Raison n.d. d'un texte « n.d. — raison » (tuiles) : la raison seule, mois en clair.
const ndReason = (s: Shown) => clearMonths(s.text.replace(/^n\.d\. — /, ""));

// Valeur tracée : la valeur et sa provenance, ou « n.d. — raison ». `short` (cellule de tableau) : « n.d. » seul, raison au survol
// et pour les lecteurs d'écran ; la raison est alors dite une fois sous le tableau.
export function Traced<T>({ view, slug, format, prov = true, short = false }: { view: FieldView<T>; slug: string; format?: (v: T) => ReactNode; prov?: boolean; short?: boolean }) {
  if (view.nd !== null) {
    if (short) return <NdShort reason={view.nd.reason} />;
    return <span className="nd" title={view.nd.code}>n.d. — {view.nd.reason}</span>;
  }
  return (
    <>
      <span>{format ? format(view.value) : String(view.value)}</span>
      {prov && view.provenance && <> <Prov p={view.provenance} slug={slug} /></>}
    </>
  );
}

// « n.d. » court : la raison reste au survol et pour les lecteurs d'écran.
export function NdShort({ reason }: { reason: string }) {
  return (
    <span className="nd" title={reason}>
      n.d.<span className="collab-sr"> — {reason}</span>
    </span>
  );
}

export function Field<T>({ row, field, value, slug, format, prov, short }: { row: TracedRow; field: string; value: T | null | undefined; slug: string; format?: (v: T) => ReactNode; prov?: boolean; short?: boolean }) {
  return <Traced view={fieldView(row, field, value)} slug={slug} format={format} prov={prov} short={short} />;
}

// Raisons n.d. distinctes d'un groupe de tuiles (une même raison n'est écrite qu'une fois, en tête de panneau).
export function shownNdReasons(list: Shown[]): string[] {
  return [...new Set(list.filter((x) => x.kind === "nd").map(ndReason))];
}

// Explication n.d. d'un panneau : une seule phrase si la raison est unique, une liste sinon.
export function NdNote({ reasons, testid, children }: { reasons: string[]; testid?: string; children?: ReactNode }) {
  if (!reasons.length) return null;
  return (
    <div className="collab-ndnote" data-testid={testid}>
      {reasons.length === 1 ? (
        <p><strong>n.d.</strong> — {reasons[0]}</p>
      ) : (
        <>
          <p><strong>n.d.</strong> — raisons :</p>
          <ul>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </>
      )}
      {children}
    </div>
  );
}

// Note unique sous un tableau : chaque raison n.d. n'est écrite qu'une fois, avec les colonnes concernées.
export function NdTableNote({ notes, testid }: { notes: { reason: string; columns: string[] }[]; testid?: string }) {
  if (!notes.length) return null;
  return (
    <div className="collab-ndnote" data-testid={testid}>
      <ul>
        {notes.map((n) => <li key={n.reason}><strong>n.d.</strong> — {n.columns.join(", ")} : {clearMonths(n.reason)}</li>)}
      </ul>
    </div>
  );
}

// Tuile d'indicateur : la valeur courte est écrite en grand ; un n.d. s'écrit « n.d. » (la raison est dite une fois en tête de
// panneau, et reste au survol) ; « ≥ n » s'écrit « au moins n ». Le « ? » du libellé renvoie à la définition (glossaire) ; le pied
// ne garde que la donnée qui qualifie le chiffre (borne basse, mois couverts…).
export function Tile({ id, label, shown, def, slug }: { id: string; label: string; shown: Shown; def: string; slug?: string }) {
  const text = shown.kind === "nd" ? "n.d." : atLeast(shown.text);
  const big = shown.kind !== "nd" && text.length <= 14;
  const cls = [shown.kind === "nd" ? "nd" : shown.kind === "lower" ? "lower" : "", big ? "big" : ""].filter(Boolean).join(" ");
  const foot = tileFoot(shown.foot);
  return (
    <div data-testid={id} className="collab-tile">
      <dt>
        {label}
        {slug && <GlossaryLink slug={slug} term={def} label={label} />}
      </dt>
      <dd className={cls || undefined} title={shown.kind === "nd" ? ndReason(shown) : undefined}>
        {text}
        {shown.kind === "nd" && <span className="collab-sr"> — {ndReason(shown)}</span>}
      </dd>
      {foot && <span className="tile-foot">{foot}</span>}
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

// Bouton de validation d'un formulaire de filtres : action principale (bleu plein), suivie d'une action secondaire (Réinitialiser).
export function FilterActions({ label, resetHref }: { label: string; resetHref?: string | null }) {
  return (
    <div className="collab-actions">
      <button className="btn primary" type="submit">{label}</button>
      {resetHref && <a className="collab-reset" href={resetHref}>Réinitialiser</a>}
    </div>
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
      <FilterActions label={submitLabel} resetHref={resetHref} />
    </form>
  );
}

// Nom du collaborateur (lien) et, en ligne secondaire, l'identifiant technique de la source. `inline` : les deux sur une même
// ligne (listes à puces).
export function PersonCell({ person, contract, slug, inline = false }: { person: PersonDraft | null; contract: ContractDraft; slug: string; inline?: boolean }) {
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
    <span className={inline ? "collab-person-cell inline" : "collab-person-cell"}>
      <a href={personHref(slug, person.personKey)}>{label ?? <span className="nd">n.d. — {person.fieldsNd.familyName?.reason ?? "nom absent"}</span>}</a>{" "}
      <ShortId id={person.externalId} sub={!inline} />
    </span>
  );
}

// Identifiant de source : affiché en entier s'il est lisible, tronqué (avec la valeur complète au survol) si c'est une empreinte.
export function ShortId({ id, sub = false }: { id: string; sub?: boolean }) {
  const cls = sub ? "collab-sub" : undefined;
  return id.length > 24 ? <code className={cls} title={id}>{id.slice(0, 8)}…</code> : <code className={cls}>{id}</code>;
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

// Fin de contrat. `short` (cellule de tableau) : « n.d. » court ; l'appelant dit la raison une fois sous le tableau (voir endNd).
export function EndCell({ c, slug, prov = true, short = false }: { c: ContractDraft; slug: string; prov?: boolean; short?: boolean }) {
  if (c.endDate) {
    const motif = c.fieldsNd.endReason?.reason ?? "non renseigné";
    return (
      <span>
        {formatDate(c.endDate)}{prov && <> <Prov p={c.provenance.endDate} slug={slug} /></>}
        {c.endReason ? <> · {endReasonLabel(c.endReason)}</> : short ? <> · motif <NdShort reason={motif} /></> : <> · <span className="nd">motif : n.d. — {motif}</span></>}
      </span>
    );
  }
  if (c.endStatus === "none_cdi") return <span>sans terme (CDI)</span>;
  const reason = c.fieldsNd.endDate?.reason ?? (c.endStatus === "unpositioned" ? "contrat non positionnable" : "fin non renseignée");
  return short ? <NdShort reason={reason} /> : <span className="nd">n.d. — {reason}</span>;
}

// Raisons n.d. d'une cellule « Fin » (mêmes cas que EndCell) : pour la note unique sous un tableau.
export function endNd(c: ContractDraft): { column: string; reason: string }[] {
  if (c.endDate) return c.endReason ? [] : [{ column: "Motif de fin", reason: c.fieldsNd.endReason?.reason ?? "non renseigné" }];
  if (c.endStatus === "none_cdi") return [];
  return [{ column: "Fin", reason: c.fieldsNd.endDate?.reason ?? (c.endStatus === "unpositioned" ? "contrat non positionnable" : "fin non renseignée") }];
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
    <ul className="finding-list collab-findings" data-testid={testId}>
      {findings.map((f, i) => (
        <li key={`${f.code}-${i}`}>
          <span className={`finding ${f.severity}`}><span className="collab-sr">{f.severity === "check" ? "À vérifier : " : "Information : "}</span>{findingLabel(f.code)}</span>
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

// Provenance de la date en ligne secondaire : le libellé complet (lecture, collection, champ) est au survol et pour les lecteurs d'écran.
function ProvLine({ p, slug }: { p: Provenance | null | undefined; slug: string }) {
  if (!p) return null;
  return <a className="collab-sub collab-prov" href={`/e/${slug}/donnees/synchro/${p.syncId}`} title={p.label} aria-label={`Provenance de la date : ${p.label}`}>provenance</a>;
}

// Entrées et sorties datées : mêmes colonnes dans le même ordre (la sortie ajoute le motif en dernière colonne), la provenance de la
// date sous la date, l'identifiant technique sous le nom.
export function EventsTable({ rows, slug, kind, testId, source }: { rows: EventRow[]; slug: string; kind: "entry" | "exit"; testId: string; source: "payfit" | "dsn" }) {
  if (!rows.length) return <p className="muted" data-testid={`${testId}-empty`}>Aucune {kind === "entry" ? "entrée" : "sortie"} sur la période.</p>;
  // Motif de fin absent : « n.d. » court dans la cellule, la raison une seule fois sous le tableau.
  const motifReason = (r: EventRow) => r.event.fieldsNd.endReason?.reason ?? (source === "payfit" ? "PayFit n'expose pas le motif" : "motif absent");
  const motifNd = kind === "exit" ? [...new Set(rows.filter((r) => !r.event.endReason).map(motifReason))] : [];
  return (
    <>
      <div className={rows.length > 12 ? "table-wrap scroll collab-scroll" : "table-wrap scroll collab-flat"}>
        <table className="data-table sticky collab-table collab-events" data-testid={testId}>
          <caption className="collab-sr">{kind === "entry" ? "Entrées" : "Sorties"} datées, une ligne par contrat</caption>
          <thead>
            <tr>
              <th scope="col">Date</th><th scope="col">Personne</th><th scope="col">Contrat</th><th scope="col">Établissement</th><th scope="col">Nature</th>
              <th scope="col">Effectif</th><th scope="col">Drapeaux</th>
              {kind === "exit" && <th scope="col" className="wrap">Motif de fin</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.event.contractKey}-${r.event.kind}`}>
                <td className="col-date">{formatDate(r.event.date)}<ProvLine p={r.event.provenance.date} slug={slug} /></td>
                <td><PersonCell person={r.person} contract={r.contract} slug={slug} /></td>
                <td><a href={contractHref(slug, r.contract.contractKey)}><code>{r.contract.externalId}</code></a></td>
                <td><code>{r.event.establishmentId ?? "n.d."}</code></td>
                <td><Nature code={r.event.nature} /></td>
                <td>{r.inScope ? <span className="collab-pill s-counted">compté</span> : <span className="collab-pill">hors effectif</span>}</td>
                <td><FlagTags flags={r.event.flags} labels={EVENT_FLAG_LABELS} /></td>
                {kind === "exit" && (
                  <td className="col-wide">
                    {r.event.endReason ? endReasonLabel(r.event.endReason) : <NdShort reason={motifReason(r)} />}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {motifNd.length > 0 && <p className="collab-note">Motif de fin n.d. : {motifNd.join(" ; ")}.</p>}
    </>
  );
}

// Liste de mois d'un filtre : valeur ISO (adresse), libellé en clair (« Octobre 2026 »), « — n.d. » pour un mois sans lecture exacte.
export function MonthSelect({ name, id, label, months, value, nd }: { name: string; id: string; label: string; months: string[]; value: string; nd: Set<string> }) {
  const options = months.includes(value) ? months : [value, ...months];
  return (
    <div className="field-row collab-month">
      <label htmlFor={id}>{label}</label>
      <select className="select" id={id} name={name} defaultValue={value}>
        {options.map((m) => (
          <option key={m} value={m}>{formatMonth(m)}{nd.has(m) ? " — n.d." : ""}</option>
        ))}
      </select>
    </div>
  );
}
