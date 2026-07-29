const cloud = require("wx-server-sdk");
const { createAccountProfileHandler } = require("./lib/account-profile");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const database = cloud.database();
const achievementAdminOpenids = new Set(
  String(process.env.ACHIEVEMENT_ADMIN_OPENIDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

exports.main = createAccountProfileHandler({
  database,
  getContext: () => cloud.getWXContext(),
  serverDate: () => database.serverDate(),
  checkNickname: (content, openid) =>
    cloud.openapi.security.msgSecCheck({
      content,
      version: 2,
      scene: 1,
      openid,
    }),
  deleteFiles: (fileList) => cloud.deleteFile({ fileList }),
  isAchievementAdmin: (openid) => achievementAdminOpenids.has(String(openid || "").trim()),
  logger: console,
});
