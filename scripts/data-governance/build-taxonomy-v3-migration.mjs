#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeTaxonomy, buildMigrationPlan, buildPilot } from "./taxonomy-v3.mjs";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "outputs", "taxonomy-v5", "migration");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function env() {
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local"), ...process.env };
}

function createClient(envId, config) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("Missing Tencent Cloud credentials.");
  return CloudBase.init({ envId, secretId, secretKey });
}

function normalizeExtendedJson(value) {
  if (Array.isArray(value)) return value.map(normalizeExtendedJson);
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$numberInt") return Number(value.$numberInt);
  if (keys.length === 1 && keys[0] === "$numberLong") return Number(value.$numberLong);
  if (keys.length === 1 && keys[0] === "$numberDouble") return Number(value.$numberDouble);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeExtendedJson(child)]),
  );
}

function parseCommandRows(data) {
  const outer = JSON.parse(data || "[]");
  return outer.map((row) => normalizeExtendedJson(JSON.parse(row)));
}

async function queryCollection(database, collection, projection) {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    const result = await database.runCommands({
      MgoCommands: [
        {
          TableName: collection,
          CommandType: "QUERY",
          Command: JSON.stringify({
            find: collection,
            filter: {},
            projection,
            skip,
            limit: pageSize,
          }),
        },
      ],
    });
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function writeJsonLines(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export async function main() {
  const envId = process.env.CLOUDBASE_ENV_ID || "cloudbase-d6gvny27ib05e0ede";
  const app = createClient(envId, env());
  const [artworks, artists, existingVocabTerms, existingTagLinks, existingArtistLinks] =
    await Promise.all([
      queryCollection(app.database, "artworks", {
        _id: 1,
        title: 1,
        title_cn: 1,
        title_zh: 1,
        title_en: 1,
        artist: 1,
        artist_display: 1,
        raw_artist_text: 1,
        artist_labels: 1,
        artist_id: 1,
        artist_ids: 1,
        primary_artist_id: 1,
        classification_version: 1,
        classification_ids: 1,
        tag_ids: 1,
        tag_keys: 1,
        tags: 1,
        tag_labels: 1,
        tags_text: 1,
        subject: 1,
        genre: 1,
        style: 1,
        year: 1,
        creation_year: 1,
        created_year: 1,
        creation_date: 1,
        date: 1,
        period: 1,
        year_and_place: 1,
      }),
      queryCollection(app.database, "artists", {
        _id: 1,
        id: 1,
        name_zh: 1,
        nameZh: 1,
        name_en: 1,
        nameEn: 1,
        aliases: 1,
        classification_version: 1,
        region_id: 1,
        style_ids: 1,
        subject_ids: 1,
        decade_ids: 1,
        classified_artwork_count: 1,
        entity_type: 1,
        attribution_qualifier: 1,
      }),
      queryCollection(app.database, "vocab_terms", {}),
      queryCollection(app.database, "artwork_tag_links", {}),
      queryCollection(app.database, "artwork_artist_links", {}),
    ]);
  const artistLabels = artists.flatMap((artist) => [
    artist.name_zh,
    artist.nameZh,
    artist.name_en,
    artist.nameEn,
    ...(Array.isArray(artist.aliases) ? artist.aliases : []),
  ]);
  const analysis = analyzeTaxonomy(artworks, { artistLabels });
  const plan = buildMigrationPlan(artworks, artists, analysis);
  const pilot = buildPilot(artworks, artists, analysis, 100);
  const pilotIds = new Set(pilot.rows.map((row) => row.artwork_id));
  const pilotAssignments = plan.artwork_assignments.filter((assignment) =>
    pilotIds.has(assignment._id),
  );
  const pilotArtistIds = new Set(pilotAssignments.flatMap((assignment) => assignment.artist_ids));
  const pilotArtistAssignments = plan.artist_assignments.filter((assignment) =>
    pilotArtistIds.has(assignment._id),
  );
  const vocabTerms = plan.accepted_terms.map((term) => ({
    _id: term.id,
    type: term.dimension === "decade" ? "period" : term.dimension,
    label_zh: term.label,
    aliases: (term.aliases || []).map((alias) => alias.label || alias).filter(Boolean),
    review_status: "reviewed",
    classification_version: plan.version,
    artwork_count: term.count,
  }));
  const termById = new Map(vocabTerms.map((term) => [term._id, term]));
  const artistById = new Map(artists.map((artist) => [String(artist._id || artist.id), artist]));
  const tagLinks = plan.artwork_assignments.flatMap((assignment) =>
    assignment.classification_ids.map((tagId) => {
      const term = termById.get(tagId);
      return {
        _id: `${assignment._id}--${tagId}`,
        artwork_id: assignment._id,
        tag_id: tagId,
        tag_label: term.label_zh,
        tag_type: term.type,
        confidence: 1,
        match_source: plan.version,
        source_field: "classification_ids",
        source_text: term.label_zh,
        source_tag_text: term.label_zh,
        review_status: "reviewed",
        classification_version: plan.version,
      };
    }),
  );
  const artistLinks = plan.artwork_assignments.flatMap((assignment) =>
    assignment.artist_ids.map((artistId) => {
      const artist = artistById.get(String(artistId));
      const role =
        artist?.entity_type === "workshop"
          ? "workshop"
          : artist?.attribution_qualifier === "after"
            ? "after"
            : "creator";
      return {
        _id: `${assignment._id}--${role}--${artistId}`,
        artwork_id: assignment._id,
        artist_id: artistId,
        role,
        confidence: 1,
        match_source: plan.version,
        matched: true,
        source_field: "artist_ids",
        review_status: "reviewed",
        classification_version: plan.version,
      };
    }),
  );
  const tagLinkIds = new Set(tagLinks.map((link) => link._id));
  const artistLinkIds = new Set(artistLinks.map((link) => link._id));
  const staleTagLinkIds = existingTagLinks
    .map((link) => link._id)
    .filter((id) => !tagLinkIds.has(id));
  const staleArtistLinkIds = existingArtistLinks
    .map((link) => link._id)
    .filter((id) => !artistLinkIds.has(id));

  const generatedAt = new Date().toISOString();
  const report = {
    generated_at: generatedAt,
    dry_run: true,
    env_id: envId,
    version: plan.version,
    checks: plan.checks,
    auxiliary_collections: {
      vocab_terms_before: existingVocabTerms.length,
      vocab_terms_after: vocabTerms.length,
      artwork_tag_links_before: existingTagLinks.length,
      artwork_tag_links_after: tagLinks.length,
      artwork_tag_links_stale: staleTagLinkIds.length,
      artwork_artist_links_before: existingArtistLinks.length,
      artwork_artist_links_after: artistLinks.length,
      artwork_artist_links_stale: staleArtistLinkIds.length,
      duplicate_tag_link_ids: tagLinks.length - tagLinkIds.size,
      duplicate_artist_link_ids: artistLinks.length - artistLinkIds.size,
    },
    unresolved_known_artists: plan.unresolved_known_artists,
    pilot: {
      artworks: pilotAssignments.length,
      artists: pilotArtistAssignments.length,
      artwork_ids: pilotAssignments.map((row) => row._id),
    },
  };

  fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
  const suffix = timestamp();
  const prefix = plan.version;
  const catalogPath = path.join(DEFAULT_OUTPUT_DIR, `${prefix}-catalog-${suffix}.json`);
  const artworksPath = path.join(DEFAULT_OUTPUT_DIR, `${prefix}-artworks-${suffix}.jsonl`);
  const artistsPath = path.join(DEFAULT_OUTPUT_DIR, `${prefix}-artists-${suffix}.jsonl`);
  const pilotPath = path.join(DEFAULT_OUTPUT_DIR, `${prefix}-pilot-artworks-${suffix}.jsonl`);
  const pilotArtistsPath = path.join(DEFAULT_OUTPUT_DIR, `${prefix}-pilot-artists-${suffix}.jsonl`);
  const rollbackPath = path.join(DEFAULT_OUTPUT_DIR, `${prefix}-rollback-artworks-${suffix}.jsonl`);
  const rollbackArtistsPath = path.join(
    DEFAULT_OUTPUT_DIR,
    `${prefix}-rollback-artists-${suffix}.jsonl`,
  );
  const vocabPath = path.join(DEFAULT_OUTPUT_DIR, `${prefix}-vocab-terms-${suffix}.jsonl`);
  const tagLinksPath = path.join(DEFAULT_OUTPUT_DIR, `${prefix}-artwork-tag-links-${suffix}.jsonl`);
  const artistLinksPath = path.join(
    DEFAULT_OUTPUT_DIR,
    `${prefix}-artwork-artist-links-${suffix}.jsonl`,
  );
  const staleLinksPath = path.join(DEFAULT_OUTPUT_DIR, `${prefix}-stale-links-${suffix}.json`);
  const rollbackVocabPath = path.join(
    DEFAULT_OUTPUT_DIR,
    `${prefix}-rollback-vocab-terms-${suffix}.jsonl`,
  );
  const rollbackTagLinksPath = path.join(
    DEFAULT_OUTPUT_DIR,
    `${prefix}-rollback-artwork-tag-links-${suffix}.jsonl`,
  );
  const rollbackArtistLinksPath = path.join(
    DEFAULT_OUTPUT_DIR,
    `${prefix}-rollback-artwork-artist-links-${suffix}.jsonl`,
  );
  const reportPath = path.join(DEFAULT_OUTPUT_DIR, `${prefix}-migration-report-${suffix}.json`);

  fs.writeFileSync(
    catalogPath,
    `${JSON.stringify(
      {
        version: plan.version,
        generated_at: generatedAt,
        terms: plan.accepted_terms,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeJsonLines(artworksPath, plan.artwork_assignments);
  writeJsonLines(artistsPath, plan.artist_assignments);
  writeJsonLines(pilotPath, pilotAssignments);
  writeJsonLines(pilotArtistsPath, pilotArtistAssignments);
  writeJsonLines(
    rollbackPath,
    plan.artwork_assignments.map((row) => ({
      _id: row._id,
      ...row.previous,
    })),
  );
  writeJsonLines(
    rollbackArtistsPath,
    plan.artist_assignments.map((row) => ({
      _id: row._id,
      ...row.previous,
    })),
  );
  writeJsonLines(vocabPath, vocabTerms);
  writeJsonLines(tagLinksPath, tagLinks);
  writeJsonLines(artistLinksPath, artistLinks);
  fs.writeFileSync(
    staleLinksPath,
    `${JSON.stringify(
      {
        artwork_tag_links: staleTagLinkIds,
        artwork_artist_links: staleArtistLinkIds,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeJsonLines(rollbackVocabPath, existingVocabTerms);
  writeJsonLines(rollbackTagLinksPath, existingTagLinks);
  writeJsonLines(rollbackArtistLinksPath, existingArtistLinks);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        report: reportPath,
        catalog: catalogPath,
        artworks: artworksPath,
        artists: artistsPath,
        pilot_artworks: pilotPath,
        pilot_artists: pilotArtistsPath,
        rollback_artworks: rollbackPath,
        rollback_artists: rollbackArtistsPath,
        vocab_terms: vocabPath,
        artwork_tag_links: tagLinksPath,
        artwork_artist_links: artistLinksPath,
        stale_links: staleLinksPath,
        rollback_vocab_terms: rollbackVocabPath,
        rollback_artwork_tag_links: rollbackTagLinksPath,
        rollback_artwork_artist_links: rollbackArtistLinksPath,
        checks: plan.checks,
        auxiliary_collections: report.auxiliary_collections,
        unresolved_known_artists: plan.unresolved_known_artists,
      },
      null,
      2,
    ),
  );

  if (
    plan.checks.duplicate_artwork_ids ||
    plan.checks.unknown_classification_ids.length ||
    plan.checks.artworks_without_classification ||
    !plan.checks.accepted_terms_total ||
    report.auxiliary_collections.duplicate_tag_link_ids ||
    report.auxiliary_collections.duplicate_artist_link_ids
  )
    process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
