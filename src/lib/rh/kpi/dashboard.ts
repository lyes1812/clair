import { addMonths, monthEnd } from "@/lib/dates";
import { coverageAt, headcountAt } from "@/lib/rh/headcount";
import { absenteeism, absenteeismMonth, absenceTypeChoices, theoreticalMonth, theoreticalWindow } from "./absence";
import { etpAverage, headcountAverage } from "./average";
import { compareWindows, etpValue } from "./compare";
import { etpMonthEnd } from "./etp";
import { countedOpts, lastClosedMonth, monthWindow, previousWindow } from "./period";
import { monthMovements, turnover } from "./turnover";
import type { EtpMonthEnd, KpiDashboard, KpiDetail, KpiDetailId, KpiInput, KpiRow, Window } from "./types";

// Assemblage de l'écran KPI RH : tuiles (valeur, N-1, écart), une ligne par mois de la fenêtre, types d'absence.
export function kpiDashboard(input: KpiInput, w: Window): KpiDashboard {
  const opts = countedOpts(input);
  const rows: KpiRow[] = w.months.map((M) => {
    const prev = addMonths(M, -12);
    return {
      month: M,
      coverage: coverageAt(input.data, M, input.scope.establishments),
      headcount: headcountAt(input.data, monthEnd(M), opts),
      etp: etpMonthEnd(input, M),
      movements: monthMovements(input, M),
      theoretical: theoreticalMonth(input, M),
      absenteeism: absenteeismMonth(input, M),
      previous: { month: prev, etp: etpMonthEnd(input, prev), absenteeism: absenteeismMonth(input, prev) },
    };
  });
  return {
    closedMonth: lastClosedMonth(input.data),
    window: w,
    previousWindow: previousWindow(w),
    params: input.params,
    scope: input.scope,
    tiles: {
      etpEnd: compareWindows<EtpMonthEnd>(input, monthWindow(w.to), (i, mw) => etpMonthEnd(i, mw.to), etpValue, "etp"),
      etpAverage: compareWindows(input, w, etpAverage, (a) => a.ratio, "etp"),
      headcountAverage: compareWindows(input, w, headcountAverage, (a) => a.ratio, "persons"),
      turnover: compareWindows(input, w, turnover, (t) => t.ratio, "points"),
      absenteeism: compareWindows(input, w, absenteeism, (a) => a.ratio, "points"),
    },
    rows,
    theoretical: theoreticalWindow(input, w),
    absenceTypes: absenceTypeChoices(input),
  };
}

export const KPI_DETAIL_IDS: KpiDetailId[] = ["etp-end", "headcount", "entries", "exits", "theoretical", "absenteeism", "etp-avg", "headcount-avg", "turnover"];

// Détail d'un chiffre cliqué : ce qui a été compté, ce qui a été exclu, avec la raison. null si l'identifiant ou le mois est invalide.
export function kpiDetail(input: KpiInput, w: Window, id: KpiDetailId, month: string | null): KpiDetail | null {
  if (id === "etp-avg" || id === "headcount-avg") return { id, window: w, value: id === "etp-avg" ? etpAverage(input, w) : headcountAverage(input, w) };
  if (id === "turnover") return { id, window: w, value: turnover(input, w) };
  if (id === "absenteeism" && month === null) return { id: "absenteeism-window", month: null, window: w, value: absenteeism(input, w), theoretical: theoreticalWindow(input, w) };
  if (month === null) return null;
  const allowed = new Set([...w.months, ...w.months.map((m) => addMonths(m, -12))]);
  if (!allowed.has(month)) return null;
  if (id === "etp-end") return { id, month, value: etpMonthEnd(input, month) };
  if (id === "headcount") return { id, month, value: headcountAt(input.data, monthEnd(month), countedOpts(input)) };
  if (id === "entries" || id === "exits") return { id, month, value: monthMovements(input, month) };
  if (id === "theoretical" || id === "absenteeism") return { id, month, value: absenteeismMonth(input, month), theoretical: theoreticalMonth(input, month) };
  return null;
}
