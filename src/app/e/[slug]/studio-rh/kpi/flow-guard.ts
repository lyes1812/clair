import { confidentialiteReason, isHidden, maskReason, type MaskStatus } from "@/lib/confidentialite";
import { columnStatus } from "@/lib/confidentialite/columns";
import { countedMovements, flowColumn, flowCounts } from "@/lib/confidentialite/flows";
import { crossFlowColumn, crossKey, movementItems, splitLabel, type SplitAxis } from "@/lib/confidentialite/splits";
import type { Count } from "@/lib/rh/headcount";
import { delta } from "@/lib/rh/kpi/compare";
import { monthMovements } from "@/lib/rh/kpi/turnover";
import { kpiNd, type KpiDashboard, type KpiInput, type KpiScope, type MovementTotal, type Turnover } from "@/lib/rh/kpi/types";

// Garde des flux du périmètre (KPI RH, filtres Établissement et Nature). Sous un filtre, les entrées et les sorties du périmètre, mois
// par mois, sont une cellule d'une répartition dont le total est publié : la nature retenue est l'une des cellules « dont <nature> » des
// entrées (ou des sorties) du mois, publiées par la croisée 02 (journal des mouvements, natureCells) et par KPI RH › Effectifs mensuels
// (axe « Contrat (nature) ») ; l'établissement retenu est l'une des cellules de la répartition par établissement des mouvements de
// l'entreprise (Effectifs mensuels, axe « Établissement »). Le flux du périmètre est n.d. un mois donné, avec la raison du seuil (écran
// et export), dès que sa cellule est masquée, principal ou secondaire : mêmes groupes (splits.ts : mouvements comptés de l'entrée SANS
// filtre, rangés par la nature ou l'établissement du mouvement, vus par leur personne), même colonne canonique que les deux autres
// écrans (flowColumn : ordre des libellés, groupe sans mouvement hors de la relation, valeur d'ordre = nombre de mouvements). Total du
// mois n.d. ou en borne basse : la répartition n'est pas publiée, masquage principal seul.
// Les deux filtres ensemble : la cellule est un croisement du tableau établissement × nature du mois, masqué en une seule passe avec
// pour marges les cellules des filtres seuls, à leur statut canonique (crossFlowColumn, splits.ts) ; chaque partition masquée seule
// laissait lire un croisement par différence d'un filtre à l'autre.
// Valeur affichée ≠ cellule contrôlée : l'écran et l'export affichent les mouvements comptés de l'entrée FILTRÉE, où la neutralisation
// des contrats continus dépend du périmètre (le partenaire d'une sortie, hors du filtre, n'y est plus compté). Quand ce compte diffère de
// celui de la cellule canonique, le flux du mois est n.d. (raison du seuil) : la valeur affichée n'est pas celle que la colonne protège.
// Les sommes publiées qui contiennent un mois masqué ne sont pas affichées non plus (raison du seuil) : le total de la période (ligne
// « Période »), et le turnover de la période et de N-1 dès qu'il lit un flux masqué (sorties ; entrées aussi pour la formule « moyenne
// des entrées et des sorties »). Les autres mois restent affichés : leurs cellules ont le même statut sur les trois écrans.
export type FlowKind = "entries" | "exits";
// months : mois de la période et de N-1 → raison du n.d. de chaque flux masqué (absent : affiché).
export type FlowGuard = { seuil: number; months: Map<string, Partial<Record<FlowKind, string>>> };

export function flowGuard(p: { base: KpiInput; scope: KpiScope; months: readonly string[]; establishments: readonly string[]; natures: readonly string[]; seuil: number }): FlowGuard | null {
  const { scope, seuil } = p;
  const etab = scope.establishments?.[0];
  const nature = scope.nature || undefined;
  if (etab === undefined && nature === undefined) return null;
  // Entrées du moteur, une seule fois (mémo du moteur par entrée) : l'entreprise sans filtre (cellules canoniques) et le périmètre.
  const whole: KpiInput = { ...p.base, scope: {} };
  const scoped: KpiInput = { ...p.base, scope };
  const known = (nature === undefined || p.natures.includes(nature)) && (etab === undefined || p.establishments.includes(etab));
  const status = (m: string, kind: "entry" | "exit"): MaskStatus => {
    const shownMv = monthMovements(scoped, m);
    const shown = countedMovements(shownMv, kind);
    // Valeur inconnue des listes de l'espace : le périmètre seul, masquage principal (jamais une valeur affichée sans contrôle).
    if (!known) return flowColumn(flowCounts(shown.map((x) => ({ group: "périmètre", contract: x.row.contract.contractKey, person: x.row.contract.personKey }))), seuil, false).get("périmètre") ?? "shown";
    const mv = monthMovements(whole, m);
    const total: Count = kind === "entry" ? mv.entries : mv.exits;
    let st: MaskStatus;
    let canonical: number;
    if (etab !== undefined && nature !== undefined) {
      const cross = crossFlowColumn(mv, kind, seuil, total.kind === "exact");
      const key = crossKey(splitLabel("etablissement", etab), splitLabel("nature", nature));
      canonical = cross.counts[key]?.contracts ?? 0;
      st = columnStatus(cross.status, key, canonical);
    } else {
      const axis: SplitAxis = etab !== undefined ? "etablissement" : "nature";
      const counts = flowCounts(movementItems(mv, kind, axis));
      const label = splitLabel(axis, etab ?? nature ?? null);
      canonical = counts[label]?.contracts ?? 0;
      st = columnStatus(flowColumn(counts, seuil, total.kind === "exact"), label, canonical);
    }
    // Compte affiché (entrée filtrée) différent de la cellule contrôlée : n.d., raison du seuil.
    const displayed: Count = kind === "entry" ? shownMv.entries : shownMv.exits;
    if (!isHidden(st) && displayed.kind !== "nd" && shown.length !== canonical) return "masked";
    return st;
  };
  const months = new Map<string, Partial<Record<FlowKind, string>>>();
  for (const m of p.months) {
    const out: Partial<Record<FlowKind, string>> = {};
    for (const [kind, k] of [["entry", "entries"], ["exit", "exits"]] as const) {
      const st = status(m, kind);
      if (isHidden(st)) out[k] = maskReason(st, seuil)!;
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
