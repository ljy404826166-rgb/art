import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("error state component uses class-only WXSS selectors", () => {
  const template = readFileSync("miniapp/components/error-state/error-state.wxml", "utf8");
  const styles = readFileSync("miniapp/components/error-state/error-state.wxss", "utf8");

  assert.match(template, /class="retry-button"/);
  assert.match(styles, /\.retry-button::after\s*\{/);
  assert.doesNotMatch(styles, /(?:^|[\s,{])button(?:::|[.#[:])/m);
  assert.doesNotMatch(styles, /^\s*#[A-Za-z_-][^{]*\{/m);
  assert.doesNotMatch(styles, /^\s*\[[^\]]+\][^{]*\{/m);
});
