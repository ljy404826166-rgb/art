import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  RECOMMENDATION_SIGNAL_VERSION,
  buildRecommendationSignalCatalog,
} from "../../scripts/data-governance/recommendation-signals-v1.mjs";

function loadCatalog() {
  const filename = fileURLToPath(new URL("./recommendation-signal-catalog.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
    },
    { filename },
  );
  return module.exports;
}

test("miniapp recommendation signal catalog matches the governance catalog", () => {
  const miniappCatalog = loadCatalog();
  const governanceCatalog = buildRecommendationSignalCatalog();

  assert.equal(miniappCatalog.RECOMMENDATION_SIGNAL_VERSION, RECOMMENDATION_SIGNAL_VERSION);
  assert.deepEqual(
    JSON.parse(JSON.stringify(miniappCatalog.RECOMMENDATION_SIGNALS)),
    governanceCatalog.map((signal) => ({
      id: signal._id,
      label: signal.label_zh,
    })),
  );
});
