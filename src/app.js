import { fetchPaintings } from "./lib/paintings.ts";
import {
  localFavoriteIds,
  localHistoryIds,
  recordRemoteHistory,
  saveLocalFavoriteIds,
  saveLocalHistoryIds,
  syncFavorite,
} from "./lib/user-library.ts";

const ROW_BATCH_SIZE = 8;
const TAG_BATCH_SIZE = 8;
const RECOMMENDATION_IMAGE_HEIGHT = 172;

const state = {
  paintings: [],
  activeView: "home",
  activeCategory: "",
  activeCategoryGroup: "",
  expandedCategoryGroups: new Set(),
  activeProfilePanel: "favorites",
  categoryQuery: "",
  query: "",
  favorites: new Set(localFavoriteIds()),
  history: localHistoryIds(),
  downloads: JSON.parse(localStorage.getItem("artArchive:downloads") || "[]"),
  loading: true,
  error: "",
  visibleTagCount: TAG_BATCH_SIZE,
  rowLimits: new Map(),
  recommendationIds: [],
  tagOrder: [],
  pullStartY: 0,
  pullDistance: 0,
  pulling: false,
  categoryInitialized: false,
};

function mountProfileShell() {
  const profileView = document.querySelector("#meView");
  if (!profileView) return;

  profileView.innerHTML = `
    <section class="profile-identity" aria-label="个人信息">
      <div class="profile-avatar" aria-hidden="true">林</div>
      <h1>林熙和</h1>
      <p>lin.xihe@curatorial.art</p>
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
  navItems: [...document.querySelectorAll("[data-view-target]")],
  viewSections: [...document.querySelectorAll("[data-view-section]")],
  grid: document.querySelector("#galleryGrid"),
  categoryGrid: document.querySelector("#categoryGrid"),
  categoryResults: document.querySelector("#categoryResults"),
  categoryResultTitle: document.querySelector("#categoryResultTitle"),
  categoryResultEyebrow: document.querySelector("#categoryResultEyebrow"),
  categorySearch: document.querySelector("#categorySearchInput"),
  favoriteGrid: document.querySelector("#favoriteGrid"),
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
  refresh: document.querySelector("#refreshButton"),
  profileRefresh: document.querySelector("#profileRefreshButton"),
  quickFavorite: document.querySelector("#favoritesButton"),
  showFavorite: document.querySelector("#showFavoriteButton"),
  install: document.querySelector("#installButton"),
  drawer: document.querySelector("#detailDrawer"),
  drawerClose: document.querySelector("#drawerClose"),
  drawerImage: document.querySelector("#drawerImage"),
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
let profileRouteCloseTimer;

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
    displayUrl: painting.display_url || painting.thumbnail_url || "",
    downloadUrl: painting.download_url || painting.display_url || "#",
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

function filteredArtworks() {
  const query = state.query.trim().toLowerCase();
  return artworks().filter((item) => {
    const haystack = [item.title, item.artist, item.year, item.movement, item.place, item.tags.join(" ")]
      .join(" ")
      .toLowerCase();
    return !query || haystack.includes(query);
  });
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
      body: "下载队列、离线文件与缓存清理会在这里管理。",
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
      body: "当前版本尚未接入 Supabase Auth，退出登录将在账号系统完成后启用。",
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

function openProfileRoute(panel) {
  const config = profileRouteConfig(panel);
  window.clearTimeout(profileRouteCloseTimer);
  nodes.profileRouteTitle.textContent = config.title;
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
  }, 380);
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

function setView(view) {
  state.activeView = view;
  for (const item of nodes.navItems) item.setAttribute("aria-pressed", String(item.dataset.viewTarget === view));
  for (const section of nodes.viewSections) section.hidden = section.dataset.viewSection !== view;
  if (view === "me") renderProfile();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function imageUrl(item) {
  return item.displayUrl || "/assets/icon.svg";
}

function recommendationCard(item) {
  const card = document.createElement("article");
  card.className = "recommendation-card";
  card.innerHTML = `
    <button class="recommendation-image" type="button" aria-label="查看 ${escapeHtml(item.title)}" data-art-title="${escapeHtml(item.title)}">
      <img loading="lazy" src="${escapeHtml(imageUrl(item))}" alt="${escapeHtml(item.title)}" />
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
  const applySize = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const width = Math.round((image.naturalWidth / image.naturalHeight) * RECOMMENDATION_IMAGE_HEIGHT);
    card.style.setProperty("--art-card-width", `${Math.max(72, width)}px`);
  };

  if (image.complete) applySize();
  image.addEventListener("load", applySize, { once: true });
}

function artworkCard(item) {
  const card = document.createElement("article");
  card.className = "art-card";
  card.innerHTML = `
    <button class="image-button" type="button" aria-label="查看 ${escapeHtml(item.title)}" data-art-title="${escapeHtml(item.title)}">
      <img loading="lazy" src="${escapeHtml(imageUrl(item))}" alt="${escapeHtml(item.title)}" />
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
  const imageButton = card.querySelector(".recommendation-image, .image-button");
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

function sectionKey(section) {
  return section.type === "recommendation" ? "recommendation" : `tag:${section.title}`;
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
    if (tagged.length) sections.push({ type: "tag", title: tag.name, artworks: tagged });
  }

  return sections;
}

function renderLoading() {
  nodes.grid.innerHTML = `
    <section class="loading-gallery" aria-label="正在加载作品">
      <div class="loading-row">
        <article class="loading-card">
          <span class="loading-image"></span>
          <span class="loading-line loading-line-title"></span>
          <span class="loading-line loading-line-meta"></span>
        </article>
        <article class="loading-card">
          <span class="loading-image"></span>
          <span class="loading-line loading-line-title"></span>
          <span class="loading-line loading-line-meta"></span>
        </article>
        <article class="loading-card">
          <span class="loading-image"></span>
          <span class="loading-line loading-line-title"></span>
          <span class="loading-line loading-line-meta"></span>
        </article>
        <article class="loading-card">
          <span class="loading-image"></span>
          <span class="loading-line loading-line-title"></span>
          <span class="loading-line loading-line-meta"></span>
        </article>
      </div>
    </section>
  `;
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

function renderRecommendationFeed() {
  if (state.loading) {
    renderLoading();
    return;
  }

  if (state.error) {
    nodes.grid.innerHTML = `<div class="empty-state">读取 paintings 失败：${escapeHtml(state.error)}</div>`;
    return;
  }

  const sections = homeSections();
  nodes.grid.innerHTML = "";
  if (!sections.length) {
    nodes.grid.innerHTML = `<div class="empty-state">paintings 表暂无数据</div>`;
    return;
  }

  if (state.query.trim()) {
    const searchSection = sections[0];
    const group = document.createElement("section");
    group.className = "home-search-results";
    group.innerHTML = `
      <div class="profile-route-heading home-search-results-heading">
        <h1>${escapeHtml(searchSection.title)}</h1>
        <p>${searchSection.artworks.length}件作品</p>
      </div>
      <div class="category-results-grid home-search-results-grid"></div>
    `;
    renderCategoryCards(group.querySelector(".home-search-results-grid"), searchSection.artworks, "没有找到匹配作品");
    nodes.grid.append(group);
    return;
  }

  for (const section of sections) {
    const key = sectionKey(section);
    setInitialRowLimit(key);

    const group = document.createElement("section");
    group.className = "recommendation-group";
    group.innerHTML = `<h2>${escapeHtml(section.title)}</h2><div class="recommendation-row" data-section-key="${escapeHtml(key)}"></div>`;

    const row = group.querySelector(".recommendation-row");
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
    container.innerHTML = `<div class="empty-state">读取失败：${escapeHtml(state.error)}</div>`;
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
    <button class="category-art-image" type="button" aria-label="查看 ${escapeHtml(item.title)}">
      <img loading="lazy" src="${escapeHtml(imageUrl(item))}" alt="${escapeHtml(item.title)}" />
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
  container.innerHTML = "";
  if (state.loading) {
    container.innerHTML = `<div class="empty-state">正在加载 paintings...</div>`;
    return;
  }
  if (state.error) {
    container.innerHTML = `<div class="empty-state">读取失败：${escapeHtml(state.error)}</div>`;
    return;
  }
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.append(...list.map((item) => categoryArtworkCard(item, options)));
}

function renderHome() {
  renderRecommendationFeed();
}

function renderCategories() {
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
        renderCategories();
      });
      row.append(button);
    }
    nodes.categoryGrid.append(section);
  }

  const query = state.categoryQuery.trim().toLowerCase();
  const list = artworks().filter((item) => {
    const matchesTag = state.activeCategory ? itemMatchesTag(item, state.activeCategory) : true;
    const haystack = [item.title, item.titleEn, item.artist, item.location, item.tags.join(" ")]
      .join(" ")
      .toLowerCase();
    return matchesTag && (!query || haystack.includes(query));
  });
  nodes.categoryResultTitle.textContent = "分类结果";
  nodes.categoryResultEyebrow.textContent = `${list.length}件作品`;
  renderCategoryCards(nodes.categoryResults, list, "当前标签下暂无作品");
}

function renderProfileLegacy() {
  const favorites = favoriteArtworks();
  nodes.favoriteCount.textContent = String(favorites.length);
  nodes.libraryCount.textContent = String(state.paintings.length);
  nodes.librarySourceText.textContent = state.error
    ? `Supabase paintings 读取失败：${state.error}`
    : "当前数据来自 Supabase paintings 表。";
  renderCards(nodes.favoriteGrid, favorites, "还没有收藏作品");
}

function renderProfile() {
  const favorites = favoriteArtworks();
  const history = historyArtworks();
  const downloads = Array.isArray(state.downloads) ? state.downloads : [];

  nodes.favoriteCount.textContent = String(favorites.length);
  nodes.historyCount.textContent = String(history.length);
  nodes.downloadCount.textContent = String(downloads.length);
  nodes.libraryCount.textContent = String(state.paintings.length);
  nodes.librarySourceText.textContent = state.error
    ? `Supabase paintings 读取失败：${state.error}`
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
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveFavorites();
  syncFavorite(id, state.favorites.has(id)).catch((error) => {
    console.warn("Favorite sync failed", error);
  });
  render();
}

function refreshRecommendations() {
  state.recommendationIds = shuffle(artworks()).map((item) => item.id);
  state.tagOrder = shuffle(allTags()).map((tag) => tag.name);
  state.visibleTagCount = TAG_BATCH_SIZE;
  state.rowLimits.clear();
  state.rowLimits.set("recommendation", ROW_BATCH_SIZE);
  renderHome();
}

function maybeLoadMoreTagSections() {
  if (state.activeView !== "home" || state.loading || state.error || state.query.trim()) return;
  const remainingDistance = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
  if (remainingDistance > 240) return;

  const tagCount = allTags().length;
  if (state.visibleTagCount >= tagCount) return;

  state.visibleTagCount += TAG_BATCH_SIZE;
  renderHome();
}

function canPullRefresh() {
  return state.activeView === "home" && !state.loading && !state.error && !state.query.trim() && window.scrollY <= 0;
}

function pullRefreshHome() {
  refreshRecommendations();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function handleTouchStart(event) {
  if (!canPullRefresh()) return;
  state.pullStartY = event.touches[0].clientY;
  state.pullDistance = 0;
  state.pulling = true;
}

function handleTouchMove(event) {
  if (!state.pulling) return;
  state.pullDistance = Math.max(0, event.touches[0].clientY - state.pullStartY);
}

function handleTouchEnd() {
  if (!state.pulling) return;
  const shouldRefresh = state.pullDistance >= 72 && canPullRefresh();
  state.pulling = false;
  state.pullStartY = 0;
  state.pullDistance = 0;
  if (shouldRefresh) pullRefreshHome();
}

function handlePointerStart(event) {
  if (!canPullRefresh() || event.button !== 0) return;
  state.pullStartY = event.clientY;
  state.pullDistance = 0;
  state.pulling = true;
}

function handlePointerMove(event) {
  if (!state.pulling) return;
  state.pullDistance = Math.max(0, event.clientY - state.pullStartY);
}

function handlePointerEnd() {
  handleTouchEnd();
}

function openDrawer(item) {
  window.clearTimeout(detailCloseTimer);
  currentDetailItem = item;
  recordHistory(item.id);
  nodes.drawerImage.src = imageUrl(item);
  nodes.drawerImage.alt = item.title;
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
      nodes.drawerImage.removeAttribute("src");
    }
  }, 380);
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
  state.visibleTagCount = TAG_BATCH_SIZE;
  state.rowLimits.clear();
  setStatus("");
  render();

  try {
    state.paintings = await fetchPaintings();
    refreshRecommendations();
  } catch (error) {
    state.error = error instanceof Error ? error.message : "未知错误";
  } finally {
    state.loading = false;
    render();
  }
}

nodes.navItems.forEach((item) => item.addEventListener("click", () => setView(item.dataset.viewTarget)));
nodes.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderHome();
});
nodes.categorySearch?.addEventListener("input", (event) => {
  state.categoryQuery = event.target.value;
  renderCategories();
});
nodes.refresh?.addEventListener("click", refreshRecommendations);
nodes.profilePanelButtons.forEach((button) => {
  button.addEventListener("click", () => openProfileRoute(button.dataset.profilePanel));
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
  openProfileRoute("logout");
});
nodes.profileRouteClose?.addEventListener("click", closeProfileRoute);
nodes.drawerClose.addEventListener("click", closeDrawer);
nodes.detailFavorite.addEventListener("click", toggleDetailFavorite);
window.addEventListener("scroll", maybeLoadMoreTagSections, { passive: true });
window.addEventListener("touchstart", handleTouchStart, { passive: true });
window.addEventListener("touchmove", handleTouchMove, { passive: true });
window.addEventListener("touchend", handleTouchEnd, { passive: true });
window.addEventListener("pointerdown", handlePointerStart, { passive: true });
window.addEventListener("pointermove", handlePointerMove, { passive: true });
window.addEventListener("pointerup", handlePointerEnd, { passive: true });
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProfileRoute();
  if (event.key === "Escape") closeDrawer();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  nodes.install.hidden = false;
});
nodes.install.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  nodes.install.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await registration.update();
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  });
}

render();
loadPaintings();
