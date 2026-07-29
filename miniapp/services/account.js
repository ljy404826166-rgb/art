const ACCOUNT_PROFILE_CACHE_KEY = "artArchive:accountProfile:v2";
const LEGACY_ACCOUNT_PROFILE_CACHE_KEY = "artArchive:accountProfile:v1";
const ACCOUNT_PROFILE_CACHE_VERSION = 2;
const ACCOUNT_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const ACHIEVEMENT_CACHE_KEY = "artArchive:achievementState:v1";
const ACHIEVEMENT_CACHE_VERSION = 1;
const ACHIEVEMENT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_ACHIEVEMENT_ID = "ordinary_user";
const DEFAULT_ACHIEVEMENT_TITLE = "普通用户";
const ACCOUNT_REQUEST_TIMEOUT_MS = 6000;
const ACCOUNT_FUNCTION_NAME = "accountProfile";
const MAX_NICKNAME_LENGTH = 20;
const MAX_AVATAR_SIZE_BYTES = 4 * 1024 * 1024;

let activeAccountRequest = null;
let activeProfileUpdateRequest = null;
let activeDeactivationRequest = null;
let activeAchievementRequest = null;
let activeAchievementEquipRequest = null;
let activeAchievementEquipId = "";

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeNickname(value) {
  return stringValue(value).replace(/\s+/g, " ");
}

function validateNickname(value) {
  const nickname = normalizeNickname(value);
  if (!nickname) {
    return {
      valid: false,
      value: "",
      message: "请输入昵称",
    };
  }
  if (Array.from(nickname).length > MAX_NICKNAME_LENGTH) {
    return {
      valid: false,
      value: nickname,
      message: `昵称不能超过${MAX_NICKNAME_LENGTH}个字符`,
    };
  }
  if (/[\u0000-\u001f\u007f<>]/u.test(nickname)) {
    return {
      valid: false,
      value: nickname,
      message: "昵称包含不支持的字符",
    };
  }
  return {
    valid: true,
    value: nickname,
    message: "",
  };
}

function getWxApi(options) {
  if (options && options.wxApi) return options.wxApi;
  return typeof wx !== "undefined" ? wx : null;
}

function limitedTitle(value) {
  return Array.from(stringValue(value)).slice(0, 8).join("");
}

function sanitizeEquippedTitle(value, fallbackId) {
  const item = value && typeof value === "object" ? value : {};
  const id = stringValue(item.id || fallbackId) || DEFAULT_ACHIEVEMENT_ID;
  const title =
    limitedTitle(item.title) || (id === DEFAULT_ACHIEVEMENT_ID ? DEFAULT_ACHIEVEMENT_TITLE : "");
  if (!title) {
    return {
      id: DEFAULT_ACHIEVEMENT_ID,
      title: DEFAULT_ACHIEVEMENT_TITLE,
    };
  }
  return { id, title };
}

function sanitizeCachedProfile(value) {
  if (!value || typeof value !== "object") return null;
  const id = stringValue(value.id);
  if (!id) return null;

  const equippedTitle = sanitizeEquippedTitle(value.equipped_title, value.equipped_title_id);
  return {
    id,
    nickname: stringValue(value.nickname),
    avatar_url: stringValue(value.avatar_url),
    equipped_title_id: equippedTitle.id,
    equipped_title: equippedTitle,
    achievement_schema_version: numberValue(value.achievement_schema_version) || 1,
    profile_completed: value.profile_completed === true,
    sync_enabled: value.sync_enabled === true,
    privacy_version: stringValue(value.privacy_version),
    account_status: stringValue(value.account_status) || "active",
    schema_version: numberValue(value.schema_version) || 1,
    created_at: value.created_at || null,
    updated_at: value.updated_at || null,
    last_active_at: value.last_active_at || null,
    last_sync_at: value.last_sync_at || null,
  };
}

function guestState() {
  return {
    status: "guest",
    profile: null,
    source: "local",
    cachedAt: 0,
    errorCode: "",
    errorMessage: "",
  };
}

function profileStatus(profile) {
  if (profile && (profile.account_status === "deleted" || profile.account_status === "deleting")) {
    return "deactivated";
  }
  return profile && profile.profile_completed ? "complete" : "identified";
}

function readCachedAccountState(options = {}) {
  const wxApi = getWxApi(options);
  if (!wxApi || typeof wxApi.getStorageSync !== "function") {
    return guestState();
  }

  try {
    const cached = wxApi.getStorageSync(ACCOUNT_PROFILE_CACHE_KEY);
    if (!cached || cached.version !== ACCOUNT_PROFILE_CACHE_VERSION) {
      return guestState();
    }
    const profile = sanitizeCachedProfile(cached.profile);
    if (!profile) return guestState();

    return {
      status: profileStatus(profile),
      profile,
      source: "cache",
      cachedAt: numberValue(cached.cachedAt),
      errorCode: "",
      errorMessage: "",
    };
  } catch (error) {
    return guestState();
  }
}

function writeCachedProfile(wxApi, profile, now) {
  if (!wxApi || typeof wxApi.setStorageSync !== "function") return;
  try {
    wxApi.setStorageSync(ACCOUNT_PROFILE_CACHE_KEY, {
      version: ACCOUNT_PROFILE_CACHE_VERSION,
      cachedAt: now,
      profile,
    });
  } catch (error) {
    // Cloud identity remains usable even when the local cache is unavailable.
  }
}

function clearCachedAccountState(options = {}) {
  const wxApi = getWxApi(options);
  if (!wxApi || typeof wxApi.removeStorageSync !== "function") return false;
  try {
    wxApi.removeStorageSync(ACCOUNT_PROFILE_CACHE_KEY);
    wxApi.removeStorageSync(LEGACY_ACCOUNT_PROFILE_CACHE_KEY);
    wxApi.removeStorageSync(ACHIEVEMENT_CACHE_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

function sanitizeAchievementItem(value) {
  if (!value || typeof value !== "object") return null;
  const id = stringValue(value.id);
  const title = limitedTitle(value.title);
  if (!id || !title) return null;
  const progress = value.progress && typeof value.progress === "object" ? value.progress : {};
  const target = Math.max(1, Math.floor(numberValue(progress.target)));
  const current = Math.min(target, Math.max(0, Math.floor(numberValue(progress.current))));
  const rate = stringValue(value.unlock_rate);

  return {
    id,
    title,
    description: stringValue(value.description),
    requirement: stringValue(value.requirement),
    grant_type: stringValue(value.grant_type),
    unlocked: value.unlocked === true,
    equipped: value.equipped === true,
    unlocked_at: value.unlocked_at || null,
    progress: {
      current,
      target,
    },
    unlocked_user_count: Math.max(0, Math.floor(numberValue(value.unlocked_user_count))),
    unlock_rate: /^\d{1,3}\.\d{2}%$/u.test(rate) ? rate : "0.00%",
  };
}

function sanitizeAchievementState(value) {
  if (!value || typeof value !== "object") return null;
  const items = (Array.isArray(value.items) ? value.items : [])
    .map(sanitizeAchievementItem)
    .filter(Boolean);
  if (items.length === 0) return null;
  const equippedTitle = sanitizeEquippedTitle(value.equipped_title);
  if (!items.some((item) => item.id === equippedTitle.id)) {
    return null;
  }
  return {
    catalog_version: Math.max(1, Math.floor(numberValue(value.catalog_version))),
    equipped_title: equippedTitle,
    active_user_count: Math.max(0, Math.floor(numberValue(value.active_user_count))),
    statistics_updated_at: value.statistics_updated_at || null,
    items: items.map((item) => ({
      ...item,
      equipped: item.id === equippedTitle.id,
    })),
  };
}

function readCachedAchievementState(options = {}) {
  const wxApi = getWxApi(options);
  if (!wxApi || typeof wxApi.getStorageSync !== "function") return null;
  try {
    const cached = wxApi.getStorageSync(ACHIEVEMENT_CACHE_KEY);
    if (!cached || cached.version !== ACHIEVEMENT_CACHE_VERSION) {
      return null;
    }
    const state = sanitizeAchievementState(cached.state);
    if (!state) return null;
    return {
      ...state,
      source: "cache",
      cachedAt: numberValue(cached.cachedAt),
    };
  } catch (error) {
    return null;
  }
}

function writeCachedAchievementState(wxApi, state, now) {
  if (!wxApi || typeof wxApi.setStorageSync !== "function") return;
  const sanitized = sanitizeAchievementState(state);
  if (!sanitized) return;
  try {
    wxApi.setStorageSync(ACHIEVEMENT_CACHE_KEY, {
      version: ACHIEVEMENT_CACHE_VERSION,
      cachedAt: now,
      state: sanitized,
    });
  } catch (error) {
    // The cloud state remains authoritative when local storage is unavailable.
  }
}

function clearCachedAchievementState(options = {}) {
  const wxApi = getWxApi(options);
  if (!wxApi || typeof wxApi.removeStorageSync !== "function") return false;
  try {
    wxApi.removeStorageSync(ACHIEVEMENT_CACHE_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

function isFresh(state, now, ttlMs) {
  return Boolean(
    state &&
    state.profile &&
    state.cachedAt > 0 &&
    now - state.cachedAt >= 0 &&
    now - state.cachedAt < ttlMs,
  );
}

function requestError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function callAccountFunction(wxApi, data) {
  return new Promise((resolve, reject) => {
    if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.callFunction !== "function") {
      reject(requestError("ACCOUNT_CLOUD_UNAVAILABLE", "当前微信版本暂不支持账号服务"));
      return;
    }

    wxApi.cloud.callFunction({
      name: ACCOUNT_FUNCTION_NAME,
      data,
      success: resolve,
      fail: reject,
    });
  });
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(requestError("ACCOUNT_REQUEST_TIMEOUT", "账号服务响应超时"));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function parseCloudPayload(response) {
  let payload = response && response.result;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      throw requestError("ACCOUNT_RESPONSE_INVALID", "账号服务返回异常");
    }
  }

  if (!payload || payload.ok !== true) {
    const code = stringValue(payload && payload.error && payload.error.code);
    const message = stringValue(payload && payload.error && payload.error.message);
    throw requestError(code || "ACCOUNT_REQUEST_FAILED", message || "账号服务暂不可用");
  }
  return payload.data || {};
}

function parseCloudProfile(response) {
  const data = parseCloudPayload(response);
  const profile = sanitizeCachedProfile(data.profile);
  if (!profile) {
    throw requestError("ACCOUNT_RESPONSE_INVALID", "账号资料格式异常");
  }
  return profile;
}

function parseAchievementData(data) {
  const state = sanitizeAchievementState(data && data.achievements);
  if (!state) {
    throw requestError("ACHIEVEMENT_RESPONSE_INVALID", "成就资料格式异常");
  }
  return {
    profile: sanitizeCachedProfile(data && data.profile),
    state,
  };
}

function isTimestampFresh(cachedAt, now, ttlMs) {
  return Boolean(cachedAt > 0 && now - cachedAt >= 0 && now - cachedAt < ttlMs);
}

function loadAchievementState(options = {}) {
  const wxApi = getWxApi(options);
  const now = typeof options.now === "number" ? options.now : Date.now();
  const ttlMs = numberValue(options.ttlMs) || ACHIEVEMENT_CACHE_TTL_MS;
  const cached = readCachedAchievementState({ wxApi });

  if (!options.force && cached && isTimestampFresh(cached.cachedAt, now, ttlMs)) {
    return Promise.resolve(cached);
  }
  if (activeAchievementRequest) return activeAchievementRequest;

  activeAchievementRequest = withTimeout(
    callAccountFunction(wxApi, {
      action: "getAchievementState",
    }),
    numberValue(options.timeoutMs) || ACCOUNT_REQUEST_TIMEOUT_MS,
  )
    .then(parseCloudPayload)
    .then((data) => {
      const parsed = parseAchievementData(data);
      if (parsed.profile) writeCachedProfile(wxApi, parsed.profile, now);
      writeCachedAchievementState(wxApi, parsed.state, now);
      return {
        ...parsed.state,
        source: "cloud",
        cachedAt: now,
      };
    })
    .finally(() => {
      activeAchievementRequest = null;
    });

  return activeAchievementRequest;
}

function equipAchievement(options = {}) {
  const achievementId = stringValue(options.achievementId);
  if (!achievementId) {
    return Promise.reject(requestError("ACHIEVEMENT_ID_REQUIRED", "请选择需要佩戴的头衔"));
  }
  if (activeAchievementEquipRequest && activeAchievementEquipId === achievementId) {
    return activeAchievementEquipRequest;
  }
  if (activeAchievementEquipRequest) {
    return Promise.reject(
      requestError("ACHIEVEMENT_UPDATE_IN_PROGRESS", "正在更新佩戴头衔，请稍候"),
    );
  }

  const wxApi = getWxApi(options);
  const now = typeof options.now === "number" ? options.now : Date.now();
  activeAchievementEquipId = achievementId;
  activeAchievementEquipRequest = withTimeout(
    callAccountFunction(wxApi, {
      action: "equipAchievement",
      achievement_id: achievementId,
    }),
    numberValue(options.timeoutMs) || ACCOUNT_REQUEST_TIMEOUT_MS,
  )
    .then(parseCloudPayload)
    .then((data) => {
      const parsed = parseAchievementData(data);
      if (!parsed.profile) {
        throw requestError("ACCOUNT_RESPONSE_INVALID", "账号资料格式异常");
      }
      writeCachedProfile(wxApi, parsed.profile, now);
      writeCachedAchievementState(wxApi, parsed.state, now);
      return {
        ...parsed.state,
        profile: parsed.profile,
        source: "cloud",
        cachedAt: now,
      };
    })
    .finally(() => {
      activeAchievementEquipRequest = null;
      activeAchievementEquipId = "";
    });

  return activeAchievementEquipRequest;
}

function classifyFailure(error, cachedState) {
  const code = stringValue(error && (error.code || error.errCode));
  const message = stringValue(error && (error.message || error.errMsg));
  const offline = /timeout|network|offline|request:fail|fail connect/i.test(`${code} ${message}`);

  const deactivated = code === "ACCOUNT_DEACTIVATED";
  return {
    status: deactivated ? "deactivated" : offline ? "offline" : "error",
    profile: cachedState.profile,
    source: cachedState.profile ? "cache" : "local",
    cachedAt: cachedState.cachedAt,
    errorCode: code || "ACCOUNT_REQUEST_FAILED",
    errorMessage: message || "账号服务暂不可用",
  };
}

function deactivateAccount(options = {}) {
  if (activeDeactivationRequest) return activeDeactivationRequest;
  const wxApi = getWxApi(options);
  const timeoutMs = numberValue(options.timeoutMs) || Math.max(15000, ACCOUNT_REQUEST_TIMEOUT_MS);

  activeDeactivationRequest = withTimeout(
    callAccountFunction(wxApi, {
      action: "deactivateAccount",
    }),
    timeoutMs,
  )
    .then(parseCloudPayload)
    .then((data) => {
      clearCachedAccountState({ wxApi });
      return {
        deactivated: data.deactivated === true,
        deletedCounts:
          data.deleted_counts && typeof data.deleted_counts === "object" ? data.deleted_counts : {},
      };
    })
    .finally(() => {
      activeDeactivationRequest = null;
    });

  return activeDeactivationRequest;
}

async function requestAccountState(options = {}) {
  const wxApi = getWxApi(options);
  const now = typeof options.now === "number" ? options.now : Date.now();
  const timeoutMs = numberValue(options.timeoutMs) || ACCOUNT_REQUEST_TIMEOUT_MS;
  const cachedState = readCachedAccountState({ wxApi });

  try {
    const response = await withTimeout(
      callAccountFunction(wxApi, {
        action: "getOrCreateProfile",
      }),
      timeoutMs,
    );
    const profile = parseCloudProfile(response);
    writeCachedProfile(wxApi, profile, now);
    return {
      status: profileStatus(profile),
      profile,
      source: "cloud",
      cachedAt: now,
      errorCode: "",
      errorMessage: "",
    };
  } catch (error) {
    return classifyFailure(error, cachedState);
  }
}

function getFileInfo(wxApi, filePath) {
  return new Promise((resolve, reject) => {
    if (!wxApi || typeof wxApi.getFileInfo !== "function") {
      reject(requestError("ACCOUNT_AVATAR_FILE_UNAVAILABLE", "暂时无法读取头像文件"));
      return;
    }
    wxApi.getFileInfo({
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

function avatarExtension(filePath) {
  const match = stringValue(filePath).match(/\.([a-z0-9]+)(?:\?|$)/i);
  const extension = match ? match[1].toLowerCase() : "jpg";
  return ["jpg", "jpeg", "png", "webp"].includes(extension) ? extension : "jpg";
}

function uploadCloudFile(wxApi, cloudPath, filePath) {
  return new Promise((resolve, reject) => {
    if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.uploadFile !== "function") {
      reject(requestError("ACCOUNT_CLOUD_UNAVAILABLE", "当前微信版本暂不支持头像上传"));
      return;
    }
    wxApi.cloud.uploadFile({
      cloudPath,
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

async function uploadProfileAvatar(options = {}) {
  const wxApi = getWxApi(options);
  const filePath = stringValue(options.filePath);
  const profileId = stringValue(options.profileId);
  const now = typeof options.now === "number" ? options.now : Date.now();
  const random = typeof options.random === "function" ? options.random : Math.random;

  if (!filePath) {
    throw requestError("ACCOUNT_AVATAR_FILE_REQUIRED", "请先选择头像");
  }
  if (!/^usr_[a-f0-9]{48}$/u.test(profileId)) {
    throw requestError("ACCOUNT_PROFILE_INVALID", "账号资料尚未准备完成");
  }

  let fileInfo;
  try {
    fileInfo = await getFileInfo(wxApi, filePath);
  } catch (error) {
    throw requestError(
      stringValue(error && (error.code || error.errCode)) || "ACCOUNT_AVATAR_FILE_UNAVAILABLE",
      "暂时无法读取头像文件",
    );
  }

  if (numberValue(fileInfo && fileInfo.size) > MAX_AVATAR_SIZE_BYTES) {
    throw requestError("ACCOUNT_AVATAR_TOO_LARGE", "头像文件不能超过4MB");
  }

  const token = Math.floor(random() * 1e9)
    .toString(36)
    .padStart(6, "0");
  const cloudPath = [
    "user-avatars",
    profileId,
    `${now}-${token}.${avatarExtension(filePath)}`,
  ].join("/");

  let response;
  try {
    response = await uploadCloudFile(wxApi, cloudPath, filePath);
  } catch (error) {
    throw requestError(
      stringValue(error && (error.code || error.errCode)) || "ACCOUNT_AVATAR_UPLOAD_FAILED",
      "头像上传失败，请稍后重试",
    );
  }

  const fileID = stringValue(response && response.fileID);
  if (!fileID) {
    throw requestError("ACCOUNT_AVATAR_UPLOAD_INVALID", "头像上传结果异常，请重试");
  }
  return {
    fileID,
    cloudPath,
  };
}

function updateAccountProfile(options = {}) {
  if (activeProfileUpdateRequest) return activeProfileUpdateRequest;

  const wxApi = getWxApi(options);
  const validation = validateNickname(options.nickname);
  if (!validation.valid) {
    return Promise.reject(requestError("ACCOUNT_NICKNAME_INVALID", validation.message));
  }
  const now = typeof options.now === "number" ? options.now : Date.now();
  const timeoutMs = numberValue(options.timeoutMs) || ACCOUNT_REQUEST_TIMEOUT_MS;

  activeProfileUpdateRequest = withTimeout(
    callAccountFunction(wxApi, {
      action: "updateProfile",
      profile: {
        nickname: validation.value,
        avatar_url: stringValue(options.avatarUrl),
      },
    }),
    timeoutMs,
  )
    .then((response) => {
      const profile = parseCloudProfile(response);
      writeCachedProfile(wxApi, profile, now);
      return {
        status: profileStatus(profile),
        profile,
        source: "cloud",
        cachedAt: now,
        errorCode: "",
        errorMessage: "",
      };
    })
    .finally(() => {
      activeProfileUpdateRequest = null;
    });

  return activeProfileUpdateRequest;
}

function loadAccountState(options = {}) {
  const wxApi = getWxApi(options);
  const now = typeof options.now === "number" ? options.now : Date.now();
  const ttlMs = numberValue(options.ttlMs) || ACCOUNT_PROFILE_CACHE_TTL_MS;
  const cachedState = readCachedAccountState({ wxApi });

  if (!options.force && isFresh(cachedState, now, ttlMs)) {
    return Promise.resolve(cachedState);
  }

  if (activeAccountRequest) return activeAccountRequest;

  activeAccountRequest = requestAccountState({
    ...options,
    wxApi,
    now,
  }).finally(() => {
    activeAccountRequest = null;
  });
  return activeAccountRequest;
}

function resetAccountServiceForTests() {
  activeAccountRequest = null;
  activeProfileUpdateRequest = null;
  activeDeactivationRequest = null;
  activeAchievementRequest = null;
  activeAchievementEquipRequest = null;
  activeAchievementEquipId = "";
}

module.exports = {
  ACHIEVEMENT_CACHE_KEY,
  ACHIEVEMENT_CACHE_TTL_MS,
  ACHIEVEMENT_CACHE_VERSION,
  ACCOUNT_FUNCTION_NAME,
  ACCOUNT_PROFILE_CACHE_KEY,
  ACCOUNT_PROFILE_CACHE_VERSION,
  ACCOUNT_PROFILE_CACHE_TTL_MS,
  ACCOUNT_REQUEST_TIMEOUT_MS,
  DEFAULT_ACHIEVEMENT_ID,
  DEFAULT_ACHIEVEMENT_TITLE,
  MAX_AVATAR_SIZE_BYTES,
  MAX_NICKNAME_LENGTH,
  classifyFailure,
  callAccountFunction,
  clearCachedAccountState,
  deactivateAccount,
  clearCachedAchievementState,
  equipAchievement,
  guestState,
  loadAccountState,
  loadAchievementState,
  normalizeNickname,
  parseCloudPayload,
  parseCloudProfile,
  readCachedAccountState,
  readCachedAchievementState,
  resetAccountServiceForTests,
  sanitizeCachedProfile,
  sanitizeAchievementState,
  updateAccountProfile,
  uploadProfileAvatar,
  validateNickname,
  withTimeout,
  writeCachedProfile,
  writeCachedAchievementState,
};
