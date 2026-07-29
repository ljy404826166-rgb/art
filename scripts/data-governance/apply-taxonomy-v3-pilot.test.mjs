import assert from "node:assert/strict";
import test from "node:test";
import { buildPilotDocuments, parseArgs } from "./apply-taxonomy-v3-pilot.mjs";

test("pilot writer is dry-run by default and validates batch size", () => {
  assert.equal(parseArgs([]).run, false);
  assert.equal(parseArgs(["--run", "--batch-size", "25"]).run, true);
  assert.throws(() => parseArgs(["--batch-size", "51"]), /between 1 and 50/);
});

test("pilot documents merge derived fields without losing source content", () => {
  const result = buildPilotDocuments({
    sourceArtworks: [{ _id: "art-1", title: "Original", tags: ["raw"] }],
    sourceArtists: [{ _id: "artist-1", name_zh: "Artist" }],
    artworkAssignments: [
      {
        _id: "art-1",
        classification_version: "classification-v3",
        classification_ids: ["style-impressionism"],
        tag_ids: ["style-impressionism"],
        artist_ids: ["artist-1"],
        primary_artist_id: "artist-1",
      },
    ],
    artistAssignments: [
      {
        _id: "artist-1",
        classification_version: "classification-v3",
        region_id: "region-europe",
        style_ids: ["style-impressionism"],
        subject_ids: ["subject-landscape"],
        decade_ids: ["period-1890s"],
        classified_artwork_count: 1,
      },
    ],
    pilotBatch: "pilot",
    syncedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(result.artworks[0].title, "Original");
  assert.deepEqual(result.artworks[0].tags, ["raw"]);
  assert.equal(result.artworks[0].classification_version, "classification-v3");
  assert.equal(result.artists[0].name_zh, "Artist");
  assert.equal(result.artists[0].pilot_batch, "pilot");
});
