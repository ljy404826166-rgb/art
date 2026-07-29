import fs from "node:fs";
import { pathToFileURL } from "node:url";

const REVIEW_STATUSES = new Set(["candidate", "reviewed", "rejected"]);
const VOCAB_TYPES = new Set([
  "style",
  "subject",
  "medium",
  "period",
  "region",
  "country",
  "collection",
  "source",
]);
const ARTWORK_ARTIST_ROLES = new Set([
  "creator",
  "after",
  "attributed_to",
  "workshop",
  "publisher",
  "subject",
  "unknown",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

function createError(collection, index, record, field, message) {
  return {
    collection,
    index,
    id: isPlainObject(record) ? (record._id ?? null) : null,
    field,
    message,
  };
}

function pushRequiredStringError(errors, collection, index, record, field) {
  if (!isNonEmptyString(record?.[field])) {
    errors.push(createError(collection, index, record, field, `${field} is required`));
  }
}

function pushStatusError(errors, collection, index, record) {
  if (!REVIEW_STATUSES.has(record?.review_status)) {
    errors.push(
      createError(
        collection,
        index,
        record,
        "review_status",
        "review_status must be candidate, reviewed, or rejected",
      ),
    );
  }
}

function hasNonEmptyAuthorityIds(authorityIds) {
  if (!isPlainObject(authorityIds)) {
    return false;
  }

  return Object.values(authorityIds).some((value) => {
    if (Array.isArray(value)) {
      return value.some(isNonEmptyString);
    }

    return isNonEmptyString(value);
  });
}

function hasNonEmptySource(sources) {
  if (!Array.isArray(sources)) {
    return false;
  }

  return sources.some((source) => {
    if (!isPlainObject(source)) {
      return false;
    }

    return isNonEmptyString(source.url) || isNonEmptyString(source.title);
  });
}

function pushDuplicateAliasErrors(errors, collection, index, record) {
  if (record.aliases == null) {
    return;
  }

  if (!Array.isArray(record.aliases)) {
    errors.push(createError(collection, index, record, "aliases", "aliases must be an array"));
    return;
  }

  const seen = new Set();
  record.aliases.forEach((alias) => {
    const normalized = normalizeToken(alias);
    if (!normalized) {
      errors.push(
        createError(collection, index, record, "aliases", "aliases cannot contain empty values"),
      );
      return;
    }

    if (seen.has(normalized)) {
      errors.push(createError(collection, index, record, "aliases", `duplicate alias: ${alias}`));
      return;
    }

    seen.add(normalized);
  });
}

function finish(errors) {
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function validateArtists(records = []) {
  const errors = [];

  if (!Array.isArray(records)) {
    return finish([createError("artists", null, null, "records", "artists must be an array")]);
  }

  records.forEach((record, index) => {
    if (!isPlainObject(record)) {
      errors.push(createError("artists", index, record, "record", "artist must be an object"));
      return;
    }

    pushRequiredStringError(errors, "artists", index, record, "_id");
    pushRequiredStringError(errors, "artists", index, record, "name_zh");
    pushRequiredStringError(errors, "artists", index, record, "name_en");
    pushStatusError(errors, "artists", index, record);

    if (!Array.isArray(record.aliases)) {
      errors.push(createError("artists", index, record, "aliases", "aliases must be an array"));
    } else {
      pushDuplicateAliasErrors(errors, "artists", index, record);
    }

    if (
      record.review_status === "reviewed" &&
      !hasNonEmptyAuthorityIds(record.authority_ids) &&
      !hasNonEmptySource(record.sources)
    ) {
      errors.push(
        createError(
          "artists",
          index,
          record,
          "sources",
          "reviewed artist must include authority_ids or at least one source",
        ),
      );
    }
  });

  return finish(errors);
}

export function validateVocabTerms(records = []) {
  const errors = [];

  if (!Array.isArray(records)) {
    return finish([
      createError("vocab_terms", null, null, "records", "vocab_terms must be an array"),
    ]);
  }

  records.forEach((record, index) => {
    if (!isPlainObject(record)) {
      errors.push(
        createError("vocab_terms", index, record, "record", "vocab term must be an object"),
      );
      return;
    }

    pushRequiredStringError(errors, "vocab_terms", index, record, "_id");
    pushRequiredStringError(errors, "vocab_terms", index, record, "label_zh");
    pushStatusError(errors, "vocab_terms", index, record);

    if (!VOCAB_TYPES.has(record.type)) {
      errors.push(
        createError(
          "vocab_terms",
          index,
          record,
          "type",
          "type must be style, subject, medium, period, region, country, collection, or source",
        ),
      );
    }

    pushDuplicateAliasErrors(errors, "vocab_terms", index, record);
  });

  return finish(errors);
}

export function validateArtworkArtistLinks(records = []) {
  const errors = [];

  if (!Array.isArray(records)) {
    return finish([
      createError(
        "artwork_artist_links",
        null,
        null,
        "records",
        "artwork_artist_links must be an array",
      ),
    ]);
  }

  records.forEach((record, index) => {
    if (!isPlainObject(record)) {
      errors.push(
        createError(
          "artwork_artist_links",
          index,
          record,
          "record",
          "artwork artist link must be an object",
        ),
      );
      return;
    }

    pushRequiredStringError(errors, "artwork_artist_links", index, record, "_id");
    pushRequiredStringError(errors, "artwork_artist_links", index, record, "artwork_id");
    pushRequiredStringError(errors, "artwork_artist_links", index, record, "artist_id");
    pushStatusError(errors, "artwork_artist_links", index, record);

    if (!isNonEmptyString(record.role)) {
      errors.push(createError("artwork_artist_links", index, record, "role", "role is required"));
    } else if (!ARTWORK_ARTIST_ROLES.has(record.role)) {
      errors.push(
        createError(
          "artwork_artist_links",
          index,
          record,
          "role",
          "role must be creator, after, attributed_to, workshop, publisher, subject, or unknown",
        ),
      );
    }
  });

  return finish(errors);
}

export function validateReviewedData({
  artists = [],
  vocabTerms = [],
  artworkArtistLinks = [],
} = {}) {
  const results = [
    validateArtists(artists),
    validateVocabTerms(vocabTerms),
    validateArtworkArtistLinks(artworkArtistLinks),
  ];

  return finish(results.flatMap((result) => result.errors));
}

export function readJsonRecords(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`${filePath} must contain a JSON array or JSON Lines`);
    }
    return parsed;
  }

  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1} is not valid JSON: ${error.message}`);
      }
    });
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const payload = {};

  if (args.artists) {
    payload.artists = readJsonRecords(args.artists);
  }
  if (args["vocab-terms"]) {
    payload.vocabTerms = readJsonRecords(args["vocab-terms"]);
  }
  if (args["artwork-artist-links"]) {
    payload.artworkArtistLinks = readJsonRecords(args["artwork-artist-links"]);
  }

  const result = validateReviewedData(payload);
  const summary = {
    ok: result.ok,
    errorCount: result.errors.length,
    errors: result.errors,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = runCli();
}
