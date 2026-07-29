import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function assertJsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

function createStorageWx() {
  const store = new Map();
  return {
    getStorageSync(key) {
      return store.get(key);
    },
    setStorageSync(key, value) {
      store.set(key, value);
    },
  };
}

function loadCommonJs(filename, context = {}) {
  const module = { exports: {} };
  const source = readFileSync(filename, "utf8");
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      ...context,
    },
    {
      filename,
    },
  );
  return module.exports;
}

function loadLocalLibrary(wxMock, requireModule) {
  return loadCommonJs("miniapp/services/local-library.js", {
    wx: wxMock,
    require: requireModule,
  });
}

test("recordDownloadArtwork stores successful downloads newest first", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  assert.equal(
    library.recordDownloadArtwork({
      _id: "a1",
      titleCn: "Artwork One",
      artist: "Claude Monet",
      thumbnail_url: "thumb.webp",
      display_url: "display.webp",
      download_url: "original.jpg",
    }),
    true,
  );

  const downloads = library.getDownloadArtworks();
  assertJsonEqual(
    downloads.map((item) => item.id),
    ["a1"],
  );
  assert.equal(downloads[0].download_url, "original.jpg");
  assert.equal(downloads[0].status, "completed");
  assert.equal(library.getLibraryStats().downloads, 1);
});

test("recordDownloadArtwork deduplicates by artwork id", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  library.recordDownloadArtwork({ _id: "a1", titleCn: "Old Title", download_url: "old.jpg" });
  library.recordDownloadArtwork({ _id: "a1", titleCn: "New Title", download_url: "new.jpg" });

  const downloads = library.getDownloadArtworks();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].titleCn, "New Title");
  assert.equal(downloads[0].download_url, "new.jpg");
});

test("recordDownloadArtwork only stores explicit download_url", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  library.recordDownloadArtwork({
    _id: "a1",
    titleCn: "Alias Only",
    downloadUrl: "camel-original.jpg",
  });

  assert.equal(library.getDownloadArtworks()[0].download_url, "");
});

test("clearDownloadArtworks clears download records and stats", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  library.recordDownloadArtwork({
    _id: "a1",
    titleCn: "Artwork One",
    download_url: "original.jpg",
  });
  library.clearDownloadArtworks();

  assertJsonEqual(library.getDownloadArtworks(), []);
  assert.equal(library.getLibraryStats().downloads, 0);
});

test("clearing local personal data preserves download records", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  library.saveFavoriteArtwork({ _id: "art-1", titleCn: "睡莲" });
  library.recordHistoryArtwork({ _id: "art-1", titleCn: "睡莲" });
  library.toggleFollowedArtist({ id: "artist-1", nameZh: "莫奈" });
  library.recordDownloadArtwork({
    _id: "art-1",
    titleCn: "睡莲",
    download_url: "original.jpg",
  });

  const stats = library.clearLocalPersonalLibrary();

  assert.equal(stats.favorites, 0);
  assert.equal(stats.followedArtists, 0);
  assert.equal(stats.history, 0);
  assert.equal(stats.downloads, 1);
  assert.equal(library.getDownloadArtworks()[0].id, "art-1");
});

test("followed artist snapshot keeps approved portrait metadata", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  library.toggleFollowedArtist({
    id: "claude-monet",
    nameZh: "克洛德·莫奈",
    nameEn: "Claude Monet",
    avatarText: "莫",
    portraitUrl: "https://cdn.example.test/monet.webp",
    portraitSource: "https://example.test/source",
    portraitLicense: "Public Domain",
    portraitCredit: "Museum",
    portraitKind: "photograph",
    portraitArtworkId: "artwork-monet",
    portraitStatus: "approved",
  });

  const [artist] = library.getFollowedArtists();
  assert.equal(artist.portraitUrl, "https://cdn.example.test/monet.webp");
  assert.equal(artist.portraitSource, "https://example.test/source");
  assert.equal(artist.portraitLicense, "Public Domain");
  assert.equal(artist.portraitCredit, "Museum");
  assert.equal(artist.portraitKind, "photograph");
  assert.equal(artist.portraitArtworkId, "artwork-monet");
  assert.equal(artist.portraitStatus, "approved");
  assert.equal(artist.portraitSnapshotVersion, 1);
});

test("followed artist snapshot never stores an unapproved portrait URL", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  library.toggleFollowedArtist({
    id: "blocked-artist",
    nameZh: "待审核画家",
    avatarText: "待",
    portraitUrl: "https://cdn.example.test/blocked.webp",
    portraitStatus: "rights_blocked",
  });

  const [artist] = library.getFollowedArtists();
  assert.equal(artist.portraitUrl, "");
  assert.equal(artist.portraitStatus, "rights_blocked");
  assert.equal(artist.avatarText, "待");
});

test("legacy followed artist snapshots without portrait fields remain readable", () => {
  const wxMock = createStorageWx();
  wxMock.setStorageSync("artArchive:followedArtistIds", ["legacy-artist"]);
  wxMock.setStorageSync("artArchive:followedArtistItems", [
    {
      id: "legacy-artist",
      nameZh: "旧画家",
      avatarText: "旧",
    },
  ]);
  const library = loadLocalLibrary(wxMock);

  const [artist] = library.getFollowedArtists();
  assert.equal(artist.id, "legacy-artist");
  assert.equal(artist.avatarText, "旧");
  assert.equal(artist.portraitUrl, undefined);
  assert.equal(library.isFollowedArtist("legacy-artist"), true);
});

test("favorite and history operations write idempotent sync metadata", () => {
  const wxMock = createStorageWx();
  const syncState = loadCommonJs("miniapp/services/library-sync-state.js", {
    wx: wxMock,
    Date,
    Math,
  });
  let scheduled = 0;
  const library = loadLocalLibrary(wxMock, (id) => {
    if (id === "./library-sync-state") return syncState;
    if (id === "./user-library-sync") {
      return {
        scheduleLibrarySync() {
          scheduled += 1;
        },
      };
    }
    throw new Error(`Unexpected module: ${id}`);
  });

  library.saveFavoriteArtwork({ _id: "art-1", titleCn: "睡莲" });
  library.recordHistoryArtwork({ _id: "art-1", titleCn: "睡莲" });
  library.recordHistoryArtwork({ _id: "art-1", titleCn: "睡莲" });
  library.removeFavoriteArtwork("art-1");

  const payload = syncState.createSyncPayload({ wxApi: wxMock });
  assert.equal(payload.favorites[0].id, "art-1");
  assert.equal(payload.favorites[0].deleted, true);
  assert.equal(payload.history[0].device_view_count, 2);
  assert.equal(scheduled, 4);
});
