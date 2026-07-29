import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  validateArtists,
  validateArtworkArtistLinks,
  validateReviewedData,
} from "./validate-reviewed-data.mjs";

describe("validateArtists", () => {
  it("rejects reviewed artists without an authority source", () => {
    const result = validateArtists([
      {
        _id: "artist-no-source",
        name_zh: "无来源画家",
        name_en: "Artist Without Source",
        aliases: ["Artist Without Source"],
        review_status: "reviewed",
      },
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].collection, "artists");
    assert.equal(result.errors[0].field, "sources");
  });

  it("allows candidate artists without an authority source", () => {
    const result = validateArtists([
      {
        _id: "artist-candidate",
        name_zh: "候选画家",
        name_en: "Candidate Artist",
        aliases: ["Candidate Artist"],
        review_status: "candidate",
      },
    ]);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects duplicate aliases on the same artist", () => {
    const result = validateArtists([
      {
        _id: "artist-duplicate-alias",
        name_zh: "克洛德·莫奈",
        name_en: "Claude Monet",
        aliases: ["Monet", " monet "],
        review_status: "candidate",
      },
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].field, "aliases");
  });
});

describe("validateArtworkArtistLinks", () => {
  it("rejects artwork-artist links without a role", () => {
    const result = validateArtworkArtistLinks([
      {
        _id: "link-missing-role",
        artwork_id: "artwork-1",
        artist_id: "artist-1",
        review_status: "reviewed",
      },
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].collection, "artwork_artist_links");
    assert.equal(result.errors[0].field, "role");
  });
});

describe("validateReviewedData", () => {
  it("aggregates errors across reviewed collections", () => {
    const result = validateReviewedData({
      artists: [
        {
          _id: "artist-no-source",
          name_zh: "无来源画家",
          name_en: "Artist Without Source",
          aliases: ["Artist Without Source"],
          review_status: "reviewed",
        },
      ],
      artworkArtistLinks: [
        {
          _id: "link-missing-role",
          artwork_id: "artwork-1",
          artist_id: "artist-1",
          review_status: "reviewed",
        },
      ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 2);
  });
});
