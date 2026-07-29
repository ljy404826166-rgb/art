#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RECOMMENDATION_SIGNAL_VERSION,
  buildChannelStats,
  buildRecommendationSignalCatalog,
  buildRecommendationSignalIndex,
  deriveChannelPolicy,
  deriveRecommendationArtwork,
} from "./recommendation-signals-v1.mjs";

const CHANNEL_VERSION = "recommendation-channels-v1";
const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_TASK3_DIR = path.resolve(
  process.cwd(),
  "outputs",
  "recommendation-system",
  "task-03",
);
const DEFAULT_VOCAB_PATH = path.resolve(
  process.cwd(),
  "outputs",
  "recommendation-system",
  "task-02",
  "controlled-vocabulary-v1.json",
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  process.cwd(),
  "outputs",
  "recommendation-system",
  "task-04",
);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) return;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) return;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      result[match[1]] = value;
    });
  return result;
}

function environment() {
  return {
    ...parseEnvFile(path.resolve(process.cwd(), ".env")),
    ...parseEnvFile(path.resolve(process.cwd(), ".env.local")),
    ...process.env,
  };
}

function createClient(envId, config) {
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
  const outer = JSON.parse(data || "[]");
  return outer.map((row) => normalizeExtendedJson(JSON.parse(row)));
}

async function queryCollection(database, collection, projection = {}) {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    let result;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        result = await database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "QUERY",
              Command: JSON.stringify({
                find: collection,
                filter: {},
                projection,
                skip,
                limit: pageSize,
              }),
            },
          ],
        });
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
    }
    if (!result) throw lastError;
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function loadCloudData({ envId }) {
  const app = createClient(envId, environment());
  const [artworks, artists] = await Promise.all([
    queryCollection(app.database, "artworks", {
      _id: 1,
      status: 1,
      review_status: 1,
      publish_status: 1,
      title: 1,
      title_cn: 1,
      title_zh: 1,
      title_en: 1,
      thumbnail_url: 1,
      display_url: 1,
      image_url: 1,
      cloud_file_id: 1,
      image: 1,
      description: 1,
      description_zh: 1,
      summary: 1,
      artist: 1,
      artist_display: 1,
      raw_artist_text: 1,
      recommendation_signal_ids: 1,
      recommendation_status: 1,
      recommendation_ineligibility_reasons: 1,
      recommendation_quality_score: 1,
      random_bucket: 1,
      recommendation_signal_version: 1,
      recommendation_random_version: 1,
      recommendation_updated_at: 1,
    }),
    queryCollection(app.database, "artists", {
      _id: 1,
      name_zh: 1,
      nameZh: 1,
      display_name: 1,
      name_en: 1,
      nameEn: 1,
      aliases: 1,
      entity_type: 1,
      review_status: 1,
    }),
  ]);
  return { artworks, artists };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

function csvEscape(value) {
  if (Array.isArray(value)) return csvEscape(value.join("|"));
  const text =
    typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  fs.writeFileSync(
    filePath,
    `${[
      columns.map(csvEscape).join(","),
      ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
    ].join("\n")}\n`,
    "utf8",
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function artistLabel(artist) {
  return String(
    artist.name_zh ||
      artist.nameZh ||
      artist.display_name ||
      artist.name_en ||
      artist.nameEn ||
      artist._id,
  );
}

function isUncertainArtistText(value) {
  return /未知|暂不明确|作者未|可能|疑似|风格|待考|相关作者|归属未定|unknown/i.test(
    String(value || ""),
  );
}

function groupArtworkIdsBy(rows, field) {
  const groups = new Map();
  rows.forEach((row) => {
    asArray(row[field]).forEach((id) => {
      if (!groups.has(id)) groups.set(id, new Set());
      groups.get(id).add(row._id);
    });
  });
  return groups;
}

function channelPriority(stats, policy) {
  if (!stats.artwork_count) return 0;
  const diversityFactor =
    policy.channel_mode === "artist_focus" ? 0.8 : Math.max(0.4, 1 - stats.top_artist_share * 0.5);
  return Number((Math.log2(stats.artwork_count + 1) * diversityFactor).toFixed(4));
}

function createChannel({
  id,
  key,
  title,
  kind,
  queryField,
  queryValue,
  stats,
  policy,
  sourceStatus = "published",
  signalType = "",
  displayTitle = title,
}) {
  const sourcePublished = sourceStatus === "published";
  const sourceType =
    queryField === "classification_ids"
      ? "classification"
      : queryField === "tag_ids"
        ? "controlled_metadata"
        : queryField === "artist_ids"
          ? "artist"
          : queryField === "recommendation_signal_ids"
            ? "recommendation_signal"
            : "editorial";
  return {
    _id: id,
    channel_key: key,
    title,
    display_title: displayTitle,
    kind,
    source_type: sourceType,
    signal_type: signalType,
    query_field: queryField,
    query_value: queryValue,
    source_publish_status: sourceStatus,
    priority_score: channelPriority(stats, policy),
    ...stats,
    ...policy,
    channel_status: sourcePublished ? policy.channel_status : "candidate",
    auto_feature_eligible: sourcePublished && policy.auto_feature_eligible,
    version: CHANNEL_VERSION,
  };
}

function buildSignalAssignments(
  tagReviewQueue,
  signalIndex,
  { ignoredLabels = new Set(), artistLabelsByArtwork = new Map() } = {},
) {
  const signalIdsByArtwork = new Map();
  const unresolved = [];
  const links = [];
  let ignoredArtistLabels = 0;
  tagReviewQueue.forEach((row) => {
    if (row.reason !== "recommendation_signal_candidate") return;
    const normalizedLabel = String(row.source_tag_text || "")
      .normalize("NFKC")
      .trim();
    const artworkArtistLabels = artistLabelsByArtwork.get(row.artwork_id) || [];
    const matchesArtworkArtist =
      normalizedLabel.length >= 2 &&
      artworkArtistLabels.some(
        (label) => label.includes(normalizedLabel) || normalizedLabel.includes(label),
      );
    if (ignoredLabels.has(normalizedLabel) || matchesArtworkArtist) {
      ignoredArtistLabels += 1;
      return;
    }
    const ids = signalIndex.get(normalizedLabel) || [];
    if (ids.length !== 1) {
      unresolved.push({
        ...row,
        reason: ids.length ? "ambiguous_signal_alias" : "unmapped_signal_label",
        candidate_signal_ids: ids,
      });
      return;
    }
    const signalId = ids[0];
    if (!signalIdsByArtwork.has(row.artwork_id)) {
      signalIdsByArtwork.set(row.artwork_id, new Set());
    }
    signalIdsByArtwork.get(row.artwork_id).add(signalId);
    links.push({
      _id: `${row.artwork_id}--${signalId}`,
      artwork_id: row.artwork_id,
      signal_id: signalId,
      source_text: row.source_tag_text,
      match_source: "reviewed-recommendation-signal-alias",
      review_status: "reviewed",
      version: RECOMMENDATION_SIGNAL_VERSION,
    });
  });
  return { signalIdsByArtwork, links, unresolved, ignoredArtistLabels };
}

function previousRecommendationFields(artwork) {
  return {
    recommendation_signal_ids: asArray(artwork.recommendation_signal_ids),
    recommendation_status: artwork.recommendation_status || null,
    recommendation_ineligibility_reasons: asArray(artwork.recommendation_ineligibility_reasons),
    recommendation_quality_score: artwork.recommendation_quality_score ?? null,
    random_bucket: artwork.random_bucket ?? null,
    recommendation_signal_version: artwork.recommendation_signal_version || null,
    recommendation_random_version: artwork.recommendation_random_version || null,
    recommendation_updated_at: artwork.recommendation_updated_at || null,
  };
}

function buildChannels({ signals, terms, artists, eligibleNormalizedArtworks }) {
  const artworkById = new Map(eligibleNormalizedArtworks.map((artwork) => [artwork._id, artwork]));
  const signalGroups = groupArtworkIdsBy(eligibleNormalizedArtworks, "recommendation_signal_ids");
  const artistGroups = groupArtworkIdsBy(eligibleNormalizedArtworks, "artist_ids");
  const classificationGroups = groupArtworkIdsBy(eligibleNormalizedArtworks, "classification_ids");
  const termGroups = groupArtworkIdsBy(eligibleNormalizedArtworks, "recommendation_term_ids");
  const channels = [];

  signals.forEach((signal) => {
    const artworkIds = [...(signalGroups.get(signal._id) || [])];
    const stats = buildChannelStats(artworkIds, artworkById);
    const policy = deriveChannelPolicy(stats);
    channels.push(
      createChannel({
        id: `channel-${signal._id}`,
        key: `signal:${signal._id}`,
        title: signal.label_zh,
        kind: "signal",
        queryField: "recommendation_signal_ids",
        queryValue: signal._id,
        stats,
        policy,
        sourceStatus: signal.publish_status,
        signalType: signal.type,
      }),
    );
  });

  artists
    .filter(
      (artist) =>
        artist.entity_type === "person" &&
        artist.review_status === "reviewed" &&
        artistGroups.has(artist._id),
    )
    .forEach((artist) => {
      const artworkIds = [...artistGroups.get(artist._id)];
      const stats = buildChannelStats(artworkIds, artworkById);
      const policy = deriveChannelPolicy(stats, { forceArtistId: artist._id });
      channels.push(
        createChannel({
          id: `channel-artist-${artist._id}`,
          key: `artist:${artist._id}`,
          title: artistLabel(artist),
          kind: "artist",
          queryField: "artist_ids",
          queryValue: artist._id,
          stats,
          policy,
        }),
      );
    });

  terms
    .filter((term) => asArray(term.usage_scopes).includes("recommendation"))
    .forEach((term) => {
      const group = classificationGroups.get(term._id) || termGroups.get(term._id);
      if (!group?.size) return;
      const artworkIds = [...group];
      const stats = buildChannelStats(artworkIds, artworkById);
      const policy = deriveChannelPolicy(stats);
      channels.push(
        createChannel({
          id: `channel-term-${term._id}`,
          key: `term:${term._id}`,
          title: term.label_zh,
          kind: "controlled_term",
          queryField: classificationGroups.has(term._id) ? "classification_ids" : "tag_ids",
          queryValue: term._id,
          stats,
          policy,
          sourceStatus: term.publish_status,
          signalType: term.type,
        }),
      );
    });

  return channels.sort(
    (left, right) =>
      Number(right.auto_feature_eligible) - Number(left.auto_feature_eligible) ||
      right.priority_score - left.priority_score ||
      left.channel_key.localeCompare(right.channel_key),
  );
}

function countBy(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] || "unknown";
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function buildBucketAudit(patches) {
  const counts = Array.from({ length: 100 }, () => 0);
  patches.forEach((patch) => {
    counts[Math.floor(patch.random_bucket / 100)] += 1;
  });
  const nonEmpty = counts.filter((count) => count > 0);
  return {
    partitions: counts.length,
    min: Math.min(...nonEmpty),
    max: Math.max(...nonEmpty),
    average: Number((patches.length / counts.length).toFixed(2)),
    counts,
  };
}

function buildMarkdown(report) {
  return `# 首页推荐信号体系预演（任务四）

生成时间：${report.generated_at}

## 结论

- 本次为只读云端预演，未修改云数据库。
- 72 种任务三候选标签已全部映射为首页推荐信号，严格分类目录保持不变。
- ${report.artwork_counts.total} 件作品均生成稳定随机分桶；其中 ${report.artwork_counts.eligible} 件进入推荐池，${report.artwork_counts.ineligible} 件被资格规则排除。
- 共生成 ${report.channel_counts.total} 个推荐频道：信号 ${report.channel_counts.by_kind.signal || 0}、画家 ${report.channel_counts.by_kind.artist || 0}、标准词条 ${report.channel_counts.by_kind.controlled_term || 0}。
- ${report.channel_counts.auto_feature_eligible} 个频道达到自动首页展示门槛。

## 首页与分类页边界

- 分类页只读取 \`classification_ids\`。
- 首页可组合 \`classification_ids\`、\`tag_ids\`、\`artist_ids\` 和 \`recommendation_signal_ids\`。
- 推荐信号全部设置 \`classification_filter=false\`，不会出现在分类页。
- 每位已审核且有作品的 person 画家都生成独立频道；不少于 8 件作品才可自动进入首页。

## 推荐资格

| 状态 | 作品数 |
|---|---:|
${Object.entries(report.artwork_counts.by_status)
  .map(([key, value]) => `| ${key} | ${value} |`)
  .join("\n")}

不合格原因：

${
  Object.entries(report.artwork_counts.ineligibility_reasons)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "- 无"
}

## 频道治理

- 跨画家频道：至少 8 件、至少 3 位画家、最大单一画家占比不超过 65%。
- 画家聚焦频道：至少 8 件，并明确记录 \`artist_scope_id\`。
- 小于 8 件的频道保留为长尾检索入口，不自动推送。
- 草稿标准词条频道保持 candidate，不进入首页自动轮播。

## 校验

- 未映射信号标签：${report.validation.unmapped_signal_labels}
- 未知信号 ID：${report.validation.unknown_signal_ids}
- 重复信号关系 ID：${report.validation.duplicate_signal_link_ids}
- 随机桶范围错误：${report.validation.invalid_random_buckets}
- 完整性门槛：${report.validation.ok ? "通过" : "未通过"}
`;
}

export async function runBuild({
  envId = process.env.CLOUDBASE_ENV_ID || DEFAULT_ENV_ID,
  task3Dir = DEFAULT_TASK3_DIR,
  vocabularyPath = DEFAULT_VOCAB_PATH,
  outputDir = DEFAULT_OUTPUT_DIR,
  generatedAt = new Date().toISOString(),
  dataProvider = loadCloudData,
} = {}) {
  const normalizedArtworks = readJsonl(path.join(task3Dir, "classification-v6-artworks.jsonl"));
  const tagReviewQueue = readJsonl(path.join(task3Dir, "classification-v6-tag-review-queue.jsonl"));
  const vocabulary = JSON.parse(fs.readFileSync(vocabularyPath, "utf8"));
  const { artworks, artists } = await dataProvider({ envId });
  const cloudArtworkById = new Map(artworks.map((artwork) => [artwork._id, artwork]));
  const signals = buildRecommendationSignalCatalog();
  const signalIndex = buildRecommendationSignalIndex(signals);
  const artistLabels = new Set(
    artists.flatMap((artist) =>
      [
        artist.name_zh,
        artist.nameZh,
        artist.display_name,
        artist.name_en,
        artist.nameEn,
        ...asArray(artist.aliases),
      ]
        .map((label) =>
          String(label || "")
            .normalize("NFKC")
            .trim(),
        )
        .filter(Boolean),
    ),
  );
  const artistLabelsById = new Map(
    artists.map((artist) => [
      artist._id,
      [
        artist.name_zh,
        artist.nameZh,
        artist.display_name,
        artist.name_en,
        artist.nameEn,
        ...asArray(artist.aliases),
      ]
        .map((label) =>
          String(label || "")
            .normalize("NFKC")
            .trim(),
        )
        .filter(Boolean),
    ]),
  );
  const artistLabelsByArtwork = new Map(
    normalizedArtworks.map((artwork) => [
      artwork._id,
      [
        ...asArray(artwork.artist_labels),
        ...asArray(artwork.artist_ids).flatMap((artistId) => artistLabelsById.get(artistId) || []),
        ...[
          cloudArtworkById.get(artwork._id)?.artist,
          cloudArtworkById.get(artwork._id)?.artist_display,
          cloudArtworkById.get(artwork._id)?.raw_artist_text,
        ].filter((label) => !isUncertainArtistText(label)),
      ]
        .map((label) =>
          String(label || "")
            .normalize("NFKC")
            .trim(),
        )
        .filter(Boolean),
    ]),
  );
  const assignments = buildSignalAssignments(tagReviewQueue, signalIndex, {
    ignoredLabels: artistLabels,
    artistLabelsByArtwork,
  });
  const normalizedById = new Map(normalizedArtworks.map((artwork) => [artwork._id, artwork]));

  const patches = normalizedArtworks.map((normalizedArtwork) => {
    const artwork = cloudArtworkById.get(normalizedArtwork._id) || {
      _id: normalizedArtwork._id,
    };
    const next = deriveRecommendationArtwork({
      artwork,
      normalizedArtwork,
      signalIds: [...(assignments.signalIdsByArtwork.get(normalizedArtwork._id) || [])],
      updatedAt: generatedAt,
    });
    return {
      ...next,
      previous: previousRecommendationFields(artwork),
    };
  });
  const patchById = new Map(patches.map((patch) => [patch._id, patch]));
  const eligibleNormalizedArtworks = normalizedArtworks
    .filter((artwork) => patchById.get(artwork._id)?.recommendation_status === "eligible")
    .map((artwork) => ({
      ...artwork,
      recommendation_signal_ids: patchById.get(artwork._id).recommendation_signal_ids,
    }));
  const channels = buildChannels({
    signals,
    terms: vocabulary.terms,
    artists,
    eligibleNormalizedArtworks,
  });

  const signalIds = new Set(signals.map((signal) => signal._id));
  const unknownSignalIds = new Set(
    patches.flatMap((patch) => patch.recommendation_signal_ids).filter((id) => !signalIds.has(id)),
  );
  const linkIds = assignments.links.map((link) => link._id);
  const duplicateLinkIds = linkIds.filter((id, index) => linkIds.indexOf(id) !== index);
  const invalidRandomBuckets = patches.filter(
    (patch) =>
      !Number.isInteger(patch.random_bucket) ||
      patch.random_bucket < 0 ||
      patch.random_bucket >= 10000,
  );
  const ineligibilityReasons = patches.flatMap(
    (patch) => patch.recommendation_ineligibility_reasons,
  );
  const report = {
    generated_at: generatedAt,
    mode: "read-only-dry-run",
    cloud_writes_performed: false,
    env_id: envId,
    signal_version: RECOMMENDATION_SIGNAL_VERSION,
    channel_version: CHANNEL_VERSION,
    signal_counts: {
      total: signals.length,
      by_type: countBy(signals, "type"),
      source_assignments: tagReviewQueue.length,
      ignored_artist_labels: assignments.ignoredArtistLabels,
      generated_links: assignments.links.length,
      artworks_with_signals: patches.filter((patch) => patch.recommendation_signal_ids.length)
        .length,
    },
    artwork_counts: {
      total: patches.length,
      eligible: patches.filter((patch) => patch.recommendation_status === "eligible").length,
      ineligible: patches.filter((patch) => patch.recommendation_status === "ineligible").length,
      by_status: countBy(patches, "recommendation_status"),
      ineligibility_reasons: ineligibilityReasons.reduce((result, reason) => {
        result[reason] = (result[reason] || 0) + 1;
        return result;
      }, {}),
    },
    channel_counts: {
      total: channels.length,
      by_kind: countBy(channels, "kind"),
      by_source_type: countBy(channels, "source_type"),
      by_status: countBy(channels, "channel_status"),
      auto_feature_eligible: channels.filter((channel) => channel.auto_feature_eligible).length,
      artist_dimensions: channels.filter((channel) => channel.kind === "artist").length,
      artist_dimensions_home_ready: channels.filter(
        (channel) => channel.kind === "artist" && channel.auto_feature_eligible,
      ).length,
      signal_auto_feature_eligible: channels.filter(
        (channel) => channel.kind === "signal" && channel.auto_feature_eligible,
      ).length,
      signal_artist_focus: channels.filter(
        (channel) => channel.kind === "signal" && channel.channel_mode === "artist_focus",
      ).length,
      signal_cross_artist: channels.filter(
        (channel) => channel.kind === "signal" && channel.channel_mode === "cross_artist",
      ).length,
    },
    random_bucket_audit: buildBucketAudit(patches),
    validation: {
      unmapped_signal_labels: assignments.unresolved.length,
      unknown_signal_ids: unknownSignalIds.size,
      duplicate_signal_link_ids: new Set(duplicateLinkIds).size,
      invalid_random_buckets: invalidRandomBuckets.length,
      missing_cloud_artworks: normalizedArtworks.filter(
        (artwork) => !cloudArtworkById.has(artwork._id),
      ).length,
      missing_normalized_artworks: artworks.filter((artwork) => !normalizedById.has(artwork._id))
        .length,
    },
  };
  report.validation.ok = Object.values(report.validation).every((value) => value === 0);

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, "recommendation-signals-v1.json"), {
    version: RECOMMENDATION_SIGNAL_VERSION,
    signals,
  });
  writeJson(path.join(outputDir, "recommendation-channels-v1.json"), {
    version: CHANNEL_VERSION,
    channels,
  });
  writeJsonl(path.join(outputDir, "recommendation-artwork-patches.jsonl"), patches);
  writeJsonl(path.join(outputDir, "artwork-recommendation-signal-links.jsonl"), assignments.links);
  writeJsonl(
    path.join(outputDir, "recommendation-signal-review-queue.jsonl"),
    assignments.unresolved,
  );
  writeJsonl(
    path.join(outputDir, "rollback-recommendation-artwork-fields.jsonl"),
    patches.map((patch) => ({ _id: patch._id, ...patch.previous })),
  );
  writeCsv(path.join(outputDir, "recommendation-channel-audit.csv"), channels);
  writeJson(path.join(outputDir, "task-04-report.json"), report);
  fs.writeFileSync(path.join(outputDir, "task-04-report.md"), buildMarkdown(report), "utf8");

  return {
    outputDir,
    report,
    signals,
    patches,
    channels,
    signalLinks: assignments.links,
  };
}

const isMain =
  process.argv[1] &&
  path.basename(path.resolve(process.argv[1])) === path.basename(fileURLToPath(import.meta.url));

if (isMain) {
  runBuild()
    .then(({ outputDir, report }) => {
      console.log(`recommendation signal dry-run written to ${outputDir}`);
      console.log(JSON.stringify(report, null, 2));
      if (!report.validation.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
