// Géométrie pure des graphiques : graduations « rondes », mise en page des barres, angles des secteurs.
// Aucune valeur n'est inventée ici : une valeur absente (null) reste absente, elle n'est jamais ramenée à zéro.

export type Ticks = { ticks: number[]; min: number; max: number; step: number };

function niceStep(range: number, target: number, integer: boolean): number {
  const rough = range / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = nice * mag;
  return integer ? Math.max(1, Math.ceil(step)) : step;
}

const clean = (v: number) => Number(v.toPrecision(12));

// Graduations rondes couvrant [lo, hi] ; `integer` : pas entier (effectifs, nombres d'événements).
export function niceTicks(lo: number, hi: number, target = 5, integer = false): Ticks {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ticks: [0, 1], min: 0, max: 1, step: 1 };
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    if (lo === 0) hi = 1;
    else {
      const pad = Math.abs(lo) * 0.1;
      lo -= pad;
      hi += pad;
    }
  }
  const step = niceStep(hi - lo, target, integer);
  const min = clean(Math.floor(lo / step) * step);
  const max = clean(Math.ceil(hi / step) * step);
  const ticks: number[] = [];
  for (let i = 0; i < 200; i++) {
    const v = clean(min + i * step);
    if (v > max + step / 2) break;
    ticks.push(v);
  }
  return { ticks, min, max, step };
}

export type Cell = number | null;
export type Bar = { cat: number; ser: number; v: number; x: number; y: number; w: number; h: number };

// Disposition des barres d'un graphique : `grouped` (une barre par série dans chaque catégorie) ou `stacked` (empilées,
// positives vers le haut, négatives vers le bas). Les cellules null ne produisent aucune barre.
export function barLayout(o: { series: Cell[][]; categories: number; mode: "grouped" | "stacked"; plotW: number; plotH: number; yMin: number; yMax: number; bandPad?: number }): { bars: Bar[]; band: number; barW: number; y: (v: number) => number } {
  const { series, categories, mode, plotW, plotH, yMin, yMax } = o;
  const band = categories > 0 ? plotW / categories : plotW;
  const pad = Math.min(o.bandPad ?? 0.22, 0.45);
  const inner = band * (1 - pad);
  const span = yMax - yMin || 1;
  const y = (v: number) => plotH - ((v - yMin) / span) * plotH;
  const bars: Bar[] = [];
  const nSer = Math.max(1, series.length);
  // Largeur plafonnée (72 px au total par catégorie) : une barre unique ne s'étale pas sur toute la largeur de la carte.
  const MAX_GROUP = 72 * Math.max(1, mode === "stacked" ? 1 : Math.min(nSer, 3));
  const used = Math.min(inner, MAX_GROUP);
  const barW = mode === "stacked" ? used : Math.max(1, (used - (nSer - 1) * 2) / nSer);
  for (let c = 0; c < categories; c++) {
    const x0 = c * band + (band - used) / 2;
    let up = 0;
    let down = 0;
    series.forEach((s, i) => {
      const v = s[c];
      if (v === null || v === undefined) return;
      if (mode === "grouped") {
        const x = x0 + i * (barW + 2);
        const a = y(Math.max(v, 0));
        const b = y(Math.min(v, 0));
        bars.push({ cat: c, ser: i, v, x, y: a, w: barW, h: Math.max(v === 0 ? 0 : 1, b - a) });
      } else if (v >= 0) {
        const a = y(up + v);
        const b = y(up);
        bars.push({ cat: c, ser: i, v, x: x0, y: a, w: barW, h: Math.max(v === 0 ? 0 : 1, b - a) });
        up += v;
      } else {
        const a = y(down);
        const b = y(down + v);
        bars.push({ cat: c, ser: i, v, x: x0, y: a, w: barW, h: Math.max(1, b - a) });
        down += v;
      }
    });
  }
  return { bars, band, barW, y };
}

// Domaine vertical d'un graphique en barres : toujours depuis zéro (une barre tronquée tromperait).
export function barDomain(series: Cell[][], categories: number, mode: "grouped" | "stacked"): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (let c = 0; c < categories; c++) {
    let up = 0;
    let down = 0;
    for (const s of series) {
      const v = s[c];
      if (v === null || v === undefined) continue;
      if (mode === "grouped") {
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      } else if (v >= 0) up += v;
      else down += v;
    }
    if (mode === "stacked") {
      hi = Math.max(hi, up);
      lo = Math.min(lo, down);
    }
  }
  return { lo, hi };
}

export type Slice = { index: number; value: number; start: number; end: number; share: number };

// Secteurs d'un anneau : angles en radians depuis midi, sens horaire. Les valeurs ≤ 0 n'ont pas de secteur.
export function sliceAngles(values: number[]): Slice[] {
  const total = values.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  if (total <= 0) return [];
  let a = 0;
  const out: Slice[] = [];
  values.forEach((v, index) => {
    if (v <= 0) return;
    const share = v / total;
    out.push({ index, value: v, start: a, end: a + share * Math.PI * 2, share });
    a += share * Math.PI * 2;
  });
  return out;
}

export function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  // Un secteur de 100 % : deux demi-arcs par cercle (un arc de 360° est dégénéré en SVG, et deux points confondus à l'arrondi
  // font disparaître l'arc intérieur : le trou de l'anneau). À dessiner avec fill-rule evenodd.
  if (end - start >= Math.PI * 2 - 1e-9) {
    const ring = (r: number, sweep: 0 | 1) => `M ${cx} ${(cy - r).toFixed(2)} A ${r} ${r} 0 1 ${sweep} ${cx} ${(cy + r).toFixed(2)} A ${r} ${r} 0 1 ${sweep} ${cx} ${(cy - r).toFixed(2)} Z`;
    return `${ring(rOuter, 1)} ${ring(rInner, 0)}`;
  }
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${p(rOuter, start)} A ${rOuter} ${rOuter} 0 ${large} 1 ${p(rOuter, end)} L ${p(rInner, end)} A ${rInner} ${rInner} 0 ${large} 0 ${p(rInner, start)} Z`;
}
