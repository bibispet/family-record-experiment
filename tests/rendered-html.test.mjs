import assert from "node:assert/strict";
import test from "node:test";

async function request(path, init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function withProvider(value, run) {
  const previousIdentity = process.env.IDENTITY_PROVIDER;
  const previousAuth = process.env.AUTH_PROVIDER;
  if (value === undefined) delete process.env.IDENTITY_PROVIDER;
  else process.env.IDENTITY_PROVIDER = value;
  delete process.env.AUTH_PROVIDER;
  try {
    return await run();
  } finally {
    if (previousIdentity === undefined) delete process.env.IDENTITY_PROVIDER;
    else process.env.IDENTITY_PROVIDER = previousIdentity;
    if (previousAuth === undefined) delete process.env.AUTH_PROVIDER;
    else process.env.AUTH_PROVIDER = previousAuth;
  }
}

test("renders the finished product welcome page", async () => {
  await withProvider(undefined, async () => {
    const response = await request("/", { headers: { accept: "text/html" } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title>Family Record Experiment<\/title>/i);
    assert.match(html, /Keep the people and stories that make you/);
    assert.match(html, /Private by default/);
    assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  });
});

test("default deny provider redirects anonymous family pages without a vendor URL", async () => {
  await withProvider(undefined, async () => {
    const response = await request("/family", {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    assert.ok([302, 303, 307, 308].includes(response.status));
    assert.equal(response.headers.get("location"), "/");
  });
});

test("selected header provider retains the dispatch-owned sign-in path", async () => {
  await withProvider("header", async () => {
    const response = await request("/family", {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    assert.ok([302, 303, 307, 308].includes(response.status));
    assert.match(response.headers.get("location") ?? "", /^\/signin-with-chatgpt\?return_to=/);
  });
});

test("production build fails loudly when configured with the local provider", async () => {
  await withProvider("local", async () => {
    const withoutIdentity = await request("/api/family");
    assert.equal(withoutIdentity.status, 500);
    assert.deepEqual(await withoutIdentity.json(), {
      error: "Something went wrong. Please try again.",
      code: "internal_error",
    });

    const withSpoofedIdentity = await request("/api/family", {
      headers: {
        "x-local-subject-id": "spoofed-subject",
        "x-local-email": "spoofed@example.test",
      },
    });
    assert.equal(withSpoofedIdentity.status, 500);
    assert.deepEqual(await withSpoofedIdentity.json(), {
      error: "Something went wrong. Please try again.",
      code: "internal_error",
    });
  });
});

const protectedRequests = [
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

for (const [path, init] of protectedRequests) {
  test(`anonymous request is denied without leaking data: ${path}`, async () => {
    await withProvider(undefined, async () => {
      const response = await request(path, init);
      assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
      const body = await response.json();
      assert.equal(body.code, "authentication_required");
      assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
    });
  });
}
