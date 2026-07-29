import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCommonsCandidate,
  buildManualSearchRecord,
  buildProjectCandidate,
  selectCandidates,
  wikidataP18FileNames,
} from "./portrait-candidate-lib.mjs";
import {
  fetchCommonsPages,
  fetchWikidataEntities,
  parseArgs as parseFetchArgs,
} from "./fetch-portrait-candidates.mjs";
import { buildContactSheet, buildReviewArtifacts } from "./build-portrait-review-sheet.mjs";
import { auditCandidates } from "./audit-portrait-candidates.mjs";
import { buildSupplementalCandidate } from "./build-portrait-pilot.mjs";
import {
  auditReview,
  buildCandidateDispositions,
  mergeReviewRecords,
} from "./finalize-portrait-pilot.mjs";

const artist = {
  artist_id: "artist-one",
  name_zh: "画家一",
  name_en: "Artist One",
  birth_year: 1850,
  death_year: 1910,
  target_priority: "P0",
  wikidata_qid: "Q123",
  aliases: ["A. One"],
  sources: [
    {
      title: "Museum artist page",
      publisher: "Museum",
      url: "https://museum.example.test/artists/one",
    },
  ],
};

const entity = {
  id: "Q123",
  claims: {
    P18: [
      {
        rank: "normal",
        mainsnak: { datavalue: { value: "Artist One portrait.jpg" } },
      },
    ],
  },
};

const commonsPage = {
  title: "File:Artist One portrait.jpg",
  imageinfo: [
    {
      url: "https://upload.wikimedia.org/artist-one.jpg",
      thumburl: "https://upload.wikimedia.org/artist-one-640px.jpg",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Artist_One_portrait.jpg",
      width: 1600,
      height: 2000,
      size: 500000,
      mime: "image/jpeg",
      sha1: "abc123",
      extmetadata: {
        Artist: { value: "Photographer" },
        Attribution: { value: "Photographer / Wikimedia Commons" },
        LicenseShortName: { value: "CC BY-SA 4.0" },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
        Copyrighted: { value: "True" },
      },
    },
  ],
};

test("project candidates preserve stable IDs and reject unknown authorization", () => {
  const candidate = buildProjectCandidate(
    {
      candidate_id: "artist-one--artwork-one",
      artist_id: "artist-one",
      artwork_id: "artwork-one",
      candidate_confidence: "high",
      source_url: "https://cdn.example.test/artwork-one.jpg",
      image_url: "https://cdn.example.test/artwork-one.jpg",
      rights_status: "unreviewed",
      relationship_evidence: {
        primary_artist_id: "artist-one",
        artist_ids: ["artist-one"],
        link_ids: ["link-one"],
      },
    },
    artist,
    {
      width: 1200,
      height: 1500,
      mime: "image/jpeg",
    },
  );
  assert.equal(candidate.artwork_id, "artwork-one");
  assert.equal(candidate.identity_evidence.artist_id, "artist-one");
  assert.equal(candidate.automated_assessment.status, "auto_rejected");
  assert.ok(candidate.automated_assessment.rejection_reasons.includes("authorization_unknown"));
  assert.ok(
    candidate.automated_assessment.rejection_reasons.includes("source_description_page_missing"),
  );
});

test("Commons P18 metadata becomes reviewable but never automatically approved", () => {
  assert.deepEqual(wikidataP18FileNames(entity), ["Artist One portrait.jpg"]);
  const candidate = buildCommonsCandidate({
    artist,
    entity,
    fileName: "Artist One portrait.jpg",
    commonsPage,
  });
  assert.equal(candidate.candidate_origin, "wikimedia_commons");
  assert.equal(candidate.automated_assessment.status, "eligible_for_manual_review");
  assert.equal(candidate.review_status, "pending_manual_review");
  assert.equal(candidate.identity_evidence.property, "P18");
  assert.equal(candidate.license_name, "CC BY-SA 4.0");
  assert.equal(candidate.credit, "Photographer / Wikimedia Commons");
});

test("API gaps, small images, and unsupported formats cannot pass", () => {
  const candidate = buildCommonsCandidate({
    artist,
    entity,
    fileName: "Artist One portrait.jpg",
    commonsPage: {
      ...commonsPage,
      imageinfo: [
        {
          ...commonsPage.imageinfo[0],
          width: 200,
          height: 300,
          mime: "image/svg+xml",
        },
      ],
    },
    apiError: "timeout",
  });
  assert.equal(candidate.automated_assessment.eligible_for_manual_review, false);
  assert.ok(candidate.automated_assessment.rejection_reasons.includes("api_metadata_unavailable"));
  assert.ok(candidate.automated_assessment.rejection_reasons.includes("image_too_small"));
  assert.ok(candidate.automated_assessment.rejection_reasons.includes("unsupported_image_format"));
});

test("lightweight avatar quality gate accepts a 256px short edge", () => {
  const candidate = buildCommonsCandidate({
    artist,
    entity,
    fileName: "Artist One portrait.jpg",
    commonsPage: {
      ...commonsPage,
      imageinfo: [
        {
          ...commonsPage.imageinfo[0],
          width: 256,
          height: 360,
        },
      ],
    },
  });
  assert.equal(candidate.automated_assessment.eligible_for_manual_review, true);
  assert.equal(candidate.automated_assessment.checks.dimensions, "pass");
});

test("selection deduplicates files and enforces three candidates per artist", () => {
  const base = buildCommonsCandidate({
    artist,
    entity,
    fileName: "Artist One portrait.jpg",
    commonsPage,
  });
  const candidates = [
    base,
    { ...base, candidate_id: "duplicate" },
    ...[1, 2, 3, 4].map((index) => ({
      ...base,
      candidate_id: `unique-${index}`,
      sha1: `hash-${index}`,
      original_download_url: `https://upload.wikimedia.org/unique-${index}.jpg`,
      rank_score: 200 - index,
    })),
  ];
  const result = selectCandidates(candidates);
  assert.equal(result.selected.length, 3);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.overflow.length, 2);
});

test("manual search records include five queries and directed authority pages", () => {
  const record = buildManualSearchRecord(artist, "wikidata_p18_missing");
  assert.equal(record.queries.length, 5);
  assert.match(record.queries[0], /Artist One 1850-1910/u);
  assert.equal(record.directed_sources.length, 1);
});

test("API readers batch public metadata and reuse their cache", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "portrait-api-cache-"));
  let calls = 0;
  const fetchFn = async (url) => {
    calls += 1;
    const endpoint = new URL(url);
    if (endpoint.hostname === "www.wikidata.org") {
      return {
        ok: true,
        json: async () => ({ entities: { Q123: entity } }),
        headers: new Headers(),
      };
    }
    return {
      ok: true,
      json: async () => ({ query: { pages: [commonsPage] } }),
      headers: new Headers(),
    };
  };
  try {
    const options = {
      cacheDir: root,
      refresh: false,
      offline: false,
      requestDelayMs: 0,
      fetchFn,
    };
    const wikidata = await fetchWikidataEntities(["Q123"], options);
    const commons = await fetchCommonsPages(["Artist One portrait.jpg"], options);
    assert.equal(wikidata.entities.get("Q123").id, "Q123");
    assert.equal(commons.pages.get("Artist One portrait.jpg").title, commonsPage.title);
    assert.equal(calls, 2);
    await fetchWikidataEntities(["Q123"], { ...options, offline: true });
    await fetchCommonsPages(["Artist One portrait.jpg"], { ...options, offline: true });
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("review artifacts keep decision columns blank and escape contact-sheet content", () => {
  const candidate = buildCommonsCandidate({
    artist: { ...artist, name_en: "<Artist One>" },
    entity,
    fileName: "Artist One portrait.jpg",
    commonsPage,
  });
  const artifacts = buildReviewArtifacts([candidate], [buildManualSearchRecord(artist)]);
  assert.match(artifacts.get("portrait-review-sheet.csv"), /reviewer_decision/u);
  assert.match(artifacts.get("portrait-candidate-contact-sheet.html"), /&lt;Artist One&gt;/u);
  assert.doesNotMatch(buildContactSheet([candidate]), /<Artist One>/u);
});

test("candidate audit verifies traceability, deduplication, and no approvals", () => {
  const candidate = buildCommonsCandidate({
    artist,
    entity,
    fileName: "Artist One portrait.jpg",
    commonsPage,
  });
  const passed = auditCandidates([candidate], [buildManualSearchRecord(artist)]);
  assert.equal(passed.status, "passed");
  assert.equal(passed.acceptance.traceability_complete, true);
  assert.equal(passed.acceptance.no_automatic_approvals, true);
  const covered = auditCandidates([candidate], [buildManualSearchRecord(artist)], ["artist-one"]);
  assert.equal(covered.acceptance.every_processed_artist_covered, true);

  const failed = auditCandidates([
    { ...candidate, review_status: "approved" },
    { ...candidate, candidate_id: "duplicate-candidate" },
  ]);
  assert.equal(failed.status, "failed");
  assert.ok(failed.errors.some((item) => item.code === "pipeline_must_not_approve"));
  assert.ok(failed.errors.some((item) => item.code === "duplicate_file"));
  const missing = auditCandidates([], [], ["artist-one"]);
  assert.equal(missing.acceptance.every_processed_artist_covered, false);
});

test("CLI parser keeps external collection read-only and validates numeric options", () => {
  const options = parseFetchArgs([
    "--input-dir",
    "outputs/input",
    "--output-dir",
    "outputs/output",
    "--offline",
    "--limit",
    "10",
  ]);
  assert.equal(options.offline, true);
  assert.equal(options.limit, 10);
  assert.throws(() => parseFetchArgs(["--request-delay-ms", "-1"]), /non-negative integer/u);
});

test("pilot configuration fixes twenty unique records and includes required boundaries", () => {
  const config = JSON.parse(fs.readFileSync(new URL("./pilot-20.json", import.meta.url), "utf8"));
  const decisions = JSON.parse(
    fs.readFileSync(new URL("./pilot-20-decisions.json", import.meta.url), "utf8"),
  );
  assert.equal(config.artists.length, 20);
  assert.equal(new Set(config.artists.map((item) => item.artist_id)).size, 20);
  assert.ok(config.artists.some((item) => item.case === "non_person_entity"));
  assert.ok(config.artists.some((item) => item.case === "targeted_high_resolution_portrait"));
  assert.equal(decisions.review_policy_version, "representative-avatar-v2");
  assert.equal(decisions.decisions.length, 20);
  assert.equal(decisions.decisions.filter((item) => item.final_status === "selected").length, 19);
});

test("targeted Commons supplements retain institution identity evidence", () => {
  const candidate = buildSupplementalCandidate(
    artist,
    {
      file_name: "Artist One portrait.jpg",
      identity_source_url: "https://museum.example.test/object/one",
      identity_note: "Museum identifies the sitter.",
    },
    commonsPage,
  );
  assert.equal(candidate.candidate_reason, "targeted_manual_commons_search");
  assert.equal(candidate.identity_evidence.type, "commons_description_and_institution_record");
  assert.equal(
    candidate.identity_evidence.institution_source_url,
    "https://museum.example.test/object/one",
  );
  assert.equal(candidate.automated_assessment.eligible_for_manual_review, true);
});

test("documented Commons supplements can represent artists without a Wikidata QID", () => {
  const candidate = buildSupplementalCandidate(
    { ...artist, wikidata_qid: "" },
    {
      artist_id: artist.artist_id,
      file_name: "Artist One portrait.jpg",
      identity_source_url: "https://museum.example.test/artist-one",
      identity_note: "Museum record identifies the depicted artist.",
    },
    commonsPage,
  );
  assert.equal(candidate.automated_assessment.eligible_for_manual_review, true);
  assert.equal(candidate.automated_assessment.checks.identity, "pass_representative_association");
  assert.equal(candidate.identity_evidence.type, "commons_description_and_institution_record");
});

test("pilot decisions merge selected rights and keep fallback reasons", () => {
  const candidate = buildCommonsCandidate({
    artist,
    entity,
    fileName: "Artist One portrait.jpg",
    commonsPage,
  });
  const scope = [
    { ...artist, entity_type: "person", cohort: "P0", case: "selected" },
    {
      artist_id: "organization-one",
      name_zh: "机构",
      name_en: "Organization",
      entity_type: "organization",
      identity_status: "verified",
      cohort: "boundary",
      case: "non_person_entity",
    },
  ];
  const decisionFile = {
    decisions: [
      {
        artist_id: "artist-one",
        selected_candidate_id: candidate.candidate_id,
        alternate_candidate_id: "",
        final_status: "selected",
        portrait_kind: "photograph",
        crop_focus_x: 0.5,
        crop_focus_y: 0.35,
        crop_zoom: 1,
        identity_review: "pass",
        content_review: "pass",
        relationship_review: "not_applicable",
        rights_review: "pass",
        quality_review: "pass",
        style_review: "pass",
        identity_evidence_urls: [candidate.source_page_url],
        rejection_reasons: [],
        review_notes: "Selected.",
      },
      {
        artist_id: "organization-one",
        selected_candidate_id: "",
        alternate_candidate_id: "",
        final_status: "non_person_entity",
        portrait_kind: "",
        crop_focus_x: 0.5,
        crop_focus_y: 0.35,
        crop_zoom: 1,
        identity_review: "not_applicable",
        content_review: "not_applicable",
        relationship_review: "not_applicable",
        rights_review: "not_applicable",
        quality_review: "not_applicable",
        style_review: "not_applicable",
        identity_evidence_urls: [],
        rejection_reasons: ["entity_type_organization"],
        review_notes: "Boundary.",
      },
    ],
  };
  const records = mergeReviewRecords(scope, [candidate], decisionFile);
  assert.equal(records[0].portrait_license, "CC BY-SA 4.0");
  assert.equal(records[0].portrait_credit, "Photographer / Wikimedia Commons");
  assert.equal(records[1].final_status, "non_person_entity");
  const dispositions = buildCandidateDispositions([candidate], records);
  assert.equal(dispositions[0].review_decision, "selected");
});

test("pilot audit rejects selected candidates without complete rights evidence", () => {
  const candidate = buildCommonsCandidate({
    artist,
    entity,
    fileName: "Artist One portrait.jpg",
    commonsPage,
  });
  const record = {
    artist_id: "artist-one",
    entity_type: "person",
    final_status: "selected",
    selected_candidate_id: candidate.candidate_id,
    identity_review: "pass",
    content_review: "pass",
    relationship_review: "not_applicable",
    rights_review: "pass",
    quality_review: "pass",
    style_review: "pass",
    crop_focus_x: 0.5,
    crop_focus_y: 0.35,
    crop_zoom: 1,
    portrait_source_url: "",
    portrait_license: "CC BY-SA 4.0",
    portrait_license_url: candidate.license_url,
    portrait_credit: candidate.credit,
    rejection_reasons: [],
    selected_candidate: candidate,
  };
  const report = auditReview([record], [candidate]);
  assert.equal(report.status, "failed");
  assert.ok(report.errors.some((item) => item.code === "rights_evidence_incomplete"));
});

test("pilot audit accepts a clearly associated representative image without strict sitter certainty", () => {
  const candidate = buildCommonsCandidate({
    artist,
    entity,
    fileName: "Artist One portrait.jpg",
    commonsPage,
  });
  const record = {
    artist_id: "artist-one",
    entity_type: "person",
    final_status: "selected",
    selected_candidate_id: candidate.candidate_id,
    representation_review: "pass_canonical_artist_association",
    identity_review: "uncertain_supposed_self_portrait",
    content_review: "pass",
    relationship_review: "not_applicable",
    rights_review: "pass",
    quality_review: "pass",
    style_review: "pass",
    crop_focus_x: 0.5,
    crop_focus_y: 0.35,
    crop_zoom: 1,
    portrait_source_url: candidate.source_page_url,
    portrait_license: "CC BY-SA 4.0",
    portrait_license_url: candidate.license_url,
    portrait_credit: candidate.credit,
    rejection_reasons: [],
    selected_candidate: candidate,
  };
  const report = auditReview([record], [candidate]);
  assert.equal(report.status, "passed");
  assert.equal(report.acceptance.selected_association_verified, true);
});
