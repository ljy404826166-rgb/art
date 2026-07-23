import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const EXPERIENCE_ENV_ID = "experience-d2gxlf5bta2349f3e";

function launchApp({ envVersion, accountInfoError } = {}) {
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
        getAccountInfoSync() {
          if (accountInfoError) throw accountInfoError;
          return {
            miniProgram: {
              envVersion,
            },
          };
        },
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

test("develop and trial mini programs use the isolated experience environment", () => {
  for (const envVersion of ["develop", "trial"]) {
    assert.deepEqual(launchApp({ envVersion }), [
      { env: EXPERIENCE_ENV_ID, traceUser: false },
    ]);
  }
});

test("release and unknown runtimes stay on the production environment", () => {
  assert.deepEqual(launchApp({ envVersion: "release" }), [
    { env: PRODUCTION_ENV_ID, traceUser: false },
  ]);
  assert.deepEqual(launchApp({ envVersion: "unknown" }), [
    { env: PRODUCTION_ENV_ID, traceUser: false },
  ]);
  assert.deepEqual(launchApp({ accountInfoError: new Error("account unavailable") }), [
    { env: PRODUCTION_ENV_ID, traceUser: false },
  ]);
});
