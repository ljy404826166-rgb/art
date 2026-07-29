import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJs(relativeUrl, dependencies = {}) {
  const filename = fileURLToPath(new URL(relativeUrl, import.meta.url));
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      require(id) {
        if (Object.prototype.hasOwnProperty.call(dependencies, id)) return dependencies[id];
        throw new Error(`Unexpected dependency: ${id}`);
      },
    },
    { filename },
  );
  return module.exports;
}

const catalog = loadCommonJs("../../data/category-catalog.js");
const recommendationCatalog = loadCommonJs("../../data/recommendation-signal-catalog.js");
const service = loadCommonJs("./home-sections.js", {
  "../../data/category-catalog": catalog,
  "../../data/recommendation-signal-catalog": recommendationCatalog,
});

test("home section resolver prefers canonical artist ids over matching labels", () => {
  const query = service.resolveHomeSectionQuery("列奥纳多·达·芬奇", [
    {
      artist: "列奥纳多·达·芬奇（Leonardo da Vinci, 1452-1519）",
      artist_ids: ["leonardo-da-vinci"],
      artist_labels: ["列奥纳多·达·芬奇", "Leonardo da Vinci"],
    },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(query)), {
    type: "artist",
    id: "leonardo-da-vinci",
    label: "列奥纳多·达·芬奇",
  });
});

test("home section resolver maps fixed labels to classification ids", () => {
  const query = service.resolveHomeSectionQuery("表现主义", []);

  assert.deepEqual(JSON.parse(JSON.stringify(query)), {
    type: "classification",
    id: "style-expressionism",
    label: "表现主义",
  });
});

test("home section resolver maps newly accepted classification-v3 labels", () => {
  const query = service.resolveHomeSectionQuery("商业美术", []);

  assert.deepEqual(JSON.parse(JSON.stringify(query)), {
    type: "classification",
    id: "style-commercial-art",
    label: "商业美术",
  });
});

test("home section resolver maps broad home labels to recommendation signals", () => {
  const query = service.resolveHomeSectionQuery("自然", []);

  assert.deepEqual(JSON.parse(JSON.stringify(query)), {
    type: "signal",
    id: "signal-setting-nature",
    label: "自然",
  });
});
