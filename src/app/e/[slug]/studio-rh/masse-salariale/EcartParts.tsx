import { FamilyTabs } from "@/components/FamilyTabs";
import { formatEuros } from "@/lib/money";
import type { Agg, Diff } from "@/lib/budget/versions";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";
import { periodText } from "@/lib/viz/ecart";
import { monthShort } from "./components";
import { NV, type Loaded } from "./ecart-data";
import { RubInput } from "./ecart/LiveRub";

import { MS_PREVU, type MsTab } from "./tabs";
export { MS_PREVU, type MsTab };

export function MsHeader({ title, summary }: { title: string; summary: string }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span className="label">Studio RH</span>
      <h1>{title}</h1>
      <p className="desc">{summary}</p>
    </div>
  );
}

export function MsTabs({ slug, current, extra = "" }: { slug: string; current: MsTab; extra?: string }) {
  const base = `/e/${slug}/studio-rh/masse-salariale`;
  const tabs: { key: MsTab; label: string; href: string; soon?: boolean }[] = [
    { key: "synthese", label: "Synthèse", href: `${base}${extra}` },
    { key: "fixe-variable", label: "Fixe & variable", href: `${base}?vue=fixe-variable${extra.replace("?", "&")}` },
    { key: "paie-compta", label: "Paie & comptabilité", href: `${base}?vue=paie-compta${extra.replace("?", "&")}` },
    ...MS_PREVU.map((t) => ({ key: t.key as MsTab, label: t.label, href: `${base}${t.path}`, soon: true })),
    { key: "ecart", label: "Écart budgétaire", href: `${base}/ecart` },
    { key: "analyse", label: "Analyse des écarts", href: `${base}/analyse` },
  ];
  return <FamilyTabs tabs={tabs} current={current} label="Vues" testid="ms-tabs" />;
}

export type Unit = "etp" | "nombre" | "eur";
const sign = (n: number) => (n > 0 ? "+" : "");
const plain = (num: number, den: number, unit: Unit) => (unit === "eur" ? formatEuros(num) : unit === "etp" ? fmtFixed({ num, den }, 2) : String(num));

export function aggText(a: Agg, unit: Unit): string {
  if (a.kind !== "value") return a.kind === "na" ? "—" : "n.d.";
  return plain(a.num, a.den, unit);
}
export function Val({ agg, unit }: { agg: Agg; unit: Unit }) {
  if (agg.kind === "nd") return <abbr className="nd" title={agg.reason}>n.d.</abbr>;
  return <>{aggText(agg, unit)}</>;
}

// Texte d'un écart signé (« +3 550,00 € ») ; null quand l'écart est n.d. ou sans objet.
export function gapText(d: Diff, unit: Unit): string | null {
  return d.kind === "value" ? `${sign(d.num)}${plain(d.num, d.den, unit)}` : null;
}
export function Gap({ d, unit }: { d: Diff; unit: Unit }) {
  if (d.kind === "nd") return <abbr className="nd" title={d.reason}>n.d.</abbr>;
  if (d.kind === "na") return <>—</>;
  return <>{gapText(d, unit)}</>;
}
export function GapPct({ d }: { d: Diff }) {
  if (d.kind === "nd") return <abbr className="nd" title={d.reason}>n.d.</abbr>;
  if (d.kind === "na") return <>—</>;
  if (!d.pct) return <abbr className="nd" title="valeur de départ nulle : le pourcentage n'est pas défini">n.d.</abbr>;
  return <>{sign(d.pct.num)}{fmtPercent({ num: d.pct.num, den: d.pct.den })}</>;
}

// Sens d'un écart, porté par une flèche neutre (gris) ajoutée en CSS : aucune règle métier ne dit quel sens est favorable,
// donc aucun code couleur « favorable / défavorable ». Le signe reste écrit dans le texte.
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
export { periodText };
export const scopeText = (loaded: Loaded) => (loaded.filter ? `service ${loaded.filter.value ?? "non ventilé"}` : "tous les services");

// Formulaire de choix des versions, de la période (rangs de mois) et du service : tout passe par l'adresse de la page.
export function PickerForm({ path, loaded, columns, hidden = {} }: { path: string; loaded: Loaded; columns: 2 | 3; hidden?: Record<string, string> }) {
  const cols = Array.from({ length: columns }, (_, i) => i);
  return (
    <form method="get" action={path} className="filters ecart-filters" data-testid="ecart-form">
      {Object.entries(hidden).map(([k, v]) => (k === "rub" ? <RubInput key={k} initial={v} /> : <input key={k} type="hidden" name={k} value={v} />))}
      {cols.map((i) => (
        <div className="field-row" key={i}>
          <label htmlFor={`v${i + 1}`}><span className="ver-badge" aria-hidden="true">{i + 1}</span>Version {i + 1}</label>
          <select className="select" id={`v${i + 1}`} name={`v${i + 1}`} defaultValue={loaded.selected[i] ?? ""}>
            <option value="">— aucune</option>
            {loaded.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      ))}
      <div className="field-row">
        <label htmlFor="de">Premier mois</label>
        <select className="select" id="de" name="de" defaultValue={loaded.from}>{MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, "0")}>{n}</option>)}</select>
      </div>
      <div className="field-row">
        <label htmlFor="a">Dernier mois</label>
        <select className="select" id="a" name="a" defaultValue={loaded.to}>{MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, "0")}>{n}</option>)}</select>
      </div>
      <div className="field-row">
        <label htmlFor="service">Service</label>
        <select className="select" id="service" name="service" defaultValue={loaded.filter === null ? "" : (loaded.filter.value ?? NV)}>
          <option value="">Tous les services</option>
          {loaded.services.map((s) => <option key={s} value={s}>{s}</option>)}
          {loaded.hasNv && <option value={NV}>Non ventilé</option>}
        </select>
      </div>
      <div className="ecart-filter-actions">
        <button className="btn primary" type="submit">Afficher</button>
        <a className="btn" href={path}>Réinitialiser</a>
      </div>
    </form>
  );
}
