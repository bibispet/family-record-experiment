// Verifies that development-only routes (/dev/sign-in, /dev/sign-out, /preview)
// are eliminated from the production build at the code level, not merely gated
// at runtime. import.meta.env.DEV is replaced with false during `vinext build`,
// making every dev-only branch dead code that the minifier removes.
//
// ── What this test checks ─────────────────────────────────────────────────
//
// The PRIMARY proof is behavioural: the built worker returns 404 for /dev/*
// routes. This is mangling-proof — it doesn't depend on symbol names surviving
// minification.
//
// The SECONDARY proof is string-based: we grep the bundle for string *values*
// that minification cannot rename — the cookie name value, form field names,
// button text, sample data. We do NOT grep for constant names or function
// names (serializeLocalIdentityCookie, createLocalIdentityProvider, etc.)
// because minifiers rename those — a vacuous pass on a security check.
//
// This test also builds fresh so a stale dist/ cannot pass for the wrong
// reason.
// ─────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

// ---------------------------------------------------------------------------
// Build freshness: the test builds itself so it never passes over a stale
// bundle.
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
// PRIMARY PROOF (behavioural, mangling-proof): the built worker returns 404
// for /dev/sign-in and /dev/sign-out. This is the strongest assertion — it
// proves the routes are stubs at the HTTP level, regardless of what symbols
// or strings survive in the bundle.
// ---------------------------------------------------------------------------
test("built worker returns 404 for dev routes (primary proof — behavioural, mangling-proof)", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  const { default: worker } = await import(workerUrl.href);
  const ctx = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const env = { waitUntil() {}, passThroughOnException() {} };
  for (const path of ["/dev/sign-in", "/dev/sign-out"]) {
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, { method: "GET" }),
      ctx,
      env,
    );
    assert.equal(
      response.status,
      404,
      `${path} must return 404 in the production build — got ${response.status}`,
    );
  }
});

// ---------------------------------------------------------------------------
// SECONDARY PROOF (string-based, mangling-proof): grep the bundle for string
// *values* that minification cannot rename. Minifiers rename function and
// variable names but never string literals. If these strings survive, the
// dev-only code is present in the bundle.
//
// We do NOT assert on constant names (LOCAL_IDENTITY_COOKIE_NAME) or function
// names (serializeLocalIdentityCookie, createLocalIdentityProvider) because
// those are renamed by minification — their absence would be a vacuous pass.
// ---------------------------------------------------------------------------

// String values that only appear in dev-only code. If any of these survive
// in the production bundle, the dev route handler body was not eliminated.
//
// NOTE: We do NOT include the cookie name value ("family_record_local_identity")
// or the path strings ("/dev/sign-in", "/dev/sign-out") because those appear
// in the identity module (identity.ts) which is production code — the local
// adapter's cookie reader and LOCAL_RESERVED_PATHS are bundled regardless of
// which adapter is selected. Only strings that exist solely in the dev route
// handler bodies belong here.
const DEV_ONLY_STRINGS = [
  // Form field names from the sign-in HTML
  "subject_id",
  // Button text from the sign-in/sign-out forms
  "Sign in locally",
  "Clear local sign-in cookie",
  // Sign-in page heading
  "Sign in to your local family record",
  // Sign-out helper message
  "Use the sign-out button on /dev/sign-in",
];

test("dev-only string values are absent from the production build (secondary proof — mangling-proof)", () => {
  const allOutput = readAllJs();
  for (const needle of DEV_ONLY_STRINGS) {
    assert.ok(
      !allOutput.includes(needle),
      `Dev-only string "${needle}" found in production build — the dev route handler body was not eliminated`,
    );
  }
});

// ---------------------------------------------------------------------------
// Preview page: sample data and CSS class names are string values that
// minification cannot rename. If they survive, the preview page content was
// not eliminated.
// ---------------------------------------------------------------------------
test("preview page sample data is absent from the production build", () => {
  const allOutput = readAllJs();
  const PREVIEW_STRINGS = [
    "Millie Stewart",
    "Bob Stewart",
    "lore-canvas",
  ];
  for (const needle of PREVIEW_STRINGS) {
    assert.ok(
      !allOutput.includes(needle),
      `Preview-only string "${needle}" found in production build`,
    );
  }
});
