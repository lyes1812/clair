import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  CoverageDraft, EndStatus, EventFlag, FieldNd, FindingSeverity, MonthFlag, PresenceBasis, PresenceStatus, Provenance, RhBuildInputs, RhBuildSummary, RhSource, TimeStatus,
} from "@/lib/rh/referential/types";

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

// Fichiers déposés (DSN, FEC) : contenu brut chiffré (les DSN contiennent des NIR), supprimable ;
// un fichier par empreinte et par espace, quel que soit son type.
export const sourceFile = pgTable(
  "source_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    syncId: uuid("sync_id").notNull().references(() => sourceSync.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    sha256: text("sha256").notNull(),
    filename: text("filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    encoding: text("encoding").notNull(),
    sealedContent: text("sealed_content").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("source_file_ws_sha_uq").on(t.workspaceId, t.sha256), index("source_file_ws_kind_idx").on(t.workspaceId, t.kind), workspaceIsolation("source_file")],
).enableRLS();

// Paramètres d'un espace (règles métier, choix de source…) : une valeur JSON par clé, sans valeur par défaut cachée.
export const workspaceSetting = pgTable(
  "workspace_setting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("workspace_setting_ws_key_uq").on(t.workspaceId, t.key), workspaceIsolation("workspace_setting")],
).enableRLS();

// --- Référentiel Collaborateurs (module 2) : construit par source (PayFit ou DSN) à partir des seules lectures
// appliquées, jamais fusionné entre sources ; chaque champ porte sa provenance ou sa raison d'absence (n.d.).
const wsRef = () => text("workspace_id").notNull().references(() => organization.id, { onDelete: "cascade" });
const buildRef = () => uuid("build_id").notNull().references(() => rhBuild.id, { onDelete: "cascade" });
// Quantités (ETP, heures, quotités) : numeric exact pour les sommes SQL ; relu en nombre côté application.
const qty = (name: string) => numeric(name, { precision: 14, scale: 4, mode: "number" });
const fieldsNd = () => jsonb("fields_nd").$type<Record<string, FieldNd>>().notNull().default({});
const provenance = () => jsonb("provenance").$type<Record<string, Provenance>>().notNull().default({});

export const rhBuild = pgTable(
  "rh_build",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: wsRef(),
    source: text("source").$type<RhSource>().notNull(),
    status: text("status").$type<"current" | "superseded">().notNull(), // un seul « current » par (espace, source) ; indisponible = unavailable_reason renseignée
    builderVersion: integer("builder_version").notNull(),
    inputsHash: text("inputs_hash").notNull(),
    inputs: jsonb("inputs").$type<RhBuildInputs>().notNull(),
    referenceDate: text("reference_date"), // PayFit : date Paris de la lecture ; DSN : fin du dernier mois complet
    presenceFrom: text("presence_from"), // AAAA-MM
    presenceTo: text("presence_to"), // AAAA-MM
    summary: jsonb("summary").$type<RhBuildSummary>().notNull().default({ persons: 0, contracts: 0, months: 0, events: 0, findings: 0 }),
    unavailableReason: text("unavailable_reason"),
    builtBy: text("built_by").references(() => user.id, { onDelete: "set null" }),
    builtAt: ts("built_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("rh_build_current_uq").on(t.workspaceId, t.source).where(sql`status = 'current'`),
    index("rh_build_ws_source_idx").on(t.workspaceId, t.source, t.builtAt),
    workspaceIsolation("rh_build"),
  ],
).enableRLS();

export const rhPerson = pgTable(
  "rh_person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: wsRef(),
    buildId: buildRef(),
    personKey: text("person_key").notNull(), // "payfit:<id>" | "dsn:<personId>"
    externalId: text("external_id").notNull(), // identifiant brut (jamais le NIR)
    identifierKind: text("identifier_kind").$type<"payfit" | "nir" | "ntt">().notNull(),
    siren: text("siren"),
    establishmentIds: jsonb("establishment_ids").$type<string[]>().notNull().default([]),
    familyName: text("family_name"),
    givenNames: text("given_names"),
    usageName: text("usage_name"),
    employeeNumber: text("employee_number"),
    teamName: text("team_name"),
    hasContract: boolean("has_contract").notNull(),
    firstDeclaredMonth: text("first_declared_month"),
    lastDeclaredMonth: text("last_declared_month"),
    fieldsNd: fieldsNd(),
    provenance: provenance(),
  },
  (t) => [uniqueIndex("rh_person_build_key_uq").on(t.buildId, t.personKey), index("rh_person_build_name_idx").on(t.buildId, t.familyName), workspaceIsolation("rh_person")],
).enableRLS();

export const rhContract = pgTable(
  "rh_contract",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: wsRef(),
    buildId: buildRef(),
    contractKey: text("contract_key").notNull(), // "payfit:<contractId>" | "dsn:<contractId>"
    externalId: text("external_id").notNull(), // PayFit contractId ; DSN numéro de contrat (S21.G00.40.009)
    personKey: text("person_key"), // null : contrat sans collaborateur
    establishmentId: text("establishment_id"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    endReason: text("end_reason"),
    endStatus: text("end_status").$type<EndStatus>().notNull(), // known | none_cdi | none_other_nature | none_nature_nd | unpositioned | disappeared
    nature: text("nature"),
    statusSource: text("status_source"), // PayFit ACTIVE/ARCHIVED/PENDING : affiché, jamais compté
    fteAtRead: numeric("fte_at_read", { mode: "number" }), // sans échelle fixe : quotité PayFit exacte, arrondie une seule fois par les KPI
    weeklyHoursAtRead: qty("weekly_hours_at_read"),
    isFullTimeAtRead: boolean("is_full_time_at_read"),
    modalityAtRead: text("modality_at_read"),
    executive: boolean("executive"),
    firstDeclaredMonth: text("first_declared_month"),
    lastDeclaredMonth: text("last_declared_month"),
    fieldsNd: fieldsNd(),
    provenance: provenance(),
  },
  (t) => [uniqueIndex("rh_contract_build_key_uq").on(t.buildId, t.contractKey), index("rh_contract_build_person_idx").on(t.buildId, t.personKey), workspaceIsolation("rh_contract")],
).enableRLS();

export const rhContractMonth = pgTable(
  "rh_contract_month",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: wsRef(),
    buildId: buildRef(),
    contractKey: text("contract_key").notNull(),
    month: text("month").notNull(),
    establishmentId: text("establishment_id").notNull(), // PayFit company.id ; DSN SIRET déclarant (une ligne par SIRET)
    presenceBasis: text("presence_basis").$type<PresenceBasis>().notNull(), // "dates" (PayFit) | "declared" | "not_declared" (DSN)
    presentAnyDay: boolean("present_any_day").notNull(),
    presentMonthEnd: boolean("present_month_end").notNull(),
    nature: text("nature"),
    referenceQuota: qty("reference_quota"),
    contractQuota: qty("contract_quota"),
    quotaUnit: text("quota_unit"),
    modality: text("modality"),
    paidTime: qty("paid_time"),
    workedTime: qty("worked_time"),
    timeUnit: text("time_unit"),
    paymentCount: integer("payment_count"),
    flags: jsonb("flags").$type<MonthFlag[]>().notNull().default([]),
    fieldsNd: fieldsNd(),
    provenance: provenance(),
  },
  (t) => [
    uniqueIndex("rh_contract_month_uq").on(t.buildId, t.contractKey, t.month, t.establishmentId),
    index("rh_contract_month_build_month_idx").on(t.buildId, t.month),
    workspaceIsolation("rh_contract_month"),
  ],
).enableRLS();

export const rhEvent = pgTable(
  "rh_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: wsRef(),
    buildId: buildRef(),
    kind: text("kind").$type<"entry" | "exit">().notNull(),
    date: text("date").notNull(),
    month: text("month").notNull(),
    contractKey: text("contract_key").notNull(),
    personKey: text("person_key"),
    establishmentId: text("establishment_id"),
    nature: text("nature"),
    endReason: text("end_reason"),
    flags: jsonb("flags").$type<EventFlag[]>().notNull().default([]),
    fieldsNd: fieldsNd(),
    provenance: provenance(),
  },
  (t) => [
    uniqueIndex("rh_event_uq").on(t.buildId, t.contractKey, t.kind),
    index("rh_event_build_month_idx").on(t.buildId, t.month),
    index("rh_event_build_person_idx").on(t.buildId, t.personKey),
    workspaceIsolation("rh_event"),
  ],
).enableRLS();

export const rhMonthCoverage = pgTable(
  "rh_month_coverage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: wsRef(),
    buildId: buildRef(),
    establishmentId: text("establishment_id").notNull(),
    month: text("month").notNull(),
    presenceStatus: text("presence_status").$type<PresenceStatus>().notNull(), // complete | lower_bound | incomplete | blocked | missing
    presenceReason: text("presence_reason"),
    timeStatus: text("time_status").$type<TimeStatus>().notNull(), // read | out_of_scope | unavailable | paid_only
    timeReason: text("time_reason"),
    declarationKeys: jsonb("declaration_keys").$type<CoverageDraft["declarationKeys"]>().notNull().default([]),
    provenance: provenance(),
  },
  (t) => [uniqueIndex("rh_month_coverage_uq").on(t.buildId, t.establishmentId, t.month), workspaceIsolation("rh_month_coverage")],
).enableRLS();

export const rhFinding = pgTable(
  "rh_finding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: wsRef(),
    buildId: buildRef(),
    code: text("code").notNull(),
    severity: text("severity").$type<FindingSeverity>().notNull(),
    personKeys: jsonb("person_keys").$type<string[]>().notNull().default([]),
    contractKeys: jsonb("contract_keys").$type<string[]>().notNull().default([]),
    month: text("month"),
    message: text("message").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    provenance: provenance(),
  },
  (t) => [index("rh_finding_build_code_idx").on(t.buildId, t.code), index("rh_finding_build_month_idx").on(t.buildId, t.month), workspaceIsolation("rh_finding")],
).enableRLS();
