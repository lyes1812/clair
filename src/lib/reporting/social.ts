import { publicReason } from "@/lib/croisee/public";
import { formatDate, monthEnd } from "@/lib/dates";
import type { PayrollContext } from "@/lib/payroll/context";
import { monthPayroll, windowPayroll, type JournalInput, type MonthPayroll, type PayrollWindow } from "@/lib/payroll/engine";
import { classify, gridRubrics } from "@/lib/payroll/grid";
import { coverageAt, gateAt, headcountAt } from "@/lib/rh/headcount";
import { absenteeism, absenteeismMonth } from "@/lib/rh/kpi/absence";
import { etpAverage } from "@/lib/rh/kpi/average";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { fmtFixed } from "@/lib/rh/kpi/format";
import { civilWindow, closedMonths, countedOpts, defaultYear, lastClosedMonth, previousWindow, rollingWindow, selectableYears } from "@/lib/rh/kpi/period";
import { monthMovements, turnover, turnoverPopulationLabel, windowMovements } from "@/lib/rh/kpi/turnover";
import type { Window } from "@/lib/rh/kpi/types";
import { euros } from "@/lib/viz/masse";
import { averageTile, etpTile, headcountTile, kpiRefusal, rateTile, SYNTHESE_TERMS, type TileValue } from "@/lib/viz/synthese";

// Adaptateur pur : les mêmes moteurs et formateurs que la Synthèse du Studio RH. Aucun chargement, aucune écriture,
// aucun indicateur juridique. Seuls des agrégats sérialisables quittent ce module pour l'écran et son impression.
export type SocialSearch = Record<string, string | string[] | undefined>;
export type SocialParams = { mode: string; fin: string; annee: string };
export function paramsTyped(raw: SocialSearch): SocialParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return { mode: one(raw.mode), fin: one(raw.fin), annee: one(raw.annee) };
}
export type SocialCell = TileValue & { qualifiers: string[]; cents?: number };
export type SocialMetric = {
  id: string; label: string; term: string; unit: "number" | "etp" | "rate" | "money";
  period: string; current: SocialCell; previous: SocialCell;
  population?: string;
};
export type SocialRow = {
  month: string; coverage: SocialCell; headcount: SocialCell; etp: SocialCell; entries: SocialCell;
  exits: SocialCell; absenteeism: SocialCell; brut: SocialCell; cotisations: SocialCell; masse: SocialCell;
};
export type SocialReport = {
  kind: "ready" | "no-period";
  selection: { mode: "civil" | "glissant"; fin: string; year: number; closed: string[]; years: { year: number; closed: boolean }[] };
  window: Window | null; previousWindow: Window | null;
  source: { kind: "payfit" | "dsn" | null; referenceDate: string | null; readAt: string | null; payrollKind: "payfit" | null; payrollReadAt: string | null; changedAt: string | null };
  notices: string[]; limits: string[]; metrics: SocialMetric[]; rows: SocialRow[];
  // Qualification globale de comparabilité ; false ne retire aucune cellule N-1 connue, notamment celle du journal de paie.
  previous: { available: boolean; reason: string | null };
};

type Result = { kind: "exact" | "lower_bound" | "nd"; qualifiers?: string[] };
const nf = new Intl.NumberFormat("fr-FR");
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const abs = (n: bigint) => n < 0n ? -n : n;
const UNSAFE = "montants de source hors de la capacité de calcul sûre en centimes ; aucun montant arrondi n'est publié";
const RAW_HISTORY = "Historique PayFit brut : contrats archivés non renvoyés sur cette période ; voir Vigilance.";

// Borne de sûreté, sans refaire le classement métier ni les totaux du moteur. Si la somme des valeurs absolues des
// entrées dépasse les entiers sûrs, l'exactitude des additions Number n'est plus garantie : le rapport refuse le montant.
function moneySafe(journal: JournalInput, months: string[]): boolean {
  const wanted = new Set(months);
  const rubrics = gridRubrics(journal.grid);
  let bound = 0n;
  for (const line of journal.lines) {
    if (!wanted.has(line.month) || !classify(line.accountId, rubrics).rubric) continue;
    for (const value of [line.debitCents, line.creditCents]) {
      if (value === null) continue;
      if (!Number.isSafeInteger(value)) return false;
      bound += abs(BigInt(value));
      if (bound > MAX) return false;
    }
  }
  return true;
}

// publicReason retire déjà les listes nominatives des moteurs RH. Le filet complémentaire retire les clés de lignes
// comptables ainsi que les noms/identifiants connus qui figureraient dans une raison inhabituelle. Aucun détail brut ne sort.
function reasonFilter(ctx: PayrollContext): (s: string) => string {
  const tokens = new Set<string>();
  const add = (s: string | null | undefined) => { if (s && s.length >= 2) tokens.add(s); };
  const data = ctx.kpi.input?.data ?? ctx.kpi.collab.data;
  for (const p of data?.persons ?? []) {
    for (const s of [p.personKey, p.externalId, p.familyName, p.givenNames, p.usageName, p.employeeNumber]) add(s);
    for (const s of (p.givenNames ?? "").split(/\s+/)) add(s);
  }
  for (const c of data?.contracts ?? []) for (const s of [c.contractKey, c.externalId, c.personKey, c.establishmentId]) add(s);
  for (const c of data?.coverage ?? []) add(c.establishmentId);
  if (ctx.kpi.input?.absences.status === "read") for (const a of ctx.kpi.input.absences.rows) { add(a.id); add(a.contractId); }
  const escaped = [...tokens].filter((s) => !/^\d{4}(?:-\d{2})?$/.test(s)).sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const known = escaped.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "giu") : null;
  return (s) => {
    const text = publicReason(s).replace(/ligne .+? du compte (\d+) sans montant/g, "ligne comptable du compte $1 sans montant")
      .replace(/\b[123478]\s?\d{2}\s?\d{2}\s?(?:\d{2}|2[AB])\s?\d{3}\s?\d{3}(?:\s?\d{2})?\b/gi, "[identifiant masqué]")
      .replace(/\b\d{13,15}\b/g, "[identifiant masqué]");
    return known ? text.replace(known, "[identifiant masqué]") : text;
  };
}

export function socialReportOf(ctx: PayrollContext, raw: SocialSearch): SocialReport {
  const clean = reasonFilter(ctx);
  const nd = (reason: string): SocialCell => ({ text: "n.d.", kind: "nd", reason: clean(reason), qualifiers: [] });
  const cell = (value: TileValue, qualifiers: string[] = []): SocialCell => ({ ...value, reason: value.reason === null ? null : clean(value.reason), qualifiers: [...new Set(qualifiers.map(clean))] });
  const fromResult = (r: Result, value: TileValue): SocialCell => cell(value, r.qualifiers);
  const count = (r: { kind: "exact" | "lower_bound"; value: number; qualifiers?: string[] } | { kind: "nd"; nd: { reason: string } }): SocialCell =>
    r.kind === "nd" ? nd(r.nd.reason) : cell({ text: `${r.kind === "lower_bound" ? "≥ " : ""}${nf.format(r.value)}`, kind: r.kind === "lower_bound" ? "lower" : "value", reason: null }, r.qualifiers ?? (r.kind === "lower_bound" ? ["borne basse : au moins les mouvements connus"] : []));
  const kpi = ctx.kpi;
  const d = kpi.input?.data ?? kpi.collab.data;
  const why = kpiRefusal({ chosen: Boolean(kpi.collab.chosen), sourceReason: kpi.collab.source.reason,
    unavailable: kpi.collab.state?.kind === "unavailable" ? kpi.collab.state.reason : null,
    hasInput: Boolean(kpi.input), invalid: kpi.settings.invalid });
  const input = why === null ? kpi.input : null;
  const rhClosed = kpi.input ? closedMonths(kpi.input.data, kpi.input.openMonths ?? []) : [];
  const payClosed = ctx.input ? ctx.input.months.filter((m) => !ctx.input!.openMonths.includes(m) && monthPayroll(ctx.input!, m).kind === "value").sort() : [];
  const closed = [...new Set([...rhClosed, ...payClosed])].sort();
  const last = payClosed.at(-1) ?? (kpi.input ? lastClosedMonth(kpi.input.data, kpi.input.openMonths ?? []) : null) ?? "";
  const years = kpi.input ? selectableYears(kpi.input.data, kpi.input.openMonths ?? []) : [...new Set(closed.map((m) => Number(m.slice(0, 4))))].map((year) => ({ year, closed: closed.includes(`${year}-12`) }));
  const p = paramsTyped(raw);
  const notices: string[] = [];
  // Ne recopier aucune valeur libre de l'URL dans ce rapport partageable (elle pourrait contenir un nom ou identifiant).
  const ignored = (name: string) => notices.push(`paramètre ${name} ignoré : valeur hors des choix proposés`);
  const mode: "civil" | "glissant" = p.mode === "civil" ? "civil" : "glissant";
  if (p.mode && p.mode !== "civil" && p.mode !== "glissant") ignored("mode");
  const fin = closed.includes(p.fin) ? p.fin : last;
  if (p.fin && p.fin !== fin) ignored("fin");
  const fallbackYear = kpi.input ? defaultYear(kpi.input.data, kpi.input.openMonths ?? []) : years.filter((y) => y.closed).at(-1)?.year ?? years.at(-1)?.year;
  const year = years.some((y) => String(y.year) === p.annee) ? Number(p.annee) : fallbackYear ?? 0;
  if (p.annee && p.annee !== String(year)) ignored("annee");
  const inputs = kpi.collab.data?.build.inputs;
  const readAt = inputs?.source === "payfit" ? inputs.startedAt : inputs?.source === "dsn" ? inputs.syncs.flatMap((s) => s.decidedAt ? [s.decidedAt] : []).sort().at(-1) ?? null : null;
  const source: SocialReport["source"] = { kind: kpi.collab.chosen, referenceDate: d?.build.referenceDate ?? null, readAt,
    payrollKind: ctx.input ? "payfit" : null, payrollReadAt: ctx.input && ctx.read ? ctx.read.startedAt.toISOString() : null,
    changedAt: kpi.collab.switchedAt?.toISOString() ?? null };
  const payrollWhy = ctx.unavailable ?? (ctx.source === "dsn" ? "source RH retenue : DSN ; journal de paie PayFit non lu, masse chargée non reconstituée" : "journal de paie indisponible");
  const limits = [...ctx.etpQualifiers];
  const history = d?.build.source === "payfit" && kpi.collab.payfitHistory?.mode === "raw" ? kpi.collab.payfitHistory : null;
  // Même avertissement que Collaborateurs/PayfitHistoryText : la limite vient du contexte, calculée avant
  // rawPayfitHistory par payfitHistoryLimit. Ne jamais la redéduire des mois que le mode brut a rendus « complets ».
  if (history) {
    limits.push(`Données telles que remontées par l'API PayFit (lecture du ${formatDate(d!.build.referenceDate)}). Paramètre : historique PayFit brut.`);
    if (history.limit) {
      const h = history.limit;
      limits.push(`Pour les mois ${h.lowerFrom} → ${h.lowerTo}${h.exactFrom ? ` (avant le ${formatDate(h.exactFrom)})` : ""}, les contrats archivés depuis plus de 12 mois ne sont pas renvoyés : effectifs, ETP et sorties peuvent être sous-estimés ; entrées, turnover et absentéisme faussés dans un sens ou dans l'autre. Cette limite concerne aussi N-1 lorsque sa période recoupe ces mois.`);
    } else limits.push("Aucun mois de la lecture n'est antérieur à la limite de conservation des contrats archivés.");
  }
  if (why) limits.push(why);
  if (!ctx.input) limits.push(payrollWhy);
  if (kpi.collab.switchedAt) limits.push("source RH changée : aucune comparaison entre PayFit et DSN");
  const base = { selection: { mode, fin, year, closed, years }, source, notices, limits: [...new Set(limits.map(clean))] };
  if (!last) return { ...base, kind: "no-period", window: null, previousWindow: null, metrics: [], rows: [], previous: { available: false, reason: "aucun mois clos disponible" } };
  const w = mode === "civil" ? civilWindow(year) : rollingWindow(fin);
  const prev = previousWindow(w);
  const archive = history?.limit;
  const rawMonth = (month: string): boolean => Boolean(archive && month >= archive.lowerFrom && month <= archive.lowerTo);
  // Le helper référentiel distingue la date d'effectif complet des mois dont les mouvements restent limités.
  const rawStock = (month: string): boolean => rawMonth(month) && (!archive?.exactFrom || monthEnd(month) < archive.exactFrom);
  const qualify = (value: SocialCell, affected: boolean): SocialCell => affected && value.kind !== "nd"
    ? { ...value, qualifiers: [...new Set([...value.qualifiers, RAW_HISTORY])] } : value;
  const unavailable = why ?? "référentiel RH indisponible";
  const money = (value: MonthPayroll | PayrollWindow | null, field: "brut" | "cotisations" | "masse", months: string[]): SocialCell => {
    if (!value || !ctx.input) return nd(payrollWhy);
    if (value.kind === "nd") return nd(value.nd.reason);
    if (!moneySafe(ctx.input, months) || !Number.isSafeInteger(value[field])) return nd(UNSAFE);
    // Le formateur monétaire commun divise par 100 (Number). Ne pas publier un centime modifié à la borne de précision.
    if (euros(value[field]) !== `${fmtFixed({ num: value[field], den: 100 })}\u00a0€`) return nd(UNSAFE);
    const open = "openMonths" in value ? value.openMonths : value.open ? months : [];
    return { ...cell({ text: euros(value[field]), kind: "value", reason: null }, open.length ? [`montants provisoires : paie non clôturée (${open.join(", ")})`] : []), cents: value[field] };
  };
  const rh = (period: Window) => {
    if (!input) return { headcount: nd(unavailable), etp: nd(unavailable), average: nd(unavailable), entries: nd(unavailable), exits: nd(unavailable), turnover: nd(unavailable), absenteeism: nd(unavailable) };
    const h = headcountAt(input.data, monthEnd(period.to), countedOpts(input));
    const e = etpMonthEnd(input, period.to);
    const a = etpAverage(input, period);
    const mv = windowMovements(input, period);
    const t = turnover(input, period);
    const ab = absenteeism(input, period);
    const stock = rawStock(period.to);
    const flows = period.months.some(rawMonth);
    return { headcount: qualify(fromResult(h, headcountTile(h)), stock), etp: qualify(fromResult(e, etpTile(e)), stock),
      average: qualify(fromResult(a, averageTile(a)), period.months.some(rawStock)),
      entries: qualify(count(mv.entries), flows), exits: qualify(count(mv.exits), flows),
      turnover: qualify(fromResult(t, rateTile(t)), flows), absenteeism: qualify(fromResult(ab, rateTile(ab)), flows) };
  };
  const curRh = rh(w);
  const prevRh = rh(prev);
  const curPay = ctx.input ? windowPayroll(ctx.input, w.months) : null;
  const prevPay = ctx.input ? windowPayroll(ctx.input, prev.months) : null;
  if ([curPay, prevPay].some((p) => p?.months.some((m) => m.kind === "value" && m.unclassified.length)))
    base.limits.push("des comptes de charges de personnel ne sont pas classés dans la grille de l'espace : ils restent hors masse salariale, comme dans le module Masse salariale");
  const metrics: SocialMetric[] = [];
  const metric = (id: string, label: string, term: string, unit: SocialMetric["unit"], period: string, current: SocialCell, previous: SocialCell, population?: string) => metrics.push({ id, label, term, unit, period, current, previous, ...(population ? { population } : {}) });
  metric("effectif", "Effectif (personnes)", SYNTHESE_TERMS.effectif, "number", `fin ${w.to}`, curRh.headcount, prevRh.headcount);
  metric("etp-fin", "ETP contractuel", SYNTHESE_TERMS.etpFin, "etp", `fin ${w.to}`, curRh.etp, prevRh.etp);
  metric("etp-moyen", "ETP moyen", SYNTHESE_TERMS.etpMoyen, "etp", w.label, curRh.average, prevRh.average);
  metric("entrees", "Entrées comptées", "movements", "number", w.label, curRh.entries, prevRh.entries);
  metric("sorties", "Sorties comptées", "movements", "number", w.label, curRh.exits, prevRh.exits);
  metric("turnover", "Turnover", SYNTHESE_TERMS.turnover, "rate", w.label, curRh.turnover, prevRh.turnover, input ? turnoverPopulationLabel(input) : undefined);
  metric("absenteisme", "Absentéisme", SYNTHESE_TERMS.absenteisme, "rate", w.label, curRh.absenteeism, prevRh.absenteeism);
  for (const [id, label, term] of [["brut", "Brut", "brut"], ["cotisations", "Cotisations et taxes", "cotisations"], ["masse", "Masse salariale chargée", SYNTHESE_TERMS.masse]] as const)
    metric(id, label, term, "money", w.label, money(curPay, id, w.months), money(prevPay, id, prev.months));
  const coverage = (month: string): SocialCell => {
    if (!input) return nd(unavailable);
    if (input.openMonths?.includes(month)) return nd(`paie non clôturée à la lecture (PayFit) : ${month}`);
    const gate = gateAt(input.data, monthEnd(month));
    if (gate.nd) return nd(gate.nd.reason);
    const lower = coverageAt(input.data, month).filter((c) => c.presenceStatus === "lower_bound");
    if (lower.length) return cell({ text: "borne basse", kind: "lower", reason: null }, lower.flatMap((c) => c.presenceReason ? [c.presenceReason] : []));
    const rawLimit = kpi.collab.payfitHistory?.mode === "raw" ? kpi.collab.payfitHistory.limit : null;
    return qualify(cell({ text: rawLimit && month >= rawLimit.lowerFrom && month <= rawLimit.lowerTo ? "brut (API PayFit)" : "complet", kind: "value", reason: null }), rawMonth(month));
  };
  const rows = w.months.map((month): SocialRow => {
    const mv = input ? monthMovements(input, month) : null;
    const h = input ? headcountAt(input.data, monthEnd(month), countedOpts(input)) : null;
    const e = input ? etpMonthEnd(input, month) : null;
    const a = input ? absenteeismMonth(input, month) : null;
    const pay = ctx.input ? monthPayroll(ctx.input, month) : null;
    return { month, coverage: coverage(month), headcount: h ? qualify(fromResult(h, headcountTile(h)), rawStock(month)) : nd(unavailable),
      etp: e ? qualify(fromResult(e, etpTile(e)), rawStock(month)) : nd(unavailable),
      entries: mv ? qualify(count(mv.entries), rawMonth(month)) : nd(unavailable), exits: mv ? qualify(count(mv.exits), rawMonth(month)) : nd(unavailable),
      absenteeism: a ? qualify(fromResult(a, rateTile(a)), rawMonth(month)) : nd(unavailable),
      brut: money(pay, "brut", [month]), cotisations: money(pay, "cotisations", [month]), masse: money(pay, "masse", [month]) };
  });
  const missingPrev = metrics.filter((m) => m.previous.kind !== "value");
  const previousRaw = prev.months.some(rawMonth);
  return { ...base, kind: "ready", window: w, previousWindow: prev, metrics, rows,
    previous: { available: missingPrev.length === 0 && !previousRaw, reason: previousRaw
      ? "N-1 en historique PayFit brut : couverture des contrats archivés limitée ; chiffres conservés tels que renvoyés par l'API"
      : missingPrev.length ? "N-1 incomplet ou non comparable : consulter les raisons et bornes basses de chaque indicateur" : null } };
}
