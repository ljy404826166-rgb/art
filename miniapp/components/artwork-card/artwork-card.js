const {
  ROW_IMAGE_HEIGHT_RPX,
  computeRowArtworkCardWidth,
  resolveRowArtworkMeasureSrc,
} = require("../horizontal-artwork-row/horizontal-artwork-row-geometry");

const rowImageRatioCache = {};

Component({
  properties: {
    artwork: {
      type: Object,
      value: {},
      observer() {
        this.prepareArtwork();
      },
    },
    variant: {
      type: String,
      value: "grid",
      observer(value) {
        const item = this.properties.artwork || {};
        const initialRatio = value === "row"
          ? (item.homeCardClass === "is-wide" ? 1.36 : 0.72)
          : (this.data.imageRatio || 0.8);
        this.updateLayout(initialRatio);
        if (value === "row") this.measureRowImage(item);
      },
    },
  },

  data: {
    imageRatio: 0.8,
    orientation: "portrait",
    cardStyle: "width: 100%;",
    frameStyle: "height: 340rpx;",
    displayTitle: "未命名作品",
    displayArtist: "Unknown artist",
  },

  lifetimes: {
    attached() {
      this.prepareArtwork();
    },
  },

  methods: {
    getInitialRatio(item) {
      if (this.properties.variant !== "row") return 0.8;
      if (item && item.homeCardClass === "is-wide") return 1.36;
      return 0.72;
    },

    prepareArtwork() {
      const item = this.properties.artwork || {};
      const initialRatio = this.getInitialRatio(item);
      this.setData({
        imageRatio: initialRatio,
        orientation: initialRatio > 1.18 ? "landscape" : "portrait",
        displayTitle: item.title || item.titleCn || item.title_cn || "未命名作品",
        displayArtist: item.artist || "Unknown artist",
      });
      this.updateLayout(initialRatio);
      this.measureRowImage(item);
    },

    handleImageLoad(event) {
      const detail = event.detail || {};
      const width = Number(detail.width || 0);
      const height = Number(detail.height || 0);
      if (!width || !height) return;
      const ratio = width / height;
      if (detail.src) rowImageRatioCache[detail.src] = ratio;
      this.updateLayout(ratio);
    },

    measureRowImage(item) {
      if (this.properties.variant !== "row") return;

      const src = resolveRowArtworkMeasureSrc(item || {});
      if (!src) return;

      const cachedRatio = rowImageRatioCache[src];
      if (cachedRatio) {
        this.updateLayout(cachedRatio);
        return;
      }

      if (this.pendingRowMeasureSrc === src) return;
      if (typeof wx === "undefined" || !wx.getImageInfo) return;

      this.pendingRowMeasureSrc = src;
      wx.getImageInfo({
        src,
        success: (result) => {
          if (this.pendingRowMeasureSrc !== src) return;
          this.pendingRowMeasureSrc = "";

          const width = Number(result && result.width);
          const height = Number(result && result.height);
          if (!width || !height) return;

          const ratio = width / height;
          rowImageRatioCache[src] = ratio;
          this.updateLayout(ratio);
        },
        fail: () => {
          if (this.pendingRowMeasureSrc === src) {
            this.pendingRowMeasureSrc = "";
          }
        },
      });
    },

    updateLayout(ratio) {
      const imageRatio = Number(ratio || 0.8);
      let orientation = "square";
      if (imageRatio > 1.18) orientation = "landscape";
      if (imageRatio < 0.82) orientation = "portrait";

      if (this.properties.variant === "row") {
        const imageHeight = ROW_IMAGE_HEIGHT_RPX;
        const cardHeight = 478;
        const cardWidth = computeRowArtworkCardWidth(imageRatio);
        this.setData({
          imageRatio,
          orientation,
          cardStyle: `width: ${cardWidth}rpx; height: ${cardHeight}rpx;`,
          frameStyle: `height: ${imageHeight}rpx;`,
        });
        this.triggerEvent("layoutchange", {
          id: (this.properties.artwork || {})._id || (this.properties.artwork || {}).id || "",
          cardWidth,
        });
        return;
      }

      this.setData({
        imageRatio,
        orientation,
        cardStyle: "width: 100%; height: 476rpx;",
        frameStyle: "height: 340rpx;",
      });
    },

    handleTap() {
      const item = this.properties.artwork || {};
      this.triggerEvent("tapcard", {
        id: item._id || item.id,
        ratio: this.data.imageRatio,
      });
    },
  },
});
