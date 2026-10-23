import { enteredAfter, hireKey, monthLast, roundDiv } from "./engine";
import type { BaseContract, BaseSnapshot, Conventions, Hypothesis, PriorMonth, Projection } from "./types";

// Simulateur N+1 : base d'un nouveau scénario dérivée de l'état projeté d'un scénario parent au dernier mois de son
// horizon (ex. décembre N). Contrats encore présents ce mois-là (base, entrées, embauches), au salaire du mois complet
// après augmentations et à leur taux de charges ; départs et fins de contrat effectifs exclus ; éléments ponctuels non
// repris (non récurrents). Le réel du parent et ses mois projetés sont recopiés pour la comparaison avec l'année N.
type Aug = Extract<Hypothesis, { kind: "augmentation" }>;
const TEN_K = 10_000n;

export function chainBase(
  parent: { id: string; name: string; firstMonth: string; lastMonth: string; conventions: Conventions },
  base: BaseSnapshot,
  hyps: Hypothesis[],
  proj: Projection,
  at: string,
): { kind: "value"; base: BaseSnapshot } | { kind: "nd"; reason: string } {
  if (proj.kind === "error") return { kind: "nd", reason: `scénario « ${parent.name} » en erreur : ${proj.errors.join(" ; ")}` };
  const M = parent.lastMonth;
  const nd = proj.months.filter((m) => m.kind === "nd");
  if (nd.length) return { kind: "nd", reason: `scénario « ${parent.name} » n.d. pour ${nd.map((m) => m.month).join(", ")} : complétez ses bases avant d'en dériver un budget` };
  const end = monthLast(M);
  const augs = hyps.filter((h): h is Aug => h.kind === "augmentation");
  const deps = new Map(hyps.flatMap((h) => (h.kind === "depart" ? [[h.contractKey, h] as const] : [])));
  const fixes = new Map(hyps.flatMap((h) => (h.kind === "base" ? [[h.contractKey, h] as const] : [])));
  const pm = proj.months.find((x) => x.month === M)!;
  if (pm.kind !== "value") return { kind: "nd", reason: `mois ${M} n.d.` };
  const contracts: BaseContract[] = [];
  const notCarried: string[] = [];
  for (const c of base.contracts) {
    const dep = deps.get(c.contractKey);
    const stop = [dep?.lastPaidDate ?? null, c.endDate].filter((x): x is string => x !== null).sort()[0] ?? null;
    if (stop !== null && stop <= end) continue; // parti au plus tard le dernier jour de M
    if (enteredAfter(base, c) && c.startDate! > end) continue;
    if (dep && dep.lastPaidDate > end) notCarried.push(`départ « ${dep.label} » du ${dep.lastPaidDate} (postérieur à ${M})`);
    const fix = fixes.get(c.contractKey);
    // Brut du mois complet à M = base + augmentations (contributions « base » et « augmentation » du moteur).
    const own = pm.contributions.filter((x) => x.contractKey === c.contractKey && (x.kind === "base" || x.kind === "augmentation"));
    const brut = own.reduce((s, x) => s + (x.brut ?? 0), 0);
    const rate = fix ? { brut: 10_000, cot: fix.chargesBps } : c.base ? { brut: c.base.refBrutCents, cot: c.base.refCotisationsCents } : null;
    if (!own.length || !rate) return { kind: "nd", reason: `contrat ${c.label} : coût de ${M} introuvable dans la projection` };
    contracts.push({ ...c, endDate: c.endDate, base: { salaryCents: brut, refBrutCents: rate.brut, refCotisationsCents: rate.cot }, baseNd: null });
  }
  for (const h of hyps) {
    if (h.kind !== "embauche") continue;
    if (h.start > end) {
      notCarried.push(`embauche « ${h.label} » du ${h.start} (postérieure à ${M})`);
      continue;
    }
    if (h.end !== null && h.end <= end) continue;
    // Embauche : brut du mois complet à M = brut temps plein × quotité, augmentations ciblées comprises.
    const key = hireKey(h.id);
    const list = augs.filter((a) => a.scope.kind === "contrat" && a.scope.key === key && a.from <= M).sort((x, y) => x.from.localeCompare(y.from));
    let n = BigInt(h.grossFullTimeCents) * BigInt(h.quotaBps);
    let d = TEN_K;
    for (const a of list) {
      n *= TEN_K + BigInt(a.rateBps);
      d *= TEN_K;
    }
    contracts.push({
      contractKey: key, externalId: key, label: h.label, service: h.service, serviceNd: h.service ? null : "embauche sans service", startDate: h.start, endDate: h.end,
      counted: h.counted, etp4: h.counted ? h.quotaBps : null, etpNd: h.counted ? null : "non compté dans l'effectif",
      base: { salaryCents: roundDiv(n, d), refBrutCents: 10_000, refCotisationsCents: h.chargesBps }, baseNd: null,
    });
  }
  for (const h of hyps) if (h.kind === "ponctuel" && h.month > M) notCarried.push(`élément « ${h.label} » de ${h.month}`);
  contracts.sort((x, y) => x.label.localeCompare(y.label) || x.contractKey.localeCompare(y.contractKey));
  const source = `projeté — scénario « ${parent.name} »`;
  const prior: PriorMonth[] = [
    ...(base.prior ?? []),
    ...proj.months.map((m): PriorMonth => (m.kind === "nd" ? { month: m.month, kind: "nd", reason: m.reasons.join(" ; "), source } : { month: m.month, kind: "value", cost: m.cost, headcount: m.headcount, etp4: m.etp4, etpNd: m.etpNd, source })),
  ];
  const refBaseCost = contracts.reduce((s, c) => s + c.base!.salaryCents + roundDiv(BigInt(c.base!.salaryCents) * BigInt(c.base!.refCotisationsCents), BigInt(c.base!.refBrutCents)), 0);
  return {
    kind: "value",
    base: {
      ...base,
      refMonth: M,
      contracts,
      refMasse: pm.cost,
      refBaseCost,
      origin: { kind: "scenario", scenarioId: parent.id, scenarioName: parent.name, month: M, at, notCarried },
      prior,
    },
  };
}
