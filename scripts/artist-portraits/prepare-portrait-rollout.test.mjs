import assert from "node:assert/strict";
import test from "node:test";
import { auditRollout, buildRollout, parseArgs } from "./prepare-portrait-rollout.mjs";

function artist(id, overrides = {}) {
  return {
    artist_id: id,
    name_zh: id,
    name_en: id,
    entity_type: "person",
    identity_status: "verified",
    public_visibility: "visible",
    portrait_final_status: "",
    target_priority: "P2",
    artwork_count: 1,
    ...overrides,
  };
}

function candidate(artistId, overrides = {}) {
  return {
    candidate_id: `${artistId}-candidate`,
    artist_id: artistId,
    rank_score: 200,
    review_rank: 1,
    candidate_confidence: "high",
    candidate_origin: "wikimedia_commons",
    source_page_url: `https://commons.example/${artistId}`,
    automated_assessment: {
      eligible_for_manual_review: true,
    },
    ...overrides,
  };
}

test("rollout excludes approved artists and orders eligible people before unresolved rows", () => {
  const scope = [
    artist("approved", { portrait_final_status: "approved" }),
    artist("no-candidate"),
    artist("with-candidate", { artwork_count: 10 }),
    artist("publisher", { entity_type: "organization" }),
  ];
  const rollout = buildRollout(scope, [candidate("with-candidate")], 2);
  assert.deepEqual(
    rollout.ledger.map((row) => row.artist_id),
    ["with-candidate", "no-candidate", "publisher"],
  );
  assert.deepEqual(
    rollout.ledger.map((row) => row.proposed_final_status),
    ["selected", "no_eligible_asset", "non_person_entity"],
  );
  assert.deepEqual(
    rollout.batches.map((batch) => batch.artists.length),
    [2, 1],
  );
});

test("rollout chooses the highest ranked eligible candidate", () => {
  const scope = [artist("one")];
  const rollout = buildRollout(scope, [
    candidate("one", { candidate_id: "lower", rank_score: 100 }),
    candidate("one", {
      candidate_id: "blocked",
      rank_score: 999,
      automated_assessment: {
        eligible_for_manual_review: false,
      },
    }),
    candidate("one", { candidate_id: "higher", rank_score: 300 }),
  ]);
  assert.equal(rollout.ledger[0].selected_candidate_id, "higher");
  assert.equal(rollout.batches[0].decisions[0].alternate_candidate_id, "lower");
});

test("rollout audit accounts for every visible artist exactly once", () => {
  const scope = [
    artist("approved", { portrait_final_status: "approved" }),
    artist("selected"),
    artist("fallback"),
  ];
  const candidates = [candidate("selected")];
  const rollout = buildRollout(scope, candidates);
  const audit = auditRollout(scope, candidates, rollout);
  assert.equal(audit.status, "passed");
  assert.equal(audit.summary.production_visible_artists, 3);
  assert.equal(audit.summary.remaining_covered, 2);
  assert.equal(audit.acceptance.all_visible_artists_accounted_for, true);
});

test("batch size must remain bounded", () => {
  assert.equal(parseArgs(["--batch-size", "20"]).batchSize, 20);
  assert.throws(() => parseArgs(["--batch-size", "0"]), /between 1 and 50/u);
  assert.throws(() => parseArgs(["--batch-size", "51"]), /between 1 and 50/u);
});
