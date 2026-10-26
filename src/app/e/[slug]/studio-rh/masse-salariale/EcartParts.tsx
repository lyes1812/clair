import { MoneyText } from "@/components/Money";
import { FamilyTabs } from "@/components/FamilyTabs";
import { GlossaryLink } from "@/components/GlossaryLink";
import { ECART_TERMS } from "@/lib/glossary/ecart";
import { formatEuros } from "@/lib/money";
import { trendClass, type TrendTone } from "@/lib/trend";
import type { Agg, Diff } from "@/lib/budget/versions";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";
import { eurosSigned, neg, periodText } from "@/lib/viz/ecart";
import { monthShort } from "./components";
import { NV, type Loaded } from "./ecart-data";
import { RubInput } from "./ecart/LiveRub";
import { SearchableSelect } from "@/components/SearchableSelect";

import { MS_PREVU, type MsTab } from "./tabs";
export { MS_PREVU, type MsTab };

// En-tête : le titre seul, comme les autres entrées du Studio RH (le résumé du module n'est plus répété sous chaque écran).
export function MsHeader({ title }: { title: string; summary?: string }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span className="label">Studio RH</span>
      <h1>{title}</h1>
    </div>
  );
}

export function MsTabs({ slug, current, extra = "" }: { slug: string; current: MsTab; extra?: string }) {
  const base = `/e/${slug}/studio-rh/masse-salariale`;
  const tabs: { key: MsTab; label: string; href: string; soon?: boolean }[] = [
    { key: "synthese", label: "Synthèse", href: `${base}${extra}` },
    { key: "fixe-variable", label: "Fixe & variable", href: `${base}?vue=fixe-variable${extra.replace("?", "&")}` },
    { key: "paie-compta", label: "Paie & comptabilité", href: `${base}?vue=paie-compta${extra.replace("?", "&")}` },
    ...MS_PREVU.map((t) => ({ key: t.key as MsTab, label: t.label, href: `${base}${t.path}`, soon: t.soon })),
    { key: "ecart", label: "Écart budgétaire", href: `${base}/ecart` },
    { key: "analyse", label: "Analyse des écarts", href: `${base}/analyse` },
  ];
  return <FamilyTabs tabs={tabs} current={current} label="Vues" testid="ms-tabs" />;
}

export type Unit = "etp" | "nombre" | "eur";
const sign = (n: number) => (n > 0 ? "+" : "");
const plain = (num: number, den: number, unit: Unit) => (unit === "eur" ? neg(formatEuros(num)) : unit === "etp" ? fmtFixed({ num, den }, 2) : neg(String(num)));

export function aggText(a: Agg, unit: Unit): string {
  if (a.kind !== "value") return a.kind === "na" ? "—" : "n.d.";
  return plain(a.num, a.den, unit);
}
export function Val({ agg, unit }: { agg: Agg; unit: Unit }) {
  if (agg.kind === "nd") return <MoneyText><abbr className="nd" title={agg.reason}>n.d.</abbr></MoneyText>;
  return <MoneyText><>{aggText(agg, unit)}</></MoneyText>;
}

// Texte d'un écart signé (« +3 550,00 € ») ; null quand l'écart est n.d. ou sans objet.
export function gapText(d: Diff, unit: Unit): string | null {
  return d.kind === "value" ? `${sign(d.num)}${plain(d.num, d.den, unit)}` : null;
}
export function Gap({ d, unit }: { d: Diff; unit: Unit }) {
  if (d.kind === "nd") return <MoneyText><abbr className="nd" title={d.reason}>n.d.</abbr></MoneyText>;
  if (d.kind === "na") return <MoneyText><>—</></MoneyText>;
  return <MoneyText><>{gapText(d, unit)}</></MoneyText>;
}
export function GapPct({ d }: { d: Diff }) {
  if (d.kind === "nd") return <abbr className="nd" title={d.reason}>n.d.</abbr>;
  if (d.kind === "na") return <>—</>;
  if (!d.pct) return <abbr className="nd" title="valeur de départ nulle : le pourcentage n'est pas défini">n.d.</abbr>;
  return <>{sign(d.pct.num)}{fmtPercent({ num: d.pct.num, den: d.pct.den })}</>;
}

// Sens d'un écart, porté par une flèche ajoutée en CSS (grise ; de la couleur de la tendance pour un coût) ; le signe reste écrit
// dans le texte. La couleur d'un écart de coût vient de gapTone (src/lib/viz/ecart.ts) : la classe est posée sur la cellule.
export const toneClass = (base: string, tone: TrendTone) => [base, trendClass(tone)].filter(Boolean).join(" ");
export type Sign = "up" | "down" | "zero";
export const signOf = (n: number): Sign => (n > 0 ? "up" : n < 0 ? "down" : "zero");
export const gapSign = (d: Diff): Sign | undefined => (d.kind === "value" ? signOf(d.num) : undefined);
export const pctSign = (d: Diff): Sign | undefined => (d.kind === "value" && d.pct ? signOf(d.pct.num) : undefined);

// Pastille numérotée d'une version (①②③) : le chiffre est décoratif, le texte caché dit « Version n ».
export function VerBadge({ n }: { n: number }) {
  return (
    <>
      <span className="ver-badge" aria-hidden="true">{n}</span>
      <span className="ecart-sr">Version {n} : </span>
    </>
  );
}
// En-tête d'un écart entre deux versions : « ② − ① » (version suivante moins version précédente).
export function VerPair({ to, from }: { to: number; from: number }) {
  return (
    <>
      <span className="ecart-ver-pair" aria-hidden="true"><span className="ver-badge">{to}</span>−<span className="ver-badge">{from}</span></span>
      <span className="ecart-sr">Version {to} moins version {from} : </span>
    </>
  );
}

const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const rankLabel = (mm: string) => monthShort(`2000-${mm}`);
export { eurosSigned, neg, periodText };
export const scopeText = (loaded: Loaded) => (loaded.filter ? `service ${loaded.filter.value ?? "non ventilé"}` : "tous les services");

// Formulaire de choix des versions, de la période (rangs de mois) et du service : tout passe par l'adresse de la page.
// Même grille pour l'écart budgétaire (3 versions) et l'analyse des écarts (2 versions) : versions sur la première ligne, puis
// premier mois, dernier mois, service et boutons sur la seconde (voir ecart.css).
// Avec `slug`, le premier mois porte son « ? » vers « Rangs de mois » : la ligne qui répétait versions, période et service sous le
// formulaire n'existe plus, le formulaire dit déjà tout cela.
export function PickerForm({ path, loaded, columns, hidden = {}, slug }: { path: string; loaded: Loaded; columns: 2 | 3; hidden?: Record<string, string>; slug?: string }) {
  const cols = Array.from({ length: columns }, (_, i) => i);
  const labelOf = (value: string | undefined) => loaded.options.find((o) => o.value === value)?.label;
  return (
    <form method="get" action={path} className="filters ecart-filters" data-testid="ecart-form">
      {Object.entries(hidden).map(([k, v]) => (k === "rub" ? <RubInput key={k} initial={v} /> : <input key={k} type="hidden" name={k} value={v} />))}
      {cols.map((i) => (
        <div className="field-row ef-v" key={i}>
          <label htmlFor={`v${i + 1}`}><span className="ver-badge" aria-hidden="true">{i + 1}</span>Version {i + 1}</label>
          <SearchableSelect className="select" id={`v${i + 1}`} name={`v${i + 1}`} defaultValue={loaded.selected[i] ?? ""} title={labelOf(loaded.selected[i])}
            searchLabel={`Version ${i + 1}`} options={[{ value: "", label: "— aucune" }, ...loaded.options]} />
        </div>
      ))}
      <div className="field-row ef-m ef-m1">
        <label htmlFor="de">Premier mois{slug && <GlossaryLink slug={slug} term={ECART_TERMS.rangsDeMois} label="Rangs de mois" />}</label>
        <select className="select" id="de" name="de" defaultValue={loaded.from}>{MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, "0")}>{n}</option>)}</select>
      </div>
      <div className="field-row ef-m">
        <label htmlFor="a">Dernier mois</label>
        <select className="select" id="a" name="a" defaultValue={loaded.to}>{MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, "0")}>{n}</option>)}</select>
      </div>
      <div className="field-row ef-s">
        <label htmlFor="service">Service</label>
        <SearchableSelect className="select" id="service" name="service" defaultValue={loaded.filter === null ? "" : (loaded.filter.value ?? NV)}
          searchLabel="Service" options={[
            { value: "", label: "Tous les services" },
            ...loaded.services.map((service) => ({ value: service, label: service })),
            ...(loaded.hasNv ? [{ value: NV, label: "Non ventilé" }] : []),
          ]} />
      </div>
      <div className="ecart-filter-actions">
        <button className="btn primary" type="submit">Afficher</button>
        <a className="btn" href={path}>Réinitialiser</a>
      </div>
    </form>
  );
}

// Titre d'une carte suivi de son « ? » vers le glossaire (le titre reste court : les explications sont au glossaire). Le
// sous-titre optionnel est réservé à la ligne de contexte (versions · période · service).
export function PanelTitle({ title, children, slug, term, label }: { title: string; children?: React.ReactNode; slug?: string; term?: string; label?: string }) {
  return (
    <div className="ecart-panel-title">
      <div className="ecart-title-row">
        <h2>{title}</h2>
        {slug && term && <GlossaryLink slug={slug} term={term} label={label} />}
      </div>
      {children && <p className="desc">{children}</p>}
    </div>
  );
}

// Légende des couleurs d'écart, une seule par tableau : le rouge et le vert ne marquent que les écarts de coût.
export function TrendLegend({ slug }: { slug: string }) {
  return (
    <p className="trend-legend ecart-legend" data-testid="trend-legend">
      <span><i className="dot bad" aria-hidden="true" />Coût en hausse</span>
      <span><i className="dot good" aria-hidden="true" />Coût en baisse</span>
      <GlossaryLink slug={slug} term={ECART_TERMS.couleurs} label="Couleurs des écarts" />
    </p>
  );
}

// Versions comparées en toutes lettres (nom complet et statut), dans l'ordre : « ① Réel PayFit 2025 → ② Scénario « … » (…) 2026 ».
// Utilisée dans le détail par salarié, dont la paire de versions peut être ② → ③ ; les champs de choix portent le libellé en infobulle.
export function VersionChain({ labels, first = 1 }: { labels: string[]; first?: number }) {
  return (
    <span className="ecart-chain">
      {labels.map((l, i) => (
        <span key={`${i}-${l}`} className="ecart-ver">
          {i > 0 && <span aria-hidden="true"> → </span>}
          <span className="ver-badge" aria-hidden="true">{first + i}</span>
          <span className="ecart-sr">Version {first + i} : </span>
          <span className="ecart-ver-name">{l}</span>
        </span>
      ))}
    </span>
  );
}

// Rôles du tableau, rappelés explicitement : en petit écran le tableau est présenté en cartes (display modifié) et certains
// navigateurs perdent alors la sémantique native des tableaux.
export const TBL = {
  table: { role: "table" },
  group: { role: "rowgroup" },
  row: { role: "row" },
  head: { role: "columnheader" },
  rowhead: { role: "rowheader" },
  cell: { role: "cell" },
} as const;
