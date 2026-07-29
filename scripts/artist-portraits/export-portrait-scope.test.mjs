import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildExistingArtworkCandidates,
  buildPortraitQueue,
  buildScopeArtifacts,
  isProductionVisibleArtist,
  parseArgs,
  writeScopeArtifacts,
} from "./export-portrait-scope.mjs";

const artists = [
  {
    _id: "verified-painter",
    name_zh: "已核验画家",
    name_en: "Verified Painter",
    aliases: ["V. Painter"],
    birth_year: 1880,
    death_year: 1950,
    entity_type: "person",
    review_status: "reviewed",
    public_visibility: "visible",
    artwork_count: 2,
    representative_artwork_ids: ["artwork-self"],
  },
  {
    _id: "unresolved-painter",
    name_zh: "未解析画家",
    name_en: "Unresolved Painter",
    entity_type: "person",
    review_status: "reviewed",
    public_visibility: "visible",
  },
  {
    _id: "publisher",
    name_zh: "示例出版社",
    name_en: "Example Publisher",
    entity_type: "organization",
    review_status: "reviewed",
    public_visibility: "visible",
  },
  {
    _id: "hidden-candidate",
    name_zh: "隐藏候选",
    name_en: "Hidden Candidate",
    entity_type: "person",
    review_status: "candidate",
    public_visibility: "hidden",
  },
];

const governanceRecords = [
  {
    _id: "verified-painter",
    entity_type: "person",
    identity_status: "verified",
    authority_ids: { wikidata: "Q123" },
    sources: [{ title: "Authority", url: "https://example.test/authority" }],
  },
  {
    _id: "unresolved-painter",
    entity_type: "person",
    identity_status: "unresolved",
  },
  {
    _id: "publisher",
    entity_type: "organization",
    identity_status: "verified",
  },
];

const artworks = [
  {
    _id: "artwork-self",
    title_cn: "自画像",
    title_en: "Self-Portrait",
    primary_artist_id: "verified-painter",
    artist_ids: ["verified-painter"],
    subject_ids: ["subject-self-portrait"],
    status: "published",
    source_name: "Museum",
    source_url: "https://example.test/artwork-self",
    display_url: "https://cdn.example.test/artwork-self.webp",
  },
  {
    _id: "artwork-landscape",
    title_cn: "河畔风景",
    title_en: "River Landscape",
    primary_artist_id: "verified-painter",
    artist_ids: ["verified-painter"],
    status: "published",
    display_url: "https://cdn.example.test/artwork-landscape.webp",
  },
];

const artistLinks = [
  {
    _id: "link-self",
    artwork_id: "artwork-self",
    artist_id: "verified-painter",
    role: "creator",
    matched: true,
    review_status: "reviewed",
  },
  {
    _id: "link-landscape",
    artwork_id: "artwork-landscape",
    artist_id: "verified-painter",
    role: "creator",
    matched: true,
    review_status: "reviewed",
  },
];

test("production visibility follows reviewed and not-hidden records", () => {
  assert.equal(isProductionVisibleArtist(artists[0]), true);
  assert.equal(isProductionVisibleArtist(artists[3]), false);
  assert.equal(
    isProductionVisibleArtist({
      _id: "legacy-reviewed",
      review_status: "reviewed",
    }),
    true,
  );
});

test("portrait queue merges public artist and private governance context", () => {
  const queue = buildPortraitQueue(artists, governanceRecords, artworks, artistLinks);
  assert.equal(queue.length, 3);

  const verified = queue.find((record) => record.artist_id === "verified-painter");
  assert.equal(verified.wikidata_qid, "Q123");
  assert.equal(verified.identity_status, "verified");
  assert.equal(verified.search_eligible, true);
  assert.equal(verified.linked_artwork_count, 2);

  const unresolved = queue.find((record) => record.artist_id === "unresolved-painter");
  assert.equal(unresolved.search_eligible, false);
  assert.equal(unresolved.portrait_final_status, "identity_unresolved");

  const publisher = queue.find((record) => record.artist_id === "publisher");
  assert.equal(publisher.search_eligible, false);
  assert.equal(publisher.portrait_final_status, "non_person_entity");
});

test("existing candidates require a self-portrait signal and stable artist relation", () => {
  const queue = buildPortraitQueue(artists, governanceRecords, artworks, artistLinks);
  const candidates = buildExistingArtworkCandidates(queue, artworks, artistLinks);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].artist_id, "verified-painter");
  assert.equal(candidates[0].artwork_id, "artwork-self");
  assert.equal(candidates[0].candidate_reason, "controlled_subject_self_portrait");
  assert.equal(candidates[0].candidate_confidence, "high");
});

test("scope artifacts cover each visible artist exactly once", () => {
  const artifacts = buildScopeArtifacts({
    envId: "test-env",
    generatedAt: "2026-07-26T00:00:00.000Z",
    artists,
    governanceRecords,
    artworks,
    artistLinks,
    permissions: {
      artists: "READONLY",
      artist_profile_governance: "PRIVATE",
    },
  });
  assert.equal(artifacts.baselineReport.status, "complete");
  assert.equal(artifacts.baselineReport.summary.production_visible_artists, 3);
  assert.equal(artifacts.baselineReport.summary.search_eligible_artists, 1);
  assert.equal(artifacts.baselineReport.summary.existing_artwork_candidates, 1);
  assert.equal(artifacts.baselineReport.acceptance.every_visible_artist_queued_once, true);
  assert.equal(artifacts.baselineReport.pre_existing_findings.unknown_artist_link_documents, 0);
  assert.equal(artifacts.baselineReport.informational.artist_links_outside_visible_scope, 0);
  assert.match(artifacts.queueCsv, /verified-painter/u);
});

test("scope artifacts write valid recoverable JSONL backups and a manifest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artist-portrait-scope-"));
  const output = path.join(root, "run");
  try {
    const input = {
      envId: "test-env",
      generatedAt: "2026-07-26T00:00:00.000Z",
      artists,
      governanceRecords,
      artworks,
      artistLinks,
      permissions: {},
    };
    const artifacts = buildScopeArtifacts(input);
    const result = writeScopeArtifacts(output, input, artifacts);
    assert.equal(result.baseline_report.backup_validation.artists.valid_jsonl, true);
    assert.equal(result.baseline_report.backup_validation.artists.counts_match, true);
    assert.equal(result.baseline_report.backup_validation.artists.ids_unique, true);
    assert.equal(fs.existsSync(path.join(output, "manifest.json")), true);
    assert.equal(fs.existsSync(path.join(output, "artist-portrait-queue.csv")), true);
    assert.equal(fs.existsSync(path.join(output, "existing-artwork-candidates.jsonl")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("argument parser keeps the exporter read-only and validates run ids", () => {
  const options = parseArgs(
    ["--env-id", "test-env", "--output-root", "outputs/custom", "--run-id", "scope-001"],
    {},
  );
  assert.equal(options.envId, "test-env");
  assert.equal(options.runId, "scope-001");
  assert.match(options.outputRoot, /outputs[\\/]custom$/u);
  assert.throws(() => parseArgs(["--run-id", "../escape"], {}), /run-id may contain only/u);
});
