// Seulement un SIREN ou un SIRET explicite ; ni nom commercial ni numéro de TVA déduit.
export function sourceSiren(identifier: unknown): string | null {
  if (typeof identifier !== "string") return null;
  const digits = identifier.replace(/[\s.-]/g, "");
  return /^(?:\d{9}|\d{14})$/.test(digits) ? digits.slice(0, 9) : null;
}

export const API_COMPANY_IDENTITY_WARNING = "SIREN de la source API non vérifiable : vérifier le rattachement de la société.";
