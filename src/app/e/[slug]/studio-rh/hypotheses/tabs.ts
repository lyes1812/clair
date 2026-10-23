// Entrées du scénario, dans l'ordre du cahier (Hypothèses budgétaires), plus « Résultat » (projection, comparaison,
// atterrissage). Une entrée « Prévu » est visible mais n'a pas encore de comportement établi.
export const VUES = [
  { key: "postes", label: "Modifications de postes" },
  { key: "embauches", label: "Embauches prévisionnelles" },
  { key: "bases", label: "Bases individuelles" },
  { key: "env-service", label: "Enveloppes par service" },
  { key: "env-rubrique", label: "Enveloppes par rubrique" },
  { key: "globales", label: "Hypothèses globales" },
  { key: "societes", label: "Hypothèses par société", soon: true },
  { key: "ctrl-effectifs", label: "Contrôles effectifs" },
  { key: "ctrl-changements", label: "Contrôles des changements" },
  { key: "resultat", label: "Résultat" },
] as const;
export type VueKey = (typeof VUES)[number]["key"];
export type Sous = "projection" | "comparaison" | "atterrissage";
export const SOUS: { key: Sous; label: string }[] = [
  { key: "projection", label: "Projection" },
  { key: "comparaison", label: "Comparaison" },
  { key: "atterrissage", label: "Atterrissage" },
];

// Anciens liens (onglets d'avant le cahier) : ils continuent d'ouvrir l'écran qui porte désormais leur contenu.
export function resolveVue(vue: string, sous: string): { vue: VueKey; sous: Sous } {
  const legacy: Record<string, { vue: VueKey; sous?: Sous }> = {
    salaries: { vue: "postes" },
    hypotheses: { vue: "ctrl-changements" },
    projection: { vue: "resultat", sous: "projection" },
    comparaison: { vue: "resultat", sous: "comparaison" },
    atterrissage: { vue: "resultat", sous: "atterrissage" },
  };
  const s = SOUS.some((x) => x.key === sous) ? (sous as Sous) : "projection";
  if (legacy[vue]) return { vue: legacy[vue].vue, sous: legacy[vue].sous ?? s };
  if (VUES.some((x) => x.key === vue)) return { vue: vue as VueKey, sous: s };
  return { vue: "resultat", sous: s };
}
