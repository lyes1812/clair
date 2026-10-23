"use client";
import { useState } from "react";
import { niceTicks } from "./scale";
import { unitFormat, type UnitName } from "./units";
import { colorOf, Frame, labelWidth, Legend, TipBox, useRoving, useWidth, type ChartSeries, type Tip } from "./shared";

export type LineChartProps = {
  testid: string;
  label: string;
  title?: string;
  categories: string[];
  categoryTitles?: string[];
  series: ChartSeries[]; // dashed / area par série (ex. réel plein, scénario en pointillés avec aire)
  unit: UnitName;
  zero?: boolean; // forcer l'axe à partir de zéro (par défaut : axe ajusté aux valeurs, ce qui est dit sous le graphique)
  height?: number;
  note?: string;
};

// Courbes multi-séries (réel, scénarios, budget). Une valeur n.d. interrompt la ligne : jamais de point à zéro, jamais de
// valeur interpolée. L'infobulle suit la colonne survolée et liste toutes les séries avec leur valeur ou leur raison n.d.
export function LineChart(p: LineChartProps) {
  const [ref, width] = useWidth();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [tip, setTip] = useState<Tip | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const rov = useRoving(p.categories.length);
  const u = unitFormat(p.unit);
  const axisFmt = u.axis;
  const vis = p.series.map((s, i) => ({ s, i })).filter(({ s }) => !hidden.has(s.key));
  const all = vis.flatMap(({ s }) => s.values.filter((v): v is number => v !== null && v !== undefined));
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const zero = p.zero ?? false;
  const t = niceTicks(zero ? Math.min(0, lo) : lo - (hi - lo) * 0.08, zero ? Math.max(0, hi) : hi + (hi - lo) * 0.08, 5, u.integer);
  const truncated = !zero && t.min > 0;
  const nCat = p.categories.length;
  const H = p.height ?? 260;
  const left = labelWidth(t.ticks.map(axisFmt));
  const right = 14;
  const top = 14;
  const rotate = (width - left - right) / Math.max(1, nCat) < 40;
  const bottom = rotate ? 46 : 26;
  const plotW = Math.max(40, width - left - right);
  const plotH = Math.max(60, H - top - bottom);
  const band = plotW / Math.max(1, nCat);
  const X = (c: number) => c * band + band / 2;
  const Y = (v: number) => plotH - ((v - t.min) / (t.max - t.min || 1)) * plotH;
  const catTitle = (c: number) => p.categoryTitles?.[c] ?? p.categories[c];
  const tipFor = (c: number): Tip => ({
    x: left + X(c),
    y: top,
    title: catTitle(c),
    rows: p.series.map((s, i) => {
      const v = s.values[c];
      return v === null || v === undefined ? { color: colorOf(i, s.color), name: s.name, value: `n.d.${s.reasons?.[c] ? ` — ${s.reasons[c]}` : ""}`, nd: true } : { color: colorOf(i, s.color), name: s.name, value: u.fmt(v) };
    }),
  });
  // Segments continus : une valeur absente coupe la ligne.
  const segments = (vals: (number | null)[]) => {
    const out: { c: number; v: number }[][] = [];
    let cur: { c: number; v: number }[] = [];
    vals.forEach((v, c) => {
      if (v === null || v === undefined) {
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push({ c, v });
    });
    if (cur.length) out.push(cur);
    return out;
  };
  const toggleHidden = (key: string) => setHidden((h) => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const aria = (c: number) => `${catTitle(c)} : ${p.series.map((s) => `${s.name} ${s.values[c] === null || s.values[c] === undefined ? `n.d.${s.reasons?.[c] ? ` (${s.reasons[c]})` : ""}` : u.fmt(s.values[c] as number)}`).join(", ")}`;
  const note = [p.note, truncated ? `Axe vertical ajusté aux valeurs (il ne part pas de zéro) : ${axisFmt(t.min)} à ${axisFmt(t.max)}.` : null].filter(Boolean).join(" ");
  return (
    <Frame testid={p.testid} title={p.title} legend={<Legend items={p.series.map((s, i) => ({ key: s.key, name: s.name, color: colorOf(i, s.color), dashed: s.dashed }))} hidden={hidden} onToggle={p.series.length > 1 ? toggleHidden : undefined} />} note={note || undefined}>
      <div ref={ref} className="chart-plot" onMouseLeave={() => { setTip(null); setAt(null); }}>
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="group" aria-label={p.label}>
          <g transform={`translate(${left},${top})`}>
            {t.ticks.map((v) => (
              <g key={v}>
                <line x1={0} x2={plotW} y1={Y(v)} y2={Y(v)} className={v === 0 ? "axis" : "grid"} />
                <text x={-8} y={Y(v)} textAnchor="end" dominantBaseline="middle" className="tick">{axisFmt(v)}</text>
              </g>
            ))}
            {Array.from({ length: nCat }, (_, c) => (
              <text key={c} className="tick cat" textAnchor={rotate ? "end" : "middle"} transform={rotate ? `translate(${X(c) + 4},${plotH + 14}) rotate(-45)` : `translate(${X(c)},${plotH + 16})`}>{p.categories[c]}</text>
            ))}
            {at !== null && <line x1={X(at)} x2={X(at)} y1={0} y2={plotH} className="cross" />}
            {vis.map(({ s, i }) => {
              const color = colorOf(i, s.color);
              const segs = segments(s.values);
              return (
                <g key={s.key}>
                  {s.area && segs.map((seg, k) => seg.length > 1 && (
                    <path key={`a${k}`} d={`M ${X(seg[0].c)} ${Y(Math.max(t.min, 0) > 0 ? t.min : 0)} ${seg.map((pt) => `L ${X(pt.c)} ${Y(pt.v)}`).join(" ")} L ${X(seg[seg.length - 1].c)} ${Y(Math.max(t.min, 0) > 0 ? t.min : 0)} Z`} fill={color} opacity={0.1} />
                  ))}
                  {segs.map((seg, k) => seg.length > 1 && (
                    <path key={`p${k}`} d={seg.map((pt, j) => `${j ? "L" : "M"} ${X(pt.c)} ${Y(pt.v)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeDasharray={s.dashed ? "6 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
                  ))}
                  {segs.map((seg) => seg.map((pt) => <circle key={`${s.key}-${pt.c}`} cx={X(pt.c)} cy={Y(pt.v)} r={at === pt.c ? 4.5 : nCat > 18 && seg.length > 1 ? 0 : 3} fill="#fff" stroke={color} strokeWidth={2} />))}
                </g>
              );
            })}
            {Array.from({ length: nCat }, (_, c) => (
              <rect key={`hit${c}`} x={c * band} y={-top} width={band} height={plotH + top + bottom - 4} fill="transparent" tabIndex={rov.tab(c)} onKeyDown={rov.onKeyDown} aria-label={aria(c)} className="hit"
                onMouseEnter={() => { setTip(tipFor(c)); setAt(c); }} onMouseMove={() => setTip(tipFor(c))}
                onFocus={() => { setTip(tipFor(c)); setAt(c); }} onBlur={() => { setTip(null); setAt(null); }} />
            ))}
          </g>
        </svg>
        <TipBox tip={tip} width={width} />
      </div>
    </Frame>
  );
}
