import assert from "node:assert/strict";
import test from "node:test";
import {
  artworkDedupeKey,
  isDirectArtistMatch,
  isEligibleArtworkType,
  normalizeArtistName,
  parseArgs,
} from "./museum-api-ingest.mjs";

test("normalizes dates, accents, and nationality text", () => {
  assert.equal(normalizeArtistName("Vincent van Gogh (Dutch, 1853–1890)"), "vincent van gogh");
  assert.equal(normalizeArtistName("Paul Cézanne (French, 1839-1906)"), "paul cezanne");
});

test("accepts direct creators and rejects attributed creators", () => {
  assert.equal(
    isDirectArtistMatch("Leonardo da Vinci", "Leonardo da Vinci (Italian, 1452–1519)"),
    true,
  );
  assert.equal(isDirectArtistMatch("Leonardo da Vinci", "Leonardo da Vinci", "circle of"), false);
  assert.equal(isDirectArtistMatch("Leonardo da Vinci", "Follower of Leonardo da Vinci"), false);
  assert.equal(isDirectArtistMatch("Vincent van Gogh", "Vincent van Gogh", "artist"), true);
});

test("excludes books and publications while retaining visual artworks", () => {
  assert.equal(isEligibleArtworkType("Drawing", "Drawings and Prints"), true);
  assert.equal(isEligibleArtworkType("Painting", "European Art"), true);
  assert.equal(isEligibleArtworkType("Book", "Library Special Collections"), false);
  assert.equal(isEligibleArtworkType("", "Books"), false);
});

test("parses source and retry options", () => {
  const options = parseArgs([
    "--count",
    "12",
    "--start",
    "6526",
    "--artist-start",
    "1",
    "--sources",
    "cma,met,aic",
    "--max-retries",
    "3",
    "--timeout-ms",
    "30000",
    "--out-dir",
    "D:/tmp/museum",
  ]);
  assert.equal(options.count, 12);
  assert.equal(options.start, 6526);
  assert.deepEqual(options.sources, ["cma", "met", "aic"]);
  assert.equal(options.maxRetries, 3);
});

test("matches bilingual database artists to museum titles", () => {
  assert.equal(
    artworkDedupeKey(
      "The Fighting Temeraire",
      "约瑟夫·马洛德·威廉·透纳（Joseph Mallord William Turner，1775—1851）",
    ),
    artworkDedupeKey("The Fighting Temeraire", "Joseph Mallord William Turner"),
  );
  assert.equal(
    artworkDedupeKey(
      "The Fighting Temeraire",
      "Joseph Mallord William Turner (British, 1775–1851)",
    ),
    artworkDedupeKey("The Fighting Temeraire", "Joseph Mallord William Turner"),
  );
});
