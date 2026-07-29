import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("artwork detail renders controlled classification tags only", () => {
  const template = readFileSync(new URL("./detail.wxml", import.meta.url), "utf8");

  assert.match(template, /artwork\.classificationTags\.length/);
  assert.match(template, /wx:for="\{\{artwork\.classificationTags\}\}"/);
  assert.match(template, /data-tag-id="\{\{item\.id\}\}"/);
  assert.match(template, /bindtap="openClassificationTag"/);
  assert.doesNotMatch(template, /artwork\.tags/);
});

test("artwork detail classification navigation uses an exact typed query", () => {
  const source = readFileSync(new URL("./detail.js", import.meta.url), "utf8");

  assert.match(source, /openClassificationTag\(event\)/);
  assert.match(source, /queryType=classification/);
  assert.match(source, /queryId=\$\{encodeURIComponent\(tagId\)\}/);
  assert.doesNotMatch(source, /openTag\(event\)/);
});

test("artwork detail renders a canonical single-line artist button label", () => {
  const template = readFileSync(new URL("./detail.wxml", import.meta.url), "utf8");
  const source = readFileSync(new URL("./detail.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("./detail.wxss", import.meta.url), "utf8");

  assert.match(template, /\{\{artistButtonText \|\| artwork\.artist\}\}/);
  assert.match(source, /formatArtistButtonText\(result\.artist, artistText\)/);
  assert.match(styles, /\.artist-line\s*\{[^}]*max-width:\s*100%/s);
  assert.match(
    styles,
    /\.artist-line text\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
  );
});
