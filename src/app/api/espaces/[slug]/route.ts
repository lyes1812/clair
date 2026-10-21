import { auth } from "@/lib/auth";
import { findAccess } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// Lecture de l'espace par l'API : 401 sans session, 403 si l'utilisateur n'en est pas membre.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { slug } = await params;
  const access = await findAccess(session.user.id, slug);
  if (!access) return Response.json({ error: "Accès refusé" }, { status: 403 });
  return Response.json({ workspace: { id: access.id, name: access.name, slug: access.slug }, role: access.role });
}
