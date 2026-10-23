import "@/styles/hypotheses-resultat.css";
import { BarChart, WaterfallChart } from "@/components/charts";
import { ViewSwitch } from "@/components/ViewSwitch";
import { formatEuros } from "@/lib/money";
import type { Measures, Retraite, SensitivityRow, VariantKind } from "@/lib/budget/lot3";
import { VARIANT_LABELS } from "@/lib/budget/lot3";
import type { Landing } from "@/lib/budget/engine";
import type { Hypothesis } from "@/lib/budget/types";
import { affichageOf, landingParts, landingWaterfall, measuresBars, retraiteWaterfall, sensitivityBars, showCharts, showTables, withAffichage, type WaterfallIn } from "@/lib/viz/hypotheses";

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

// Cascade ou, à défaut, la raison pour laquelle il n'y a rien à tracer (n.d. avec sa raison, ou cascade sans intérêt).
function Wf({ w, testid, title, label, note }: { w: WaterfallIn; testid: string; title: string; label: string; note?: string }) {
  if (w.kind === "value") {
    return <WaterfallChart testid={testid} label={label} title={title} startLabel={w.startLabel} start={w.start} steps={w.steps} endLabel={w.endLabel} end={w.end} unit="eur" note={note} />;
  }
  return (
    <div className="hr-nd" data-testid={`${testid}-nd`}>
      <p className="hr-nd-title">{title}</p>
      <p className={w.kind === "nd" ? "nd" : "desc"}>{w.kind === "nd" ? `n.d. — ${w.reason}` : w.text}</p>
    </div>
  );
}

export function LandingView({
  hrefBase, scenarioId, year, landing, retraite, measures, sens, options, chosen, affichage,
}: {
  hrefBase: string; scenarioId: string; year: string; landing: Landing; retraite: Retraite; measures: Measures;
  sens: SensitivityRow[]; options: { value: string; label: string }[]; chosen: { value: string; delta: string }[]; affichage?: string;
}) {
  const rows = chosen.length ? chosen : [{ value: "", delta: "" }];
  const aff = affichageOf(affichage);
  // Adresse de l'écran : variations choisies conservées ; l'affichage « tout » n'est pas écrit dans l'adresse.
  const here = `${hrefBase}?${[`scenario=${encodeURIComponent(scenarioId)}`, "vue=resultat", "sous=atterrissage", ...chosen.flatMap((c) => [`sv=${encodeURIComponent(c.value)}`, `sd=${encodeURIComponent(c.delta)}`])].join("&")}`;
  const tableHref = withAffichage(here, "tableau");
  const bars = measuresBars(measures);
  const sensBars = sensitivityBars(sens);
  return (
    <>
      <div className="hr-switch">
        <ViewSwitch
          testid="atr-affichage"
          label="Affichage de l'atterrissage"
          current={aff}
          options={[
            { key: "tout", label: "Afficher tout", href: withAffichage(here, "tout") },
            { key: "graphique", label: "Graphique", href: withAffichage(here, "graphique") },
            { key: "tableau", label: "Tableau", href: withAffichage(here, "tableau") },
          ]}
        />
        <p className="hr-hint">Atterrissage {year} : mois réels puis mois projetés, avant et après les éléments non récurrents. Les tableaux donnent les montants exacts.</p>
      </div>
      <section className="panel" data-testid="atr-retraite">
        <h2>Atterrissage {year} retraité <span className="desc">— <a href="#def-retraite">Définition</a></span></h2>
        <dl className="facts hr-tiles">
          <div className="hr-tile" data-testid="atr-tile-landing">
            <dt>Atterrissage {year}{" "}<span className="hr-sub">coût employeur, réel + projeté</span></dt>
            <dd className={landing.kind === "nd" ? "nd" : undefined}>{landing.kind === "nd" ? `n.d. — ${landing.reason}` : formatEuros(landing.total)}</dd>
            {landing.kind === "value" && (
              <span className="tile-foot" data-testid="atr-tile-landing-split">{landingParts(landing).map((x) => `${x.label.charAt(0).toLowerCase()}${x.label.slice(1)} ${formatEuros(x.value)}`).join(" + ")}</span>
            )}
          </div>
          <div className="hr-tile" data-testid="atr-tile-retire">
            <dt>Éléments non récurrents retirés{" "}<span className="hr-sub">déjà en comptabilité + prévus</span></dt>
            <dd className={retraite.kind === "nd" ? "nd" : undefined}>{retraite.kind === "nd" ? "n.d." : formatEuros(retraite.total)}</dd>
            {retraite.kind === "value" && <span className="tile-foot">déjà en comptabilité {formatEuros(retraite.realised)} + prévus {formatEuros(retraite.projected)}</span>}
          </div>
          <div className="hr-tile" data-testid="atr-tile-retraite">
            <dt>Atterrissage {year} retraité{" "}<span className="hr-sub">hors éléments non récurrents</span></dt>
            <dd className={retraite.kind === "nd" ? "nd" : undefined}>{retraite.kind === "nd" ? `n.d. — ${retraite.reason}` : formatEuros(retraite.retraite)}</dd>
          </div>
        </dl>
        {showCharts(aff) && (
          <div className="hr-charts-2" data-testid="atr-charts">
            <div className="hr-block">
              <Wf
                w={landingWaterfall(landing)}
                testid="atr-wf-atterrissage"
                title={`Atterrissage ${year} : réel + projeté`}
                label={`Atterrissage ${year} en euros : mois réels, puis mois projetés, jusqu'au total de l'année`}
                note="Chaque barre ajoute un ensemble de mois à la précédente : réel, puis mois projetés (par le scénario parent le cas échéant, puis par ce scénario). Montants exacts : tuile ci-dessus."
              />
            </div>
            <div className="hr-block">
              <Wf
                w={retraiteWaterfall(retraite)}
                testid="atr-wf-retraite"
                title={`Atterrissage ${year} retraité`}
                label={`De l'atterrissage ${year} à l'atterrissage retraité, en euros : éléments non récurrents déjà comptabilisés, puis prévus`}
                note="Éléments non récurrents retirés de l'atterrissage : déjà dans les comptes, puis prévus par les hypothèses."
              />
            </div>
          </div>
        )}
        {showTables(aff) && retraite.kind === "value" && (
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
        <p className="tile-foot">Éléments déjà en comptabilité : saisis à la main dans Hypothèses (le journal PayFit ne les distingue pas). Prévus : coûts de sortie des départs, éléments ponctuels marqués « non récurrent », tuilages (coût de l'entrant du recouvrement avec le remplacé).{aff === "graphique" ? <> Détail par élément : <a href={tableHref}>affichage Tableau</a>.</> : null}</p>
      </section>

      <section className="panel" data-testid="atr-measures">
        <h2>Mesures de management — {year} <span className="desc">— un départ à la fois ; <a href="#def-mesures">Définition</a></span></h2>
        {measures.kind === "nd" ? (
          <p className="nd">n.d. — {measures.reason}</p>
        ) : measures.rows.length === 0 ? (
          <p className="desc">Aucun départ dans ce scénario.</p>
        ) : (
          <>
            {showCharts(aff) && bars.kind === "value" && (
              <BarChart
                testid="atr-chart-mesures"
                label={`Effet de chaque mesure de management sur ${year}, en euros : paie évitée, coûts de sortie, coût du remplaçant et économie nette`}
                title={`Effet de chaque départ sur ${year}`}
                categories={bars.categories}
                categoryTitles={bars.titles}
                series={bars.series}
                unit="eur"
                mode="grouped"
                note={["Économie nette : définition ci-dessous.", bars.series.some((x) => x.key === "replacement") ? "Départ sans remplaçant lié : pas de barre « Coût du remplaçant » (raison au survol)." : null].filter(Boolean).join(" ")}
              />
            )}
            {showTables(aff) && (
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
          </>
        )}
        <p className="tile-foot">Économie nette = paie évitée − coûts de sortie − coût du remplaçant lié ; positif = économie. Année pleine = 12 × (paie évitée − coût du remplaçant) du mois complet de décembre.</p>
      </section>

      <section className="panel" data-testid="atr-sens">
        <h2>Sensibilités <span className="desc">— effet d'une variation d'une hypothèse sur l'atterrissage {year} ; <a href="#def-sensibilites">Définition</a></span></h2>
        <form method="get" action={hrefBase} data-testid="atr-sens-form">
          <input type="hidden" name="scenario" value={scenarioId} />
          <input type="hidden" name="vue" value="atterrissage" />
          {aff !== "tout" && <input type="hidden" name="affichage" value={aff} />}
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
        {showCharts(aff) && sensBars.kind === "value" && (
          <BarChart
            testid="atr-chart-sens"
            label={`Effet de chaque variation sur l'atterrissage ${year} et sur l'atterrissage retraité, en euros`}
            title={`Effet de chaque variation sur l'atterrissage ${year}`}
            categories={sensBars.categories}
            categoryTitles={sensBars.titles}
            series={sensBars.series}
            unit="eur"
            mode="grouped"
            note="Les numéros sont ceux des variations, dans l'ordre du formulaire et du tableau. Effet = atterrissage avec la variation − atterrissage retenu ; chaque variation est calculée seule. Pas de barre : variation n.d. (raison au survol)."
          />
        )}
        {showTables(aff) && sens.length > 0 && (
          <div className="table-wrap">
            <table className="data-table" data-testid="atr-sens-table">
              <thead><tr><th>Variation</th><th className="num">Effet sur l'atterrissage</th><th className="num">Effet sur le retraité</th><th className="num">Atterrissage après variation</th></tr></thead>
              <tbody>
                {sens.map((s, i) => (
                  <tr key={i} data-sens={i}>
                    <td className="wrap"><span className="ver-badge">{i + 1}</span>{s.label}</td>
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
