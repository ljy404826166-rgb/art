import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadPrivacyPage({ needAuthorization = false } = {}) {
  const source = readFileSync("miniapp/pages/privacy/privacy.js", "utf8");
  const module = { exports: {} };
  let page = null;
  const contractCalls = [];
  const toasts = [];
  const wxMock = {
    getPrivacySetting(options) {
      options.success({ needAuthorization });
    },
    openPrivacyContract(options) {
      contractCalls.push(options);
      options.success({});
    },
    showToast(options) {
      toasts.push(options);
    },
  };
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      Promise,
      Error,
      wx: wxMock,
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
      filename: "miniapp/pages/privacy/privacy.js",
    },
  );
  return { contractCalls, page, toasts };
}

test("privacy page explains every account data category", () => {
  const template = readFileSync("miniapp/pages/privacy/privacy.wxml", "utf8");
  const script = readFileSync("miniapp/pages/privacy/privacy.js", "utf8");

  assert.match(script, /头像与昵称/);
  assert.match(script, /收藏与关注/);
  assert.match(script, /浏览历史/);
  assert.match(script, /头衔与成就/);
  assert.match(script, /当前佩戴头衔/);
  assert.match(script, /下载记录/);
  assert.match(template, /不读取通讯录、手机号或位置/);
  assert.match(template, /bindtap="openPrivacyContract"/);
});

test("privacy page reads WeChat privacy state and opens the official guide", async () => {
  const { contractCalls, page } = loadPrivacyPage({
    needAuthorization: true,
  });

  await page.onLoad();
  assert.equal(page.data.privacyState.label, "待确认");
  await page.openPrivacyContract();
  assert.equal(contractCalls.length, 1);
  assert.equal(page.data.openingContract, false);
});
