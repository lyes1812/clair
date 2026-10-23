// Entrées de la famille KPI RH, dans l'ordre du cahier. « Suivi des effectifs » est l'écran historique complet (tous les
// indicateurs, le tableau mois par mois et la ventilation par catégorie) ; Turnover et Absentéisme en sont des lectures
// ciblées ; Effectifs mensuels ventile une mesure par axe. Une entrée « Prévu » n'a pas encore de comportement établi.
export const KPI_VUES = [
  { key: "turnover", label: "Turnover" },
  { key: "absenteisme", label: "Absentéisme" },
  { key: "effectifs", label: "Effectifs mensuels" },
  { key: "suivi", label: "Suivi des effectifs" },
  { key: "pyramide", label: "Pyramide", soon: true },
  { key: "salaires", label: "Analyse des salaires", soon: true },
  { key: "livre", label: "Livre de paie", soon: true },
  { key: "publisher", label: "Publisher", soon: true },
] as const;
export type KpiVue = (typeof KPI_VUES)[number]["key"];
export const resolveKpiVue = (v: string): KpiVue => (KPI_VUES.some((x) => x.key === v) ? (v as KpiVue) : "suivi");
