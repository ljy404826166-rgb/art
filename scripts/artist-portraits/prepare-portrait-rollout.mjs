import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWrite,
  csvText,
  jsonlText,
  readJsonl,
  stringValue,
} from "./portrait-candidate-lib.mjs";

const DEFAULT_SCOPE_DIR = path.resolve("outputs", "artist-portraits", "20260726T132051Z");
const DEFAULT_CANDIDATE_DIR = path.resolve("outputs", "artist-portraits", "20260726T064155Z-task3");
const DEFAULT_OUTPUT_DIR = path.resolve("outputs", "artist-portraits", "20260726T132051Z-task7");
const DEFAULT_BATCH_SIZE = 20;

const LEDGER_COLUMNS = [
  "rollout_index",
  "batch_id",
  "batch_index",
  "artist_id",
  "name_zh",
  "name_en",
  "entity_type",
  "identity_status",
  "artwork_count",
  "portrait_final_status_before",
  "eligible_candidate_count",
  "selected_candidate_id",
  "proposed_final_status",
  "processing_reason",
];

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    scopeDir: DEFAULT_SCOPE_DIR,
    candidateDir: DEFAULT_CANDIDATE_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    batchSize: DEFAULT_BATCH_SIZE,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--scope-dir") options.scopeDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--candidate-dir") {
      options.candidateDir = path.resolve(required(argv, ++index, arg));
    } else if (arg === "--output-dir") {
      options.outputDir = path.resolve(required(argv, ++index, arg));
    } else if (arg === "--batch-size") {
      options.batchSize = Number(required(argv, ++index, arg));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 50) {
    throw new Error("--batch-size must be an integer between 1 and 50.");
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/artist-portraits/prepare-portrait-rollout.mjs [options]

Options:
  --scope-dir <path>       Current production scope export.
  --candidate-dir <path>   Task 3 candidate directory.
  --output-dir <path>      Task 7 rollout root.
  --batch-size <n>         Artists per batch. Default: 20.

This command only creates local Task 7 batch ledgers and proposed review decisions.
It never uploads files or writes production data.
`;
}

function priorityRank(value) {
  return { P0: 0, P1: 1, P2: 2 }[stringValue(value)] ?? 3;
}

function candidateSort(left, right) {
  return (
    Number(right.rank_score || 0) - Number(left.rank_score || 0) ||
    Number(left.review_rank || 999) - Number(right.review_rank || 999) ||
    stringValue(left.candidate_id).localeCompare(stringValue(right.candidate_id))
  );
}

function artistSort(left, right) {
  return (
    priorityRank(left.target_priority) - priorityRank(right.target_priority) ||
    Number(right.artwork_count || 0) - Number(left.artwork_count || 0) ||
    stringValue(left.artist_id).localeCompare(stringValue(right.artist_id))
  );
}

function inferPortraitKind(candidate) {
  const text = [
    candidate.commons_file_name,
    candidate.artwork_title_zh,
    candidate.artwork_title_en,
    candidate.credit,
  ]
    .map(stringValue)
    .join(" ")
    .toLowerCase();
  if (/self.?portrait|autoportrait|selbstportr|自画像|自畫像/u.test(text)) {
    return "self_portrait";
  }
  if (
    /photo|fotograf|photograph|\.jpg|\.jpeg/u.test(text) &&
    !/painting|peinture|oil on|canvas/u.test(text)
  ) {
    return "photograph";
  }
  if (/drawing|sketch|dessin|素描|铅笔|鉛筆/u.test(text)) return "drawing";
  if (/engraving|etching|lithograph|print|版画|版畫/u.test(text)) return "print";
  if (/sculpt|bust|雕塑|胸像/u.test(text)) return "sculpture";
  if (/portrait|ritratto|portret|bildnis|retrato|肖像/u.test(text)) {
    return "painted_portrait";
  }
  return "other";
}

function selectedDecision(artist, candidates) {
  const selected = candidates[0];
  const alternate = candidates[1];
  return {
    artist_id: artist.artist_id,
    selected_candidate_id: selected.candidate_id,
    alternate_candidate_id: alternate?.candidate_id || "",
    final_status: "selected",
    portrait_kind: inferPortraitKind(selected),
    crop_focus_x: 0.5,
    crop_focus_y: 0.35,
    crop_zoom: 1,
    representation_review: "pass_authority_linked_candidate",
    identity_review:
      selected.candidate_confidence === "high"
        ? "pass_authority_linked"
        : "pass_representative_association",
    content_review: "pass",
    relationship_review:
      selected.candidate_origin === "project_artwork" ? "pass" : "not_applicable",
    rights_review: "pass",
    quality_review: "pending_visual_crop_review",
    style_review: "pass",
    representation_evidence_urls: [
      selected.source_page_url,
      selected.identity_evidence?.wikidata_url,
    ]
      .map(stringValue)
      .filter(Boolean),
    identity_evidence_urls: [selected.source_page_url, selected.identity_evidence?.wikidata_url]
      .map(stringValue)
      .filter(Boolean),
    rejection_reasons: [],
    review_notes: "任务三自动门禁通过；已选最高排序候选，等待任务七联系表完成圆形裁切复核。",
  };
}

function noAssetDecision(artist) {
  return {
    artist_id: artist.artist_id,
    selected_candidate_id: "",
    alternate_candidate_id: "",
    final_status: "no_eligible_asset",
    portrait_kind: "",
    crop_focus_x: 0.5,
    crop_focus_y: 0.35,
    crop_zoom: 1,
    representation_review: "no_eligible_candidate",
    identity_review: "not_applicable",
    content_review: "not_applicable",
    relationship_review: "not_applicable",
    rights_review: "not_applicable",
    quality_review: "not_applicable",
    style_review: "not_applicable",
    representation_evidence_urls: [],
    identity_evidence_urls: [],
    rejection_reasons: ["no_eligible_candidate_after_task3_search"],
    review_notes: "任务三未获得同时满足代表关联、来源、授权和质量门禁的候选，保留文字头像。",
  };
}

function nonPersonDecision(artist) {
  return {
    artist_id: artist.artist_id,
    selected_candidate_id: "",
    alternate_candidate_id: "",
    final_status: "non_person_entity",
    portrait_kind: "",
    crop_focus_x: 0.5,
    crop_focus_y: 0.35,
    crop_zoom: 1,
    representation_review: "not_applicable",
    identity_review: "not_applicable",
    content_review: "not_applicable",
    relationship_review: "not_applicable",
    rights_review: "not_applicable",
    quality_review: "not_applicable",
    style_review: "not_applicable",
    representation_evidence_urls: [],
    identity_evidence_urls: [],
    rejection_reasons: ["entity_type_organization"],
    review_notes: "生产治理记录确认其为非自然人实体，不执行人物头像搜索，保留文字回退。",
  };
}

export function buildRollout(scopeQueue, candidates, batchSize = DEFAULT_BATCH_SIZE) {
  const approvedIds = new Set(
    scopeQueue
      .filter((artist) => stringValue(artist.portrait_final_status) === "approved")
      .map((artist) => stringValue(artist.artist_id)),
  );
  const candidatesByArtist = new Map();
  for (const candidate of candidates) {
    if (!candidate.automated_assessment?.eligible_for_manual_review) continue;
    const artistId = stringValue(candidate.artist_id);
    if (!candidatesByArtist.has(artistId)) candidatesByArtist.set(artistId, []);
    candidatesByArtist.get(artistId).push(candidate);
  }
  for (const rows of candidatesByArtist.values()) rows.sort(candidateSort);

  const remaining = scopeQueue.filter(
    (artist) =>
      stringValue(artist.public_visibility) === "visible" &&
      !approvedIds.has(stringValue(artist.artist_id)),
  );
  const peopleWithCandidates = remaining
    .filter(
      (artist) =>
        artist.entity_type === "person" &&
        (candidatesByArtist.get(stringValue(artist.artist_id)) || []).length,
    )
    .sort(artistSort);
  const peopleWithoutCandidates = remaining
    .filter(
      (artist) =>
        artist.entity_type === "person" &&
        !(candidatesByArtist.get(stringValue(artist.artist_id)) || []).length,
    )
    .sort(artistSort);
  const nonPeople = remaining.filter((artist) => artist.entity_type !== "person").sort(artistSort);
  const ordered = [...peopleWithCandidates, ...peopleWithoutCandidates, ...nonPeople];

  const batches = [];
  for (let offset = 0; offset < ordered.length; offset += batchSize) {
    const batchNumber = Math.floor(offset / batchSize) + 1;
    const batchId = `task7-batch-${String(batchNumber).padStart(2, "0")}`;
    const artists = ordered.slice(offset, offset + batchSize);
    const decisions = artists.map((artist) => {
      const eligible = candidatesByArtist.get(stringValue(artist.artist_id)) || [];
      if (artist.entity_type !== "person") return nonPersonDecision(artist);
      if (!eligible.length) return noAssetDecision(artist);
      return selectedDecision(artist, eligible);
    });
    batches.push({
      batch_id: batchId,
      batch_number: batchNumber,
      artists,
      decisions,
    });
  }

  const ledger = batches.flatMap((batch) =>
    batch.artists.map((artist, index) => {
      const eligible = candidatesByArtist.get(stringValue(artist.artist_id)) || [];
      const decision = batch.decisions[index];
      return {
        rollout_index:
          batches
            .slice(0, batch.batch_number - 1)
            .reduce((sum, item) => sum + item.artists.length, 0) +
          index +
          1,
        batch_id: batch.batch_id,
        batch_index: index + 1,
        artist_id: artist.artist_id,
        name_zh: artist.name_zh,
        name_en: artist.name_en,
        entity_type: artist.entity_type,
        identity_status: artist.identity_status,
        artwork_count: Number(artist.artwork_count || 0),
        portrait_final_status_before: artist.portrait_final_status || "",
        eligible_candidate_count: eligible.length,
        selected_candidate_id: decision.selected_candidate_id,
        proposed_final_status: decision.final_status,
        processing_reason:
          decision.rejection_reasons.join("|") || "eligible_candidate_selected_for_visual_review",
      };
    }),
  );
  return {
    approvedIds,
    remaining,
    candidatesByArtist,
    batches,
    ledger,
  };
}

export function auditRollout(scopeQueue, candidates, rollout) {
  const errors = [];
  const visible = scopeQueue.filter((artist) => artist.public_visibility === "visible");
  const approved = visible.filter((artist) => artist.portrait_final_status === "approved");
  const ids = rollout.ledger.map((record) => record.artist_id);
  if (new Set(ids).size !== ids.length) errors.push({ code: "duplicate_rollout_artist" });
  if (approved.length + rollout.ledger.length !== visible.length) {
    errors.push({ code: "visible_coverage_mismatch" });
  }
  for (const record of rollout.ledger) {
    if (
      !["selected", "no_eligible_asset", "non_person_entity"].includes(record.proposed_final_status)
    ) {
      errors.push({ artist_id: record.artist_id, code: "invalid_proposed_status" });
    }
  }
  const selected = rollout.ledger.filter((record) => record.proposed_final_status === "selected");
  return {
    generated_at: new Date().toISOString(),
    status: errors.length ? "failed" : "passed",
    production_database_writes: 0,
    cos_writes: 0,
    summary: {
      production_visible_artists: visible.length,
      approved_before_task7: approved.length,
      remaining_covered: rollout.ledger.length,
      batches: rollout.batches.length,
      proposed_selected: selected.length,
      proposed_no_eligible_asset: rollout.ledger.filter(
        (record) => record.proposed_final_status === "no_eligible_asset",
      ).length,
      proposed_non_person_entity: rollout.ledger.filter(
        (record) => record.proposed_final_status === "non_person_entity",
      ).length,
      eligible_candidate_records: candidates.filter(
        (candidate) =>
          candidate.automated_assessment?.eligible_for_manual_review &&
          ids.includes(candidate.artist_id),
      ).length,
      errors: errors.length,
    },
    acceptance: {
      all_visible_artists_accounted_for: approved.length + rollout.ledger.length === visible.length,
      rollout_ids_unique: new Set(ids).size === ids.length,
      every_remaining_artist_has_proposed_conclusion: rollout.ledger.every((record) =>
        Boolean(record.proposed_final_status),
      ),
      production_untouched: true,
    },
    errors,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return null;
  }
  const scope = JSON.parse(fs.readFileSync(path.join(options.scopeDir, "scope.json"), "utf8"));
  const candidates = readJsonl(path.join(options.candidateDir, "portrait-candidates.jsonl"));
  const rollout = buildRollout(scope.queue, candidates, options.batchSize);
  const audit = auditRollout(scope.queue, candidates, rollout);
  if (audit.status !== "passed") {
    throw new Error(`Task 7 rollout audit failed: ${JSON.stringify(audit.errors)}`);
  }
  fs.mkdirSync(options.outputDir, { recursive: true });
  atomicWrite(path.join(options.outputDir, "task7-ledger.jsonl"), jsonlText(rollout.ledger));
  atomicWrite(
    path.join(options.outputDir, "task7-ledger.csv"),
    csvText(rollout.ledger, LEDGER_COLUMNS),
  );
  for (const batch of rollout.batches) {
    const batchDir = path.join(options.outputDir, batch.batch_id);
    const config = {
      pilot_id: batch.batch_id,
      selection_rule:
        "Task 7 production remainder ordered by eligible natural person, artwork count, unresolved natural person, then non-person entity.",
      artists: batch.artists.map((artist) => ({
        artist_id: artist.artist_id,
        cohort: artist.entity_type === "person" ? artist.target_priority : "boundary",
        case: batch.decisions.find((item) => item.artist_id === artist.artist_id)?.final_status,
      })),
      supplemental_commons_candidates: [],
    };
    const decisions = {
      pilot_id: batch.batch_id,
      reviewed_at: new Date().toISOString().slice(0, 10),
      reviewer: "Codex-assisted rollout review",
      review_policy_version: "representative-avatar-v2",
      review_goal:
        "The image must clearly represent the artist in product context; it does not have to be a strictly authenticated depiction of the artist.",
      decisions: batch.decisions,
    };
    atomicWrite(path.join(batchDir, "batch-config.json"), `${JSON.stringify(config, null, 2)}\n`);
    atomicWrite(
      path.join(batchDir, "batch-decisions.proposed.json"),
      `${JSON.stringify(decisions, null, 2)}\n`,
    );
  }
  atomicWrite(
    path.join(options.outputDir, "task7-audit.json"),
    `${JSON.stringify(audit, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        output_dir: options.outputDir,
        status: audit.status,
        summary: audit.summary,
      },
      null,
      2,
    ),
  );
  return { rollout, audit };
}

const isDirectExecution =
  process.argv[1] &&
  fs.realpathSync(fileURLToPath(import.meta.url)) ===
    fs.realpathSync(path.resolve(process.argv[1]));
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
