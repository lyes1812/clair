import { Money, MoneyUnitLabel } from "@/components/Money";
import { formatDate } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import type { AgedInfo } from "@/lib/restructuring/crisis/context";
import { AGING_LABELS, cashToOverdue, claimsByRank, exigibilityLabel, HORIZON_WEEKS, weekStartOf, type Claim, type ClaimsView } from "@/lib/restructuring/crisis/claims";
import { RANKS, type Amount, type RankSettings } from "@/lib/restructuring/crisis/model";
import { PanelHead, Tile } from "../studio-rh/masse-salariale/components";
import { ActionForm } from "../studio-rh/hypotheses/ActionForm";
import type { FormState } from "../studio-rh/hypotheses/actions";

// Cap 13, lot L3 : passif par créance (balance âgée fournisseurs + soldes du FEC), exigibilité, rapprochement et rang par créance.
export type ClaimsAction = (previous: FormState, form: FormData) => Promise<FormState>;
type Value = Extract<ClaimsView, { kind: "value" }>;
const rankLabel = (id: string | null) => RANKS.find((rank) => rank.id === id)?.label ?? null;

function AgedNotice({ aged, slug, exercise, asOf }: { aged: AgedInfo | null; slug: string; exercise: string | null; asOf: string }) {
  if (!aged) return <p className="notice" data-testid="claims-aged-none">Aucune balance âgée fournisseurs appliquée : les fournisseurs sont lus dans le FEC, un solde par compte auxiliaire, sans échéance. <a href={`/e/${slug}/donnees/aged`}>Déposer la balance âgée</a></p>;
  if (aged.used) return <p className="desc" data-testid="claims-aged-used">Balance âgée appliquée : {aged.filename}, arrêtée au {formatDate(aged.asOf)}, {aged.count} facture{aged.count === 1 ? "" : "s"}.</p>;
  const href = `/e/${slug}/studio-restructuring?${new URLSearchParams({ vue: "crisis", ...(exercise ? { exercice: exercise } : {}), date: aged.asOf })}`;
  return <p className="notice" data-testid="claims-aged-other-date">La balance âgée appliquée est arrêtée au {formatDate(aged.asOf)}, pas au {formatDate(asOf)} : elle n’est pas utilisée ici, les fournisseurs sont lus dans le FEC. {aged.dateInExercise ? <a href={href}>Afficher au {formatDate(aged.asOf)}</a> : "Cette date est hors de l’exercice affiché."}</p>;
}

function Control({ v }: { v: Value }) {
  const c = v.control;
  if (c.kind === "nd") return null;
  // Écart au centime, hors arrondi d'affichage.
  return <div className="claims-block" data-testid="claims-control" data-strong={c.strong ? "true" : "false"}>
    <p className={c.gapCents === 0 ? "desc" : "notice"}>Contrôle balance âgée ↔ FEC 401 : balance {formatEuros(c.agedCents)}, FEC {formatEuros(c.fecCents)}, écart {formatEuros(c.gapCents)}{c.strong ? " · avertissement fort (plus de 2 % ou de 5 000 €)" : c.gapCents !== 0 ? " · avertissement" : " · conforme"}.</p>
    {c.lines.length ? <div className="table-wrap"><table className="data-table" data-testid="claims-control-lines"><thead><tr><th scope="col">Fournisseur</th><th scope="col">Auxiliaire</th><th scope="col" className="num">Balance âgée</th><th scope="col" className="num">FEC 401</th><th scope="col" className="num">Écart</th></tr></thead>
      <tbody>{c.lines.map((l) => <tr key={`${l.auxiliary ?? ""}|${l.creditor}`}><th scope="row">{l.creditor}</th><td>{l.auxiliary ?? "—"}</td><td className="num">{formatEuros(l.agedCents)}</td><td className="num">{formatEuros(l.fecCents)}</td><td className="num">{formatEuros(l.gapCents)}</td></tr>)}</tbody></table></div> : null}
  </div>;
}

function Schedule({ v }: { v: Value }) {
  const t = v.totals;
  const rows: [string, number, string][] = [
    ["Échu à la date d’arrêté", t.echuCents, "echu"],
    ...t.weeks.map((cents, w) => [`Semaine ${w + 1} (à partir du ${formatDate(weekStartOf(v.asOf, w + 1))})`, cents, `s${w + 1}`] as [string, number, string]),
    [`Au-delà de ${HORIZON_WEEKS} semaines`, t.auDelaCents, "au-dela"],
    ["Sans échéance connue (n.d., non estimée)", t.ndCents, "nd"],
  ];
  return <div className="table-wrap" data-testid="claims-schedule"><table className="data-table"><thead><tr><th scope="col">Exigibilité</th><th scope="col" className="num">Passif exigible</th></tr></thead>
    <tbody>{rows.filter(([, cents, id]) => cents !== 0 || id === "echu" || id === "nd").map(([label, cents, id]) => <tr key={id} data-testid={`claims-schedule-${id}`}><th scope="row">{label}</th><td className="num"><Money cents={cents} /></td></tr>)}</tbody>
    <tfoot>
      <tr><th scope="row">Total du passif exigible</th><td className="num" data-testid="claims-exigible"><Money cents={t.exigibleCents} /></td></tr>
      {t.nonExigibleCents ? <tr><th scope="row">Charges à payer, non exigibles (gardées à échoir)</th><td className="num"><Money cents={t.nonExigibleCents} /></td></tr> : null}
      {t.payeeCents ? <tr><th scope="row">Factures payées depuis la date d’arrêté (retirées)</th><td className="num"><Money cents={t.payeeCents} /></td></tr> : null}
    </tfoot></table></div>;
}

function ByRank({ v }: { v: Value }) {
  const r = claimsByRank(v.claims);
  return <div className="table-wrap" data-testid="claims-by-rank"><table className="data-table"><thead><tr><th scope="col">Rang</th><th scope="col" className="num">Créances</th><th scope="col" className="num">Passif exigible</th></tr></thead>
    <tbody>{r.totals.map((t) => <tr key={t.id}><th scope="row">{t.label}</th><td className="num">{t.count}</td><td className="num"><Money cents={t.cents} /></td></tr>)}
      <tr data-testid="claims-unranked"><th scope="row">Rang non choisi</th><td className="num">{r.unrankedCount}</td><td className="num">{r.unrankedCount ? <><Money cents={r.unrankedCents} /> <small className="nd">à classer</small></> : <Money cents={0} />}</td></tr></tbody></table></div>;
}

function Aging({ v }: { v: Value }) {
  if (!v.claims.some((c) => c.source === "balance")) return null;
  return <div className="table-wrap" data-testid="claims-aging"><table className="data-table"><thead><tr><th scope="col">Tranche (recalculée par Clair)</th><th scope="col" className="num">Factures</th><th scope="col" className="num">Montant</th></tr></thead>
    <tbody>{v.aging.map((a) => <tr key={a.bucket}><th scope="row">{AGING_LABELS[a.bucket]}</th><td className="num">{a.count}</td><td className="num"><Money cents={a.cents} /></td></tr>)}</tbody></table></div>;
}

function matchText(c: Claim) {
  const parts: string[] = [];
  if (c.source === "balance") parts.push(c.fecMatch ? `FEC règle ${c.fecMatch.rule} (${formatDate(c.fecMatch.date)}${c.fecMatch.pieceRef ? `, ${c.fecMatch.pieceRef}` : ""})` : "FEC : non rapprochée");
  if (c.paid) parts.push(`banque règle ${c.paid.rule} : payée le ${formatDate(c.paid.date)}`);
  return parts.join(" · ") || "—";
}

function ClaimRows({ v, ranks, editable }: { v: Value; ranks: RankSettings | null; editable: boolean }) {
  return <div className="table-wrap scroll restructuring-scroll" tabIndex={0} role="region" aria-label="Créances"><table className="data-table" data-testid="claims-table"><thead><tr><th scope="col">Créancier</th><th scope="col">Nature</th><th scope="col">Facture</th><th scope="col" className="num">Montant</th><th scope="col">Échéance</th><th scope="col">Exigibilité</th><th scope="col">Rang</th><th scope="col">Rapprochement</th></tr></thead>
    <tbody>{v.claims.map((c) => {
      const inherited = rankLabel(ranks?.[c.nature] ?? null);
      return <tr key={c.key} data-testid={`claim-${c.key}`} data-exigibility={c.exigibility.kind}>
        <th scope="row">{c.creditor}<small>{c.source === "balance" ? "Balance âgée" : `FEC ${c.accountId}`}{c.auxiliary ? ` · ${c.auxiliary}` : ""}</small></th>
        <td>{c.natureLabel}</td>
        <td>{c.invoice ? <>{c.invoice}<small>{c.invoiceDate ? formatDate(c.invoiceDate) : ""}</small></> : "—"}</td>
        <td className="num"><Money cents={c.amountCents} /></td>
        <td>{editable && c.exigibility.kind !== "non_exigible" ? <>
          <input type="hidden" name="claim" value={c.key} />
          <input type="date" className="input" name={`due-${c.key}`} aria-label={`Échéance saisie — ${c.creditor}${c.invoice ? ` ${c.invoice}` : ""}`} defaultValue={c.dueOrigin === "saisie" ? c.dueDate ?? "" : ""} />
          <small>{c.dueOrigin === "lue" ? `Lue : ${formatDate(c.dueDate)}` : c.dueOrigin === "saisie" ? "Saisie" : "n.d. — à saisir"}</small>
        </> : c.dueDate ? <>{formatDate(c.dueDate)}<small>{c.dueOrigin}</small></> : <span className="nd">n.d.</span>}</td>
        <td>{c.exigibility.kind === "nd" ? <span className="nd" title={c.exigibility.reason}>n.d.</span> : exigibilityLabel(c.exigibility, v.asOf)}</td>
        <td>{editable && c.exigibility.kind !== "non_exigible" ? <select className="select" name={`rank-${c.key}`} aria-label={`Rang — ${c.creditor}${c.invoice ? ` ${c.invoice}` : ""}`} defaultValue={c.rankOrigin === "creance" ? c.rank ?? "" : ""}>
          <option value="">{inherited ? `Hérité : ${inherited}` : "Non choisi"}</option>{RANKS.map((rank) => <option key={rank.id} value={rank.id}>{rank.label}</option>)}</select>
          : rankLabel(c.rank) ?? <span className="nd">n.d. — non choisi</span>}</td>
        <td className="wrap">{matchText(c)}</td>
      </tr>;
    })}</tbody></table></div>;
}

export function ClaimsSection({ claims, aged, notices, slug, exercise, asOf, ranks, cash, save }: { claims: ClaimsView; aged: AgedInfo | null; notices: string[]; slug: string; exercise: string | null; asOf: string; ranks: RankSettings | null; cash: Amount; save?: ClaimsAction }) {
  return <section className="panel restructuring-section" data-testid="crisis-claims"><PanelHead title="Passif par créance" desc={<>Balance âgée fournisseurs et soldes du FEC à la date d’arrêté · montants en <MoneyUnitLabel /></>} />
    <AgedNotice aged={aged} slug={slug} exercise={exercise} asOf={asOf} />
    {notices.map((n) => <p className="notice" key={n}>{n}</p>)}
    {claims.kind === "nd" ? <p className="nd" data-testid="claims-nd">n.d. — {claims.reason}</p> : <>
      <dl className="facts ms-tiles four restructuring-tiles" data-testid="claims-tiles">
        <Tile testid="claims-tile-passif" main label="Passif total" value={<Money cents={claims.totals.passifCents} />} lead={`${claims.claims.length} créance${claims.claims.length === 1 ? "" : "s"}`} />
        <Tile testid="claims-tile-exigible" label="Passif exigible" value={<Money cents={claims.totals.exigibleCents} />} lead="Hors charges à payer et factures payées depuis" />
        <Tile testid="claims-tile-echu" label="Dont échu" value={<Money cents={claims.totals.echuCents} />} lead={claims.totals.ndCents ? "Les créances sans échéance ne sont pas comptées comme échues" : "Échéance au plus tard à la date d’arrêté"} />
        {(() => {
          const r = cashToOverdue(cash.cents, claims.totals.echuCents);
          return <Tile testid="claims-tile-indicator" label="Disponibilités / passif échu" value={r.kind === "nd" ? "n.d." : (r.hundredths / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} nd={r.kind === "nd"} lead={r.kind === "nd" ? (cash.cents === null ? cash.reason ?? r.reason : r.reason) : "Indicateur seulement : appréciation juridique réservée au professionnel. Autorisations de découvert non saisies."} />;
        })()}
      </dl>
      <p className="desc" data-testid="claims-reconciliation">Passif total {formatEuros(claims.reconciliation.passifCents)} = dettes du FEC {formatEuros(claims.reconciliation.fecDebtCents)} − fournisseurs couverts par la balance âgée {formatEuros(claims.reconciliation.coveredFecCents)} + balance âgée {formatEuros(claims.reconciliation.agedCents)}.</p>
      <Control v={claims} />
      {claims.warnings.length ? <ul className="restructuring-notices" data-testid="claims-warnings">{claims.warnings.map((w) => <li className="notice" key={w}>{w}</li>)}</ul> : null}
      <div className="claims-grid"><Schedule v={claims} /><ByRank v={claims} /><Aging v={claims} /></div>
      {save ? <ActionForm action={save} submit="Enregistrer rangs et échéances" testid="claims-form" className="form">
        <ClaimRows v={claims} ranks={ranks} editable />
        <p className="desc">Rang vide : hérité de la nature. Échéance vide : celle de la balance âgée, sinon n.d. Aucune échéance n’est estimée.</p>
      </ActionForm> : <><ClaimRows v={claims} ranks={ranks} editable={false} /><p className="desc">Les rangs et échéances sont saisis par un éditeur ou un administrateur de l’espace.</p></>}
    </>}
  </section>;
}
