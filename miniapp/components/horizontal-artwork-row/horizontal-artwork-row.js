Component({
  properties: {
    items: {
      type: Array,
      value: [],
    },
    sectionIndex: {
      type: Number,
      value: 0,
    },
    loadingMore: {
      type: Boolean,
      value: false,
    },
  },

  lifetimes: {
    attached() {
      this.lastLowerAt = 0;
    },
  },

  methods: {
    handleRowToLower() {
      const now = Date.now();
      if (now - Number(this.lastLowerAt || 0) < 900) return;

      this.lastLowerAt = now;
      this.triggerEvent("rowtolower", {
        sectionIndex: this.properties.sectionIndex,
      });
    },

    handleTapCard(event) {
      const detail = event.detail || {};
      if (!detail.id) return;
      this.triggerEvent("tapcard", {
        id: detail.id,
        ratio: detail.ratio,
      });
    },
  },
});
