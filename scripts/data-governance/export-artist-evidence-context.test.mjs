import assert from "node:assert/strict";
import test from "node:test";

import { buildArtistEvidenceContext, parseArgs } from "./export-artist-evidence-context.mjs";

test("evidence exporter accepts a priority or explicit artist ids", () => {
  assert.equal(parseArgs([]).priority, "P0");
  assert.equal(parseArgs(["--priority", "p1"]).priority, "P1");
  assert.deepEqual(parseArgs(["--artist-id", "artist-1", "--artist-id", "artist-2"]).artistIds, [
    "artist-1",
    "artist-2",
  ]);
  assert.throws(() => parseArgs(["--priority", "P3"]), /P0, P1, or P2/);
});

test("builds P0 evidence from relationship links and legacy artist labels", () => {
  const result = buildArtistEvidenceContext({
    p0Ids: ["artist-a"],
    artists: [
      {
        _id: "artist-a",
        name_en: "Artist A",
        aliases: ["A. Artist"],
      },
      {
        _id: "artist-b",
        name_en: "Artist B",
      },
    ],
    artworks: [
      {
        _id: "work-linked",
        title: "Linked work",
        artist_en: "Different label",
      },
      {
        _id: "work-alias",
        title: "Alias work",
        artist_en: "A. Artist",
      },
    ],
    artworkArtistLinks: [
      {
        _id: "link-1",
        artist_id: "artist-a",
        artwork_id: "work-linked",
        role: "creator",
        review_status: "candidate",
      },
    ],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].linked_artworks.length, 2);
  assert.deepEqual(result[0].linked_artworks.map((row) => row.match_type).sort(), [
    "artist_label",
    "relationship",
  ]);
  assert.equal(result[0].linked_artworks[0].role, "creator");
});
