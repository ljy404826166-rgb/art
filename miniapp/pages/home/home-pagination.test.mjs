import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJsModule(filePath) {
  const filename = filePath instanceof URL ? fileURLToPath(filePath) : filePath;
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports }, { filename });
  return module.exports;
}

const { createPaginatedSection, getFreshArtworkBatch, getArtworkKey } = loadCommonJsModule(
  new URL("./home-pagination.js", import.meta.url),
);

test("createPaginatedSection keeps only the first row batch and initializes pagination state", () => {
  const section = createPaginatedSection(
    {
      key: "tag:portrait",
      tag: "portrait",
      items: Array.from({ length: 10 }, (_, index) => ({ id: `art-${index}` })),
    },
    { rowLimit: 8 },
  );

  assert.equal(section.items.length, 8);
  assert.equal(section.skip, 8);
  assert.equal(section.hasMore, true);
  assert.equal(section.loadingMore, false);
});

test("getFreshArtworkBatch appends only unseen artworks up to the row limit", () => {
  const existing = [{ id: "a" }, { _id: "b" }];
  const incoming = [{ id: "a" }, { id: "c" }, { _id: "d" }, { source_id: "e" }];

  const keys = Array.from(getFreshArtworkBatch(existing, incoming, 2), getArtworkKey);
  assert.deepEqual(keys, ["c", "d"]);
});
