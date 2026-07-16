import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const serviceDefaults = {
  artworks: {
    fetchArtworkById: async () => null,
    fallbackArtworkById: () => null,
    normalizeError: (error) => String((error && error.message) || error || ""),
  },
  artists: { loadArtistByArtworkText: async () => ({ artist: null }) },
  imageLayout: {
    computeDetailHeroFrameStyle: () => "",
    resolveDetailMeasureSrc: () => "",
  },
  artworkPreview: {
    previewArtwork: async () => ({ url: "display" }),
  },
  downloads: {
    downloadFile: async () => "temp-file",
    getDownloadFailureMessage: () => "下载失败，请重试",
    isAlbumPermissionError: () => false,
    resolveArtworkDownloadUrl: (artwork) => artwork && artwork.download_url,
    saveImageToAlbum: async () => {},
  },
  localLibrary: {
    isFavoriteArtwork: () => false,
    recordDownloadArtwork: () => {},
    recordHistoryArtwork: () => {},
    toggleFavoriteArtwork: () => true,
  },
  networkStatus: {
    getNetworkSnapshot: async () => ({
      isConnected: true,
      networkType: "wifi",
    }),
    isCellularNetwork: (type) => ["2g", "3g", "4g", "5g"].includes(type),
    subscribeNetworkStatus: () => () => {},
  },
  shareRoutes: {
    buildArtworkShareMessage: (artwork) => ({
      title: artwork ? artwork.titleCn : "fallback",
      path: artwork ? `/pages/detail/detail?id=${artwork.id}` : "/pages/home/home",
    }),
  },
};

function loadDetailPage(overrides = {}, wxOverrides = {}) {
  const filename = fileURLToPath(new URL("./detail.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  let page;
  const services = { ...serviceDefaults, ...overrides };
  const localRequire = (id) => {
    if (id === "../../services/artworks") return services.artworks;
    if (id === "../../services/artists") return services.artists;
    if (id === "./detail-image-layout") return services.imageLayout;
    if (id === "../../services/artwork-preview") return services.artworkPreview;
    if (id === "../../services/downloads") return services.downloads;
    if (id === "../../services/local-library") return services.localLibrary;
    if (id === "../../services/network-status") return services.networkStatus;
    if (id === "../../services/share-routes") return services.shareRoutes;
    return require(id);
  };
  const Page = (definition) => {
    page = {
      ...definition,
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(patch) {
        Object.assign(this.data, patch);
      },
    };
  };
  const wx = {
    setNavigationBarTitle() {},
    showToast() {},
    showLoading() {},
    hideLoading() {},
    showModal() {},
    openSetting() {},
    navigateTo() {},
    ...wxOverrides,
  };

  vm.runInNewContext(source, {
    module: { exports: {} },
    exports: {},
    require: localRequire,
    Page,
    wx,
    console,
  }, { filename });
  return page;
}

test("detail exposes a stable artwork share payload", () => {
  const page = loadDetailPage();
  page.data.artwork = { id: "starry-night", titleCn: "星月夜" };

  assert.deepEqual(page.onShareAppMessage(), {
    title: "星月夜",
    path: "/pages/detail/detail?id=starry-night",
  });
});

test("detail preview handler previews the loaded artwork", async () => {
  const calls = [];
  const page = loadDetailPage({
    artworkPreview: {
      previewArtwork: async (artwork) => {
        calls.push(artwork);
        return { url: artwork.display_url };
      },
    },
  });
  page.data.artwork = { id: "starry-night", display_url: "https://img.example/display.webp" };

  await page.previewHeroImage();

  assert.deepEqual(calls, [page.data.artwork]);
});

test("detail blocks original download while offline", async () => {
  let downloadCalls = 0;
  let downloadRecords = 0;
  const toasts = [];
  const page = loadDetailPage({
    networkStatus: {
      ...serviceDefaults.networkStatus,
      getNetworkSnapshot: async () => ({
        isConnected: false,
        networkType: "none",
      }),
    },
    downloads: {
      ...serviceDefaults.downloads,
      downloadFile: async () => {
        downloadCalls += 1;
        return "temp-file";
      },
    },
    localLibrary: {
      ...serviceDefaults.localLibrary,
      recordDownloadArtwork: () => {
        downloadRecords += 1;
      },
    },
  }, {
    showToast(options) {
      toasts.push(options);
    },
  });
  page.data.artwork = {
    id: "artwork",
    download_url: "https://img.example/original.jpg",
  };

  await page.downloadArtwork();

  assert.equal(downloadCalls, 0);
  assert.equal(downloadRecords, 0);
  assert.equal(page.data.downloading, false);
  assert.equal(toasts[0].title, "当前无网络，无法下载原图");
});

test("detail asks before an original download on cellular data", async () => {
  let downloadCalls = 0;
  let downloadRecords = 0;
  const modals = [];
  const page = loadDetailPage({
    networkStatus: {
      ...serviceDefaults.networkStatus,
      getNetworkSnapshot: async () => ({
        isConnected: true,
        networkType: "4g",
      }),
    },
    downloads: {
      ...serviceDefaults.downloads,
      downloadFile: async () => {
        downloadCalls += 1;
        return "temp-file";
      },
    },
    localLibrary: {
      ...serviceDefaults.localLibrary,
      recordDownloadArtwork: () => {
        downloadRecords += 1;
      },
    },
  }, {
    showModal(options) {
      modals.push(options);
      options.success({ confirm: false, cancel: true });
    },
  });
  page.data.artwork = {
    id: "artwork",
    download_url: "https://img.example/original.jpg",
  };

  await page.downloadArtwork();

  assert.equal(modals[0].title, "使用移动网络下载");
  assert.equal(downloadCalls, 0);
  assert.equal(downloadRecords, 0);
  assert.equal(page.data.downloading, false);
});

test("detail admits only one download request while the network guard is pending", async () => {
  let resolveSnapshot;
  let snapshotCalls = 0;
  let downloadCalls = 0;
  const snapshot = new Promise((resolve) => {
    resolveSnapshot = resolve;
  });
  const page = loadDetailPage({
    networkStatus: {
      ...serviceDefaults.networkStatus,
      getNetworkSnapshot: async () => {
        snapshotCalls += 1;
        return snapshot;
      },
    },
    downloads: {
      ...serviceDefaults.downloads,
      downloadFile: async () => {
        downloadCalls += 1;
        return "temp-file";
      },
    },
  });
  page.data.artwork = {
    id: "artwork",
    download_url: "https://img.example/original.jpg",
  };

  const firstDownload = page.downloadArtwork();
  const secondDownload = page.downloadArtwork();

  assert.equal(snapshotCalls, 1);
  resolveSnapshot({ isConnected: true, networkType: "wifi" });
  await Promise.all([firstDownload, secondDownload]);
  assert.equal(downloadCalls, 1);
});

test("detail preserves the completed download flow after the network guard passes", async () => {
  const calls = [];
  const page = loadDetailPage({
    downloads: {
      ...serviceDefaults.downloads,
      downloadFile: async (url) => {
        calls.push(["download", url]);
        return "temp-file";
      },
      saveImageToAlbum: async (path) => {
        calls.push(["save", path]);
      },
    },
    localLibrary: {
      ...serviceDefaults.localLibrary,
      recordDownloadArtwork: (artwork, status) => {
        calls.push(["record", artwork.id, status]);
      },
    },
  }, {
    showLoading() {
      calls.push(["show-loading"]);
    },
    hideLoading() {
      calls.push(["hide-loading"]);
    },
  });
  page.data.artwork = {
    id: "artwork",
    download_url: "https://img.example/original.jpg",
  };

  await page.downloadArtwork();

  assert.deepEqual(calls, [
    ["show-loading"],
    ["download", "https://img.example/original.jpg"],
    ["save", "temp-file"],
    ["record", "artwork", "completed"],
    ["hide-loading"],
  ]);
  assert.equal(page.data.downloading, false);
});

test("detail network monitoring keeps one active subscription and cleans up safely", () => {
  const listeners = [];
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const page = loadDetailPage({
    networkStatus: {
      ...serviceDefaults.networkStatus,
      subscribeNetworkStatus(listener) {
        subscribeCalls += 1;
        listeners.push(listener);
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          unsubscribeCalls += 1;
        };
      },
    },
  });

  page.onShow();
  listeners[0]({ isConnected: false, networkType: "none" });
  assert.deepEqual(page.data.networkState, {
    isConnected: false,
    networkType: "none",
  });

  page.onShow();
  assert.equal(subscribeCalls, 2);
  assert.equal(unsubscribeCalls, 1);

  page.onHide();
  page.onHide();
  page.onUnload();
  assert.equal(unsubscribeCalls, 2);
});

const previewFailureMessages = [
  ["unsupported", "当前微信版本不支持预览"],
  ["offline", "网络连接异常，请稍后重试"],
  ["permission-denied", "暂无图片预览权限"],
  ["remote-failed", "图片预览失败，请稍后重试"],
  ["invalid-data", "暂无可预览图片"],
  ["unknown", "图片预览失败"],
];

for (const [code, expectedTitle] of previewFailureMessages) {
  test(`detail preview handler maps ${code} to a localized message`, async () => {
    const toasts = [];
    const page = loadDetailPage({
      artworkPreview: {
        previewArtwork: async () => {
          const error = new Error("previewImage:fail native error");
          error.code = code;
          throw error;
        },
      },
    }, {
      showToast(options) {
        toasts.push(options);
      },
    });
    page.data.artwork = { id: "starry-night", display_url: "https://img.example/display.webp" };

    await page.previewHeroImage();

    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].title, expectedTitle);
    assert.equal(toasts[0].icon, "none");
    assert.notEqual(toasts[0].title, "previewImage:fail native error");
  });
}
