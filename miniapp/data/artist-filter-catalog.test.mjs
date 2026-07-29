import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJs(fileUrl, dependencies = {}) {
  const filename = fileURLToPath(fileUrl);
  const module = { exports: {} };
  vm.runInNewContext(
    readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      require(id) {
        if (dependencies[id]) return dependencies[id];
        throw new Error(`Unexpected dependency: ${id}`);
      },
    },
    { filename },
  );
  return module.exports;
}

const categoryCatalog = loadCommonJs(new URL("./category-catalog.js", import.meta.url));
const artistCatalog = loadCommonJs(new URL("./artist-filter-catalog.js", import.meta.url), {
  "./category-catalog": categoryCatalog,
});

test("artist filters reuse the artwork taxonomy and add a controlled region group", () => {
  assert.deepEqual(
    Array.from(artistCatalog.ARTIST_FILTER_GROUPS, (group) => group.key),
    ["region", "style", "subject"],
  );
  assert.equal(artistCatalog.ARTIST_FILTER_GROUPS[2].name, "作品题材");
  assert.ok(
    artistCatalog.ARTIST_FILTER_CATALOG_VERSION.startsWith(
      categoryCatalog.CATEGORY_CATALOG_VERSION,
    ),
  );
});

test("artist filters omit zero-use taxonomy terms and retain production counts", () => {
  const groups = artistCatalog.ARTIST_FILTER_GROUPS;
  const allTags = groups.flatMap((group) => group.tags);
  assert.ok(allTags.every((tag) => tag.count > 0));
  assert.equal(allTags.find((tag) => tag.id === "style-impressionism").count, 10);
  assert.equal(allTags.find((tag) => tag.id === "style-dutch-golden-age").count, 4);
  assert.equal(allTags.find((tag) => tag.id === "subject-portrait").count, 43);
  assert.equal(allTags.find((tag) => tag.id === "subject-narrative").count, 3);
  assert.equal(allTags.find((tag) => tag.id === "subject-bathers").count, 6);
  assert.equal(allTags.find((tag) => tag.id === "style-venetian-school").count, 1);
  assert.equal(allTags.find((tag) => tag.id === "subject-abstract").count, 5);
  assert.equal(allTags.find((tag) => tag.id === "style-british-romanticism").count, 1);
  assert.equal(allTags.find((tag) => tag.id === "style-hudson-river-school").count, 2);
  assert.equal(
    allTags.some((tag) => tag.id === "period-1890s"),
    false,
  );
});
