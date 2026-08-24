import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../app/lib/api";
import {
  getApiActorFromRequest,
  getIdentityProvider,
  getSignInPath,
  type IdentityProvider,
  viewerToApiActor,
  type Viewer,
} from "../app/lib/identity";

// ---------------------------------------------------------------------------
// Helpers
//
// Environment control MUST be synchronous for sync code paths: an
// asynchronous patch/restore would leak provider selection across tests and
// make denials depend on scheduling order.
// ---------------------------------------------------------------------------

type EnvPatch = Record<string, string | undefined>;

function applyEnv(patch: EnvPatch): Map<string, string | undefined> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return saved;
}

function restoreEnv(saved: Map<string, string | undefined>): void {
  for (const [key, previous] of saved.entries()) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

function withEnv<T>(patch: EnvPatch, fn: () => T): T {
  const saved = applyEnv(patch);
  try {
    return fn();
  } finally {
    restoreEnv(saved);
  }
}

async function withEnvAsync<T>(patch: EnvPatch, fn: () => Promise<T>): Promise<T> {
  const saved = applyEnv(patch);
  try {
    return await fn();
  } finally {
    restoreEnv(saved);
  }
}

const LOCAL_ALLOWED: EnvPatch = {
  IDENTITY_PROVIDER: "local",
  NODE_ENV: "test",
  FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: "1",
};

function resolveViewerUnder(env: EnvPatch, entries: Record<string, string>): Viewer | null {
  return withEnv(env, () => getIdentityProvider().resolveViewer(new Headers(entries)));
}

// Route-layer harness: boots the built worker exactly like
// tests/rendered-html.test.mjs does, so denials are observed where visitors
// hit them — at protected routes, not inside authorization functions.
const PROTECTED_ROUTES: Array<[string, RequestInit]> = [
  ["/api/family", { method: "GET" }],
  ["/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/people/00000000-0000-4000-8000-000000000001", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/relationships", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/people/00000000-0000-4000-8000-000000000001/stories", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/people/00000000-0000-4000-8000-000000000001/media", { method: "POST" }],
  ["/api/relationships/00000000-0000-4000-8000-000000000001/unlink", { method: "POST" }],
  ["/api/shares", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/shares/00000000-0000-4000-8000-000000000001/revoke", { method: "POST" }],
  ["/api/media/00000000-0000-4000-8000-000000000001", { method: "GET" }],
];

const MEDIA_PATH = "/api/media/00000000-0000-4000-8000-000000000001";

async function fetchBuiltWorker(tag: string, path: string, init: RequestInit): Promise<Response> {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("identity-audit", tag);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

interface AdapterScenario {
  tag: string;
  label: string;
  env: EnvPatch;
  credentials?: Record<string, string>;
}

const ADAPTER_SCENARIOS: AdapterScenario[] = [
  { tag: "deny", label: "default deny", env: {} },
  {
    tag: "header",
    label: "header adapter",
    env: { IDENTITY_PROVIDER: "header" },
    credentials: {
      "oai-authenticated-user-id": "route-subject",
      "oai-authenticated-user-email": "route@example.test",
    },
  },
  {
    tag: "local",
    label: "local adapter (dev-gated)",
    env: LOCAL_ALLOWED,
    credentials: { "x-local-subject": "route-subject", "x-local-email": "route@example.test" },
  },
];

async function assertAuthenticationRequired(response: Response, context: string): Promise<void> {
  assert.equal(response.status, 401, `${context}: expected 401`);
  assert.match(
    response.headers.get("cache-control") ?? "",
    /private, no-store/,
    `${context}: protected responses must be private and non-cacheable`,
  );
  const body = (await response.json()) as { code?: string };
  assert.equal(body.code, "authentication_required", `${context}: expected authentication_required`);
}

// ---------------------------------------------------------------------------
// Provider selection and interface shape
// ---------------------------------------------------------------------------

test("provider selection maps configuration to adapters and defaults to deny", () => {
  for (const value of ["header", "oai", "chatgpt", "trusted-header", "trusted_header"]) {
    withEnv({ IDENTITY_PROVIDER: value }, () => {
      assert.equal(getIdentityProvider().name, "header", `IDENTITY_PROVIDER=${value}`);
    });
  }
  withEnv({ AUTH_PROVIDER: "header" }, () => {
    assert.equal(getIdentityProvider().name, "header", "AUTH_PROVIDER fallback");
  });
  withEnv({ IDENTITY_PROVIDER: "nonsense" }, () => {
    assert.equal(getIdentityProvider().name, "deny", "unknown values must fall back to deny");
  });
  withEnv({}, () => {
    assert.equal(getIdentityProvider().name, "deny", "unset configuration must default to deny");
  });
});

test("adapters share one interface and only the header adapter knows a vendor sign-in route", () => {
  withEnv({ IDENTITY_PROVIDER: "header" }, () => {
    const provider = getIdentityProvider();
    assert.equal(typeof provider.resolveViewer, "function");
    const path = provider.signInPath("/family");
    assert.match(path ?? "", /^\/signin-with-chatgpt\?return_to=%2Ffamily$/);
  });
  withEnv(LOCAL_ALLOWED, () => {
    const provider = getIdentityProvider();
    assert.equal(typeof provider.resolveViewer, "function");
    const path = provider.signInPath("/family");
    assert.match(path ?? "", /^\/dev\/sign-in\?return_to=%2Ffamily$/);
    assert.doesNotMatch(path ?? "", /chatgpt/i);
  });
  withEnv({}, () => {
    const provider = getIdentityProvider();
    assert.equal(typeof provider.resolveViewer, "function");
    // The deny provider offers no destination at all: no vendor URL exists
    // in the default path.
    assert.equal(provider.signInPath("/family"), null);
  });
});

test("reserved auth paths are never accepted as return_to targets", () => {
  withEnv({ IDENTITY_PROVIDER: "header" }, () => {
    assert.match(getSignInPath("/signin-with-chatgpt") ?? "", /=%2F$/);
  });
  withEnv(LOCAL_ALLOWED, () => {
    assert.match(getSignInPath("/dev/sign-in") ?? "", /=%2F$/);
  });
});

// ---------------------------------------------------------------------------
// Header adapter resolution details
// ---------------------------------------------------------------------------

test("header adapter resolves oai-* headers when selected", () => {
  const viewer = resolveViewerUnder(
    { IDENTITY_PROVIDER: "header" },
    {
      "oai-authenticated-user-id": "subject-1",
      "oai-authenticated-user-email": "Family@Example.test",
      "oai-authenticated-user-full-name": "Example%20User",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
  );
  assert.deepEqual(viewer, {
    subjectId: "subject-1",
    email: "family@example.test",
    displayName: "Example User",
  });
  assert.deepEqual(viewerToApiActor(viewer!), {
    authSubject: "subject-1",
    email: "family@example.test",
    displayName: "Example User",
  });
});

test("header adapter rejects incomplete identity and undecodable display names", () => {
  assert.equal(
    resolveViewerUnder({ IDENTITY_PROVIDER: "header" }, { "oai-authenticated-user-id": "only-id" }),
    null,
  );
  assert.equal(resolveViewerUnder({ IDENTITY_PROVIDER: "header" }, {}), null);
  const badEncoding = resolveViewerUnder(
    { IDENTITY_PROVIDER: "header" },
    {
      "oai-authenticated-user-id": "s1",
      "oai-authenticated-user-email": "a@example.test",
      "oai-authenticated-user-full-name": "%ZZ",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
  );
  assert.equal(badEncoding?.displayName, null);
});

test("viewer shape stays derived from ApiActor regardless of adapter", () => {
  const headerViewer = resolveViewerUnder(
    { IDENTITY_PROVIDER: "header" },
    { "oai-authenticated-user-id": "s1", "oai-authenticated-user-email": "USER@EXAMPLE.TEST" },
  )!;
  assert.equal(headerViewer.email, "user@example.test");
  assert.equal(headerViewer.displayName, null);
  assert.equal(viewerToApiActor(headerViewer).displayName, "user@example.test");

  const localViewer = resolveViewerUnder(
    LOCAL_ALLOWED,
    { "x-local-subject": "s2", "x-local-email": "Other@Example.test", "x-local-display-name": "Other Name" },
  )!;
  assert.equal(localViewer.email, "other@example.test");
  assert.equal(viewerToApiActor(localViewer).displayName, "Other Name");
});

// ---------------------------------------------------------------------------
// Local adapter safety (structural confinement to development)
// ---------------------------------------------------------------------------

test("local adapter resolves x-local-* headers only while safely configured", () => {
  const viewer = resolveViewerUnder(
    LOCAL_ALLOWED,
    { "x-local-subject": "local-subject-1", "x-local-email": "Local@Example.test", "x-local-display-name": "Local User" },
  );
  assert.deepEqual(viewer, {
    subjectId: "local-subject-1",
    email: "local@example.test",
    displayName: "Local User",
  });
  const alias = resolveViewerUnder(
    LOCAL_ALLOWED,
    { "x-dev-user-id": "alias-subject", "x-dev-user-email": "Alias@Example.test", "x-dev-user-name": "Alias Name" },
  );
  assert.deepEqual(alias, {
    subjectId: "alias-subject",
    email: "alias@example.test",
    displayName: "Alias Name",
  });
  assert.equal(resolveViewerUnder(LOCAL_ALLOWED, {}), null);
});

test("each adapter ignores the other adapter's headers", () => {
  const oaiHeaders = {
    "oai-authenticated-user-id": "subject-oai",
    "oai-authenticated-user-email": "oai@example.test",
    "oai-authenticated-user-full-name": "OAI%20User",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const localHeaders = {
    "x-local-subject": "subject-local",
    "x-local-email": "local@example.test",
    "x-local-display-name": "Local",
  };
  assert.equal(resolveViewerUnder(LOCAL_ALLOWED, oaiHeaders), null, "local must ignore oai-*");
  assert.equal(resolveViewerUnder({ IDENTITY_PROVIDER: "header" }, localHeaders), null, "header must ignore x-local-*");
  assert.equal(resolveViewerUnder({}, oaiHeaders), null, "deny must ignore oai-*");
  assert.equal(resolveViewerUnder({}, localHeaders), null, "deny must ignore x-local-*");
});

test("local adapter refuses to initialise outside development even with the opt-in flag", () => {
  withEnv({ IDENTITY_PROVIDER: "local", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: "1", NODE_ENV: "production" }, () => {
    assert.throws(() => getIdentityProvider(), /refusing to initialise the local identity provider outside development/);
  });
  withEnv({ IDENTITY_PROVIDER: "local", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: "1" }, () => {
    // NODE_ENV unset (typical of deployed Workers) counts as hostile.
    assert.throws(() => getIdentityProvider(), /refusing to initialise the local identity provider outside development/);
  });
  withEnv({ AUTH_PROVIDER: "local", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: "1", NODE_ENV: "production" }, () => {
    assert.throws(() => getIdentityProvider(), /outside development/);
  });
});

test("local adapter requires the explicit opt-in flag even in development", () => {
  withEnv({ IDENTITY_PROVIDER: "local", NODE_ENV: "development" }, () => {
    assert.throws(() => getIdentityProvider(), /FAMILY_RECORD_ALLOW_LOCAL_IDENTITY=1/);
  });
  withEnv({ IDENTITY_PROVIDER: "local", NODE_ENV: "test" }, () => {
    assert.throws(() => getIdentityProvider(), /FAMILY_RECORD_ALLOW_LOCAL_IDENTITY=1/);
  });
  withEnv({ IDENTITY_PROVIDER: "local", NODE_ENV: "development", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: "0" }, () => {
    assert.throws(() => getIdentityProvider(), /FAMILY_RECORD_ALLOW_LOCAL_IDENTITY=1/);
  });
});

test("a held local adapter reference cannot outlive the safety conditions", () => {
  let held: IdentityProvider;
  withEnv(LOCAL_ALLOWED, () => {
    held = getIdentityProvider();
    assert.equal(held.name, "local");
  });
  // Safety conditions revoked after initialization: resolution must fail loudly.
  withEnv({ NODE_ENV: "production", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: undefined }, () => {
    assert.throws(
      () => held.resolveViewer(new Headers({ "x-local-subject": "s", "x-local-email": "s@example.test" })),
      /refusing to initialise/,
    );
    assert.throws(() => held.signInPath("/family"), /refusing to initialise/);
  });
});

// ---------------------------------------------------------------------------
// Route layer: denial matrix under each adapter configuration
//
// These exercise the real protection boundary — protected routes reached with
// no session (and with foreign credentials) through the built worker — rather
// than calling authorization functions directly.
// ---------------------------------------------------------------------------

for (const scenario of ADAPTER_SCENARIOS) {
  test(`route layer: every protected route denies anonymous requests (${scenario.label})`, async () => {
    await withEnvAsync(scenario.env, async () => {
      for (const [path, init] of PROTECTED_ROUTES) {
        const response = await fetchBuiltWorker(scenario.tag, path, init);
        await assertAuthenticationRequired(response, path);
      }
    });
  });
}

test("route layer: default deny refuses both credential families simultaneously", async () => {
  await withEnvAsync({}, async () => {
    const response = await fetchBuiltWorker("deny", MEDIA_PATH, {
      method: "GET",
      headers: {
        "oai-authenticated-user-id": "route-subject",
        "oai-authenticated-user-email": "route@example.test",
        "x-local-subject": "route-subject",
        "x-local-email": "route@example.test",
      },
    });
    await assertAuthenticationRequired(response, MEDIA_PATH);
  });
});

test("route layer: header adapter ignores x-local-* credentials end to end", async () => {
  await withEnvAsync({ IDENTITY_PROVIDER: "header" }, async () => {
    const response = await fetchBuiltWorker("header", MEDIA_PATH, {
      method: "GET",
      headers: { "x-local-subject": "route-subject", "x-local-email": "route@example.test" },
    });
    await assertAuthenticationRequired(response, MEDIA_PATH);
  });
});

test("route layer: local adapter ignores oai-* credentials end to end", async () => {
  await withEnvAsync(LOCAL_ALLOWED, async () => {
    const response = await fetchBuiltWorker("local", MEDIA_PATH, {
      method: "GET",
      headers: {
        "oai-authenticated-user-id": "route-subject",
        "oai-authenticated-user-email": "route@example.test",
      },
    });
    await assertAuthenticationRequired(response, MEDIA_PATH);
  });
});

for (const scenario of ADAPTER_SCENARIOS.slice(1)) {
  test(`route layer: valid ${scenario.label} credentials pass the identity gate`, async () => {
    await withEnvAsync(scenario.env, async () => {
      const response = await fetchBuiltWorker(scenario.tag, MEDIA_PATH, {
        method: "GET",
        headers: scenario.credentials,
      });
      const body = (await response.json()) as { code?: string };
      assert.notEqual(response.status, 401, "authenticated request must move past the identity gate");
      assert.notEqual(body.code, "authentication_required");
    });
  });
}

test("API helper enforces the configured provider, not raw headers", () => {
  withEnv({ IDENTITY_PROVIDER: "header" }, () => {
    const actor = getApiActorFromRequest(
      new Request("https://record.test/api/family", {
        headers: {
          "oai-authenticated-user-id": "subject-1",
          "oai-authenticated-user-email": "Family@Example.test",
        },
      }),
    );
    assert.equal(actor.authSubject, "subject-1");
    assert.equal(actor.email, "family@example.test");
  });
  withEnv({}, () => {
    assert.throws(
      () =>
        getApiActorFromRequest(
          new Request("https://record.test/api/family", {
            headers: {
              "oai-authenticated-user-id": "subject-1",
              "oai-authenticated-user-email": "Family@Example.test",
            },
          }),
        ),
      (error: unknown) => error instanceof HttpError && error.status === 401,
    );
  });
});
