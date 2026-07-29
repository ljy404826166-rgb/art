import test from "node:test";
import assert from "node:assert/strict";
import {
  derivativeObjectPaths,
  isEligibleImageRow,
  parseArgs,
  sanitizedUrlPath,
  updatePayloadForManifestRow,
} from "./image-derivatives-shared.mjs";

test("parseArgs defaults to dry-run and limit 20", () => {
  const args = parseArgs([]);
  assert.equal(args.dryRun, true);
  assert.equal(args.limit, 20);
});

test("parseArgs requires explicit execute to disable dry-run", () => {
  const args = parseArgs(["--execute", "--limit", "20"]);
  assert.equal(args.dryRun, false);
  assert.equal(args.limit, 20);
});

test("derivativeObjectPaths uses new derivative paths", () => {
  assert.deepEqual(derivativeObjectPaths("1504_standard"), {
    thumbnailObjectPath: "derivatives/thumb/1504_standard.webp",
    displayObjectPath: "derivatives/display/1504_standard.webp",
  });
});

test("sanitizedUrlPath strips query and origin details to safe path", () => {
  assert.equal(
    sanitizedUrlPath(
      "https://example.supabase.co/storage/v1/object/public/artwork/1504_standard.jpg?token=secret",
    ),
    "/storage/v1/object/public/artwork/1504_standard.jpg",
  );
});

test("isEligibleImageRow requires equal current urls and storage source", () => {
  const row = {
    thumbnail_url: "https://x.supabase.co/storage/v1/object/public/artwork/a.jpg",
    display_url: "https://x.supabase.co/storage/v1/object/public/artwork/a.jpg",
    download_url: "https://x.supabase.co/storage/v1/object/public/artwork/a.jpg",
  };
  assert.equal(isEligibleImageRow(row), true);
});

test("updatePayloadForManifestRow preserves download_url", () => {
  const payload = updatePayloadForManifestRow({
    artworkImageId: "image-row-id",
    thumbnailPublicUrl: "https://cdn/thumb.webp",
    displayPublicUrl: "https://cdn/display.webp",
    currentDownloadUrl: "https://origin/original.jpg",
  });
  assert.deepEqual(payload, {
    id: "image-row-id",
    thumbnail_url: "https://cdn/thumb.webp",
    display_url: "https://cdn/display.webp",
  });
});
