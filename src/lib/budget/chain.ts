import { hireKey, monthLast, roundDiv } from "./engine";
import type { BaseContract, BaseSnapshot, Conventions, Hypothesis, PriorMonth, Projection } from "./types";

// Simulateur N+1 : base d'un nouveau scénario dérivée de l'état projeté d'un scénario parent figé au dernier mois de
// son horizon (ex. décembre N). Contrats encore présents ce mois-là (base, entrées, embauches), au brut et aux charges
// du mois complet après augmentations (exactement ceux du moteur) ; départs et fins de contrat effectifs exclus ;
// éléments ponctuels et coûts de sortie non repris. Le réel du parent et ses mois projetés sont recopiés pour la
// comparaison avec l'année N. Les contrats connus de PayFit qui commencent après M entrent avec une base à saisir.
type Aug = Extract<Hypothesis, { kind: "augmentation" }>;
const TEN_K = 10_000n;

export function chainBase(
  parent: { id: string; name: string; firstMonth: string; lastMonth: string; conventions: Conventions },
  base: BaseSnapshot,
  hyps: Hypothesis[],
  proj: Projection,
  at: string,
  childLastMonth: string,
): { kind: "value"; base: BaseSnapshot } | { kind: "nd"; reason: string } {
  if (proj.kind === "error") return { kind: "nd", reason: `scénario « ${parent.name} » en erreur : ${proj.errors.join(" ; ")}` };
  const M = parent.lastMonth;
  const nd = proj.months.filter((m) => m.kind === "nd");
  if (nd.length) return { kind: "nd", reason: `scénario « ${parent.name} » n.d. pour ${nd.map((m) => m.month).join(", ")} : complétez ses bases avant d'en dériver un budget` };
  const pm = proj.months.find((x) => x.month === M);
  if (!pm || pm.kind !== "value") return { kind: "nd", reason: `mois ${M} absent de la projection du parent` };
  const end = monthLast(M);
  const childEnd = monthLast(childLastMonth);
  const augs = hyps.filter((h): h is Aug => h.kind === "augmentation");
  const deps = new Map(hyps.flatMap((h) => (h.kind === "depart" ? [[h.contractKey, h] as const] : [])));
  const fixes = new Map(hyps.flatMap((h) => (h.kind === "base" ? [[h.contractKey, h] as const] : [])));
  const contracts: BaseContract[] = [];
  const notCarried: string[] = [];
  const carried = new Set<string>();
  // Base dérivée : brut et charges du mois complet ; taux de charges = charges ÷ brut (ou taux saisi si brut nul).
  const baseOf = (brut: number, charges: number, bps: number | null) => (brut > 0 ? { salaryCents: brut, refBrutCents: brut, refCotisationsCents: charges } : { salaryCents: 0, refBrutCents: 10_000, refCotisationsCents: bps ?? 0 });
  let hireFull = 0;
  let hireInM = 0;
  for (const c of base.contracts) {
    const dep = deps.get(c.contractKey);
    const stop = [dep?.lastPaidDate ?? null, c.endDate].filter((x): x is string => x !== null).sort()[0] ?? null;
    if (stop !== null && stop <= end) continue; // parti au plus tard le dernier jour de M
    if (dep && dep.lastPaidDate > end) notCarried.push(`départ « ${dep.label} » du ${dep.lastPaidDate} (postérieur à ${M})`);
    const own = pm.contributions.filter((x) => x.contractKey === c.contractKey && (x.kind === "base" || x.kind === "augmentation"));
    if (!own.length) return { kind: "nd", reason: `contrat ${c.label} : coût de ${M} introuvable dans la projection` };
    const brut = own.reduce((s, x) => s + (x.brut ?? 0), 0);
    const charges = own.reduce((s, x) => s + (x.charges ?? 0), 0);
    contracts.push({ ...c, base: baseOf(brut, charges, fixes.get(c.contractKey)?.chargesBps ?? null), baseNd: null });
    carried.add(c.contractKey);
  }
  for (const h of hyps) {
    if (h.kind !== "embauche") continue;
    if (h.start > end) {
      notCarried.push(`embauche « ${h.label} » du ${h.start} (postérieure à ${M})`);
      continue;
    }
    if (h.end !== null && h.end <= end) continue;
    // Embauche : brut et charges du mois complet à M (brut temps plein × quotité, augmentations ciblées comprises),
    // calculés comme le moteur (fraction exacte, un arrondi par niveau).
    const key = hireKey(h.id);
    const list = augs.filter((a) => a.scope.kind === "contrat" && a.scope.key === key && a.from <= M).sort((x, y) => x.from.localeCompare(y.from));
    let n = BigInt(h.grossFullTimeCents) * BigInt(h.quotaBps);
    let d = TEN_K;
    for (const a of list) {
      n *= TEN_K + BigInt(a.rateBps);
      d *= TEN_K;
    }
    const brut = roundDiv(n, d);
    const charges = roundDiv(n * BigInt(h.chargesBps), d * TEN_K);
    hireFull += brut + charges;
    hireInM += pm.contributions.filter((x) => x.contractKey === key).reduce((s, x) => s + x.cost, 0);
    contracts.push({
      contractKey: key, externalId: key, label: h.label, service: h.service, serviceNd: h.service ? null : "embauche sans service", startDate: h.start, endDate: h.end,
      counted: h.counted, etp4: h.counted ? h.quotaBps : null, etpNd: h.counted ? null : "non compté dans l'effectif",
      base: baseOf(brut, charges, h.chargesBps), baseNd: null,
    });
    carried.add(key);
  }
  // Contrats connus de PayFit qui commencent après M : repris s'ils commencent dans l'horizon du nouveau scénario.
  const upcoming: BaseContract[] = [];
  for (const c of base.upcoming ?? []) {
    if (c.startDate !== null && c.startDate <= childEnd) contracts.push({ ...c, base: null, baseNd: `entré le ${c.startDate}, après le mois de référence : base à saisir` });
    else upcoming.push(c);
  }
  for (const h of hyps) if (h.kind === "ponctuel" && h.month > M) notCarried.push(`élément « ${h.label} » de ${h.month}`);
  contracts.sort((x, y) => x.label.localeCompare(y.label) || x.contractKey.localeCompare(y.contractKey));

  // Écart entre le coût projeté de M et la base dérivée, par nature (éléments non repris dans la base).
  const sum = (pred: (k: string, key: string | null) => boolean) => pm.contributions.filter((x) => pred(x.kind, x.contractKey)).reduce((s, x) => s + x.cost, 0);
  const gapItems = [
    { label: `éléments ponctuels de ${M}`, cost: sum((k) => k === "ponctuel") },
    { label: `coûts de sortie de ${M}`, cost: sum((k) => k === "sortie") },
    { label: `contrats sortis en ${M} (non repris)`, cost: sum((k, key) => k !== "ponctuel" && k !== "sortie" && key !== null && !carried.has(key)) },
    { label: `prorata d'entrée en ${M} des contrats repris`, cost: sum((k, key) => k === "entree" && key !== null && carried.has(key)) + (hireInM - hireFull) },
  ].filter((g) => g.cost !== 0);
  const refBaseCost = contracts.filter((c) => c.base).reduce((s, c) => s + c.base!.salaryCents + roundDiv(BigInt(c.base!.salaryCents) * BigInt(c.base!.refCotisationsCents), BigInt(c.base!.refBrutCents)), 0);
  const residual = pm.cost - refBaseCost - gapItems.reduce((s, g) => s + g.cost, 0);
  if (residual !== 0) gapItems.push({ label: "écart non ventilé", cost: residual });

  const source = `projeté — scénario « ${parent.name} »`;
  const prior: PriorMonth[] = [
    ...(base.prior ?? []),
    ...proj.months.map((m): PriorMonth => (m.kind === "nd" ? { month: m.month, kind: "nd", reason: m.reasons.join(" ; "), source } : { month: m.month, kind: "value", cost: m.cost, brut: m.brut, charges: m.charges, headcount: m.headcount, etp4: m.etp4, etpNd: m.etpNd, source })),
  ];
  return {
    kind: "value",
    base: {
      ...base,
      refMonth: M,
      contracts,
      refMasse: pm.cost,
      refBaseCost, // contrats présents fin M seulement (les entrées postérieures n'ont pas de coût en M)
      origin: { kind: "scenario", scenarioId: parent.id, scenarioName: parent.name, month: M, at, notCarried, gap: gapItems },
      prior,
      upcoming,
    },
  };
}
