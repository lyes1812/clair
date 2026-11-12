export const RESTRUCTURING_VIEWS = [
  { id: "overview", label: "Vue d’ensemble" },
  { id: "measures", label: "Mesures" },
  { id: "monthly", label: "Impacts mensuels" },
  // Cap 13, lot 1 : lecture du FEC, sans scénario RH.
  { id: "crisis", label: "Cap 13 · Trésorerie et dettes" },
  // Cap 13, lot 2a : plan de base saisi dans Clair, solde de départ lu dans le FEC ou saisi.
  { id: "cash", label: "Cap 13 · Trésorerie 13 semaines" },
] as const;
export type RestructuringViewId = typeof RESTRUCTURING_VIEWS[number]["id"];
