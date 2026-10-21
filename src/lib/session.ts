import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser(returnTo?: string) {
  const session = await getSession();
  if (!session) {
    redirect(returnTo ? `/connexion?retour=${encodeURIComponent(returnTo)}` : "/connexion");
  }
  return session;
}

// N'accepte que des chemins internes pour éviter les redirections ouvertes.
export function safeReturnPath(value: string | null | undefined, fallback = "/espaces"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
