#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  buildArtistEnrichmentPilotPackage,
  discoverBatchFiles,
} from "./build-artist-enrichment-pilot.mjs";
import { validateArtistEnrichment } from "./artist-enrichment.mjs";

const ROOT = path.resolve("outputs", "artist-enrichment");
const AUDIT_FILE = path.join(ROOT, "artist-enrichment-audit-20260725T034957Z.json");
const OUTPUT_DIR = path.join(ROOT, "completion-audit");

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function loadBatches() {
  return discoverBatchFiles(ROOT).map((name) => ({
    __file: path.join(ROOT, name),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8")),
  }));
}

function httpSourceCount(record) {
  return (record.sources || []).filter((source) => /^https?:\/\//u.test(source.url || "")).length;
}

function main() {
  const sourceAudit = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
  const sourceIds = new Set(sourceAudit.artists.map((artist) => artist._id));
  const batches = loadBatches();
  const pilot = buildArtistEnrichmentPilotPackage(batches);
  const patchById = new Map(pilot.artist_patches.map((record) => [record._id, record]));
  const missingSourceIds = [...sourceIds].filter((id) => !patchById.has(id)).sort();
  const addedEntityIds = [...patchById.keys()].filter((id) => !sourceIds.has(id)).sort();
  const structural = pilot.artist_patches.filter(
    (record) => !record.bio_zh || !record.bio_facts || !record.sources,
  );
  const fullRecords = pilot.artist_patches.filter((record) => !structural.includes(record));
  const validationErrors = [];
  const qualityErrors = [];
  for (const record of fullRecords) {
    const validation = validateArtistEnrichment(record);
    if (!validation.ok) validationErrors.push({ _id: record._id, errors: validation.errors });
    if (!record.country_code || record.country_code === "ZZ") {
      qualityErrors.push({
        _id: record._id,
        field: "country_code",
        message: "missing normalized country",
      });
    }
    if (!record.occupations_zh?.length) {
      qualityErrors.push({
        _id: record._id,
        field: "occupations_zh",
        message: "missing occupations",
      });
    }
    if (!record.representative_artwork_ids || !Array.isArray(record.representative_artwork_ids)) {
      qualityErrors.push({
        _id: record._id,
        field: "representative_artwork_ids",
        message: "representative_artwork_ids must be an array",
      });
    }
    if (!Number.isSafeInteger(record.artwork_count) || record.artwork_count < 0) {
      qualityErrors.push({
        _id: record._id,
        field: "artwork_count",
        message: "invalid artwork_count",
      });
    }
    if (!httpSourceCount(record)) {
      qualityErrors.push({
        _id: record._id,
        field: "sources",
        message: "missing online authority source",
      });
    }
  }
  const originalFull = fullRecords.filter((record) => sourceIds.has(record._id));
  const originalStructural = structural.filter((record) => sourceIds.has(record._id));
  const status =
    missingSourceIds.length === 0 &&
    originalFull.length + originalStructural.length === sourceIds.size &&
    validationErrors.length === 0 &&
    qualityErrors.length === 0
      ? "complete"
      : "incomplete";
  const result = {
    generated_at: new Date().toISOString(),
    status,
    production_written: false,
    source_audit: AUDIT_FILE,
    summary: {
      source_artists: sourceIds.size,
      source_artists_covered: sourceIds.size - missingSourceIds.length,
      source_full_enrichment_records: originalFull.length,
      source_structural_dispositions: originalStructural.length,
      added_verified_or_structural_entities: addedEntityIds.length,
      total_artist_patches: pilot.artist_patches.length,
      relationship_changes: pilot.relationship_changes.length,
      biographies_valid: fullRecords.length - validationErrors.length,
      biographies_invalid: validationErrors.length,
      quality_errors: qualityErrors.length,
      source_batches: batches.length,
    },
    missing_source_ids: missingSourceIds,
    added_entity_ids: addedEntityIds,
    structural_disposition_ids: originalStructural.map((record) => record._id).sort(),
    validation_errors: validationErrors,
    quality_errors: qualityErrors,
    relationship_changes: pilot.relationship_changes.map((change) => ({
      _id: change._id,
      artwork_id: change.artwork_id || null,
      artwork_ids: change.artwork_ids || [],
      artist_id: change.artist_id || null,
      set_role: change.set_role || null,
      set_roles: change.set_roles || [],
      remove_artist_ids: change.remove_artist_ids || [],
      review_status: change.review_status || "",
    })),
  };
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const output = path.join(OUTPUT_DIR, `artist-enrichment-completion-audit-${timestamp()}.json`);
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, ...result.summary, status }, null, 2));
  if (status !== "complete") process.exitCode = 1;
}

main();
