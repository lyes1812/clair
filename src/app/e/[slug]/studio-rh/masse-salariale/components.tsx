import type { ReactNode } from "react";
import { BarChart } from "@/components/charts";
import type { ChartSeries } from "@/components/charts/shared";
import { GlossaryLink } from "@/components/GlossaryLink";
import { MASSE_TERMS } from "@/lib/glossary/masse";
import type { MonthPayroll } from "@/lib/payroll/engine";
import { fmtFixed } from "@/lib/rh/kpi/format";
import { COLORS, euros, hasData, masseSeries, monthsAxis, seriesReasons } from "@/lib/viz/masse";

const MONTH_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const monthShort = (m: string) => MONTH_SHORT[Number(m.slice(5, 7)) - 1];
export const eurosOf = (r: { num: number; den: number }) => `${fmtFixed({ num: r.num, den: r.den * 100 })} €`;

export const MM = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
export const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// Affichage de l'écran (comme Écart budgétaire) : tout, graphiques seuls ou tableaux seuls ; porté par l'adresse (affichage=).
export type Affichage = "tout" | "graphique" | "tableau";
export const AFFICHAGES: Affichage[] = ["tout", "graphique", "tableau"];
export const isAffichage = (v: string): v is Affichage => (AFFICHAGES as string[]).includes(v);

// En-tête : titre de l'entrée, sans paragraphe explicatif (les définitions sont au glossaire). La source et le détail de la lecture
// viennent sous les onglets : la barre d'onglets reste au même endroit d'un écran à l'autre. `summary` : texte optionnel, non utilisé
// par les écrans.
export function MsHead({ title, summary, children }: { title: string; summary?: string; children?: ReactNode }) {
  return (
    <div className="ms-head">
      <span className="label">Studio RH</span>
      <h1>{title}</h1>
      {summary && <p className="desc">{summary}</p>}
      {children}
    </div>
  );
}

// Bloc replié « Détails de la lecture » : les mentions techniques qui se répètent d'un écran à l'autre (montants bruts de la
// source, grille de comptes, mois lus). Rien n'y est retiré : le contenu est seulement à un clic.
export function ReadDetails({ children }: { children: ReactNode }) {
  return (
    <details className="ms-read-details" data-testid="ms-read-details">
      <summary>Détails de la lecture</summary>
      <div className="ms-read-body">{children}</div>
    </details>
  );
}

// Ligne de source (une ligne) et, à sa suite, le détail de la lecture replié.
export function MsRead({ source, children }: { source?: ReactNode; children?: ReactNode }) {
  if (!source && !children) return null;
  return (
    <div className="ms-read">
      {source}
      {children && <ReadDetails>{children}</ReadDetails>}
    </div>
  );
}

// Titre de panneau suivi, s'il y a lieu, de son « ? » vers le glossaire (`slug` et `term` ensemble) ; `desc` : une ligne de contexte.
export function PanelTitle({ title, desc, slug, term }: { title: ReactNode; desc?: ReactNode; slug?: string; term?: string }) {
  return (
    <div className="ms-panel-title">
      <div className="ms-title-row">
        <h2>{title}</h2>
        {slug && term && <GlossaryLink slug={slug} term={term} />}
      </div>
      {desc && <p className="desc">{desc}</p>}
    </div>
  );
}

// En-tête de panneau : titre (et son « ? »), actions à droite. Le même sur tous les panneaux de l'écran.
export function PanelHead({ title, desc, tools, slug, term }: { title: ReactNode; desc?: ReactNode; tools?: ReactNode; slug?: string; term?: string }) {
  return (
    <div className="panel-head">
      <PanelTitle title={title} desc={desc} slug={slug} term={term} />
      {tools && <div className="panel-tools">{tools}</div>}
    </div>
  );
}

// Légende des tendances, une seule par écran : rouge = coût en hausse, vert = coût en baisse. Le signe et la flèche accompagnent
// toujours la couleur ; la convention est au glossaire.
export function TrendLegend({ slug }: { slug: string }) {
  return (
    <p className="trend-legend" data-testid="ms-trend-legend">
      <span><i className="dot bad" aria-hidden="true" />Coût en hausse</span>
      <span><i className="dot good" aria-hidden="true" />Coût en baisse</span>
      <GlossaryLink slug={slug} term={MASSE_TERMS.tendances} />
    </p>
  );
}

// Légende d'un graphique mensuel qui contient un n.d. : une seule par zone de graphiques, à la place d'une phrase sous chaque graphique.
export function NdKey({ testid = "ms-nd-key" }: { testid?: string }) {
  return (
    <p className="chart-legend ms-nd-key" data-testid={testid}>
      <span className="legend-btn static"><i className="swatch hatch" aria-hidden="true" />n.d. : colonne hachurée, barre absente ou courbe interrompue (raison au survol)</span>
    </p>
  );
}

// Barre de filtres : année, premier et dernier mois, service ; périodes rapides sur une seconde ligne.
export type Preset = { label: string; href: string; current: boolean };
export function PeriodBar(p: {
  years: number[];
  year: number;
  from: string;
  to: string;
  hidden: Record<string, string>;
  presets: Preset[];
  resetHref: string;
  service?: { value: string; options: { value: string; label: string }[] };
}) {
  return (
    <form method="get" className="filters bar ms-bar" data-testid="ms-filters" aria-label="Période et périmètre">
      {Object.entries(p.hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="field-row">
        <label htmlFor="annee">Année</label>
        <select className="select" id="annee" name="annee" defaultValue={String(p.year)}>
          {p.years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <div className="field-row">
        <label htmlFor="de">Premier mois</label>
        <select className="select" id="de" name="de" defaultValue={p.from}>
          {MM.map((m, i) => <option key={m} value={m}>{MONTH_NAMES[i]}</option>)}
        </select>
      </div>
      <div className="field-row">
        <label htmlFor="a">Dernier mois</label>
        <select className="select" id="a" name="a" defaultValue={p.to}>
          {MM.map((m, i) => <option key={m} value={m}>{MONTH_NAMES[i]}</option>)}
        </select>
      </div>
      {p.service && (
        <div className="field-row">
          <label htmlFor="service">Service</label>
          <select className="select" id="service" name="service" defaultValue={p.service.value}>
            <option value="">Tous les services</option>
            {p.service.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      <div className="ms-bar-actions">
        <button className="btn primary" type="submit">Afficher</button>
        <a className="btn" href={p.resetHref}>Réinitialiser</a>
      </div>
      {p.presets.length > 0 && (
        <div className="ms-bar-presets" data-testid="ms-presets" role="group" aria-label="Périodes rapides">
          <span className="ms-bar-label">Périodes rapides</span>
          {p.presets.map((x) => <a key={x.label} className="btn small" href={x.href} aria-current={x.current ? "true" : undefined}>{x.label}</a>)}
        </div>
      )}
    </form>
  );
}

// Tuile d'indicateur : libellé suivi de son « ? » vers le glossaire, valeur en grand, repère de lecture, comparaison N-1 sous un filet.
// Une seule balise <dd> par tuile : la valeur ; tout le reste est dans des <span> / <div> (tests et lecteurs d'écran lisent la valeur seule).
// `nd` : valeur n.d. (« n.d. » en gris italique, raison listée sous les tuiles) ; `ndLong` : la raison elle-même est la valeur (texte courant).
// `sub` : la tuile détaille la précédente (« dont primes »), elle est en retrait. `def` + `slug` : « ? » vers l'entrée du glossaire.
// `trend` : classe de tendance (trend-bad / trend-good, voir trendOf) de la valeur, quand elle est un écart de montant.
export function Tile(p: { testid: string; label: string; value: ReactNode; nd?: boolean; ndLong?: boolean; main?: boolean; sub?: boolean; lead?: ReactNode; compare?: ReactNode; foot?: ReactNode; def?: string; slug?: string; trend?: string }) {
  const dd = [p.nd ? (p.ndLong ? "nd long" : "nd") : "", p.nd ? "" : (p.trend ?? "")].filter(Boolean).join(" ");
  return (
    <div data-testid={p.testid} className={["ms-tile", p.main ? "main" : "", p.sub ? "sub" : ""].filter(Boolean).join(" ")}>
      <dt>{p.label}{p.def && p.slug && <GlossaryLink slug={p.slug} term={p.def} label={p.label} />}</dt>
      <dd className={dd || undefined}>{p.value}</dd>
      {p.lead && <span className="tile-foot ms-tile-lead">{p.lead}</span>}
      {p.compare && <div className="ms-tile-compare">{p.compare}</div>}
      {p.foot}
    </div>
  );
}

// Raisons des « n.d. » d'un tableau, listées sous le tableau (jamais seulement en infobulle).
export function NdLines({ lines, testid = "ms-nd-reasons" }: { lines: string[]; testid?: string }) {
  if (lines.length === 0) return null;
  return (
    <div className="tile-foot ms-nd-lines" data-testid={testid}>
      <strong className="nd">n.d.</strong>
      <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}

// Zone de défilement d'un tableau : atteignable au clavier (une zone qui défile sans lien ni champ ne l'est pas autrement) et
// nommée pour les lecteurs d'écran ; `gap` : espace au-dessus quand elle suit un autre bloc.
export function ScrollTable({ label, gap, children }: { label: string; gap?: boolean; children: ReactNode }) {
  return (
    <div className={gap ? "table-wrap scroll ms-scroll ms-scroll-gap" : "table-wrap scroll ms-scroll"} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

// Pied d'une zone de graphiques : seulement l'accès au tableau exact quand l'affichage ne montre que les graphiques (l'explication
// de la lecture est au glossaire). Rien dans les autres affichages.
export function GraphFoot({ aff, tableHref, testid = "ms-graph-foot" }: { aff: Affichage; tableHref: string; testid?: string }) {
  if (aff !== "graphique") return null;
  return (
    <p className="tile-foot ms-graph-foot" data-testid={testid}>
      <a href={tableHref}>Afficher le tableau exact</a>
    </p>
  );
}

// État vide « n.d. » : un seul composant pour tout l'écran (graphique non tracé, rapprochement sans comptabilité, services
// absents). Titre « n.d. » (ou `title`), la raison écrite une fois, puis l'action pour y remédier.
export function NdState({ testid, heading, title = "n.d.", reason, reasons = [], more = 0, action, children }: { testid: string; heading?: string; title?: string; reason?: ReactNode; reasons?: string[]; more?: number; action?: { href: string; label: string }; children?: ReactNode }) {
  return (
    <div className="ms-nd-state" data-testid={testid}>
      {heading && <h3 className="ms-sub">{heading}</h3>}
      <p className="ms-nd-title">{title}</p>
      {reason && <p className="ms-nd-reason">{reason}</p>}
      {children}
      {reasons.length > 0 && <ul className="ms-nd-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {more > 0 && <p className="tile-foot">… et {more} autre{more > 1 ? "s" : ""} raison{more > 1 ? "s" : ""}.</p>}
      {action && <a className="ms-nd-action" href={action.href}>{action.label}<span aria-hidden="true"> →</span></a>}
    </div>
  );
}

// Graphique dont aucune valeur n'est connue : non tracé, avec la raison (un axe à zéro, ou une courbe vide, ferait croire à des
// valeurs nulles). Les raisons sont celles des mois n.d. (`lines` : raisons déjà regroupées par l'écran, à défaut celles des
// séries) ; au-delà de trois, le nombre des autres est dit.
export function ChartGuard({ testid, title, series, lines, children }: { testid: string; title: string; series: ChartSeries[]; lines?: string[]; children: ReactNode }) {
  if (hasData(series)) return <>{children}</>;
  const reasons = lines && lines.length > 0 ? lines : seriesReasons(series);
  const shown = reasons.slice(0, 3);
  return <NdState testid={`${testid}-vide`} heading={title} reason="Aucune valeur connue sur la période : graphique non tracé." reasons={shown} more={reasons.length - shown.length} />;
}

// Tendance mensuelle : barres groupées, masse chargée de l'année N et du même mois un an plus tôt (N-1). Un mois n.d. est une
// colonne hachurée avec sa raison, sans hauteur inventée. Aucune note sous le graphique : la lecture est au glossaire, les mois provisoires
// sont dans la ligne de période de l'écran et dans l'infobulle.
export function TrendChart({ rows, previous, lines }: { rows: MonthPayroll[]; previous: MonthPayroll[]; lines?: string[] }) {
  const year = rows[0]?.month.slice(0, 4) ?? "";
  const prevYear = previous[0]?.month.slice(0, 4) ?? "";
  const open = [...rows, ...previous].filter((r) => r.open).map((r) => r.month);
  const axis = monthsAxis(rows.map((r) => r.month), previous.map((r) => r.month), open);
  const title = `Masse chargée par mois, ${year} face à ${prevYear} (N-1)`;
  const series = masseSeries(rows, previous, { cur: `Masse chargée ${year}`, prev: `Masse chargée ${prevYear} (N-1)` });
  return (
    <ChartGuard testid="ms-trend" title={title} series={series} lines={lines}>
      <BarChart
        testid="ms-trend"
        label={`Masse salariale chargée par mois, ${year} et ${prevYear}, en euros`}
        title={title}
        categories={axis.categories}
        categoryTitles={axis.titles}
        series={series}
        unit="eur"
        height={300}
      />
    </ChartGuard>
  );
}

// Composition du coût : part du brut et des cotisations dans la masse chargée.
export function Composition({ brut, cotisations }: { brut: number; cotisations: number }) {
  const total = brut + cotisations;
  if (total <= 0) return <p className="nd">n.d. — masse chargée nulle ou négative sur la période</p>;
  const pct = (v: number) => fmtFixed({ num: v * 100, den: total }, 1);
  const width = (v: number) => `${Math.max(0, Math.min(100, (v / total) * 100))}%`;
  return (
    <div className="ms-composition" data-testid="ms-composition">
      <h3 className="ms-sub">Composition de la masse chargée</h3>
      <div className="ms-composition-bar" aria-hidden="true">
        <span style={{ width: width(brut), background: COLORS.brut }} />
        <span style={{ width: width(cotisations), background: COLORS.cotisations }} />
      </div>
      <ul className="ms-composition-legend">
        <li><i className="swatch" style={{ background: COLORS.brut }} aria-hidden="true" />Brut {pct(brut)} % · {euros(brut)}</li>
        <li><i className="swatch" style={{ background: COLORS.cotisations }} aria-hidden="true" />Cotisations patronales {pct(cotisations)} % · {euros(cotisations)}</li>
      </ul>
    </div>
  );
}
