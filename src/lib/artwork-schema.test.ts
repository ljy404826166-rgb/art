import { describe, expect, it } from "vitest";

import { parseArtworkRecords } from "./artwork-schema";

describe("parseArtworkRecords", () => {
  it("normalizes nullable Supabase artwork fields", () => {
    const records = parseArtworkRecords([
      {
        id: "1",
        slug: "starry-night",
        title_cn: "星月夜",
        title_en: "The Starry Night",
        artist: "Vincent van Gogh",
        year_and_place: null,
        location: null,
        medium: null,
        dimensions: null,
        description: null,
        tags: "夜空, 后印象派",
        tags_text: null,
        source_name: null,
        source_url: null,
        thumbnail_url: null,
        display_url: null,
        download_url: null,
        iiif_url: null,
        created_at: "2026-05-24T00:00:00.000Z",
        updated_at: "2026-05-24T00:00:00.000Z",
      },
    ]);

    expect(records[0]?.tags).toEqual(["夜空", "后印象派"]);
  });

  it("throws when required artwork identity fields are missing", () => {
    expect(() => parseArtworkRecords([{ title_cn: "无效记录" }])).toThrow(
      /Invalid artwork payload/,
    );
  });
});
