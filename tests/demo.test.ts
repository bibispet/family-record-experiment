import assert from "node:assert/strict";
import test from "node:test";
import { EXAMPLE_SEED_PLAN } from "../db/seed";
import { getDemoSnapshot } from "../app/lib/demo";

test("the hosted demo exposes only the fictional checked-in seed", () => {
  const snapshot = getDemoSnapshot();
  assert.equal(snapshot.viewer.email, "seed-steward@example.test");
  assert.equal(snapshot.data.people.length, EXAMPLE_SEED_PLAN.people.length);
  assert.equal(snapshot.data.relationships.length, EXAMPLE_SEED_PLAN.relationships.length);
  assert.equal(snapshot.data.stories.length, EXAMPLE_SEED_PLAN.stories.length);
  assert.equal(snapshot.data.media.length, EXAMPLE_SEED_PLAN.media.length);
  assert.ok(snapshot.data.media.every((item) => item.accessUrl === null));
  assert.equal(snapshot.data.shares.length, 0);
});
