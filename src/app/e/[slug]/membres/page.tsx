import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invitation, member, user } from "@/db/schema";
import { listEvents } from "@/lib/events";
import { isRole, ROLES, ROLE_LABELS } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { cancelInvitation, changeRole, removeMember } from "./actions";
import { CopyLink, InviteForm, RenameForm } from "./Forms";

const EVENT_LABELS: Record<string, string> = {
  "workspace.created": "Espace créé",
  "workspace.renamed": "Espace renommé",
  "invitation.created": "Invitation créée",
  "member.joined": "Membre ajouté",
  "member.role_changed": "Rôle modifié",
  "member.removed": "Membre retiré",
};

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

function appUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
}

export default async function MembresPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { session, workspace } = await requireWorkspace(slug);
  const isAdmin = workspace.role === "admin";

  const members = await db
    .select({ id: member.id, role: member.role, userId: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, workspace.id))
    .orderBy(asc(user.name));
  const invitations = isAdmin
    ? await db
        .select()
        .from(invitation)
        .where(and(eq(invitation.organizationId, workspace.id), eq(invitation.status, "pending")))
        .orderBy(asc(invitation.email))
    : [];
  const events = isAdmin ? await listEvents(workspace.id, 30) : [];

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Espace</span>
        <h1>Membres et accès</h1>
        <p className="desc">
          Administrateur : gère l'espace et ses membres. Éditeur : importe et saisit (modules suivants). Lecteur : consulte.
        </p>
      </div>

      {isAdmin && (
        <section className="panel">
          <h2>Espace</h2>
          <RenameForm slug={slug} name={workspace.name} />
        </section>
      )}

      <section className="panel" aria-labelledby="members-title">
        <h2 id="members-title">Membres</h2>
        <ul className="list" data-testid="member-list">
          {members.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.name}</strong> <span className="muted">{m.email}</span>
              </span>
              {isAdmin && m.userId !== session.user.id ? (
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <form action={changeRole.bind(null, slug, m.id)} style={{ display: "flex", gap: 8 }}>
                    <select className="select" name="role" defaultValue={m.role} aria-label={`Rôle de ${m.name}`} style={{ width: 160 }}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                    <button className="btn" type="submit">Appliquer</button>
                  </form>
                  <form action={removeMember.bind(null, slug, m.id)}>
                    <button className="btn danger" type="submit">Retirer</button>
                  </form>
                </span>
              ) : (
                <span className="tag">{isRole(m.role) ? ROLE_LABELS[m.role] : m.role}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section className="panel">
          <h2>Inviter</h2>
          <p className="desc">Pas d'envoi d'e-mail en V1 : le lien d'invitation est à transmettre à la personne. Il expire au bout de 7 jours.</p>
          <InviteForm slug={slug} />
          {invitations.length > 0 && (
            <ul className="list" data-testid="invitation-list">
              {invitations.map((inv) => (
                <li key={inv.id}>
                  <span>
                    {inv.email} <span className="tag">{isRole(inv.role) ? ROLE_LABELS[inv.role] : inv.role}</span>
                  </span>
                  <CopyLink url={`${appUrl()}/invitation/${inv.id}`} />
                  <form action={cancelInvitation.bind(null, slug, inv.id)}>
                    <button className="btn danger" type="submit">Annuler</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="panel">
          <h2>Journal de l'espace</h2>
          {events.length === 0 ? (
            <p className="muted">Aucun événement.</p>
          ) : (
            <ul className="list" data-testid="event-list">
              {events.map((ev) => (
                <li key={ev.id}>
                  <span>{EVENT_LABELS[ev.kind] ?? ev.kind}</span>
                  <span className="desc">{dateFmt.format(ev.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
