import {
  createSupabaseClient,
  describeMode,
  isEligibleImageRow,
  manifestRowForImageRow,
  parseArgs,
  writeJson,
} from "./image-derivatives-shared.mjs";

const DEFAULT_OUTPUT = "image-derivatives-manifest-pilot.json";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = args.output || DEFAULT_OUTPUT;
  const { supabase, supabaseUrl } = createSupabaseClient();

  const { data, error } = await supabase
    .from("artwork_images")
    .select("id,artwork_id,image_id,thumbnail_url,display_url,download_url,created_at")
    .order("created_at", { ascending: false })
    .limit(args.limit);

  if (error) {
    throw new Error(`Failed to read artwork_images: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  const eligibleRows = rows.filter(isEligibleImageRow);
  const manifestRows = eligibleRows.map((row) =>
    manifestRowForImageRow(row, {
      supabaseUrl,
      bucket: args.bucket,
    }),
  );

  const manifest = {
    kind: "image-derivatives-manifest",
    version: 1,
    mode: describeMode(args.dryRun),
    generatedAt: new Date().toISOString(),
    bucket: args.bucket,
    limit: args.limit,
    scannedCount: rows.length,
    eligibleCount: eligibleRows.length,
    rows: manifestRows,
  };

  const absoluteOutput = writeJson(output, manifest);
  console.log(
    JSON.stringify(
      {
        mode: manifest.mode,
        output: absoluteOutput,
        scannedCount: manifest.scannedCount,
        eligibleCount: manifest.eligibleCount,
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
