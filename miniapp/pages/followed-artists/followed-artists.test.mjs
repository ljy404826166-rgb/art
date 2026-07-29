import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("followed artists page uses the shared portrait with legacy-safe artist data", () => {
  const template = readFileSync(new URL("./followed-artists.wxml", import.meta.url), "utf8");
  const config = JSON.parse(
    readFileSync(new URL("./followed-artists.json", import.meta.url), "utf8"),
  );

  assert.match(
    template,
    /<artist-portrait artist="\{\{item\}\}" size="followed" lazy-load="\{\{true\}\}" \/>/u,
  );
  assert.doesNotMatch(template, /class="artist-avatar"/u);
  assert.equal(
    config.usingComponents["artist-portrait"],
    "/components/artist-portrait/artist-portrait",
  );
});
