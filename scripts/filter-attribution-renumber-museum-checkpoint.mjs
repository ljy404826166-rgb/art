#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const fields = [
  "id",
  "title_cn",
  "title_en",
  "artist",
  "location",
  "year_and_place",
  "medium",
  "dimensions",
  "description",
  "tags",
];
const attributionPrefix =
  /^(after|attributed to|circle of|follower of|school of|workshop of|studio of|manner of|possibly|formerly attributed)/i;

function requiredArg(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return value;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const body = [
    fields.join(","),
    ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(",")),
  ].join("\r\n");
  fs.writeFileSync(filePath, `\uFEFF${body}\r\n`, "utf8");
}

const runDir = path.resolve(requiredArg("--run-dir"));
const start = Number(requiredArg("--start"));
if (!Number.isSafeInteger(start) || start < 1) throw new Error("--start must be positive.");
const checkpointPath = path.join(runDir, "checkpoint.json");
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
if (checkpoint.rows.length !== checkpoint.evidence.length)
  throw new Error("Row/evidence count mismatch.");

const backupDir = path.join(
  runDir,
  `_attribution-filter-backup-${checkpoint.rows.length}-${Date.now()}`,
);
const removedDir = path.join(backupDir, "removed-images");
const workDir = path.join(runDir, "_attribution-renumber-work");
fs.mkdirSync(removedDir, { recursive: true });
fs.mkdirSync(workDir, { recursive: true });
for (const filePath of [checkpointPath, checkpoint.outputCsv, checkpoint.evidenceJsonl]) {
  fs.copyFileSync(filePath, path.join(backupDir, path.basename(filePath)));
}

const kept = [];
const removed = [];
for (let index = 0; index < checkpoint.rows.length; index += 1) {
  const row = checkpoint.rows[index];
  const evidence = checkpoint.evidence[index];
  const primaryDisplay = String(evidence.raw?.artist_display || "").trim();
  const ineligible = evidence.source.provider === "aic" && attributionPrefix.test(primaryDisplay);
  (ineligible ? removed : kept).push({ row, evidence, oldId: row.id });
}

const imagesDir = path.join(runDir, "images");
for (let index = 0; index < kept.length; index += 1) {
  fs.renameSync(
    path.join(imagesDir, `${kept[index].oldId}.jpg`),
    path.join(workDir, `${index}.jpg`),
  );
}
for (const record of removed) {
  fs.renameSync(
    path.join(imagesDir, `${record.oldId}.jpg`),
    path.join(removedDir, `${record.oldId}.jpg`),
  );
}
for (let index = 0; index < kept.length; index += 1) {
  const newId = `${start + index}_standard`;
  const newImage = path.join(imagesDir, `${newId}.jpg`);
  fs.renameSync(path.join(workDir, `${index}.jpg`), newImage);
  kept[index].row.id = newId;
  kept[index].evidence.image.id = newId;
  kept[index].evidence.image.asset_name = `${newId}.jpg`;
  kept[index].evidence.image.local_path = newImage;
}
fs.rmdirSync(workDir);

checkpoint.status = "running";
checkpoint.rows = kept.map((record) => record.row);
checkpoint.evidence = kept.map((record) => record.evidence);
checkpoint.skippedAttribution = [
  ...(checkpoint.skippedAttribution || []),
  ...removed.map((record) => ({
    source_key: `${record.evidence.source.provider}:${record.evidence.source.object_id}`,
    title_en: record.row.title_en,
    artist: record.row.artist,
    removed_id: record.oldId,
  })),
];
checkpoint.nextNumber = start + kept.length;
checkpoint.updatedAt = new Date().toISOString();
writeCsv(checkpoint.outputCsv, checkpoint.rows);
fs.writeFileSync(
  checkpoint.evidenceJsonl,
  `${checkpoint.evidence.map((row) => JSON.stringify(row)).join("\n")}\n`,
  "utf8",
);
fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
fs.writeFileSync(
  path.join(backupDir, "removed.json"),
  `${JSON.stringify(
    removed.map((record) => ({
      id: record.oldId,
      title_en: record.row.title_en,
      artist: record.row.artist,
      source: record.evidence.source,
    })),
    null,
    2,
  )}\n`,
  "utf8",
);
process.stdout.write(
  JSON.stringify(
    {
      original: kept.length + removed.length,
      kept: kept.length,
      removed: removed.length,
      firstId: checkpoint.rows[0]?.id || "",
      lastId: checkpoint.rows.at(-1)?.id || "",
      nextNumber: checkpoint.nextNumber,
      backupDir,
    },
    null,
    2,
  ),
);
