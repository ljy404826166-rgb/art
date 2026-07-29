Component({
  properties: {
    artist: {
      type: Object,
      value: null,
      observer() {
        this.preparePortrait();
      },
    },
    size: {
      type: String,
      value: "list",
    },
    lazyLoad: {
      type: Boolean,
      value: true,
    },
  },

  data: {
    imageSrc: "",
    displayText: "?",
    ariaLabel: "画家头像",
    loading: false,
    failed: false,
    showImage: false,
  },

  lifetimes: {
    attached() {
      this.preparePortrait();
    },
  },

  methods: {
    resolveDisplayText(artist) {
      const explicit = String(artist.avatarText || artist.avatar_text || "").trim();
      if (explicit) return explicit.slice(0, 2);
      const name = String(
        artist.nameZh || artist.name_zh || artist.nameEn || artist.name_en || "",
      ).trim();
      return name ? name.slice(0, 1) : "?";
    },

    resolvePortraitKey(artist, imageSrc) {
      if (!imageSrc) return "";
      const identity = String(
        artist.id ||
          artist._id ||
          artist.nameZh ||
          artist.name_zh ||
          artist.nameEn ||
          artist.name_en ||
          "",
      ).trim();
      return `${identity}\n${imageSrc}`;
    },

    preparePortrait() {
      const artist = this.properties.artist || {};
      const portraitStatus = String(artist.portraitStatus || artist.portrait_status || "").trim();
      const rawImageSrc = String(artist.portraitUrl || artist.portrait_url || "").trim();
      const imageSrc = portraitStatus === "approved" ? rawImageSrc : "";
      const displayName = String(
        artist.nameZh || artist.name_zh || artist.nameEn || artist.name_en || "",
      ).trim();
      const portraitKey = this.resolvePortraitKey(artist, imageSrc);
      const isSamePortrait =
        Boolean(portraitKey) &&
        portraitKey === this._portraitKey &&
        imageSrc === this.data.imageSrc;
      this._portraitKey = portraitKey;

      const nextData = {
        displayText: this.resolveDisplayText(artist),
        ariaLabel: displayName ? `${displayName}肖像` : "画家头像",
      };
      if (isSamePortrait) {
        this.setData(nextData);
        return;
      }

      this.setData({
        ...nextData,
        imageSrc,
        loading: Boolean(imageSrc),
        failed: false,
        showImage: Boolean(imageSrc),
      });
    },

    handleLoad(event) {
      this.setData({
        loading: false,
        failed: false,
        showImage: true,
      });
      this.triggerEvent("portraitload", {
        src: this.data.imageSrc,
        width: event && event.detail && event.detail.width,
        height: event && event.detail && event.detail.height,
      });
    },

    handleError() {
      this.setData({
        loading: false,
        failed: true,
        showImage: false,
      });
      this.triggerEvent("portraiterror", {
        src: this.data.imageSrc,
        fallbackText: this.data.displayText,
      });
    },
  },
});
