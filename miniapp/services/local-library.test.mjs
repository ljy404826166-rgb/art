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

function loadLocalLibrary(wxMock) {
  const module = { exports: {} };
  const source = readFileSync("miniapp/services/local-library.js", "utf8");
  vm.runInNewContext(source, { module, exports: module.exports, wx: wxMock }, {
    filename: "miniapp/services/local-library.js",
  });
  return module.exports;
}

test("recordDownloadArtwork stores successful downloads newest first", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  assert.equal(library.recordDownloadArtwork({
    _id: "a1",
    titleCn: "Artwork One",
    artist: "Claude Monet",
    thumbnail_url: "thumb.webp",
    display_url: "display.webp",
    download_url: "original.jpg",
  }), true);

  const downloads = library.getDownloadArtworks();
  assertJsonEqual(downloads.map((item) => item.id), ["a1"]);
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

  library.recordDownloadArtwork({ _id: "a1", titleCn: "Artwork One", download_url: "original.jpg" });
  library.clearDownloadArtworks();

  assertJsonEqual(library.getDownloadArtworks(), []);
  assert.equal(library.getLibraryStats().downloads, 0);
});
