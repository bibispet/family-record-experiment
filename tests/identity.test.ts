import assert from "node:assert/strict";
import test from "node:test";
import { GET as getFamily } from "../app/api/family/route";
import { GET as getMedia } from "../app/api/media/[id]/route";
import { POST as createPersonMedia } from "../app/api/people/[id]/media/route";
import { PATCH as updatePerson } from "../app/api/people/[id]/route";
import { POST as createStory } from "../app/api/people/[id]/stories/route";
import { POST as createPerson } from "../app/api/people/route";
import { POST as unlinkRelationship } from "../app/api/relationships/[id]/unlink/route";
import { POST as createRelationship } from "../app/api/relationships/route";
import { POST as revokeShare } from "../app/api/shares/[id]/revoke/route";
import { POST as createShare } from "../app/api/shares/route";
import { HttpError } from "../app/lib/api";
import {
  getApiActorFromRequest,
  getIdentityProvider,
  getSignInPath,
  getViewer,
  viewerToApiActor,
  type IdentityProvider,
} from "../app/lib/identity";

type ProviderConfiguration = "header" | "local" | undefined;

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

async function withIdentityConfiguration<T>(
  provider: ProviderConfiguration,
  developmentServer: boolean,
  run: () => T | Promise<T>,
): Promise<T> {
  const previousIdentity = process.env.IDENTITY_PROVIDER;
  const previousAuth = process.env.AUTH_PROVIDER;
  const previousDevelopmentServer = globalThis.__LOCAL_IDENTITY_DEV_SERVER__;

  if (provider === undefined) delete process.env.IDENTITY_PROVIDER;
  else process.env.IDENTITY_PROVIDER = provider;
  delete process.env.AUTH_PROVIDER;
  globalThis.__LOCAL_IDENTITY_DEV_SERVER__ = developmentServer;

  try {
    return await run();
  } finally {
    if (previousIdentity === undefined) delete process.env.IDENTITY_PROVIDER;
    else process.env.IDENTITY_PROVIDER = previousIdentity;
    if (previousAuth === undefined) delete process.env.AUTH_PROVIDER;
    else process.env.AUTH_PROVIDER = previousAuth;
    if (previousDevelopmentServer === undefined) delete globalThis.__LOCAL_IDENTITY_DEV_SERVER__;
    else globalThis.__LOCAL_IDENTITY_DEV_SERVER__ = previousDevelopmentServer;
  }
}

test("configured providers satisfy the same identity interface", async () => {
  const configurations: Array<{
    name: ProviderConfiguration;
    developmentServer: boolean;
    expectedName: string;
  }> = [
    { name: undefined, developmentServer: false, expectedName: "deny" },
    { name: "header", developmentServer: false, expectedName: "header" },
    { name: "local", developmentServer: true, expectedName: "local" },
  ];

  for (const configuration of configurations) {
    await withIdentityConfiguration(configuration.name, configuration.developmentServer, () => {
      const provider: IdentityProvider = getIdentityProvider();
      assert.equal(provider.name, configuration.expectedName);
      assert.equal(typeof provider.resolveViewer, "function");
      assert.equal(typeof provider.signInPath, "function");
    });
  }
});

test("header provider preserves trusted Sites header behaviour when selected", async () => {
  await withIdentityConfiguration("header", false, () => {
    const provider = getIdentityProvider();
    const viewer = provider.resolveViewer(
      headers({
        "oai-authenticated-user-id": " subject-1 ",
        "oai-authenticated-user-email": " Family@Example.test ",
        "oai-authenticated-user-full-name": "Example%20User",
        "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      }),
    );

    assert.deepEqual(viewer, {
      subjectId: "subject-1",
      email: "family@example.test",
      displayName: "Example User",
    });
    assert.equal(provider.signInPath("/family"), "/signin-with-chatgpt?return_to=%2Ffamily");
    assert.equal(provider.signInPath("https://attacker.test"), "/signin-with-chatgpt?return_to=%2F");
    assert.equal(
      provider.resolveViewer(headers({ "oai-authenticated-user-id": "only-id" })),
      null,
    );

    const badEncoding = provider.resolveViewer(
      headers({
        "oai-authenticated-user-id": "subject-2",
        "oai-authenticated-user-email": "user@example.test",
        "oai-authenticated-user-full-name": "%ZZ",
        "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      }),
    );
    assert.equal(badEncoding?.displayName, null);
  });
});

test("local provider resolves only local headers in the development server", async () => {
  await withIdentityConfiguration("local", true, () => {
    const provider = getIdentityProvider();
    const viewer = provider.resolveViewer(
      headers({
        "x-local-subject-id": " local-subject-1 ",
        "x-local-email": " Local@Example.test ",
        "x-local-display-name": " Local User ",
      }),
    );

    assert.deepEqual(viewer, {
      subjectId: "local-subject-1",
      email: "local@example.test",
      displayName: "Local User",
    });
    assert.equal(provider.resolveViewer(headers({})), null);
    assert.equal(
      provider.resolveViewer(
        headers({
          "oai-authenticated-user-id": "subject-oai",
          "oai-authenticated-user-email": "oai@example.test",
        }),
      ),
      null,
    );
    assert.equal(provider.signInPath("/family"), "/dev/sign-in?return_to=%2Ffamily");
  });
});

test("local provider refuses to initialise outside the development server", async () => {
  await withIdentityConfiguration("local", false, () => {
    assert.throws(
      () => getIdentityProvider(),
      /available only from the Vite development server and cannot initialise in a production build/,
    );
    assert.throws(
      () =>
        getViewer(
          new Request("https://record.test/api/family", {
            headers: {
              "x-local-subject-id": "spoofed-subject",
              "x-local-email": "spoofed@example.test",
            },
          }),
        ),
      /available only from the Vite development server/,
    );
  });
});

test("default provider denies inbound identities and has a vendor-neutral sign-in path", async () => {
  await withIdentityConfiguration(undefined, false, () => {
    const request = new Request("https://record.test/api/family", {
      headers: {
        "oai-authenticated-user-id": "subject-oai",
        "oai-authenticated-user-email": "oai@example.test",
        "x-local-subject-id": "subject-local",
        "x-local-email": "local@example.test",
      },
    });

    assert.equal(getIdentityProvider().name, "deny");
    assert.equal(getViewer(request), null);
    assert.equal(getSignInPath("/family"), "/");
    assert.doesNotMatch(getSignInPath("/family"), /chatgpt|oai/i);
    assert.throws(
      () => getApiActorFromRequest(request),
      (error: unknown) => error instanceof HttpError && error.status === 401,
    );
  });
});

test("viewer maps to exactly the actor fields consumed by family-store", async () => {
  await withIdentityConfiguration("header", false, () => {
    const viewer = getViewer(
      new Request("https://record.test/api/family", {
        headers: {
          "oai-authenticated-user-id": "subject-actor",
          "oai-authenticated-user-email": "ACTOR@EXAMPLE.TEST",
        },
      }),
    );
    assert.ok(viewer);
    assert.deepEqual(viewerToApiActor(viewer), {
      authSubject: "subject-actor",
      email: "actor@example.test",
      displayName: "actor@example.test",
    });
  });
});

type ProtectedRouteCase = {
  label: string;
  invoke: () => Promise<Response>;
};

const testId = "00000000-0000-4000-8000-000000000001";
const routeContext = { params: Promise.resolve({ id: testId }) };

function jsonRequest(path: string, method: string, unselectedIdentityHeaders: Record<string, string>): Request {
  return new Request(`https://record.test${path}`, {
    method,
    headers: { ...unselectedIdentityHeaders, "content-type": "application/json" },
    body: "{}",
  });
}

function protectedRouteCases(unselectedIdentityHeaders: Record<string, string>): ProtectedRouteCase[] {
  return [
    {
      label: "GET /api/family",
      invoke: () =>
        getFamily(
          new Request("https://record.test/api/family", { headers: unselectedIdentityHeaders }),
        ),
    },
    {
      label: "POST /api/people",
      invoke: () => createPerson(jsonRequest("/api/people", "POST", unselectedIdentityHeaders)),
    },
    {
      label: "PATCH /api/people/:id",
      invoke: () =>
        updatePerson(
          jsonRequest(`/api/people/${testId}`, "PATCH", unselectedIdentityHeaders),
          routeContext,
        ),
    },
    {
      label: "POST /api/relationships",
      invoke: () =>
        createRelationship(jsonRequest("/api/relationships", "POST", unselectedIdentityHeaders)),
    },
    {
      label: "POST /api/people/:id/stories",
      invoke: () =>
        createStory(
          jsonRequest(`/api/people/${testId}/stories`, "POST", unselectedIdentityHeaders),
          routeContext,
        ),
    },
    {
      label: "POST /api/people/:id/media",
      invoke: () =>
        createPersonMedia(
          new Request(`https://record.test/api/people/${testId}/media`, {
            method: "POST",
            headers: unselectedIdentityHeaders,
          }),
          routeContext,
        ),
    },
    {
      label: "POST /api/relationships/:id/unlink",
      invoke: () =>
        unlinkRelationship(
          new Request(`https://record.test/api/relationships/${testId}/unlink`, {
            method: "POST",
            headers: unselectedIdentityHeaders,
          }),
          routeContext,
        ),
    },
    {
      label: "POST /api/shares",
      invoke: () => createShare(jsonRequest("/api/shares", "POST", unselectedIdentityHeaders)),
    },
    {
      label: "POST /api/shares/:id/revoke",
      invoke: () =>
        revokeShare(
          new Request(`https://record.test/api/shares/${testId}/revoke`, {
            method: "POST",
            headers: unselectedIdentityHeaders,
          }),
          routeContext,
        ),
    },
    {
      label: "GET /api/media/:id",
      invoke: () =>
        getMedia(
          new Request(`https://record.test/api/media/${testId}`, {
            headers: unselectedIdentityHeaders,
          }),
          routeContext,
        ),
    },
  ];
}

const routeProviderConfigurations: Array<{
  provider: "header" | "local";
  developmentServer: boolean;
  unselectedIdentityHeaders: Record<string, string>;
}> = [
  {
    provider: "header",
    developmentServer: false,
    unselectedIdentityHeaders: {
      "x-local-subject-id": "local-subject",
      "x-local-email": "local@example.test",
    },
  },
  {
    provider: "local",
    developmentServer: true,
    unselectedIdentityHeaders: {
      "oai-authenticated-user-id": "header-subject",
      "oai-authenticated-user-email": "header@example.test",
    },
  },
];

for (const configuration of routeProviderConfigurations) {
  test(`protected routes reject requests without a selected-provider session under the ${configuration.provider} provider`, async () => {
    await withIdentityConfiguration(configuration.provider, configuration.developmentServer, async () => {
      for (const route of protectedRouteCases(configuration.unselectedIdentityHeaders)) {
        const response = await route.invoke();
        assert.equal(response.status, 401, route.label);
        assert.match(response.headers.get("cache-control") ?? "", /private, no-store/, route.label);
        assert.deepEqual(
          await response.json(),
          { error: "Sign in to continue.", code: "authentication_required" },
          route.label,
        );
      }
    });
  });
}
