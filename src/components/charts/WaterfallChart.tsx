"use client";
import { useId, useState } from "react";
import { niceTicks } from "./scale";
import { unitFormat, type UnitName } from "./units";
import { Frame, labelWidth, TipBox, useWidth, type Tip } from "./shared";

export type WaterfallProps = {
  testid: string;
  label: string;
  title?: string;
  startLabel: string;
  endLabel: string;
  start: number;
  end: number;
  steps: { label: string; value: number }[];
  unit: UnitName;
  note?: string;
};

// Cascade (pont) : départ, contributions signées, arrivée. Hausse pleine bleue, baisse hachurée rouge, totaux en noir ; chaque
// barre porte sa valeur signée en clair, le sens ne dépend donc pas de la couleur. L'axe est tronqué quand les contributions
// sont petites devant les totaux ; la troncature est écrite sous le graphique.
export function WaterfallChart(p: WaterfallProps) {
  const uid = useId().replace(/:/g, "");
  const [ref, width] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const [on, setOn] = useState<number | null>(null);
  const u = unitFormat(p.unit);
  const axisFmt = u.axis;
  const levels: number[] = [p.start];
  for (const s of p.steps) levels.push(levels.at(-1)! + s.value);
  const top = Math.max(1, p.start, p.end, ...levels);
  const bottom = Math.min(p.start, p.end, ...levels);
  const truncated = bottom > 0 && (top - bottom) / top < 0.3;
  const lo = truncated ? Math.max(0, bottom - (top - bottom) * 0.5) : Math.min(0, bottom);
  const t = niceTicks(lo, top + (top - lo) * 0.06, 5);
  const bars = [
    { label: p.startLabel, from: Math.max(t.min, 0) > 0 ? t.min : 0, to: p.start, kind: "total" as const, text: u.fmt(p.start), value: p.start },
    ...p.steps.map((s, i) => ({ label: s.label, from: levels[i], to: levels[i + 1], kind: (s.value >= 0 ? "up" : "down") as "up" | "down", text: `${s.value > 0 ? "+" : ""}${u.fmt(s.value)}`, value: s.value })),
    { label: p.endLabel, from: Math.max(t.min, 0) > 0 ? t.min : 0, to: p.end, kind: "total" as const, text: u.fmt(p.end), value: p.end },
  ];
  const n = bars.length;
  const H = 280;
  const left = labelWidth(t.ticks.map(axisFmt));
  const right = 10;
  const topM = 22;
  const bottomM = 44;
  const plotW = Math.max(60, width - left - right);
  const plotH = H - topM - bottomM;
  const band = plotW / n;
  const barW = Math.min(64, band * 0.62);
  const Y = (v: number) => plotH - ((v - t.min) / (t.max - t.min || 1)) * plotH;
  const short = (s: string) => {
    const max = Math.max(8, Math.floor(band / 6.2));
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };
  const tipOf = (i: number): Tip => ({ x: left + i * band + band / 2, y: topM, title: bars[i].label, rows: [{ name: bars[i].kind === "total" ? "Valeur" : "Contribution", value: bars[i].text, strong: true }] });
  const note = [p.note, truncated ? `Axe tronqué : il commence à ${axisFmt(Math.round(t.min))}.` : null].filter(Boolean).join(" ");
  return (
    <Frame testid={p.testid} title={p.title} note={note || undefined} legend={<ul className="chart-legend" aria-label="Légende"><li><span className="legend-btn static"><i className="swatch" style={{ background: "var(--chart-ink)" }} />Total</span></li><li><span className="legend-btn static"><i className="swatch" style={{ background: "var(--chart-1)" }} />Hausse</span></li><li><span className="legend-btn static"><i className="swatch hatch" />Baisse</span></li></ul>}>
      <div ref={ref} className="chart-plot" onMouseLeave={() => { setTip(null); setOn(null); }}>
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="group" aria-label={p.label}>
          <defs>
            <pattern id={`hd-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff" /><rect width="3" height="6" fill="var(--danger)" /></pattern>
          </defs>
          <g transform={`translate(${left},${topM})`}>
            {t.ticks.map((v) => (
              <g key={v}>
                <line x1={0} x2={plotW} y1={Y(v)} y2={Y(v)} className={v === 0 ? "axis" : "grid"} />
                <text x={-8} y={Y(v)} textAnchor="end" dominantBaseline="middle" className="tick">{axisFmt(v)}</text>
              </g>
            ))}
            {bars.slice(0, -1).map((b, i) => (
              <line key={`c${i}`} x1={i * band + band / 2 + barW / 2} x2={(i + 1) * band + band / 2 - barW / 2} y1={Y(b.to)} y2={Y(b.to)} className="connector" />
            ))}
            {bars.map((b, i) => {
              const a = Y(Math.max(b.from, b.to));
              const h = Math.max(2, Math.abs(Y(b.from) - Y(b.to)));
              const x = i * band + (band - barW) / 2;
              return (
                <g key={`${b.label}-${i}`} opacity={on !== null && on !== i ? 0.55 : 1}>
                  <rect x={x} y={a} width={barW} height={h} fill={b.kind === "total" ? "var(--chart-ink)" : b.kind === "up" ? "var(--chart-1)" : `url(#hd-${uid})`} stroke={b.kind === "down" ? "var(--danger)" : "none"} rx={2} />
                  <text x={x + barW / 2} y={a - 5} textAnchor="middle" className="val">{b.text}</text>
                  <text x={x + barW / 2} y={plotH + 16} textAnchor="middle" className="tick cat">{short(b.label)}</text>
                  <rect x={i * band} y={-topM} width={band} height={plotH + topM + bottomM - 4} fill="transparent" tabIndex={0} className="hit" aria-label={`${b.label} : ${b.text}`}
                    onMouseEnter={() => { setOn(i); setTip(tipOf(i)); }} onFocus={() => { setOn(i); setTip(tipOf(i)); }} onBlur={() => { setOn(null); setTip(null); }} />
                </g>
              );
            })}
          </g>
        </svg>
        <TipBox tip={tip} width={width} />
      </div>
    </Frame>
  );
}
