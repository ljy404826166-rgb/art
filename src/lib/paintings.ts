import {
  fetchArtworkById,
  fetchArtworksPage,
  type ArtworkPageOptions,
  type ArtworkRecord,
} from "./artworks";
import {
  artworkPageCacheKey,
  readArtworkDetailCache,
  readArtworkPageCache,
  saveArtworkDetailCache,
  saveArtworkPageCache,
} from "./local-library-store";
import { hasSupabaseConfig } from "./supabase";

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
  iiif_url?: string | null;
};

export type PaintingsPageResult = {
  paintings: Painting[];
  nextFrom: number | null;
  hasMore: boolean;
  totalCount: number | null;
  source: "network" | "cache" | "preview";
  cachedAt?: string;
  error?: string;
  offline: boolean;
};

const maxReadAttempts = 2;
const retryDelayMs = 450;
const pageRequests = new Map<string, Promise<PaintingsPageResult>>();
const detailRequests = new Map<string, Promise<Painting | null>>();

const previewPaintings: Painting[] = [
  {
    id: "preview-starry-night",
    title_cn: "星月夜",
    title_en: "The Starry Night",
    artist: "Vincent van Gogh",
    location: "Museum of Modern Art, New York",
    year_and_place: "1889, Saint-Remy-de-Provence",
    medium: "Oil on canvas",
    dimensions: "73.7 x 92.1 cm",
    description: "A preview artwork used when the Supabase artwork source is unavailable locally.",
    tags: ["Post-Impressionism", "Night", "Landscape"],
    display_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/640px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
    thumbnail_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/320px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
    download_url:
      "https://upload.wikimedia.org/wikipedia/commons/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
  },
  {
    id: "preview-girl-with-pearl",
    title_cn: "戴珍珠耳环的少女",
    title_en: "Girl with a Pearl Earring",
    artist: "Johannes Vermeer",
    location: "Mauritshuis, The Hague",
    year_and_place: "c. 1665, Delft",
    medium: "Oil on canvas",
    dimensions: "44.5 x 39 cm",
    description:
      "A compact preview record so the gallery remains usable without a remote database.",
    tags: ["Dutch Golden Age", "Portrait"],
    display_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Meisje_met_de_parel.jpg/640px-Meisje_met_de_parel.jpg",
    thumbnail_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Meisje_met_de_parel.jpg/320px-Meisje_met_de_parel.jpg",
    download_url: "https://upload.wikimedia.org/wikipedia/commons/d/d7/Meisje_met_de_parel.jpg",
  },
  {
    id: "preview-great-wave",
    title_cn: "神奈川冲浪里",
    title_en: "The Great Wave off Kanagawa",
    artist: "Katsushika Hokusai",
    location: "The Metropolitan Museum of Art",
    year_and_place: "c. 1830-1832, Edo",
    medium: "Woodblock print",
    dimensions: "25.7 x 37.8 cm",
    description: "A fallback preview item for local development and design review.",
    tags: ["Ukiyo-e", "Wave", "Print"],
    display_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/The_Great_Wave_off_Kanagawa.jpg/640px-The_Great_Wave_off_Kanagawa.jpg",
    thumbnail_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/The_Great_Wave_off_Kanagawa.jpg/320px-The_Great_Wave_off_Kanagawa.jpg",
    download_url:
      "https://upload.wikimedia.org/wikipedia/commons/0/0a/The_Great_Wave_off_Kanagawa.jpg",
  },
];

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
    iiif_url: artwork.iiif_url,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function isNetworkFailure(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timed out")
  );
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function retryRead<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxReadAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maxReadAttempts || isOffline() || isNetworkFailure(error)) break;
      await delay(retryDelayMs * attempt);
    }
  }
  throw lastError;
}

async function fetchPaintingsPageUncached(
  options: ArtworkPageOptions = {},
): Promise<PaintingsPageResult> {
  const cacheKey = artworkPageCacheKey(options);
  try {
    const page = await retryRead(() => fetchArtworksPage(options));
    const paintings = page.items.map(artworkToPainting);
    void saveArtworkPageCache(cacheKey, {
      items: paintings,
      nextFrom: page.nextFrom,
      hasMore: page.hasMore,
      totalCount: page.totalCount,
    }).catch((error) => {
      console.warn("Artwork page cache write failed", error);
    });
    return {
      paintings,
      nextFrom: page.nextFrom,
      hasMore: page.hasMore,
      totalCount: page.totalCount,
      source: "network",
      offline: false,
    };
  } catch (error) {
    const cached = await readArtworkPageCache<Painting>(cacheKey);
    if (cached) {
      return {
        paintings: cached.items,
        nextFrom: cached.nextFrom,
        hasMore: cached.hasMore,
        totalCount: cached.totalCount ?? null,
        source: "cache",
        cachedAt: cached.updatedAt,
        error: errorMessage(error),
        offline: isOffline(),
      };
    }

    if (hasSupabaseConfig && (!import.meta.env.DEV || !isNetworkFailure(error))) throw error;
    console.warn("Using local preview paintings because Supabase artworks are unavailable.", error);
    return {
      paintings: previewPaintings,
      nextFrom: null,
      hasMore: false,
      totalCount: previewPaintings.length,
      source: "preview",
      error: errorMessage(error),
      offline: isOffline(),
    };
  }
}

export async function fetchPaintingsPage(
  options: ArtworkPageOptions = {},
): Promise<PaintingsPageResult> {
  const cacheKey = artworkPageCacheKey(options);
  const pending = pageRequests.get(cacheKey);
  if (pending) return pending;

  const request = fetchPaintingsPageUncached(options).finally(() => {
    pageRequests.delete(cacheKey);
  });
  pageRequests.set(cacheKey, request);
  return request;
}

export async function fetchPaintingById(id: string): Promise<Painting | null> {
  const itemId = String(id || "").trim();
  if (!itemId) return null;

  const pending = detailRequests.get(itemId);
  if (pending) return pending;

  const request = (async () => {
    try {
      const artwork = await retryRead(() => fetchArtworkById(itemId));
      const painting = artwork ? artworkToPainting(artwork) : null;
      if (painting) {
        void saveArtworkDetailCache(itemId, painting).catch((error) => {
          console.warn("Artwork detail cache write failed", error);
        });
      }
      return painting;
    } catch (error) {
      const cached = await readArtworkDetailCache<Painting>(itemId);
      if (cached) return cached.item;
      throw error;
    }
  })().finally(() => {
    detailRequests.delete(itemId);
  });

  detailRequests.set(itemId, request);
  return request;
}

export async function fetchPaintings(): Promise<Painting[]> {
  const page = await fetchPaintingsPage();
  return page.paintings;
}
