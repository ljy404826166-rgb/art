import MiniSearch from "minisearch";

export type SearchableArtwork = {
  id: string;
  title?: string | null;
  titleCn?: string | null;
  titleEn?: string | null;
  artist?: string | null;
  year?: string | null;
  yearAndPlace?: string | null;
  movement?: string | null;
  place?: string | null;
  medium?: string | null;
  location?: string | null;
  description?: string | null;
  tags?: string[];
};

type ArtworkSearchDocument = SearchableArtwork & {
  aliasText: string;
  tagsText: string;
};

function compactAliases(value: string | null | undefined): string[] {
  const words = (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter(Boolean);
  const aliases = new Set(words);

  for (let index = 0; index < words.length - 1; index += 1) {
    aliases.add(`${words[index]}${words[index + 1]}`);
  }
  if (words.length > 1) aliases.add(words.join(""));

  return [...aliases];
}

function toSearchDocument(item: SearchableArtwork): ArtworkSearchDocument {
  return {
    ...item,
    aliasText: [
      ...compactAliases(item.title),
      ...compactAliases(item.titleCn),
      ...compactAliases(item.titleEn),
      ...compactAliases(item.artist),
    ].join(" "),
    tagsText: (item.tags ?? []).join(" "),
  };
}

export function searchArtworks<TArtwork extends SearchableArtwork>(
  items: readonly TArtwork[],
  query: string,
): TArtwork[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [...items];

  const documents = items.map(toSearchDocument);
  const byId = new Map(items.map((item) => [item.id, item]));
  const index = new MiniSearch<ArtworkSearchDocument>({
    fields: [
      "title",
      "titleCn",
      "titleEn",
      "artist",
      "year",
      "yearAndPlace",
      "movement",
      "place",
      "medium",
      "location",
      "description",
      "tagsText",
      "aliasText",
    ],
    searchOptions: {
      boost: { title: 3, titleCn: 3, titleEn: 2, artist: 2, tagsText: 2, aliasText: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
    storeFields: ["id"],
  });

  index.addAll(documents);

  return index
    .search(normalizedQuery)
    .map((result) => byId.get(String(result.id)))
    .filter((item): item is TArtwork => Boolean(item));
}
