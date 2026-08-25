import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeMutation, cleanDate, HttpError, noStoreJson } from "../app/lib/api";
import { getApiActorFromRequest } from "../app/lib/identity";

// Identity resolution is configuration-driven; these tests opt into the
// header adapter explicitly and restore the environment afterwards.
function withHeaderProvider<T>(fn: () => T): T {
  const prev = process.env.IDENTITY_PROVIDER;
  process.env.IDENTITY_PROVIDER = "header";
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.IDENTITY_PROVIDER;
    else process.env.IDENTITY_PROVIDER = prev;
  }
}

test("trusted identity headers resolve an API actor when the header provider is selected", () => {
  withHeaderProvider(() => {
    const request = new Request("https://record.test/api/family", {
      headers: {
        "oai-authenticated-user-id": "subject-1",
        "oai-authenticated-user-email": "Family@Example.test",
        "oai-authenticated-user-full-name": "Example%20User",
        "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      },
    });
    assert.deepEqual(getApiActorFromRequest(request), {
      authSubject: "subject-1",
      email: "family@example.test",
      displayName: "Example User",
    });
  });
});

test("missing identity is rejected before resource lookup", () => {
  withHeaderProvider(() => {
    assert.throws(
      () => getApiActorFromRequest(new Request("https://record.test/api/family")),
      (error: unknown) => error instanceof HttpError && error.status === 401,
    );
  });
});

test("trusted oai-* headers do not resolve an actor under the default deny provider", () => {
  const request = new Request("https://record.test/api/family", {
    headers: {
      "oai-authenticated-user-id": "subject-1",
      "oai-authenticated-user-email": "Family@Example.test",
    },
  });
  assert.throws(
    () => getApiActorFromRequest(request),
    (error: unknown) => error instanceof HttpError && error.status === 401,
  );
});

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
