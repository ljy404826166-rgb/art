const {
  VIEWPORT_WIDTH_RPX,
  estimateRowMoverWidth,
  getRowArtworkKey,
} = require("./horizontal-artwork-row-geometry");

const ROW_HEIGHT_RPX = 526;

function getWindowWidth() {
  if (typeof wx === "undefined") return 375;
  if (wx.getWindowInfo) return wx.getWindowInfo().windowWidth || 375;
  if (wx.getSystemInfoSync) return wx.getSystemInfoSync().windowWidth || 375;
  return 375;
}

Component({
  properties: {
    items: {
      type: Array,
      value: [],
      observer(items) {
        if (this.shouldResetForItems(items)) {
          this.resetPosition();
        }
        this.updateMoverWidth(items);
      },
    },
    sectionIndex: {
      type: Number,
      value: 0,
    },
    loadingMore: {
      type: Boolean,
      value: false,
      observer() {
        this.updateMoverWidth(this.properties.items);
      },
    },
  },

  data: {
    x: 0,
    moverStyle: `width: ${VIEWPORT_WIDTH_RPX}rpx; height: ${ROW_HEIGHT_RPX}rpx;`,
  },

  lifetimes: {
    attached() {
      this.currentX = 0;
      this.estimatedMoverWidthRpx = VIEWPORT_WIDTH_RPX;
      this.lastDragAt = 0;
      this.lastLowerAt = 0;
      this.touchStartX = 0;
      this.movedDuringTouch = false;
      this.cardWidths = {};
      this.firstItemKey = getRowArtworkKey((this.properties.items || [])[0], 0);
      this.itemCount = (this.properties.items || []).length;
      this.rpxToPx = getWindowWidth() / VIEWPORT_WIDTH_RPX;
    },
  },

  methods: {
    shouldResetForItems(items) {
      const list = items || [];
      const firstItemKey = getRowArtworkKey(list[0], 0);
      const isAppend = Boolean(
        this.firstItemKey
        && firstItemKey
        && firstItemKey === this.firstItemKey
        && list.length >= Number(this.itemCount || 0),
      );

      this.firstItemKey = firstItemKey;
      this.itemCount = list.length;
      if (!isAppend) this.cardWidths = {};
      return !isAppend;
    },

    updateMoverWidth(items) {
      const moverWidthRpx = estimateRowMoverWidth(items, this.cardWidths || {}, {
        loadingMore: this.properties.loadingMore,
      });
      this.estimatedMoverWidthRpx = moverWidthRpx;
      this.setData({
        x: this.currentX || 0,
        moverStyle: `width: ${moverWidthRpx}rpx; height: ${ROW_HEIGHT_RPX}rpx;`,
      });
    },

    resetPosition() {
      this.currentX = 0;
      this.touchStartX = 0;
      this.movedDuringTouch = false;
      this.lastLowerAt = 0;
      this.setData({ x: 0 });
    },

    maybeTriggerLower(x) {
      const now = Date.now();
      const scrollablePx = Math.max(
        0,
        (this.estimatedMoverWidthRpx - VIEWPORT_WIDTH_RPX) * (this.rpxToPx || 0.5),
      );
      if (scrollablePx <= 0) return;
      if (Math.abs(Number(x || 0)) < scrollablePx - 120) return;
      if (now - Number(this.lastLowerAt || 0) < 900) return;

      this.lastLowerAt = now;
      this.triggerEvent("rowtolower", {
        sectionIndex: this.properties.sectionIndex,
      });
    },

    handleTouchStart() {
      this.touchStartX = this.currentX || 0;
      this.movedDuringTouch = false;
    },

    handleMoveChange(event) {
      const detail = event.detail || {};
      const x = Number(detail.x || 0);
      const movedDistance = Math.abs(x - Number(this.touchStartX || 0));
      this.currentX = x;

      if (movedDistance > 8) {
        this.movedDuringTouch = true;
        this.lastDragAt = Date.now();
      }

      this.maybeTriggerLower(x);
    },

    handleTouchEnd() {
      if (this.movedDuringTouch) {
        this.lastDragAt = Date.now();
      }
      this.movedDuringTouch = false;
    },

    handleCardLayoutChange(event) {
      const detail = event.detail || {};
      const dataset = event.currentTarget ? event.currentTarget.dataset || {} : {};
      const index = Number(dataset.index || 0);
      const item = (this.properties.items || [])[index];
      const key = getRowArtworkKey(item, index) || detail.id;
      const cardWidth = Number(detail.cardWidth || 0);
      if (!key || cardWidth <= 0) return;
      if (Math.abs(Number((this.cardWidths || {})[key] || 0) - cardWidth) < 1) return;

      this.cardWidths = {
        ...(this.cardWidths || {}),
        [key]: cardWidth,
      };
      this.updateMoverWidth(this.properties.items);
    },

    handleTapCard(event) {
      if (Date.now() - Number(this.lastDragAt || 0) < 260) return;
      const detail = event.detail || {};
      if (!detail.id) return;
      this.triggerEvent("tapcard", {
        id: detail.id,
        ratio: detail.ratio,
      });
    },
  },
});
