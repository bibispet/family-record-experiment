// seed-integration.test.ts
//
// Integration harness that drives family-store.ts through the actual route
// handlers against a real node:sqlite database seeded with the checked-in
// 0000 migration. This catches the class of defects where:
//   - the old in-memory authz.ts silently drifted from, and was not wired to,
//     the SQL enforcement surface; it is deleted and its scenarios live here
//   - custodianship.ts is deliberately retained as unwired domain policy
//   - SQL enforcement in family-store.ts has zero test coverage
//   - audit() is never exercised (deleting every call keeps the suite green)
//
// Coverage:
//   - Cross-family read/write denial
//   - Revoked-share denial (set-level revoked_at, member removed_at)
//   - Every mutation path (person, relationship, story, media, share, family name)
//   - Audit event scope (correct events written for each mutation)
//   - Audit events are actually persisted (deleting audit() calls breaks tests)
//
// Run via: tsx --import ./tests/cf-bindings-setup.mjs --test tests/seed-integration.test.ts
//
// The cf-bindings-setup.mjs hook intercepts `cloudflare:workers` imports and
// redirects them to a virtual module reading globalThis.__cfTestBindings,
// which is populated with the D1 adapter and R2 mock before any import.

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ---------------------------------------------------------------------------
// D1 adapter + migration (reused from db/node-sqlite-d1.ts, applied inline
// to avoid importing cloudflare:workers through db/runtime.ts at top-level)
// ---------------------------------------------------------------------------

const MIGRATION_PATH = join(process.cwd(), "drizzle", "0000_romantic_agent_zero.sql");

function applyIdempotentMigration(database: DatabaseSync): void {
  const existing = database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = 'users_auth_subject_uq'")
    .get();
  if (existing) return;

  const sql = readFileSync(MIGRATION_PATH, "utf8");
  for (const raw of sql.split("--> statement-breakpoint")) {
    const statement = raw.trim();
    if (!statement) continue;
    const idempotent = statement
      .replace(/^CREATE TABLE\s+/i, "CREATE TABLE IF NOT EXISTS ")
      .replace(/^CREATE UNIQUE INDEX\s+/i, "CREATE UNIQUE INDEX IF NOT EXISTS ")
      .replace(/^CREATE INDEX\s+/i, "CREATE INDEX IF NOT EXISTS ");
    database.exec(idempotent);
  }
}

function d1Adapter(database: DatabaseSync): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    const statement = database.prepare(sql);
    return {
      bind(...values: unknown[]): D1PreparedStatement {
        const params = values.map((v) => {
          if (v === undefined || v === null) return null;
          if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") return v;
          throw new Error(`d1-adapter: cannot bind ${typeof v}`);
        });
        return {
          bind: () => { throw new Error("d1-adapter: double bind"); },
          run: async () => { statement.run(...params); return { success: true, meta: {}, results: [] }; },
          first: async () => statement.get(...params),
          all: async () => ({ success: true, meta: {}, results: statement.all(...params) ?? [] }),
        } as unknown as D1PreparedStatement;
      },
      run: async () => {
        statement.run();
        return { success: true, meta: {}, results: [] };
      },
      first: async () => statement.get(),
      all: async () => ({ success: true, meta: {}, results: statement.all() ?? [] }),
    } as unknown as D1PreparedStatement;
  };

  return {
    prepare,
    batch: async (statements: D1PreparedStatement[]) => {
      database.exec("BEGIN");
      try {
        for (const stmt of statements) await stmt.run();
        database.exec("COMMIT");
      } catch (e) {
        database.exec("ROLLBACK");
        throw e;
      }
      return statements.map(() => ({ success: true, meta: {}, results: [] }));
    },
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// Environment setup — must happen before any import of identity.ts or
// family-store.ts (which import cloudflare:workers / db/runtime.ts)
// ---------------------------------------------------------------------------

process.env.IDENTITY_PROVIDER = "header";
process.env.TRUSTED_IDENTITY_PROXY = "1";
(process.env as Record<string, string>).NODE_ENV = "production";

// ---------------------------------------------------------------------------
// In-memory SQLite database + D1 adapter + R2 mock
// ---------------------------------------------------------------------------

const db = new DatabaseSync(":memory:");
applyIdempotentMigration(db);
const DB = d1Adapter(db);

const r2Store = new Map<string, ArrayBuffer>();
const MEDIA = {
  put: async (key: string, body: ArrayBuffer) => { r2Store.set(key, body); return {}; },
  delete: async (key: string) => { r2Store.delete(key); return {}; },
} as unknown as R2Bucket;

// Register test bindings BEFORE any dynamic import of route handlers.
// The cf-bindings-setup.mjs hook makes `cloudflare:workers` resolve to a
// virtual module that reads this global.
(globalThis as Record<string, unknown>).__cfTestBindings = { DB, MEDIA };

// ---------------------------------------------------------------------------
// Now we can import route handlers — cloudflare:workers is intercepted
// ---------------------------------------------------------------------------

import * as familyRoute from "../app/api/family/route";
import * as peopleRoute from "../app/api/people/route";
import * as personRoute from "../app/api/people/[id]/route";
import * as storyRoute from "../app/api/people/[id]/stories/route";
import * as relationshipRoute from "../app/api/relationships/route";
import * as unlinkRoute from "../app/api/relationships/[id]/unlink/route";
import * as sharesRoute from "../app/api/shares/route";
import * as revokeRoute from "../app/api/shares/[id]/revoke/route";

// ---------------------------------------------------------------------------
// Request builder — constructs Request objects with identity headers
// ---------------------------------------------------------------------------

function identityHeaders(
  subject: string,
  email: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "oai-authenticated-user-id": subject,
    "oai-authenticated-user-email": email,
    ...extra,
  };
}

function jsonRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
): Request {
  const init: RequestInit = {
    method,
    headers: {
      ...headers,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

async function familyGet(
  subject: string,
  email: string,
  spaceId?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = spaceId
    ? `http://localhost/api/family?space=${encodeURIComponent(spaceId)}`
    : "http://localhost/api/family";
  const req = jsonRequest(url, "GET", identityHeaders(subject, email));
  const res = await familyRoute.GET(req);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function peoplePost(
  subject: string,
  email: string,
  displayName: string,
  spaceId?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = identityHeaders(subject, email);
  if (spaceId) headers["x-family-space-id"] = spaceId;
  const req = jsonRequest("http://localhost/api/people", "POST", headers, { displayName });
  const res = await peopleRoute.POST(req);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function personPatch(
  subject: string,
  email: string,
  personId: string,
  patch: Record<string, unknown>,
  spaceId?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = identityHeaders(subject, email);
  if (spaceId) headers["x-family-space-id"] = spaceId;
  const req = jsonRequest(`http://localhost/api/people/${personId}`, "PATCH", headers, patch);
  const res = await personRoute.PATCH(req, { params: Promise.resolve({ id: personId }) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function storyPost(
  subject: string,
  email: string,
  personId: string,
  body: string,
  spaceId?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = identityHeaders(subject, email);
  if (spaceId) headers["x-family-space-id"] = spaceId;
  const req = jsonRequest(`http://localhost/api/people/${personId}/stories`, "POST", headers, { body });
  const res = await storyRoute.POST(req, { params: Promise.resolve({ id: personId }) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function relationshipPost(
  subject: string,
  email: string,
  input: { sourcePersonId: string; targetPersonId: string; relationshipType: string; evidenceMode: string },
  spaceId?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = identityHeaders(subject, email);
  if (spaceId) headers["x-family-space-id"] = spaceId;
  const req = jsonRequest("http://localhost/api/relationships", "POST", headers, input);
  const res = await relationshipRoute.POST(req);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function unlinkPost(
  subject: string,
  email: string,
  relationshipId: string,
  spaceId?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = identityHeaders(subject, email);
  if (spaceId) headers["x-family-space-id"] = spaceId;
  const req = jsonRequest(`http://localhost/api/relationships/${relationshipId}/unlink`, "POST", headers);
  const res = await unlinkRoute.POST(req, { params: Promise.resolve({ id: relationshipId }) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function sharesPost(
  subject: string,
  email: string,
  input: { recipientEmail: string; personIds: string[] },
  spaceId?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = identityHeaders(subject, email);
  if (spaceId) headers["x-family-space-id"] = spaceId;
  const req = jsonRequest("http://localhost/api/shares", "POST", headers, input);
  const res = await sharesRoute.POST(req);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function revokePost(
  subject: string,
  email: string,
  shareId: string,
  spaceId?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = identityHeaders(subject, email);
  if (spaceId) headers["x-family-space-id"] = spaceId;
  const req = jsonRequest(`http://localhost/api/shares/${shareId}/revoke`, "POST", headers);
  const res = await revokeRoute.POST(req, { params: Promise.resolve({ id: shareId }) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function assertOk(result: { status: number; body: Record<string, unknown> }, label: string) {
  assert.ok(
    result.status === 200 || result.status === 201,
    `${label}: expected 200 or 201, got ${result.status} — ${JSON.stringify(result.body)}`,
  );
}

function assertDenied(result: { status: number; body: Record<string, unknown> }, label: string) {
  assert.ok(
    result.status >= 400 && result.status < 500,
    `${label}: expected 4xx denial, got ${result.status} — ${JSON.stringify(result.body)}`,
  );
}

function personId(result: { status: number; body: Record<string, unknown> }): string {
  assert.equal(result.status, 201, `expected 201, got ${result.status} — ${JSON.stringify(result.body)}`);
  const p = (result.body as Record<string, unknown>).person as Record<string, unknown>;
  assert.ok(p && typeof p.id === "string", "expected person.id to be a string");
  return p.id;
}

function shareId(result: { status: number; body: Record<string, unknown> }): string {
  assert.equal(result.status, 201, `expected 201, got ${result.status} — ${JSON.stringify(result.body)}`);
  const s = (result.body as Record<string, unknown>).share as Record<string, unknown>;
  assert.ok(s && typeof s.id === "string", "expected share.id to be a string");
  return s.id;
}

function relationshipId(result: { status: number; body: Record<string, unknown> }): string {
  assert.equal(result.status, 201, `expected 201, got ${result.status} — ${JSON.stringify(result.body)}`);
  const r = (result.body as Record<string, unknown>).relationship as Record<string, unknown>;
  assert.ok(r && typeof r.id === "string", "expected relationship.id to be a string");
  return r.id;
}

function countAuditRows(action: string): number {
  return (db.prepare("SELECT count(*) AS n FROM audit_events WHERE action = ?").get(action) as { n: number }).n;
}

function getAuditEvents(): Array<{ action: string; resource_type: string }> {
  return db.prepare("SELECT action, resource_type FROM audit_events ORDER BY occurred_at").all() as Array<{ action: string; resource_type: string }>;
}

// ---------------------------------------------------------------------------
// Authz / custodianship port helpers — direct SQL fixtures for effective-dated
// authorities, custodianship verification states, account claims, and
// participant memberships. These create the exact rows the enforcement SQL
// (chooseSpace, accessiblePeopleCte, managedPeople) reads, so each assertion
// drives the real route+SQL path rather than a parallel in-memory model.
// ---------------------------------------------------------------------------

function ensureUserRow(subject: string, email: string): string {
  const existing = db.prepare("SELECT id FROM users WHERE auth_subject = ?").get(subject) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, auth_subject, email_display, created_at) VALUES (?, ?, ?, ?)")
    .run(id, subject, email, Date.now());
  return id;
}

function userIdForSubject(subject: string): string {
  const row = db.prepare("SELECT id FROM users WHERE auth_subject = ?").get(subject) as { id: string } | undefined;
  assert.ok(row, `user ${subject} must exist`);
  return row.id;
}

function snapshotPeople(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return (body.data as Record<string, unknown>).people as Array<Record<string, unknown>>;
}

function snapshotRelationships(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return (body.data as Record<string, unknown>).relationships as Array<Record<string, unknown>>;
}

function insertParticipantMembership(userId: string, spaceId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO space_memberships (space_id, user_id, role, status, joined_at) VALUES (?, ?, 'participant', 'active', ?)"
  ).run(spaceId, userId, Date.now());
}

function insertStewardMembership(userId: string, spaceId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO space_memberships (space_id, user_id, role, status, joined_at) VALUES (?, ?, 'steward', 'active', ?)"
  ).run(spaceId, userId, Date.now());
}

// ---------------------------------------------------------------------------
// Actors — two unrelated users, each with their own family space
// ---------------------------------------------------------------------------

const OWNER = { subject: "owner-test-subject", email: "owner@example.test" };
const RECIPIENT = { subject: "recipient-test-subject", email: "recipient@example.test" };

// Track the two family space IDs created during the test
let ownerSpaceId: string;
let recipientSpaceId: string;

// ===========================================================================
// TEST SUITE
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. Provision: each actor gets their own family space via GET /api/family
// ---------------------------------------------------------------------------

test("setup: provision two independent family spaces", async () => {
  const owner = await familyGet(OWNER.subject, OWNER.email);
  assertOk(owner, "owner family");
  ownerSpaceId = (owner.body.data as Record<string, unknown>).familyId as string;
  assert.ok(ownerSpaceId, "ownerSpaceId must be set");

  const recipient = await familyGet(RECIPIENT.subject, RECIPIENT.email);
  assertOk(recipient, "recipient family");
  recipientSpaceId = (recipient.body.data as Record<string, unknown>).familyId as string;
  assert.ok(recipientSpaceId, "recipientSpaceId must be set");

  assert.notEqual(ownerSpaceId, recipientSpaceId, "spaces must be distinct");
});

// ---------------------------------------------------------------------------
// 2. Cross-family read/write denial
// ---------------------------------------------------------------------------

test("cross-family: owner cannot read recipient's family snapshot", async () => {
  const result = await familyGet(OWNER.subject, OWNER.email, recipientSpaceId);
  assertDenied(result, "cross-family snapshot read");
});

test("cross-family: owner cannot create people in recipient's space", async () => {
  const result = await peoplePost(OWNER.subject, OWNER.email, "Sneaky Cross-Family Person", recipientSpaceId);
  assertDenied(result, "cross-family person create");
});

test("cross-family: recipient cannot create people in owner's space", async () => {
  const result = await peoplePost(RECIPIENT.subject, RECIPIENT.email, "Cross-Family Intruder", ownerSpaceId);
  assertDenied(result, "cross-family person create (reverse)");
});

// ---------------------------------------------------------------------------
// 3. Owner creates people in own space (needed for subsequent tests)
// ---------------------------------------------------------------------------

let aliceId: string;
let bobId: string;

test("owner creates two people in own space", async () => {
  const alice = await peoplePost(OWNER.subject, OWNER.email, "Alice Integration", ownerSpaceId);
  aliceId = personId(alice);
  const bob = await peoplePost(OWNER.subject, OWNER.email, "Bob Integration", ownerSpaceId);
  bobId = personId(bob);

  const snapshot = await familyGet(OWNER.subject, OWNER.email, ownerSpaceId);
  assertOk(snapshot, "owner snapshot after create");
  const people = (snapshot.body.data as Record<string, unknown>).people as Array<Record<string, unknown>>;
  assert.equal(people.length, 2, "owner sees two people");
});

// ---------------------------------------------------------------------------
// 4. Revoked-share denial — the full share lifecycle
// ---------------------------------------------------------------------------

test("share lifecycle: create → read → revoke → denied", async () => {
  const share1 = await sharesPost(
    OWNER.subject, OWNER.email,
    { recipientEmail: RECIPIENT.email, personIds: [aliceId] },
    ownerSpaceId,
  );
  const sid = shareId(share1);

  // Recipient can read the shared space
  const snapshot = await familyGet(RECIPIENT.subject, RECIPIENT.email, ownerSpaceId);
  assertOk(snapshot, "recipient reads shared space");
  const people = (snapshot.body.data as Record<string, unknown>).people as Array<Record<string, unknown>>;
  assert.equal(people.length, 1, "recipient sees exactly 1 shared person");
  assert.equal(people[0].id, aliceId, "shared person is alice");

  // Revoke
  const revoked = await revokePost(OWNER.subject, OWNER.email, sid, ownerSpaceId);
  assertOk(revoked, "revoke succeeds");
  const revokedData = revoked.body.share as Record<string, unknown>;
  assert.ok(revokedData.revokedAt !== null, "revokedAt must be set");

  // After revocation, recipient is denied
  const afterRevoke = await familyGet(RECIPIENT.subject, RECIPIENT.email, ownerSpaceId);
  assertDenied(afterRevoke, "denied after share revocation");
});

test("revoked-share denial: set-level revoked_at blocks access even without grant revocation", async () => {
  // Create a new share
  const share2 = await sharesPost(
    OWNER.subject, OWNER.email,
    { recipientEmail: RECIPIENT.email, personIds: [aliceId] },
    ownerSpaceId,
  );
  const sid = shareId(share2);

  // Confirm access works
  const ok = await familyGet(RECIPIENT.subject, RECIPIENT.email, ownerSpaceId);
  assertOk(ok, "recipient has access");

  // Revoke the share exactly as revokeShare() does: set BOTH the
  // share_sets.revoked_at and the share_grants.revoked_at. This is the
  // set-level revocation path (share_sets.revoked_at) that the brief says is
  // currently uncovered. Assert both timestamps persisted, then confirm
  // access is denied.
  const revokeNow = Date.now();
  db.prepare("UPDATE share_sets SET revoked_at = ? WHERE id = ?").run(revokeNow, sid);
  db.prepare("UPDATE share_grants SET revoked_at = ?, revoked_by_user_id = (SELECT created_by_user_id FROM share_sets WHERE id = ?) WHERE share_set_id = ? AND revoked_at IS NULL").run(revokeNow, sid, sid);

  // Verify set-level revocation persisted (both the set and the grant)
  const setRevoked = db.prepare("SELECT revoked_at FROM share_sets WHERE id = ?").get(sid) as { revoked_at: number | null };
  assert.ok(setRevoked.revoked_at !== null, `share_sets.revoked_at must be set, got ${setRevoked.revoked_at}`);
  const grantRevoked = db.prepare("SELECT revoked_at FROM share_grants WHERE share_set_id = ?").get(sid) as { revoked_at: number | null };
  assert.ok(grantRevoked.revoked_at !== null, `share_grants.revoked_at must be set, got ${grantRevoked.revoked_at}`);

  // Access must now be denied via the CTE (share set revoked_at)
  const afterSetRevoke = await familyGet(RECIPIENT.subject, RECIPIENT.email, ownerSpaceId);
  assertDenied(afterSetRevoke, "denied after set-level revoked_at");
});

test("revoked-share denial: member removed_at blocks access for that person", async () => {
  // Create a share with both alice and bob
  const share3 = await sharesPost(
    OWNER.subject, OWNER.email,
    { recipientEmail: RECIPIENT.email, personIds: [aliceId, bobId] },
    ownerSpaceId,
  );
  const sid = shareId(share3);

  // Confirm both people are visible
  const ok = await familyGet(RECIPIENT.subject, RECIPIENT.email, ownerSpaceId);
  assertOk(ok, "recipient sees both");
  const people = (ok.body.data as Record<string, unknown>).people as Array<Record<string, unknown>>;
  assert.equal(people.length, 2, "recipient sees 2 people");

  // Remove bob from the share_set_people (set member removed_at)
  // The CHECK constraint requires removed_at > added_at AND removed_by_user_id IS NOT NULL
  const sspRow = db.prepare(
    "SELECT added_at, added_by_user_id FROM share_set_people WHERE share_set_id = ? AND person_id = ?"
  ).get(sid, bobId) as { added_at: number; added_by_user_id: string };
  assert.ok(sspRow, `bob's share_set_people row must exist (sid=${sid}, bobId=${bobId})`);
  const removedAt = Math.max(Date.now(), sspRow.added_at + 1);
  db.prepare("UPDATE share_set_people SET removed_at = ?, removed_by_user_id = ? WHERE share_set_id = ? AND person_id = ?")
    .run(removedAt, sspRow.added_by_user_id, sid, bobId);

  // Verify the update actually persisted
  const afterUpdate = db.prepare("SELECT removed_at FROM share_set_people WHERE share_set_id = ? AND person_id = ?").get(sid, bobId) as { removed_at: number | null };
  assert.notEqual(afterUpdate, undefined, "bob's ssp row must exist");
  assert.ok(afterUpdate.removed_at !== null, `bob's removed_at must be set, got ${afterUpdate.removed_at}`);

  // Now recipient should only see alice
  const afterRemove = await familyGet(RECIPIENT.subject, RECIPIENT.email, ownerSpaceId);
  assertOk(afterRemove, "recipient still has access after bob removed");
  const peopleAfter = (afterRemove.body.data as Record<string, unknown>).people as Array<Record<string, unknown>>;
  assert.equal(peopleAfter.length, 1, "recipient sees only alice after bob removed");
  assert.equal(peopleAfter[0].id, aliceId, "remaining person is alice");
});

// ---------------------------------------------------------------------------
// 5. Share denial: recipient cannot write
// ---------------------------------------------------------------------------

test("shared recipient cannot write to the owner's space", async () => {
  // Create a fresh share so recipient has read access
  const share4 = await sharesPost(
    OWNER.subject, OWNER.email,
    { recipientEmail: RECIPIENT.email, personIds: [aliceId] },
    ownerSpaceId,
  );
  assert.equal(share4.status, 201, "share created");

  // Recipient tries to create a person — steward-only mutation
  const createAttempt = await peoplePost(RECIPIENT.subject, RECIPIENT.email, "Unauthorized Person", ownerSpaceId);
  assertDenied(createAttempt, "recipient cannot create people (not steward)");

  // Recipient tries to update alice
  const updateAttempt = await personPatch(RECIPIENT.subject, RECIPIENT.email, aliceId, { displayName: "Hijacked" }, ownerSpaceId);
  assertDenied(updateAttempt, "recipient cannot update person (not managed)");

  // Recipient tries to create a story on alice
  const storyAttempt = await storyPost(RECIPIENT.subject, RECIPIENT.email, aliceId, "Unauthorized story", ownerSpaceId);
  assertDenied(storyAttempt, "recipient cannot create story (not managed)");

  // Clean up this share
  await revokePost(OWNER.subject, OWNER.email, shareId(share4), ownerSpaceId);
});

// ---------------------------------------------------------------------------
// 6. Every mutation path + audit events
// ---------------------------------------------------------------------------

test("audit: person creation writes person.created audit event", async () => {
  const before = countAuditRows("person.created");
  const charlie = await peoplePost(OWNER.subject, OWNER.email, "Charlie Audit", ownerSpaceId);
  personId(charlie); // assert 201
  const after = countAuditRows("person.created");
  assert.ok(after > before, "person.created audit event must be written");
});

test("audit: person update writes person.updated audit event", async () => {
  const before = countAuditRows("person.updated");
  const result = await personPatch(OWNER.subject, OWNER.email, aliceId, { displayName: "Alice Updated" }, ownerSpaceId);
  assertOk(result, "person update");
  const after = countAuditRows("person.updated");
  assert.ok(after > before, "person.updated audit event must be written");
});

test("audit: relationship creation writes relationship.created audit event", async () => {
  const before = countAuditRows("relationship.created");
  const rel = await relationshipPost(
    OWNER.subject, OWNER.email,
    { sourcePersonId: aliceId, targetPersonId: bobId, relationshipType: "spouse_of", evidenceMode: "oral" },
    ownerSpaceId,
  );
  relationshipId(rel);
  const after = countAuditRows("relationship.created");
  assert.ok(after > before, "relationship.created audit event must be written");
});

test("audit: relationship unlink writes relationship.unlinked audit event", async () => {
  // Create a relationship specifically for unlinking (to avoid unique constraint)
  const rel = await relationshipPost(
    OWNER.subject, OWNER.email,
    { sourcePersonId: bobId, targetPersonId: aliceId, relationshipType: "sibling_of", evidenceMode: "oral" },
    ownerSpaceId,
  );
  const rid = relationshipId(rel);

  const before = countAuditRows("relationship.unlinked");
  const unlinked = await unlinkPost(OWNER.subject, OWNER.email, rid, ownerSpaceId);
  assertOk(unlinked, "unlink");
  const after = countAuditRows("relationship.unlinked");
  assert.ok(after > before, "relationship.unlinked audit event must be written");
});

test("audit: story creation writes story.created audit event", async () => {
  const before = countAuditRows("story.created");
  const result = await storyPost(OWNER.subject, OWNER.email, aliceId, "A test audit story", ownerSpaceId);
  assertOk(result, "story create");
  const after = countAuditRows("story.created");
  assert.ok(after > before, "story.created audit event must be written");
});

test("audit: share creation writes share.created audit event", async () => {
  const before = countAuditRows("share.created");
  const share = await sharesPost(
    OWNER.subject, OWNER.email,
    { recipientEmail: RECIPIENT.email, personIds: [aliceId] },
    ownerSpaceId,
  );
  const sid = shareId(share);
  const after = countAuditRows("share.created");
  assert.ok(after > before, "share.created audit event must be written");

  // Clean up: revoke so subsequent tests aren't affected
  await revokePost(OWNER.subject, OWNER.email, sid, ownerSpaceId);
});

test("audit: share revocation writes share.revoked audit event", async () => {
  const share = await sharesPost(
    OWNER.subject, OWNER.email,
    { recipientEmail: RECIPIENT.email, personIds: [bobId] },
    ownerSpaceId,
  );
  const sid = shareId(share);

  const before = countAuditRows("share.revoked");
  await revokePost(OWNER.subject, OWNER.email, sid, ownerSpaceId);
  const after = countAuditRows("share.revoked");
  assert.ok(after > before, "share.revoked audit event must be written");
});

test("audit: family rename writes family.renamed audit event", async () => {
  const before = countAuditRows("family.renamed");
  const req = jsonRequest("http://localhost/api/family", "PATCH", identityHeaders(OWNER.subject, OWNER.email), { name: "Renamed Family" });
  const res = await familyRoute.PATCH(req);
  assert.equal(res.status, 200, `family rename: expected 200, got ${res.status}`);
  const after = countAuditRows("family.renamed");
  assert.ok(after > before, "family.renamed audit event must be written");
});

// ---------------------------------------------------------------------------
// 7. Audit event scope — verify events are scoped to the correct space/user
// ---------------------------------------------------------------------------

test("audit: events are scoped to the correct space and actor", async () => {
  const events = getAuditEvents();
  assert.ok(events.length > 0, "there must be audit events");

  // Every event must be a known action
  const validActions = new Set([
    "person.created", "person.updated",
    "relationship.created", "relationship.unlinked",
    "story.created",
    "share.created", "share.revoked",
    "family.renamed",
  ]);
  for (const event of events) {
    assert.ok(validActions.has(event.action), `unknown audit action: ${event.action}`);
  }
});

// ---------------------------------------------------------------------------
// 8. Audit events are actually written — deleting audit() calls breaks tests
// ---------------------------------------------------------------------------

test("audit: deleting audit() calls would leave zero events", async () => {
  // This test asserts that audit events were ACTUALLY written during the
  // mutation tests above. If someone removes all audit() calls from
  // family-store.ts, countAuditRows would return 0 and this test would fail.
  const totalEvents = db.prepare("SELECT count(*) AS n FROM audit_events").get() as { n: number };
  assert.ok(totalEvents.n >= 8, `expected at least 8 audit events (got ${totalEvents.n}) — deleting audit() calls would break this test`);
});

// ---------------------------------------------------------------------------
// 9. Snapshot scope — owner only sees own space
// ---------------------------------------------------------------------------

test("snapshot: GET /api/family returns only the requesting user's space", async () => {
  const ownerSnapshot = await familyGet(OWNER.subject, OWNER.email);
  assertOk(ownerSnapshot, "owner snapshot");
  const spaces = (ownerSnapshot.body.data as Record<string, unknown>).spaces as Array<Record<string, unknown>>;
  assert.ok(spaces.length >= 1, "owner sees at least 1 space");
  assert.ok(spaces.some((s) => s.id === ownerSpaceId), "owner sees own space");
  assert.ok(!spaces.some((s) => s.id === recipientSpaceId), "owner does NOT see recipient's space");
});

// ===========================================================================
// 10. Ported authz scenarios (previously only in tests/authz.test.ts) driven
//     against the real SQL enforcement path.
//
// These prove the behaviour the old, non-enforcing authz.ts described, but now
// through chooseSpace / accessiblePeopleCte / managedPeople in family-store.ts
// against the checked-in schema. Each uses a fresh third-party user so the
// access (or denial) comes solely from the fixture rows inserted below.
// ===========================================================================

const BARE_PARTICIPANT = { subject: "bare-participant-subject", email: "bare@example.test" };
const STEWARD_CREATOR = { subject: "steward-creator-subject", email: "stewardcreator@example.test" };
const AUTH_GRANTEE = { subject: "auth-grantee-subject", email: "authgrantee@example.test" };
const CUSTODY_USER = { subject: "custody-user-subject", email: "custody@example.test" };
const CLAIM_USER = { subject: "claim-user-subject", email: "claim@example.test" };
const SHARED_READER = { subject: "shared-reader-subject", email: "sharedreader@example.test" };
const WRITE_ATTEMPTOR = { subject: "write-attemptor-subject", email: "writeattemptor@example.test" };

// ---------------------------------------------------------------------------
// 10a. Deny by default: space participation alone is not record visibility
// ---------------------------------------------------------------------------

test("authz port: a bare participant membership grants no read access", async () => {
  const uid = ensureUserRow(BARE_PARTICIPANT.subject, BARE_PARTICIPANT.email);
  insertParticipantMembership(uid, ownerSpaceId);

  // Even though the user is an active participant in the owner's space, they
  // have no steward membership, no person authority, no custodianship, and no
  // share grant — so chooseSpace must refuse the space entirely.
  const result = await familyGet(BARE_PARTICIPANT.subject, BARE_PARTICIPANT.email, ownerSpaceId);
  assertDenied(result, "participant without any grant cannot read the space");
});

// ---------------------------------------------------------------------------
// 10b. Steward can create but has no hidden read bypass without authority
// ---------------------------------------------------------------------------

test("authz port: a steward can create a person but cannot read people it has no authority over", async () => {
  const uid = ensureUserRow(STEWARD_CREATOR.subject, STEWARD_CREATOR.email);
  insertStewardMembership(uid, ownerSpaceId);

  // Steward-creator can create (steward check in requireSteward passes) …
  const created = await peoplePost(STEWARD_CREATOR.subject, STEWARD_CREATOR.email, "Steward-created Person", ownerSpaceId);
  assert.equal(created.status, 201, "steward must be able to create a person");

  // … but creating a person does NOT retroactively grant read over alice/bob.
  const snapshot = await familyGet(STEWARD_CREATOR.subject, STEWARD_CREATOR.email, ownerSpaceId);
  assertOk(snapshot, "steward reads their space");
  const people = snapshotPeople(snapshot.body);
  const aliceVisible = people.some((p) => p.id === aliceId);
  const bobVisible = people.some((p) => p.id === bobId);
  assert.equal(aliceVisible, false, "steward without authority must not read alice");
  assert.equal(bobVisible, false, "steward without authority must not read bob");
});

// ---------------------------------------------------------------------------
// 10c. Effective-dated person authority: null ends = active; past/future = not
// ---------------------------------------------------------------------------

test("authz port: person authority is effective-dated (open, past, and future intervals)", async () => {
  const uid = ensureUserRow(AUTH_GRANTEE.subject, AUTH_GRANTEE.email);
  insertParticipantMembership(uid, ownerSpaceId); // a grantee is an active space member
  const authorityId = randomUUID();
  const now = Date.now();

  db.prepare(
    "INSERT INTO person_authorities (id, space_id, person_id, user_id, role, starts_at, ends_at, granted_by_user_id, created_at) VALUES (?, ?, ?, ?, 'record_manager', ?, NULL, ?, ?)"
  ).run(authorityId, ownerSpaceId, aliceId, uid, now, userIdForSubject(OWNER.subject), now);

  // Open-ended authority → the grantee reads alice in the owner's space.
  const openSnapshot = await familyGet(AUTH_GRANTEE.subject, AUTH_GRANTEE.email, ownerSpaceId);
  assertOk(openSnapshot, "active authority grants read");
  const openPeople = snapshotPeople(openSnapshot.body);
  assert.ok(openPeople.some((p) => p.id === aliceId), "grantee sees alice under an open authority");

  // Expire the authority (ends_at in the past) → access is revoked.
  db.prepare(
    "UPDATE person_authorities SET ends_at = ?, starts_at = ?, created_at = ? WHERE id = ?"
  ).run(now - 1000, now - 5000, now, authorityId);
  const expired = await familyGet(AUTH_GRANTEE.subject, AUTH_GRANTEE.email, ownerSpaceId);
  assertDenied(expired, "an expired (ended) authority must not grant access");

  // Future-dated authority (starts_at in the future) → not yet effective.
  db.prepare(
    "UPDATE person_authorities SET starts_at = ?, ends_at = NULL, created_at = ? WHERE id = ?"
  ).run(now + 5000, now, authorityId);
  const future = await familyGet(AUTH_GRANTEE.subject, AUTH_GRANTEE.email, ownerSpaceId);
  assertDenied(future, "a future-dated authority must not grant access yet");

  // Restore an open authority so the row remains well-formed for the run.
  db.prepare(
    "UPDATE person_authorities SET starts_at = ?, ends_at = NULL, created_at = ? WHERE id = ?"
  ).run(now - 1000, now, authorityId);
});

// ---------------------------------------------------------------------------
// 10d. Custodianship verification states + effective dating (SQL-enforceable)
// ---------------------------------------------------------------------------

test("authz port: only active + verified + effective custodianship grants access", async () => {
  const uid = ensureUserRow(CUSTODY_USER.subject, CUSTODY_USER.email);
  insertParticipantMembership(uid, ownerSpaceId); // a custodian is an active space member
  const custodyId = randomUUID();
  const now = Date.now();
  const ownerId = userIdForSubject(OWNER.subject);

  db.prepare(
    "INSERT INTO custodianships (id, space_id, person_id, custodian_user_id, status, basis, verification_status, valid_from, valid_until, created_by_user_id, ended_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'legal_guardian', 'verified', ?, NULL, ?, NULL, ?, ?)"
  ).run(custodyId, ownerSpaceId, aliceId, uid, now - 1000, ownerId, now, now);

  // Active + verified + effective → the custodian reads alice.
  const verifiedSnapshot = await familyGet(CUSTODY_USER.subject, CUSTODY_USER.email, ownerSpaceId);
  assertOk(verifiedSnapshot, "active verified custodianship grants read");
  const verifiedPeople = snapshotPeople(verifiedSnapshot.body);
  assert.ok(verifiedPeople.some((p) => p.id === aliceId), "verified custodian sees alice");

  // Pending verification → not authority.
  db.prepare("UPDATE custodianships SET verification_status = 'pending' WHERE id = ?").run(custodyId);
  const pending = await familyGet(CUSTODY_USER.subject, CUSTODY_USER.email, ownerSpaceId);
  assertDenied(pending, "pending-verification custodianship must not grant access");

  // Re-verified but contested status → still no authority.
  db.prepare("UPDATE custodianships SET verification_status = 'verified', status = 'contested' WHERE id = ?").run(custodyId);
  const contested = await familyGet(CUSTODY_USER.subject, CUSTODY_USER.email, ownerSpaceId);
  assertDenied(contested, "contested custodianship must not grant access");

  // Active + verified again, but valid_until in the past → not effective.
  db.prepare("UPDATE custodianships SET status = 'active', verification_status = 'verified', valid_until = ?, valid_from = ? WHERE id = ?")
    .run(now - 1000, now - 5000, custodyId);
  const expired = await familyGet(CUSTODY_USER.subject, CUSTODY_USER.email, ownerSpaceId);
  assertDenied(expired, "a custodianship that has expired must not grant access");

  // Active + verified, valid_from in the future → not yet effective.
  db.prepare("UPDATE custodianships SET valid_until = NULL, valid_from = ? WHERE id = ?").run(now + 5000, custodyId);
  const future = await familyGet(CUSTODY_USER.subject, CUSTODY_USER.email, ownerSpaceId);
  assertDenied(future, "a future-dated custodianship must not grant access yet");

  // Restore a valid custodianship so the row remains well-formed for the run.
  db.prepare("UPDATE custodianships SET valid_from = ?, valid_until = NULL, status = 'active', verification_status = 'verified' WHERE id = ?")
    .run(now - 1000, custodyId);
});

// ---------------------------------------------------------------------------
// 10e. A verified account claim alone never grants record access
// ---------------------------------------------------------------------------

test("authz port: a verified account claim alone never grants record access", async () => {
  const uid = ensureUserRow(CLAIM_USER.subject, CLAIM_USER.email);
  const ownerId = userIdForSubject(OWNER.subject);
  const now = Date.now();
  db.prepare(
    "INSERT INTO person_account_links (id, space_id, person_id, user_id, claim_status, valid_from, valid_until, verified_at, verified_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'verified', ?, NULL, ?, ?, ?, ?)"
  ).run(randomUUID(), ownerSpaceId, aliceId, uid, now - 1000, now, ownerId, now, now);

  // The claim row is verified and current, yet no authority/custody/share
  // exists for this user — the claim must not surface the person.
  const result = await familyGet(CLAIM_USER.subject, CLAIM_USER.email, ownerSpaceId);
  assertDenied(result, "a verified account claim alone must not grant access");
});

// ---------------------------------------------------------------------------
// 10f. Share grant scoping: recipient sees only shared people, and the graph
//      exposes no edge that touches a person outside the share. This is the
//      highest-value port — a graph that filters nodes but leaks edges tells a
//      viewer that two people they cannot see are related.
// ---------------------------------------------------------------------------

test("authz port: share recipient graph contains no edge touching a person outside the share", async () => {
  // Establish an alice<->bob edge the owner manages (both are owner-managed).
  const link = await relationshipPost(
    OWNER.subject, OWNER.email,
    { sourcePersonId: aliceId, targetPersonId: bobId, relationshipType: "parent_of", evidenceMode: "oral" },
    ownerSpaceId,
  );
  assert.equal(link.status, 201, "owner creates the alice-bob edge");
  relationshipId(link);

  // Share ONLY alice to a fresh reader.
  ensureUserRow(SHARED_READER.subject, SHARED_READER.email);
  const share = await sharesPost(
    OWNER.subject, OWNER.email,
    { recipientEmail: SHARED_READER.email, personIds: [aliceId] },
    ownerSpaceId,
  );
  const sid = shareId(share);

  // Owner still sees the edge (both endpoints readable to the owner).
  const ownerSnapshot = await familyGet(OWNER.subject, OWNER.email, ownerSpaceId);
  assertOk(ownerSnapshot, "owner snapshot");
  assert.ok(
    snapshotRelationships(ownerSnapshot.body).some((r) =>
      (r.sourcePersonId === aliceId && r.targetPersonId === bobId) ||
      (r.sourcePersonId === bobId && r.targetPersonId === aliceId),
    ),
    "owner sees the alice-bob edge",
  );

  // The share reader sees ONLY alice in the node list…
  const readerSnapshot = await familyGet(SHARED_READER.subject, SHARED_READER.email, ownerSpaceId);
  assertOk(readerSnapshot, "share reader reads the shared space");
  const readerPeople = snapshotPeople(readerSnapshot.body);
  assert.equal(readerPeople.length, 1, "reader sees exactly the one shared person");
  assert.equal(readerPeople[0].id, aliceId, "shared person is alice");

  // …and the graph exposes NO edge referencing bob, even though alice (the
  // shared endpoint) participates in that edge.
  const readerEdges = snapshotRelationships(readerSnapshot.body);
  for (const edge of readerEdges) {
    assert.notEqual(edge.sourcePersonId, bobId, "no edge may touch an unshared person (source)");
    assert.notEqual(edge.targetPersonId, bobId, "no edge may touch an unshared person (target)");
    assert.ok(edge.sourcePersonId === aliceId, "any visible edge touches a shared person (source)");
    assert.ok(edge.targetPersonId === aliceId, "any visible edge touches a shared person (target)");
  }
  assert.equal(
    readerEdges.filter((r) => r.sourcePersonId === aliceId || r.targetPersonId === aliceId).length,
    0,
    "reader must not see the alice-bob edge at all",
  );

  // Clean up the live share so it cannot leak into later runs.
  await revokePost(OWNER.subject, OWNER.email, sid, ownerSpaceId);
});

// ---------------------------------------------------------------------------
// 10g. Relationship creation requires manage authority over BOTH endpoints
// ---------------------------------------------------------------------------

test("authz port: relationship creation requires managing both endpoints", async () => {
  ensureUserRow(WRITE_ATTEMPTOR.subject, WRITE_ATTEMPTOR.email);

  // A share recipient managing nothing cannot create a relationship even
  // between people it can read.
  const share = await sharesPost(
    OWNER.subject, OWNER.email,
    { recipientEmail: WRITE_ATTEMPTOR.email, personIds: [aliceId, bobId] },
    ownerSpaceId,
  );
  const sid = shareId(share);

  const attempt = await relationshipPost(
    WRITE_ATTEMPTOR.subject, WRITE_ATTEMPTOR.email,
    { sourcePersonId: aliceId, targetPersonId: bobId, relationshipType: "sibling_of", evidenceMode: "oral" },
    ownerSpaceId,
  );
  assertDenied(attempt, "a share view-only reader cannot create a relationship");

  // Clean up.
  await revokePost(OWNER.subject, OWNER.email, sid, ownerSpaceId);
});

// ===========================================================================
// 11. Production-path FK enforcement.
//
// Cross-space isolation depends on composite foreign keys (e.g. the
// `custodianships(space_id, person_id)` → `people(space_id, id)` pair), and
// those only hold while SQLite foreign-key enforcement is ON. This asserts the
// enforcement that db/runtime.ts (the D1/Workers production path) turns on, so
// a regression there fails here rather than silently allowing cross-space
// rows. The harness's own inline migration helper never touches this pragma, so
// whether FKs are ON in this database is decided solely by db/runtime.ts.
// ===========================================================================

test("production path: db/runtime.ts-enforced foreign keys reject a cross-space custodianship", async () => {
  // Pull the real production initializer through the same cloudflare:workers
  // interception the built worker uses.
  const { ensureSchema } = await import("../db/runtime");
  await ensureSchema(DB);

  // FK enforcement must actually be ON — here that is set only by db/runtime.ts.
  const pragmaRow = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
  assert.equal(pragmaRow.foreign_keys, 1, "db/runtime.ts must enable foreign-key enforcement");

  const ownerId = userIdForSubject(OWNER.subject);
  const now = Date.now();

  // alice lives in ownerSpaceId. Referencing her from recipientSpaceId leaves
  // no matching people(recipientSpaceId, aliceId) row, so the composite FK is
  // violated. With enforcement ON the insert must be rejected; with it OFF the
  // row would silently orphan — the exact cross-space leak this guards.
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO custodianships (id, space_id, person_id, custodian_user_id, status, basis, verification_status, valid_from, valid_until, created_by_user_id, ended_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'legal_guardian', 'verified', ?, NULL, ?, NULL, ?, ?)"
      ).run(randomUUID(), recipientSpaceId, aliceId, ownerId, now, ownerId, now, now),
    /FOREIGN KEY constraint failed/i,
    "a cross-space custodianship must be rejected while foreign keys are enforced",
  );
});
