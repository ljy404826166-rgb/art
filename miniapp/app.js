App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        traceUser: false,
      });
    }
  },

  globalData: {
    appName: "Art Archive",
  },
});
