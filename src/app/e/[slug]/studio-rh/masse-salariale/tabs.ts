export type MsTab = "synthese" | "fixe-variable" | "paie-compta" | "croisee" | "organisation" | "reel" | "suivi" | "ecart" | "analyse";
export const MS_TAB_GROUPS = [
  { key: 'synthese', label: 'Synthèse', keys: ['synthese'] },
  { key: 'decomposition', label: 'Décomposition', keys: ['fixe-variable', 'paie-compta', 'croisee', 'organisation'] },
  { key: 'ecarts', label: 'Écarts', keys: ['reel', 'suivi', 'ecart', 'analyse'] },
] as const;

// Entrées partagées par les onglets et le menu général. Les vues livrées gardent
// explicitement soon:false pour le contrat commun de navigation.
export const MS_PREVU = [
  { key: "croisee", label: "Masse salariale croisée", path: "/croisee", soon: false },
  { key: "organisation", label: "Masse salariale par organisation", path: "/organisation", soon: false },
  { key: "reel", label: "Écart réel", path: "/reel", soon: false },
  { key: "suivi", label: "Suivi réel / budget", path: "/suivi", soon: false },
] as const;
