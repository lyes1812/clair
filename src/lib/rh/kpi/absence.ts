import { formatDate, monthEnd, monthOf, monthStart } from "@/lib/dates";
import { gateAt, monthRanges, natureOfMonth, payfitRetentionLimit } from "@/lib/rh/headcount";
import { PAYFIT_ARCHIVED_RETENTION_MONTHS } from "@/lib/rh/referential/build-payfit";
import { ABSENCE_STATUS_LABELS } from "@/lib/rh/labels";
import type { ContractDraft } from "@/lib/rh/referential/types";
import { absenceSlots, countDays, eachDay, isWeekday } from "./days";
import { ratio } from "./fraction";
import { memo } from "./memo";
import { checkWindow, countedOpts } from "./period";
import {
  kpiNd,
  periodReason,
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
  type TheoreticalWindow,
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
      const nature = c ? natureOfMonth(c, m) : null;
      if (!c || seen.has(c.contractKey) || c.startDate === null || nature === null || !opts.natures.includes(nature)) continue;
      seen.add(c.contractKey);
      const from = max(c.startDate, monthStart(month));
      const to = min(c.endDate ?? monthEnd(month), monthEnd(month));
      const days = countDays(from, to, params.dayBasis);
      contributions.push({ contractKey: c.contractKey, externalId: c.externalId, personKey: c.personKey, establishmentId: c.establishmentId, nature, from, to, days, half: 2 * days, provenance: m.provenance.presentAnyDay ?? null });
    }
    return { month, kind: "exact", half: contributions.reduce((s, x) => s + x.half, 0), contributions };
  });
}

export function theoreticalWindow(input: KpiInput, w: Window): TheoreticalWindow {
  return memo(input, `th-w:${w.from}:${w.to}`, () => {
    const g = checkWindow(input.data, w, input.openMonths);
    if (g) return { kind: "nd", nd: g, months: [] };
    const months = w.months.map((m) => theoreticalMonth(input, m));
    const nds = months.filter((m): m is Extract<TheoreticalMonth, { kind: "nd" }> => m.kind === "nd");
    if (nds.length) return { kind: "nd", months, nd: kpiNd("month-nd", periodReason(nds.map((m) => m.month), nds[0].month, nds[0].nd.reason), { months: nds.map((m) => m.month) }) };
    return { kind: "exact", half: months.reduce((s, m) => s + (m.kind === "exact" ? m.half : 0), 0), months };
  });
}

// Gardes communes au mois et à la période (ordre de la spécification : source, lecture, paramètre).
function absenceGuard(input: KpiInput): KpiNd | null {
  const a = input.absences;
  if (a.status === "not-extracted") return kpiNd("not-extracted", a.nd.reason);
  if (a.status === "unavailable") return kpiNd("absences-unavailable", `absences non lues : ${a.nd.reason}`);
  if (!input.params.absenceTypes.length) return kpiNd("absence-types-unset", "motifs d'absence non choisis (Paramètres › Définitions des KPI)");
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
    const undated: { a: (typeof absences.rows)[number]; contractKey: string; possible: SlotKey[]; known: string; which: string }[] = [];
    const personContracts = new Map<string, ContractDraft[]>();
    for (const k of data.contracts) {
      if (!k.personKey || k.startDate === null || k.nature === null || !opts.natures.includes(k.nature) || !inEst(scope.establishments, k.establishmentId)) continue;
      if (k.startDate > me || (k.endDate !== null && k.endDate < ms)) continue;
      personContracts.set(k.personKey, [...(personContracts.get(k.personKey) ?? []), k]);
    }
    const setOf = (m: Map<string, Set<SlotKey>>, k: string) => {
      let s = m.get(k);
      if (!s) m.set(k, (s = new Set()));
      return s;
    };
    // Demi-journées incertaines, gardées par absence pour que le détail retrace le « ≥ » (après résolution par l'union).
    const doubtOf = new Map<string, { contractKey: string; slot: SlotKey; via: string | null }[]>();
    const addDoubt = (id: string, contractKey: string, slots: SlotKey[], via: string | null = null) => {
      if (!slots.length) return;
      uncertainIds.add(id);
      const list = doubtOf.get(id) ?? [];
      for (const slot of slots) {
        setOf(doubt, contractKey).add(slot);
        list.push({ contractKey, slot, via });
      }
      doubtOf.set(id, list);
    };
    const orphanOf = new Map<string, number>();
    // Demi-journées que l'absence peut couvrir hors de son contrat mais sous un autre contrat compté de la même personne
    // (ex. fin d'un CDD et début d'un CDI pendant l'absence) : au dénominateur de l'autre contrat, non rattachées par PayFit
    // ⇒ incertaines (« ≥ »). Une borne inconnue est remplacée par la borne de l'autre contrat dans le mois ; un contrat sans
    // date de début n'a pas de période connue : tous les jours sous l'autre contrat sont incertains.
    const spillOver = (a: (typeof absences.rows)[number], c: ContractDraft) => {
      if (!c.personKey) return;
      for (const c2 of personContracts.get(c.personKey) ?? []) {
        if (c2.contractKey === c.contractKey) continue;
        const clip2 = { from: max(ms, c2.startDate!), to: min(me, c2.endDate ?? me) };
        const s2 = absenceSlots(
          {
            start: a.start.date === null ? { date: clip2.from, moment: "beginning-of-day" } : { date: a.start.date, moment: a.start.moment },
            end: a.end.date === null ? { date: clip2.to, moment: "end-of-day" } : { date: a.end.date, moment: a.end.moment },
          },
          clip2,
          params.dayBasis,
        );
        const on = [...new Set([...s2.slots, ...s2.uncertain])].filter((x) => {
          const d = x.slice(0, 10);
          return c.startDate === null || d < c.startDate || (c.endDate !== null && d > c.endDate);
        });
        addDoubt(a.id, c2.contractKey, on, c2.externalId);
      }
    };
    // Contrat sans collaborateur : les jours de l'absence hors de sa période (bornes inconnues : tout le mois) peuvent tomber sous
    // un autre contrat compté de la même personne, inconnue ⇒ incertitude (« ≥ »), jamais « non comptés » en exact.
    const orphan = (a: (typeof absences.rows)[number], c: ContractDraft) => {
      if (c.personKey) return;
      const from = a.start.date === null ? ms : max(a.start.date, ms);
      const to = a.end.date === null ? me : min(a.end.date, me);
      const n = eachDay(from, to).filter((d) => (params.dayBasis === "calendar" || isWeekday(d)) && (c.startDate === null || d < c.startDate || (c.endDate !== null && d > c.endDate))).length;
      if (!n) return;
      orphanDays += n;
      orphanOf.set(a.id, n);
      uncertainIds.add(a.id);
    };
    let outside = 0;
    let orphanDays = 0;
    for (const a of absences.rows) {
      const sd = a.start.date;
      const ed = a.end.date;
      const touches = sd === null && ed === null ? true : sd === null ? month <= monthOf(ed!) : ed === null ? month >= monthOf(sd) : sd <= me && ed >= ms;
      if (!touches) continue;
      if (!params.absenceTypes.includes(a.type)) {
        excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "type", label: `motif ${a.type} non retenu`, uncertain: 0 });
        continue;
      }
      if (a.status !== null && !(params.absenceStatuses as string[]).includes(a.status)) {
        excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "status", label: `statut ${ABSENCE_STATUS_LABELS[a.status] ?? a.status} non retenu`, uncertain: 0 });
        continue;
      }
      const c = byExternal.get(a.contractId);
      if (!c) {
        // PayFit ne renvoie plus les contrats archivés depuis plus de 12 mois, mais peut renvoyer leurs absences : une absence
        // terminée avant la limite de conservation, sur un contrat absent de la lecture, n'est pas comptée (son contrat ne
        // l'est pas non plus dans les jours théoriques). Ce cas n'atteint ce point qu'en historique brut : en mode signalé, ces
        // mois sont n.d. plus haut. Ailleurs, un contrat inconnu reste une anomalie : n.d.
        const limit = payfitRetentionLimit(data);
        if (limit !== null && ed !== null && ed < limit) {
          excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "contract-not-returned", label: `contrat ${a.contractId} non renvoyé par PayFit (archivé depuis plus de ${PAYFIT_ARCHIVED_RETENTION_MONTHS} mois) : absence non comptée, comme son contrat dans les jours théoriques`, uncertain: 0 });
          continue;
        }
        return { month, kind: "nd", nd: kpiNd("absence-unknown-contract", `absence ${a.id} rattachée au contrat ${a.contractId} inconnu du référentiel`) };
      }
      spillOver(a, c);
      orphan(a, c);
      if (c.startDate === null || c.nature === null || !opts.natures.includes(c.nature) || !inEst(scope.establishments, c.establishmentId)) {
        // Contrat hors périmètre : l'absence n'est pas comptée (ses éventuels débordements sont incertains, ci-dessus).
        const label = c.startDate === null ? "contrat non positionnable (sans date de début)" : "contrat hors natures comptées ou hors établissement";
        excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "contract-out-of-scope", label, uncertain: 0 });
        continue;
      }
      if (sd === null || ed === null) {
        // Borne inconnue : remplacée par la borne de la période du contrat dans le mois (vide si le contrat n'y est pas actif).
        const reach = { from: max(ms, c.startDate), to: min(me, c.endDate ?? me) };
        const r = absenceSlots(
          {
            start: sd === null ? { date: reach.from, moment: "beginning-of-day" } : { date: sd, moment: a.start.moment },
            end: ed === null ? { date: reach.to, moment: "end-of-day" } : { date: ed, moment: a.end.moment },
          },
          reach,
          params.dayBasis,
        );
        const possible = [...new Set([...r.slots, ...r.uncertain])];
        const known = sd === null && ed === null ? "dates de début et de fin non renseignées" : sd === null ? `date de début non renseignée, fin le ${formatDate(ed)}` : `date de fin non renseignée, début le ${formatDate(sd)}`;
        if (!possible.length) {
          excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "contract-out-of-scope", label: `aucune demi-journée comptée possible dans la période du contrat (${known})`, uncertain: 0 });
          continue;
        }
        if (a.status === null) {
          // Jamais comptée : des dates inconnues ne font qu'élargir ses demi-journées incertaines.
          addDoubt(a.id, c.contractKey, possible);
          excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "status-nd", label: `statut non renseigné : non comptée (${known})`, uncertain: 0 });
          continue;
        }
        // Décidé après la boucle : n.d. seulement si une demi-journée possible n'est pas déjà comptée par une absence datée.
        undated.push({ a, contractKey: c.contractKey, possible, known, which: sd === null && ed === null ? "début et de fin" : sd === null ? "début" : "fin" });
        continue;
      }
      const clip = { from: max(ms, c.startDate), to: min(me, c.endDate ?? me) };
      const inMonth = eachDay(max(sd, ms), min(ed, me)).filter((d) => params.dayBasis === "calendar" || isWeekday(d));
      const outsideContract = inMonth.filter((d) => d < c.startDate! || (c.endDate !== null && d > c.endDate)).length;
      outside += outsideContract;
      if (a.status === null) {
        // Créneaux que l'absence pourrait couvrir, moments compris : comptés comme incertains, jamais comme absents.
        const p = absenceSlots({ start: { date: sd, moment: a.start.moment }, end: { date: ed, moment: a.end.moment } }, clip, params.dayBasis);
        addDoubt(a.id, c.contractKey, [...new Set([...p.slots, ...p.uncertain])]);
        excluded.push({ absenceId: a.id, contractId: a.contractId, type: a.type, status: a.status, why: "status-nd", label: "statut non renseigné : non comptée", uncertain: 0 });
        continue;
      }
      const s = absenceSlots({ start: { date: sd, moment: a.start.moment }, end: { date: ed, moment: a.end.moment } }, clip, params.dayBasis);
      const u = setOf(union, c.contractKey);
      const added = s.slots.filter((x) => !u.has(x));
      added.forEach((x) => u.add(x));
      addDoubt(a.id, c.contractKey, s.uncertain);
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
        uncertain: 0,
        outsideContract,
        notes: [...s.notes],
      });
    }
    for (const x of undated) {
      const u = union.get(x.contractKey) ?? new Set<SlotKey>();
      if (x.possible.some((sl) => !u.has(sl))) return { month, kind: "nd", nd: kpiNd("absence-date-nd", `absence ${x.a.id} : date de ${x.which} non renseignée dans PayFit`) };
      excluded.push({ absenceId: x.a.id, contractId: x.a.contractId, type: x.a.type, status: x.a.status, why: "date-nd-covered", label: `${x.known} : toutes ses demi-journées possibles sur ce contrat sont déjà comptées par d'autres absences`, uncertain: 0 });
    }
    // Trace par absence : demi-journées incertaines restantes après l'union (celles qui font le « ≥ »), débordements et
    // jours hors contrat d'un contrat sans collaborateur.
    // Chaque demi-journée incertaine restante est attribuée à la première absence (ordre de lecture) qui la rend incertaine :
    // la colonne « Incertaines » s'additionne au total « ≥ ».
    const attributed = new Set<string>();
    const traces = new Map<string, { uncertain: number; notes: string[] }>();
    for (const [id, list] of doubtOf) {
      const byVia = new Map<string, { open: number; closed: number }>();
      let open = 0;
      const seen = new Set<string>();
      for (const d of list) {
        const k = `${d.contractKey}|${d.slot}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const isOpen = !(union.get(d.contractKey)?.has(d.slot) ?? false);
        const mine = isOpen && !attributed.has(k);
        if (mine) {
          attributed.add(k);
          open += 1;
        }
        if (d.via) {
          const v = byVia.get(d.via) ?? { open: 0, closed: 0 };
          if (mine) v.open += 1;
          else if (!isOpen) v.closed += 1;
          byVia.set(d.via, v);
        }
      }
      const notes = [...byVia]
        .filter(([, v]) => v.open || v.closed)
        .map(([via, v]) =>
          v.open ? `${v.open} demi-journée(s) incertaine(s) sous le contrat ${via} de la même personne (non rattachées par PayFit)${v.closed ? ` ; ${v.closed} déjà comptée(s) par d'autres absences` : ""}` : `${v.closed} demi-journée(s) sous le contrat ${via} déjà comptée(s) par d'autres absences`,
        );
      traces.set(id, { uncertain: open, notes });
    }
    const traceOf = (id: string): { uncertain: number; notes: string[] } => {
      const t = traces.get(id) ?? { uncertain: 0, notes: [] };
      const o = orphanOf.get(id);
      return { uncertain: t.uncertain, notes: o ? [...t.notes, `${o} jour(s) hors contrat, collaborateur du contrat inconnu : rattachement non vérifiable (« ≥ »)`] : t.notes };
    };
    for (const sl of slices) {
      const tr = traceOf(sl.absenceId);
      sl.uncertain = tr.uncertain;
      sl.notes.push(...tr.notes);
    }
    for (const x of excluded) {
      if (x.why === "type" || x.why === "status") continue;
      const tr = traceOf(x.absenceId);
      x.uncertain = tr.uncertain;
      if (tr.notes.length) x.label = `${x.label} ; ${tr.notes.join(" ; ")}`;
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
    if (orphanDays) qualifiers.push(`≥ : ${orphanDays} jour(s) d'absence hors contrat d'un contrat sans collaborateur (rattachement non vérifiable)`);
    return { month, kind: unresolved || orphanDays ? "lower_bound" : "exact", ratio: ratio(num, t.half), theoretical: t.contributions, slices, excluded, qualifiers };
  });
}

export function absenteeism(input: KpiInput, w: Window): Absenteeism {
  return memo(input, `abs-w:${w.from}:${w.to}`, () => {
    const g = checkWindow(input.data, w, input.openMonths);
    if (g) return { kind: "nd", nd: g, months: [] };
    const guard = absenceGuard(input);
    if (guard) return { kind: "nd", nd: guard, months: [] };
    const months = w.months.map((m) => absenteeismMonth(input, m));
    // Un mois sans aucun contrat compté (0 jour théorique) apporte 0 ÷ 0 à la somme : il ne rend pas la période n.d.
    const empty = (m: AbsenteeismMonth) => m.kind === "nd" && m.nd.code === "denominator-zero";
    const nds = months.filter((m): m is Extract<AbsenteeismMonth, { kind: "nd" }> => m.kind === "nd" && !empty(m));
    if (nds.length) {
      const allLower = nds.every((m) => m.nd.code === "month-lower-bound");
      const list = nds.map((m) => m.month);
      return { kind: "nd", months, nd: kpiNd(allLower ? "month-lower-bound" : "month-nd", periodReason(list, nds[0].month, nds[0].nd.reason), { months: list }) };
    }
    const exact = months.filter((m): m is Extract<AbsenteeismMonth, { kind: "exact" | "lower_bound" }> => m.kind !== "nd");
    const num = exact.reduce((s, m) => s + m.ratio.num, 0);
    const den = exact.reduce((s, m) => s + m.ratio.den, 0);
    if (den === 0) return { kind: "nd", months, nd: kpiNd("denominator-zero", "aucun contrat compté présent sur la période") };
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
