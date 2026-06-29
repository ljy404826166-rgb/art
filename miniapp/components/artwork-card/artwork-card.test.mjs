import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function readLocal(path) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

test("artwork-card truncates title and artist metadata to one line", () => {
  const wxss = readLocal("./artwork-card.wxss");

  const titleRule = wxss.match(/(?:^|\n)\.card-title\s*\{[\s\S]*?\}/);
  const artistRule = wxss.match(/(?:^|\n)\.card-artist\s*\{[\s\S]*?\}/);

  assert.ok(titleRule, "card title rule should exist");
  assert.ok(artistRule, "card artist rule should exist");

  [titleRule[0], artistRule[0]].forEach((rule) => {
    assert.match(rule, /overflow:\s*hidden/);
    assert.match(rule, /white-space:\s*nowrap/);
    assert.match(rule, /text-overflow:\s*ellipsis/);
  });
});

test("artwork-card uses ArtworkImage in card mode for list thumbnails", () => {
  const wxml = readLocal("./artwork-card.wxml");
  const artworkImageJs = readFileSync(
    fileURLToPath(new URL("../artwork-image/artwork-image.js", import.meta.url)),
    "utf8",
  );

  assert.match(wxml, /<artwork-image[\s\S]*usage="card"/);
  assert.match(artworkImageJs, /artwork\.thumbnail_url/);
  assert.doesNotMatch(artworkImageJs, /artwork\.download_url/);
});
