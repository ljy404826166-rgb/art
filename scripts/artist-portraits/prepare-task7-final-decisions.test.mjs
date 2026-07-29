import assert from "node:assert/strict";
import test from "node:test";
import { finalizeBatchDecisions } from "./prepare-task7-final-decisions.mjs";

test("newly recovered eligible candidates replace no-asset fallback", () => {
  const proposed = {
    decisions: [
      {
        artist_id: "artist-one",
        selected_candidate_id: "",
        alternate_candidate_id: "",
        final_status: "no_eligible_asset",
        rejection_reasons: ["none"],
      },
    ],
  };
  const candidates = [
    {
      artist_id: "artist-one",
      candidate_id: "candidate-one",
      candidate_origin: "wikimedia_commons",
      candidate_reason: "targeted_manual_commons_search",
      source_page_url: "https://commons.wikimedia.org/wiki/File:Artist.jpg",
      license_name: "Public domain",
      credit: "",
      rank_score: 345,
      automated_assessment: { eligible_for_manual_review: true },
      identity_evidence: {
        institution_source_url: "https://museum.example.test/artist",
      },
    },
  ];
  const output = finalizeBatchDecisions(proposed, candidates);
  assert.equal(output.decisions[0].final_status, "selected");
  assert.equal(output.decisions[0].selected_candidate_id, "candidate-one");
  assert.equal(output.decisions[0].quality_review, "pass_contact_sheet_and_circle_crop");
  assert.equal(output.decisions[0].credit_override, "Wikimedia Commons contributors");
});

test("artists without eligible candidates keep an explicit fallback", () => {
  const output = finalizeBatchDecisions(
    {
      decisions: [
        {
          artist_id: "artist-two",
          final_status: "no_eligible_asset",
          rejection_reasons: [],
        },
      ],
    },
    [],
  );
  assert.equal(output.decisions[0].final_status, "no_eligible_asset");
  assert.deepEqual(output.decisions[0].rejection_reasons, [
    "no_representative_open_license_candidate_after_task7_search",
  ]);
});
