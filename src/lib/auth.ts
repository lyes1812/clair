import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { organization, twoFactor } from "better-auth/plugins";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { ac, orgRoles } from "@/lib/roles";
import { recordEvent } from "@/lib/events";
import { signupAllowed } from "@/lib/signup";

const ADMIN_PATHS = new Set([
  "/organization/update",
  "/organization/delete",
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/update-member-role",
  "/organization/remove-member",
]);

export const auth = betterAuth({
  appName: "Clair",
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
  hooks: {
    // Inscription sur invitation ; TOTP obligatoire pour toute action d'administration d'un espace, y compris appelée directement sur l'API.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        if (!(await signupAllowed(ctx.body?.email))) {
          throw new APIError("FORBIDDEN", {
            code: "SIGNUP_INVITATION_REQUIRED",
            message: "Inscription sur invitation uniquement.",
          });
        }
        return;
      }
      if (!ADMIN_PATHS.has(ctx.path)) return;
      const session = ctx.context.session;
      if (session && !session.user.twoFactorEnabled) {
        throw new APIError("FORBIDDEN", { message: "Activez la double authentification (TOTP) pour administrer un espace." });
      }
    }),
  },
  plugins: [
    twoFactor({ issuer: "Clair" }),
    organization({
      ac,
      roles: orgRoles,
      creatorRole: "admin",
      invitationExpiresIn: 60 * 60 * 24 * 7,
      cancelPendingInvitationsOnReInvite: true,
      // Pas de service d'envoi en V1 : l'administrateur copie le lien d'invitation.
      organizationHooks: {
        afterCreateOrganization: async ({ organization, user }) => {
          await recordEvent(organization.id, user.id, "workspace.created", { name: organization.name });
        },
        afterCreateInvitation: async ({ invitation, inviter, organization }) => {
          await recordEvent(organization.id, inviter.id, "invitation.created", {
            email: invitation.email,
            role: invitation.role,
          });
        },
        afterAcceptInvitation: async ({ member, user, organization }) => {
          await recordEvent(organization.id, user.id, "member.joined", { role: member.role });
        },
        afterUpdateMemberRole: async ({ member, previousRole, user, organization }) => {
          await recordEvent(organization.id, user.id, "member.role_changed", {
            memberId: member.id,
            from: previousRole,
            to: member.role,
          });
        },
        afterRemoveMember: async ({ member, user, organization }) => {
          await recordEvent(organization.id, user.id, "member.removed", { memberId: member.id });
        },
      },
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
