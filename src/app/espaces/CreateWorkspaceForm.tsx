"use client";
import { useActionState } from "react";
import { createWorkspace } from "./actions";

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspace, undefined);
  return (
    <form className="form" action={action}>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      <div className="inline-form">
        <div className="field-row">
          <label htmlFor="ws-name">Nom de l'espace (en général, la structure cliente)</label>
          <input className="input" id="ws-name" name="name" required minLength={2} maxLength={80} />
        </div>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Création…" : "Créer l'espace"}
        </button>
      </div>
      <p className="desc">Vous en serez l'administrateur : la double authentification vous sera demandée.</p>
    </form>
  );
}
