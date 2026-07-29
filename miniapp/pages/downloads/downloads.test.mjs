import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadDownloadsPage({ wxMock, libraryMock }) {
  let pageDefinition;
  const source = readFileSync("miniapp/pages/downloads/downloads.js", "utf8");
  vm.runInNewContext(
    source,
    {
      module: { exports: {} },
      exports: {},
      require(request) {
        if (request === "../../services/local-library") {
          return libraryMock;
        }
        throw new Error(`Unexpected require: ${request}`);
      },
      Page(definition) {
        pageDefinition = definition;
      },
      wx: wxMock,
    },
    {
      filename: "miniapp/pages/downloads/downloads.js",
    },
  );
  return pageDefinition;
}

function createPageInstance(definition) {
  return {
    ...definition,
    data: { ...definition.data },
    setData(nextData) {
      this.data = {
        ...this.data,
        ...nextData,
      };
    },
  };
}

test("clearDownloads shows feedback after clearing local records", () => {
  let cleared = false;
  const toasts = [];
  const pageDefinition = loadDownloadsPage({
    wxMock: {
      showModal(options) {
        options.success({ confirm: true });
      },
      showToast(options) {
        toasts.push(options);
      },
    },
    libraryMock: {
      clearDownloadArtworks() {
        cleared = true;
      },
      getDownloadArtworks() {
        return cleared ? [] : [{ id: "a1", titleCn: "Downloaded Artwork" }];
      },
    },
  });
  const page = createPageInstance(pageDefinition);
  page.refreshDownloads();

  page.clearDownloads();

  assert.equal(cleared, true);
  assert.deepEqual(page.data.artworks, []);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].title, "已清空下载记录");
  assert.equal(toasts[0].icon, "none");
});
