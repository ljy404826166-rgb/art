import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadLegalDocuments() {
  const source = readFileSync("miniapp/data/legal-documents.js", "utf8");
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      String,
    },
    {
      filename: "miniapp/data/legal-documents.js",
    },
  );
  return module.exports;
}

function loadLegalPage() {
  const documents = loadLegalDocuments();
  const source = readFileSync("miniapp/pages/legal/legal.js", "utf8");
  const module = { exports: {} };
  const navigationTitles = [];
  let page = null;

  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      require(request) {
        if (request === "../../data/legal-documents") return documents;
        throw new Error(`Unexpected require: ${request}`);
      },
      wx: {
        setNavigationBarTitle(options) {
          navigationTitles.push(options);
        },
      },
      Page(definition) {
        page = {
          ...definition,
          data: JSON.parse(JSON.stringify(definition.data)),
          setData(updates) {
            this.data = {
              ...this.data,
              ...JSON.parse(JSON.stringify(updates)),
            };
          },
        };
      },
    },
    {
      filename: "miniapp/pages/legal/legal.js",
    },
  );

  return {
    documents,
    helpers: module.exports,
    navigationTitles,
    page,
  };
}

test("legal catalogue contains four complete, independently readable documents", () => {
  const { documents } = loadLegalPage();
  const catalogue = documents.LEGAL_DOCUMENTS;

  assert.deepEqual(Object.keys(catalogue), ["content", "copyright", "disclaimer", "agreement"]);
  assert.equal(catalogue.content.title, "内容与资料说明");
  assert.equal(catalogue.copyright.title, "版权与来源说明");
  assert.equal(catalogue.disclaimer.title, "免责声明");
  assert.equal(catalogue.agreement.title, "Masterpiece 用户协议");
  assert.ok(Object.values(catalogue).every((document) => document.version === "V1.0"));
  assert.ok(catalogue.content.sections.length >= 6);
  assert.ok(catalogue.copyright.sections.length >= 9);
  assert.ok(catalogue.disclaimer.sections.length >= 10);
  assert.ok(catalogue.agreement.sections.length >= 16);

  const allCopy = Object.values(catalogue)
    .flatMap((document) => document.sections)
    .flatMap((section) => section.paragraphs)
    .join("\n");
  assert.match(allCopy, /个人运营者/);
  assert.doesNotMatch(allCopy, /李嘉宇/);
  assert.match(allCopy, /MasterpieceArt@163\.com/);
  assert.match(allCopy, /18251881993/);
  assert.match(allCopy, /北京市海淀区清华东路35号北京林业大学/);
  assert.match(allCopy, /不排除或限制运营者因故意、重大过失造成损害的责任/);
  assert.match(allCopy, /提供下载能力不表示授予商业使用/);
});

test("legal page selects a requested document and updates the navigation title", () => {
  const { navigationTitles, page } = loadLegalPage();

  const selected = page.onLoad({ document: "copyright" });

  assert.equal(selected.id, "copyright");
  assert.equal(page.data.document.title, "版权与来源说明");
  assert.equal(page.data.sections.length, selected.sections.length);
  assert.equal(navigationTitles[0].title, "版权与来源说明");
});

test("legal page falls back safely for an unknown document id", () => {
  const { page } = loadLegalPage();

  page.onLoad({ document: "not-a-document" });

  assert.equal(page.data.document.id, "content");
  assert.equal(page.data.document.title, "内容与资料说明");
});

test("legal page renders only the source document title, metadata, headings, and paragraphs", () => {
  const template = readFileSync("miniapp/pages/legal/legal.wxml", "utf8");
  const styles = readFileSync("miniapp/pages/legal/legal.wxss", "utf8");

  assert.match(template, /\{\{document\.title\}\}/);
  assert.match(template, /版本：\{\{document\.version\}\}/);
  assert.match(template, /更新日期：\{\{document\.updatedAt\}\}/);
  assert.match(template, /生效日期：\{\{document\.effectiveAt\}\}/);
  assert.match(template, /\{\{section\.index\}\}、\{\{section\.title\}\}/);
  assert.match(template, /user-select="true"/);
  assert.doesNotMatch(
    template,
    /document\.headline|document\.summary|notice-card|section-list|feedback-card|bindtap|<image/,
  );
  assert.doesNotMatch(styles, /border-radius|box-shadow|notice-card|feedback-card/);
  assert.match(
    styles,
    /\.section-paragraph\s*\{[^}]*font-size:\s*28rpx;[^}]*line-height:\s*52rpx;/s,
  );
});
