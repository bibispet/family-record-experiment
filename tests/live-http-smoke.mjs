import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.FAMILY_RECORD_TEST_URL ?? "http://[::1]:3000";
const skipIfUnreachable = process.argv.includes("--skip-if-unreachable");

// The live smoke test drives a running server (npm run dev / npm run start).
// In CI no server exists, so when --skip-if-unreachable is passed we do a cheap
// connectivity probe and exit 0 gracefully instead of failing the whole suite.
if (skipIfUnreachable) {
  let reachable = false;
  try {
    await fetch(new URL("/", baseUrl), { method: "HEAD", signal: AbortSignal.timeout(2000) });
    reachable = true;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    console.log(`Live authorization smoke skipped: no server reachable at ${baseUrl}`);
    process.exit(0);
  }
}

const runId = randomUUID();
const owner = { id: `smoke-owner-${runId}`, email: `owner-${runId}@example.test` };
const recipient = { id: `smoke-recipient-${runId}`, email: `recipient-${runId}@example.test` };

function actorHeaders(actor, spaceId, extra = {}) {
  return {
    "oai-authenticated-user-id": actor.id,
    "oai-authenticated-user-email": actor.email,
    ...(spaceId ? { "x-family-space-id": spaceId } : {}),
    ...extra,
  };
}

async function request(path, { actor, spaceId, method = "GET", json, body, expected = 200 } = {}) {
  const headers = actorHeaders(actor, spaceId, json === undefined ? {} : { "content-type": "application/json" });
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: json === undefined ? body : JSON.stringify(json),
  });
  assert.equal(response.status, expected, `${method} ${path} returned ${response.status}: ${await response.clone().text()}`);
  return response;
}

async function json(path, options) {
  return (await request(path, options)).json();
}

// Provision two unrelated private spaces through the same production route/store path.
const recipientHome = await json("/api/family", { actor: recipient });
const ownerHome = await json("/api/family", { actor: owner });
const ownerSpaceId = ownerHome.data.familyId;
const recipientSpaceId = recipientHome.data.familyId;
assert.notEqual(ownerSpaceId, recipientSpaceId);

const first = (await json("/api/people", {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "POST",
  json: { displayName: "Rosa Smoke" },
  expected: 201,
})).person;
const second = (await json("/api/people", {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "POST",
  json: { displayName: "June Smoke" },
  expected: 201,
})).person;

await request("/api/relationships", {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "POST",
  json: {
    sourcePersonId: first.id,
    targetPersonId: first.id,
    relationshipType: "sibling_of",
    evidenceMode: "verified",
  },
  expected: 400,
});

await request(`/api/people/${first.id}`, {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "PATCH",
  json: { displayName: "Rosa Smoke Updated" },
});

const relationship = (await json("/api/relationships", {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "POST",
  json: {
    sourcePersonId: first.id,
    targetPersonId: second.id,
    relationshipType: "parent_of",
    evidenceMode: "oral",
  },
  expected: 201,
})).relationship;

await request(`/api/people/${first.id}/stories`, {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "POST",
  json: { body: "A locally generated authorization smoke-test story." },
  expected: 201,
});

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const form = new FormData();
form.set("kind", "photo");
form.set("caption", "Private smoke-test photo");
form.set("file", new Blob([png], { type: "image/png" }), "smoke.png");
const uploaded = (await json(`/api/people/${first.id}/media`, {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "POST",
  body: form,
  expected: 201,
})).media;

await request(`/api/media/${uploaded.id}?space=${ownerSpaceId}`, { actor: recipient, expected: 404 });
await request(`/api/people/${first.id}`, {
  actor: recipient,
  spaceId: ownerSpaceId,
  method: "PATCH",
  json: { displayName: "Unauthorized change" },
  expected: 404,
});
await request("/api/people", {
  actor: owner,
  spaceId: recipientSpaceId,
  method: "POST",
  json: { displayName: "Cross-family attempt" },
  expected: 404,
});

const share = (await json("/api/shares", {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "POST",
  json: { recipientEmail: recipient.email, personIds: [first.id] },
  expected: 201,
})).share;

const sharedSnapshot = await json(`/api/family?space=${ownerSpaceId}`, { actor: recipient });
assert.deepEqual(sharedSnapshot.data.people.map((person) => person.id), [first.id]);
assert.equal(sharedSnapshot.data.relationships.length, 0, "an edge with a hidden endpoint must not be returned");
assert.equal(sharedSnapshot.data.stories.length, 1);
assert.equal(sharedSnapshot.data.media.length, 1);
assert.deepEqual(sharedSnapshot.data.access.managedPersonIds, []);
await request(`/api/media/${uploaded.id}?space=${ownerSpaceId}`, { actor: recipient });
await request(`/api/people/${first.id}/stories`, {
  actor: recipient,
  spaceId: ownerSpaceId,
  method: "POST",
  json: { body: "View-only users may not write." },
  expected: 404,
});

const firstUnlink = (await json(`/api/relationships/${relationship.id}/unlink`, {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "POST",
})).relationship;
const secondUnlink = (await json(`/api/relationships/${relationship.id}/unlink`, {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "POST",
})).relationship;
assert.equal(firstUnlink.endedAt, secondUnlink.endedAt, "unlink must be idempotent");
const afterUnlink = await json(`/api/family?space=${ownerSpaceId}`, { actor: owner });
assert.equal(afterUnlink.data.people.length, 2, "unlink must retain both people");

await request(`/api/shares/${share.id}/revoke`, {
  actor: owner,
  spaceId: ownerSpaceId,
  method: "POST",
});
await request(`/api/media/${uploaded.id}?space=${ownerSpaceId}`, { actor: recipient, expected: 404 });
await request(`/api/family?space=${ownerSpaceId}`, { actor: recipient, expected: 404 });

console.log(`Live authorization smoke passed against ${baseUrl}`);
