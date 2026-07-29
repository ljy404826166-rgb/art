import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CloudBase from "@cloudbase/manager-node";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_OUTPUT_DIR = path.resolve("outputs/recommendation-system/task-06");
const DEFAULT_RELEASE_DIR = path.resolve("outputs/recommendation-system/task-05");
const REQUIRED_INDEXES = {
  artworks: [
    "status_recommendation_random_id",
    "status_signal_random_id",
    "status_artist_random_id",
    "status_tag_random_id",
    "status_classification_created_id",
  ],
  recommendation_channels: ["status_auto_priority"],
};
const REQUIRED_PERMISSIONS = {
  recommendation_signals: "READONLY",
  recommendation_channels: "READONLY",
  artwork_recommendation_signal_links: "PRIVATE",
};
const CHANNEL_SOURCE_TYPE_BY_QUERY_FIELD = {
  classification_ids: "classification",
  tag_ids: "controlled_metadata",
  artist_ids: "artist",
  recommendation_signal_ids: "recommendation_signal",
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "")).filter(Boolean))];
}

function duplicates(rows) {
  const seen = new Set();
  const repeated = new Set();
  rows.forEach((row) => {
    const id = String(row?._id || "");
    if (!id) return;
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  });
  return [...repeated].sort();
}

function difference(left, right) {
  const rightSet = right instanceof Set ? right : new Set(right);
  return [...left].filter((value) => !rightSet.has(value)).sort();
}

function sameIds(actual, expected) {
  const actualIds = new Set(actual.map((row) => String(row._id)));
  const expectedIds = new Set(expected.map((row) => String(row._id)));
  return {
    missing: difference(expectedIds, actualIds),
    unexpected: difference(actualIds, expectedIds),
  };
}

function channelArtworkCount(channel, eligibleArtworks) {
  const field = String(channel.query_field || "");
  const value = String(channel.query_value || "");
  if (!field || !value) return 0;
  return eligibleArtworks.filter((artwork) => asArray(artwork[field]).includes(value)).length;
}

function checkClientContract(clientSource) {
  return {
    uses_pure_channel_title: /\btitle:\s*channel\.title\b/.test(clientSource),
    ignores_legacy_composite_title: !/\btitle:\s*channel\.display_title\b/.test(clientSource),
    pages_channel_catalog:
      /fetchRecommendationChannels[\s\S]*for\s*\(let skip[\s\S]*\.skip\(skip\)/.test(clientSource),
    preserves_legacy_fallback:
      /fetchRecommendationChannels\(\{ limit:\s*200 \}\)\.catch\(\(\) => \[\]\)/.test(clientSource),
  };
}

export function auditRecommendationProduction({
  artworks,
  artists,
  vocabTerms,
  tagLinks,
  artistLinks,
  signals,
  channels,
  signalLinks,
  release,
  indexes = {},
  permissions = {},
  clientSource = "",
}) {
  const datasets = {
    artworks,
    vocabTerms,
    tagLinks,
    artistLinks,
    signals,
    channels,
    signalLinks,
  };
  const artworkIds = new Set(artworks.map((row) => String(row._id)));
  const artistIds = new Set(artists.map((row) => String(row._id)));
  const termIds = new Set(vocabTerms.map((row) => String(row._id)));
  const signalIds = new Set(signals.map((row) => String(row._id)));
  const eligibleArtworks = artworks.filter(
    (artwork) => artwork.status === "published" && artwork.recommendation_status === "eligible",
  );
  const publishedArtworks = artworks.filter((artwork) => artwork.status === "published");
  const artistById = new Map(artists.map((artist) => [String(artist._id), artist]));
  const artistChannelIds = new Set(
    channels
      .filter((channel) => channel.kind === "artist")
      .map((channel) => String(channel.query_value)),
  );
  const referencedReviewedPeople = new Set(
    eligibleArtworks
      .flatMap((artwork) => asArray(artwork.artist_ids))
      .filter((artistId) => {
        const artist = artistById.get(String(artistId));
        return artist?.entity_type === "person" && artist?.review_status === "reviewed";
      })
      .map(String),
  );
  const datasetIds = {};
  Object.entries(datasets).forEach(([key, rows]) => {
    datasetIds[key] = sameIds(rows, release[key] || []);
  });
  const duplicateIds = {};
  Object.entries(datasets).forEach(([key, rows]) => {
    duplicateIds[key] = duplicates(rows);
  });
  const channelCountMismatches = channels
    .map((channel) => ({
      channel_id: channel._id,
      expected: Number(channel.artwork_count || 0),
      actual: channelArtworkCount(channel, eligibleArtworks),
    }))
    .filter((row) => row.expected !== row.actual);
  const clientContract = checkClientContract(clientSource);
  const missingIndexes = Object.fromEntries(
    Object.entries(REQUIRED_INDEXES).map(([collection, required]) => [
      collection,
      difference(new Set(required), new Set(indexes[collection] || [])),
    ]),
  );
  const permissionMismatches = Object.entries(REQUIRED_PERMISSIONS)
    .filter(([collection, expected]) => permissions[collection] !== expected)
    .map(([collection, expected]) => ({
      collection,
      expected,
      actual: permissions[collection] || "",
    }));

  const checks = {
    duplicate_ids: duplicateIds,
    release_id_mismatches: datasetIds,
    published_artwork_version_mismatches: publishedArtworks
      .filter(
        (artwork) =>
          artwork.classification_version !== "classification-v7" ||
          artwork.taxonomy_version !== "controlled-vocabulary-v2" ||
          artwork.recommendation_signal_version !== "recommendation-signals-v1" ||
          artwork.recommendation_random_version !== "fnv1a-v1" ||
          artwork.release_version !== "recommendation-system-v1",
      )
      .map((artwork) => artwork._id),
    published_artwork_recommendation_mismatches: publishedArtworks
      .filter((artwork) => artwork.recommendation_status !== "eligible")
      .map((artwork) => artwork._id),
    invalid_random_buckets: publishedArtworks
      .filter(
        (artwork) =>
          !Number.isSafeInteger(artwork.random_bucket) ||
          artwork.random_bucket < 0 ||
          artwork.random_bucket >= 10000,
      )
      .map((artwork) => artwork._id),
    orphan_tag_links: tagLinks
      .filter((link) => !artworkIds.has(String(link.artwork_id)))
      .map((link) => link._id),
    unknown_tag_ids: unique(
      tagLinks.filter((link) => !termIds.has(String(link.tag_id))).map((link) => link.tag_id),
    ),
    orphan_artist_links: artistLinks
      .filter((link) => !artworkIds.has(String(link.artwork_id)))
      .map((link) => link._id),
    unknown_artist_ids: unique(
      artistLinks
        .filter((link) => !artistIds.has(String(link.artist_id)))
        .map((link) => link.artist_id),
    ),
    orphan_signal_links: signalLinks
      .filter((link) => !artworkIds.has(String(link.artwork_id)))
      .map((link) => link._id),
    unknown_signal_ids: unique(
      signalLinks
        .filter((link) => !signalIds.has(String(link.signal_id)))
        .map((link) => link.signal_id),
    ),
    channel_title_mismatches: channels
      .filter((channel) => channel.display_title !== channel.title)
      .map((channel) => channel._id),
    channel_count_mismatches: channelCountMismatches,
    invalid_channel_queries: channels
      .filter(
        (channel) =>
          !["classification_ids", "tag_ids", "artist_ids", "recommendation_signal_ids"].includes(
            channel.query_field,
          ) || !String(channel.query_value || ""),
      )
      .map((channel) => channel._id),
    invalid_channel_source_types: channels
      .filter(
        (channel) =>
          channel.source_type !== CHANNEL_SOURCE_TYPE_BY_QUERY_FIELD[channel.query_field],
      )
      .map((channel) => channel._id),
    recommendation_signals_in_classification: signals
      .filter((signal) => signal.classification_filter !== false)
      .map((signal) => signal._id),
    missing_artist_channels: difference(referencedReviewedPeople, artistChannelIds),
    missing_indexes: missingIndexes,
    permission_mismatches: permissionMismatches,
    client_contract: clientContract,
  };

  const arrayChecks = [
    ...Object.values(duplicateIds),
    ...Object.values(datasetIds).flatMap((value) => [value.missing, value.unexpected]),
    checks.published_artwork_version_mismatches,
    checks.published_artwork_recommendation_mismatches,
    checks.invalid_random_buckets,
    checks.orphan_tag_links,
    checks.unknown_tag_ids,
    checks.orphan_artist_links,
    checks.unknown_artist_ids,
    checks.orphan_signal_links,
    checks.unknown_signal_ids,
    checks.channel_title_mismatches,
    checks.channel_count_mismatches,
    checks.invalid_channel_queries,
    checks.invalid_channel_source_types,
    checks.recommendation_signals_in_classification,
    checks.missing_artist_channels,
    ...Object.values(missingIndexes),
    checks.permission_mismatches,
  ];
  const ok =
    arrayChecks.every((values) => values.length === 0) &&
    Object.values(clientContract).every(Boolean);
  return {
    counts: {
      artworks: artworks.length,
      published_artworks: publishedArtworks.length,
      recommendation_eligible_artworks: eligibleArtworks.length,
      artists: artists.length,
      vocab_terms: vocabTerms.length,
      tag_links: tagLinks.length,
      artist_links: artistLinks.length,
      signals: signals.length,
      channels: channels.length,
      auto_feature_channels: channels.filter((channel) => channel.auto_feature_eligible).length,
      artist_channels: artistChannelIds.size,
      signal_links: signalLinks.length,
    },
    checks,
    ok,
  };
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

function environment() {
  return {
    ...parseEnvFile(path.resolve(".env")),
    ...parseEnvFile(path.resolve(".env.local")),
    ...process.env,
  };
}

function client(envId, config = environment()) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("Missing Tencent Cloud credentials.");
  return CloudBase.init({ envId, secretId, secretKey });
}

function normalizeExtendedJson(value) {
  if (Array.isArray(value)) return value.map(normalizeExtendedJson);
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$numberInt") return Number(value.$numberInt);
  if (keys.length === 1 && keys[0] === "$numberLong") return Number(value.$numberLong);
  if (keys.length === 1 && keys[0] === "$numberDouble") return Number(value.$numberDouble);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeExtendedJson(child)]),
  );
}

function parseCommandRows(data) {
  return JSON.parse(data || "[]").map((row) => normalizeExtendedJson(JSON.parse(row)));
}

async function withRetry(operation, label, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw new Error(`${label} failed: ${lastError.message}`, { cause: lastError });
}

async function queryCollection(database, collection) {
  const rows = [];
  const pageSize = 500;
  for (let skip = 0; ; skip += pageSize) {
    const result = await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "QUERY",
              Command: JSON.stringify({
                find: collection,
                filter: {},
                skip,
                limit: pageSize,
              }),
            },
          ],
        }),
      `query ${collection} at ${skip}`,
    );
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readRelease(releaseDir) {
  return {
    artworks: readJsonl(path.join(releaseDir, "release-artworks.jsonl")),
    vocabTerms: readJsonl(path.join(releaseDir, "release-vocab-terms.jsonl")),
    tagLinks: readJsonl(path.join(releaseDir, "release-artwork-tag-links.jsonl")),
    artistLinks: readJsonl(path.join(releaseDir, "release-artwork-artist-links.jsonl")),
    signals: readJsonl(path.join(releaseDir, "release-recommendation-signals.jsonl")),
    channels: readJsonl(path.join(releaseDir, "release-recommendation-channels.jsonl")),
    signalLinks: readJsonl(
      path.join(releaseDir, "release-artwork-recommendation-signal-links.jsonl"),
    ),
  };
}

function markdown(report) {
  const countRows = Object.entries(report.counts)
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join("\n");
  return `# 推荐体系生产审计（任务六）

生成时间：${report.generated_at}

环境：\`${report.env_id}\`

结论：${report.ok ? "通过" : "未通过"}

## 数量

| 项目 | 数量 |
|---|---:|
${countRows}

## 门禁

- 数据集 ID 与发布清单一致：${Object.values(report.checks.release_id_mismatches).every(
    (value) => !value.missing.length && !value.unexpected.length,
  )}
- 已发布作品版本完整：${report.checks.published_artwork_version_mismatches.length === 0}
- 关系表无孤儿或未知引用：${[
    report.checks.orphan_tag_links,
    report.checks.unknown_tag_ids,
    report.checks.orphan_artist_links,
    report.checks.unknown_artist_ids,
    report.checks.orphan_signal_links,
    report.checks.unknown_signal_ids,
  ].every((values) => values.length === 0)}
- 频道标题语义分离：${report.checks.channel_title_mismatches.length === 0}
- 频道作品数量一致：${report.checks.channel_count_mismatches.length === 0}
- 频道来源类型明确：${report.checks.invalid_channel_source_types.length === 0}
- 推荐信号未污染严格分类：${report.checks.recommendation_signals_in_classification.length === 0}
- 每位合格画家均有独立频道：${report.checks.missing_artist_channels.length === 0}
- 查询索引完整：${Object.values(report.checks.missing_indexes).every(
    (values) => values.length === 0,
  )}
- 权限符合设计：${report.checks.permission_mismatches.length === 0}
- 客户端契约完整：${Object.values(report.checks.client_contract).every(Boolean)}
`;
}

export async function runAudit({
  envId = PRODUCTION_ENV_ID,
  releaseDir = DEFAULT_RELEASE_DIR,
  outputDir = DEFAULT_OUTPUT_DIR,
} = {}) {
  const app = client(envId);
  const datasets = {};
  for (const [key, collection] of [
    ["artworks", "artworks"],
    ["artists", "artists"],
    ["vocabTerms", "vocab_terms"],
    ["tagLinks", "artwork_tag_links"],
    ["artistLinks", "artwork_artist_links"],
    ["signals", "recommendation_signals"],
    ["channels", "recommendation_channels"],
    ["signalLinks", "artwork_recommendation_signal_links"],
  ]) {
    datasets[key] = await queryCollection(app.database, collection);
  }
  const indexes = {};
  for (const collection of Object.keys(REQUIRED_INDEXES)) {
    const detail = await app.database.describeCollection(collection);
    indexes[collection] = asArray(detail.Indexes).map((index) => index.Name);
  }
  const permissionResult = await app.permission.describeResourcePermission({
    resourceType: "collection",
    resources: Object.keys(REQUIRED_PERMISSIONS),
  });
  const permissions = Object.fromEntries(
    asArray(permissionResult?.Data?.PermissionList).map((item) => [item.Resource, item.Permission]),
  );
  const result = auditRecommendationProduction({
    ...datasets,
    release: readRelease(releaseDir),
    indexes,
    permissions,
    clientSource: [
      fs.readFileSync("miniapp/pages/home/home.js", "utf8"),
      fs.readFileSync("miniapp/services/artworks.js", "utf8"),
    ].join("\n"),
  });
  const report = {
    generated_at: new Date().toISOString(),
    env_id: envId,
    ...result,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "task-06-production-audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(outputDir, "task-06-production-audit.md"), markdown(report), "utf8");
  return report;
}

const isMain =
  process.argv[1] &&
  path.basename(path.resolve(process.argv[1])) === path.basename(fileURLToPath(import.meta.url));

if (isMain) {
  runAudit()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
