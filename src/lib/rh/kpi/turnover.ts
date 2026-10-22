import { addDays, formatDate, monthStart } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { headcountAt, monthlyList, monthRanges, type Count, type EventRow } from "@/lib/rh/headcount";
import { headcountAverage } from "./average";
import { ratio } from "./fraction";
import { memo } from "./memo";
import { checkWindow, countedOpts } from "./period";
import { kpiNd, type EventContribution, type KpiInput, type MonthMovements, type Turnover, type Window } from "./types";

// Mouvements d'un mois après les règles du turnover (natures, date de référence, contrats continus, natures de sortie exclues).
export function monthMovements(input: KpiInput, month: string): MonthMovements {
  return memo(input, `mv:${month}`, () => {
    const { data, params, scope } = input;
    const opts = countedOpts(input);
    const ml = monthlyList(data, month, opts);
    const ref = data.build.referenceDate;
    const inEst = (id: string | null) => !scope.establishments || (id !== null && scope.establishments.includes(id));
    const partnerOf = (r: EventRow) => {
      const e = r.event;
      if (!e.personKey || !e.flags.includes("continuity_same_person")) return null;
      const want = e.kind === "exit" ? { kind: "entry", date: addDays(e.date, 1) } : { kind: "exit", date: addDays(e.date, -1) };
      const p = data.events.find((x) => x.kind === want.kind && x.date === want.date && x.personKey === e.personKey && x.flags.includes("continuity_same_person"));
      return p ? { event: p, counted: p.nature !== null && opts.natures.includes(p.nature) && inEst(p.establishmentId) } : null;
    };
    const events: EventContribution[] = [...ml.entries, ...ml.exits].map((r) => {
      const partner = partnerOf(r);
      const p = partner ? { contractKey: partner.event.contractKey, date: partner.event.date } : null;
      if (!r.inScope) return { row: r, why: "out-of-scope", label: "hors natures comptées", partner: p };
      if (ref && r.event.date > ref) return { row: r, why: "future", label: "postérieur à la date de référence", partner: p };
      if (params.neutralizeContinuity && partner?.counted) {
        return { row: r, why: "neutralized", label: `contrat continu neutralisé (avec ${partner.event.contractKey.split(":")[1] ?? partner.event.contractKey} le ${formatDate(partner.event.date)})`, partner: p };
      }
      if (r.event.kind === "exit" && r.event.nature !== null && params.excludedExitNatures.includes(r.event.nature)) {
        return { row: r, why: "excluded-nature", label: `sortie exclue : nature ${contractNatureLabel(r.event.nature)} (Paramètres)`, partner: p };
      }
      return { row: r, why: "counted", label: "compté", partner: p };
    });
    const count = (c: Count, kind: "entry" | "exit"): Count =>
      c.kind === "nd" ? c : { kind: c.kind, value: events.filter((x) => x.why === "counted" && x.row.event.kind === kind).length, qualifiers: c.qualifiers };
    return { month, entries: count(ml.entriesCount, "entry"), exits: count(ml.exitsCount, "exit"), events };
  });
}

// Turnover d'une période close : ((E + S) ÷ 2) ÷ effectif moyen, ou S ÷ effectif au premier jour (Paramètres).
export function turnover(input: KpiInput, w: Window): Turnover {
  return memo(input, `to:${w.from}:${w.to}`, () => {
    const formula = input.params.turnoverFormula;
    const g = checkWindow(input.data, w);
    if (g) return { kind: "nd", formula, nd: g, months: [] };
    const months = w.months.map((m) => monthMovements(input, m));
    const ndMonths = months.filter((m) => m.entries.kind === "nd" || m.exits.kind === "nd");
    if (ndMonths.length) {
      const first = ndMonths[0];
      const which = first.exits.kind === "nd" ? first.exits : first.entries;
      const label = first.exits.kind === "nd" ? "sorties" : "entrées";
      const reason = which.kind === "nd" ? which.nd.reason : "n.d.";
      return { kind: "nd", formula, months, nd: kpiNd("month-nd", `${monthRanges(ndMonths.map((m) => m.month))} : ${label} n.d. — ${reason}`, { months: ndMonths.map((m) => m.month) }) };
    }
    const lowMonths = months.filter((m) => m.entries.kind === "lower_bound" || m.exits.kind === "lower_bound");
    if (lowMonths.length) {
      const first = lowMonths[0];
      const q = (first.entries.kind === "lower_bound" ? first.entries.qualifiers : first.exits.kind === "lower_bound" ? first.exits.qualifiers : [])[0];
      return { kind: "nd", formula, months, nd: kpiNd("month-lower-bound", `${monthRanges(lowMonths.map((m) => m.month))} : mouvements en borne basse${q ? ` (${q})` : ""}`, { months: lowMonths.map((m) => m.month) }) };
    }
    const E = months.reduce((s, m) => s + (m.entries.kind === "nd" ? 0 : m.entries.value), 0);
    const S = months.reduce((s, m) => s + (m.exits.kind === "nd" ? 0 : m.exits.value), 0);
    const neutralized = months.flatMap((m) => m.events).filter((e) => e.why === "neutralized").length;
    const excluded = months.flatMap((m) => m.events).filter((e) => e.why === "excluded-nature");
    const qualifiers = ["entrées et sorties en contrats, effectif en personnes"];
    if (neutralized) qualifiers.push(`${neutralized} mouvement(s) de contrats continus neutralisé(s)`);
    if (excluded.length) qualifiers.push(`${excluded.length} sortie(s) exclue(s) : natures ${[...new Set(excluded.map((e) => e.row.event.nature))].join(", ")}`);
    if (formula === "half_sum") {
      const avg = headcountAverage(input, w);
      if (avg.kind === "nd") return { kind: "nd", formula, months, nd: avg.nd };
      if (avg.ratio.num === 0) return { kind: "nd", formula, months, nd: kpiNd("denominator-zero", "effectif moyen nul sur la période") };
      const n = w.months.length;
      return { kind: "exact", formula, ratio: ratio(n * (E + S), 2 * avg.ratio.num), entries: E, exits: S, base: { kind: "average", average: avg }, months, qualifiers };
    }
    const date = monthStart(w.from);
    const h0 = headcountAt(input.data, date, countedOpts(input));
    if (h0.kind === "nd") return { kind: "nd", formula, months, nd: kpiNd(h0.nd.code, h0.nd.reason) };
    if (h0.kind === "lower_bound") return { kind: "nd", formula, months, nd: kpiNd("month-lower-bound", `effectif au ${formatDate(date)} en borne basse (PayFit)`) };
    if (h0.persons === 0) return { kind: "nd", formula, months, nd: kpiNd("denominator-zero", `effectif nul au ${formatDate(date)}`) };
    return { kind: "exact", formula, ratio: ratio(S, h0.persons), entries: E, exits: S, base: { kind: "start", date, persons: h0.persons, contractKeys: h0.contractKeys }, months, qualifiers };
  });
}
