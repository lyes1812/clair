import { classify } from "@/lib/payroll/grid";
import { gridRubrics } from "@/lib/payroll/grid";
import { monthPayroll, serviceOf, withService, type JournalInput } from "@/lib/payroll/engine";
import { monthRange } from "@/lib/connectors/months";
import { contributionRubric, type ServiceFilter } from "./versions";
import type { BaseSnapshot, Projection } from "./types";

// Détail individuel d'un écart : pour une rubrique et une période, la valeur de chaque salarié (contrat ou embauche) dans
// une version. Clé = identifiant externe du contrat PayFit (ou « embauche:… ») ; les lignes sans salarié (enveloppes,
// éléments saisis pour toute l'entreprise, lignes de journal sans contrat) sont regroupées sous la clé « hors-salarie ».
export type ZoomRubric = "masse" | "brut" | "remun" | "primes" | "indemnites" | "charges";
export const ZOOM_RUBRICS: Record<ZoomRubric, string> = {
  masse: "Masse salariale chargée", brut: "Total brut", remun: "Rémunération de base (salaires, gratifications de stage)",
  primes: "Primes et éléments variables", indemnites: "Indemnités et avantages", charges: "Charges patronales (cotisations et taxes)",
};
export const HORS_SALARIE = "hors-salarie";
export type ZoomSource =
  | { kind: "reel"; journal: JournalInput; filter: ServiceFilter }
  | { kind: "scenario"; base: BaseSnapshot; proj: Projection; journal: JournalInput | null; filter: ServiceFilter }
  | { kind: "budget" };
export type Zoom = { kind: "value"; byKey: Map<string, number> } | { kind: "nd"; reason: string };

function journalMonth(j: JournalInput, filter: ServiceFilter, m: string, rubric: ZoomRubric, out: Map<string, number>): string | null {
  if (j.openMonths.includes(m)) return `${m} : paie non clôturée à la lecture`;
  const mp = monthPayroll(filter ? withService(j, filter.value) : j, m);
  if (mp.kind === "nd") return `${m} : ${mp.nd.reason}`;
  const rubrics = gridRubrics(j.grid);
  for (const l of j.lines) {
    if (l.month !== m) continue;
    if (filter && serviceOf(l, j.serviceAxis) !== filter.value) continue;
    const c = classify(l.accountId, rubrics);
    if (!c.rubric || c.rubric.role === "hors-masse") continue;
    const v = (l.debitCents ?? 0) - (l.creditCents ?? 0);
    const id = c.rubric.id;
    const inRubric =
      rubric === "masse" ||
      (rubric === "brut" && c.rubric.role === "brut") ||
      (rubric === "remun" && (id === "salaires" || id === "stages")) ||
      (rubric === "primes" && id === "primes") ||
      (rubric === "indemnites" && id === "indemnites") ||
      (rubric === "charges" && c.rubric.role === "cotisations");
    if (!inRubric) continue;
    const k = l.contractId ?? HORS_SALARIE;
    out.set(k, (out.get(k) ?? 0) + v);
  }
  return null;
}

export function zoomOf(src: ZoomSource, months: string[], rubric: ZoomRubric): Zoom {
  if (src.kind === "budget") return { kind: "nd", reason: "budget saisi : montant global seulement, aucun détail par salarié" };
  const out = new Map<string, number>();
  const reasons: string[] = [];
  if (src.kind === "reel") {
    for (const m of months) {
      const r = journalMonth(src.journal, src.filter, m, rubric, out);
      if (r) reasons.push(r);
    }
    return reasons.length ? { kind: "nd", reason: reasons.join(" ; ") } : { kind: "value", byKey: out };
  }
  const { base, proj, journal, filter } = src;
  const external = new Map(base.contracts.map((c) => [c.contractKey, c.externalId]));
  for (const m of months) {
    if (m <= base.refMonth) {
      const a = base.actuals.find((x) => x.month === m);
      if (!a || a.kind === "nd") {
        reasons.push(`${m} : ${a ? a.reason : "réel non lu"}`);
        continue;
      }
      if (!journal) {
        reasons.push(`${m} : journal de paie courant indisponible`);
        continue;
      }
      const live = monthPayroll(journal, m);
      if (live.kind !== "value" || live.masse !== a.masse || live.brut !== a.brut) {
        reasons.push(`${m} : lecture PayFit modifiée depuis la création du scénario, détail courant différent du réel figé`);
        continue;
      }
      const r = journalMonth(journal, filter, m, rubric, out);
      if (r) reasons.push(r);
      continue;
    }
    if (proj.kind === "error") {
      reasons.push(`${m} : projection refusée`);
      continue;
    }
    const pm = proj.months.find((x) => x.month === m);
    if (!pm) {
      reasons.push(`${m} : hors de l'horizon du scénario`);
      continue;
    }
    if (pm.kind === "nd") {
      reasons.push(`${m} : ${pm.reasons.join(" ; ")}`);
      continue;
    }
    for (const c of pm.contributions) {
      if (filter && c.service !== filter.value) continue;
      let v: number | null;
      if (rubric === "masse") v = c.cost;
      else if (c.brut === null || c.charges === null) {
        reasons.push(`${m} : « ${c.label} » saisi en coût chargé sans brut ni charges : non ventilable par rubrique`);
        continue;
      } else if (rubric === "charges") v = c.charges;
      else if (rubric === "brut") v = c.brut;
      else v = contributionRubric(c, journal) === rubric ? c.brut : null;
      if (v === null || v === 0) continue;
      const k = c.contractKey ? (external.get(c.contractKey) ?? c.contractKey) : HORS_SALARIE;
      out.set(k, (out.get(k) ?? 0) + v);
    }
  }
  return reasons.length ? { kind: "nd", reason: [...new Set(reasons)].slice(0, 3).join(" ; ") + (reasons.length > 3 ? " …" : "") } : { kind: "value", byKey: out };
}

export const monthsOfYearRange = (year: string, from: string, to: string) => monthRange(`${year}-${from}`, `${year}-${to}`);
