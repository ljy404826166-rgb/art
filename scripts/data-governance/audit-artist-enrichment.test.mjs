import assert from "node:assert/strict";
import test from "node:test";
import { auditArtist } from "./audit-artist-enrichment.mjs";

test("audit classifies non-person creator records and lists normalization gaps", () => {
  const row = auditArtist({
    _id: "follower-of-raphael",
    name_zh: "拉斐尔追随者",
    name_en: "Follower of Raphael",
    review_status: "candidate",
    bio_zh: "资料",
    authority_ids: {},
    sources: [{ url: "https://example.test/source" }],
  });
  assert.equal(row.inferred_entity_type, "attribution");
  assert.equal(row.proposed_identity_status, "provisional");
  assert.equal(row.research_priority, "P0");
  assert.ok(row.gaps.includes("bio_length"));
  assert.ok(row.gaps.includes("country_code"));
  assert.equal(row.source_domains[0], "example.test");
});

test("audit recognizes a verified person with authority records", () => {
  const row = auditArtist({
    _id: "artist-a",
    name_zh: "示例画家",
    name_en: "Example Artist",
    review_status: "reviewed",
    authority_ids: { wikidata: "Q1" },
    sources: [{ url: "https://www.wikidata.org/wiki/Q1" }],
    birth_year: 1880,
    death_year: 1950,
    bio_zh: "艺".repeat(220),
    country: "法国",
    region: "欧洲",
    artwork_count: 1,
  });
  assert.equal(row.inferred_entity_type, "person");
  assert.equal(row.proposed_identity_status, "verified");
  assert.equal(row.bio_char_count, 220);
  assert.equal(row.gaps.includes("bio_length"), false);
});
