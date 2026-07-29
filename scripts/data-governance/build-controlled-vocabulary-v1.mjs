#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIST_ALIAS_OVERLAY,
  CONTROLLED_VOCABULARY_VERSION,
  DIMENSION_POLICIES,
  TARGET_CLASSIFICATION_VERSION,
  buildArtistDimensionCatalog,
  buildControlledVocabulary,
  buildLegacyTagRouting,
  loadCategoryCatalog,
  validateControlledVocabulary,
} from "./controlled-vocabulary-v1.mjs";

const DEFAULT_TASK1_REPORT = path.resolve(
  process.cwd(),
  "outputs",
  "recommendation-system",
  "task-01",
  "recommendation-readiness-audit.json",
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  process.cwd(),
  "outputs",
  "recommendation-system",
  "task-02",
);

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

function countBy(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] || "unknown";
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function buildArtistPolicy(artistDimensions, task1Report) {
  const statusCounts = countBy(artistDimensions, "public_dimension_status");
  return {
    version: CONTROLLED_VOCABULARY_VERSION,
    decision: {
      artists_are_vocab_terms: false,
      dimension_type: "artist",
      query_field: "artist_ids",
      channel_reference_format: "artist:<canonical_artist_id>",
      every_reviewed_painter_gets_dimension: true,
      every_painter_is_default_home_channel: false,
      default_home_min_artworks: 8,
    },
    eligibility_rules: [
      "entity_type=person",
      "review_status=reviewed",
      "artist_id resolves to an artists document",
      "at least one published artwork references the artist_id",
    ],
    non_person_rules: {
      organization: "保留创作者实体，但默认不作为“画家”推荐维度。",
      workshop: "保留工作室实体；只有经策展确认后才能形成公开频道。",
      attribution: "圈子、追随者等归属实体不冒充本人频道。",
      anonymous: "匿名作者不形成单一画家频道，可进入匿名艺术专题。",
      unresolved: "身份未解决前不得发布画家推荐维度。",
      rejected: "不得进入推荐体系。",
    },
    unknown_attribution_rules: [
      {
        input: "已知具体画家但旧 slug 不一致",
        action: "映射到 canonical artist_id，旧 ID 作为别名保留。",
      },
      {
        input: "French、Italian、Flemish 等国别或画派归属",
        action: "创建 attribution 实体或映射地区词条，不创建虚构人物画家。",
      },
      {
        input: "Anonymous",
        action: "使用 anonymous 实体，不作为具体画家频道。",
      },
      {
        input: "Unknown、暂不明确",
        action: "artist_ids 留空并保留 raw_artist_text，不创建统一未知画家频道。",
      },
      {
        input: "workshop/circle/follower/after",
        action: "使用独立 attribution/workshop 实体并在 artwork_artist_links.role 中记录关系。",
      },
    ],
    alias_overlay: ARTIST_ALIAS_OVERLAY,
    registered_artist_count: task1Report.summary.registered_artist_dimensions,
    dimension_status_counts: statusCounts,
    orphan_reference_count: task1Report.summary.orphan_artist_ids,
    orphan_affected_artworks: task1Report.summary.artworks_with_orphan_artist_reference,
    dimensions: artistDimensions,
  };
}

function buildMarkdown({ validation, routing, artistPolicy, terms }) {
  const routingCounts = countBy(routing, "route_type");
  const topSignalCandidates = routing
    .filter((row) => row.route_type === "recommendation_signal_candidate")
    .slice(0, 20);
  const typeRows = Object.entries(validation.counts_by_type);
  return `# 受控分类词表与画家推荐维度（任务二）

生成时间：${new Date().toISOString()}

## 结果

- 词表版本：\`${CONTROLLED_VOCABULARY_VERSION}\`
- 目标分类版本：\`${TARGET_CLASSIFICATION_VERSION}\`
- 总词条：${validation.term_count}
- 沿用并保持 ID 不变的已发布词条：${validation.published_terms}
- 新增待部署词条：${validation.draft_terms}
- 当前已发布分类页词条：${validation.published_classification_filter_terms}
- 新增分类页候选词条：${validation.draft_classification_filter_terms}
- 推荐可用受控词条：${validation.recommendation_terms}
- 校验错误：${validation.errors.length}
- 校验警告：${validation.warnings.length}

## 分类维度

| 类型 | 中文名称 | 词条数 | 分类页 | 推荐 |
|---|---|---:|---|---|
${typeRows
  .map(([type, count]) => {
    const policy = DIMENSION_POLICIES[type];
    return `| ${type} | ${policy.label_zh} | ${count} | ${policy.classification_page ? "是" : "否"} | ${policy.recommendation ? "是" : "否"} |`;
  })
  .join("\n")}

分类页继续只显示已发布、已审核的流派、题材和 decade 年代。媒介、技法、载体、形式、系列、地区等先用于推荐、搜索和元数据，不自动进入分类页。

## 旧标签分流

${Object.entries(routingCounts)
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}

仍待任务四设计为推荐信号或人工复核的高频标签：

| 标签 | 作品数 | 当前建议 |
|---|---:|---|
${topSignalCandidates.map((row) => `| ${row.label} | ${row.artwork_count} | recommendation_signal_candidate |`).join("\n")}

## 画家推荐维度

- 画家不是普通词表词条，直接复用 \`artists._id\` 和作品的 \`artist_ids\`。
- 频道引用格式为 \`artist:<canonical_artist_id>\`。
- 每位已审核、可解析且至少有一件作品的 person 画家都有推荐维度。
- 拥有至少 8 件作品只决定是否适合作为常驻首页频道，不决定维度是否存在。
- 当前状态分布：${Object.entries(artistPolicy.dimension_status_counts)
    .map(([key, value]) => `${key}=${value}`)
    .join("，")}。

## 发布边界

1. 本阶段产物均为本地候选目录，不写云端。
2. 原有110个分类词条保持已发布状态和稳定 ID。
3. 新增词条为 reviewed + draft，必须在迁移预演后再发布。
4. 别名必须唯一归属；出现冲突时禁止自动匹配。
5. 上下级关系只作为知识关系保存，首版查询不自动递归扩展。
6. 首页推荐信号体系将在任务四建立，不将色彩、情绪、季节等内容塞入严格分类。
`;
}

export function runBuild({
  task1ReportPath = DEFAULT_TASK1_REPORT,
  outputDir = DEFAULT_OUTPUT_DIR,
} = {}) {
  const task1Report = JSON.parse(fs.readFileSync(task1ReportPath, "utf8"));
  const terms = buildControlledVocabulary(loadCategoryCatalog());
  const validation = validateControlledVocabulary(terms);
  if (!validation.ok) {
    throw new Error(
      `Controlled vocabulary validation failed: ${JSON.stringify(validation.errors)}`,
    );
  }
  const routing = buildLegacyTagRouting(task1Report.legacy_tag_frequency, terms).sort(
    (left, right) => right.artwork_count - left.artwork_count,
  );
  const artistDimensions = buildArtistDimensionCatalog(
    task1Report.artist_recommendation_dimensions,
  );
  const artistPolicy = buildArtistPolicy(artistDimensions, task1Report);
  const report = {
    generated_at: new Date().toISOString(),
    version: CONTROLLED_VOCABULARY_VERSION,
    target_classification_version: TARGET_CLASSIFICATION_VERSION,
    validation,
    legacy_routing_counts: countBy(routing, "route_type"),
    artist_dimension_status_counts: artistPolicy.dimension_status_counts,
    source_task1_report: path.relative(process.cwd(), task1ReportPath).replaceAll("\\", "/"),
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "controlled-vocabulary-v1.json"),
    `${JSON.stringify(
      {
        version: CONTROLLED_VOCABULARY_VERSION,
        target_classification_version: TARGET_CLASSIFICATION_VERSION,
        dimensions: DIMENSION_POLICIES,
        terms,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "vocabulary-validation.json"),
    `${JSON.stringify(validation, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "artist-dimension-policy.json"),
    `${JSON.stringify(artistPolicy, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "task-02-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "task-02-report.md"),
    buildMarkdown({ validation, routing, artistPolicy, terms }),
    "utf8",
  );
  writeCsv(path.join(outputDir, "legacy-tag-routing.csv"), routing);
  writeCsv(path.join(outputDir, "artist-dimensions.csv"), artistDimensions);

  return {
    outputDir,
    validation,
    routingCounts: report.legacy_routing_counts,
    artistDimensionStatusCounts: report.artist_dimension_status_counts,
  };
}

const isMain =
  process.argv[1] &&
  path.basename(path.resolve(process.argv[1])) === path.basename(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    process.stdout.write(`${JSON.stringify(runBuild(), null, 2)}\n`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
