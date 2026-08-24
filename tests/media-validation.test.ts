import assert from "node:assert/strict";
import test from "node:test";
import { PHOTO_LIMIT, validateMedia } from "../app/lib/media-validation";

const validPng = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZgL8AAAAASUVORK5CYII=", "base64"),
);

test("accepts a structurally complete PNG by bytes, not filename", async () => {
  const result = await validateMedia(new File([validPng], "memory.txt", { type: "text/plain" }), "photo");
  assert.equal(result.contentType, "image/png");
  assert.equal(result.extension, "png");
});

test("rejects extension-spoofed active content", async () => {
  const file = new File(["<svg><script>alert(1)</script></svg>"], "portrait.jpg", { type: "image/jpeg" });
  await assert.rejects(() => validateMedia(file, "photo"), /JPEG, PNG, or WebP/);
});

test("rejects empty and truncated image files", async () => {
  await assert.rejects(() => validateMedia(new File([], "empty.png"), "photo"), /empty/);
  const signatureOnly = new File([validPng.slice(0, 24)], "broken.png", { type: "image/png" });
  await assert.rejects(() => validateMedia(signatureOnly, "photo"), /JPEG, PNG, or WebP/);
});

test("enforces the actual byte limit", async () => {
  const oversized = new File([new Uint8Array(PHOTO_LIMIT + 1)], "large.jpg", { type: "image/jpeg" });
  await assert.rejects(() => validateMedia(oversized, "photo"), /smaller than 10 MB/);
});
