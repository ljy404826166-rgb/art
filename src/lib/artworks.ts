import { hasSupabaseConfig, supabase } from "./supabase";

export type ArtworkRecord = {
  id: string;
  slug: string;
  title_cn: string;
  title_en: string | null;
  artist: string;
  year_and_place: string | null;
  location: string | null;
  medium: string | null;
  dimensions: string | null;
  description: string | null;
  tags: string[];
  tags_text: string | null;
  source_name: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  display_url: string | null;
  download_url: string | null;
  iiif_url: string | null;
  created_at: string;
  updated_at: string;
};

const columns = [
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

export async function fetchArtworks(): Promise<ArtworkRecord[]> {
  if (!hasSupabaseConfig) {
    throw new Error("缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY。");
  }

  const { data, error } = await supabase
    .from("published_artworks")
    .select(columns)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ArtworkRecord[];
}

export async function fetchArtworksByTag(tag: string): Promise<ArtworkRecord[]> {
  const { data, error } = await supabase
    .from("published_artworks")
    .select(columns)
    .contains("tags", [tag])
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ArtworkRecord[];
}

export async function fetchArtworksByArtist(artist: string): Promise<ArtworkRecord[]> {
  const { data, error } = await supabase
    .from("published_artworks")
    .select(columns)
    .eq("artist", artist)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ArtworkRecord[];
}
