import { copyFile, mkdir, readFile, rename, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { CSV_COLUMNS, toCsv } from "./artvee-ingest.mjs";
import { artworkDedupeKey } from "./museum-api-ingest.mjs";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined)
      throw new Error(`Invalid argument near ${name || "end"}`);
    options[name.slice(2)] = value;
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeAtomic(filePath, body) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, body, "utf8");
  await rename(temporaryPath, filePath);
}

function dedupeKey(row) {
  return artworkDedupeKey(
    row.title_en || row.title || row.title_cn || "",
    row.artist || row.artist_display || "",
  );
}

function evidenceSourceKey(record) {
  const source = record?.source || {};
  const provider = source.provider || source.name || source.institution || "";
  const identifier = source.object_id || source.record_id || source.object_url || source.url || "";
  return provider && identifier ? `${provider}|${identifier}` : "";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const required = [
    "run-dir",
    "artvee-checkpoint",
    "museum-checkpoint",
    "existing-index",
    "start",
    "count",
  ];
  for (const name of required) if (!options[name]) throw new Error(`--${name} is required`);

  const runDir = path.resolve(options["run-dir"]);
  const artveeCheckpointPath = path.resolve(options["artvee-checkpoint"]);
  const museumCheckpointPath = path.resolve(options["museum-checkpoint"]);
  const existingIndexPath = path.resolve(options["existing-index"]);
  const start = Number.parseInt(options.start, 10);
  const count = Number.parseInt(options.count, 10);
  const end = start + count - 1;
  const artvee = await readJson(artveeCheckpointPath);
  const museum = await readJson(museumCheckpointPath);
  const existing = await readJson(existingIndexPath);

  if (museum.status !== "completed")
    throw new Error(`Museum fill is not completed: ${museum.status}`);
  const rows = [...(artvee.rows || []), ...(museum.rows || [])];
  const evidence = [...(artvee.evidenceRows || []), ...(museum.evidence || [])];
  if (rows.length !== count || evidence.length !== count) {
    throw new Error(
      `Expected ${count} combined rows/evidence, got ${rows.length}/${evidence.length}`,
    );
  }

  const ids = rows.map((row) => Number.parseInt(row.id, 10));
  if (!ids.every((number, index) => number === start + index)) {
    throw new Error(`Combined IDs are not continuous from ${start} to ${end}`);
  }
  if (!rows.every((row) => CSV_COLUMNS.every((column) => Object.hasOwn(row, column)))) {
    throw new Error("At least one row does not use the strict ten-column schema.");
  }

  const semanticKeys = rows.map(dedupeKey);
  if (semanticKeys.some((key) => !key))
    throw new Error("At least one combined row has an empty semantic key.");
  if (new Set(semanticKeys).size !== semanticKeys.length)
    throw new Error("Combined batch has an internal semantic duplicate.");

  const existingRows = Array.isArray(existing)
    ? existing
    : existing.artworks || existing.rows || existing.documents || [];
  const existingKeys = new Set(existingRows.map(dedupeKey).filter(Boolean));
  const externalDuplicates = semanticKeys.filter((key) => existingKeys.has(key));
  if (externalDuplicates.length)
    throw new Error(
      `Combined batch has ${externalDuplicates.length} external semantic duplicates.`,
    );

  const sourceKeys = evidence.map(evidenceSourceKey);
  if (sourceKeys.some((key) => !key))
    throw new Error("At least one evidence record has an empty source key.");
  if (new Set(sourceKeys).size !== sourceKeys.length)
    throw new Error("Combined batch has duplicate source records.");

  const imageFiles = (await readdir(path.join(runDir, "images"))).filter((name) =>
    /\.(?:jpg|jpeg|png|webp)$/i.test(name),
  );
  if (imageFiles.length !== count)
    throw new Error(`Expected ${count} images, found ${imageFiles.length}`);
  for (let number = start; number <= end; number += 1) {
    if (!imageFiles.includes(`${number}_standard.jpg`))
      throw new Error(`Missing image ${number}_standard.jpg`);
  }

  const badAttributions = evidence.filter(
    (record) =>
      record?.source?.provider === "aic" &&
      /^(After|Attributed to|Circle of|Follower of|School of|Workshop of|Studio of|Manner of)\b/i.test(
        String(record?.raw?.artist_display || "")
          .split(/\r?\n/, 1)[0]
          .trim(),
      ),
  );
  if (badAttributions.length)
    throw new Error(`Found ${badAttributions.length} disallowed attribution records.`);

  const csvPath = path.join(runDir, `hybrid-artworks-${start}-${end}.csv`);
  const evidencePath = path.join(runDir, `hybrid-artworks-${start}-${end}.evidence.jsonl`);
  const reportPath = path.join(runDir, `hybrid-artworks-${start}-${end}.verification.json`);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const backupDir = path.join(runDir, `_pre-hybrid-finalize-backup-${timestamp}`);
  await mkdir(backupDir, { recursive: true });
  await copyFile(artveeCheckpointPath, path.join(backupDir, path.basename(artveeCheckpointPath)));
  await copyFile(
    museumCheckpointPath,
    path.join(backupDir, `museum-${path.basename(museumCheckpointPath)}`),
  );

  artvee.rows = rows;
  artvee.evidenceRows = evidence;
  artvee.nextNumber = end + 1;
  artvee.status = "completed";
  artvee.outputPath = csvPath;
  artvee.evidencePath = evidencePath;
  artvee.updatedAt = new Date().toISOString();
  artvee.hybridFill = {
    provider: "museum-open-apis",
    artveeRows: rows.length - museum.rows.length,
    museumRows: museum.rows.length,
    museumCheckpoint: museumCheckpointPath,
    finalizedAt: artvee.updatedAt,
  };

  const report = {
    status: "passed",
    start,
    end,
    rows: rows.length,
    evidence: evidence.length,
    images: imageFiles.length,
    strictColumns: CSV_COLUMNS,
    nonEmptySemanticKeys: semanticKeys.length,
    internalSemanticDuplicates: 0,
    externalSemanticDuplicates: 0,
    sourceDuplicates: 0,
    badAttributions: 0,
    artveeRows: artvee.hybridFill.artveeRows,
    museumRows: artvee.hybridFill.museumRows,
    csvPath,
    evidencePath,
    backupDir,
    verifiedAt: artvee.updatedAt,
  };

  await writeAtomic(csvPath, `\uFEFF${toCsv(rows)}`);
  await writeAtomic(
    evidencePath,
    `${evidence.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  await writeAtomic(artveeCheckpointPath, `${JSON.stringify(artvee, null, 2)}\n`);
  await writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
