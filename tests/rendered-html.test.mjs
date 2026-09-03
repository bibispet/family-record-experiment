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
  assert.match(html, /<title>Lore Family Demo<\/title>/i);
  assert.match(html, /Keep the people and stories that make you/);
  assert.match(html, /Read-only demo/);
  assert.match(html, /Nothing can be entered, uploaded, or saved/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("renders the fictional demo and warning on every page", async () => {
  for (const path of ["/family", "/family/graph"]) {
    const response = await request(path, { headers: { accept: "text/html" } });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /Read-only demo/, path);
    assert.match(html, /Amara Adeyemi/, path);
    assert.doesNotMatch(html, /Add a person|Save story|type="file"|recipientEmail/, path);
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
  ["/api/stories/00000000-0000-4000-8000-000000000001", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/stories/00000000-0000-4000-8000-000000000001", { method: "DELETE" }],
  ["/api/media/00000000-0000-4000-8000-000000000001", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }],
  ["/api/media/00000000-0000-4000-8000-000000000001", { method: "DELETE" }],
  ["/api/audit", { method: "GET" }],
  ["/api/relationships/00000000-0000-4000-8000-000000000001", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }],
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
test("anonymous request is denied without leaking data: PATCH /api/family", async () => {
  const response = await request("/api/family", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "test" }),
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  const body = await response.json();
  assert.equal(body.code, "authentication_required");
  assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
});
