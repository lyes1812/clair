import { monthEnd } from "@/lib/dates";
import { monthRange } from "@/lib/connectors/months";
import { monthPayroll, withService, type JournalInput } from "@/lib/payroll/engine";
import { gridRubrics } from "@/lib/payroll/grid";
import { headcountAt } from "@/lib/rh/headcount";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { countedOpts } from "@/lib/rh/kpi/period";
import { monthMovements } from "@/lib/rh/kpi/turnover";
import type { KpiInput } from "@/lib/rh/kpi/types";
import { flowsOf } from "./flows";
import type { Series } from "./series";
import type { BaseSnapshot, Contribution, PresentPerson, Projection } from "./types";

// Versions comparables (module 5, écart budgétaire) : un réel, un scénario ou un budget saisi, mois par mois, avec les
// mêmes rubriques. Une cellule est une valeur, n.d. avec sa raison, ou « sans objet » (rubrique que la version ne porte
// pas : jamais comptée comme un zéro mais sans effet dans les sommes). Toute somme sur une période est n.d. dès qu'un
// de ses mois l'est.
export type Cell = { kind: "value"; v: number } | { kind: "nd"; reason: string } | { kind: "na" };
export type Layer = "reel" | "projete-parent" | "projete" | "budget";
export const val = (v: number): Cell => ({ kind: "value", v });
export const nd = (reason: string): Cell => ({ kind: "nd", reason });
const NA: Cell = { kind: "na" };

// Rubriques d'une version, du haut vers le bas du tableau d'écart.
export type RowKey = "etp" | "headcount" | "entrees" | "sorties" | "masse" | "brut" | "remun" | "primes" | "indemnites" | "autres" | "charges" | "nonventile";
// Composition d'un mois : ETP (1/10 000) de chaque salarié compté présent en fin de mois, par contrat ou embauche.
export type PeopleCell = { kind: "value"; map: Record<string, number> } | { kind: "nd"; reason: string };
export type MonthFacts = { month: string; layer: Layer; source: string } & Record<Exclude<RowKey, "etp" | "headcount" | "entrees" | "sorties"> | "etp4" | "headcount" | "entrees" | "sorties", Cell> & { free: Record<string, number>; people: PeopleCell };
export type Version = { key: string; label: string; kind: "reel" | "scenario" | "budget"; year: string; months: Map<string, MonthFacts> };

export type ServiceFilter = { value: string | null } | null; // null : tous les services ; { value: null } : non ventilé
// ETP réel d'un service pour un mois (module Masse salariale : lignes de journal du mois rattachées au contrat) ; absent : n.d.
export type EtpService = (month: string, filter: { value: string | null }) => Cell;

const allNd = (month: string, layer: Layer, source: string, reason: string): MonthFacts => ({
  month, layer, source, etp4: nd(reason), headcount: nd(reason), entrees: nd(reason), sorties: nd(reason), masse: nd(reason), brut: nd(reason), remun: nd(reason), primes: nd(reason), indemnites: nd(reason), autres: nd(reason), charges: nd(reason), nonventile: nd(reason), free: {}, people: { kind: "nd", reason },
});

// ETP, effectif et mouvements d'un mois réalisé, lus dans le référentiel Collaborateurs courant (non historisés par service).
function realPeopleCells(kpi: KpiInput | null, m: string, filter: ServiceFilter, etpService?: EtpService): Pick<MonthFacts, "etp4" | "headcount" | "entrees" | "sorties" | "people"> {
  if (!kpi) {
    const r = nd("référentiel Collaborateurs indisponible");
    return { etp4: r, headcount: r, entrees: r, sorties: r, people: { kind: "nd", reason: "référentiel Collaborateurs indisponible" } };
  }
  if (filter) {
    const reason = "service des collaborateurs non historisé pour les mois réalisés : effectif et mouvements non filtrables par service";
    return { etp4: etpService ? etpService(m, filter) : nd("ETP par service indisponible"), headcount: nd(reason), entrees: nd(reason), sorties: nd(reason), people: { kind: "nd", reason } };
  }
  const e = etpMonthEnd(kpi, m);
  const h = headcountAt(kpi.data, monthEnd(m), countedOpts(kpi));
  const mv = monthMovements(kpi, m);
  const count = (c: { kind: string; value?: number; nd?: { reason: string } }, what: string): Cell => (c.kind === "exact" ? val(c.value!) : c.kind === "nd" ? nd(c.nd?.reason ?? `${what} n.d.`) : nd(`${what} en borne basse (source incomplète)`));
  const people: PeopleCell =
    e.kind === "nd" ? { kind: "nd", reason: e.nd.reason }
    : e.missing.length ? { kind: "nd", reason: `${e.missing.length} contrat(s) présent(s) sans quotité : ETP par salarié incomplets` }
    : { kind: "value", map: Object.fromEntries(e.contributions.map((c) => [c.contractKey, c.etp4])) };
  return {
    etp4: e.kind === "exact" ? val(e.etp4) : e.kind === "nd" ? nd(e.nd.reason) : nd("ETP en borne basse (contrat sans quotité ou source incomplète)"),
    headcount: h.kind === "exact" ? val(h.contracts) : h.kind === "nd" ? nd(h.nd.reason) : nd("effectif en borne basse (source incomplète)"),
    entrees: count(mv.entries as never, "entrées"),
    sorties: count(mv.exits as never, "sorties"),
    people,
  };
}

// Mois réalisé lu dans le journal courant (mois clos seulement).
function realMonth(journal: JournalInput, kpi: KpiInput | null, m: string, filter: ServiceFilter, etpService?: EtpService): MonthFacts {
  const src = "réel PayFit (journal de paie)";
  if (journal.openMonths.includes(m)) return allNd(m, "reel", src, "paie non clôturée à la lecture");
  const mp = monthPayroll(filter ? withService(journal, filter.value) : journal, m);
  if (mp.kind === "nd") return allNd(m, "reel", src, mp.nd.reason);
  return {
    month: m, layer: "reel", source: src, ...realPeopleCells(kpi, m, filter, etpService),
    masse: val(mp.masse), brut: val(mp.brut), remun: val(mp.byRubric.salaires + mp.byRubric.stages), primes: val(mp.byRubric.primes), indemnites: val(mp.byRubric.indemnites),
    autres: NA, charges: val(mp.cotisations), nonventile: NA, free: {},
  };
}

export function reelVersion(key: string, label: string, year: string, journal: JournalInput, kpi: KpiInput | null, filter: ServiceFilter, etpService?: EtpService): Version {
  return { key, label, kind: "reel", year, months: new Map(monthRange(`${year}-01`, `${year}-12`).map((m) => [m, journal.months.includes(m) ? realMonth(journal, kpi, m, filter, etpService) : allNd(m, "reel", "réel PayFit (journal de paie)", `mois ${m} non lu (hors lecture PayFit appliquée)`)])) };
}

// Rubrique PayFit visée par une enveloppe « par rubrique » : libellé de la grille de comptes, sans tenir compte de la casse.
function payfitRubric(label: string, journal: JournalInput | null): "remun" | "primes" | "indemnites" | null {
  if (!journal) return null;
  const k = label.trim().toLowerCase();
  const by = new Map(gridRubrics(journal.grid).map((r) => [r.label.toLowerCase(), r.id]));
  const id = by.get(k);
  return id === "salaires" || id === "stages" ? "remun" : id === "primes" ? "primes" : id === "indemnites" ? "indemnites" : null;
}

// Rubrique d'une ligne de projection : rémunération (base, augmentations, mouvements, embauches), primes (éléments
// ponctuels), indemnités (coûts de sortie), autres (enveloppes de service ou de rubrique libre) ; une enveloppe dont la
// rubrique porte le libellé d'une rubrique PayFit de la grille de comptes y est comptée.
export function contributionRubric(c: Contribution, journal: JournalInput | null): "remun" | "primes" | "indemnites" | "autres" {
  if (c.kind === "ponctuel") return "primes";
  if (c.kind === "sortie") return "indemnites";
  if (c.kind === "enveloppe") return (c.rubric ? payfitRubric(c.rubric, journal) : null) ?? "autres";
  return "remun";
}

export function scenarioVersion(
  key: string, label: string, year: string, base: BaseSnapshot, proj: Projection, journal: JournalInput | null, kpi: KpiInput | null, filter: ServiceFilter, etpService?: EtpService,
): Version {
  const months = new Map<string, MonthFacts>();
  const flows = new Map(flowsOf(base, proj).map((f) => [f.month, f]));
  const filtered = filter !== null;
  const matches = (s: string | null) => !filter || s === filter.value;
  for (const m of monthRange(`${year}-01`, `${year}-12`)) {
    const a = base.actuals.find((x) => x.month === m);
    const pr = base.prior?.find((x) => x.month === m);
    const pm = proj.kind === "value" ? proj.months.find((x) => x.month === m) : undefined;
    if (a && m <= base.refMonth) {
      const src = "réel figé du scénario";
      if (a.kind === "nd") {
        months.set(m, allNd(m, "reel", src, a.reason));
        continue;
      }
      // Ventilation par rubrique : journal courant, seulement s'il donne encore le même total que le réel figé.
      let split: Pick<MonthFacts, "masse" | "brut" | "remun" | "primes" | "indemnites" | "autres" | "charges" | "nonventile"> | null = null;
      let why = "journal de paie courant indisponible";
      if (journal && !journal.openMonths.includes(m)) {
        const live = monthPayroll(journal, m);
        if (live.kind === "nd") why = live.nd.reason;
        else if (live.masse === a.masse && live.brut === a.brut) {
          const f = filtered ? monthPayroll(withService(journal, filter!.value), m) : live;
          if (f.kind === "value") split = { masse: val(f.masse), brut: val(f.brut), remun: val(f.byRubric.salaires + f.byRubric.stages), primes: val(f.byRubric.primes), indemnites: val(f.byRubric.indemnites), autres: NA, charges: val(f.cotisations), nonventile: NA };
          else why = f.nd.reason;
        } else why = "lecture PayFit modifiée depuis la création du scénario : ventilation courante différente du réel figé";
      }
      const r = nd(why);
      const live = realPeopleCells(kpi, m, filter, etpService);
      months.set(m, {
        month: m, layer: "reel", source: src, entrees: live.entrees, sorties: live.sorties,
        // Composition : lecture courante, retenue seulement si elle redonne l'effectif figé du scénario.
        people: live.people.kind === "value" && a.headcount !== null && Object.keys(live.people.map).length === a.headcount ? live.people : { kind: "nd", reason: live.people.kind === "nd" ? live.people.reason : "lecture PayFit modifiée depuis la création du scénario : composition courante différente de l'effectif figé" },
        etp4: filtered ? live.etp4 : a.etp4 === null ? nd(a.etpNd ?? "ETP n.d.") : val(a.etp4),
        headcount: filtered ? live.headcount : a.headcount === null ? nd(a.etpNd ?? "effectif n.d.") : val(a.headcount),
        ...(split ?? (filtered ? { masse: nd(`service ${filter!.value ?? "non ventilé"} : ${why}`), brut: nd(why), remun: nd(why), primes: nd(why), indemnites: nd(why), autres: NA, charges: nd(why), nonventile: NA } : { masse: val(a.masse), brut: val(a.brut), remun: r, primes: r, indemnites: r, autres: NA, charges: val(a.cotisations), nonventile: NA })),
        free: {},
      });
      continue;
    }
    if (pr && !pm) {
      const src = pr.source;
      if (pr.kind === "nd") months.set(m, allNd(m, "projete-parent", src, pr.reason));
      else {
        const why = "projeté par le scénario parent : ventilation par rubrique non conservée";
        const r = filtered ? nd("projeté par le scénario parent : non filtrable par service") : nd(why);
        // Le scénario parent n'a conservé que les totaux de toute l'entreprise (coût, ETP, effectif), sans service : sous le filtre
        // Service, masse, ETP et effectif sont n.d. (non filtrables), jamais les chiffres de toute l'entreprise sous le nom du service.
        months.set(m, {
          month: m, layer: "projete-parent", source: src,
          etp4: filtered ? r : pr.etp4 === null ? nd(pr.etpNd ?? "ETP n.d.") : val(pr.etp4), headcount: filtered ? r : val(pr.headcount),
          entrees: nd(why), sorties: nd(why), people: { kind: "nd", reason: "projeté par le scénario parent : composition non conservée" },
          masse: filtered ? r : val(pr.cost), brut: pr.brut === null || pr.brut === undefined || filtered ? r : val(pr.brut), remun: r, primes: r, indemnites: r, autres: NA,
          charges: pr.charges === null || pr.charges === undefined || filtered ? r : val(pr.charges), nonventile: NA, free: {},
        });
      }
      continue;
    }
    if (!pm) {
      months.set(m, allNd(m, "projete", "scénario", `mois ${m} hors de l'horizon du scénario`));
      continue;
    }
    const src = "projeté — scénario";
    if (pm.kind === "nd") {
      months.set(m, allNd(m, "projete", src, pm.reasons.join(" ; ")));
      continue;
    }
    // Lignes du mois par rubrique ; un coût saisi sans brut ni charges est non ventilé.
    let remun = 0;
    let primes = 0;
    let indemnites = 0;
    let autres = 0;
    let charges = 0;
    let nonventile = 0;
    let masse = 0;
    const free: Record<string, number> = {};
    for (const c of pm.contributions) {
      if (!matches(c.service)) continue;
      masse += c.cost;
      if (c.brut === null || c.charges === null) {
        nonventile += c.cost;
        continue;
      }
      charges += c.charges;
      const r = contributionRubric(c, journal);
      if (r === "remun") remun += c.brut;
      else if (r === "primes") primes += c.brut;
      else if (r === "indemnites") indemnites += c.brut;
      else {
        autres += c.brut;
        const k = c.rubric ?? `service ${c.service ?? "non ventilé"}`;
        free[k] = (free[k] ?? 0) + c.brut;
      }
    }
    const f = flows.get(m);
    const people = pm.people ?? {};
    const inService = (p: PresentPerson) => !filter || p.service === filter.value;
    const kept = Object.entries(people).filter(([, p]) => inService(p));
    months.set(m, {
      month: m, layer: "projete", source: src,
      etp4: kept.some(([, p]) => p.etp4 === null) ? nd(pm.etpNd ?? "ETP n.d.") : val(kept.reduce((s, [, p]) => s + (p.etp4 ?? 0), 0)),
      headcount: val(kept.length),
      // Entrées et sorties filtrées par service : le service d'un sortant est celui de son dernier mois présent ; sans filtre, toutes.
      entrees: f && f.kind === "value" ? (filter ? val(f.entrees.filter((k) => people[k] && inService(people[k])).length) : val(f.entrees.length)) : nd(f && f.kind === "nd" ? f.reason : "mouvements n.d."),
      sorties: f && f.kind === "value" ? (filter ? nd("sorties d'un service : service du sortant non conservé dans la projection") : val(f.sorties.length)) : nd(f && f.kind === "nd" ? f.reason : "mouvements n.d."),
      masse: val(masse), brut: nonventile > 0 ? nd("coûts chargés saisis sans brut ni charges (non ventilés)") : val(remun + primes + indemnites + autres),
      remun: val(remun), primes: val(primes), indemnites: val(indemnites), autres: val(autres), charges: nonventile > 0 ? nd("coûts chargés saisis sans brut ni charges (non ventilés)") : val(charges), nonventile: val(nonventile), free,
      people: kept.some(([, p]) => p.etp4 === null) ? { kind: "nd", reason: pm.etpNd ?? "ETP n.d." } : { kind: "value", map: Object.fromEntries(kept.map(([k, p]) => [k, p.etp4 ?? 0])) },
    });
  }
  return { key, label, kind: "scenario", year, months };
}

// Budget saisi : coût chargé global par mois ; rien d'autre n'est connu.
export function budgetVersion(key: string, label: string, year: string, amounts: Record<string, number | null>): Version {
  const months = new Map<string, MonthFacts>();
  for (const m of monthRange(`${year}-01`, `${year}-12`)) {
    const v = amounts[m];
    const none = "budget saisi : montant global seulement";
    if (v === null || v === undefined) months.set(m, allNd(m, "budget", "budget saisi", "montant du budget non saisi"));
    else months.set(m, { ...allNd(m, "budget", "budget saisi", none), masse: val(v), etp4: nd("budget saisi sans ETP"), headcount: nd("budget saisi sans effectif"), entrees: nd("budget saisi sans mouvements"), sorties: nd("budget saisi sans mouvements") });
  }
  return { key, label, kind: "budget", year, months };
}

// --- Agrégation d'une rubrique sur une période (mois du même rang dans l'année de la version).
// ETP : moyenne des ETP de fin de mois ({ num = somme en 1/10 000 ETP, den = nombre de mois × 10 000 }) ; effectif : fin de
// période ; entrées, sorties et montants : sommes. n.d. dès qu'un mois l'est ; sans objet si toute la période l'est.
export type Agg = { kind: "value"; num: number; den: number } | { kind: "nd"; reason: string } | { kind: "na" };
export const ROW_LABELS: Record<RowKey, string> = {
  etp: "ETP (moyenne des ETP de fin de mois)",
  headcount: "Inscrit fin de période",
  entrees: "Entrées",
  sorties: "Sorties",
  masse: "Masse salariale chargée",
  brut: "Total brut",
  remun: "Rémunération de base (salaires, gratifications de stage)",
  primes: "Primes et éléments variables",
  indemnites: "Indemnités et avantages",
  autres: "Autres rubriques saisies (enveloppes)",
  charges: "Charges patronales (cotisations et taxes)",
  nonventile: "Coûts chargés non ventilés (saisis sans brut ni charges)",
};
export const ROW_UNIT: Record<RowKey, "etp" | "nombre" | "eur"> = { etp: "etp", headcount: "nombre", entrees: "nombre", sorties: "nombre", masse: "eur", brut: "eur", remun: "eur", primes: "eur", indemnites: "eur", autres: "eur", charges: "eur", nonventile: "eur" };

const cellOf = (f: MonthFacts, k: RowKey): Cell => (k === "etp" ? f.etp4 : f[k]);

// Mois de la période choisie (rangs de mois dans l'année : « 01 » à « 12 ») pour l'année de la version.
export const monthsOfYear = (year: string, from: string, to: string) => monthRange(`${year}-${from}`, `${year}-${to}`);

export function aggregate(v: Version, months: string[], k: RowKey): Agg {
  const cells = months.map((m) => ({ m, c: v.months.get(m) ? cellOf(v.months.get(m)!, k) : nd(`mois ${m} non couvert`) }));
  const bad = cells.filter((x) => x.c.kind === "nd") as { m: string; c: { kind: "nd"; reason: string } }[];
  if (bad.length) return { kind: "nd", reason: [...new Set(bad.map((x) => `${x.m} : ${x.c.reason}`))].slice(0, 3).join(" ; ") + (bad.length > 3 ? ` (+ ${bad.length - 3} mois)` : "") };
  if (cells.every((x) => x.c.kind === "na")) return { kind: "na" };
  const vals = cells.map((x) => (x.c.kind === "value" ? x.c.v : 0));
  if (k === "headcount") return { kind: "value", num: vals.at(-1) ?? 0, den: 1 };
  if (k === "etp") return { kind: "value", num: vals.reduce((s, x) => s + x, 0), den: months.length * 10_000 };
  return { kind: "value", num: vals.reduce((s, x) => s + x, 0), den: 1 };
}

// Écart b − a (même période, même dénominateur) et part de l'écart dans la valeur de a ; % n.d. si a est nul.
export type Diff = { kind: "value"; num: number; den: number; pct: { num: number; den: number } | null } | { kind: "nd"; reason: string } | { kind: "na" };
export function diff(a: Agg, b: Agg): Diff {
  if (a.kind === "nd") return { kind: "nd", reason: a.reason };
  if (b.kind === "nd") return { kind: "nd", reason: b.reason };
  if (a.kind === "na" || b.kind === "na") return { kind: "na" };
  if (a.den !== b.den) return { kind: "nd", reason: "périodes de longueur différente" };
  return { kind: "value", num: b.num - a.num, den: a.den, pct: a.num !== 0 ? { num: b.num - a.num, den: Math.abs(a.num) } : null };
}

// Version entièrement n.d. (source indisponible) : chaque mois porte la raison.
export function ndVersion(key: string, label: string, kind: Version["kind"], year: string, reason: string): Version {
  return { key, label, kind, year, months: new Map(monthRange(`${year}-01`, `${year}-12`).map((m) => [m, allNd(m, kind === "budget" ? "budget" : kind === "reel" ? "reel" : "projete", label, reason)])) };
}

// Série mensuelle de coût et d'ETP d'une version sur des mois cibles : le mois i de `from` devient le mois i de `to`
// (comparaison d'années différentes mois à mois), pour le pont volume / coût moyen.
export function alignedSeries(v: Version, from: string[], to: string[]): Series {
  const s: Series = { key: v.key, label: v.label, points: new Map() };
  from.forEach((m, i) => {
    const f = v.months.get(m);
    const month = to[i];
    if (!f || f.masse.kind !== "value") s.points.set(month, { month, kind: "nd", reason: f?.masse.kind === "nd" ? f.masse.reason : "mois non couvert" });
    else s.points.set(month, { month, kind: "value", cost: f.masse.v, etp4: f.etp4.kind === "value" ? f.etp4.v : null, etpNd: f.etp4.kind === "nd" ? f.etp4.reason : null, layer: f.layer });
  });
  return s;
}
