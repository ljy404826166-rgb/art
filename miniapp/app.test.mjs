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
  let appDefinition = null;

  vm.runInNewContext(
    source,
    {
      App(definition) {
        appDefinition = definition;
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
  return initCalls;
}

test("all mini program runtimes use the production environment", () => {
  assert.deepEqual(launchApp(), [
    { env: PRODUCTION_ENV_ID, traceUser: false },
  ]);
});
