const {
  loadAccountState,
  normalizeNickname,
  readCachedAccountState,
  updateAccountProfile,
  uploadProfileAvatar,
  validateNickname,
} = require("../../services/account");

function firstAvatarCharacter(name) {
  const value = String(name || "").trim();
  return value ? Array.from(value)[0] : "艺";
}

function errorMessage(error, fallback) {
  const message = String((error && (error.message || error.errMsg)) || "").trim();
  return message || fallback;
}

function formFromProfile(profile) {
  const value = profile || {};
  const nickname = String(value.nickname || "");
  const avatarUrl = String(value.avatar_url || "");
  return {
    profileId: String(value.id || ""),
    nickname,
    originalNickname: nickname,
    avatarPreviewUrl: avatarUrl,
    savedAvatarUrl: avatarUrl,
    pendingAvatarPath: "",
    avatarText: firstAvatarCharacter(nickname || "微信用户"),
  };
}

function canSaveProfile(data) {
  const validation = validateNickname(data.nickname);
  if (!validation.valid || !data.profileId || data.saving) return false;
  return Boolean(validation.value !== data.originalNickname || data.pendingAvatarPath);
}

Page({
  data: {
    ...formFromProfile(null),
    loading: true,
    saving: false,
    canSave: false,
    formError: "",
    accountHint: "正在读取微信账号资料…",
  },

  onLoad() {
    const cached = readCachedAccountState();
    if (cached.profile) {
      this.applyProfile(cached.profile);
    }

    this._profileLoadPromise = loadAccountState().then((state) => {
      if (state.profile) {
        this.applyProfile(state.profile);
        return state;
      }
      this.setData({
        loading: false,
        canSave: false,
        accountHint:
          state.status === "offline"
            ? "当前网络不可用，请返回后稍后重试"
            : "账号资料暂不可用，请返回后重试",
      });
      return state;
    });

    return this._profileLoadPromise;
  },

  onUnload() {
    this._pageUnloaded = true;
  },

  applyProfile(profile) {
    const form = formFromProfile(profile);
    this.setData({
      ...form,
      loading: false,
      saving: false,
      canSave: false,
      formError: "",
      accountHint: profile.profile_completed
        ? "资料已保存至微信云端"
        : "完善资料后可在不同设备恢复账号信息",
    });
  },

  onChooseAvatar(event) {
    const avatarUrl = String(
      event && event.detail && event.detail.avatarUrl ? event.detail.avatarUrl : "",
    ).trim();
    if (!avatarUrl || this.data.saving) return;

    const patch = {
      avatarPreviewUrl: avatarUrl,
      pendingAvatarPath: avatarUrl,
      formError: "",
    };
    patch.canSave = canSaveProfile({
      ...this.data,
      ...patch,
    });
    this.setData(patch);
    return this.saveProfile();
  },

  onNicknameInput(event) {
    const nickname = String(event && event.detail ? event.detail.value || "" : "");
    const patch = {
      nickname,
      avatarText: firstAvatarCharacter(nickname || "微信用户"),
      formError: "",
    };
    patch.canSave = canSaveProfile({
      ...this.data,
      ...patch,
    });
    this.setData(patch);
  },

  clearNickname() {
    if (this.data.loading || this.data.saving) return;
    const patch = {
      nickname: "",
      avatarText: firstAvatarCharacter("微信用户"),
      formError: "",
    };
    patch.canSave = canSaveProfile({
      ...this.data,
      ...patch,
    });
    this.setData(patch);
  },

  onNicknameBlur() {
    const nickname = normalizeNickname(this.data.nickname);
    const validation = validateNickname(nickname);
    const patch = {
      nickname,
      avatarText: firstAvatarCharacter(nickname || "微信用户"),
      formError: validation.valid ? "" : validation.message,
    };
    patch.canSave = canSaveProfile({
      ...this.data,
      ...patch,
    });
    this.setData(patch);
    if (patch.canSave) return this.saveProfile();
    return Promise.resolve(null);
  },

  saveProfile() {
    if (this._savePromise) return this._savePromise;

    const validation = validateNickname(this.data.nickname);
    if (!validation.valid) {
      this.setData({
        formError: validation.message,
        canSave: false,
      });
      wx.showToast({
        title: validation.message,
        icon: "none",
      });
      return Promise.resolve(null);
    }
    if (!this.data.profileId) {
      wx.showToast({
        title: "账号资料尚未准备完成",
        icon: "none",
      });
      return Promise.resolve(null);
    }
    if (!canSaveProfile(this.data)) return Promise.resolve(null);

    const previousAvatarUrl = this.data.savedAvatarUrl;
    const pendingAvatarPath = this.data.pendingAvatarPath;
    this.setData({
      saving: true,
      canSave: false,
      formError: "",
    });

    this._savePromise = (async () => {
      let avatarUrl = previousAvatarUrl;
      if (pendingAvatarPath) {
        try {
          const upload = await uploadProfileAvatar({
            filePath: pendingAvatarPath,
            profileId: this.data.profileId,
          });
          avatarUrl = upload.fileID;
        } catch (error) {
          this.setData({
            avatarPreviewUrl: previousAvatarUrl,
            pendingAvatarPath: "",
          });
          throw error;
        }
      }

      const state = await updateAccountProfile({
        nickname: validation.value,
        avatarUrl,
      });
      this.applyProfile(state.profile);
      wx.showToast({
        title: "保存成功",
        icon: "success",
      });
      return state;
    })()
      .catch((error) => {
        const message = errorMessage(error, "资料保存失败，请稍后重试");
        this.setData({
          formError: message,
        });
        wx.showToast({
          title: message,
          icon: "none",
        });
        return null;
      })
      .finally(() => {
        this._savePromise = null;
        if (!this._pageUnloaded) {
          this.setData({
            saving: false,
            canSave: canSaveProfile({
              ...this.data,
              saving: false,
            }),
          });
        }
      });

    return this._savePromise;
  },
});

module.exports = {
  canSaveProfile,
  errorMessage,
  firstAvatarCharacter,
  formFromProfile,
};
