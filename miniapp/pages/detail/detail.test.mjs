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
