"use client";
import { useActionState, type ReactNode } from "react";
import { Feedback } from "./Feedback";
import { saveConfidentialite } from "./actions";

// Origine du seuil de confidentialité : non défini, modifié (date déjà mise en forme par la page) ou illisible ; legacy : valeur lue
// par repli sur l'ancien réglage de la Masse salariale croisée, tant qu'aucun seuil n'est enregistré dans cette section.
export type ConfidentialiteOrigin = { kind: "absent" } | { kind: "set"; at: string | null; legacy: boolean } | { kind: "invalid"; legacy: boolean };
export type ConfidentialiteFormProps = {
  slug: string;
  value: number | null; // valeur en vigueur ; null : le champ reste vide, jamais pré-rempli ni suggéré
  origin: ConfidentialiteOrigin;
  disabled: boolean;
  help?: ReactNode; // lien « ? » vers le glossaire, rendu par la page (composant serveur)
};

export const CONFIDENTIALITE_FORM_NOTE = "Aucune valeur par défaut : un champ vidé supprime le seuil, qui redevient « non défini ».";
export const CONFIDENTIALITE_LEGACY_NOTE = "Ancien réglage de la Masse salariale croisée, repris tant qu'aucun seuil n'est enregistré ici.";

function originText(origin: ConfidentialiteOrigin): string {
  if (origin.kind === "absent") return "Non défini : toute répartition est n.d. tant que le seuil n'est pas enregistré.";
  const own = origin.kind === "set" ? `Modifié le ${origin.at ?? "n.d."} par un administrateur.` : "Valeur enregistrée illisible : à ré-enregistrer.";
  return origin.legacy ? `${own} ${CONFIDENTIALITE_LEGACY_NOTE}` : own;
}

// Seuil de confidentialité de l'espace (personnes distinctes, entier ≥ 1) : un seul champ, vide tant que rien n'est défini, lecture
// seule hors administrateurs. Un champ vidé supprime le seuil (retour à « non défini », jamais 0).
export function ConfidentialiteForm({ slug, value, origin, disabled, help }: ConfidentialiteFormProps) {
  const [state, action, pending] = useActionState(saveConfidentialite.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} testid="setting-confidentialite-status" />
      <p className="desc">{CONFIDENTIALITE_FORM_NOTE}</p>
      <fieldset className="pm-card" disabled={disabled}>
        <legend className="label">Seuil{help}</legend>
        <div className="pm-card-body">
          <div className="pm-item">
            <div className="field-row pm-field-narrow">
              <label htmlFor="confidentialite-seuil">Seuil de confidentialité (personnes distinctes)</label>
              <input className="input" id="confidentialite-seuil" name="seuil" type="number" min={1} step={1} inputMode="numeric" defaultValue={value ?? ""} autoComplete="off" data-testid="setting-confidentialite-seuil" />
            </div>
            <span className="desc pm-origin" data-missing={origin.kind === "set" ? undefined : "true"} data-legacy={origin.kind !== "absent" && origin.legacy ? "true" : undefined} data-testid="setting-confidentialite-origin">
              {originText(origin)}
            </span>
          </div>
        </div>
      </fieldset>
      {!disabled && (
        <div className="actions">
          <button className="btn primary" type="submit" disabled={pending} data-testid="setting-confidentialite-save">
            {pending ? "Enregistrement…" : "Enregistrer le seuil de confidentialité"}
          </button>
        </div>
      )}
    </form>
  );
}
