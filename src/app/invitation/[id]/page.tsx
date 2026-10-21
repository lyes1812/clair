import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { db } from "@/db/client";
import { invitation, organization } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isRole, ROLE_LABELS } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser(`/invitation/${id}`);
  const [inv] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      workspaceName: organization.name,
      slug: organization.slug,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(eq(invitation.id, id))
    .limit(1);

  const sameEmail = inv && inv.email.toLowerCase() === session.user.email.toLowerCase();
  // Une invitation n'est révélée qu'à son destinataire.
  if (!inv || !sameEmail) {
    return (
      <AuthCard title="Invitation introuvable">
        <p>Ce lien ne correspond à aucune invitation pour le compte {session.user.email}.</p>
        <p className="desc">Connectez-vous avec l'adresse invitée, ou demandez un nouveau lien à l'administrateur de l'espace.</p>
        <a href="/espaces">Mes espaces</a>
      </AuthCard>
    );
  }
  if (inv.status !== "pending" || inv.expiresAt < new Date()) {
    return (
      <AuthCard title="Invitation expirée">
        <p>Cette invitation n'est plus valable ({inv.status === "accepted" ? "déjà acceptée" : "expirée ou annulée"}).</p>
        <a href="/espaces">Mes espaces</a>
      </AuthCard>
    );
  }

  async function accept() {
    "use server";
    await auth.api.acceptInvitation({ body: { invitationId: id }, headers: await headers() });
    redirect(`/e/${inv.slug}`);
  }

  return (
    <AuthCard title="Rejoindre un espace">
      <p>
        Vous êtes invité à rejoindre <strong>{inv.workspaceName}</strong> en tant que{" "}
        <strong>{isRole(inv.role) ? ROLE_LABELS[inv.role] : "membre"}</strong>.
      </p>
      <form action={accept}>
        <button className="btn primary" type="submit">Accepter l'invitation</button>
      </form>
    </AuthCard>
  );
}
