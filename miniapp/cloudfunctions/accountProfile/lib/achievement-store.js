const crypto = require("node:crypto");
const {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATALOG_VERSION,
  DEFAULT_ACHIEVEMENT_ID,
  findAchievementDefinition,
} = require("./achievement-catalog");

const USER_ACHIEVEMENTS_COLLECTION = "user_achievements";
const ACHIEVEMENT_STATISTICS_COLLECTION = "achievement_statistics";
const ACHIEVEMENT_STATISTICS_DOCUMENT_ID = "global";
const ACHIEVEMENT_SCHEMA_VERSION = 1;

function stringValue(value, maxLength = 0) {
  const text = typeof value === "string" ? value.trim() : "";
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function normalizeEquippedTitleId(value) {
  const id = stringValue(value, 80);
  return findAchievementDefinition(id) ? id : DEFAULT_ACHIEVEMENT_ID;
}

function achievementProfileFields(value = {}) {
  return {
    equipped_title_id: normalizeEquippedTitleId(value.equipped_title_id),
    achievement_schema_version:
      Number(value.achievement_schema_version) || ACHIEVEMENT_SCHEMA_VERSION,
  };
}

function achievementDocumentId(openid, achievementId) {
  const trustedOpenid = stringValue(openid, 180);
  const definition = findAchievementDefinition(achievementId);
  if (!trustedOpenid) {
    throw new TypeError("openid is required");
  }
  if (!definition) {
    throw new TypeError("achievementId is not in the catalog");
  }
  const digest = crypto
    .createHash("sha256")
    .update(`${trustedOpenid}\u0000${definition.id}`)
    .digest("hex");
  return `ach_${digest.slice(0, 48)}`;
}

function createUserAchievementDocument({
  openid,
  userId,
  achievementId,
  grantType,
  grantReference = "",
  now,
}) {
  const definition = findAchievementDefinition(achievementId);
  if (!definition) {
    throw new TypeError("achievementId is not in the catalog");
  }
  const trustedOpenid = stringValue(openid, 180);
  const trustedUserId = stringValue(userId, 80);
  if (!trustedOpenid || !trustedUserId) {
    throw new TypeError("openid and userId are required");
  }

  return {
    _openid: trustedOpenid,
    user_id: trustedUserId,
    achievement_id: definition.id,
    grant_type: stringValue(grantType, 40) || definition.grant_type,
    grant_reference: stringValue(grantReference, 240),
    catalog_version: ACHIEVEMENT_CATALOG_VERSION,
    schema_version: ACHIEVEMENT_SCHEMA_VERSION,
    unlocked_at: now,
    created_at: now,
    updated_at: now,
  };
}

function createAchievementStatisticsDocument(now) {
  const unlockedCounts = {};
  ACHIEVEMENT_CATALOG.forEach((item) => {
    unlockedCounts[item.id] = 0;
  });

  return {
    kind: "global",
    active_user_count: 0,
    unlocked_counts: unlockedCounts,
    catalog_version: ACHIEVEMENT_CATALOG_VERSION,
    schema_version: ACHIEVEMENT_SCHEMA_VERSION,
    created_at: now,
    updated_at: now,
    reconciled_at: null,
  };
}

module.exports = {
  ACHIEVEMENT_SCHEMA_VERSION,
  ACHIEVEMENT_STATISTICS_COLLECTION,
  ACHIEVEMENT_STATISTICS_DOCUMENT_ID,
  USER_ACHIEVEMENTS_COLLECTION,
  achievementDocumentId,
  achievementProfileFields,
  createAchievementStatisticsDocument,
  createUserAchievementDocument,
  normalizeEquippedTitleId,
};
