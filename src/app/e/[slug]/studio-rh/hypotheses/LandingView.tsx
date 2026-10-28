import { MoneyText, MoneyUnitLabel } from "@/components/Money";
import "@/styles/hypotheses-resultat.css";
import { BarChart, WaterfallChart } from "@/components/charts";
import { ViewSwitch } from "@/components/ViewSwitch";
import { GlossaryLink } from "@/components/GlossaryLink";
import { formatDate, formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { HYP_TERMS } from "@/lib/glossary/hypotheses";
import type { Measures, Retraite, SensitivityRow, VariantKind } from "@/lib/budget/lot3";
import { VARIANT_LABELS } from "@/lib/budget/lot3";
import type { Landing } from "@/lib/budget/engine";
import type { Hypothesis } from "@/lib/budget/types";
import type { ActualEvent } from "@/lib/payroll/non-recurring";
import { costTone, trendClass, type TrendTone } from "@/lib/trend";
import { affichageOf, frDates, hasNd, landingParts, landingWaterfall, measuresBars, retraiteWaterfall, savingTone, sensitivityBars, showCharts, showTables, slugOf, withAffichage, type WaterfallIn } from "@/lib/viz/hypotheses";
import { NdKey, PanelTitle, TileTitle, TrendLegend } from "./ProjectionView";

const signed = (c: number) => `${c > 0 ? "+" : ""}${formatEuros(c)}`;
// Classe d'une cellule ou d'une valeur dont la couleur dit la tendance du coût (rouge : coût en hausse, vert : coût en baisse) ; la classe
// hr-gap ajoute la flèche, le signe reste écrit. Neutre : aucune classe.
const toneClass = (base: string, tone: TrendTone): string => (tone === "flat" ? base : [base, "hr-gap", trendClass(tone)].filter(Boolean).join(" "));

export type ActualStatusItem = { kind: ActualEvent["kind"]; month: string; amountMissing: boolean; sourceMismatch: boolean; monthUnavailable: boolean; legacyOverlap: boolean };
// Synthèse de statut serveur seulement : aucune identité, note libre ni valeur individuelle n’est reçue ou rendue.
export function ActualNonRecurringStatus({ items }: { items: ActualStatusItem[] }) {
  if (!items.length) return null;
  const labels: Record<ActualStatusItem["kind"], string> = { licenciement: "Licenciement", "rupture-conventionnelle": "Rupture conventionnelle", tuilage: "Tuilage", autre: "Autre élément identifié" };
  return <div className="tile-foot" data-testid="atr-actual-status">
    <strong>Coûts passés identifiés dans Réel</strong>
    <ul>{items.map((item, index) => {
      const reasons = [
        item.amountMissing ? "montant chargé à renseigner" : null,
        item.sourceMismatch ? "lecture différente de la base figée, à vérifier dans Réel" : null,
        item.monthUnavailable ? "mois absent du réel connu de la base figée" : null,
        item.legacyOverlap ? "ancienne saisie réalisée du scénario sur ce mois : rapprochement nécessaire" : null,
      ].filter(Boolean);
      return <li key={`${item.kind}-${item.month}-${index}`} data-testid={`atr-actual-status-${index}`}><span>{labels[item.kind]} · {formatMonth(item.month)}</span> — {reasons.length ? <span className="nd">n.d. : {reasons.join(" ; ")}</span> : "montant chargé renseigné"}</li>;
    })}</ul>
  </div>;
}

// Lecteur : la liste élément par élément (nature et mois de chaque déclaration) est réservée aux éditeurs ; seul le nombre de
// déclarations du Réel que le retraité reprend sur la fenêtre (janvier → mois de la base) est écrit, un total de l'entreprise.
export function ActualNonRecurringCount({ count, from, to }: { count: number; from: string; to: string }) {
  if (count === 0) return null;
  return <p className="tile-foot" data-testid="atr-actual-count">
    <strong>Coûts passés identifiés dans Réel</strong> : {count} déclaration{count > 1 ? "s" : ""} à reprendre, {formatMonth(from).toLowerCase()} → {formatMonth(to).toLowerCase()}. Le détail par élément est réservé aux éditeurs.
  </p>;
}

// Statut de chaque ligne issue des déclarations du Réel (par nature), calculé par la page avec la fonction de la Masse salariale
// (maskNonRecurring, fenêtre janvier → mois de la base) : raison du n.d., ou null quand la ligne est affichée.
export type ActualHidden = Record<ActualEvent["kind"], string | null>;
export const ACTUAL_SHOWN: ActualHidden = { licenciement: null, "rupture-conventionnelle": null, tuilage: null, autre: null };

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

// Cascade ou, à défaut, la raison pour laquelle il n'y a rien à tracer (n.d. avec sa raison, ou cascade sans intérêt). Ces cascades
// décomposent un total (mois réels puis projetés, éléments non récurrents retirés) : elles restent bleues et grises, le rouge et le vert
// étant réservés aux écarts de coût.
function Wf({ w, testid, title, label }: { w: WaterfallIn; testid: string; title: string; label: string }) {
  if (w.kind === "value") {
    return <WaterfallChart testid={testid} label={label} title={title} startLabel={w.startLabel} start={w.start} steps={w.steps} endLabel={w.endLabel} end={w.end} unit="eur" />;
  }
  return (
    <div className="hr-nd" data-testid={`${testid}-nd`}>
      <p className="hr-nd-title">{title}</p>
      <p className={w.kind === "nd" ? "nd" : "desc"}>{w.kind === "nd" ? `n.d. — ${frDates(w.reason)}` : w.text}</p>
    </div>
  );
}

// actualHidden : statut des lignes issues du Réel (seuil de confidentialité, comme la Masse salariale) ; une ligne masquée est n.d. pour
// son montant déjà en comptabilité et son total, avec la raison écrite sous le tableau. Les totaux (« déjà en comptabilité », « prévus »,
// cascade du retraité) sont des totaux de l'entreprise, publiés comme la tuile « Coûts identifiés » : jamais masqués.
export function LandingView({
  hrefBase, scenarioId, year, landing, retraite, measures, sens, options, chosen, affichage, actualHidden,
}: {
  hrefBase: string; scenarioId: string; year: string; landing: Landing; retraite: Retraite; measures: Measures;
  sens: SensitivityRow[]; options: { value: string; label: string }[]; chosen: { value: string; delta: string }[]; affichage?: string;
  actualHidden: ActualHidden;
}) {
  const slug = slugOf(hrefBase);
  const rows = chosen.length ? chosen : [{ value: "", delta: "" }];
  const aff = affichageOf(affichage);
  // Adresse de l'écran : variations choisies conservées ; l'affichage « tout » n'est pas écrit dans l'adresse.
  const here = `${hrefBase}?${[`scenario=${encodeURIComponent(scenarioId)}`, "vue=resultat", "sous=atterrissage", ...chosen.flatMap((c) => [`sv=${encodeURIComponent(c.value)}`, `sd=${encodeURIComponent(c.delta)}`])].join("&")}`;
  const bars = measuresBars(measures);
  const sensBars = sensitivityBars(sens);
  // Légende des tendances : seulement s'il y a un montant d'économie ou d'effet à lire en rouge ou en vert.
  const trended = (measures.kind === "value" && measures.rows.length > 0) || sens.some((x) => x.effect.kind === "value");
  const barsNd = (bars.kind === "value" && hasNd(bars.series)) || (sensBars.kind === "value" && hasNd(sensBars.series));
  return (
    <MoneyText><>
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
        <div className="hr-line-bar">
          <p className="hr-context">Année {year} · mois réels puis mois projetés · <MoneyUnitLabel /></p>
          {trended && <TrendLegend slug={slug} />}
        </div>
      </div>
      <section className="panel" data-testid="atr-retraite">
        <PanelTitle title={`Atterrissage ${year} retraité`} desc={<>Hors éléments non récurrents · <MoneyUnitLabel /></>} slug={slug} term={HYP_TERMS.retraite} />
        <dl className="facts hr-tiles">
          <div className="hr-tile" data-testid="atr-tile-landing">
            <TileTitle title={`Atterrissage ${year}`} sub="coût employeur · réel + projeté" slug={slug} term={HYP_TERMS.atterrissage} />
            <dd className={landing.kind === "nd" ? "nd" : undefined}>{landing.kind === "nd" ? `n.d. — ${frDates(landing.reason)}` : formatEuros(landing.total)}</dd>
            {landing.kind === "value" && (
              <span className="tile-foot" data-testid="atr-tile-landing-split">{landingParts(landing).map((x) => `${x.label.charAt(0).toLowerCase()}${x.label.slice(1)} ${formatEuros(x.value)}`).join(" + ")}</span>
            )}
          </div>
          <div className="hr-tile" data-testid="atr-tile-retire">
            <TileTitle title="Éléments non récurrents retirés" sub="déjà en comptabilité + prévus" slug={null} />
            <dd className={retraite.kind === "nd" ? "nd" : undefined}>{retraite.kind === "nd" ? "n.d." : formatEuros(retraite.total)}</dd>
            {retraite.kind === "value" && <span className="tile-foot">déjà en comptabilité {formatEuros(retraite.realised)} + prévus {formatEuros(retraite.projected)}</span>}
          </div>
          <div className="hr-tile" data-testid="atr-tile-retraite">
            <TileTitle title={`Atterrissage ${year} retraité`} sub="hors éléments non récurrents" slug={null} />
            <dd className={retraite.kind === "nd" ? "nd" : undefined}>{retraite.kind === "nd" ? `n.d. — ${frDates(retraite.reason)}` : formatEuros(retraite.retraite)}</dd>
          </div>
        </dl>
        {showCharts(aff) && (
          <div className="hr-subblock">
            <div className="hr-subhead">
              <h3>Cascades</h3>
              {slug && <GlossaryLink slug={slug} term={HYP_TERMS.cascades} label="Cascades de l'atterrissage" />}
            </div>
            <div className="hr-charts-2" data-testid="atr-charts">
              <div className="hr-block">
                <Wf
                  w={landingWaterfall(landing)}
                  testid="atr-wf-atterrissage"
                  title={`Atterrissage ${year} : réel + projeté`}
                  label={`Atterrissage ${year} en euros : mois réels, puis mois projetés, jusqu'au total de l'année`}
                />
              </div>
              <div className="hr-block">
                <Wf
                  w={retraiteWaterfall(retraite)}
                  testid="atr-wf-retraite"
                  title={`Atterrissage ${year} retraité`}
                  label={`De l'atterrissage ${year} à l'atterrissage retraité, en euros : éléments non récurrents déjà comptabilisés, puis prévus`}
                />
              </div>
            </div>
          </div>
        )}
        {showTables(aff) && retraite.kind === "value" && (
          <div className="table-wrap">
            <table className="data-table" data-testid="atr-nonrec">
              <thead><tr><th>Éléments non récurrents de {year}</th><th className="num">Déjà dans les comptes</th><th className="num">D'ici décembre (hypothèses)</th><th className="num">Total</th></tr></thead>
              <tbody>
                {retraite.rows.length === 0 && <tr><td colSpan={4} className="desc">Aucun élément non récurrent saisi ni prévu.</td></tr>}
                {retraite.rows.map((r) => {
                  const hidden = r.actual ? actualHidden[r.actual] : null;
                  return (
                    <tr key={`${r.actual ?? ""}|${r.label}`} data-row={r.label}>
                      <td>{r.label}</td>
                      {hidden ? <td className="num nd" data-col="realised" title={hidden}>n.d.</td> : <td className="num" data-col="realised">{formatEuros(r.realised)}</td>}
                      <td className="num" data-col="projected">{formatEuros(r.projected)}</td>
                      {hidden ? <td className="num nd" data-col="total" title={hidden}>n.d.</td> : <td className="num" data-col="total">{formatEuros(r.realised + r.projected)}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="total" data-testid="atr-nonrec-total"><td>Total retiré de l'atterrissage</td><td className="num">{formatEuros(retraite.realised)}</td><td className="num">{formatEuros(retraite.projected)}</td><td className="num" data-col="total">{formatEuros(retraite.total)}</td></tr></tfoot>
            </table>
            {(() => {
              // Raisons des n.d. sous le tableau (jamais seulement en infobulle), une ligne par raison.
              const byReason = new Map<string, string[]>();
              for (const r of retraite.rows) {
                const hidden = r.actual ? actualHidden[r.actual] : null;
                if (hidden) byReason.set(hidden, [...(byReason.get(hidden) ?? []), r.label]);
              }
              return byReason.size ? <p className="tile-foot nd" data-testid="atr-nonrec-nd">n.d. : {[...byReason].map(([reason, labels]) => `${labels.join(", ")} : ${reason}`).join(" ; ")}</p> : null;
            })()}
          </div>
        )}
      </section>

      <section className="panel" data-testid="atr-measures">
        <PanelTitle title={`Mesures de management — ${year}`} desc={<>Chaque départ est évalué seul · <MoneyUnitLabel /></>} slug={slug} term={HYP_TERMS.mesures} />
        {measures.kind === "nd" ? (
          <p className="nd">n.d. — {frDates(measures.reason)}</p>
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
              />
            )}
            {showTables(aff) && (
              <div className="table-wrap">
                <table className="data-table" data-testid="atr-measures-table">
                  <thead><tr><th>Mesure</th><th>Dernier jour payé</th><th className="num">Paie évitée {year}</th><th className="num">Coûts de sortie</th><th className="num">Remplaçant</th><th className="num">Économie nette {year}{slug && <GlossaryLink slug={slug} term={HYP_TERMS.mesuresLecture} label="Lecture des mesures de management" />}</th><th className="num">Économie année pleine</th></tr></thead>
                  <tbody>
                    {measures.rows.map((m) => (
                      <tr key={m.id} data-measure={m.label}>
                        <td>{m.label} <span className="tile-foot">{m.who}</span></td>
                        <td className="hr-date">{formatDate(m.lastPaidDate)}</td>
                        <td className="num" data-col="avoided">{formatEuros(m.avoided)}</td>
                        <td className="num" data-col="exit">{formatEuros(m.exit)}</td>
                        <td className="num" data-col="replacement">{m.replacement === null ? "sans remplacement" : `${formatEuros(m.replacement)} (${m.replacementLabel})`}</td>
                        <td className={toneClass("num", savingTone(m.net))} data-col="net">{formatEuros(m.net)}</td>
                        <td className={toneClass("num", m.fullYear.kind === "nd" ? "flat" : savingTone(m.fullYear.cents))} data-col="full" title={m.fullYear.kind === "nd" ? frDates(m.fullYear.reason) : undefined}>{m.fullYear.kind === "nd" ? "n.d." : formatEuros(m.fullYear.cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(() => {
                  const nd = measures.rows.filter((m) => m.fullYear.kind === "nd").map((m) => `${m.label} : ${m.fullYear.kind === "nd" ? frDates(m.fullYear.reason) : ""}`);
                  return nd.length ? <p className="tile-foot nd">n.d. : {nd.join(" ; ")}</p> : null;
                })()}
              </div>
            )}
          </>
        )}
      </section>

      <section className="panel" data-testid="atr-sens">
        <PanelTitle title="Sensibilités" desc={<>Effet sur l’atterrissage {year} · chaque variation est calculée seule · <MoneyUnitLabel /></>} slug={slug} term={HYP_TERMS.sensibilites} />
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
                <div className="hr-label-row">
                  <label htmlFor={`sd-${i}`}>Valeur</label>
                  {i === 0 && slug && <GlossaryLink slug={slug} term={HYP_TERMS.sensibilitesLecture} label="Saisie et lecture des sensibilités" />}
                </div>
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
          />
        )}
        {showCharts(aff) && barsNd && <NdKey />}
        {showTables(aff) && sens.length > 0 && (
          <div className="table-wrap">
            <table className="data-table" data-testid="atr-sens-table">
              <thead><tr><th>Variation</th><th className="num">Effet sur l'atterrissage</th><th className="num">Effet sur le retraité</th><th className="num">Atterrissage après variation</th></tr></thead>
              <tbody>
                {sens.map((s, i) => (
                  <tr key={i} data-sens={i}>
                    <td className="wrap"><span className="ver-badge">{i + 1}</span>{s.label}</td>
                    {s.effect.kind === "nd" ? <td colSpan={3} className="nd wrap">n.d. — {frDates(s.effect.reason)}</td> : (
                      <>
                        <td className={toneClass("num", costTone(s.effect.atterrissage))} data-col="effect">{signed(s.effect.atterrissage)}</td>
                        <td className={toneClass("num", s.effect.retraite === null ? "flat" : costTone(s.effect.retraite))} data-col="retraite">{s.effect.retraite === null ? "n.d." : signed(s.effect.retraite)}</td>
                        <td className="num" data-col="total">{formatEuros(s.effect.total)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </></MoneyText>
  );
}
