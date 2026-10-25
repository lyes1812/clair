import { MoneyText, MoneyUnitLabel } from "@/components/Money";
import "@/styles/hypotheses-resultat.css";
import type { ReactNode } from "react";
import { BarChart, LineChart } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { ViewSwitch } from "@/components/ViewSwitch";
import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { HYP_TERMS } from "@/lib/glossary/hypotheses";
import type { Landing } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import { CATEGORY_IDS, CATEGORY_LABELS, type BaseSnapshot, type CategoryId, type Contribution, type ProjectedMonth, type Projection } from "@/lib/budget/types";
import { fmtEtp4 } from "@/lib/rh/kpi/format";
import { affichageOf, contributionsChart, costSeries, etpSeries, frDates, hasNd, hasValues, headcountSeries, monthAxis, monthLongLabel, natureChart, ndMonthsNote, showCharts, showTables, withAffichage, type NatureChart } from "@/lib/viz/hypotheses";
import { monthShort } from "../masse-salariale/components";

const KIND: Record<Contribution["kind"], string> = {
  base: "Base", augmentation: "Augmentation", quotite: "Changement de quotité", enveloppe: "Enveloppe", absence: "Congé non payé", depart: "Départ", "fin-contrat": "Fin de contrat connue", entree: "Entrée après la base", embauche: "Embauche", ponctuel: "Élément ponctuel", sortie: "Coûts de sortie",
};
const eur = (v: number | null) => (v === null ? "n.d." : formatEuros(v));
const fd = (s: string | null) => (s === null ? null : frDates(s));
const persons = (n: number) => `${n} ${n > 1 ? "personnes" : "personne"}`;
type Row = { month: string; layer: "reel" | "parent" | "projete"; source?: string; brut: number | null; charges: number | null; cost: number | null; headcount: number | null; etp4: number | null; nd: string | null; etpNd: string | null };

// Mois de l'année du premier mois projeté (réel figé) puis mois projetés jusqu'à la fin de l'horizon.
function rowsOf(base: BaseSnapshot, proj: Projection, scenario: ScenarioRow): Row[] {
  const year = scenario.firstMonth.slice(0, 4);
  const actual: Row[] = base.actuals
    .filter((a) => a.month.startsWith(year) && a.month < scenario.firstMonth)
    .map((a) => (a.kind === "nd" ? { month: a.month, layer: "reel", brut: null, charges: null, cost: null, headcount: null, etp4: null, nd: frDates(a.reason), etpNd: null } : { month: a.month, layer: "reel", brut: a.brut, charges: a.cotisations, cost: a.masse, headcount: a.headcount, etp4: a.etp4, nd: null, etpNd: fd(a.etpNd) }));
  // Base dérivée : mois projetés par le scénario parent dans l'année (coût et effectif seulement).
  const prior: Row[] = (base.prior ?? [])
    .filter((p) => p.month.startsWith(year) && p.month < scenario.firstMonth && !base.actuals.some((a) => a.month === p.month))
    .map((p) => (p.kind === "nd" ? { month: p.month, layer: "parent", source: p.source, brut: null, charges: null, cost: null, headcount: null, etp4: null, nd: frDates(p.reason), etpNd: null } : { month: p.month, layer: "parent", source: p.source, brut: p.brut ?? null, charges: p.charges ?? null, cost: p.cost, headcount: p.headcount, etp4: p.etp4, nd: p.brut === undefined ? "brut et charges non conservés par la base dérivée (créée avant leur reprise)" : null, etpNd: fd(p.etpNd) }));
  const projected: Row[] = proj.kind === "error" ? [] : proj.months.map((p: ProjectedMonth) => (p.kind === "nd" ? { month: p.month, layer: "projete", brut: null, charges: null, cost: null, headcount: null, etp4: null, nd: frDates(p.reasons.join(" ; ")), etpNd: null } : { month: p.month, layer: "projete", brut: p.brut, charges: p.charges, cost: p.cost, headcount: p.headcount, etp4: p.etp4, nd: null, etpNd: fd(p.etpNd) }));
  return [...actual, ...prior, ...projected];
}

// Mois projetés par les scénarios parents, groupés par scénario d'origine (une base dérivée de base dérivée a deux sources).
function priorBySource(base: BaseSnapshot, months: string[]) {
  const out: { source: string; months: string[]; cost: number }[] = [];
  for (const m of months) {
    const p = base.prior?.find((x) => x.month === m);
    if (!p || p.kind !== "value") continue;
    const g = out.find((x) => x.source === p.source) ?? (out.push({ source: p.source, months: [], cost: 0 }), out.at(-1)!);
    g.months.push(m);
    g.cost += p.cost;
  }
  return out;
}

// Rien à tracer : on l'écrit, avec la raison de chaque série.
export function NdBlock({ title, reasons }: { title: string; reasons: string[] }) {
  return (
    <div className="hr-nd">
      <p className="hr-nd-title">{title}</p>
      <p className="nd">n.d. — aucune valeur à tracer.</p>
      {reasons.length > 0 && <ul className="list">{reasons.map((r, i) => <li key={`${i}-${r}`} className="desc">{r}</li>)}</ul>}
    </div>
  );
}

// Titre de panneau suivi, s'il y a lieu, de son « ? » vers le glossaire, puis d'UNE ligne de contexte (période · version · unité).
// Les écrans de chiffres n'expliquent pas : les définitions et les règles de lecture sont au glossaire.
export function PanelTitle({ title, desc, slug, term, label }: { title: ReactNode; desc?: ReactNode; slug: string | null; term?: string; label?: string }) {
  return (
    <div className="hr-title">
      <div className="hr-title-row">
        <h2>{title}</h2>
        {slug && term && <GlossaryLink slug={slug} term={term} label={label} />}
      </div>
      {desc && <p className="desc">{desc}</p>}
    </div>
  );
}

// Titre d'une tuile suivi de son « ? » ; `sub` : sa précision de période ou d'unité, en une ligne.
export function TileTitle({ title, sub, slug, term, label }: { title: ReactNode; sub?: ReactNode; slug: string | null; term?: string; label?: string }) {
  return (
    <dt>
      <span className="hr-dt-title">{title}{slug && term && <GlossaryLink slug={slug} term={term} label={label} />}</span>
      {sub && <span className="hr-sub">{sub}</span>}
    </dt>
  );
}

// Légende des mois n.d. : une seule par zone de graphiques, à la place d'une phrase sous chaque graphique.
export function NdKey({ testid = "hr-nd-key" }: { testid?: string }) {
  return (
    <p className="chart-legend hr-nd-key" data-testid={testid}>
      <span className="legend-btn static"><i className="swatch hatch" aria-hidden="true" />n.d. : colonne hachurée, barre absente ou courbe interrompue (raison au survol)</span>
    </p>
  );
}

// Légende des tendances, une seule par écran : rouge = coût en hausse, vert = coût en baisse. Le signe et la flèche accompagnent
// toujours la couleur ; la convention est au glossaire.
export function TrendLegend({ slug }: { slug: string | null }) {
  return (
    <p className="trend-legend hr-trend-legend" data-testid="hr-trend-legend">
      <span><i className="dot bad" aria-hidden="true" />Coût en hausse</span>
      <span><i className="dot good" aria-hidden="true" />Coût en baisse</span>
      {slug && <GlossaryLink slug={slug} term={HYP_TERMS.tendances} label="Tendances financières" />}
    </p>
  );
}

// Graphiques de la projection, un panneau par notion : coût par mois (réel, projeté), effectif et ETP de fin de mois ; coût projeté par
// nature de contribution ; contributions seules (sans la base). Les montants viennent des mêmes lignes que le tableau « Mois par mois »
// (aucun recalcul ici). Le « ? » de chaque panneau mène à sa définition ; une seule légende n.d. ferme la zone.
function Lecture({ slug, rows, months, nature }: { slug: string; rows: Row[]; months: ProjectedMonth[]; nature: NatureChart }) {
  const axis = monthAxis(rows.map((r) => r.month));
  const first = rows[0]?.month ?? "";
  const last = rows.at(-1)?.month ?? "";
  const range = `${formatMonth(first).toLowerCase()} → ${formatMonth(last).toLowerCase()}`;
  const natureRange = `${monthLongLabel(months[0].month)} → ${monthLongLabel(months.at(-1)!.month)}`;
  const nProjected = rows.filter((r) => r.layer !== "reel").length;
  const nd = ndMonthsNote(rows);
  const nNd = rows.filter((r) => r.cost === null).length;
  const cost = costSeries(rows);
  const heads = headcountSeries(rows);
  const etps = etpSeries(rows);
  const contrib = contributionsChart(nature);
  const natureNd = months.filter((m) => m.kind === "nd");
  const reasonsOf = (series: { name: string; reasons?: (string | null)[] }[]) => [...new Set(series.flatMap((s) => (s.reasons ?? []).filter((r): r is string => !!r && !r.startsWith("sans objet"))))];
  const anyNd = hasNd(cost) || hasNd(heads) || hasNd(etps) || hasNd(nature.series);
  return (
    <div className="hr-stack" data-testid="proj-lecture">
      <section className="panel">
        <PanelTitle title="Coût, effectif et ETP par mois" desc={<>{range} · <MoneyUnitLabel />, personnes et ETP</>} slug={slug} term={HYP_TERMS.projectionGraphiques} />
        <div className="hr-charts">
          <BarChart
            testid="proj-chart"
            label={`Coût employeur par mois en euros, de ${monthLongLabel(first)} à ${monthLongLabel(last)} : ${rows.length} mois dont ${nProjected} projetés${nNd ? ` et ${nNd} n.d.` : ""}`}
            title="Coût employeur par mois (euros)"
            categories={axis.categories}
            categoryTitles={axis.titles}
            series={cost}
            unit="eur"
            mode="stacked"
          />
          <div className="hr-charts-2">
            <div className="hr-block">
              {hasValues(heads) ? (
                <LineChart
                  testid="proj-chart-effectif"
                  label={`Effectif de fin de mois, en personnes, de ${monthLongLabel(first)} à ${monthLongLabel(last)}`}
                  title="Effectif de fin de mois (personnes)"
                  categories={axis.categories}
                  categoryTitles={axis.titles}
                  series={heads}
                  unit="nombre"
                  height={230}
                />
              ) : (
                <NdBlock title="Effectif de fin de mois (personnes)" reasons={reasonsOf(heads)} />
              )}
            </div>
            <div className="hr-block">
              {hasValues(etps) ? (
                <LineChart
                  testid="proj-chart-etp"
                  label={`ETP de fin de mois, de ${monthLongLabel(first)} à ${monthLongLabel(last)}`}
                  title="ETP de fin de mois"
                  categories={axis.categories}
                  categoryTitles={axis.titles}
                  series={etps}
                  unit="etp"
                  height={230}
                />
              ) : (
                <NdBlock title="ETP de fin de mois" reasons={reasonsOf(etps)} />
              )}
            </div>
          </div>
          {(anyNd || nd !== null) && (
            <div className="hr-nd-zone">
              {anyNd && <NdKey />}
              {nd !== null && <p className="tile-foot nd" data-testid="proj-chart-nd">n.d. : {nd}</p>}
            </div>
          )}
        </div>
      </section>
      {hasValues(nature.series) ? (
        <>
          <section className="panel hr-chart-panel" data-testid="proj-nature-chart">
            <PanelTitle title="Coût projeté par nature de contribution" desc={<>{natureRange} · <MoneyUnitLabel /></>} slug={slug} term={HYP_TERMS.coutNature} />
            <BarChart
              testid="proj-chart-nature"
              label={`Coût projeté par nature de contribution, en euros, de ${monthLongLabel(months[0].month)} à ${monthLongLabel(months.at(-1)!.month)}`}
              categories={nature.categories}
              categoryTitles={nature.titles}
              series={nature.series}
              unit="eur"
              mode="stacked"
              toggle
            />
          </section>
          <section className="panel hr-chart-panel" data-testid="proj-contributions">
            <PanelTitle title="Contributions hors base" desc={<>{natureRange} · <MoneyUnitLabel /></>} slug={slug} term={HYP_TERMS.contributionsHorsBase} />
            {contrib.series.length > 0 ? (
              <BarChart
                testid="proj-chart-contributions"
                label={`Contributions seules, hors base, en euros, de ${monthLongLabel(months[0].month)} à ${monthLongLabel(months.at(-1)!.month)} : ${contrib.series.map((s) => s.name).join(", ")}`}
                categories={contrib.categories}
                categoryTitles={contrib.titles}
                series={contrib.series}
                unit="eur"
                mode="stacked"
                toggle
              />
            ) : (
              <p className="desc" data-testid="proj-chart-contributions-vide">Aucune contribution hors base d'un montant non nul sur ces mois : le coût de chaque mois calculé est celui de la base.</p>
            )}
          </section>
        </>
      ) : (
        <section className="panel hr-chart-panel" data-testid="proj-nature-chart">
          <PanelTitle title="Coût projeté par nature de contribution" slug={slug} term={HYP_TERMS.coutNature} />
          <NdBlock title={natureRange} reasons={[...new Set(natureNd.flatMap((m) => (m.kind === "nd" ? m.reasons.map(frDates) : [])))]} />
        </section>
      )}
    </div>
  );
}

export function ProjectionView({ slug, scenario, base, proj, landing, month, affichage }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; proj: Projection; landing: Landing; month: string; affichage?: string }) {
  const href = `/e/${slug}/studio-rh/hypotheses?scenario=${scenario.id}`;
  if (proj.kind === "error") {
    return (
      <MoneyText><section className="panel" data-testid="proj-error">
        <h2>Projection refusée</h2>
        <ul className="list">{proj.errors.map((e) => <li key={e} className="nd">{frDates(e)}</li>)}</ul>
      </section></MoneyText>
    );
  }
  const aff = affichageOf(affichage);
  // Adresse de l'écran, mois ouvert conservé ; l'affichage « tout » n'est pas écrit dans l'adresse.
  const here = `${href}&vue=resultat&sous=projection${/^\d{4}-\d{2}$/.test(month) ? `&mois=${month}` : ""}`;
  const monthHref = (m: string) => `${withAffichage(`${href}&vue=resultat&sous=projection&mois=${m}`, aff)}#proj-detail`;
  const rows = rowsOf(base, proj, scenario);
  const pm = proj.months;
  const nature = natureChart(pm);
  const ndMonths = pm.filter((p) => p.kind === "nd");
  const horizon = ndMonths.length ? null : pm.reduce((s, p) => s + (p.kind === "value" ? p.cost : 0), 0);
  const last = pm.at(-1)!;
  const detail = pm.find((p) => p.month === month) ?? null;
  const headNote = [last.kind === "value" && last.etpNd ? `ETP n.d. — ${frDates(last.etpNd)}` : null, base.etpNote ? frDates(base.etpNote) : null].filter((x): x is string => !!x);
  // Une ligne de contexte : période · origine des mois (réel figé, projeté) · unité.
  const first = rows[0]?.month ?? scenario.firstMonth;
  const range = `${formatMonth(first).toLowerCase()} → ${formatMonth(rows.at(-1)?.month ?? scenario.lastMonth).toLowerCase()}`;
  const origin = (base.prior?.length ?? 0) > 0 ? "réel figé ou projeté par le scénario parent" : "réel figé";
  return (
    <MoneyText><>
      <div className="hr-switch">
        <ViewSwitch
          testid="proj-affichage"
          label="Affichage de la projection"
          current={aff}
          options={[
            { key: "tout", label: "Afficher tout", href: withAffichage(here, "tout") },
            { key: "graphique", label: "Graphique", href: withAffichage(here, "graphique") },
            { key: "tableau", label: "Tableau", href: withAffichage(here, "tableau") },
          ]}
        />
        <p className="hr-context">{range} · {origin} avant {formatMonth(scenario.firstMonth).toLowerCase()}, projeté ensuite · <MoneyUnitLabel /></p>
      </div>
      {ndMonths.length > 0 && (
        <p className="notice" data-testid="proj-nd">
          Projection n.d. pour {ndMonths.length} mois : {frDates([...new Set(ndMonths.flatMap((p) => (p.kind === "nd" ? p.reasons : [])))].join(" ; "))}. <a href={`${href}&vue=bases`}>Compléter dans Bases individuelles</a>.
        </p>
      )}
      <section className="panel" data-testid="proj-overview">
        <h2>Vue d'ensemble</h2>
        <dl className="facts hr-tiles">
          <div className="hr-tile" data-testid="proj-tile-landing">
            <TileTitle title={`Atterrissage ${landing.year}`} sub="coût employeur · réel + projeté" slug={slug} term={HYP_TERMS.atterrissage} />
            <dd className={landing.kind === "nd" ? "nd" : undefined}>{landing.kind === "nd" ? `n.d. — ${frDates(landing.reason)}` : formatEuros(landing.total)}</dd>
            {landing.kind === "value" && (
              <span className="tile-foot" data-testid="proj-tile-landing-split">
                {[
                  landing.actualMonths.length ? `réel ${monthShort(landing.actualMonths[0])}–${monthShort(landing.actualMonths.at(-1)!)} ${formatEuros(landing.actual)}` : null,
                  ...priorBySource(base, landing.priorMonths).map((g) => `${g.source} ${monthShort(g.months[0])}–${monthShort(g.months.at(-1)!)} ${formatEuros(g.cost)}`),
                  landing.projectedMonths.length ? `projeté ${monthShort(landing.projectedMonths[0])}–${monthShort(landing.projectedMonths.at(-1)!)} ${formatEuros(landing.projected)}` : null,
                ].filter(Boolean).join(" + ")}
              </span>
            )}
          </div>
          <div className="hr-tile" data-testid="proj-tile-horizon">
            <TileTitle title="Coût projeté" sub={`${formatMonth(scenario.firstMonth).toLowerCase()} → ${formatMonth(scenario.lastMonth).toLowerCase()} · ${pm.length} mois`} slug={slug} term={HYP_TERMS.coutProjete} />
            <dd className={horizon === null ? "nd" : undefined}>{horizon === null ? "n.d. — un mois projeté au moins est n.d." : formatEuros(horizon)}</dd>
          </div>
          <div className="hr-tile" data-testid="proj-tile-headcount">
            <TileTitle title="Effectif et ETP" sub={`fin ${formatMonth(last.month).toLowerCase()}`} slug={slug} term={HYP_TERMS.effectif} />
            <dd className={last.kind === "nd" ? "nd" : undefined}>{last.kind === "nd" ? "n.d." : `${persons(last.headcount)} · ${last.etp4 === null ? "ETP n.d." : `${fmtEtp4(last.etp4)} ETP`}`}</dd>
            {(headNote.length > 0) && <span className="tile-foot">{headNote.join(" · ")}</span>}
          </div>
        </dl>
      </section>
      {showCharts(aff) && <Lecture slug={slug} rows={rows} months={pm} nature={nature} />}
      {showTables(aff) && (
        <section className="panel" data-testid="proj-mois">
          <PanelTitle title="Mois par mois" desc="Réel figé puis projeté · cliquer un mois projeté ouvre son détail" slug={slug} term={HYP_TERMS.projection} />
          <div className="table-wrap">
            <table className="data-table" data-testid="proj-table">
              <thead><tr><th>Mois</th><th>Nature</th><th className="num">Brut</th><th className="num">Charges</th><th className="num">Coût employeur</th><th className="num">Effectif fin de mois</th><th className="num">ETP</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month} data-month={r.month} data-layer={r.layer}>
                    <td>{r.layer === "projete" && r.cost !== null ? <a href={monthHref(r.month)}>{formatMonth(r.month)}</a> : formatMonth(r.month)}</td>
                    <td>{r.layer === "reel" ? "Réel" : r.layer === "parent" ? (r.source ?? "Projeté (scénario parent)") : "Projeté"}</td>
                    <td className="num">{eur(r.brut)}</td>
                    <td className="num">{eur(r.charges)}</td>
                    <td className="num" data-col="cost" title={r.nd ?? undefined}>{r.cost === null ? "n.d." : formatEuros(r.cost)}</td>
                    <td className="num">{r.headcount ?? "n.d."}</td>
                    <td className="num">{r.etp4 === null ? "n.d." : fmtEtp4(r.etp4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.some((r) => r.nd || r.etpNd) && (
            <p className="tile-foot nd" data-testid="proj-nd-reasons">n.d. : {[...new Set(rows.flatMap((r) => [r.nd && `${formatMonth(r.month).toLowerCase()} : ${r.nd}`, r.etpNd && `${formatMonth(r.month).toLowerCase()} : ${r.etpNd}`]).filter(Boolean))].join(" ; ")}</p>
          )}
          {rows.some((r) => r.layer !== "reel" && r.cost !== null && (r.brut === null || r.charges === null)) && (
            <p className="tile-foot nd" data-testid="proj-brut-nd">n.d. : brut ou charges d'un mois projeté dont un élément est saisi en coût chargé, non ventilé (coût employeur exact).</p>
          )}
        </section>
      )}
      {showTables(aff) && <NatureTable slug={slug} nature={nature} months={pm} />}
      {showTables(aff) && <CategoriesTable slug={slug} proj={proj} base={base} />}
      {showTables(aff) && detail && detail.kind === "value" && <Detail slug={slug} month={detail} />}
    </></MoneyText>
  );
}

// Tableau exact du graphique « par nature » : pour chaque mois, la somme des contributions du moteur de chaque nature ; la dernière
// ligne reprend le coût du mois donné par le moteur (somme des lignes). Mois n.d. : « n.d. » avec la raison au survol. Nature sans
// aucune contribution ce mois-là : « — » (aucune hypothèse de ce type), jamais un 0,00 € qui passerait pour un solde calculé.
function NatureTable({ slug, nature, months }: { slug: string; nature: NatureChart; months: ProjectedMonth[] }) {
  if (!hasValues(nature.series)) return null;
  const why = (m: ProjectedMonth) => (m.kind === "nd" ? frDates(m.reasons.join(" ; ")) : undefined);
  return (
    <MoneyText><section className="panel" data-testid="proj-nature">
      <PanelTitle title="Coût projeté par nature de contribution" desc={<>Mois projetés · <MoneyUnitLabel /></>} slug={slug} term={HYP_TERMS.coutNature} />
      <div className="table-wrap">
        <table className="data-table sticky-first" data-testid="proj-nature-table">
          <thead><tr><th>Nature</th>{months.map((m, i) => <th key={m.month} className="num" title={nature.titles[i]}>{nature.categories[i]}</th>)}</tr></thead>
          <tbody>
            {nature.series.map((s, si) => (
              <tr key={s.key} data-nature={s.key}>
                <td><span className="hr-group"><i className="swatch" style={{ background: s.color }} aria-hidden="true" />{s.name}</span></td>
                {s.values.map((v, i) => (
                  <td key={months[i].month} className="num" data-month={months[i].month} title={v === null ? why(months[i]) : nature.contributing[si][i] ? undefined : "aucune contribution de cette nature ce mois-là"}>
                    {v === null ? "n.d." : nature.contributing[si][i] ? formatEuros(v) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total" data-testid="proj-nature-total">
              <td>Coût du mois</td>
              {months.map((m) => <td key={m.month} className="num" data-month={m.month} title={why(m)}>{m.kind === "value" ? formatEuros(m.cost) : "n.d."}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </section></MoneyText>
  );
}

// Effectif et ETP de fin de mois par catégorie (CDI, CDD, apprenti, stagiaire) ; « non classé » : nature sans catégorie.
function CategoriesTable({ slug, proj, base }: { slug: string; proj: Projection; base: BaseSnapshot }) {
  if (proj.kind === "error") return null;
  const months = proj.months.filter((m): m is Extract<ProjectedMonth, { kind: "value" }> => m.kind === "value" && m.byCategory !== undefined);
  if (!months.length) return null;
  const keys = [...CATEGORY_IDS, "nc"].filter((k) => months.some((m) => m.byCategory![k]));
  const ref = base.contracts.filter((c) => c.counted);
  const unclassified = ref.filter((c) => !c.category).length;
  const text = (n: number, etp4: number | null) => `${persons(n)} · ${etp4 === null ? "ETP n.d." : `${fmtEtp4(etp4)} ETP`}`;
  // Une seule catégorie : la colonne Total répéterait la même valeur.
  const withTotal = keys.length > 1;
  return (
    <section className="panel" data-testid="proj-categories">
      <PanelTitle title="Effectif et ETP par catégorie" desc="Fin de mois · contrats comptés dans l'effectif" slug={slug} term={HYP_TERMS.categories} />
      <div className="table-wrap">
        <table className="data-table" data-testid="proj-categories-table">
          <thead>
            <tr><th>Mois</th>{keys.map((k) => <th key={k} className="num">{k === "nc" ? "Non classé" : CATEGORY_LABELS[k as CategoryId]}</th>)}{withTotal && <th className="num">Total</th>}</tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} data-month={m.month}>
                <td>{formatMonth(m.month)}</td>
                {keys.map((k) => {
                  const c = m.byCategory![k];
                  return <td key={k} className="num" data-col={k}>{c ? text(c.headcount, c.etp4) : "—"}</td>;
                })}
                {withTotal && <td className="num" data-col="total">{text(m.headcount, m.etp4)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unclassified > 0 && <p className="tile-foot" data-testid="proj-categories-nd">{unclassified} contrat{unclassified > 1 ? "s" : ""} sans catégorie (nature non reconnue), compté{unclassified > 1 ? "s" : ""} « non classé ».</p>}
    </section>
  );
}

// Détail d'un mois projeté : chaque contribution et l'hypothèse qui la porte ; la somme égale le total du mois.
function Detail({ slug, month }: { slug: string; month: Extract<ProjectedMonth, { kind: "value" }> }) {
  // Libellé écrit par le moteur (« Entrée le 2026-10-12 ») : date en français ; le libellé d'une hypothèse saisie reste tel que saisi.
  const shown = (c: { hypothesisId: string | null; label: string }) => (c.hypothesisId ? c.label : frDates(c.label));
  const byHyp = new Map<string, { label: string; shown: string; kind: Contribution["kind"]; cost: number; n: number }>();
  for (const c of month.contributions) {
    // Une ligne par hypothèse et par nature d'effet (un départ : économie de paie d'un côté, coûts de sortie de l'autre).
    const k = `${c.hypothesisId ?? "-"}:${c.kind}:${c.hypothesisId || c.kind === "base" ? "" : c.label}`;
    const g = byHyp.get(k) ?? { label: c.label, shown: shown(c), kind: c.kind, cost: 0, n: 0 };
    g.cost += c.cost;
    g.n += 1;
    byHyp.set(k, g);
  }
  return (
    <MoneyText><section className="panel" id="proj-detail" data-testid="proj-detail">
      <PanelTitle title={`${formatMonth(month.month)} — de quoi est fait le coût projeté`} slug={slug} term={HYP_TERMS.contribution} />
      <div className="table-wrap">
        <table className="data-table" data-testid="proj-detail-hyps">
          <thead><tr><th>Hypothèse ou base</th><th>Type</th><th className="num">Lignes</th><th className="num">Coût employeur</th></tr></thead>
          <tbody>
            {[...byHyp].map(([k, g]) => (
              <tr key={k} data-hyp={g.label}><td>{g.shown}</td><td>{KIND[g.kind]}</td><td className="num">{g.n}</td><td className="num" data-col="cost">{formatEuros(g.cost)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr className="total" data-testid="proj-detail-total"><td colSpan={3}>Total du mois</td><td className="num" data-col="cost">{formatEuros(month.cost)}</td></tr></tfoot>
        </table>
      </div>
      <details className="hr-lines">
        <summary>Détail par contrat ({month.contributions.length} lignes)</summary>
        <div className="table-wrap">
          <table className="data-table" data-testid="proj-detail-lines">
            <thead><tr><th>Contrat ou poste</th><th>Service</th><th>Hypothèse ou base</th><th>Type</th><th className="num">Brut</th><th className="num">Charges</th><th className="num">Coût</th></tr></thead>
            <tbody>
              {month.contributions.map((c, i) => (
                <tr key={i}><td>{c.who}</td><td>{c.service ?? "Non ventilé"}</td><td>{shown(c)}</td><td>{KIND[c.kind]}</td><td className="num">{eur(c.brut)}</td><td className="num">{eur(c.charges)}</td><td className="num">{formatEuros(c.cost)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr className="total"><td colSpan={4}>Total</td><td className="num">{eur(month.brut)}</td><td className="num">{eur(month.charges)}</td><td className="num">{formatEuros(month.cost)}</td></tr></tfoot>
          </table>
        </div>
      </details>
    </section></MoneyText>
  );
}
