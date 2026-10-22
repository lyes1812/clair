import { monthEnd } from "@/lib/dates";
import { headcountAt, monthRanges } from "@/lib/rh/headcount";
import { etpMonthEnd } from "./etp";
import { ratio } from "./fraction";
import { memo } from "./memo";
import { checkWindow, countedOpts } from "./period";
import { kpiNd, periodReason, type Average, type KpiInput, type MonthValue, type Window } from "./types";

// Moyennes de fin de mois : tous les mois doivent être exacts, sinon n.d. en nommant les mois en cause.
function average(input: KpiInput, w: Window, unit: "etp" | "persons", values: MonthValue[]): Average {
  const nds = values.filter((v) => v.kind === "nd");
  if (nds.length) {
    const months = nds.map((v) => v.month);
    return { kind: "nd", unit, months: values, nd: kpiNd("month-nd", periodReason(months, nds[0].month, nds[0].nd?.reason ?? "valeur absente"), { months }) };
  }
  const lowers = values.filter((v) => v.kind === "lower_bound");
  if (lowers.length) {
    const months = lowers.map((v) => v.month);
    return {
      kind: "nd",
      unit,
      months: values,
      nd: kpiNd("month-lower-bound", `mois en borne basse : ${monthRanges(months)}${lowers[0].qualifiers[0] ? ` (${lowers[0].qualifiers[0]})` : ""} ; la moyenne exige des mois exacts (prorata journalier en V2)`, { months }),
    };
  }
  const sum = values.reduce((s, v) => s + (v.value ?? 0), 0);
  const qualifiers = unit === "etp" && input.data.build.source === "payfit" ? ["quotités à la date de lecture, non historisées par PayFit"] : [];
  return { kind: "exact", unit, ratio: ratio(sum, unit === "etp" ? values.length * 10000 : values.length), months: values, qualifiers };
}

export function etpAverage(input: KpiInput, w: Window): Average {
  return memo(input, `etp-avg:${w.from}:${w.to}`, () => {
    const g = checkWindow(input.data, w);
    if (g) return { kind: "nd", unit: "etp", nd: g, months: [] };
    const values: MonthValue[] = w.months.map((m) => {
      const e = etpMonthEnd(input, m);
      return e.kind === "nd" ? { month: m, kind: "nd", value: null, nd: e.nd, qualifiers: [] } : { month: m, kind: e.kind, value: e.etp4, nd: null, qualifiers: e.qualifiers };
    });
    return average(input, w, "etp", values);
  });
}

export function headcountAverage(input: KpiInput, w: Window): Average {
  return memo(input, `hc-avg:${w.from}:${w.to}`, () => {
    const g = checkWindow(input.data, w);
    if (g) return { kind: "nd", unit: "persons", nd: g, months: [] };
    const opts = countedOpts(input);
    const values: MonthValue[] = w.months.map((m) => {
      const h = headcountAt(input.data, monthEnd(m), opts);
      return h.kind === "nd" ? { month: m, kind: "nd", value: null, nd: kpiNd(h.nd.code, h.nd.reason), qualifiers: [] } : { month: m, kind: h.kind, value: h.persons, nd: null, qualifiers: h.qualifiers };
    });
    return average(input, w, "persons", values);
  });
}
