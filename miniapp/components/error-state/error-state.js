Component({
  properties: {
    title: {
      type: String,
      value: "读取失败",
    },
    message: {
      type: String,
      value: "",
    },
    retryText: {
      type: String,
      value: "重试",
    },
    showRetry: {
      type: Boolean,
      value: true,
    },
    icon: {
      type: String,
      value: "/assets/icons/lucide/svg/circle-alert.svg",
    },
  },
  methods: {
    handleRetry() {
      this.triggerEvent("retry");
    },
  },
});
