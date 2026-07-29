import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadComponentDefinition() {
  let definition;
  const nextTicks = [];
  const geometry = {
    VIEWPORT_WIDTH_RPX: 750,
    estimateRowMoverWidth(items, measuredWidths = {}, options = {}) {
      const itemWidth = (items || []).reduce(
        (total, item) => total + Number(measuredWidths[item.id] || item.width || 300),
        0,
      );
      return Math.max(750, 92 + itemWidth + (options.loadingMore ? 164 : 0));
    },
    getRowArtworkKey(item, index) {
      return item && (item.id || `index:${index}`);
    },
  };
  const sandbox = {
    Component(value) {
      definition = value;
    },
    require() {
      return geometry;
    },
    setTimeout,
    wx: {
      getWindowInfo() {
        return { windowWidth: 375 };
      },
      nextTick(callback) {
        nextTicks.push(callback);
      },
    },
  };

  vm.runInNewContext(
    readFileSync("miniapp/components/horizontal-artwork-row/horizontal-artwork-row.js", "utf8"),
    sandbox,
    { filename: "horizontal-artwork-row.js" },
  );

  return {
    definition,
    flushNextTick() {
      const callback = nextTicks.shift();
      if (callback) callback();
    },
    pendingNextTicks() {
      return nextTicks.length;
    },
  };
}

function createInstance(definition, properties = {}) {
  const setDataCalls = [];
  const instance = {
    data: { ...definition.data },
    properties: {
      items: [],
      sectionIndex: 0,
      loadingMore: false,
      ...properties,
    },
    setData(patch) {
      setDataCalls.push(patch);
      Object.assign(this.data, patch);
    },
    triggerEvent() {},
  };

  Object.entries(definition.methods).forEach(([name, method]) => {
    instance[name] = method.bind(instance);
  });
  definition.lifetimes.attached.call(instance);
  return { instance, setDataCalls };
}

test("row coalesces observer and card measurement updates into one render", () => {
  const runtime = loadComponentDefinition();
  const initialItems = [
    { id: "a", width: 400 },
    { id: "b", width: 400 },
  ];
  const { instance, setDataCalls } = createInstance(runtime.definition, {
    items: initialItems,
  });

  assert.equal(runtime.pendingNextTicks(), 1);
  runtime.flushNextTick();
  assert.equal(setDataCalls.length, 1);

  const nextItems = initialItems.concat({ id: "c", width: 300 });
  instance.properties.items = nextItems;
  runtime.definition.properties.items.observer.call(instance, nextItems);
  instance.properties.loadingMore = true;
  runtime.definition.properties.loadingMore.observer.call(instance, true);
  instance.handleCardLayoutChange({
    detail: { id: "a", cardWidth: 320 },
    currentTarget: { dataset: { index: 0 } },
  });

  assert.equal(runtime.pendingNextTicks(), 1);
  assert.equal(setDataCalls.length, 1);
  runtime.flushNextTick();
  assert.equal(setDataCalls.length, 2);
});

test("row skips setData when the calculated render data did not change", () => {
  const runtime = loadComponentDefinition();
  const items = [
    { id: "a", width: 400 },
    { id: "b", width: 400 },
  ];
  const { instance, setDataCalls } = createInstance(runtime.definition, { items });

  runtime.flushNextTick();
  assert.equal(setDataCalls.length, 1);

  instance.scheduleMoverWidthUpdate(items);
  runtime.flushNextTick();
  assert.equal(setDataCalls.length, 1);
});

test("row resets its x position in the deferred consolidated update", () => {
  const runtime = loadComponentDefinition();
  const initialItems = [
    { id: "a", width: 400 },
    { id: "b", width: 400 },
  ];
  const { instance, setDataCalls } = createInstance(runtime.definition, {
    items: initialItems,
  });
  runtime.flushNextTick();

  instance.currentX = -120;
  instance.data.x = -120;
  const replacementItems = [{ id: "z", width: 300 }];
  instance.properties.items = replacementItems;
  runtime.definition.properties.items.observer.call(instance, replacementItems);

  assert.equal(instance.currentX, 0);
  assert.equal(instance.data.x, -120);
  runtime.flushNextTick();
  assert.equal(instance.data.x, 0);
  assert.equal(setDataCalls.length, 2);
});
