import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate } from "@/lib/dates";
import { MODALITY_LABELS, quotaUnitLabel } from "@/lib/dsn/labels";
import type { ContractDraft, ContractMonthDraft, EventDraft, PersonDraft, RhBuildData } from "@/lib/rh/referential/types";
import type { AbsenceRow } from "@/lib/rh/referential/store";
import { END_STATUS_LABELS, EVENT_FLAG_LABELS, fmtNumber, MONTH_FLAG_LABELS, timeUnitLabel } from "@/lib/rh/view";
import { EndCell, Field, FlagTags, Nature, personHref, Prov, ProvenanceDetails } from "./components";

// Fiche d'un contrat : identité, fin, attributs à la date de lecture (PayFit), table par mois, événements, absences.
const ABSENCE_STATUS: Record<string, string> = { approved: "approuvée", pending_approval: "en attente d'approbation", declined: "refusée", cancelled: "annulée", pending_cancellation: "annulation en attente" };
const MOMENT: Record<string, string> = { "beginning-of-day": "début de journée", "middle-of-day": "mi-journée", "end-of-day": "fin de journée" };

export function ContractPanel({ c, data, slug, person, months, events, absences }: { c: ContractDraft; data: RhBuildData; slug: string; person: PersonDraft | null; months: ContractMonthDraft[]; events: EventDraft[]; absences: AbsenceRow[] | null }) {
  const isPayfit = data.build.source === "payfit";
  const ref = data.build.referenceDate ? formatDate(data.build.referenceDate) : "n.d.";
  return (
    <section className="panel" data-testid="collab-contract" data-contract={c.externalId}>
      <h2>Contrat <code>{c.externalId}</code> <span className="desc">— {END_STATUS_LABELS[c.endStatus]}</span></h2>
      <dl className="facts">
        <div><dt>Identifiant</dt><dd><Field row={c} field="externalId" value={c.externalId} slug={slug} /></dd></div>
        <div><dt>Personne</dt><dd>{person ? <a href={personHref(slug, person.personKey)}>{[person.familyName, person.givenNames].filter(Boolean).join(" ") || person.externalId}</a> : <span className="nd">n.d. — {c.fieldsNd.personKey?.reason ?? "contrat sans collaborateur"}</span>}</dd></div>
        <div><dt>Établissement</dt><dd><Field row={c} field="establishmentId" value={c.establishmentId} slug={slug} format={(v) => <code>{v}</code>} /></dd></div>
        <div><dt>Nature</dt><dd><Field row={c} field="nature" value={c.nature} slug={slug} format={(v) => <Nature code={v} />} /></dd></div>
        <div><dt>Début</dt><dd><Field row={c} field="startDate" value={c.startDate} slug={slug} format={formatDate} /></dd></div>
        <div><dt>Fin</dt><dd><EndCell c={c} slug={slug} /></dd></div>
        {isPayfit && (
          <>
            <div><dt>Statut PayFit</dt><dd><Field row={c} field="statusSource" value={c.statusSource} slug={slug} /> <span className="desc">(à la date de lecture, non utilisé pour compter)</span></dd></div>
            <div><dt>ETP contractuel</dt><dd><Field row={c} field="fteAtRead" value={c.fteAtRead} slug={slug} format={fmtNumber} /> <span className="desc">à la date de lecture du {ref}</span></dd></div>
            <div><dt>Heures hebdomadaires</dt><dd><Field row={c} field="weeklyHoursAtRead" value={c.weeklyHoursAtRead} slug={slug} format={fmtNumber} /></dd></div>
            <div><dt>Temps plein</dt><dd><Field row={c} field="isFullTimeAtRead" value={c.isFullTimeAtRead} slug={slug} format={(v) => (v ? "oui" : "non")} /></dd></div>
            <div><dt>Modalité</dt><dd><Field row={c} field="modalityAtRead" value={c.modalityAtRead} slug={slug} /></dd></div>
            <div><dt>Cadre dirigeant</dt><dd><Field row={c} field="executive" value={c.executive} slug={slug} format={(v) => (v ? "oui" : "non")} /></dd></div>
          </>
        )}
        {!isPayfit && (
          <>
            <div><dt>Première déclaration</dt><dd><Field row={c} field="firstDeclaredMonth" value={c.firstDeclaredMonth} slug={slug} /></dd></div>
            <div><dt>Dernière déclaration</dt><dd><Field row={c} field="lastDeclaredMonth" value={c.lastDeclaredMonth} slug={slug} /></dd></div>
          </>
        )}
      </dl>

      <h3>Par mois</h3>
      <div className="table-wrap contract-months">
        <table className="data-table" data-testid="contract-months">
          <thead>
            <tr>
              <th>Mois</th><th className="wrap">{isPayfit ? "Périmètre" : "Déclaré"}</th><th>Présent fin de mois</th><th>Nature</th><th className="wrap">Quotités</th><th className="wrap">Temps payé / travaillé</th>{!isPayfit && <th className="num">Versements</th>}<th>Drapeaux</th><th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={`${m.month}-${m.establishmentId}`}>
                <td>{m.month}</td>
                <td className="wrap">{m.presenceBasis === "dates" ? (m.fieldsNd.paidTime?.code === "month-out-of-scope" ? "mois hors périmètre de la lecture" : "mois lu") : m.presenceBasis === "declared" ? `déclaré (${m.establishmentId})` : "non déclaré"}</td>
                <td>{m.presentMonthEnd ? "oui" : "non"}</td>
                <td>{isPayfit ? <span className="nd" title={m.fieldsNd.nature?.reason}>n.d. — non historisé</span> : <Field row={m} field="nature" value={m.nature} slug={slug} format={(v) => <Nature code={v} />} prov={false} />}</td>
                <td className="wrap">
                  {isPayfit ? <span className="nd">n.d. — non historisé par PayFit</span> : m.contractQuota !== null || m.referenceQuota !== null ? `${m.contractQuota === null ? "n.d." : fmtNumber(m.contractQuota)} / ${m.referenceQuota === null ? "n.d." : fmtNumber(m.referenceQuota)} ${quotaUnitLabel(m.quotaUnit)}${m.modality ? ` · ${MODALITY_LABELS[m.modality] ?? `modalité ${m.modality}`}` : ""}` : <span className="nd">n.d. — {m.fieldsNd.contractQuota?.reason}</span>}
                </td>
                <td className="wrap">
                  {m.paidTime !== null ? (m.paidTime === 0 ? "0 — sous contrat, aucun temps payé" : `${fmtNumber(m.paidTime)} ${timeUnitLabel(m.timeUnit, data.build.source)}`) : <span className="nd">n.d. — {m.fieldsNd.paidTime?.reason}</span>}
                  {" / "}
                  {m.workedTime !== null ? (m.workedTime === 0 ? "0" : `${fmtNumber(m.workedTime)} ${timeUnitLabel(m.timeUnit, data.build.source)}`) : <span className="nd">n.d. — {m.fieldsNd.workedTime?.reason}</span>}
                </td>
                {!isPayfit && <td className="num">{m.paymentCount === null ? <span className="nd">n.d.</span> : m.paymentCount === 0 ? <span title={m.fieldsNd.paymentCount?.reason}>0 — aucun versement</span> : m.paymentCount}</td>}
                <td><FlagTags flags={m.flags} labels={MONTH_FLAG_LABELS} /></td>
                <td><ProvenanceDetails row={m} slug={slug} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {months.length === 0 && <p className="muted">Aucun mois : contrat non positionnable ou hors couverture.</p>}

      <h3>Événements</h3>
      {events.length === 0 ? <p className="muted">Aucun événement (contrat non positionnable).</p> : (
        <ul className="list" data-testid="contract-events">
          {events.map((e) => (
            <li key={e.kind}>
              <span>{e.kind === "entry" ? "Entrée" : "Sortie"} le {formatDate(e.date)} <Prov p={e.provenance.date} slug={slug} />{e.kind === "exit" && (e.endReason ? <> · motif {e.endReason}</> : <> · <span className="nd">motif : n.d. — {e.fieldsNd.endReason?.reason}</span></>)}</span>
              <FlagTags flags={e.flags} labels={EVENT_FLAG_LABELS} />
            </li>
          ))}
        </ul>
      )}

      <h3>Absences</h3>
      {absences === null ? (
        <p className="nd" data-testid="contract-absences-nd">n.d. — arrêts non extraits de la DSN</p>
      ) : absences.length === 0 ? (
        <p className="muted" data-testid="contract-absences-empty">Aucune absence dans la lecture appliquée (mois lus seulement ; mois hors périmètre : n.d.).</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table" data-testid="contract-absences">
            <thead><tr><th>Type</th><th>Statut</th><th>Début</th><th>Fin</th><th>Durée</th></tr></thead>
            <tbody>
              {absences.map((a) => (
                <tr key={a.id} className={a.status === "declined" || a.status === "cancelled" ? "muted" : undefined}>
                  <td>{a.type}</td>
                  <td>{a.status ? (ABSENCE_STATUS[a.status] ?? a.status) : <span className="nd">n.d.</span>}</td>
                  <td>{a.start.date ? `${formatDate(a.start.date)}${a.start.moment ? ` (${MOMENT[a.start.moment] ?? a.start.moment})` : ""}` : <span className="nd">n.d.</span>}</td>
                  <td>{a.end.date ? `${formatDate(a.end.date)}${a.end.moment ? ` (${MOMENT[a.end.moment] ?? a.end.moment})` : ""}` : <span className="nd">n.d.</span>}</td>
                  <td><span className="nd">n.d. — PayFit ne fournit pas la durée</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="desc">Référentiel reconstruit le {dateTimeFmt.format((data.build as { builtAt?: Date }).builtAt ?? new Date(0))}.</p>
    </section>
  );
}
