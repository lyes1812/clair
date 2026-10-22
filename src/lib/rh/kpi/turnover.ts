import { addDays, formatDate, monthStart } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { headcountAt, monthlyList, monthRanges, type Count, type EventRow } from "@/lib/rh/headcount";
import type { EventDraft } from "@/lib/rh/referential/types";
import { headcountAverage } from "./average";
import { ratio } from "./fraction";
import { memo } from "./memo";
import { checkWindow, countedOpts } from "./period";
import { kpiNd, type EventContribution, type KpiInput, type MonthMovements, type Turnover, type Window } from "./types";

const eventKey = (e: EventDraft) => `${e.contractKey}|${e.kind}`;

// Contrats continus : couples « sortie le jour J ↔ entrée le jour J+1 » de la même personne, appariés un pour un (une sortie
// ne neutralise qu'une entrée). L'appariement dépend du référentiel et des natures comptées (Paramètres), jamais des filtres de
// l'écran : pour une sortie, entrée d'une nature comptée d'abord, puis de même nature, puis du même établissement, puis par
// identifiant de contrat. Que le partenaire soit compté dans le périmètre affiché (filtre nature ou établissement) est évalué
// ensuite. Un événement sans partenaire reste un mouvement ordinaire.
function continuityPartners(input: KpiInput): Map<string, { event: EventDraft; counted: boolean }> {
  return memo(input, "continuity", () => {
    const opts = countedOpts(input);
    const est = input.scope.establishments;
    const counted = (e: EventDraft) => e.nature !== null && opts.natures.includes(e.nature) && (!est || (e.establishmentId !== null && est.includes(e.establishmentId)));
    // Entrées marquées « contrat continu » par le référentiel ; sorties candidates : toutes celles de la même personne la veille
    // (le référentiel ne marque qu'une sortie par entrée, qui n'est pas forcément celle d'une nature comptée).
    const entries = input.data.events.filter((e) => e.kind === "entry" && e.personKey !== null && e.flags.includes("continuity_same_person"));
    const eves = new Set(entries.map((e) => `${e.personKey}|${addDays(e.date, -1)}`));
    const natured = (e: EventDraft) => (e.nature !== null && input.params.natures.includes(e.nature) ? 1 : 0);
    const exits = input.data.events
      .filter((e) => e.kind === "exit" && e.personKey !== null && eves.has(`${e.personKey}|${e.date}`))
      .sort((a, b) => a.date.localeCompare(b.date) || natured(b) - natured(a) || a.contractKey.localeCompare(b.contractKey));
    const out = new Map<string, { event: EventDraft; counted: boolean }>();
    for (const x of exits) {
      const next = addDays(x.date, 1);
      const affinity = (e: EventDraft) => 4 * natured(e) + (e.nature !== null && e.nature === x.nature ? 2 : 0) + (e.establishmentId !== null && e.establishmentId === x.establishmentId ? 1 : 0);
      const y = entries
        .filter((e) => !out.has(eventKey(e)) && e.personKey === x.personKey && e.date === next)
        .sort((a, b) => affinity(b) - affinity(a) || a.contractKey.localeCompare(b.contractKey))[0];
      if (!y) continue;
      out.set(eventKey(x), { event: y, counted: counted(y) });
      out.set(eventKey(y), { event: x, counted: counted(x) });
    }
    return out;
  });
}

// Mouvements d'un mois après les règles du turnover (natures, date de référence, contrats continus, natures de sortie exclues).
export function monthMovements(input: KpiInput, month: string): MonthMovements {
  return memo(input, `mv:${month}`, () => {
    const { data, params } = input;
    const opts = countedOpts(input);
    const ml = monthlyList(data, month, opts);
    const ref = data.build.referenceDate;
    const partners = continuityPartners(input);
    const partnerOf = (r: EventRow) => partners.get(eventKey(r.event)) ?? null;
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
