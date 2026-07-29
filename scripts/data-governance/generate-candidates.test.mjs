import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateArtistCandidates } from "./generate-artist-candidates.mjs";
import { generateVocabCandidates } from "./generate-vocab-candidates.mjs";

const mockArtworks = [
  {
    _id: "artwork_a",
    artist: "克洛德·莫奈（Claude Monet, 1840-1926）",
    tag_keys: ["印象派", "油画", "19世纪"],
  },
  {
    _id: "artwork_b",
    artist: "克洛德·莫奈（Claude Monet, 1840-1926）",
    tag_keys: ["印象派", "风景画", "19世纪"],
  },
];

describe("generateArtistCandidates", () => {
  it("generates stable artist candidates from artwork artist text", () => {
    const candidates = generateArtistCandidates(mockArtworks);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]._id, "claude-monet");
    assert.equal(candidates[0].name_zh, "克洛德·莫奈");
    assert.equal(candidates[0].name_en, "Claude Monet");
    assert.equal(candidates[0].review_status, "candidate");
    assert.deepEqual(candidates[0].source_artwork_ids, ["artwork_a", "artwork_b"]);
    assert.ok(candidates[0].aliases.includes("克洛德·莫奈"));
    assert.ok(candidates[0].aliases.includes("Claude Monet"));
    assert.ok(candidates[0].aliases.includes("克洛德·莫奈（Claude Monet, 1840-1926）"));
  });
});

describe("generateVocabCandidates", () => {
  it("classifies style, medium, and period tag candidates", () => {
    const candidates = generateVocabCandidates(mockArtworks);
    const byLabel = new Map(candidates.map((candidate) => [candidate.label_zh, candidate]));

    assert.equal(byLabel.get("印象派")._id, "style-yin-xiang-pai");
    assert.equal(byLabel.get("印象派").type, "style");
    assert.equal(byLabel.get("油画")._id, "medium-you-hua");
    assert.equal(byLabel.get("油画").type, "medium");
    assert.equal(byLabel.get("19世纪")._id, "period-19shi-ji");
    assert.equal(byLabel.get("19世纪").type, "period");
    assert.deepEqual(byLabel.get("印象派").source_artwork_ids, ["artwork_a", "artwork_b"]);
  });
});
