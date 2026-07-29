import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readLocal(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("grid skeleton can remove internal inset inside an already padded page", () => {
  const script = readLocal("./skeleton-card.js");
  const template = readLocal("./skeleton-card.wxml");
  const styles = readLocal("./skeleton-card.wxss");

  assert.match(script, /inset:\s*\{[\s\S]*type: Boolean,[\s\S]*value: true/);
  assert.match(template, /\{\{inset \? '' : 'is-flush'\}\}/);
  assert.match(
    styles,
    /\.skeleton-list\.grid\.is-flush\s*\{[\s\S]*padding-right: 0;[\s\S]*padding-left: 0;/,
  );
});

test("grid skeleton matches the loaded artwork card dimensions", () => {
  const styles = readLocal("./skeleton-card.wxss");

  assert.match(styles, /\.skeleton-list\.grid \.skeleton-card\s*\{[\s\S]*height: 476rpx;/);
  assert.match(styles, /\.skeleton-image\s*\{[\s\S]*height: 340rpx;/);
  assert.match(styles, /\.skeleton-list\.grid \.skeleton-copy\s*\{[\s\S]*height: 136rpx;/);
});
