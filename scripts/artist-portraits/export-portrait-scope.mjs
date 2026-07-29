#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CloudBase from "@cloudbase/manager-node";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_OUTPUT_ROOT = path.resolve("outputs", "artist-portraits");
const PAGE_SIZE = 1000;
const COLLECTIONS = {
  artists: "artists",
  governance: "artist_profile_governance",
  artworks: "artworks",
  artistLinks: "artwork_artist_links",
};
const SELF_PORTRAIT_SUBJECT_IDS = new Set(["subject-self-portrait"]);
const SELF_PORTRAIT_PATTERNS = [
  /\bself[\s-]?portrait\b/iu,
  /\bautoportrait\b/iu,
  /\bselbstbildnis\b/iu,
  /\bautoritratto\b/iu,
  /\bzelfportret\b/iu,
  /\bsjälvporträtt\b/iu,
  /\bselvportræt\b/iu,
  /\bomakuva\b/iu,
  /\bauto[\s-]?retrato\b/iu,
  /\bautorretrato\b/iu,
  /\bавтопортрет\b/iu,
  /自画像|自畫像|自画象/iu,
];
const CREATOR_ROLES = new Set(["creator", "attributed_to"]);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        )
          value = value.slice(1, -1);
        return [key, value];
      }),
  );
}

function env() {
  return {
    ...parseEnvFile(".env"),
    ...parseEnvFile(".env.local"),
    ...process.env,
  };
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function timestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

export function parseArgs(argv = [], config = process.env) {
  const options = {
    envId: config.CLOUDBASE_ENV_ID || config.TCB_ENV_ID || DEFAULT_ENV_ID,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    runId: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--output-root") {
      options.outputRoot = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--run-id") {
      options.runId = required(argv, (index += 1), arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(options.runId || "auto")) {
    throw new Error("--run-id may contain only letters, numbers, dot, underscore, and hyphen.");
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/artist-portraits/export-portrait-scope.mjs
  node scripts/artist-portraits/export-portrait-scope.mjs \\
    --env-id ${DEFAULT_ENV_ID} \\
    --output-root outputs/artist-portraits

This command is read-only. It queries production collections and writes local audit artifacts.
`;
}

function createClient(envId, config) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error("Missing Tencent Cloud credentials.");
  }
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
  return JSON.parse(data || "[]").map((row) => normalizeExtendedJson(JSON.parse(row)));
}

async function withRetry(operation, label, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError.message}`);
}

export async function queryCollection(database, collection, projection = {}) {
  const rows = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const result = await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "QUERY",
              Command: JSON.stringify({
                find: collection,
                filter: {},
                projection,
                skip,
                limit: PAGE_SIZE,
              }),
            },
          ],
        }),
      `query ${collection}`,
    );
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  return String(value || "").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function recordId(record) {
  return stringValue(record && record._id);
}

function duplicateIds(records) {
  const seen = new Set();
  const duplicates = new Set();
  for (const record of records) {
    const id = recordId(record);
    if (!id || seen.has(id)) duplicates.add(id || "(missing)");
    seen.add(id);
  }
  return [...duplicates].sort();
}

function countBy(records, field) {
  return records.reduce((summary, record) => {
    const value = stringValue(record[field]) || "(missing)";
    summary[value] = (summary[value] || 0) + 1;
    return summary;
  }, {});
}

export function isProductionVisibleArtist(record = {}) {
  if (stringValue(record.review_status) !== "reviewed") return false;
  return stringValue(record.public_visibility) !== "hidden";
}

function governanceRecordForArtist(governanceById, artistId) {
  return governanceById.get(artistId) || {};
}

function qidFrom(record = {}) {
  return stringValue(record.authority_ids?.wikidata);
}

function priorityFor(record = {}) {
  const existing = stringValue(record.research_priority);
  if (/^P[0-2]$/u.test(existing)) return existing;
  const artworkCount = Number(record.artwork_count || 0);
  if (artworkCount >= 50) return "P0";
  if (artworkCount >= 10) return "P1";
  return "P2";
}

function portraitDisposition(entityType, identityStatus) {
  if (entityType !== "person") {
    return {
      searchEligible: false,
      finalStatus: "non_person_entity",
      blockReason: `entity_type:${entityType || "missing"}`,
    };
  }
  if (!["verified", "provisional"].includes(identityStatus)) {
    return {
      searchEligible: false,
      finalStatus: "identity_unresolved",
      blockReason: `identity_status:${identityStatus || "missing"}`,
    };
  }
  return {
    searchEligible: true,
    finalStatus: "pending",
    blockReason: "",
  };
}

function linkedArtistIdsForArtwork(artwork = {}, links = []) {
  return unique([
    stringValue(artwork.primary_artist_id),
    ...asArray(artwork.artist_ids).map(stringValue),
    ...links
      .filter((link) => link.matched !== false && CREATOR_ROLES.has(stringValue(link.role)))
      .map((link) => stringValue(link.artist_id)),
  ]);
}

function hasSelfPortraitSubject(artwork = {}) {
  return asArray(artwork.subject_ids).some((id) => SELF_PORTRAIT_SUBJECT_IDS.has(stringValue(id)));
}

function artworkSearchText(artwork = {}) {
  return [
    artwork.title_cn,
    artwork.title_zh,
    artwork.title,
    artwork.title_en,
    artwork.titleEn,
    ...asArray(artwork.tags),
    ...asArray(artwork.tag_keys),
  ]
    .map(stringValue)
    .filter(Boolean)
    .join(" ");
}

function hasSelfPortraitText(artwork = {}) {
  const text = artworkSearchText(artwork);
  return SELF_PORTRAIT_PATTERNS.some((pattern) => pattern.test(text));
}

function artworkImageUrl(artwork = {}) {
  return stringValue(
    artwork.display_url || artwork.download_url || artwork.thumbnail_url || artwork.image_url,
  );
}

export function buildExistingArtworkCandidates(queue, artworks, artistLinks = []) {
  const queueById = new Map(queue.map((record) => [record.artist_id, record]));
  const linksByArtworkId = new Map();
  for (const link of artistLinks) {
    const artworkId = stringValue(link.artwork_id);
    if (!artworkId) continue;
    const bucket = linksByArtworkId.get(artworkId) || [];
    bucket.push(link);
    linksByArtworkId.set(artworkId, bucket);
  }

  const candidates = [];
  for (const artwork of artworks) {
    const artworkId = recordId(artwork);
    if (!artworkId || stringValue(artwork.status) === "rejected") continue;
    const controlledSubject = hasSelfPortraitSubject(artwork);
    const titleOrTags = hasSelfPortraitText(artwork);
    if (!controlledSubject && !titleOrTags) continue;
    const linkedArtistIds = linkedArtistIdsForArtwork(
      artwork,
      linksByArtworkId.get(artworkId) || [],
    );
    for (const artistId of linkedArtistIds) {
      const artist = queueById.get(artistId);
      if (!artist || artist.entity_type !== "person") continue;
      candidates.push({
        candidate_id: `${artistId}--${artworkId}`,
        candidate_origin: "project_artwork",
        artist_id: artistId,
        name_zh: artist.name_zh,
        name_en: artist.name_en,
        artwork_id: artworkId,
        title_cn: stringValue(artwork.title_cn || artwork.title_zh || artwork.title),
        title_en: stringValue(artwork.title_en || artwork.titleEn),
        relationship_type:
          stringValue(artwork.primary_artist_id) === artistId
            ? "primary_creator_self_portrait"
            : "linked_creator_self_portrait",
        relationship_evidence: {
          primary_artist_id: stringValue(artwork.primary_artist_id),
          artist_ids: asArray(artwork.artist_ids).map(stringValue),
          link_ids: (linksByArtworkId.get(artworkId) || [])
            .filter((link) => stringValue(link.artist_id) === artistId)
            .map((link) => recordId(link)),
        },
        candidate_reason: controlledSubject
          ? "controlled_subject_self_portrait"
          : "title_or_tag_self_portrait",
        candidate_confidence: controlledSubject ? "high" : "medium",
        source_name: stringValue(artwork.source_name),
        source_url: stringValue(artwork.source_url),
        image_url: artworkImageUrl(artwork),
        thumbnail_url: stringValue(artwork.thumbnail_url),
        display_url: stringValue(artwork.display_url),
        download_url: stringValue(artwork.download_url),
        rights_status:
          stringValue(artwork.rights_status || artwork.image_rights || artwork.license) ||
          "unreviewed",
        license_url: stringValue(artwork.license_url),
        review_status: "pending_identity_rights_quality_review",
      });
    }
  }
  return candidates.sort(
    (left, right) =>
      left.artist_id.localeCompare(right.artist_id) ||
      left.artwork_id.localeCompare(right.artwork_id),
  );
}

export function buildPortraitQueue(artists, governanceRecords, artworks, artistLinks) {
  const governanceById = new Map(governanceRecords.map((record) => [recordId(record), record]));
  const linksByArtistId = new Map();
  const linksByArtworkId = new Map();
  for (const link of artistLinks) {
    const artworkId = stringValue(link.artwork_id);
    if (!artworkId) continue;
    const values = linksByArtworkId.get(artworkId) || [];
    values.push(link);
    linksByArtworkId.set(artworkId, values);
  }
  for (const artwork of artworks) {
    const artworkId = recordId(artwork);
    const ids = linkedArtistIdsForArtwork(artwork, linksByArtworkId.get(artworkId) || []);
    for (const artistId of ids) {
      const values = linksByArtistId.get(artistId) || new Set();
      values.add(artworkId);
      linksByArtistId.set(artistId, values);
    }
  }

  return artists
    .filter(isProductionVisibleArtist)
    .map((artist) => {
      const artistId = recordId(artist);
      const governance = governanceRecordForArtist(governanceById, artistId);
      const entityType = stringValue(governance.entity_type || artist.entity_type) || "unresolved";
      const identityStatus =
        stringValue(governance.identity_status || artist.identity_status) || "unresolved";
      const authorityIds = governance.authority_ids || artist.authority_ids || {};
      const sources = asArray(governance.sources || artist.sources);
      const disposition = portraitDisposition(entityType, identityStatus);
      return {
        artist_id: artistId,
        name_zh: stringValue(artist.name_zh || governance.name_zh),
        name_en: stringValue(artist.name_en || governance.name_en),
        aliases: unique(
          [...asArray(artist.aliases), ...asArray(governance.aliases)].map(stringValue),
        ),
        birth_year: artist.birth_year ?? governance.birth_year ?? null,
        death_year: artist.death_year ?? governance.death_year ?? null,
        lifespan_text: stringValue(artist.lifespan_text || governance.lifespan_text),
        country: stringValue(
          artist.country_zh || artist.country || governance.country_zh || governance.country,
        ),
        region: stringValue(artist.region || governance.region),
        styles: unique([...asArray(artist.styles), ...asArray(governance.styles)].map(stringValue)),
        entity_type: entityType,
        identity_status: identityStatus,
        review_status: stringValue(artist.review_status),
        public_visibility: stringValue(artist.public_visibility) || "visible",
        wikidata_qid: qidFrom({ authority_ids: authorityIds }),
        authority_ids: authorityIds,
        sources,
        representative_artwork_ids: unique(
          asArray(artist.representative_artwork_ids).map(stringValue),
        ),
        artwork_count: Number(
          artist.artwork_count ||
            governance.artwork_count ||
            linksByArtistId.get(artistId)?.size ||
            0,
        ),
        linked_artwork_count: linksByArtistId.get(artistId)?.size || 0,
        current_portrait_url: stringValue(artist.portrait_url),
        current_portrait_status: stringValue(artist.portrait_status),
        target_priority: priorityFor({ ...governance, ...artist }),
        search_eligible: disposition.searchEligible,
        search_block_reason: disposition.blockReason,
        portrait_final_status: artist.portrait_status || disposition.finalStatus,
      };
    })
    .sort(
      (left, right) =>
        left.target_priority.localeCompare(right.target_priority) ||
        right.artwork_count - left.artwork_count ||
        left.artist_id.localeCompare(right.artist_id),
    );
}

function queueCsv(queue, candidateCounts) {
  const columns = [
    "artist_id",
    "name_zh",
    "name_en",
    "birth_year",
    "death_year",
    "entity_type",
    "identity_status",
    "review_status",
    "public_visibility",
    "wikidata_qid",
    "artwork_count",
    "linked_artwork_count",
    "existing_candidate_count",
    "target_priority",
    "search_eligible",
    "search_block_reason",
    "portrait_final_status",
    "current_portrait_url",
    "aliases_json",
    "authority_ids_json",
    "sources_json",
    "representative_artwork_ids_json",
  ];
  const escape = (value) => {
    const text = String(value ?? "");
    if (!/[",\r\n]/u.test(text)) return text;
    return `"${text.replace(/"/gu, '""')}"`;
  };
  const rows = queue.map((record) => ({
    ...record,
    existing_candidate_count: candidateCounts.get(record.artist_id) || 0,
    aliases_json: JSON.stringify(record.aliases),
    authority_ids_json: JSON.stringify(record.authority_ids),
    sources_json: JSON.stringify(record.sources),
    representative_artwork_ids_json: JSON.stringify(record.representative_artwork_ids),
  }));
  return [
    columns.join(","),
    ...rows.map((record) => columns.map((column) => escape(record[column])).join(",")),
  ].join("\n");
}

function relationshipSnapshot(queue, artworks, artistLinks) {
  const queueIds = new Set(queue.map((record) => record.artist_id));
  const linksByArtwork = new Map();
  for (const link of artistLinks) {
    const artworkId = stringValue(link.artwork_id);
    const values = linksByArtwork.get(artworkId) || [];
    values.push(link);
    linksByArtwork.set(artworkId, values);
  }
  return artworks.flatMap((artwork) => {
    const artworkId = recordId(artwork);
    const artistIds = linkedArtistIdsForArtwork(
      artwork,
      linksByArtwork.get(artworkId) || [],
    ).filter((artistId) => queueIds.has(artistId));
    return artistIds.map((artistId) => ({
      artwork_id: artworkId,
      artist_id: artistId,
      primary_artist_id: stringValue(artwork.primary_artist_id),
      artist_ids: asArray(artwork.artist_ids).map(stringValue),
      title_cn: stringValue(artwork.title_cn || artwork.title_zh || artwork.title),
      title_en: stringValue(artwork.title_en || artwork.titleEn),
      status: stringValue(artwork.status),
      source_name: stringValue(artwork.source_name),
      source_url: stringValue(artwork.source_url),
      subject_ids: asArray(artwork.subject_ids).map(stringValue),
      image_url: artworkImageUrl(artwork),
    }));
  });
}

function missingRepresentativeArtworkIds(queue, artworkIds) {
  return queue.flatMap((artist) =>
    artist.representative_artwork_ids
      .filter((artworkId) => !artworkIds.has(artworkId))
      .map((artworkId) => ({ artist_id: artist.artist_id, artwork_id: artworkId })),
  );
}

function summarizeUnknownArtistLinks(links) {
  const summary = new Map();
  for (const link of links) {
    const artistId = stringValue(link.artist_id) || "(missing)";
    const current = summary.get(artistId) || {
      artist_id: artistId,
      link_count: 0,
      sample_link_ids: [],
    };
    current.link_count += 1;
    if (current.sample_link_ids.length < 5) current.sample_link_ids.push(recordId(link));
    summary.set(artistId, current);
  }
  return [...summary.values()].sort(
    (left, right) =>
      right.link_count - left.link_count || left.artist_id.localeCompare(right.artist_id),
  );
}

export function buildScopeArtifacts({
  envId,
  generatedAt,
  artists,
  governanceRecords,
  artworks,
  artistLinks,
  permissions = {},
}) {
  const queue = buildPortraitQueue(artists, governanceRecords, artworks, artistLinks);
  const candidates = buildExistingArtworkCandidates(queue, artworks, artistLinks);
  const candidateCounts = candidates.reduce((counts, candidate) => {
    counts.set(candidate.artist_id, (counts.get(candidate.artist_id) || 0) + 1);
    return counts;
  }, new Map());
  const relationships = relationshipSnapshot(queue, artworks, artistLinks);
  const governanceIds = new Set(governanceRecords.map(recordId));
  const artworkIds = new Set(artworks.map(recordId));
  const allArtistIds = new Set(artists.map(recordId));
  const queueIds = new Set(queue.map((record) => record.artist_id));
  const visibleSourceIds = artists.filter(isProductionVisibleArtist).map(recordId);
  const unknownArtistLinks = artistLinks.filter((link) => {
    const artistId = stringValue(link.artist_id);
    return artistId && !allArtistIds.has(artistId);
  });
  const issues = {
    duplicate_artist_ids: duplicateIds(artists),
    duplicate_governance_ids: duplicateIds(governanceRecords),
    duplicate_artwork_ids: duplicateIds(artworks),
    duplicate_artist_link_ids: duplicateIds(artistLinks),
    visible_artists_missing_governance: visibleSourceIds
      .filter((artistId) => !governanceIds.has(artistId))
      .sort(),
    visible_artists_missing_names: queue
      .filter((artist) => !artist.name_zh && !artist.name_en)
      .map((artist) => artist.artist_id),
    visible_artists_missing_entity_type: queue
      .filter((artist) => artist.entity_type === "unresolved")
      .map((artist) => artist.artist_id),
    visible_artists_missing_identity_status: queue
      .filter((artist) => artist.identity_status === "unresolved")
      .map((artist) => artist.artist_id),
    invalid_wikidata_qids: queue
      .filter((artist) => artist.wikidata_qid && !/^Q[1-9][0-9]*$/u.test(artist.wikidata_qid))
      .map((artist) => ({
        artist_id: artist.artist_id,
        wikidata_qid: artist.wikidata_qid,
      })),
    missing_representative_artworks: missingRepresentativeArtworkIds(queue, artworkIds),
    artist_links_missing_artworks: artistLinks
      .filter((link) => !artworkIds.has(stringValue(link.artwork_id)))
      .map((link) => recordId(link)),
  };
  const scopeComplete =
    queue.length === visibleSourceIds.length &&
    new Set(queue.map((record) => record.artist_id)).size === queue.length &&
    issues.duplicate_artist_ids.length === 0 &&
    issues.visible_artists_missing_names.length === 0;
  const baselineReport = {
    generated_at: generatedAt,
    env_id: envId,
    read_only: true,
    status: scopeComplete ? "complete" : "incomplete",
    collections: COLLECTIONS,
    permissions,
    summary: {
      production_artist_documents: artists.length,
      production_visible_artists: queue.length,
      excluded_artist_documents: artists.length - queue.length,
      governance_documents: governanceRecords.length,
      artwork_documents: artworks.length,
      artist_link_documents: artistLinks.length,
      search_eligible_artists: queue.filter((record) => record.search_eligible).length,
      search_blocked_artists: queue.filter((record) => !record.search_eligible).length,
      artists_with_wikidata_qid: queue.filter((record) => record.wikidata_qid).length,
      artists_with_current_portrait: queue.filter((record) => record.current_portrait_url).length,
      artists_with_linked_artworks: queue.filter((record) => record.linked_artwork_count > 0)
        .length,
      existing_artwork_candidates: candidates.length,
      artists_with_existing_artwork_candidates: candidateCounts.size,
    },
    visible_entity_types: countBy(queue, "entity_type"),
    visible_identity_statuses: countBy(queue, "identity_status"),
    visible_priorities: countBy(queue, "target_priority"),
    excluded_review_statuses: countBy(
      artists.filter((record) => !isProductionVisibleArtist(record)),
      "review_status",
    ),
    informational: {
      artist_links_outside_visible_scope: artistLinks.filter((link) => {
        const artistId = stringValue(link.artist_id);
        return artistId && allArtistIds.has(artistId) && !queueIds.has(artistId);
      }).length,
    },
    pre_existing_findings: {
      unknown_artist_link_documents: unknownArtistLinks.length,
      unknown_artist_ids: summarizeUnknownArtistLinks(unknownArtistLinks),
      affects_portrait_queue: false,
      note: "Legacy relationship debt is recorded but excluded from portrait candidate matching.",
    },
    issues,
    acceptance: {
      production_total_known: artists.length > 0,
      every_visible_artist_queued_once:
        queue.length === visibleSourceIds.length &&
        new Set(queue.map((record) => record.artist_id)).size === queue.length,
      people_and_non_people_classified: queue.every((record) => Boolean(record.entity_type)),
      unresolved_identities_blocked: queue
        .filter((record) => record.identity_status === "unresolved")
        .every((record) => !record.search_eligible),
      candidates_use_stable_ids: candidates.every(
        (candidate) => candidate.artist_id && candidate.artwork_id,
      ),
      production_write_performed: false,
    },
  };
  const scope = {
    generated_at: generatedAt,
    env_id: envId,
    read_only: true,
    source_of_truth: "production artists + artist_profile_governance",
    visibility_rule: {
      review_status: "reviewed",
      public_visibility: "not hidden",
    },
    queue_count: queue.length,
    queue,
  };
  return {
    scope,
    queue,
    candidates,
    relationships,
    baselineReport,
    queueCsv: queueCsv(queue, candidateCounts),
  };
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function atomicWrite(filePath, data) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, filePath);
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonlText(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
}

function validateJsonlBackup(text, expectedCount) {
  const rows = text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const ids = rows.map(recordId);
  return {
    valid_jsonl: true,
    expected_count: expectedCount,
    parsed_count: rows.length,
    counts_match: rows.length === expectedCount,
    ids_unique: new Set(ids).size === ids.length,
    missing_ids: ids.filter((id) => !id).length,
  };
}

export function writeScopeArtifacts(outputDirectory, input, artifacts) {
  fs.mkdirSync(outputDirectory, { recursive: false });
  const files = new Map([
    ["production-backup.jsonl", jsonlText(input.artists)],
    ["production-governance-backup.jsonl", jsonlText(input.governanceRecords)],
    ["artwork-relationship-snapshot.jsonl", jsonlText(artifacts.relationships)],
    ["scope.json", jsonText(artifacts.scope)],
    ["artist-portrait-queue.csv", `\uFEFF${artifacts.queueCsv}\n`],
    ["existing-artwork-candidates.jsonl", jsonlText(artifacts.candidates)],
  ]);
  const backupValidation = {
    artists: validateJsonlBackup(files.get("production-backup.jsonl"), input.artists.length),
    governance: validateJsonlBackup(
      files.get("production-governance-backup.jsonl"),
      input.governanceRecords.length,
    ),
  };
  const baselineReport = {
    ...artifacts.baselineReport,
    backup_validation: backupValidation,
  };
  files.set("baseline-report.json", jsonText(baselineReport));

  const manifestFiles = [];
  for (const [name, data] of files) {
    const filePath = path.join(outputDirectory, name);
    atomicWrite(filePath, data);
    manifestFiles.push({
      name,
      bytes: Buffer.byteLength(data),
      sha256: sha256(data),
    });
  }
  const manifest = {
    generated_at: input.generatedAt,
    env_id: input.envId,
    read_only: true,
    files: manifestFiles,
  };
  atomicWrite(path.join(outputDirectory, "manifest.json"), jsonText(manifest));
  return {
    output_directory: outputDirectory,
    manifest,
    baseline_report: baselineReport,
  };
}

function permissionMap(result) {
  return Object.fromEntries(
    (result?.Data?.PermissionList || []).map((entry) => [entry.Resource, entry.Permission]),
  );
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv, env());
  if (options.help) {
    console.log(usage());
    return null;
  }
  const generatedAt = new Date().toISOString();
  const runId = options.runId || timestamp(new Date(generatedAt));
  const outputDirectory = path.join(options.outputRoot, runId);
  fs.mkdirSync(options.outputRoot, { recursive: true });
  if (fs.existsSync(outputDirectory)) {
    throw new Error(`Output directory already exists: ${outputDirectory}`);
  }

  const app = createClient(options.envId, env());
  const artworkProjection = {
    _id: 1,
    title_cn: 1,
    title_zh: 1,
    title: 1,
    title_en: 1,
    titleEn: 1,
    artist_ids: 1,
    primary_artist_id: 1,
    artist_labels: 1,
    artist: 1,
    status: 1,
    subject_ids: 1,
    tags: 1,
    tag_keys: 1,
    source_name: 1,
    source_url: 1,
    image_id: 1,
    thumbnail_url: 1,
    display_url: 1,
    download_url: 1,
    image_url: 1,
    rights_status: 1,
    image_rights: 1,
    license: 1,
    license_url: 1,
  };
  const linkProjection = {
    _id: 1,
    artwork_id: 1,
    artist_id: 1,
    role: 1,
    matched: 1,
    review_status: 1,
  };
  const [artists, governanceRecords, artworks, artistLinks, permissions] = await Promise.all([
    queryCollection(app.database, COLLECTIONS.artists),
    queryCollection(app.database, COLLECTIONS.governance),
    queryCollection(app.database, COLLECTIONS.artworks, artworkProjection),
    queryCollection(app.database, COLLECTIONS.artistLinks, linkProjection),
    app.permission.describeResourcePermission({
      resourceType: "collection",
      resources: Object.values(COLLECTIONS),
    }),
  ]);

  const input = {
    envId: options.envId,
    generatedAt,
    artists,
    governanceRecords,
    artworks,
    artistLinks,
    permissions: permissionMap(permissions),
  };
  const artifacts = buildScopeArtifacts(input);
  const result = writeScopeArtifacts(outputDirectory, input, artifacts);
  console.log(
    JSON.stringify(
      {
        output_directory: result.output_directory,
        status: result.baseline_report.status,
        summary: result.baseline_report.summary,
        acceptance: result.baseline_report.acceptance,
        backup_validation: result.baseline_report.backup_validation,
      },
      null,
      2,
    ),
  );
  return result;
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
