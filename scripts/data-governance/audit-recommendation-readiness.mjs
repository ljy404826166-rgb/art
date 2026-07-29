#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_OUTPUT_DIR = path.resolve(
  process.cwd(),
  "outputs",
  "recommendation-system",
  "task-01",
);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function env() {
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local"), ...process.env };
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

async function queryCollection(database, collection, projection) {
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

function cleanText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLabel(value) {
  return cleanText(value)
    .replace(/[“”‘’"'`]/g, "")
    .toLocaleLowerCase("zh-CN");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function dimensionForId(id) {
  const value = cleanText(id);
  if (value.startsWith("style-")) return "style";
  if (value.startsWith("subject-")) return "subject";
  if (value.startsWith("medium-")) return "medium";
  if (value.startsWith("technique-")) return "technique";
  if (value.startsWith("period-")) return "period";
  if (value.startsWith("region-")) return "region";
  return "other";
}

function termLabel(term) {
  return cleanText(
    term.label_zh ||
      term.name_zh ||
      term.label ||
      term.name ||
      term.label_en ||
      term.name_en ||
      term._id,
  );
}

function artistLabel(artist) {
  return cleanText(
    artist.name_zh ||
      artist.nameZh ||
      artist.display_name ||
      artist.name_en ||
      artist.nameEn ||
      artist._id,
  );
}

function legacyTagsForArtwork(artwork) {
  return unique([
    ...asArray(artwork.tag_keys),
    ...asArray(artwork.tags),
    ...asArray(artwork.tag_labels),
  ]);
}

function artworkArtistIds(artwork) {
  return unique([...asArray(artwork.artist_ids), artwork.primary_artist_id]);
}

function buildAliasIndex(rows, getAliases) {
  const index = new Map();
  rows.forEach((row) => {
    getAliases(row).forEach((alias) => {
      const normalized = normalizeLabel(alias);
      if (!normalized) return;
      if (!index.has(normalized)) index.set(normalized, []);
      index.get(normalized).push(row._id);
    });
  });
  return index;
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function sortByCount(rows, countKey = "artwork_count") {
  return rows.sort(
    (left, right) =>
      Number(right[countKey] || 0) - Number(left[countKey] || 0) ||
      cleanText(left.label || left.artist_name || left.id).localeCompare(
        cleanText(right.label || right.artist_name || right.id),
        "zh-CN",
      ),
  );
}

function comparableSlug(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function levenshtein(left, right) {
  const a = comparableSlug(left);
  const b = comparableSlug(right);
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function slugSimilarity(left, right) {
  const maxLength = Math.max(comparableSlug(left).length, comparableSlug(right).length);
  return maxLength ? Number((1 - levenshtein(left, right) / maxLength).toFixed(4)) : 0;
}

function loadCategoryCatalog(catalogPath) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(catalogPath, "utf8"),
    {
      module,
      exports: module.exports,
    },
    { filename: catalogPath },
  );
  return module.exports;
}

export function buildRecommendationAudit({
  artworks = [],
  artists = [],
  vocabTerms = [],
  categoryCatalog = { CATEGORY_CATALOG_VERSION: "", CATEGORY_GROUPS: [] },
  sourceInspection = {},
  envId = "",
} = {}) {
  const termById = new Map(vocabTerms.map((term) => [cleanText(term._id), term]));
  const artistById = new Map(artists.map((artist) => [cleanText(artist._id), artist]));
  const termAliasIndex = buildAliasIndex(vocabTerms, (term) =>
    unique([
      termLabel(term),
      ...asArray(term.aliases).flatMap((alias) =>
        typeof alias === "string"
          ? [alias]
          : [alias?.label, alias?.label_zh, alias?.label_en, alias?.name],
      ),
    ]),
  );
  const artistAliasIndex = buildAliasIndex(artists, (artist) =>
    unique([
      artistLabel(artist),
      artist.name_zh,
      artist.nameZh,
      artist.name_en,
      artist.nameEn,
      artist.display_name,
      ...asArray(artist.aliases).flatMap((alias) =>
        typeof alias === "string"
          ? [alias]
          : [alias?.label, alias?.name, alias?.name_zh, alias?.name_en],
      ),
    ]),
  );

  const classificationCounts = new Map();
  const dimensionArtworkCounts = new Map();
  const unknownClassificationIds = new Map();
  const artistArtworkCounts = new Map();
  const legacyTagStats = new Map();
  let classifiedArtworkCount = 0;
  let tagIdArtworkCount = 0;
  let artistLinkedArtworkCount = 0;
  let resolvedArtistArtworkCount = 0;
  let artworksWithOrphanArtistReference = 0;
  let recommendationSignalArtworkCount = 0;
  let recommendationStatusArtworkCount = 0;
  let randomBucketArtworkCount = 0;

  artworks.forEach((artwork) => {
    const classificationIds = unique(asArray(artwork.classification_ids));
    if (classificationIds.length) classifiedArtworkCount += 1;
    if (asArray(artwork.tag_ids).length) tagIdArtworkCount += 1;
    const artworkDimensions = new Set();
    classificationIds.forEach((id) => {
      increment(classificationCounts, id);
      artworkDimensions.add(dimensionForId(id));
      if (!termById.has(id)) increment(unknownClassificationIds, id);
    });
    artworkDimensions.forEach((dimension) => increment(dimensionArtworkCounts, dimension));

    const artistIds = artworkArtistIds(artwork);
    if (artistIds.length) artistLinkedArtworkCount += 1;
    if (artistIds.some((artistId) => artistById.has(artistId))) {
      resolvedArtistArtworkCount += 1;
    }
    if (artistIds.some((artistId) => !artistById.has(artistId))) {
      artworksWithOrphanArtistReference += 1;
    }
    artistIds.forEach((artistId) => increment(artistArtworkCounts, artistId));

    if (asArray(artwork.recommendation_signal_ids).length) {
      recommendationSignalArtworkCount += 1;
    }
    if (cleanText(artwork.recommendation_status)) recommendationStatusArtworkCount += 1;
    if (Number.isFinite(Number(artwork.random_bucket))) randomBucketArtworkCount += 1;

    legacyTagsForArtwork(artwork).forEach((label) => {
      const key = normalizeLabel(label);
      if (!legacyTagStats.has(key)) {
        legacyTagStats.set(key, {
          label,
          artworkIds: new Set(),
          artistCounts: new Map(),
        });
      }
      const stat = legacyTagStats.get(key);
      stat.artworkIds.add(cleanText(artwork._id));
      artistIds.forEach((artistId) => increment(stat.artistCounts, artistId));
    });
  });

  const classificationFrequency = sortByCount(
    [...classificationCounts.entries()].map(([id, artworkCount]) => ({
      id,
      label: termById.has(id) ? termLabel(termById.get(id)) : "",
      dimension: dimensionForId(id),
      artwork_count: artworkCount,
      known_vocab_term: termById.has(id),
    })),
  );

  const legacyTagFrequency = sortByCount(
    [...legacyTagStats.entries()].map(([normalized, stat]) => {
      const termMatches = unique(termAliasIndex.get(normalized) || []);
      const artistMatches = unique(artistAliasIndex.get(normalized) || []);
      const artistRanking = [...stat.artistCounts.entries()].sort(
        (left, right) => right[1] - left[1],
      );
      const [topArtistId = "", topArtistCount = 0] = artistRanking[0] || [];
      const artworkCount = stat.artworkIds.size;
      let disposition = "recommendation_signal_candidate";
      if (termMatches.length === 1) disposition = "classification_alias";
      else if (artistMatches.length === 1) disposition = "artist_dimension";
      else if (termMatches.length > 1 || artistMatches.length > 1) disposition = "ambiguous";
      return {
        label: stat.label,
        normalized_label: normalized,
        artwork_count: artworkCount,
        unique_artist_count: stat.artistCounts.size,
        top_artist_id: topArtistId,
        top_artist_name: artistById.has(topArtistId)
          ? artistLabel(artistById.get(topArtistId))
          : "",
        top_artist_artwork_count: topArtistCount,
        top_artist_share: ratio(topArtistCount, artworkCount),
        term_matches: termMatches,
        artist_matches: artistMatches,
        disposition,
      };
    }),
  );

  const artistDimensions = sortByCount(
    artists.map((artist) => {
      const artworkCount = artistArtworkCounts.get(cleanText(artist._id)) || 0;
      return {
        id: cleanText(artist._id),
        artist_name: artistLabel(artist),
        review_status: cleanText(artist.review_status) || "unknown",
        entity_type: cleanText(artist.entity_type) || "person",
        artwork_count: artworkCount,
        has_artworks: artworkCount > 0,
        home_channel_ready_8: artworkCount >= 8,
      };
    }),
  );

  const referencedArtistIds = [...artistArtworkCounts.keys()];
  const orphanArtistIds = referencedArtistIds.filter((id) => !artistById.has(id)).sort();
  const zeroArtworkArtists = artistDimensions.filter((row) => !row.has_artworks);
  const orphanArtistReferences = orphanArtistIds.map((id) => {
    const candidate = zeroArtworkArtists
      .map((artist) => ({
        id: artist.id,
        artist_name: artist.artist_name,
        similarity: slugSimilarity(id, artist.id),
      }))
      .sort((left, right) => right.similarity - left.similarity)[0];
    return {
      id,
      artwork_count: artistArtworkCounts.get(id) || 0,
      suggested_artist_id: candidate?.similarity >= 0.72 ? candidate.id : "",
      suggested_artist_name: candidate?.similarity >= 0.72 ? candidate.artist_name : "",
      similarity: candidate?.similarity >= 0.72 ? candidate.similarity : 0,
    };
  });
  const aliasConflicts = [
    ...[...termAliasIndex.entries()]
      .filter(([, ids]) => unique(ids).length > 1)
      .map(([label, ids]) => ({ namespace: "vocab_term", label, ids: unique(ids) })),
    ...[...artistAliasIndex.entries()]
      .filter(([, ids]) => unique(ids).length > 1)
      .map(([label, ids]) => ({ namespace: "artist", label, ids: unique(ids) })),
  ];

  const actualClassificationCount = new Map(
    classificationFrequency.map((row) => [row.id, row.artwork_count]),
  );
  const catalogRows = asArray(categoryCatalog.CATEGORY_GROUPS).flatMap((group) =>
    asArray(group.tags).map((tag) => {
      const actualCount = actualClassificationCount.get(cleanText(tag.id)) || 0;
      return {
        group: cleanText(group.key),
        id: cleanText(tag.id),
        label: cleanText(tag.label),
        catalog_count: Number(tag.count || 0),
        actual_count: actualCount,
        count_delta: Number(tag.count || 0) - actualCount,
        count_matches: Number(tag.count || 0) === actualCount,
        known_vocab_term: termById.has(cleanText(tag.id)),
      };
    }),
  );
  const catalogIds = new Set(catalogRows.map((row) => row.id));
  const reviewedClassificationIds = new Set(
    vocabTerms
      .filter((term) => cleanText(term.review_status) === "reviewed")
      .map((term) => cleanText(term._id))
      .filter((id) => ["style", "subject", "period"].includes(dimensionForId(id))),
  );

  const legacyDispositionCounts = legacyTagFrequency.reduce((result, row) => {
    result[row.disposition] = (result[row.disposition] || 0) + 1;
    return result;
  }, {});
  const highConcentrationLegacyTags = legacyTagFrequency.filter(
    (row) => row.artwork_count >= 8 && row.top_artist_share >= 0.5,
  );
  const artistDimensionsWithArtworks = artistDimensions.filter((row) => row.has_artworks);
  const reviewedArtistDimensions = artistDimensions.filter(
    (row) => row.review_status === "reviewed" && row.has_artworks,
  );

  return {
    generated_at: new Date().toISOString(),
    env_id: envId,
    decision: {
      artist_is_separate_recommendation_dimension: true,
      artist_dimension_field: "artist_ids",
      artist_names_are_not_general_tags: true,
      category_page_source: "reviewed classification_ids only",
      home_source_target:
        "published recommendation channels using classification_ids, artist_ids, and recommendation_signal_ids",
    },
    summary: {
      artworks_total: artworks.length,
      artists_total: artists.length,
      registered_artist_dimensions: artists.length,
      vocab_terms_total: vocabTerms.length,
      classified_artworks: classifiedArtworkCount,
      classification_coverage: ratio(classifiedArtworkCount, artworks.length),
      tag_ids_coverage: ratio(tagIdArtworkCount, artworks.length),
      artist_linked_artworks: artistLinkedArtworkCount,
      artist_coverage: ratio(artistLinkedArtworkCount, artworks.length),
      resolved_artist_artworks: resolvedArtistArtworkCount,
      resolved_artist_coverage: ratio(resolvedArtistArtworkCount, artworks.length),
      artworks_with_orphan_artist_reference: artworksWithOrphanArtistReference,
      artworks_without_artist: artworks.length - artistLinkedArtworkCount,
      distinct_legacy_tags: legacyTagFrequency.length,
      legacy_tag_assignments_total: legacyTagFrequency.reduce(
        (total, row) => total + row.artwork_count,
        0,
      ),
      legacy_tag_dispositions: legacyDispositionCounts,
      recommendation_signal_coverage: ratio(recommendationSignalArtworkCount, artworks.length),
      recommendation_status_coverage: ratio(recommendationStatusArtworkCount, artworks.length),
      random_bucket_coverage: ratio(randomBucketArtworkCount, artworks.length),
      artist_dimensions_with_artworks: artistDimensionsWithArtworks.length,
      reviewed_artist_dimensions_with_artworks: reviewedArtistDimensions.length,
      referenced_artist_dimension_ids: referencedArtistIds.length,
      artist_dimensions_home_ready_8: artistDimensions.filter((row) => row.home_channel_ready_8)
        .length,
      registered_artists_without_artworks: zeroArtworkArtists.length,
      high_concentration_legacy_home_tags: highConcentrationLegacyTags.length,
      unknown_classification_ids: unknownClassificationIds.size,
      orphan_artist_ids: orphanArtistReferences.length,
      orphan_artist_ids_with_suggested_mapping: orphanArtistReferences.filter(
        (row) => row.suggested_artist_id,
      ).length,
      alias_conflicts: aliasConflicts.length,
      catalog_terms: catalogRows.length,
      catalog_count_mismatches: catalogRows.filter((row) => !row.count_matches).length,
      reviewed_classification_terms_missing_from_catalog: [...reviewedClassificationIds].filter(
        (id) => !catalogIds.has(id),
      ).length,
    },
    coverage_by_dimension: Object.fromEntries(
      [...dimensionArtworkCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([dimension, count]) => [
          dimension,
          { artwork_count: count, coverage: ratio(count, artworks.length) },
        ]),
    ),
    source_inspection: sourceInspection,
    classification_frequency: classificationFrequency,
    legacy_tag_frequency: legacyTagFrequency,
    artist_recommendation_dimensions: artistDimensions,
    catalog_consistency: catalogRows,
    issues: {
      unknown_classification_ids: [...unknownClassificationIds.entries()].map(
        ([id, artworkCount]) => ({ id, artwork_count: artworkCount }),
      ),
      orphan_artist_references: orphanArtistReferences,
      alias_conflicts: aliasConflicts,
      high_concentration_legacy_home_tags: highConcentrationLegacyTags,
      reviewed_classification_terms_missing_from_catalog: [...reviewedClassificationIds]
        .filter((id) => !catalogIds.has(id))
        .sort(),
    },
  };
}

function csvEscape(value) {
  if (Array.isArray(value)) return csvEscape(value.join("|"));
  const text =
    typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const lines = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function buildMarkdown(report) {
  const summary = report.summary;
  const topArtists = report.artist_recommendation_dimensions.slice(0, 10);
  const concentrated = report.issues.high_concentration_legacy_home_tags.slice(0, 10);
  return `# 首页推荐与分类体系现状审计（任务一）

生成时间：${report.generated_at}

## 结论

- 云端作品 ${summary.artworks_total} 件，画家 ${summary.artists_total} 位，受控词条 ${summary.vocab_terms_total} 个。
- 严格分类覆盖率 ${percent(summary.classification_coverage)}；画家 ID 非空覆盖率 ${percent(summary.artist_coverage)}；能关联现有画家实体的覆盖率 ${percent(summary.resolved_artist_coverage)}。
- 画家已确认为独立推荐维度，查询字段为 \`artist_ids\`，不将画家姓名混入普通标签。
- 已登记 ${summary.registered_artist_dimensions} 个画家维度，其中 ${summary.artist_dimensions_with_artworks} 个能直接关联作品，${summary.artist_dimensions_home_ready_8} 个拥有至少 8 件作品，可形成容量充足的首页画家频道。
- 当前首页仍从旧 \`tags/tag_keys\` 动态发现栏目：${report.source_inspection.home_uses_legacy_tags ? "是" : "否"}。
- 当前分类页使用版本化本地目录：${report.source_inspection.category_uses_versioned_catalog ? "是" : "否"}。

## 主要差距

- 旧标签共 ${summary.distinct_legacy_tags} 个；分流结果：${Object.entries(
    summary.legacy_tag_dispositions,
  )
    .map(([key, value]) => `${key}=${value}`)
    .join("，")}。
- \`recommendation_signal_ids\` 覆盖率 ${percent(summary.recommendation_signal_coverage)}。
- \`recommendation_status\` 覆盖率 ${percent(summary.recommendation_status_coverage)}。
- \`random_bucket\` 覆盖率 ${percent(summary.random_bucket_coverage)}。
- 有 ${summary.orphan_artist_ids} 个作品中的画家 ID 暂时无法关联画家实体，影响 ${summary.artworks_with_orphan_artist_reference} 件作品；其中 ${summary.orphan_artist_ids_with_suggested_mapping} 个已给出高相似度修正候选。
- 有 ${summary.registered_artists_without_artworks} 个已登记画家实体暂未被作品的 \`artist_ids\` 引用。
- 分类目录计数不一致 ${summary.catalog_count_mismatches} 项。
- 作品池不少于 8 件且单一画家占比达到 50% 的旧首页标签 ${summary.high_concentration_legacy_home_tags} 个。

## 画家推荐池 Top 10

| 画家 | ID | 作品数 | 审核状态 | 首页池达到 8 件 |
|---|---|---:|---|---|
${topArtists.map((row) => `| ${row.artist_name} | ${row.id} | ${row.artwork_count} | ${row.review_status} | ${row.home_channel_ready_8 ? "是" : "否"} |`).join("\n")}

## 高集中度旧首页标签 Top 10

| 标签 | 作品数 | 画家数 | 占比最高画家 | 最高占比 |
|---|---:|---:|---|---:|
${concentrated.map((row) => `| ${row.label} | ${row.artwork_count} | ${row.unique_artist_count} | ${row.top_artist_name || row.top_artist_id} | ${percent(row.top_artist_share)} |`).join("\n")}

## 任务二输入

1. 分类页面继续只接收 reviewed 的流派、题材、媒介、技法、年代等标准词条。
2. 首页频道可以组合 \`classification_ids\`、\`artist_ids\` 和未来的 \`recommendation_signal_ids\`。
3. 所有画家保留独立推荐维度；作品较少的画家仍可查询，但不自动进入常驻首页频道。
4. 将旧标签按 \`classification_alias / artist_dimension / recommendation_signal_candidate / ambiguous\` 四类处理。
5. 在迁移首页前先建立推荐信号词表、推荐资格字段和随机分桶字段。
`;
}

function inspectSourceFiles() {
  const homePath = path.resolve(process.cwd(), "miniapp", "pages", "home", "home.js");
  const categoryPath = path.resolve(process.cwd(), "miniapp", "services", "categories.js");
  const homeSource = fs.readFileSync(homePath, "utf8");
  const categorySource = fs.readFileSync(categoryPath, "utf8");
  return {
    home_file: path.relative(process.cwd(), homePath).replaceAll("\\", "/"),
    home_uses_legacy_tags: /item\.tags\s*\|\|\s*item\.tag_keys/.test(homeSource),
    home_discovers_sections_dynamically: /uniqueTags\(/.test(homeSource),
    home_uses_published_channel_collection: /recommendation_channels/.test(homeSource),
    category_file: path.relative(process.cwd(), categoryPath).replaceAll("\\", "/"),
    category_uses_versioned_catalog: /CATEGORY_CATALOG_VERSION/.test(categorySource),
    category_uses_cloud_catalog: /category_catalog_state|cloud\.(?:database|callFunction)/.test(
      categorySource,
    ),
  };
}

export async function runAudit({
  envId = process.env.CLOUDBASE_ENV_ID || DEFAULT_ENV_ID,
  outputDir = DEFAULT_OUTPUT_DIR,
} = {}) {
  const app = createClient(envId, env());
  const [artworks, artists, vocabTerms] = await Promise.all([
    queryCollection(app.database, "artworks", {
      _id: 1,
      status: 1,
      review_status: 1,
      publish_status: 1,
      primary_artist_id: 1,
      artist_ids: 1,
      artist_labels: 1,
      classification_ids: 1,
      tag_ids: 1,
      tag_keys: 1,
      tags: 1,
      tag_labels: 1,
      recommendation_signal_ids: 1,
      recommendation_status: 1,
      recommendation_score: 1,
      random_bucket: 1,
    }),
    queryCollection(app.database, "artists", {
      _id: 1,
      name_zh: 1,
      nameZh: 1,
      name_en: 1,
      nameEn: 1,
      display_name: 1,
      aliases: 1,
      review_status: 1,
      entity_type: 1,
    }),
    queryCollection(app.database, "vocab_terms", {
      _id: 1,
      type: 1,
      dimension: 1,
      label_zh: 1,
      label_en: 1,
      name_zh: 1,
      name_en: 1,
      label: 1,
      aliases: 1,
      review_status: 1,
    }),
  ]);
  const categoryCatalog = loadCategoryCatalog(
    path.resolve(process.cwd(), "miniapp", "data", "category-catalog.js"),
  );
  const report = buildRecommendationAudit({
    artworks,
    artists,
    vocabTerms,
    categoryCatalog,
    sourceInspection: inspectSourceFiles(),
    envId,
  });

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "recommendation-readiness-audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "recommendation-readiness-audit.md"),
    buildMarkdown(report),
    "utf8",
  );
  writeCsv(path.join(outputDir, "legacy-tag-frequency.csv"), report.legacy_tag_frequency);
  writeCsv(
    path.join(outputDir, "artist-recommendation-dimensions.csv"),
    report.artist_recommendation_dimensions,
  );
  writeCsv(path.join(outputDir, "classification-frequency.csv"), report.classification_frequency);
  writeCsv(path.join(outputDir, "category-catalog-consistency.csv"), report.catalog_consistency);
  writeCsv(
    path.join(outputDir, "artist-reference-integrity.csv"),
    report.issues.orphan_artist_references,
  );
  writeCsv(
    path.join(outputDir, "home-section-concentration-risks.csv"),
    report.issues.high_concentration_legacy_home_tags,
  );

  return { report, outputDir };
}

const isMain =
  process.argv[1] &&
  path.basename(path.resolve(process.argv[1])) === path.basename(fileURLToPath(import.meta.url));

if (isMain) {
  runAudit()
    .then(({ report, outputDir }) => {
      process.stdout.write(
        `${JSON.stringify(
          {
            summary: report.summary,
            output_dir: outputDir,
          },
          null,
          2,
        )}\n`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
