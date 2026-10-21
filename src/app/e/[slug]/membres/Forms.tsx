"use client";
import { useActionState } from "react";
import { ROLES, ROLE_LABELS } from "@/lib/roles";
import { inviteMember, renameWorkspace, type ActionState } from "./actions";

function Feedback({ state }: { state: ActionState }) {
  if (state?.error) return <p className="error" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="notice" role="status">{state.ok}</p>;
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
        <div className="field-row" style={{ flex: "0 1 180px" }}>
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

export function CopyLink({ url }: { url: string }) {
  return (
    <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <code className="code" data-testid="invitation-link">{url}</code>
      <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(url)}>Copier</button>
    </span>
  );
}
