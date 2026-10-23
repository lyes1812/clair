import type { FormState } from "./actions";

// Retour d'un formulaire de paramètres : erreur annoncée (alerte) ou enregistrement confirmé (statut).
export function Feedback({ state, testid }: { state: FormState; testid?: string }) {
  if (state?.error) return <p className="error" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="notice ok" role="status" data-testid={testid}>{state.ok}</p>;
  return null;
}
