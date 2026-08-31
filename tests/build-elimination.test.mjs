// Verifies that development-only routes (/dev/sign-in, /dev/sign-out, /preview)
// are eliminated from the production build at the code level, not merely gated
// at runtime. import.meta.env.DEV is replaced with false during `vinext build`,
// making every dev-only branch dead code that the minifier removes.
//
// This test asserts on the symbols that matter — the local adapter's identity
// imports, the cookie serializers — not on UI copy that could be renamed without
// fixing the underlying leak. It also builds fresh so a stale dist/ cannot pass
// for the wrong reason.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

// ---------------------------------------------------------------------------
// Build freshness: the test builds itself so it never passes over a stale bundle.
// ---------------------------------------------------------------------------
test("production build is fresh", () => {
  execSync("npm run build", { cwd: join(__dirname, ".."), stdio: "pipe" });
  assert.ok(existsSync(distDir), "dist/ directory must exist after build");
});

// ---------------------------------------------------------------------------
// Collect all JS files in the dist directory recursively.
// ---------------------------------------------------------------------------
function collectJsFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(fullPath));
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      files.push(fullPath);
    }
  }
  return files;
}

function readAllJs() {
  const files = collectJsFiles(distDir);
  assert.ok(files.length > 0, "dist/ must contain at least one JS file");
  return files.map((file) => readFileSync(file, "utf-8")).join("\n");
}

// ---------------------------------------------------------------------------
// Symbol-level assertions: these are the exports that only the dev routes
// import from identity.ts. If they survive in a /dev/* route chunk, the
// build-time guard did not eliminate the dev-only code.
// ---------------------------------------------------------------------------
const DEV_ONLY_IDENTITY_SYMBOLS = [
  "assertLocalIdentityDevelopmentOnly",
  "serializeLocalIdentityCookie",
  "serializeClearedLocalIdentityCookie",
  "safeLocalIdentityReturnTo",
];

const DEV_ONLY_API_SYMBOLS = [
  "assertSafeMutation",
];

test("dev-only identity imports are absent from the production build", () => {
  const allOutput = readAllJs();
  for (const symbol of DEV_ONLY_IDENTITY_SYMBOLS) {
    assert.ok(
      !allOutput.includes(symbol),
      `Identity symbol "${symbol}" found in production build — the dev route's import was not eliminated`,
    );
  }
});

test("dev-only api imports are absent from the production build", () => {
  const allOutput = readAllJs();
  for (const symbol of DEV_ONLY_API_SYMBOLS) {
    assert.ok(
      !allOutput.includes(symbol),
      `API symbol "${symbol}" found in production build — the dev route's import was not eliminated`,
    );
  }
});

// ---------------------------------------------------------------------------
// Cookie serializer: the local identity cookie name is a public constant, but
// the serializer functions that create/clear the cookie are dev-only. If they
// survive, the cookie machinery is in the production bundle.
// ---------------------------------------------------------------------------
test("local identity cookie serializer is absent from the production build", () => {
  const allOutput = readAllJs();
  // The cookie name is exported and used by route-layer code, so it may appear.
  // But the serializer function bodies should not.
  assert.ok(
    !allOutput.includes("serializeLocalIdentityCookie"),
    "serializeLocalIdentityCookie (the cookie serializer) found in production build",
  );
  assert.ok(
    !allOutput.includes("serializeClearedLocalIdentityCookie"),
    "serializeClearedLocalIdentityCookie (the cookie clearer) found in production build",
  );
});

// ---------------------------------------------------------------------------
// Local adapter: the local identity provider factory should not appear in
// the production build. The header adapter and deny adapter are fine — they
// are production code. The local adapter is dev-only.
// ---------------------------------------------------------------------------
test("local identity adapter is absent from the production build", () => {
  const allOutput = readAllJs();
  assert.ok(
    !allOutput.includes("createLocalIdentityProvider"),
    "createLocalIdentityProvider found in production build — the local adapter was not eliminated",
  );
  assert.ok(
    !allOutput.includes("LOCAL_IDENTITY_COOKIE_NAME"),
    "LOCAL_IDENTITY_COOKIE_NAME found in production build — the local adapter's cookie constant was not eliminated",
  );
});

// ---------------------------------------------------------------------------
// /dev/* route chunks: the route files still exist (the router discovers them
// by file path) but they should be 404 stubs. The route chunk should not
// contain any HTML, form fields, or cookie logic — just the 404 response.
// ---------------------------------------------------------------------------
test("dev route handlers are 404 stubs in the production build", () => {
  const allOutput = readAllJs();
  // The route path strings appear in route discovery metadata — that's fine.
  // What matters is that no dev-only form fields, cookie logic, or
  // identity-guard calls survive in the bundle. The symbol tests above
  // already cover the imports; this test covers the form HTML and cookie
  // logic that would only exist if the handler body was not eliminated.
  assert.ok(
    !allOutput.includes("subject_id"),
    "Sign-in form field \"subject_id\" found in production build — the dev route handler body was not eliminated",
  );
  assert.ok(
    !allOutput.includes("Sign in locally"),
    "Sign-in button text \"Sign in locally\" found in production build — the dev route handler body was not eliminated",
  );
  assert.ok(
    !allOutput.includes("Clear local sign-in cookie"),
    "Sign-out button text \"Clear local sign-in cookie\" found in production build — the dev route handler body was not eliminated",
  );
});

// ---------------------------------------------------------------------------
// Preview page: the sample data and CSS should be eliminated. The page
// component should call notFound() in production.
// ---------------------------------------------------------------------------
test("preview page sample data is absent from the production build", () => {
  const allOutput = readAllJs();
  assert.ok(
    !allOutput.includes("Millie Stewart"),
    "Preview sample data \"Millie Stewart\" found in production build",
  );
  assert.ok(
    !allOutput.includes("Bob Stewart"),
    "Preview sample data \"Bob Stewart\" found in production build",
  );
  assert.ok(
    !allOutput.includes("lore-canvas"),
    "Preview CSS class \"lore-canvas\" found in production build",
  );
});
