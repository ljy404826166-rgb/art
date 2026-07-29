import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateProjectEntry } from "./check-project-entry.mjs";

const sharedSettings = {
  es6: true,
  postcss: true,
  minified: true,
  minifyWXML: true,
  minifyWXSS: true,
  uglifyFileName: false,
  useCompilerPlugins: false,
};

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "masterpiece-entry-"));
  fs.mkdirSync(path.join(root, "miniapp"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), "{}\n");
  fs.writeFileSync(path.join(root, "vite.config.js"), "export default {};\n");
  fs.writeFileSync(path.join(root, "miniapp", "app.json"), "{}\n");

  const sharedProject = {
    appid: "test-appid",
    compileType: "miniprogram",
    projectname: "masterpiece-native-miniapp",
    libVersion: "3.15.2",
    setting: sharedSettings,
  };

  fs.writeFileSync(
    path.join(root, "miniapp", "project.config.json"),
    JSON.stringify(
      {
        ...sharedProject,
        miniprogramRoot: "./",
        cloudfunctionRoot: "cloudfunctions/",
      },
      null,
      2,
    ),
  );
  return root;
}

test("accepts miniapp as the only WeChat project entry", (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

  assert.deepEqual(validateProjectEntry(fixture).errors, []);
});

test("rejects a duplicate project config at the repository root", (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(fixture, "project.config.json"),
    JSON.stringify({
      appid: "test-appid",
      compileType: "miniprogram",
      miniprogramRoot: "miniapp/",
    }),
  );

  assert.match(
    validateProjectEntry(fixture).errors.join("\n"),
    /仓库根目录不应存在 project\.config\.json/,
  );
});

test("reports an invalid miniapp miniprogram path", (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

  const rootPath = path.join(fixture, "miniapp", "project.config.json");
  const rootConfig = JSON.parse(fs.readFileSync(rootPath, "utf8"));
  rootConfig.miniprogramRoot = "miniapp/";
  fs.writeFileSync(rootPath, JSON.stringify(rootConfig));

  assert.match(validateProjectEntry(fixture).errors.join("\n"), /小程序配置 miniprogramRoot/);
});
