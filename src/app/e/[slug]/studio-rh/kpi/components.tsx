import type { ReactNode } from "react";
import { BarChart, LineChart, type ChartSeries } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { SourceBadge } from "@/components/SourceBadge";
import { Sparkline } from "@/components/Sparkline";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate, formatMonth } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { KPI_TERMS } from "@/lib/glossary/kpi";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { monthRanges, payfitExactFrom, type Count, type HeadcountResult } from "@/lib/rh/headcount";
import { fmtEtp4, fmtFixed, fmtFraction, fmtHalfDays, fmtPercent, showKpi } from "@/lib/rh/kpi/format";
import type {
  Absenteeism,
  AbsenteeismMonth,
  Average,
  Compared,
  EtpBasis,
  EtpMonthEnd,
  EtpSource,
  EventContribution,
  Kind,
  KpiNd,
  KpiRow,
  MonthMovements,
  TheoreticalMonth,
  TheoreticalWindow,
  Turnover,
} from "@/lib/rh/kpi/types";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { ABSENCE_MOMENT_LABELS, ABSENCE_STATUS_LABELS } from "@/lib/rh/labels";
import type { ContractDraft, PersonDraft } from "@/lib/rh/referential/types";
import { EVENT_FLAG_LABELS, fmtInt, fmtNumber, showCount, showHeadcount, timeUnitLabel, type Shown } from "@/lib/rh/view";
import { absenceTypeLabel, absenteeismSeries, categorySeries, comparedRate, etpSeries, headcountSeries, monthAxis, movementSeries, ndSummary, readingQualifiers, zeroRateNote, type CategoryMonthIn } from "@/lib/viz/kpi";
import { BuildInfo, contractHref, FlagTags, Nature, PayfitHistoryNotice, PersonCell, Prov } from "../collaborateurs/components";

// Composants de l'écran KPI RH : en-tête, tuiles (valeur, N-1, écart, « ? » vers le glossaire), tableau mensuel, détail d'un chiffre.
// Aucune explication de calcul sur l'écran : les définitions sont au glossaire (src/lib/glossary/kpi.ts), reliées par un « ? ».
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/kpi")!;

export type Maps = { persons: Map<string, PersonDraft>; contracts: Map<string, ContractDraft> };

// --- Valeurs affichées

export function show<T extends { kind: Kind | "nd"; nd?: KpiNd | null }>(v: T, text: (x: Exclude<T, { kind: "nd" }>) => string): Shown {
  return showKpi(v, () => text(v as Exclude<T, { kind: "nd" }>));
}
export const etpShown = (e: EtpMonthEnd): Shown => show(e, (x) => fmtEtp4(x.etp4));
export const etpTitle = (e: EtpMonthEnd): string | undefined => (e.kind === "nd" ? undefined : `${fmtFraction({ num: e.etp4, den: 10000 })} ETP (${fmtInt(e.etp4)} dix-millièmes)`);
export const averageShown = (a: Average): Shown => show(a, (x) => fmtFixed(x.ratio));
export const ratioTitle = (v: { kind: Kind | "nd"; ratio?: { num: number; den: number } }): string | undefined => (v.kind === "nd" || !v.ratio ? undefined : `fraction exacte : ${fmtFraction(v.ratio)}`);
export const turnoverShown = (t: Turnover): Shown => show(t, (x) => fmtPercent(x.ratio));
export const absenteeismShown = (a: Absenteeism | AbsenteeismMonth): Shown => show(a, (x) => fmtPercent(x.ratio));
export const absenceDaysShown = (a: AbsenteeismMonth): Shown => show(a, (x) => fmtHalfDays(x.ratio.num));
export const theoreticalShown = (t: TheoreticalMonth): Shown => show(t, (x) => fmtHalfDays(x.half));
const ndReason = (s: Shown) => s.text.replace(/^n\.d\. — /, "");
const cls = (s: Shown) => (s.kind === "nd" ? "nd" : s.kind === "lower" ? "lower" : undefined);

// --- En-tête

// bare : page « Prévu » (aucun chiffre) : ni dernier mois clos ni détails de la lecture, qui n'ont rien à qualifier.
export function KpiHeader({ ctx, closedMonth, children, bare = false }: { ctx: KpiContext; closedMonth: string | null; children?: ReactNode; bare?: boolean }) {
  const { slug, source, state, switchedAt } = ctx.collab;
  return (
    <>
      <div className="kpi-head">
        <span className="label">Studio RH</span>
        <h1>{ITEM.label}</h1>
        <div className="kpi-read-strip">
          <div className="kpi-source">
            <SourceBadge resolution={source} slug={slug} />
            {source.chosen && <GlossaryLink slug={slug} term={KPI_TERMS.sourceGaps} label="Écarts entre PayFit et DSN" />}
          </div>
          {ctx.collab.data && !bare && (
            <p className="desc" data-testid="kpi-closed-month">
              Dernier mois clos : {closedMonth ? <strong>{closedMonth}</strong> : <span className="nd">n.d. — aucun mois clos à la date de référence</span>}
              {(ctx.input?.openMonths ?? []).length > 0 && (
                <span data-testid="kpi-payroll-open"> · paie non clôturée à la lecture : {ctx.input!.openMonths!.join(", ")} (mois non clos)</span>
              )}
            </p>
          )}
        </div>
        {switchedAt && (
          <p className="notice" data-testid="source-switch-notice">
            Source RH changée le {dateTimeFmt.format(switchedAt)} par un administrateur ({source.reason}) : aucune comparaison entre PayFit et DSN.
          </p>
        )}
        {ctx.collab.data && !bare && (
          <details className="kpi-read-details" data-testid="kpi-read-details">
            <summary>Détails de la lecture</summary>
            <BuildInfo ctx={ctx.collab} />
          </details>
        )}
      </div>
      {!source.chosen && (
        <section className="placeholder" data-testid="kpi-nd">
          <h3>n.d. — aucune source RH retenue</h3>
          <p className="muted">
            Connectez PayFit ou déposez des DSN dans <a href={`/e/${slug}/donnees`}>Données</a>, appliquez une lecture, puis revenez ici.
          </p>
        </section>
      )}
      {state?.kind === "unavailable" && (
        <section className="placeholder" data-testid="kpi-unavailable">
          <h3>n.d. — référentiel indisponible</h3>
          <p className="muted">{state.reason}. Corrigez la clé dans <a href={`/e/${slug}/donnees`}>Données</a> et relancez une lecture.</p>
        </section>
      )}
      {children}
    </>
  );
}

// Titre de panneau suivi de son « ? » vers le glossaire (le titre reste court : les explications sont au glossaire).
export function PanelTitle({ slug, term, label, children }: { slug: string; term: string; label?: string; children: ReactNode }) {
  return (
    <div className="kpi-title">
      <h2>{children}</h2>
      <GlossaryLink slug={slug} term={term} label={label} />
    </div>
  );
}

// PayFit : limites de la lecture (quotités à la date de lecture, limite de conservation des contrats archivés), réunies dans un
// seul bloc repliable dont le résumé reste visible. En mode « brut » (défaut), la limite de conservation est dite une fois par
// PayfitHistoryNotice ; en mode « signalé », les mois concernés sont listés dans le second paragraphe.
export function PayfitNotice({ ctx }: { ctx: KpiContext }) {
  const data = ctx.collab.data;
  if (!data || data.build.source !== "payfit") return null;
  const history = ctx.collab.payfitHistory;
  const raw = history?.mode === "raw";
  const lower = [...new Set(data.coverage.filter((c) => c.presenceStatus === "lower_bound").map((c) => c.month))].sort();
  const exactFrom = payfitExactFrom(data);
  const archive = !raw && lower.length > 0 && !!exactFrom;
  // Un résumé court par limite : ce qui reste lisible bloc fermé.
  const digests = [
    ...(raw ? [history?.limit ? "contrats archivés de plus de 12 mois non renvoyés par PayFit" : "historique PayFit tel que renvoyé par l'API"] : []),
    ...(archive ? ["mois en borne basse (contrats archivés non renvoyés)"] : []),
    `quotités à la date de lecture (${formatDate(data.build.referenceDate)})`,
  ];
  return (
    <details className="kpi-limits" data-testid="kpi-read-limits">
      <summary>
        <span className="kpi-limits-title">Limites de la lecture ({digests.length})</span>
        <span className="kpi-limits-digest">{digests.join(" · ")}</span>
      </summary>
      <div className="kpi-limits-body">
        {raw && <PayfitHistoryNotice ctx={ctx.collab} />}
        <p className="notice" data-testid="kpi-payfit-notice">
          Quotités non historisées par PayFit : la même quotité sert pour tous les mois, N-1 compris.
          <GlossaryLink slug={ctx.collab.slug} term={KPI_TERMS.limits} />
        </p>
        {archive && (
          <p className="notice" data-testid="kpi-payfit-archive-notice">
            Contrats archivés non renvoyés par PayFit (constat sur un compte PayFit, à vérifier pour chaque espace) : effectif et ETP exacts à partir du {formatDate(exactFrom!)} ; entrées, sorties et absences des mois {monthRanges(lower)} incomplètes ; turnover et absentéisme n.d. sur toute période qui en contient un.
          </p>
        )}
      </div>
    </details>
  );
}

// --- Types d'absence : libellé français quand l'application le connaît, sinon le code tel que reçu de PayFit (discret)

// withCode : dans un tableau de détail (traçabilité), le code PayFit reste écrit à côté du libellé, pas seulement en infobulle.
export function AbsenceType({ code, withCode = false }: { code: string; withCode?: boolean }) {
  const label = absenceTypeLabel(code);
  if (!label) return <code className="kpi-code" title="Type affiché tel que reçu de PayFit">{code}</code>;
  return withCode ? <><span>{label}</span> <code className="kpi-code">{code}</code></> : <span title={`Code PayFit : ${code}`}>{label}</span>;
}
export function AbsenceTypes({ codes }: { codes: string[] }) {
  return <>{codes.map((c, i) => <span key={c}>{i > 0 ? ", " : ""}<AbsenceType code={c} /></span>)}</>;
}

// Tuile Absentéisme : types d'absence comptés, présents non comptés, comptés mais sans aucune absence dans la lecture.
// Le nombre entre parenthèses (absences de toute la lecture) est expliqué au glossaire.
export function AbsenceTypeNotes({ chosen, other, missing, slug }: { chosen: { type: string; count: number }[]; other: { type: string; count: number }[]; missing: { type: string }[]; slug: string }) {
  const list = (xs: { type: string; count: number }[]) =>
    xs.length ? xs.map((x, i) => <span key={x.type}>{i > 0 ? ", " : ""}<AbsenceType code={x.type} /> ({x.count})</span>) : "aucun";
  return (
    <details className="tile-more">
      <summary>Types d'absence</summary>
      <span className="tile-foot tile-types" data-testid="kpi-absence-types">
        <span><strong>Types comptés</strong> : {list(chosen)}</span>
        <span><strong>Autres types présents dans la lecture, non comptés</strong> : {list(other)}</span>
        {missing.length > 0 && <span><strong>Types comptés absents de la lecture</strong> : <AbsenceTypes codes={missing.map((x) => x.type)} /></span>}
        <span>
          <a href={`/e/${slug}/parametres#kpi`}>Paramètres</a>
          <GlossaryLink slug={slug} term={KPI_TERMS.absenceTypes} />
        </span>
      </span>
    </details>
  );
}

// --- Tuiles

export function KpiTile(props: {
  id: string;
  slug: string;
  label: string;
  shown: Shown;
  title?: string;
  n1: string;
  n1Title?: string; // période N-1 complète, au survol de la ligne N-1
  delta: string;
  deltaTitle?: string; // écart exact en fractions (au survol de la ligne Écart) : rien de visible, la traçabilité reste entière
  qualifiers?: string[];
  // Avertissement qui conditionne la lecture de la valeur : reste visible sous la valeur.
  warning?: ReactNode;
  term: string; // identifiant de l'entrée du glossaire (« ? » à côté du libellé)
  detail: string;
  detailN1: string;
  children?: ReactNode;
  visible?: boolean;
  sparkline?: readonly (number | null)[];
}) {
  const { id, slug, label, shown, title, n1, n1Title, delta, deltaTitle, qualifiers = [], warning, term, detail, detailN1, children, visible = true } = props;
  if (!visible) return null;
  const notes = readingQualifiers(qualifiers);
  return (
    <div className="kpi-tile" data-testid={`kpi-tile-${id}`}>
      <dt>{label}<GlossaryLink slug={slug} term={term} /></dt>
      <dd className={cls(shown)} title={title}>{shown.text}</dd>
      {/* Toujours présent, même vide : la rangée des remarques garde la grille des tuiles alignée (N-1 et écart, liens). */}
      <div className="tile-notes">
        {notes.map((q) => <span key={q} className="tile-foot">{q}</span>)}
        {warning}
        {children}
        {shown.kind === "value" && props.sparkline && <Sparkline values={props.sparkline} />}
      </div>
      <span className="tile-compare">
        <span className="tile-foot" title={n1Title} data-testid={`kpi-tile-${id}-n1`}>N-1 : {n1}</span>
        <span className="tile-foot" title={deltaTitle} data-testid={`kpi-tile-${id}-delta`}>Écart : {delta}</span>
      </span>
      <span className="tile-foot tile-links">
        <a href={detail}>Détail</a> · <a href={detailN1} data-testid={`kpi-tile-${id}-detail-n1`}>Détail N-1</a>
      </span>
    </div>
  );
}

// --- Lecture graphique (séries mensuelles déjà calculées : le tableau « Mois par mois » reste la référence)

// Un emplacement de graphique : si tout est n.d. la raison remplace le graphique (une courbe vide ne dirait rien).
function Slot({ id, title, list, wide, children }: { id: string; title: string; list: ChartSeries[]; wide?: boolean; children: ReactNode }) {
  const nd = ndSummary(list);
  return (
    <div className={wide ? "kpi-chart wide" : "kpi-chart"}>
      {nd ? (
        <figure className="chart" data-testid={`kpi-chart-${id}`} data-state="nd">
          <figcaption className="chart-head"><span className="chart-title">{title}</span></figcaption>
          <p className="nd">n.d. — {nd}</p>
        </figure>
      ) : children}
    </div>
  );
}

export function KpiCharts({ slug, vue, rows, turnover, absenteeism }: { slug: string; vue: "suivi" | "turnover" | "absenteisme"; rows: KpiRow[]; turnover: Compared<Turnover>; absenteeism: Compared<Absenteeism> }) {
  const months = rows.map((r) => r.month);
  const axis = monthAxis(months); // séries du mois seul
  const axisN1 = monthAxis(months, rows.map((r) => r.previous.month)); // séries avec leur N-1 : l'infobulle nomme les deux mois
  const etp = etpSeries(rows);
  const headcount = headcountSeries(rows);
  const moves = movementSeries(rows);
  const abs = absenteeismSeries(rows);
  const turn = comparedRate("Turnover", { label: turnover.previousWindow.label, value: turnover.previous }, { label: turnover.window.label, value: turnover.current });
  const absPeriod = comparedRate("Absentéisme", { label: absenteeism.previousWindow.label, value: absenteeism.previous }, { label: absenteeism.window.label, value: absenteeism.current });
  const H = 250;
  // Un emplacement par graphique, dans l'ordre de lecture de chaque écran ; le seul graphique « large » est celui des mouvements du turnover.
  // Aucune note sous les graphiques : les règles de lecture sont au glossaire (« ? » du panneau).
  const slots: Record<string, ReactNode> = {
    etp: (
      <Slot key="etp" id="etp" title="ETP contractuel de fin de mois" list={etp}>
        <LineChart testid="kpi-chart-etp" label="ETP contractuel de fin de mois, par mois, période affichée et N-1" title="ETP contractuel de fin de mois" categories={axisN1.categories} categoryTitles={axisN1.titles} series={etp} unit="etp" height={H} />
      </Slot>
    ),
    effectif: (
      <Slot key="effectif" id="effectif" title="Effectif de fin de mois (personnes)" list={headcount}>
        <LineChart testid="kpi-chart-effectif" label="Effectif de fin de mois en personnes, par mois" title="Effectif de fin de mois (personnes)" categories={axis.categories} categoryTitles={axis.titles} series={headcount} unit="nombre" height={H} />
      </Slot>
    ),
    mouvements: (
      <Slot key="mouvements" id="mouvements" title="Entrées et sorties comptées par mois" list={moves} wide={vue === "turnover"}>
        <BarChart testid="kpi-chart-mouvements" label="Entrées et sorties comptées, par mois" title="Entrées et sorties comptées par mois" categories={axis.categories} categoryTitles={axis.titles} series={moves} unit="nombre" mode="grouped" height={H} />
      </Slot>
    ),
    absenteisme: (
      <Slot key="absenteisme" id="absenteisme" title="Absentéisme par mois" list={abs}>
        <LineChart testid="kpi-chart-absenteisme" label="Absentéisme de chaque mois, période affichée et N-1" title="Absentéisme par mois, période affichée et N-1" categories={axisN1.categories} categoryTitles={axisN1.titles} series={abs} unit="bps" zero height={H} note={zeroRateNote(abs)} />
      </Slot>
    ),
    turnover: (
      <Slot key="turnover" id="turnover-periode" title="Turnover par période" list={turn.series}>
        <BarChart testid="kpi-chart-turnover-periode" label="Taux de turnover, période précédente et période affichée" title="Turnover par période" categories={turn.categories} categoryTitles={turn.titles} series={turn.series} unit="bps" mode="grouped" height={H} />
      </Slot>
    ),
    absenteismePeriode: (
      <Slot key="absenteisme-periode" id="absenteisme-periode" title="Absentéisme par période" list={absPeriod.series}>
        <BarChart testid="kpi-chart-absenteisme-periode" label="Taux d'absentéisme, période précédente et période affichée" title="Absentéisme par période" categories={absPeriod.categories} categoryTitles={absPeriod.titles} series={absPeriod.series} unit="bps" mode="grouped" height={H} note={zeroRateNote(absPeriod.series)} />
      </Slot>
    ),
  };
  const order = vue === "turnover" ? ["mouvements", "effectif", "turnover"] : vue === "absenteisme" ? ["absenteisme", "absenteismePeriode"] : ["etp", "effectif", "mouvements", "absenteisme", "turnover", "absenteismePeriode"];
  return (
    <section className="panel" data-testid="kpi-graphs">
      <div className="panel-head">
        <PanelTitle slug={slug} term={KPI_TERMS.graphs} label="Lecture des graphiques KPI RH">Lecture graphique</PanelTitle>
      </div>
      <div className="kpi-charts">{order.map((id) => slots[id])}</div>
    </section>
  );
}

// ETP de fin de mois par catégorie (CDI, CDD, apprenti, stagiaire) : barres empilées dont la hauteur est l'ETP contractuel du mois.
export function KpiCategoryChart({ months, keys, labels }: { months: CategoryMonthIn[]; keys: string[]; labels: Record<string, string> }) {
  const axis = monthAxis(months.map((m) => m.month));
  const list = categorySeries(months, keys, labels, "etp");
  return (
    <Slot id="categories" title="ETP de fin de mois par catégorie" list={list}>
      <BarChart
        testid="kpi-chart-categories"
        label="ETP de fin de mois par catégorie de contrat, par mois"
        title="ETP de fin de mois par catégorie"
        categories={axis.categories}
        categoryTitles={axis.titles}
        series={list}
        unit="etp"
        mode="stacked"
        toggle
        height={260}
      />
    </Slot>
  );
}

// --- Tableau mensuel

export function Cell({ col, shown, href }: { col: string; shown: Shown; href: string | null }) {
  const nd = shown.kind === "nd";
  const text = nd ? "n.d." : shown.text;
  const title = nd ? ndReason(shown) : shown.foot;
  return (
    <td data-col={col} className="num">
      {href ? <a href={href} className={cls(shown)} title={title}>{text}</a> : <span className={cls(shown)} title={title}>{text}</span>}
    </td>
  );
}

// Raisons des « n.d. » du tableau, dédoublonnées, avec les mois concernés.
export function NdReasons({ items, slug }: { items: { month: string; shown: Shown }[]; slug?: string }) {
  const byReason = new Map<string, string[]>();
  for (const { month, shown } of items) {
    if (shown.kind !== "nd") continue;
    const r = ndReason(shown);
    byReason.set(r, [...new Set([...(byReason.get(r) ?? []), month])].sort());
  }
  if (!byReason.size) return null;
  return (
    <div data-testid="kpi-nd-reasons">
      <h3>
        Raisons des « n.d. » du tableau
        {slug && <GlossaryLink slug={slug} term={KPI_TERMS.ndReasons} />}
      </h3>
      <ul className="desc">
        {[...byReason].map(([reason, months]) => (
          <li key={reason}>{monthRanges(months)} — {reason}</li>
        ))}
      </ul>
    </div>
  );
}

// --- Détail d'un chiffre

const BASIS_LABELS: Record<EtpBasis, string> = {
  payfit_full_time: "temps plein = 1 (Paramètres)",
  payfit_fte: "ETP de la fiche PayFit, arrondi",
  payfit_forfait_jours: "forfait jours sans quotité PayFit = 1 (Paramètres)",
  dsn_full_time_modality: "modalité temps plein (S21.G00.40.014 = 10) = 1 (Paramètres)",
  dsn_ratio: "quotité ÷ quotité de référence, arrondi",
};

function sourceText(s: EtpSource | null, ref: string | null): string {
  if (!s) return "n.d.";
  if (s.source === "payfit") {
    const parts: string[] = [];
    if (s.isFullTimeAtRead !== null) parts.push(`temps plein : ${s.isFullTimeAtRead ? "oui" : "non"}`);
    parts.push(s.fteAtRead !== null ? `${fmtNumber(s.fteAtRead)} ETP` : "ETP : n.d.");
    if (s.weeklyHoursAtRead !== null) parts.push(`${fmtNumber(s.weeklyHoursAtRead)} h par semaine`);
    return `${parts.join(" · ")}, à la lecture du ${formatDate(ref)}`;
  }
  const q = (v: number | null) => (v === null ? "n.d." : fmtNumber(v));
  return `${q(s.contractQuota)} / ${q(s.referenceQuota)} ${timeUnitLabel(s.quotaUnit, "dsn")}, DSN ${s.month}${s.modality ? ` · modalité ${s.modality}` : ""}`;
}

function Person({ personKey, contractKey, maps, slug }: { personKey: string | null; contractKey: string; maps: Maps; slug: string }) {
  const c = maps.contracts.get(contractKey);
  if (!c) return <span className="nd">n.d. — contrat inconnu du référentiel</span>;
  return <PersonCell person={personKey ? (maps.persons.get(personKey) ?? null) : null} contract={c} slug={slug} />;
}

function ContractLink({ contractKey, externalId, slug }: { contractKey: string; externalId: string; slug: string }) {
  return <a href={contractHref(slug, contractKey)}><code>{externalId}</code></a>;
}

function Total({ children, nd = false }: { children: ReactNode; nd?: boolean }) {
  return <p className={nd ? "nd" : "desc"} data-testid="kpi-detail-total"><strong>{children}</strong></p>;
}

export function EtpEndDetail({ v, maps, slug, decimals, refDate }: { v: EtpMonthEnd; maps: Maps; slug: string; decimals: number; refDate: string | null }) {
  return (
    <>
      {v.kind !== "nd" && (
        <div className="table-wrap">
          <table className="data-table" data-testid="kpi-detail-contracts">
            <thead>
              <tr><th>Personne</th><th>Contrat</th><th>Établissement</th><th>Nature</th><th>Quotité source</th><th className="wrap">Règle appliquée</th><th className="num">ETP retenu</th><th className="wrap">Contrôles</th><th>Provenance</th></tr>
            </thead>
            <tbody>
              {v.contributions.map((c) => (
                <tr key={c.contractKey} data-contract={c.externalId}>
                  <td><Person personKey={c.personKey} contractKey={c.contractKey} maps={maps} slug={slug} /></td>
                  <td><ContractLink contractKey={c.contractKey} externalId={c.externalId} slug={slug} /></td>
                  <td><code>{c.establishmentId ?? "n.d."}</code></td>
                  <td><Nature code={c.nature} /></td>
                  <td>{sourceText(c.source, refDate)}</td>
                  <td className="wrap">{BASIS_LABELS[c.basis]}</td>
                  <td className="num">{fmtFixed({ num: c.etp4, den: 10000 }, decimals)}</td>
                  <td className="wrap">{c.checks.length ? c.checks.join(" · ") : <span className="muted">—</span>}</td>
                  <td><Prov p={c.provenance} slug={slug} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v.missing.length > 0 && (
        <>
          <h3>Contrats présents sans quotité lisible</h3>
          <div className="table-wrap">
            <table className="data-table" data-testid="kpi-detail-missing">
              <thead><tr><th>Personne</th><th>Contrat</th><th>Nature</th><th className="wrap">Quotité source</th><th className="wrap">Raison</th></tr></thead>
              <tbody>
                {v.missing.map((m) => (
                  <tr key={m.contractKey}>
                    <td><Person personKey={m.personKey} contractKey={m.contractKey} maps={maps} slug={slug} /></td>
                    <td><ContractLink contractKey={m.contractKey} externalId={m.externalId} slug={slug} /></td>
                    <td><Nature code={m.nature} /></td>
                    <td className="wrap">{sourceText(m.source, refDate)}</td>
                    <td className="wrap nd">n.d. — {m.nd.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {v.kind === "nd" ? (
        <Total nd>n.d. — {v.nd.reason}</Total>
      ) : (
        <Total>
          Σ {v.kind === "lower_bound" ? "≥" : "="} {fmtEtp4(v.etp4)} ETP ({v.contributions.length} contrat{v.contributions.length > 1 ? "s" : ""}, {fmtInt(v.etp4)} dix-millièmes)
          {v.qualifiers.length > 0 && <> — {v.qualifiers.join(" · ")}</>}
        </Total>
      )}
    </>
  );
}

export function HeadcountDetail({ v, maps, slug, month, natureAt }: { v: HeadcountResult; maps: Maps; slug: string; month: string; natureAt: (key: string, month: string) => string | null }) {
  if (v.kind === "nd") return <Total nd>n.d. — {v.nd.reason}</Total>;
  return (
    <>
      <div className="table-wrap">
        <table className="data-table" data-testid="kpi-detail-contracts">
          <thead><tr><th>Personne</th><th>Contrat</th><th>Nature</th></tr></thead>
          <tbody>
            {v.contractKeys.map((k) => {
              const c = maps.contracts.get(k);
              return (
                <tr key={k}>
                  <td><Person personKey={c?.personKey ?? null} contractKey={k} maps={maps} slug={slug} /></td>
                  <td>{c ? <ContractLink contractKey={k} externalId={c.externalId} slug={slug} /> : <code>{k}</code>}</td>
                  <td><Nature code={natureAt(k, month)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {v.declaredAfterEndKeys.length > 0 && (
        <p className="desc" data-testid="kpi-detail-after-end">
          Déclarés ce mois après leur fin, non comptés :{" "}
          {v.declaredAfterEndKeys.map((k, i) => (
            <span key={k}>
              {i > 0 ? ", " : ""}
              {maps.contracts.get(k) ? <ContractLink contractKey={k} externalId={maps.contracts.get(k)!.externalId} slug={slug} /> : <code>{k}</code>}
            </span>
          ))}
        </p>
      )}
      <Total>
        Σ {v.kind === "lower_bound" ? "≥" : "="} {fmtInt(v.persons)} personne{v.persons > 1 ? "s" : ""} ({fmtInt(v.contracts)} contrat{v.contracts > 1 ? "s" : ""})
        {v.qualifiers.length > 0 && <> — {v.qualifiers.join(" · ")}</>} · <a href={`/e/${slug}/studio-rh/collaborateurs?mois=${month}`}>liste du mois dans Collaborateurs</a>
      </Total>
    </>
  );
}

function EventsTable({ events, slug }: { events: EventContribution[]; slug: string }) {
  if (!events.length) return <p className="muted" data-testid="kpi-detail-events-empty">Aucun mouvement.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table" data-testid="kpi-detail-events">
        <thead><tr><th>Date</th><th>Mouvement</th><th>Personne</th><th>Contrat</th><th>Nature</th><th className="wrap">Prise en compte</th><th>Drapeaux</th><th>Provenance</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={`${e.row.event.contractKey}-${e.row.event.kind}`} data-why={e.why}>
              <td>{formatDate(e.row.event.date)}</td>
              <td>{e.row.event.kind === "entry" ? "entrée" : "sortie"}</td>
              <td><PersonCell person={e.row.person} contract={e.row.contract} slug={slug} /></td>
              <td><ContractLink contractKey={e.row.contract.contractKey} externalId={e.row.contract.externalId} slug={slug} /></td>
              <td><Nature code={e.row.event.nature} /></td>
              <td className="wrap">{e.why === "counted" ? e.label : <span className="muted">{e.label}</span>}</td>
              <td><FlagTags flags={e.row.event.flags} labels={EVENT_FLAG_LABELS} /></td>
              <td><Prov p={e.row.event.provenance.date} slug={slug} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MovementsDetail({ v, kind, maps, slug }: { v: MonthMovements; kind: "entry" | "exit"; maps: Maps; slug: string }) {
  const count: Count = kind === "entry" ? v.entries : v.exits;
  const s = showCount(count);
  return (
    <>
      <EventsTable events={v.events.filter((e) => e.row.event.kind === kind)} slug={slug} />
      <Total nd={s.kind === "nd"}>
        {kind === "entry" ? "Entrées" : "Sorties"} comptées : {s.text}
        {s.foot ? <> — {s.foot}</> : null}
      </Total>
    </>
  );
}

export function AverageDetail({ v, detailHref }: { v: Average; detailHref: (id: string, month: string) => string }) {
  const etp = v.unit === "etp";
  return (
    <>
      {v.months.length > 0 && (
        <div className="table-wrap">
          <table className="data-table" data-testid="kpi-detail-months">
            <thead><tr><th>Mois</th><th className="num">{etp ? "ETP fin de mois" : "Effectif fin de mois (personnes)"}</th><th className="wrap">État</th></tr></thead>
            <tbody>
              {v.months.map((m) => (
                <tr key={m.month} data-month={m.month}>
                  <td>{m.month}</td>
                  <td className="num">
                    <a href={detailHref(etp ? "etp-end" : "headcount", m.month)} className={m.kind === "nd" ? "nd" : m.kind === "lower_bound" ? "lower" : undefined}>
                      {m.kind === "nd" || m.value === null ? "n.d." : `${m.kind === "lower_bound" ? "≥ " : ""}${etp ? fmtFixed({ num: m.value, den: 10000 }, 4) : fmtInt(m.value)}`}
                    </a>
                  </td>
                  <td className="wrap">{m.kind === "nd" ? <span className="nd">n.d. — {m.nd?.reason}</span> : m.kind === "lower_bound" ? <span className="lower">borne basse</span> : "exact"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v.kind === "nd" ? (
        <Total nd>n.d. — {v.nd.reason}</Total>
      ) : (
        <Total>
          Σ = {fmtInt(v.months.reduce((s, m) => s + (m.value ?? 0), 0))}
          {etp ? " dix-millièmes d'ETP" : " personnes"} ; n = {v.months.length} ; moyenne = {fmtFraction(v.ratio)} = {fmtFixed(v.ratio)}
          {etp ? " ETP" : ""}
          {v.qualifiers.length > 0 && <> — {v.qualifiers.join(" · ")}</>}
        </Total>
      )}
    </>
  );
}

export function TurnoverDetail({ v, maps, slug, detailHref, natureAt }: { v: Turnover; maps: Maps; slug: string; detailHref: (id: string, month: string | null) => string; natureAt: (key: string, month: string) => string | null }) {
  return (
    <>
      {v.months.length > 0 && (
        <div className="table-wrap">
          <table className="data-table" data-testid="kpi-detail-months">
            <thead><tr><th>Mois</th><th className="num">Entrées comptées</th><th className="num">Sorties comptées</th></tr></thead>
            <tbody>
              {v.months.map((m) => {
                const e = showCount(m.entries);
                const s = showCount(m.exits);
                return (
                  <tr key={m.month} data-month={m.month}>
                    <td>{m.month}</td>
                    <Cell col="entries" shown={e} href={detailHref("entries", m.month)} />
                    <Cell col="exits" shown={s} href={detailHref("exits", m.month)} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <h3>Mouvements de la période</h3>
      <EventsTable events={v.months.flatMap((m) => m.events)} slug={slug} />
      {v.kind === "nd" ? (
        <Total nd>n.d. — {v.nd.reason}</Total>
      ) : v.base.kind === "average" ? (
        <Total>
          ((E + S) ÷ 2) ÷ effectif moyen = (({v.entries} + {v.exits}) ÷ 2) ÷ {fmtFraction(v.base.average.ratio)} = {fmtFraction(v.ratio)} = {fmtPercent(v.ratio)} ·{" "}
          <a href={detailHref("headcount-avg", null)}>effectif moyen {fmtFixed(v.base.average.ratio)}</a>
          {v.qualifiers.length > 0 && <> — {v.qualifiers.join(" · ")}</>}
        </Total>
      ) : (
        <>
          <h3>Effectif au {formatDate(v.base.date)} (base de la formule)</h3>
          <div className="table-wrap">
            <table className="data-table" data-testid="kpi-detail-base">
              <thead><tr><th>Personne</th><th>Contrat</th><th>Nature</th></tr></thead>
              <tbody>
                {v.base.contractKeys.map((k) => {
                  const c = maps.contracts.get(k);
                  return (
                    <tr key={k}>
                      <td><Person personKey={c?.personKey ?? null} contractKey={k} maps={maps} slug={slug} /></td>
                      <td>{c ? <ContractLink contractKey={k} externalId={c.externalId} slug={slug} /> : <code>{k}</code>}</td>
                      <td><Nature code={natureAt(k, v.base.kind === "start" ? v.base.date.slice(0, 7) : "")} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Total>
            S ÷ effectif au {formatDate(v.base.date)} = {v.exits} ÷ {v.base.persons} = {fmtPercent(v.ratio)} ({v.base.persons} personne{v.base.persons > 1 ? "s" : ""}, {v.base.contractKeys.length} contrat{v.base.contractKeys.length > 1 ? "s" : ""})
            {v.qualifiers.length > 0 && <> — {v.qualifiers.join(" · ")}</>}
          </Total>
        </>
      )}
    </>
  );
}

const boundText = (b: { date: string | null; moment: string | null }) =>
  `${b.date ? formatDate(b.date) : "date n.d."} (${b.moment ? (ABSENCE_MOMENT_LABELS[b.moment] ?? b.moment) : "moment n.d."})`;
const statusText = (s: string | null) => (s === null ? "n.d." : (ABSENCE_STATUS_LABELS[s] ?? s));

export function AbsenceMonthDetail({ id, v, theoretical, maps, slug }: { id: "theoretical" | "absenteeism"; v: AbsenteeismMonth; theoretical: TheoreticalMonth; maps: Maps; slug: string }) {
  return (
    <>
      <h3>Jours théoriques</h3>
      {theoretical.kind === "nd" ? (
        <p className="nd">n.d. — {theoretical.nd.reason}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table" data-testid="kpi-detail-theoretical">
            <thead><tr><th>Personne</th><th>Contrat</th><th>Du</th><th>Au</th><th className="num">Jours</th><th>Provenance</th></tr></thead>
            <tbody>
              {theoretical.contributions.map((t) => (
                <tr key={t.contractKey}>
                  <td><Person personKey={t.personKey} contractKey={t.contractKey} maps={maps} slug={slug} /></td>
                  <td><ContractLink contractKey={t.contractKey} externalId={t.externalId} slug={slug} /></td>
                  <td>{formatDate(t.from)}</td>
                  <td>{formatDate(t.to)}</td>
                  <td className="num">{fmtInt(t.days)}</td>
                  <td><Prov p={t.provenance} slug={slug} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Absences comptées</h3>
      {v.kind === "nd" ? (
        <p className="nd">n.d. — {v.nd.reason}</p>
      ) : v.slices.length === 0 ? (
        <p className="muted" data-testid="kpi-detail-absences-empty">Aucune absence des types et statuts retenus dans le mois.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table" data-testid="kpi-detail-absences">
            <thead>
              <tr>
                <th>Absence</th><th>Personne</th><th>Contrat</th><th>Type</th><th>Statut</th><th className="wrap">Début</th><th className="wrap">Fin</th><th className="wrap">Retenu dans le mois</th>
                <th className="num">Demi-journées ajoutées</th><th className="num">Déjà couvertes</th><th className="num">Incertaines</th><th className="num">Hors contrat (j)</th><th className="wrap">Notes</th>
              </tr>
            </thead>
            <tbody>
              {v.slices.map((s) => (
                <tr key={`${s.absenceId}-${s.contractKey}`}>
                  <td><code>{s.absenceId}</code></td>
                  <td><Person personKey={s.personKey} contractKey={s.contractKey} maps={maps} slug={slug} /></td>
                  <td><ContractLink contractKey={s.contractKey} externalId={s.externalId} slug={slug} /></td>
                  <td><AbsenceType code={s.type} withCode /></td>
                  <td>{statusText(s.status)}</td>
                  <td className="wrap">{boundText(s.start)}</td>
                  <td className="wrap">{boundText(s.end)}</td>
                  <td className="wrap">{formatDate(s.from)} → {formatDate(s.to)}</td>
                  <td className="num">{s.half} ({fmtHalfDays(s.half)})</td>
                  <td className="num">{s.overlap}</td>
                  <td className="num">{s.uncertain ? <span className="lower">{s.uncertain}</span> : 0}</td>
                  <td className="num">{s.outsideContract}</td>
                  <td className="wrap">{s.notes.length ? s.notes.join(" · ") : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v.kind !== "nd" && v.excluded.length > 0 && (
        <>
          <h3>Absences non comptées</h3>
          <div className="table-wrap">
            <table className="data-table" data-testid="kpi-detail-excluded">
              <thead><tr><th>Absence</th><th>Contrat</th><th>Type</th><th>Statut</th><th className="num">Incertaines</th><th className="wrap">Raison</th></tr></thead>
              <tbody>
                {v.excluded.map((x) => (
                  <tr key={`${x.absenceId}-${x.why}`}>
                    <td><code>{x.absenceId}</code></td>
                    <td><code>{x.contractId}</code></td>
                    <td><AbsenceType code={x.type} withCode /></td>
                    <td>{statusText(x.status)}</td>
                    <td className="num">{x.uncertain ? <span className="lower">{x.uncertain}</span> : 0}</td>
                    <td className="wrap">{x.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {id === "theoretical" ? (
        theoretical.kind === "nd" ? (
          <Total nd>n.d. — {theoretical.nd.reason}</Total>
        ) : (
          <Total>Σ jours théoriques = {fmtHalfDays(theoretical.half)} ({theoretical.contributions.length} contrat{theoretical.contributions.length > 1 ? "s" : ""})</Total>
        )
      ) : v.kind === "nd" ? (
        <Total nd>n.d. — {v.nd.reason}</Total>
      ) : (
        <Total>
          {v.kind === "lower_bound" ? "≥ " : ""}
          {v.ratio.num} demi-journées = {fmtHalfDays(v.ratio.num)} ÷ {fmtHalfDays(v.ratio.den)} = {fmtPercent(v.ratio)}
          {v.qualifiers.length > 0 && <> — {v.qualifiers.join(" · ")}</>}
        </Total>
      )}
    </>
  );
}

export function AbsenteeismWindowDetail({ v, theoretical, detailHref }: { v: Absenteeism; theoretical: TheoreticalWindow; detailHref: (id: string, month: string) => string }) {
  // Une ligne par mois : jours théoriques (toujours calculés s'ils le peuvent) et absences (n.d. avec la raison de la période
  // quand l'absentéisme s'arrête avant le calcul mensuel : arrêts DSN non extraits, types non choisis, absences non lues).
  const abs = new Map(v.months.map((m) => [m.month, m]));
  const th = new Map(theoretical.months.map((m) => [m.month, m]));
  const months = [...new Set([...theoretical.months.map((m) => m.month), ...v.months.map((m) => m.month)])].sort();
  const absNd = (m: string): Shown => ({ text: `n.d. — ${v.kind === "nd" && !abs.has(m) ? v.nd.reason : "absentéisme du mois non calculé"}`, kind: "nd" });
  const thNd: Shown = { text: `n.d. — ${theoretical.kind === "nd" ? theoretical.nd.reason : "jours théoriques du mois non calculés"}`, kind: "nd" };
  return (
    <>
      {months.length > 0 && (
        <div className="table-wrap">
          <table className="data-table" data-testid="kpi-detail-months">
            <thead><tr><th>Mois</th><th className="num">Jours d'absence</th><th className="num">Jours théoriques</th><th className="num">Absentéisme</th></tr></thead>
            <tbody>
              {months.map((m) => {
                const a = abs.get(m);
                const t = th.get(m);
                return (
                  <tr key={m} data-month={m}>
                    <td>{m}</td>
                    <Cell col="absence-days" shown={a ? absenceDaysShown(a) : absNd(m)} href={detailHref("absenteeism", m)} />
                    <Cell col="theoretical" shown={t ? theoreticalShown(t) : thNd} href={detailHref("theoretical", m)} />
                    <Cell col="absenteeism" shown={a ? absenteeismShown(a) : absNd(m)} href={detailHref("absenteeism", m)} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {theoretical.kind === "nd" ? (
        <p className="nd" data-testid="kpi-detail-theoretical-total">Σ jours théoriques : n.d. — {theoretical.nd.reason}</p>
      ) : (
        <p className="desc" data-testid="kpi-detail-theoretical-total">
          <strong>Σ jours théoriques = {fmtHalfDays(theoretical.half)}</strong> ({theoretical.months.length} mois, contrats comptés présents, {theoretical.half} demi-journées)
        </p>
      )}
      {v.kind === "nd" ? (
        <Total nd>Absentéisme : n.d. — {v.nd.reason}</Total>
      ) : (
        <Total>
          {v.kind === "lower_bound" ? "≥ " : ""}
          {v.ratio.num} demi-journées = {fmtHalfDays(v.ratio.num)} ÷ {fmtHalfDays(v.ratio.den)} = {fmtPercent(v.ratio)}
          {v.qualifiers.length > 0 && <> — {v.qualifiers.join(" · ")}</>}
        </Total>
      )}
    </>
  );
}

// --- Paramètres en vigueur (les définitions, les raisons des n.d. et les écarts entre sources sont au glossaire)

// Règles de l'espace qui commandent les calculs, avec leur origine : un bloc replié, un « ? » vers l'explication de l'origine.
export function KpiParams({ slug, params }: { slug: string; params: { label: string; value: string; origin: string; testId: string }[] }) {
  return (
    <details className="panel" data-testid="kpi-params-block" id="parametres-en-vigueur">
      <summary>Paramètres en vigueur</summary>
      <dl className="defs" data-testid="kpi-params">
        {params.map((p) => (
          <div key={p.testId} data-testid={`kpi-param-${p.testId}`}>
            <dt>{p.label}</dt>
            <dd>{p.value} — <span className="muted">{p.origin}</span></dd>
          </div>
        ))}
      </dl>
      <p className="desc">
        <a href={`/e/${slug}/parametres#kpi`}>Paramètres › Définitions des KPI</a>
        <GlossaryLink slug={slug} term={KPI_TERMS.settings} />
      </p>
    </details>
  );
}

export const monthLabel = (m: string) => formatMonth(m).toLowerCase();
export const natureList = (codes: string[]) => codes.map((c) => contractNatureLabel(c)).join(", ");
export { showHeadcount, showCount };
