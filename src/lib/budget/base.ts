import { monthPayroll, serviceOf, type JournalInput } from "@/lib/payroll/engine";
import { classify, gridRubrics } from "@/lib/payroll/grid";
import { monthEnd } from "@/lib/dates";
import { presenceAt } from "@/lib/rh/headcount";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import type { KpiInput } from "@/lib/rh/kpi/types";
import { roundDiv } from "./engine";
import { CURRENCY, type ActualMonth, type BaseContract, type BaseSnapshot } from "./types";

// Base figée d'un scénario, construite depuis la lecture PayFit appliquée (journal de paie) et le référentiel
// Collaborateurs. Mois de référence = dernier mois clos avant la bascule. Calcul pur.
//
// Base d'un contrat présent à la fin du mois de référence : rubriques « Salaires » et « Gratifications de stage » de
// ses lignes du mois (primes et indemnités exclues : elles se projettent par hypothèse) ; charges au taux observé du
// contrat ce mois-là = cotisations ÷ brut total de ses lignes. Un contrat entré dans le mois, sans ligne de paie ou
// sans cotisation rattachée a une base n.d. à saisir (correction de base) : rien n'est reconstitué.
export const BASE_RUBRICS = ["salaires", "stages"] as const;

export type BaseInput = { input: JournalInput; kpi: KpiInput; refMonth: string; syncId: string; readAt: string };

export function buildBase({ input, kpi, refMonth, syncId, readAt }: BaseInput): { kind: "value"; base: BaseSnapshot } | { kind: "nd"; reason: string } {
  if (!input.months.includes(refMonth)) return { kind: "nd", reason: `mois de référence ${refMonth} hors de la lecture PayFit appliquée` };
  if (input.openMonths.includes(refMonth)) return { kind: "nd", reason: `paie de ${refMonth} non clôturée à la lecture : le mois de référence doit être clos` };
  const ref = monthPayroll(input, refMonth);
  if (ref.kind === "nd") return { kind: "nd", reason: `mois de référence ${refMonth} : ${ref.nd.reason}` };

  const rubrics = gridRubrics(input.grid);
  type Acc = { recurring: number; brut: number; cot: number; lines: number; cotLines: number; service: string | null; hasBrut: boolean };
  const acc = new Map<string, Acc>();
  for (const l of input.lines) {
    if (l.month !== refMonth || !l.contractId) continue;
    const c = classify(l.accountId, rubrics);
    if (!c.rubric) continue;
    const a = acc.get(l.contractId) ?? { recurring: 0, brut: 0, cot: 0, lines: 0, cotLines: 0, service: null, hasBrut: false };
    const v = (l.debitCents ?? 0) - (l.creditCents ?? 0);
    a.lines += 1;
    if (c.rubric.role === "brut") {
      a.brut += v;
      if ((BASE_RUBRICS as readonly string[]).includes(c.rubric.id)) a.recurring += v;
      if (!a.hasBrut) {
        a.service = serviceOf(l, input.serviceAxis);
        a.hasBrut = true;
      }
    } else if (c.rubric.role === "cotisations") {
      a.cot += v;
      a.cotLines += 1;
    }
    acc.set(l.contractId, a);
  }

  const end = monthEnd(refMonth);
  const etp = etpMonthEnd(kpi, refMonth);
  const persons = new Map(kpi.data.persons.map((p) => [p.personKey, p]));
  const contracts: BaseContract[] = [];
  for (const c of kpi.data.contracts) {
    const pr = presenceAt(kpi.data, c, end);
    if (pr.state === "absent") continue;
    const p = c.personKey ? persons.get(c.personKey) : undefined;
    const label = (p && [p.usageName ?? p.familyName, p.givenNames].filter(Boolean).join(" ").trim()) || c.externalId;
    const a = acc.get(c.externalId);
    const counted = c.nature !== null && kpi.params.natures.includes(c.nature);
    let etp4: number | null = null;
    let etpNd: string | null = null;
    if (!counted) etpNd = "nature non comptée dans l'effectif";
    else if (etp.kind === "nd") etpNd = etp.nd.reason;
    else if (etp.kind !== "exact") etpNd = `ETP fin ${refMonth} en borne basse`;
    else {
      const ctr = etp.contributions.find((x) => x.contractKey === c.contractKey);
      const miss = etp.missing.find((x) => x.contractKey === c.contractKey);
      if (ctr) etp4 = ctr.etp4;
      else etpNd = miss ? miss.nd.reason : "ETP n.d.";
    }
    let baseNd: string | null = null;
    if (pr.state === "nd") baseNd = `présence fin ${refMonth} n.d. : ${pr.nd.reason}`;
    else if (c.startDate !== null && c.startDate > `${refMonth}-01`) baseNd = `entré le ${c.startDate} : mois de référence incomplet`;
    else if (!a || !a.hasBrut) baseNd = `aucune ligne de brut en ${refMonth} pour ce contrat`;
    else if (a.recurring <= 0) baseNd = `salaire de ${refMonth} nul ou négatif (rubriques Salaires et Stages)`;
    else if (a.cotLines === 0) baseNd = `aucune cotisation rattachée au contrat en ${refMonth} : taux de charges n.d.`;
    else if (a.brut <= 0) baseNd = `brut total de ${refMonth} nul ou négatif : taux de charges n.d.`;
    contracts.push({
      contractKey: c.contractKey,
      externalId: c.externalId,
      label,
      service: a?.service ?? null,
      startDate: c.startDate,
      endDate: c.endDate,
      counted,
      etp4,
      etpNd,
      base: baseNd || !a ? null : { salaryCents: a.recurring, refBrutCents: a.brut, refCotisationsCents: a.cot },
      baseNd,
    });
  }
  contracts.sort((x, y) => x.label.localeCompare(y.label) || x.contractKey.localeCompare(y.contractKey));

  const actuals: ActualMonth[] = input.months
    .filter((m) => m <= refMonth)
    .sort()
    .map((m) => {
      const mp = monthPayroll(input, m);
      if (mp.kind === "nd") return { month: m, kind: "nd", reason: mp.nd.reason };
      const e = etpMonthEnd(kpi, m);
      const exact = e.kind === "exact" ? e : null;
      return {
        month: m,
        kind: "value",
        brut: mp.brut,
        cotisations: mp.cotisations,
        masse: mp.masse,
        headcount: exact ? exact.headcount.contracts : null,
        etp4: exact ? exact.etp4 : null,
        etpNd: exact ? null : e.kind === "nd" ? e.nd.reason : "ETP en borne basse",
      };
    });

  const known = contracts.every((c) => c.base !== null);
  const refBaseCost = known ? contracts.reduce((s, c) => s + c.base!.salaryCents + roundDiv(BigInt(c.base!.salaryCents) * BigInt(c.base!.refCotisationsCents), BigInt(c.base!.refBrutCents)), 0) : null;
  return { kind: "value", base: { currency: CURRENCY, refMonth, syncId, readAt, contracts, actuals, refMasse: ref.masse, refBaseCost } };
}
