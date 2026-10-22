import type { ReactNode } from "react";
import { SourceBadge } from "@/components/SourceBadge";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate, formatMonth } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { RH_DEFINITIONS } from "@/lib/rh/definitions";
import { monthRanges, payfitExactFrom, type Count, type HeadcountResult } from "@/lib/rh/headcount";
import { KPI_DEFINITIONS, KPI_ND_EXPLANATIONS, SOURCE_GAPS } from "@/lib/rh/kpi/definitions";
import { fmtEtp4, fmtFixed, fmtFraction, fmtHalfDays, fmtPercent, showKpi } from "@/lib/rh/kpi/format";
import type {
  Absenteeism,
  AbsenteeismMonth,
  Average,
  EtpBasis,
  EtpMonthEnd,
  EtpSource,
  EventContribution,
  Kind,
  KpiNd,
  MonthMovements,
  TheoreticalMonth,
  TheoreticalWindow,
  Turnover,
} from "@/lib/rh/kpi/types";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { ABSENCE_MOMENT_LABELS, ABSENCE_STATUS_LABELS } from "@/lib/rh/labels";
import type { ContractDraft, PersonDraft, RhBuildData } from "@/lib/rh/referential/types";
import { EVENT_FLAG_LABELS, fmtInt, fmtNumber, showCount, showHeadcount, timeUnitLabel, type Shown } from "@/lib/rh/view";
import { BuildInfo, contractHref, FlagTags, Nature, PersonCell, Prov } from "../collaborateurs/components";

// Composants de l'écran KPI RH : en-tête, tuiles (valeur, N-1, écart, paramètres), tableau mensuel, détail d'un chiffre.
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

export function KpiHeader({ ctx, closedMonth, children }: { ctx: KpiContext; closedMonth: string | null; children?: ReactNode }) {
  const { slug, source, state, switchedAt } = ctx.collab;
  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Studio RH</span>
        <h1>{ITEM.label}</h1>
        <p className="desc">{ITEM.summary}</p>
        <SourceBadge resolution={source} slug={slug} />
        <BuildInfo ctx={ctx.collab} />
        {switchedAt && (
          <p className="notice" data-testid="source-switch-notice">
            Source RH changée le {dateTimeFmt.format(switchedAt)} par un administrateur ({source.reason}). Les identifiants PayFit et DSN sont distincts : aucune comparaison n'est faite entre les deux sources.
          </p>
        )}
        {ctx.collab.data && (
          <p className="desc" data-testid="kpi-closed-month">
            Dernier mois clos : {closedMonth ? <strong>{closedMonth}</strong> : <span className="nd">n.d. — aucun mois clos à la date de référence</span>}
          </p>
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

// PayFit : quotités à la lecture et limite de conservation des contrats archivés (au jour près pour l'effectif).
export function PayfitNotice({ data }: { data: RhBuildData }) {
  if (data.build.source !== "payfit") return null;
  const lower = [...new Set(data.coverage.filter((c) => c.presenceStatus === "lower_bound").map((c) => c.month))].sort();
  const exactFrom = payfitExactFrom(data);
  return (
    <p className="notice" data-testid="kpi-payfit-notice">
      Quotités à la date de lecture ({formatDate(data.build.referenceDate)}), non historisées par PayFit : la même quotité sert pour tous les mois, N-1 compris.{" "}
      {lower.length > 0 && exactFrom ? (
        <>
          PayFit ne renvoie plus les contrats archivés depuis plus de 12 mois (constaté sur le compte pilote, à vérifier pour chaque espace) : l'effectif et l'ETP sont exacts à partir du {formatDate(exactFrom)} ; les entrées, sorties et
          absences des mois {monthRanges(lower)} sont incomplètes, et tout turnover ou absentéisme d'une période qui contient l'un de ces mois est n.d.
        </>
      ) : (
        <>Aucun mois de la lecture n'est en borne basse.</>
      )}
    </p>
  );
}

// --- Tuiles

export function KpiTile(props: {
  id: string;
  label: string;
  shown: Shown;
  title?: string;
  n1: string;
  delta: string;
  params: string;
  qualifiers?: string[];
  def: string;
  detail: string;
  children?: ReactNode;
}) {
  const { id, label, shown, title, n1, delta, params, qualifiers = [], def, detail, children } = props;
  return (
    <div data-testid={`kpi-tile-${id}`}>
      <dt>{label}</dt>
      <dd className={cls(shown)} title={title}>{shown.text}</dd>
      {[...new Set(qualifiers)].map((q) => <span key={q} className="tile-foot">{q}</span>)}
      <span className="tile-foot" data-testid={`kpi-tile-${id}-n1`}>{n1}</span>
      <span className="tile-foot" data-testid={`kpi-tile-${id}-delta`}>écart : {delta}</span>
      <span className="tile-foot" data-testid={`kpi-tile-${id}-params`}>{params}</span>
      {children}
      <span className="tile-foot">
        <a href={`#def-${def}`}>Définition</a> · <a href={detail}>Détail</a>
      </span>
    </div>
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
export function NdReasons({ items }: { items: { month: string; shown: Shown }[] }) {
  const byReason = new Map<string, string[]>();
  for (const { month, shown } of items) {
    if (shown.kind !== "nd") continue;
    const r = ndReason(shown);
    byReason.set(r, [...new Set([...(byReason.get(r) ?? []), month])].sort());
  }
  if (!byReason.size) return null;
  return (
    <div data-testid="kpi-nd-reasons">
      <h3>Raisons des « n.d. » du tableau</h3>
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

export function HeadcountDetail({ v, maps, slug, month }: { v: HeadcountResult; maps: Maps; slug: string; month: string }) {
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
                  <td><Nature code={c?.nature ?? null} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Total>
        Σ {v.kind === "lower_bound" ? "≥" : "="} {fmtInt(v.persons)} personne{v.persons > 1 ? "s" : ""} ({fmtInt(v.contracts)} contrat{v.contracts > 1 ? "s" : ""}) ·{" "}
        <a href={`/e/${slug}/studio-rh/collaborateurs?mois=${month}`}>liste du mois dans Collaborateurs</a>
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

export function TurnoverDetail({ v, maps, slug, detailHref }: { v: Turnover; maps: Maps; slug: string; detailHref: (id: string, month: string | null) => string }) {
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
        <Total>
          S ÷ effectif au {formatDate(v.base.date)} = {v.exits} ÷ {v.base.persons} = {fmtPercent(v.ratio)}
          {v.qualifiers.length > 0 && <> — {v.qualifiers.join(" · ")}</>}
        </Total>
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
                  <td><code>{s.type}</code></td>
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
              <thead><tr><th>Absence</th><th>Contrat</th><th>Type</th><th>Statut</th><th className="wrap">Raison</th></tr></thead>
              <tbody>
                {v.excluded.map((x) => (
                  <tr key={`${x.absenceId}-${x.why}`}>
                    <td><code>{x.absenceId}</code></td>
                    <td><code>{x.contractId}</code></td>
                    <td><code>{x.type}</code></td>
                    <td>{statusText(x.status)}</td>
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
          {v.ratio.num} demi-journées = {fmtHalfDays(v.ratio.num)} ÷ {fmtHalfDays(v.ratio.den)} = {fmtPercent(v.ratio)} (somme des jours ÷ somme des jours théoriques, jamais une moyenne de taux)
          {v.qualifiers.length > 0 && <> — {v.qualifiers.join(" · ")}</>}
        </Total>
      )}
    </>
  );
}

// --- Définitions, paramètres en vigueur, n.d., écarts entre sources

const RH_REUSED = new Set(["presence", "headcount-persons", "movements", "reference-date", "lower-bound"]);

export function KpiDefinitions({ slug, params }: { slug: string; params: { label: string; value: string; origin: string; testId: string }[] }) {
  return (
    <details className="panel" data-testid="kpi-definitions" id="definitions">
      <summary>Définitions, paramètres et raisons des « n.d. »</summary>
      <dl className="defs">
        {KPI_DEFINITIONS.map((d) => (
          <div key={d.id} id={`def-${d.id}`}>
            <dt>{d.title}</dt>
            <dd>{d.text}</dd>
          </div>
        ))}
        {RH_DEFINITIONS.filter((d) => RH_REUSED.has(d.id)).map((d) => (
          <div key={d.id} id={`def-${d.id}`}>
            <dt>{d.title}</dt>
            <dd>{d.text}</dd>
          </div>
        ))}
      </dl>
      <h3>Paramètres en vigueur</h3>
      <dl className="defs" data-testid="kpi-params">
        {params.map((p) => (
          <div key={p.testId} data-testid={`kpi-param-${p.testId}`}>
            <dt>{p.label}</dt>
            <dd>{p.value} — <span className="muted">{p.origin}</span></dd>
          </div>
        ))}
      </dl>
      <p className="desc">
        Modifiables par un administrateur dans <a href={`/e/${slug}/parametres#kpi`}>Paramètres › Définitions des KPI</a>.
      </p>
      <h3>Ce qui est « n.d. » et pourquoi</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Cas</th><th className="wrap">Règle</th></tr></thead>
          <tbody>
            {KPI_ND_EXPLANATIONS.map(([k, v]) => (
              <tr key={k}><td>{k}</td><td className="wrap">{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Écarts entre PayFit et DSN</h3>
      <div className="table-wrap">
        <table className="data-table" data-testid="kpi-source-gaps">
          <thead><tr><th>Sujet</th><th className="wrap">PayFit</th><th className="wrap">DSN</th></tr></thead>
          <tbody>
            {SOURCE_GAPS.map(([k, p, d]) => (
              <tr key={k}><td>{k}</td><td className="wrap">{p}</td><td className="wrap">{d}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export const monthLabel = (m: string) => formatMonth(m).toLowerCase();
export const natureList = (codes: string[]) => codes.map((c) => contractNatureLabel(c)).join(", ");
export { showHeadcount, showCount };
