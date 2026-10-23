"use client";
import { useId, useMemo, useState } from "react";
import { barDomain, barLayout, niceTicks } from "./scale";
import { colorOf, Frame, labelWidth, Legend, NdPattern, onColor, TipBox, useRoving, useWidth, type ChartSeries, type Tip } from "./shared";
import { unitFormat, type UnitName } from "./units";

export type BarChartProps = {
  testid: string;
  label: string; // résumé lu par les lecteurs d'écran
  title?: string;
  categories: string[]; // étiquettes courtes de l'axe (« janv. »)
  categoryTitles?: string[]; // intitulés complets des infobulles (« janvier 2026 »)
  series: ChartSeries[];
  unit: UnitName; // euros (centimes), ETP (dix-millièmes), nombre, pourcentage (points de base)
  mode?: "grouped" | "stacked"; // mode initial
  toggle?: boolean; // boutons « Empiler / Désempiler »
  height?: number;
  note?: string;
};

const H_DEFAULT = 260;

// Barres groupées ou empilées, une catégorie par mois (ou par groupe). Une catégorie sans aucune valeur (n.d.) est une
// colonne hachurée avec sa raison ; une valeur absente d'une série n'est jamais dessinée comme zéro.
export function BarChart(p: BarChartProps) {
  const uid = useId().replace(/:/g, "");
  const [ref, width] = useWidth();
  const [mode, setMode] = useState<"grouped" | "stacked">(p.mode ?? "grouped");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [tip, setTip] = useState<Tip | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const rov = useRoving(p.categories.length);
  const u = unitFormat(p.unit);
  const axisFmt = u.axis;
  const labelFmt = u.label;
  const visible = useMemo(() => p.series.map((s, i) => ({ s, i })).filter(({ s }) => !hidden.has(s.key)), [p.series, hidden]);
  const nCat = p.categories.length;
  const values = visible.map(({ s }) => s.values);
  const dom = barDomain(values, nCat, mode);
  const t = niceTicks(dom.lo, dom.hi, 5, u.integer);
  const H = p.height ?? H_DEFAULT;
  const left = labelWidth(t.ticks.map(axisFmt));
  const right = 8;
  const top = 18;
  const rotate = (width - left - right) / Math.max(1, nCat) < 40;
  const bottom = rotate ? 46 : 26;
  const plotW = Math.max(40, width - left - right);
  const plotH = Math.max(60, H - top - bottom);
  const lay = barLayout({ series: values, categories: nCat, mode, plotW, plotH, yMin: t.min, yMax: t.max });
  const ndCat = (c: number) => p.series.every((s) => s.values[c] === null || s.values[c] === undefined);
  const catTitle = (c: number) => p.categoryTitles?.[c] ?? p.categories[c];
  const tipFor = (c: number): Tip => {
    const rows = p.series.map((s, i) => {
      const v = s.values[c];
      return v === null || v === undefined ? { color: colorOf(i, s.color), name: s.name, value: `n.d.${s.reasons?.[c] ? ` — ${s.reasons[c]}` : ""}`, nd: true } : { color: colorOf(i, s.color), name: s.name, value: u.fmt(v) };
    });
    const known = visible.map(({ s }) => s.values[c]).filter((v): v is number => v !== null && v !== undefined);
    const foot = mode === "stacked" && known.length > 1 ? `Total affiché : ${u.fmt(known.reduce((a, b) => a + b, 0))}` : undefined;
    return { x: left + c * lay.band + lay.band / 2, y: top, title: catTitle(c), rows, foot };
  };
  const labelBars = lay.barW >= 26 && (mode === "grouped" ? visible.length <= 4 : true);
  const toggleHidden = (key: string) => setHidden((h) => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const aria = (c: number) => `${catTitle(c)} : ${p.series.map((s) => `${s.name} ${s.values[c] === null || s.values[c] === undefined ? `n.d.${s.reasons?.[c] ? ` (${s.reasons[c]})` : ""}` : u.fmt(s.values[c] as number)}`).join(", ")}`;
  return (
    <Frame
      testid={p.testid}
      title={p.title}
      tools={p.toggle && p.series.length > 1 ? (
        <div className="seg" role="group" aria-label="Mode d'affichage">
          <button type="button" className="btn small" aria-pressed={mode === "stacked"} onClick={() => setMode("stacked")}>Empiler</button>
          <button type="button" className="btn small" aria-pressed={mode === "grouped"} onClick={() => setMode("grouped")}>Désempiler</button>
        </div>
      ) : undefined}
      legend={<Legend items={p.series.map((s, i) => ({ key: s.key, name: s.name, color: colorOf(i, s.color) }))} hidden={hidden} onToggle={p.series.length > 1 ? toggleHidden : undefined} />}
      note={p.note}
    >
      <div ref={ref} className="chart-plot" onMouseLeave={() => setTip(null)}>
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="group" aria-label={p.label}>
          <defs><NdPattern id={`nd-${uid}`} /></defs>
          <g transform={`translate(${left},${top})`}>
            {t.ticks.map((v) => (
              <g key={v}>
                <line x1={0} x2={plotW} y1={lay.y(v)} y2={lay.y(v)} className={v === 0 ? "axis" : "grid"} />
                <text x={-8} y={lay.y(v)} textAnchor="end" dominantBaseline="middle" className="tick">{axisFmt(v)}</text>
              </g>
            ))}
            {Array.from({ length: nCat }, (_, c) => {
              const cx = c * lay.band + lay.band / 2;
              return (
                <text key={c} className="tick cat" textAnchor={rotate ? "end" : "middle"} transform={rotate ? `translate(${cx + 4},${plotH + 14}) rotate(-45)` : `translate(${cx},${plotH + 16})`}>{p.categories[c]}</text>
              );
            })}
            {Array.from({ length: nCat }, (_, c) => ndCat(c) && (
              <g key={`nd${c}`}>
                <rect x={c * lay.band + (lay.band - lay.barW) / 2} y={plotH - Math.min(28, plotH / 3)} width={Math.max(6, lay.barW)} height={Math.min(28, plotH / 3)} fill={`url(#nd-${uid})`} stroke="var(--line)" />
                {lay.barW >= 22 && <text x={c * lay.band + lay.band / 2} y={plotH - Math.min(28, plotH / 3) - 4} textAnchor="middle" className="tick nd">n.d.</text>}
              </g>
            ))}
            {lay.bars.map((b) => {
              const { s, i } = visible[b.ser];
              return <rect key={`${b.cat}-${b.ser}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={colorOf(i, s.color)} rx={mode === "grouped" ? 2 : 0} opacity={focus !== null && focus !== b.cat ? 0.55 : 1} />;
            })}
            {labelBars && lay.bars.map((b) => (mode === "grouped" || b.h >= 14) && b.v !== 0 ? (
              <text key={`l${b.cat}-${b.ser}`} x={b.x + b.w / 2} y={mode === "grouped" ? (b.v >= 0 ? b.y - 4 : b.y + b.h + 11) : b.y + b.h / 2} textAnchor="middle" dominantBaseline={mode === "grouped" ? undefined : "middle"} className="val" style={mode === "grouped" ? undefined : { fill: onColor(colorOf(visible[b.ser].i, visible[b.ser].s.color)) }}>{labelFmt(b.v)}</text>
            ) : null)}
            {Array.from({ length: nCat }, (_, c) => (
              <rect key={`hit${c}`} x={c * lay.band} y={-top} width={lay.band} height={plotH + top + bottom - 4} fill="transparent" tabIndex={rov.tab(c)} onKeyDown={rov.onKeyDown} aria-label={aria(c)} className="hit"
                onMouseEnter={() => { setTip(tipFor(c)); setFocus(c); }} onMouseMove={() => setTip(tipFor(c))} onMouseLeave={() => setFocus(null)}
                onFocus={() => { setTip(tipFor(c)); setFocus(c); }} onBlur={() => { setTip(null); setFocus(null); }} />
            ))}
          </g>
        </svg>
        <TipBox tip={tip} width={width} />
      </div>
    </Frame>
  );
}
