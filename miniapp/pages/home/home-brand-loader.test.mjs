import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const wxmlUrl = new URL("./home.wxml", import.meta.url);
const wxssUrl = new URL("./home.wxss", import.meta.url);
const gifUrl = new URL("../../assets/brand/masterpiece-loading.gif", import.meta.url);

test("home pagination uses the branded wordmark loader only while loading more", async () => {
  const wxml = await readFile(wxmlUrl, "utf8");

  assert.match(wxml, /wx:if="\{\{loadingMore\}\}" class="home-brand-loader"/);
  assert.match(wxml, /src="\/assets\/brand\/masterpiece-loading\.gif"/);
  assert.doesNotMatch(wxml, /<loading-more wx:if="\{\{loadingMore\}\}" text="继续加载\.\.\." \/>/);
});

test("initial and paged search loading use the branded wordmark animation", async () => {
  const wxml = await readFile(wxmlUrl, "utf8");
  const config = JSON.parse(await readFile(new URL("./home.json", import.meta.url), "utf8"));

  assert.match(
    wxml,
    /wx:if="\{\{searchLoading\}\}"[\s\S]*?class="home-brand-loader search-brand-loader"/,
  );
  assert.match(
    wxml,
    /wx:if="\{\{searchLoadingMore\}\}"[\s\S]*?class="home-brand-loader search-brand-loader search-brand-loader-more"/,
  );
  assert.doesNotMatch(wxml, /正在全库搜索\.\.\.|正在加载更多\.\.\./);
  assert.doesNotMatch(wxml, /<loading-more/);
  assert.equal(config.usingComponents["loading-more"], undefined);
});

test("brand loader keeps a compact, centered footprint", async () => {
  const wxss = await readFile(wxssUrl, "utf8");

  assert.match(wxss, /\.home-page\s*\{[\s\S]*padding: 56rpx 10rpx 92rpx;/);
  assert.match(wxss, /\.home-brand-loader\s*\{[\s\S]*justify-content: center;/);
  assert.match(
    wxss,
    /\.home-brand-loader\s*\{[\s\S]*min-height: 64rpx;[\s\S]*background: #ffffff;/,
  );
  assert.match(wxss, /\.home-brand-loader-image\s*\{[\s\S]*width: 280rpx;[\s\S]*height: 56rpx;/);
});

test("brand loader asset is an optimized 420 by 88 GIF", async () => {
  const gif = await readFile(gifUrl);

  assert.equal(gif.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.equal(gif.readUInt16LE(6), 420);
  assert.equal(gif.readUInt16LE(8), 88);
  assert.ok(gif.byteLength < 160_000);
});
