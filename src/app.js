import { fetchPaintingById, fetchPaintingsPage } from "./lib/paintings.ts";
import { registerSW } from "virtual:pwa-register";
import {
  readAppSettings,
  resetAppSettings,
  saveAppSettings,
  updateAppSettings,
} from "./lib/app-settings.ts";
import {
  friendlyAuthError,
  getCurrentSession,
  getCurrentUserSummary,
  signInWithEmailPassword,
  signOutCurrentSession,
  signUpWithEmailPassword,
  subscribeAuthState,
  userSummaryFromUser,
} from "./lib/auth.ts";
import {
  readRemoteUserProfile,
  saveRemoteUserProfile,
} from "./lib/remote-user-profile.ts";
import {
  readRemoteUserSettings,
  saveRemoteUserSettings,
} from "./lib/user-settings.ts";
import {
  initialsFromName,
  profileLimits,
  readUserProfile,
  saveUserProfile,
} from "./lib/user-profile.ts";
import {
  clearLocalDownloads,
  clearLocalFavorites,
  clearLocalHistory,
  localFavoriteIds,
  localHistoryIds,
  recordRemoteHistory,
  saveLocalFavoriteIds,
  saveLocalHistoryIds,
  syncFavorite,
} from "./lib/user-library.ts";
import { searchArtworks } from "./lib/artwork-search.ts";

const ROW_BATCH_SIZE = 8;
const TAG_BATCH_SIZE = 8;
const HOME_PAGE_SIZE = 80;
const CATEGORY_PAGE_SIZE = 40;
const SEARCH_PAGE_SIZE = 40;
const SEARCH_DEBOUNCE_MS = 300;
const RECOMMENDATION_IMAGE_HEIGHT = 172;
const imageRatioCacheKey = "artArchive:imageRatios";
const downloadStorageKey = "artArchive:downloads";
const MOTION_PAGE_ENTER_MS = 220;
const MOTION_PRESS_MS = 120;
const MOTION_PANEL_EXIT_MS = 260;
const MOTION_TOAST_HOLD_MS = 1400;

const state = {
  paintings: [],
  activeView: "home",
  activeCategory: "",
  activeCategoryGroup: "",
  expandedCategoryGroups: new Set(),
  activeProfilePanel: "favorites",
  categoryQuery: "",
  query: "",
  settings: readAppSettings(),
  profile: readUserProfile(),
  profileDraft: null,
  profileSaving: false,
  profileMessage: "",
  profileError: "",
  auth: {
    loaded: false,
    loading: false,
    user: null,
    session: null,
    error: "",
  },
  authForm: {
    mode: "login",
    email: "",
    password: "",
    confirmPassword: "",
    loading: false,
    message: "",
    error: "",
  },
  remoteProfile: {
    loaded: false,
    loading: false,
    unavailable: false,
    error: "",
  },
  remoteSettings: {
    loaded: false,
    loading: false,
    error: "",
  },
  authSummary: null,
  authLoaded: false,
  routeMessage: "",
  favorites: new Set(localFavoriteIds()),
  history: localHistoryIds(),
  downloads: readLocalDownloadRecords(),
  downloadError: "",
  loading: true,
  loadingMorePaintings: false,
  error: "",
  catalogSource: "network",
  catalogOffline: false,
  catalogCachedAt: "",
  paintingsNextFrom: null,
  paintingsHasMore: false,
  paintingsTotalCount: null,
  searchVisibleCount: SEARCH_PAGE_SIZE,
  categoryResults: {
    key: "",
    items: [],
    nextFrom: null,
    hasMore: false,
    totalCount: null,
    loading: false,
    loadingMore: false,
    error: "",
  },
  visibleTagCount: TAG_BATCH_SIZE,
  rowLimits: new Map(),
  recommendationIds: [],
  tagOrder: [],
  homeScrollY: 0,
  pullStartY: 0,
  pullDistance: 0,
  pulling: false,
  pullRefreshing: false,
  categoryInitialized: false,
};

function mountProfileShell() {
  const profileView = document.querySelector("#meView");
  if (!profileView) return;

  profileView.innerHTML = `
    <section class="profile-identity" aria-label="个人信息">
      <div class="profile-avatar" id="profileAvatar" aria-hidden="true"></div>
      <div class="profile-identity-copy">
        <h1 id="profileDisplayName"></h1>
        <p id="profileDisplayEmail"></p>
        <small id="profileBio"></small>
      </div>
      <div class="profile-identity-actions">
        <button class="profile-edit-button" id="profileEditButton" type="button">编辑资料</button>
        <button class="profile-edit-button profile-auth-button" id="profileAuthButton" type="button"></button>
      </div>
    </section>

    <section class="profile-stats" aria-label="个人数据">
      <button class="profile-stat-card" id="showFavoriteButton" type="button" data-profile-panel="favorites">
        <strong id="favoriteCount">0</strong>
        <span>我的收藏</span>
      </button>
      <button class="profile-stat-card" type="button" data-profile-panel="history">
        <strong id="profileHistoryCount">0</strong>
        <span>浏览历史</span>
      </button>
    </section>

    <section class="profile-menu-card" aria-label="内容管理">
      <button class="profile-menu-row" type="button" data-profile-panel="history">
        <span class="profile-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 8v5l3 2" /><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v5h5" /></svg></span>
        <span>浏览历史</span>
        <svg class="profile-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
      </button>
      <button class="profile-menu-row" type="button" data-profile-panel="favorites">
        <span class="profile-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8Z" /></svg></span>
        <span>我的收藏</span>
        <svg class="profile-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
      </button>
      <button class="profile-menu-row" type="button" data-profile-panel="downloads">
        <span class="profile-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg></span>
        <span>下载管理</span>
        <small id="profileDownloadCount">0</small>
        <svg class="profile-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
      </button>
    </section>

    <section class="profile-menu-card" aria-label="账号设置">
      <button class="profile-menu-row" type="button" data-profile-panel="profile">
        <span class="profile-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M5 20c.7-3.5 3.4-5.6 7-5.6s6.3 2.1 7 5.6" /></svg></span>
        <span>个人资料</span>
        <svg class="profile-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
      </button>
      <button class="profile-menu-row" type="button" data-profile-panel="security">
        <span class="profile-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 2.9 8.6 7 10 4.1-1.4 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></svg></span>
        <span>安全中心</span>
        <svg class="profile-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
      </button>
      <button class="profile-menu-row" id="profileRefreshButton" type="button" data-profile-panel="settings">
        <span class="profile-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.8 1.8 0 0 0-1-1.6 1.8 1.8 0 0 0-2 .4l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.8 1.8 0 0 0 1.6-1 1.8 1.8 0 0 0-.4-2l-.1-.1A2 2 0 0 1 7 4l.1.1a1.8 1.8 0 0 0 2 .4 1.8 1.8 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.8 1.8 0 0 0 1 1.6 1.8 1.8 0 0 0 2-.4l.1-.1A2 2 0 0 1 20 7l-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.6 1h.1a2 2 0 0 1 0 4h-.1a1.8 1.8 0 0 0-1.7 1Z" /></svg></span>
        <span>设置</span>
        <svg class="profile-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
      </button>
    </section>

    <button class="profile-logout" id="profileLogoutButton" type="button">退出登录</button>
    <p class="profile-version" id="librarySourceText">VERSION 0.1.0 · ACADEMIC ARCHIVE</p>
    <span id="libraryCount" hidden>0</span>

    <section class="profile-dynamic-section" id="profileDynamicSection" aria-live="polite">
      <div class="profile-dynamic-heading">
        <h2 id="profilePanelTitle">我的收藏</h2>
        <p id="profilePanelMeta">0件作品</p>
      </div>
      <div class="category-results-grid profile-collection-grid" id="favoriteGrid"></div>
    </section>
  `;

  if (!document.querySelector("#profileRouteDrawer")) {
    document.querySelector("#app")?.insertAdjacentHTML(
      "beforeend",
      `
        <aside class="profile-route-drawer" id="profileRouteDrawer" aria-hidden="true" data-mounted="false" aria-labelledby="profileRouteTitle">
          <article class="profile-route-card">
            <header class="detail-topbar profile-route-topbar">
              <button class="detail-icon-button" id="profileRouteClose" type="button" aria-label="返回我的">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 18L9 12L15 6" /></svg>
              </button>
              <strong class="detail-brand" id="profileRouteTitle">我的</strong>
              <span class="profile-route-spacer" aria-hidden="true"></span>
            </header>
            <main class="profile-route-main" id="profileRouteMain"></main>
          </article>
        </aside>
      `,
    );
  }
}

mountProfileShell();

const nodes = {
  topbar: document.querySelector(".topbar"),
  topbarMark: document.querySelector(".topbar-mark"),
  screenKicker: document.querySelector(".screen-kicker"),
  screenTitle: document.querySelector(".screen-title"),
  screenSubtitle: document.querySelector(".screen-subtitle"),
  navItems: [...document.querySelectorAll("[data-view-target]")],
  viewSections: [...document.querySelectorAll("[data-view-section]")],
  grid: document.querySelector("#galleryGrid"),
  categoryGrid: document.querySelector("#categoryGrid"),
  categoryResults: document.querySelector("#categoryResults"),
  categoryResultTitle: document.querySelector("#categoryResultTitle"),
  categoryResultEyebrow: document.querySelector("#categoryResultEyebrow"),
  categorySearch: document.querySelector("#categorySearchInput"),
  favoriteGrid: document.querySelector("#favoriteGrid"),
  profileAvatar: document.querySelector("#profileAvatar"),
  profileDisplayName: document.querySelector("#profileDisplayName"),
  profileDisplayEmail: document.querySelector("#profileDisplayEmail"),
  profileBio: document.querySelector("#profileBio"),
  profileEdit: document.querySelector("#profileEditButton"),
  profileAuth: document.querySelector("#profileAuthButton"),
  favoriteCount: document.querySelector("#favoriteCount"),
  historyCount: document.querySelector("#profileHistoryCount"),
  downloadCount: document.querySelector("#profileDownloadCount"),
  profilePanelTitle: document.querySelector("#profilePanelTitle"),
  profilePanelMeta: document.querySelector("#profilePanelMeta"),
  profilePanelButtons: [...document.querySelectorAll("[data-profile-panel]")],
  profileLogout: document.querySelector("#profileLogoutButton"),
  profileRoute: document.querySelector("#profileRouteDrawer"),
  profileRouteClose: document.querySelector("#profileRouteClose"),
  profileRouteTitle: document.querySelector("#profileRouteTitle"),
  profileRouteMain: document.querySelector("#profileRouteMain"),
  libraryCount: document.querySelector("#libraryCount"),
  librarySourceText: document.querySelector("#librarySourceText"),
  search: document.querySelector("#searchInput"),
  status: document.querySelector("#statusBand"),
  toastRegion: document.querySelector("#motionToastRegion"),
  pullRefresh: document.querySelector("#pullRefreshIndicator"),
  refresh: document.querySelector("#refreshButton"),
  profileRefresh: document.querySelector("#profileRefreshButton"),
  quickFavorite: document.querySelector("#favoritesButton"),
  showFavorite: document.querySelector("#showFavoriteButton"),
  install: document.querySelector("#installButton"),
  drawer: document.querySelector("#detailDrawer"),
  drawerClose: document.querySelector("#drawerClose"),
  detailViewerFrame: document.querySelector("#detailViewerFrame"),
  detailIiifViewer: document.querySelector("#detailIiifViewer"),
  drawerImage: document.querySelector("#drawerImage"),
  detailDownload: document.querySelector("#detailDownloadButton"),
  detailFavorite: document.querySelector("#detailFavoriteButton"),
  detailTitleCn: document.querySelector("#detailTitleCn"),
  detailTitleEn: document.querySelector("#detailTitleEn"),
  detailCreator: document.querySelector("#detailCreator"),
  detailLocation: document.querySelector("#detailLocation"),
  detailCreated: document.querySelector("#detailCreated"),
  detailMedium: document.querySelector("#detailMedium"),
  detailDimensions: document.querySelector("#detailDimensions"),
  detailDescription: document.querySelector("#detailDescription"),
  detailTags: document.querySelector("#detailTags"),
};

let deferredInstallPrompt;
let currentDetailItem = null;
let detailCloseTimer;
let detailViewer = null;
let openSeadragonModulePromise = null;
let profileRouteCloseTimer;
let toastTimer;
let searchDebounceTimer;
let categorySearchDebounceTimer;
let categoryInfiniteObserver;

const topbarViews = {
  home: {
    kicker: "ART ARCHIVE",
    title: "画廊",
    subtitle: "今日馆藏",
    mark: `<svg viewBox="0 0 24 24"><path d="M5 19V7.5L12 4l7 3.5V19" /><path d="M8.5 19v-7h7v7" /></svg>`,
    showFavorite: true,
  },
  categories: {
    kicker: "CURATION",
    title: "分类",
    subtitle: "按主题与年代筛选",
    mark: `<svg viewBox="0 0 24 24"><path d="M5 5h6v6H5V5Z" /><path d="M13 5h6v6h-6V5Z" /><path d="M5 13h6v6H5v-6Z" /><path d="M13 13h6v6h-6v-6Z" /></svg>`,
    showFavorite: false,
  },
  me: {
    kicker: "PRIVATE ROOM",
    title: "我的",
    subtitle: "收藏与账户",
    mark: `<svg viewBox="0 0 24 24"><path d="M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M5 20c.7-3.5 3.4-5.6 7-5.6s6.3 2.1 7 5.6" /></svg>`,
    showFavorite: false,
  },
};

function updateTopbar(view) {
  const config = topbarViews[view] || topbarViews.home;
  if (nodes.topbar) nodes.topbar.dataset.activeView = view;
  if (nodes.topbarMark) nodes.topbarMark.innerHTML = config.mark;
  if (nodes.screenKicker) nodes.screenKicker.textContent = config.kicker;
  if (nodes.screenTitle) nodes.screenTitle.textContent = config.title;
  if (nodes.screenSubtitle) nodes.screenSubtitle.textContent = config.subtitle;
  if (nodes.quickFavorite) nodes.quickFavorite.hidden = !config.showFavorite;
  if (nodes.install) nodes.install.hidden = view !== "home" || !deferredInstallPrompt;
}

function applyAppSettings() {
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.fontSize = state.settings.fontSize;
  document.documentElement.dataset.motion = state.settings.motion;
}

applyAppSettings();

function parseTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
  return String(value || "")
    .split(/[,，;；、\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function yearFrom(value) {
  const match = String(value || "").match(/\d{3,4}/);
  return match ? match[0] : "未知年代";
}

function readImageRatioCache() {
  try {
    return JSON.parse(localStorage.getItem(imageRatioCacheKey) || "{}");
  } catch {
    return {};
  }
}

function writeImageRatioCache(cache) {
  localStorage.setItem(imageRatioCacheKey, JSON.stringify(cache));
}

function ratioFromDimensions(value) {
  const text = String(value || "")
    .replace(/,/g, "")
    .replace(/[×xX]/g, " x ");
  const numbers = text.match(/\d+(?:\.\d+)?/g)?.map(Number).filter((number) => Number.isFinite(number));
  if (!numbers || numbers.length < 2) return 0;

  const [width, height] = numbers;
  if (width <= 0 || height <= 0) return 0;
  return width / height;
}

function cardWidthFromRatio(ratio) {
  if (!ratio || !Number.isFinite(ratio)) return 113;
  return Math.max(72, Math.round(ratio * RECOMMENDATION_IMAGE_HEIGHT));
}

function shuffle(list) {
  const result = [...list];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function paintingToArtwork(painting) {
  const tags = parseTags(painting.tags);
  const title = painting.title_cn || painting.title_en || "未命名作品";
  const movement = tags[0] || "馆藏作品";

  return {
    id: painting.id,
    title,
    titleCn: painting.title_cn || title,
    titleEn: painting.title_en || "",
    artist: painting.artist || "未知艺术家",
    year: yearFrom(painting.year_and_place),
    place: painting.location || "Supabase",
    location: painting.location || "未知收藏地",
    yearAndPlace: painting.year_and_place || "年代与地点暂未收录",
    movement,
    medium: painting.medium || "材质暂未收录",
    dimensions: painting.dimensions || "尺寸暂未收录",
    thumbnailUrl: painting.thumbnail_url || painting.display_url || "",
    displayUrl: painting.display_url || painting.thumbnail_url || "",
    downloadUrl: painting.download_url || "",
    iiifUrl: painting.iiif_url || "",
    detailLoaded: Boolean(painting.description || painting.location || painting.medium || painting.download_url || painting.iiif_url),
    sourceName: "Supabase paintings",
    sourceUrl: "#",
    description: painting.description || "这条作品资料来自 Supabase 的 paintings 表，详细解读内容仍在完善。",
    whyItMatters: painting.description || "这条作品资料来自 Supabase 的 paintings 表。",
    studyNotes: [
      painting.title_en ? `英文名：${painting.title_en}` : "",
      painting.year_and_place ? `年代与地点：${painting.year_and_place}` : "",
      painting.medium ? `媒介：${painting.medium}` : "",
      painting.dimensions ? `尺寸：${painting.dimensions}` : "",
      painting.location ? `馆藏/来源：${painting.location}` : "",
      tags.length ? `标签：${tags.join("、")}` : "",
    ].filter(Boolean),
    tags: [...new Set(tags)],
  };
}

function artworks() {
  return state.paintings.map(paintingToArtwork);
}

function saveFavorites() {
  saveLocalFavoriteIds([...state.favorites]);
}

function saveHistory() {
  saveLocalHistoryIds(state.history);
}

function normalizeDownloadRecord(record) {
  if (!record || typeof record !== "object") return null;
  const artworkId = String(record.artworkId || record.id || "").trim();
  if (!artworkId) return null;
  const now = new Date().toISOString();
  const rawStatus = String(record.status || "").trim();
  const status = {
    pending: "queued",
    queued: "queued",
    started: "downloading",
    downloading: "downloading",
    completed: "completed",
    failed: "failed",
  }[rawStatus] || "queued";
  const downloadedBytes = Math.max(0, Number(record.downloadedBytes || record.size || 0) || 0);
  const totalBytes = Math.max(0, Number(record.totalBytes || 0) || 0);
  return {
    id: artworkId,
    artworkId,
    title: String(record.title || "未命名作品"),
    thumbnailUrl: String(record.thumbnailUrl || ""),
    sourceUrl: String(record.sourceUrl || record.downloadUrl || ""),
    status,
    downloadedBytes,
    totalBytes,
    createdAt: String(record.createdAt || record.downloadedAt || now),
    updatedAt: String(record.updatedAt || record.downloadedAt || now),
    downloadedAt: record.downloadedAt ? String(record.downloadedAt) : "",
    errorMessage: record.errorMessage || record.error ? String(record.errorMessage || record.error) : "",
  };
}

function readLocalDownloadRecords(options = {}) {
  try {
    const records = JSON.parse(localStorage.getItem(downloadStorageKey) || "[]");
    if (!Array.isArray(records)) return [];
    return records.map(normalizeDownloadRecord).filter(Boolean);
  } catch (error) {
    console.error("Download records read failed", error);
    if (options.throwOnError) throw error;
    return [];
  }
}

function saveLocalDownloadRecords(records) {
  const normalized = Array.isArray(records) ? records.map(normalizeDownloadRecord).filter(Boolean) : [];
  localStorage.setItem(downloadStorageKey, JSON.stringify(normalized));
  state.downloads = normalized;
  state.downloadError = "";
  return normalized;
}

function reloadLocalDownloadRecords() {
  try {
    state.downloadError = "";
    state.downloads = readLocalDownloadRecords({ throwOnError: true });
  } catch (error) {
    console.error("Download records reload failed", error);
    state.downloads = [];
    state.downloadError = error instanceof Error ? error.message : "unknown";
  }
}

function downloadUrlForItem(item) {
  const url = String(item?.downloadUrl || "").trim();
  return url && url !== "#" ? url : "";
}

function safeDownloadFilename(item) {
  const title = String(item?.titleCn || item?.title || "artwork")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${title || "artwork"}.jpg`;
}

function upsertDownloadRecord(item, patch = {}) {
  const now = new Date().toISOString();
  const artworkId = String(item?.id || patch.artworkId || "").trim();
  if (!artworkId) return null;

  const existing = state.downloads.find((record) => record.artworkId === artworkId);
  const record = normalizeDownloadRecord({
    ...existing,
    id: artworkId,
    artworkId,
    title: item?.titleCn || item?.title || existing?.title || "未命名作品",
    thumbnailUrl: thumbnailImageUrl(item) || existing?.thumbnailUrl || "",
    sourceUrl: downloadUrlForItem(item),
    status: patch.status || "queued",
    downloadedBytes: patch.downloadedBytes ?? existing?.downloadedBytes ?? 0,
    totalBytes: patch.totalBytes ?? existing?.totalBytes ?? 0,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    downloadedAt: patch.downloadedAt ?? existing?.downloadedAt ?? "",
    errorMessage: patch.errorMessage || "",
  });
  if (!record) return null;

  saveLocalDownloadRecords([record, ...state.downloads.filter((itemRecord) => itemRecord.artworkId !== artworkId)]);
  return record;
}

function updateDownloadRecordStatus(artworkId, patch) {
  const now = new Date().toISOString();
  const records = state.downloads.map((record) =>
    record.artworkId === artworkId
      ? normalizeDownloadRecord({ ...record, ...patch, updatedAt: now })
      : record,
  );
  saveLocalDownloadRecords(records);
}

function triggerBrowserDownload(url, filename) {
  if (!url) throw new Error("missing-url");

  // Web can only ask the browser to download/open the file. It cannot guarantee saving to the OS photo library.
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.target = "_blank";
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function updateDownloadProgress(artworkId, downloadedBytes, totalBytes) {
  updateDownloadRecordStatus(artworkId, {
    status: "downloading",
    downloadedBytes,
    totalBytes,
    errorMessage: "",
  });
}

async function fetchBlobWithProgress(record) {
  const response = await fetch(record.sourceUrl);
  if (!response.ok) throw new Error(`http-${response.status}`);

  const totalBytes = Number(response.headers.get("content-length") || 0) || 0;
  const contentType = response.headers.get("content-type") || "application/octet-stream";

  if (!response.body?.getReader) {
    const blob = await response.blob();
    return {
      blob,
      downloadedBytes: blob.size,
      totalBytes: totalBytes || blob.size,
    };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let downloadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    downloadedBytes += value.byteLength;
    updateDownloadProgress(record.artworkId, downloadedBytes, totalBytes);
  }

  return {
    blob: new Blob(chunks, { type: contentType }),
    downloadedBytes,
    totalBytes: totalBytes || downloadedBytes,
  };
}

async function downloadRecordFile(record, filename) {
  if (!record?.sourceUrl) throw new Error("missing-url");

  updateDownloadProgress(record.artworkId, 0, record.totalBytes || 0);

  try {
    const { blob, downloadedBytes, totalBytes } = await fetchBlobWithProgress(record);
    const objectUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(objectUrl, filename);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    updateDownloadRecordStatus(record.artworkId, {
      status: "completed",
      downloadedBytes,
      totalBytes,
      downloadedAt: new Date().toISOString(),
      errorMessage: "",
    });
  } catch (error) {
    // If CORS or Content-Length prevents streaming, fall back to the browser's own download handling.
    // This can show an indeterminate "下载中" state because Web pages cannot observe the final file write.
    try {
      triggerBrowserDownload(record.sourceUrl, filename);
      updateDownloadRecordStatus(record.artworkId, {
        status: "downloading",
        downloadedBytes: 0,
        totalBytes: 0,
        errorMessage: error instanceof Error ? error.message : "浏览器正在处理下载",
      });
    } catch (fallbackError) {
      updateDownloadRecordStatus(record.artworkId, {
        status: "failed",
        errorMessage:
          fallbackError instanceof Error && fallbackError.message === "missing-url" ? "暂无可下载图源" : "下载未能启动",
      });
      throw fallbackError;
    }
  }
}

function recordHistory(id) {
  if (!id) return;
  state.history = [id, ...state.history.filter((itemId) => itemId !== id)].slice(0, 50);
  saveHistory();
  recordRemoteHistory(id).catch((error) => {
    console.warn("History sync failed", error);
  });
  if (state.activeView === "me") renderProfile();
}

function setStatus(message, tone = "info") {
  nodes.status.textContent = message;
  nodes.status.dataset.tone = tone;
  nodes.status.hidden = !message;
}

function cachedStatusMessage(result) {
  if (!result || result.source !== "cache") return "";
  if (result.offline) return "当前离线，已显示上次可用数据";
  return "网络暂不可用，已显示缓存数据";
}

function animateViewEntry(view) {
  const section = nodes.viewSections.find((item) => item.dataset.viewSection === view);
  if (!section) return;
  section.classList.remove("motion-page-enter");
  void section.offsetWidth;
  section.classList.add("motion-page-enter");
  window.setTimeout(() => section.classList.remove("motion-page-enter"), MOTION_PAGE_ENTER_MS + 60);
}

function showMotionToast(message, tone = "info") {
  if (!nodes.toastRegion || !message) return;
  window.clearTimeout(toastTimer);
  nodes.toastRegion.innerHTML = "";
  const toast = document.createElement("div");
  toast.className = "motion-toast";
  toast.dataset.tone = tone;
  toast.textContent = message;
  nodes.toastRegion.append(toast);
  toastTimer = window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 180);
  }, MOTION_TOAST_HOLD_MS);
}

async function handleDetailDownload() {
  if (!currentDetailItem) return;
  const existed = state.downloads.some((record) => record.artworkId === currentDetailItem.id);
  const record = upsertDownloadRecord(currentDetailItem, { status: "queued" });
  if (!record) return;

  showMotionToast(existed ? "已在下载列表" : "已加入下载列表", "success");
  renderProfile();

  try {
    await downloadRecordFile(record, safeDownloadFilename(currentDetailItem));
  } catch (error) {
    showMotionToast(error instanceof Error && error.message === "missing-url" ? "暂无可下载图源" : "下载未能启动", "error");
  }

  renderProfile();
}

function addPressFeedback(target) {
  const pressable = target.closest?.("button, a");
  if (!pressable || pressable.disabled) return;
  pressable.classList.add("motion-pressing");
  window.setTimeout(() => pressable.classList.remove("motion-pressing"), MOTION_PRESS_MS);
}

function filteredArtworks() {
  return searchArtworks(artworks(), state.query);
}

function resetCategoryResults() {
  state.categoryResults = {
    key: "",
    items: [],
    nextFrom: null,
    hasMore: false,
    totalCount: null,
    loading: false,
    loadingMore: false,
    error: "",
  };
}

function categoryResultKey(tag) {
  return String(tag || "__all__");
}

function favoriteArtworks() {
  return artworks().filter((item) => state.favorites.has(item.id));
}

function historyArtworks() {
  const byId = new Map(artworks().map((item) => [item.id, item]));
  return state.history.map((id) => byId.get(id)).filter(Boolean);
}

function setProfilePanel(panel) {
  state.activeProfilePanel = panel;
  renderProfile();
}

function checkedText(value) {
  return value ? "开启" : "关闭";
}

function settingSelected(current, value) {
  return current === value ? "true" : "false";
}

function profileStatusBadge(text, tone = "neutral") {
  return `<span class="profile-status-badge" data-tone="${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}

function isLoggedIn() {
  return Boolean(state.auth.user || state.authSummary);
}

function setAuthState(session, user) {
  state.auth.session = session || null;
  state.auth.user = user || session?.user || null;
  state.authSummary = userSummaryFromUser(state.auth.user);
  state.authLoaded = true;
  state.auth.loaded = true;
  state.auth.loading = false;
  state.auth.error = "";
}

function clearAccountScopedState() {
  state.auth.session = null;
  state.auth.user = null;
  state.authSummary = null;
  state.authLoaded = true;
  state.auth.loaded = true;
  state.auth.loading = false;
  state.remoteProfile = { loaded: false, loading: false, unavailable: false, error: "" };
  state.remoteSettings = { loaded: false, loading: false, error: "" };
  state.profile = readUserProfile();
  state.profileDraft = null;
  state.settings = readAppSettings();
  applyAppSettings();
}

function accountShortId() {
  const id = state.authSummary?.id || state.auth.user?.id || "";
  return id ? `${id.slice(0, 8)}...` : "未登录";
}

async function loadRemoteProfileForUser(userId) {
  state.remoteProfile.loading = true;
  state.remoteProfile.error = "";
  const result = await readRemoteUserProfile(userId);
  state.remoteProfile.loading = false;
  state.remoteProfile.loaded = true;
  state.remoteProfile.unavailable = result.unavailable;
  state.remoteProfile.error = result.error;

  if (result.profile) {
    const localProfile = readUserProfile();
    state.profile = saveUserProfile({
      ...localProfile,
      ...result.profile,
      emailDisplay: localProfile.emailDisplay || state.authSummary?.email || "",
      avatarDataUrl: localProfile.avatarDataUrl,
      avatarInitials: result.profile.avatarInitials || localProfile.avatarInitials,
    });
    state.profileDraft = null;
  }
}

async function loadRemoteSettingsForUser(userId) {
  state.remoteSettings.loading = true;
  state.remoteSettings.error = "";
  const result = await readRemoteUserSettings(userId);
  state.remoteSettings.loading = false;
  state.remoteSettings.loaded = true;
  state.remoteSettings.error = result.error;

  if (result.settings) {
    state.settings = saveAppSettings(result.settings);
    applyAppSettings();
  }
}

async function loadAccountDataAfterSignIn() {
  const userId = state.authSummary?.id || state.auth.user?.id;
  if (!userId) return;
  await Promise.allSettled([
    loadRemoteProfileForUser(userId),
    loadRemoteSettingsForUser(userId),
  ]);
  renderProfile();
  rerenderActiveProfileRoute();
}

async function initializeAuthState() {
  state.auth.loading = true;
  state.auth.loaded = false;
  state.authLoaded = false;
  renderProfile();
  try {
    const { session, user } = await getCurrentSession();
    setAuthState(session, user);
    if (user) await loadAccountDataAfterSignIn();
  } catch (error) {
    console.error("Auth session restore failed", error);
    clearAccountScopedState();
    state.auth.error = friendlyAuthError(error, "账号状态读取失败");
  } finally {
    state.auth.loading = false;
    state.auth.loaded = true;
    state.authLoaded = true;
    renderProfile();
    rerenderActiveProfileRoute();
  }
}

function startAuthSubscription() {
  return subscribeAuthState((event, session) => {
    window.setTimeout(() => {
      if (event === "SIGNED_OUT") {
        clearAccountScopedState();
        state.routeMessage = "已退出登录。";
        renderProfile();
        rerenderActiveProfileRoute();
        return;
      }

      setAuthState(session, session?.user || null);
      if (session?.user) {
        loadAccountDataAfterSignIn().catch((error) => {
          console.error("Account data reload failed", error);
        });
      } else {
        renderProfile();
        rerenderActiveProfileRoute();
      }
    }, 0);
  });
}

function profileDisplayEmail() {
  if (!isLoggedIn()) return "未登录";
  return state.authSummary?.email || state.profile.emailDisplay || "未绑定邮箱";
}

function profileAvatarMarkup(profile = state.profile) {
  if (profile.avatarDataUrl) {
    return `<img src="${escapeHtml(profile.avatarDataUrl)}" alt="" />`;
  }
  return escapeHtml(profile.avatarInitials || initialsFromName(profile.displayName));
}

function renderProfileIdentity() {
  if (nodes.profileAvatar) nodes.profileAvatar.innerHTML = profileAvatarMarkup();
  if (nodes.profileDisplayName) nodes.profileDisplayName.textContent = state.profile.displayName;
  if (nodes.profileDisplayEmail) nodes.profileDisplayEmail.textContent = profileDisplayEmail();
  if (nodes.profileBio) {
    if (state.auth.loading && !state.auth.loaded) {
      nodes.profileBio.textContent = "正在读取账号状态...";
    } else {
      nodes.profileBio.textContent = state.profile.bio || (isLoggedIn() ? "还没有个人简介" : "登录后可同步资料和设置");
    }
  }
  if (nodes.profileAuth) {
    nodes.profileAuth.textContent = isLoggedIn() ? "账号已登录" : "登录 / 注册";
    nodes.profileAuth.dataset.authenticated = String(isLoggedIn());
  }
  if (nodes.profileLogout) {
    nodes.profileLogout.textContent = isLoggedIn() ? "退出登录" : "登录 / 注册";
  }
}

function startProfileDraft() {
  state.profileDraft = { ...state.profile };
  state.profileMessage = "";
  state.profileError = "";
}

function currentProfileDraft() {
  if (!state.profileDraft) startProfileDraft();
  return state.profileDraft;
}

function validateProfileDraft(profile) {
  const errors = [];
  const displayName = profile.displayName.trim();
  if (!displayName) errors.push("昵称不能为空");
  if (displayName.length > profileLimits.displayNameMax) errors.push(`昵称不能超过 ${profileLimits.displayNameMax} 个字符`);
  if (profile.bio.length > profileLimits.bioMax) errors.push(`简介不能超过 ${profileLimits.bioMax} 个字符`);
  if (profile.location.length > profileLimits.locationMax) errors.push(`所在地不能超过 ${profileLimits.locationMax} 个字符`);
  if (profile.website.length > profileLimits.websiteMax) errors.push(`网站不能超过 ${profileLimits.websiteMax} 个字符`);
  if (profile.website && !/^https?:\/\/\S+\.\S+/.test(profile.website)) {
    errors.push("网站需要以 http:// 或 https:// 开头");
  }
  return errors;
}

function authRouteHtml() {
  const isRegister = state.authForm.mode === "register";
  const title = isRegister ? "注册账号" : "登录账号";
  const subtitle = isRegister ? "创建账号后可同步资料和设置。" : "登录后恢复你的云端资料和偏好。";
  const message = state.authForm.message
    ? `<div class="profile-route-message" data-tone="success">${escapeHtml(state.authForm.message)}</div>`
    : "";
  const error = state.authForm.error
    ? `<div class="profile-route-message" data-tone="error">${escapeHtml(state.authForm.error)}</div>`
    : "";

  return `
    <section class="profile-route-page auth-route">
      <section class="profile-route-hero">
        <p>账号系统</p>
        <h1>${title}</h1>
        <div>${subtitle}</div>
      </section>

      ${message}
      ${error}

      <section class="profile-setting-group auth-form-card">
        <h2>${isRegister ? "创建账号" : "邮箱登录"}</h2>
        <label class="profile-form-field">
          <span>邮箱</span>
          <input id="authEmailInput" type="email" autocomplete="email" value="${escapeHtml(state.authForm.email)}" />
        </label>
        <label class="profile-form-field">
          <span>密码</span>
          <input id="authPasswordInput" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" value="${escapeHtml(state.authForm.password)}" />
        </label>
        ${isRegister ? `
          <label class="profile-form-field">
            <span>确认密码</span>
            <input id="authConfirmPasswordInput" type="password" autocomplete="new-password" value="${escapeHtml(state.authForm.confirmPassword)}" />
          </label>
        ` : ""}
      </section>

      <div class="profile-save-bar auth-action-bar">
        <button class="profile-edit-action profile-edit-action-secondary" type="button" data-auth-action="toggleMode">${isRegister ? "已有账号，去登录" : "创建账号"}</button>
        <button class="profile-edit-action profile-edit-action-primary" type="button" data-auth-action="submit" ${state.authForm.loading ? "disabled" : ""}>${state.authForm.loading ? (isRegister ? "注册中..." : "登录中...") : title}</button>
      </div>
    </section>
  `;
}

function renderAuthRoute(mode = state.authForm.mode) {
  state.authForm.mode = mode;
  nodes.profileRoute.dataset.activeRoute = "auth";
  nodes.profileRouteTitle.textContent = state.authForm.mode === "register" ? "注册账号" : "登录账号";
  nodes.profileRouteMain.innerHTML = authRouteHtml();
  bindAuthRouteEvents();
}

function syncAuthFormFromRoute() {
  state.authForm.email = document.querySelector("#authEmailInput")?.value.trim() || "";
  state.authForm.password = document.querySelector("#authPasswordInput")?.value || "";
  state.authForm.confirmPassword = document.querySelector("#authConfirmPasswordInput")?.value || "";
}

function validateAuthForm() {
  const email = state.authForm.email.trim();
  if (!email) return "请输入邮箱";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "请输入有效邮箱";
  if (!state.authForm.password) return "请输入密码";
  if (state.authForm.mode === "register" && state.authForm.password.length < 8) return "密码至少需要 8 位";
  if (state.authForm.mode === "register" && state.authForm.password !== state.authForm.confirmPassword) {
    return "两次输入的密码不一致";
  }
  return "";
}

async function handleAuthSubmit() {
  syncAuthFormFromRoute();
  const validationError = validateAuthForm();
  if (validationError) {
    state.authForm.error = validationError;
    state.authForm.message = "";
    renderAuthRoute();
    return;
  }

  state.authForm.loading = true;
  state.authForm.error = "";
  state.authForm.message = "";
  renderAuthRoute();

  try {
    const result = state.authForm.mode === "register"
      ? await signUpWithEmailPassword(state.authForm.email, state.authForm.password)
      : await signInWithEmailPassword(state.authForm.email, state.authForm.password);
    state.authForm.message = result.message || "登录成功";
    state.authForm.password = "";
    state.authForm.confirmPassword = "";
    if (result.session) {
      setAuthState(result.session, result.user);
      await loadAccountDataAfterSignIn();
      closeProfileRoute();
      setView("me");
    } else {
      state.authForm.mode = "login";
      renderAuthRoute("login");
    }
  } catch (error) {
    console.error("Auth submit failed", error);
    state.authForm.error = friendlyAuthError(error, state.authForm.mode === "register" ? "注册失败，请稍后重试" : "登录失败，请检查邮箱和密码");
  } finally {
    state.authForm.loading = false;
    renderProfile();
    if (nodes.profileRoute?.dataset.activeRoute === "auth") renderAuthRoute();
  }
}

function bindAuthRouteEvents() {
  nodes.profileRouteMain.querySelector("[data-auth-action='toggleMode']")?.addEventListener("click", () => {
    syncAuthFormFromRoute();
    state.authForm.mode = state.authForm.mode === "register" ? "login" : "register";
    state.authForm.error = "";
    state.authForm.message = "";
    state.authForm.password = "";
    state.authForm.confirmPassword = "";
    renderAuthRoute();
  });

  nodes.profileRouteMain.querySelector("[data-auth-action='submit']")?.addEventListener("click", handleAuthSubmit);
  nodes.profileRouteMain.querySelectorAll("input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") handleAuthSubmit();
    });
  });
}

function profileRouteHtml() {
  const profile = currentProfileDraft();
  const authLabel = state.authLoaded ? (state.authSummary ? "已登录" : "未登录") : "读取中";
  const syncCopy = state.authSummary
    ? "当前资料先保存在本机；云端同步将在后续阶段开启。"
    : "当前未登录，请先登录后再同步资料；本次编辑仅保存在本机。";
  const message = state.profileMessage
    ? `<div class="profile-route-message" data-tone="success">${escapeHtml(state.profileMessage)}</div>`
    : "";
  const error = state.profileError
    ? `<div class="profile-route-message" data-tone="error">${escapeHtml(state.profileError)}</div>`
    : "";

  return `
    <section class="profile-route-page profile-edit-route">
      <section class="profile-route-hero">
        <p>个人中心</p>
        <h1>个人资料</h1>
        <div>${escapeHtml(syncCopy)}</div>
      </section>

      ${message}
      ${error}

      <section class="profile-setting-group">
        <h2>头像</h2>
        <div class="profile-avatar-editor">
          <div class="profile-avatar profile-avatar-preview" id="profileAvatarPreview">${profileAvatarMarkup(profile)}</div>
          <div class="profile-avatar-actions">
            <label class="profile-edit-action profile-edit-action-primary">
              <span>选择图片</span>
              <input id="profileAvatarInput" type="file" accept="image/png,image/jpeg,image/webp" />
            </label>
            <button class="profile-edit-action profile-edit-action-secondary" type="button" data-profile-edit-action="removeAvatar">移除头像</button>
          </div>
        </div>
        <p class="profile-form-help">支持 JPG、PNG、WebP，最大 1MB。当前只做本地预览，不上传云端。</p>
      </section>

      <section class="profile-setting-group">
        <h2>基础资料</h2>
        <label class="profile-form-field">
          <span>昵称</span>
          <input id="profileDisplayNameInput" type="text" maxlength="${profileLimits.displayNameMax}" value="${escapeHtml(profile.displayName)}" />
        </label>
        <label class="profile-form-field">
          <span>个人简介</span>
          <textarea id="profileBioInput" maxlength="${profileLimits.bioMax}">${escapeHtml(profile.bio)}</textarea>
        </label>
        <label class="profile-form-field">
          <span>所在地</span>
          <input id="profileLocationInput" type="text" maxlength="${profileLimits.locationMax}" value="${escapeHtml(profile.location)}" />
        </label>
        <label class="profile-form-field">
          <span>个人网站</span>
          <input id="profileWebsiteInput" type="url" maxlength="${profileLimits.websiteMax}" value="${escapeHtml(profile.website)}" placeholder="https://example.com" />
        </label>
        <label class="profile-form-field">
          <span>邮箱展示</span>
          <input id="profileEmailDisplayInput" type="text" maxlength="${profileLimits.emailDisplayMax}" value="${escapeHtml(profile.emailDisplay)}" />
        </label>
      </section>

      <section class="profile-setting-group">
        <h2>账号状态</h2>
        <div class="profile-setting-row"><div><strong>登录状态</strong><span>${escapeHtml(authLabel)}</span></div>${profileStatusBadge(authLabel, state.authSummary ? "ok" : "muted")}</div>
        <div class="profile-setting-row"><div><strong>Auth 邮箱</strong><span>${accountValue(state.authSummary?.email)}</span></div>${profileStatusBadge(state.authSummary?.email ? "来自 Auth" : "未配置", state.authSummary?.email ? "ok" : "muted")}</div>
      </section>

      <div class="profile-save-bar">
        <button class="profile-edit-action profile-edit-action-secondary" type="button" data-profile-edit-action="cancel">取消</button>
        <button class="profile-edit-action profile-edit-action-primary" type="button" data-profile-edit-action="save" ${state.profileSaving ? "disabled" : ""}>${state.profileSaving ? "保存中..." : "保存资料"}</button>
      </div>
    </section>
  `;
}

function renderProfileEditRoute() {
  nodes.profileRouteTitle.textContent = "个人资料";
  nodes.profileRoute.dataset.activeRoute = "profile";
  nodes.profileRouteMain.innerHTML = profileRouteHtml();
  bindProfileEditRouteEvents();
}

function syncProfileDraftFromForm() {
  const draft = currentProfileDraft();
  draft.displayName = document.querySelector("#profileDisplayNameInput")?.value.trim() || "";
  draft.bio = document.querySelector("#profileBioInput")?.value.trim() || "";
  draft.location = document.querySelector("#profileLocationInput")?.value.trim() || "";
  draft.website = document.querySelector("#profileWebsiteInput")?.value.trim() || "";
  draft.emailDisplay = document.querySelector("#profileEmailDisplayInput")?.value.trim() || "";
  draft.avatarInitials = initialsFromName(draft.displayName);
}

function handleProfileAvatarFile(file) {
  if (!file) return;
  if (!profileLimits.avatarMimeTypes.includes(file.type)) {
    state.profileError = "头像仅支持 JPG、PNG 或 WebP";
    state.profileMessage = "";
    renderProfileEditRoute();
    return;
  }
  if (file.size > profileLimits.avatarMaxBytes) {
    state.profileError = "头像文件不能超过 1MB";
    state.profileMessage = "";
    renderProfileEditRoute();
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    currentProfileDraft().avatarDataUrl = String(reader.result || "");
    currentProfileDraft().avatarUrl = "";
    state.profileError = "";
    state.profileMessage = "";
    renderProfileEditRoute();
  });
  reader.addEventListener("error", () => {
    state.profileError = "头像读取失败，请重新选择";
    state.profileMessage = "";
    renderProfileEditRoute();
  });
  reader.readAsDataURL(file);
}

async function saveProfileDraft() {
  syncProfileDraftFromForm();
  const draft = currentProfileDraft();
  const errors = validateProfileDraft(draft);
  if (errors.length) {
    state.profileError = errors[0];
    state.profileMessage = "";
    renderProfileEditRoute();
    return;
  }

  state.profileSaving = true;
  state.profileError = "";
  state.profileMessage = "";
  renderProfileEditRoute();

  try {
    state.profile = saveUserProfile(draft);
    const userId = state.authSummary?.id || state.auth.user?.id;
    if (userId && !state.remoteProfile.unavailable) {
      const result = await saveRemoteUserProfile(userId, state.profile);
      state.remoteProfile.loaded = true;
      state.remoteProfile.unavailable = result.unavailable;
      state.remoteProfile.error = result.error;
      if (result.profile) {
        state.profile = saveUserProfile({
          ...state.profile,
          ...result.profile,
          emailDisplay: state.profile.emailDisplay,
          avatarDataUrl: state.profile.avatarDataUrl,
        });
      }
      if (result.unavailable) {
        state.profileMessage = "资料已保存在本机，云端资料表未配置";
      } else if (result.error) {
        console.error("Remote profile save failed", result.error);
        state.profileMessage = "资料已保存在本机，云端同步失败";
      } else {
        state.profileMessage = "资料已保存并同步";
      }
    } else if (userId && state.remoteProfile.unavailable) {
      state.profileMessage = "资料已保存在本机，云端资料表未配置";
    } else {
      state.profileMessage = "资料已保存在本机";
    }
    state.profileDraft = { ...state.profile };
  } catch (error) {
    console.error("Profile save failed", error);
    state.profileError = "保存失败，请稍后重试";
  } finally {
    state.profileSaving = false;
    renderProfile();
    renderProfileEditRoute();
  }
}

function bindProfileEditRouteEvents() {
  nodes.profileRouteMain.querySelector("#profileAvatarInput")?.addEventListener("change", (event) => {
    handleProfileAvatarFile(event.target.files?.[0]);
  });

  nodes.profileRouteMain.querySelectorAll("[data-profile-edit-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.profileEditAction === "removeAvatar") {
        currentProfileDraft().avatarDataUrl = "";
        currentProfileDraft().avatarUrl = "";
        state.profileError = "";
        state.profileMessage = "";
        renderProfileEditRoute();
      }

      if (button.dataset.profileEditAction === "cancel") {
        closeProfileRoute();
      }

      if (button.dataset.profileEditAction === "save") {
        saveProfileDraft();
      }
    });
  });
}

function settingsRouteHtml() {
  const settings = state.settings;
  const loggedIn = Boolean(state.authSummary);
  const downloads = Array.isArray(state.downloads) ? state.downloads : [];
  const settingsSyncMessage = state.remoteSettings.error
    ? `<div class="profile-route-message" data-tone="${loggedIn ? "error" : "warning"}">${escapeHtml(state.remoteSettings.error)}</div>`
    : loggedIn
      ? `<div class="profile-route-message" data-tone="success">${state.remoteSettings.loaded ? "设置同步已启用" : "登录后将同步设置"}</div>`
      : `<div class="profile-route-message" data-tone="warning">未登录，设置仅保存在本机。登录后可同步到云端。</div>`;

  return `
    <section class="profile-route-page settings-route">
      <section class="profile-route-hero">
        <p>应用偏好</p>
        <h1>设置</h1>
        <div>管理阅读体验、下载画质、缓存与数据同步。</div>
      </section>

      ${settingsSyncMessage}

      <section class="profile-setting-group">
        <h2>显示与阅读</h2>
        <div class="profile-setting-row">
          <div><strong>主题</strong><span>当前完整视觉以浅色为主，深色主题先保存偏好</span></div>
          <div class="profile-segmented" data-setting="theme">
            <button type="button" data-value="system" aria-pressed="${settingSelected(settings.theme, "system")}">跟随系统</button>
            <button type="button" data-value="light" aria-pressed="${settingSelected(settings.theme, "light")}">浅色</button>
            <button type="button" data-value="dark" aria-pressed="${settingSelected(settings.theme, "dark")}">深色</button>
          </div>
        </div>
        <div class="profile-setting-row">
          <div><strong>字体大小</strong><span>影响详情页和个人页正文</span></div>
          <div class="profile-segmented" data-setting="fontSize">
            <button type="button" data-value="small" aria-pressed="${settingSelected(settings.fontSize, "small")}">小</button>
            <button type="button" data-value="medium" aria-pressed="${settingSelected(settings.fontSize, "medium")}">标准</button>
            <button type="button" data-value="large" aria-pressed="${settingSelected(settings.fontSize, "large")}">大</button>
          </div>
        </div>
        <div class="profile-setting-row">
          <div><strong>动画效果</strong><span>可降低页面动效强度</span></div>
          <div class="profile-segmented" data-setting="motion">
            <button type="button" data-value="full" aria-pressed="${settingSelected(settings.motion, "full")}">完整</button>
            <button type="button" data-value="reduced" aria-pressed="${settingSelected(settings.motion, "reduced")}">减弱</button>
          </div>
        </div>
      </section>

      <section class="profile-setting-group">
        <h2>下载</h2>
        <div class="profile-setting-row">
          <div><strong>默认下载画质</strong><span>下载功能完善后使用该偏好</span></div>
          <div class="profile-segmented" data-setting="downloadQuality">
            <button type="button" data-value="standard" aria-pressed="${settingSelected(settings.downloadQuality, "standard")}">标准</button>
            <button type="button" data-value="high" aria-pressed="${settingSelected(settings.downloadQuality, "high")}">高清</button>
            <button type="button" data-value="original" aria-pressed="${settingSelected(settings.downloadQuality, "original")}">原图优先</button>
          </div>
        </div>
        <button class="profile-setting-row profile-switch-row" type="button" data-toggle-setting="confirmBeforeDownload" aria-pressed="${String(settings.confirmBeforeDownload)}">
          <div><strong>下载前确认</strong><span>${checkedText(settings.confirmBeforeDownload)}</span></div>
          <span class="profile-switch" aria-hidden="true"></span>
        </button>
        <button class="profile-setting-row profile-switch-row" type="button" data-toggle-setting="saveDownloadHistory" aria-pressed="${String(settings.saveDownloadHistory)}">
          <div><strong>保存下载记录</strong><span>${checkedText(settings.saveDownloadHistory)}</span></div>
          <span class="profile-switch" aria-hidden="true"></span>
        </button>
      </section>

      <section class="profile-setting-group">
        <h2>数据与缓存</h2>
        <button class="profile-setting-row" type="button" data-local-action="clearHistory"><div><strong>清除浏览历史</strong><span>${state.history.length} 条本机记录</span></div></button>
        <button class="profile-setting-row" type="button" data-local-action="clearFavorites"><div><strong>清除本机收藏</strong><span>${state.favorites.size} 件作品</span></div></button>
        <button class="profile-setting-row" type="button" data-local-action="clearDownloads"><div><strong>清除下载记录</strong><span>${downloads.length} 个文件</span></div></button>
        <button class="profile-setting-row" type="button" data-local-action="resetSettings"><div><strong>重置应用偏好</strong><span>恢复默认设置</span></div></button>
      </section>

      <section class="profile-setting-group">
        <h2>数据同步</h2>
        <div class="profile-setting-row"><div><strong>收藏同步</strong><span>${loggedIn ? "已登录后自动同步收藏变更" : "未登录，仅保存在本机"}</span></div>${profileStatusBadge(loggedIn ? "可用" : "未登录", loggedIn ? "ok" : "muted")}</div>
        <div class="profile-setting-row"><div><strong>浏览历史同步</strong><span>${loggedIn ? "已登录后自动同步浏览记录" : "未登录，仅保存在本机"}</span></div>${profileStatusBadge(loggedIn ? "可用" : "未登录", loggedIn ? "ok" : "muted")}</div>
        <div class="profile-setting-row is-disabled"><div><strong>云端设置同步</strong><span>已有 user_settings 表，完整登录流程完成后启用</span></div>${profileStatusBadge("占位", "muted")}</div>
      </section>

      <section class="profile-setting-group">
        <h2>关于</h2>
        <div class="profile-setting-row"><div><strong>版本</strong><span>0.1.0</span></div></div>
        <div class="profile-setting-row"><div><strong>数据来源</strong><span>Supabase、Artvee、芝加哥艺术博物馆等公开资料</span></div></div>
        <div class="profile-setting-row is-disabled"><div><strong>隐私政策</strong><span>App Store / Google Play 上线前补齐</span></div>${profileStatusBadge("占位", "muted")}</div>
        <div class="profile-setting-row is-disabled"><div><strong>用户协议</strong><span>上线前补齐</span></div>${profileStatusBadge("占位", "muted")}</div>
      </section>
    </section>
  `;
}

function renderSettingsRoute() {
  nodes.profileRoute.dataset.activeRoute = "settings";
  nodes.profileRouteTitle.textContent = "设置";
  nodes.profileRouteMain.innerHTML = settingsRouteHtml();
  bindSettingsRouteEvents();
}

function rerenderActiveProfileRoute() {
  if (nodes.profileRoute.dataset.activeRoute === "profile") {
    renderProfileEditRoute();
  }
  if (nodes.profileRouteTitle.textContent === "设置") {
    renderSettingsRoute();
  }
  if (nodes.profileRouteTitle.textContent === "安全中心") {
    renderSecurityRoute();
  }
}

function runLocalDataAction(action) {
  const messages = {
    clearHistory: "确认清除本机浏览历史？",
    clearFavorites: "确认清除本机收藏？",
    clearDownloads: "确认清除下载记录？",
    resetSettings: "确认恢复默认设置？",
  };

  if (!window.confirm(messages[action] || "确认执行该操作？")) return;

  if (action === "clearHistory") {
    clearLocalHistory();
    state.history = [];
  }

  if (action === "clearFavorites") {
    clearLocalFavorites();
    state.favorites = new Set();
  }

  if (action === "clearDownloads") {
    clearLocalDownloads();
    state.downloads = [];
  }

  if (action === "resetSettings") {
    state.settings = resetAppSettings();
    applyAppSettings();
  }

  renderProfile();
  rerenderActiveProfileRoute();
}

async function persistAppSettingsPatch(patch) {
  state.settings = updateAppSettings(patch);
  applyAppSettings();
  const userId = state.authSummary?.id || state.auth.user?.id;
  if (!userId) {
    state.remoteSettings.error = "未登录，设置已保存在本机";
    return;
  }

  const result = await saveRemoteUserSettings(userId, state.settings);
  state.remoteSettings.loaded = true;
  state.remoteSettings.error = result.error;
  if (result.error) {
    console.error("Remote settings save failed", result.error);
  }
  rerenderActiveProfileRoute();
}

function bindSettingsRouteEvents() {
  nodes.profileRouteMain.querySelectorAll("[data-setting]").forEach((group) => {
    group.querySelectorAll("button[data-value]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = group.dataset.setting;
        persistAppSettingsPatch({ [key]: button.dataset.value }).catch((error) => {
          console.error("Settings save failed", error);
        });
        renderSettingsRoute();
      });
    });
  });

  nodes.profileRouteMain.querySelectorAll("[data-toggle-setting]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.toggleSetting;
      persistAppSettingsPatch({ [key]: !state.settings[key] }).catch((error) => {
        console.error("Settings save failed", error);
      });
      renderSettingsRoute();
    });
  });

  nodes.profileRouteMain.querySelectorAll("[data-local-action]").forEach((button) => {
    button.addEventListener("click", () => runLocalDataAction(button.dataset.localAction));
  });
}

function accountValue(value) {
  return value ? escapeHtml(value) : "未绑定或未登录";
}

function securityRouteHtml() {
  const loggedIn = Boolean(state.authSummary);
  const authStatus = state.authLoaded ? (loggedIn ? "已登录" : "未登录") : "读取中";
  const authTone = state.authLoaded ? (loggedIn ? "ok" : "muted") : "warning";
  const message = state.routeMessage
    ? `<div class="profile-route-message">${escapeHtml(state.routeMessage)}</div>`
    : "";
  const loginAction = loggedIn
    ? ""
    : `<button class="profile-edit-action profile-edit-action-primary auth-inline-action" type="button" data-security-action="openAuth">登录 / 注册</button>`;

  return `
    <section class="profile-route-page security-route">
      <section class="profile-route-hero">
        <p>手机号、邮箱与登录设备</p>
        <h1>安全中心</h1>
        <div>这里仅展示当前 Supabase Auth 可确认的账号状态；暂未接入的能力保持占位。</div>
      </section>

      ${message}
      ${loginAction}

      <section class="profile-setting-group">
        <h2>账号状态</h2>
        <div class="profile-setting-row">
          <div><strong>登录状态</strong><span>${authStatus}</span></div>
          ${profileStatusBadge(authStatus, authTone)}
        </div>
        <div class="profile-setting-row">
          <div><strong>绑定邮箱</strong><span>${accountValue(state.authSummary?.email)}</span></div>
          ${profileStatusBadge(state.authSummary?.email ? "来自 Auth" : "未配置", state.authSummary?.email ? "ok" : "muted")}
        </div>
        <div class="profile-setting-row">
          <div><strong>绑定手机号</strong><span>${accountValue(state.authSummary?.phone)}</span></div>
          ${profileStatusBadge(state.authSummary?.phone ? "来自 Auth" : "未配置", state.authSummary?.phone ? "ok" : "muted")}
        </div>
        <div class="profile-setting-row">
          <div><strong>用户 ID</strong><span>${escapeHtml(accountShortId())}</span></div>
          ${profileStatusBadge(loggedIn ? "当前用户" : "未登录", loggedIn ? "ok" : "muted")}
        </div>
        <button class="profile-setting-row" type="button" data-security-action="refreshAuth">
          <div><strong>刷新账号状态</strong><span>重新读取 Supabase Auth 当前用户。</span></div>
        </button>
      </section>

      <section class="profile-setting-group">
        <h2>安全管理</h2>
        <button class="profile-setting-row is-disabled" type="button" disabled>
          <div><strong>更换邮箱</strong><span>需要完整登录、验证邮件和回调页面后启用。</span></div>${profileStatusBadge("占位", "muted")}
        </button>
        <button class="profile-setting-row is-disabled" type="button" disabled>
          <div><strong>更换手机号</strong><span>需要短信验证能力后启用。</span></div>${profileStatusBadge("占位", "muted")}
        </button>
        <button class="profile-setting-row is-disabled" type="button" disabled>
          <div><strong>登录设备管理</strong><span>当前项目没有设备会话列表接口，暂不展示伪数据。</span></div>${profileStatusBadge("占位", "muted")}
        </button>
      </section>

      <section class="profile-setting-group">
        <h2>本机隐私</h2>
        <button class="profile-setting-row" type="button" data-local-action="clearHistory"><div><strong>清除浏览历史</strong><span>${state.history.length} 条本机记录</span></div></button>
        <button class="profile-setting-row" type="button" data-local-action="clearFavorites"><div><strong>清除本机收藏</strong><span>${state.favorites.size} 件作品</span></div></button>
        <button class="profile-setting-row" type="button" data-local-action="clearDownloads"><div><strong>清除下载记录</strong><span>${Array.isArray(state.downloads) ? state.downloads.length : 0} 个文件</span></div></button>
      </section>

      <section class="profile-setting-group">
        <h2>账号操作</h2>
        <button class="profile-setting-row profile-danger-row" type="button" data-security-action="signOut" ${loggedIn ? "" : "disabled"}>
          <div><strong>退出登录</strong><span>${loggedIn ? "退出当前 Supabase Auth 会话。" : "当前没有可退出的登录会话。"}</span></div>
        </button>
        <button class="profile-setting-row profile-danger-row is-disabled" type="button" disabled>
          <div><strong>注销账号</strong><span>需要后端删除流程、二次确认和数据保留策略后启用。</span></div>${profileStatusBadge("占位", "muted")}
        </button>
      </section>
    </section>
  `;
}

function renderSecurityRoute() {
  nodes.profileRoute.dataset.activeRoute = "security";
  nodes.profileRouteTitle.textContent = "安全中心";
  nodes.profileRouteMain.innerHTML = securityRouteHtml();
  bindSecurityRouteEvents();
}

function bindSecurityRouteEvents() {
  nodes.profileRouteMain.querySelectorAll("[data-local-action]").forEach((button) => {
    button.addEventListener("click", () => runLocalDataAction(button.dataset.localAction));
  });

  nodes.profileRouteMain.querySelectorAll("[data-security-action]").forEach((button) => {
    button.addEventListener("click", () => handleSecurityAction(button.dataset.securityAction));
  });
}

async function handleSecurityAction(action) {
  if (action === "openAuth") {
    openProfileRoute("auth");
    return;
  }

  if (action === "refreshAuth") {
    state.routeMessage = "正在刷新账号状态...";
    renderSecurityRoute();
    await loadAuthSummary({ rerenderRoute: true });
    state.routeMessage = "账号状态已刷新。";
    renderSecurityRoute();
    return;
  }

  if (action === "signOut") {
    await handleSignOut();
  }
}

async function handleSignOut() {
  if (!isLoggedIn()) {
    openProfileRoute("auth");
    return;
  }
  if (!window.confirm("确认退出当前账号？")) return;
  state.routeMessage = "正在退出登录...";
  rerenderActiveProfileRoute();
  try {
    await signOutCurrentSession();
    clearAccountScopedState();
    state.routeMessage = "已退出登录。";
    state.authForm.message = "";
    state.authForm.error = "";
    closeProfileRoute();
    setView("me");
  } catch (error) {
    console.error("Sign out failed", error);
    state.routeMessage = friendlyAuthError(error, "退出失败，请稍后重试");
  } finally {
    renderProfile();
    rerenderActiveProfileRoute();
  }
}

async function loadAuthSummary(options = {}) {
  state.authLoaded = false;
  if (options.rerenderRoute && nodes.profileRoute.dataset.activeRoute === "profile") renderProfileEditRoute();
  if (options.rerenderRoute && nodes.profileRouteTitle.textContent === "安全中心") renderSecurityRoute();
  try {
    state.authSummary = await getCurrentUserSummary();
    if (state.authSummary && !state.auth.user) {
      const { session, user } = await getCurrentSession();
      setAuthState(session, user);
    }
  } catch (error) {
    console.warn("Auth summary failed", error);
    state.authSummary = null;
  } finally {
    state.authLoaded = true;
    if (options.rerenderRoute && nodes.profileRoute.dataset.activeRoute === "profile") renderProfileEditRoute();
    if (options.rerenderRoute && nodes.profileRouteTitle.textContent === "安全中心") renderSecurityRoute();
  }
}

function profileRouteConfig(panel) {
  const favorites = favoriteArtworks();
  const history = historyArtworks();
  const downloads = Array.isArray(state.downloads) ? state.downloads : [];
  const configs = {
    favorites: {
      title: "我的收藏",
      eyebrow: `${favorites.length}件作品`,
      body: favorites.length ? "收藏作品列表会在这里展开。" : "还没有收藏作品。",
      list: favorites,
      empty: "还没有收藏作品",
    },
    history: {
      title: "浏览历史",
      eyebrow: `${history.length}件作品`,
      body: history.length ? "最近浏览过的画作会在这里展开。" : "还没有浏览记录。",
      list: history,
      empty: "还没有浏览记录",
    },
    downloads: {
      title: "下载管理",
      eyebrow: `${downloads.length}个文件`,
      body: downloads.length ? "本机下载记录保存在当前浏览器。" : "暂无下载内容。",
      records: downloads,
    },
    security: {
      title: "安全中心",
      eyebrow: "手机号、邮箱与登录设备",
      body: "解绑或更换手机号、邮箱，以及登录设备管理会在这里配置。",
    },
    settings: {
      title: "设置",
      eyebrow: "应用偏好",
      body: "主题、缓存、下载画质、语言和数据同步策略会在这里配置。",
    },
    logout: {
      title: "退出登录",
      eyebrow: "账号状态",
      body: "退出登录会结束当前 Supabase Auth 会话，并返回未登录状态。",
    },
  };
  return configs[panel] || configs.settings;
}

function splitDisplayName(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.*?)\s*[（(](.*?)[）)]\s*$/);
  if (!match) return { primary: text, secondary: "" };
  return {
    primary: match[1].trim(),
    secondary: match[2].trim(),
  };
}

function downloadStatusText(status) {
  if (status === "failed") return "下载失败";
  if (status === "completed") return "下载完成";
  if (status === "downloading") return "下载中";
  return "等待下载";
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(precision)}${units[unitIndex]}`;
}

function downloadProgressValue(record) {
  const downloadedBytes = Number(record.downloadedBytes || 0);
  const totalBytes = Number(record.totalBytes || 0);
  if (!totalBytes || totalBytes <= 0) return record.status === "completed" ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)));
}

function downloadProgressText(record) {
  if (record.status === "failed") return "下载失败";
  if (!record.totalBytes) return record.status === "downloading" ? "正在下载" : "-- / --";
  return `${formatBytes(record.downloadedBytes)} / ${formatBytes(record.totalBytes)}`;
}

function formatDownloadTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderDownloadRecords(container, records) {
  if (state.downloadError) {
    const copy = pageDataErrorCopy(state.downloadError, "downloads");
    container.innerHTML = errorStateMarkup({
      title: copy.title,
      description: copy.description,
      retryLabel: "重新读取",
      compact: true,
      action: "reloadDownloads",
    });
    bindStateActions(container);
    return;
  }

  const list = Array.isArray(records) ? records : [];
  if (!list.length) {
    container.innerHTML = `<div class="profile-route-empty">暂无下载内容</div>`;
    return;
  }

  container.innerHTML = list
    .map(
      (record) => `
        <article class="download-record" data-status="${escapeHtml(record.status)}">
          <img class="download-record-thumb" src="${escapeHtml(record.thumbnailUrl || "/assets/icon.svg")}" alt="${escapeHtml(record.title)}" />
          <div class="download-record-copy">
            <h2>${escapeHtml(record.title)}</h2>
            <div class="download-progress" aria-label="下载进度 ${escapeHtml(downloadProgressText(record))}">
              <span class="download-progress-track">
                <span class="download-progress-fill" style="width: ${downloadProgressValue(record)}%"></span>
              </span>
              <span class="download-progress-text">${escapeHtml(downloadProgressText(record))}</span>
            </div>
            <span>${escapeHtml(formatDownloadTime(record.updatedAt || record.createdAt))}</span>
          </div>
          <strong class="download-record-status">${escapeHtml(downloadStatusText(record.status))}</strong>
        </article>
      `,
    )
    .join("");
}

function openProfileRoute(panel) {
  if (panel === "auth") {
    window.clearTimeout(profileRouteCloseTimer);
    state.authForm.error = "";
    state.authForm.message = "";
    renderAuthRoute(state.authForm.mode || "login");
    nodes.profileRoute.dataset.mounted = "true";
    requestAnimationFrame(() => {
      nodes.profileRoute.setAttribute("aria-hidden", "false");
    });
    document.body.classList.add("profile-route-open");
    return;
  }

  if (panel === "profile") {
    window.clearTimeout(profileRouteCloseTimer);
    startProfileDraft();
    renderProfileEditRoute();
    nodes.profileRoute.dataset.mounted = "true";
    requestAnimationFrame(() => {
      nodes.profileRoute.setAttribute("aria-hidden", "false");
    });
    document.body.classList.add("profile-route-open");
    loadAuthSummary({ rerenderRoute: true });
    return;
  }

  if (panel === "settings") {
    window.clearTimeout(profileRouteCloseTimer);
    renderSettingsRoute();
    nodes.profileRoute.dataset.mounted = "true";
    requestAnimationFrame(() => {
      nodes.profileRoute.setAttribute("aria-hidden", "false");
    });
    document.body.classList.add("profile-route-open");
    return;
  }

  if (panel === "security") {
    window.clearTimeout(profileRouteCloseTimer);
    state.routeMessage = "";
    renderSecurityRoute();
    nodes.profileRoute.dataset.mounted = "true";
    requestAnimationFrame(() => {
      nodes.profileRoute.setAttribute("aria-hidden", "false");
    });
    document.body.classList.add("profile-route-open");
    loadAuthSummary({ rerenderRoute: true });
    return;
  }

  if (panel === "logout") {
    handleSignOut().catch((error) => {
      console.error("Sign out failed", error);
    });
    return;
  }

  const config = profileRouteConfig(panel);
  window.clearTimeout(profileRouteCloseTimer);
  nodes.profileRouteTitle.textContent = config.title;
  if (config.records) {
    nodes.profileRouteMain.innerHTML = `
      <section class="profile-route-list download-route-list">
        <div class="profile-route-heading">
          <h1>${escapeHtml(config.title)}</h1>
          <p>${escapeHtml(config.eyebrow)}</p>
        </div>
        <div class="download-record-list" id="downloadRecordList"></div>
      </section>
    `;
    renderDownloadRecords(document.querySelector("#downloadRecordList"), config.records);
    nodes.profileRoute.dataset.mounted = "true";
    requestAnimationFrame(() => {
      nodes.profileRoute.setAttribute("aria-hidden", "false");
    });
    document.body.classList.add("profile-route-open");
    return;
  }
  if (config.list) {
    nodes.profileRouteMain.innerHTML = `
      <section class="profile-route-list">
        <div class="profile-route-heading">
          <h1>${escapeHtml(config.title)}</h1>
          <p>${escapeHtml(config.eyebrow)}</p>
        </div>
        <div class="category-results-grid profile-route-grid" id="profileRouteGrid"></div>
      </section>
    `;
    renderCategoryCards(document.querySelector("#profileRouteGrid"), config.list, config.empty, { closeRouteBeforeOpen: true });
  } else {
    nodes.profileRouteMain.innerHTML = `
      <section class="profile-route-placeholder">
        <p>${escapeHtml(config.eyebrow)}</p>
        <h1>${escapeHtml(config.title)}</h1>
        <div>${escapeHtml(config.body)}</div>
      </section>
    `;
  }
  nodes.profileRoute.dataset.mounted = "true";
  requestAnimationFrame(() => {
    nodes.profileRoute.setAttribute("aria-hidden", "false");
  });
  document.body.classList.add("profile-route-open");
}

function openTagRoute(tag) {
  const list = artworks().filter((item) => itemMatchesTag(item, tag));
  window.clearTimeout(profileRouteCloseTimer);
  nodes.profileRouteTitle.textContent = "标签";
  nodes.profileRouteMain.innerHTML = `
    <section class="profile-route-list">
      <div class="profile-route-heading">
        <h1>${escapeHtml(tag)}</h1>
        <p>${list.length}件作品</p>
      </div>
      <div class="category-results-grid profile-route-grid" id="profileRouteGrid"></div>
    </section>
  `;
  renderCategoryCards(document.querySelector("#profileRouteGrid"), list, "当前标签下暂无作品", { closeRouteBeforeOpen: true });
  nodes.profileRoute.dataset.mounted = "true";
  requestAnimationFrame(() => {
    nodes.profileRoute.setAttribute("aria-hidden", "false");
  });
  document.body.classList.add("profile-route-open");
}

function openHomeSectionRoute(section) {
  if (section.type === "tag") {
    openTagRoute(section.tagName || section.title);
    return;
  }

  const list = Array.isArray(section.artworks) ? section.artworks : [];
  window.clearTimeout(profileRouteCloseTimer);
  nodes.profileRouteTitle.textContent = section.title;
  nodes.profileRouteMain.innerHTML = `
    <section class="profile-route-list">
      <div class="profile-route-heading">
        <h1>${escapeHtml(section.title)}</h1>
        <p>${list.length}件作品</p>
      </div>
      <div class="category-results-grid profile-route-grid" id="profileRouteGrid"></div>
    </section>
  `;
  renderCategoryCards(document.querySelector("#profileRouteGrid"), list, "暂无推荐作品", { closeRouteBeforeOpen: true });
  nodes.profileRoute.dataset.mounted = "true";
  requestAnimationFrame(() => {
    nodes.profileRoute.setAttribute("aria-hidden", "false");
  });
  document.body.classList.add("profile-route-open");
}

function openArtistRoute(artist) {
  const normalizedArtist = String(artist || "").trim();
  const artistName = splitDisplayName(normalizedArtist || "未知艺术家");
  const list = artworks().filter((item) => item.artist === normalizedArtist);
  window.clearTimeout(profileRouteCloseTimer);
  nodes.profileRouteTitle.textContent = "艺术家";
  nodes.profileRouteMain.innerHTML = `
    <section class="profile-route-list">
      <div class="profile-route-heading artist-route-heading">
        <h1>
          <span>${escapeHtml(artistName.primary || "未知艺术家")}</span>
          ${artistName.secondary ? `<small>${escapeHtml(artistName.secondary)}</small>` : ""}
        </h1>
        <p>${list.length}件作品</p>
      </div>
      <div class="category-results-grid profile-route-grid" id="profileRouteGrid"></div>
    </section>
  `;
  renderCategoryCards(document.querySelector("#profileRouteGrid"), list, "当前艺术家暂无更多作品", { closeRouteBeforeOpen: true });
  nodes.profileRoute.dataset.mounted = "true";
  requestAnimationFrame(() => {
    nodes.profileRoute.setAttribute("aria-hidden", "false");
  });
  document.body.classList.add("profile-route-open");
}

function closeProfileRoute() {
  if (nodes.profileRoute.getAttribute("aria-hidden") === "true" && nodes.profileRoute.dataset.mounted !== "true") return;
  window.clearTimeout(profileRouteCloseTimer);
  nodes.profileRoute.setAttribute("aria-hidden", "true");
  document.body.classList.remove("profile-route-open");
  profileRouteCloseTimer = window.setTimeout(() => {
    if (nodes.profileRoute.getAttribute("aria-hidden") === "true") {
      nodes.profileRoute.dataset.mounted = "false";
      nodes.profileRouteMain.innerHTML = "";
    }
  }, MOTION_PANEL_EXIT_MS);
}

function allTags() {
  const counts = new Map();
  for (const item of artworks()) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([name, count]) => ({ name, count }));
}

const categoryDefinitions = [
  {
    key: "genre",
    title: "流派",
    fallback: ["印象派", "现实主义", "文艺复兴", "表现主义", "抽象派"],
    matches: (tag) => /派|主义|艺术运动|文艺复兴|巴洛克|洛可可|浪漫|现代|象征|古典|野兽|立体|抽象|印象|现实|表现|学院/i.test(tag),
  },
  {
    key: "era",
    title: "年代",
    fallback: ["15世纪", "17世纪", "1900年代", "当代艺术"],
    matches: (tag) => /世纪|年代|古代|中世纪|文艺复兴|当代|现代|^\d{3,4}s?$|^\d{2}世纪$/i.test(tag),
  },
  {
    key: "region",
    title: "地区",
    fallback: ["荷兰艺术", "法国艺术", "意大利艺术", "东亚艺术"],
    matches: (tag) => /中国|日本|东亚|亚洲|法国|意大利|荷兰|英国|美国|西班牙|德国|欧洲|巴黎|佛兰德|地区|艺术$/i.test(tag),
  },
];

function categoryTagGroups() {
  const tags = allTags();
  const remaining = new Map(tags.map((tag) => [tag.name, tag]));
  const groups = categoryDefinitions.map((definition) => {
    const matched = tags.filter((tag) => definition.matches(tag.name)).slice(0, 12);
    for (const tag of matched) remaining.delete(tag.name);
    return {
      ...definition,
      tags: matched.length ? matched : definition.fallback.map((name) => ({ name, count: 0 })),
    };
  });

  const themeTags = [...remaining.values()].slice(0, 12);
  if (themeTags.length) {
    groups.push({
      key: "theme",
      title: "题材",
      fallback: [],
      matches: () => false,
      tags: themeTags,
    });
  }
  return groups;
}

function orderedTags() {
  const tags = allTags();
  const byName = new Map(tags.map((tag) => [tag.name, tag]));
  const ordered = state.tagOrder.map((name) => byName.get(name)).filter(Boolean);
  const missing = tags.filter((tag) => !state.tagOrder.includes(tag.name));
  return [...ordered, ...missing];
}

function itemMatchesTag(item, tag) {
  return item.tags.includes(tag);
}

async function loadCategoryResults(options = {}) {
  const tag = state.activeCategory;
  if (!tag) return;

  const reset = Boolean(options.reset);
  const key = categoryResultKey(tag);
  const from = reset ? 0 : state.categoryResults.nextFrom;
  if (!reset && (state.categoryResults.loadingMore || from == null)) return;

  state.categoryResults = {
    key,
    items: reset ? [] : state.categoryResults.items,
    nextFrom: reset ? null : state.categoryResults.nextFrom,
    hasMore: reset ? false : state.categoryResults.hasMore,
    totalCount: reset ? null : state.categoryResults.totalCount,
    loading: reset,
    loadingMore: !reset,
    error: "",
  };
  renderCategories();

  try {
    const page = await fetchPaintingsPage({ limit: CATEGORY_PAGE_SIZE, from: from ?? 0, tag });
    appendPaintingsPage(page.paintings);
    const cacheMessage = cachedStatusMessage(page);
    if (cacheMessage) setStatus(cacheMessage, page.offline ? "warning" : "info");
    const nextItems = page.paintings.map(paintingToArtwork);
    const merged = reset ? nextItems : [...state.categoryResults.items, ...nextItems];
    state.categoryResults = {
      key,
      items: [...new Map(merged.map((item) => [item.id, item])).values()],
      nextFrom: page.nextFrom,
      hasMore: page.hasMore,
      totalCount: page.totalCount ?? state.categoryResults.totalCount,
      loading: false,
      loadingMore: false,
      error: "",
    };
  } catch (error) {
    console.error("Category artworks fetch failed", error);
    state.categoryResults = {
      ...state.categoryResults,
      key,
      loading: false,
      loadingMore: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }

  renderCategories();
}

function clampedWindowScrollY(value) {
  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return Math.min(Math.max(0, value), maxScrollY);
}

function restoreHomeScrollPosition() {
  const targetScrollY = state.homeScrollY;
  const restore = () => {
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo({ top: clampedWindowScrollY(targetScrollY), behavior: "auto" });
    root.style.scrollBehavior = previousScrollBehavior;
  };

  requestAnimationFrame(() => {
    restore();
    window.setTimeout(restore, 80);
    window.setTimeout(restore, 220);
  });
}

function setView(view) {
  const previousView = state.activeView;
  const isHomeReselect = previousView === "home" && view === "home";

  if (previousView === "home" && view !== "home") state.homeScrollY = window.scrollY;

  state.activeView = view;
  updateTopbar(view);
  for (const item of nodes.navItems) item.setAttribute("aria-pressed", String(item.dataset.viewTarget === view));
  for (const section of nodes.viewSections) section.hidden = section.dataset.viewSection !== view;
  if (view === "me") renderProfile();
  animateViewEntry(view);

  if (isHomeReselect) {
    state.homeScrollY = 0;
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if (view === "home" && previousView !== "home") {
    restoreHomeScrollPosition();
    return;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function thumbnailImageUrl(item) {
  return item.thumbnailUrl || item.displayUrl || "/assets/icon.svg";
}

function displayImageUrl(item) {
  return item.displayUrl || item.thumbnailUrl || "/assets/icon.svg";
}

function imageUrl(item) {
  return thumbnailImageUrl(item);
}

function initialRecommendationCardWidth(item) {
  const url = thumbnailImageUrl(item);
  const cachedRatio = Number(readImageRatioCache()[url]);
  const ratio = cachedRatio || ratioFromDimensions(item.dimensions);
  return cardWidthFromRatio(ratio);
}

function preloadImageRatio(item, options = {}) {
  const { timeoutMs = 6000 } = options;
  const url = thumbnailImageUrl(item);
  return new Promise((resolve) => {
    const image = new Image();
    const finish = () => resolve();
    const timer = timeoutMs > 0 ? window.setTimeout(finish, timeoutMs) : 0;

    image.addEventListener(
      "load",
      () => {
        if (timer) window.clearTimeout(timer);
        if (image.naturalWidth && image.naturalHeight) {
          const cache = readImageRatioCache();
          cache[url] = image.naturalWidth / image.naturalHeight;
          writeImageRatioCache(cache);
        }
        if (typeof image.decode === "function") {
          image.decode().then(resolve).catch(resolve);
        } else {
          resolve();
        }
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        if (timer) window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    image.decoding = "async";
    image.src = url;
  });
}

async function preloadInitialHomeImageRatios() {
  const sections = dedupedHomeSections();
  const items = [];

  for (const section of sections) {
    for (const item of section.artworks) {
      if (!items.some((existing) => thumbnailImageUrl(existing) === thumbnailImageUrl(item))) {
        items.push(item);
      }
      if (items.length >= 2) break;
    }
    if (items.length >= 2) break;
  }

  await Promise.all(items.map((item) => preloadImageRatio(item, { timeoutMs: 1500 })));
}

function recommendationCard(item) {
  const card = document.createElement("article");
  card.className = "recommendation-card";
  card.style.setProperty("--art-card-width", `${initialRecommendationCardWidth(item)}px`);
  card.innerHTML = `
    <button class="recommendation-image" type="button" aria-label="查看 ${escapeHtml(item.title)}" data-art-title="${escapeHtml(item.title)}">
      <img loading="lazy" decoding="async" src="${escapeHtml(thumbnailImageUrl(item))}" alt="${escapeHtml(item.title)}" />
    </button>
    <div class="recommendation-copy">
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.artist)}</p>
    </div>
  `;
  attachImageFallback(card);
  attachRecommendationImageSizing(card);
  card.querySelector(".recommendation-image").addEventListener("click", () => openDrawer(item));
  return card;
}

function attachRecommendationImageSizing(card) {
  const image = card.querySelector("img");
  const imageButton = card.querySelector(".recommendation-image");
  const applySize = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const ratio = image.naturalWidth / image.naturalHeight;
    const width = cardWidthFromRatio(ratio);
    card.style.setProperty("--art-card-width", `${width}px`);
    const cache = readImageRatioCache();
    cache[image.currentSrc || image.src] = ratio;
    writeImageRatioCache(cache);
    imageButton.classList.add("is-loaded");
  };

  if (image.complete) applySize();
  image.addEventListener("load", applySize, { once: true });
}

function artworkCard(item) {
  const card = document.createElement("article");
  card.className = "art-card";
  card.innerHTML = `
    <button class="image-button" type="button" aria-label="查看 ${escapeHtml(item.title)}" data-art-title="${escapeHtml(item.title)}">
      <img loading="lazy" src="${escapeHtml(thumbnailImageUrl(item))}" alt="${escapeHtml(item.title)}" />
    </button>
    <div class="art-card-body">
      <div>
        <p>${escapeHtml(item.movement)}</p>
        <h3>${escapeHtml(item.title)}</h3>
        <span>${escapeHtml(item.artist)} · ${escapeHtml(item.year)}</span>
      </div>
      <button class="favorite-button" type="button" aria-label="收藏 ${escapeHtml(item.title)}" aria-pressed="${state.favorites.has(item.id)}">
        ${state.favorites.has(item.id) ? "♥" : "♡"}
      </button>
    </div>
  `;
  attachImageFallback(card);
  card.querySelector(".image-button").addEventListener("click", () => openDrawer(item));
  card.querySelector(".favorite-button").addEventListener("click", () => toggleFavorite(item.id));
  return card;
}

function attachImageFallback(card) {
  const image = card.querySelector("img");
  const imageButton = card.querySelector(".recommendation-image, .image-button, .category-art-image");
  image.addEventListener("error", () => {
    card.style.setProperty("--art-card-width", "156px");
    image.removeAttribute("src");
    image.alt = "";
    imageButton.classList.add("image-missing");
  });
}

function recommendationItems(list) {
  const byId = new Map(list.map((item) => [item.id, item]));
  return state.recommendationIds.map((id) => byId.get(id)).filter(Boolean);
}

function artworkUniqueId(item) {
  return String(item?.id || item?.source_record_id || item?.artwork_id || "").trim();
}

function selectUnusedArtworkItems(candidates, usedArtworkIds, sectionLimit = ROW_BATCH_SIZE) {
  const selected = [];
  const candidateLimit = Math.max(sectionLimit * 5, 30);

  for (const item of candidates.slice(0, candidateLimit)) {
    const uniqueId = artworkUniqueId(item);
    if (!uniqueId || usedArtworkIds.has(uniqueId)) continue;

    selected.push(item);
    // Avoid showing the same artwork in multiple home sections during this render cycle.
    usedArtworkIds.add(uniqueId);

    if (selected.length >= sectionLimit) break;
  }

  return selected;
}

function sectionKey(section) {
  return section.type === "recommendation" ? "recommendation" : `tag:${section.tagName || section.title}`;
}

function rowLimit(key) {
  return state.rowLimits.get(key) || ROW_BATCH_SIZE;
}

function setInitialRowLimit(key) {
  if (!state.rowLimits.has(key)) state.rowLimits.set(key, ROW_BATCH_SIZE);
}

function homeSections() {
  const list = filteredArtworks();
  if (state.query.trim()) return [{ type: "search", title: "搜索结果", artworks: list }];

  const tags = orderedTags().slice(0, state.visibleTagCount);
  const sections = [{ type: "recommendation", title: "推荐", artworks: recommendationItems(list) }];

  for (const tag of tags) {
    const tagged = list.filter((item) => itemMatchesTag(item, tag.name));
    if (tagged.length) sections.push({ type: "tag", title: tag.name, tagName: tag.name, artworks: tagged });
  }

  return sections;
}

function dedupedHomeSections() {
  const list = filteredArtworks();
  if (state.query.trim()) return homeSections();

  const tags = orderedTags().slice(0, state.visibleTagCount);
  const usedArtworkIds = new Set();
  const randomizedList = recommendationItems(list);
  const sections = [
    {
      type: "recommendation",
      title: "推荐",
      artworks: selectUnusedArtworkItems(randomizedList, usedArtworkIds, rowLimit("recommendation")),
    },
  ];

  for (const tag of tags) {
    const key = `tag:${tag.name}`;
    const tagged = selectUnusedArtworkItems(
      randomizedList.filter((item) => itemMatchesTag(item, tag.name)),
      usedArtworkIds,
      rowLimit(key),
    );
    if (tagged.length) sections.push({ type: "tag", title: tag.name, tagName: tag.name, artworks: tagged });
  }

  return sections;
}

function renderLoading() {
  nodes.grid.innerHTML = `
    <section class="loading-gallery" aria-label="正在加载作品" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
    </section>
  `;
}

function isOfflineError() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function pageDataErrorCopy(error, context = "gallery") {
  if (isOfflineError()) {
    return {
      title: "暂时无法连接画廊",
      description: "请检查网络后重试",
    };
  }

  if (context === "detail") {
    return {
      title: "暂时无法打开作品详情",
      description: "请稍后重试，或返回画廊继续浏览。",
    };
  }

  if (context === "downloads") {
    return {
      title: "暂时无法读取下载记录",
      description: "请稍后重试，或清理本机记录后再查看。",
    };
  }

  return {
    title: "暂时无法连接画廊",
    description: "请检查网络后重试",
  };
}

function errorStateMarkup(options = {}) {
  const {
    title = "暂时无法连接画廊",
    description = "请检查网络后重试",
    retryLabel = "重新加载",
    compact = false,
    action = "reloadPaintings",
  } = options;

  return `
    <section class="state-panel" data-state="error" data-compact="${String(compact)}" role="status" aria-live="polite">
      <div class="state-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 4.3 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <div class="state-copy">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      <button class="state-action" type="button" data-state-action="${escapeHtml(action)}">${escapeHtml(retryLabel)}</button>
    </section>
  `;
}

function bindStateActions(scope = document) {
  scope.querySelectorAll("[data-state-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.stateAction === "reloadPaintings") {
        loadPaintings();
      }

      if (button.dataset.stateAction === "reloadCategory") {
        loadCategoryResults({ reset: true });
      }

      if (button.dataset.stateAction === "closeDetail") {
        closeDrawer();
      }

      if (button.dataset.stateAction === "reloadDownloads") {
        reloadLocalDownloadRecords();
        renderProfile();
        if (nodes.profileRoute?.getAttribute("aria-hidden") === "false") {
          openProfileRoute("downloads");
        }
      }
    });
  });
}

function appendRowItems(row, section) {
  const key = sectionKey(section);
  const currentCount = row.querySelectorAll(".recommendation-card").length;
  const nextItems = section.artworks.slice(currentCount, rowLimit(key));
  row.append(...nextItems.map(recommendationCard));
}

function maybeLoadMoreRow(row, section) {
  const remainingDistance = row.scrollWidth - row.clientWidth - row.scrollLeft;
  if (remainingDistance > 40) return;

  const key = sectionKey(section);
  const currentLimit = rowLimit(key);
  if (currentLimit >= section.artworks.length) return;

  state.rowLimits.set(key, currentLimit + ROW_BATCH_SIZE);
  appendRowItems(row, section);
}

function ensureHomeSectionAction(group, section) {
  let header = group.querySelector(".recommendation-group-head");
  const title = group.querySelector("h2");

  if (!header && title) {
    header = document.createElement("div");
    header.className = "recommendation-group-head";
    title.before(header);
    header.append(title);
  }

  if (!header || header.querySelector(".section-more-button")) return;

  const button = document.createElement("button");
  button.className = "section-more-button";
  button.type = "button";
  button.setAttribute("aria-label", `查看全部 ${section.title} 作品`);
  button.innerHTML = `<span>查看全部</span><span aria-hidden="true">›</span>`;
  button.addEventListener("click", () => openHomeSectionRoute(section));
  header.append(button);
}

function renderRecommendationFeed() {
  if (state.loading) {
    renderLoading();
    return;
  }

  if (state.error) {
    const copy = pageDataErrorCopy(state.error, "gallery");
    nodes.grid.innerHTML = errorStateMarkup({
      title: copy.title,
      description: copy.description,
      retryLabel: "重新加载",
      compact: false,
    });
    bindStateActions(nodes.grid);
    return;
  }

  const sections = dedupedHomeSections();
  nodes.grid.innerHTML = "";
  if (!sections.length) {
    nodes.grid.innerHTML = `<div class="empty-state">paintings 表暂无数据</div>`;
    return;
  }

  if (state.query.trim()) {
    const searchSection = sections[0];
    const resultCount = searchSection.artworks.length;
    const visibleResults = searchSection.artworks.slice(0, state.searchVisibleCount);
    const group = document.createElement("section");
    group.className = "home-search-results";
    group.innerHTML = `
      <div class="profile-route-heading home-search-results-heading">
        <h1>${escapeHtml(searchSection.title)}</h1>
        <p>${resultCount}件作品</p>
      </div>
      <div class="category-results-grid home-search-results-grid"></div>
    `;
    renderCategoryCards(group.querySelector(".home-search-results-grid"), visibleResults, "没有找到匹配作品", {
      hasMore: visibleResults.length < resultCount,
      onLoadMore: () => {
        state.searchVisibleCount += SEARCH_PAGE_SIZE;
        renderHome();
      },
    });
    nodes.grid.append(group);
    return;
  }

  for (const section of sections) {
    const key = sectionKey(section);
    setInitialRowLimit(key);

    const group = document.createElement("section");
    group.className = "recommendation-group";
    group.innerHTML = `
      <div class="recommendation-group-head">
        <h2>${escapeHtml(section.title)}</h2>
      </div>
      <div class="recommendation-row" data-section-key="${escapeHtml(key)}"></div>
    `;

    const row = group.querySelector(".recommendation-row");
    ensureHomeSectionAction(group, section);
    row.append(...section.artworks.slice(0, rowLimit(key)).map(recommendationCard));
    row.addEventListener("scroll", () => maybeLoadMoreRow(row, section), { passive: true });
    nodes.grid.append(group);
  }
}

function renderCards(container, list, emptyText) {
  container.innerHTML = "";
  if (state.loading) {
    container.innerHTML = `<div class="empty-state">正在加载 paintings...</div>`;
    return;
  }
  if (state.error) {
    const copy = pageDataErrorCopy(state.error, "gallery");
    container.innerHTML = errorStateMarkup({
      title: copy.title,
      description: copy.description,
      retryLabel: "重新加载",
      compact: true,
    });
    bindStateActions(container);
    return;
  }
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.append(...list.map(artworkCard));
}

function categoryArtworkCard(item, options = {}) {
  const card = document.createElement("article");
  card.className = "category-art-card";
  card.innerHTML = `
    <button class="category-art-image" type="button" aria-label="查看 ${escapeHtml(item.title)}" data-art-title="${escapeHtml(item.title)}">
      <img loading="lazy" src="${escapeHtml(thumbnailImageUrl(item))}" alt="${escapeHtml(item.title)}" />
    </button>
    <div class="category-art-copy">
      <h3>${escapeHtml(item.titleCn || item.title)}</h3>
      <p>${escapeHtml(item.artist)}</p>
    </div>
  `;
  attachImageFallback(card);
  card.querySelector(".category-art-image").addEventListener("click", () => {
    if (options.closeRouteBeforeOpen) closeProfileRoute();
    openDrawer(item);
  });
  return card;
}

function renderCategoryCards(container, list, emptyText, options = {}) {
  categoryInfiniteObserver?.disconnect();
  container.innerHTML = "";
  if (state.loading) {
    container.innerHTML = `<div class="empty-state">?????? paintings...</div>`;
    return;
  }
  if (state.error) {
    const copy = pageDataErrorCopy(state.error, "gallery");
    container.innerHTML = errorStateMarkup({
      title: copy.title,
      description: copy.description,
      retryLabel: "??????",
      compact: true,
    });
    bindStateActions(container);
    return;
  }
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.append(...list.map((item) => categoryArtworkCard(item, options)));
  if (options.hasMore) {
    const sentinel = document.createElement("div");
    sentinel.className = "category-load-more-sentinel";
    sentinel.dataset.categoryLoadMore = "true";
    sentinel.setAttribute("aria-live", "polite");
    sentinel.textContent = options.loadingMore ? "\u52a0\u8f7d\u4e2d..." : "\u7ee7\u7eed\u4e0b\u6ed1\u52a0\u8f7d\u66f4\u591a";
    container.append(sentinel);
    observeCategoryLoadMore(sentinel, options.onLoadMore);
  }
}

function observeCategoryLoadMore(sentinel, onLoadMore) {
  categoryInfiniteObserver?.disconnect();
  if (!sentinel || typeof IntersectionObserver === "undefined") return;

  categoryInfiniteObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (!state.activeCategory || state.categoryResults.loading || state.categoryResults.loadingMore) return;
      if (!state.categoryResults.hasMore || state.categoryResults.nextFrom == null) return;
      onLoadMore?.();
    },
    { root: null, rootMargin: "480px 0px", threshold: 0.01 },
  );
  categoryInfiniteObserver.observe(sentinel);
}
function renderHome() {
  renderRecommendationFeed();
}

function renderCategories() {
  if (state.error) {
    nodes.categoryGrid.innerHTML = "";
    nodes.categoryResultTitle.textContent = "分类结果";
    nodes.categoryResultEyebrow.textContent = "无法读取";
    const copy = pageDataErrorCopy(state.error, "gallery");
    nodes.categoryResults.innerHTML = errorStateMarkup({
      title: copy.title,
      description: copy.description,
      retryLabel: "重新加载",
      compact: true,
    });
    bindStateActions(nodes.categoryResults);
    return;
  }

  const groups = categoryTagGroups();
  const firstGroup = groups.find((group) => group.tags.length);
  const firstTag = firstGroup?.tags[0];
  if (!state.categoryInitialized && !state.activeCategory && firstTag) {
    state.activeCategory = firstTag.name;
    state.activeCategoryGroup = firstGroup.key;
    state.categoryInitialized = true;
  }
  nodes.categoryGrid.innerHTML = "";

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "category-filter-section";
    const isExpanded = state.expandedCategoryGroups.has(group.key);
    section.dataset.expanded = String(isExpanded);
    section.innerHTML = `
      <div class="category-filter-head">
        <h3>${escapeHtml(group.title)}</h3>
        <button class="category-expand-button" type="button" aria-expanded="${String(isExpanded)}" aria-label="${isExpanded ? "收起" : "展开"}${escapeHtml(group.title)}标签">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      <div class="category-chip-row"></div>
    `;
    section.querySelector(".category-expand-button").addEventListener("click", () => {
      if (state.expandedCategoryGroups.has(group.key)) {
        state.expandedCategoryGroups.delete(group.key);
      } else {
        state.expandedCategoryGroups.add(group.key);
      }
      renderCategories();
    });
    const row = section.querySelector(".category-chip-row");
    for (const tag of group.tags) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "category-chip";
      button.setAttribute("aria-pressed", String(state.activeCategory === tag.name));
      button.textContent = tag.name;
      button.addEventListener("click", () => {
        if (state.activeCategory === tag.name) {
          state.activeCategory = "";
          state.activeCategoryGroup = "";
        } else {
          state.activeCategory = tag.name;
          state.activeCategoryGroup = group.key;
        }
        resetCategoryResults();
        renderCategories();
      });
      row.append(button);
    }
    nodes.categoryGrid.append(section);
  }

  if (state.activeCategory && state.categoryResults.key !== categoryResultKey(state.activeCategory)) {
    void loadCategoryResults({ reset: true });
  }

  if (state.activeCategory && state.categoryResults.loading) {
    nodes.categoryResultTitle.textContent = "分类结果";
    nodes.categoryResultEyebrow.textContent = "正在加载";
    nodes.categoryResults.innerHTML = `<div class="empty-state">正在加载 paintings...</div>`;
    return;
  }

  if (state.activeCategory && state.categoryResults.error) {
    nodes.categoryResultTitle.textContent = "分类结果";
    nodes.categoryResultEyebrow.textContent = "无法读取";
    const copy = pageDataErrorCopy(state.categoryResults.error, "gallery");
    nodes.categoryResults.innerHTML = errorStateMarkup({
      title: copy.title,
      description: copy.description,
      retryLabel: "重新加载",
      compact: true,
      action: "reloadCategory",
    });
    bindStateActions(nodes.categoryResults);
    return;
  }

  const query = state.categoryQuery.trim().toLowerCase();
  const sourceList = state.activeCategory ? state.categoryResults.items : artworks();
  const list = sourceList.filter((item) => {
    const matchesTag = state.activeCategory ? itemMatchesTag(item, state.activeCategory) : true;
    const haystack = [item.title, item.titleEn, item.artist, item.location, item.tags.join(" ")]
      .join(" ")
      .toLowerCase();
    return matchesTag && (!query || haystack.includes(query));
  });
  nodes.categoryResultTitle.textContent = "分类结果";
  const categoryTotalCount = state.activeCategory
    ? state.categoryResults.totalCount
    : query
      ? null
      : state.paintingsTotalCount;
  const visibleCountLabel = `${list.length}\u4ef6\u4f5c\u54c1`;
  nodes.categoryResultEyebrow.textContent = Number.isFinite(categoryTotalCount)
    ? `${categoryTotalCount}\u4ef6\u4f5c\u54c1`
    : visibleCountLabel;
  renderCategoryCards(nodes.categoryResults, list, "当前标签下暂无作品", {
    hasMore: Boolean(state.activeCategory && state.categoryResults.hasMore),
    loadingMore: state.categoryResults.loadingMore,
    onLoadMore: () => loadCategoryResults(),
  });
}

function renderProfileLegacy() {
  const favorites = favoriteArtworks();
  nodes.favoriteCount.textContent = String(favorites.length);
  nodes.libraryCount.textContent = String(state.paintings.length);
  nodes.librarySourceText.textContent = state.error
    ? "暂时无法连接画廊"
    : "当前数据来自 Supabase paintings 表。";
  renderCards(nodes.favoriteGrid, favorites, "还没有收藏作品");
}

function renderProfile() {
  renderProfileIdentity();
  const favorites = favoriteArtworks();
  const history = historyArtworks();
  const downloads = Array.isArray(state.downloads) ? state.downloads : [];

  nodes.favoriteCount.textContent = String(favorites.length);
  nodes.historyCount.textContent = String(history.length);
  nodes.downloadCount.textContent = String(downloads.length);
  nodes.libraryCount.textContent = String(state.paintings.length);
  nodes.librarySourceText.textContent = state.error
    ? "暂时无法连接画廊"
    : `VERSION 0.1.0 · ${state.paintings.length}件馆藏`;

  nodes.profilePanelButtons.forEach((button) => {
    button.setAttribute("aria-pressed", "false");
  });

  const panelConfig = {
    favorites: {
      title: "我的收藏",
      meta: `${favorites.length}件作品`,
      list: favorites,
      empty: "还没有收藏作品",
    },
    history: {
      title: "浏览历史",
      meta: `${history.length}件作品`,
      list: history,
      empty: "还没有浏览记录",
    },
    downloads: {
      title: "下载管理",
      meta: `${downloads.length}个文件`,
      list: [],
      empty: "下载功能将在文件存储与权限策略完善后启用",
    },
    security: {
      title: "安全中心",
      meta: "手机号、邮箱与登录设备",
      list: [],
      empty: "账号安全功能将在 Supabase Auth 接入后启用",
    },
    settings: {
      title: "设置",
      meta: "应用偏好与资料同步",
      list: [],
      empty: "可在这里承载主题、缓存、下载画质与数据同步设置",
    },
  };

  if (nodes.profilePanelTitle && nodes.profilePanelMeta && nodes.favoriteGrid) {
    const active = panelConfig[state.activeProfilePanel] || panelConfig.favorites;
    nodes.profilePanelTitle.textContent = active.title;
    nodes.profilePanelMeta.textContent = active.meta;
    renderCategoryCards(nodes.favoriteGrid, active.list, active.empty);
  }
}

function render() {
  renderHome();
  renderCategories();
  renderProfile();
}

function toggleFavorite(id) {
  const willFavorite = !state.favorites.has(id);
  if (willFavorite) state.favorites.add(id);
  else state.favorites.delete(id);
  saveFavorites();
  syncFavorite(id, state.favorites.has(id)).catch((error) => {
    console.warn("Favorite sync failed", error);
  });
  render();
  showMotionToast(willFavorite ? "已收藏" : "已取消收藏", willFavorite ? "success" : "warning");
}

async function refreshRecommendations(options = {}) {
  const { renderAfter = true } = options;
  state.recommendationIds = shuffle(artworks()).map((item) => item.id);
  state.tagOrder = shuffle(allTags()).map((tag) => tag.name);
  state.visibleTagCount = TAG_BATCH_SIZE;
  state.rowLimits.clear();
  state.rowLimits.set("recommendation", ROW_BATCH_SIZE);

  const preloadPromise = preloadInitialHomeImageRatios().catch((error) => {
    console.warn("Home image ratio preload failed", error);
  });

  if (renderAfter) renderHome();

  void preloadPromise.then(() => {
    if (state.activeView === "home" && !state.loading) renderHome();
  });
}

function appendPaintingsPage(paintings) {
  const byId = new Map(state.paintings.map((painting) => [painting.id, painting]));
  for (const painting of paintings) byId.set(painting.id, painting);
  state.paintings = [...byId.values()];
}

async function loadMorePaintings() {
  if (state.loading || state.loadingMorePaintings || !state.paintingsHasMore || state.paintingsNextFrom == null) return;
  state.loadingMorePaintings = true;
  setStatus("加载更多作品...");
  try {
    const page = await fetchPaintingsPage({ limit: HOME_PAGE_SIZE, from: state.paintingsNextFrom });
    appendPaintingsPage(page.paintings);
    state.paintingsNextFrom = page.nextFrom;
    state.paintingsHasMore = page.hasMore;
    state.paintingsTotalCount = page.totalCount ?? state.paintingsTotalCount;
    const cacheMessage = cachedStatusMessage(page);
    setStatus(cacheMessage, page.offline ? "warning" : "info");
    render();
  } catch (error) {
    console.error("More paintings fetch failed", error);
    setStatus("加载更多作品失败，请稍后重试", "error");
  } finally {
    state.loadingMorePaintings = false;
  }
}

function maybeLoadMoreTagSections() {
  if (state.activeView !== "home" || state.loading || state.error || state.query.trim()) return;
  const remainingDistance = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
  if (remainingDistance > 240) return;

  const tagCount = allTags().length;
  if (state.visibleTagCount >= tagCount) {
    void loadMorePaintings();
    return;
  }

  state.visibleTagCount += TAG_BATCH_SIZE;
  renderHome();
}

function canPullRefresh() {
  return (
    state.activeView === "home" &&
    !state.loading &&
    !state.error &&
    !state.query.trim() &&
    !state.pullRefreshing &&
    window.scrollY <= 0
  );
}

async function pullRefreshHome() {
  await refreshRecommendations();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updatePullRefreshIndicator(phase, distance = state.pullDistance) {
  if (!nodes.pullRefresh) return;
  const threshold = 72;
  const progress = Math.min(distance / threshold, 1);
  const offset = phase === "refreshing" ? 42 : Math.min(distance * 0.48, 42);

  nodes.pullRefresh.dataset.state = phase;
  nodes.pullRefresh.style.setProperty("--pull-progress", String(progress));
  nodes.pullRefresh.style.setProperty("--pull-offset", `${Math.round(offset)}px`);
  nodes.pullRefresh.setAttribute("aria-hidden", String(phase === "idle"));
}

function resetPullRefreshIndicator(delay = 220) {
  window.setTimeout(() => updatePullRefreshIndicator("idle", 0), delay);
}

function handleTouchStart(event) {
  if (!canPullRefresh()) return;
  state.pullStartY = event.touches[0].clientY;
  state.pullDistance = 0;
  state.pulling = true;
  updatePullRefreshIndicator("pulling", 0);
}

function handleTouchMove(event) {
  if (!state.pulling) return;
  state.pullDistance = Math.max(0, event.touches[0].clientY - state.pullStartY);
  updatePullRefreshIndicator(state.pullDistance >= 72 ? "ready" : "pulling");
}

function handleTouchEnd() {
  if (!state.pulling) return;
  const shouldRefresh = state.pullDistance >= 72 && canPullRefresh();
  state.pulling = false;
  state.pullStartY = 0;
  if (shouldRefresh) {
    state.pullRefreshing = true;
    updatePullRefreshIndicator("refreshing", state.pullDistance);
    pullRefreshHome()
      .catch((error) => {
        console.warn("Recommendation refresh failed", error);
        renderHome();
      })
      .finally(() => {
        state.pullRefreshing = false;
        state.pullDistance = 0;
        updatePullRefreshIndicator("done", 0);
        resetPullRefreshIndicator();
      });
    return;
  }
  state.pullDistance = 0;
  updatePullRefreshIndicator("done", 0);
  resetPullRefreshIndicator(140);
}

function handlePointerStart(event) {
  if (!canPullRefresh() || event.button !== 0) return;
  state.pullStartY = event.clientY;
  state.pullDistance = 0;
  state.pulling = true;
  updatePullRefreshIndicator("pulling", 0);
}

function handlePointerMove(event) {
  if (!state.pulling) return;
  state.pullDistance = Math.max(0, event.clientY - state.pullStartY);
  updatePullRefreshIndicator(state.pullDistance >= 72 ? "ready" : "pulling");
}

function handlePointerEnd() {
  handleTouchEnd();
}

function updateNetworkStatus() {
  if (typeof navigator === "undefined") return;
  if (navigator.onLine === false) {
    setStatus(state.paintings.length ? "当前离线，继续显示已加载数据" : "当前离线", "warning");
    return;
  }
  if (state.catalogSource === "cache" || state.error) {
    setStatus("网络已恢复，正在刷新作品数据...");
    void loadPaintings();
  }
}

function iiifInfoUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/\/info\.json(?:\?.*)?$/i.test(url)) return url;
  const match = url.match(/^(.*\/iiif\/(?:2|3)\/[^/]+)\/full\//i);
  return match ? `${match[1]}/info.json` : "";
}

function detailTileSource(item) {
  const iiifUrl = iiifInfoUrl(item?.iiifUrl);
  if (iiifUrl) return iiifUrl;
  return null;
}

function loadOpenSeadragon() {
  if (!openSeadragonModulePromise) {
    openSeadragonModulePromise = import("openseadragon").then((module) => module.default || module);
  }
  return openSeadragonModulePromise;
}

function destroyDetailViewer() {
  if (detailViewer) {
    detailViewer.destroy();
    detailViewer = null;
  }
  if (nodes.detailIiifViewer) nodes.detailIiifViewer.innerHTML = "";
  if (nodes.detailViewerFrame) nodes.detailViewerFrame.hidden = true;
  if (nodes.drawerImage) nodes.drawerImage.hidden = false;
}

function detailArtworkRatio(item) {
  const cachedRatio = Number(readImageRatioCache()[imageUrl(item)]);
  const ratio = cachedRatio || ratioFromDimensions(item?.dimensions);
  return ratio && Number.isFinite(ratio) ? ratio : 1;
}

function setDetailArtworkRatio(item) {
  const ratio = detailArtworkRatio(item);
  nodes.detailViewerFrame?.style.setProperty("--detail-art-ratio", String(ratio));
  nodes.drawerImage?.style.setProperty("--detail-art-ratio", String(ratio));
}

async function mountDetailViewer(item) {
  destroyDetailViewer();
  const tileSource = detailTileSource(item);
  if (!tileSource || !nodes.detailViewerFrame || !nodes.detailIiifViewer) return false;

  const itemId = item.id;
  let OpenSeadragon;
  try {
    OpenSeadragon = await loadOpenSeadragon();
  } catch (error) {
    console.warn("OpenSeadragon failed to load", error);
    return false;
  }
  if (currentDetailItem?.id !== itemId) return false;

  nodes.detailViewerFrame.hidden = false;
  detailViewer = OpenSeadragon({
    element: nodes.detailIiifViewer,
    tileSources: tileSource,
    showNavigationControl: false,
    showNavigator: false,
    gestureSettingsMouse: {
      clickToZoom: true,
      dblClickToZoom: true,
      scrollToZoom: true,
    },
    gestureSettingsTouch: {
      pinchToZoom: true,
      flickEnabled: true,
    },
    minZoomImageRatio: 0.82,
    visibilityRatio: 0.92,
    constrainDuringPan: true,
    animationTime: 0.35,
    blendTime: 0.1,
  });
  detailViewer.addHandler("open", () => {
    if (currentDetailItem?.id !== itemId) return;
    detailViewer.viewport.goHome(true);
    detailViewer.forceRedraw();
    nodes.drawerImage.hidden = true;
  });
  detailViewer.addHandler("open-failed", () => {
    destroyDetailViewer();
    nodes.drawerImage.src = displayImageUrl(item);
    nodes.drawerImage.alt = item.title;
  });
  return true;
}

async function hydrateDetailItem(itemId) {
  try {
    const painting = await fetchPaintingById(itemId);
    if (!painting || currentDetailItem?.id !== itemId) return;
    const hydrated = {
      ...currentDetailItem,
      ...paintingToArtwork(painting),
      detailLoaded: true,
    };
    currentDetailItem = hydrated;
    openDrawer(hydrated);
  } catch (error) {
    console.warn("Detail fetch failed", error);
  }
}

function openDrawer(item) {
  if (!item || !item.id) {
    window.clearTimeout(detailCloseTimer);
    currentDetailItem = null;
    destroyDetailViewer();
    nodes.drawerImage.removeAttribute("src");
    nodes.drawerImage.alt = "";
    nodes.detailTitleCn.textContent = "作品详情";
    nodes.detailTitleEn.textContent = "";
    nodes.detailCreator.textContent = "";
    nodes.detailLocation.textContent = "";
    nodes.detailCreated.textContent = "";
    nodes.detailMedium.textContent = "";
    nodes.detailDimensions.textContent = "";
    nodes.detailDescription.innerHTML = errorStateMarkup({
      ...pageDataErrorCopy(null, "detail"),
      retryLabel: "返回画廊",
      compact: true,
      action: "closeDetail",
    });
    nodes.detailTags.innerHTML = "";
    nodes.drawer.dataset.mounted = "true";
    requestAnimationFrame(() => {
      nodes.drawer.setAttribute("aria-hidden", "false");
    });
    document.body.classList.add("drawer-open");
    bindStateActions(nodes.detailDescription);
    return;
  }

  window.clearTimeout(detailCloseTimer);
  currentDetailItem = item;
  recordHistory(item.id);
  setDetailArtworkRatio(item);
  nodes.drawerImage.src = displayImageUrl(item);
  nodes.drawerImage.alt = item.title;
  mountDetailViewer(item);
  nodes.detailTitleCn.textContent = item.titleCn || item.title;
  nodes.detailTitleEn.textContent = item.titleEn || "";
  nodes.detailCreator.innerHTML = `<button class="detail-artist-button" type="button">${escapeHtml(item.artist)}</button>`;
  nodes.detailCreator.querySelector(".detail-artist-button").addEventListener("click", () => openArtistRoute(item.artist));
  nodes.detailLocation.textContent = item.location;
  nodes.detailCreated.textContent = item.yearAndPlace;
  nodes.detailMedium.textContent = item.medium;
  nodes.detailDimensions.textContent = item.dimensions;
  nodes.detailDescription.innerHTML = descriptionParagraphs(item.description)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
  nodes.detailTags.innerHTML = item.tags
    .slice(0, 8)
    .map((tag) => `<button class="detail-tag-button" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
    .join("");
  nodes.detailTags.querySelectorAll("[data-tag]").forEach((button) => {
    button.addEventListener("click", () => openTagRoute(button.dataset.tag));
  });
  updateDetailFavoriteButton(item.id);
  if (!item.detailLoaded) void hydrateDetailItem(item.id);
  nodes.drawer.dataset.mounted = "true";
  requestAnimationFrame(() => {
    nodes.drawer.setAttribute("aria-hidden", "false");
  });
  document.body.classList.add("drawer-open");
}

function closeDrawer() {
  if (nodes.drawer.getAttribute("aria-hidden") === "true" && nodes.drawer.dataset.mounted !== "true") return;
  window.clearTimeout(detailCloseTimer);
  nodes.drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
  currentDetailItem = null;
  detailCloseTimer = window.setTimeout(() => {
    if (nodes.drawer.getAttribute("aria-hidden") === "true") {
      nodes.drawer.dataset.mounted = "false";
      destroyDetailViewer();
      nodes.drawerImage.removeAttribute("src");
    }
  }, MOTION_PANEL_EXIT_MS);
}

function descriptionParagraphs(value) {
  const parts = String(value || "")
    .split(/\n{2,}|\r\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) return parts;

  const text = parts[0] || "暂无作品描述。";
  if (text.length <= 140) return [text];
  const midpoint = Math.floor(text.length / 2);
  const splitAt = text.indexOf("。", midpoint);
  if (splitAt < 0) return [text];
  return [text.slice(0, splitAt + 1), text.slice(splitAt + 1).trim()].filter(Boolean);
}

function updateDetailFavoriteButton(id) {
  const isFavorite = state.favorites.has(id);
  nodes.detailFavorite.setAttribute("aria-pressed", String(isFavorite));
  nodes.detailFavorite.setAttribute("aria-label", isFavorite ? "取消收藏作品" : "收藏作品");
}

function toggleDetailFavorite() {
  if (!currentDetailItem) return;
  toggleFavorite(currentDetailItem.id);
  updateDetailFavoriteButton(currentDetailItem.id);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[character];
  });
}

async function loadPaintings() {
  state.loading = true;
  state.error = "";
  state.catalogSource = "network";
  state.catalogOffline = false;
  state.catalogCachedAt = "";
  state.paintingsNextFrom = null;
  state.paintingsHasMore = false;
  state.paintingsTotalCount = null;
  state.searchVisibleCount = SEARCH_PAGE_SIZE;
  resetCategoryResults();
  state.visibleTagCount = TAG_BATCH_SIZE;
  state.rowLimits.clear();
  setStatus("");
  render();

  try {
    const page = await fetchPaintingsPage({ limit: HOME_PAGE_SIZE, from: 0 });
    state.paintings = page.paintings;
    state.paintingsNextFrom = page.nextFrom;
    state.paintingsHasMore = page.hasMore;
    state.paintingsTotalCount = page.totalCount ?? page.paintings.length;
    state.catalogSource = page.source;
    state.catalogOffline = page.offline;
    state.catalogCachedAt = page.cachedAt || "";
    const cacheMessage = cachedStatusMessage(page);
    if (cacheMessage) setStatus(cacheMessage, page.offline ? "warning" : "info");
    await refreshRecommendations({ renderAfter: false });
  } catch (error) {
    console.error("Paintings fetch failed", error);
    state.error = error instanceof Error ? error.message : "未知错误";
  } finally {
    state.loading = false;
    render();
  }
}

nodes.navItems.forEach((item) => item.addEventListener("click", () => setView(item.dataset.viewTarget)));
nodes.search.addEventListener("input", (event) => {
  window.clearTimeout(searchDebounceTimer);
  const value = event.target.value;
  searchDebounceTimer = window.setTimeout(() => {
    state.query = value;
    state.searchVisibleCount = SEARCH_PAGE_SIZE;
    renderHome();
  }, SEARCH_DEBOUNCE_MS);
});
nodes.categorySearch?.addEventListener("input", (event) => {
  window.clearTimeout(categorySearchDebounceTimer);
  const value = event.target.value;
  categorySearchDebounceTimer = window.setTimeout(() => {
    state.categoryQuery = value;
    renderCategories();
  }, SEARCH_DEBOUNCE_MS);
});
nodes.refresh?.addEventListener("click", () => {
  refreshRecommendations().catch((error) => {
    console.warn("Recommendation refresh failed", error);
    renderHome();
  });
});
nodes.profilePanelButtons.forEach((button) => {
  button.addEventListener("click", () => openProfileRoute(button.dataset.profilePanel));
});
nodes.profileEdit?.addEventListener("click", () => openProfileRoute("profile"));
nodes.profileAuth?.addEventListener("click", () => {
  if (!isLoggedIn()) openProfileRoute("auth");
  else openProfileRoute("security");
});
nodes.quickFavorite.addEventListener("click", () => {
  setView("me");
  openProfileRoute("favorites");
});
nodes.showFavorite.addEventListener("click", () => {
  setView("me");
  openProfileRoute("favorites");
});
nodes.profileLogout?.addEventListener("click", () => {
  if (isLoggedIn()) handleSignOut();
  else openProfileRoute("auth");
});
nodes.profileRouteClose?.addEventListener("click", closeProfileRoute);
nodes.drawerClose.addEventListener("click", closeDrawer);
nodes.detailDownload?.addEventListener("click", handleDetailDownload);
nodes.detailFavorite.addEventListener("click", toggleDetailFavorite);
document.addEventListener("pointerdown", (event) => addPressFeedback(event.target), { passive: true });
window.addEventListener("scroll", maybeLoadMoreTagSections, { passive: true });
window.addEventListener("touchstart", handleTouchStart, { passive: true });
window.addEventListener("touchmove", handleTouchMove, { passive: true });
window.addEventListener("touchend", handleTouchEnd, { passive: true });
window.addEventListener("touchcancel", handleTouchEnd, { passive: true });
window.addEventListener("pointerdown", handlePointerStart, { passive: true });
window.addEventListener("pointermove", handlePointerMove, { passive: true });
window.addEventListener("pointerup", handlePointerEnd, { passive: true });
window.addEventListener("pointercancel", handlePointerEnd, { passive: true });
window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProfileRoute();
  if (event.key === "Escape") closeDrawer();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateTopbar(state.activeView);
});
nodes.install.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  nodes.install.hidden = true;
});

if (import.meta.env.DEV) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) void registration.unregister();
    });
  }
  if ("caches" in window) {
    caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key);
    });
  }
} else {
  const updateServiceWorker = registerSW({
    immediate: true,
    onOfflineReady() {
      showMotionToast("离线缓存已就绪", "success");
    },
    onNeedRefresh() {
      updateServiceWorker(true);
    },
    onRegisterError(error) {
      console.warn("PWA service worker registration failed", error);
    },
  });
}

render();
initializeAuthState();
startAuthSubscription();
loadPaintings();
