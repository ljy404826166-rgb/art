import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readPageFile(page, extension) {
  return readFileSync(new URL(`./${page}/${page}.${extension}`, import.meta.url), "utf8");
}

test("search fields reserve a fixed trailing action without native button sizing", () => {
  for (const page of ["home", "artists"]) {
    const template = readPageFile(page, "wxml");
    const styles = readPageFile(page, "wxss");

    assert.doesNotMatch(template, /<button[^>]*class="[^"]*search-action/);
    assert.match(template, /class="[^"]*search-action[^"]*"/);
    assert.match(template, /aria-role="button"/);
    assert.match(styles, /\.search-shell\s*\{[^}]*display:\s*flex;/s);
    assert.match(
      styles,
      /\.search-input\s*\{[^}]*flex:\s*1 1 0%;[^}]*width:\s*0;[^}]*min-width:\s*0;/s,
    );
    assert.match(
      styles,
      /\.search-action\s*\{[^}]*flex:\s*0 0 96rpx;[^}]*width:\s*96rpx;[^}]*max-width:\s*96rpx;/s,
    );
  }
});

test("nickname clear control is anchored to the right-side center", () => {
  const template = readPageFile("profile-edit", "wxml");
  const styles = readPageFile("profile-edit", "wxss");

  assert.doesNotMatch(template, /<button[^>]*class="nickname-clear"/);
  assert.match(template, /class="nickname-clear"/);
  assert.match(
    styles,
    /\.nickname-input\s*\{[^}]*flex:\s*1 1 0%;[^}]*width:\s*0;[^}]*min-width:\s*0;/s,
  );
  assert.match(
    styles,
    /\.nickname-clear\s*\{[^}]*top:\s*50%;[^}]*right:\s*18rpx;[^}]*width:\s*52rpx;[^}]*max-width:\s*52rpx;[^}]*transform:\s*translateY\(-50%\);/s,
  );
});

test("library and filter clear controls cannot stretch on Android", () => {
  for (const page of ["history", "downloads"]) {
    const template = readPageFile(page, "wxml");
    const styles = readPageFile(page, "wxss");

    assert.doesNotMatch(template, /<button[^>]*class="clear-button"/);
    assert.match(template, /class="clear-button"/);
    assert.match(
      styles,
      /\.clear-button\s*\{[^}]*flex:\s*0 0 108rpx;[^}]*width:\s*108rpx;[^}]*max-width:\s*108rpx;[^}]*padding:\s*0;/s,
    );
  }

  const categoryTemplate = readPageFile("category", "wxml");
  const categoryStyles = readPageFile("category", "wxss");
  assert.doesNotMatch(categoryTemplate, /<button[^>]*class="clear-filter-button"/);
  assert.match(
    categoryStyles,
    /\.clear-filter-button\s*\{[^}]*flex:\s*0 0 132rpx;[^}]*width:\s*132rpx;[^}]*max-width:\s*132rpx;[^}]*padding:\s*0;/s,
  );
});
