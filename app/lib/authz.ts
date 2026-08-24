import type {
  Custodianship,
  FamilyGraphDto,
  FamilyPerson,
  Id,
  MediaAssetDto,
  MediaAssetRecord,
  PersonAuthority,
  PersonSummaryDto,
  RelationshipDto,
  RelationshipRecord,
  ShareGrant,
  ShareSet,
  ShareSetPerson,
  SpaceMembership,
  StoryDto,
  StoryRecord,
  TimestampMs,
} from "./domain";
import { toPersonSummaryDto } from "./domain";

export interface AuthorizationSnapshot {
  now: TimestampMs;
  memberships: readonly SpaceMembership[];
  authorities: readonly PersonAuthority[];
  custodianships: readonly Custodianship[];
  shareSets: readonly ShareSet[];
  shareSetPeople: readonly ShareSetPerson[];
  shareGrants: readonly ShareGrant[];
}

type PersonRef = Pick<FamilyPerson, "id" | "spaceId">;

function hasActiveMembership(
  actorUserId: Id,
  spaceId: Id,
  snapshot: AuthorizationSnapshot,
): boolean {
  return snapshot.memberships.some(
    (membership) =>
      membership.userId === actorUserId &&
      membership.spaceId === spaceId &&
      membership.status === "active" &&
      membership.joinedAt <= snapshot.now,
  );
}

function isActiveInterval(
  startsAt: TimestampMs | null,
  endsAt: TimestampMs | null,
  now: TimestampMs,
): boolean {
  // A missing start is not interpreted as permission. Proposed custody rows
  // may omit validFrom, but cannot authorize until explicitly activated.
  return startsAt !== null && startsAt <= now && (endsAt === null || endsAt > now);
}

function hasActiveDirectAuthority(
  actorUserId: Id,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  return snapshot.authorities.some(
    (authority) =>
      authority.userId === actorUserId &&
      authority.spaceId === person.spaceId &&
      authority.personId === person.id &&
      isActiveInterval(authority.startsAt, authority.endsAt, snapshot.now),
  );
}

function hasActiveCustodianship(
  actorUserId: Id,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  return snapshot.custodianships.some(
    (custodianship) =>
      custodianship.custodianUserId === actorUserId &&
      custodianship.spaceId === person.spaceId &&
      custodianship.personId === person.id &&
      custodianship.status === "active" &&
      custodianship.verificationStatus === "verified" &&
      isActiveInterval(
        custodianship.validFrom,
        custodianship.validUntil,
        snapshot.now,
      ),
  );
}

function hasActiveViewGrant(
  actorUserId: Id,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  const eligibleSetIds = new Set(
    snapshot.shareGrants
      .filter(
        (grant) =>
          grant.granteeUserId === actorUserId &&
          grant.spaceId === person.spaceId &&
          grant.permission === "view" &&
          grant.createdAt <= snapshot.now &&
          (grant.revokedAt === null || grant.revokedAt > snapshot.now),
      )
      .map((grant) => grant.shareSetId),
  );

  if (eligibleSetIds.size === 0) return false;

  const activeSetIds = new Set(
    snapshot.shareSets
      .filter(
        (shareSet) =>
          shareSet.spaceId === person.spaceId &&
          eligibleSetIds.has(shareSet.id) &&
          shareSet.createdAt <= snapshot.now &&
          (shareSet.revokedAt === null || shareSet.revokedAt > snapshot.now),
      )
      .map((shareSet) => shareSet.id),
  );

  return snapshot.shareSetPeople.some(
    (entry) =>
      entry.spaceId === person.spaceId &&
      entry.personId === person.id &&
      activeSetIds.has(entry.shareSetId) &&
      entry.addedAt <= snapshot.now &&
      (entry.removedAt === null || entry.removedAt > snapshot.now),
  );
}

export function canCreatePerson(
  actorUserId: Id,
  spaceId: Id,
  snapshot: AuthorizationSnapshot,
): boolean {
  return snapshot.memberships.some(
    (membership) =>
      membership.userId === actorUserId &&
      membership.spaceId === spaceId &&
      membership.status === "active" &&
      membership.role === "steward" &&
      membership.joinedAt <= snapshot.now,
  );
}

export function canManagePerson(
  actorUserId: Id,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  if (!hasActiveMembership(actorUserId, person.spaceId, snapshot)) return false;

  return (
    hasActiveDirectAuthority(actorUserId, person, snapshot) ||
    hasActiveCustodianship(actorUserId, person, snapshot)
  );
}

export function canSharePerson(
  actorUserId: Id,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  return canManagePerson(actorUserId, person, snapshot);
}

export function canReadPerson(
  actorUserId: Id,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  if (!hasActiveMembership(actorUserId, person.spaceId, snapshot)) return false;

  return (
    hasActiveDirectAuthority(actorUserId, person, snapshot) ||
    hasActiveCustodianship(actorUserId, person, snapshot) ||
    hasActiveViewGrant(actorUserId, person, snapshot)
  );
}

export function canReadSensitivePersonDetails(
  actorUserId: Id,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  return canManagePerson(actorUserId, person, snapshot);
}

export function canReadRelationship(
  actorUserId: Id,
  relationship: RelationshipRecord,
  sourcePerson: PersonRef,
  targetPerson: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  if (
    relationship.sourcePersonId !== sourcePerson.id ||
    relationship.targetPersonId !== targetPerson.id ||
    relationship.spaceId !== sourcePerson.spaceId ||
    relationship.spaceId !== targetPerson.spaceId ||
    sourcePerson.id === targetPerson.id
  ) {
    return false;
  }

  return (
    canReadPerson(actorUserId, sourcePerson, snapshot) &&
    canReadPerson(actorUserId, targetPerson, snapshot)
  );
}

export function canCreateRelationship(
  actorUserId: Id,
  sourcePerson: PersonRef,
  targetPerson: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  if (
    sourcePerson.spaceId !== targetPerson.spaceId ||
    sourcePerson.id === targetPerson.id
  ) {
    return false;
  }

  return (
    canManagePerson(actorUserId, sourcePerson, snapshot) &&
    canManagePerson(actorUserId, targetPerson, snapshot)
  );
}

// Ending a shared relationship changes both histories. Until a unilateral
// policy is explicitly approved, unlinking uses the same authority as creation.
export const canUnlinkRelationship = canCreateRelationship;

export function canReadStory(
  actorUserId: Id,
  story: StoryRecord,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  return (
    story.spaceId === person.spaceId &&
    story.personId === person.id &&
    canReadPerson(actorUserId, person, snapshot)
  );
}

export function canManageStory(
  actorUserId: Id,
  story: StoryRecord,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  return (
    story.spaceId === person.spaceId &&
    story.personId === person.id &&
    canManagePerson(actorUserId, person, snapshot)
  );
}

export function canReadMediaAsset(
  actorUserId: Id,
  media: MediaAssetRecord,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  return (
    media.status === "ready" &&
    media.spaceId === person.spaceId &&
    media.personId === person.id &&
    canReadPerson(actorUserId, person, snapshot)
  );
}

export function canManageMediaAsset(
  actorUserId: Id,
  media: MediaAssetRecord,
  person: PersonRef,
  snapshot: AuthorizationSnapshot,
): boolean {
  return (
    media.spaceId === person.spaceId &&
    media.personId === person.id &&
    canManagePerson(actorUserId, person, snapshot)
  );
}

export function canCreateShareSet(
  actorUserId: Id,
  people: readonly PersonRef[],
  snapshot: AuthorizationSnapshot,
): boolean {
  if (people.length === 0) return false;
  const spaceId = people[0]?.spaceId;
  if (!spaceId || people.some((person) => person.spaceId !== spaceId)) {
    return false;
  }
  return people.every((person) => canSharePerson(actorUserId, person, snapshot));
}

function readablePeopleById(
  actorUserId: Id,
  spaceId: Id,
  people: readonly FamilyPerson[],
  snapshot: AuthorizationSnapshot,
): Map<Id, FamilyPerson> {
  const result = new Map<Id, FamilyPerson>();
  for (const person of people) {
    if (
      person.spaceId === spaceId &&
      canReadPerson(actorUserId, person, snapshot)
    ) {
      result.set(person.id, person);
    }
  }
  return result;
}

export function filterReadablePersonDtos(
  actorUserId: Id,
  spaceId: Id,
  people: readonly FamilyPerson[],
  snapshot: AuthorizationSnapshot,
): PersonSummaryDto[] {
  return Array.from(
    readablePeopleById(actorUserId, spaceId, people, snapshot).values(),
    (person) => toPersonSummaryDto(person),
  );
}

export function filterReadableRelationshipDtos(
  actorUserId: Id,
  spaceId: Id,
  people: readonly FamilyPerson[],
  relationships: readonly RelationshipRecord[],
  snapshot: AuthorizationSnapshot,
): RelationshipDto[] {
  const readable = readablePeopleById(actorUserId, spaceId, people, snapshot);

  return relationships.flatMap((relationship) => {
    if (relationship.spaceId !== spaceId) return [];
    const sourcePerson = readable.get(relationship.sourcePersonId);
    const targetPerson = readable.get(relationship.targetPersonId);
    if (
      !sourcePerson ||
      !targetPerson ||
      !canReadRelationship(
        actorUserId,
        relationship,
        sourcePerson,
        targetPerson,
        snapshot,
      )
    ) {
      return [];
    }

    return [
      {
        id: relationship.id,
        sourcePersonId: relationship.sourcePersonId,
        targetPersonId: relationship.targetPersonId,
        relationshipType: relationship.relationshipType,
        evidenceMode: relationship.evidenceMode,
        createdAt: relationship.createdAt,
        endedAt: relationship.endedAt,
      },
    ];
  });
}

export function buildFamilyGraphDto(
  actorUserId: Id,
  spaceId: Id,
  people: readonly FamilyPerson[],
  relationships: readonly RelationshipRecord[],
  snapshot: AuthorizationSnapshot,
): FamilyGraphDto {
  return {
    people: filterReadablePersonDtos(actorUserId, spaceId, people, snapshot),
    relationships: filterReadableRelationshipDtos(
      actorUserId,
      spaceId,
      people,
      relationships,
      snapshot,
    ),
  };
}

export function filterReadableStoryDtos(
  actorUserId: Id,
  spaceId: Id,
  people: readonly FamilyPerson[],
  stories: readonly StoryRecord[],
  snapshot: AuthorizationSnapshot,
): StoryDto[] {
  const readable = readablePeopleById(actorUserId, spaceId, people, snapshot);
  return stories.flatMap((story) => {
    const person = readable.get(story.personId);
    if (
      story.spaceId !== spaceId ||
      !person ||
      !canReadStory(actorUserId, story, person, snapshot)
    ) {
      return [];
    }
    return [
      {
        id: story.id,
        personId: story.personId,
        body: story.body,
        createdAt: story.createdAt,
        updatedAt: story.updatedAt,
      },
    ];
  });
}

export function filterReadableMediaDtos(
  actorUserId: Id,
  spaceId: Id,
  people: readonly FamilyPerson[],
  mediaAssets: readonly MediaAssetRecord[],
  snapshot: AuthorizationSnapshot,
): MediaAssetDto[] {
  const readable = readablePeopleById(actorUserId, spaceId, people, snapshot);
  return mediaAssets.flatMap((media) => {
    const person = readable.get(media.personId);
    if (
      media.spaceId !== spaceId ||
      !person ||
      !canReadMediaAsset(actorUserId, media, person, snapshot)
    ) {
      return [];
    }
    return [
      {
        id: media.id,
        personId: media.personId,
        storyId: media.storyId,
        kind: media.kind,
        canonicalMime: media.canonicalMime,
        byteSize: media.byteSize,
        caption: media.caption,
        createdAt: media.createdAt,
      },
    ];
  });
}
