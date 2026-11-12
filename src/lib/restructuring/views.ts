export const RESTRUCTURING_VIEWS = [
  { id: "overview", label: "Vue d’ensemble" },
  { id: "measures", label: "Mesures" },
  { id: "monthly", label: "Impacts mensuels" },
  // Cap 13, lot 1 : lecture du FEC, sans scénario RH.
  { id: "crisis", label: "Cap 13 · Trésorerie et dettes" },
] as const;
export type RestructuringViewId = typeof RESTRUCTURING_VIEWS[number]["id"];
