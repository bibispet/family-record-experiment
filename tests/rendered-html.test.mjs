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

test("renders the finished product welcome page", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Family Record Experiment<\/title>/i);
  assert.match(html, /Keep the people and stories that make you/);
  assert.match(html, /Private by default/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("redirects anonymous family pages to dispatch-owned sign in", async () => {
  // The vendor sign-in destination belongs to the header adapter. The default
  // deny provider offers no sign-in URL at all, so this redirect behavior is
  // asserted with the header adapter explicitly selected.
  const previous = process.env.IDENTITY_PROVIDER;
  process.env.IDENTITY_PROVIDER = "header";
  try {
    const response = await request("/family", {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    assert.ok([302, 303, 307, 308].includes(response.status));
    assert.match(response.headers.get("location") ?? "", /^\/signin-with-chatgpt\?return_to=/);
  } finally {
    if (previous === undefined) delete process.env.IDENTITY_PROVIDER;
    else process.env.IDENTITY_PROVIDER = previous;
  }
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
    const response = await request(path, init);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
    const body = await response.json();
    assert.equal(body.code, "authentication_required");
    assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
  });
}
