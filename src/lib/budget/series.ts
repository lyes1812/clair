import { monthRange } from "@/lib/connectors/months";
import { monthPayroll, type JournalInput } from "@/lib/payroll/engine";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import type { KpiInput } from "@/lib/rh/kpi/types";
import { roundDiv } from "./engine";
import type { BaseSnapshot, Projection } from "./types";

// Comparaisons du module 5 : séries mensuelles de coût employeur (et d'ETP fin de mois quand la lecture en a) —
// scénario, budget saisi, réel courant, N-1 — comparées sur les mêmes mois. Une valeur absente est n.d. avec sa
// raison, jamais 0 ; un total est n.d. dès qu'un de ses mois l'est.
export type Layer = "reel" | "projete-parent" | "projete" | "budget";
export type Point = { month: string; kind: "value"; cost: number; etp4: number | null; etpNd: string | null; layer: Layer } | { month: string; kind: "nd"; reason: string };
export type Series = { key: string; label: string; points: Map<string, Point> };

const put = (s: Series, p: Point) => s.points.set(p.month, p);

// Scénario : réel figé de sa base, mois projetés du scénario parent (base dérivée), puis sa projection.
export function scenarioSeries(key: string, label: string, base: BaseSnapshot, proj: Projection): Series {
  const s: Series = { key, label, points: new Map() };
  for (const a of base.actuals) put(s, a.kind === "nd" ? { month: a.month, kind: "nd", reason: a.reason } : { month: a.month, kind: "value", cost: a.masse, etp4: a.etp4, etpNd: a.etpNd, layer: "reel" });
  for (const p of base.prior ?? []) {
    if (s.points.has(p.month)) continue;
    put(s, p.kind === "nd" ? { month: p.month, kind: "nd", reason: p.reason } : { month: p.month, kind: "value", cost: p.cost, etp4: p.etp4, etpNd: p.etpNd, layer: "projete-parent" });
  }
  if (proj.kind === "error") return s;
  for (const p of proj.months) put(s, p.kind === "nd" ? { month: p.month, kind: "nd", reason: p.reasons.join(" ; ") } : { month: p.month, kind: "value", cost: p.cost, etp4: p.etp4, etpNd: p.etpNd, layer: "projete" });
  return s;
}

// Budget saisi : montant chargé global par mois ; sans ETP.
export type BudgetAmounts = Record<string, number | null>;
export function budgetSeries(key: string, label: string, year: string, amounts: BudgetAmounts): Series {
  const s: Series = { key, label, points: new Map() };
  for (const m of monthRange(`${year}-01`, `${year}-12`)) {
    const v = amounts[m];
    put(s, v === null || v === undefined ? { month: m, kind: "nd", reason: "montant du budget non saisi" } : { month: m, kind: "value", cost: v, etp4: null, etpNd: "budget saisi sans ETP", layer: "budget" });
  }
  return s;
}

// Réel courant : journal de la lecture PayFit appliquée, mois clos seulement ; ETP fin de mois du module KPI RH.
export function liveSeries(key: string, label: string, input: JournalInput, kpi: KpiInput | null): Series {
  const s: Series = { key, label, points: new Map() };
  for (const m of input.months) {
    if (input.openMonths.includes(m)) {
      put(s, { month: m, kind: "nd", reason: "paie non clôturée à la lecture" });
      continue;
    }
    const mp = monthPayroll(input, m);
    if (mp.kind === "nd") {
      put(s, { month: m, kind: "nd", reason: mp.nd.reason });
      continue;
    }
    const e = kpi ? etpMonthEnd(kpi, m) : null;
    put(s, { month: m, kind: "value", cost: mp.masse, etp4: e?.kind === "exact" ? e.etp4 : null, etpNd: !e ? "référentiel indisponible" : e.kind === "exact" ? null : e.kind === "nd" ? e.nd.reason : "ETP en borne basse", layer: "reel" });
  }
  return s;
}

// Même série décalée de n mois (N-1 : n = 12) : le point de m est celui de m − n.
export function shifted(s: Series, n: number, key: string, label: string): Series {
  const out: Series = { key, label, points: new Map() };
  for (const [m, p] of s.points) {
    const [y, mm] = m.split("-").map(Number);
    const d = new Date(Date.UTC(y, mm - 1 + n, 1));
    const to = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.points.set(to, { ...p, month: to });
  }
  return out;
}

// Raisons groupées : une raison suivie de ses mois, mois consécutifs en plage (« 2026-01 → 2026-12 »).
export function groupReasons(items: { month: string; reason: string }[]): string {
  const by = new Map<string, string[]>();
  for (const i of items) by.set(i.reason, [...(by.get(i.reason) ?? []), i.month]);
  const next = (m: string) => {
    const [y, mm] = m.split("-").map(Number);
    return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
  };
  const ranges = (ms: string[]) => {
    const sorted = [...ms].sort();
    const out: string[] = [];
    let start = sorted[0];
    let prev = sorted[0];
    for (const m of sorted.slice(1).concat([""])) {
      if (m && m === next(prev)) {
        prev = m;
        continue;
      }
      out.push(start === prev ? start : `${start} → ${prev}`);
      start = m;
      prev = m;
    }
    return out.join(", ");
  };
  return [...by].map(([r, ms]) => `${r} (${ranges(ms)})`).join(" ; ");
}

const pointOf = (s: Series, m: string): Point => s.points.get(m) ?? { month: m, kind: "nd", reason: "mois non couvert" };

// Total d'une série sur des mois : n.d. si un mois l'est, avec les raisons.
export type Total = { kind: "value"; cost: number } | { kind: "nd"; reason: string };
export function total(s: Series, months: string[]): Total {
  const reasons: { month: string; reason: string }[] = [];
  let cost = 0;
  for (const m of months) {
    const p = pointOf(s, m);
    if (p.kind === "nd") reasons.push({ month: m, reason: p.reason });
    else cost += p.cost;
  }
  return reasons.length ? { kind: "nd", reason: groupReasons(reasons) } : { kind: "value", cost };
}

// Écart d'une lecture à une autre sur les mêmes mois : a − b, en € et en % de b (n.d. si b ≤ 0).
export type Gap = { kind: "value"; a: number; b: number; delta: number; pct: { num: number; den: number } | null } | { kind: "nd"; reason: string };
export function gap(a: Series, b: Series, months: string[]): Gap {
  const ta = total(a, months);
  const tb = total(b, months);
  if (ta.kind === "nd") return { kind: "nd", reason: `${a.label} : ${ta.reason}` };
  if (tb.kind === "nd") return { kind: "nd", reason: `${b.label} : ${tb.reason}` };
  return { kind: "value", a: ta.cost, b: tb.cost, delta: ta.cost - tb.cost, pct: tb.cost > 0 ? { num: ta.cost - tb.cost, den: tb.cost } : null };
}

// Pont d'écart volume / coût moyen entre deux lectures sur les mêmes mois, en ETP-mois (ETP fin de mois sommés) :
// effet volume = (ETP-mois a − ETP-mois b) × coût par ETP-mois de b ; effet coût moyen = (coût par ETP-mois a − coût
// par ETP-mois b) × ETP-mois de a. Calcul exact, l'effet volume est arrondi au centime et l'effet coût moyen est
// l'écart restant : la somme égale l'écart. L'effet de structure (mix) n'est pas calculé.
export type Bridge =
  | { kind: "value"; a: { cost: number; etpMonths4: number }; b: { cost: number; etpMonths4: number }; delta: number; volume: number; averageCost: number }
  | { kind: "nd"; reason: string };
export function bridge(a: Series, b: Series, months: string[]): Bridge {
  const side = (s: Series) => {
    const reasons: { month: string; reason: string }[] = [];
    let cost = 0;
    let etp = 0;
    for (const m of months) {
      const p = pointOf(s, m);
      if (p.kind === "nd") reasons.push({ month: m, reason: p.reason });
      else if (p.etp4 === null) reasons.push({ month: m, reason: `ETP n.d. — ${p.etpNd ?? "non disponible"}` });
      else (cost += p.cost), (etp += p.etp4);
    }
    return reasons.length ? { kind: "nd" as const, reason: `${s.label} : ${groupReasons(reasons)}` } : { kind: "value" as const, cost, etp };
  };
  const sa = side(a);
  const sb = side(b);
  if (sa.kind === "nd") return sa;
  if (sb.kind === "nd") return sb;
  if (sa.etp <= 0 || sb.etp <= 0) return { kind: "nd", reason: "ETP-mois nuls sur la période : coût par ETP-mois non défini" };
  const delta = sa.cost - sb.cost;
  const volume = roundDiv(BigInt(sa.etp - sb.etp) * BigInt(sb.cost), BigInt(sb.etp));
  return { kind: "value", a: { cost: sa.cost, etpMonths4: sa.etp }, b: { cost: sb.cost, etpMonths4: sb.etp }, delta, volume, averageCost: delta - volume };
}
