import { monthEnd, monthOf, monthStart } from "@/lib/dates";
import { gateAt, monthRanges } from "@/lib/rh/headcount";
import { ABSENCE_STATUS_LABELS } from "@/lib/rh/labels";
import type { ContractDraft } from "@/lib/rh/referential/types";
import { absenceSlots, countDays, eachDay, isWeekday } from "./days";
import { ratio } from "./fraction";
import { memo } from "./memo";
import { checkWindow, countedOpts } from "./period";
import {
  kpiNd,
  type AbsenceExcluded,
  type AbsenceSlice,
  type AbsenceTypeChoice,
  type Absenteeism,
  type AbsenteeismMonth,
  type KpiInput,
  type KpiNd,
  type SlotKey,
  type TheoreticalContribution,
  type TheoreticalMonth,
  type Window,
} from "./types";

// Absentéisme = jours d'absence ÷ jours théoriques, en demi-journées ; jamais une moyenne de taux mensuels.
const max = (a: string, b: string) => (a > b ? a : b);
const min = (a: string, b: string) => (a < b ? a : b);
const inEst = (scope: string[] | undefined, id: string | null) => !scope || (id !== null && scope.includes(id));

export function theoreticalMonth(input: KpiInput, month: string): TheoreticalMonth {
  return memo(input, `th:${month}`, () => {
    const { data, scope, params } = input;
    const opts = countedOpts(input);
    const g = gateAt(data, monthEnd(month), scope.establishments);
    if (g.nd) return { month, kind: "nd", nd: kpiNd(g.nd.code, g.nd.reason) };
    if (g.coverage.some((c) => c.presenceStatus === "lower_bound")) {
      return { month, kind: "nd", nd: kpiNd("month-lower-bound", "mois en borne basse (PayFit) : contrats archivés inconnus") };
    }
    const byKey = new Map(data.contracts.map((c) => [c.contractKey, c]));
    const seen = new Set<string>();
    const contributions: TheoreticalContribution[] = [];
    const rows = data.months
      .filter((m) => m.month === month && m.presentAnyDay && inEst(scope.establishments, m.establishmentId))
      .filter((m) => (data.build.source === "payfit" ? m.presenceBasis === "dates" : m.presenceBasis === "declared" && !m.flags.includes("declared_before_start") && !m.flags.includes("declared_after_end")))
      .sort((a, b) => a.contractKey.localeCompare(b.contractKey) || a.establishmentId.localeCompare(b.establishmentId));
    for (const m of rows) {
      const c = byKey.get(m.contractKey);
      if (!c || seen.has(c.contractKey) || c.startDate === null || c.nature === null || !opts.natures.includes(c.nature)) continue;
      seen.add(c.contractKey);
      const from = max(c.startDate, monthStart(month));
      const to = min(c.endDate ?? monthEnd(month), monthEnd(month));
      const days = countDays(from, to, params.dayBasis);
      contributions.push({ contractKey: c.contractKey, externalId: c.externalId, personKey: c.personKey, establishmentId: c.establishmentId, nature: c.nature, from, to, days, half: 2 * days, provenance: m.provenance.presentAnyDay ?? null });
    }
    return { month, kind: "exact", half: contributions.reduce((s, x) => s + x.half, 0), contributions };
  });
}

// Gardes communes au mois et à la période (ordre de la spécification : source, lecture, paramètre).
function absenceGuard(input: KpiInput): KpiNd | null {
  const a = input.absences;
  if (a.status === "not-extracted") return kpiNd("not-extracted", a.nd.reason);
  if (a.status === "unavailable") return kpiNd("absences-unavailable", `absences non lues : ${a.nd.reason}`);
  if (!input.params.absenceTypes.length) return kpiNd("absence-types-unset", "types d'absence non choisis (Paramètres › Définitions des KPI)");
  return null;
}

export function absenteeismMonth(input: KpiInput, month: string): AbsenteeismMonth {
  return memo(input, `abs:${month}`, () => {
    const { data, params, scope, absences } = input;
    const guard = absenceGuard(input);
    if (guard || absences.status !== "read") return { month, kind: "nd", nd: guard ?? kpiNd("absences-unavailable", "absences non lues") };
    const g = gateAt(data, monthEnd(month), scope.establishments);
    if (g.nd) return { month, kind: "nd", nd: kpiNd(g.nd.code, g.nd.reason) };
    if (g.coverage.some((c) => c.presenceStatus === "lower_bound")) {
      return { month, kind: "nd", nd: kpiNd("month-lower-bound", "mois en borne basse (PayFit) : contrats archivés et leurs absences inconnus") };
    }
    if (!absences.months.includes(month)) {
      const read = [...absences.months].sort();
      return { month, kind: "nd", nd: kpiNd("month-out-of-scope", `absences non lues pour ${month} (mois lus : ${read.length ? `${read[0]} → ${read[read.length - 1]}` : "aucun"})`) };
    }
    const t = theoreticalMonth(input, month);
    if (t.kind === "nd") return { month, kind: "nd", nd: t.nd };
    if (t.half === 0) return { month, kind: "nd", nd: kpiNd("denominator-zero", `aucun contrat compté présent dans ${month}`) };

    const opts = countedOpts(input);
    const ms = monthStart(month);
    const me = monthEnd(month);
    const byExternal = new Map<string, ContractDraft>(data.contracts.map((c) => [c.externalId, c]));
    const union = new Map<string, Set<SlotKey>>();
    const doubt = new Map<string, Set<SlotKey>>();
    const slices: AbsenceSlice[] = [];
    const excluded: AbsenceExcluded[] = [];
    const uncertainIds = new Set<string>();
    let outside = 0;
    const setOf = (m: Map<string, Set<SlotKey>>, k: string) => {
      let s = m.get(k);
      if (!s) m.set(k, (s = new Set()));
      return s;
    };
    for (const a of absences.rows) {
      const sd = a.start.date;
      const ed = a.end.date;
      const touches = sd === null && ed === null ? true : sd === null ? month <= monthOf(ed!) : ed === null ? month >= monthOf(sd) : sd <= me && ed >= ms;
      if (!touches) continue;
      if (!params.absenceTypes.includes(a.type)) {
        excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "type", label: `type ${a.type} non choisi`, uncertain: 0 });
        continue;
      }
      if (a.status !== null && !(params.absenceStatuses as string[]).includes(a.status)) {
        excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "status", label: `statut ${ABSENCE_STATUS_LABELS[a.status] ?? a.status} non retenu`, uncertain: 0 });
        continue;
      }
      const c = byExternal.get(a.contractId);
      if (!c) return { month, kind: "nd", nd: kpiNd("absence-unknown-contract", `absence ${a.id} rattachée au contrat ${a.contractId} inconnu du référentiel`) };
      if (c.startDate === null || c.nature === null || !opts.natures.includes(c.nature) || !inEst(scope.establishments, c.establishmentId)) {
        const label = c.startDate === null ? "contrat non positionnable (sans date de début)" : "contrat hors natures comptées ou hors établissement";
        excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "contract-out-of-scope", label, uncertain: 0 });
        continue;
      }
      if (sd === null || ed === null) {
        return { month, kind: "nd", nd: kpiNd("absence-date-nd", `absence ${a.id} : date de ${sd === null ? "début" : "fin"} non renseignée dans PayFit`) };
      }
      const clip = { from: max(ms, c.startDate), to: min(me, c.endDate ?? me) };
      const inMonth = eachDay(max(sd, ms), min(ed, me)).filter((d) => params.dayBasis === "calendar" || isWeekday(d));
      const outsideContract = inMonth.filter((d) => d < c.startDate! || (c.endDate !== null && d > c.endDate)).length;
      outside += outsideContract;
      if (a.status === null) {
        const possible = eachDay(max(sd, clip.from), min(ed, clip.to))
          .filter((d) => params.dayBasis === "calendar" || isWeekday(d))
          .flatMap((d) => [`${d}#0`, `${d}#1`]);
        possible.forEach((x) => setOf(doubt, c.contractKey).add(x));
        if (possible.length) uncertainIds.add(a.id);
        excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "status-nd", label: "statut non renseigné : non comptée", uncertain: possible.length });
        continue;
      }
      const s = absenceSlots({ start: { date: sd, moment: a.start.moment }, end: { date: ed, moment: a.end.moment } }, clip, params.dayBasis);
      const u = setOf(union, c.contractKey);
      const added = s.slots.filter((x) => !u.has(x));
      added.forEach((x) => u.add(x));
      s.uncertain.forEach((x) => setOf(doubt, c.contractKey).add(x));
      if (s.uncertain.length) uncertainIds.add(a.id);
      slices.push({
        absenceId: a.id,
        contractKey: c.contractKey,
        externalId: c.externalId,
        personKey: c.personKey,
        type: a.type,
        status: a.status,
        start: a.start,
        end: a.end,
        from: clip.from,
        to: clip.to,
        half: added.length,
        overlap: s.slots.length - added.length,
        uncertain: s.uncertain.length,
        outsideContract,
        notes: s.notes,
      });
    }
    let num = 0;
    for (const u of union.values()) num += u.size;
    let unresolved = 0;
    for (const [k, d] of doubt) {
      const u = union.get(k) ?? new Set<SlotKey>();
      for (const x of d) if (!u.has(x)) unresolved += 1;
    }
    const qualifiers: string[] = [];
    const overlap = slices.reduce((s, x) => s + x.overlap, 0);
    if (overlap) qualifiers.push(`chevauchement : ${overlap} demi-journée(s) comptée(s) une fois`);
    if (outside) qualifiers.push(`${outside} jour(s) d'absence hors période du contrat non comptés`);
    if (unresolved) qualifiers.push(`≥ : ${unresolved} demi-journée(s) incertaine(s) (absences ${[...uncertainIds].sort().join(", ")})`);
    const noStatus = excluded.filter((x) => x.why === "status-nd").length;
    if (noStatus) qualifiers.push(`${noStatus} absence(s) sans statut non comptée(s)`);
    return { month, kind: unresolved ? "lower_bound" : "exact", ratio: ratio(num, t.half), theoretical: t.contributions, slices, excluded, qualifiers };
  });
}

export function absenteeism(input: KpiInput, w: Window): Absenteeism {
  return memo(input, `abs-w:${w.from}:${w.to}`, () => {
    const g = checkWindow(input.data, w);
    if (g) return { kind: "nd", nd: g, months: [] };
    const guard = absenceGuard(input);
    if (guard) return { kind: "nd", nd: guard, months: [] };
    const months = w.months.map((m) => absenteeismMonth(input, m));
    const nds = months.filter((m): m is Extract<AbsenteeismMonth, { kind: "nd" }> => m.kind === "nd");
    if (nds.length) {
      const allLower = nds.every((m) => m.nd.code === "month-lower-bound");
      const list = nds.map((m) => m.month);
      return { kind: "nd", months, nd: kpiNd(allLower ? "month-lower-bound" : "month-nd", `n.d. : ${monthRanges(list)} — ${nds[0].month} : ${nds[0].nd.reason}`, { months: list }) };
    }
    const exact = months as Extract<AbsenteeismMonth, { kind: "exact" | "lower_bound" }>[];
    const num = exact.reduce((s, m) => s + m.ratio.num, 0);
    const den = exact.reduce((s, m) => s + m.ratio.den, 0);
    const lower = exact.filter((m) => m.kind === "lower_bound");
    const qualifiers = lower.length ? [`mois en borne basse : ${monthRanges(lower.map((m) => m.month))}`] : [];
    return { kind: lower.length ? "lower_bound" : "exact", ratio: ratio(num, den), months, qualifiers };
  });
}

// Types présents dans la lecture (avec leur nombre) et types choisis absents de la lecture.
export function absenceTypeChoices(input: KpiInput): AbsenceTypeChoice[] {
  const counts = new Map<string, number>();
  if (input.absences.status === "read") for (const a of input.absences.rows) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  const types = new Set([...counts.keys(), ...input.params.absenceTypes]);
  return [...types].sort().map((type) => ({ type, count: counts.get(type) ?? 0, chosen: input.params.absenceTypes.includes(type), inRead: counts.has(type) }));
}
