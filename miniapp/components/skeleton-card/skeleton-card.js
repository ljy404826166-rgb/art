Component({
  properties: {
    variant: {
      type: String,
      value: "grid",
    },
    count: {
      type: Number,
      value: 4,
    },
  },
  data: {
    items: [],
  },
  observers: {
    count(count) {
      this.setData({ items: Array.from({ length: Number(count || 0) }) });
    },
  },
  lifetimes: {
    attached() {
      this.setData({ items: Array.from({ length: Number(this.properties.count || 0) }) });
    },
  },
});
