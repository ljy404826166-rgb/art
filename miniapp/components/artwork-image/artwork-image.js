const {
  resolveArtworkImageCandidates,
} = require("../../services/artwork-image-sources");

const loadedImageSrcs = {};

Component({
  properties: {
    artwork: {
      type: Object,
      value: {},
      observer() {
        this.prepareImage();
      },
    },
    usage: {
      type: String,
      value: "card",
      observer() {
        this.prepareImage();
      },
    },
    mode: {
      type: String,
      value: "",
    },
    frameStyle: {
      type: String,
      value: "",
    },
    fallbackText: {
      type: String,
      value: "",
    },
    lazyLoad: {
      type: Boolean,
      value: true,
    },
    shape: {
      type: String,
      value: "",
    },
  },

  data: {
    currentSrc: "",
    candidates: [],
    candidateIndex: 0,
    loading: false,
    failed: false,
    resolvedMode: "aspectFill",
    resolvedShape: "rounded",
    displayText: "",
  },

  lifetimes: {
    attached() {
      this.prepareImage();
    },
  },

  methods: {
    compactUnique(values) {
      const seen = {};
      return values.reduce((result, value) => {
        const text = String(value || "").trim();
        if (!text || seen[text]) return result;
        seen[text] = true;
        result.push(text);
        return result;
      }, []);
    },

    resolveCandidates(artwork, usage) {
      if (usage === "avatar") {
        return this.compactUnique([
          artwork.avatar_url,
          artwork.cloud_file_id,
          artwork.thumbnail_url,
        ]);
      }

      return resolveArtworkImageCandidates(artwork, usage);
    },

    resolveMode(usage) {
      if (this.properties.mode) return this.properties.mode;
      if (usage === "detail") return "widthFix";
      return "aspectFill";
    },

    resolveShape(usage) {
      if (this.properties.shape) return this.properties.shape;
      if (usage === "avatar") return "circle";
      return "rounded";
    },

    resolveText(artwork) {
      return this.properties.fallbackText
        || artwork.title
        || artwork.titleCn
        || artwork.title_cn
        || "未命名作品";
    },

    prepareImage() {
      const artwork = this.properties.artwork || {};
      const usage = this.properties.usage || "card";
      const candidates = this.resolveCandidates(artwork, usage);
      const currentSrc = candidates[0] || "";
      const isSameLoadedImage = currentSrc && currentSrc === this.data.currentSrc && !this.data.loading && !this.data.failed;
      this.setData({
        candidates,
        candidateIndex: 0,
        currentSrc,
        loading: Boolean(currentSrc) && !loadedImageSrcs[currentSrc] && !isSameLoadedImage,
        failed: !candidates.length,
        resolvedMode: this.resolveMode(usage),
        resolvedShape: this.resolveShape(usage),
        displayText: this.resolveText(artwork),
      });
    },

    handleLoad(event) {
      if (this.data.currentSrc) {
        loadedImageSrcs[this.data.currentSrc] = true;
      }
      this.setData({
        loading: false,
        failed: false,
      });
      this.triggerEvent("imageload", {
        width: event.detail.width,
        height: event.detail.height,
        src: this.data.currentSrc,
      });
    },

    handleError() {
      const nextIndex = this.data.candidateIndex + 1;
      const nextSrc = this.data.candidates[nextIndex];
      if (nextSrc) {
        this.setData({
          candidateIndex: nextIndex,
          currentSrc: nextSrc,
          loading: true,
          failed: false,
        });
        return;
      }
      this.setData({
        loading: false,
        failed: true,
      });
      this.triggerEvent("imageerror", {
        fallbackText: this.data.displayText,
      });
    },
  },
});
