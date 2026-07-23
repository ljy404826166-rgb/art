const CLOUD_ENV_IDS = {
  production: "cloudbase-d6gvny27ib05e0ede",
  experience: "experience-d2gxlf5bta2349f3e",
};

function resolveCloudEnvId() {
  try {
    const accountInfo = wx.getAccountInfoSync();
    const envVersion = accountInfo
      && accountInfo.miniProgram
      && accountInfo.miniProgram.envVersion;
    if (envVersion === "develop" || envVersion === "trial") {
      return CLOUD_ENV_IDS.experience;
    }
  } catch (error) {
    // Unknown runtimes stay on production rather than risking an accidental
    // experience-environment connection in a released mini program.
  }
  return CLOUD_ENV_IDS.production;
}

App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: resolveCloudEnvId(),
        traceUser: false,
      });
    }
  },

  globalData: {
    appName: "Art Archive",
  },
});
