import { monthRange } from "@/lib/connectors/months";
import { workdays } from "./calendar";
import type { BaseContract, BaseSnapshot, Contribution, Conventions, Hypothesis, ProjectedMonth, Projection, Scope } from "./types";

// Moteur de projection de la masse salariale (module 5) : calcul pur, déterministe, en centimes.
// Pour chaque mois projeté et chaque contrat, le coût est la somme de contributions rattachées chacune à une hypothèse
// (ou à la base figée) : base du mois complet, effet de chaque augmentation, effet d'un départ ou d'une fin de contrat,
// embauches, éléments ponctuels. Calcul exact en fractions puis un seul arrondi au centime par niveau cumulé (demi-centime
// à l'écart de zéro) ; chaque contribution est la différence entre deux niveaux arrondis, donc la somme tombe juste.

type Frac = { n: bigint; d: bigint };
const B = BigInt;
const TEN_K = B(10_000);

export function roundDiv(n: bigint, d: bigint): number {
  if (d < 0n) return roundDiv(-n, -d);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = a / d;
  const r = a % d;
  const v = r * 2n >= d ? q + 1n : q;
  return Number(neg ? -v : v);
}

export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
export const monthStart = (month: string) => `${month}-01`;
export const monthLast = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
const dayOf = (date: string) => Number(date.slice(8, 10));

// Part de présence dans le mois d'un intervalle de jours payés [from, to] (bornes incluses, to null = sans fin).
// « calendaire » : jours présents ÷ jours du mois ; « ouvres » : jours ouvrés présents ÷ jours ouvrés du mois (lundi à
// vendredi hors jours fériés légaux, voir calendar.ts) ; « aucun » : mois entier dès un jour de présence.
export function presence(month: string, from: string, to: string | null, prorata: Conventions["prorata"]): Frac {
  const first = monthStart(month);
  const last = monthLast(month);
  if (from > last || (to !== null && to < first)) return { n: 0n, d: 1n };
  const a = from < first ? first : from;
  const b = to === null || to > last ? last : to;
  if (prorata === "aucun") return { n: 1n, d: 1n };
  if (prorata === "ouvres") return { n: B(workdays(a, b)), d: B(workdays(first, last)) };
  return { n: B(dayOf(b) - dayOf(a) + 1), d: B(daysInMonth(month)) };
}

const specificity = (s: Scope) => (s.kind === "contrat" ? 3 : s.kind === "service" ? 2 : 1);
const scopeText = (s: Scope) => (s.kind === "global" ? "toute l'entreprise" : s.kind === "service" ? `service ${s.service}` : "contrat ciblé");
export const hireKey = (id: string) => `embauche:${id}`;
export const enteredAfter = (base: BaseSnapshot, c: BaseContract) => c.startDate !== null && c.startDate > monthLast(base.refMonth);

type Aug = Extract<Hypothesis, { kind: "augmentation" }>;
type Hire = Extract<Hypothesis, { kind: "embauche" }>;
type Dep = Extract<Hypothesis, { kind: "depart" }>;
type Fix = Extract<Hypothesis, { kind: "base" }>;
type Abs = Extract<Hypothesis, { kind: "absence" }>;
type Target = { key: string; service: string | null; isHire: boolean };

// Augmentations retenues pour une cible : pour chaque mois d'effet, la plus ciblée (contrat > service > toute
// l'entreprise) ; deux hypothèses de même niveau le même mois sont en conflit. Les embauches ne reçoivent que les
// augmentations qui les visent directement. Taux successifs composés.
function augmentationsFor(t: Target, augs: Aug[], errors: Set<string>): Aug[] {
  const applies = (a: Aug) =>
    a.scope.kind === "contrat" ? a.scope.key === t.key : t.isHire ? false : a.scope.kind === "global" ? true : a.scope.service === t.service;
  const byMonth = new Map<string, Aug[]>();
  for (const a of augs) if (applies(a)) byMonth.set(a.from, [...(byMonth.get(a.from) ?? []), a]);
  const chosen: Aug[] = [];
  for (const [from, list] of [...byMonth].sort(([x], [y]) => x.localeCompare(y))) {
    const top = Math.max(...list.map((a) => specificity(a.scope)));
    const best = list.filter((a) => specificity(a.scope) === top);
    if (best.length > 1) errors.add(`augmentations en conflit en ${from} (${scopeText(best[0].scope)}) : ${best.map((a) => `« ${a.label} »`).join(", ")} — une seule par mois et par niveau`);
    chosen.push(best[0]);
  }
  return chosen;
}

// Niveaux cumulés d'un salaire mensuel S (fraction) après k augmentations, avec une part de présence p et un taux de
// charges c : brut_k = arrondi(S × Π(1 + r_i) × p), charges_k = arrondi(S × Π(1 + r_i) × p × c).
function levels(S: Frac, augs: Aug[], p: Frac, c: Frac) {
  const out: { brut: number; charges: number }[] = [];
  let n = S.n * p.n;
  let d = S.d * p.d;
  for (let k = 0; k <= augs.length; k++) {
    if (k > 0) {
      n *= TEN_K + B(augs[k - 1].rateBps);
      d *= TEN_K;
    }
    out.push({ brut: roundDiv(n, d), charges: roundDiv(n * c.n, d * c.d) });
  }
  return out;
}

export function validate(base: BaseSnapshot, firstMonth: string, lastMonth: string, hyps: Hypothesis[]): string[] {
  const errors: string[] = [];
  const keys = new Set(base.contracts.map((c) => c.contractKey));
  const inHorizon = (m: string) => m >= firstMonth && m <= lastMonth;
  const deps = new Map<string, Dep>();
  const fixes = new Set<string>();
  for (const h of hyps) {
    if (h.kind === "augmentation") {
      if (!inHorizon(h.from)) errors.push(`« ${h.label} » : mois d'effet ${h.from} hors de l'horizon ${firstMonth} → ${lastMonth} (la base du mois de référence contient déjà le passé)`);
      if (h.scope.kind === "contrat" && !keys.has(h.scope.key) && !hyps.some((x) => x.kind === "embauche" && hireKey(x.id) === (h.scope as { key: string }).key)) errors.push(`« ${h.label} » : contrat ou embauche ciblé inconnu`);
    }
    if (h.kind === "depart") {
      if (!keys.has(h.contractKey)) errors.push(`« ${h.label} » : contrat absent de la base figée`);
      if (deps.has(h.contractKey)) errors.push(`« ${h.label} » : deux départs pour le même contrat`);
      deps.set(h.contractKey, h);
      if (h.lastPaidDate < monthStart(firstMonth)) errors.push(`« ${h.label} » : dernier jour payé ${h.lastPaidDate} antérieur à la bascule (${firstMonth})`);
      const c = base.contracts.find((x) => x.contractKey === h.contractKey);
      if (c?.endDate && h.lastPaidDate > c.endDate) errors.push(`« ${h.label} » : fin de contrat connue le ${c.endDate} — le dernier jour payé (${h.lastPaidDate}) doit la précéder`);
      if (c?.startDate && h.lastPaidDate < c.startDate) errors.push(`« ${h.label} » : dernier jour payé (${h.lastPaidDate}) antérieur à l'entrée du contrat (${c.startDate})`);
    }
    if (h.kind === "base") {
      if (!keys.has(h.contractKey)) errors.push(`« ${h.label} » : contrat absent de la base figée`);
      if (fixes.has(h.contractKey)) errors.push(`« ${h.label} » : deux corrections de base pour le même contrat`);
      fixes.add(h.contractKey);
    }
    if (h.kind === "embauche") {
      if (h.end !== null && h.end < h.start) errors.push(`« ${h.label} » : dernier jour payé antérieur au premier`);
      if (h.start < monthStart(firstMonth)) errors.push(`« ${h.label} » : arrivée ${h.start} antérieure à la bascule (${firstMonth})`);
      if (h.replaces !== null && !hyps.some((x) => x.id === h.replaces && x.kind === "depart")) errors.push(`« ${h.label} » : le départ remplacé n'existe pas`);
    }
    if (h.kind === "ponctuel" && !inHorizon(h.month)) errors.push(`« ${h.label} » : mois ${h.month} hors de l'horizon ${firstMonth} → ${lastMonth}`);
    if (h.kind === "ponctuel" && h.contractKey && !keys.has(h.contractKey) && !hyps.some((x) => x.kind === "embauche" && hireKey(x.id) === h.contractKey)) errors.push(`« ${h.label} » : salarié inconnu`);
    if (h.kind === "absence") {
      if (!keys.has(h.contractKey)) errors.push(`« ${h.label} » : salarié absent de la base figée (un congé sur une embauche n'est pas géré : décalez sa date d'arrivée)`);
      if (h.to < h.from) errors.push(`« ${h.label} » : fin de l'absence antérieure à son début`);
      if (h.to < monthStart(firstMonth) || h.from > monthLast(lastMonth)) errors.push(`« ${h.label} » : absence hors de l'horizon ${firstMonth} → ${lastMonth}`);
      if (h.paidBps < 0 || h.paidBps > 10_000) errors.push(`« ${h.label} » : part payée entre 0 et 100 %`);
      const c = base.contracts.find((x) => x.contractKey === h.contractKey);
      if (c?.startDate && h.to < c.startDate) errors.push(`« ${h.label} » : absence antérieure à l'entrée du salarié`);
      const other = hyps.find((x) => x.kind === "absence" && x.id !== h.id && x.contractKey === h.contractKey && x.from <= h.to && h.from <= x.to);
      if (other) errors.push(`« ${h.label} » : chevauche « ${other.label} » pour le même salarié`);
    }
    if (h.kind === "categorie") {
      if (!keys.has(h.contractKey) && !hyps.some((x) => x.kind === "embauche" && hireKey(x.id) === h.contractKey)) errors.push(`« ${h.label} » : salarié inconnu`);
      if (hyps.some((x) => x.kind === "categorie" && x.id !== h.id && x.contractKey === h.contractKey)) errors.push(`« ${h.label} » : deux catégories pour le même salarié`);
    }
    if (h.kind === "realise" && !base.actuals.some((x) => x.month === h.month && x.kind === "value")) errors.push(`« ${h.label} » : ${h.month} n'est pas un mois réalisé de la base figée (pour un mois à venir, utilisez un élément ponctuel)`);
  }
  return errors;
}

export function project(base: BaseSnapshot, firstMonth: string, lastMonth: string, hyps: Hypothesis[], conv: Conventions): Projection {
  const errors = validate(base, firstMonth, lastMonth, hyps);
  if (errors.length) return { kind: "error", errors };
  const augs = hyps.filter((h): h is Aug => h.kind === "augmentation");
  const hires = hyps.filter((h): h is Hire => h.kind === "embauche");
  const deps = new Map(hyps.filter((h): h is Dep => h.kind === "depart").map((h) => [h.contractKey, h]));
  const fixes = new Map(hyps.filter((h): h is Fix => h.kind === "base").map((h) => [h.contractKey, h]));
  const absFor = new Map<string, Abs[]>();
  for (const h of hyps) if (h.kind === "absence") absFor.set(h.contractKey, [...(absFor.get(h.contractKey) ?? []), h].sort((x, y) => x.from.localeCompare(y.from)));
  const catOf = new Map(hyps.flatMap((h) => (h.kind === "categorie" ? [[h.contractKey, h.category] as const] : [])));
  const conflicts = new Set<string>();
  const augFor = new Map<string, Aug[]>();
  // Un contrat entré après le mois de référence a une base saisie à son entrée : comme une embauche, il ne reçoit que
  // les augmentations qui le visent directement.
  for (const c of base.contracts) augFor.set(c.contractKey, augmentationsFor({ key: c.contractKey, service: c.service, isHire: enteredAfter(base, c) }, augs, conflicts));
  for (const h of hires) augFor.set(hireKey(h.id), augmentationsFor({ key: hireKey(h.id), service: h.service, isHire: true }, augs, conflicts));
  if (conflicts.size) return { kind: "error", errors: [...conflicts] };

  const start = monthStart(firstMonth);
  const months: ProjectedMonth[] = monthRange(firstMonth, lastMonth).map((m) => {
    const contributions: Contribution[] = [];
    const reasons: string[] = [];
    let headcount = 0;
    let etp = 0;
    const etpNd: string[] = [];
    const cats = new Map<string, { headcount: number; etp: number; nd: boolean }>();
    const countIn = (cat: string | null | undefined, etp4: number | null) => {
      const k = cat ?? "nc";
      const e = cats.get(k) ?? { headcount: 0, etp: 0, nd: false };
      e.headcount += 1;
      if (etp4 === null) e.nd = true;
      else e.etp += etp4;
      cats.set(k, e);
    };
    const end = monthLast(m);
    const effective = (list: Aug[]) => list.filter((a) => a.from <= m);

    for (const c of base.contracts) {
      const dep = deps.get(c.contractKey) ?? null;
      // Fin de présence : départ saisi ou fin de contrat connue, la plus proche.
      const stop = [dep?.lastPaidDate ?? null, c.endDate].filter((x): x is string => x !== null).sort()[0] ?? null;
      // Contrat entré après le mois de référence (connu de PayFit à la lecture) : présent à partir de son entrée.
      const from = c.startDate && c.startDate > start ? c.startDate : start;
      const p = presence(m, from, stop, conv.prorata);
      if (p.n === 0n) continue;
      const fix = fixes.get(c.contractKey) ?? null;
      const S: Frac | null = fix ? { n: B(fix.salaryCents), d: 1n } : c.base ? { n: B(c.base.salaryCents), d: 1n } : null;
      const rate: Frac | null = fix ? { n: B(fix.chargesBps), d: TEN_K } : c.base && c.base.refBrutCents > 0 ? { n: B(c.base.refCotisationsCents), d: B(c.base.refBrutCents) } : null;
      if (!S || !rate) {
        reasons.push(`${c.label} : base n.d. (${c.baseNd ?? "non renseignée"}) — saisir une correction de base`);
        continue;
      }
      const list = effective(augFor.get(c.contractKey) ?? []);
      const full = levels(S, list, { n: 1n, d: 1n }, rate);
      const who = c.label;
      const sourceLabel = fix ? `Base corrigée — « ${fix.label} »` : `Base figée ${base.refMonth}`;
      contributions.push({ hypothesisId: fix?.id ?? null, kind: "base", label: sourceLabel, contractKey: c.contractKey, who, service: c.service, brut: full[0].brut, charges: full[0].charges, cost: full[0].brut + full[0].charges });
      list.forEach((a, i) => {
        const b = full[i + 1].brut - full[i].brut;
        const ch = full[i + 1].charges - full[i].charges;
        contributions.push({ hypothesisId: a.id, kind: "augmentation", label: a.label, contractKey: c.contractKey, who, service: c.service, brut: b, charges: ch, cost: b + ch });
      });
      {
        // Réductions successives, chacune rattachée à sa cause — entrée après le mois de référence, fin de contrat
        // connue, départ saisi, puis absences non payées. Chaque ligne = différence de deux niveaux arrondis.
        const endKnown = c.endDate !== null && c.endDate <= end ? c.endDate : null;
        const depDate = dep !== null && dep.lastPaidDate <= end ? dep.lastPaidDate : null;
        const steps: { p: Frac; kind: "entree" | "fin-contrat" | "depart" | "absence"; label: string; id: string | null }[] = [];
        if (from > monthStart(m)) steps.push({ p: presence(m, from, null, conv.prorata), kind: "entree", label: `Entrée le ${from}`, id: null });
        if (endKnown) steps.push({ p: presence(m, from, endKnown, conv.prorata), kind: "fin-contrat", label: `Fin de contrat connue le ${endKnown}`, id: null });
        const stopIn = [depDate, endKnown].filter((x): x is string => x !== null).sort()[0] ?? null;
        if (depDate) steps.push({ p: presence(m, from, stopIn, conv.prorata), kind: "depart", label: dep!.label, id: dep!.id });
        // Absences : jours non payés dans la période de présence (calendaires, ou ouvrés selon la règle).
        let run = p;
        for (const ab of absFor.get(c.contractKey) ?? []) {
          const lo = [ab.from, from, monthStart(m)].sort().at(-1)!;
          const hi = [ab.to, stopIn ?? end, end].sort()[0];
          if (lo > hi) continue;
          const days = conv.prorata === "ouvres" ? workdays(lo, hi) : dayOf(hi) - dayOf(lo) + 1;
          if (days <= 0) continue;
          const D = conv.prorata === "ouvres" ? workdays(monthStart(m), end) : daysInMonth(m);
          const unpaid = B(days) * B(10_000 - ab.paidBps);
          run = { n: run.n * TEN_K * B(D) - unpaid * run.d, d: run.d * TEN_K * B(D) };
          steps.push({ p: run, kind: "absence", label: ab.label, id: ab.id });
        }
        let prev = full.at(-1)!;
        for (const st of steps) {
          const lv = levels(S, list, st.p, rate).at(-1)!;
          const b = lv.brut - prev.brut;
          const ch = lv.charges - prev.charges;
          if (b !== 0 || ch !== 0) contributions.push({ hypothesisId: st.id, kind: st.kind, label: st.label, contractKey: c.contractKey, who, service: c.service, brut: b, charges: ch, cost: b + ch });
          prev = lv;
        }
      }
      const atEnd = from <= end && (stop === null || stop >= end);
      if (atEnd && c.counted) {
        headcount += 1;
        countIn(catOf.get(c.contractKey) ?? c.category ?? null, c.etp4);
        if (c.etp4 === null) etpNd.push(`${c.label} : ${c.etpNd ?? "ETP n.d."}`);
        else etp += c.etp4;
      }
    }

    for (const h of hires) {
      const p = presence(m, h.start, h.end, conv.prorata);
      if (p.n === 0n) continue;
      const S: Frac = { n: B(h.grossFullTimeCents) * B(h.quotaBps), d: TEN_K };
      const rate: Frac = { n: B(h.chargesBps), d: TEN_K };
      const list = effective(augFor.get(hireKey(h.id)) ?? []);
      const lv = levels(S, list, p, rate);
      // Tuilage : coût de l'entrant (augmentations comprises) pendant les jours où le salarié remplacé est encore payé.
      const rep = h.replaces ? deps.get(base.contracts.find((c) => deps.get(c.contractKey)?.id === h.replaces)?.contractKey ?? "") : undefined;
      const overlapEnd = rep ? [rep.lastPaidDate, h.end].filter((x): x is string => x !== null).sort()[0] : null;
      const po = overlapEnd && overlapEnd >= h.start ? presence(m, h.start, overlapEnd, conv.prorata) : null;
      const tl = po && po.n > 0n ? levels(S, list, po, rate).at(-1)! : null;
      contributions.push({ hypothesisId: h.id, kind: "embauche", label: h.label, contractKey: hireKey(h.id), who: h.label, service: h.service, brut: lv[0].brut, charges: lv[0].charges, cost: lv[0].brut + lv[0].charges, ...(tl ? { nonRecurringCents: tl.brut + tl.charges } : {}) });
      list.forEach((a, i) => {
        const b = lv[i + 1].brut - lv[i].brut;
        const ch = lv[i + 1].charges - lv[i].charges;
        contributions.push({ hypothesisId: a.id, kind: "augmentation", label: a.label, contractKey: hireKey(h.id), who: h.label, service: h.service, brut: b, charges: ch, cost: b + ch });
      });
      if (h.counted && (h.end === null || h.end >= end) && h.start <= end) {
        headcount += 1;
        countIn(catOf.get(hireKey(h.id)) ?? h.category ?? null, h.quotaBps);
        etp += h.quotaBps;
      }
    }

    const amount = (a: Extract<Hypothesis, { kind: "ponctuel" }>["amount"]) => {
      if (a.mode === "charge") return { brut: null, charges: null, cost: a.costCents };
      const ch = roundDiv(B(a.brutCents) * B(a.chargesBps), TEN_K);
      return { brut: a.brutCents, charges: ch, cost: a.brutCents + ch };
    };
    for (const h of hyps) {
      if (h.kind === "ponctuel" && h.month === m) {
        const a = amount(h.amount);
        const target = h.contractKey ? base.contracts.find((x) => x.contractKey === h.contractKey) : null;
        const hire = h.contractKey && !target ? hires.find((x) => hireKey(x.id) === h.contractKey) : null;
        contributions.push({
          hypothesisId: h.id, kind: "ponctuel", label: h.label, contractKey: h.contractKey ?? null, who: target?.label ?? hire?.label ?? h.service ?? "toute l'entreprise",
          service: h.service ?? target?.service ?? hire?.service ?? null, ...a, ...(h.nonRecurring ? { nonRecurringCents: a.cost } : {}),
        });
      }
      if (h.kind === "depart" && h.exitCost && h.lastPaidDate.slice(0, 7) === m) {
        const c = base.contracts.find((x) => x.contractKey === h.contractKey)!;
        const a = amount(h.exitCost);
        contributions.push({ hypothesisId: h.id, kind: "sortie", label: `${h.label} — coûts de sortie`, contractKey: c.contractKey, who: c.label, service: c.service, ...a, nonRecurringCents: a.cost, ...(h.motif?.trim() ? { nonRecurringLabel: h.motif.trim() } : {}) });
      }
    }

    if (reasons.length) return { month: m, kind: "nd", reasons };
    const sum = (k: "brut" | "charges") => (contributions.some((x) => x[k] === null) ? null : contributions.reduce((s, x) => s + (x[k] ?? 0), 0));
    return {
      month: m,
      kind: "value",
      brut: sum("brut"),
      charges: sum("charges"),
      cost: contributions.reduce((s, x) => s + x.cost, 0),
      headcount,
      etp4: etpNd.length ? null : etp,
      etpNd: etpNd.length ? etpNd.join(" ; ") : null,
      byCategory: Object.fromEntries([...cats].map(([k, v]) => [k, { headcount: v.headcount, etp4: v.nd ? null : v.etp }])),
      contributions,
    };
  });
  return { kind: "value", months };
}

// Atterrissage d'une année : réel des mois figés + mois projetés par le(s) scénario(s) parent(s) (base dérivée) +
// projection du scénario, jusqu'à décembre.
export type Landing =
  | { kind: "value"; year: string; actual: number; prior: number; projected: number; total: number; actualMonths: string[]; priorMonths: string[]; projectedMonths: string[] }
  | { kind: "nd"; year: string; reason: string };
export function landing(base: BaseSnapshot, proj: Projection, year: string): Landing {
  if (proj.kind === "error") return { kind: "nd", year, reason: "projection refusée (hypothèses en erreur)" };
  const months = monthRange(`${year}-01`, `${year}-12`);
  const reasons: string[] = [];
  const out = { actual: 0, prior: 0, projected: 0, actualMonths: [] as string[], priorMonths: [] as string[], projectedMonths: [] as string[] };
  for (const m of months) {
    if (m > base.refMonth) {
      const p = proj.months.find((x) => x.month === m);
      if (!p) reasons.push(`${m} : hors de l'horizon du scénario`);
      else if (p.kind === "nd") reasons.push(`${m} : ${p.reasons.join(" ; ")}`);
      else (out.projected += p.cost), out.projectedMonths.push(m);
      continue;
    }
    const a = base.actuals.find((x) => x.month === m);
    const pr = base.prior?.find((x) => x.month === m);
    if (a) {
      if (a.kind === "nd") reasons.push(`${m} : ${a.reason}`);
      else (out.actual += a.masse), out.actualMonths.push(m);
    } else if (pr) {
      if (pr.kind === "nd") reasons.push(`${m} : ${pr.reason}`);
      else (out.prior += pr.cost), out.priorMonths.push(m);
    } else reasons.push(`${m} : réel non lu`);
  }
  if (reasons.length) return { kind: "nd", year, reason: reasons.join(" ; ") };
  return { kind: "value", year, ...out, total: out.actual + out.prior + out.projected };
}

export const contractOf = (base: BaseSnapshot, key: string): BaseContract | undefined => base.contracts.find((c) => c.contractKey === key);
