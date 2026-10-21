"use client";
import { useActionState } from "react";
import { connectPayFit, decideSync, launchPayFitSync, type FormState } from "./actions";

function Feedback({ state }: { state: FormState }) {
  if (state?.error) return <p className="error" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="notice" role="status">{state.ok}</p>;
  return null;
}

export function ConnectForm({ slug, connected }: { slug: string; connected: boolean }) {
  const [state, action, pending] = useActionState(connectPayFit.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <div className="inline-form">
        <div className="field-row">
          <label htmlFor="apiKey">{connected ? "Remplacer la clé API PayFit" : "Clé API PayFit"}</label>
          <input className="input" id="apiKey" name="apiKey" type="password" autoComplete="off" spellCheck={false} required />
        </div>
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Vérification…" : "Vérifier et enregistrer"}</button>
      </div>
      <p className="desc">
        Créez dans PayFit (Intégrations → Accès API) une clé dédiée à Clair, en lecture seule : accounting:read, collaborators:read,
        contracts:read, contracts:time-information:read, time:read. La clé est vérifiée auprès de PayFit, puis stockée chiffrée ; elle n'est plus jamais affichée.
      </p>
    </form>
  );
}

export function SyncForm({ slug, defaultFrom, defaultTo }: { slug: string; defaultFrom: string; defaultTo: string }) {
  const [state, action, pending] = useActionState(launchPayFitSync.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <div className="inline-form">
        <div className="field-row" style={{ flex: "0 1 200px" }}>
          <label htmlFor="from">Du mois</label>
          <input className="input" id="from" name="from" type="month" defaultValue={defaultFrom} required />
        </div>
        <div className="field-row" style={{ flex: "0 1 200px" }}>
          <label htmlFor="to">Au mois</label>
          <input className="input" id="to" name="to" type="month" defaultValue={defaultTo} required />
        </div>
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Lancement…" : "Synchroniser"}</button>
      </div>
      <p className="desc">
        Collaborateurs et contrats : état actuel chez PayFit (contrats archivés depuis plus d'un an non fournis). Temps, absences, statut de paie et
        journal : pour chaque mois de la période (24 au plus). Rien n'est modifié avant validation de l'aperçu.
      </p>
    </form>
  );
}

export function DecisionButtons({ slug, syncId }: { slug: string; syncId: string }) {
  const [applyState, apply, applying] = useActionState(async () => decideSync(slug, syncId, "apply"), undefined);
  const [discardState, discard, discarding] = useActionState(async () => decideSync(slug, syncId, "discard"), undefined);
  return (
    <div className="form">
      <Feedback state={applyState ?? discardState} />
      <div className="actions">
        <form action={apply}>
          <button className="btn primary" type="submit" disabled={applying || discarding}>Appliquer cette lecture</button>
        </form>
        <form action={discard}>
          <button className="btn danger" type="submit" disabled={applying || discarding}>Abandonner</button>
        </form>
      </div>
    </div>
  );
}
