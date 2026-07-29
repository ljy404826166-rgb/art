import {
  createSupabaseClient,
  describeMode,
  parseArgs,
  readJson,
  updatePayloadForManifestRow,
  writeJson,
} from "./image-derivatives-shared.mjs";

const DEFAULT_ROLLBACK_OUTPUT = "image-derivatives-rollback-pilot.json";

function rollbackRowForManifestRow(row) {
  return {
    artworkImageId: row.artworkImageId,
    previousThumbnailUrl: row.currentThumbnailUrl,
    previousDisplayUrl: row.currentDisplayUrl,
    previousDownloadUrl: row.currentDownloadUrl,
    appliedThumbnailUrl: row.thumbnailPublicUrl,
    appliedDisplayUrl: row.displayPublicUrl,
    appliedAt: new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    throw new Error("--input is required");
  }

  const uploadManifest = readJson(args.input);
  const rows = Array.isArray(uploadManifest.rows)
    ? uploadManifest.rows.filter((row) => row.readyForDbUpdate).slice(0, args.limit)
    : [];
  const rollbackOutput = args.rollbackOutput || DEFAULT_ROLLBACK_OUTPUT;
  const rollback = {
    kind: "image-derivatives-rollback",
    version: 1,
    mode: describeMode(args.dryRun),
    generatedAt: new Date().toISOString(),
    sourceManifest: args.input,
    rows: rows.map(rollbackRowForManifestRow),
  };
  const absoluteRollbackOutput = writeJson(rollbackOutput, rollback);
  let updatedCount = 0;

  if (!args.dryRun && rows.length > 0) {
    const { supabase } = createSupabaseClient();
    for (const row of rows) {
      const payload = updatePayloadForManifestRow(row);
      const { error } = await supabase
        .from("artwork_images")
        .update({
          thumbnail_url: payload.thumbnail_url,
          display_url: payload.display_url,
        })
        .eq("id", payload.id);
      if (error) {
        throw new Error(`Failed to update artwork_images ${payload.id}: ${error.message}`);
      }
      updatedCount += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: describeMode(args.dryRun),
        rollbackOutput: absoluteRollbackOutput,
        candidateCount: rows.length,
        updatedCount,
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
