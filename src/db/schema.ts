import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Tables de Better Auth (authentification, espaces = « organization », membres, invitations, TOTP).
// Générées par @better-auth/cli puis ajustées : horodatages avec fuseau, rôle par défaut « reader ».

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at")
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at")
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: ts("created_at").notNull(),
  metadata: text("metadata"),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").default("reader").notNull(),
  createdAt: ts("created_at").notNull(),
}, (t) => [uniqueIndex("member_org_user_uq").on(t.organizationId, t.userId), index("member_user_idx").on(t.userId)]);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").default("pending").notNull(),
  expiresAt: ts("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// Tables métier : chacune porte workspace_id et une politique RLS (FORCE) qui ne laisse voir
// que les lignes de l'espace déclaré dans la transaction (voir src/db/workspace-scope.ts).
const workspaceIsolation = (table: string) =>
  pgPolicy(`${table}_workspace_isolation`, {
    as: "permissive",
    for: "all",
    using: sql`workspace_id = current_setting('app.workspace_id', true)`,
    withCheck: sql`workspace_id = current_setting('app.workspace_id', true)`,
  });

export const workspaceEvent = pgTable(
  "workspace_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: ts("occurred_at").defaultNow().notNull(),
  },
  (t) => [index("workspace_event_ws_idx").on(t.workspaceId, t.occurredAt), workspaceIsolation("workspace_event")],
).enableRLS();

// Connecteurs : une clé chiffrée par espace et par fournisseur (jamais lisible en clair en base).
export const connectorCredential = pgTable(
  "connector_credential",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    sealedSecret: text("sealed_secret").notNull(),
    externalCompanyId: text("external_company_id"),
    companyName: text("company_name"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("unverified"),
    lastVerifiedAt: ts("last_verified_at"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: ts("created_at").defaultNow().notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("connector_credential_ws_provider_uq").on(t.workspaceId, t.provider), workspaceIsolation("connector_credential")],
).enableRLS();

// Une synchronisation = une lecture complète d'une source, d'abord en aperçu, puis appliquée en bloc.
export const sourceSync = pgTable(
  "source_sync",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
    baselineSyncId: uuid("baseline_sync_id"),
    contentHash: text("content_hash"),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: ts("started_at").defaultNow().notNull(),
    finishedAt: ts("finished_at"),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: ts("decided_at"),
  },
  (t) => [index("source_sync_ws_provider_idx").on(t.workspaceId, t.provider, t.startedAt), workspaceIsolation("source_sync")],
).enableRLS();

// Enregistrements normalisés d'une synchronisation : une ligne par élément source (collaborateur, contrat, ligne de journal…).
export const sourceRecord = pgTable(
  "source_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    syncId: uuid("sync_id").notNull().references(() => sourceSync.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    recordKey: text("record_key").notNull(),
    period: text("period"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    recordHash: text("record_hash").notNull(),
  },
  (t) => [
    uniqueIndex("source_record_sync_key_uq").on(t.syncId, t.collection, t.recordKey),
    index("source_record_ws_collection_idx").on(t.workspaceId, t.collection),
    workspaceIsolation("source_record"),
  ],
).enableRLS();
