import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJsModule(relativeUrl, dependencies = {}) {
  const filename = fileURLToPath(new URL(relativeUrl, import.meta.url));
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      require(id) {
        if (Object.prototype.hasOwnProperty.call(dependencies, id)) {
          return dependencies[id];
        }
        throw new Error(`Unexpected dependency: ${id}`);
      },
    },
    { filename },
  );
  return { exports: module.exports, source };
}

function loadLocalCatalog() {
  return loadCommonJsModule("../data/category-catalog.js").exports;
}

function loadCategoriesService() {
  const localCatalog = loadLocalCatalog();
  return loadCommonJsModule("./categories.js", {
    "../data/category-catalog": localCatalog,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("local classification-v7 catalog contains the fixed 124 production tags", async () => {
  const { exports: service } = loadCategoriesService();
  const result = await service.loadCategoryCatalog();

  assert.equal(result.catalogVersion, "classification-v7");
  assert.equal(result.source, "local");
  assert.equal(result.stale, false);
  assert.deepEqual(
    clone(result.groups.map((group) => [group.key, group.name, group.tags.length])),
    [
      ["style", "流派", 34],
      ["subject", "题材", 42],
      ["decade", "年代", 48],
    ],
  );
  assert.equal(
    result.groups.reduce((total, group) => total + group.tags.length, 0),
    124,
  );
});

test("fixed catalog has canonical unique ids and labels", async () => {
  const { exports: service } = loadCategoriesService();
  const result = await service.loadCategoryCatalog();
  const tags = result.groups.flatMap((group) => group.tags);
  const ids = tags.map((tag) => tag.id);

  assert.equal(new Set(ids).size, 124);
  tags.forEach((tag) => {
    assert.equal(typeof tag.id, "string");
    assert.equal(tag.id, tag.id.trim());
    assert.ok(tag.id.length > 0);
    assert.equal(typeof tag.label, "string");
    assert.equal(tag.label, tag.label.trim());
    assert.ok(tag.label.length > 0);
    assert.equal(Number.isFinite(tag.count), true);
    assert.ok(tag.count > 0);
    assert.deepEqual(Object.keys(clone(tag)).sort(), ["count", "id", "label"]);
  });
});

test("fixed decades remain sorted from earliest to latest", async () => {
  const { exports: service } = loadCategoriesService();
  const result = await service.loadCategoryCatalog();
  const decades = result.groups
    .find((group) => group.key === "decade")
    .tags.map((tag) => Number(tag.label.slice(0, -1)));

  assert.equal(decades[0], 1200);
  assert.equal(decades.at(-1), 1960);
  assert.deepEqual(
    decades,
    decades.slice().sort((left, right) => left - right),
  );
});

test("each catalog load returns an isolated copy", async () => {
  const { exports: service } = loadCategoriesService();
  const first = await service.loadCategoryCatalog();
  first.groups[0].name = "已修改";
  first.groups[0].tags[0].label = "已修改";
  first.groups[0].tags.push({ id: "unexpected", label: "异常" });

  const second = await service.loadCategoryCatalog();

  assert.equal(second.groups[0].name, "流派");
  assert.equal(second.groups[0].tags[0].label, "印象派");
  assert.equal(second.groups[0].tags.length, 34);
});

test("styles and subjects are ordered by artwork count", async () => {
  const { exports: service } = loadCategoriesService();
  const result = await service.loadCategoryCatalog();

  for (const key of ["style", "subject"]) {
    const counts = result.groups.find((group) => group.key === key).tags.map((tag) => tag.count);
    assert.deepEqual(
      counts,
      counts.slice().sort((left, right) => right - left),
    );
  }
});

test("category service has no cloud database or storage dependency", () => {
  const { source } = loadCategoriesService();

  assert.doesNotMatch(source, /wx\.cloud|database\(|category_catalog_state|category_catalog/);
  assert.doesNotMatch(source, /getStorageSync|setStorageSync|CACHE_KEY/);
  assert.match(source, /source:\s*"local"/);
});
