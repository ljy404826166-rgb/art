import assert from "node:assert/strict";
import test from "node:test";
import {
  countBiographyCharacters,
  inferArtistEntityType,
  validateArtistEnrichment,
  validateBiography,
} from "./artist-enrichment.mjs";

function biography(length, prefix = "") {
  return `${prefix}${"艺".repeat(Math.max(0, length - Array.from(prefix).length))}`;
}

function validArtist(overrides = {}) {
  return {
    _id: "artist-a",
    entity_type: "person",
    identity_status: "verified",
    name_zh: "示例画家",
    name_en: "Example Artist",
    aliases: [],
    birth_year: 1880,
    death_year: 1950,
    occupations_zh: ["画家"],
    bio_zh: biography(220, "示例画家生于1880年，卒于1950年。"),
    bio_facts: {
      lifespan: "1880年生，1950年卒",
      title: "画家",
      career: "主要生涯已经核实",
      standing: "艺术史地位已经核实",
    },
    authority_ids: { wikidata: "Q1" },
    sources: [{ title: "Authority", url: "https://example.test/artist-a" }],
    ...overrides,
  };
}

test("counts biography characters after removing whitespace", () => {
  assert.equal(countBiographyCharacters("画 家\n简介"), 4);
});

test("requires a 200-300 character biography with four evidence facets", () => {
  assert.equal(validateBiography(validArtist()).ok, true);
  assert.match(
    validateBiography(validArtist({ bio_zh: biography(199, "1880 1950") })).errors[0].message,
    /200-300/,
  );
  assert.equal(
    validateBiography(
      validArtist({
        bio_facts: { lifespan: "", title: "画家", career: "生涯", standing: "地位" },
      }),
    ).ok,
    false,
  );
});

test("person biography mentions known birth and death years", () => {
  const result = validateBiography(
    validArtist({
      bio_zh: biography(220),
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.message.includes("birth_year")));
  assert.ok(result.errors.some((item) => item.message.includes("death_year")));
});

test("infers organizations, workshops, attributions, anonymous and unresolved records", () => {
  assert.equal(inferArtistEntityType({ name_en: "Imprimerie Chaix" }), "organization");
  assert.equal(inferArtistEntityType({ name_en: "Studio of Georges Rouget" }), "workshop");
  assert.equal(inferArtistEntityType({ name_en: "Follower of Raphael" }), "attribution");
  assert.equal(inferArtistEntityType({ name_zh: "未知艺术家" }), "anonymous");
  assert.equal(
    inferArtistEntityType({ name_en: "A. Example", review_status: "candidate" }),
    "unresolved",
  );
});

test("valid enriched artist passes all core governance rules", () => {
  assert.deepEqual(validateArtistEnrichment(validArtist()), {
    ok: true,
    biography_length: 220,
    errors: [],
  });
});
