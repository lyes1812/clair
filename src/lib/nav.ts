// Organisation figée de l'interface (CLAUDE.md) : ne rien ajouter, fusionner ni masquer sans accord de Lyes.
export type NavItem = { label: string; path: string; module: number; summary: string };

export const DATA_ITEM: NavItem = {
  label: "Données",
  path: "donnees",
  module: 1,
  summary: "Sources DSN et PayFit, synchronisation à la demande, historique des imports et rapprochement DSN–PayFit.",
};

export const STUDIO_RH_ITEMS: NavItem[] = [
  { label: "Collaborateurs", path: "studio-rh/collaborateurs", module: 2, summary: "Fiches individuelles, listes mensuelle et annuelle, entrées et sorties datées." },
  { label: "KPI RH", path: "studio-rh/kpi", module: 3, summary: "ETP, effectif moyen, turnover et absentéisme, avec comparaison N-1 et définitions paramétrables." },
  { label: "Masse salariale", path: "studio-rh/masse-salariale", module: 4, summary: "Brut, charges et coût chargé par mois et par population, rapprochés des comptes 641/645." },
  { label: "Hypothèses budgétaires", path: "studio-rh/hypotheses", module: 5, summary: "Base figée, hypothèses datées, scénarios et projection traçable de la masse salariale." },
  { label: "Reporting social", path: "studio-rh/reporting-social", module: 6, summary: "Index égalité FH et BDESE : entrées prévues, pas encore réalisées." },
];

// Studio Finance demandé par Lyes ; le catalogue et l'ordre du Studio RH restent inchangés.
export const FINANCE_ITEM: NavItem = {
  label: "Studio Finance", path: "studio-finance", module: 7,
  summary: "Compte de résultat issu de Pennylane ou du FEC, modèle, budget, prévision et écarts.",
};
export const RESTRUCTURING_ITEM: NavItem = {
  label: "Studio Restructuring", path: "studio-restructuring", module: 8,
  summary: "Comparer les scénarios RH, les coûts de transition et les économies mensuelles d’un projet de réorganisation.",
};
export const ALL_ITEMS: NavItem[] = [DATA_ITEM, ...STUDIO_RH_ITEMS, FINANCE_ITEM, RESTRUCTURING_ITEM];
