import { describe, expect, it } from "vitest";

import { searchArtworks } from "./artwork-search";

const sampleArtworks = [
  {
    id: "starry-night",
    title: "星月夜",
    titleEn: "The Starry Night",
    artist: "Vincent van Gogh",
    year: "1889",
    movement: "Post-Impressionism",
    place: "Saint-Remy",
    tags: ["夜空", "后印象派"],
  },
  {
    id: "water-lilies",
    title: "睡莲",
    titleEn: "Water Lilies",
    artist: "Claude Monet",
    year: "1916",
    movement: "Impressionism",
    place: "Giverny",
    tags: ["花园", "印象派"],
  },
];

describe("searchArtworks", () => {
  it("returns all artworks for an empty query", () => {
    expect(searchArtworks(sampleArtworks, "").map((item) => item.id)).toEqual([
      "starry-night",
      "water-lilies",
    ]);
  });

  it("matches Chinese and English fields", () => {
    expect(searchArtworks(sampleArtworks, "星月").map((item) => item.id)).toEqual(["starry-night"]);
    expect(searchArtworks(sampleArtworks, "monet").map((item) => item.id)).toEqual([
      "water-lilies",
    ]);
  });

  it("supports useful fuzzy matching for artist names", () => {
    expect(searchArtworks(sampleArtworks, "vangog").map((item) => item.id)).toEqual([
      "starry-night",
    ]);
  });
});
