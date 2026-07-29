export const ARTIST_ENTITY_TYPES = new Set([
  "person",
  "organization",
  "workshop",
  "attribution",
  "anonymous",
  "unresolved",
]);

export const ARTIST_IDENTITY_STATUSES = new Set([
  "verified",
  "provisional",
  "conflicted",
  "duplicate",
  "unresolved",
]);

export const BIO_MIN_CHARACTERS = 200;
export const BIO_MAX_CHARACTERS = 300;
export const BIO_FACT_KEYS = ["lifespan", "title", "career", "standing"];

const PLACEHOLDER_PATTERN = /待审核|待补充|未知|不详|暂无|暂不明确|资料有限|不可考|未考证/i;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function error(field, message) {
  return { field, message };
}

export function countBiographyCharacters(value) {
  return Array.from(String(value || "").replace(/\s+/gu, "")).length;
}

export function isPlaceholderValue(value) {
  return isNonEmptyString(value) && PLACEHOLDER_PATTERN.test(value.trim());
}

export function inferArtistEntityType(record = {}) {
  const text = [record._id, record.name_zh, record.name_en, ...asArray(record.aliases)]
    .filter(Boolean)
    .join(" ");
  if (/unknown artist|未知艺术家|anonymous/i.test(text)) return "anonymous";
  if (/circle of|follower of|圈子|追随者/i.test(text)) return "attribution";
  if (/studio of|workshop of|工作室/i.test(text)) return "workshop";
  if (
    /imprimerie|imp\.|lith\.|publisher|publishing|press|& co\.?|出版社|印刷所|印刷公司|艺术社/i.test(
      text,
    )
  )
    return "organization";
  if (record.review_status === "candidate" && !hasAuthorityId(record.authority_ids)) {
    return "unresolved";
  }
  return "person";
}

export function hasAuthorityId(authorityIds) {
  if (!isObject(authorityIds)) return false;
  return Object.values(authorityIds).some((value) =>
    Array.isArray(value) ? value.some(isNonEmptyString) : isNonEmptyString(value),
  );
}

export function validateBiography(record = {}) {
  const errors = [];
  const bio = String(record.bio_zh || "").trim();
  const length = countBiographyCharacters(bio);
  if (length < BIO_MIN_CHARACTERS || length > BIO_MAX_CHARACTERS) {
    errors.push(
      error(
        "bio_zh",
        `bio_zh must contain ${BIO_MIN_CHARACTERS}-${BIO_MAX_CHARACTERS} non-whitespace Unicode characters; got ${length}`,
      ),
    );
  }

  const facts = record.bio_facts;
  if (!isObject(facts)) {
    errors.push(error("bio_facts", "bio_facts is required"));
  } else {
    for (const key of BIO_FACT_KEYS) {
      if (!isNonEmptyString(facts[key])) {
        errors.push(error(`bio_facts.${key}`, `${key} biography evidence is required`));
      }
    }
  }

  if (record.entity_type === "person") {
    for (const [field, value] of [
      ["birth_year", record.birth_year],
      ["death_year", record.death_year],
    ]) {
      const year = Number(value || 0);
      if (year > 0 && !bio.includes(String(year))) {
        errors.push(error("bio_zh", `bio_zh must mention known ${field} ${year}`));
      }
    }
    if (!asArray(record.occupations_zh).some(isNonEmptyString)) {
      errors.push(
        error("occupations_zh", "person biography requires at least one title or occupation"),
      );
    }
  }

  return {
    ok: errors.length === 0,
    length,
    errors,
  };
}

export function validateArtistEnrichment(record = {}) {
  const errors = [];
  if (!isNonEmptyString(record._id)) errors.push(error("_id", "_id is required"));
  if (!ARTIST_ENTITY_TYPES.has(record.entity_type)) {
    errors.push(error("entity_type", "entity_type is invalid"));
  }
  if (!ARTIST_IDENTITY_STATUSES.has(record.identity_status)) {
    errors.push(error("identity_status", "identity_status is invalid"));
  }
  if (!isNonEmptyString(record.name_zh)) errors.push(error("name_zh", "name_zh is required"));
  if (!isNonEmptyString(record.name_en)) errors.push(error("name_en", "name_en is required"));
  if (!Array.isArray(record.aliases)) errors.push(error("aliases", "aliases must be an array"));
  if (!Array.isArray(record.sources) || !record.sources.length) {
    errors.push(error("sources", "at least one source is required"));
  }
  if (
    record.identity_status === "verified" &&
    !hasAuthorityId(record.authority_ids) &&
    !asArray(record.sources).some((source) => isNonEmptyString(source && source.url))
  ) {
    errors.push(error("authority_ids", "verified identity requires an authority id or source URL"));
  }
  if (
    ["unresolved", "conflicted"].includes(record.identity_status) &&
    !isNonEmptyString(record.unresolved_reason)
  ) {
    errors.push(error("unresolved_reason", "unresolved or conflicted identity requires a reason"));
  }

  const biography = validateBiography(record);
  errors.push(...biography.errors);
  return {
    ok: errors.length === 0,
    biography_length: biography.length,
    errors,
  };
}
