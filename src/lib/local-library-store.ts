import Dexie, { type Table } from "dexie";

type LocalListName = "favorites" | "history";

type LocalListEntry = {
  name: LocalListName;
  ids: string[];
  updatedAt: string;
};

type ArtworkPageCacheEntry<TItem = unknown> = {
  key: string;
  items: TItem[];
  nextFrom: number | null;
  hasMore: boolean;
  totalCount?: number | null;
  updatedAt: string;
};

type ArtworkDetailCacheEntry<TItem = unknown> = {
  id: string;
  item: TItem;
  updatedAt: string;
};

class ArtArchiveLocalDb extends Dexie {
  lists!: Table<LocalListEntry, LocalListName>;
  artworkPages!: Table<ArtworkPageCacheEntry, string>;
  artworkDetails!: Table<ArtworkDetailCacheEntry, string>;

  constructor() {
    super("artArchiveLocal");
    this.version(1).stores({
      lists: "name,updatedAt",
    });
    this.version(2).stores({
      lists: "name,updatedAt",
      artworkPages: "key,updatedAt",
      artworkDetails: "id,updatedAt",
    });
  }
}

export const localLibraryDb = new ArtArchiveLocalDb();

export function uniqueIds(ids: readonly string[], limit = Number.POSITIVE_INFINITY): string[] {
  return [...new Set(ids.filter(Boolean))].slice(0, limit);
}

async function saveList(name: LocalListName, ids: readonly string[]): Promise<void> {
  await localLibraryDb.lists.put({
    name,
    ids: uniqueIds(ids, name === "history" ? 50 : Number.POSITIVE_INFINITY),
    updatedAt: new Date().toISOString(),
  });
}

async function readList(name: LocalListName): Promise<string[]> {
  return (await localLibraryDb.lists.get(name))?.ids ?? [];
}

async function clearList(name: LocalListName): Promise<void> {
  await localLibraryDb.lists.delete(name);
}

export function saveFavoriteIdsIndexed(ids: readonly string[]): Promise<void> {
  return saveList("favorites", ids);
}

export function readFavoriteIdsIndexed(): Promise<string[]> {
  return readList("favorites");
}

export function clearIndexedFavorites(): Promise<void> {
  return clearList("favorites");
}

export function saveHistoryIdsIndexed(ids: readonly string[]): Promise<void> {
  return saveList("history", ids);
}

export function readHistoryIdsIndexed(): Promise<string[]> {
  return readList("history");
}

export function clearIndexedHistory(): Promise<void> {
  return clearList("history");
}

export function artworkPageCacheKey(options: {
  limit?: number;
  from?: number;
  tag?: string;
  artist?: string;
}): string {
  return JSON.stringify({
    limit: options.limit ?? null,
    from: options.from ?? 0,
    tag: options.tag || "",
    artist: options.artist || "",
  });
}

export async function saveArtworkPageCache<TItem>(
  key: string,
  page: {
    items: TItem[];
    nextFrom: number | null;
    hasMore: boolean;
    totalCount?: number | null;
  },
): Promise<void> {
  await localLibraryDb.artworkPages.put({
    key,
    items: page.items,
    nextFrom: page.nextFrom,
    hasMore: page.hasMore,
    totalCount: page.totalCount ?? null,
    updatedAt: new Date().toISOString(),
  });
}

export async function readArtworkPageCache<TItem>(
  key: string,
): Promise<ArtworkPageCacheEntry<TItem> | null> {
  return (
    ((await localLibraryDb.artworkPages.get(key)) as ArtworkPageCacheEntry<TItem> | undefined) ??
    null
  );
}

export async function saveArtworkDetailCache<TItem>(id: string, item: TItem): Promise<void> {
  await localLibraryDb.artworkDetails.put({
    id,
    item,
    updatedAt: new Date().toISOString(),
  });
}

export async function readArtworkDetailCache<TItem>(
  id: string,
): Promise<ArtworkDetailCacheEntry<TItem> | null> {
  return (
    ((await localLibraryDb.artworkDetails.get(id)) as ArtworkDetailCacheEntry<TItem> | undefined) ??
    null
  );
}
