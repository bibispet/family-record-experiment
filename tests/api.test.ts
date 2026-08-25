import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeMutation, cleanDate, HttpError, noStoreJson } from "../app/lib/api";

test("cross-origin mutations are rejected", () => {
  const request = new Request("https://record.test/api/people", {
    method: "POST",
    headers: { origin: "https://attacker.test", "content-type": "application/json" },
    body: "{}",
  });
  assert.throws(
    () => assertSafeMutation(request, "json"),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

test("calendar dates are validated instead of normalized", () => {
  assert.equal(cleanDate("2008-02-29"), "2008-02-29");
  assert.throws(() => cleanDate("2007-02-29"), /real calendar date/);
});

test("protected JSON is explicitly private and non-cacheable", async () => {
  const response = noStoreJson({ ok: true });
  assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  assert.deepEqual(await response.json(), { ok: true });
});
