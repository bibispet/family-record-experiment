// Verifies that development-only routes (/dev/sign-in, /dev/sign-out, /preview)
// are eliminated from the production build at the code level, not merely gated
// at runtime. import.meta.env.DEV is replaced with false during `vinext build`,
// making every dev-only branch dead code that the minifier removes.
//
// This test runs after `npm run build` (which is part of `npm test`).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

// Collect all JS files in the dist directory recursively.
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

// Strings that are unique to development-only routes and should not appear
// anywhere in the production build output. If any of these survive the build,
// the build-time guard is not working.
const DEV_ONLY_STRINGS = [
  // /dev/sign-in route
  "Development sign in",
  "Sign in to your local family record",
  'name="subject_id"',
  "Sign in locally",
  "Clear local sign-in cookie",
  // /preview page
  "lore-canvas",
  "Millie Stewart",
  "Bob Stewart",
];

test("production build output exists", () => {
  assert.ok(existsSync(distDir), "dist/ directory must exist — run `npm run build` first");
  const jsFiles = collectJsFiles(distDir);
  assert.ok(jsFiles.length > 0, "dist/ must contain at least one JS file");
});

test("development-only route content is absent from the production build", () => {
  const jsFiles = collectJsFiles(distDir);
  assert.ok(jsFiles.length > 0, "dist/ must contain at least one JS file");

  const allOutput = jsFiles
    .map((file) => readFileSync(file, "utf-8"))
    .join("\n");

  for (const needle of DEV_ONLY_STRINGS) {
    assert.ok(
      !allOutput.includes(needle),
      `Development-only string "${needle}" found in production build output — the build-time guard is not working`,
    );
  }
});
