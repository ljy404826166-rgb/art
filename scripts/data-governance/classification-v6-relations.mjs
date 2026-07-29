import {
  ARTIST_ALIAS_OVERLAY,
  CONTROLLED_VOCABULARY_VERSION,
  INTERNAL_OR_NOISE_LABELS,
  TARGET_CLASSIFICATION_VERSION,
  buildVocabularyIndex,
  normalizeVocabularyLabel,
} from "./controlled-vocabulary-v1.mjs";

const CLASSIFICATION_MAX_IDS = 8;
const AMBIGUOUS_LEGACY_LABELS = new Set(["花鸟虫兽", "花卉或水果"]);
const BOTANICAL_EVIDENCE_PATTERN =
  /植物|植物学|植物图谱|草莓|苹果|曼陀罗|荨麻|睡莲|啤酒花|蒲公英|旋花|向日葵|茅膏菜|葫芦|botan|strawberry|apple|thornapple|nettle|water lily|hops|dandelion|bindweed|sunflower|sundew|coloquintes/iu;
const ILLUSTRATION_EVIDENCE_PATTERN =
  /插图|图版|图谱|版画|印刷|素描集|illustration|plate\b|print|woodcut|engraving/iu;
const CURATED_TERM_OVERRIDES = {
  "artwork_3531059a-dabe-49bd-b05b-af23c110b894": ["subject-history-painting"],
  "artwork_90f90995-6b7e-4552-8d05-d4e897f30eca": ["subject-portrait", "subject-figure"],
  "artwork_ba52eef6-3dd1-47af-93ef-f66697875f3b": [
    "subject-portrait",
    "subject-figure",
    "subject-interior",
  ],
  "artwork_a0754c0f-4684-4529-b2f9-6b28bdd0a6e9": ["subject-genre-scene", "subject-figure"],
};

const ARTIST_ID_REPAIRS = {
  "antonio-z-ol": "antonio-zunol-a-zunol",
  "diego-vel-zquez": "diego-velazquez",
  "douard-manet": "edouard-manet",
  "eug-ne-boudin": "eugene-boudin",
  "eug-ne-delacroix": "eugene-delacroix",
  "eug-ne-jansson": "eugene-jansson",
  "francisco-de-goya": "francisco-goya",
  "j-zsef-borsos": "jozsef-borsos",
  "jean-fran-ois-millet": "jean-francois-millet",
  "jean-honor-fragonard": "jean-honore-fragonard",
  "jean-l-on-g-r-me": "jean-leon-gerome",
  "julien-dupr": "julien-dupre",
  "l-on-mathieu-cochereau": "leon-mathieu-cochereau",
  "luis-jim-nez-aranda": "luis-jimenez-aranda",
  "paul-c-sar-helleu": "paul-cesar-helleu",
  "richard-nicola-s-roland-holst": "richard-nicolaus-roland-holst",
  "s-de-rubelli": "s-rubelli",
  "th-odore-rousseau": "theodore-rousseau",
  "th-ophile-alexandre-steinlen": "theophile-alexandre-steinlen",
};

const ATTRIBUTION_GROUPS = {
  american: ["美国画派（作者未详）", "American school (artist unknown)"],
  austrian: ["奥地利画派（作者未详）", "Austrian school (artist unknown)"],
  belgian: ["比利时画派（作者未详）", "Belgian school (artist unknown)"],
  czech: ["捷克画派（作者未详）", "Czech school (artist unknown)"],
  english: ["英国画派（作者未详）", "English school (artist unknown)"],
  flemish: ["佛兰德斯画派（作者未详）", "Flemish school (artist unknown)"],
  french: ["法国画派（作者未详）", "French school (artist unknown)"],
  german: ["德国画派（作者未详）", "German school (artist unknown)"],
  italian: ["意大利画派（作者未详）", "Italian school (artist unknown)"],
  japanese: ["日本画派（作者未详）", "Japanese school (artist unknown)"],
  russian: ["俄罗斯画派（作者未详）", "Russian school (artist unknown)"],
  swedish: ["瑞典画派（作者未详）", "Swedish school (artist unknown)"],
};

const ROLE_PRIORITY = {
  creator: 0,
  attributed_to: 1,
  workshop: 2,
  after: 3,
  publisher: 4,
  subject: 5,
  unknown: 6,
};

function cleanText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function sameArray(left, right) {
  const a = asArray(left);
  const b = asArray(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function artistLookupText(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .toLocaleLowerCase();
}

function artistLabel(artist) {
  return cleanText(
    artist?.name_zh ||
      artist?.nameZh ||
      artist?.display_name ||
      artist?.name_en ||
      artist?.nameEn ||
      artist?._id,
  );
}

function artistSourceText(artwork) {
  return cleanText(
    artwork?.raw_artist_text ||
      artwork?.artist_display ||
      artwork?.artist ||
      asArray(artwork?.artist_labels).join(" "),
  );
}

function isUncertainArtistText(value) {
  return /未知|暂不明确|作者未|可能|疑似|风格|待考|相关作者|归属未定|unknown/i.test(value);
}

function artworkSemanticText(artwork) {
  return unique([
    artwork?.title_cn,
    artwork?.title,
    artwork?.title_en,
    artwork?.description,
    artwork?.medium,
  ]).join(" ");
}

function artworkRawTagLabels(artwork) {
  return unique([
    ...asArray(artwork?.tag_keys),
    ...asArray(artwork?.tags),
    ...asArray(artwork?.tag_labels),
  ]);
}

function structuredCreationYear(artwork) {
  const candidates = [
    artwork?.creation_year,
    artwork?.created_year,
    artwork?.year,
    artwork?.creation_date,
    artwork?.date,
    artwork?.period,
    artwork?.year_and_place,
  ];
  for (const value of candidates) {
    if (Number.isInteger(value) && value >= 1000 && value <= 2099) return value;
    const match = cleanText(value).match(/(?:^|[^\d])(\d{4})(?:[^\d]|$)/u);
    if (!match) continue;
    const year = Number(match[1]);
    if (year >= 1000 && year <= 2099) return year;
  }
  return null;
}

function decadeTermIdForArtwork(artwork) {
  const year = structuredCreationYear(artwork);
  return year ? `period-${Math.floor(year / 10) * 10}s` : "";
}

function legacyClassificationDecision(artwork, termId, rawLabels) {
  const semanticText = artworkSemanticText(artwork);
  const hasRawLabel = (label) => rawLabels.includes(label);
  const hasAmbiguousLegacyLabel = rawLabels.some((label) => AMBIGUOUS_LEGACY_LABELS.has(label));

  if (termId === "subject-botanical") {
    const isMarine =
      hasRawLabel("海洋生物") ||
      asArray(artwork?.classification_ids).includes("subject-marine-life");
    if (isMarine || !BOTANICAL_EVIDENCE_PATTERN.test(semanticText)) {
      return {
        accepted: false,
        reason: isMarine
          ? "legacy_botanical_conflicts_with_marine_life"
          : "legacy_botanical_missing_semantic_evidence",
        candidateTermIds: isMarine ? ["subject-marine-life"] : [],
      };
    }
  }

  if (
    termId === "subject-illustration" &&
    hasRawLabel("博物插图") &&
    !ILLUSTRATION_EVIDENCE_PATTERN.test(semanticText)
  ) {
    return {
      accepted: false,
      reason: "legacy_illustration_missing_semantic_evidence",
      candidateTermIds: [],
    };
  }

  if (termId === "subject-architectural-landscape" && hasRawLabel("礼拜堂设计")) {
    return {
      accepted: false,
      reason: "chapel_design_is_not_architectural_landscape",
      candidateTermIds: ["subject-religious"],
    };
  }

  if (hasAmbiguousLegacyLabel && (termId === "subject-floral" || termId === "subject-animal")) {
    return {
      accepted: false,
      reason: "ambiguous_compound_subject_requires_artwork_review",
      candidateTermIds: ["subject-floral", "subject-animal", "subject-still-life"],
    };
  }

  return { accepted: true, reason: "", candidateTermIds: [] };
}

function exactAliasDecision(artwork, label, termId) {
  const rawLabels = artworkRawTagLabels(artwork);
  if (AMBIGUOUS_LEGACY_LABELS.has(label)) {
    return {
      accepted: false,
      reason: "ambiguous_compound_subject_requires_artwork_review",
      candidateTermIds: ["subject-floral", "subject-animal", "subject-still-life"],
    };
  }
  return legacyClassificationDecision(artwork, termId, rawLabels);
}

function artistAliases(artist) {
  return unique([
    artist?._id,
    artist?.name_zh,
    artist?.nameZh,
    artist?.display_name,
    artist?.name_en,
    artist?.nameEn,
    ...asArray(artist?.aliases).flatMap((alias) =>
      typeof alias === "string"
        ? [alias]
        : [alias?.label, alias?.name, alias?.name_zh, alias?.name_en],
    ),
  ]);
}

function buildArtistLookup(artists) {
  const byId = new Map(artists.map((artist) => [cleanText(artist._id), artist]));
  const entries = [];
  artists.forEach((artist) => {
    artistAliases(artist).forEach((alias) => {
      const normalized = artistLookupText(alias);
      if (normalized.length < 3) return;
      entries.push({ normalized, artist });
    });
  });
  Object.entries(ARTIST_ALIAS_OVERLAY).forEach(([alias, artistId]) => {
    if (!byId.has(artistId)) return;
    entries.push({
      normalized: artistLookupText(alias),
      artist: byId.get(artistId),
    });
  });
  entries.sort((left, right) => right.normalized.length - left.normalized.length);
  return { byId, entries };
}

function findArtistInCertainText(text, lookup) {
  if (!text || isUncertainArtistText(text)) return null;
  const normalized = artistLookupText(text);
  const matches = [];
  lookup.entries.forEach((entry) => {
    if (!normalized.includes(entry.normalized)) return;
    if (!matches.some((artist) => artist._id === entry.artist._id)) {
      matches.push(entry.artist);
    }
  });
  return matches.length === 1 ? matches[0] : null;
}

function buildAttributionCandidates() {
  return Object.entries(ATTRIBUTION_GROUPS).map(([sourceId, labels]) => ({
    _id: `attribution-${sourceId}-school`,
    entity_type: "attribution",
    identity_status: "provisional",
    name_zh: labels[0],
    name_en: labels[1],
    aliases: [sourceId],
    review_status: "candidate",
    recommendation_eligible: false,
    source_artist_id: sourceId,
    source: "classification-v6-artist-reference-normalization",
  }));
}

function targetArtistStatus(artist) {
  return cleanText(artist?.review_status) === "reviewed" ? "reviewed" : "candidate";
}

function resolveArtistReference({ sourceArtistId, artwork, lookup, attributionBySourceId }) {
  const sourceText = artistSourceText(artwork);
  if (lookup.byId.has(sourceArtistId)) {
    const artist = lookup.byId.get(sourceArtistId);
    return {
      target: artist,
      role: "creator",
      review_status: targetArtistStatus(artist),
      confidence: 1,
      match_source: "existing-canonical-artist-id",
      source_text: sourceText,
    };
  }

  const repairedId = ARTIST_ID_REPAIRS[sourceArtistId];
  if (repairedId && lookup.byId.has(repairedId)) {
    const artist = lookup.byId.get(repairedId);
    return {
      target: artist,
      role: "creator",
      review_status: targetArtistStatus(artist),
      confidence: 1,
      match_source: "reviewed-artist-id-alias",
      source_text: sourceText,
    };
  }

  if (sourceArtistId === "anonymous" || sourceArtistId === "unknown-18th-century") {
    const anonymous = [...lookup.byId.values()].find(
      (artist) => artist.entity_type === "anonymous",
    );
    if (anonymous) {
      return {
        target: anonymous,
        role: "attributed_to",
        review_status: "candidate",
        confidence: 0.75,
        match_source: "anonymous-attribution-candidate",
        source_text: sourceText,
      };
    }
  }

  const artistFromText = findArtistInCertainText(sourceText, lookup);
  if (artistFromText) {
    return {
      target: artistFromText,
      role: "creator",
      review_status: targetArtistStatus(artistFromText),
      confidence: 1,
      match_source: "exact-canonical-name-in-source-text",
      source_text: sourceText,
    };
  }

  if (attributionBySourceId.has(sourceArtistId)) {
    return {
      target: attributionBySourceId.get(sourceArtistId),
      role: "attributed_to",
      review_status: "candidate",
      confidence: 0.75,
      match_source: "national-school-attribution-candidate",
      source_text: sourceText,
    };
  }

  return {
    target: null,
    role: "unknown",
    review_status: "candidate",
    confidence: 0,
    match_source: "unresolved-artist-reference",
    source_text: sourceText,
  };
}

function existingArtistSources(artwork, existingArtistLinks) {
  const sourceIds = unique([
    ...existingArtistLinks.map((link) => link.artist_id),
    ...asArray(artwork.artist_ids),
    artwork.primary_artist_id,
  ]);
  if (sourceIds.length) return sourceIds;
  return artistSourceText(artwork) ? [""] : [];
}

function buildArtistRelations({ artworks, artists, existingArtistLinks }) {
  const lookup = buildArtistLookup(artists);
  const attributionCandidates = buildAttributionCandidates();
  const attributionBySourceId = new Map(
    attributionCandidates.map((candidate) => [candidate.source_artist_id, candidate]),
  );
  const existingByArtwork = new Map();
  existingArtistLinks.forEach((link) => {
    const artworkId = cleanText(link.artwork_id);
    if (!existingByArtwork.has(artworkId)) existingByArtwork.set(artworkId, []);
    existingByArtwork.get(artworkId).push(link);
  });

  const links = [];
  const reviewQueue = [];
  const derivedByArtwork = new Map();
  const repairCounts = {};

  artworks.forEach((artwork) => {
    const artworkId = cleanText(artwork._id);
    const oldLinks = existingByArtwork.get(artworkId) || [];
    const sourceIds = existingArtistSources(artwork, oldLinks);
    const relations = sourceIds
      .map((sourceArtistId) => {
        const oldLink = oldLinks.find((link) => cleanText(link.artist_id) === sourceArtistId);
        const resolved = resolveArtistReference({
          sourceArtistId,
          artwork,
          lookup,
          attributionBySourceId,
        });
        if (!resolved.target) {
          reviewQueue.push({
            artwork_id: artworkId,
            source_artist_id: sourceArtistId,
            source_artist_text: resolved.source_text,
            reason: "unresolved_artist_reference",
            suggested_action: "人工确认具体画家、归属实体或保持 artist_ids 为空",
          });
          return null;
        }
        const role =
          resolved.match_source === "existing-canonical-artist-id"
            ? cleanText(oldLink?.role || resolved.role)
            : resolved.role;
        repairCounts[resolved.match_source] = (repairCounts[resolved.match_source] || 0) + 1;
        return {
          _id: `${artworkId}--${role}--${resolved.target._id}`,
          artwork_id: artworkId,
          artist_id: resolved.target._id,
          artist_label: artistLabel(resolved.target),
          role,
          confidence: resolved.confidence,
          match_source: resolved.match_source,
          matched: resolved.review_status === "reviewed",
          source_field: "artist_ids",
          source_artist_id: sourceArtistId,
          source_text: resolved.source_text,
          review_status: resolved.review_status,
          classification_version: TARGET_CLASSIFICATION_VERSION,
          vocabulary_version: CONTROLLED_VOCABULARY_VERSION,
        };
      })
      .filter(Boolean);

    const deduplicated = [];
    const seen = new Set();
    relations
      .sort(
        (left, right) =>
          (ROLE_PRIORITY[left.role] ?? 99) - (ROLE_PRIORITY[right.role] ?? 99) ||
          left.artist_id.localeCompare(right.artist_id),
      )
      .forEach((link) => {
        if (seen.has(link._id)) return;
        seen.add(link._id);
        deduplicated.push(link);
      });
    links.push(...deduplicated);

    const reviewedLinks = deduplicated.filter((link) => link.review_status === "reviewed");
    derivedByArtwork.set(artworkId, {
      primary_artist_id: reviewedLinks[0]?.artist_id || null,
      artist_ids: unique(reviewedLinks.map((link) => link.artist_id)),
      artist_labels: unique(reviewedLinks.map((link) => link.artist_label)),
      artist_relation_roles: unique(reviewedLinks.map((link) => link.role)),
    });
  });

  const usedCandidateIds = new Set(
    links.filter((link) => link.review_status === "candidate").map((link) => link.artist_id),
  );
  return {
    links,
    reviewQueue,
    derivedByArtwork,
    repairCounts,
    attributionCandidates: attributionCandidates.filter((candidate) =>
      usedCandidateIds.has(candidate._id),
    ),
  };
}

function termTypeFields(type) {
  return (
    {
      style: "style_ids",
      subject: "subject_ids",
      medium: "medium_ids",
      technique: "technique_ids",
      support: "support_ids",
      format: "format_ids",
      period: "period_ids",
      series: "series_ids",
      region: "region_ids",
      country: "country_ids",
      rights: "rights_ids",
    }[type] || ""
  );
}

function buildTagRelations({ artworks, terms, artists }) {
  const termById = new Map(terms.map((term) => [term._id, term]));
  const vocabIndex = buildVocabularyIndex(terms);
  const artistTagIndex = new Map();
  artists.forEach((artist) => {
    artistAliases(artist).forEach((alias) => {
      const normalized = normalizeVocabularyLabel(alias);
      if (!normalized) return;
      if (!artistTagIndex.has(normalized)) artistTagIndex.set(normalized, new Set());
      artistTagIndex.get(normalized).add(artist._id);
    });
  });
  Object.entries(ARTIST_ALIAS_OVERLAY).forEach(([alias, artistId]) => {
    const normalized = normalizeVocabularyLabel(alias);
    if (!artistTagIndex.has(normalized)) artistTagIndex.set(normalized, new Set());
    artistTagIndex.get(normalized).add(artistId);
  });
  const links = [];
  const reviewQueue = [];
  const ignoredArtistTags = [];
  const derivedByArtwork = new Map();
  const linkSourceCounts = {};

  artworks.forEach((artwork) => {
    const artworkId = cleanText(artwork._id);
    const rawTagLabels = artworkRawTagLabels(artwork);
    const sourcesByTerm = new Map();
    const addSource = (termId, source) => {
      if (!termById.has(termId)) return;
      if (!sourcesByTerm.has(termId)) sourcesByTerm.set(termId, []);
      sourcesByTerm.get(termId).push(source);
    };

    unique(asArray(artwork.classification_ids)).forEach((termId) => {
      const decision = legacyClassificationDecision(artwork, termId, rawTagLabels);
      if (!decision.accepted) {
        reviewQueue.push({
          artwork_id: artworkId,
          source_tag_text: termId,
          source_field: "classification_ids",
          rejected_term_id: termId,
          reason: decision.reason,
          candidate_term_ids: decision.candidateTermIds,
        });
        return;
      }
      addSource(termId, {
        source_field: "classification_ids",
        source_text: termId,
        match_source: "classification-v5-preserved",
      });
    });

    unique(CURATED_TERM_OVERRIDES[artworkId] || []).forEach((termId) => {
      addSource(termId, {
        source_field: "curated_subject_override",
        source_text: artworkId,
        match_source: "curated-semantic-override",
      });
    });

    const derivedDecadeId = decadeTermIdForArtwork(artwork);
    if (derivedDecadeId && termById.has(derivedDecadeId)) {
      addSource(derivedDecadeId, {
        source_field: "year_and_place",
        source_text: String(structuredCreationYear(artwork)),
        match_source: "structured-date-derived",
      });
    }

    unique([
      ...asArray(artwork.tag_keys),
      ...asArray(artwork.tags),
      ...asArray(artwork.tag_labels),
    ]).forEach((label) => {
      const termIds = unique(vocabIndex.get(normalizeVocabularyLabel(label)) || []);
      if (termIds.length === 1) {
        const decision = exactAliasDecision(artwork, label, termIds[0]);
        if (!decision.accepted) {
          reviewQueue.push({
            artwork_id: artworkId,
            source_tag_text: label,
            source_field: "tag_keys",
            rejected_term_id: termIds[0],
            reason: decision.reason,
            candidate_term_ids: decision.candidateTermIds,
          });
          return;
        }
        addSource(termIds[0], {
          source_field: "tag_keys",
          source_text: label,
          match_source: "controlled-vocabulary-exact-alias",
        });
      } else if (termIds.length > 1) {
        reviewQueue.push({
          artwork_id: artworkId,
          source_tag_text: label,
          reason: "ambiguous_controlled_vocabulary_alias",
          candidate_term_ids: termIds,
        });
      } else if (artistTagIndex.has(normalizeVocabularyLabel(label))) {
        ignoredArtistTags.push({
          artwork_id: artworkId,
          source_tag_text: label,
          artist_ids: [...artistTagIndex.get(normalizeVocabularyLabel(label))].sort(),
          route_type: "artist_dimension",
        });
      } else if (!INTERNAL_OR_NOISE_LABELS.has(label)) {
        reviewQueue.push({
          artwork_id: artworkId,
          source_tag_text: label,
          reason: "recommendation_signal_candidate",
          candidate_term_ids: [],
        });
      }
    });

    const tagIds = [...sourcesByTerm.keys()].sort((left, right) => {
      const a = termById.get(left);
      const b = termById.get(right);
      return Number(a.sort_order || 0) - Number(b.sort_order || 0) || left.localeCompare(right);
    });
    tagIds.forEach((termId) => {
      const term = termById.get(termId);
      const sources = sourcesByTerm.get(termId);
      const exactSource = sources.find(
        (source) => source.match_source === "controlled-vocabulary-exact-alias",
      );
      const source = exactSource || sources[0];
      linkSourceCounts[source.match_source] = (linkSourceCounts[source.match_source] || 0) + 1;
      links.push({
        _id: `${artworkId}--${termId}`,
        artwork_id: artworkId,
        tag_id: termId,
        tag_label: term.label_zh,
        tag_type: term.type,
        period_kind: term.period_kind || "",
        confidence: 1,
        match_source: source.match_source,
        source_field: source.source_field,
        source_text: source.source_text,
        source_texts: unique(sources.map((item) => item.source_text)),
        evidence:
          {
            "classification-v5-preserved": "reviewed production classification preserved",
            "controlled-vocabulary-exact-alias": "curated exact alias",
            "curated-semantic-override": "manual artwork-level semantic correction",
            "structured-date-derived": "decade derived from structured creation date",
          }[source.match_source] || "reviewed classification evidence",
        review_status: "reviewed",
        term_publish_status: term.publish_status,
        classification_version: TARGET_CLASSIFICATION_VERSION,
        vocabulary_version: CONTROLLED_VOCABULARY_VERSION,
      });
    });

    const currentClassificationIds = unique(asArray(artwork.classification_ids)).filter(
      (id) => termById.has(id) && sourcesByTerm.has(id),
    );
    const addedClassificationIds = tagIds.filter(
      (id) =>
        termById.get(id).usage_scopes.includes("classification_filter") &&
        !currentClassificationIds.includes(id),
    );
    const classificationIds = [
      ...currentClassificationIds,
      ...addedClassificationIds.slice(
        0,
        Math.max(0, CLASSIFICATION_MAX_IDS - currentClassificationIds.length),
      ),
    ].sort((left, right) => {
      const dimensionOrder = { style: 0, subject: 1, period: 2 };
      const a = termById.get(left);
      const b = termById.get(right);
      return (
        (dimensionOrder[a.type] ?? 99) - (dimensionOrder[b.type] ?? 99) ||
        Number(a.sort_order || 0) - Number(b.sort_order || 0) ||
        left.localeCompare(right)
      );
    });

    const fields = {
      classification_ids: classificationIds,
      tag_ids: tagIds,
      style_ids: [],
      subject_ids: [],
      medium_ids: [],
      technique_ids: [],
      support_ids: [],
      format_ids: [],
      period_ids: [],
      decade_ids: [],
      series_ids: [],
      region_ids: [],
      country_ids: [],
      rights_ids: [],
      recommendation_term_ids: [],
    };
    tagIds.forEach((id) => {
      const term = termById.get(id);
      const field = termTypeFields(term.type);
      if (field) fields[field].push(id);
      if (term.type === "period" && term.period_kind === "decade") {
        fields.decade_ids.push(id);
      }
      if (term.usage_scopes.includes("recommendation")) {
        fields.recommendation_term_ids.push(id);
      }
    });
    derivedByArtwork.set(artworkId, fields);
  });

  return {
    links,
    reviewQueue,
    ignoredArtistTags,
    derivedByArtwork,
    linkSourceCounts,
  };
}

function previousArtworkFields(artwork) {
  return {
    classification_version: artwork.classification_version || null,
    taxonomy_version: artwork.taxonomy_version || null,
    classification_ids: asArray(artwork.classification_ids),
    tag_ids: asArray(artwork.tag_ids),
    style_ids: asArray(artwork.style_ids),
    subject_ids: asArray(artwork.subject_ids),
    medium_ids: asArray(artwork.medium_ids),
    technique_ids: asArray(artwork.technique_ids),
    support_ids: asArray(artwork.support_ids),
    format_ids: asArray(artwork.format_ids),
    period_ids: asArray(artwork.period_ids),
    decade_ids: asArray(artwork.decade_ids),
    series_ids: asArray(artwork.series_ids),
    region_ids: asArray(artwork.region_ids),
    country_ids: asArray(artwork.country_ids),
    rights_ids: asArray(artwork.rights_ids),
    recommendation_term_ids: asArray(artwork.recommendation_term_ids),
    primary_artist_id: artwork.primary_artist_id || null,
    artist_ids: asArray(artwork.artist_ids),
    artist_labels: asArray(artwork.artist_labels),
    artist_relation_roles: asArray(artwork.artist_relation_roles),
  };
}

function artworkChanged(previous, next) {
  const arrayFields = Object.keys(previous).filter((key) => Array.isArray(previous[key]));
  return (
    previous.classification_version !== next.classification_version ||
    previous.taxonomy_version !== next.taxonomy_version ||
    previous.primary_artist_id !== next.primary_artist_id ||
    arrayFields.some((field) => !sameArray(previous[field], next[field]))
  );
}

export function buildClassificationV6Migration({
  artworks = [],
  artists = [],
  terms = [],
  existingArtistLinks = [],
  existingTagLinks = [],
  batchId = "classification-v6-dry-run",
  updatedAt = "2026-07-28T00:00:00.000Z",
} = {}) {
  const artistResult = buildArtistRelations({
    artworks,
    artists,
    existingArtistLinks,
  });
  const tagResult = buildTagRelations({ artworks, terms, artists });
  const termIds = new Set(terms.map((term) => term._id));
  const existingArtistIds = new Set(artists.map((artist) => artist._id));
  const candidateArtistIds = new Set(
    artistResult.attributionCandidates.map((candidate) => candidate._id),
  );

  const artworkAssignments = artworks.map((artwork) => {
    const artworkId = cleanText(artwork._id);
    const previous = previousArtworkFields(artwork);
    const artistFields = artistResult.derivedByArtwork.get(artworkId);
    const tagFields = tagResult.derivedByArtwork.get(artworkId);
    const next = {
      classification_version: TARGET_CLASSIFICATION_VERSION,
      taxonomy_version: CONTROLLED_VOCABULARY_VERSION,
      ...tagFields,
      ...artistFields,
    };
    return {
      _id: artworkId,
      ...next,
      classification_migration_batch: batchId,
      classification_updated_at: updatedAt,
      changed: artworkChanged(previous, next),
      previous,
    };
  });

  const duplicateIds = (rows) => {
    const counts = new Map();
    rows.forEach((row) => counts.set(row._id, (counts.get(row._id) || 0) + 1));
    return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  };
  const unknownTagIds = unique(
    artworkAssignments.flatMap((row) => row.tag_ids).filter((id) => !termIds.has(id)),
  );
  const orphanArtistIds = unique(
    artistResult.links
      .map((link) => link.artist_id)
      .filter((id) => !existingArtistIds.has(id) && !candidateArtistIds.has(id)),
  );
  const reviewedArtistLinkIds = new Set(
    artistResult.links
      .filter((link) => link.review_status === "reviewed")
      .map((link) => `${link.artwork_id}--${link.artist_id}`),
  );
  const derivedArtistLinkMismatches = artworkAssignments.flatMap((artwork) =>
    artwork.artist_ids
      .filter((artistId) => !reviewedArtistLinkIds.has(`${artwork._id}--${artistId}`))
      .map((artistId) => ({ artwork_id: artwork._id, artist_id: artistId })),
  );

  const checks = {
    artworks_total: artworkAssignments.length,
    artworks_changed: artworkAssignments.filter((row) => row.changed).length,
    artworks_with_classification_ids: artworkAssignments.filter(
      (row) => row.classification_ids.length,
    ).length,
    artworks_with_tag_ids: artworkAssignments.filter((row) => row.tag_ids.length).length,
    artworks_with_reviewed_artist_ids: artworkAssignments.filter((row) => row.artist_ids.length)
      .length,
    artworks_without_reviewed_artist_ids: artworkAssignments.filter((row) => !row.artist_ids.length)
      .length,
    unknown_tag_ids: unknownTagIds,
    orphan_artist_ids: orphanArtistIds,
    duplicate_tag_link_ids: duplicateIds(tagResult.links),
    duplicate_artist_link_ids: duplicateIds(artistResult.links),
    derived_artist_link_mismatches: derivedArtistLinkMismatches,
    tag_review_queue_total: tagResult.reviewQueue.length,
    artist_review_queue_total: artistResult.reviewQueue.length,
    candidate_attribution_entities_total: artistResult.attributionCandidates.length,
    existing_tag_links_total: existingTagLinks.length,
    proposed_tag_links_total: tagResult.links.length,
    existing_artist_links_total: existingArtistLinks.length,
    proposed_artist_links_total: artistResult.links.length,
  };
  const ok =
    unknownTagIds.length === 0 &&
    orphanArtistIds.length === 0 &&
    checks.duplicate_tag_link_ids.length === 0 &&
    checks.duplicate_artist_link_ids.length === 0 &&
    derivedArtistLinkMismatches.length === 0 &&
    checks.artworks_with_tag_ids === artworkAssignments.length;

  return {
    version: TARGET_CLASSIFICATION_VERSION,
    vocabulary_version: CONTROLLED_VOCABULARY_VERSION,
    batch_id: batchId,
    artworkAssignments,
    artworkTagLinks: tagResult.links,
    artworkArtistLinks: artistResult.links,
    attributionCandidates: artistResult.attributionCandidates,
    tagReviewQueue: tagResult.reviewQueue,
    artistReviewQueue: artistResult.reviewQueue,
    ignoredArtistTags: tagResult.ignoredArtistTags,
    repairCounts: artistResult.repairCounts,
    tagLinkSourceCounts: tagResult.linkSourceCounts,
    rollback: {
      artworks: artworks.map((artwork) => ({
        _id: artwork._id,
        ...previousArtworkFields(artwork),
      })),
      artworkTagLinks: existingTagLinks,
      artworkArtistLinks: existingArtistLinks,
    },
    checks,
    ok,
  };
}

export { ARTIST_ID_REPAIRS, ATTRIBUTION_GROUPS };
