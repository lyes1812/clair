// Libellés français des collections lues, partagés par les écrans Données.
export const COLLECTION_LABELS: Record<string, string> = {
  company: "Société",
  collaborators: "Collaborateurs",
  contracts: "Contrats",
  worked_time: "Temps par contrat et par mois",
  absences: "Absences",
  payroll_status: "Statut de paie par mois",
  ledger_lines: "Lignes du journal comptable",
};

export const PROVIDER_LABELS = { payfit: "PayFit", pennylane: "Pennylane" } as const;

export const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
