import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";

function launchApp() {
  const filename = fileURLToPath(new URL("./app.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  const initCalls = [];
  let syncInitializations = 0;
  let appDefinition = null;

  vm.runInNewContext(
    source,
    {
      App(definition) {
        appDefinition = definition;
      },
      require(id) {
        assert.equal(id, "./services/user-library-sync");
        return {
          initializeLibrarySync() {
            syncInitializations += 1;
          },
        };
      },
      wx: {
        cloud: {
          init(options) {
            initCalls.push({ ...options });
          },
        },
      },
    },
    { filename },
  );

  assert.ok(appDefinition);
  appDefinition.onLaunch();
  return {
    appDefinition,
    initCalls,
    syncInitializations,
  };
}

test("all mini program runtimes use the production environment", () => {
  assert.deepEqual(launchApp().initCalls, [{ env: PRODUCTION_ENV_ID, traceUser: false }]);
});

test("personal library sync starts automatically after cloud initialization", () => {
  assert.equal(launchApp().syncInitializations, 1);
});

test("the user-facing application name is Masterpiece", () => {
  assert.equal(launchApp().appDefinition.globalData.appName, "Masterpiece");
  assert.equal(launchApp().appDefinition.globalData.appVersion, "0.1.0");
});

test("the achievements page is registered as a subpage", () => {
  const config = JSON.parse(
    readFileSync(fileURLToPath(new URL("./app.json", import.meta.url)), "utf8"),
  );
  assert.equal(config.pages.includes("pages/achievements/achievements"), true);
  assert.equal(
    config.tabBar.list.some((item) => item.pagePath === "pages/achievements/achievements"),
    false,
  );
});
