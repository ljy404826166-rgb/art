import assert from "node:assert/strict";
import test from "node:test";
import {
  detectImageMime,
  focusedSquareBounds,
  objectKeyFor,
  parseArgs,
  publicUrlFor,
} from "./process-upload-portrait-pilot.mjs";

test("task 5 defaults to dry-run and fixes the dedicated portrait prefix", () => {
  const options = parseArgs([], {
    TENCENT_COS_BUCKET: "bucket-123",
    TENCENT_COS_REGION: "ap-test",
    TENCENT_COS_DOMAIN: "https://img.example.test",
  });
  assert.equal(options.run, false);
  assert.equal(options.prefix, "artist-portraits");
  assert.throws(() => parseArgs(["--prefix", "ppaintings"], {}), /must remain artist-portraits/u);
});

test("task 5 recognizes JPEG, PNG, and WebP signatures", () => {
  assert.equal(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xdb])), "image/jpeg");
  assert.equal(
    detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
  assert.equal(detectImageMime(Buffer.from("RIFF0000WEBP", "ascii")), "image/webp");
  assert.equal(detectImageMime(Buffer.from("not-an-image")), "");
});

test("focused crop honors focus and clamps to source bounds", () => {
  assert.deepEqual(focusedSquareBounds(1200, 800, 0.5, 0.5, 1), {
    left: 200,
    top: 0,
    width: 800,
    height: 800,
  });
  const tight = focusedSquareBounds(1200, 800, 0.95, 0.1, 2);
  assert.deepEqual(tight, { left: 800, top: 0, width: 400, height: 400 });
});

test("object keys are versioned, immutable, and reject unsafe artist IDs", () => {
  assert.equal(objectKeyFor("claude-monet"), "artist-portraits/claude-monet/v1/portrait-512.webp");
  assert.throws(() => objectKeyFor("../escape"), /Unsafe artist_id/u);
  assert.throws(() => objectKeyFor("claude-monet", "other"), /Unexpected portrait prefix/u);
});

test("public URL encodes object-key segments without changing hierarchy", () => {
  assert.equal(
    publicUrlFor("artist-portraits/claude-monet/v1/portrait-512.webp", {
      domain: "https://img.example.test/",
      bucket: "",
      region: "",
    }),
    "https://img.example.test/artist-portraits/claude-monet/v1/portrait-512.webp",
  );
});
