import "@/styles/hypotheses-resultat.css";
import { BarChart, LineChart, WaterfallChart } from "@/components/charts";
import { ViewSwitch } from "@/components/ViewSwitch";
import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { roundDiv } from "@/lib/budget/engine";
import { bridge, gap, type Layer, type Point, type Series } from "@/lib/budget/series";
import { fmtEtp4, fmtPercent } from "@/lib/rh/kpi/format";
import { affichageOf, bridgeWaterfall, comparisonSeries, gapSeries, hasValues, layerSpans, monthAxis, ndReadings, showCharts, showTables, withAffichage } from "@/lib/viz/hypotheses";
import { monthShort } from "../masse-salariale/components";

const LAYER: Record<Layer, string> = { reel: "réel", "projete-parent": "projeté (parent)", projete: "projeté", budget: "budget" };
const signed = (c: number) => `${c > 0 ? "+" : ""}${formatEuros(c)}`;
const cell = (p: Point | undefined) => (!p ? "n.d." : p.kind === "nd" ? "n.d." : formatEuros(p.cost));
const why = (p: Point | undefined) => (!p ? "mois non couvert par cette lecture" : p.kind === "nd" ? p.reason : undefined);
const pctText = (pct: { num: number; den: number } | null) => (pct ? `${pct.num > 0 ? "+" : ""}${fmtPercent(pct)}` : "n.d. (référence nulle)");

export type Option = { value: string; label: string };

// Onglet « Comparaison » : ce scénario face à d'autres lectures (réel courant, N-1, budgets saisis, autres scénarios),
// mois par mois sur une année, écarts (ce scénario − lecture comparée) et pont volume / coût moyen.
export function ComparisonView({
  hrefBase, scenarioId, years, year, principal, compared, options, selected, refMonth, affichage,
}: { hrefBase: string; scenarioId: string; years: string[]; year: string; principal: Series; compared: Series[]; options: Option[]; selected: string[]; refMonth: string; affichage?: string }) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const done = months.filter((m) => m <= refMonth);
  const pv = (m: string) => principal.points.get(m);
  const aff = affichageOf(affichage);
  // Adresse de l'écran : année et lectures choisies conservées ; l'affichage « tout » n'est pas écrit dans l'adresse.
  const here = `${hrefBase}?${[`scenario=${encodeURIComponent(scenarioId)}`, "vue=resultat", "sous=comparaison", `annee=${encodeURIComponent(year)}`, ...selected.map((v) => `cmp=${encodeURIComponent(v)}`)].join("&")}`;
  const axis = monthAxis(months);
  const lines = comparisonSeries(principal, compared, months);
  const gaps = gapSeries(principal, compared, months);
  const ndNotes = ndReadings([principal, ...compared], months);
  const origin = layerSpans(principal, months);
  const bridges = compared.map((c) => ({ c, b: bridge(principal, c, months) }));
  return (
    <>
      <div className="hr-switch">
        <ViewSwitch
          testid="cmp-affichage"
          label="Affichage de la comparaison"
          current={aff}
          options={[
            { key: "tout", label: "Afficher tout", href: withAffichage(here, "tout") },
            { key: "graphique", label: "Graphique", href: withAffichage(here, "graphique") },
            { key: "tableau", label: "Tableau", href: withAffichage(here, "tableau") },
          ]}
        />
        <p className="hr-hint">Coût employeur mensuel de {year} : ce scénario face aux lectures choisies. Les tableaux donnent les montants exacts.</p>
      </div>
      <form method="get" action={hrefBase} className="panel" data-testid="cmp-form">
        <input type="hidden" name="scenario" value={scenarioId} />
        <input type="hidden" name="vue" value="comparaison" />
        {aff !== "tout" && <input type="hidden" name="affichage" value={aff} />}
        <div className="filters">
          <div className="field-row">
            <label htmlFor="cmp-year">Année</label>
            <select className="select" id="cmp-year" name="annee" defaultValue={year}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </div>
        </div>
        <fieldset className="checks">
          <legend className="label">Comparer avec (3 lectures au plus)</legend>
          {options.map((o) => (
            <label key={o.value} className="check">
              <input type="checkbox" name="cmp" value={o.value} defaultChecked={selected.includes(o.value)} data-testid={`cmp-opt-${o.value}`} />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="actions"><button className="btn" type="submit">Comparer</button></div>
      </form>

      {compared.length > 0 && (
        <section className="panel">
          <h2>Écarts {year} <span className="desc">— {principal.label} − lecture comparée ; positif = au-dessus</span></h2>
          <dl className="facts hr-tiles hr-tiles-sm">
            {compared.map((c) => {
              const y = gap(principal, c, months);
              const ytd = done.length ? gap(principal, c, done) : null;
              return (
                <div key={c.key} className="hr-tile" data-testid={`cmp-tile-${c.key}`}>
                  <dt>vs {c.label}{" "}<span className="hr-sub">écart sur l'année {year}</span></dt>
                  <dd className={y.kind === "nd" ? "nd" : undefined}>{y.kind === "nd" ? `n.d. — ${y.reason}` : `${signed(y.delta)} · ${pctText(y.pct)}`}</dd>
                  {y.kind === "value" && <span className="tile-foot">{formatEuros(y.a)} contre {formatEuros(y.b)} sur l'année</span>}
                  {ytd && (
                    <span className="tile-foot" data-testid={`cmp-ytd-${c.key}`}>
                      {monthShort(done[0])}–{monthShort(done.at(-1)!)} (mêmes mois) : {ytd.kind === "nd" ? `n.d. — ${ytd.reason}` : `${signed(ytd.delta)} · ${pctText(ytd.pct)}`}
                    </span>
                  )}
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {showCharts(aff) && (
        <section className="panel" data-testid="cmp-lecture">
          <div className="hr-title">
            <h2>Courbes mensuelles — {year}</h2>
            <p className="desc">
              Coût employeur de chaque mois : {principal.label} (trait plein bleu) {compared.length ? "face aux lectures choisies" : "seul : choisir des lectures à comparer dans le formulaire ci-dessus"}. Le graphique est une lecture : les montants exacts, à l'euro près, sont dans {aff === "graphique" ? <a href={withAffichage(here, "tableau")}>l'affichage Tableau</a> : "le tableau « Mois par mois » plus bas"}. Définitions : <a href="#def-budget-saisi">budget saisi</a>, <a href="#def-pont">pont d'écart</a>.
            </p>
          </div>
          <div className="hr-charts">
            {hasValues(lines) ? (
              <LineChart
                testid="cmp-chart"
                label={`Coût employeur mensuel en euros, ${year} : ${lines.map((s) => s.name).join(", ")}`}
                title={`Coût employeur par mois — ${year}`}
                categories={axis.categories}
                categoryTitles={axis.titles}
                series={lines}
                unit="eur"
                note={[
                  origin ? `Origine des mois du scénario (trait plein bleu) : ${origin}.` : null,
                  ndNotes.length ? `Courbe interrompue : mois sans valeur (raison au survol) — ${ndNotes.join(" ; ")}.` : null,
                ].filter(Boolean).join(" ") || undefined}
              />
            ) : (
              <NdBlock title={`Coût employeur par mois — ${year}`} reasons={ndNotes} />
            )}
            {compared.length > 0 && (
              hasValues(gaps) ? (
                <BarChart
                  testid="cmp-chart-ecart"
                  label={`Écart mensuel de coût employeur en euros, ${year} : ${principal.label} moins chacune des lectures comparées`}
                  title={`Écart par mois — ${year}`}
                  categories={axis.categories}
                  categoryTitles={axis.titles}
                  series={gaps}
                  unit="eur"
                  mode="grouped"
                  note="Écart = coût du scénario − coût de la lecture comparée, mois par mois ; positif = au-dessus. Pas de barre : l'une des deux lectures est n.d. ce mois-là (raison au survol)."
                />
              ) : (
                <NdBlock title={`Écart par mois — ${year}`} reasons={ndNotes} />
              )
            )}
          </div>
        </section>
      )}

      {showTables(aff) && (
        <section className="panel" data-testid="cmp-mois">
          <h2>Mois par mois — {year}</h2>
          <div className="table-wrap">
            <table className="data-table" data-testid="cmp-table">
              <thead>
                <tr>
                  <th>Mois</th>
                  <th className="num">{principal.label}</th>
                  {compared.map((c) => [<th key={c.key} className="num">{c.label}</th>, <th key={`${c.key}-e`} className="num">Écart</th>])}
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const a = pv(m);
                  return (
                    <tr key={m} data-month={m}>
                      <td>{formatMonth(m)}</td>
                      <td className="num" data-col="principal" title={why(a)}>{cell(a)}{a?.kind === "value" ? <span className="tile-foot"> {a.source ?? LAYER[a.layer]}</span> : null}</td>
                      {compared.map((c) => {
                        const b = c.points.get(m);
                        const e = a?.kind === "value" && b?.kind === "value" ? signed(a.cost - b.cost) : "n.d.";
                        return [
                          <td key={c.key} className="num" data-col={c.key} title={why(b)}>{cell(b)}{b?.kind === "value" && b.layer !== "budget" ? <span className="tile-foot"> {b.source ?? LAYER[b.layer]}</span> : null}</td>,
                          <td key={`${c.key}-e`} className="num" data-col={`${c.key}-ecart`} title={why(a) ?? why(b)}>{e}</td>,
                        ];
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr data-testid="cmp-total">
                  <td>Année {year}</td>
                  <td className="num" data-col="principal">{(() => { const g = gap(principal, principal, months); return g.kind === "nd" ? "n.d." : formatEuros(g.a); })()}</td>
                  {compared.map((c) => {
                    const g = gap(principal, c, months);
                    const tb = gap(c, c, months);
                    return [
                      <td key={c.key} className="num" data-col={c.key}>{tb.kind === "nd" ? "n.d." : formatEuros(tb.a)}</td>,
                      <td key={`${c.key}-e`} className="num" data-col={`${c.key}-ecart`}>{g.kind === "nd" ? "n.d." : signed(g.delta)}</td>,
                    ];
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="tile-foot">Un total est n.d. dès qu'un de ses mois l'est (raison au survol de la cellule). « projeté — scénario « X » » : mois projeté par le scénario X dont ce budget est dérivé (directement ou par une dérivation antérieure).</p>
        </section>
      )}

      {compared.length > 0 && (
        <section className="panel" data-testid="cmp-bridge">
          <h2>Pont d'écart {year} — volume et coût moyen <span className="desc">— <a href="#def-pont">Définition</a></span></h2>
          {showCharts(aff) && (
            <div className="hr-charts-2" data-testid="cmp-bridge-charts">
              {bridges.map(({ c, b }) => {
                const w = bridgeWaterfall(b, principal.label, c.label);
                return (
                  <div className="hr-block" key={c.key}>
                    {w.kind === "value" ? (
                      <WaterfallChart
                        testid={`cmp-pont-${c.key}`}
                        label={`Pont d'écart ${year} entre ${c.label} et ${principal.label}, en euros : effet volume puis effet coût moyen`}
                        title={`Pont d'écart ${year} — ${c.label}`}
                        startLabel={w.startLabel}
                        endLabel={w.endLabel}
                        start={w.start}
                        end={w.end}
                        steps={w.steps}
                        unit="eur"
                        note="L'effet de structure n'est pas calculé : il demande les données individuelles datées des deux lectures."
                      />
                    ) : (
                      <div className="hr-nd">
                        <p className="hr-nd-title">Pont d'écart {year} — {c.label}</p>
                        <p className="nd">n.d. — {w.kind === "nd" ? w.reason : w.text}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {showTables(aff) && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Lecture comparée</th><th className="num">Écart total</th><th className="num">Effet volume</th><th className="num">Effet coût moyen</th><th>Effet de structure</th><th className="num">ETP-mois</th><th className="num">Coût par ETP-mois</th></tr></thead>
                <tbody>
                  {bridges.map(({ c, b }) => {
                    if (b.kind === "nd") return <tr key={c.key} data-bridge={c.key}><td>{c.label}</td><td colSpan={6} className="nd wrap">n.d. — {b.reason}</td></tr>;
                    const cpe = (x: { cost: number; etpMonths4: number }) => formatEuros(roundDiv(BigInt(x.cost) * 10000n, BigInt(x.etpMonths4)));
                    return (
                      <tr key={c.key} data-bridge={c.key}>
                        <td>{c.label}</td>
                        <td className="num" data-col="delta">{signed(b.delta)}</td>
                        <td className="num" data-col="volume">{signed(b.volume)}</td>
                        <td className="num" data-col="cout-moyen">{signed(b.averageCost)}</td>
                        <td className="nd wrap">n.d. — non calculé : données individuelles datées des deux lectures requises</td>
                        <td className="num">{fmtEtp4(b.a.etpMonths4)} / {fmtEtp4(b.b.etpMonths4)}</td>
                        <td className="num">{cpe(b.a)} / {cpe(b.b)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}

// Rien à tracer : on l'écrit, avec les raisons.
function NdBlock({ title, reasons }: { title: string; reasons: string[] }) {
  return (
    <div className="hr-nd">
      <p className="hr-nd-title">{title}</p>
      <p className="nd">n.d. — aucune valeur à tracer.</p>
      {reasons.length > 0 && <ul className="list">{reasons.map((r, i) => <li key={`${i}-${r}`} className="desc">{r}</li>)}</ul>}
    </div>
  );
}
