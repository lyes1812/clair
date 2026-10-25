import { MoneyText } from "@/components/Money";
import "@/styles/ecart.css";
import { GlossaryLink } from "@/components/GlossaryLink";
import { formatEuros } from "@/lib/money";
import { bridge, type Series } from "@/lib/budget/series";
import { etpCascade, masseByRubric, STEP_LABELS } from "@/lib/budget/cascade";
import { aggregate, alignedSeries, diff, type RowKey } from "@/lib/budget/versions";
import { ECART_TERMS, STEP_TERMS } from "@/lib/glossary/ecart";
import { costTone, trendClass } from "@/lib/trend";
import { etpWaterfall, gapTone, masseWaterfall, pontWaterfall } from "@/lib/viz/ecart";
import { fmtFixed } from "@/lib/rh/kpi/format";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { loadVersions } from "../ecart-data";
import { GapPct, MsHeader, MsTabs, neg, PanelTitle, periodText, pctSign, PickerForm, scopeText, signOf, TBL, toneClass, TrendLegend } from "../EcartParts";
import { peopleIndex } from "../people-index";
import { LiveViewSwitch } from "../ecart/LiveRub";
import { AnalyseChart, type AnalyseItem } from "./AnalyseChart";
import { Weight } from "./Weight";
import { TitledWaterfall } from "./TitledWaterfall";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;
type Affichage = "tout" | "graphique" | "tableau";
const AFFICHAGES: Affichage[] = ["tout", "graphique", "tableau"];
const etp = (n: number) => fmtFixed({ num: n, den: 10000 }, 2);
const eur = (n: number) => neg(formatEuros(n));
const sg = (n: number, f: (x: number) => string) => `${n > 0 ? "+" : ""}${f(n)}`;
const RUBRIC_OPTIONS = [{ key: "etp", label: "ETP (moyenne des ETP de fin de mois)" }, { key: "masse", label: "Masse salariale chargée" }];

export default async function AnalysePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await requireWorkspace(slug);
  const canZoom = hasAtLeast(workspace.role, "editor");
  const loaded = await loadVersions(slug, workspace.id, sp, 2);
  const [a, b] = loaded.versions;
  const base = `/e/${slug}/studio-rh/masse-salariale/analyse`;
  const monthsA = a ? loaded.months(a.year) : [];
  const monthsB = b ? loaded.months(b.year) : [];
  const cascade = a && b ? etpCascade(a, b, monthsA, monthsB) : null;
  const masse = a && b ? masseByRubric(a, b, monthsA, monthsB) : null;
  const pont = a && b ? bridge(alignedSeries(b, monthsB, monthsA) as Series, alignedSeries(a, monthsA, monthsA) as Series, monthsA) : null;
  const people = canZoom ? peopleIndex(loaded) : null;
  const nameOf = (k: string) => people?.get(k)?.label ?? k;
  const aff: Affichage = AFFICHAGES.includes(one(sp.affichage) as Affichage) ? (one(sp.affichage) as Affichage) : "tout";
  const rub = RUBRIC_OPTIONS.some((o) => o.key === one(sp.rub)) ? one(sp.rub) : "etp";
  const [s0, s1] = loaded.shorts;
  const period = periodText(loaded.from, loaded.to);
  const scope = scopeText(loaded);
  // Adresse d'un affichage : versions, période et service conservés.
  const keep = new URLSearchParams();
  for (const k of ["v1", "v2", "de", "a", "service"]) if (one(sp[k])) keep.set(k, one(sp[k]));
  if (!keep.has("v1") && loaded.selected.length) loaded.selected.forEach((v, i) => keep.set(`v${i + 1}`, v));
  const affHref = (key: Affichage) => {
    const p = new URLSearchParams(keep);
    p.set("rub", rub);
    if (key !== "tout") p.set("affichage", key);
    return `${base}?${p.toString()}`;
  };
  const ecartHref = `/e/${slug}/studio-rh/masse-salariale/ecart?${keep.toString()}`;
  const hidden: Record<string, string> = { rub, ...(aff !== "tout" ? { affichage: aff } : {}) };
  const showGraph = !!(a && b) && aff !== "tableau";
  const showTables = !!(a && b) && aff !== "graphique";

  // Pourcentages d'écart repris des agrégats de l'écart budgétaire (mêmes valeurs que sur cette page) : par rubrique de masse,
  // total de la masse et ETP moyen. Une contribution d'ETP n'a pas de valeur de départ propre : pas de pourcentage.
  const pctOf = (k: RowKey) => (a && b ? diff(aggregate(a, monthsA, k), aggregate(b, monthsB, k)) : null);
  const etpPct = pctOf("etp");
  const massePct = pctOf("masse");

  const wfEtp = cascade ? etpWaterfall(cascade) : null;
  const wfMasse = masse ? masseWaterfall(masse) : null;
  const wfPont = pont ? pontWaterfall(pont) : null;
  const items: Record<string, AnalyseItem> | null = wfEtp && wfMasse
    ? {
        etp: { label: RUBRIC_OPTIONS[0].label, title: `ETP — de ${s0} à ${s1}`, ariaLabel: `Cascade des ETP de ${s0} à ${s1}, ${period}, ${scope} : ETP de départ, contributions des entrées et des sorties, ETP d'arrivée`, startLabel: s0, endLabel: s1, trend: "neutral", data: wfEtp },
        masse: { label: RUBRIC_OPTIONS[1].label, title: `Masse salariale chargée — de ${s0} à ${s1}`, ariaLabel: `Cascade de la masse salariale chargée de ${s0} à ${s1}, ${period}, ${scope} : montant de départ, contribution de chaque rubrique, montant d'arrivée`, startLabel: s0, endLabel: s1, trend: "cost", data: wfMasse },
      }
    : null;
  const help = (term: string, label: string) => <GlossaryLink slug={slug} term={term} label={label} />;
  const axisHelp = <GlossaryLink slug={slug} term={ECART_TERMS.axeAjuste} label="Lecture d'un graphique à axe ajusté" />;
  // La légende des couleurs est écrite une fois, au-dessus du tableau de masse ; le pont ne la répète que si ce tableau est absent.
  const legendInMasse = showTables && !!masse && masse.kind === "value";

  return (
    <MoneyText><>
      <MsHeader title={ITEM.label} />
      <MsTabs slug={slug} current="analyse" />
      <section className="panel" data-testid="analyse">
        <div className="panel-head">
          <PanelTitle title="Analyse des écarts" slug={slug} term={ECART_TERMS.analyse} label="Analyse des écarts" />
          {a && b && (
            <LiveViewSwitch
              initialRub={rub}
              testid="analyse-affichage"
              label="Affichage des résultats"
              current={aff}
              options={[{ key: "tout", label: "Afficher tout", href: affHref("tout") }, { key: "graphique", label: "Graphique", href: affHref("graphique") }, { key: "tableau", label: "Tableau", href: affHref("tableau") }]}
            />
          )}
        </div>
        {loaded.ctx.unavailable && <p className="notice">Journal de paie PayFit indisponible : {loaded.ctx.unavailable}. Les versions réelles sont n.d.</p>}
        {loaded.notices.map((n) => <p key={n} className="notice">{n}</p>)}
        <PickerForm path={base} loaded={loaded} columns={2} hidden={hidden} slug={slug} />
        {!a || !b ? <p className="desc" data-testid="analyse-empty">Choisissez deux versions à comparer.</p> : (
          <p className="desc" data-testid="analyse-vers-ecart"><a href={ecartHref}>Écart par rubrique</a></p>
        )}
      </section>

      {showGraph && items && (
        <section className="panel" data-testid="analyse-graph" id="graphique">
          <div className="panel-head">
            <PanelTitle title="Cascade de l'écart" slug={slug} term={ECART_TERMS.cascades} label="Lecture d'une cascade" />
          </div>
          <AnalyseChart initial={rub} options={RUBRIC_OPTIONS} items={items} axisHelp={axisHelp} />
        </section>
      )}

      {showTables && a && b && cascade && (
        <section className="panel" data-testid="analyse-etp" id="tableau">
          <div className="panel-head">
            <PanelTitle title="Cascade d'ETP" slug={slug} term={ECART_TERMS.cascade} label="Cascade d'ETP" />
          </div>
          {cascade.kind === "nd" ? (
            <p className="nd" data-testid="analyse-etp-nd">n.d. — {cascade.reason}</p>
          ) : (
            <>
              <div className="table-wrap scroll">
                <table className="data-table sticky sticky-first ecart-table analyse-table stack-sm" data-testid="analyse-etp-table" {...TBL.table}>
                  <caption className="ecart-sr">Cascade des ETP de {s0} à {s1}, {period}, {scope} : départ, contributions, écart total, arrivée</caption>
                  <thead {...TBL.group}><tr {...TBL.row}><th scope="col" {...TBL.head}>Rubrique</th><th scope="col" className="num" {...TBL.head}>ETP (valeur ou écart)</th><th scope="col" className="num" {...TBL.head}>Poids des écarts{help(ECART_TERMS.poids, "Poids des écarts")}</th><th scope="col" className="num" {...TBL.head}>Écart (%){help(ECART_TERMS.ecartPourcentage, "Écart en pourcentage")}</th></tr></thead>
                  <tbody {...TBL.group}>
                    <tr data-step="start" className="total" {...TBL.row}><th scope="row" {...TBL.rowhead}>ETP {s0}</th><td className="num" data-col="valeur" data-label="Valeur" {...TBL.cell}>{etp(cascade.start)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                    {cascade.steps.map((s) => (
                      <tr key={s.id} data-step={s.id} className="child" {...TBL.row}>
                        <th scope="row" {...TBL.rowhead}>{STEP_LABELS[s.id]}{help(STEP_TERMS[s.id], STEP_LABELS[s.id])}</th>
                        <td className="num" data-col="valeur" data-sign={signOf(s.etp4)} data-label="Écart" {...TBL.cell}>{sg(s.etp4, etp)}</td>
                        <td className="num" data-label="Poids des écarts" {...TBL.cell}><Weight n={s.etp4} total={cascade.end - cascade.start} /></td>
                        <td className="num" data-label="Écart (%)" {...TBL.cell}>—</td>
                      </tr>
                    ))}
                    <tr data-step="residual" className="child" {...TBL.row}><th scope="row" {...TBL.rowhead}>Résiduel d'arrondi{help(ECART_TERMS.residuel, "Résiduel d'une cascade")}</th><td className="num" data-col="valeur" data-label="Écart" {...TBL.cell}>{sg(cascade.residual, etp)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                    <tr data-step="total" className="subtotal" {...TBL.row}><th scope="row" {...TBL.rowhead}>Écart total{help(ECART_TERMS.ecart, "Écart")}</th><td className="num" data-col="valeur" data-sign={signOf(cascade.end - cascade.start)} data-label="Écart" {...TBL.cell}>{sg(cascade.end - cascade.start, etp)}</td><td {...TBL.cell} /><td className="num" data-col="pct" data-sign={etpPct ? pctSign(etpPct) : undefined} data-label="Écart (%)" {...TBL.cell}>{etpPct ? <GapPct d={etpPct} /> : "—"}</td></tr>
                    <tr data-step="end" className="total" {...TBL.row}><th scope="row" {...TBL.rowhead}>ETP {s1}</th><td className="num" data-col="valeur" data-label="Valeur" {...TBL.cell}>{etp(cascade.end)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                  </tbody>
                </table>
              </div>
              {canZoom ? (
                <details data-testid="analyse-etp-who">
                  <summary>Salariés derrière chaque contribution</summary>
                  <ul className="list">
                    {cascade.steps.filter((s) => s.people.length).map((s) => <li key={s.id} className="desc"><strong>{STEP_LABELS[s.id]}</strong> : {s.people.slice(0, 30).map((p) => `${nameOf(p.key)} ${sg(p.etp4, etp)}`).join(" · ")}{s.people.length > 30 ? ` · … (${s.people.length - 30} autres)` : ""}</li>)}
                  </ul>
                </details>
              ) : <p className="tile-foot">Le détail nominatif est réservé aux administrateurs et aux éditeurs.</p>}
            </>
          )}
        </section>
      )}

      {showTables && a && b && masse && (
        <section className="panel" data-testid="analyse-masse">
          <div className="panel-head">
            <PanelTitle title="Masse salariale chargée" slug={slug} term={ECART_TERMS.contributions} label="Contributions de la masse salariale" />
          </div>
          {masse.kind === "nd" ? (
            <p className="nd" data-testid="analyse-masse-nd">n.d. — {masse.reason}</p>
          ) : (
            <>
              <TrendLegend slug={slug} />
              <div className="table-wrap scroll">
                <table className="data-table sticky sticky-first ecart-table analyse-table stack-sm" data-testid="analyse-masse-table" {...TBL.table}>
                  <caption className="ecart-sr">Contribution de chaque rubrique à l'écart de masse salariale chargée de {s0} à {s1}, {period}, {scope}</caption>
                  <thead {...TBL.group}><tr {...TBL.row}><th scope="col" {...TBL.head}>Rubrique</th><th scope="col" className="num" {...TBL.head}>Montant (valeur ou écart)</th><th scope="col" className="num" {...TBL.head}>Poids des écarts{help(ECART_TERMS.poids, "Poids des écarts")}</th><th scope="col" className="num" {...TBL.head}>Écart (%){help(ECART_TERMS.ecartPourcentage, "Écart en pourcentage")}</th></tr></thead>
                  <tbody {...TBL.group}>
                    <tr data-step="start" className="total" {...TBL.row}><th scope="row" {...TBL.rowhead}>{s0}</th><td className="num" data-col="valeur" data-label="Valeur" {...TBL.cell}>{eur(masse.start)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                    {masse.steps.map((s) => {
                      const pct = pctOf(s.key as RowKey);
                      return (
                        <tr key={s.key} data-step={s.key} className="child" {...TBL.row}>
                          <th scope="row" {...TBL.rowhead}>{s.label}</th>
                          <td className={toneClass("num", s.delta === null ? "flat" : costTone(s.delta))} data-col="valeur" data-sign={s.delta === null ? undefined : signOf(s.delta)} data-label="Écart" {...TBL.cell}>{s.delta === null ? <abbr className="nd" title={s.reason ?? undefined}>n.d.</abbr> : sg(s.delta, eur)}</td>
                          <td className="num" data-label="Poids des écarts" {...TBL.cell}><Weight n={s.delta} total={masse.end - masse.start} reason={s.reason} /></td>
                          <td className={toneClass("num", pct ? gapTone(s.key as RowKey, pct, "pct") : "flat")} data-sign={pct ? pctSign(pct) : undefined} data-label="Écart (%)" {...TBL.cell}>{pct ? <GapPct d={pct} /> : "—"}</td>
                        </tr>
                      );
                    })}
                    <tr data-step="residual" className="child" {...TBL.row}><th scope="row" {...TBL.rowhead}>{masse.steps.some((s) => s.delta === null) ? "Résiduel (rubriques n.d.)" : "Résiduel"}{help(ECART_TERMS.residuel, "Résiduel d'une cascade")}</th><td className={toneClass("num", costTone(masse.residual ?? 0))} data-col="valeur" data-label="Écart" {...TBL.cell}>{sg(masse.residual ?? 0, eur)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                    <tr data-step="total" className="subtotal" {...TBL.row}><th scope="row" {...TBL.rowhead}>Écart total{help(ECART_TERMS.ecart, "Écart")}</th><td className={toneClass("num", costTone(masse.end - masse.start))} data-col="valeur" data-sign={signOf(masse.end - masse.start)} data-label="Écart" {...TBL.cell}>{sg(masse.end - masse.start, eur)}</td><td {...TBL.cell} /><td className={toneClass("num", massePct ? gapTone("masse", massePct, "pct") : "flat")} data-col="pct" data-sign={massePct ? pctSign(massePct) : undefined} data-label="Écart (%)" {...TBL.cell}>{massePct ? <GapPct d={massePct} /> : "—"}</td></tr>
                    <tr data-step="end" className="total" {...TBL.row}><th scope="row" {...TBL.rowhead}>{s1}</th><td className="num" data-col="valeur" data-label="Valeur" {...TBL.cell}>{eur(masse.end)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                  </tbody>
                </table>
              </div>
              {masse.steps.some((s) => s.delta === null) && (
                <details data-testid="analyse-masse-nd-list">
                  <summary>Rubriques n.d. ({masse.steps.filter((s) => s.delta === null).length})</summary>
                  <ul className="list">{masse.steps.filter((s) => s.delta === null).map((s) => <li key={s.key} className="desc">{s.label} : {s.reason ?? "valeur absente"}</li>)}</ul>
                </details>
              )}
            </>
          )}
        </section>
      )}

      {a && b && pont && (
        <section className="panel" data-testid="analyse-pont">
          <div className="panel-head">
            <PanelTitle title="Pont volume / coût moyen" slug={slug} term={ECART_TERMS.pont} label="Pont volume / coût moyen" />
          </div>
          {pont.kind === "nd" ? (
            <p className="nd" data-testid="analyse-pont-nd">n.d. — {pont.reason}</p>
          ) : (
            <>
              {aff !== "graphique" && !legendInMasse && <TrendLegend slug={slug} />}
              <div className="pont">
                {aff !== "graphique" && (
                  <dl className="pont-tiles">
                    <div data-testid="pont-delta"><dt>Écart de masse salariale</dt><dd className={trendClass(costTone(pont.delta))} data-sign={signOf(pont.delta)}>{sg(pont.delta, eur)}</dd></div>
                    <div data-testid="pont-volume"><dt>Effet volume</dt><dd className={trendClass(costTone(pont.volume))} data-sign={signOf(pont.volume)}>{sg(pont.volume, eur)}</dd></div>
                    <div data-testid="pont-cout"><dt>Effet coût moyen</dt><dd className={trendClass(costTone(pont.averageCost))} data-sign={signOf(pont.averageCost)}>{sg(pont.averageCost, eur)}</dd></div>
                  </dl>
                )}
                {aff !== "tableau" && wfPont && wfPont.kind === "value" && (
                  <div className="pont-chart">
                    <TitledWaterfall
                      testid="wf-pont"
                      label={`Pont de la masse salariale chargée de ${s0} à ${s1}, ${period}, ${scope} : effet volume et effet coût moyen`}
                      title={`Masse salariale chargée — de ${s0} à ${s1}`}
                      startLabel={s0}
                      endLabel={s1}
                      start={wfPont.start}
                      end={wfPont.end}
                      steps={wfPont.steps}
                      unit={wfPont.unit}
                      trend="cost"
                      axisHelp={axisHelp}
                    />
                  </div>
                )}
              </div>
              <p className="tile-foot">Effet de structure (mix) non isolé : compris dans l'effet coût moyen.</p>
            </>
          )}
        </section>
      )}
    </></MoneyText>
  );
}
