import { personsOfContracts, type PersonLink, type PersonsOfContracts } from "@/lib/confidentialite";
import { isHireKey } from "@/lib/confidentialite/groups";
import { aggregate, type PeopleCell, type Version } from "./versions";

// Analyse des écarts d'ETP entre deux versions sur la même période (mois de même rang dans l'année de chaque version).
// ETP d'une période = moyenne des ETP de fin de mois sur ses n mois. Chaque salarié (contrat ou embauche) contribue à
// l'écart b − a de la moyenne selon sa présence :
//   • jamais présent en A, présent en B : « entrées nouvelles » = ETP-mois de B ÷ n ;
//   • présent en A, jamais en B : « sorties » = − ETP-mois de A ÷ n ;
//   • présent dans les deux (pa et pb mois présents, ETP-mois sa et sb) :
//       effet de présence = (sa ÷ pa) × (pb − pa) ÷ n, rangé en « entrées : effet report » s'il est positif (plus de mois
//       présents en B : entrée en cours de période A, pleinement comptée en B) ou en « sorties : effet déport » s'il est
//       négatif (moins de mois présents en B) ;
//       changement d'ETP = (sb × pa − sa × pb) ÷ (pa × n) (quotité moyenne différente).
// Les contributions s'additionnent exactement à l'écart ; chaque palier cumulé est arrondi une seule fois au dix-millième
// d'ETP et chaque contribution est la différence de deux paliers arrondis : le résiduel est nul par construction. Un mois
// n.d. d'une des versions rend l'analyse n.d. : aucune composition n'est supposée.
type Frac = { n: bigint; d: bigint };
const B = BigInt;
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
const add = (x: Frac, y: Frac): Frac => {
  const n = x.n * y.d + y.n * x.d;
  const d = x.d * y.d;
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const frac = (n: bigint, d: bigint): Frac => ({ n, d });
function round(x: Frac): number {
  const neg = x.n < 0n;
  const a = neg ? -x.n : x.n;
  const q = a / x.d;
  const r = a % x.d;
  const v = r * 2n >= x.d ? q + 1n : q;
  return Number(neg ? -v : v);
}

export type StepId = "entrees-new" | "entrees-report" | "sorties" | "sorties-deport" | "etp-change";
export const STEP_LABELS: Record<StepId, string> = {
  "entrees-new": "Entrées nouvelles",
  "entrees-report": "Entrées : effet report",
  sorties: "Sorties",
  "sorties-deport": "Sorties : effet déport",
  "etp-change": "Changement d'ETP",
};
export type CascadeStep = { id: StepId; label: string; etp4: number; people: { key: string; etp4: number }[] };
export type Cascade = { kind: "value"; months: number; start: number; end: number; steps: CascadeStep[]; residual: number } | { kind: "nd"; reason: string };

function peopleOf(v: Version, months: string[]): { kind: "value"; list: Record<string, number>[] } | { kind: "nd"; reason: string } {
  const list: Record<string, number>[] = [];
  for (const m of months) {
    const f = v.months.get(m);
    const p: PeopleCell = f ? f.people : { kind: "nd", reason: `mois ${m} non couvert` };
    if (p.kind === "nd") return { kind: "nd", reason: `${v.label}, ${m} : ${p.reason}` };
    list.push(p.map);
  }
  return { kind: "value", list };
}

export function etpCascade(a: Version, b: Version, monthsA: string[], monthsB: string[]): Cascade {
  if (monthsA.length !== monthsB.length || monthsA.length === 0) return { kind: "nd", reason: "périodes de longueur différente ou vides" };
  const A = peopleOf(a, monthsA);
  if (A.kind === "nd") return A;
  const Bp = peopleOf(b, monthsB);
  if (Bp.kind === "nd") return Bp;
  const n = B(monthsA.length);
  const keys = [...new Set([...A.list.flatMap((x) => Object.keys(x)), ...Bp.list.flatMap((x) => Object.keys(x))])].sort();
  const totals: Record<StepId, Frac> = { "entrees-new": frac(0n, 1n), "entrees-report": frac(0n, 1n), sorties: frac(0n, 1n), "sorties-deport": frac(0n, 1n), "etp-change": frac(0n, 1n) };
  const who: Record<StepId, Map<string, Frac>> = { "entrees-new": new Map(), "entrees-report": new Map(), sorties: new Map(), "sorties-deport": new Map(), "etp-change": new Map() };
  const put = (id: StepId, key: string, x: Frac) => {
    if (x.n === 0n) return;
    totals[id] = add(totals[id], x);
    who[id].set(key, add(who[id].get(key) ?? frac(0n, 1n), x));
  };
  let sumA = 0n;
  let sumB = 0n;
  for (const k of keys) {
    const ea = A.list.map((x) => x[k]).filter((x) => x !== undefined);
    const eb = Bp.list.map((x) => x[k]).filter((x) => x !== undefined);
    const pa = B(ea.length);
    const pb = B(eb.length);
    const sa = B(ea.reduce((s, x) => s + x, 0));
    const sb = B(eb.reduce((s, x) => s + x, 0));
    sumA += sa;
    sumB += sb;
    if (pa === 0n && pb > 0n) put("entrees-new", k, frac(sb, n));
    else if (pa > 0n && pb === 0n) put("sorties", k, frac(-sa, n));
    else if (pa > 0n && pb > 0n) {
      const presence = frac(sa * (pb - pa), pa * n);
      if (pb > pa) put("entrees-report", k, presence);
      else if (pb < pa) put("sorties-deport", k, presence);
      put("etp-change", k, frac(sb * pa - sa * pb, pa * n));
    }
  }
  // Paliers cumulés arrondis une fois chacun : départ = moyenne de A, arrivée = moyenne de B.
  let level: Frac = frac(sumA, n);
  const start = round(level);
  let prev = start;
  const order: StepId[] = ["entrees-new", "entrees-report", "sorties", "sorties-deport", "etp-change"];
  const steps: CascadeStep[] = [];
  for (const id of order) {
    level = add(level, totals[id]);
    const r = round(level);
    steps.push({
      id, label: STEP_LABELS[id], etp4: r - prev,
      people: [...who[id]].map(([key, x]) => ({ key, etp4: round(x) })).sort((p, q) => Math.abs(q.etp4) - Math.abs(p.etp4) || p.key.localeCompare(q.key)),
    });
    prev = r;
  }
  const end = round(frac(sumB, n));
  return { kind: "value", months: monthsA.length, start, end, steps, residual: end - start - steps.reduce((s, x) => s + x.etp4, 0) };
}

// Personnes distinctes décrites par chaque palier (unité du seuil de confidentialité) : les contrats réels du palier (clé de
// référentiel d'un contrat) reliés à leur personne par le lien du référentiel Collaborateurs ; un contrat réel que le lien ne relie
// pas est compté à part (unlinked : il ne protège jamais). Les embauches prévues d'un scénario (clé « embauche:… » du moteur de
// projection, isHireKey du module partagé) ne décrivent aucune personne réelle : comptées à part (hires), ni reliées ni non reliées.
// Un palier porté seulement par des embauches prévues est exempt du masquage et n'apporte aucune personne protectrice ; un palier qui
// les mêle à des contrats réels se juge sur ses seuls contrats réels (projectedCell du module partagé, appelé par maskCascade de
// src/lib/viz/ecart.ts). Un palier vide ne décrit personne. Aucune clé de personne n'est interprétée ici : la fonction rend ce que le
// lien lui donne.
export type CascadeGroup = PersonsOfContracts & { hires: number };
export function cascadePersons(c: Pick<Extract<Cascade, { kind: "value" }>, "steps">, link: PersonLink): CascadeGroup[] {
  return c.steps.map((s) => {
    const real = s.people.filter((p) => !isHireKey(p.key)).map((p) => p.key);
    return { ...personsOfContracts(real, link), hires: s.people.length - real.length };
  });
}

// Écart de masse salariale par rubrique entre deux versions : chaque rubrique est une contribution ; si une rubrique est n.d.
// d'un côté, l'écart total reste affiché et le résiduel est l'écart non expliqué (n.d. si le total l'est).
export type RubricStep = { key: string; label: string; delta: number | null; reason: string | null };
export function masseByRubric(a: Version, b: Version, monthsA: string[], monthsB: string[]): { kind: "value"; start: number; end: number; steps: RubricStep[]; residual: number | null } | { kind: "nd"; reason: string } {
  const ta = aggregate(a, monthsA, "masse");
  const tb = aggregate(b, monthsB, "masse");
  if (ta.kind !== "value") return { kind: "nd", reason: ta.kind === "nd" ? `${a.label} : ${ta.reason}` : "masse sans objet" };
  if (tb.kind !== "value") return { kind: "nd", reason: tb.kind === "nd" ? `${b.label} : ${tb.reason}` : "masse sans objet" };
  const keys = [["remun", "Rémunération de base"], ["primes", "Primes et éléments variables"], ["indemnites", "Indemnités et avantages"], ["autres", "Autres rubriques saisies"], ["charges", "Charges patronales"], ["nonventile", "Coûts chargés non ventilés"]] as const;
  const steps: RubricStep[] = keys.map(([k, label]) => {
    const x = aggregate(a, monthsA, k);
    const y = aggregate(b, monthsB, k);
    if (x.kind === "nd") return { key: k, label, delta: null, reason: `${a.label} : ${x.reason}` };
    if (y.kind === "nd") return { key: k, label, delta: null, reason: `${b.label} : ${y.reason}` };
    return { key: k, label, delta: (y.kind === "value" ? y.num : 0) - (x.kind === "value" ? x.num : 0), reason: null };
  });
  const known = steps.reduce((s, x) => s + (x.delta ?? 0), 0);
  return { kind: "value", start: ta.num, end: tb.num, steps, residual: tb.num - ta.num - known };
}
