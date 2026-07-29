#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_VERSION = "recommendation-system-v1";
const DEFAULT_TASK2_DIR = path.resolve("outputs", "recommendation-system", "task-02");
const DEFAULT_TASK3_DIR = path.resolve("outputs", "recommendation-system", "task-03");
const DEFAULT_TASK4_DIR = path.resolve("outputs", "recommendation-system", "task-04");
const DEFAULT_OUTPUT_DIR = path.resolve("outputs", "recommendation-system", "task-05");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
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

function withoutKeys(value, keys) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function releaseTerms(terms, releasedAt) {
  return terms.map((term) => {
    if (term.review_status !== "reviewed" || term.publish_status !== "draft") {
      return term;
    }
    return {
      ...term,
      publish_status: "published",
      published_at: releasedAt,
      release_version: RELEASE_VERSION,
    };
  });
}

function releaseChannels(channels, releasedTermIds) {
  return channels.map((channel) => {
    if (channel.kind !== "controlled_term" || !releasedTermIds.has(channel.query_value))
      return channel;
    return {
      ...channel,
      source_publish_status: "published",
      channel_status: channel.capacity_ready ? "published" : "long_tail",
      auto_feature_eligible: Boolean(channel.capacity_ready && channel.diversity_ready),
      release_version: RELEASE_VERSION,
    };
  });
}

function duplicateIds(rows) {
  const counts = new Map();
  rows.forEach((row) => counts.set(row._id, (counts.get(row._id) || 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

export function buildRelease({
  vocabulary,
  classificationArtworks,
  tagLinks,
  artistLinks,
  recommendationPatches,
  signals,
  channels,
  signalLinks,
  releasedAt,
}) {
  const terms = releaseTerms(vocabulary.terms, releasedAt);
  const releasedTermIds = new Set(
    terms
      .filter(
        (term) =>
          term.publish_status === "published" &&
          vocabulary.terms.find((source) => source._id === term._id)?.publish_status === "draft",
      )
      .map((term) => term._id),
  );
  const termById = new Map(terms.map((term) => [term._id, term]));
  const recommendationById = new Map(recommendationPatches.map((patch) => [patch._id, patch]));
  const artworks = classificationArtworks.map((classification) => {
    const recommendation = recommendationById.get(classification._id);
    if (!recommendation) throw new Error(`Missing recommendation patch ${classification._id}`);
    return {
      ...withoutKeys(classification, ["previous", "changed"]),
      ...withoutKeys(recommendation, ["previous"]),
      release_version: RELEASE_VERSION,
      release_updated_at: releasedAt,
    };
  });
  const releasedTagLinks = tagLinks.map((link) => ({
    ...link,
    term_publish_status: termById.get(link.tag_id)?.publish_status || link.term_publish_status,
    release_version: RELEASE_VERSION,
  }));
  const releasedChannels = releaseChannels(channels, releasedTermIds);
  const termIds = new Set(terms.map((term) => term._id));
  const signalIds = new Set(signals.map((signal) => signal._id));
  const artworkIds = new Set(artworks.map((artwork) => artwork._id));
  const checks = {
    artworks: artworks.length,
    promoted_terms: releasedTermIds.size,
    duplicate_artwork_ids: duplicateIds(artworks),
    duplicate_tag_link_ids: duplicateIds(releasedTagLinks),
    duplicate_artist_link_ids: duplicateIds(artistLinks),
    duplicate_signal_link_ids: duplicateIds(signalLinks),
    duplicate_channel_ids: duplicateIds(releasedChannels),
    unknown_tag_ids: [
      ...new Set(releasedTagLinks.map((link) => link.tag_id).filter((id) => !termIds.has(id))),
    ],
    unknown_signal_ids: [
      ...new Set(signalLinks.map((link) => link.signal_id).filter((id) => !signalIds.has(id))),
    ],
    missing_tag_link_artworks: [
      ...new Set(
        releasedTagLinks.map((link) => link.artwork_id).filter((id) => !artworkIds.has(id)),
      ),
    ],
    missing_artist_link_artworks: [
      ...new Set(artistLinks.map((link) => link.artwork_id).filter((id) => !artworkIds.has(id))),
    ],
    missing_signal_link_artworks: [
      ...new Set(signalLinks.map((link) => link.artwork_id).filter((id) => !artworkIds.has(id))),
    ],
    candidate_channels: releasedChannels.filter((channel) => channel.channel_status === "candidate")
      .length,
  };
  checks.ok = Object.entries(checks)
    .filter(([key]) => !["artworks", "promoted_terms", "candidate_channels"].includes(key))
    .every(([, value]) => Array.isArray(value) && value.length === 0);
  return {
    version: RELEASE_VERSION,
    releasedAt,
    terms,
    artworks,
    tagLinks: releasedTagLinks,
    artistLinks,
    signals,
    channels: releasedChannels,
    signalLinks,
    checks,
  };
}

function buildMarkdown(release) {
  return `# 推荐体系 v1 发布清单（任务五）

生成时间：${release.releasedAt}

- 作品：${release.artworks.length}
- 受控词条：${release.terms.length}
- 本阶段由 draft 晋升为 published 的 reviewed 词条：${release.checks.promoted_terms}
- 作品—词条关系：${release.tagLinks.length}
- 作品—画家关系：${release.artistLinks.length}
- 推荐信号：${release.signals.length}
- 作品—推荐信号关系：${release.signalLinks.length}
- 推荐频道：${release.channels.length}
- 仍为 candidate 的频道：${release.checks.candidate_channels}
- 引用完整性：${release.checks.ok ? "通过" : "未通过"}

晋升仅适用于任务二中已经设置为 \`reviewed + draft\`、并已通过任务三全量迁移和任务四频道预演的词条。分类页目录仍由客户端固定目录控制，不会因为词条晋升自动增加筛选项。
`;
}

export function runBuild({
  task2Dir = DEFAULT_TASK2_DIR,
  task3Dir = DEFAULT_TASK3_DIR,
  task4Dir = DEFAULT_TASK4_DIR,
  outputDir = DEFAULT_OUTPUT_DIR,
  releasedAt = new Date().toISOString(),
} = {}) {
  const release = buildRelease({
    vocabulary: readJson(path.join(task2Dir, "controlled-vocabulary-v1.json")),
    classificationArtworks: readJsonl(path.join(task3Dir, "classification-v6-artworks.jsonl")),
    tagLinks: readJsonl(path.join(task3Dir, "classification-v6-artwork-tag-links.jsonl")),
    artistLinks: readJsonl(path.join(task3Dir, "classification-v6-artwork-artist-links.jsonl")),
    recommendationPatches: readJsonl(path.join(task4Dir, "recommendation-artwork-patches.jsonl")),
    signals: readJson(path.join(task4Dir, "recommendation-signals-v1.json")).signals,
    channels: readJson(path.join(task4Dir, "recommendation-channels-v1.json")).channels,
    signalLinks: readJsonl(path.join(task4Dir, "artwork-recommendation-signal-links.jsonl")),
    releasedAt,
  });
  if (!release.checks.ok) {
    throw new Error(`Release validation failed: ${JSON.stringify(release.checks)}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, "release-artworks.jsonl"), release.artworks);
  writeJsonl(path.join(outputDir, "release-vocab-terms.jsonl"), release.terms);
  writeJsonl(path.join(outputDir, "release-artwork-tag-links.jsonl"), release.tagLinks);
  writeJsonl(path.join(outputDir, "release-artwork-artist-links.jsonl"), release.artistLinks);
  writeJsonl(path.join(outputDir, "release-recommendation-signals.jsonl"), release.signals);
  writeJsonl(path.join(outputDir, "release-recommendation-channels.jsonl"), release.channels);
  writeJsonl(
    path.join(outputDir, "release-artwork-recommendation-signal-links.jsonl"),
    release.signalLinks,
  );
  writeJson(path.join(outputDir, "task-05-release-report.json"), {
    version: release.version,
    released_at: release.releasedAt,
    counts: {
      artworks: release.artworks.length,
      vocab_terms: release.terms.length,
      tag_links: release.tagLinks.length,
      artist_links: release.artistLinks.length,
      signals: release.signals.length,
      channels: release.channels.length,
      signal_links: release.signalLinks.length,
    },
    checks: release.checks,
  });
  fs.writeFileSync(
    path.join(outputDir, "task-05-release-report.md"),
    buildMarkdown(release),
    "utf8",
  );
  return release;
}

const isMain =
  process.argv[1] &&
  path.basename(path.resolve(process.argv[1])) === path.basename(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const release = runBuild();
    console.log(
      JSON.stringify(
        {
          output_dir: DEFAULT_OUTPUT_DIR,
          checks: release.checks,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
