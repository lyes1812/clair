"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { ROLES, ROLE_LABELS } from "@/lib/roles";
import { inviteMember, renameWorkspace, type ActionState } from "./actions";

function Feedback({ state }: { state: ActionState }) {
  if (state?.error) return <p className="error" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="notice ok" role="status">{state.ok}</p>;
  return null;
}

export function RenameForm({ slug, name }: { slug: string; name: string }) {
  const [state, action, pending] = useActionState(renameWorkspace.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <div className="inline-form">
        <div className="field-row">
          <label htmlFor="ws-rename">Nom de l'espace</label>
          <input className="input" id="ws-rename" name="name" defaultValue={name} required minLength={2} maxLength={80} />
        </div>
        <button className="btn" type="submit" disabled={pending}>Renommer</button>
      </div>
    </form>
  );
}

export function InviteForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(inviteMember.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <div className="inline-form">
        <div className="field-row">
          <label htmlFor="invite-email">E-mail</label>
          <input className="input" id="invite-email" name="email" type="email" required />
        </div>
        <div className="field-row mb-role-field">
          <label htmlFor="invite-role">Rôle</label>
          <select className="select" id="invite-role" name="role" defaultValue="reader">
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <button className="btn primary" type="submit" disabled={pending}>Inviter</button>
      </div>
    </form>
  );
}

// Lien d'invitation : affiché en clair (aucun e-mail n'est envoyé en V1), copiable d'un clic, sélectionnable d'un clic aussi.
export function CopyLink({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("done");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 3000);
  }
  return (
    <span className="mb-link">
      <code className="code" data-testid="invitation-link">{url}</code>
      <button type="button" className="btn" onClick={copy} aria-label="Copier le lien d'invitation">{state === "done" ? "Copié" : "Copier"}</button>
      <span className="desc" aria-live="polite">{state === "done" ? "Lien copié dans le presse-papiers." : state === "failed" ? "Copie impossible : sélectionnez le lien à la main." : ""}</span>
    </span>
  );
}
