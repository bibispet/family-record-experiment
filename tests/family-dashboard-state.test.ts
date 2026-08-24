import assert from "node:assert/strict";
import test from "node:test";
import {
  withCreatedPerson,
  withRenamedPerson,
  withRevokedShare,
  withUnlinkedRelationship,
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
