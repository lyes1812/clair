// Libellés français des collections lues, partagés par les écrans Données.
export const COLLECTION_LABELS: Record<string, string> = {
  company: "Société",
  accounts: "Plan comptable",
  collaborators: "Collaborateurs",
  contracts: "Contrats",
  worked_time: "Temps par contrat et par mois",
  absences: "Absences",
  payroll_status: "Statut de paie par mois",
  ledger_lines: "Lignes du journal comptable",
  declarations: "Déclarations",
  people: "Individus déclarés",
  remunerations: "Rémunérations",
  activities: "Activités (temps)",
};

export const PROVIDER_LABELS = { payfit: "PayFit", pennylane: "Pennylane", dsn: "Fichiers DSN", fec: "Fichiers FEC" } as const;

export const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
