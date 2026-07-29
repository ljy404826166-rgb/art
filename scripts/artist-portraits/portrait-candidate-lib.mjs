import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CANDIDATE_SCHEMA_VERSION = 1;
export const MAX_CANDIDATES_PER_ARTIST = 3;
// Artist portraits are rendered as small circular avatars (roughly 96 CSS px).
// A 256 px short edge still provides a 2x display source while avoiding the
// exclusion of otherwise representative public-domain historical portraits.
export const MIN_PORTRAIT_EDGE = 256;
export const SUPPORTED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);

export function stringValue(value) {
  return String(value ?? "").trim();
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function stripHtml(value) {
  return stringValue(value)
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

export function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

export function jsonlText(records) {
  return records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
}

export function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filePath);
}

export function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function cacheKey(value) {
  return crypto.createHash("sha256").update(stringValue(value)).digest("hex");
}

export function normalizeUrl(value) {
  const text = stringValue(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/iu.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return text;
  }
}

export function isDirectMediaUrl(value) {
  const text = stringValue(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    return (
      /\.(?:avif|gif|jpe?g|png|tiff?|webp)(?:$|\?)/iu.test(url.pathname) ||
      /\/storage\/v1\/object\//u.test(url.pathname) ||
      /\/derivatives\//u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function commonsDescriptionUrl(fileName) {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(
    stringValue(fileName).replace(/^File:/iu, ""),
  ).replace(/%20/gu, "_")}`;
}

export function metadataValue(metadata, field) {
  return stripHtml(metadata?.[field]?.value);
}

export function licenseAssessment(licenseName, licenseUrl, rightsStatus = "") {
  const name = stringValue(licenseName);
  const url = stringValue(licenseUrl);
  const rights = stringValue(rightsStatus);
  const joined = `${name} ${url} ${rights}`.toLowerCase();
  const unknown = !name && !url && (!rights || /unreviewed|unknown|pending/u.test(rights));
  const blocked =
    /all rights reserved|copyrighted|non.?commercial|\bnc\b|no derivatives|\bnd\b/u.test(joined);
  const open =
    /public domain|\bpd[-_ ]|cc0|creative commons.*(?:by|zero)|creativecommons\.org\/(?:licenses\/by|publicdomain)/u.test(
      joined,
    ) && !blocked;
  return {
    status: blocked ? "blocked" : open ? "open" : "unknown",
    license_name: name,
    license_url: url,
  };
}

export function imageAssessment({ width, height, mime }) {
  const normalizedMime = stringValue(mime).toLowerCase();
  const numericWidth = Number(width || 0);
  const numericHeight = Number(height || 0);
  const hasDimensions = numericWidth > 0 && numericHeight > 0;
  return {
    dimensions_known: hasDimensions,
    dimensions_ok: hasDimensions
      ? Math.min(numericWidth, numericHeight) >= MIN_PORTRAIT_EDGE
      : false,
    mime_known: Boolean(normalizedMime),
    mime_ok: SUPPORTED_IMAGE_MIMES.has(normalizedMime),
  };
}

function candidateAssessment({
  identityOk,
  sourcePageUrl,
  license,
  image,
  apiError = "",
  allowUnknownImageMetadata = false,
}) {
  const rejectionReasons = [];
  const warnings = [];
  if (apiError) rejectionReasons.push("api_metadata_unavailable");
  if (!identityOk) rejectionReasons.push("identity_evidence_missing");
  if (!sourcePageUrl) rejectionReasons.push("source_description_page_missing");
  if (license.status === "unknown") rejectionReasons.push("authorization_unknown");
  if (license.status === "blocked") rejectionReasons.push("license_not_eligible");
  if (!image.mime_known || !image.dimensions_known) {
    if (allowUnknownImageMetadata) warnings.push("image_metadata_requires_manual_check");
    else rejectionReasons.push("image_metadata_incomplete");
  }
  if (image.mime_known && !image.mime_ok) rejectionReasons.push("unsupported_image_format");
  if (image.dimensions_known && !image.dimensions_ok) rejectionReasons.push("image_too_small");
  return {
    status: rejectionReasons.length ? "auto_rejected" : "eligible_for_manual_review",
    eligible_for_manual_review: rejectionReasons.length === 0,
    rejection_reasons: unique(rejectionReasons),
    warnings: unique(warnings),
    checks: {
      identity: identityOk ? "pass" : "fail",
      source_description_page: sourcePageUrl ? "pass" : "fail",
      license: license.status,
      dimensions: image.dimensions_known ? (image.dimensions_ok ? "pass" : "fail") : "unknown",
      mime: image.mime_known ? (image.mime_ok ? "pass" : "fail") : "unknown",
    },
  };
}

export function buildProjectCandidate(raw = {}, artist = {}, probe = {}) {
  const sourceUrl = stringValue(raw.source_url);
  const sourcePageUrl = isDirectMediaUrl(sourceUrl) ? "" : sourceUrl;
  const license = licenseAssessment(
    raw.license_name || raw.license,
    raw.license_url,
    raw.rights_status,
  );
  const mime = stringValue(probe.mime);
  const width = Number(probe.width || 0);
  const height = Number(probe.height || 0);
  const image = imageAssessment({ width, height, mime });
  const identityOk = Boolean(
    stringValue(raw.artist_id) &&
    stringValue(raw.artwork_id) &&
    (stringValue(raw.relationship_evidence?.primary_artist_id) === stringValue(raw.artist_id) ||
      asArray(raw.relationship_evidence?.artist_ids).includes(raw.artist_id) ||
      asArray(raw.relationship_evidence?.link_ids).length),
  );
  const assessment = candidateAssessment({
    identityOk,
    sourcePageUrl,
    license,
    image,
    apiError: probe.error,
    allowUnknownImageMetadata: true,
  });
  const confidence = stringValue(raw.candidate_confidence);
  const score =
    300 +
    (confidence === "high" ? 30 : confidence === "medium" ? 20 : 0) +
    (assessment.eligible_for_manual_review ? 40 : 0);
  return {
    candidate_schema_version: CANDIDATE_SCHEMA_VERSION,
    candidate_id:
      stringValue(raw.candidate_id) ||
      `${stringValue(raw.artist_id)}--${stringValue(raw.artwork_id)}`,
    candidate_origin: "project_artwork",
    artist_id: stringValue(raw.artist_id),
    name_zh: stringValue(raw.name_zh || artist.name_zh),
    name_en: stringValue(raw.name_en || artist.name_en),
    target_priority: stringValue(artist.target_priority),
    artwork_id: stringValue(raw.artwork_id),
    artwork_title_zh: stringValue(raw.title_cn),
    artwork_title_en: stringValue(raw.title_en),
    wikidata_qid: stringValue(artist.wikidata_qid),
    commons_file_name: "",
    source_name: stringValue(raw.source_name),
    source_page_url: sourcePageUrl,
    original_download_url: stringValue(raw.download_url || raw.image_url),
    preview_url: stringValue(raw.display_url || raw.thumbnail_url || raw.image_url),
    author: "",
    license_name: license.license_name,
    license_url: license.license_url,
    credit: "",
    rights_status: stringValue(raw.rights_status) || "unreviewed",
    width,
    height,
    byte_size: Number(probe.byte_size || 0),
    mime,
    sha1: stringValue(probe.sha1),
    identity_evidence: {
      type: "stable_project_artist_artwork_relation",
      artist_id: stringValue(raw.artist_id),
      artwork_id: stringValue(raw.artwork_id),
      relationship_type: stringValue(raw.relationship_type),
      link_ids: asArray(raw.relationship_evidence?.link_ids),
    },
    candidate_reason: stringValue(raw.candidate_reason),
    candidate_confidence: confidence,
    rank_score: score,
    automated_assessment: assessment,
    review_status: "pending_manual_review",
    reviewer_decision: "",
    reviewer_notes: "",
  };
}

function p18FileNames(entity = {}) {
  return unique(
    asArray(entity?.claims?.P18)
      .filter((claim) => claim?.rank !== "deprecated")
      .map((claim) => stringValue(claim?.mainsnak?.datavalue?.value))
      .filter(Boolean),
  );
}

export function wikidataP18FileNames(entity = {}) {
  return p18FileNames(entity);
}

export function buildCommonsCandidate({
  artist = {},
  entity = {},
  fileName,
  commonsPage = {},
  apiError = "",
}) {
  const imageInfo = asArray(commonsPage?.imageinfo)[0] || {};
  const metadata = imageInfo.extmetadata || {};
  const licenseName =
    metadataValue(metadata, "LicenseShortName") || metadataValue(metadata, "UsageTerms");
  const licenseUrl = metadataValue(metadata, "LicenseUrl");
  const license = licenseAssessment(licenseName, licenseUrl);
  const sourcePageUrl = stringValue(imageInfo.descriptionurl) || commonsDescriptionUrl(fileName);
  const width = Number(imageInfo.width || 0);
  const height = Number(imageInfo.height || 0);
  const mime = stringValue(imageInfo.mime).toLowerCase();
  const image = imageAssessment({ width, height, mime });
  const qid = stringValue(artist.wikidata_qid);
  const identityOk = Boolean(qid && p18FileNames(entity).includes(fileName));
  const assessment = candidateAssessment({
    identityOk,
    sourcePageUrl,
    license,
    image,
    apiError,
  });
  const copyrighted = metadataValue(metadata, "Copyrighted");
  if (/true|yes/iu.test(copyrighted) && license.status !== "open") {
    assessment.status = "auto_rejected";
    assessment.eligible_for_manual_review = false;
    assessment.rejection_reasons = unique([
      ...assessment.rejection_reasons,
      "copyright_status_requires_review",
    ]);
  }
  const fileSha1 = stringValue(imageInfo.sha1);
  return {
    candidate_schema_version: CANDIDATE_SCHEMA_VERSION,
    candidate_id: `${stringValue(artist.artist_id)}--commons-${cacheKey(fileName).slice(0, 16)}`,
    candidate_origin: "wikimedia_commons",
    artist_id: stringValue(artist.artist_id),
    name_zh: stringValue(artist.name_zh),
    name_en: stringValue(artist.name_en),
    target_priority: stringValue(artist.target_priority),
    artwork_id: "",
    artwork_title_zh: "",
    artwork_title_en: "",
    wikidata_qid: qid,
    commons_file_name: stringValue(fileName),
    source_name: "Wikimedia Commons",
    source_page_url: sourcePageUrl,
    original_download_url: stringValue(imageInfo.url),
    preview_url: stringValue(imageInfo.thumburl || imageInfo.url),
    author: metadataValue(metadata, "Artist"),
    license_name: license.license_name,
    license_url: license.license_url,
    credit:
      metadataValue(metadata, "Attribution") ||
      metadataValue(metadata, "Credit") ||
      metadataValue(metadata, "Artist"),
    rights_status: license.status === "open" ? "open_license_metadata" : license.status,
    width,
    height,
    byte_size: Number(imageInfo.size || 0),
    mime,
    sha1: fileSha1,
    identity_evidence: {
      type: "wikidata_p18_claim",
      artist_id: stringValue(artist.artist_id),
      wikidata_qid: qid,
      property: "P18",
      file_name: stringValue(fileName),
      wikidata_url: qid ? `https://www.wikidata.org/wiki/${qid}` : "",
    },
    candidate_reason: "wikidata_p18",
    candidate_confidence: "high",
    rank_score: 240 + (assessment.eligible_for_manual_review ? 50 : 0),
    automated_assessment: assessment,
    review_status: "pending_manual_review",
    reviewer_decision: "",
    reviewer_notes: "",
  };
}

function candidateDeduplicationKey(candidate) {
  const hash = stringValue(candidate.sha1).toLowerCase();
  if (hash) return `sha1:${hash}`;
  const url = normalizeUrl(candidate.original_download_url || candidate.preview_url);
  return url ? `url:${url}` : `id:${candidate.candidate_id}`;
}

function sortCandidates(left, right) {
  const leftEligible = left.automated_assessment?.eligible_for_manual_review ? 1 : 0;
  const rightEligible = right.automated_assessment?.eligible_for_manual_review ? 1 : 0;
  return (
    rightEligible - leftEligible ||
    Number(right.rank_score || 0) - Number(left.rank_score || 0) ||
    stringValue(left.candidate_id).localeCompare(stringValue(right.candidate_id))
  );
}

export function selectCandidates(candidates, maxPerArtist = MAX_CANDIDATES_PER_ARTIST) {
  const globallySeen = new Set();
  const duplicates = [];
  const byArtist = new Map();
  for (const candidate of [...candidates].sort(sortCandidates)) {
    const key = candidateDeduplicationKey(candidate);
    if (globallySeen.has(key)) {
      duplicates.push({
        candidate_id: candidate.candidate_id,
        artist_id: candidate.artist_id,
        reason: "duplicate_file",
        deduplication_key: key,
      });
      continue;
    }
    globallySeen.add(key);
    const bucket = byArtist.get(candidate.artist_id) || [];
    bucket.push(candidate);
    byArtist.set(candidate.artist_id, bucket);
  }

  const selected = [];
  const overflow = [];
  for (const [artistId, values] of byArtist.entries()) {
    const sorted = values.sort(sortCandidates);
    let kept = sorted.slice(0, maxPerArtist);
    const external = sorted.find(
      (candidate) =>
        candidate.candidate_origin === "wikimedia_commons" &&
        candidate.automated_assessment?.eligible_for_manual_review,
    );
    const hasProject = kept.some((candidate) => candidate.candidate_origin === "project_artwork");
    if (external && hasProject && !kept.includes(external)) {
      kept = [...kept.slice(0, Math.max(0, maxPerArtist - 1)), external].sort(sortCandidates);
    }
    const keptIds = new Set(kept.map((candidate) => candidate.candidate_id));
    selected.push(
      ...kept.map((candidate, index) => ({
        ...candidate,
        review_rank: index + 1,
      })),
    );
    overflow.push(
      ...sorted
        .filter((candidate) => !keptIds.has(candidate.candidate_id))
        .map((candidate) => ({
          candidate_id: candidate.candidate_id,
          artist_id: artistId,
          reason: "artist_candidate_limit",
        })),
    );
  }
  return {
    selected: selected.sort(
      (left, right) =>
        stringValue(left.artist_id).localeCompare(stringValue(right.artist_id)) ||
        Number(left.review_rank || 0) - Number(right.review_rank || 0),
    ),
    duplicates,
    overflow,
  };
}

export function buildManualSearchRecord(artist = {}, reason = "no_eligible_p18") {
  const name = stringValue(artist.name_en || artist.name_zh);
  const lifespan = [artist.birth_year, artist.death_year]
    .filter((value) => value != null)
    .join("-");
  const identity = `${name}${lifespan ? ` ${lifespan}` : ""}`.trim();
  const suffixes = ["portrait", "photograph", "self portrait", "drawing", "Wikimedia Commons"];
  const directedSources = asArray(artist.sources)
    .map((source) => ({
      title: stringValue(source.title),
      publisher: stringValue(source.publisher),
      url: stringValue(source.url),
    }))
    .filter((source) => /^https?:\/\//iu.test(source.url))
    .filter((source) => !/wikidata\.org|\/artworks?\/?$/iu.test(source.url));
  return {
    artist_id: stringValue(artist.artist_id),
    name_zh: stringValue(artist.name_zh),
    name_en: stringValue(artist.name_en),
    birth_year: artist.birth_year ?? null,
    death_year: artist.death_year ?? null,
    wikidata_qid: stringValue(artist.wikidata_qid),
    reason,
    queries: suffixes.map((suffix) => `"${identity}" ${suffix}`),
    directed_sources: directedSources,
    aliases: asArray(artist.aliases),
    review_status: "manual_search_required",
  };
}

export function csvText(rows, columns) {
  const escape = (value) => {
    const text = Array.isArray(value)
      ? value.join(" | ")
      : value && typeof value === "object"
        ? JSON.stringify(value)
        : stringValue(value);
    return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  return `\uFEFF${[
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\n")}\n`;
}

export function candidateAuditSummary(candidates, searchRecords = []) {
  const byOrigin = {};
  const byStatus = {};
  const artists = new Set();
  for (const candidate of candidates) {
    artists.add(candidate.artist_id);
    byOrigin[candidate.candidate_origin] = (byOrigin[candidate.candidate_origin] || 0) + 1;
    const status = candidate.automated_assessment?.status || "(missing)";
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return {
    candidates: candidates.length,
    artists_with_candidates: artists.size,
    by_origin: byOrigin,
    by_automated_status: byStatus,
    manual_search_artists: searchRecords.length,
  };
}
