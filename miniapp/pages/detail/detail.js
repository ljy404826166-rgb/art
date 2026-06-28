const {
  fetchArtworkById,
  fallbackArtworkById,
  normalizeError,
} = require("../../services/artworks");
const { loadArtistByArtworkText } = require("../../services/artists");
const {
  computeDetailHeroFrameStyle,
  resolveDetailMeasureSrc,
} = require("./detail-image-layout");
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

const detailImageRatioCache = {};

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
    this.loadArtwork(options.id || options.source_id || options.supabase_id);
  },

  async loadArtwork(id) {
    this.setData({
      currentId: id || "",
      loading: true,
      error: "",
    });
    try {
      const artwork = await fetchArtworkById(id);
      this.applyLoadedArtwork(artwork, { usingFallback: false });
    } catch (error) {
      const fallbackArtwork = fallbackArtworkById(id);
      this.applyLoadedArtwork(fallbackArtwork, {
        error: normalizeError(error),
        usingFallback: true,
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
    this.loadArtwork(this.data.currentId);
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

  async downloadArtwork() {
    const artwork = this.data.artwork;
    if (!artwork || this.data.downloading) return;

    const downloadUrl = resolveArtworkDownloadUrl(artwork);
    if (!downloadUrl) {
      wx.showToast({
        title: "暂无可下载原图",
        icon: "none",
      });
      return;
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
  },
});
