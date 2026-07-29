import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJsModule(filePath) {
  const filename = filePath instanceof URL ? fileURLToPath(filePath) : filePath;
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  const localRequire = (id) => {
    if (id === "./category-catalog") {
      return {
        CATEGORY_GROUPS: [
          {
            key: "style",
            tags: [
              { id: "style-impressionism", label: "印象派" },
              { id: "style-dutch-golden-age", label: "荷兰黄金时代" },
            ],
          },
          {
            key: "subject",
            tags: [{ id: "subject-portrait", label: "肖像画" }],
          },
          {
            key: "decade",
            tags: [{ id: "period-1660s", label: "1660s" }],
          },
        ],
      };
    }
    throw new Error(`Unexpected dependency: ${id}`);
  };
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      require: localRequire,
    },
    { filename },
  );
  return module.exports;
}

const { buildClassificationTagItems } = loadCommonJsModule(
  new URL("./classification-tags.js", import.meta.url),
);

function loadRealClassificationTags() {
  const catalogFilename = fileURLToPath(new URL("./category-catalog.js", import.meta.url));
  const catalogModule = { exports: {} };
  vm.runInNewContext(
    readFileSync(catalogFilename, "utf8"),
    {
      module: catalogModule,
      exports: catalogModule.exports,
    },
    { filename: catalogFilename },
  );

  const filename = fileURLToPath(new URL("./classification-tags.js", import.meta.url));
  const module = { exports: {} };
  vm.runInNewContext(
    readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      require(id) {
        if (id === "./category-catalog") return catalogModule.exports;
        throw new Error(`Unexpected dependency: ${id}`);
      },
    },
    { filename },
  );
  return module.exports;
}

test("buildClassificationTagItems exposes only controlled ids in catalog order", () => {
  const items = buildClassificationTagItems([
    "subject-portrait",
    "unknown-public-domain",
    "period-1660s",
    "style-dutch-golden-age",
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(items)), [
    {
      id: "style-dutch-golden-age",
      label: "荷兰黄金时代",
      group: "style",
    },
    {
      id: "subject-portrait",
      label: "肖像画",
      group: "subject",
    },
    {
      id: "period-1660s",
      label: "1660s",
      group: "decade",
    },
  ]);
});

test("legacy labels cannot become controlled buttons without ids", () => {
  assert.deepEqual(buildClassificationTagItems(["公共领域", "荷兰艺术", "油彩画"]), []);
});

test("the real production catalog exposes exactly 110 controlled tag items", () => {
  const real = loadRealClassificationTags();
  const items = real.buildClassificationTagItems([
    "style-dutch-golden-age",
    "subject-portrait",
    "period-1660s",
    "公共领域",
  ]);

  assert.equal(real.CLASSIFICATION_TAGS.length, 110);
  assert.deepEqual(JSON.parse(JSON.stringify(items.map((item) => item.id))), [
    "style-dutch-golden-age",
    "subject-portrait",
    "period-1660s",
  ]);
});

test("artwork normalization keeps legacy data but exposes only controlled buttons", () => {
  const classificationTags = loadRealClassificationTags();
  const filename = fileURLToPath(new URL("./fallback-artworks.js", import.meta.url));
  const module = { exports: {} };
  vm.runInNewContext(
    readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      require(id) {
        if (id === "./classification-tags") return classificationTags;
        throw new Error(`Unexpected dependency: ${id}`);
      },
    },
    { filename },
  );

  const artwork = module.exports.normalizeArtwork({
    _id: "artwork-test",
    title_cn: "测试作品",
    tags: ["肖像画", "荷兰黄金时代", "荷兰艺术", "公共领域"],
    tag_keys: ["肖像画", "荷兰黄金时代", "荷兰艺术", "公共领域"],
    classification_ids: ["style-dutch-golden-age", "subject-portrait", "period-1660s"],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(artwork.tags)), [
    "肖像画",
    "荷兰黄金时代",
    "荷兰艺术",
    "公共领域",
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(artwork.classificationTags.map((item) => item.label))),
    ["荷兰黄金时代", "肖像画", "1660s"],
  );
});
