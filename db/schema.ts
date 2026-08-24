import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  BIRTH_DATE_ACCURACIES,
  CUSTODIANSHIP_BASES,
  CUSTODIANSHIP_STATUSES,
  CUSTODIANSHIP_VERIFICATION_STATUSES,
  MEDIA_KINDS,
  MEDIA_STATUSES,
  PERSON_ACCOUNT_CLAIM_STATUSES,
  PERSON_AUTHORITY_ROLES,
  RELATIONSHIP_EVIDENCE_MODES,
  RELATIONSHIP_TYPES,
  SHARE_PERMISSIONS,
  SHARE_SET_KINDS,
  SPACE_MEMBERSHIP_ROLES,
  SPACE_MEMBERSHIP_STATUSES,
  TRANSFER_CASE_STATUSES,
} from "../app/lib/domain";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    authSubject: text("auth_subject").notNull(),
    emailDisplay: text("email_display"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("users_auth_subject_uq").on(table.authSubject)],
);

export const familySpaces = sqliteTable("family_spaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: integer("created_at").notNull(),
});

export const spaceMemberships = sqliteTable(
  "space_memberships",
  {
    spaceId: text("space_id")
      .notNull()
      .references(() => familySpaces.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role", { enum: SPACE_MEMBERSHIP_ROLES }).notNull(),
    status: text("status", { enum: SPACE_MEMBERSHIP_STATUSES }).notNull(),
    joinedAt: integer("joined_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.userId] }),
    index("space_memberships_user_status_idx").on(table.userId, table.status),
  ],
);

export const people = sqliteTable(
  "people",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => familySpaces.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    birthDate: text("birth_date"),
    birthDateAccuracy: text("birth_date_accuracy", {
      enum: BIRTH_DATE_ACCURACIES,
    })
      .notNull()
      .default("unknown"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("people_space_id_id_uq").on(table.spaceId, table.id),
    index("people_space_created_at_idx").on(table.spaceId, table.createdAt),
    check(
      "people_birth_date_shape_ck",
      sql`${table.birthDate} is null or length(${table.birthDate}) = 10`,
    ),
    check(
      "people_birth_date_accuracy_ck",
      sql`(${table.birthDate} is null and ${table.birthDateAccuracy} = 'unknown') or ${table.birthDate} is not null`,
    ),
  ],
);

export const personAuthorities = sqliteTable(
  "person_authorities",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    personId: text("person_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role", { enum: PERSON_AUTHORITY_ROLES }).notNull(),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at"),
    grantedByUserId: text("granted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "person_authorities_person_fk",
      columns: [table.spaceId, table.personId],
      foreignColumns: [people.spaceId, people.id],
    }).onDelete("restrict"),
    uniqueIndex("person_authorities_active_user_role_uq")
      .on(table.personId, table.userId, table.role)
      .where(sql`${table.endsAt} is null`),
    uniqueIndex("person_authorities_active_self_uq")
      .on(table.personId)
      .where(sql`${table.role} = 'self' and ${table.endsAt} is null`),
    index("person_authorities_user_person_idx").on(
      table.userId,
      table.personId,
    ),
    check(
      "person_authorities_interval_ck",
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

// Custodianship is explicit many-to-many authority and is never inferred from
// parent_of, oral bonds, or space stewardship.
export const custodianships = sqliteTable(
  "custodianships",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    personId: text("person_id").notNull(),
    custodianUserId: text("custodian_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: CUSTODIANSHIP_STATUSES }).notNull(),
    basis: text("basis", { enum: CUSTODIANSHIP_BASES }).notNull(),
    verificationStatus: text("verification_status", {
      enum: CUSTODIANSHIP_VERIFICATION_STATUSES,
    }).notNull(),
    validFrom: integer("valid_from"),
    validUntil: integer("valid_until"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    endedByUserId: text("ended_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "custodianships_person_fk",
      columns: [table.spaceId, table.personId],
      foreignColumns: [people.spaceId, people.id],
    }).onDelete("restrict"),
    uniqueIndex("custodianships_current_user_person_uq")
      .on(table.personId, table.custodianUserId)
      .where(
        sql`${table.status} in ('proposed', 'pending_verification', 'active', 'suspended', 'contested') and ${table.validUntil} is null`,
      ),
    index("custodianships_custodian_person_idx").on(
      table.custodianUserId,
      table.personId,
    ),
    check(
      "custodianships_interval_ck",
      sql`${table.validUntil} is null or (${table.validFrom} is not null and ${table.validUntil} > ${table.validFrom})`,
    ),
    check(
      "custodianships_active_dates_ck",
      sql`${table.status} <> 'active' or ${table.validFrom} is not null`,
    ),
  ],
);

// A verified account link is an identity claim, not permission. Only explicit
// self authority created by a completed transfer grants control.
export const personAccountLinks = sqliteTable(
  "person_account_links",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    personId: text("person_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    claimStatus: text("claim_status", {
      enum: PERSON_ACCOUNT_CLAIM_STATUSES,
    }).notNull(),
    validFrom: integer("valid_from"),
    validUntil: integer("valid_until"),
    verifiedAt: integer("verified_at"),
    verifiedByUserId: text("verified_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "person_account_links_person_fk",
      columns: [table.spaceId, table.personId],
      foreignColumns: [people.spaceId, people.id],
    }).onDelete("restrict"),
    uniqueIndex("person_account_links_current_person_uq")
      .on(table.personId)
      .where(
        sql`${table.claimStatus} = 'verified' and ${table.validUntil} is null`,
      ),
    uniqueIndex("person_account_links_current_user_space_uq")
      .on(table.spaceId, table.userId)
      .where(
        sql`${table.claimStatus} = 'verified' and ${table.validUntil} is null`,
      ),
    index("person_account_links_user_status_idx").on(
      table.userId,
      table.claimStatus,
    ),
    check(
      "person_account_links_interval_ck",
      sql`${table.validUntil} is null or (${table.validFrom} is not null and ${table.validUntil} > ${table.validFrom})`,
    ),
    check(
      "person_account_links_verified_ck",
      sql`${table.claimStatus} <> 'verified' or (${table.verifiedAt} is not null and ${table.validFrom} is not null)`,
    ),
  ],
);

export const relationships = sqliteTable(
  "relationships",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    sourcePersonId: text("source_person_id").notNull(),
    targetPersonId: text("target_person_id").notNull(),
    relationshipType: text("relationship_type", {
      enum: RELATIONSHIP_TYPES,
    }).notNull(),
    evidenceMode: text("evidence_mode", {
      enum: RELATIONSHIP_EVIDENCE_MODES,
    }).notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    endedAt: integer("ended_at"),
    endedByUserId: text("ended_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    foreignKey({
      name: "relationships_source_person_fk",
      columns: [table.spaceId, table.sourcePersonId],
      foreignColumns: [people.spaceId, people.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "relationships_target_person_fk",
      columns: [table.spaceId, table.targetPersonId],
      foreignColumns: [people.spaceId, people.id],
    }).onDelete("restrict"),
    uniqueIndex("relationships_active_pair_type_uq")
      .on(
        table.spaceId,
        table.relationshipType,
        table.sourcePersonId,
        table.targetPersonId,
      )
      .where(sql`${table.endedAt} is null`),
    index("relationships_source_active_idx").on(
      table.sourcePersonId,
      table.endedAt,
    ),
    index("relationships_target_active_idx").on(
      table.targetPersonId,
      table.endedAt,
    ),
    check(
      "relationships_distinct_people_ck",
      sql`${table.sourcePersonId} <> ${table.targetPersonId}`,
    ),
    check(
      "relationships_ended_by_ck",
      sql`(${table.endedAt} is null and ${table.endedByUserId} is null) or (${table.endedAt} is not null and ${table.endedByUserId} is not null)`,
    ),
  ],
);

export const stories = sqliteTable(
  "stories",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    personId: text("person_id").notNull(),
    body: text("body").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "stories_person_fk",
      columns: [table.spaceId, table.personId],
      foreignColumns: [people.spaceId, people.id],
    }).onDelete("restrict"),
    uniqueIndex("stories_space_person_id_uq").on(
      table.spaceId,
      table.personId,
      table.id,
    ),
    index("stories_person_created_at_idx").on(
      table.personId,
      table.createdAt,
    ),
    check(
      "stories_body_length_ck",
      sql`length(trim(${table.body})) between 1 and 4000`,
    ),
  ],
);

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    personId: text("person_id").notNull(),
    storyId: text("story_id"),
    r2Key: text("r2_key").notNull(),
    kind: text("kind", { enum: MEDIA_KINDS }).notNull(),
    canonicalMime: text("canonical_mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    caption: text("caption").notNull().default(""),
    status: text("status", { enum: MEDIA_STATUSES }).notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    readyAt: integer("ready_at"),
  },
  (table) => [
    foreignKey({
      name: "media_assets_person_fk",
      columns: [table.spaceId, table.personId],
      foreignColumns: [people.spaceId, people.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "media_assets_story_fk",
      columns: [table.spaceId, table.personId, table.storyId],
      foreignColumns: [stories.spaceId, stories.personId, stories.id],
    }).onDelete("restrict"),
    uniqueIndex("media_assets_r2_key_uq").on(table.r2Key),
    index("media_assets_person_status_created_idx").on(
      table.personId,
      table.status,
      table.createdAt,
    ),
    check("media_assets_byte_size_ck", sql`${table.byteSize} > 0`),
    check(
      "media_assets_ready_at_ck",
      sql`(${table.status} = 'ready' and ${table.readyAt} is not null) or (${table.status} <> 'ready' and ${table.readyAt} is null)`,
    ),
  ],
);

export const shareSets = sqliteTable(
  "share_sets",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => familySpaces.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: SHARE_SET_KINDS }).notNull(),
    label: text("label").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    uniqueIndex("share_sets_space_id_id_uq").on(table.spaceId, table.id),
    index("share_sets_space_active_idx").on(table.spaceId, table.revokedAt),
  ],
);

// A branch is a materialized reviewed set. Graph edits cannot silently widen it.
export const shareSetPeople = sqliteTable(
  "share_set_people",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    shareSetId: text("share_set_id").notNull(),
    personId: text("person_id").notNull(),
    addedByUserId: text("added_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    addedAt: integer("added_at").notNull(),
    removedAt: integer("removed_at"),
    removedByUserId: text("removed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    foreignKey({
      name: "share_set_people_set_fk",
      columns: [table.spaceId, table.shareSetId],
      foreignColumns: [shareSets.spaceId, shareSets.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "share_set_people_person_fk",
      columns: [table.spaceId, table.personId],
      foreignColumns: [people.spaceId, people.id],
    }).onDelete("restrict"),
    uniqueIndex("share_set_people_active_member_uq")
      .on(table.shareSetId, table.personId)
      .where(sql`${table.removedAt} is null`),
    index("share_set_people_person_set_idx").on(
      table.personId,
      table.shareSetId,
    ),
    check(
      "share_set_people_removal_ck",
      sql`(${table.removedAt} is null and ${table.removedByUserId} is null) or (${table.removedAt} > ${table.addedAt} and ${table.removedByUserId} is not null)`,
    ),
  ],
);

export const shareGrants = sqliteTable(
  "share_grants",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    shareSetId: text("share_set_id").notNull(),
    granteeUserId: text("grantee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    permission: text("permission", { enum: SHARE_PERMISSIONS }).notNull(),
    grantedByUserId: text("granted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    revokedAt: integer("revoked_at"),
    revokedByUserId: text("revoked_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    foreignKey({
      name: "share_grants_set_fk",
      columns: [table.spaceId, table.shareSetId],
      foreignColumns: [shareSets.spaceId, shareSets.id],
    }).onDelete("restrict"),
    uniqueIndex("share_grants_active_grantee_uq")
      .on(table.shareSetId, table.granteeUserId)
      .where(sql`${table.revokedAt} is null`),
    index("share_grants_grantee_set_idx").on(
      table.granteeUserId,
      table.shareSetId,
    ),
    check(
      "share_grants_revocation_ck",
      sql`(${table.revokedAt} is null and ${table.revokedByUserId} is null) or (${table.revokedAt} > ${table.createdAt} and ${table.revokedByUserId} is not null)`,
    ),
  ],
);

// Application code only appends audit rows. Corrections are new events.
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => familySpaces.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    dedupeKey: text("dedupe_key"),
  },
  (table) => [
    uniqueIndex("audit_events_dedupe_key_uq").on(table.dedupeKey),
    index("audit_events_resource_time_idx").on(
      table.resourceType,
      table.resourceId,
      table.occurredAt,
    ),
    index("audit_events_space_time_idx").on(table.spaceId, table.occurredAt),
  ],
);

export const transferCases = sqliteTable(
  "transfer_cases",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    personId: text("person_id").notNull(),
    targetUserId: text("target_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    // No default: a caller must explicitly choose draft or policy_blocked.
    status: text("status", { enum: TRANSFER_CASE_STATUSES }).notNull(),
    eligibilityCivilDate: text("eligibility_civil_date"),
    eligibilityAt: integer("eligibility_at"),
    eligibilityTimeZone: text("eligibility_time_zone"),
    policyVersion: text("policy_version"),
    noAccountPolicy: text("no_account_policy"),
    policyBlockedReason: text("policy_blocked_reason"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
    completionAuditEventId: text("completion_audit_event_id")
      .unique()
      .references(() => auditEvents.id, { onDelete: "restrict" }),
  },
  (table) => [
    foreignKey({
      name: "transfer_cases_person_fk",
      columns: [table.spaceId, table.personId],
      foreignColumns: [people.spaceId, people.id],
    }).onDelete("restrict"),
    index("transfer_cases_person_status_idx").on(table.personId, table.status),
    check(
      "transfer_cases_completion_ck",
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null and ${table.completionAuditEventId} is not null) or (${table.status} <> 'completed' and ${table.completedAt} is null and ${table.completionAuditEventId} is null)`,
    ),
    check(
      "transfer_cases_policy_block_ck",
      sql`${table.status} <> 'policy_blocked' or ${table.policyBlockedReason} is not null`,
    ),
  ],
);
