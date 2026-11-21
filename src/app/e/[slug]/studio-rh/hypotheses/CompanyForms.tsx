"use client";

import { useActionState } from "react";
import { createCompanyAction, renameCompanyAction } from "../../company-actions";

export function CreateCompanyForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(createCompanyAction.bind(null, slug), undefined);
  return <form action={action} className="company-edit-form" data-testid="company-create-form">
    <label className="field-row"><span>Nom de la société</span><input className="input" name="name" maxLength={120} required autoComplete="organization" /></label>
    <label className="field-row"><span>SIREN (facultatif)</span><input className="input" name="siren" inputMode="numeric" pattern="[0-9]{9}" maxLength={9} /></label>
    <button className="btn primary" disabled={pending}>{pending ? "Création…" : "Créer la société"}</button>
    {state?.error && <p className="error" role="alert">{state.error}</p>}
  </form>;
}

export function RenameCompanyForm({ slug, company, sirenLocked = false }: { slug: string; company: { id: string; name: string; siren: string | null }; sirenLocked?: boolean }) {
  const [state, action, pending] = useActionState(renameCompanyAction.bind(null, slug, company.id), undefined);
  return <form action={action} className="company-edit-form" data-testid="company-rename-form">
    <label className="field-row"><span>Nom de la société</span><input className="input" name="name" maxLength={120} required defaultValue={company.name} /></label>
    <label className="field-row"><span>SIREN (facultatif)</span><input className="input" name="siren" inputMode="numeric" pattern="[0-9]{9}" maxLength={9} defaultValue={company.siren ?? ""} readOnly={sirenLocked} />{sirenLocked && <small className="desc">Périmètre conservé après la première lecture.</small>}</label>
    <button className="btn" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
    {state?.error && <p className="error" role="alert">{state.error}</p>}{state?.ok && <p role="status">{state.ok}</p>}
  </form>;
}
