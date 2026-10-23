import { monthRange } from "@/lib/connectors/months";
import { hireKey, landing, project } from "./engine";
import type { BaseSnapshot, Conventions, Hypothesis, Projection } from "./types";

// Lot 3 du module 5 : atterrissage retraité, mesures de management, sensibilités. Calculs purs sur la projection du
// moteur (centimes) ; chaque montant remonte à une hypothèse visible.
type Dep = Extract<Hypothesis, { kind: "depart" }>;
type Hire = Extract<Hypothesis, { kind: "embauche" }>;

// --- Atterrissage retraité : atterrissage − éléments non récurrents (déjà en comptabilité, saisis à la main, + prévus
// par les hypothèses : coûts de sortie, éléments ponctuels marqués, tuilages = coût de l'entrant pendant le recouvrement).
export type NonRecurringRow = { label: string; realised: number; projected: number };
export type Retraite =
  | { kind: "value"; year: string; atterrissage: number; rows: NonRecurringRow[]; realised: number; projected: number; total: number; retraite: number }
  | { kind: "nd"; year: string; reason: string };

export function retraite(base: BaseSnapshot, proj: Projection, hyps: Hypothesis[], year: string): Retraite {
  const land = landing(base, proj, year);
  if (land.kind === "nd" || proj.kind === "error") return { kind: "nd", year, reason: land.kind === "nd" ? land.reason : "projection refusée" };
  const rows = new Map<string, NonRecurringRow>();
  const add = (label: string, side: "realised" | "projected", cents: number) => {
    const r = rows.get(label) ?? { label, realised: 0, projected: 0 };
    r[side] += cents;
    rows.set(label, r);
  };
  for (const h of hyps) if (h.kind === "realise" && h.month.startsWith(year) && h.month <= base.refMonth) add(h.category, "realised", h.costCents);
  for (const m of proj.months) {
    if (!m.month.startsWith(year) || m.kind !== "value") continue;
    for (const c of m.contributions) {
      if (!c.nonRecurringCents) continue;
      add(c.kind === "sortie" ? "Coûts de sortie (hypothèses de départ)" : c.kind === "embauche" ? "Tuilages (coût de l'entrant pendant le recouvrement)" : `Éléments ponctuels non récurrents`, "projected", c.nonRecurringCents);
    }
  }
  const list = [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
  const realised = list.reduce((s, r) => s + r.realised, 0);
  const projected = list.reduce((s, r) => s + r.projected, 0);
  return { kind: "value", year, atterrissage: land.total, rows: list, realised, projected, total: realised + projected, retraite: land.total - realised - projected };
}

// --- Mesures de management : pour chaque départ, effet sur l'année du premier mois projeté, en comparant la projection
// avec et sans ce départ (le remplaçant lié reste compté à part). Économie nette = paie évitée − coûts de sortie −
// coût du remplaçant lié. Année pleine = 12 × (paie évitée − coût du remplaçant) du dernier mois de l'année, mois complet.
export type Measure = {
  id: string;
  label: string;
  who: string;
  lastPaidDate: string;
  avoided: number; // paie évitée sur l'année (mois projetés)
  exit: number; // coûts de sortie sur l'année
  replacement: number | null; // coût du remplaçant lié sur l'année (null : aucun remplaçant lié)
  replacementLabel: string | null;
  net: number;
  fullYear: { kind: "value"; cents: number } | { kind: "nd"; reason: string };
};
export type Measures = { kind: "value"; year: string; rows: Measure[] } | { kind: "nd"; year: string; reason: string };

const sumOf = (p: Projection, year: string, pick: (c: { kind: string; contractKey: string | null; hypothesisId: string | null; cost: number }) => boolean) =>
  p.kind === "value" ? p.months.reduce((s, m) => (m.month.startsWith(year) && m.kind === "value" ? s + m.contributions.filter(pick).reduce((t, c) => t + c.cost, 0) : s), 0) : 0;

export function measures(base: BaseSnapshot, first: string, last: string, hyps: Hypothesis[], conv: Conventions, year: string): Measures {
  const withDep = project(base, first, last, hyps, conv);
  if (withDep.kind === "error") return { kind: "nd", year, reason: `projection refusée : ${withDep.errors.join(" ; ")}` };
  const nd = withDep.months.filter((m) => m.kind === "nd" && m.month.startsWith(year));
  if (nd.length) return { kind: "nd", year, reason: `mois n.d. : ${nd.map((m) => m.month).join(", ")}` };
  const lastOfYear = `${year}-12`;
  const rows: Measure[] = [];
  for (const d of hyps.filter((h): h is Dep => h.kind === "depart")) {
    // Sans ce départ : le lien documentaire des remplaçants vers lui est coupé (le remplaçant reste dans la projection).
    const without = project(base, first, last, hyps.filter((h) => h.id !== d.id).map((h) => (h.kind === "embauche" && h.replaces === d.id ? { ...h, replaces: null } : h)), conv);
    if (without.kind === "error") return { kind: "nd", year, reason: `projection sans « ${d.label} » refusée : ${without.errors.join(" ; ")}` };
    const c = base.contracts.find((x) => x.contractKey === d.contractKey)!;
    const own = (x: { contractKey: string | null; kind: string }) => x.contractKey === d.contractKey && x.kind !== "sortie";
    const avoided = sumOf(without, year, own) - sumOf(withDep, year, own);
    const exit = sumOf(withDep, year, (x) => x.hypothesisId === d.id && (x as { kind: string }).kind === "sortie");
    const hires = hyps.filter((h): h is Hire => h.kind === "embauche" && h.replaces === d.id);
    const keys = new Set(hires.map((h) => hireKey(h.id)));
    const replacement = hires.length ? sumOf(withDep, year, (x) => x.contractKey !== null && keys.has(x.contractKey)) : null;
    // Année pleine : mois complet du dernier mois de l'année, sans le départ ; remplaçants : mois complet aussi.
    let fullYear: Measure["fullYear"];
    const dec = without.months.find((m) => m.month === lastOfYear);
    const decWith = withDep.months.find((m) => m.month === lastOfYear);
    if (!dec || !decWith || dec.kind !== "value" || decWith.kind !== "value") fullYear = { kind: "nd", reason: `${lastOfYear} hors de l'horizon du scénario` };
    else if (hires.some((h) => h.start > `${lastOfYear}-01`)) fullYear = { kind: "nd", reason: `remplaçant arrivé après le 1er ${lastOfYear} : mois incomplet` };
    else {
      const full = (m: typeof dec, pred: (x: { contractKey: string | null; kind: string }) => boolean) => m.contributions.filter(pred).reduce((t, x) => t + x.cost, 0);
      const avoidedMonth = full(dec, (x) => x.contractKey === d.contractKey && (x.kind === "base" || x.kind === "augmentation"));
      const replMonth = full(decWith, (x) => x.contractKey !== null && keys.has(x.contractKey));
      fullYear = { kind: "value", cents: 12 * (avoidedMonth - replMonth) };
    }
    rows.push({ id: d.id, label: d.label, who: c.label, lastPaidDate: d.lastPaidDate, avoided, exit, replacement, replacementLabel: hires.length ? hires.map((h) => h.label).join(", ") : null, net: avoided - exit - (replacement ?? 0), fullYear });
  }
  return { kind: "value", year, rows };
}

// --- Sensibilités : effet d'une variation d'une hypothèse sur l'atterrissage de l'année (variation − hypothèse retenue).
export type VariantKind = "jours" | "taux" | "pct" | "sortie-pct";
export type Variant = { hypothesisId: string; kind: VariantKind; delta: number }; // jours : entier ; taux : points de base ; pct : points de base (100 = 1 %)
export const VARIANT_LABELS: Record<VariantKind, string> = { jours: "décalage en jours", taux: "variation du taux, en points de %", pct: "variation du montant, en %", "sortie-pct": "variation des coûts de sortie, en %" };

const shiftDate = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const scale = (a: Extract<Hypothesis, { kind: "ponctuel" }>["amount"], bps: number) => (a.mode === "brut" ? { ...a, brutCents: Math.round((a.brutCents * (10_000 + bps)) / 10_000) } : { ...a, costCents: Math.round((a.costCents * (10_000 + bps)) / 10_000) });

export function applyVariant(hyps: Hypothesis[], v: Variant): { kind: "value"; hyps: Hypothesis[] } | { kind: "nd"; reason: string } {
  const h = hyps.find((x) => x.id === v.hypothesisId);
  if (!h) return { kind: "nd", reason: "hypothèse introuvable" };
  let n: Hypothesis;
  if (v.kind === "jours" && h.kind === "depart") n = { ...h, lastPaidDate: shiftDate(h.lastPaidDate, v.delta) };
  else if (v.kind === "jours" && h.kind === "embauche") n = { ...h, start: shiftDate(h.start, v.delta) };
  else if (v.kind === "taux" && h.kind === "augmentation") n = { ...h, rateBps: h.rateBps + v.delta };
  else if (v.kind === "pct" && h.kind === "ponctuel") n = { ...h, amount: scale(h.amount, v.delta) };
  else if (v.kind === "pct" && h.kind === "realise") n = { ...h, costCents: Math.round((h.costCents * (10_000 + v.delta)) / 10_000) };
  else if (v.kind === "sortie-pct" && h.kind === "depart" && h.exitCost) n = { ...h, exitCost: scale(h.exitCost, v.delta) };
  else return { kind: "nd", reason: `variation « ${VARIANT_LABELS[v.kind]} » non applicable à « ${h.label} »` };
  return { kind: "value", hyps: hyps.map((x) => (x.id === h.id ? n : x)) };
}

export type SensitivityRow = { variant: Variant; label: string; effect: { kind: "value"; atterrissage: number; retraite: number | null; total: number } | { kind: "nd"; reason: string } };
export function sensitivities(base: BaseSnapshot, first: string, last: string, hyps: Hypothesis[], conv: Conventions, year: string, variants: Variant[]): { reference: Retraite; landing: ReturnType<typeof landing>; rows: SensitivityRow[] } {
  const ref = project(base, first, last, hyps, conv);
  const reference = retraite(base, ref, hyps, year);
  const refLanding = landing(base, ref, year);
  const rows = variants.map((variant): SensitivityRow => {
    const h = hyps.find((x) => x.id === variant.hypothesisId);
    const label = `${h?.label ?? "?"} — ${VARIANT_LABELS[variant.kind]} ${variant.delta > 0 ? "+" : ""}${variant.kind === "jours" ? variant.delta : variant.delta / 100}`;
    const a = applyVariant(hyps, variant);
    if (a.kind === "nd") return { variant, label, effect: a };
    const p = project(base, first, last, a.hyps, conv);
    if (p.kind === "error") return { variant, label, effect: { kind: "nd", reason: `variation refusée : ${p.errors.join(" ; ")}` } };
    const l = landing(base, p, year);
    if (l.kind === "nd" || refLanding.kind === "nd") return { variant, label, effect: { kind: "nd", reason: l.kind === "nd" ? l.reason : refLanding.kind === "nd" ? refLanding.reason : "" } };
    const r = retraite(base, p, a.hyps, year);
    return { variant, label, effect: { kind: "value", atterrissage: l.total - refLanding.total, retraite: r.kind === "value" && reference.kind === "value" ? r.retraite - reference.retraite : null, total: l.total } };
  });
  return { reference, landing: refLanding, rows };
}

export const yearMonths = (year: string) => monthRange(`${year}-01`, `${year}-12`);
