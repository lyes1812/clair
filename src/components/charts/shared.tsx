"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Couleurs de série : charte « 101 » (un bleu mesuré, gris / noir) étendues à huit teintes distinctes. La couleur n'est
// jamais le seul porteur d'information : légende nommée, étiquettes et infobulle donnent le nom et la valeur.
export const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)"];
export const colorOf = (i: number, override?: string) => override ?? PALETTE[i % PALETTE.length];
// Texte posé sur une teinte de série : blanc sur 1, 2, 4 et 5, encre sur 3, 6, 7 et 8 (≥ 4,5:1 dans les deux cas). Couleur libre : blanc.
const INK_ON = new Set([3, 6, 7, 8]);
export const onColor = (color: string) => {
  const m = /--chart-(\d)/.exec(color);
  return m && INK_ON.has(Number(m[1])) ? "var(--chart-ink)" : "#fff";
};

// Un seul arrêt de tabulation par graphique, flèches gauche / droite (et début / fin) entre les colonnes : douze colonnes
// par graphique ne doivent pas coûter douze tabulations au clavier.
export function useRoving(n: number) {
  const [active, setActive] = useState(0);
  return {
    tab: (i: number) => (i === Math.min(active, Math.max(0, n - 1)) ? 0 : -1),
    onKeyDown: (e: React.KeyboardEvent<SVGElement>) => {
      const keys: Record<string, (i: number) => number> = { ArrowRight: (i) => i + 1, ArrowLeft: (i) => i - 1, Home: () => 0, End: () => n - 1 };
      const f = keys[e.key];
      if (!f) return;
      const hits = Array.from(e.currentTarget.ownerSVGElement?.querySelectorAll<SVGElement>(".hit") ?? []);
      const i = hits.indexOf(e.currentTarget);
      const next = Math.min(Math.max(0, f(i)), hits.length - 1);
      e.preventDefault();
      setActive(next);
      hits[next]?.focus();
    },
  };
}

export type ChartSeries = {
  key: string;
  name: string;
  values: (number | null)[];
  // Raison d'une valeur absente (n.d.), par catégorie ; affichée dans l'infobulle, jamais remplacée par zéro.
  reasons?: (string | null)[];
  color?: string;
  dashed?: boolean;
  area?: boolean;
};

// Largeur disponible du conteneur : mesurée côté navigateur, valeur de repli au rendu serveur.
export function useWidth(fallback = 720): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(240, Math.floor(el.getBoundingClientRect().width)));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export type Tip = { x: number; y: number; title: string; rows: { color?: string; name: string; value: string; strong?: boolean; nd?: boolean }[]; foot?: string };

// Infobulle : « Série / Groupe / Valeur » de la charte, positionnée sur le point survolé (ou le point focalisé au clavier).
export function TipBox({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const right = tip.x > width * 0.6;
  return (
    <div className="chart-tip" role="status" style={{ top: Math.max(0, tip.y), ...(right ? { right: Math.max(0, width - tip.x + 12) } : { left: tip.x + 12 }) }}>
      <strong>{tip.title}</strong>
      {tip.rows.map((r) => (
        <div key={r.name} className={r.strong ? "tip-row strong" : "tip-row"}>
          {r.color && <i className="swatch" style={{ background: r.color }} aria-hidden="true" />}
          <span>{r.name}</span>
          <b className={r.nd ? "nd" : undefined}>{r.value}</b>
        </div>
      ))}
      {tip.foot && <span className="tip-foot">{tip.foot}</span>}
    </div>
  );
}

export function Legend({ items, hidden, onToggle }: { items: { key: string; name: string; color: string; dashed?: boolean }[]; hidden?: Set<string>; onToggle?: (key: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="chart-legend" aria-label="Légende">
      {items.map((it) => {
        const off = hidden?.has(it.key) ?? false;
        const mark = <i className={it.dashed ? "swatch dashed" : "swatch"} style={{ background: it.dashed ? undefined : it.color, borderColor: it.color, color: it.color }} aria-hidden="true" />;
        return (
          <li key={it.key}>
            {onToggle ? (
              <button type="button" className="legend-btn" aria-pressed={!off} onClick={() => onToggle(it.key)} title={off ? "Afficher la série" : "Masquer la série"}>
                {mark}
                <span className={off ? "off" : undefined}>{it.name}</span>
              </button>
            ) : (
              <span className="legend-btn static">{mark}<span>{it.name}</span></span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Frame({ testid, title, tools, legend, note, children }: { testid: string; title?: string; tools?: ReactNode; legend?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <figure className="chart" data-testid={testid}>
      {(title || tools) && (
        <figcaption className="chart-head">
          {title && <span className="chart-title">{title}</span>}
          {tools && <div className="chart-tools">{tools}</div>}
        </figcaption>
      )}
      {children}
      {legend}
      {note && <p className="chart-note">{note}</p>}
    </figure>
  );
}

// Largeur estimée d'une étiquette d'axe (police 10 px) pour réserver la marge gauche.
export const labelWidth = (labels: string[]) => Math.ceil(Math.max(0, ...labels.map((l) => l.length)) * 6.1) + 12;

export const NdPattern = ({ id }: { id: string }) => (
  <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="6" height="6" fill="var(--surface)" />
    <rect width="2" height="6" fill="#c7cedd" />
  </pattern>
);
