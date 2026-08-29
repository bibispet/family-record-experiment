import assert from "node:assert/strict";
import test from "node:test";
import {
  EXAMPLE_SEED_PLAN,
  deterministicUuid,
  seedFamily,
  seedIdentity,
  validateSeedPlan,
  type SeedPlan,
} from "../db/seed";

type BoundStatement = { sql: string; params: unknown[] };

/** D1 recorder: captures the exact bound rows so the test can assert shapes. */
function fakeD1(): { database: D1Database; records: BoundStatement[] } {
  const records: BoundStatement[] = [];
  const statement = {
    run: async () => {},
    first: async () => null,
    all: async () => ({ results: [] }),
    bind: () => {
      throw new Error("double bind");
    },
  };
  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          records.push({ sql, params });
          return statement;
        },
        run: async () => {},
        first: async () => null,
        all: async () => ({ results: [] }),
      };
    },
    batch: async () => {},
  } as unknown as D1Database;
  return { database, records };
}

test("example seed plan passes validation", () => {
  assert.doesNotThrow(() => validateSeedPlan(EXAMPLE_SEED_PLAN));
});

test("validation rejects unknown or self-referencing people", () => {
  const mutated: SeedPlan = structuredClone(EXAMPLE_SEED_PLAN);
  mutated.relationships = [
    ...mutated.relationships,
    { source: "Amara Adeyemi", target: "No One Here", relationshipType: "parent_of", evidenceMode: "oral", endedAt: null },
  ];
  assert.throws(() => validateSeedPlan(mutated), /No One Here/);

  const selfReference: SeedPlan = structuredClone(EXAMPLE_SEED_PLAN);
  selfReference.stories[0] = { person: "No Such Person", body: "y" };
  assert.throws(() => validateSeedPlan(selfReference), /No Such Person/);
});

test("a remarriage is modeled as an ended spouse bond, not a deleted one", () => {
  const ended = EXAMPLE_SEED_PLAN.relationships.filter((relationship) => relationship.endedAt !== null);
  assert.equal(ended.length, 1);
  const endedBond = ended[0];
  assert.ok(endedBond);
  assert.equal(endedBond.relationshipType, "spouse_of");
  assert.ok(endedBond.endedAt !== null && endedBond.endedAt < Date.now());
});

test("adoption/oral parent bonds are recorded without an invented 'adopted' type", () => {
  const oralParents = EXAMPLE_SEED_PLAN.relationships.filter(
    (relationship) => relationship.evidenceMode === "oral" && relationship.relationshipType === "parent_of",
  );
  assert.ok(oralParents.length >= 1);
});

test("unknown parentage is an explicit absence of any parent_of bond", () => {
  const parentedBy = new Set(
    EXAMPLE_SEED_PLAN.relationships
      .filter((relationship) => relationship.relationshipType === "parent_of")
      .map((relationship) => relationship.target),
  );
  const priya = EXAMPLE_SEED_PLAN.people.find((person) => person.displayName === "Priya Patel");
  assert.ok(priya);
  assert.equal(priya.birthDate, null);
  assert.equal(priya.birthDateAccuracy, "unknown");
  assert.equal(parentedBy.has("Priya Patel"), false);
});

test("a one-appearance person has exactly one bond and no records of their own", () => {
  const appearances = new Map<string, number>();
  for (const relationship of EXAMPLE_SEED_PLAN.relationships) {
    appearances.set(relationship.source, (appearances.get(relationship.source) ?? 0) + 1);
    appearances.set(relationship.target, (appearances.get(relationship.target) ?? 0) + 1);
  }
  const s = EXAMPLE_SEED_PLAN.people.find((person) => person.displayName === "Sanaa Okafor");
  assert.ok(s);
  assert.equal(appearances.get("Sanaa Okafor"), 1);
  assert.equal(EXAMPLE_SEED_PLAN.stories.some((story) => story.person === "Sanaa Okafor"), false);
  assert.equal(EXAMPLE_SEED_PLAN.media.some((item) => item.person === "Sanaa Okafor"), false);
});

test("seeding inserts the full graph with stable, scoped rows", async () => {
  const { database, records } = fakeD1();
  const result = await seedFamily(database, "space-seed", "user-seed", EXAMPLE_SEED_PLAN);

  assert.equal(result.people, EXAMPLE_SEED_PLAN.people.length);
  assert.equal(result.relationships, EXAMPLE_SEED_PLAN.relationships.length);
  assert.equal(result.stories, EXAMPLE_SEED_PLAN.stories.length);
  assert.equal(result.media, EXAMPLE_SEED_PLAN.media.length);

  const byTable = (table: string) => records.filter((record) => record.sql.includes(`INSERT INTO ${table} (`));
  assert.equal(byTable("users").length, 1);
  assert.equal(byTable("family_spaces").length, 1);
  assert.equal(byTable("space_memberships").length, 1);
  assert.equal(byTable("people").length, result.people);
  assert.equal(byTable("person_authorities").length, result.people);
  assert.equal(byTable("relationships").length, result.relationships);
  assert.equal(byTable("stories").length, result.stories);
  assert.equal(byTable("media_assets").length, result.media);

  // Ended bonds carry both ended_at and ended_by_user_id.
  for (const record of byTable("relationships")) {
    const endedAt = record.params[8];
    const endedBy = record.params[9];
    assert.equal(endedAt === null, endedBy === null);
  }

  // Ready media carry a ready_at timestamp and an opaque seed r2_key.
  for (const record of byTable("media_assets")) {
    assert.ok(record.sql.includes("'ready'"));
    assert.equal(typeof record.params[8], "string"); // created_by_user_id
    assert.equal(typeof record.params[9], "number"); // created_at
    assert.equal(typeof record.params[10], "number"); // ready_at
    assert.ok((record.params[3] as string).startsWith("seed/"));
  }

  // Every person gets exactly one record_manager authority under the steward.
  for (const record of byTable("person_authorities")) {
    assert.ok(record.sql.includes("'record_manager'"));
    assert.equal(record.params[3], "user-seed"); // user_id
    assert.equal(record.params[5], "user-seed"); // granted_by_user_id
  }

  // All rows are scoped to the seeded space and steward.
  for (const record of byTable("people")) {
    assert.equal(record.params[1], "space-seed");
  }
});

test("validateSeedPlan rejects a plan whose media references a stranger", async () => {
  const mutated: SeedPlan = structuredClone(EXAMPLE_SEED_PLAN);
  mutated.media = [{ person: "Invisible Stranger", kind: "photo", caption: "h", byteSize: 1 }];
  assert.throws(() => validateSeedPlan(mutated), /Invisible Stranger/);
});

test("the seed identity is deterministic and marks every seeded row", () => {
  assert.match(deterministicUuid("space:Archivo Adeyemi:seed-steward@example.test"), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const first = seedIdentity(EXAMPLE_SEED_PLAN);
  const second = seedIdentity(EXAMPLE_SEED_PLAN);
  assert.equal(first.spaceId, second.spaceId);
  assert.equal(first.stewardUserId, second.stewardUserId);
  assert.notEqual(first.spaceId, first.stewardUserId);
  const otherPlan: SeedPlan = { ...EXAMPLE_SEED_PLAN, spaceName: "Another Archive" };
  assert.notEqual(seedIdentity(otherPlan).spaceId, first.spaceId);
});
