"use client";
import { useState } from "react";
import { fmtPercent } from "@/lib/rh/kpi/format";
import { arcPath, sliceAngles } from "./scale";
import { unitFormat, type UnitName } from "./units";
import { colorOf, Frame, TipBox, useRoving, useWidth, type Tip } from "./shared";

export type Part = { key: string; name: string; value: number | null; reason?: string | null; color?: string };
export type DonutProps = {
  testid: string;
  label: string;
  title?: string;
  parts: Part[]; // value null : part n.d. (listée avec sa raison, absente de l'anneau)
  unit: UnitName;
  centerLabel?: string; // texte sous le total au centre
  note?: string;
  maxParts?: number;
};

// Répartition en anneau : les parts n.d. ne sont pas dans l'anneau (leur poids est inconnu) mais restent listées avec leur
// raison. Au-delà de `maxParts` (8), un anneau ne se lit plus : barres horizontales classées.
export function DonutChart(p: DonutProps) {
  const u = unitFormat(p.unit);
  const [ref, width] = useWidth(360);
  const [tip, setTip] = useState<Tip | null>(null);
  const [on, setOn] = useState<number | null>(null);
  const maxParts = p.maxParts ?? 8;
  const positive = p.parts.filter((x): x is Part & { value: number } => x.value !== null && x.value > 0);
  // Au-delà de maxParts : barres horizontales, classées de la plus grande à la plus petite part.
  const known = positive.length > maxParts ? [...positive].sort((a, b) => b.value - a.value) : positive;
  const nd = p.parts.filter((x) => x.value === null);
  const total = known.reduce((s, x) => s + x.value, 0);
  const rov = useRoving(known.length);
  const many = known.length > maxParts;
  const size = Math.min(220, Math.max(140, width * 0.5));
  const r = size / 2 - 4;
  const slices = sliceAngles(known.map((x) => x.value));
  const pct = (v: number) => fmtPercent({ num: v, den: total });
  const tipOf = (i: number): Tip => ({ x: size / 2, y: 8, title: known[i].name, rows: [{ color: colorOf(i, known[i].color), name: "Valeur", value: u.fmt(known[i].value), strong: true }, { name: "Part", value: pct(known[i].value) }] });
  return (
    <Frame testid={p.testid} title={p.title} note={p.note}>
      <div ref={ref} className="chart-plot donut-wrap" onMouseLeave={() => { setTip(null); setOn(null); }}>
        {total > 0 && !many && (
          <div className="donut-svg" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group" aria-label={p.label}>
              {slices.map((s, k) => (
                <path key={known[s.index].key} d={arcPath(size / 2, size / 2, r, r * 0.6, s.start, s.end)} fill={colorOf(s.index, known[s.index].color)} stroke="#fff" strokeWidth={known.length > 1 ? 2 : 0} opacity={on !== null && on !== s.index ? 0.5 : 1} tabIndex={rov.tab(k)} onKeyDown={rov.onKeyDown} className="hit" aria-label={`${known[s.index].name} : ${u.fmt(known[s.index].value)}, ${pct(known[s.index].value)}`}
                  onMouseEnter={() => { setOn(s.index); setTip(tipOf(s.index)); }} onFocus={() => { setOn(s.index); setTip(tipOf(s.index)); }} onBlur={() => { setOn(null); setTip(null); }} data-slice={k} />
              ))}
              <text x={size / 2} y={size / 2 - 2} textAnchor="middle" className="donut-total">{u.fmt(total)}</text>
              {p.centerLabel && <text x={size / 2} y={size / 2 + 14} textAnchor="middle" className="tick">{p.centerLabel}</text>}
            </svg>
            <TipBox tip={tip} width={size} />
          </div>
        )}
        <ul className="parts" aria-label="Répartition">
          {known.map((x, i) => (
            <li key={x.key} className={on === i ? "on" : undefined} onMouseEnter={() => setOn(i)} onMouseLeave={() => setOn(null)}>
              {many ? <span className="bar" style={{ width: `${Math.max(2, (x.value / total) * 100)}%`, background: colorOf(i, x.color) }} aria-hidden="true" /> : <i className="swatch" style={{ background: colorOf(i, x.color) }} aria-hidden="true" />}
              <span className="part-name">{x.name}</span>
              <b>{u.fmt(x.value)}</b>
              <span className="part-share">{pct(x.value)}</span>
            </li>
          ))}
          {nd.map((x) => (
            <li key={x.key} className="nd-part">
              <i className="swatch dashed" aria-hidden="true" />
              <span className="part-name">{x.name}</span>
              <b className="nd">n.d.</b>
              <span className="part-share">{x.reason ?? "valeur non disponible"}</span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}
