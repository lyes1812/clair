"use client";
import { useActionState } from "react";
import type { FormState } from "./actions";

// Formulaire branché sur une action serveur (liée côté serveur au slug et au scénario) : message d'erreur ou de
// confirmation renvoyé par l'action, bouton désactivé pendant l'envoi.
export function ActionForm({
  action, submit, testid, children, className, danger,
}: { action: (prev: FormState, f: FormData) => Promise<FormState>; submit: string; testid: string; children?: React.ReactNode; className?: string; danger?: boolean }) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form className={className ?? "form"} action={run} data-testid={testid}>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      {state?.ok && <p className="notice" role="status">{state.ok}</p>}
      {state?.details && <ul className="list" data-testid={`${testid}-details`}>{state.details.map((d) => <li key={d} className="desc">{d}</li>)}</ul>}
      {children}
      <div className="actions">
        <button className={danger ? "btn danger" : "btn primary"} type="submit" disabled={pending}>{pending ? "Enregistrement…" : submit}</button>
      </div>
    </form>
  );
}
