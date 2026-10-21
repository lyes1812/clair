import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { invitation } from "@/db/schema";

// Inscription sur invitation uniquement. CLAIR_SIGNUP_ALLOWED_DOMAINS (ex. « test.invalid » sur TEST)
// ouvre l'inscription à des domaines précis, pour les comptes de recette ; vide en production.
export function allowedDomains(raw = process.env.CLAIR_SIGNUP_ALLOWED_DOMAINS): string[] {
  return (raw ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
}

export function domainAllowed(email: string, domains: string[]): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  return Boolean(domain) && domains.includes(domain);
}

export async function hasPendingInvitation(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(sql`lower(${invitation.email})`, email.trim().toLowerCase()),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function signupAllowed(email: unknown): Promise<boolean> {
  if (typeof email !== "string" || !email.includes("@")) return false;
  return domainAllowed(email, allowedDomains()) || (await hasPendingInvitation(email));
}
