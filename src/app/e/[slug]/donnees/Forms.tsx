"use client";
import { useActionState } from "react";
import { connectSource, decideSync, launchSync, type FormState } from "./actions";

function Feedback({ state }: { state: FormState }) {
  if (state?.error) return <p className="error" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="notice" role="status">{state.ok}</p>;
  return null;
}

const KEY_HELP: Record<string, string> = {
  payfit:
    "Créez dans PayFit (Intégrations → Accès API) une clé dédiée à Clair, en lecture seule : accounting:read, collaborators:read, contracts:read, contracts:time-information:read, time:read.",
  pennylane:
    "Créez dans Pennylane (Paramètres → Connectivité → Développeurs) un jeton d'API dédié à Clair, en lecture seule sur la comptabilité.",
};

export function ConnectForm({ slug, source, label, connected }: { slug: string; source: string; label: string; connected: boolean }) {
  const [state, action, pending] = useActionState(connectSource.bind(null, slug, source), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <div className="inline-form">
        <div className="field-row">
          <label htmlFor="apiKey">{connected ? `Remplacer la clé API ${label}` : `Clé API ${label}`}</label>
          <input className="input" id="apiKey" name="apiKey" type="password" autoComplete="off" spellCheck={false} required />
        </div>
        {source === "pennylane" && (
          <div className="field-row" style={{ flex: "0 1 240px" }}>
            <label htmlFor="companyId">Identifiant de société (facultatif)</label>
            <input className="input" id="companyId" name="companyId" inputMode="numeric" autoComplete="off" />
          </div>
        )}
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Vérification…" : "Vérifier et enregistrer"}</button>
      </div>
      <p className="desc">
        {KEY_HELP[source]} La clé est vérifiée auprès du fournisseur, puis stockée chiffrée ; elle n'est plus jamais affichée.
        {source === "pennylane" && " L'identifiant de société n'est utile qu'avec un jeton donnant accès à plusieurs sociétés."}
      </p>
    </form>
  );
}

const SYNC_HELP: Record<string, string> = {
  payfit:
    "Collaborateurs et contrats : état actuel chez PayFit (contrats archivés depuis plus d'un an non fournis). Temps, absences, statut de paie et journal : pour chaque mois de la période (24 au plus).",
  pennylane:
    "Plan comptable complet, puis lignes d'écritures des classes 6 et 7 et des comptes 421, 431, 437, pour chaque mois de la période (24 au plus).",
};

export function SyncForm({ slug, source, defaultFrom, defaultTo }: { slug: string; source: string; defaultFrom: string; defaultTo: string }) {
  const [state, action, pending] = useActionState(launchSync.bind(null, slug, source), undefined);
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
      <p className="desc">{SYNC_HELP[source]} Rien n'est modifié avant validation de l'aperçu.</p>
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
