import assert from "node:assert/strict";
import test from "node:test";
import { buildPilotArtistDocuments, parseArgs } from "./apply-artist-enrichment-pilot.mjs";

test("artist enrichment pilot writer is dry-run by default", () => {
  assert.equal(parseArgs([]).run, false);
  assert.equal(parseArgs(["--run", "--batch-size", "25"]).run, true);
  assert.throws(() => parseArgs(["--batch-size", "51"]), /between 1 and 50/);
});

test("structural pilot patch preserves source artist fields", () => {
  const documents = buildPilotArtistDocuments(
    [
      {
        _id: "artist-1",
        name_zh: "原姓名",
        name_en: "Original",
        bio_zh: "原简介",
        sources: [{ title: "Original", url: "https://example.com" }],
      },
    ],
    {
      artist_patches: [
        {
          _id: "artist-1",
          entity_type: "attribution",
          identity_status: "provisional",
        },
      ],
      validation: [],
    },
    "2026-07-25T00:00:00.000Z",
  );
  assert.equal(documents[0].name_zh, "原姓名");
  assert.equal(documents[0].entity_type, "attribution");
  assert.equal(documents[0].enrichment_validation_status, "structural_disposition");
});

test("partial pilot patch requires an existing source artist", () => {
  assert.throws(
    () =>
      buildPilotArtistDocuments(
        [],
        {
          artist_patches: [{ _id: "missing", entity_type: "unresolved" }],
          validation: [],
        },
        "2026-07-25T00:00:00.000Z",
      ),
    /Missing production source artist/,
  );
});
