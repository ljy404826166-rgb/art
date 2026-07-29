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

function requiredArg(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return value;
}

const runDir = path.resolve(requiredArg("--run-dir"));
const start = Number(requiredArg("--start"));
if (!Number.isSafeInteger(start) || start < 1)
  throw new Error("--start must be a positive integer.");

const checkpointPath = path.join(runDir, "checkpoint.json");
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
if (checkpoint.status !== "running")
  throw new Error(`Checkpoint must be running, got ${checkpoint.status}.`);
if (!checkpoint.rows?.length || checkpoint.rows.length !== checkpoint.evidence?.length) {
  throw new Error("Checkpoint row/evidence counts are invalid.");
}

const backupDir = path.join(
  runDir,
  `_renumber-backup-${checkpoint.rows[0].id.replace("_standard", "")}`,
);
if (fs.existsSync(backupDir)) throw new Error(`Backup already exists: ${backupDir}`);
fs.mkdirSync(backupDir, { recursive: true });
for (const filePath of [checkpointPath, checkpoint.outputCsv, checkpoint.evidenceJsonl]) {
  fs.copyFileSync(filePath, path.join(backupDir, path.basename(filePath)));
}

const imagesDir = path.join(runDir, "images");
for (let index = 0; index < checkpoint.rows.length; index += 1) {
  const oldId = checkpoint.rows[index].id;
  const newId = `${start + index}_standard`;
  const oldImage = path.join(imagesDir, `${oldId}.jpg`);
  const newImage = path.join(imagesDir, `${newId}.jpg`);
  if (!fs.existsSync(oldImage)) throw new Error(`Missing source image: ${oldImage}`);
  if (fs.existsSync(newImage) && oldImage !== newImage)
    throw new Error(`Target image already exists: ${newImage}`);
  if (oldImage !== newImage) fs.renameSync(oldImage, newImage);

  checkpoint.rows[index].id = newId;
  const evidence = checkpoint.evidence[index];
  evidence.image.id = newId;
  evidence.image.asset_name = `${newId}.jpg`;
  evidence.image.local_path = newImage;
}

checkpoint.nextNumber = start + checkpoint.rows.length;
checkpoint.updatedAt = new Date().toISOString();
writeCsv(checkpoint.outputCsv, checkpoint.rows);
fs.writeFileSync(
  checkpoint.evidenceJsonl,
  `${checkpoint.evidence.map((row) => JSON.stringify(row)).join("\n")}\n`,
  "utf8",
);
fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
process.stdout.write(
  JSON.stringify(
    {
      status: "renumbered",
      rows: checkpoint.rows.length,
      firstId: checkpoint.rows[0].id,
      lastId: checkpoint.rows.at(-1).id,
      nextNumber: checkpoint.nextNumber,
      backupDir,
    },
    null,
    2,
  ),
);
