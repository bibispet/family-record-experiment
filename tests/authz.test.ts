import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFamilyGraphDto,
  canCreatePerson,
  canCreateRelationship,
  canManagePerson,
  canReadPerson,
  filterReadableMediaDtos,
  type AuthorizationSnapshot,
} from "../app/lib/authz";
import {
  canonicalizeRelationshipEndpoints,
  type Custodianship,
  type FamilyPerson,
  type MediaAssetRecord,
  type PersonAccountLink,
  type PersonAuthority,
  type RelationshipRecord,
  type ShareGrant,
  type ShareSet,
  type ShareSetPerson,
  type SpaceMembership,
} from "../app/lib/domain";

const NOW = 1_000_000;
const SPACE_ID = "space-family";
const OWNER_ID = "user-owner";
const VIEWER_ID = "user-viewer";

function person(id: string, spaceId = SPACE_ID): FamilyPerson {
  return {
    id,
    spaceId,
    displayName: `Person ${id}`,
    birthDate: null,
    birthDateAccuracy: "unknown",
    createdByUserId: OWNER_ID,
    createdAt: 1,
    updatedAt: 1,
  };
}

function membership(
  userId: string,
  role: SpaceMembership["role"] = "participant",
  status: SpaceMembership["status"] = "active",
): SpaceMembership {
  return { spaceId: SPACE_ID, userId, role, status, joinedAt: 1 };
}

function authority(
  personId: string,
  userId = OWNER_ID,
  endsAt: number | null = null,
): PersonAuthority {
  return {
    id: `authority-${personId}-${userId}`,
    spaceId: SPACE_ID,
    personId,
    userId,
    role: "record_manager",
    startsAt: 1,
    endsAt,
    grantedByUserId: OWNER_ID,
    createdAt: 1,
  };
}

function custodianship(
  personId: string,
  custodianUserId: string,
  overrides: Partial<Custodianship> = {},
): Custodianship {
  return {
    id: `custody-${personId}-${custodianUserId}`,
    spaceId: SPACE_ID,
    personId,
    custodianUserId,
    status: "active",
    basis: "legal_guardian",
    verificationStatus: "verified",
    validFrom: 1,
    validUntil: null,
    createdByUserId: OWNER_ID,
    endedByUserId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<AuthorizationSnapshot> = {},
): AuthorizationSnapshot {
  return {
    now: NOW,
    memberships: [],
    authorities: [],
    custodianships: [],
    shareSets: [],
    shareSetPeople: [],
    shareGrants: [],
    ...overrides,
  };
}

function activeShare(personIds: readonly string[]): {
  set: ShareSet;
  members: ShareSetPerson[];
  grant: ShareGrant;
} {
  const set: ShareSet = {
    id: "set-branch",
    spaceId: SPACE_ID,
    kind: "branch",
    label: "A reviewed branch",
    createdByUserId: OWNER_ID,
    createdAt: 2,
    revokedAt: null,
  };
  return {
    set,
    members: personIds.map((personId, index) => ({
      id: `member-${index}`,
      spaceId: SPACE_ID,
      shareSetId: set.id,
      personId,
      addedByUserId: OWNER_ID,
      addedAt: 2,
      removedAt: null,
      removedByUserId: null,
    })),
    grant: {
      id: "grant-viewer",
      spaceId: SPACE_ID,
      shareSetId: set.id,
      granteeUserId: VIEWER_ID,
      permission: "view",
      grantedByUserId: OWNER_ID,
      createdAt: 2,
      revokedAt: null,
      revokedByUserId: null,
    },
  };
}

test("authorization is private by default", () => {
  const rosa = person("rosa");
  assert.equal(canReadPerson(VIEWER_ID, rosa, snapshot()), false);
  assert.equal(canManagePerson(VIEWER_ID, rosa, snapshot()), false);

  // Space participation alone is not record visibility.
  const participant = snapshot({ memberships: [membership(VIEWER_ID)] });
  assert.equal(canReadPerson(VIEWER_ID, rosa, participant), false);
  assert.equal(canManagePerson(VIEWER_ID, rosa, participant), false);
});

test("a steward can create a person but has no hidden administrator read bypass", () => {
  const rosa = person("rosa");
  const steward = snapshot({
    memberships: [membership(OWNER_ID, "steward")],
  });

  assert.equal(canCreatePerson(OWNER_ID, SPACE_ID, steward), true);
  assert.equal(canReadPerson(OWNER_ID, rosa, steward), false);
});

test("explicit authority is effective-dated and grants manage access", () => {
  const rosa = person("rosa");
  const active = snapshot({
    memberships: [membership(OWNER_ID, "steward")],
    authorities: [authority(rosa.id)],
  });
  assert.equal(canReadPerson(OWNER_ID, rosa, active), true);
  assert.equal(canManagePerson(OWNER_ID, rosa, active), true);

  const ended = snapshot({
    memberships: [membership(OWNER_ID, "steward")],
    authorities: [authority(rosa.id, OWNER_ID, NOW)],
  });
  assert.equal(canReadPerson(OWNER_ID, rosa, ended), false);
});

test("only active, verified, effective custodianship grants authority", () => {
  const child = person("child");
  const base = { memberships: [membership(OWNER_ID, "steward")] };

  assert.equal(
    canManagePerson(
      OWNER_ID,
      child,
      snapshot({
        ...base,
        custodianships: [custodianship(child.id, OWNER_ID)],
      }),
    ),
    true,
  );
  assert.equal(
    canManagePerson(
      OWNER_ID,
      child,
      snapshot({
        ...base,
        custodianships: [
          custodianship(child.id, OWNER_ID, {
            verificationStatus: "pending",
          }),
        ],
      }),
    ),
    false,
  );
  assert.equal(
    canManagePerson(
      OWNER_ID,
      child,
      snapshot({
        ...base,
        custodianships: [
          custodianship(child.id, OWNER_ID, { status: "contested" }),
        ],
      }),
    ),
    false,
  );
});

test("a verified account claim alone never grants record access", () => {
  const subject = person("subject");
  const claim: PersonAccountLink = {
    id: "claim",
    spaceId: SPACE_ID,
    personId: subject.id,
    userId: VIEWER_ID,
    claimStatus: "verified",
    validFrom: 1,
    validUntil: null,
    verifiedAt: 1,
    verifiedByUserId: OWNER_ID,
    createdAt: 1,
    updatedAt: 1,
  };
  assert.equal(claim.claimStatus, "verified");
  assert.equal(
    canReadPerson(
      VIEWER_ID,
      subject,
      snapshot({ memberships: [membership(VIEWER_ID)] }),
    ),
    false,
  );
});

test("a materialized branch grants only its reviewed people and revokes immediately", () => {
  const rosa = person("rosa");
  const june = person("june");
  const newlyAdded = person("new-person");
  const share = activeShare([rosa.id, june.id]);
  const sharedSnapshot = snapshot({
    memberships: [membership(VIEWER_ID)],
    shareSets: [share.set],
    shareSetPeople: share.members,
    shareGrants: [share.grant],
  });

  assert.equal(canReadPerson(VIEWER_ID, rosa, sharedSnapshot), true);
  assert.equal(canReadPerson(VIEWER_ID, june, sharedSnapshot), true);
  assert.equal(canReadPerson(VIEWER_ID, newlyAdded, sharedSnapshot), false);
  assert.equal(canManagePerson(VIEWER_ID, rosa, sharedSnapshot), false);

  const revokedSnapshot = snapshot({
    ...sharedSnapshot,
    shareGrants: [{ ...share.grant, revokedAt: NOW }],
  });
  assert.equal(canReadPerson(VIEWER_ID, rosa, revokedSnapshot), false);
});

test("graph DTOs never expose an edge unless both endpoints are readable", () => {
  const rosa = person("rosa");
  const june = person("june");
  const hidden = person("hidden");
  const share = activeShare([rosa.id, june.id]);
  const relationships: RelationshipRecord[] = [
    {
      id: "visible-edge",
      spaceId: SPACE_ID,
      sourcePersonId: rosa.id,
      targetPersonId: june.id,
      relationshipType: "parent_of",
      evidenceMode: "verified",
      createdByUserId: OWNER_ID,
      createdAt: 2,
      endedAt: null,
      endedByUserId: null,
    },
    {
      id: "hidden-edge",
      spaceId: SPACE_ID,
      sourcePersonId: rosa.id,
      targetPersonId: hidden.id,
      relationshipType: "close_family_friend_of",
      evidenceMode: "oral",
      createdByUserId: OWNER_ID,
      createdAt: 2,
      endedAt: null,
      endedByUserId: null,
    },
  ];
  const graph = buildFamilyGraphDto(
    VIEWER_ID,
    SPACE_ID,
    [rosa, june, hidden],
    relationships,
    snapshot({
      memberships: [membership(VIEWER_ID)],
      shareSets: [share.set],
      shareSetPeople: share.members,
      shareGrants: [share.grant],
    }),
  );

  assert.deepEqual(
    graph.people.map(({ id }) => id),
    [rosa.id, june.id],
  );
  assert.deepEqual(
    graph.relationships.map(({ id }) => id),
    ["visible-edge"],
  );
  assert.equal(JSON.stringify(graph).includes(hidden.id), false);
});

test("relationship creation requires manage authority over both same-space endpoints", () => {
  const rosa = person("rosa");
  const june = person("june");
  const otherSpace = person("elsewhere", "space-other");
  const oneAuthority = snapshot({
    memberships: [membership(OWNER_ID, "steward")],
    authorities: [authority(rosa.id)],
  });
  assert.equal(
    canCreateRelationship(OWNER_ID, rosa, june, oneAuthority),
    false,
  );

  const bothAuthorities = snapshot({
    memberships: [membership(OWNER_ID, "steward")],
    authorities: [authority(rosa.id), authority(june.id)],
  });
  assert.equal(
    canCreateRelationship(OWNER_ID, rosa, june, bothAuthorities),
    true,
  );
  assert.equal(
    canCreateRelationship(OWNER_ID, rosa, otherSpace, bothAuthorities),
    false,
  );
  assert.equal(
    canCreateRelationship(OWNER_ID, rosa, rosa, bothAuthorities),
    false,
  );
});

test("media DTOs require ready state and never expose private R2 keys", () => {
  const rosa = person("rosa");
  const share = activeShare([rosa.id]);
  const ready: MediaAssetRecord = {
    id: "photo-ready",
    spaceId: SPACE_ID,
    personId: rosa.id,
    storyId: null,
    r2Key: "private/opaque/object-key",
    kind: "photo",
    canonicalMime: "image/jpeg",
    byteSize: 123,
    caption: "At the beach",
    status: "ready",
    createdByUserId: OWNER_ID,
    createdAt: 2,
    readyAt: 3,
  };
  const pending: MediaAssetRecord = {
    ...ready,
    id: "photo-pending",
    r2Key: "private/pending-key",
    status: "pending",
    readyAt: null,
  };
  const media = filterReadableMediaDtos(
    VIEWER_ID,
    SPACE_ID,
    [rosa],
    [ready, pending],
    snapshot({
      memberships: [membership(VIEWER_ID)],
      shareSets: [share.set],
      shareSetPeople: share.members,
      shareGrants: [share.grant],
    }),
  );

  assert.equal(media.length, 1);
  assert.equal(media[0]?.id, ready.id);
  assert.equal("r2Key" in (media[0] ?? {}), false);
  assert.equal(JSON.stringify(media).includes(ready.r2Key), false);
});

test("symmetric relationship endpoints are canonicalized without changing directed ones", () => {
  assert.deepEqual(canonicalizeRelationshipEndpoints("sibling_of", "z", "a"), {
    sourcePersonId: "a",
    targetPersonId: "z",
  });
  assert.deepEqual(canonicalizeRelationshipEndpoints("parent_of", "z", "a"), {
    sourcePersonId: "z",
    targetPersonId: "a",
  });
  assert.throws(
    () => canonicalizeRelationshipEndpoints("spouse_of", "same", "same"),
    /different people/,
  );
});
