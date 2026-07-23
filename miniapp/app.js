const CLOUD_ENV_ID = "cloudbase-d6gvny27ib05e0ede";

App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: false,
      });
    }
  },

  globalData: {
    appName: "Art Archive",
  },
});
