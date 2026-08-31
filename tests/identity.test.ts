import assert from "node:assert/strict";
import test from "node:test";
import * as devSignInRoute from "../app/dev/sign-in/route";
import * as devSignOutRoute from "../app/dev/sign-out/route";
import { HttpError } from "../app/lib/api";
import {
  getApiActorFromRequest,
  getIdentityProvider,
  getSignInPath,
  LOCAL_IDENTITY_COOKIE_NAME,
  serializeLocalIdentityCookie,
  serializeClearedLocalIdentityCookie,
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

const LOCAL_COOKIE_VIEWER: Viewer = {
  subjectId: "cookie-subject",
  email: "cookie@example.test",
  displayName: "Cookie Developer",
};

function requestCookieFromSetCookie(setCookie: string): string {
  const separator = setCookie.indexOf(";");
  return separator < 0 ? setCookie : setCookie.slice(0, separator);
}

function localIdentityRequestCookie(viewer: Viewer = LOCAL_COOKIE_VIEWER): string {
  return withEnv(LOCAL_ALLOWED, () => requestCookieFromSetCookie(serializeLocalIdentityCookie(viewer)));
}

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

const LOCAL_COOKIE_PARITY_ROUTES: Array<[string, RequestInit]> = [
  ["/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/people/00000000-0000-4000-8000-000000000001", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/relationships", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/people/00000000-0000-4000-8000-000000000001/stories", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/shares", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
];

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

async function assertGuardedRouteUnavailable(tag: string, path: string, init: RequestInit): Promise<void> {
  const response = await fetchBuiltWorker(tag, path, init);
  // The build-time guard returns 404 (route eliminated from production build).
  // The runtime guard would throw 500, but the build-time guard is stronger.
  assert.ok(response.status >= 400, `${path}: the development route must not be accessible`);
  assert.equal(response.headers.get("set-cookie"), null, `${path}: a rejected request must not mutate cookies`);
  assert.doesNotMatch(await response.text(), /name="subject_id"/i, `${path}: the sign-in form must not render`);
}

async function postLocalSignIn(tag: string): Promise<Response> {
  return fetchBuiltWorker(tag, "/dev/sign-in", {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost",
    },
    body: new URLSearchParams({
      subject_id: "route-subject",
      email: "Route@Example.test",
      display_name: "Route Developer",
      return_to: "/family",
    }).toString(),
  });
}

function withRequestCredentials(init: RequestInit, credentials: Record<string, string>): RequestInit {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(credentials)) headers.set(name, value);
  return { ...init, headers };
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
    env: { IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" },
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
    withEnv({ IDENTITY_PROVIDER: value, TRUSTED_IDENTITY_PROXY: "1" }, () => {
      assert.equal(getIdentityProvider().name, "header", `IDENTITY_PROVIDER=${value}`);
    });
  }
  withEnv({ AUTH_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, () => {
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
  withEnv({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, () => {
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
  withEnv({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, () => {
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
    { IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" },
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
    resolveViewerUnder({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, { "oai-authenticated-user-id": "only-id" }),
    null,
  );
  assert.equal(resolveViewerUnder({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, {}), null);
  const badEncoding = resolveViewerUnder(
    { IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" },
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
    { IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" },
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

test("local adapter resolves its browser cookie without changing local-header behavior", () => {
  const cookie = localIdentityRequestCookie();
  assert.deepEqual(resolveViewerUnder(LOCAL_ALLOWED, { cookie }), LOCAL_COOKIE_VIEWER);

  const headerViewer = resolveViewerUnder(LOCAL_ALLOWED, {
    cookie,
    "x-local-subject": "header-subject",
    "x-local-email": "Header@Example.test",
    "x-local-display-name": "Header Developer",
  });
  assert.deepEqual(headerViewer, {
    subjectId: "header-subject",
    email: "header@example.test",
    displayName: "Header Developer",
  });

  assert.equal(
    resolveViewerUnder(LOCAL_ALLOWED, { cookie, "x-local-subject": "incomplete-header" }),
    null,
    "an incomplete local-header identity must keep its previous null result instead of borrowing cookie fields",
  );
  assert.equal(resolveViewerUnder(LOCAL_ALLOWED, { cookie: `${LOCAL_IDENTITY_COOKIE_NAME}=not-json` }), null);
});

test("header and deny adapters ignore the local identity cookie", () => {
  const cookie = localIdentityRequestCookie();
  assert.equal(resolveViewerUnder({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, { cookie }), null);
  assert.equal(resolveViewerUnder({}, { cookie }), null);
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
  assert.equal(resolveViewerUnder({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, localHeaders), null, "header must ignore x-local-*");
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
  withEnv({ IDENTITY_PROVIDER: "local", NODE_ENV: "development", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: undefined }, () => {
    assert.throws(() => getIdentityProvider(), /FAMILY_RECORD_ALLOW_LOCAL_IDENTITY=1/);
  });
  withEnv({ IDENTITY_PROVIDER: "local", NODE_ENV: "test", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: undefined }, () => {
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

test("a local identity cookie is ignored when the development guard is revoked", () => {
  let held: IdentityProvider;
  let cookie: string;
  withEnv(LOCAL_ALLOWED, () => {
    held = getIdentityProvider();
    cookie = requestCookieFromSetCookie(serializeLocalIdentityCookie(LOCAL_COOKIE_VIEWER));
    assert.deepEqual(held.resolveViewer(new Headers({ cookie })), LOCAL_COOKIE_VIEWER);
  });

  withEnv({ NODE_ENV: "production", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: "1" }, () => {
    assert.throws(
      () => held.resolveViewer(new Headers({ cookie })),
      /refusing to initialise the local identity provider outside development/,
    );
  });
  withEnv({ NODE_ENV: "test", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: undefined }, () => {
    assert.throws(
      () => held.resolveViewer(new Headers({ cookie })),
      /FAMILY_RECORD_ALLOW_LOCAL_IDENTITY=1/,
    );
  });
});

test("development sign-in and sign-out routes fail loudly outside the local identity guard", async () => {
  await withEnvAsync(
    { IDENTITY_PROVIDER: "local", NODE_ENV: "production", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: "1" },
    async () => {
      await assertGuardedRouteUnavailable("dev-sign-in-production-get", "/dev/sign-in", {
        method: "GET",
        headers: { accept: "text/html" },
      });
      await assertGuardedRouteUnavailable("dev-sign-in-production-post", "/dev/sign-in", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "http://localhost",
        },
        body: "subject_id=blocked&email=blocked%40example.test",
      });
      await assertGuardedRouteUnavailable("dev-sign-out-production", "/dev/sign-out", {
        method: "POST",
        headers: { origin: "http://localhost" },
      });
      for (const method of ["HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
        await assertGuardedRouteUnavailable(
          `dev-sign-in-production-${method.toLowerCase()}`,
          "/dev/sign-in",
          { method },
        );
        await assertGuardedRouteUnavailable(
          `dev-sign-out-production-${method.toLowerCase()}`,
          "/dev/sign-out",
          { method },
        );
      }
    },
  );

  await withEnvAsync(
    { IDENTITY_PROVIDER: "local", NODE_ENV: "development", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: undefined },
    () => assertGuardedRouteUnavailable("dev-sign-in-flag-off", "/dev/sign-in", { method: "GET" }),
  );
});

test("development sign-in guard is re-checked on every request", async () => {
  // Through the built worker (production build), the build-time guard returns
  // 404 regardless of runtime env — proving the route is eliminated at build time.
  const tag = "dev-sign-in-recheck";
  await withEnvAsync(LOCAL_ALLOWED, async () => {
    const response = await fetchBuiltWorker(tag, "/dev/sign-in", { method: "GET" });
    assert.equal(response.status, 404, "build-time guard must eliminate dev routes from production build");
  });
  // Through direct handler calls (tsx), DEV_MODE=1 is set via --import
  // (tests/setup-dev-mode.ts) so isDev is true. The runtime guard is
  // re-checked on every request.
  await withEnvAsync(LOCAL_ALLOWED, () => {
    assert.doesNotThrow(() => devSignInRoute.GET(new Request("http://localhost/dev/sign-in")));
  });
  await withEnvAsync(
    { IDENTITY_PROVIDER: "local", NODE_ENV: "production", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: "1" },
    () => assert.throws(
      () => devSignInRoute.GET(new Request("http://localhost/dev/sign-in")),
      /refusing to initialise the local identity provider outside development/,
    ),
  );
});

test("every supported development auth route method invokes the exact local identity guard", async () => {
  await withEnvAsync(
    { IDENTITY_PROVIDER: "local", NODE_ENV: "production", FAMILY_RECORD_ALLOW_LOCAL_IDENTITY: "1" },
    async () => {
      const syncHandlers: Array<() => Response> = [
        () => devSignInRoute.GET(new Request("http://localhost/dev/sign-in")),
        () => devSignInRoute.HEAD(),
        () => devSignInRoute.OPTIONS(),
        () => devSignInRoute.PUT(),
        () => devSignInRoute.PATCH(),
        () => devSignInRoute.DELETE(),
        () => devSignOutRoute.GET(),
        () => devSignOutRoute.HEAD(),
        () => devSignOutRoute.OPTIONS(),
        () => devSignOutRoute.PUT(),
        () => devSignOutRoute.PATCH(),
        () => devSignOutRoute.DELETE(),
      ];
      for (const handler of syncHandlers) {
        assert.throws(handler, /refusing to initialise the local identity provider outside development/);
      }
      await assert.rejects(
        devSignInRoute.POST(new Request("http://localhost/dev/sign-in", { method: "POST" })),
        /refusing to initialise the local identity provider outside development/,
      );
      await assert.rejects(
        devSignOutRoute.POST(new Request("http://localhost/dev/sign-out", { method: "POST" })),
        /refusing to initialise the local identity provider outside development/,
      );
    },
  );
});

test("browser sign-in cookie reaches protected routes exactly like local identity headers", async () => {
  // Dev routes are eliminated from the production build, so we create the
  // cookie directly via serializeLocalIdentityCookie (in tsx) and test that
  // it works identically to local identity headers through the built worker.
  const cookie = localIdentityRequestCookie({
    subjectId: "route-subject",
    email: "route@example.test",
    displayName: "Route Developer",
  });

  await withEnvAsync(LOCAL_ALLOWED, async () => {
    assert.deepEqual(getIdentityProvider().resolveViewer(new Headers({ cookie })), {
      subjectId: "route-subject",
      email: "route@example.test",
      displayName: "Route Developer",
    });

    const localHeaders = {
      "x-local-subject": "route-subject",
      "x-local-email": "route@example.test",
      "x-local-display-name": "Route Developer",
    };
    for (const [index, [path, init]] of LOCAL_COOKIE_PARITY_ROUTES.entries()) {
      const headerResponse = await fetchBuiltWorker(
        `local-header-parity-${index}`,
        path,
        withRequestCredentials(init, localHeaders),
      );
      const cookieResponse = await fetchBuiltWorker(
        `local-cookie-parity-${index}`,
        path,
        withRequestCredentials(init, { cookie }),
      );
      const headerBody = await headerResponse.text();
      const cookieBody = await cookieResponse.text();
      assert.notEqual(headerResponse.status, 401, `${path}: local headers must pass the identity gate`);
      assert.equal(cookieResponse.status, headerResponse.status, `${path}: cookie/header status parity`);
      assert.equal(cookieBody, headerBody, `${path}: cookie/header response parity`);
      assert.doesNotMatch(cookieBody, /authentication_required/, `${path}: cookie must pass the identity gate`);
    }

    const familyHeaderResponse = await fetchBuiltWorker(
      "local-header-family-rsc",
      "/family",
      withRequestCredentials(
        { method: "GET", redirect: "manual", headers: { accept: "text/html" } },
        localHeaders,
      ),
    );
    const familyCookieResponse = await fetchBuiltWorker(
      "local-cookie-family-rsc",
      "/family",
      withRequestCredentials(
        { method: "GET", redirect: "manual", headers: { accept: "text/html" } },
        { cookie },
      ),
    );
    for (const [label, response] of [
      ["headers", familyHeaderResponse],
      ["cookie", familyCookieResponse],
    ] as const) {
      assert.notEqual(response.status, 401, `/family: ${label} identity must pass the RSC identity gate`);
      assert.doesNotMatch(
        response.headers.get("location") ?? "",
        /^\/dev\/sign-in/,
        `/family: ${label} identity must not be redirected back to local sign-in`,
      );
    }
    assert.equal(familyCookieResponse.status, familyHeaderResponse.status, "/family: cookie/header RSC parity");

    // Sign-out: the cleared cookie must produce a null viewer.
    const clearedCookie = withEnv(LOCAL_ALLOWED, () =>
      requestCookieFromSetCookie(serializeClearedLocalIdentityCookie()),
    );
    assert.equal(
      getIdentityProvider().resolveViewer(new Headers({ cookie: clearedCookie })),
      null,
    );

    const afterSignOut = await fetchBuiltWorker("dev-sign-in-flow", MEDIA_PATH, { method: "GET" });
    await assertAuthenticationRequired(afterSignOut, "protected route after local sign-out");
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
  await withEnvAsync({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, async () => {
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
  withEnv({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, () => {
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

// ---------------------------------------------------------------------------
// Header adapter: trusted-proxy guard
//
// The header adapter trusts request headers that only a trusted reverse
// proxy can set. Without an explicit TRUSTED_IDENTITY_PROXY=1 confirmation,
// the adapter must refuse to initialise — any visitor could forge the headers
// otherwise.
// ---------------------------------------------------------------------------

test("header adapter refuses to initialise without TRUSTED_IDENTITY_PROXY", () => {
  withEnv({ IDENTITY_PROVIDER: "header" }, () => {
    assert.throws(
      () => getIdentityProvider(),
      /refusing to initialise the header identity provider without TRUSTED_IDENTITY_PROXY=1/,
    );
  });
});

test("header adapter refuses to resolve viewer without TRUSTED_IDENTITY_PROXY even if constructed with it", () => {
  let held: IdentityProvider;
  withEnv({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, () => {
    held = getIdentityProvider();
    assert.equal(held.name, "header");
  });
  // Revoke the trusted-proxy flag after construction: resolution must fail loudly.
  withEnv({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: undefined }, () => {
    assert.throws(
      () => held.resolveViewer(new Headers({ "oai-authenticated-user-id": "s", "oai-authenticated-user-email": "s@example.test" })),
      /refusing to initialise the header identity provider without TRUSTED_IDENTITY_PROXY=1/,
    );
    assert.throws(
      () => held.signInPath("/family"),
      /refusing to initialise the header identity provider without TRUSTED_IDENTITY_PROXY=1/,
    );
  });
});

test("header adapter works when TRUSTED_IDENTITY_PROXY=1 is set", () => {
  withEnv({ IDENTITY_PROVIDER: "header", TRUSTED_IDENTITY_PROXY: "1" }, () => {
    const provider = getIdentityProvider();
    assert.equal(provider.name, "header");
    const viewer = provider.resolveViewer(new Headers({
      "oai-authenticated-user-id": "subject-1",
      "oai-authenticated-user-email": "user@example.test",
    }));
    assert.deepEqual(viewer, {
      subjectId: "subject-1",
      email: "user@example.test",
      displayName: null,
    });
    assert.match(provider.signInPath("/family") ?? "", /^\/signin-with-chatgpt\?return_to=%2Ffamily$/);
  });
});
