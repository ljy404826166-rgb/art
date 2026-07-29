import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveArtistClassification,
  resolveRegionId,
  selectPilotArtists,
} from "./artist-classification.mjs";

test("derives controlled style, subject, and chronological decade ids from linked artworks", () => {
  const artist = {
    _id: "artist-a",
    region: "欧洲",
    country: "法国",
    styles: ["印象派"],
  };
  const artworks = [
    {
      status: "published",
      classification_ids: ["style-impressionism", "subject-landscape", "period-1890s"],
    },
    {
      status: "published",
      classification_ids: ["style-impressionism", "subject-landscape", "period-1880s"],
    },
  ];

  const result = deriveArtistClassification(artist, artworks);
  assert.equal(result.classification_version, "classification-v7");
  assert.equal(result.region_id, "region-europe");
  assert.deepEqual(result.style_ids, ["style-impressionism"]);
  assert.deepEqual(result.subject_ids, ["subject-landscape"]);
  assert.deepEqual(result.decade_ids, ["period-1880s", "period-1890s"]);
  assert.equal(result.classified_artwork_count, 2);
});

test("uses clean legacy styles only when linked artworks provide no style classification", () => {
  const result = deriveArtistClassification(
    {
      _id: "artist-a",
      styles: ["文艺复兴", "1452-1519", "油画"],
    },
    [],
  );

  assert.deepEqual(result.style_ids, ["style-renaissance"]);
  assert.deepEqual(result.subject_ids, []);
  assert.deepEqual(result.decade_ids, []);
});

test("region mapping never exposes a pending-review label", () => {
  assert.equal(resolveRegionId({ region: "待审核", country: "日本" }), "region-asia");
  assert.equal(resolveRegionId({ region: "待审核", country: "未知" }), "region-other");
});

test("pilot includes named representatives then fills by artwork count", () => {
  const rows = [
    { artistId: "other", derived: { classified_artwork_count: 100 } },
    { artistId: "claude-monet", derived: { classified_artwork_count: 10 } },
    { artistId: "leonardo-da-vinci", derived: { classified_artwork_count: 5 } },
  ];
  assert.deepEqual(
    selectPilotArtists(rows, 3).map((row) => row.artistId),
    ["leonardo-da-vinci", "claude-monet", "other"],
  );
});
