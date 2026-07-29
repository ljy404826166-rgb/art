import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_ENV_ID,
  indexDefinition,
  parseArgs,
  planUpdates,
} from "./deploy-artwork-search.mjs";

test("production writes require the exact environment confirmation", () => {
  assert.throws(() => parseArgs(["--run"]), /requires --confirm-production/);
  assert.deepEqual(parseArgs(["--run", "--confirm-production", PRODUCTION_ENV_ID]), {
    envId: PRODUCTION_ENV_ID,
    run: true,
    confirmation: PRODUCTION_ENV_ID,
    batchSize: 20,
    indexesOnly: false,
  });
});

test("index definitions preserve compound index key order", () => {
  assert.deepEqual(
    indexDefinition({
      name: "search",
      keys: [
        { name: "status", direction: "1" },
        { name: "created_at", direction: "-1" },
        { name: "search_terms", direction: "1" },
      ],
    }),
    {
      IndexName: "search",
      MgoKeySchema: {
        MgoIndexKeys: [
          { Name: "status", Direction: "1" },
          { Name: "created_at", Direction: "-1" },
          { Name: "search_terms", Direction: "1" },
        ],
        MgoIsUnique: false,
      },
    },
  );
});

test("update planning is deterministic and skips current documents", () => {
  const version = "search-terms-v1";
  const row = {
    _id: "artwork_1",
    title_cn: "星月夜",
    artist: "文森特·梵高",
  };
  const first = planUpdates([row], version);
  assert.equal(first.length, 1);
  assert.ok(first[0].search_terms.includes("星月夜"));
  assert.equal(
    planUpdates(
      [
        {
          ...row,
          search_terms: first[0].search_terms,
          search_terms_version: version,
        },
      ],
      version,
    ).length,
    0,
  );
});
