import test from "node:test";
import assert from "node:assert/strict";

import {
  CSV_COLUMNS,
  buildCsvRow,
  buildCloudbaseArtworkDocument,
  buildGeminiRequestBody,
  buildGeminiResearchRequestBody,
  buildRawEvidenceRecord,
  buildListingUrl,
  buildArtistPriorityEntries,
  buildFamousSearchQueries,
  selectFamousCandidates,
  collectListingTarget,
  extractArtistsFromHtml,
  buildOpenAIRequestBody,
  buildCheckpointState,
  extractListingsFromHtml,
  extractMaxStorageNumber,
  formatProgressLine,
  formatAssetName,
  isRetriableGeminiStatus,
  isArtveeMaintenancePage,
  mergeProcessedSourceUrls,
  nextStorageNumberFromMaxes,
  normalizeGeneratedMetadata,
  parseArgs,
  parseRobotsTxt,
  parseArtworkPage,
  resolveGeminiApiKey,
  shouldPauseBeforeAi,
  shouldTreatArtistPageErrorAsEnd,
  tencentCosObjectKey,
  tencentCosPublicUrl,
  uploadImageWithRetry,
  toCsv,
} from "./artvee-ingest.mjs";

test("artist pagination ends only on explicit 404 responses", () => {
  assert.equal(shouldTreatArtistPageErrorAsEnd(new Error("Fetch failed 404 Not Found"), 1), true);
  assert.equal(shouldTreatArtistPageErrorAsEnd(new Error("fetch failed"), 8), false);
  assert.equal(shouldTreatArtistPageErrorAsEnd(new Error("UND_ERR_CONNECT_TIMEOUT"), 2), false);
  assert.equal(shouldTreatArtistPageErrorAsEnd(new Error("This operation was aborted"), 1), false);
});

test("maintenance HTML is rejected instead of being cached as artwork metadata", () => {
  assert.equal(isArtveeMaintenancePage("<title>Site Under Maintenance</title>"), true);
  assert.equal(
    isArtveeMaintenancePage("Our website is currently undergoing scheduled maintenance."),
    true,
  );
  assert.equal(isArtveeMaintenancePage("<title>Margate - Artvee</title>"), false);
});

test("parseArgs supports random, search, and popular count commands", () => {
  const random = parseArgs(["random", "5"]);
  assert.deepEqual(random.command, "random");
  assert.equal(random.count, 5);
  assert.equal(random.provider, "gemini");
  assert.equal(random.model, "gemini-2.5-flash-lite");
  assert.equal(random.delayMs, 35000);
  assert.deepEqual(random.pageDelayMs, [5000, 12000]);
  assert.deepEqual(random.imageDelayMs, [25000, 45000]);
  assert.equal(random.htmlLimitPerHour, 180);
  assert.equal(random.imageLimitPerHour, 0);
  assert.equal(random.maxArtworkPagesPerRun, 70);
  assert.equal(random.maxImagesPerRun, 200);
  assert.equal(random.timeoutMs, 15000);
  assert.equal(random.maxRetries, 1);
  assert.equal(random.robotsTxt, true);
  assert.equal(random.cache, true);
  assert.equal(random.resume, true);
  assert.equal(random.progress, true);
  assert.equal(random.useAI, false);
  assert.equal(random.upload, false);
  assert.equal(random.database, false);

  const search = parseArgs(["search", "van gogh", "10", "--dry-run"]);
  assert.equal(search.command, "search");
  assert.equal(search.keyword, "van gogh");
  assert.equal(search.count, 10);
  assert.equal(search.dryRun, true);

  assert.equal(parseArgs(["popular", "15"]).count, 15);

  const openai = parseArgs([
    "popular",
    "15",
    "--with-ai",
    "--provider",
    "openai",
    "--model",
    "gpt-5.4-mini",
  ]);
  assert.equal(openai.provider, "openai");
  assert.equal(openai.model, "gpt-5.4-mini");
  assert.equal(openai.useAI, true);

  const legacyDb = parseArgs(["search", "monet", "5", "--db"]);
  assert.equal(legacyDb.upload, false);
  assert.equal(legacyDb.database, false);
  assert.equal(legacyDb.legacyDatabaseRequested, true);

  const legacySupabaseUpload = parseArgs(["search", "monet", "5", "--supabase-upload"]);
  assert.equal(legacySupabaseUpload.upload, false);
  assert.equal(legacySupabaseUpload.storageTarget, "none");
  assert.equal(legacySupabaseUpload.legacySupabaseUploadRequested, true);
});

test("parseArgs rejects direct Tencent COS and CloudBase publishing from ingest", () => {
  assert.throws(
    () =>
      parseArgs([
        "search",
        "monet",
        "5",
        "--cos-upload",
        "--cloudbase-db",
        "--cos-bucket",
        "masterpiece-1437223579",
        "--cos-region",
        "ap-beijing",
        "--cos-prefix",
        "ppaintings",
        "--cloudbase-env-id",
        "cloudbase-d6gvny27ib05e0ede",
      ]),
    /reviewed publish step/,
  );

  const dryRun = parseArgs(["search", "monet", "5", "--cos-upload", "--cloudbase-db", "--dry-run"]);
  assert.equal(dryRun.upload, false);
  assert.equal(dryRun.database, false);
  assert.equal(dryRun.storageTarget, "none");
  assert.equal(dryRun.databaseTarget, "none");
  assert.equal(dryRun.useAI, false);
});

test("parseArgs supports raw evidence output path", () => {
  const options = parseArgs([
    "search",
    "monet",
    "5",
    "--evidence-output",
    "D:\\art\\csv\\review\\monet.evidence.jsonl",
  ]);

  assert.equal(options.evidenceOutput, "D:\\art\\csv\\review\\monet.evidence.jsonl");
  assert.equal(options.upload, false);
  assert.equal(options.database, false);
});

test("Tencent COS helpers build stable object keys and public URLs", () => {
  const options = {
    cosBucket: "masterpiece-1437223579",
    cosRegion: "ap-beijing",
    cosPrefix: "ppaintings",
    cosDomain: "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com",
  };

  assert.equal(tencentCosObjectKey("001_standard.jpg", options), "ppaintings/001_standard.jpg");
  assert.equal(
    tencentCosPublicUrl("ppaintings/001_standard.jpg", options),
    "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com/ppaintings/001_standard.jpg",
  );
});

test("CloudBase artwork document uses COS original and derivative URLs", () => {
  const doc = buildCloudbaseArtworkDocument(
    {
      sourceUrl: "https://artvee.com/dl/example/",
      sourceRecordId: "80705",
      license: "Public domain",
      artveeImageKey: "abc",
      imageUrl: "https://mdl.artvee.com/ft/abc.jpg",
      downloadUrl: "https://mdl.artvee.com/sdl/abc.jpg",
      popularity: 10,
    },
    {
      id: "001_standard",
      title_cn: "示例作品",
      title_en: "Example Work",
      artist: "Example Artist",
      location: "Example Museum",
      year_and_place: "1900",
      medium: "Oil on canvas",
      dimensions: "10 x 20 cm",
      description: "Description",
      tags: "TagA,TagB,TagC,TagD",
    },
    "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com/ppaintings/001_standard.jpg",
    "001_standard.jpg",
    {
      status: "published",
      cosDomain: "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com",
      cosPrefix: "ppaintings",
    },
  );

  assert.equal(doc._id, "artwork_001_standard");
  assert.equal(doc.source_record_id, "80705");
  assert.equal(doc.image_id, "001_standard");
  assert.equal(
    doc.thumbnail_url,
    "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com/ppaintings/derivatives/thumb/001_standard.webp",
  );
  assert.equal(
    doc.display_url,
    "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com/ppaintings/derivatives/display/001_standard.webp",
  );
  assert.equal(
    doc.download_url,
    "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com/ppaintings/001_standard.jpg",
  );
  assert.deepEqual(doc.tag_keys, ["TagA", "TagB", "TagC", "TagD"]);
  assert.equal(doc.sync_target, "cloudbase");
});

test("raw evidence record preserves Artvee facts without pretending they are reviewed metadata", () => {
  const record = buildRawEvidenceRecord(
    {
      sourceUrl: "https://artvee.com/dl/example/",
      sourceRecordId: "80705",
      titleEn: "Example Work",
      artist: "Example Artist",
      location: "Artvee Collection",
      yearAndPlace: "1900",
      medium: "JPG",
      dimensions: "1200 x 900 px",
      tags: ["Landscape", "Public domain"],
      pageText: "Example Work Example Artist Public domain Illustration",
      imageUrl: "https://example.com/preview.jpg",
      downloadUrl: "https://example.com/download.jpg",
      license: "Public domain",
      popularity: 10,
      artveeImageKey: "abc",
      hdDimensions: "2400 x 1800 px",
    },
    { id: "001_standard" },
    "001_standard.jpg",
    "D:\\art\\csv\\images\\001_standard.jpg",
  );

  assert.equal(record.schema_version, 1);
  assert.equal(record.review_status, "pending");
  assert.equal(record.source.name, "Artvee");
  assert.equal(record.source.record_id, "80705");
  assert.equal(record.raw.title_en, "Example Work");
  assert.equal(record.raw.image_pixel_dimensions, "1200 x 900 px");
  assert.equal(record.raw.file_format, "JPG");
  assert.equal(
    record.raw.page_text_excerpt,
    "Example Work Example Artist Public domain Illustration",
  );
  assert.deepEqual(record.verified_sources, []);
  assert.equal(record.image.asset_name, "001_standard.jpg");
  assert.equal(record.image.local_path, "D:\\art\\csv\\images\\001_standard.jpg");
  assert.equal(record.reviewed_metadata.title_cn, "");
  assert.deepEqual(record.reviewed_metadata.tags, []);
});

test("parseArgs supports artist page commands", () => {
  const byUrl = parseArgs(["artist", "https://artvee.com/artist/leonardo-da-vinci/", "17"]);
  assert.equal(byUrl.command, "artist");
  assert.equal(byUrl.artistUrl, "https://artvee.com/artist/leonardo-da-vinci/");
  assert.equal(byUrl.count, 17);

  const bySlug = parseArgs(["artist", "leonardo-da-vinci", "17"]);
  assert.equal(bySlug.artistUrl, "https://artvee.com/artist/leonardo-da-vinci/");
});

test("parseArgs supports artist directory commands", () => {
  const options = parseArgs(["artists", "30"]);
  assert.equal(options.command, "artists");
  assert.equal(options.count, 30);
  assert.equal(options.artistsUrl, "https://artvee.com/artists/");
  assert.equal(options.artistStart, 1);
  assert.equal(options.perArtist, 0);

  const custom = parseArgs([
    "artists",
    "10",
    "--artist-start",
    "3",
    "--per-artist",
    "2",
    "--artists-url",
    "https://artvee.com/artists/",
  ]);
  assert.equal(custom.artistStart, 3);
  assert.equal(custom.perArtist, 2);
});

test("parseArgs supports ranked artist priority commands", () => {
  const options = parseArgs(["artists-priority", "50"]);
  assert.equal(options.command, "artists-priority");
  assert.equal(options.count, 50);
  assert.match(options.artistPriorityList, /artist-priority\.json$/);
  assert.equal(options.artistStart, 1);
  assert.equal(options.perArtist, 0);

  const custom = parseArgs([
    "artists-priority",
    "20",
    "--artist-start",
    "4",
    "--scan-artist-start",
    "19",
    "--per-artist",
    "3",
    "--artist-priority-list",
    "D:\\art\\data\\custom-artists.json",
  ]);
  assert.equal(custom.artistStart, 4);
  assert.equal(custom.scanArtistStart, 19);
  assert.equal(custom.perArtist, 3);
  assert.equal(custom.artistPriorityList, "D:\\art\\data\\custom-artists.json");
});

test("buildArtistPriorityEntries sorts by rank and removes duplicate artist URLs", () => {
  const entries = buildArtistPriorityEntries([
    { rank: 2, name: "Vincent van Gogh", slug: "vincent-van-gogh", score: 99 },
    { rank: 1, name: "Leonardo da Vinci", slug: "leonardo-da-vinci", score: 100 },
    {
      rank: 3,
      name: "Duplicate Leonardo",
      url: "https://artvee.com/artist/leonardo-da-vinci/",
      score: 1,
    },
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["Leonardo da Vinci", "Vincent van Gogh"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.url),
    ["https://artvee.com/artist/leonardo-da-vinci/", "https://artvee.com/artist/vincent-van-gogh/"],
  );
});

test("parseArgs supports famous cold-start commands", () => {
  const options = parseArgs(["famous", "25"]);
  assert.equal(options.command, "famous");
  assert.equal(options.count, 25);
  assert.match(options.famousList, /famous-artworks\.json$/);

  const custom = parseArgs(["famous", "10", "--famous-list", "D:\\art\\data\\my-famous.json"]);
  assert.equal(custom.famousList, "D:\\art\\data\\my-famous.json");
});

test("parseArgs supports disabling resume and progress", () => {
  const options = parseArgs(["search", "van gogh", "25", "--no-resume", "--no-progress"]);
  assert.equal(options.resume, false);
  assert.equal(options.progress, false);
});

test("parseArgs accepts polite crawler overrides", () => {
  const options = parseArgs([
    "search",
    "monet",
    "50",
    "--page-delay-ms",
    "8000-20000",
    "--image-delay-ms=30000-60000",
    "--html-limit-per-hour",
    "120",
    "--image-limit-per-hour",
    "30",
    "--max-artwork-pages-per-run",
    "100",
    "--max-images-per-run",
    "30",
    "--timeout-ms",
    "20000",
    "--max-retries",
    "2",
    "--no-robots",
    "--no-cache",
    "--cache-dir",
    "D:\\art\\csv\\.cache-test",
  ]);

  assert.deepEqual(options.pageDelayMs, [8000, 20000]);
  assert.deepEqual(options.imageDelayMs, [30000, 60000]);
  assert.equal(options.htmlLimitPerHour, 120);
  assert.equal(options.imageLimitPerHour, 30);
  assert.equal(options.maxArtworkPagesPerRun, 100);
  assert.equal(options.maxImagesPerRun, 30);
  assert.equal(options.timeoutMs, 20000);
  assert.equal(options.maxRetries, 2);
  assert.equal(options.robotsTxt, false);
  assert.equal(options.cache, false);
  assert.match(options.cacheDir, /cache-test$/);
});

test("default raw metadata mode does not call AI and preserves crawlable website fields", () => {
  const options = parseArgs(["search", "van gogh", "5"]);
  assert.equal(options.useAI, false);
  assert.equal(shouldPauseBeforeAi(options), false);

  const row = buildCsvRow(
    {
      titleEn: "Van Gogh Painting Sunflowers",
      artist: "Paul Gauguin",
      location: "Post-Impressionism",
      yearAndPlace: "1888",
      medium: "JPG",
      dimensions: "1800 x 1370px",
      tags: ["Post-Impressionism", "Figurative"],
    },
    138,
    null,
  );

  assert.equal(row.id, "138_standard");
  assert.equal(row.title_cn, "暂不明确");
  assert.equal(row.title_en, "Van Gogh Painting Sunflowers");
  assert.equal(row.artist, "Paul Gauguin");
  assert.equal(row.location, "Post-Impressionism");
  assert.equal(row.year_and_place, "1888");
  assert.equal(row.medium, "暂不明确");
  assert.equal(row.dimensions, "暂不明确");
  assert.equal(row.description, "暂不明确");
  assert.equal(row.tags, "Post-Impressionism,Figurative,暂不明确,暂不明确");
});

test("Gemini defaults require an environment key and pause before model calls", () => {
  assert.equal(resolveGeminiApiKey({}), "");
  assert.equal(resolveGeminiApiKey({ GEMINI_API_KEY: "from-env" }), "from-env");
  assert.equal(resolveGeminiApiKey({ GOOGLE_API_KEY: "from-google-env" }), "from-google-env");
  assert.equal(shouldPauseBeforeAi({ provider: "gemini", useAI: true, delayMs: 35000 }), true);
  assert.equal(shouldPauseBeforeAi({ provider: "openai", useAI: true, delayMs: 35000 }), false);
  assert.equal(shouldPauseBeforeAi({ provider: "gemini", useAI: false, delayMs: 35000 }), false);
});

test("buildListingUrl matches Artvee list URL patterns", () => {
  assert.equal(
    buildListingUrl({ command: "random", page: 2, perPage: 30 }),
    "https://artvee.com/page/2/?orderby=random_order&per_page=30",
  );
  assert.equal(
    buildListingUrl({ command: "search", keyword: "van gogh", page: 1, perPage: 30 }),
    "https://artvee.com/main/?s=van+gogh&per_page=30",
  );
  assert.equal(
    buildListingUrl({ command: "popular", page: 3, perPage: 30 }),
    "https://artvee.com/page/3/?orderby=popularity&per_page=30",
  );
  assert.equal(
    buildListingUrl({
      command: "famous",
      keyword: "mona lisa leonardo da vinci",
      page: 1,
      perPage: 30,
    }),
    "https://artvee.com/main/?s=mona+lisa+leonardo+da+vinci&per_page=30",
  );
  assert.equal(
    buildListingUrl({
      command: "artist",
      artistUrl: "https://artvee.com/artist/leonardo-da-vinci/",
      page: 1,
      perPage: 30,
    }),
    "https://artvee.com/artist/leonardo-da-vinci/?per_page=30",
  );
  assert.equal(
    buildListingUrl({
      command: "artist",
      artistUrl: "https://artvee.com/artist/leonardo-da-vinci/",
      page: 2,
      perPage: 30,
    }),
    "https://artvee.com/artist/leonardo-da-vinci/page/2/?per_page=30",
  );
});

test("extractArtistsFromHtml preserves Artvee artist directory order", () => {
  const html = `
    <div class="wrapp-catti"><a href="https://artvee.com/artist/alphonse-mucha/">
      <h3><span>Alphonse Mucha</span><mark class="count">Czech, 203 Items</mark></h3></a></div>
    <a href="https://artvee.com/artist/alphonse-mucha/" class="category-link"></a>
    <div class="wrapp-catti"><a href="https://artvee.com/artist/henri-matisse/">
      <h3><span>Henri Matisse</span><mark class="count">French, 238 Items</mark></h3></a></div>
  `;
  assert.deepEqual(extractArtistsFromHtml(html), [
    {
      url: "https://artvee.com/artist/alphonse-mucha/",
      name: "Alphonse Mucha",
      countText: "Czech, 203 Items",
    },
    {
      url: "https://artvee.com/artist/henri-matisse/",
      name: "Henri Matisse",
      countText: "French, 238 Items",
    },
  ]);
});

test("listing collection reserves enough candidates to replace skipped existing artworks", () => {
  assert.equal(collectListingTarget({ command: "search", count: 50 }), 150);
  assert.equal(collectListingTarget({ command: "random", count: 10 }), 40);
  assert.equal(collectListingTarget({ command: "popular", count: 15 }), 45);
  assert.equal(collectListingTarget({ command: "famous", count: 15 }), 60);
});

test("famous search queries prioritize canonical cold-start artworks", () => {
  const queries = buildFamousSearchQueries([
    { query: "lesser known work", priority: 10 },
    { query: "mona lisa leonardo da vinci", priority: 100 },
    { query: "starry night van gogh", priority: 99 },
  ]);
  assert.deepEqual(queries.slice(0, 3), [
    "mona lisa leonardo da vinci",
    "starry night van gogh",
    "lesser known work",
  ]);
});

test("famous search queries preserve curation order for equal priorities", () => {
  const queries = buildFamousSearchQueries([
    { query: "mona lisa leonardo da vinci", priority: 100 },
    { query: "starry night van gogh", priority: 100 },
    { query: "girl with a pearl earring vermeer", priority: 100 },
  ]);
  assert.deepEqual(queries.slice(0, 3), [
    "mona lisa leonardo da vinci",
    "starry night van gogh",
    "girl with a pearl earring vermeer",
  ]);
});

test("famous candidates limit repeated artists and repeated series in fallback", () => {
  const candidates = [
    {
      title: "The Great Wave",
      artist: "Katsushika Hokusai",
      url: "https://artvee.com/dl/great-wave/",
      popularity: 20,
    },
    {
      title: "Album of Sketches by Katsushika Hokusai and His Disciples Pl.20",
      artist: "Katsushika Hokusai",
      url: "https://artvee.com/dl/hokusai-20/",
      popularity: 30,
    },
    {
      title: "Album of Sketches by Katsushika Hokusai and His Disciples Pl.16",
      artist: "Katsushika Hokusai",
      url: "https://artvee.com/dl/hokusai-16/",
      popularity: 30,
    },
    {
      title: "Album of Sketches by Katsushika Hokusai and His Disciples Pl.17",
      artist: "Katsushika Hokusai",
      url: "https://artvee.com/dl/hokusai-17/",
      popularity: 30,
    },
    {
      title: "Mona Lisa",
      artist: "Leonardo da Vinci",
      url: "https://artvee.com/dl/mona-lisa/",
      popularity: 10,
    },
    {
      title: "The Last Supper",
      artist: "Leonardo da Vinci",
      url: "https://artvee.com/dl/last-supper/",
      popularity: 10,
    },
    {
      title: "Vitruvian Man",
      artist: "Leonardo da Vinci",
      url: "https://artvee.com/dl/vitruvian-man/",
      popularity: 10,
    },
    {
      title: "La Gioconda",
      artist: "Follower of Leonardo da Vinci",
      url: "https://artvee.com/dl/la-gioconda/",
      popularity: 10,
    },
  ];

  const selected = selectFamousCandidates(candidates, {
    query: "hokusai",
    maxArtistPerRun: 3,
    maxSeriesPerRun: 2,
  });

  assert.equal(selected.filter((item) => /Hokusai/i.test(item.artist)).length, 3);
  assert.equal(selected.filter((item) => /Album of Sketches/i.test(item.title)).length, 2);
  assert.equal(
    selected.some((item) => item.title === "The Great Wave"),
    true,
  );
});

test("famous candidates demote non-original related images behind exact classic matches", () => {
  const selected = selectFamousCandidates(
    [
      {
        title: "Leonardo da Vinci, Mona Lisa",
        artist: "Cercle Francais d'Art",
        url: "https://artvee.com/dl/repro/",
        popularity: 50,
      },
      {
        title: "The Mona Lisa",
        artist: "Leonardo da Vinci",
        url: "https://artvee.com/dl/original/",
        popularity: 1,
      },
      {
        title: "Mona Lisa",
        artist: "Follower of Leonardo da Vinci",
        url: "https://artvee.com/dl/follower/",
        popularity: 30,
      },
    ],
    { query: "mona lisa leonardo da vinci" },
  );

  assert.equal(selected[0].url, "https://artvee.com/dl/original/");
});

test("famous candidates skip unrelated fallback when a canonical work phrase is missing", () => {
  const selected = selectFamousCandidates(
    [
      {
        title: "Album of Sketches by Katsushika Hokusai and His Disciples Pl.20",
        artist: "Katsushika Hokusai",
        url: "https://artvee.com/dl/hokusai-20/",
        popularity: 30,
      },
    ],
    { query: "the great wave hokusai" },
  );

  assert.equal(selected.length, 0);
});

test("famous candidates require canonical phrases for specific cold-start works", () => {
  assert.equal(
    selectFamousCandidates(
      [
        {
          title:
            "A sculpture of the same man reading, tearing a man in half, and giving another man a coin",
          artist: "William Henry Walker",
          url: "x",
        },
      ],
      { query: "vitruvian man leonardo da vinci" },
    ).length,
    0,
  );

  assert.equal(
    selectFamousCandidates(
      [
        {
          title: "Military and Navy; The Constable of the Tower",
          artist: "Leslie Matthew Ward",
          url: "x",
        },
      ],
      { query: "the hay wain constable" },
    ).length,
    0,
  );

  assert.equal(
    selectFamousCandidates([{ title: "The Hay Wain", artist: "John Constable", url: "x" }], {
      query: "the hay wain constable",
    }).length,
    1,
  );
});

test("default crawl cap allows two hundred images per run", () => {
  const options = parseArgs(["famous", "200"]);
  assert.equal(options.maxImagesPerRun, 200);
});

test("extractListingsFromHtml reads Artvee product cards", () => {
  const html = `
    <div class="product-grid-item product">
      <div class="product-element-top product-image-link pttl tbmc linko"
        data-cnt="311"
        data-id="80705"
        data-sk="{&quot;sdlimagesize&quot;:&quot;1800 x 1433px&quot;,&quot;sk&quot;:&quot;211013fg&quot;}"
        data-url="/dl/vincent-van-gogh-painting-sunflowers">
        <img alt="Vincent van Gogh painting sunflowers" src="https://mdl.artvee.com/ft/211013fg.jpg" />
      </div>
      <div class="pbm"><div><h3 class="product-title"><a href="https://artvee.com/dl/vincent-van-gogh-painting-sunflowers/">Vincent van Gogh painting sunflowers</a></h3></div>
      <div class="woodmart-product-brands-links"><a>Paul Gauguin</a> (French, 1848-1903)</div>
      <div class="woodmart-product-cats"><a>Figurative</a></div></div>
    </div>`;

  const listings = extractListingsFromHtml(html, "https://artvee.com/main/?s=van+gogh");
  assert.equal(listings.length, 1);
  assert.equal(listings[0].url, "https://artvee.com/dl/vincent-van-gogh-painting-sunflowers/");
  assert.equal(listings[0].sourceRecordId, "80705");
  assert.equal(listings[0].popularity, 311);
  assert.equal(listings[0].dimensions, "1800 x 1433px");
  assert.deepEqual(listings[0].tags, ["Figurative"]);
});

test("parseArtworkPage extracts detail metadata and standard download URL", () => {
  const html = `
    <meta property="og:image" content="https://mdl.artvee.com/sftb/22227po.jpg">
    <h1 itemprop="name" class="product_title entry-title"><a href="https://artvee.com/dl/help-yourself-9/">Help Yourself (1934-1943) </a></h1>
    <div class="tartist"><div class="woodmart-product-brands-links"><a>Anonymous</a></div></div>
    <h3 class="media-heading"><span>Standard, 1132 x 1800px</span><span>JPG, Size: 1.76 MB</span></h3>
    <a class="prem-link gr btn dis sdl" data-title="Help Yourself" rel="nofollow" href="https://mdl.artvee.com/sdl/22227posdl.jpg?sig=abc">Download</a>
    <h6><span>License: </span>All public domain files can be freely used for personal and commercial projects.</h6>
    <h2>In Collection: Federal Theatre Project <a>(View all 1212)</a></h2>
  `;

  const artwork = parseArtworkPage(html, "https://artvee.com/dl/help-yourself-9/");
  assert.equal(artwork.titleEn, "Help Yourself");
  assert.equal(artwork.yearAndPlace, "1934-1943");
  assert.equal(artwork.artist, "Anonymous");
  assert.equal(artwork.dimensions, "1132 x 1800px");
  assert.equal(artwork.medium, "JPG");
  assert.equal(artwork.downloadUrl, "https://mdl.artvee.com/sdl/22227posdl.jpg?sig=abc");
  assert.equal(artwork.location, "Federal Theatre Project");
});

test("CSV output keeps the sample column order and escaping", () => {
  assert.deepEqual(CSV_COLUMNS, [
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
  ]);

  const csv = toCsv([
    {
      id: "136_standard",
      title_cn: "A, B",
      title_en: 'A "B"',
      artist: "Anon",
      location: "",
      year_and_place: "1900",
      medium: "JPG",
      dimensions: "100 x 200px",
      description: "描述",
      tags: "Landscape,Public domain",
    },
  ]);

  assert.match(
    csv,
    /^id,title_cn,title_en,artist,location,year_and_place,medium,dimensions,description,tags\r?\n/,
  );
  assert.match(csv, /"A, B","A ""B"""/);
});

test("model metadata supplies the full sample-shaped CSV row", () => {
  const generated = normalizeGeneratedMetadata({
    title_cn: "麦田",
    title_en: "Wheat Field",
    artist: "文森特·梵高 (Vincent van Gogh)",
    location: "私人收藏 (Private Collection)",
    year_and_place: "1888年，法国阿尔勒",
    medium: "布面油画 (Oil on canvas)",
    dimensions: "暂不明确",
    description: "这是一段由模型生成的作品简介。",
    tags: ["后印象派", "1880年代", "风景画", "油画", "现代艺术", "重复", "重复", "多余标签"],
  });
  assert.deepEqual(generated.tags, ["后印象派", "1880年代", "风景画", "油画", "现代艺术", "重复"]);

  const row = buildCsvRow(
    {
      titleCn: "Wheat Field",
      titleEn: "Wheat Field",
      artist: "Vincent van Gogh",
      location: "",
      yearAndPlace: "1888",
      medium: "JPG",
      dimensions: "1800 x 1370px",
      tags: ["Artvee raw category"],
    },
    138,
    generated,
  );

  assert.equal(row.title_cn, "麦田");
  assert.equal(row.title_en, "Wheat Field");
  assert.equal(row.artist, "文森特·梵高 (Vincent van Gogh)");
  assert.equal(row.location, "私人收藏 (Private Collection)");
  assert.equal(row.year_and_place, "1888年，法国阿尔勒");
  assert.equal(row.medium, "布面油画 (Oil on canvas)");
  assert.equal(row.dimensions, "暂不明确");
  assert.equal(row.description, "这是一段由模型生成的作品简介。");
  assert.equal(row.tags, "后印象派,1880年代,风景画,油画,现代艺术,重复");
});

test("missing or ungrounded fields use unclear instead of copying English or image metadata", () => {
  const generated = normalizeGeneratedMetadata(
    {
      description: "这是一段由模型生成的作品简介。",
      tags: ["公共领域"],
    },
    {
      titleEn: "Omslagontwerp voor Vincent Van Gogh",
      artist: "Richard Nicolaüs Roland Holst",
      location: "",
      yearAndPlace: "",
      medium: "JPG",
      dimensions: "1800 x 1665px",
      tags: [],
    },
  );
  const row = buildCsvRow(
    {
      titleEn: "Omslagontwerp voor Vincent Van Gogh",
      artist: "Richard Nicolaüs Roland Holst",
      medium: "JPG",
      dimensions: "1800 x 1665px",
    },
    1,
    generated,
  );

  assert.equal(row.id, "001_standard");
  assert.equal(row.title_cn, "暂不明确");
  assert.equal(row.title_en, "Omslagontwerp voor Vincent Van Gogh");
  assert.equal(row.location, "暂不明确");
  assert.equal(row.year_and_place, "暂不明确");
  assert.equal(row.medium, "暂不明确");
  assert.equal(row.dimensions, "暂不明确");
});

test("generated description is capped to the requested CSV length", () => {
  const generated = normalizeGeneratedMetadata({
    title_cn: "测试作品",
    title_en: "Test Work",
    artist: "测试艺术家 (Test Artist)",
    location: "暂不明确",
    year_and_place: "暂不明确",
    medium: "暂不明确",
    dimensions: "暂不明确",
    description: "这".repeat(430),
    tags: ["标签一", "标签二", "标签三", "标签四"],
  });

  assert.equal(generated.description.length <= 400, true);
  assert.equal(generated.description.length > 300, true);
});

test("OpenAI request uses structured output schema for all CSV metadata", () => {
  const body = buildOpenAIRequestBody(
    {
      titleEn: "Wheat Field",
      titleCn: "Wheat Field",
      artist: "Vincent van Gogh",
      yearAndPlace: "1888",
      tags: ["Landscape"],
      sourceUrl: "https://artvee.com/dl/wheat-field-2/",
      dimensions: "1800 x 1370px",
      license: "Public domain",
    },
    { model: "gpt-5.4-mini" },
  );

  assert.equal(body.model, "gpt-5.4-mini");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "artwork_metadata");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.required, [
    "title_cn",
    "title_en",
    "artist",
    "location",
    "year_and_place",
    "medium",
    "dimensions",
    "description",
    "tags",
  ]);
  assert.equal(body.text.format.schema.properties.title_cn.type, "string");
  assert.equal(body.text.format.schema.properties.tags.minItems, 4);
  assert.equal(body.text.format.schema.properties.tags.maxItems, 6);
});

test("Gemini research request uses Google Search grounding without JSON mode", () => {
  const body = buildGeminiResearchRequestBody({
    titleEn: "Wheat Field",
    artist: "Vincent van Gogh",
    sourceUrl: "https://artvee.com/dl/wheat-field-2/",
  });

  assert.deepEqual(body.tools, [{ google_search: {} }]);
  assert.equal(body.generationConfig?.responseMimeType, undefined);
  assert.match(body.contents[0].parts[0].text, /可验证/);
});

test("Gemini request asks for full CSV JSON without tools", () => {
  const body = buildGeminiRequestBody({
    titleEn: "Wheat Field",
    titleCn: "Wheat Field",
    artist: "Vincent van Gogh",
    yearAndPlace: "1888",
    tags: ["Landscape"],
    sourceUrl: "https://artvee.com/dl/wheat-field-2/",
    dimensions: "1800 x 1370px",
    license: "Public domain",
  });

  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.tools, undefined);
  assert.deepEqual(body.generationConfig.responseSchema.required, [
    "title_cn",
    "title_en",
    "artist",
    "location",
    "year_and_place",
    "medium",
    "dimensions",
    "description",
    "tags",
  ]);
  assert.equal(body.generationConfig.responseSchema.additionalProperties, undefined);
  assert.equal(body.generationConfig.responseSchema.properties.title_cn.type, "STRING");
  assert.equal(body.generationConfig.responseSchema.properties.tags.minItems, 4);
  assert.equal(body.generationConfig.responseSchema.properties.tags.maxItems, 6);
  assert.match(body.contents[0].parts[0].text, /4-6/);
});

test("storage numbering continues from current Supabase object names", () => {
  assert.equal(formatAssetName(1), "001_standard.jpg");
  assert.equal(formatAssetName(136), "136_standard.jpg");
  assert.equal(
    extractMaxStorageNumber([
      { name: "099_standard.jpg" },
      { name: "135_standard.jpg" },
      { name: "notes.txt" },
    ]),
    135,
  );
  assert.equal(nextStorageNumberFromMaxes(886, 921, 820), 922);
});

test("Gemini high-demand and quota responses are retriable", () => {
  assert.equal(isRetriableGeminiStatus(429), true);
  assert.equal(isRetriableGeminiStatus(503), true);
  assert.equal(isRetriableGeminiStatus(400), false);
});

test("progress line renders a terminal-visible stage and count", () => {
  const line = formatProgressLine({
    current: 12,
    total: 50,
    stage: "downloading image",
    width: 20,
  });
  assert.match(line, /12\/50/);
  assert.match(line, /24%/);
  assert.match(line, /downloading image/);
  assert.match(line, /\[[#-]{20}\]/);
});

test("checkpoint state preserves output, rows, and processed source urls", () => {
  const state = buildCheckpointState({
    options: parseArgs(["search", "van gogh", "3"]),
    outputPath: "D:/art/csv/test.csv",
    rows: [{ id: "001_standard" }, { id: "002_standard" }],
    processedSourceUrls: new Set(["https://artvee.com/dl/a/", "https://artvee.com/dl/b/"]),
    nextNumber: 3,
    imagesThisRun: 2,
    status: "running",
  });

  assert.equal(state.outputPath, "D:/art/csv/test.csv");
  assert.equal(state.rows.length, 2);
  assert.deepEqual(state.processedSourceUrls, [
    "https://artvee.com/dl/a/",
    "https://artvee.com/dl/b/",
  ]);
  assert.equal(state.nextNumber, 3);
  assert.equal(state.status, "running");
});

test("processed source URL history merges and de-duplicates across runs", () => {
  const merged = mergeProcessedSourceUrls(
    ["https://artvee.com/dl/a/", "https://artvee.com/dl/b/"],
    new Set(["https://artvee.com/dl/b/", "https://artvee.com/dl/c/"]),
  );
  assert.deepEqual(
    [...merged],
    ["https://artvee.com/dl/a/", "https://artvee.com/dl/b/", "https://artvee.com/dl/c/"],
  );
});

test("robots parser reads disallow rules and crawl delay for matching agents", () => {
  const parsed = parseRobotsTxt(
    `
    User-agent: other
    Disallow: /other
    Crawl-delay: 99

    User-agent: *
    Disallow: /private
    Crawl-delay: 12
  `,
    "ArtArchiveDataBuilder/0.1",
  );

  assert.deepEqual(parsed.disallow, ["/private"]);
  assert.equal(parsed.crawlDelayMs, 12000);
});

test("uploadImageWithRetry retries upload failures and returns a non-throwing result", async () => {
  let attempts = 0;
  const messages = [];
  const result = await uploadImageWithRetry(
    null,
    "artwork",
    "304_standard.jpg",
    { buffer: Buffer.from("x") },
    {
      maxRetries: 2,
      retryDelayMs: 1,
      uploadFn: async () => {
        attempts += 1;
        throw new Error("fetch failed");
      },
      sleepFn: async () => {},
      logFn: (message) => messages.push(message),
    },
  );

  assert.equal(attempts, 3);
  assert.equal(result.uploaded, false);
  assert.equal(result.publicUrl, "");
  assert.equal(result.error, "fetch failed");
  assert.match(messages.at(-1), /continuing without Storage upload/);
});
