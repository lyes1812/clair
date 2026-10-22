import { addMonths, formatMonth, monthEnd, monthsBetween } from "@/lib/dates";
import type { HeadcountOpts } from "@/lib/rh/headcount";
import type { RhBuildData } from "@/lib/rh/referential/types";
import { kpiNd, type KpiInput, type KpiNd, type Window } from "./types";

// Mois clos et fenêtres : un mois est clos si son dernier jour est antérieur ou égal à la date de référence. Aucune horloge.
const lower = (month: string) => formatMonth(month).toLowerCase();

// open : mois dont la paie n'est pas clôturée à la lecture (PayFit) ; ils ne sont pas clos même si leur dernier jour est passé.
export function closedMonths(data: RhBuildData, open: string[] = []): string[] {
  const { referenceDate: ref, presenceFrom, presenceTo } = data.build;
  if (!ref || !presenceFrom || !presenceTo) return [];
  return monthsBetween(presenceFrom, presenceTo).filter((m) => monthEnd(m) <= ref && !open.includes(m));
}

// Dernier mois clos retenu par défaut. DSN : le dernier mois clos complet pour tous les établissements connus (un
// établissement qui dépose plus tôt que les autres ne fait pas avancer la fenêtre par défaut sur un mois incomplet).
export function lastClosedMonth(data: RhBuildData, open: string[] = []): string | null {
  const closed = closedMonths(data, open);
  if (data.build.source !== "dsn") return closed.at(-1) ?? null;
  for (let i = closed.length - 1; i >= 0; i--) {
    const cov = data.coverage.filter((c) => c.month === closed[i]);
    if (cov.length && cov.every((c) => c.presenceStatus === "complete")) return closed[i];
  }
  return closed.at(-1) ?? null;
}

export function monthWindow(month: string): Window {
  return { mode: "month", from: month, to: month, months: [month], label: `fin ${lower(month)}` };
}

export function rollingWindow(end: string): Window {
  const from = addMonths(end, -11);
  return { mode: "rolling", from, to: end, months: monthsBetween(from, end), label: `12 mois glissants : ${lower(from)} → ${lower(end)}` };
}

export function civilWindow(year: number): Window {
  return { mode: "civil", from: `${year}-01`, to: `${year}-12`, months: monthsBetween(`${year}-01`, `${year}-12`), label: `année civile ${year}` };
}

export function previousWindow(w: Window): Window {
  if (w.mode === "month") return monthWindow(addMonths(w.to, -12));
  if (w.mode === "civil") return civilWindow(Number(w.from.slice(0, 4)) - 1);
  return rollingWindow(addMonths(w.to, -12));
}

export function checkWindow(data: RhBuildData, w: Window, open: string[] = []): KpiNd | null {
  const unpaid = w.months.filter((m) => open.includes(m));
  if (unpaid.length) return kpiNd("period-not-closed", `paie non clôturée à la lecture (PayFit) : ${unpaid.join(", ")} n'est pas clos`, { months: unpaid });
  const last = lastClosedMonth(data);
  if (!last) return kpiNd("month-not-covered", "aucun mois clos dans la source retenue");
  if (w.to > last) {
    const ref = data.build.referenceDate!;
    return kpiNd("period-not-closed", `période non close à la date de référence (${ref.slice(8, 10)}/${ref.slice(5, 7)}/${ref.slice(0, 4)}) : ${w.to} n'est pas clos`);
  }
  return null;
}

export function selectableYears(data: RhBuildData, open: string[] = []): { year: number; closed: boolean }[] {
  const { referenceDate: ref, presenceFrom, presenceTo } = data.build;
  if (!ref || !presenceFrom || !presenceTo) return [];
  const out: { year: number; closed: boolean }[] = [];
  for (let y = Number(presenceFrom.slice(0, 4)); y <= Number(presenceTo.slice(0, 4)); y++) out.push({ year: y, closed: monthEnd(`${y}-12`) <= ref && !open.includes(`${y}-12`) });
  return out;
}

// Dernière année civile close ; à défaut, l'année du dernier mois clos.
export function defaultYear(data: RhBuildData, open: string[] = []): number | null {
  const closed = selectableYears(data, open).filter((y) => y.closed);
  if (closed.length) return closed[closed.length - 1].year;
  const last = lastClosedMonth(data, open);
  return last ? Number(last.slice(0, 4)) : null;
}

export function countedOpts(input: KpiInput): HeadcountOpts {
  return { natures: input.scope.nature ? [input.scope.nature] : input.params.natures, establishments: input.scope.establishments };
}
