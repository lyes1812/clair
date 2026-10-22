import { addDays, formatDate, monthStart } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { gateAt, headcountAt, monthlyList, monthRanges, payfitExactFrom, type Count, type EventRow } from "@/lib/rh/headcount";
import { nd, type EventDraft } from "@/lib/rh/referential/types";
import { headcountAverage } from "./average";
import { ratio } from "./fraction";
import { memo } from "./memo";
import { checkWindow, countedOpts } from "./period";
import { kpiNd, periodReason, type EventContribution, type KpiInput, type MonthMovements, type MovementTotal, type Turnover, type Window } from "./types";

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

// Contrats continus : le partenaire possible d'un mouvement (la veille d'une entrée, le lendemain d'une sortie) est-il connu ?
// DSN : le mois de ce jour doit être couvert par des déclarations complètes (tous établissements : le contrat suivant peut être
// déclaré par un autre SIRET). PayFit : un contrat terminé avant la date de lecture − 12 mois peut manquer ; les contrats à
// venir sont renvoyés. Sans cette connaissance, neutraliser ou compter serait une supposition.
function neighbourKnown(data: KpiInput["data"], kind: "entry" | "exit", date: string): boolean {
  const day = addDays(date, kind === "entry" ? -1 : 1);
  if (data.build.source === "payfit") {
    if (kind === "exit") return true;
    const from = payfitExactFrom(data);
    return from === null ? !data.coverage.some((c) => c.presenceStatus === "lower_bound") : day >= from;
  }
  const g = gateAt(data, day);
  return g.nd === null && g.coverage.every((c) => c.presenceStatus === "complete");
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
    const externalOf = new Map(data.contracts.map((c) => [c.contractKey, c.externalId]));
    const events: EventContribution[] = [...ml.entries, ...ml.exits].map((r) => {
      const partner = partnerOf(r);
      const p = partner ? { contractKey: partner.event.contractKey, date: partner.event.date } : null;
      if (!r.inScope) return { row: r, why: "out-of-scope", label: "hors natures comptées", partner: p };
      if (ref && r.event.date > ref) return { row: r, why: "future", label: "postérieur à la date de référence", partner: p };
      // Contrat continu : neutralisé seulement si le jour voisin est connu partout (sinon un partenaire mieux apparié pourrait
      // apparaître au dépôt suivant, par exemple dans un autre établissement).
      const known = !params.neutralizeContinuity || r.event.personKey === null || neighbourKnown(data, r.event.kind, r.event.date);
      if (params.neutralizeContinuity && partner?.counted && known) {
        return { row: r, why: "neutralized", label: `contrat continu neutralisé (avec ${externalOf.get(partner.event.contractKey) ?? partner.event.contractKey} le ${formatDate(partner.event.date)})`, partner: p };
      }
      // Sortie de nature exclue : jamais comptée, qu'elle soit continue ou non ⇒ aucune incertitude.
      if (r.event.kind === "exit" && r.event.nature !== null && params.excludedExitNatures.includes(r.event.nature)) {
        return { row: r, why: "excluded-nature", label: `sortie exclue : nature ${contractNatureLabel(r.event.nature)} (Paramètres)`, partner: p };
      }
      if (!known) {
        const day = formatDate(addDays(r.event.date, r.event.kind === "entry" ? -1 : 1));
        return { row: r, why: "continuity-unknown", label: `continuité non vérifiable : le ${day} n'est pas couvert par la source (contrat ${r.event.kind === "entry" ? "précédent" : "suivant"} inconnu)`, partner: p };
      }
      return { row: r, why: "counted", label: "compté", partner: p };
    });
    const count = (c: Count, kind: "entry" | "exit"): Count => {
      if (c.kind === "nd") return c;
      const what = kind === "entry" ? "entrées" : "sorties";
      const unknown = events.filter((x) => x.why === "continuity-unknown" && x.row.event.kind === kind);
      if (unknown.length) {
        const list = unknown.map((x) => `${x.row.contract.externalId} le ${formatDate(x.row.event.date)}`).join(", ");
        return { kind: "nd", nd: nd("coverage-incomplete", `${what} de ${month} : contrats continus non vérifiables (${list}) — jour voisin hors de la couverture ; sans la neutralisation (Paramètres), ces mouvements seraient comptés`) };
      }
      return { kind: c.kind, value: events.filter((x) => x.why === "counted" && x.row.event.kind === kind).length, qualifiers: c.qualifiers };
    };
    return { month, entries: count(ml.entriesCount, "entry"), exits: count(ml.exitsCount, "exit"), events };
  });
}

// Entrées et sorties comptées d'une période (ligne « Période » de l'écran) : somme des mois, « ≥ » si un mois l'est, n.d. avec
// la raison du premier mois n.d. ; indépendant de la formule du turnover.
export function windowMovements(input: KpiInput, w: Window): { entries: MovementTotal; exits: MovementTotal } {
  return memo(input, `mv-w:${w.from}:${w.to}`, () => {
    const g = checkWindow(input.data, w, input.openMonths);
    if (g) return { entries: { kind: "nd", nd: g }, exits: { kind: "nd", nd: g } };
    const months = w.months.map((m) => monthMovements(input, m));
    const total = (pick: (m: MonthMovements) => Count): MovementTotal => {
      const nds = months.filter((m) => pick(m).kind === "nd");
      if (nds.length) {
        const first = pick(nds[0]);
        const reason = first.kind === "nd" ? first.nd.reason : "n.d.";
        return { kind: "nd", nd: kpiNd("month-nd", periodReason(nds.map((m) => m.month), nds[0].month, reason), { months: nds.map((m) => m.month) }) };
      }
      const value = months.reduce((s, m) => {
        const c = pick(m);
        return s + (c.kind === "nd" ? 0 : c.value);
      }, 0);
      return { kind: months.some((m) => pick(m).kind === "lower_bound") ? "lower_bound" : "exact", value };
    };
    return { entries: total((m) => m.entries), exits: total((m) => m.exits) };
  });
}

// Turnover d'une période close : ((E + S) ÷ 2) ÷ effectif moyen, ou S ÷ effectif au premier jour (Paramètres).
export function turnover(input: KpiInput, w: Window): Turnover {
  return memo(input, `to:${w.from}:${w.to}`, () => {
    const formula = input.params.turnoverFormula;
    const g = checkWindow(input.data, w, input.openMonths);
    if (g) return { kind: "nd", formula, nd: g, months: [] };
    const months = w.months.map((m) => monthMovements(input, m));
    // La variante « sorties ÷ effectif au premier jour » n'utilise pas les entrées : seules les sorties doivent être exactes.
    const usesEntries = formula === "half_sum";
    const ndMonths = months.filter((m) => (usesEntries && m.entries.kind === "nd") || m.exits.kind === "nd");
    if (ndMonths.length) {
      const first = ndMonths[0];
      const which = first.exits.kind === "nd" ? first.exits : first.entries;
      const label = first.exits.kind === "nd" ? "sorties" : "entrées";
      const reason = which.kind === "nd" ? which.nd.reason : "n.d.";
      return { kind: "nd", formula, months, nd: kpiNd("month-nd", `${monthRanges(ndMonths.map((m) => m.month))} : ${label} n.d. — ${reason}`, { months: ndMonths.map((m) => m.month) }) };
    }
    const lowMonths = months.filter((m) => (usesEntries && m.entries.kind === "lower_bound") || m.exits.kind === "lower_bound");
    if (lowMonths.length) {
      const first = lowMonths[0];
      const q = (first.entries.kind === "lower_bound" ? first.entries.qualifiers : first.exits.kind === "lower_bound" ? first.exits.qualifiers : [])[0];
      return { kind: "nd", formula, months, nd: kpiNd("month-lower-bound", `${monthRanges(lowMonths.map((m) => m.month))} : mouvements en borne basse${q ? ` (${q})` : ""}`, { months: lowMonths.map((m) => m.month) }) };
    }
    // Entrées : total publié seulement si tous les mois sont exacts (la variante « sorties ÷ début » peut s'en passer).
    const E = months.every((m) => m.entries.kind === "exact") ? months.reduce((s, m) => s + (m.entries.kind === "exact" ? m.entries.value : 0), 0) : null;
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
      return { kind: "exact", formula, ratio: ratio(n * (E! + S), 2 * avg.ratio.num), entries: E!, exits: S, base: { kind: "average", average: avg }, months, qualifiers };
    }
    const date = monthStart(w.from);
    const h0 = headcountAt(input.data, date, countedOpts(input));
    if (h0.kind === "nd") return { kind: "nd", formula, months, nd: kpiNd(h0.nd.code, h0.nd.reason) };
    if (h0.kind === "lower_bound") return { kind: "nd", formula, months, nd: kpiNd("month-lower-bound", `effectif au ${formatDate(date)} en borne basse${h0.qualifiers[0] ? ` (${h0.qualifiers[0]})` : ""}`) };
    if (h0.persons === 0) return { kind: "nd", formula, months, nd: kpiNd("denominator-zero", `effectif nul au ${formatDate(date)}`) };
    return { kind: "exact", formula, ratio: ratio(S, h0.persons), entries: E, exits: S, base: { kind: "start", date, persons: h0.persons, contractKeys: h0.contractKeys }, months, qualifiers };
  });
}
