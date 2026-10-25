import { SearchableSelect } from "@/components/SearchableSelect";
import { MoneyText, MoneyUnitLabel } from "@/components/Money";
import { CalendarDays, ListChecks, PieChart } from "lucide-react";
import { BarChart, DonutChart } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { ParamLayout, ParamSection } from "@/components/ParamLayout";
import { monthRange } from "@/lib/connectors/months";
import { getCategoryNatures, getContractCategories } from "@/lib/budget/categories";
import { project } from "@/lib/budget/engine";
import { AXES, MEASURES, monthlyGrid, UNAVAILABLE_AXES, type Axis, type Measure, type RealSource } from "@/lib/budget/monthly";
import { getScenario, KIND_LABELS, listScenarios } from "@/lib/budget/store";
import { nd, val } from "@/lib/budget/versions";
import { KPI_TERMS } from "@/lib/glossary/kpi";
import { formatEuros } from "@/lib/money";
import { loadPayrollContext } from "@/lib/payroll/context";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";
import { selectableYears } from "@/lib/rh/kpi/period";
import type { KpiInput } from "@/lib/rh/kpi/types";
import { barNote, donutNote, gridSeries, groupColor, monthAxis, monthShortLabel, repartition, splitAxisLabel, unitLabel } from "@/lib/viz/kpi";
import { PanelTitle } from "./components";

type Unit = "etp" | "nombre" | "eur";
// Part d'un groupe : sans total positif, elle n'est pas définie (n.d. avec sa raison, jamais 0 %).
const share = (v: number, total: number) => (total > 0 ? fmtPercent({ num: v, den: total }) : <abbr className="nd" title="total nul : une part n'est pas définie">n.d.</abbr>);
const text = (v: number, unit: Unit) => (unit === "eur" ? formatEuros(v) : unit === "etp" ? fmtFixed({ num: v, den: 10000 }, 2) : String(v));

// Effectifs mensuels : une rubrique, un axe de répartition, une version (réel PayFit ou scénario) et une année ; tout passe par l'adresse.
// Mise en page : volet « J'analyse mes… / Par… / Répartis par… » à gauche, filtres Version et Année en haut, puis
// le panneau « Graphiques » (anneau de répartition et barres par mois), la répartition et le tableau mensuel exact.
// Aucune explication sur l'écran : rubriques, ventilation, versions, répartition et graphiques sont au glossaire (« ? »).
export async function EffectifsMensuels({ slug, workspaceId, kpi, search }: { slug: string; workspaceId: string; kpi: KpiInput | null; search: { mesure: string; axe: string; version: string; annee: string } }) {
  const pay = await loadPayrollContext(slug);
  const [{ natures }, overrides, rows] = await Promise.all([getCategoryNatures(workspaceId), getContractCategories(workspaceId), listScenarios(workspaceId)]);
  const measure: Measure = (MEASURES.some((m) => m.key === search.mesure) ? search.mesure : "etp") as Measure;
  const axis: Axis = (AXES.some((a) => a.key === search.axe) ? search.axe : "categorie") as Axis;
  const mdef = MEASURES.find((m) => m.key === measure)!;
  const versions = [{ value: "reel", label: "Réel PayFit" }, ...rows.map((r) => ({ value: `scenario:${r.scenario.id}`, label: `Scénario « ${r.scenario.name} » (${KIND_LABELS[r.scenario.kind]}, ${r.scenario.status === "fige" ? "figé" : "brouillon"})` }))];
  const version = versions.some((v) => v.value === search.version) ? search.version : "reel";
  const full = version.startsWith("scenario:") ? await getScenario(workspaceId, version.slice(9)) : null;
  const years = full
    ? [...new Set([full.base.refMonth.slice(0, 4), ...monthRange(full.scenario.firstMonth, full.scenario.lastMonth).map((m) => m.slice(0, 4))])].sort()
    : kpi ? selectableYears(kpi.data, kpi.openMonths ?? []).map((y) => String(y.year)) : [];
  const year = years.includes(search.annee) ? search.annee : (full ? full.scenario.firstMonth.slice(0, 4) : years.at(-1) ?? String(new Date().getFullYear()));
  const etpService = (m: string, f: { value: string | null }) => {
    const [e] = pay.etp([m], f);
    return e.etp4 === null ? nd(e.reason ?? "ETP par service n.d.") : val(e.etp4);
  };
  const real: RealSource = { kpi, journal: pay.input, natures, overrides, etpService };
  const grid = monthlyGrid({ measure, axis, year, real, scenario: full ? { base: full.base, hyps: full.hypotheses, proj: project(full.base, full.scenario.firstMonth, full.scenario.lastMonth, full.hypotheses, full.scenario.conventions) } : null });
  const unit = mdef.unit;
  const stock = measure === "etp" || measure === "inscrit";
  const axisParts = splitAxisLabel(AXES.find((a) => a.key === axis)!.label);
  const axisLabel = axisParts.name.toLowerCase();
  const versionLabel = versions.find((v) => v.value === version)!.label;
  // Répartition : stocks au dernier mois connu, flux sur le cumul des mois connus.
  const repart = grid.kind === "value" ? repartition(grid, stock) : null;
  const basis = repart && grid.kind === "value"
    ? stock ? (repart.used[0] ? `fin ${monthShortLabel(repart.used[0])} ${year}` : "aucun mois connu") : `cumul des ${repart.used.length} mois connus (${repart.known.length < 12 ? `${12 - repart.known.length} mois n.d. non comptés` : "année complète"})`
    : "";
  const ndReasons = grid.kind === "value" ? [...new Set(grid.months.flatMap((m) => { const t = grid.total(m); return t.kind === "nd" ? [`${m} : ${t.reason}`] : []; }))] : [];
  const base = `/e/${slug}/studio-rh/kpi`;

  // Graphiques : tout vient de la grille du tableau (mêmes cellules, mêmes n.d.).
  const color = (g: string) => groupColor(grid.kind === "value" ? Math.max(0, grid.groups.indexOf(g)) : 0);
  const axisMonths = grid.kind === "value" ? monthAxis(grid.months) : null;
  const projected = grid.kind === "value" ? grid.months.filter((m) => grid.layers.get(m) === "projete") : [];
  const nGroups = grid.kind === "value" ? grid.groups.length : 0;
  const omitted = repart ? repart.items.filter((x) => x.v <= 0).map((x) => x.group) : [];
  const barNotes = grid.kind === "value" ? barNote(projected, nGroups) : undefined;
  // Au-delà de huit parts positives, l'anneau cède la place à des barres horizontales : classées de la plus grande à la plus petite.
  const donutParts = repart ? repart.items.map((x) => ({ key: x.group, name: x.group, value: x.v, color: color(x.group) })) : [];
  const ranked = donutParts.filter((x) => x.value > 0).length > 8 ? [...donutParts].sort((a, b) => b.value - a.value) : donutParts;
  const donutNoteText = repart ? donutNote(omitted) : undefined;

  return (
    <>
      <form method="get" action={base} data-testid="em-form" aria-label="Paramètres des effectifs mensuels">
        <input type="hidden" name="vue" value="effectifs" />
        <ParamLayout
          testid="em"
          aside={
            <>
              <ParamSection title="J'analyse mes…" icon={<ListChecks size={16} aria-hidden="true" />}>
                <div className="field-row">
                  <label htmlFor="mesure">Rubrique</label>
                  <select className="select" id="mesure" name="mesure" defaultValue={measure}>{MEASURES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
                </div>
                <p className="em-param-link"><GlossaryLink slug={slug} term={KPI_TERMS.effectifsMeasures} label="Rubriques des effectifs mensuels" /></p>
              </ParamSection>
              <ParamSection title="Par…" icon={<CalendarDays size={16} aria-hidden="true" />}>
                <p className="em-param-fixed" data-testid="em-par">Temps : un mois par colonne</p>
              </ParamSection>
              <ParamSection title="Répartis par…" icon={<PieChart size={16} aria-hidden="true" />}>
                <div className="field-row">
                  <label htmlFor="axe">Axe de répartition</label>
                  <select className="select" id="axe" name="axe" defaultValue={axis}>
                    {AXES.map((a) => <option key={a.key} value={a.key} title={a.label}>{splitAxisLabel(a.label).name}</option>)}
                    {UNAVAILABLE_AXES.map((a) => <option key={a.label} value={`nd-${a.label}`} disabled>{a.label} — indisponible</option>)}
                  </select>
                </div>
                <p className="em-param-link"><GlossaryLink slug={slug} term={KPI_TERMS.effectifsBreakdown} label="Ventilation par axe" /></p>
                <details className="em-param-note" data-testid="em-axes-nd">
                  <summary>Axes indisponibles ({UNAVAILABLE_AXES.length})</summary>
                  <ul>{UNAVAILABLE_AXES.map((a) => <li key={a.label}><strong>{a.label}</strong> : {a.reason}</li>)}</ul>
                </details>
              </ParamSection>
            </>
          }
        >
          <div className="filters bar kpi-bar" data-testid="em-filters">
            <div className="field-row em-version">
              <label htmlFor="version">Version</label>
              <SearchableSelect className="select" id="version" name="version" defaultValue={version} searchLabel="Version" options={versions} />
            </div>
            <div className="field-row">
              <label htmlFor="annee">Année</label>
              <select className="select" id="annee" name="annee" defaultValue={year}>{(years.length ? years : [year]).map((y) => <option key={y} value={y}>{y}</option>)}</select>
            </div>
            <div className="kpi-actions">
              <button className="btn primary" type="submit">Afficher</button>
              <a className="btn" href={`${base}?vue=effectifs`}>Réinitialiser</a>
            </div>
          </div>
          <p className="desc" data-testid="em-context">
            {mdef.label} · par {axisLabel} · {versionLabel} · {year} · {unit === "eur" ? <MoneyUnitLabel /> : unitLabel(unit)}
            <GlossaryLink slug={slug} term={full ? KPI_TERMS.effectifsVersion : KPI_TERMS.effectifs} label={full ? "Version et mois projetés" : "Effectifs mensuels"} />
          </p>

          <MoneyText>{grid.kind === "nd" || !repart || !axisMonths ? (
            <section className="panel">
              <p className="nd" data-testid="em-nd">n.d. — {grid.kind === "nd" ? grid.reason : "aucune valeur"}</p>
            </section>
          ) : (
            <>
              <section className="panel" data-testid="em-graph">
                <div className="panel-head">
                  <PanelTitle slug={slug} term={KPI_TERMS.effectifsGraphs} label="Lecture des graphiques des effectifs mensuels">Graphiques</PanelTitle>
                </div>
                <div className="em-charts">
                  <div className="em-donut">
                    {repart.items.some((x) => x.v > 0) ? (
                      <DonutChart
                        testid="em-donut"
                        label={`Répartition de ${mdef.label.toLowerCase()} par ${axisLabel}, ${basis}`}
                        title={`Répartition — ${basis}`}
                        parts={ranked}
                        unit={unit}
                        centerLabel={stock ? "total du mois" : "cumul"}
                        note={donutNoteText}
                      />
                    ) : (
                      <figure className="chart" data-testid="em-donut" data-state="vide">
                        <figcaption className="chart-head"><span className="chart-title">Répartition — {basis}</span></figcaption>
                        <p className="desc">Aucune valeur positive à répartir sur cette base (total à {text(repart.total, unit)}).</p>
                      </figure>
                    )}
                  </div>
                  <div className="em-bars">
                    <BarChart
                      testid="em-chart"
                      label={`${mdef.label} par mois et par ${axisLabel}, ${year}`}
                      title={`${mdef.label} par mois — ${year}`}
                      categories={axisMonths.categories}
                      categoryTitles={axisMonths.titles.map((t, i) => (projected.includes(grid.months[i]) ? `${t} (projeté)` : t))}
                      series={gridSeries(grid)}
                      unit={unit}
                      mode={nGroups > 3 ? "stacked" : "grouped"}
                      toggle
                      height={300}
                      note={barNotes}
                    />
                  </div>
                </div>
              </section>

              <section className="panel" data-testid="em-repart-panel">
                <div className="panel-head">
                  <PanelTitle slug={slug} term={KPI_TERMS.effectifsShare} label="Répartition par groupe">Répartition par {axisLabel}</PanelTitle>
                  <span className="desc">{basis}</span>
                </div>
                <div className="table-wrap">
                  <table className="data-table kpi-table" data-testid="em-repart">
                    <thead><tr><th>Groupe</th><th className="num">Valeur</th><th className="num">Part</th></tr></thead>
                    <tbody>
                      {repart.items.map((it) => (
                        <tr key={it.group} data-group={it.group}>
                          <td><i className="swatch" style={{ background: color(it.group), marginRight: 8 }} aria-hidden="true" />{it.group}</td>
                          <td className="num" data-col="valeur">{text(it.v, unit)}</td>
                          <td className="num" data-col="part">{share(it.v, repart.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr data-group="total" className="total">
                        <th>Total</th>
                        <td className="num" data-col="valeur">{text(repart.total, unit)}</td>
                        <td className="num" data-col="part">{share(repart.total, repart.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            </>
          )}</MoneyText>
        </ParamLayout>
      </form>
      {/* Hors du volet de paramètres : le tableau prend toute la largeur de la page et se lit en entier (colonnes mois compactes). */}
      <MoneyText>{grid.kind === "value" && repart && axisMonths && (
        <section className="panel" data-testid="em-monthly-panel">
          <div className="panel-head">
            <PanelTitle slug={slug} term={KPI_TERMS.effectifsBreakdown} label="Ventilation par axe et tableau de référence">Répartition mensuelle</PanelTitle>
          </div>
          <p className="kpi-scroll-hint">Tableau défilant : faire glisser vers la droite.</p>
          <div className="table-wrap scroll" tabIndex={0} role="region" aria-label="Répartition mensuelle, tableau défilant">
            <table className="data-table kpi-table em-monthly sticky sticky-first" data-testid="em-table">
              <thead>
                <tr>
                  <th>Groupe</th>
                  {grid.months.map((m) => <th key={m} className="num">{monthShortLabel(m)}{grid.layers.get(m) === "projete" ? <span className="tile-foot"> proj.</span> : null}</th>)}
                </tr>
              </thead>
              <tbody>
                {grid.groups.map((g) => (
                  <tr key={g} data-group={g}>
                    <td title={g}><i className="swatch" style={{ background: color(g), marginRight: 8 }} aria-hidden="true" />{g}</td>
                    {grid.months.map((m) => {
                      const c = grid.cell(g, m);
                      return <td key={m} className="num" data-month={m}>{c.kind === "value" ? text(c.v, unit) : <abbr className="nd" title={c.kind === "nd" ? c.reason : undefined}>n.d.</abbr>}</td>;
                    })}
                  </tr>
                ))}
                <tr data-group="total" className="total">
                  <th>Total</th>
                  {grid.months.map((m) => {
                    const c = grid.total(m);
                    return <td key={m} className="num" data-month={m} data-col="total">{c.kind === "value" ? text(c.v, unit) : <abbr className="nd" title={c.kind === "nd" ? c.reason : undefined}>n.d.</abbr>}</td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          {ndReasons.length > 0 && <details data-testid="em-nd-list"><summary>Mois n.d. ({ndReasons.length})</summary><ul className="list">{ndReasons.map((r) => <li key={r} className="desc">{r}</li>)}</ul></details>}
        </section>
      )}</MoneyText>
    </>
  );
}
