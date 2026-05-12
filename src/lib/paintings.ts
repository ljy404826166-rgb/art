import { fetchArtworks, type ArtworkRecord } from "./artworks";

export type Painting = {
  id: string;
  title_cn: string | null;
  title_en: string | null;
  artist: string | null;
  location: string | null;
  year_and_place: string | null;
  medium: string | null;
  dimensions: string | null;
  description: string | null;
  tags: string | string[] | null;
  display_url: string | null;
  thumbnail_url: string | null;
  download_url: string | null;
};

function artworkToPainting(artwork: ArtworkRecord): Painting {
  return {
    id: artwork.id,
    title_cn: artwork.title_cn,
    title_en: artwork.title_en,
    artist: artwork.artist,
    location: artwork.location,
    year_and_place: artwork.year_and_place,
    medium: artwork.medium,
    dimensions: artwork.dimensions,
    description: artwork.description,
    tags: artwork.tags_text || artwork.tags,
    display_url: artwork.display_url || artwork.thumbnail_url,
    thumbnail_url: artwork.thumbnail_url,
    download_url: artwork.download_url,
  };
}

export async function fetchPaintings(): Promise<Painting[]> {
  const artworks = await fetchArtworks();
  return artworks.map(artworkToPainting);
}
