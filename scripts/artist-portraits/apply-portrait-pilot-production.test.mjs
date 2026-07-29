import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDesiredPortraits,
  buildPatch,
  buildRollbackRecord,
  parseArgs,
  portraitFields,
} from "./apply-portrait-pilot-production.mjs";

const ENV_ID = "cloudbase-d6gvny27ib05e0ede";

function evidence(overrides = {}) {
  const review = {
    artist_id: "artist-one",
    final_status: "selected",
    portrait_source_url: "https://commons.example.test/File:Artist",
    portrait_license: "Public domain",
    portrait_credit: "Museum",
    portrait_kind: "historical_portrait",
    portrait_artwork_id: "",
    ...overrides,
  };
  const upload = {
    artist_id: review.artist_id,
    public_url: `https://cdn.example.test/${review.artist_id}.webp`,
    bytes: 1000,
    sha256: `${review.artist_id}-hash`,
    content_type: "image/webp",
  };
  const remote = {
    artist_id: review.artist_id,
    public_url: upload.public_url,
    remote_sha256: upload.sha256,
    remote_content_type: "image/webp",
    remote_width: 512,
    remote_height: 512,
    verified: true,
  };
  return { review, upload, remote };
}

function pilotEvidence() {
  const rows = Array.from({ length: 19 }, (_, index) =>
    evidence({
      artist_id: `artist-${index + 1}`,
      portrait_artwork_id: index === 0 ? "artwork-one" : "",
    }),
  );
  return {
    reviews: rows.map((row) => row.review),
    uploads: rows.map((row) => row.upload),
    report: {
      generated_at: "2026-07-26T12:00:00.000Z",
      mode: "uploaded",
      objects: rows.map((row) => row.remote),
    },
  };
}

test("task 6 requires explicit production confirmation", () => {
  assert.equal(parseArgs([]).run, false);
  assert.throws(() => parseArgs(["--run"]), /confirm-production/u);
  assert.throws(() => parseArgs(["--env-id", "other"]), /restricted/u);
  assert.equal(parseArgs(["--run", "--confirm-production", ENV_ID]).run, true);
});

test("desired portrait records require nineteen verified Task 5 uploads", () => {
  const input = pilotEvidence();
  const desired = buildDesiredPortraits(input.reviews, input.uploads, input.report);
  assert.equal(desired.length, 19);
  assert.equal(desired[0].portrait_artwork_id, "artwork-one");
  assert.equal(desired[1].portrait_artwork_id, undefined);
  assert.equal(desired[0].portrait_status, "approved");
  assert.equal(desired[0].portrait_updated_at, input.report.generated_at);
});

test("concluded fallback records clear portrait assets without requiring uploads", () => {
  const reviews = [
    { artist_id: "artist-one", final_status: "no_eligible_asset" },
    { artist_id: "publisher-one", final_status: "non_person_entity" },
  ];
  const desired = buildDesiredPortraits(
    reviews,
    [],
    { mode: "not_required", objects: [] },
    2,
    "2026-07-26T12:30:00.000Z",
  );
  assert.deepEqual(desired, [
    {
      _id: "artist-one",
      portrait_status: "no_eligible_asset",
      portrait_updated_at: "2026-07-26T12:30:00.000Z",
    },
    {
      _id: "publisher-one",
      portrait_status: "non_person_entity",
      portrait_updated_at: "2026-07-26T12:30:00.000Z",
    },
  ]);
});

test("external portrait patch unsets a stale artwork relation", () => {
  const current = {
    _id: "artist-one",
    portrait_artwork_id: "stale-artwork",
    portrait_status: "candidate",
  };
  const desired = {
    _id: "artist-one",
    portrait_url: "https://cdn.example.test/artist-one.webp",
    portrait_source: "https://example.test/source",
    portrait_license: "Public domain",
    portrait_credit: "Museum",
    portrait_kind: "photograph",
    portrait_status: "approved",
    portrait_updated_at: "2026-07-26T12:00:00.000Z",
  };
  const patch = buildPatch(current, desired);
  assert.equal(patch.unset.portrait_artwork_id, "");
  assert.equal(patch.set.portrait_status, "approved");
  assert.ok(patch.differences.some((item) => item.field === "portrait_url"));
});

test("rollback manifest preserves present fields and unsets originally absent fields", () => {
  const current = {
    _id: "artist-one",
    portrait_status: "candidate",
    portrait_source: "https://example.test/old",
  };
  const rollback = buildRollbackRecord(current);
  assert.deepEqual(rollback.restore_set, portraitFields(current));
  assert.ok(rollback.restore_unset.includes("portrait_url"));
  assert.ok(!rollback.restore_unset.includes("portrait_status"));
  assert.match(rollback.original_document_sha256, /^[a-f0-9]{64}$/u);
});
