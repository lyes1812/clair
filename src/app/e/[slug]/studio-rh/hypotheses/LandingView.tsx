import { formatEuros } from "@/lib/money";
import type { Measures, Retraite, SensitivityRow, VariantKind } from "@/lib/budget/lot3";
import { VARIANT_LABELS } from "@/lib/budget/lot3";
import type { Landing } from "@/lib/budget/engine";
import type { Hypothesis } from "@/lib/budget/types";

const signed = (c: number) => `${c > 0 ? "+" : ""}${formatEuros(c)}`;

// Variations proposées pour chaque hypothèse (unité écrite dans le libellé ; aucune valeur par défaut).
export function variantOptions(hyps: Hypothesis[]): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const add = (h: Hypothesis, k: VariantKind) => out.push({ value: `${h.id}|${k}`, label: `${h.label} — ${VARIANT_LABELS[k]}` });
  for (const h of hyps) {
    if (h.kind === "depart") {
      add(h, "jours");
      if (h.exitCost) add(h, "sortie-pct");
    }
    if (h.kind === "embauche") add(h, "jours");
    if (h.kind === "augmentation") add(h, "taux");
    if (h.kind === "ponctuel" || h.kind === "realise") add(h, "pct");
  }
  return out;
}

export function LandingView({
  hrefBase, scenarioId, year, landing, retraite, measures, sens, options, chosen,
}: {
  hrefBase: string; scenarioId: string; year: string; landing: Landing; retraite: Retraite; measures: Measures;
  sens: SensitivityRow[]; options: { value: string; label: string }[]; chosen: { value: string; delta: string }[];
}) {
  const rows = chosen.length ? chosen : [{ value: "", delta: "" }];
  return (
    <>
      <section className="panel" data-testid="atr-retraite">
        <h2>Atterrissage {year} retraité <span className="desc">— <a href="#def-retraite">Définition</a></span></h2>
        <dl className="facts">
          <div data-testid="atr-tile-landing">
            <dt>Atterrissage {year}</dt>
            <dd className={landing.kind === "nd" ? "nd" : undefined}>{landing.kind === "nd" ? `n.d. — ${landing.reason}` : formatEuros(landing.total)}</dd>
          </div>
          <div data-testid="atr-tile-retire">
            <dt>Éléments non récurrents retirés</dt>
            <dd className={retraite.kind === "nd" ? "nd" : undefined}>{retraite.kind === "nd" ? "n.d." : formatEuros(retraite.total)}</dd>
            {retraite.kind === "value" && <span className="tile-foot">déjà en comptabilité {formatEuros(retraite.realised)} + prévus {formatEuros(retraite.projected)}</span>}
          </div>
          <div data-testid="atr-tile-retraite">
            <dt>Atterrissage {year} retraité</dt>
            <dd className={retraite.kind === "nd" ? "nd" : undefined}>{retraite.kind === "nd" ? `n.d. — ${retraite.reason}` : formatEuros(retraite.retraite)}</dd>
          </div>
        </dl>
        {retraite.kind === "value" && (
          <div className="table-wrap">
            <table className="data-table" data-testid="atr-nonrec">
              <thead><tr><th>Éléments non récurrents de {year}</th><th className="num">Déjà dans les comptes</th><th className="num">D'ici décembre (hypothèses)</th><th className="num">Total</th></tr></thead>
              <tbody>
                {retraite.rows.length === 0 && <tr><td colSpan={4} className="desc">Aucun élément non récurrent saisi ni prévu.</td></tr>}
                {retraite.rows.map((r) => (
                  <tr key={r.label} data-row={r.label}><td>{r.label}</td><td className="num" data-col="realised">{formatEuros(r.realised)}</td><td className="num" data-col="projected">{formatEuros(r.projected)}</td><td className="num" data-col="total">{formatEuros(r.realised + r.projected)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr data-testid="atr-nonrec-total"><td>Total retiré de l'atterrissage</td><td className="num">{formatEuros(retraite.realised)}</td><td className="num">{formatEuros(retraite.projected)}</td><td className="num" data-col="total">{formatEuros(retraite.total)}</td></tr></tfoot>
            </table>
          </div>
        )}
        <p className="tile-foot">Éléments déjà en comptabilité : saisis à la main dans Hypothèses (le journal PayFit ne les distingue pas). Prévus : coûts de sortie des départs, éléments ponctuels marqués « non récurrent », tuilages (coût de l'entrant du recouvrement avec le remplacé).</p>
      </section>

      <section className="panel" data-testid="atr-measures">
        <h2>Mesures de management — {year} <span className="desc">— un départ à la fois ; <a href="#def-mesures">Définition</a></span></h2>
        {measures.kind === "nd" ? (
          <p className="nd">n.d. — {measures.reason}</p>
        ) : measures.rows.length === 0 ? (
          <p className="desc">Aucun départ dans ce scénario.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="atr-measures-table">
              <thead><tr><th>Mesure</th><th>Dernier jour payé</th><th className="num">Paie évitée {year}</th><th className="num">Coûts de sortie</th><th className="num">Remplaçant</th><th className="num">Économie nette {year}</th><th className="num">Économie année pleine</th></tr></thead>
              <tbody>
                {measures.rows.map((m) => (
                  <tr key={m.id} data-measure={m.label}>
                    <td>{m.label} <span className="tile-foot">{m.who}</span></td>
                    <td>{m.lastPaidDate}</td>
                    <td className="num" data-col="avoided">{formatEuros(m.avoided)}</td>
                    <td className="num" data-col="exit">{formatEuros(m.exit)}</td>
                    <td className="num" data-col="replacement">{m.replacement === null ? "sans remplacement" : `${formatEuros(m.replacement)} (${m.replacementLabel})`}</td>
                    <td className="num" data-col="net">{formatEuros(m.net)}</td>
                    <td className="num" data-col="full" title={m.fullYear.kind === "nd" ? m.fullYear.reason : undefined}>{m.fullYear.kind === "nd" ? "n.d." : formatEuros(m.fullYear.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(() => {
              const nd = measures.rows.filter((m) => m.fullYear.kind === "nd").map((m) => `${m.label} : ${m.fullYear.kind === "nd" ? m.fullYear.reason : ""}`);
              return nd.length ? <p className="tile-foot nd">n.d. : {nd.join(" ; ")}</p> : null;
            })()}
          </div>
        )}
        <p className="tile-foot">Économie nette = paie évitée − coûts de sortie − coût du remplaçant lié ; positif = économie. Année pleine = 12 × (paie évitée − coût du remplaçant) du mois complet de décembre.</p>
      </section>

      <section className="panel" data-testid="atr-sens">
        <h2>Sensibilités <span className="desc">— effet d'une variation d'une hypothèse sur l'atterrissage {year} ; <a href="#def-sensibilites">Définition</a></span></h2>
        <form method="get" action={hrefBase} data-testid="atr-sens-form">
          <input type="hidden" name="scenario" value={scenarioId} />
          <input type="hidden" name="vue" value="atterrissage" />
          {rows.concat(Array.from({ length: Math.max(0, 3 - rows.length) }, () => ({ value: "", delta: "" }))).slice(0, 5).map((r, i) => (
            <div className="filters" key={i}>
              <div className="field-row">
                <label htmlFor={`sv-${i}`}>Variation {i + 1}</label>
                <select className="select" id={`sv-${i}`} name="sv" defaultValue={r.value}>
                  <option value="">—</option>
                  {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field-row">
                <label htmlFor={`sd-${i}`}>Valeur</label>
                <input className="input" id={`sd-${i}`} name="sd" inputMode="decimal" defaultValue={r.delta} />
              </div>
            </div>
          ))}
          <div className="actions"><button className="btn" type="submit">Calculer</button></div>
        </form>
        {sens.length > 0 && (
          <div className="table-wrap">
            <table className="data-table" data-testid="atr-sens-table">
              <thead><tr><th>Variation</th><th className="num">Effet sur l'atterrissage</th><th className="num">Effet sur le retraité</th><th className="num">Atterrissage après variation</th></tr></thead>
              <tbody>
                {sens.map((s, i) => (
                  <tr key={i} data-sens={i}>
                    <td className="wrap">{s.label}</td>
                    {s.effect.kind === "nd" ? <td colSpan={3} className="nd wrap">n.d. — {s.effect.reason}</td> : (
                      <>
                        <td className="num" data-col="effect">{signed(s.effect.atterrissage)}</td>
                        <td className="num" data-col="retraite">{s.effect.retraite === null ? "n.d." : signed(s.effect.retraite)}</td>
                        <td className="num" data-col="total">{formatEuros(s.effect.total)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="tile-foot">Valeur : jours (décalage de date), % pour un montant ou des coûts de sortie, points de % pour un taux d'augmentation (ex. 0,5). Chaque variation est calculée seule, sans être enregistrée.</p>
      </section>
    </>
  );
}
