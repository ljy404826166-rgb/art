import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadAboutPage() {
  const source = readFileSync("miniapp/pages/about/about.js", "utf8");
  const module = { exports: {} };
  const navigations = [];
  let page = null;
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      String,
      wx: {
        navigateTo(options) {
          navigations.push(options);
        },
      },
      getApp() {
        return {
          globalData: {
            appName: "Masterpiece",
            appVersion: "0.1.0",
          },
        };
      },
      Page(definition) {
        page = {
          ...definition,
          data: JSON.parse(JSON.stringify(definition.data)),
        };
      },
    },
    {
      filename: "miniapp/pages/about/about.js",
    },
  );
  return { helpers: module.exports, navigations, page };
}

test("about page reads the shared Masterpiece name and version", () => {
  const { page } = loadAboutPage();

  assert.equal(page.data.app.name, "Masterpiece");
  assert.equal(page.data.app.version, "0.1.0");
  assert.equal(typeof page.data.app.year, "number");
  assert.equal(page.data.legalItems.length, 4);
});

test("about page shows legal documents and the compact email contact card", () => {
  const { page } = loadAboutPage();
  const template = readFileSync("miniapp/pages/about/about.wxml", "utf8");
  const styles = readFileSync("miniapp/pages/about/about.wxss", "utf8");

  assert.match(template, /class="brand-name">\{\{app\.name\}\}<\/text>/);
  assert.match(template, /传世杰作/);
  assert.match(template, /class="mission-card"/);
  assert.match(template, /bindtap="openLegalDocument"/);
  assert.deepEqual(
    Array.from(page.data.legalItems, (item) => item.title),
    ["内容与资料说明", "版权与来源说明", "免责声明", "用户协议"],
  );
  assert.match(template, /class="contact-card"/);
  assert.match(template, /MasterpieceArt@163\.com/);
  assert.doesNotMatch(template, /contact-details|contact-row/);
  assert.doesNotMatch(template, /LEGAL &amp; INFORMATION|条款与说明|section-heading/);
  assert.doesNotMatch(template, /legal-icon|legal-description|item\.description|item\.icon/);
  assert.match(template, /不构成鉴定、估值、交易、投资、法律或其他专业建议/);
  assert.match(styles, /\.about-page\s*\{[^}]*padding:\s*32rpx 48rpx/s);
  assert.match(styles, /\.brand-name\s*\{[^}]*font-size:\s*72rpx;[^}]*font-weight:\s*800;/s);
  assert.match(styles, /\.mission-card\s*\{[^}]*border-radius:\s*32rpx;[^}]*padding:\s*48rpx;/s);
  assert.match(styles, /\.legal-row\s*\{[^}]*min-height:\s*112rpx;[^}]*align-items:\s*center;/s);
  assert.doesNotMatch(styles, /\.legal-icon|\.legal-description|\.section-heading/);
  assert.match(styles, /\.contact-card\s*\{[^}]*border-radius:\s*16rpx;[^}]*padding:\s*40rpx;/s);
});

test("about page routes each legal option to the shared document reader", () => {
  const { navigations, page } = loadAboutPage();

  page.openLegalDocument({
    currentTarget: { dataset: { id: "copyright" } },
  });
  page.openLegalDocument({
    currentTarget: { dataset: { id: "unknown" } },
  });

  assert.equal(navigations[0].url, "/pages/legal/legal?document=copyright");
  assert.equal(navigations.length, 1);
});
