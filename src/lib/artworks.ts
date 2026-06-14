import { hasSupabaseConfig, supabase } from "./supabase";
import { type ArtworkRecord, parseArtworkRecords } from "./artwork-schema";

export type { ArtworkRecord } from "./artwork-schema";

export type ArtworkPageOptions = {
  limit?: number;
  from?: number;
  tag?: string;
  artist?: string;
};

export type ArtworkPageResult = {
  items: ArtworkRecord[];
  nextFrom: number | null;
  hasMore: boolean;
  totalCount: number | null;
};

const summaryColumns = [
  "id",
  "slug",
  "title_cn",
  "title_en",
  "artist",
  "year_and_place",
  "dimensions",
  "tags",
  "tags_text",
  "thumbnail_url",
  "display_url",
  "created_at",
  "updated_at",
].join(",");

const detailColumns = [
  "id",
  "slug",
  "title_cn",
  "title_en",
  "artist",
  "year_and_place",
  "location",
  "medium",
  "dimensions",
  "description",
  "tags",
  "tags_text",
  "source_name",
  "source_url",
  "thumbnail_url",
  "display_url",
  "download_url",
  "iiif_url",
  "created_at",
  "updated_at",
].join(",");

const defaultPageSize = 80;

function assertSupabaseConfig() {
  if (!hasSupabaseConfig) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
  }
}

export async function fetchArtworksPage(options: ArtworkPageOptions = {}): Promise<ArtworkPageResult> {
  assertSupabaseConfig();

  const limit = Math.max(1, Math.min(options.limit ?? defaultPageSize, 100));
  const from = Math.max(0, options.from ?? 0);
  const to = from + limit;
  let query = supabase
    .from("published_artworks")
    .select(summaryColumns, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (options.tag) query = query.contains("tags", [options.tag]);
  if (options.artist) query = query.eq("artist", options.artist);

  const { data, error, count } = await query;

  if (error) throw new Error(error.message);

  const records = parseArtworkRecords(data ?? []);
  return {
    items: records.slice(0, limit),
    hasMore: records.length > limit,
    nextFrom: records.length > limit ? from + limit : null,
    totalCount: count ?? null,
  };
}

export async function fetchArtworks(): Promise<ArtworkRecord[]> {
  const page = await fetchArtworksPage({ limit: defaultPageSize, from: 0 });
  return page.items;
}

export async function fetchArtworkById(id: string): Promise<ArtworkRecord | null> {
  assertSupabaseConfig();

  const { data, error } = await supabase
    .from("published_artworks")
    .select(detailColumns)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return parseArtworkRecords([data])[0] ?? null;
}

export async function fetchArtworksByTag(tag: string, options: ArtworkPageOptions = {}): Promise<ArtworkRecord[]> {
  const page = await fetchArtworksPage({ ...options, tag });
  return page.items;
}

export async function fetchArtworksByArtist(artist: string, options: ArtworkPageOptions = {}): Promise<ArtworkRecord[]> {
  const page = await fetchArtworksPage({ ...options, artist });
  return page.items;
}
