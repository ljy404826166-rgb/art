const {
  shouldResetRowScroll,
} = require("./horizontal-artwork-row-geometry");

Component({
  properties: {
    items: {
      type: Array,
      value: [],
      observer(items, previousItems) {
        if (shouldResetRowScroll(previousItems, items)) {
          this.resetScrollLeft();
        }
      },
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

  data: {
    scrollLeft: 0,
  },

  lifetimes: {
    attached() {
      this.lastLowerAt = 0;
    },
  },

  methods: {
    resetScrollLeft() {
      this.setData({ scrollLeft: 1 }, () => {
        this.setData({ scrollLeft: 0 });
      });
    },

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
