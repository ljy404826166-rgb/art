const {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATALOG_VERSION,
  DEFAULT_ACHIEVEMENT_ID,
  findAchievementDefinition,
  formatUnlockRate,
} = require("./achievement-catalog");
const {
  ACHIEVEMENT_STATISTICS_COLLECTION,
  ACHIEVEMENT_STATISTICS_DOCUMENT_ID,
  USER_ACHIEVEMENTS_COLLECTION,
  achievementDocumentId,
  normalizeEquippedTitleId,
} = require("./achievement-store");
const {
  AchievementError,
  achievementMetricsFromLibrary,
  ensureAchievementAccount,
  grantAutomaticAchievements,
} = require("./achievement-engine");

const QUERY_PAGE_SIZE = 100;

function stringValue(value, maxLength = 0) {
  const text = typeof value === "string" ? value.trim() : "";
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function isDocumentNotFound(error) {
  const code = stringValue(error && (error.code || error.errCode));
  const message = stringValue(error && (error.message || error.errMsg));
  return /not.?found|not.?exist|不存在/i.test(`${code} ${message}`);
}

async function readDocument(scope, collectionName, id) {
  try {
    const result = await scope.collection(collectionName).doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    if (isDocumentNotFound(error)) return null;
    throw error;
  }
}

async function readAllForUser(database, collectionName, openid) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += QUERY_PAGE_SIZE) {
    let query = database.collection(collectionName).where({ _openid: openid });
    const supportsSkip = typeof query.skip === "function";
    if (offset > 0 && !supportsSkip) break;
    if (offset > 0) {
      query = query.skip(offset);
    }
    const result = await query.limit(QUERY_PAGE_SIZE).get();
    const batch = result && Array.isArray(result.data) ? result.data : [];
    rows.push(...batch);
    if (batch.length < QUERY_PAGE_SIZE) break;
  }
  return rows;
}

function publicEquippedTitle(id) {
  const normalizedId = normalizeEquippedTitleId(id);
  const definition =
    findAchievementDefinition(normalizedId) || findAchievementDefinition(DEFAULT_ACHIEVEMENT_ID);
  return {
    id: definition.id,
    title: definition.title,
  };
}

function progressForDefinition(definition, metrics, unlocked) {
  if (definition.rule_type === "always") {
    return { current: 1, target: 1 };
  }
  if (definition.rule_type === "threshold") {
    return {
      current: Math.min(nonNegativeInteger(metrics[definition.metric]), definition.threshold),
      target: definition.threshold,
    };
  }
  return {
    current: unlocked ? 1 : 0,
    target: 1,
  };
}

function buildAchievementState({ profile, achievementRows, statistics, library }) {
  const unlockedById = new Map(
    (Array.isArray(achievementRows) ? achievementRows : [])
      .filter((item) => Boolean(findAchievementDefinition(item && item.achievement_id)))
      .map((item) => [item.achievement_id, item]),
  );
  const metrics = achievementMetricsFromLibrary(library);
  const activeUserCount = nonNegativeInteger(statistics && statistics.active_user_count);
  const unlockedCounts =
    statistics && statistics.unlocked_counts && typeof statistics.unlocked_counts === "object"
      ? statistics.unlocked_counts
      : {};
  const equipped = publicEquippedTitle(profile && profile.equipped_title_id);

  return {
    catalog_version: ACHIEVEMENT_CATALOG_VERSION,
    equipped_title: equipped,
    active_user_count: activeUserCount,
    statistics_updated_at: (statistics && statistics.updated_at) || null,
    items: ACHIEVEMENT_CATALOG.map((definition) => {
      const row = unlockedById.get(definition.id);
      const unlocked = definition.id === DEFAULT_ACHIEVEMENT_ID || Boolean(row);
      return {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        requirement: definition.requirement,
        grant_type: definition.grant_type,
        unlocked,
        equipped: equipped.id === definition.id,
        unlocked_at: (row && row.unlocked_at) || null,
        progress: progressForDefinition(definition, metrics, unlocked),
        unlocked_user_count: nonNegativeInteger(unlockedCounts[definition.id]),
        unlock_rate: formatUnlockRate(unlockedCounts[definition.id], activeUserCount),
      };
    }),
  };
}

async function getAchievementState({ database, openid, userId, serverDate }) {
  await ensureAchievementAccount({
    database,
    openid,
    userId,
    serverDate,
  });
  const [favorites, followedArtists, history] = await Promise.all([
    readAllForUser(database, "user_favorites", openid),
    readAllForUser(database, "user_followed_artists", openid),
    readAllForUser(database, "user_history", openid),
  ]);
  const library = {
    favorites,
    followed_artists: followedArtists,
    history,
  };
  await grantAutomaticAchievements({
    database,
    openid,
    userId,
    library,
    serverDate,
  });
  const [profile, achievementRows, statistics] = await Promise.all([
    readDocument(database, "users", userId),
    readAllForUser(database, USER_ACHIEVEMENTS_COLLECTION, openid),
    readDocument(database, ACHIEVEMENT_STATISTICS_COLLECTION, ACHIEVEMENT_STATISTICS_DOCUMENT_ID),
  ]);
  if (!profile) {
    throw new AchievementError("ACHIEVEMENT_USER_NOT_FOUND", "未找到需要处理的用户");
  }

  return buildAchievementState({
    profile,
    achievementRows,
    statistics,
    library,
  });
}

async function equipAchievement({ database, openid, userId, achievementId, serverDate }) {
  const definition = findAchievementDefinition(achievementId);
  if (!definition) {
    throw new AchievementError("ACHIEVEMENT_INVALID", "该头衔不存在");
  }
  await ensureAchievementAccount({
    database,
    openid,
    userId,
    serverDate,
  });
  if (definition.id !== DEFAULT_ACHIEVEMENT_ID) {
    const owned = await readDocument(
      database,
      USER_ACHIEVEMENTS_COLLECTION,
      achievementDocumentId(openid, definition.id),
    );
    if (!owned) {
      throw new AchievementError("ACHIEVEMENT_NOT_UNLOCKED", "尚未获得该头衔");
    }
  }

  await database
    .collection("users")
    .doc(userId)
    .update({
      data: {
        equipped_title_id: definition.id,
        updated_at: serverDate(),
      },
    });
  return getAchievementState({
    database,
    openid,
    userId,
    serverDate,
  });
}

module.exports = {
  QUERY_PAGE_SIZE,
  buildAchievementState,
  equipAchievement,
  getAchievementState,
  progressForDefinition,
  publicEquippedTitle,
  readAllForUser,
};
