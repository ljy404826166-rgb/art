const {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATALOG_VERSION,
  DEFAULT_ACHIEVEMENT_ID,
  findAchievementDefinition,
} = require("./achievement-catalog");
const {
  ACHIEVEMENT_SCHEMA_VERSION,
  ACHIEVEMENT_STATISTICS_COLLECTION,
  ACHIEVEMENT_STATISTICS_DOCUMENT_ID,
  USER_ACHIEVEMENTS_COLLECTION,
  achievementDocumentId,
  createAchievementStatisticsDocument,
  createUserAchievementDocument,
} = require("./achievement-store");

class AchievementError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AchievementError";
    this.code = code;
    this.publicMessage = message;
  }
}

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

function normalizeStatistics(document, now) {
  const initial = createAchievementStatisticsDocument(now);
  const source = document && typeof document === "object" ? document : initial;
  const unlockedCounts = {};
  ACHIEVEMENT_CATALOG.forEach((item) => {
    unlockedCounts[item.id] = nonNegativeInteger(
      source.unlocked_counts && source.unlocked_counts[item.id],
    );
  });
  return {
    kind: "global",
    active_user_count: nonNegativeInteger(source.active_user_count),
    unlocked_counts: unlockedCounts,
    catalog_version: ACHIEVEMENT_CATALOG_VERSION,
    schema_version: ACHIEVEMENT_SCHEMA_VERSION,
    created_at: source.created_at || now,
    updated_at: now,
    reconciled_at: source.reconciled_at || null,
  };
}

async function runTransaction(database, handler) {
  if (database && typeof database.runTransaction === "function") {
    return database.runTransaction(handler);
  }
  // Test doubles use the same collection contract without a transaction API.
  return handler(database);
}

function assertActiveUser(document) {
  if (!document || typeof document !== "object") {
    throw new AchievementError("ACHIEVEMENT_USER_NOT_FOUND", "未找到需要处理的用户");
  }
  const status = stringValue(document.account_status) || "active";
  if (status === "deleted" || status === "deleting") {
    throw new AchievementError("ACCOUNT_DEACTIVATED", "该微信账号已完成注销");
  }
}

async function ensureAchievementAccount({ database, openid, userId, serverDate }) {
  const now = serverDate();
  const defaultDocumentId = achievementDocumentId(openid, DEFAULT_ACHIEVEMENT_ID);

  return runTransaction(database, async (transaction) => {
    const user = await readDocument(transaction, "users", userId);
    assertActiveUser(user);
    if (user.achievement_registered === true) {
      return {
        registered: false,
        default_granted: false,
      };
    }

    const defaultAchievement = await readDocument(
      transaction,
      USER_ACHIEVEMENTS_COLLECTION,
      defaultDocumentId,
    );
    const statisticsDocument = await readDocument(
      transaction,
      ACHIEVEMENT_STATISTICS_COLLECTION,
      ACHIEVEMENT_STATISTICS_DOCUMENT_ID,
    );
    const statistics = normalizeStatistics(statisticsDocument, now);
    statistics.active_user_count += 1;
    statistics.unlocked_counts[DEFAULT_ACHIEVEMENT_ID] += 1;

    if (!defaultAchievement) {
      await transaction
        .collection(USER_ACHIEVEMENTS_COLLECTION)
        .doc(defaultDocumentId)
        .set({
          data: createUserAchievementDocument({
            openid,
            userId,
            achievementId: DEFAULT_ACHIEVEMENT_ID,
            grantType: "default",
            now,
          }),
        });
    }
    await transaction
      .collection(ACHIEVEMENT_STATISTICS_COLLECTION)
      .doc(ACHIEVEMENT_STATISTICS_DOCUMENT_ID)
      .set({ data: statistics });
    await transaction
      .collection("users")
      .doc(userId)
      .update({
        data: {
          achievement_registered: true,
          equipped_title_id: DEFAULT_ACHIEVEMENT_ID,
          achievement_schema_version: ACHIEVEMENT_SCHEMA_VERSION,
          updated_at: now,
        },
      });

    return {
      registered: true,
      default_granted: !defaultAchievement,
    };
  });
}

function activeCount(rows) {
  return (Array.isArray(rows) ? rows : []).filter((item) => item && item.deleted !== true).length;
}

function achievementMetricsFromLibrary(library) {
  const value = library && typeof library === "object" ? library : {};
  return {
    favorite_unique_count: activeCount(value.favorites),
    followed_artist_unique_count: activeCount(value.followed_artists),
    history_unique_count: activeCount(value.history),
  };
}

function automaticAchievementIds(metrics) {
  const values = metrics && typeof metrics === "object" ? metrics : {};
  return ACHIEVEMENT_CATALOG.filter(
    (item) =>
      item.grant_type === "automatic" &&
      item.rule_type === "threshold" &&
      nonNegativeInteger(values[item.metric]) >= item.threshold,
  ).map((item) => item.id);
}

async function grantAchievement({
  database,
  openid,
  userId,
  achievementId,
  grantType,
  grantReference = "",
  serverDate,
}) {
  const definition = findAchievementDefinition(achievementId);
  if (!definition || definition.id === DEFAULT_ACHIEVEMENT_ID) {
    throw new AchievementError("ACHIEVEMENT_INVALID", "该头衔不存在或不能通过此方式授予");
  }
  const documentId = achievementDocumentId(openid, definition.id);
  const now = serverDate();

  return runTransaction(database, async (transaction) => {
    const user = await readDocument(transaction, "users", userId);
    const existing = await readDocument(transaction, USER_ACHIEVEMENTS_COLLECTION, documentId);
    const statisticsDocument = await readDocument(
      transaction,
      ACHIEVEMENT_STATISTICS_COLLECTION,
      ACHIEVEMENT_STATISTICS_DOCUMENT_ID,
    );
    assertActiveUser(user);
    if (user.achievement_registered !== true) {
      throw new AchievementError("ACHIEVEMENT_ACCOUNT_NOT_READY", "用户成就资料尚未初始化");
    }
    if (existing) {
      return {
        granted: false,
        achievement_id: definition.id,
      };
    }

    const statistics = normalizeStatistics(statisticsDocument, now);
    statistics.unlocked_counts[definition.id] += 1;
    await transaction
      .collection(USER_ACHIEVEMENTS_COLLECTION)
      .doc(documentId)
      .set({
        data: createUserAchievementDocument({
          openid,
          userId,
          achievementId: definition.id,
          grantType,
          grantReference,
          now,
        }),
      });
    await transaction
      .collection(ACHIEVEMENT_STATISTICS_COLLECTION)
      .doc(ACHIEVEMENT_STATISTICS_DOCUMENT_ID)
      .set({ data: statistics });

    return {
      granted: true,
      achievement_id: definition.id,
    };
  });
}

async function grantAutomaticAchievements({ database, openid, userId, library, serverDate }) {
  await ensureAchievementAccount({
    database,
    openid,
    userId,
    serverDate,
  });
  const metrics = achievementMetricsFromLibrary(library);
  const eligibleIds = automaticAchievementIds(metrics);
  const newlyUnlocked = [];

  for (const achievementId of eligibleIds) {
    const result = await grantAchievement({
      database,
      openid,
      userId,
      achievementId,
      grantType: "automatic",
      grantReference: `metric:${findAchievementDefinition(achievementId).metric}`,
      serverDate,
    });
    if (result.granted) newlyUnlocked.push(achievementId);
  }

  return {
    metrics,
    newly_unlocked: newlyUnlocked,
  };
}

async function grantManualAchievement({
  database,
  openid,
  userId,
  achievementId,
  grantReference,
  serverDate,
}) {
  const definition = findAchievementDefinition(achievementId);
  if (!definition || definition.grant_type !== "manual") {
    throw new AchievementError("ACHIEVEMENT_MANUAL_ONLY", "该头衔不支持人工授予");
  }
  const reference = stringValue(grantReference, 240);
  if (!reference) {
    throw new AchievementError("ACHIEVEMENT_GRANT_REFERENCE_REQUIRED", "人工授予必须填写审核引用");
  }
  await ensureAchievementAccount({
    database,
    openid,
    userId,
    serverDate,
  });
  return grantAchievement({
    database,
    openid,
    userId,
    achievementId: definition.id,
    grantType: "manual",
    grantReference: reference,
    serverDate,
  });
}

async function readUserAchievementIds(database, openid) {
  const result = await database
    .collection(USER_ACHIEVEMENTS_COLLECTION)
    .where({ _openid: openid })
    .limit(100)
    .get();
  return [
    ...new Set(
      (result && Array.isArray(result.data) ? result.data : [])
        .map((item) => stringValue(item && item.achievement_id, 80))
        .filter((id) => Boolean(findAchievementDefinition(id))),
    ),
  ];
}

async function unregisterAchievementAccount({ database, openid, userId, serverDate }) {
  const achievementIds = await readUserAchievementIds(database, openid);
  const now = serverDate();

  return runTransaction(database, async (transaction) => {
    const user = await readDocument(transaction, "users", userId);
    const statisticsDocument = await readDocument(
      transaction,
      ACHIEVEMENT_STATISTICS_COLLECTION,
      ACHIEVEMENT_STATISTICS_DOCUMENT_ID,
    );
    if (!user || user.achievement_registered !== true) {
      return { unregistered: false, achievement_ids: [] };
    }

    const statistics = normalizeStatistics(statisticsDocument, now);
    statistics.active_user_count = Math.max(0, statistics.active_user_count - 1);
    achievementIds.forEach((achievementId) => {
      statistics.unlocked_counts[achievementId] = Math.max(
        0,
        statistics.unlocked_counts[achievementId] - 1,
      );
    });
    await transaction
      .collection(ACHIEVEMENT_STATISTICS_COLLECTION)
      .doc(ACHIEVEMENT_STATISTICS_DOCUMENT_ID)
      .set({ data: statistics });
    await transaction
      .collection("users")
      .doc(userId)
      .update({
        data: {
          achievement_registered: false,
          equipped_title_id: DEFAULT_ACHIEVEMENT_ID,
          updated_at: now,
        },
      });

    return {
      unregistered: true,
      achievement_ids: achievementIds,
    };
  });
}

module.exports = {
  AchievementError,
  activeCount,
  achievementMetricsFromLibrary,
  automaticAchievementIds,
  ensureAchievementAccount,
  grantAchievement,
  grantAutomaticAchievements,
  grantManualAchievement,
  normalizeStatistics,
  readUserAchievementIds,
  unregisterAchievementAccount,
};
