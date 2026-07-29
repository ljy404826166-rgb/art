import assert from "node:assert/strict";
import test from "node:test";
import { buildTask7Audit } from "./audit-task7-rollout.mjs";

test("task 7 aggregate audit accepts concluded production coverage", () => {
  const queue = [
    {
      artist_id: "artist-one",
      portrait_final_status: "approved",
      current_portrait_url: "https://cdn.example.test/artist-one.webp",
    },
    {
      artist_id: "artist-two",
      portrait_final_status: "no_eligible_asset",
      current_portrait_url: "",
    },
  ];
  const ledger = [{ artist_id: "artist-two" }];
  const batches = [
    {
      name: "task7-batch-01",
      reviews: [
        {
          artist_id: "artist-two",
          final_status: "no_eligible_asset",
        },
      ],
      selected: 0,
      noEligible: 1,
      nonPerson: 0,
      task4: { status: "passed" },
      task5: null,
      task6: { status: "passed", mode: "production_write" },
      verification: { passed: true, verified_records: 1 },
    },
  ];
  const audit = buildTask7Audit({ queue, ledger, batches });
  assert.equal(audit.status, "passed");
  assert.equal(audit.summary.approved_portraits, 1);
  assert.equal(audit.summary.task7_database_records_verified, 1);
});
