import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

// Trois rôles par espace. Seul l'administrateur gère l'espace et ses membres ;
// les droits métier de l'éditeur (saisie d'hypothèses, imports) arrivent avec les modules suivants.
export const ROLES = ["admin", "editor", "reader"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrateur",
  editor: "Éditeur",
  reader: "Lecteur",
};

const RANK: Record<Role, number> = { reader: 1, editor: 2, admin: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function hasAtLeast(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required];
}

export const ac = createAccessControl(defaultStatements);

export const orgRoles = {
  admin: ac.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  }),
  editor: ac.newRole({ organization: [] }),
  reader: ac.newRole({ organization: [] }),
};
