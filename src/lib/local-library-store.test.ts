import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  localLibraryDb,
  readFavoriteIdsIndexed,
  saveFavoriteIdsIndexed,
  uniqueIds,
} from "./local-library-store";

describe("local-library-store", () => {
  beforeEach(async () => {
    await localLibraryDb.lists.clear();
  });

  it("deduplicates ids while preserving order", () => {
    expect(uniqueIds(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("persists favorite ids in IndexedDB", async () => {
    await saveFavoriteIdsIndexed(["a", "b", "a"]);

    await expect(readFavoriteIdsIndexed()).resolves.toEqual(["a", "b"]);
  });
});
