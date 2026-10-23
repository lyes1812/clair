import { formatEuros } from "@/lib/money";
import type { Agg, Diff } from "@/lib/budget/versions";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";
import { monthShort } from "./components";
import { NV, type Loaded } from "./ecart-data";

export type MsTab = "synthese" | "fixe-variable" | "paie-compta" | "ecart" | "analyse";

// Onglets de la famille Masse salariale : les trois écrans existants puis l'écart budgétaire et l'analyse des écarts.
export function MsTabs({ slug, current, extra = "" }: { slug: string; current: MsTab; extra?: string }) {
  const base = `/e/${slug}/studio-rh/masse-salariale`;
  const tabs: { key: MsTab; label: string; href: string }[] = [
    { key: "synthese", label: "Synthèse", href: `${base}${extra}` },
    { key: "fixe-variable", label: "Fixe & variable", href: `${base}?vue=fixe-variable${extra.replace("?", "&")}` },
    { key: "paie-compta", label: "Paie & comptabilité", href: `${base}?vue=paie-compta${extra.replace("?", "&")}` },
    { key: "ecart", label: "Écart budgétaire", href: `${base}/ecart` },
    { key: "analyse", label: "Analyse des écarts", href: `${base}/analyse` },
  ];
  return (
    <nav className="tabs" aria-label="Vues" data-testid="ms-tabs">
      {tabs.map((t) => <a key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}>{t.label}</a>)}
    </nav>
  );
}

export type Unit = "etp" | "nombre" | "eur";
const sign = (n: number) => (n > 0 ? "+" : "");
export function aggText(a: Agg, unit: Unit): string {
  if (a.kind !== "value") return a.kind === "na" ? "—" : "n.d.";
  return unit === "eur" ? formatEuros(a.num) : unit === "etp" ? fmtFixed({ num: a.num, den: a.den }, 2) : String(a.num);
}
export function Val({ agg, unit }: { agg: Agg; unit: Unit }) {
  if (agg.kind === "nd") return <abbr className="nd" title={agg.reason}>n.d.</abbr>;
  return <>{aggText(agg, unit)}</>;
}
export function Gap({ d, unit }: { d: Diff; unit: Unit }) {
  if (d.kind === "nd") return <abbr className="nd" title={d.reason}>n.d.</abbr>;
  if (d.kind === "na") return <>—</>;
  const t = unit === "eur" ? formatEuros(d.num) : unit === "etp" ? fmtFixed({ num: d.num, den: d.den }, 2) : String(d.num);
  return <>{sign(d.num)}{t}</>;
}
export function GapPct({ d }: { d: Diff }) {
  if (d.kind === "nd") return <abbr className="nd" title={d.reason}>n.d.</abbr>;
  if (d.kind === "na") return <>—</>;
  if (!d.pct) return <abbr className="nd" title="valeur de départ nulle : le pourcentage n'est pas défini">n.d.</abbr>;
  return <>{sign(d.pct.num)}{fmtPercent({ num: d.pct.num, den: d.pct.den })}</>;
}

const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const rankLabel = (mm: string) => monthShort(`2000-${mm}`);

// Formulaire de choix des versions, de la période (rangs de mois) et du service : tout passe par l'adresse de la page.
export function PickerForm({ path, loaded, columns, hidden = {} }: { path: string; loaded: Loaded; columns: 2 | 3; hidden?: Record<string, string> }) {
  const cols = Array.from({ length: columns }, (_, i) => i);
  return (
    <form method="get" action={path} className="filters" data-testid="ecart-form">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {cols.map((i) => (
        <div className="field-row" key={i}>
          <label htmlFor={`v${i + 1}`}>Version {i + 1}</label>
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
      <button className="btn" type="submit">Afficher</button>
    </form>
  );
}

// Cascade (pont) : valeur de départ, contributions signées, valeur d'arrivée. Une contribution positive est pleine, une
// négative hachurée, et chaque barre porte sa valeur signée en clair : le sens ne dépend pas de la couleur.
export function Waterfall({ startLabel, endLabel, start, end, steps, fmt, testid }: { startLabel: string; endLabel: string; start: number; end: number; steps: { label: string; value: number }[]; fmt: (n: number) => string; testid: string }) {
  const levels: number[] = [start];
  for (const s of steps) levels.push(levels.at(-1)! + s.value);
  const top = Math.max(1, start, end, ...levels);
  const bottom = Math.min(start, end, ...levels);
  // Quand les contributions sont petites devant les totaux, l'axe est tronqué pour qu'elles se lisent ; il est dit à l'écran.
  const truncated = bottom > 0 && (top - bottom) / top < 0.3;
  const low = truncated ? Math.max(0, bottom - (top - bottom) * 0.5) : Math.min(0, bottom);
  const span = top - low || 1;
  const H = 170;
  const W = (steps.length + 2) * 78 + 20;
  const y = (v: number) => 14 + ((top - Math.max(v, low)) / span) * (H - 24);
  const bars = [
    { label: startLabel, from: low, to: start, kind: "total" as const, text: fmt(start) },
    ...steps.map((s, i) => ({ label: s.label, from: levels[i], to: levels[i + 1], kind: s.value >= 0 ? ("up" as const) : ("down" as const), text: `${s.value > 0 ? "+" : ""}${fmt(s.value)}` })),
    { label: endLabel, from: low, to: end, kind: "total" as const, text: fmt(end) },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H + 64}`} role="img" aria-label="Cascade de l'écart" style={{ width: "100%", maxWidth: W, height: "auto" }} data-testid={testid}>
      <defs><pattern id={`${testid}-h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--ink)" /></pattern></defs>
      <line x1="6" x2={W - 6} y1={y(low)} y2={y(low)} stroke="var(--line)" />
      {truncated && <text x={W - 8} y={H + 40} textAnchor="end" fontSize="10" fill="var(--muted)">{`axe tronqué à ${fmt(Math.round(low))}`}</text>}
      {bars.map((b, i) => {
        const x = 16 + i * 78;
        const a = y(Math.max(b.from, b.to));
        const h = Math.max(2, Math.abs(y(b.from) - y(b.to)));
        return (
          <g key={`${b.label}-${i}`}>
            <rect x={x} y={a} width="44" height={h} fill={b.kind === "total" ? "var(--ink)" : b.kind === "up" ? "var(--blue)" : `url(#${testid}-h)`} stroke={b.kind === "down" ? "var(--ink)" : "none"}><title>{`${b.label} : ${b.text}`}</title></rect>
            <text x={x + 22} y={a - 4} textAnchor="middle" fontSize="10" fill="var(--ink)">{b.text}</text>
            <text x={x + 22} y={H + 16} textAnchor="middle" fontSize="10" fill="var(--muted)">{b.label.length > 14 ? `${b.label.slice(0, 13)}…` : b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
