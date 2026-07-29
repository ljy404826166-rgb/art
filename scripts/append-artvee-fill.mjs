import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCsvRow, CSV_COLUMNS, parseArtworkPage, toCsv } from "./artvee-ingest.mjs";
import { artworkDedupeKey } from "./museum-api-ingest.mjs";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith("--")) throw new Error(`Unexpected argument: ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    options[name.slice(2)] = value;
    index += 1;
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

function rowsFromIndex(index) {
  if (Array.isArray(index)) return index;
  return index.artworks || index.documents || index.rows || index.items || [];
}

function rowKey(row) {
  return artworkDedupeKey(
    row.title_en || row.titleEn || row.title || "",
    row.artist || row.artist_en || row.artistEn || "",
  );
}

function assertJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
    throw new Error("Candidate image is not a JPEG.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const required = [
    "batch-dir",
    "candidate-dir",
    "fresh-html",
    "database-index",
    "previous-checkpoint",
    "museum-history",
    "artvee-history",
    "id",
    "artist-rank",
  ];
  for (const name of required) {
    if (!options[name]) throw new Error(`--${name} is required`);
  }

  const batchDir = path.resolve(options["batch-dir"]);
  const candidateDir = path.resolve(options["candidate-dir"]);
  const checkpointPath = path.join(batchDir, "checkpoint.json");
  const checkpoint = await readJson(checkpointPath);
  const idNumber = Number.parseInt(options.id, 10);
  const id = `${idNumber}_standard`;
  const destinationImage = path.join(batchDir, "images", `${id}.jpg`);
  const candidateImage = path.join(candidateDir, "images", `${id}.jpg`);
  const html = await readFile(path.resolve(options["fresh-html"]), "utf8");
  const sourceUrl = options["source-url"] || "https://artvee.com/dl/margate/";
  const artwork = parseArtworkPage(html, sourceUrl, {
    title: options.title || "",
    artist: options.artist || "",
  });
  const row = buildCsvRow(artwork, idNumber, null);
  const semanticKey = artworkDedupeKey(row.title_en, row.artist);
  const sourceKey = `artvee:${artwork.sourceRecordId || sourceUrl}`;

  if (!semanticKey) throw new Error("Candidate does not have a non-empty semantic dedupe key.");
  if (checkpoint.status !== "running")
    throw new Error(`Expected running checkpoint, got ${checkpoint.status}`);
  if (checkpoint.rows?.length !== 199 || checkpoint.evidence?.length !== 199) {
    throw new Error(
      `Expected 199 rows/evidence records, got ${checkpoint.rows?.length}/${checkpoint.evidence?.length}`,
    );
  }
  if (checkpoint.nextNumber !== idNumber) {
    throw new Error(`Expected nextNumber ${idNumber}, got ${checkpoint.nextNumber}`);
  }
  if (checkpoint.rows.some((existing) => existing.id === id))
    throw new Error(`${id} already exists`);
  if (CSV_COLUMNS.some((column) => !(column in row)))
    throw new Error("Candidate does not have the strict ten-column schema.");

  const previousCheckpoint = await readJson(path.resolve(options["previous-checkpoint"]));
  const databaseIndex = await readJson(path.resolve(options["database-index"]));
  const museumHistory = await readJson(path.resolve(options["museum-history"]));
  const existingRows = [
    ...checkpoint.rows,
    ...(previousCheckpoint.rows || []),
    ...rowsFromIndex(databaseIndex),
  ];
  if (existingRows.some((existing) => rowKey(existing) === semanticKey)) {
    throw new Error(`Semantic duplicate detected: ${semanticKey}`);
  }
  if ((museumHistory.semanticKeys || []).includes(semanticKey)) {
    throw new Error(`Museum history duplicate detected: ${semanticKey}`);
  }

  const imageBuffer = await readFile(candidateImage);
  assertJpeg(imageBuffer);
  if ((await stat(candidateImage)).size < 100_000)
    throw new Error("Candidate image is unexpectedly small.");
  try {
    await stat(destinationImage);
    throw new Error(`Destination image already exists: ${destinationImage}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const evidence = {
    schema_version: 1,
    source: {
      institution: "Artvee",
      provider: "artvee",
      object_id: artwork.sourceRecordId || "",
      object_url: sourceUrl,
      api_rights: artwork.license || "Public domain",
    },
    priority_artist: {
      rank: Number.parseInt(options["artist-rank"], 10),
      name: "J. M. W. Turner",
      slug: "joseph-mallord-william-turner",
      score: null,
    },
    canonical_fingerprint: createHash("sha256").update(semanticKey).digest("hex"),
    image: {
      id,
      asset_name: `${id}.jpg`,
      source_url: artwork.downloadUrl || artwork.imageUrl || "",
      local_path: destinationImage,
    },
    raw: {
      title: artwork.titleEn || "",
      artist: artwork.artist || "",
      year_text: artwork.yearAndPlace || "",
      collection: artwork.location || "",
      license: artwork.license || "",
      tags: artwork.tags || [],
      image_pixel_dimensions: artwork.dimensions || "",
      hd_image_pixel_dimensions: artwork.hdDimensions || "",
      artvee_image_key: artwork.artveeImageKey || "",
    },
  };

  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const backupDir = path.join(batchDir, `_pre-artvee-fill-backup-${timestamp}`);
  await mkdir(backupDir, { recursive: true });
  for (const filePath of [
    checkpointPath,
    checkpoint.outputCsv,
    checkpoint.evidenceJsonl,
    options["museum-history"],
  ]) {
    await copyFile(path.resolve(filePath), path.join(backupDir, path.basename(filePath)));
  }

  await copyFile(candidateImage, destinationImage);
  checkpoint.rows.push(row);
  checkpoint.evidence.push(evidence);
  checkpoint.processedKeys = [...new Set([...(checkpoint.processedKeys || []), sourceKey])];
  checkpoint.nextNumber = idNumber + 1;
  checkpoint.status = "completed";
  checkpoint.updatedAt = new Date().toISOString();
  checkpoint.artveeFill = {
    id,
    sourceUrl,
    semanticKey,
    addedAt: checkpoint.updatedAt,
  };

  museumHistory.processedKeys = [...new Set([...(museumHistory.processedKeys || []), sourceKey])];
  museumHistory.semanticKeys = [...new Set([...(museumHistory.semanticKeys || []), semanticKey])];
  museumHistory.updatedAt = checkpoint.updatedAt;

  const artveeHistoryPath = path.resolve(options["artvee-history"]);
  const artveeHistory = await readJson(artveeHistoryPath);
  artveeHistory.urls = [
    ...new Set([...(artveeHistory.urls || artveeHistory.processedSourceUrls || []), sourceUrl]),
  ];
  artveeHistory.updatedAt = checkpoint.updatedAt;

  await writeAtomic(checkpoint.outputCsv, `\uFEFF${toCsv(checkpoint.rows)}`);
  await writeAtomic(
    checkpoint.evidenceJsonl,
    `${checkpoint.evidence.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  await writeAtomic(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  await writeAtomic(options["museum-history"], `${JSON.stringify(museumHistory, null, 2)}\n`);
  await writeAtomic(artveeHistoryPath, `${JSON.stringify(artveeHistory, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        status: checkpoint.status,
        id,
        title: row.title_en,
        artist: row.artist,
        semanticKey,
        rows: checkpoint.rows.length,
        evidence: checkpoint.evidence.length,
        nextNumber: checkpoint.nextNumber,
        imageBytes: imageBuffer.length,
        backupDir,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
