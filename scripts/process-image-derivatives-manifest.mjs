import {
  createSupabaseClient,
  describeMode,
  parseArgs,
  readJson,
  writeJson,
} from "./image-derivatives-shared.mjs";

const DEFAULT_OUTPUT = "image-derivatives-upload-result-pilot.json";

async function loadSharp() {
  try {
    const module = await import("sharp");
    return module.default;
  } catch {
    throw new Error("Missing optional dependency sharp. Install it before processing derivatives.");
  }
}

async function downloadImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function makeWebp(buffer, { width }) {
  const sharp = await loadSharp();
  return sharp(buffer)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
}

async function uploadDerivative({ supabase, bucket, objectPath, buffer, dryRun }) {
  if (dryRun) {
    return { uploaded: false, skipped: true, reason: "dry-run" };
  }
  const { error } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
    contentType: "image/webp",
    upsert: false,
  });
  if (error) {
    return { uploaded: false, skipped: true, reason: error.message };
  }
  return { uploaded: true, skipped: false, reason: "" };
}

async function processRow({ row, supabase, bucket, dryRun }) {
  const result = {
    ...row,
    thumbnailUpload: { uploaded: false, skipped: false, reason: "" },
    displayUpload: { uploaded: false, skipped: false, reason: "" },
    readyForDbUpdate: false,
  };

  try {
    const sourceBuffer = await downloadImageBuffer(row.sourceUrl);
    const thumbnailBuffer = await makeWebp(sourceBuffer, { width: 420 });
    const displayBuffer = await makeWebp(sourceBuffer, { width: 1440 });

    result.thumbnailUpload = await uploadDerivative({
      supabase,
      bucket,
      objectPath: row.thumbnailObjectPath,
      buffer: thumbnailBuffer,
      dryRun,
    });
    result.displayUpload = await uploadDerivative({
      supabase,
      bucket,
      objectPath: row.displayObjectPath,
      buffer: displayBuffer,
      dryRun,
    });
    result.readyForDbUpdate = result.thumbnailUpload.uploaded && result.displayUpload.uploaded;
  } catch (error) {
    result.error = error.message;
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    throw new Error("--input is required");
  }

  const manifest = readJson(args.input);
  const rows = Array.isArray(manifest.rows) ? manifest.rows.slice(0, args.limit) : [];
  const output = args.output || DEFAULT_OUTPUT;
  const { supabase } = createSupabaseClient();
  const results = [];

  for (const row of rows) {
    results.push(
      await processRow({
        row,
        supabase,
        bucket: manifest.bucket || args.bucket,
        dryRun: args.dryRun,
      }),
    );
  }

  const processedManifest = {
    kind: "image-derivatives-upload-result",
    version: 1,
    mode: describeMode(args.dryRun),
    generatedAt: new Date().toISOString(),
    sourceManifest: args.input,
    bucket: manifest.bucket || args.bucket,
    processedCount: results.length,
    uploadedCount: results.filter((row) => row.readyForDbUpdate).length,
    rows: results,
  };

  const absoluteOutput = writeJson(output, processedManifest);
  console.log(
    JSON.stringify(
      {
        mode: processedManifest.mode,
        output: absoluteOutput,
        processedCount: processedManifest.processedCount,
        uploadedCount: processedManifest.uploadedCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
