import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadHelpPage() {
  const source = readFileSync("miniapp/pages/help/help.js", "utf8");
  const module = { exports: {} };
  let page = null;
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      String,
      Page(definition) {
        page = {
          ...definition,
          data: JSON.parse(JSON.stringify(definition.data)),
          setData(patch) {
            this.data = { ...this.data, ...patch };
          },
        };
      },
    },
    {
      filename: "miniapp/pages/help/help.js",
    },
  );
  return { helpers: module.exports, page };
}

test("help page provides focused account and content FAQs", () => {
  const { helpers } = loadHelpPage();

  assert.equal(helpers.FAQ_ITEMS.length, 5);
  assert.equal(
    helpers.FAQ_ITEMS.some((item) => /自动同步/.test(item.answer)),
    true,
  );
  assert.equal(
    helpers.FAQ_ITEMS.some((item) => /人工核查/.test(item.answer)),
    true,
  );
  assert.equal(
    helpers.FAQ_ITEMS.some((item) => /“博古通今”头衔/.test(item.answer)),
    true,
  );
});

test("FAQ accordion opens one answer at a time", () => {
  const { page } = loadHelpPage();

  page.toggleFaq({
    currentTarget: { dataset: { id: "image-loading" } },
  });
  assert.equal(page.data.faqs.find((item) => item.id === "image-loading").expanded, true);

  page.toggleFaq({
    currentTarget: { dataset: { id: "downloads" } },
  });
  assert.equal(page.data.faqs.find((item) => item.id === "image-loading").expanded, false);
  assert.equal(page.data.faqs.find((item) => item.id === "downloads").expanded, true);
});

test("FAQ questions stay left-aligned on one line while chevrons stay at the far right", () => {
  const template = readFileSync("miniapp/pages/help/help.wxml", "utf8");
  const styles = readFileSync("miniapp/pages/help/help.wxss", "utf8");

  assert.match(template, /<view\s+class="faq-button"[\s\S]*aria-role="button"/);
  assert.doesNotMatch(template, /<button\s+class="faq-button"/);
  assert.match(template, /<view class="faq-question">\{\{item\.question\}\}<\/view>/);
  assert.match(template, /class="faq-toggle \{\{item\.expanded \? 'is-expanded' : ''\}\}"/);
  assert.match(template, /class="faq-chevron"/);
  assert.doesNotMatch(template, /\{\{item\.expanded \? '−' : '\+'\}\}/);
  assert.match(styles, /\.faq-button\s*\{[\s\S]*display:\s*flex/);
  assert.match(styles, /\.faq-button\s*\{[\s\S]*box-sizing:\s*border-box/);
  assert.match(styles, /\.faq-button\s*\{[\s\S]*justify-content:\s*flex-start/);
  assert.match(styles, /\.faq-question\s*\{[\s\S]*text-align:\s*left/);
  assert.match(styles, /\.faq-question\s*\{[\s\S]*justify-content:\s*flex-start/);
  assert.match(styles, /\.faq-question\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.doesNotMatch(styles, /\.faq-question\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.doesNotMatch(styles, /\.faq-question\s*\{[^}]*overflow-wrap/);
  assert.match(styles, /\.section-title\s*\{[^}]*font-size:\s*36rpx;[^}]*font-weight:\s*600;/s);
  assert.match(
    styles,
    /\.faq-list\s*\{[^}]*border-radius:\s*32rpx;[^}]*box-shadow:\s*0 8rpx 40rpx rgba\(0, 0, 0, 0\.04\);/s,
  );
  assert.match(
    styles,
    /\.faq-button\s*\{[^}]*min-height:\s*120rpx;[^}]*padding:\s*40rpx 48rpx;[^}]*font-size:\s*32rpx;/s,
  );
  assert.match(styles, /\.faq-toggle\s*\{[\s\S]*flex:\s*0 0 48rpx/);
  assert.doesNotMatch(styles, /\.faq-toggle\s*\{[^}]*position:\s*absolute/);
  assert.match(styles, /\.faq-chevron\s*\{[\s\S]*border-right:\s*4rpx solid #bbcbba/);
  assert.match(styles, /\.faq-toggle\.is-expanded \.faq-chevron/);
});

test("feedback uses the native WeChat customer service entry", () => {
  const template = readFileSync("miniapp/pages/help/help.wxml", "utf8");

  assert.match(template, /open-type="contact"/);
  assert.match(template, /session-from="masterpiece_help"/);
  assert.match(template, /客服人员上线后会尽快处理/);
  assert.match(template, /请勿发送身份证、银行卡/);
});
