// Libellés de la nomenclature DSN pour les codes rencontrés ; un code hors table est affiché tel quel avec « libellé n.d. ».
export const CONTRACT_NATURE_LABELS: Record<string, string> = {
  "01": "CDI",
  "02": "CDD",
  "03": "Contrat de mission (intérim)",
  "07": "CDI intermittent",
  "08": "CDD intermittent",
  "09": "Contrat de travail temporaire",
  "10": "Contrat de travail saisonnier",
  "20": "Contrat de travail intérimaire",
  "29": "Convention de stage",
  "80": "Mandat social",
  "81": "Mandat d'élu",
  "82": "Contrat de travail lié à l'activité de l'élu",
};

export const END_REASON_LABELS: Record<string, string> = {
  "011": "Licenciement suite à liquidation judiciaire ou à redressement judiciaire",
  "014": "Licenciement pour motif économique",
  "020": "Licenciement pour autre motif",
  "026": "Fin de contrat à durée déterminée",
  "031": "Fin de période d'essai à l'initiative de l'employeur",
  "032": "Fin de période d'essai à l'initiative du salarié",
  "033": "Rupture anticipée d'un CDD à l'initiative de l'employeur",
  "034": "Rupture anticipée d'un CDD à l'initiative du salarié",
  "035": "Rupture conventionnelle",
  "036": "Retraite à l'initiative du salarié",
  "037": "Retraite à l'initiative de l'employeur",
  "038": "Décès",
  "039": "Fin de mission d'intérim",
  "043": "Rupture anticipée d'un commun accord",
  "058": "Prise d'acte de la rupture",
  "059": "Démission",
};

// Unité de la quotité (S21.G00.40.011) et modalité d'exercice du temps (S21.G00.40.014).
export const QUOTA_UNIT_LABELS: Record<string, string> = {
  "10": "heures",
  "12": "journées",
  "20": "forfait jours",
  "21": "forfait heures",
  "90": "autre unité",
  "99": "sans objet",
};
export const MODALITY_LABELS: Record<string, string> = {
  "10": "temps plein",
  "20": "temps partiel",
  "21": "temps partiel thérapeutique",
  "99": "non concerné",
};

export function quotaUnitLabel(code: string | null): string {
  if (!code) return "unité n.d.";
  return QUOTA_UNIT_LABELS[code] ?? `unité ${code}`;
}

export function contractNatureLabel(code: string | null): string {
  if (!code) return "n.d.";
  return CONTRACT_NATURE_LABELS[code] ? `${CONTRACT_NATURE_LABELS[code]} (${code})` : `code ${code} — libellé n.d.`;
}

export function endReasonLabel(code: string | null): string {
  if (!code) return "n.d.";
  return END_REASON_LABELS[code] ? `${END_REASON_LABELS[code]} (${code})` : `code ${code} — libellé n.d.`;
}
