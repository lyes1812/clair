import type { FindingSeverity } from "./referential/types";

// Constats du référentiel : un cas limite n'est jamais tranché en silence, il est affiché.
export const FINDING_LABELS: Record<string, { case: string; label: string; severity: FindingSeverity }> = {
  "simultaneous-contracts": { case: "A1", label: "Contrats simultanés pour une même personne", severity: "info" },
  rehire: { case: "A2", label: "Réembauche : nouveau contrat après une fin", severity: "info" },
  "continuity-same-person": { case: "A3", label: "Contrat continu (fin J, début J+1, même personne)", severity: "info" },
  "establishment-closed": { case: "C5 bis", label: "Établissement réputé fermé : plus de déclaration, contrats terminés ou transférés", severity: "info" },
  "identity-change": { case: "A4", label: "Même contrat sous deux identifiants de personne : NTT→NIR ou NIR corrigé ? à vérifier", severity: "check" },
  "ntt-identity": { case: "A4", label: "Personne identifiée par un identifiant temporaire (NTT)", severity: "info" },
  "person-without-contract": { case: "B5/C8", label: "Personne sans contrat connu", severity: "info" },
  "contract-without-person": { case: "B6", label: "Contrat sans collaborateur dans la source", severity: "check" },
  "person-not-in-collaborators": { case: "B6 bis", label: "Collaborateur référencé par un contrat mais absent de la collection collaborateurs", severity: "check" },
  pending: { case: "B2", label: "Contrat en attente chez PayFit", severity: "info" },
  "no-start-date": { case: "B3", label: "Contrat sans date de début : non positionnable", severity: "check" },
  "end-not-provided": { case: "B8", label: "Contrat à durée déterminée sans date de fin renseignée", severity: "check" },
  "nature-unknown": { case: "C11", label: "Nature de contrat absente", severity: "info" },
  "end-conflict": { case: "C6", label: "Deux dates de fin différentes déclarées pour le même contrat", severity: "check" },
  "declared-after-end": { case: "C6 bis", label: "Contrat déclaré après sa fin : régularisation ou rupture annulée ?", severity: "info" },
  disappeared: { case: "C7", label: "Contrat absent des déclarations suivantes sans fin déclarée", severity: "check" },
  "declared-gap": { case: "C7 bis", label: "Contrat absent d'un mois couvert entre deux déclarations", severity: "check" },
  "declared-before-start": { case: "C9 bis", label: "Contrat déclaré avant sa date de début", severity: "info" },
  renumbered: { case: "C10", label: "Contrat renuméroté ou date de début corrigée ? à vérifier", severity: "check" },
  "multi-establishment": { case: "C5", label: "Contrat déclaré par deux établissements le même mois", severity: "info" },
  "fraction-duplicate": { case: "C4", label: "Personne présente dans deux fractions retenues du même mois", severity: "info" },
  "attributes-changed": { case: "C12", label: "Nature ou quotité modifiée entre deux mois (avenant ?)", severity: "info" },
  "negative-time": { case: "E1", label: "Temps négatif (régularisation)", severity: "check" },
  "time-missing": { case: "F2", label: "Contrat présent sans ligne de temps dans un mois lu", severity: "check" },
  "time-outside-contract": { case: "E1 bis", label: "Ligne de temps PayFit hors de la période du contrat (régularisation ?)", severity: "info" },
  "time-without-contract": { case: "E1 ter", label: "Ligne de temps PayFit sans contrat positionnable (contrat inconnu ou sans date de début)", severity: "check" },
  "fraction-conflict": { case: "C4 bis", label: "Attributs différents entre deux fractions retenues du même mois : la première fait foi, à vérifier", severity: "check" },
  "lower-bound-window": { case: "B4", label: "Mois antérieurs à la fenêtre de conservation PayFit : effectifs en borne basse", severity: "info" },
};

export function findingLabel(code: string): string {
  return FINDING_LABELS[code]?.label ?? code;
}
