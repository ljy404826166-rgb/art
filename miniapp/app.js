const CLOUD_ENV_ID = "cloudbase-d6gvny27ib05e0ede";

App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: false,
      });
      try {
        const { initializeLibrarySync } = require("./services/user-library-sync");
        initializeLibrarySync();
      } catch (error) {
        // Account sync is optional and must never delay public browsing.
      }
    }
  },

  globalData: {
    appName: "Masterpiece",
    appVersion: "0.1.0",
  },
});
