export const SPACE_MEMBERSHIP_ROLES = ["steward", "participant"] as const;
export type SpaceMembershipRole = (typeof SPACE_MEMBERSHIP_ROLES)[number];

export const SPACE_MEMBERSHIP_STATUSES = [
  "active",
  "suspended",
  "left",
] as const;
export type SpaceMembershipStatus =
  (typeof SPACE_MEMBERSHIP_STATUSES)[number];

export const BIRTH_DATE_ACCURACIES = [
  "unknown",
  "exact",
  "approximate",
] as const;
export type BirthDateAccuracy = (typeof BIRTH_DATE_ACCURACIES)[number];

// Custodianships are modeled separately. A biological or oral relationship is
// never authority, and a custodian is never silently treated as the subject.
export const PERSON_AUTHORITY_ROLES = ["self", "record_manager"] as const;
export type PersonAuthorityRole = (typeof PERSON_AUTHORITY_ROLES)[number];

export const CUSTODIANSHIP_STATUSES = [
  "proposed",
  "pending_verification",
  "active",
  "suspended",
  "contested",
  "ended",
] as const;
export type CustodianshipStatus = (typeof CUSTODIANSHIP_STATUSES)[number];

export const CUSTODIANSHIP_BASES = [
  "parent",
  "legal_guardian",
  "court_order",
  "other",
] as const;
export type CustodianshipBasis = (typeof CUSTODIANSHIP_BASES)[number];

export const CUSTODIANSHIP_VERIFICATION_STATUSES = [
  "unverified",
  "pending",
  "verified",
  "contested",
] as const;
export type CustodianshipVerificationStatus =
  (typeof CUSTODIANSHIP_VERIFICATION_STATUSES)[number];

export const PERSON_ACCOUNT_CLAIM_STATUSES = [
  "none",
  "pending",
  "verified",
  "rejected",
  "expired",
  "contested",
] as const;
export type PersonAccountClaimStatus =
  (typeof PERSON_ACCOUNT_CLAIM_STATUSES)[number];

export const RELATIONSHIP_TYPES = [
  "parent_of",
  "spouse_of",
  "sibling_of",
  "godparent_of",
  "close_family_friend_of",
  "other",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const SYMMETRIC_RELATIONSHIP_TYPES = [
  "spouse_of",
  "sibling_of",
  "close_family_friend_of",
] as const satisfies readonly RelationshipType[];

export const RELATIONSHIP_EVIDENCE_MODES = ["verified", "oral"] as const;
export type RelationshipEvidenceMode =
  (typeof RELATIONSHIP_EVIDENCE_MODES)[number];

export const MEDIA_KINDS = ["photo", "voice_note"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = ["pending", "ready", "failed"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const SHARE_SET_KINDS = ["person", "branch"] as const;
export type ShareSetKind = (typeof SHARE_SET_KINDS)[number];

// Sharing is deliberately view-only in the first slice. Authority is explicit.
export const SHARE_PERMISSIONS = ["view"] as const;
export type SharePermission = (typeof SHARE_PERMISSIONS)[number];

// There is intentionally no default transfer state. Creating a case requires a
// deliberate policy choice, and only a separate completion operation may grant
// subject authority.
export const TRANSFER_CASE_STATUSES = [
  "draft",
  "policy_blocked",
  "ready",
  "completed",
  "held",
] as const;
export type TransferCaseStatus = (typeof TRANSFER_CASE_STATUSES)[number];

export type Id = string;
export type TimestampMs = number;

export interface AppUser {
  id: Id;
  authSubject: string;
  emailDisplay: string | null;
  createdAt: TimestampMs;
}

export interface FamilySpace {
  id: Id;
  name: string;
  createdByUserId: Id;
  createdAt: TimestampMs;
}

export interface SpaceMembership {
  spaceId: Id;
  userId: Id;
  role: SpaceMembershipRole;
  status: SpaceMembershipStatus;
  joinedAt: TimestampMs;
}

export interface FamilyPerson {
  id: Id;
  spaceId: Id;
  displayName: string;
  birthDate: string | null;
  birthDateAccuracy: BirthDateAccuracy;
  createdByUserId: Id;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
}

export interface PersonAuthority {
  id: Id;
  spaceId: Id;
  personId: Id;
  userId: Id;
  role: PersonAuthorityRole;
  startsAt: TimestampMs;
  endsAt: TimestampMs | null;
  grantedByUserId: Id;
  createdAt: TimestampMs;
}

export interface Custodianship {
  id: Id;
  spaceId: Id;
  personId: Id;
  custodianUserId: Id;
  status: CustodianshipStatus;
  basis: CustodianshipBasis;
  verificationStatus: CustodianshipVerificationStatus;
  validFrom: TimestampMs | null;
  validUntil: TimestampMs | null;
  createdByUserId: Id;
  endedByUserId: Id | null;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
}

export interface PersonAccountLink {
  id: Id;
  spaceId: Id;
  personId: Id;
  userId: Id;
  claimStatus: PersonAccountClaimStatus;
  validFrom: TimestampMs | null;
  validUntil: TimestampMs | null;
  verifiedAt: TimestampMs | null;
  verifiedByUserId: Id | null;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
}

export interface RelationshipRecord {
  id: Id;
  spaceId: Id;
  sourcePersonId: Id;
  targetPersonId: Id;
  relationshipType: RelationshipType;
  evidenceMode: RelationshipEvidenceMode;
  createdByUserId: Id;
  createdAt: TimestampMs;
  endedAt: TimestampMs | null;
  endedByUserId: Id | null;
}

export interface StoryRecord {
  id: Id;
  spaceId: Id;
  personId: Id;
  body: string;
  createdByUserId: Id;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
}

export interface MediaAssetRecord {
  id: Id;
  spaceId: Id;
  personId: Id;
  storyId: Id | null;
  r2Key: string;
  kind: MediaKind;
  canonicalMime: string;
  byteSize: number;
  caption: string;
  status: MediaStatus;
  createdByUserId: Id;
  createdAt: TimestampMs;
  readyAt: TimestampMs | null;
}

export interface ShareSet {
  id: Id;
  spaceId: Id;
  kind: ShareSetKind;
  label: string;
  createdByUserId: Id;
  createdAt: TimestampMs;
  revokedAt: TimestampMs | null;
}

export interface ShareSetPerson {
  id: Id;
  spaceId: Id;
  shareSetId: Id;
  personId: Id;
  addedByUserId: Id;
  addedAt: TimestampMs;
  removedAt: TimestampMs | null;
  removedByUserId: Id | null;
}

export interface ShareGrant {
  id: Id;
  spaceId: Id;
  shareSetId: Id;
  granteeUserId: Id;
  permission: SharePermission;
  grantedByUserId: Id;
  createdAt: TimestampMs;
  revokedAt: TimestampMs | null;
  revokedByUserId: Id | null;
}

export interface AuditEvent {
  id: Id;
  spaceId: Id;
  actorUserId: Id;
  action: string;
  resourceType: string;
  resourceId: Id;
  occurredAt: TimestampMs;
  dedupeKey: string | null;
}

export interface TransferCase {
  id: Id;
  spaceId: Id;
  personId: Id;
  targetUserId: Id | null;
  status: TransferCaseStatus;
  eligibilityCivilDate: string | null;
  eligibilityAt: TimestampMs | null;
  eligibilityTimeZone: string | null;
  policyVersion: string | null;
  noAccountPolicy: string | null;
  policyBlockedReason: string | null;
  createdByUserId: Id;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
  completedAt: TimestampMs | null;
  completionAuditEventId: Id | null;
}

// Birth dates are included only for people the viewer can already read.
// Safe client DTOs still omit authority/custodian identities, audit actors,
// media object keys, and relationship end actors.
export interface PersonSummaryDto {
  id: Id;
  displayName: string;
  birthDate: string | null;
  birthDateAccuracy: BirthDateAccuracy;
}

export function toPersonSummaryDto(
  person: Pick<FamilyPerson, "id" | "displayName" | "birthDate" | "birthDateAccuracy">,
): PersonSummaryDto {
  return {
    id: person.id,
    displayName: person.displayName,
    birthDate: person.birthDate,
    birthDateAccuracy: person.birthDateAccuracy,
  };
}

export interface RelationshipDto {
  id: Id;
  sourcePersonId: Id;
  targetPersonId: Id;
  relationshipType: RelationshipType;
  evidenceMode: RelationshipEvidenceMode;
  createdAt: TimestampMs;
  endedAt: TimestampMs | null;
}

export interface StoryDto {
  id: Id;
  personId: Id;
  body: string;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
}

export interface MediaAssetDto {
  id: Id;
  personId: Id;
  storyId: Id | null;
  kind: MediaKind;
  canonicalMime: string;
  byteSize: number;
  caption: string;
  createdAt: TimestampMs;
}

export interface FamilyGraphDto {
  people: PersonSummaryDto[];
  relationships: RelationshipDto[];
}

export function canonicalizeRelationshipEndpoints(
  relationshipType: RelationshipType,
  sourcePersonId: Id,
  targetPersonId: Id,
): { sourcePersonId: Id; targetPersonId: Id } {
  if (sourcePersonId === targetPersonId) {
    throw new Error("A relationship must connect two different people.");
  }

  const symmetric = (SYMMETRIC_RELATIONSHIP_TYPES as readonly string[]).includes(
    relationshipType,
  );
  if (symmetric && sourcePersonId.localeCompare(targetPersonId) > 0) {
    return { sourcePersonId: targetPersonId, targetPersonId: sourcePersonId };
  }

  return { sourcePersonId, targetPersonId };
}
