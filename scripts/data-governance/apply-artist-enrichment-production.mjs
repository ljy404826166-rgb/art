#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtistEnrichment } from "./artist-enrichment.mjs";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const PROFILE_VERSION = "artist-profile-v1";
const MIGRATION_BATCH = "artist-enrichment-production-20260727";
const DEFAULT_MANIFEST_DIR = path.resolve("outputs", "artist-enrichment", "pilot");
const DEFAULT_BACKUP_DIR = path.resolve("outputs", "artist-enrichment", "production-backup");
const DEFAULT_REPORT_DIR = path.resolve("outputs", "artist-enrichment", "production-write");
const COLLECTIONS = {
  artists: "artists",
  artworks: "artworks",
  artistLinks: "artwork_artist_links",
  governance: "artist_profile_governance",
  relationshipGovernance: "artist_relationship_governance",
};

export const PUBLIC_ARTIST_FIELDS = new Set([
  "_id",
  "name_zh",
  "name_en",
  "preferred_name",
  "aliases",
  "birth_year",
  "death_year",
  "birth_date_text",
  "death_date_text",
  "birth_place",
  "death_place",
  "lifespan_text",
  "country_code",
  "country_zh",
  "country",
  "region_id",
  "region",
  "occupations_zh",
  "styles",
  "periods",
  "active_period",
  "representative_works",
  "representative_artwork_ids",
  "bio_zh",
  "historical_significance_zh",
  "tags",
  "avatar_text",
  "portrait_url",
  "portrait_source",
  "portrait_license",
  "portrait_credit",
  "portrait_kind",
  "portrait_artwork_id",
  "portrait_status",
  "portrait_updated_at",
  "artwork_count",
  "classification_version",
  "style_ids",
  "subject_ids",
  "decade_ids",
  "classified_artwork_count",
  "classification_updated_at",
  "classification_migration_batch",
  "entity_type",
  "review_status",
  "public_visibility",
  "profile_schema_version",
  "profile_published_at",
  "updated_at",
]);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
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
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local"), ...process.env };
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    run: false,
    incremental: false,
    envId: PRODUCTION_ENV_ID,
    confirmation: "",
    manifestDir: DEFAULT_MANIFEST_DIR,
    backupDir: DEFAULT_BACKUP_DIR,
    reportDir: DEFAULT_REPORT_DIR,
    batchSize: 20,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--incremental") options.incremental = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--confirm-production") {
      options.confirmation = required(argv, (index += 1), arg);
    } else if (arg === "--manifest-dir") {
      options.manifestDir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--backup-dir") {
      options.backupDir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--report-dir") {
      options.reportDir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--batch-size") {
      options.batchSize = Number(required(argv, (index += 1), arg));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 50) {
    throw new Error("--batch-size must be an integer between 1 and 50.");
  }
  if (options.run && options.envId !== PRODUCTION_ENV_ID) {
    throw new Error(`Production writes are restricted to ${PRODUCTION_ENV_ID}.`);
  }
  if (options.run && options.confirmation !== PRODUCTION_ENV_ID) {
    throw new Error(`--run requires --confirm-production ${PRODUCTION_ENV_ID}.`);
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/data-governance/apply-artist-enrichment-production.mjs
  node scripts/data-governance/apply-artist-enrichment-production.mjs --run \\
    --confirm-production ${PRODUCTION_ENV_ID}

Dry-run is the default. A local rollback snapshot is created before any production write.
`;
}

function latestManifest(directory) {
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith("artist-enrichment-pilot-") && name.endsWith(".json"))
    .sort();
  if (!files.length) throw new Error(`No artist enrichment pilot manifest in ${directory}`);
  return path.join(directory, files.at(-1));
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

async function queryCollection(database, collection, filter = {}, projection = {}) {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    const result = await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "QUERY",
              Command: JSON.stringify({
                find: collection,
                filter,
                projection,
                skip,
                limit: pageSize,
              }),
            },
          ],
        }),
      `query ${collection}`,
    );
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function createClient(envId, config) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("Missing Tencent Cloud credentials.");
  return CloudBase.init({ envId, secretId, secretKey });
}

function compactObject(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function titleForArtwork(record = {}) {
  return String(
    record.title_cn ||
      record.title_zh ||
      record.titleCn ||
      record.titleZh ||
      record.title ||
      record.title_en ||
      record.titleEn ||
      "",
  ).trim();
}

function reviewStatusForStructural(record = {}) {
  return record.record_action === "retire_as_non_creator_label" ? "rejected" : "candidate";
}

function avatarText(record = {}) {
  const existing = String(record.avatar_text || "").trim();
  if (existing) return existing;
  return String(record.name_zh || record.name_en || "?")
    .trim()
    .slice(0, 1);
}

function publicFields(record) {
  return compactObject(
    Object.fromEntries(Object.entries(record).filter(([key]) => PUBLIC_ARTIST_FIELDS.has(key))),
  );
}

export function buildProductionDocuments(sourceArtists, manifest, artworks, publishedAt) {
  const sourceById = new Map(sourceArtists.map((record) => [String(record._id), record]));
  const artworkById = new Map(artworks.map((record) => [String(record._id), record]));
  const fullRecordIds = new Set(
    (manifest.validation || []).filter((row) => row.ok).map((row) => String(row._id)),
  );
  const publicArtists = [];
  const governanceRecords = [];

  for (const patch of manifest.artist_patches || []) {
    const source = sourceById.get(String(patch._id));
    const canCreateStructuralAuthority = [
      "retain_as_workshop_authority",
      "retain_as_attribution_authority",
      "retain_as_organization_authority",
    ].includes(patch.record_action);
    if (
      !source &&
      !fullRecordIds.has(String(patch._id)) &&
      patch.record_action !== "create" &&
      !canCreateStructuralAuthority
    ) {
      throw new Error(`Missing production source artist for ${patch._id}`);
    }
    const merged = { ...(source || {}), ...patch };
    const isFullRecord = fullRecordIds.has(String(patch._id));
    if (isFullRecord) {
      const validation = validateArtistEnrichment(merged);
      if (!validation.ok) {
        throw new Error(`Artist ${patch._id} failed final enrichment validation.`);
      }
    }

    const representativeArtworkIds = (merged.representative_artwork_ids || []).slice(0, 2);
    const representativeWorks = representativeArtworkIds
      .map((id) => titleForArtwork(artworkById.get(String(id))))
      .filter(Boolean);
    const base = {
      ...merged,
      representative_works: representativeWorks.length
        ? representativeWorks
        : merged.representative_works || [],
      representative_artwork_ids: representativeArtworkIds,
      avatar_text: avatarText(merged),
      review_status: isFullRecord ? "reviewed" : reviewStatusForStructural(merged),
      public_visibility: isFullRecord ? "visible" : "hidden",
      profile_schema_version: PROFILE_VERSION,
      profile_published_at: isFullRecord ? publishedAt : undefined,
      updated_at: publishedAt,
    };

    if (!isFullRecord) {
      for (const field of [
        "bio_zh",
        "historical_significance_zh",
        "representative_works",
        "representative_artwork_ids",
      ])
        delete base[field];
    }
    const publicDocument = publicFields(base);
    publicArtists.push(publicDocument);
    governanceRecords.push({
      ...merged,
      _id: String(merged._id),
      governance_schema_version: PROFILE_VERSION,
      governance_status: isFullRecord ? "approved_for_publication" : "internal_only",
      production_review_status: publicDocument.review_status,
      production_public_visibility: publicDocument.public_visibility,
      production_migration_batch: MIGRATION_BATCH,
      production_synced_at: publishedAt,
    });
  }

  return {
    publicArtists,
    governanceRecords,
    fullRecordIds,
  };
}

function relationshipAssignments(change) {
  if (Array.isArray(change.set_roles)) return change.set_roles;
  if (change.add && change.add.artist_id) {
    return [{ artist_id: change.add.artist_id, role: change.add.role || "creator" }];
  }
  if (change.artist_id && change.set_role) {
    return [{ artist_id: change.artist_id, role: change.set_role }];
  }
  throw new Error(`Relationship change ${change._id} has no target assignment.`);
}

function affectedArtworkIds(change) {
  return Array.isArray(change.artwork_ids)
    ? change.artwork_ids.map(String)
    : [String(change.artwork_id)];
}

function artistLabel(record = {}, fallback = "") {
  const zh = String(record.name_zh || "").trim();
  const en = String(record.name_en || "").trim();
  if (zh && en && zh !== en) return `${zh} (${en})`;
  return zh || en || fallback;
}

export function buildRelationshipTargets(changes, publicArtists, publishedAt) {
  const artistById = new Map(publicArtists.map((record) => [String(record._id), record]));
  const links = [];
  const artworkPatches = [];
  const governance = [];
  const rolePriority = ["creator", "attributed_to", "workshop", "after", "publisher", "unknown"];

  for (const change of changes || []) {
    const assignments = relationshipAssignments(change);
    for (const artworkId of affectedArtworkIds(change)) {
      const normalizedAssignments = assignments.map((assignment) => ({
        artist_id: String(assignment.artist_id),
        role: String(assignment.role || "creator"),
      }));
      const sorted = [...normalizedAssignments].sort(
        (left, right) => rolePriority.indexOf(left.role) - rolePriority.indexOf(right.role),
      );
      const artistIds = [...new Set(sorted.map((assignment) => assignment.artist_id))];
      const labels = artistIds.map((id) => artistLabel(artistById.get(id), id));
      const primary = sorted[0]?.artist_id || "";
      artworkPatches.push({
        _id: artworkId,
        artist_ids: artistIds,
        primary_artist_id: primary,
        artist_labels: labels,
        artist: labels.join(" / "),
        artist_relationship_version: PROFILE_VERSION,
        artist_relationship_updated_at: publishedAt,
        artist_relationship_migration_batch: MIGRATION_BATCH,
      });
      for (const assignment of sorted) {
        links.push({
          _id: `${artworkId}--${assignment.role}--${assignment.artist_id}`,
          artwork_id: artworkId,
          artist_id: assignment.artist_id,
          role: assignment.role,
          confidence: "high",
          matched: true,
          match_source: "artist-enrichment-reviewed",
          source_field: "artist_governance",
          review_status: "reviewed",
          classification_version: PROFILE_VERSION,
          classification_updated_at: publishedAt,
          classification_migration_batch: MIGRATION_BATCH,
        });
      }
      governance.push({
        ...change,
        _id: `${change._id}--${artworkId}`,
        source_change_id: change._id,
        artwork_id: artworkId,
        applied_assignments: sorted,
        production_status: "applied",
        production_migration_batch: MIGRATION_BATCH,
        production_applied_at: publishedAt,
      });
    }
  }
  return { links, artworkPatches, governance };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function upsertDocuments(database, collection, documents, batchSize) {
  await database.createCollectionIfNotExists(collection);
  for (const batch of chunks(documents, batchSize)) {
    await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "UPDATE",
              Command: JSON.stringify({
                update: collection,
                updates: batch.map((document) => {
                  const { _id, ...fields } = document;
                  return { q: { _id }, u: { $set: fields }, upsert: true };
                }),
              }),
            },
          ],
        }),
      `upsert ${collection}`,
    );
  }
}

async function replacePublicArtists(database, currentArtists, targetArtists, batchSize) {
  const currentById = new Map(currentArtists.map((record) => [String(record._id), record]));
  for (const batch of chunks(targetArtists, batchSize)) {
    await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: COLLECTIONS.artists,
              CommandType: "UPDATE",
              Command: JSON.stringify({
                update: COLLECTIONS.artists,
                updates: batch.map((document) => {
                  const current = currentById.get(String(document._id)) || {};
                  const unset = Object.fromEntries(
                    Object.keys(current)
                      .filter((key) => key !== "_id" && !(key in document))
                      .map((key) => [key, ""]),
                  );
                  const { _id, ...fields } = document;
                  const update = { $set: fields };
                  if (Object.keys(unset).length) update.$unset = unset;
                  return { q: { _id }, u: update, upsert: true };
                }),
              }),
            },
          ],
        }),
      `replace public ${COLLECTIONS.artists}`,
    );
  }
}

async function deleteDocuments(database, collection, ids, batchSize) {
  for (const batch of chunks(ids, batchSize)) {
    await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "DELETE",
              Command: JSON.stringify({
                delete: collection,
                deletes: batch.map((id) => ({ q: { _id: id }, limit: 1 })),
              }),
            },
          ],
        }),
      `delete ${collection}`,
    );
  }
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function writeJson(directory, prefix, value) {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${prefix}-${timestamp()}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function idSet(values) {
  return new Set(values.map((record) => String(record._id)));
}

function exactIds(actual, expected) {
  const actualIds = idSet(actual);
  const expectedIds = idSet(expected);
  return actualIds.size === expectedIds.size && [...expectedIds].every((id) => actualIds.has(id));
}

function countBy(records, field) {
  return records.reduce((result, record) => {
    const value = String(record[field] || "(none)");
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function publicContractViolations(records) {
  return records.flatMap((record) => {
    const forbidden = Object.keys(record).filter((key) => !PUBLIC_ARTIST_FIELDS.has(key));
    return forbidden.length ? [{ _id: record._id, forbidden }] : [];
  });
}

function samePublicDocument(actual, expected) {
  return [...PUBLIC_ARTIST_FIELDS].every(
    (field) => JSON.stringify(actual?.[field]) === JSON.stringify(expected?.[field]),
  );
}

function publicMismatches(actual, expected) {
  const actualById = new Map(actual.map((record) => [String(record._id), record]));
  return expected
    .filter((record) => !samePublicDocument(actualById.get(String(record._id)) || {}, record))
    .map((record) => record._id);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const manifestFile = latestManifest(options.manifestDir);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const app = createClient(options.envId, env());
  const publishedAt = new Date().toISOString();
  const affectedIds = [
    ...new Set((manifest.relationship_changes || []).flatMap(affectedArtworkIds)),
  ];
  const [currentArtists, allArtworkTitles, affectedArtworks, affectedLinks, permissions] =
    await Promise.all([
      queryCollection(app.database, COLLECTIONS.artists),
      queryCollection(
        app.database,
        COLLECTIONS.artworks,
        {},
        {
          _id: 1,
          title: 1,
          title_zh: 1,
          titleZh: 1,
          title_en: 1,
          titleEn: 1,
        },
      ),
      queryCollection(app.database, COLLECTIONS.artworks, {
        _id: { $in: affectedIds },
      }),
      queryCollection(app.database, COLLECTIONS.artistLinks, {
        artwork_id: { $in: affectedIds },
      }),
      app.permission.describeResourcePermission({
        resourceType: "collection",
        resources: [
          COLLECTIONS.artists,
          COLLECTIONS.artworks,
          COLLECTIONS.artistLinks,
          COLLECTIONS.governance,
          COLLECTIONS.relationshipGovernance,
        ],
      }),
    ]);

  const production = buildProductionDocuments(
    currentArtists,
    manifest,
    allArtworkTitles,
    publishedAt,
  );
  const relationships = buildRelationshipTargets(
    manifest.relationship_changes,
    production.publicArtists,
    publishedAt,
  );
  const originalArtistIds = new Set(
    (manifest.artist_patches || [])
      .map((record) => String(record._id))
      .filter((id) => currentArtists.some((record) => String(record._id) === id)),
  );
  const sourceIsBaseline = currentArtists.length === 112 && originalArtistIds.size === 112;
  const sourceIsIdempotentTarget = currentArtists.length === 116 && originalArtistIds.size === 116;
  const fullReplacementSafe =
    (sourceIsBaseline || sourceIsIdempotentTarget) &&
    production.publicArtists.length === 116 &&
    production.governanceRecords.length === 116;
  const targetArtistIds = new Set(production.publicArtists.map((record) => String(record._id)));
  const incrementalSafe =
    options.incremental &&
    targetArtistIds.size === production.publicArtists.length &&
    production.publicArtists.length > 0 &&
    production.publicArtists.length === production.governanceRecords.length;
  const baselineSafe =
    (fullReplacementSafe || incrementalSafe) &&
    relationships.artworkPatches.length === affectedIds.length &&
    affectedArtworks.length === affectedIds.length;
  if (!baselineSafe) {
    throw new Error("Production preflight failed: source counts or affected IDs have drifted.");
  }

  const backup = {
    generated_at: publishedAt,
    env_id: options.envId,
    migration_batch: MIGRATION_BATCH,
    manifest_file: manifestFile,
    permissions: permissions.Data,
    collections: {
      [COLLECTIONS.artists]: currentArtists,
      [COLLECTIONS.artworks]: affectedArtworks,
      [COLLECTIONS.artistLinks]: affectedLinks,
    },
    rollback: {
      restore_collections: [COLLECTIONS.artists, COLLECTIONS.artworks, COLLECTIONS.artistLinks],
      delete_new_artist_ids: production.publicArtists
        .map((record) => String(record._id))
        .filter((id) => !currentArtists.some((record) => String(record._id) === id)),
      affected_artwork_ids: affectedIds,
    },
  };
  const backupFile = writeJson(options.backupDir, "artist-enrichment-production-backup", backup);
  const report = {
    generated_at: publishedAt,
    dry_run: !options.run,
    env_id: options.envId,
    migration_batch: MIGRATION_BATCH,
    manifest_file: manifestFile,
    backup_file: backupFile,
    production_collections_modified: false,
    preflight: {
      safe_to_write: baselineSafe,
      mode: options.incremental ? "incremental" : "full-replacement",
      source_artists: currentArtists.length,
      target_public_artist_documents: production.publicArtists.length,
      reviewed_public_profiles: production.publicArtists.filter(
        (record) => record.review_status === "reviewed",
      ).length,
      hidden_governance_profiles: production.publicArtists.filter(
        (record) => record.public_visibility === "hidden",
      ).length,
      governance_documents: production.governanceRecords.length,
      affected_artworks: relationships.artworkPatches.length,
      target_relationship_links: relationships.links.length,
    },
    write: {},
    verification: {},
  };

  if (options.run) {
    await app.database.createCollectionIfNotExists(COLLECTIONS.governance);
    await app.database.createCollectionIfNotExists(COLLECTIONS.relationshipGovernance);
    await app.permission.modifyResourcePermission({
      resourceType: "collection",
      resource: COLLECTIONS.governance,
      permission: "PRIVATE",
    });
    await app.permission.modifyResourcePermission({
      resourceType: "collection",
      resource: COLLECTIONS.relationshipGovernance,
      permission: "PRIVATE",
    });

    await upsertDocuments(
      app.database,
      COLLECTIONS.governance,
      production.governanceRecords,
      options.batchSize,
    );
    await upsertDocuments(
      app.database,
      COLLECTIONS.relationshipGovernance,
      relationships.governance,
      options.batchSize,
    );
    await replacePublicArtists(
      app.database,
      currentArtists,
      production.publicArtists,
      options.batchSize,
    );
    await upsertDocuments(
      app.database,
      COLLECTIONS.artworks,
      relationships.artworkPatches,
      options.batchSize,
    );
    await deleteDocuments(
      app.database,
      COLLECTIONS.artistLinks,
      affectedLinks.map((record) => String(record._id)),
      options.batchSize,
    );
    await upsertDocuments(
      app.database,
      COLLECTIONS.artistLinks,
      relationships.links,
      options.batchSize,
    );
    report.production_collections_modified = true;
    report.write = {
      public_artists: production.publicArtists.length,
      governance_records: production.governanceRecords.length,
      relationship_governance_records: relationships.governance.length,
      artworks_updated: relationships.artworkPatches.length,
      relationship_links_removed: affectedLinks.length,
      relationship_links_written: relationships.links.length,
    };

    const [
      verifiedArtists,
      verifiedGovernance,
      verifiedRelationshipGovernance,
      verifiedArtworks,
      verifiedLinks,
      verifiedPermissions,
    ] = await Promise.all([
      queryCollection(app.database, COLLECTIONS.artists),
      queryCollection(app.database, COLLECTIONS.governance),
      queryCollection(app.database, COLLECTIONS.relationshipGovernance),
      queryCollection(app.database, COLLECTIONS.artworks, { _id: { $in: affectedIds } }),
      queryCollection(app.database, COLLECTIONS.artistLinks, {
        artwork_id: { $in: affectedIds },
      }),
      app.permission.describeResourcePermission({
        resourceType: "collection",
        resources: [
          COLLECTIONS.artists,
          COLLECTIONS.governance,
          COLLECTIONS.relationshipGovernance,
        ],
      }),
    ]);
    const artistMismatches = publicMismatches(verifiedArtists, production.publicArtists);
    const verifiedTargetArtists = verifiedArtists.filter((record) =>
      targetArtistIds.has(String(record._id)),
    );
    const verifiedTargetGovernance = verifiedGovernance.filter((record) =>
      targetArtistIds.has(String(record._id)),
    );
    const targetRelationshipChangeIds = new Set(
      (manifest.relationship_changes || []).map((record) => String(record._id)),
    );
    const verifiedTargetRelationshipGovernance = verifiedRelationshipGovernance.filter((record) =>
      targetRelationshipChangeIds.has(String(record.source_change_id)),
    );
    const forbiddenPublicFields = publicContractViolations(verifiedArtists);
    const verifiedArtworkById = new Map(
      verifiedArtworks.map((record) => [String(record._id), record]),
    );
    const artworkMismatches = relationships.artworkPatches
      .filter((expected) => {
        const actual = verifiedArtworkById.get(String(expected._id)) || {};
        return [
          "artist_ids",
          "primary_artist_id",
          "artist_labels",
          "artist",
          "artist_relationship_version",
        ].some((field) => JSON.stringify(actual[field]) !== JSON.stringify(expected[field]));
      })
      .map((record) => record._id);
    const permissionByCollection = Object.fromEntries(
      (verifiedPermissions.Data?.PermissionList || []).map((entry) => [
        entry.Resource,
        entry.Permission,
      ]),
    );
    report.verification = {
      public_artists: verifiedArtists.length,
      public_review_statuses: countBy(verifiedArtists, "review_status"),
      public_visibility: countBy(verifiedArtists, "public_visibility"),
      public_artist_ids_match: exactIds(
        options.incremental ? verifiedTargetArtists : verifiedArtists,
        production.publicArtists,
      ),
      public_artist_mismatches: artistMismatches,
      forbidden_public_fields: forbiddenPublicFields,
      governance_records: verifiedGovernance.length,
      governance_ids_match: exactIds(
        options.incremental ? verifiedTargetGovernance : verifiedGovernance,
        production.governanceRecords,
      ),
      relationship_governance_records: verifiedRelationshipGovernance.length,
      relationship_governance_ids_match: exactIds(
        options.incremental ? verifiedTargetRelationshipGovernance : verifiedRelationshipGovernance,
        relationships.governance,
      ),
      affected_artworks: verifiedArtworks.length,
      artwork_mismatches: artworkMismatches,
      affected_relationship_links: verifiedLinks.length,
      relationship_link_ids_match: exactIds(verifiedLinks, relationships.links),
      permissions: permissionByCollection,
    };
    const expectedArtistTotal = options.incremental
      ? currentArtists.length +
        production.publicArtists.filter(
          (record) => !currentArtists.some((current) => String(current._id) === String(record._id)),
        ).length
      : 116;
    const targetProfilesPublished = verifiedTargetArtists.every((record) => {
      const isFullRecord = production.fullRecordIds.has(String(record._id));
      return isFullRecord
        ? record.review_status === "reviewed" && record.public_visibility === "visible"
        : record.review_status !== "reviewed" && record.public_visibility === "hidden";
    });
    report.verification.passed =
      verifiedArtists.length === expectedArtistTotal &&
      (options.incremental
        ? targetProfilesPublished
        : report.verification.public_review_statuses.reviewed === 103 &&
          report.verification.public_visibility.hidden === 13) &&
      report.verification.public_artist_ids_match &&
      artistMismatches.length === 0 &&
      forbiddenPublicFields.length === 0 &&
      report.verification.governance_ids_match &&
      report.verification.relationship_governance_ids_match &&
      artworkMismatches.length === 0 &&
      report.verification.relationship_link_ids_match &&
      permissionByCollection[COLLECTIONS.artists] === "READONLY" &&
      permissionByCollection[COLLECTIONS.governance] === "PRIVATE" &&
      permissionByCollection[COLLECTIONS.relationshipGovernance] === "PRIVATE";
    if (!report.verification.passed) {
      const failedReportFile = writeJson(
        options.reportDir,
        "artist-enrichment-production-write-failed",
        report,
      );
      console.error(
        JSON.stringify(
          {
            report: failedReportFile,
            verification: report.verification,
          },
          null,
          2,
        ),
      );
      throw new Error(`Production verification failed; restore from ${backupFile}`);
    }
  }

  const reportFile = writeJson(options.reportDir, "artist-enrichment-production-write", report);
  console.log(JSON.stringify({ report: reportFile, ...report }, null, 2));
  return report;
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
