#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { artworkDedupeKey } from "./museum-api-ingest.mjs";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return path.resolve(value);
};

const checkpointPath = arg("--checkpoint");
const historyPath = arg("--history");
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
if (checkpoint.status !== "completed")
  throw new Error("Only a completed checkpoint can seed history.");
const history = fs.existsSync(historyPath)
  ? JSON.parse(fs.readFileSync(historyPath, "utf8"))
  : { version: 1, processedKeys: [], semanticKeys: [] };
const semanticKeys = checkpoint.rows
  .map((row) => artworkDedupeKey(row.title_en, row.artist))
  .filter(Boolean);
if (semanticKeys.length !== checkpoint.rows.length)
  throw new Error("Every checkpoint row must produce a dedupe key.");
history.version = 1;
history.processedKeys = [
  ...new Set([...(history.processedKeys || []), ...(checkpoint.processedKeys || [])]),
];
history.semanticKeys = [...new Set([...(history.semanticKeys || []), ...semanticKeys])];
history.updatedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
process.stdout.write(
  JSON.stringify(
    {
      processedKeys: history.processedKeys.length,
      semanticKeys: history.semanticKeys.length,
    },
    null,
    2,
  ),
);
