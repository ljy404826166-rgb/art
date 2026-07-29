const crypto = require("node:crypto");
const { LibrarySyncError, syncLibrary } = require("./library-sync");
const {
  ACHIEVEMENT_STATISTICS_COLLECTION,
  USER_ACHIEVEMENTS_COLLECTION,
  achievementProfileFields,
} = require("./achievement-store");
const {
  AchievementError,
  ensureAchievementAccount,
  grantAutomaticAchievements,
  grantManualAchievement,
  unregisterAchievementAccount,
} = require("./achievement-engine");
const {
  equipAchievement,
  getAchievementState,
  publicEquippedTitle,
} = require("./achievement-state");

const USERS_COLLECTION = "users";
const PROFILE_SCHEMA_VERSION = 2;
const MAX_NICKNAME_LENGTH = 20;
const SUPPORTED_ACTIONS = new Set([
  "getOrCreateProfile",
  "updateProfile",
  "setSyncEnabled",
  "syncLibrary",
  "deactivateAccount",
  "adminGrantAchievement",
  "getAchievementState",
  "equipAchievement",
]);
const PERSONAL_LIBRARY_COLLECTIONS = [
  "user_favorites",
  "user_followed_artists",
  "user_history",
  USER_ACHIEVEMENTS_COLLECTION,
];

class AccountProfileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AccountProfileError";
    this.code = code;
    this.publicMessage = message;
  }
}

function createRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNickname(value) {
  return stringValue(value).replace(/\s+/g, " ");
}

function nicknameLength(value) {
  return Array.from(value).length;
}

function validateNickname(value) {
  const nickname = normalizeNickname(value);
  if (!nickname) {
    throw new AccountProfileError("ACCOUNT_NICKNAME_REQUIRED", "请输入昵称");
  }
  if (nicknameLength(nickname) > MAX_NICKNAME_LENGTH) {
    throw new AccountProfileError(
      "ACCOUNT_NICKNAME_TOO_LONG",
      `昵称不能超过${MAX_NICKNAME_LENGTH}个字符`,
    );
  }
  if (/[\u0000-\u001f\u007f<>]/u.test(nickname)) {
    throw new AccountProfileError("ACCOUNT_NICKNAME_INVALID", "昵称包含不支持的字符");
  }
  return nickname;
}

function profileDocumentId(openid) {
  const digest = crypto.createHash("sha256").update(openid).digest("hex");
  return `usr_${digest.slice(0, 48)}`;
}

function sanitizeProfile(document) {
  if (!document || typeof document !== "object") return null;
  const achievementFields = achievementProfileFields(document);

  return {
    id: stringValue(document._id),
    nickname: stringValue(document.nickname),
    avatar_url: stringValue(document.avatar_url),
    ...achievementFields,
    equipped_title: publicEquippedTitle(achievementFields.equipped_title_id),
    profile_completed: document.profile_completed === true,
    sync_enabled: document.sync_enabled === true,
    privacy_version: stringValue(document.privacy_version),
    account_status: stringValue(document.account_status) || "active",
    schema_version: Number(document.schema_version) || PROFILE_SCHEMA_VERSION,
    created_at: document.created_at || null,
    updated_at: document.updated_at || null,
    last_active_at: document.last_active_at || null,
    last_sync_at: document.last_sync_at || null,
  };
}

function success(data, requestId) {
  return {
    ok: true,
    data,
    error: null,
    request_id: requestId,
  };
}

function failure(code, message, requestId) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      message,
    },
    request_id: requestId,
  };
}

function isDuplicateKeyError(error) {
  const code = stringValue(error && (error.code || error.errCode));
  const message = stringValue(error && (error.message || error.errMsg));
  return (
    /duplicate|duplicatekey|already exists|e11000/i.test(code) ||
    /duplicate|duplicate key|e11000/i.test(message)
  );
}

function isDocumentNotFoundError(error) {
  const code = stringValue(error && (error.code || error.errCode));
  const message = stringValue(error && (error.message || error.errMsg));
  return (
    /not.?found|document.?not.?exist/i.test(code) ||
    /not found|does not exist|document.*不存在/i.test(message)
  );
}

async function findProfileById(collection, id) {
  try {
    const result = await collection.doc(id).get();
    return (result && result.data) || null;
  } catch (error) {
    if (isDocumentNotFoundError(error)) return null;
    throw error;
  }
}

async function findProfile(collection, openid) {
  const deterministicId = profileDocumentId(openid);
  const deterministicProfile = await findProfileById(collection, deterministicId);
  if (deterministicProfile) return deterministicProfile;

  const result = await collection.where({ _openid: openid }).limit(1).get();
  const rows = result && Array.isArray(result.data) ? result.data : [];
  return rows[0] || null;
}

async function createProfileDocumentIfMissing({ database, id, document }) {
  const create = async (scope) => {
    const collection = scope.collection(USERS_COLLECTION);
    const existing = await findProfileById(collection, id);
    if (existing) {
      return {
        created: false,
        document: existing,
      };
    }
    await collection.doc(id).set({ data: document });
    return {
      created: true,
      document: {
        ...document,
        _id: id,
      },
    };
  };

  if (typeof database.runTransaction === "function") {
    return database.runTransaction(create);
  }
  return create(database);
}

async function getOrCreateProfile({ database, openid, serverDate }) {
  const collection = database.collection(USERS_COLLECTION);
  const existing = await findProfile(collection, openid);

  if (existing) {
    const accountStatus = stringValue(existing.account_status) || "active";
    if (accountStatus === "deleted" || accountStatus === "deleting") {
      throw new AccountProfileError(
        "ACCOUNT_DEACTIVATED",
        accountStatus === "deleting" ? "账号注销仍在处理中，请稍后重试" : "该微信账号已完成注销",
      );
    }
    if (existing.achievement_registered !== true) {
      await ensureAchievementAccount({
        database,
        openid,
        userId: existing._id,
        serverDate,
      });
    }
    const registered = (await findProfileById(collection, existing._id)) || existing;
    return {
      created: false,
      profile: sanitizeProfile(registered),
    };
  }

  const now = serverDate();
  const document = {
    _openid: openid,
    nickname: "",
    avatar_url: "",
    ...achievementProfileFields(),
    achievement_registered: false,
    profile_completed: false,
    sync_enabled: true,
    privacy_version: "",
    account_status: "active",
    schema_version: PROFILE_SCHEMA_VERSION,
    created_at: now,
    updated_at: now,
    last_active_at: now,
    last_sync_at: null,
  };

  const id = profileDocumentId(openid);
  const result = await createProfileDocumentIfMissing({
    database,
    id,
    document,
  });
  const accountStatus = stringValue(result.document.account_status) || "active";
  if (accountStatus === "deleted" || accountStatus === "deleting") {
    throw new AccountProfileError(
      "ACCOUNT_DEACTIVATED",
      accountStatus === "deleting" ? "账号注销仍在处理中，请稍后重试" : "该微信账号已完成注销",
    );
  }
  if (result.document.achievement_registered !== true) {
    await ensureAchievementAccount({
      database,
      openid,
      userId: id,
      serverDate,
    });
  }
  const registered = (await findProfileById(collection, id)) || result.document;
  return {
    created: result.created,
    profile: sanitizeProfile(registered),
  };
}

async function deleteCollectionRowsForUser(database, collectionName, openid) {
  const collection = database.collection(collectionName);
  let deleted = 0;
  for (let batch = 0; batch < 200; batch += 1) {
    const result = await collection.where({ _openid: openid }).limit(100).get();
    const rows = result && Array.isArray(result.data) ? result.data : [];
    if (rows.length === 0) return deleted;
    await Promise.all(
      rows.map((row) => {
        if (!row || !row._id) return null;
        return collection.doc(row._id).remove();
      }),
    );
    deleted += rows.length;
  }
  throw new AccountProfileError(
    "ACCOUNT_DEACTIVATION_INCOMPLETE",
    "个人数据量较大，注销尚未完成，请重试",
  );
}

async function deleteAvatarFile(fileId, deleteFiles) {
  if (!fileId) return;
  if (typeof deleteFiles !== "function") {
    throw new AccountProfileError(
      "ACCOUNT_DEACTIVATION_UNAVAILABLE",
      "账号注销服务暂不可用，请稍后重试",
    );
  }
  let result;
  try {
    result = await deleteFiles([fileId]);
  } catch (error) {
    const message = stringValue(error && (error.message || error.errMsg));
    if (/not.?found|not.?exist|不存在/i.test(message)) return;
    throw new AccountProfileError("ACCOUNT_AVATAR_DELETE_FAILED", "头像数据删除失败，请稍后重试");
  }
  const rows = result && Array.isArray(result.fileList) ? result.fileList : [];
  if (
    rows.some((row) => {
      const status = Number(row && row.status);
      const message = stringValue(row && (row.errMsg || row.message));
      return status !== 0 && !/not.?found|not.?exist|不存在/i.test(message);
    })
  ) {
    throw new AccountProfileError("ACCOUNT_AVATAR_DELETE_FAILED", "头像数据删除失败，请稍后重试");
  }
}

async function deactivateAccount({ database, openid, serverDate, deleteFiles }) {
  const collection = database.collection(USERS_COLLECTION);
  const existing = await findProfile(collection, openid);
  const id = existing && existing._id ? existing._id : profileDocumentId(openid);
  const now = serverDate();
  const pendingAvatar = stringValue(
    existing && (existing.pending_avatar_url || existing.avatar_url),
  );
  const tombstone = {
    _openid: openid,
    nickname: "",
    avatar_url: "",
    ...achievementProfileFields(),
    achievement_registered: existing && existing.achievement_registered === true,
    pending_avatar_url: pendingAvatar,
    profile_completed: false,
    sync_enabled: false,
    privacy_version: "",
    account_status: "deleting",
    schema_version: PROFILE_SCHEMA_VERSION,
    created_at: (existing && existing.created_at) || now,
    updated_at: now,
    last_active_at: now,
    last_sync_at: null,
  };

  await collection.doc(id).set({ data: tombstone });
  await unregisterAchievementAccount({
    database,
    openid,
    userId: id,
    serverDate,
  });
  await deleteAvatarFile(pendingAvatar, deleteFiles);
  if (pendingAvatar) {
    await collection.doc(id).update({
      data: {
        pending_avatar_url: "",
        updated_at: serverDate(),
      },
    });
  }

  const deletedCounts = {};
  for (const collectionName of PERSONAL_LIBRARY_COLLECTIONS) {
    deletedCounts[collectionName] = await deleteCollectionRowsForUser(
      database,
      collectionName,
      openid,
    );
  }

  await collection.doc(id).update({
    data: {
      pending_avatar_url: "",
      account_status: "deleted",
      updated_at: serverDate(),
      deleted_at: serverDate(),
    },
  });

  return {
    deactivated: true,
    deleted_counts: deletedCounts,
  };
}

function avatarBelongsToProfile(avatarUrl, profileId) {
  if (!avatarUrl) return true;
  if (!avatarUrl.startsWith("cloud://")) return false;
  return avatarUrl.includes(`/user-avatars/${profileId}/`);
}

function nicknameSuggestion(response) {
  const nested =
    response && response.result && typeof response.result === "object" ? response.result : null;
  return stringValue((nested && nested.suggest) || (response && response.suggest)).toLowerCase();
}

async function assertNicknameSafe({ nickname, openid, checkNickname }) {
  if (typeof checkNickname !== "function") {
    throw new AccountProfileError(
      "ACCOUNT_CONTENT_CHECK_UNAVAILABLE",
      "昵称暂时无法校验，请稍后重试",
    );
  }

  let result;
  try {
    result = await checkNickname(nickname, openid);
  } catch (error) {
    throw new AccountProfileError("ACCOUNT_CONTENT_CHECK_FAILED", "昵称暂时无法校验，请稍后重试");
  }

  if (nicknameSuggestion(result) !== "pass") {
    throw new AccountProfileError("ACCOUNT_NICKNAME_REJECTED", "该昵称暂不可使用，请修改后重试");
  }
}

async function updateProfile({ database, openid, serverDate, profileInput, checkNickname }) {
  const currentResult = await getOrCreateProfile({
    database,
    openid,
    serverDate,
  });
  const current = currentResult.profile;
  const nickname = validateNickname(profileInput && profileInput.nickname);
  const hasAvatar = Boolean(
    profileInput && Object.prototype.hasOwnProperty.call(profileInput, "avatar_url"),
  );
  const avatarUrl = hasAvatar ? stringValue(profileInput.avatar_url) : current.avatar_url;

  if (!avatarBelongsToProfile(avatarUrl, current.id)) {
    throw new AccountProfileError("ACCOUNT_AVATAR_INVALID", "头像文件来源无效，请重新选择");
  }

  if (nickname !== current.nickname) {
    await assertNicknameSafe({
      nickname,
      openid,
      checkNickname,
    });
  }

  const now = serverDate();
  const update = {
    nickname,
    avatar_url: avatarUrl,
    profile_completed: Boolean(nickname && avatarUrl),
    updated_at: now,
    last_active_at: now,
  };
  const collection = database.collection(USERS_COLLECTION);

  await collection.doc(current.id).update({
    data: update,
  });

  const saved = await findProfileById(collection, current.id);
  return {
    created: currentResult.created,
    profile: sanitizeProfile(
      saved || {
        ...current,
        ...update,
        _id: current.id,
      },
    ),
  };
}

async function setSyncEnabled({ database, openid, serverDate, enabled }) {
  const currentResult = await getOrCreateProfile({
    database,
    openid,
    serverDate,
  });
  const now = serverDate();
  const update = {
    sync_enabled: enabled === true,
    updated_at: now,
    last_active_at: now,
  };
  const collection = database.collection(USERS_COLLECTION);
  await collection.doc(currentResult.profile.id).update({
    data: update,
  });
  const saved = await findProfileById(collection, currentResult.profile.id);
  return {
    created: currentResult.created,
    profile: sanitizeProfile(
      saved || {
        ...currentResult.profile,
        ...update,
        _id: currentResult.profile.id,
      },
    ),
  };
}

function createAccountProfileHandler({
  database,
  getContext,
  serverDate,
  checkNickname,
  deleteFiles,
  isAchievementAdmin = () => false,
  now = Date.now,
  logger = console,
}) {
  if (!database || typeof database.collection !== "function") {
    throw new TypeError("database.collection is required");
  }
  if (typeof getContext !== "function") {
    throw new TypeError("getContext is required");
  }
  if (typeof serverDate !== "function") {
    throw new TypeError("serverDate is required");
  }

  return async function accountProfileHandler(event = {}) {
    const requestId = createRequestId();
    const action = stringValue(event.action) || "getOrCreateProfile";

    if (!SUPPORTED_ACTIONS.has(action)) {
      return failure("ACCOUNT_ACTION_UNSUPPORTED", "暂不支持该账号操作", requestId);
    }

    const context = getContext() || {};
    const openid = stringValue(context.OPENID);

    if (!openid) {
      return failure("ACCOUNT_UNAUTHENTICATED", "暂时无法识别当前微信用户", requestId);
    }

    try {
      let data;
      if (action === "deactivateAccount") {
        data = await deactivateAccount({
          database,
          openid,
          serverDate,
          deleteFiles,
        });
      } else if (action === "getAchievementState") {
        const account = await getOrCreateProfile({
          database,
          openid,
          serverDate,
        });
        const achievements = await getAchievementState({
          database,
          openid,
          userId: account.profile.id,
          serverDate,
        });
        data = {
          profile: account.profile,
          achievements,
        };
      } else if (action === "equipAchievement") {
        const account = await getOrCreateProfile({
          database,
          openid,
          serverDate,
        });
        const achievements = await equipAchievement({
          database,
          openid,
          userId: account.profile.id,
          achievementId: event.achievement_id,
          serverDate,
        });
        const saved = await findProfileById(
          database.collection(USERS_COLLECTION),
          account.profile.id,
        );
        data = {
          profile: sanitizeProfile(saved),
          achievements,
        };
      } else if (action === "adminGrantAchievement") {
        if (!isAchievementAdmin(openid)) {
          throw new AccountProfileError("ACHIEVEMENT_ADMIN_FORBIDDEN", "当前账号无权执行人工授予");
        }
        const targetUserId = stringValue(event.target_user_id);
        const target = await findProfileById(database.collection(USERS_COLLECTION), targetUserId);
        if (!target || !target._openid) {
          throw new AccountProfileError("ACHIEVEMENT_TARGET_NOT_FOUND", "未找到需要授予头衔的用户");
        }
        const grant = await grantManualAchievement({
          database,
          openid: target._openid,
          userId: target._id,
          achievementId: event.achievement_id,
          grantReference: event.grant_reference,
          serverDate,
        });
        data = {
          target_user_id: target._id,
          ...grant,
        };
      } else if (action === "updateProfile") {
        data = await updateProfile({
          database,
          openid,
          serverDate,
          profileInput: event.profile && typeof event.profile === "object" ? event.profile : {},
          checkNickname,
        });
      } else if (action === "setSyncEnabled") {
        data = await setSyncEnabled({
          database,
          openid,
          serverDate,
          enabled: event.enabled === true,
        });
      } else if (action === "syncLibrary") {
        const account = await getOrCreateProfile({
          database,
          openid,
          serverDate,
        });
        const library = await syncLibrary({
          database,
          openid,
          deviceId: event.device_id,
          event,
          serverDate,
          now: now(),
        });
        const achievements = await grantAutomaticAchievements({
          database,
          openid,
          userId: account.profile.id,
          library,
          serverDate,
        });
        const savedProfile = await setSyncEnabled({
          database,
          openid,
          serverDate,
          enabled: true,
        });
        const lastSyncAt = serverDate();
        const downloadSummary =
          event.download_summary && typeof event.download_summary === "object"
            ? event.download_summary
            : {};
        const downloadCount = Math.min(
          1000000,
          Math.max(0, Math.floor(Number(downloadSummary.count) || 0)),
        );
        const downloadUpdatedAt = Math.max(
          0,
          Math.floor(Number(downloadSummary.updated_at_ms) || 0),
        );
        await database
          .collection(USERS_COLLECTION)
          .doc(savedProfile.profile.id)
          .update({
            data: {
              last_sync_at: lastSyncAt,
              last_active_at: lastSyncAt,
              download_summary_count: downloadCount,
              download_summary_updated_at_ms: downloadUpdatedAt,
            },
          });
        data = {
          profile: {
            ...savedProfile.profile,
            last_sync_at: lastSyncAt,
          },
          library,
          achievements,
        };
      } else {
        data = await getOrCreateProfile({
          database,
          openid,
          serverDate,
        });
      }
      return success(data, requestId);
    } catch (error) {
      if (
        error instanceof AccountProfileError ||
        error instanceof AchievementError ||
        error instanceof LibrarySyncError
      ) {
        return failure(error.code, error.publicMessage, requestId);
      }
      if (logger && typeof logger.error === "function") {
        logger.error("[accountProfile] request failed", {
          requestId,
          action,
          code: stringValue(error && (error.code || error.errCode)) || "unknown",
          message: stringValue(error && (error.message || error.errMsg)) || "unknown",
        });
      }
      return failure("ACCOUNT_STORAGE_FAILED", "账号服务暂不可用，请稍后重试", requestId);
    }
  };
}

module.exports = {
  AccountProfileError,
  ACHIEVEMENT_STATISTICS_COLLECTION,
  MAX_NICKNAME_LENGTH,
  PROFILE_SCHEMA_VERSION,
  SUPPORTED_ACTIONS,
  USER_ACHIEVEMENTS_COLLECTION,
  USERS_COLLECTION,
  assertNicknameSafe,
  avatarBelongsToProfile,
  createAccountProfileHandler,
  createProfileDocumentIfMissing,
  deactivateAccount,
  deleteCollectionRowsForUser,
  getOrCreateProfile,
  isDuplicateKeyError,
  isDocumentNotFoundError,
  nicknameSuggestion,
  normalizeNickname,
  profileDocumentId,
  sanitizeProfile,
  setSyncEnabled,
  updateProfile,
  validateNickname,
};
