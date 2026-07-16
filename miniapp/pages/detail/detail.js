const {
  fetchArtworkById,
  fallbackArtworkById,
} = require("../../services/artworks");
const { loadArtistByArtworkText } = require("../../services/artists");
const {
  computeDetailHeroFrameStyle,
  resolveDetailMeasureSrc,
} = require("./detail-image-layout");
const { previewArtwork } = require("../../services/artwork-preview");
const {
  downloadFile,
  getDownloadFailureMessage,
  isAlbumPermissionError,
  resolveArtworkDownloadUrl,
  saveImageToAlbum,
} = require("../../services/downloads");
const {
  isFavoriteArtwork,
  recordDownloadArtwork,
  recordHistoryArtwork,
  toggleFavoriteArtwork,
} = require("../../services/local-library");
const {
  getNetworkSnapshot,
  isCellularNetwork,
  subscribeNetworkStatus,
} = require("../../services/network-status");
const { buildArtworkShareMessage } = require("../../services/share-routes");

const detailImageRatioCache = {};
const OFFLINE_LOAD_MESSAGE = "当前无网络，请连接网络后重试";
const DETAIL_LOAD_FAILURE_MESSAGE = "作品详情加载失败，请稍后重试";
const previewFailureMessages = {
  unsupported: "当前微信版本不支持预览",
  offline: "网络连接异常，请稍后重试",
  "permission-denied": "暂无图片预览权限",
  "remote-failed": "图片预览失败，请稍后重试",
  "invalid-data": "暂无可预览图片",
};

function getPreviewFailureMessage(error) {
  return previewFailureMessages[error && error.code] || "图片预览失败";
}

function decodeRouteText(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

Page({
  data: {
    artwork: null,
    currentId: "",
    loading: true,
    error: "",
    usingFallback: false,
    isFavorite: false,
    heroFrameStyle: "",
    downloading: false,
    networkState: {
      isConnected: true,
      networkType: "unknown",
    },
    resolvedArtistId: "",
    resolvedArtistText: "",
  },

  onLoad(options) {
    wx.setNavigationBarTitle({
      title: "详情",
    });
    const routeRatioStyle = computeDetailHeroFrameStyle(options && options.ratio);
    if (routeRatioStyle) {
      this.setData({ heroFrameStyle: routeRatioStyle });
    }
    const routeId = options && (options.id || options.source_id || options.supabase_id);
    this.loadArtwork(decodeRouteText(routeId));
  },

  onShow() {
    this.stopNetworkMonitor();
    this.stopNetworkSubscription = subscribeNetworkStatus((networkState) => {
      this.setData({ networkState });
    });
  },

  onHide() {
    this.stopNetworkMonitor();
  },

  onUnload() {
    this.stopNetworkMonitor();
  },

  stopNetworkMonitor() {
    if (typeof this.stopNetworkSubscription === "function") {
      this.stopNetworkSubscription();
      this.stopNetworkSubscription = null;
    }
  },

  onShareAppMessage() {
    const shareArtwork = this.data.loading && this.data.currentId
      ? { id: this.data.currentId }
      : (this.data.artwork || { id: this.data.currentId });
    return buildArtworkShareMessage(shareArtwork);
  },

  async previewHeroImage() {
    if (!this.data.artwork) return;
    try {
      await previewArtwork(this.data.artwork);
    } catch (error) {
      wx.showToast({
        title: getPreviewFailureMessage(error),
        icon: "none",
      });
    }
  },

  async loadArtwork(id) {
    this.setData({
      currentId: id || "",
      loading: true,
      error: "",
    });
    let networkState;
    try {
      networkState = await getNetworkSnapshot();
      this.setData({ networkState });
    } catch (error) {
      // Unknown probe failures retain compatibility with the existing cloud load.
    }

    if (networkState && networkState.isConnected === false) {
      this.setData({
        loading: false,
        error: OFFLINE_LOAD_MESSAGE,
        usingFallback: false,
      });
      return;
    }

    try {
      const artwork = await fetchArtworkById(id);
      this.applyLoadedArtwork(artwork, {
        error: artwork ? "" : DETAIL_LOAD_FAILURE_MESSAGE,
        usingFallback: false,
      });
    } catch (error) {
      const fallbackArtwork = fallbackArtworkById(id);
      this.applyLoadedArtwork(fallbackArtwork, {
        error: DETAIL_LOAD_FAILURE_MESSAGE,
        usingFallback: Boolean(fallbackArtwork),
      });
    }
  },

  applyLoadedArtwork(artwork, options = {}) {
    const artworkId = artwork && (artwork._id || artwork.id || artwork.source_id || artwork.supabase_id);
    if (artwork) {
      recordHistoryArtwork(artwork);
    }

    this.setData({
      artwork,
      loading: false,
      error: options.error || "",
      usingFallback: Boolean(options.usingFallback),
      isFavorite: isFavoriteArtwork(artworkId),
    });

    this.measureHeroImage(artwork);
    this.prefetchArtistFromArtwork(artwork);
  },

  async prefetchArtistFromArtwork(artwork) {
    const artistText = artwork && artwork.artist;
    this.setData({
      resolvedArtistId: "",
      resolvedArtistText: artistText || "",
    });
    if (!artistText) return;

    const result = await loadArtistByArtworkText(artistText, { allowFallback: false });
    const currentArtistText = this.data.artwork && this.data.artwork.artist;
    if (currentArtistText !== artistText) return;

    if (result && result.artist && result.artist.id) {
      this.setData({
        resolvedArtistId: result.artist.id,
        resolvedArtistText: artistText,
      });
    }
  },

  setHeroImageRatio(ratio) {
    const heroFrameStyle = computeDetailHeroFrameStyle(ratio);
    if (!heroFrameStyle || heroFrameStyle === this.data.heroFrameStyle) return;
    this.setData({ heroFrameStyle });
  },

  measureHeroImage(artwork) {
    const src = resolveDetailMeasureSrc(artwork || {});
    if (!src) return;

    const cachedRatio = detailImageRatioCache[src];
    if (cachedRatio) {
      this.setHeroImageRatio(cachedRatio);
      return;
    }

    if (typeof wx === "undefined" || !wx.getImageInfo) return;
    this.pendingHeroMeasureSrc = src;
    wx.getImageInfo({
      src,
      success: (result) => {
        if (this.pendingHeroMeasureSrc !== src) return;
        this.pendingHeroMeasureSrc = "";

        const width = Number(result && result.width);
        const height = Number(result && result.height);
        if (!width || !height) return;

        const ratio = width / height;
        detailImageRatioCache[src] = ratio;
        this.setHeroImageRatio(ratio);
      },
      fail: () => {
        if (this.pendingHeroMeasureSrc === src) {
          this.pendingHeroMeasureSrc = "";
        }
      },
    });
  },

  handleHeroImageLoad(event) {
    const detail = event.detail || {};
    const width = Number(detail.width || 0);
    const height = Number(detail.height || 0);
    if (!width || !height) return;

    if (detail.src) {
      detailImageRatioCache[detail.src] = width / height;
    }
    this.setHeroImageRatio(width / height);
  },

  retryLoad() {
    return this.loadArtwork(this.data.currentId);
  },

  openArtistFromArtwork() {
    const artistText = this.data.artwork && this.data.artwork.artist;
    if (!artistText) {
      wx.showToast({
        title: "暂无画家详情",
        icon: "none",
      });
      return;
    }

    const resolvedArtistId = this.data.resolvedArtistText === artistText
      ? this.data.resolvedArtistId
      : "";
    const query = resolvedArtistId
      ? `id=${encodeURIComponent(resolvedArtistId)}`
      : `artistText=${encodeURIComponent(artistText)}`;
    wx.navigateTo({
      url: `/pages/artist-detail/artist-detail?${query}`,
    });
  },

  openTag(event) {
    const { tag } = event.currentTarget.dataset || {};
    if (!tag) return;
    wx.navigateTo({
      url: `/pages/tag/tag?tag=${encodeURIComponent(tag)}`,
    });
  },

  toggleFavorite() {
    if (!this.data.artwork) return;
    const isFavorite = toggleFavoriteArtwork(this.data.artwork);
    this.setData({ isFavorite });
    wx.showToast({
      title: isFavorite ? "已收藏" : "已取消收藏",
      icon: "none",
    });
  },

  confirmDownloadWithTrafficWarning() {
    return new Promise((resolve) => {
      wx.showModal({
        title: "下载流量提醒",
        content: "网络状态不明或可能正在使用移动网络，继续下载可能消耗流量。是否继续？",
        confirmText: "继续下载",
        success: (result) => resolve(Boolean(result && result.confirm)),
        fail: () => resolve(false),
      });
    });
  },

  async downloadArtwork() {
    const artwork = this.data.artwork;
    if (!artwork || this.data.downloading || this.downloadRequestPending) return;

    const downloadUrl = resolveArtworkDownloadUrl(artwork);
    if (!downloadUrl) {
      wx.showToast({
        title: "暂无可下载原图",
        icon: "none",
      });
      return;
    }

    this.downloadRequestPending = true;
    try {
      let networkState;
      try {
        networkState = await getNetworkSnapshot();
      } catch (error) {
        networkState = {
          isConnected: true,
          networkType: "unknown",
        };
      }
      this.setData({ networkState });

      if (!networkState.isConnected) {
        wx.showToast({
          title: "当前无网络，无法下载原图",
          icon: "none",
        });
        return;
      }

      if (
        isCellularNetwork(networkState.networkType)
        || networkState.networkType === "unknown"
      ) {
        const confirmed = await this.confirmDownloadWithTrafficWarning();
        if (!confirmed) return;
      }

      this.setData({ downloading: true });
      wx.showLoading({
        title: "下载中",
        mask: true,
      });

      try {
        const tempFilePath = await downloadFile(downloadUrl);
        await saveImageToAlbum(tempFilePath);
        recordDownloadArtwork(artwork, "completed");
        wx.hideLoading();
        wx.showToast({
          title: "已保存到相册",
          icon: "success",
        });
      } catch (error) {
        wx.hideLoading();
        if (isAlbumPermissionError(error)) {
          wx.showModal({
            title: "需要相册权限",
            content: "请允许保存到相册后重试下载。",
            confirmText: "去设置",
            success: (result) => {
              if (result.confirm && wx.openSetting) {
                wx.openSetting();
              }
            },
          });
        } else {
          wx.showToast({
            title: getDownloadFailureMessage(error),
            icon: "none",
          });
        }
      } finally {
        this.setData({ downloading: false });
      }
    } finally {
      this.downloadRequestPending = false;
    }
  },
});
