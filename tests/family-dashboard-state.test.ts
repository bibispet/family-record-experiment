import assert from "node:assert/strict";
import test from "node:test";
import {
  withCreatedPerson,
  withRenamedPerson,
  withUpdatedPerson,
  withUpdatedStory,
  withDeletedStory,
  withUpdatedMedia,
  withDeletedMedia,
  withUpdatedFamilyName,
  withUpdatedRelationship,
  withRevokedShare,
  withUnlinkedRelationship,
  filterPeople,
  type FamilyDashboardData,
  type FamilyPerson,
} from "../app/family/family-dashboard-state";

function snapshot(overrides: Partial<FamilyDashboardData> = {}): FamilyDashboardData {
  return {
    familyId: "space-1",
    familyName: "Example family",
    spaces: [{ id: "space-1", name: "Example family" }],
    access: { canCreatePeople: true, managedPersonIds: ["person-existing"] },
    people: [{ id: "person-existing", displayName: "Existing relative" }],
    relationships: [],
    stories: [],
    media: [],
    shares: [],
    ...overrides,
  };
}

test("withCreatedPerson appends the person and grants local manage access", () => {
  const created: FamilyPerson = { id: "person-new", displayName: "New relative" };
  const next = withCreatedPerson(snapshot(), created);

  assert.equal(next.people.at(-1)?.id, "person-new");
  assert.deepEqual(next.access.managedPersonIds, ["person-existing", "person-new"]);
  assert.equal(next.access.canCreatePeople, true);
});

test("withCreatedPerson does not duplicate an id already in managedPersonIds", () => {
  const created: FamilyPerson = { id: "person-existing", displayName: "Existing relative" };
  const current = snapshot({
    people: [],
    access: { canCreatePeople: true, managedPersonIds: ["person-existing"] },
  });
  const next = withCreatedPerson(current, created);

  assert.deepEqual(next.access.managedPersonIds, ["person-existing"]);
  assert.equal(next.people.length, 1);
});

test("withRenamedPerson updates only the named record", () => {
  const next = withRenamedPerson(snapshot(), "person-existing", "Renamed relative");
  assert.equal(next.people[0]?.displayName, "Renamed relative");
});

test("withUnlinkedRelationship end-dates the bond and keeps the people", () => {
  const current = snapshot({
    people: [
      { id: "person-existing", displayName: "Existing relative" },
      { id: "person-new", displayName: "New relative" },
    ],
    relationships: [{
      id: "bond-1",
      sourcePersonId: "person-existing",
      targetPersonId: "person-new",
      relationshipType: "parent_of",
      evidenceMode: "oral",
      endedAt: null,
    }],
  });
  const next = withUnlinkedRelationship(current, "bond-1", "2026-08-17T00:00:00.000Z");
  assert.equal(next.relationships[0]?.endedAt, "2026-08-17T00:00:00.000Z");
  assert.equal(next.people.length, 2);
});

test("withRevokedShare marks the snapshot revoked without deleting it", () => {
  const current = snapshot({
    shares: [{ id: "share-1", recipientEmail: "kin@example.com", permission: "view", revokedAt: null }],
  });
  const next = withRevokedShare(current, "share-1", "2026-08-17T00:00:00.000Z");
  assert.equal(next.shares[0]?.revokedAt, "2026-08-17T00:00:00.000Z");
  assert.equal(next.shares.length, 1);
});

test("withUpdatedPerson updates displayName and birthDate together", () => {
  const current = snapshot({
    people: [{ id: "person-existing", displayName: "Existing relative", birthDate: null, birthDateAccuracy: "unknown" }],
  });
  const next = withUpdatedPerson(current, "person-existing", "Updated relative", "1990-05-15", "exact");
  assert.equal(next.people[0]?.displayName, "Updated relative");
  assert.equal(next.people[0]?.birthDate, "1990-05-15");
  assert.equal(next.people[0]?.birthDateAccuracy, "exact");
});

test("withUpdatedPerson can clear birthDate", () => {
  const current = snapshot({
    people: [{ id: "person-existing", displayName: "Existing relative", birthDate: "1990-05-15", birthDateAccuracy: "exact" }],
  });
  const next = withUpdatedPerson(current, "person-existing", "Existing relative", null, "unknown");
  assert.equal(next.people[0]?.birthDate, null);
  assert.equal(next.people[0]?.birthDateAccuracy, "unknown");
});

test("withUpdatedStory replaces the body of the matching story", () => {
  const current = snapshot({
    stories: [
      { id: "story-1", personId: "person-existing", body: "Old text", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "story-2", personId: "person-existing", body: "Other story", createdAt: "2026-01-02T00:00:00.000Z" },
    ],
  });
  const next = withUpdatedStory(current, "story-1", "Updated text");
  assert.equal(next.stories[0]?.body, "Updated text");
  assert.equal(next.stories[1]?.body, "Other story");
});

test("withDeletedStory removes the story and keeps others", () => {
  const current = snapshot({
    stories: [
      { id: "story-1", personId: "person-existing", body: "First", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "story-2", personId: "person-existing", body: "Second", createdAt: "2026-01-02T00:00:00.000Z" },
    ],
  });
  const next = withDeletedStory(current, "story-1");
  assert.equal(next.stories.length, 1);
  assert.equal(next.stories[0]?.id, "story-2");
});

test("withUpdatedMedia updates the caption of the matching item", () => {
  const current = snapshot({
    media: [
      { id: "media-1", personId: "person-existing", kind: "photo", caption: "Old caption", status: "ready" },
      { id: "media-2", personId: "person-existing", kind: "voice_note", caption: "Other", status: "ready" },
    ],
  });
  const next = withUpdatedMedia(current, "media-1", "New caption");
  assert.equal(next.media[0]?.caption, "New caption");
  assert.equal(next.media[1]?.caption, "Other");
});

test("withDeletedMedia removes the item and keeps others", () => {
  const current = snapshot({
    media: [
      { id: "media-1", personId: "person-existing", kind: "photo", caption: "Photo", status: "ready" },
      { id: "media-2", personId: "person-existing", kind: "voice_note", caption: "Voice", status: "ready" },
    ],
  });
  const next = withDeletedMedia(current, "media-1");
  assert.equal(next.media.length, 1);
  assert.equal(next.media[0]?.id, "media-2");
});
test("withUpdatedFamilyName replaces the family name on the dashboard data", () => {
  const original = {
    familyId: "f1",
    familyName: "Smith family",
    spaces: [],
    access: { canCreatePeople: false, managedPersonIds: [] },
    people: [],
    relationships: [],
    stories: [],
    media: [],
    shares: [],
  };
  const result = withUpdatedFamilyName(original, "Johnson family");
  assert.equal(result.familyName, "Johnson family");
  assert.equal(original.familyName, "Smith family");
});
test("withUpdatedRelationship updates type and evidence mode of the matching bond", () => {
  const original = {
    familyId: "f1",
    familyName: "Test",
    spaces: [],
    access: { canCreatePeople: false, managedPersonIds: [] },
    people: [],
    relationships: [
      { id: "r1", sourcePersonId: "p1", targetPersonId: "p2", relationshipType: "parent_of", evidenceMode: "oral", createdAt: null, endedAt: null },
    ],
    stories: [],
    media: [],
    shares: [],
  };
  const result = withUpdatedRelationship(original, "r1", "spouse_of", "verified");
  assert.equal(result.relationships[0]?.relationshipType, "spouse_of");
  assert.equal(result.relationships[0]?.evidenceMode, "verified");
  assert.equal(result.relationships.length, 1);
});

test("filterPeople returns all people when the query is empty", () => {
  const people: FamilyPerson[] = [
    { id: "p1", displayName: "Alice" },
    { id: "p2", displayName: "Bob" },
  ];
  assert.deepEqual(filterPeople(people, ""), people);
  assert.deepEqual(filterPeople(people, "   "), people);
});

test("filterPeople matches case-insensitively on displayName", () => {
  const people: FamilyPerson[] = [
    { id: "p1", displayName: "Alice" },
    { id: "p2", displayName: "Bob" },
    { id: "p3", displayName: "Charlotte" },
  ];
  const result = filterPeople(people, "ali");
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "p1");
});

test("filterPeople returns empty array when nothing matches", () => {
  const people: FamilyPerson[] = [
    { id: "p1", displayName: "Alice" },
  ];
  const result = filterPeople(people, "Zara");
  assert.equal(result.length, 0);
});
