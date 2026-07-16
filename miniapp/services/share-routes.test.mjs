import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJsModule(filename) {
  const module = { exports: {} };
  const source = readFileSync(filename, "utf8");
  vm.runInNewContext(source, { module, exports: module.exports }, { filename });
  return module.exports;
}

const filename = fileURLToPath(new URL("./share-routes.js", import.meta.url));
const {
  buildArtworkShareMessage,
  buildArtistShareMessage,
} = loadCommonJsModule(filename);

test("buildArtworkShareMessage uses a stable encoded artwork id and thumbnail", () => {
  assert.deepEqual({ ...buildArtworkShareMessage({
    _id: "artwork/梵高",
    titleCn: "星月夜",
    artist: "文森特·梵高",
    thumbnail_url: "https://img.example/thumb.webp",
    display_url: "https://img.example/display.webp",
  }) }, {
    title: "星月夜 · 文森特·梵高",
    path: "/pages/detail/detail?id=artwork%2F%E6%A2%B5%E9%AB%98",
    imageUrl: "https://img.example/thumb.webp",
  });
});

test("buildArtistShareMessage uses a stable artist id", () => {
  assert.deepEqual({ ...buildArtistShareMessage({
    id: "claude-monet",
    nameZh: "克洛德·莫奈",
    nameEn: "Claude Monet",
  }) }, {
    title: "克洛德·莫奈（Claude Monet）· Art Archive",
    path: "/pages/artist-detail/artist-detail?id=claude-monet",
  });
});

test("share payloads fall back to the home page without a stable id", () => {
  assert.deepEqual({ ...buildArtworkShareMessage(null) }, {
    title: "Art Archive · 在线画廊",
    path: "/pages/home/home",
  });
  assert.deepEqual({ ...buildArtistShareMessage({ nameZh: "未知画家" }) }, {
    title: "Art Archive · 在线画廊",
    path: "/pages/home/home",
  });
});
