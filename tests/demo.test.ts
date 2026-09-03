import assert from "node:assert/strict";
import test from "node:test";
import { EXAMPLE_SEED_PLAN } from "../db/seed";
import { demoRequest } from "../app/family/demo-client";
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

test("demo mutations stay in browser memory and never call fetch", async () => {
  const snapshot = getDemoSnapshot();
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error("demo mutation reached the network");
  };

  try {
    const personId = snapshot.data.people[0]!.id;
    const response = await demoRequest<{ story: { personId: string; body: string } }>(
      `/api/people/${personId}/stories`,
      { method: "POST", body: JSON.stringify({ body: "Temporary demo text" }) },
      snapshot.data,
    );
    assert.equal(response.story.personId, personId);
    assert.equal(response.story.body, "Temporary demo text");
    assert.equal(fetched, false);
    assert.equal(snapshot.data.stories.length, EXAMPLE_SEED_PLAN.stories.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
