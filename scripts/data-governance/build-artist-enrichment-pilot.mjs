#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtistEnrichment } from "./artist-enrichment.mjs";

const BATCH_FILE_PATTERN = /^artist-enrichment-(?:candidates|dispositions)-batch-(\d+)\.json$/;

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function stableChangeId(change, index) {
  const artworkId = change.artwork_id || change.artwork_ids?.[0] || change.artist_id || "change";
  return `artist-enrichment-${String(index + 1).padStart(3, "0")}-${artworkId}`;
}

export function buildArtistEnrichmentPilotPackage(batches, generatedAt = new Date().toISOString()) {
  const patches = new Map();
  const fullRecordIds = new Set();
  const relationshipChanges = [];
  const sources = [];

  for (const batch of batches) {
    sources.push({
      file: batch.__file || "",
      generated_at: batch.generated_at || "",
      status: batch.status || "",
      production_written: Boolean(batch.production_written),
    });
    for (const record of batch.records || []) {
      const previous = patches.get(record._id) || {};
      patches.set(record._id, { ...previous, ...record });
      fullRecordIds.add(record._id);
    }
    for (const record of batch.record_corrections || []) {
      const previous = patches.get(record._id) || {};
      patches.set(record._id, { ...previous, ...record });
    }
    for (const record of batch.record_dispositions || []) {
      const previous = patches.get(record._id) || {};
      patches.set(record._id, { ...previous, ...record });
    }
    relationshipChanges.push(...(batch.relationship_corrections || []));
  }

  const artistPatches = [...patches.values()].sort((a, b) => a._id.localeCompare(b._id));
  const fullRecords = artistPatches.filter((record) => fullRecordIds.has(record._id));
  const validation = fullRecords.map((record) => ({
    _id: record._id,
    ...validateArtistEnrichment(record),
  }));
  const invalid = validation.filter((row) => !row.ok);
  if (invalid.length) {
    throw new Error(`Invalid full enrichment records: ${invalid.map((row) => row._id).join(", ")}`);
  }

  return {
    generated_at: generatedAt,
    status: "pilot_candidate_package",
    production_written: false,
    pilot_collections: {
      artists: "artists_enrichment_pilot_20260725",
      relationship_changes: "artist_relationship_changes_pilot_20260725",
    },
    summary: {
      source_batches: batches.length,
      artist_patches: artistPatches.length,
      full_enrichment_records: fullRecords.length,
      structural_dispositions: artistPatches.length - fullRecords.length,
      relationship_changes: relationshipChanges.length,
      full_records_valid: validation.length - invalid.length,
      full_records_invalid: invalid.length,
    },
    source_batches: sources,
    artist_patches: artistPatches,
    relationship_changes: relationshipChanges.map((change, index) => ({
      _id: stableChangeId(change, index),
      ...change,
    })),
    validation,
  };
}

export function discoverBatchFiles(inputDir) {
  return fs
    .readdirSync(inputDir)
    .map((name) => {
      const match = name.match(BATCH_FILE_PATTERN);
      return match ? { name, batch: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.batch - right.batch || left.name.localeCompare(right.name))
    .map((entry) => entry.name);
}

export function main(argv = process.argv.slice(2)) {
  const inputDir = path.resolve(argv[0] || path.join("outputs", "artist-enrichment"));
  const outputDir = path.resolve(argv[1] || path.join("outputs", "artist-enrichment", "pilot"));
  const batchFiles = discoverBatchFiles(inputDir);
  if (!batchFiles.length) throw new Error(`No artist enrichment batches in ${inputDir}`);
  const batches = batchFiles.map((name) => {
    const file = path.join(inputDir, name);
    return {
      __file: file,
      ...JSON.parse(fs.readFileSync(file, "utf8")),
    };
  });
  const result = buildArtistEnrichmentPilotPackage(batches);
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, `artist-enrichment-pilot-${timestamp()}.json`);
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, summary: result.summary }, null, 2));
  return { output, result };
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
