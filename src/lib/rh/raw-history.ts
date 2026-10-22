import { payfitExactFrom } from "./headcount";
import type { RhBuildData } from "./referential/types";

// Limite de conservation PayFit telle que constatée dans un référentiel : mois de couverture en borne basse et date à partir de
// laquelle l'effectif est complet. null si aucun mois n'est concerné.
export type PayfitHistoryLimit = { lowerFrom: string; lowerTo: string; exactFrom: string | null };

export function payfitHistoryLimit(data: RhBuildData): PayfitHistoryLimit | null {
  const lower = data.coverage.filter((c) => c.presenceStatus === "lower_bound").map((c) => c.month).sort();
  if (!lower.length) return null;
  return { lowerFrom: lower[0], lowerTo: lower[lower.length - 1], exactFrom: payfitExactFrom(data) };
}

// Mode « brut » (décision de Lyes, 22/10/2026) : les mois antérieurs à la limite de conservation PayFit sont traités comme
// couverts. Les chiffres sont ceux que l'API renvoie (rien n'est ajouté ni reconstitué) ; la limite est dite une seule fois
// en tête d'écran au lieu de « ≥ » et de « n.d. » sur chaque chiffre concerné. Le référentiel stocké n'est pas modifié.
export function rawPayfitHistory<T extends RhBuildData>(data: T): T {
  if (data.build.source !== "payfit" || !data.coverage.some((c) => c.presenceStatus === "lower_bound")) return data;
  return {
    ...data,
    coverage: data.coverage.map((c) => (c.presenceStatus === "lower_bound" ? { ...c, presenceStatus: "complete" as const, presenceReason: null } : c)),
    events: data.events.map((e) => (e.flags.includes("lower_bound_window") ? { ...e, flags: e.flags.filter((f) => f !== "lower_bound_window") } : e)),
    findings: data.findings.filter((f) => f.code !== "lower-bound-window"),
  };
}
