import "@/styles/donnees.css";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invitation, member, user } from "@/db/schema";
import { listEvents, type EventKind } from "@/lib/events";
import { isRole, ROLES, ROLE_LABELS, type Role } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { Empty, PageHead } from "../donnees/ui";
import { cancelInvitation, changeRole, removeMember } from "./actions";
import { CopyLink, InviteForm, RenameForm } from "./Forms";

// Libellé de chaque type d'événement ; un type sans libellé s'affiche tel quel.
const EVENT_LABELS = {
  "workspace.created": "Espace créé",
  "workspace.renamed": "Espace renommé",
  "invitation.created": "Invitation créée",
  "member.joined": "Membre ajouté",
  "member.role_changed": "Rôle modifié",
  "member.removed": "Membre retiré",
  "connector.connected": "Source connectée",
  "connector.disconnected": "Source déconnectée",
  "source.applied": "Synchronisation appliquée",
  "source.discarded": "Synchronisation abandonnée",
  "dsn.uploaded": "Fichiers DSN déposés",
  "fec.uploaded": "Fichiers FEC déposés",
  "setting.changed": "Paramètre modifié",
  "rh.rebuilt": "Référentiel Collaborateurs reconstruit",
  "rh.rebuild_failed": "Reconstruction du référentiel en échec",
  "budget.scenario_created": "Scénario budgétaire créé",
  "budget.scenario_duplicated": "Scénario budgétaire dupliqué",
  "budget.scenario_frozen": "Scénario budgétaire figé",
  "budget.scenario_deleted": "Scénario budgétaire supprimé",
  "budget.hypothesis_added": "Hypothèse budgétaire ajoutée",
  "budget.hypothesis_deleted": "Hypothèse budgétaire supprimée",
  "budget.grid_saved": "Grille mensuelle enregistrée",
  "budget.bulk_departures": "Départs saisis en masse",
  "budget.bulk_raises": "Augmentations saisies en masse",
  "budget.hypotheses_imported": "Hypothèses reprises d'un autre scénario",
  "budget.reference_saved": "Budget de référence enregistré",
  "budget.reference_deleted": "Budget de référence supprimé",
} satisfies Partial<Record<EventKind, string>>;

// Ce que chaque rôle peut faire, d'après les contrôles côté serveur.
const ROLE_NOTES: Record<Role, string> = {
  admin: "Gère l'espace, ses membres, les sources connectées et les règles de l'espace (Paramètres).",
  editor: "Lance les lectures des sources, dépose les fichiers et saisit les hypothèses.",
  reader: "Consulte les écrans de l'espace, sans rien modifier.",
};

const EVENT_LIMIT = 30;
const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

function appUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
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
  const events = isAdmin ? await listEvents(workspace.id, EVENT_LIMIT) : [];
  const nameOf = new Map(members.map((m) => [m.userId, m.name]));

  return (
    <>
      <PageHead kicker="Espace" title="Membres et accès">
        <p className="desc">Trois rôles par espace : chaque action est contrôlée côté serveur, quel que soit l'écran.</p>
      </PageHead>

      <ul className="mb-roles" data-testid="mb-roles">
        {ROLES.map((r) => (
          <li key={r} data-current={workspace.role === r ? "true" : undefined}>
            <span className="mb-role-title">
              <strong>{ROLE_LABELS[r]}</strong>
              {workspace.role === r && <span className="tag">Votre rôle</span>}
            </span>
            <span className="desc">{ROLE_NOTES[r]}</span>
          </li>
        ))}
      </ul>

      <section className="panel" aria-labelledby="members-title" id="membres">
        <div className="dn-section-head">
          <h2 id="members-title">Membres</h2>
          <p className="desc">{members.length} membre{members.length > 1 ? "s" : ""} dans l'espace.</p>
        </div>
        <ul className="list mb-members" data-testid="member-list">
          {members.map((m) => (
            <li key={m.id}>
              <span className="mb-person">
                <span className="avatar" aria-hidden="true">{initials(m.name)}</span>
                <span className="mb-id">
                  <strong>{m.name}{m.userId === session.user.id && <span className="mb-self"> (vous)</span>}</strong>
                  <span className="muted">{m.email}</span>
                </span>
              </span>
              {isAdmin && m.userId !== session.user.id ? (
                <span className="mb-actions">
                  <form action={changeRole.bind(null, slug, m.id)} className="mb-role-form">
                    <select className="select" name="role" defaultValue={m.role} aria-label={`Rôle de ${m.name}`}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                    <button className="btn" type="submit" aria-label={`Appliquer le rôle à ${m.name}`}>Appliquer</button>
                  </form>
                  <form action={removeMember.bind(null, slug, m.id)}>
                    <button className="btn danger" type="submit" aria-label={`Retirer ${m.name} de l'espace`}>Retirer</button>
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
        <section className="panel" id="inviter">
          <div className="dn-section-head">
            <h2>Inviter</h2>
            <p className="desc">Pas d'envoi d'e-mail en V1 : le lien d'invitation est à transmettre à la personne. Il expire au bout de 7 jours.</p>
          </div>
          <InviteForm slug={slug} />
          {invitations.length > 0 && (
            <div className="mb-pending">
              <h3>Invitations en attente</h3>
              <ul className="list mb-invitations" data-testid="invitation-list">
                {invitations.map((inv) => (
                  <li key={inv.id}>
                    <span className="mb-id">
                      <strong>{inv.email}</strong>
                      <span className="desc">
                        <span className="tag">{isRole(inv.role) ? ROLE_LABELS[inv.role] : inv.role}</span> Expire le {dateFmt.format(inv.expiresAt)}
                      </span>
                    </span>
                    <CopyLink url={`${appUrl()}/invitation/${inv.id}`} />
                    <form action={cancelInvitation.bind(null, slug, inv.id)}>
                      <button className="btn danger" type="submit" aria-label={`Annuler l'invitation de ${inv.email}`}>Annuler</button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="panel" id="journal">
          <div className="dn-section-head">
            <h2>Journal de l'espace</h2>
            <p className="desc">Les {EVENT_LIMIT} derniers événements, du plus récent au plus ancien.</p>
          </div>
          {events.length === 0 ? (
            <Empty>Aucun événement.</Empty>
          ) : (
            <div className="table-wrap scroll">
              <table className="data-table sticky" data-testid="event-list">
                <thead><tr><th scope="col">Date</th><th scope="col">Événement</th><th scope="col">Par</th></tr></thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td>{dateFmt.format(ev.occurredAt)}</td>
                      <td>{(EVENT_LABELS as Record<string, string>)[ev.kind] ?? ev.kind}</td>
                      <td>{ev.actorUserId ? (nameOf.get(ev.actorUserId) ?? <span className="nd">ancien membre</span>) : <span className="nd">n.d.</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="panel" id="espace">
          <div className="dn-section-head">
            <h2>Espace</h2>
            <p className="desc">Le nom est affiché dans le menu et en tête de chaque écran.</p>
          </div>
          <RenameForm slug={slug} name={workspace.name} />
        </section>
      )}
    </>
  );
}
