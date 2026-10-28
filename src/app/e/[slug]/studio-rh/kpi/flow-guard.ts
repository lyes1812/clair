import { confidentialiteReason, isHidden, maskReason, type MaskStatus } from "@/lib/confidentialite";
import { countedMovements, flowCounts, flowPartitionStatus, type FlowCount } from "@/lib/confidentialite/flows";
import type { Count } from "@/lib/rh/headcount";
import { delta } from "@/lib/rh/kpi/compare";
import { monthMovements } from "@/lib/rh/kpi/turnover";
import { kpiNd, type KpiDashboard, type KpiInput, type KpiScope, type MovementTotal, type Turnover } from "@/lib/rh/kpi/types";
import type { EventDraft } from "@/lib/rh/referential/types";

// Garde des flux du périmètre (KPI RH, filtres Établissement et Nature). Sous un filtre, les entrées et les sorties du périmètre, mois
// par mois, sont une cellule d'une répartition dont le total est publié : la nature retenue est l'une des cellules « dont <nature> » des
// entrées (ou des sorties) du mois, publiées par la croisée 02 (journal des mouvements, natureCells) ; l'établissement retenu est l'une
// des cellules de la répartition par établissement des mouvements de l'entreprise (total publié sans filtre). Le flux du périmètre est
// n.d. un mois donné, avec la raison du seuil (écran et export), dès que sa cellule est masquée, principal ou secondaire : même
// partition, mêmes mouvements comptés (monthMovements de l'entrée sans le filtre examiné), même fonction de statut que la croisée 02
// (flowPartitionStatus, src/lib/confidentialite/flows.ts). Les deux filtres ensemble : nature dans l'établissement retenu, établissement
// dans la nature retenue (même découpage que la garde des effectifs, scopeGuard). Total du mois n.d. ou en borne basse : la répartition
// n'est pas publiée, masquage principal seul.
// Les sommes publiées qui contiennent un mois masqué ne sont pas affichées non plus (raison du seuil) : le total de la période (ligne
// « Période »), et le turnover de la période et de N-1 dès qu'il lit un flux masqué (sorties ; entrées aussi pour la formule « moyenne
// des entrées et des sorties »). Les autres mois restent affichés : ils sont publiés tels quels dans la croisée 02, ils ne peuvent pas
// servir de protection secondaire.
export type FlowKind = "entries" | "exits";
// months : mois de la période et de N-1 → raison du n.d. de chaque flux masqué (absent : affiché).
export type FlowGuard = { seuil: number; months: Map<string, Partial<Record<FlowKind, string>>> };

const REST = "\u0000reste"; // mouvements d'aucune valeur de la liste (sans établissement, par exemple) : jamais un code de la source
type Partition = { values: readonly string[]; selected: string; input: KpiInput; key: (e: EventDraft) => string | null };

export function flowGuard(p: { base: KpiInput; scope: KpiScope; months: readonly string[]; establishments: readonly string[]; natures: readonly string[]; seuil: number }): FlowGuard | null {
  const { scope, seuil } = p;
  const etab = scope.establishments?.[0];
  if (etab === undefined && !scope.nature) return null;
  // Entrée de chaque partition : le périmètre élargi (sans le filtre examiné), une seule fois (mémo du moteur par entrée).
  const parts: Partition[] = [];
  if (scope.nature) parts.push({ values: p.natures, selected: scope.nature, input: { ...p.base, scope: { establishments: scope.establishments } }, key: (e) => e.nature });
  if (etab !== undefined) parts.push({ values: p.establishments, selected: etab, input: { ...p.base, scope: { nature: scope.nature } }, key: (e) => e.establishmentId });
  const scoped: KpiInput = { ...p.base, scope };
  const status = (part: Partition, m: string, kind: "entry" | "exit"): MaskStatus => {
    const at = part.values.indexOf(part.selected);
    // Valeur inconnue des listes de l'espace : le périmètre seul, masquage principal (jamais une valeur affichée sans contrôle).
    if (at < 0) {
      const own = flowCounts(countedMovements(monthMovements(scoped, m), kind).map((x) => ({ group: "p", contract: x.row.contract.contractKey, person: x.row.contract.personKey })));
      return flowPartitionStatus(own, ["p"], seuil, false)[0];
    }
    const mv = monthMovements(part.input, m);
    const total: Count = kind === "entry" ? mv.entries : mv.exits;
    const items = countedMovements(mv, kind).map((x) => {
      const v = part.key(x.row.event);
      return { group: v !== null && part.values.includes(v) ? v : REST, contract: x.row.contract.contractKey, person: x.row.contract.personKey };
    });
    const counts = flowCounts(items);
    const rest: FlowCount | null = counts[REST] ?? null;
    return flowPartitionStatus(counts, part.values, seuil, total.kind === "exact", rest)[at];
  };
  const months = new Map<string, Partial<Record<FlowKind, string>>>();
  for (const m of p.months) {
    const out: Partial<Record<FlowKind, string>> = {};
    for (const [kind, k] of [["entry", "entries"], ["exit", "exits"]] as const) {
      for (const part of parts) {
        const st = status(part, m, kind);
        if (isHidden(st)) {
          out[k] = maskReason(st, seuil)!;
          break;
        }
      }
    }
    if (out.entries || out.exits) months.set(m, out);
  }
  return { seuil, months };
}

// Tableau de bord après la garde des flux : entrées et sorties masquées des mois de la période (tableau mensuel, graphique, export),
// total de la période et turnover (période, N-1, écart) qui en contiennent un. Une valeur déjà n.d. garde sa raison. Aucune valeur n'est
// recalculée : seules des valeurs publiées deviennent n.d.
export function maskFlows(dash: KpiDashboard, g: FlowGuard | null): KpiDashboard {
  if (!g || g.months.size === 0) return dash;
  const reasonOf = (m: string, k: FlowKind): string | null => g.months.get(m)?.[k] ?? null;
  const hiddenIn = (months: readonly string[], k: FlowKind): boolean => months.some((m) => reasonOf(m, k) !== null);
  // Somme publiée qui contient un mois masqué : masquée pour le protéger (raison du seuil, la même que pour le mois).
  const reason = confidentialiteReason(g.seuil);
  const count = (c: Count, r: string | null): Count => (r === null || c.kind === "nd" ? c : { kind: "nd", nd: { code: "confidentialite", reason: r } });
  const total = (t: MovementTotal, k: FlowKind): MovementTotal => (t.kind !== "nd" && hiddenIn(dash.window.months, k) ? { kind: "nd", nd: kpiNd("confidentialite", reason) } : t);
  const rate = (t: Turnover, months: readonly string[]): Turnover =>
    t.kind !== "nd" && (hiddenIn(months, "exits") || (t.formula === "half_sum" && hiddenIn(months, "entries"))) ? { kind: "nd", formula: t.formula, nd: kpiNd("confidentialite", reason), months: [] } : t;
  const rows = dash.rows.map((r) => {
    const e = reasonOf(r.month, "entries");
    const x = reasonOf(r.month, "exits");
    return e === null && x === null ? r : { ...r, movements: { ...r.movements, entries: count(r.movements.entries, e), exits: count(r.movements.exits, x) } };
  });
  const t = dash.tiles.turnover;
  const current = rate(t.current, t.window.months);
  const previous = rate(t.previous, t.previousWindow.months);
  const turnover = current === t.current && previous === t.previous ? t : { ...t, current, previous, delta: delta(current, previous, (x) => x.ratio, "points", t.previousWindow.label) };
  return { ...dash, rows, movements: { entries: total(dash.movements.entries, "entries"), exits: total(dash.movements.exits, "exits") }, tiles: { ...dash.tiles, turnover } };
}
