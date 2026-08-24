import assert from "node:assert/strict";
import test from "node:test";
import {
  denyIdentityProvider,
  getIdentityProvider,
  headerIdentityProvider,
  localIdentityProvider,
  viewerToApiActor,
  getViewer,
  getApiActorFromRequest,
} from "../app/lib/identity";
import { HttpError } from "../app/lib/api";
import { canReadPerson, canManagePerson, type AuthorizationSnapshot } from "../app/lib/authz";
import type { FamilyPerson, SpaceMembership } from "../app/lib/domain";

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

// Helper to run with a specific IDENTITY_PROVIDER value and restore afterwards.
async function withProvider<T>(value: string | undefined, fn: () => T | Promise<T>): Promise<T> {
  const prevIdentity = process.env.IDENTITY_PROVIDER;
  const prevAuth = process.env.AUTH_PROVIDER;
  if (value === undefined) {
    delete process.env.IDENTITY_PROVIDER;
    delete process.env.AUTH_PROVIDER;
  } else {
    process.env.IDENTITY_PROVIDER = value;
    delete process.env.AUTH_PROVIDER;
  }
  try {
    return await fn();
  } finally {
    if (prevIdentity === undefined) delete process.env.IDENTITY_PROVIDER;
    else process.env.IDENTITY_PROVIDER = prevIdentity;
    if (prevAuth === undefined) delete process.env.AUTH_PROVIDER;
    else process.env.AUTH_PROVIDER = prevAuth;
  }
}

test("identity providers expose the same interface shape", () => {
  for (const provider of [headerIdentityProvider, localIdentityProvider, denyIdentityProvider]) {
    assert.equal(typeof provider.name, "string");
    assert.equal(typeof provider.resolveViewer, "function");
    assert.equal(typeof provider.signInPath, "function");
    assert.match(provider.signInPath("/family"), /return_to=/);
  }
});

test("header provider resolves a viewer from oai-* headers", () => {
  const viewer = headerIdentityProvider.resolveViewer(
    headers({
      "oai-authenticated-user-id": "subject-1",
      "oai-authenticated-user-email": "Family@Example.test",
      "oai-authenticated-user-full-name": "Example%20User",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    }),
  );
  assert.deepEqual(viewer, {
    subjectId: "subject-1",
    email: "family@example.test",
    displayName: "Example User",
  });
  const actor = viewerToApiActor(viewer!);
  assert.deepEqual(actor, {
    authSubject: "subject-1",
    email: "family@example.test",
    displayName: "Example User",
  });
});

test("header provider handles missing identity and bad encoding", () => {
  assert.equal(
    headerIdentityProvider.resolveViewer(headers({ "oai-authenticated-user-id": "only-id" })),
    null,
  );
  assert.equal(headerIdentityProvider.resolveViewer(headers({})), null);

  const viewer = headerIdentityProvider.resolveViewer(
    headers({
      "oai-authenticated-user-id": "s1",
      "oai-authenticated-user-email": "a@example.test",
      "oai-authenticated-user-full-name": "%ZZ",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    }),
  );
  assert.equal(viewer?.displayName, null);
});

test("local provider resolves a viewer from x-local-* headers with no network", () => {
  const viewer = localIdentityProvider.resolveViewer(
    headers({
      "x-local-subject": "local-subject-1",
      "x-local-email": "Local@Example.test",
      "x-local-display-name": "Local User",
    }),
  );
  assert.deepEqual(viewer, {
    subjectId: "local-subject-1",
    email: "local@example.test",
    displayName: "Local User",
  });
  // Alias headers also work
  const alias = localIdentityProvider.resolveViewer(
    headers({
      "x-dev-user-id": "alias-subject",
      "x-dev-user-email": "Alias@Example.test",
      "x-dev-user-name": "Alias Name",
    }),
  );
  assert.deepEqual(alias, {
    subjectId: "alias-subject",
    email: "alias@example.test",
    displayName: "Alias Name",
  });
  assert.equal(localIdentityProvider.resolveViewer(headers({})), null);
});

test("each provider ignores the other's headers", () => {
  const oaiHeaders = headers({
    "oai-authenticated-user-id": "subject-oai",
    "oai-authenticated-user-email": "oai@example.test",
    "oai-authenticated-user-full-name": "OAI%20User",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  const localHeaders = headers({
    "x-local-subject": "subject-local",
    "x-local-email": "local@example.test",
    "x-local-display-name": "Local",
  });

  assert.equal(localIdentityProvider.resolveViewer(oaiHeaders), null);
  assert.equal(headerIdentityProvider.resolveViewer(localHeaders), null);
  assert.equal(denyIdentityProvider.resolveViewer(oaiHeaders), null);
  assert.equal(denyIdentityProvider.resolveViewer(localHeaders), null);
});

test("default provider refuses to trust inbound identity headers", async () => {
  await withProvider(undefined, () => {
    const provider = getIdentityProvider();
    assert.equal(provider.name, "deny");
    assert.equal(
      provider.resolveViewer(
        headers({
          "oai-authenticated-user-id": "subject-1",
          "oai-authenticated-user-email": "a@example.test",
        }),
      ),
      null,
    );
    const req = new Request("https://record.test/api/family", {
      headers: {
        "oai-authenticated-user-id": "subject-1",
        "oai-authenticated-user-email": "a@example.test",
      },
    });
    assert.equal(getViewer(req), null);
    assert.throws(
      () => getApiActorFromRequest(req),
      (e: unknown) => e instanceof HttpError && (e as HttpError).status === 401,
    );
  });
});

test("explicit opt-in to header provider trusts oai-* headers", async () => {
  await withProvider("header", () => {
    assert.equal(getIdentityProvider().name, "header");
    const req = new Request("https://record.test/api/family", {
      headers: {
        "oai-authenticated-user-id": "subject-1",
        "oai-authenticated-user-email": "a@example.test",
        "oai-authenticated-user-full-name": "Test%20User",
        "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      },
    });
    const viewer = getViewer(req);
    assert.deepEqual(viewer?.subjectId, "subject-1");
    const actor = getApiActorFromRequest(req);
    assert.equal(actor.authSubject, "subject-1");
  });
});

test("explicit opt-in to local provider trusts x-local-* headers and denies oai-*", async () => {
  await withProvider("local", () => {
    assert.equal(getIdentityProvider().name, "local");
    const localReq = new Request("https://record.test/api/family", {
      headers: {
        "x-local-subject": "local-1",
        "x-local-email": "local@example.test",
      },
    });
    const oaiReq = new Request("https://record.test/api/family", {
      headers: {
        "oai-authenticated-user-id": "oai-1",
        "oai-authenticated-user-email": "oai@example.test",
      },
    });
    assert.notEqual(getViewer(localReq), null);
    assert.equal(getViewer(oaiReq), null);
    assert.doesNotThrow(() => getApiActorFromRequest(localReq));
    assert.throws(() => getApiActorFromRequest(oaiReq), (e: unknown) => e instanceof HttpError && (e as HttpError).status === 401);
  });
});

test("viewer shape is derived from ApiActor (subjectId/email/displayName)", () => {
  const headerViewer = headerIdentityProvider.resolveViewer(
    headers({
      "oai-authenticated-user-id": "s1",
      "oai-authenticated-user-email": "USER@EXAMPLE.TEST",
    }),
  )!;
  // email is lowercased, displayName falls back to email via viewerToApiActor
  assert.equal(headerViewer.email, "user@example.test");
  assert.equal(headerViewer.displayName, null);
  assert.equal(viewerToApiActor(headerViewer).displayName, "user@example.test");
  assert.equal(viewerToApiActor(headerViewer).authSubject, "s1");

  const localViewer = localIdentityProvider.resolveViewer(
    headers({ "x-local-subject": "s2", "x-local-email": "Other@Example.test", "x-local-display-name": "Other Name" }),
  )!;
  assert.equal(localViewer.email, "other@example.test");
  assert.equal(viewerToApiActor(localViewer).displayName, "Other Name");
});

test("anonymous, outsider, cross-family and view-only denials still deny under both adapters", () => {
  // Anonymous: no viewer => no ApiActor => 401 before authz is even consulted.
  // This is true for both providers; we test via getViewer returning null.
  assert.equal(headerIdentityProvider.resolveViewer(headers({})), null);
  assert.equal(localIdentityProvider.resolveViewer(headers({})), null);
  assert.equal(denyIdentityProvider.resolveViewer(headers({})), null);

  // For the remaining cases we exercise the authorization model directly.
  // The model is unchanged: every route still makes its own server-side check.
  // Build viewers via each provider and prove the authz outcomes are identical.

  const SPACE_A = "space-a";
  const SPACE_B = "space-b";
  const OWNER = "user-owner";
  const OUTSIDER = "user-outsider";

  function person(id: string, spaceId: string): FamilyPerson {
    return {
      id,
      spaceId,
      displayName: `Person ${id}`,
      birthDate: null,
      birthDateAccuracy: "unknown",
      createdByUserId: OWNER,
      createdAt: 1,
      updatedAt: 1,
    };
  }
  function membership(userId: string, spaceId: string, role: SpaceMembership["role"] = "participant"): SpaceMembership {
    return { spaceId, userId, role, status: "active", joinedAt: 1 };
  }
  const ownerHeaderViewer = headerIdentityProvider.resolveViewer(
    headers({ "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": "owner@example.test" }),
  )!;
  const outsiderHeaderViewer = headerIdentityProvider.resolveViewer(
    headers({ "oai-authenticated-user-id": OUTSIDER, "oai-authenticated-user-email": "outsider@example.test" }),
  )!;
  const ownerLocalViewer = localIdentityProvider.resolveViewer(
    headers({ "x-local-subject": OWNER, "x-local-email": "owner@example.test" }),
  )!;
  const outsiderLocalViewer = localIdentityProvider.resolveViewer(
    headers({ "x-local-subject": OUTSIDER, "x-local-email": "outsider@example.test" }),
  )!;

  // All four viewers have same subjectId/email shape; only provider differed.
  for (const [label, outsiderViewer] of [
    ["header", outsiderHeaderViewer],
    ["local", outsiderLocalViewer],
  ] as const) {
    const outsiderActor = viewerToApiActor(outsiderViewer);
    // Simulate outsider has no membership in SPACE_A, so canReadPerson is false regardless of provider.
    // We test via canReadPerson with a snapshot that contains only owner authority.
    const rosa = person("rosa", SPACE_A);
    const snapshot: AuthorizationSnapshot = {
      now: 1000,
      memberships: [membership(OWNER, SPACE_A, "steward")],
      authorities: [
        {
          id: "a1",
          spaceId: SPACE_A,
          personId: rosa.id,
          userId: OWNER,
          role: "record_manager",
          startsAt: 1,
          endsAt: null,
          grantedByUserId: OWNER,
          createdAt: 1,
        },
      ],
      custodianships: [],
      shareSets: [],
      shareSetPeople: [],
      shareGrants: [],
    };
    assert.equal(canReadPerson(outsiderActor.authSubject, rosa, snapshot), false, `outsider via ${label} must not read`);
    assert.equal(canManagePerson(outsiderActor.authSubject, rosa, snapshot), false, `outsider via ${label} must not manage`);
  }

  // Cross-family: owner viewer from SPACE_A must not read person in SPACE_B
  for (const viewer of [ownerHeaderViewer, ownerLocalViewer]) {
    const actor = viewerToApiActor(viewer);
    const otherSpacePerson = person("other", SPACE_B);
    const crossSnapshot: AuthorizationSnapshot = {
      now: 1000,
      memberships: [membership(actor.authSubject, SPACE_A, "steward")],
      authorities: [
        {
          id: "a2",
          spaceId: SPACE_B,
          personId: otherSpacePerson.id,
          userId: actor.authSubject,
          role: "record_manager",
          startsAt: 1,
          endsAt: null,
          grantedByUserId: actor.authSubject,
          createdAt: 1,
        },
      ],
      custodianships: [],
      shareSets: [],
      shareSetPeople: [],
      shareGrants: [],
    };
    // canReadPerson requires membership in the person's space
    assert.equal(canReadPerson(actor.authSubject, otherSpacePerson, crossSnapshot), false, "cross-family must not read");
  }

  // View-only: share recipient can read but not manage, regardless of provider
  for (const viewer of [outsiderHeaderViewer, outsiderLocalViewer]) {
    const actor = viewerToApiActor(viewer);
    const rosa = person("rosa", SPACE_A);
    const viewSnapshot: AuthorizationSnapshot = {
      now: 1000,
      memberships: [membership(actor.authSubject, SPACE_A, "participant")],
      authorities: [],
      custodianships: [],
      shareSets: [{ id: "set1", spaceId: SPACE_A, kind: "branch", label: "branch", createdByUserId: OWNER, createdAt: 1, revokedAt: null }],
      shareSetPeople: [
        {
          id: "m1",
          spaceId: SPACE_A,
          shareSetId: "set1",
          personId: rosa.id,
          addedByUserId: OWNER,
          addedAt: 1,
          removedAt: null,
          removedByUserId: null,
        },
      ],
      shareGrants: [
        {
          id: "g1",
          spaceId: SPACE_A,
          shareSetId: "set1",
          granteeUserId: actor.authSubject,
          permission: "view",
          grantedByUserId: OWNER,
          createdAt: 1,
          revokedAt: null,
          revokedByUserId: null,
        },
      ],
    };
    assert.equal(canReadPerson(actor.authSubject, rosa, viewSnapshot), true, "view-only can read");
    assert.equal(canManagePerson(actor.authSubject, rosa, viewSnapshot), false, "view-only cannot manage under either provider");
  }
});
