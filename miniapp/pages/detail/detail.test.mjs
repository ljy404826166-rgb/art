import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJsModule(filename) {
  const module = { exports: {} };
  const source = readFileSync(filename, "utf8");
  vm.runInNewContext(source, { module, exports: module.exports }, { filename });
  return module.exports;
}

const shareRoutes = loadCommonJsModule(
  fileURLToPath(new URL("../../services/share-routes.js", import.meta.url)),
);

function loadRealArtworkFallbackService() {
  const fallbackArtworks = loadCommonJsModule(
    fileURLToPath(new URL("../../data/fallback-artworks.js", import.meta.url)),
  );
  const searchEngine = loadCommonJsModule(
    fileURLToPath(new URL("../../services/search-engine.js", import.meta.url)),
  );
  const filename = fileURLToPath(new URL("../../services/artworks.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  const localRequire = (id) => {
    if (id === "../data/fallback-artworks") return fallbackArtworks;
    if (id === "./search-engine") return searchEngine;
    return require(id);
  };

  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: localRequire,
  }, { filename });
  return module.exports;
}

const realArtworkFallbackService = loadRealArtworkFallbackService();

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

function loadDownloadGuardPage(networkStatus, showModal) {
  const calls = {
    downloadFile: 0,
    saveImageToAlbum: 0,
    recordDownloadArtwork: 0,
    showLoading: 0,
    hideLoading: 0,
    successToast: 0,
  };
  const modals = [];
  const toasts = [];
  const page = loadDetailPage({
    networkStatus: {
      ...serviceDefaults.networkStatus,
      ...networkStatus,
    },
    downloads: {
      ...serviceDefaults.downloads,
      downloadFile: async () => {
        calls.downloadFile += 1;
        return "temp-file";
      },
      saveImageToAlbum: async () => {
        calls.saveImageToAlbum += 1;
      },
    },
    localLibrary: {
      ...serviceDefaults.localLibrary,
      recordDownloadArtwork: () => {
        calls.recordDownloadArtwork += 1;
      },
    },
  }, {
    showLoading() {
      calls.showLoading += 1;
    },
    hideLoading() {
      calls.hideLoading += 1;
    },
    showToast(options) {
      toasts.push(options);
      if (options.icon === "success") calls.successToast += 1;
    },
    showModal(options) {
      modals.push(options);
      showModal(options);
    },
  });
  page.data.artwork = {
    id: "artwork",
    download_url: "https://img.example/original.jpg",
  };
  return { calls, modals, page, toasts };
}

test("detail exposes a stable artwork share payload", () => {
  const page = loadDetailPage();
  page.data.artwork = { id: "starry-night", titleCn: "星月夜" };

  assert.deepEqual(page.onShareAppMessage(), {
    title: "星月夜",
    path: "/pages/detail/detail?id=starry-night",
  });
});

test("detail shares its decoded route id before the artwork finishes loading", async () => {
  const originalId = "artwork/梵高%2Fstudy";
  const message = shareRoutes.buildArtworkShareMessage({
    id: originalId,
    titleCn: "星月夜",
  });
  const rawRouteId = message.path.split("id=")[1];
  const lookupIds = [];
  let markLookupStarted;
  const lookupStarted = new Promise((resolve) => {
    markLookupStarted = resolve;
  });
  const page = loadDetailPage({
    artworks: {
      ...serviceDefaults.artworks,
      fetchArtworkById: async (id) => {
        lookupIds.push(id);
        markLookupStarted();
        return new Promise(() => {});
      },
    },
    shareRoutes,
  });

  page.onLoad({ id: rawRouteId });
  const loadingShare = page.onShareAppMessage();
  await lookupStarted;

  assert.equal(page.data.currentId, originalId);
  assert.deepEqual(lookupIds, [originalId]);
  assert.equal(loadingShare.path, message.path);
  assert.notEqual(loadingShare.path, "/pages/home/home");
});

test("detail missing encoded share target stays recoverable without unrelated artwork or history", async () => {
  const requestedId = "missing/梵高/study";
  const encodedId = encodeURIComponent(requestedId);
  const history = [];
  const page = loadDetailPage({
    artworks: {
      ...realArtworkFallbackService,
      fetchArtworkById: async () => {
        throw new Error("remote artwork unavailable");
      },
    },
    localLibrary: {
      ...serviceDefaults.localLibrary,
      recordHistoryArtwork: (artwork) => {
        history.push(artwork);
      },
    },
    shareRoutes,
  });

  page.onLoad({ id: encodedId });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(page.data.currentId, requestedId);
  assert.equal(page.data.artwork, null);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.usingFallback, false);
  assert.equal(page.data.error, "作品详情加载失败，请稍后重试");
  assert.doesNotMatch(page.data.error, /remote artwork unavailable/);
  assert.deepEqual(history, []);
  assert.equal(
    page.onShareAppMessage().path,
    `/pages/detail/detail?id=${encodeURIComponent(requestedId)}`,
  );
  assert.notEqual(page.onShareAppMessage().path, "/pages/home/home");
});

test("detail treats a missing remote record as a localized recoverable error", async () => {
  const page = loadDetailPage({
    artworks: {
      ...serviceDefaults.artworks,
      fetchArtworkById: async () => null,
    },
  });

  await page.loadArtwork("missing-cloud-record");

  assert.equal(page.data.currentId, "missing-cloud-record");
  assert.equal(page.data.artwork, null);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.usingFallback, false);
  assert.equal(page.data.error, "作品详情加载失败，请稍后重试");
});

test("detail preserves a known exact fallback without replacing the requested share target", async () => {
  const requestedId = "artwork_starry_night";
  const fallbackArtwork = realArtworkFallbackService.fallbackArtworkById(requestedId);
  const history = [];
  const page = loadDetailPage({
    artworks: {
      ...realArtworkFallbackService,
      fetchArtworkById: async () => {
        throw new Error("cloud database unavailable");
      },
    },
    localLibrary: {
      ...serviceDefaults.localLibrary,
      recordHistoryArtwork: (artwork) => {
        history.push(artwork);
      },
    },
    shareRoutes,
  });

  await page.loadArtwork(requestedId);

  assert.equal(page.data.artwork._id, fallbackArtwork._id);
  assert.equal(page.data.usingFallback, true);
  assert.equal(page.data.error, "作品详情加载失败，请稍后重试");
  assert.deepEqual(history, [fallbackArtwork]);
  assert.equal(
    page.onShareAppMessage().path,
    `/pages/detail/detail?id=${encodeURIComponent(requestedId)}`,
  );
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

test("detail initial load fast-fails offline without cloud or fallback reads", async () => {
  let fetchCalls = 0;
  let fallbackCalls = 0;
  const page = loadDetailPage({
    artworks: {
      ...serviceDefaults.artworks,
      fetchArtworkById: async () => {
        fetchCalls += 1;
        return null;
      },
      fallbackArtworkById: () => {
        fallbackCalls += 1;
        return null;
      },
    },
    networkStatus: {
      ...serviceDefaults.networkStatus,
      getNetworkSnapshot: async () => ({
        isConnected: false,
        networkType: "none",
      }),
    },
  });

  await page.loadArtwork("offline-artwork");

  assert.equal(fetchCalls, 0);
  assert.equal(fallbackCalls, 0);
  assert.equal(page.data.artwork, null);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.usingFallback, false);
  assert.equal(page.data.error, "当前无网络，请连接网络后重试");
  assert.deepEqual(page.data.networkState, {
    isConnected: false,
    networkType: "none",
  });
});

test("detail offline retry preserves loaded content and skips cloud and fallback reads", async () => {
  let fetchCalls = 0;
  let fallbackCalls = 0;
  const existingArtwork = {
    id: "loaded-artwork",
    titleCn: "已加载作品",
  };
  const page = loadDetailPage({
    artworks: {
      ...serviceDefaults.artworks,
      fetchArtworkById: async () => {
        fetchCalls += 1;
        return null;
      },
      fallbackArtworkById: () => {
        fallbackCalls += 1;
        return null;
      },
    },
    networkStatus: {
      ...serviceDefaults.networkStatus,
      getNetworkSnapshot: async () => ({
        isConnected: false,
        networkType: "none",
      }),
    },
  });
  page.data.currentId = existingArtwork.id;
  page.data.artwork = existingArtwork;

  await page.retryLoad();

  assert.equal(fetchCalls, 0);
  assert.equal(fallbackCalls, 0);
  assert.equal(page.data.artwork, existingArtwork);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, "当前无网络，请连接网络后重试");
});

test("detail network recovery waits for an explicit retry before loading", async () => {
  let listener;
  let snapshotCalls = 0;
  let fetchCalls = 0;
  const loadedArtwork = {
    id: "recoverable-artwork",
    titleCn: "恢复后的作品",
  };
  const page = loadDetailPage({
    artworks: {
      ...serviceDefaults.artworks,
      fetchArtworkById: async () => {
        fetchCalls += 1;
        return loadedArtwork;
      },
    },
    networkStatus: {
      ...serviceDefaults.networkStatus,
      getNetworkSnapshot: async () => {
        snapshotCalls += 1;
        return snapshotCalls === 1
          ? { isConnected: false, networkType: "none" }
          : { isConnected: true, networkType: "wifi" };
      },
      subscribeNetworkStatus(nextListener) {
        listener = nextListener;
        return () => {};
      },
    },
  });

  await page.loadArtwork(loadedArtwork.id);
  page.onShow();
  listener({ isConnected: true, networkType: "wifi" });
  await Promise.resolve();

  assert.equal(fetchCalls, 0);
  assert.equal(page.data.artwork, null);

  await page.retryLoad();

  assert.equal(fetchCalls, 1);
  assert.equal(page.data.artwork, loadedArtwork);
  assert.equal(page.data.error, "");
});

test("detail ignores a stale load snapshot after a newer live offline event", async () => {
  let listener;
  let resolveSnapshot;
  let fetchCalls = 0;
  const existingArtwork = {
    id: "preserved-artwork",
    titleCn: "已加载作品",
  };
  const snapshot = new Promise((resolve) => {
    resolveSnapshot = resolve;
  });
  const page = loadDetailPage({
    artworks: {
      ...serviceDefaults.artworks,
      fetchArtworkById: async () => {
        fetchCalls += 1;
        return {
          id: "stale-network-result",
          titleCn: "不应加载",
        };
      },
    },
    networkStatus: {
      ...serviceDefaults.networkStatus,
      getNetworkSnapshot: async () => snapshot,
      subscribeNetworkStatus(nextListener) {
        listener = nextListener;
        return () => {};
      },
    },
  });
  page.data.artwork = existingArtwork;
  page.onShow();

  const loadPromise = page.loadArtwork(existingArtwork.id);
  listener({ isConnected: false, networkType: "none" });
  await Promise.resolve();

  assert.equal(fetchCalls, 0);
  resolveSnapshot({ isConnected: true, networkType: "wifi" });
  await loadPromise;

  assert.equal(fetchCalls, 0);
  assert.equal(page.data.artwork, existingArtwork);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.usingFallback, false);
  assert.equal(page.data.error, "当前无网络，请连接网络后重试");
  assert.deepEqual(page.data.networkState, {
    isConnected: false,
    networkType: "none",
  });
});

test("detail keeps a newer live offline state when the pending load probe rejects", async () => {
  let listener;
  let rejectSnapshot;
  let fetchCalls = 0;
  const snapshot = new Promise((resolve, reject) => {
    rejectSnapshot = reject;
  });
  const page = loadDetailPage({
    artworks: {
      ...serviceDefaults.artworks,
      fetchArtworkById: async () => {
        fetchCalls += 1;
        return null;
      },
    },
    networkStatus: {
      ...serviceDefaults.networkStatus,
      getNetworkSnapshot: async () => snapshot,
      subscribeNetworkStatus(nextListener) {
        listener = nextListener;
        return () => {};
      },
    },
  });
  page.onShow();

  const loadPromise = page.loadArtwork("offline-after-probe-failure");
  listener({ isConnected: false, networkType: "none" });
  rejectSnapshot(new Error("getNetworkType:fail"));
  await loadPromise;

  assert.equal(fetchCalls, 0);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, "当前无网络，请连接网络后重试");
  assert.deepEqual(page.data.networkState, {
    isConnected: false,
    networkType: "none",
  });
});

test("detail continues normal loading when the network probe is unknown or fails", async () => {
  for (const getNetworkSnapshot of [
    async () => ({ isConnected: true, networkType: "unknown" }),
    async () => {
      throw new Error("getNetworkType:fail");
    },
  ]) {
    let fetchCalls = 0;
    const page = loadDetailPage({
      artworks: {
        ...serviceDefaults.artworks,
        fetchArtworkById: async (id) => {
          fetchCalls += 1;
          return { id, titleCn: "兼容加载" };
        },
      },
      networkStatus: {
        ...serviceDefaults.networkStatus,
        getNetworkSnapshot,
      },
    });

    await page.loadArtwork("compatible-artwork");

    assert.equal(fetchCalls, 1);
    assert.equal(page.data.artwork.id, "compatible-artwork");
    assert.equal(page.data.loading, false);
  }
});

test("detail blocks original download while offline", async () => {
  const { calls, page, toasts } = loadDownloadGuardPage({
    getNetworkSnapshot: async () => ({
      isConnected: false,
      networkType: "none",
    }),
  }, () => {
    throw new Error("offline download must not show a confirmation");
  });

  await page.downloadArtwork();

  assert.equal(calls.downloadFile, 0);
  assert.equal(calls.saveImageToAlbum, 0);
  assert.equal(calls.recordDownloadArtwork, 0);
  assert.equal(calls.showLoading, 0);
  assert.equal(calls.hideLoading, 0);
  assert.equal(calls.successToast, 0);
  assert.equal(page.data.downloading, false);
  assert.equal(toasts[0].title, "当前无网络，无法下载原图");
});

test("detail keeps a newer live offline state when a pending download probe resolves Wi-Fi", async () => {
  let listener;
  let resolveSnapshot;
  let snapshotCalls = 0;
  const snapshot = new Promise((resolve) => {
    resolveSnapshot = resolve;
  });
  const { calls, modals, page } = loadDownloadGuardPage({
    getNetworkSnapshot: async () => {
      snapshotCalls += 1;
      if (snapshotCalls === 1) return snapshot;
      return {
        isConnected: false,
        networkType: "none",
      };
    },
    subscribeNetworkStatus(nextListener) {
      listener = nextListener;
      return () => {};
    },
  }, (options) => {
    options.success({ confirm: false, cancel: true });
  });
  page.onShow();

  const firstDownload = page.downloadArtwork();
  listener({ isConnected: false, networkType: "none" });
  resolveSnapshot({ isConnected: true, networkType: "wifi" });
  await firstDownload;

  assert.deepEqual(page.data.networkState, {
    isConnected: false,
    networkType: "none",
  });
  assert.equal(modals.length, 0);
  assert.equal(calls.downloadFile, 0);
  assert.equal(calls.saveImageToAlbum, 0);
  assert.equal(calls.recordDownloadArtwork, 0);
  assert.equal(calls.showLoading, 0);
  assert.equal(calls.hideLoading, 0);
  assert.equal(calls.successToast, 0);
  assert.equal(page.data.downloading, false);
  assert.equal(page.downloadRequestPending, false);

  await page.downloadArtwork();
  assert.equal(snapshotCalls, 2);
});

test("detail keeps a newer live offline state when a pending download probe rejects", async () => {
  let listener;
  let rejectSnapshot;
  let snapshotCalls = 0;
  const snapshot = new Promise((resolve, reject) => {
    rejectSnapshot = reject;
  });
  const { calls, modals, page } = loadDownloadGuardPage({
    getNetworkSnapshot: async () => {
      snapshotCalls += 1;
      if (snapshotCalls === 1) return snapshot;
      return {
        isConnected: false,
        networkType: "none",
      };
    },
    subscribeNetworkStatus(nextListener) {
      listener = nextListener;
      return () => {};
    },
  }, (options) => {
    options.success({ confirm: false, cancel: true });
  });
  page.onShow();

  const firstDownload = page.downloadArtwork();
  listener({ isConnected: false, networkType: "none" });
  rejectSnapshot(new Error("getNetworkType:fail"));
  await firstDownload;

  assert.deepEqual(page.data.networkState, {
    isConnected: false,
    networkType: "none",
  });
  assert.equal(modals.length, 0);
  assert.equal(calls.downloadFile, 0);
  assert.equal(calls.saveImageToAlbum, 0);
  assert.equal(calls.recordDownloadArtwork, 0);
  assert.equal(calls.showLoading, 0);
  assert.equal(calls.hideLoading, 0);
  assert.equal(calls.successToast, 0);
  assert.equal(page.data.downloading, false);
  assert.equal(page.downloadRequestPending, false);

  await page.downloadArtwork();
  assert.equal(snapshotCalls, 2);
});

test("detail asks before an original download on cellular data", async () => {
  const { calls, modals, page } = loadDownloadGuardPage({
    getNetworkSnapshot: async () => ({
      isConnected: true,
      networkType: "4g",
    }),
  }, (options) => {
    options.success({ confirm: false, cancel: true });
  });

  await page.downloadArtwork();

  assert.match(modals[0].content, /继续下载可能消耗流量/);
  assert.equal(calls.downloadFile, 0);
  assert.equal(calls.saveImageToAlbum, 0);
  assert.equal(calls.recordDownloadArtwork, 0);
  assert.equal(calls.showLoading, 0);
  assert.equal(calls.hideLoading, 0);
  assert.equal(calls.successToast, 0);
  assert.equal(page.data.downloading, false);
});

test("detail asks before downloading when the network type is unknown", async () => {
  const { calls, modals, page } = loadDownloadGuardPage({
    getNetworkSnapshot: async () => ({
      isConnected: true,
      networkType: "unknown",
    }),
  }, (options) => {
    options.success({ confirm: false, cancel: true });
  });

  await page.downloadArtwork();

  assert.equal(modals.length, 1);
  assert.match(modals[0].content, /继续下载可能消耗流量/);
  assert.equal(calls.downloadFile, 0);
  assert.equal(calls.saveImageToAlbum, 0);
  assert.equal(calls.recordDownloadArtwork, 0);
  assert.equal(calls.showLoading, 0);
  assert.equal(calls.hideLoading, 0);
  assert.equal(calls.successToast, 0);
  assert.equal(page.data.downloading, false);
});

test("detail asks before downloading when the network snapshot rejects", async () => {
  const { calls, modals, page } = loadDownloadGuardPage({
    getNetworkSnapshot: async () => {
      throw new Error("getNetworkType:fail");
    },
  }, (options) => {
    options.success({ confirm: false, cancel: true });
  });
  page.data.networkState = {
    isConnected: true,
    networkType: "wifi",
  };

  await page.downloadArtwork();

  assert.equal(modals.length, 1);
  assert.match(modals[0].content, /继续下载可能消耗流量/);
  assert.equal(page.data.networkState.isConnected, true);
  assert.equal(page.data.networkState.networkType, "unknown");
  assert.equal(calls.downloadFile, 0);
  assert.equal(calls.saveImageToAlbum, 0);
  assert.equal(calls.recordDownloadArtwork, 0);
  assert.equal(calls.showLoading, 0);
  assert.equal(calls.hideLoading, 0);
  assert.equal(calls.successToast, 0);
  assert.equal(page.data.downloading, false);
});

test("detail stops without side effects when the download confirmation modal fails", async () => {
  const { calls, modals, page } = loadDownloadGuardPage({
    getNetworkSnapshot: async () => ({
      isConnected: true,
      networkType: "4g",
    }),
  }, (options) => {
    options.fail(new Error("showModal:fail"));
  });

  await page.downloadArtwork();

  assert.equal(modals.length, 1);
  assert.match(modals[0].content, /继续下载可能消耗流量/);
  assert.equal(calls.downloadFile, 0);
  assert.equal(calls.saveImageToAlbum, 0);
  assert.equal(calls.recordDownloadArtwork, 0);
  assert.equal(calls.showLoading, 0);
  assert.equal(calls.hideLoading, 0);
  assert.equal(calls.successToast, 0);
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
