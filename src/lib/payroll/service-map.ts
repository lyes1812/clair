import { serviceOf, type LedgerLine } from "./engine";
import { classify, gridRubrics, type AccountGrid } from "./grid";

// Service d'un contrat pour un mois : celui de ses lignes de brut, à défaut de ses autres lignes de charges de personnel ;
// les contreparties (42/43…) ne comptent pas. Sans ligne : absent de la table (non ventilé). Module sans base ni next,
// partagé par l'écran Masse salariale (context.ts) et le script d'administration (workspace-ops.ts).
export function buildContractServiceMap(lines: LedgerLine[], grid: AccountGrid, axis: string): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const rank = new Map<string, number>();
  const rubrics = gridRubrics(grid);
  for (const l of lines) {
    if (!l.contractId) continue;
    const c = classify(l.accountId, rubrics);
    const r = c.rubric?.role === "brut" ? 2 : c.rubric || c.payroll ? 1 : 0;
    const k = `${l.month}|${l.contractId}`;
    if (r > (rank.get(k) ?? 0)) {
      rank.set(k, r);
      map.set(k, serviceOf(l, axis));
    }
  }
  return map;
}
