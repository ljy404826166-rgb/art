#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, stringValue } from "./portrait-candidate-lib.mjs";

const DEFAULT_ROOT = path.resolve("outputs", "artist-portraits", "20260726T132051Z-task7");

const CANDIDATE_OVERRIDES = {
  "jan-van-eyck": "jan-van-eyck--commons-9171ebcd25482a91",
  "theodore-rousseau": "theodore-rousseau--commons-e51bdb2efbdb4a18",
};

const CROP_OVERRIDES = {
  "anders-zorn": { crop_focus_x: 0.5, crop_focus_y: 0.18, crop_zoom: 2 },
  "artemisia-gentileschi": { crop_focus_x: 0.58, crop_focus_y: 0.35, crop_zoom: 1.2 },
  "georges-goursat": { crop_focus_x: 0.5, crop_focus_y: 0.18, crop_zoom: 2.5 },
  "gerard-ter-borch": { crop_focus_x: 0.5, crop_focus_y: 0.18, crop_zoom: 2.5 },
  "jan-baptist-maes": { crop_focus_x: 0.5, crop_focus_y: 0.25, crop_zoom: 2 },
  "jean-leon-gerome": { crop_focus_x: 0.5, crop_focus_y: 0.18, crop_zoom: 2 },
  "joseph-denis-odevaere": { crop_focus_x: 0.5, crop_focus_y: 0.25, crop_zoom: 1.7 },
  "kazimir-malevich": { crop_focus_x: 0.5, crop_focus_y: 0.35, crop_zoom: 1.25 },
  "p-s-kroyer": { crop_focus_x: 0.45, crop_focus_y: 0.25, crop_zoom: 2.5 },
  "wassily-kandinsky": { crop_focus_x: 0.5, crop_focus_y: 0.35, crop_zoom: 1.15 },
  "winslow-homer": { crop_focus_x: 0.5, crop_focus_y: 0.18, crop_zoom: 2.5 },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(JSON.parse);
}

function inferPortraitKind(candidate = {}) {
  const text = [
    candidate.commons_file_name,
    candidate.artwork_title_zh,
    candidate.artwork_title_en,
    candidate.credit,
  ]
    .map(stringValue)
    .join(" ")
    .toLowerCase();
  if (/self.?portrait|autoportrait|selbstportr|autoritratto/u.test(text)) {
    return "self_portrait";
  }
  if (/photo|fotograf|photograph/u.test(text)) return "photograph";
  if (/drawing|sketch|dessin/u.test(text)) return "drawing";
  if (/engraving|etching|lithograph|print/u.test(text)) return "print";
  if (/sculpt|bust/u.test(text)) return "sculpture";
  return "painted_portrait";
}

function candidateSort(left, right) {
  return (
    Number(right.rank_score || 0) - Number(left.rank_score || 0) ||
    Number(left.review_rank || 999) - Number(right.review_rank || 999) ||
    stringValue(left.candidate_id).localeCompare(stringValue(right.candidate_id))
  );
}

export function finalizeBatchDecisions(proposed, candidates) {
  const byArtist = new Map();
  for (const candidate of candidates) {
    const bucket = byArtist.get(candidate.artist_id) || [];
    bucket.push(candidate);
    byArtist.set(candidate.artist_id, bucket);
  }
  return {
    ...proposed,
    reviewed_at: new Date().toISOString(),
    reviewer: "Codex-assisted Task 7 lightweight visual review",
    review_policy_version: "representative-avatar-v2-lightweight-256",
    decisions: proposed.decisions.map((decision) => {
      if (decision.final_status === "non_person_entity") {
        return {
          ...decision,
          quality_review: "not_applicable",
          review_notes: "该记录为机构或出版实体，不使用人物头像，保留文字回退。",
        };
      }
      const eligible = (byArtist.get(decision.artist_id) || [])
        .filter((candidate) => candidate.automated_assessment?.eligible_for_manual_review)
        .sort(candidateSort);
      const overrideId = CANDIDATE_OVERRIDES[decision.artist_id];
      const selected = overrideId
        ? eligible.find((candidate) => candidate.candidate_id === overrideId)
        : eligible.find((candidate) => candidate.candidate_id === decision.selected_candidate_id) ||
          eligible[0];
      if (!selected) {
        return {
          ...decision,
          selected_candidate_id: "",
          alternate_candidate_id: "",
          final_status: "no_eligible_asset",
          rejection_reasons: ["no_representative_open_license_candidate_after_task7_search"],
          quality_review: "not_applicable",
          review_notes: "任务七补搜后仍无同时满足代表性、来源和许可底线的头像，保留文字回退。",
        };
      }
      const alternate = eligible.find(
        (candidate) => candidate.candidate_id !== selected.candidate_id,
      );
      const evidenceUrls = [
        selected.source_page_url,
        selected.identity_evidence?.institution_source_url,
        selected.identity_evidence?.wikidata_url,
      ]
        .map(stringValue)
        .filter(Boolean);
      const associationReview =
        selected.candidate_reason === "targeted_manual_commons_search"
          ? "pass_representative_association"
          : "pass_authority_linked_candidate";
      return {
        ...decision,
        selected_candidate_id: selected.candidate_id,
        alternate_candidate_id: alternate?.candidate_id || "",
        final_status: "selected",
        portrait_kind: inferPortraitKind(selected),
        crop_focus_x: 0.5,
        crop_focus_y: 0.35,
        crop_zoom: 1,
        ...CROP_OVERRIDES[decision.artist_id],
        representation_review: associationReview,
        identity_review: associationReview,
        content_review: "pass",
        relationship_review:
          selected.candidate_origin === "project_artwork" ? "pass" : "not_applicable",
        rights_review: "pass",
        quality_review: "pass_contact_sheet_and_circle_crop",
        style_review: "pass",
        representation_evidence_urls: evidenceUrls,
        identity_evidence_urls: evidenceUrls,
        credit_override: selected.credit || selected.author || "Wikimedia Commons contributors",
        rejection_reasons: [],
        review_notes:
          "任务七轻量审核通过：该图片在圆形头像中能够清楚代表此画家，来源与开放许可元数据完整。",
      };
    }),
  };
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") options.root = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const outputs = [];
  for (const name of fs
    .readdirSync(options.root)
    .filter((entry) => /^task7-batch-\d+$/u.test(entry))
    .sort()) {
    const batchDir = path.join(options.root, name);
    const proposed = readJson(path.join(batchDir, "batch-decisions.proposed.json"));
    const candidates = readJsonl(path.join(batchDir, "pilot-candidates.jsonl"));
    const finalDecisions = finalizeBatchDecisions(proposed, candidates);
    const outputPath = path.join(batchDir, "batch-decisions.final.json");
    atomicWrite(outputPath, `${JSON.stringify(finalDecisions, null, 2)}\n`);
    outputs.push({
      batch: name,
      selected: finalDecisions.decisions.filter((item) => item.final_status === "selected").length,
      no_eligible_asset: finalDecisions.decisions.filter(
        (item) => item.final_status === "no_eligible_asset",
      ).length,
      non_person_entity: finalDecisions.decisions.filter(
        (item) => item.final_status === "non_person_entity",
      ).length,
      output: outputPath,
    });
  }
  console.log(JSON.stringify(outputs, null, 2));
}

if (
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    fs.realpathSync(path.resolve(process.argv[1])) ===
      fs.realpathSync(fileURLToPath(import.meta.url)))
) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
