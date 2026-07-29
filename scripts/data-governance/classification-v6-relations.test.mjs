import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildClassificationV6Migration } from "./classification-v6-relations.mjs";
import { buildControlledVocabulary } from "./controlled-vocabulary-v1.mjs";

const terms = buildControlledVocabulary();
const artists = [
  {
    _id: "pierre-auguste-renoir",
    entity_type: "person",
    name_zh: "皮埃尔-奥古斯特·雷诺阿",
    name_en: "Pierre-Auguste Renoir",
    aliases: ["雷诺阿"],
    review_status: "reviewed",
  },
  {
    _id: "eugene-delacroix",
    entity_type: "person",
    name_zh: "欧仁·德拉克罗瓦",
    name_en: "Eugène Delacroix",
    aliases: ["Eugene Delacroix"],
    review_status: "reviewed",
  },
  {
    _id: "candidate-person",
    entity_type: "person",
    name_zh: "待确认画家",
    name_en: "Candidate Artist",
    review_status: "candidate",
  },
  {
    _id: "artist-anonymous",
    entity_type: "anonymous",
    name_zh: "未知艺术家",
    name_en: "Anonymous",
    review_status: "reviewed",
  },
];

function migrate(artworks, existingArtistLinks = []) {
  return buildClassificationV6Migration({
    artworks,
    artists,
    terms,
    existingArtistLinks,
    batchId: "test-batch",
    updatedAt: "2026-07-28T00:00:00.000Z",
  });
}

describe("classification-v6 artist relation normalization", () => {
  it("repairs the malformed Renoir reference only when source text is certain", () => {
    const malformed = "feng-19shi-ji-fa-guo-xian-zhu-yi-xiang-zhu-yi";
    const result = migrate([
      {
        _id: "renoir-certain",
        artist_ids: [malformed],
        artist: "皮埃尔-奥古斯特·雷诺阿（法国，1841—1919）",
        classification_ids: ["style-impressionism"],
      },
      {
        _id: "renoir-uncertain",
        artist_ids: [malformed],
        artist: "作者未明确记载（可能为雷诺阿风格）",
        classification_ids: ["style-impressionism"],
      },
    ]);

    const certain = result.artworkAssignments.find((row) => row._id === "renoir-certain");
    const uncertain = result.artworkAssignments.find((row) => row._id === "renoir-uncertain");
    assert.deepEqual(certain.artist_ids, ["pierre-auguste-renoir"]);
    assert.deepEqual(uncertain.artist_ids, []);
    assert.equal(result.artistReviewQueue.length, 1);
  });

  it("repairs reviewed aliases but does not publish candidate identities", () => {
    const result = migrate([
      {
        _id: "reviewed-alias",
        artist_ids: ["eug-ne-delacroix"],
        classification_ids: ["subject-portrait"],
      },
      {
        _id: "candidate-identity",
        artist_ids: ["candidate-person"],
        classification_ids: ["subject-portrait"],
      },
    ]);

    assert.deepEqual(
      result.artworkAssignments.find((row) => row._id === "reviewed-alias").artist_ids,
      ["eugene-delacroix"],
    );
    assert.deepEqual(
      result.artworkAssignments.find((row) => row._id === "candidate-identity").artist_ids,
      [],
    );
    assert.equal(
      result.artworkArtistLinks.find((link) => link.artwork_id === "candidate-identity")
        .review_status,
      "candidate",
    );
  });

  it("creates a candidate attribution entity for national schools", () => {
    const result = migrate([
      {
        _id: "french-school",
        artist_ids: ["french"],
        artist: "French school (artist unknown)",
        classification_ids: ["period-19th-century"],
      },
    ]);

    assert.deepEqual(result.artworkAssignments[0].artist_ids, []);
    assert.equal(result.attributionCandidates[0]._id, "attribution-french-school");
    assert.equal(result.artworkArtistLinks[0].role, "attributed_to");
    assert.equal(result.artworkArtistLinks[0].review_status, "candidate");
  });

  it("derives an exact reviewed artist from raw text when no old relation exists", () => {
    const result = migrate([
      {
        _id: "raw-only",
        artist: "Pierre-Auguste Renoir, 1841–1919",
        classification_ids: ["style-impressionism"],
      },
    ]);

    assert.deepEqual(result.artworkAssignments[0].artist_ids, ["pierre-auguste-renoir"]);
    assert.equal(result.artworkArtistLinks[0].match_source, "exact-canonical-name-in-source-text");
  });
});

describe("classification-v6 integrity and review coverage", () => {
  it("keeps unclassified artworks out of strict filters without failing referential integrity", () => {
    const result = migrate([
      {
        _id: "pending-strict-review",
        tags: ["版画"],
      },
    ]);

    assert.equal(result.ok, true);
    assert.deepEqual(result.artworkAssignments[0].classification_ids, []);
    assert.deepEqual(result.artworkAssignments[0].tag_ids, ["medium-print"]);
    assert.equal(result.checks.artworks_with_classification_ids, 0);
  });
});

describe("classification-v6 tag relation normalization", () => {
  it("derives the decade from structured artwork dates", () => {
    const result = migrate([
      {
        _id: "dated-work",
        year_and_place: "1756年，伦敦",
        tag_keys: ["人物画"],
      },
    ]);

    assert.deepEqual(result.artworkAssignments[0].decade_ids, ["period-1750s"]);
    assert.ok(result.artworkAssignments[0].classification_ids.includes("period-1750s"));
    assert.equal(
      result.artworkTagLinks.find((link) => link.tag_id === "period-1750s").match_source,
      "structured-date-derived",
    );
  });

  it("maps aliases into typed relations and keeps artist names out of the tag queue", () => {
    const result = migrate([
      {
        _id: "typed-tags",
        artist_ids: ["pierre-auguste-renoir"],
        classification_ids: ["style-impressionism"],
        tag_keys: [
          "印象主义",
          "油画",
          "画布",
          "19世纪",
          "公共领域",
          "皮埃尔-奥古斯特·雷诺阿",
          "暖色氛围",
        ],
      },
    ]);
    const artwork = result.artworkAssignments[0];

    assert.deepEqual(artwork.style_ids, ["style-impressionism"]);
    assert.deepEqual(artwork.medium_ids, ["medium-oil-painting"]);
    assert.deepEqual(artwork.support_ids, ["support-canvas"]);
    assert.deepEqual(artwork.period_ids, ["period-19th-century"]);
    assert.deepEqual(artwork.rights_ids, ["rights-public-domain"]);
    assert.equal(result.ignoredArtistTags.length, 1);
    assert.equal(result.ignoredArtistTags[0].route_type, "artist_dimension");
    assert.deepEqual(
      result.tagReviewQueue.map((row) => row.source_tag_text),
      ["暖色氛围"],
    );
  });

  it("preserves existing classification filters and caps added filters at eight", () => {
    const result = migrate([
      {
        _id: "classification-cap",
        classification_ids: [
          "style-impressionism",
          "subject-portrait",
          "subject-landscape",
          "subject-still-life",
          "subject-genre-scene",
          "subject-seascape",
          "subject-religious",
        ],
        tag_keys: ["人物画", "室内"],
      },
    ]);

    assert.equal(result.artworkAssignments[0].classification_ids.length, 8);
    assert.deepEqual(
      new Set(result.artworkAssignments[0].classification_ids),
      new Set([
        "style-impressionism",
        "subject-portrait",
        "subject-landscape",
        "subject-still-life",
        "subject-genre-scene",
        "subject-seascape",
        "subject-religious",
        "subject-figure",
      ]),
    );
  });

  it("suppresses unsafe inherited subject mappings while retaining semantic matches", () => {
    const result = migrate([
      {
        _id: "marine-plate",
        title_cn: "图谱：海蜥鱼与海雀鹰鱼",
        description: "自然史鱼类图谱",
        classification_ids: ["subject-illustration", "subject-botanical", "subject-marine-life"],
        tag_keys: ["博物插图", "海洋生物"],
      },
      {
        _id: "botanical-plate",
        title_cn: "苹果",
        medium: "彩色植物图谱插图",
        classification_ids: ["subject-illustration", "subject-botanical"],
        tag_keys: ["博物插图"],
      },
      {
        _id: "artwork_ba52eef6-3dd1-47af-93ef-f66697875f3b",
        title_cn: "宫娥",
        medium: "布面油画",
        classification_ids: ["subject-illustration", "subject-botanical"],
        tag_keys: ["博物插图"],
        tags_text: "博物插图,西方艺术史,油画",
      },
      {
        _id: "chapel-figure-study",
        title_cn: "圣母面部习作——旺斯礼拜堂",
        classification_ids: ["subject-religious", "subject-architectural-landscape"],
        tag_keys: ["礼拜堂设计"],
      },
      {
        _id: "ambiguous-flora-fauna",
        classification_ids: ["subject-floral", "subject-animal"],
        tag_keys: ["花鸟虫兽"],
      },
    ]);

    const assignment = (id) => result.artworkAssignments.find((row) => row._id === id);

    assert.deepEqual(assignment("marine-plate").subject_ids.sort(), [
      "subject-illustration",
      "subject-marine-life",
    ]);
    assert.deepEqual(assignment("botanical-plate").subject_ids.sort(), [
      "subject-botanical",
      "subject-illustration",
    ]);
    assert.deepEqual(assignment("artwork_ba52eef6-3dd1-47af-93ef-f66697875f3b").subject_ids, [
      "subject-figure",
      "subject-portrait",
      "subject-interior",
    ]);
    assert.deepEqual(assignment("chapel-figure-study").subject_ids, ["subject-religious"]);
    assert.deepEqual(assignment("ambiguous-flora-fauna").subject_ids, []);
    assert.equal(
      result.tagReviewQueue.some(
        (row) =>
          row.artwork_id === "artwork_ba52eef6-3dd1-47af-93ef-f66697875f3b" &&
          row.reason === "legacy_botanical_missing_semantic_evidence",
      ),
      true,
    );
    assert.equal(
      result.tagReviewQueue.some(
        (row) =>
          row.artwork_id === "ambiguous-flora-fauna" &&
          row.reason === "ambiguous_compound_subject_requires_artwork_review",
      ),
      true,
    );
  });

  it("is deterministic and passes integrity gates", () => {
    const artworks = [
      {
        _id: "deterministic",
        artist_ids: ["eug-ne-delacroix"],
        classification_ids: ["subject-portrait"],
        tag_keys: ["油画"],
      },
    ];
    const first = migrate(artworks);
    const second = migrate(artworks);

    assert.deepEqual(first, second);
    assert.equal(first.ok, true);
    assert.deepEqual(first.checks.unknown_tag_ids, []);
    assert.deepEqual(first.checks.orphan_artist_ids, []);
    assert.deepEqual(first.checks.duplicate_tag_link_ids, []);
    assert.deepEqual(first.checks.duplicate_artist_link_ids, []);
    assert.deepEqual(first.checks.derived_artist_link_mismatches, []);
  });

  it("is idempotent after applying the proposed artwork fields and relations", () => {
    const sourceArtwork = {
      _id: "idempotent",
      artist_ids: ["eug-ne-delacroix"],
      classification_ids: ["subject-portrait"],
      tag_keys: ["油画"],
    };
    const first = migrate([sourceArtwork]);
    const appliedArtwork = {
      ...sourceArtwork,
      ...first.artworkAssignments[0],
    };
    delete appliedArtwork.previous;
    delete appliedArtwork.changed;

    const second = buildClassificationV6Migration({
      artworks: [appliedArtwork],
      artists,
      terms,
      existingArtistLinks: first.artworkArtistLinks,
      existingTagLinks: first.artworkTagLinks,
      batchId: "test-batch",
      updatedAt: "2026-07-28T00:00:00.000Z",
    });

    assert.equal(second.artworkAssignments[0].changed, false);
    assert.deepEqual(
      second.artworkAssignments[0].artist_ids,
      first.artworkAssignments[0].artist_ids,
    );
    assert.deepEqual(second.artworkAssignments[0].tag_ids, first.artworkAssignments[0].tag_ids);
  });
});
