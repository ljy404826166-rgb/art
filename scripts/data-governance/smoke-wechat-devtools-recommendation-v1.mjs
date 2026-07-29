import fs from "node:fs";
import path from "node:path";
import automator from "miniprogram-automator";

const DEFAULT_ENDPOINT = "ws://127.0.0.1:9420";
const OUTPUT_DIR = path.resolve("outputs/recommendation-system/task-06/devtools");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(check, { timeout = 30_000, interval = 500, label = "condition" } = {}) {
  const startedAt = Date.now();
  let lastValue;
  while (Date.now() - startedAt < timeout) {
    lastValue = await check();
    if (lastValue) return lastValue;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${lastValue}`);
}

function artworkIds(section) {
  return (section?.items || []).map((item) => item?._id || item?.id).filter(Boolean);
}

function summarizeSections(sections) {
  return (sections || []).map((section) => ({
    key: section.key,
    title: section.title,
    query_type: section.queryType || "",
    query_id: section.queryId || "",
    item_count: (section.items || []).length,
    artwork_ids: artworkIds(section),
    has_more: section.hasMore !== false,
  }));
}

function changedSectionCount(before, after) {
  const limit = Math.min(before.length, after.length);
  let changed = Math.abs(before.length - after.length);
  for (let index = 0; index < limit; index += 1) {
    if (before[index].key !== after[index].key) changed += 1;
  }
  return changed;
}

async function waitForHomeReady(page) {
  await waitUntil(
    async () => {
      const loading = await page.data("loading");
      const sections = await page.data("sections");
      const firstChannel = Array.isArray(sections) ? sections[1] : null;
      const firstChannelReady =
        firstChannel &&
        ((firstChannel.items || []).length > 0 ||
          firstChannel.hydrated === true ||
          Boolean(firstChannel.sectionError) ||
          firstChannel.hasMore === false);
      return (
        loading === false && Array.isArray(sections) && sections.length > 1 && firstChannelReady
      );
    },
    { label: "home page data" },
  );
  await sleep(3_000);
}

async function run({
  wsEndpoint = process.env.WECHAT_AUTOMATOR_ENDPOINT || DEFAULT_ENDPOINT,
  outputDir = OUTPUT_DIR,
} = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const consoleEvents = [];
  const exceptions = [];
  let miniProgram;
  let cloudDatabaseMocked = false;
  let homePage;

  try {
    miniProgram = await automator.connect({ wsEndpoint });
    miniProgram.on("console", (event) => {
      consoleEvents.push(event);
    });
    miniProgram.on("exception", (event) => {
      exceptions.push(event);
    });

    homePage = await miniProgram.reLaunch("/pages/home/home");
    await waitForHomeReady(homePage);
    await miniProgram.screenshot({
      path: path.join(outputDir, "home-initial.png"),
    });

    const initial = {
      path: homePage.path,
      error: await homePage.data("error"),
      using_fallback: await homePage.data("usingFallback"),
      sections: summarizeSections(await homePage.data("sections")),
    };
    const mixedTitles = initial.sections.filter((section) => section.title.includes(" · "));
    const emptyTitles = initial.sections.filter((section) => !String(section.title || "").trim());

    await homePage.callMethod("onPullDownRefresh");
    await waitForHomeReady(homePage);
    let refreshedSections = summarizeSections(await homePage.data("sections"));
    let refreshAttempts = 1;
    if (changedSectionCount(initial.sections, refreshedSections) === 0) {
      await homePage.callMethod("onPullDownRefresh");
      await waitForHomeReady(homePage);
      refreshedSections = summarizeSections(await homePage.data("sections"));
      refreshAttempts = 2;
    }
    await miniProgram.screenshot({
      path: path.join(outputDir, "home-refreshed.png"),
    });

    const liveSections = await homePage.data("sections");
    const loadIndex = liveSections.findIndex(
      (section, index) =>
        index > 0 && section && section.hasMore !== false && (section.items || []).length > 0,
    );
    if (loadIndex < 0) {
      throw new Error("No hydrated section is available for horizontal loading.");
    }
    const loadBefore = summarizeSections(liveSections)[loadIndex];
    await homePage.callMethod("handleSectionScrollToLower", {
      detail: { sectionIndex: loadIndex },
      currentTarget: { dataset: { sectionIndex: loadIndex } },
    });
    await waitUntil(
      async () => {
        const loadingMore = await homePage.data(`sections[${loadIndex}].loadingMore`);
        return loadingMore === false;
      },
      { label: "horizontal section loading" },
    );
    const loadAfterRaw = await homePage.data(`sections[${loadIndex}]`);
    const loadAfter = summarizeSections([loadAfterRaw])[0];
    const duplicateArtworkIds = loadAfter.artwork_ids.filter(
      (id, index, ids) => ids.indexOf(id) !== index,
    );

    const moreLink = await homePage.$(".section-more");
    if (!moreLink) throw new Error("No section more link found.");
    await moreLink.tap();
    const tagPage = await waitUntil(
      async () => {
        const page = await miniProgram.currentPage();
        return page.path === "pages/tag/tag" ? page : null;
      },
      { label: "section detail navigation" },
    );
    await waitUntil(async () => (await tagPage.data("loading")) === false, {
      label: "section detail data",
    });
    await sleep(2_000);
    const navigation = {
      path: tagPage.path,
      tag: await tagPage.data("tag"),
      query_type: await tagPage.data("queryType"),
      query_id: await tagPage.data("queryId"),
      result_count: ((await tagPage.data("artworks")) || []).length,
      total_count: await tagPage.data("totalCount"),
      error: await tagPage.data("error"),
      using_fallback: await tagPage.data("usingFallback"),
    };
    await miniProgram.screenshot({
      path: path.join(outputDir, "section-detail.png"),
    });

    homePage = await miniProgram.reLaunch("/pages/home/home");
    await waitForHomeReady(homePage);
    await miniProgram.evaluate(() => {
      globalThis.__taskSixOriginalCloudDatabase = wx.cloud.database;
      wx.cloud.database = () => {
        throw new Error("task-six-cloud-outage");
      };
    });
    cloudDatabaseMocked = true;
    await homePage.callMethod("loadArtworks");
    await waitUntil(async () => (await homePage.data("loading")) === false, {
      label: "fallback load",
    });
    const fallback = {
      using_fallback: await homePage.data("usingFallback"),
      error: await homePage.data("error"),
      section_count: ((await homePage.data("sections")) || []).length,
      artwork_count: ((await homePage.data("artworks")) || []).length,
    };
    await miniProgram.screenshot({
      path: path.join(outputDir, "home-fallback.png"),
    });

    await miniProgram.evaluate(() => {
      if (globalThis.__taskSixOriginalCloudDatabase) {
        wx.cloud.database = globalThis.__taskSixOriginalCloudDatabase;
        delete globalThis.__taskSixOriginalCloudDatabase;
      }
    });
    cloudDatabaseMocked = false;
    homePage = await miniProgram.reLaunch("/pages/home/home");
    await waitForHomeReady(homePage);

    const unhandledExceptions = exceptions.map((event) =>
      typeof event === "string" ? event : JSON.stringify(event),
    );
    const report = {
      generated_at: new Date().toISOString(),
      endpoint: wsEndpoint,
      initial,
      title_contract: {
        mixed_titles: mixedTitles,
        empty_titles: emptyTitles,
        ok: mixedTitles.length === 0 && emptyTitles.length === 0,
      },
      refresh: {
        attempts: refreshAttempts,
        changed_section_count: changedSectionCount(initial.sections, refreshedSections),
        before_keys: initial.sections.map((section) => section.key),
        after_keys: refreshedSections.map((section) => section.key),
        ok: changedSectionCount(initial.sections, refreshedSections) > 0,
      },
      horizontal_load: {
        section_index: loadIndex,
        section_title: loadBefore.title,
        before_count: loadBefore.item_count,
        after_count: loadAfter.item_count,
        duplicate_artwork_ids: [...new Set(duplicateArtworkIds)],
        query_type_unchanged: loadBefore.query_type === loadAfter.query_type,
        query_id_unchanged: loadBefore.query_id === loadAfter.query_id,
        ok:
          loadAfter.item_count >= loadBefore.item_count &&
          duplicateArtworkIds.length === 0 &&
          loadBefore.query_type === loadAfter.query_type &&
          loadBefore.query_id === loadAfter.query_id,
      },
      navigation: {
        ...navigation,
        ok:
          navigation.path === "pages/tag/tag" &&
          Boolean(navigation.tag || navigation.query_id) &&
          navigation.result_count > 0 &&
          !navigation.error &&
          !navigation.using_fallback,
      },
      fallback: {
        ...fallback,
        ok:
          fallback.using_fallback === true &&
          fallback.section_count > 0 &&
          fallback.artwork_count > 0,
      },
      runtime: {
        console_event_count: consoleEvents.length,
        exception_count: unhandledExceptions.length,
        exceptions: unhandledExceptions,
        ok: unhandledExceptions.length === 0,
      },
    };
    report.ok = [
      !initial.error && !initial.using_fallback,
      report.title_contract.ok,
      report.refresh.ok,
      report.horizontal_load.ok,
      report.navigation.ok,
      report.fallback.ok,
      report.runtime.ok,
    ].every(Boolean);
    fs.writeFileSync(
      path.join(outputDir, "task-06-devtools-smoke.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    return report;
  } finally {
    if (miniProgram && cloudDatabaseMocked) {
      try {
        await miniProgram.evaluate(() => {
          if (globalThis.__taskSixOriginalCloudDatabase) {
            wx.cloud.database = globalThis.__taskSixOriginalCloudDatabase;
            delete globalThis.__taskSixOriginalCloudDatabase;
          }
        });
        await miniProgram.reLaunch("/pages/home/home");
      } catch {
        // The report preserves the primary failure; reconnecting reloads the app.
      }
    }
    if (miniProgram) miniProgram.disconnect();
  }
}

run()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
