import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadComponent() {
  const source = readFileSync("miniapp/components/artist-portrait/artist-portrait.js", "utf8");
  let definition = null;
  vm.runInNewContext(
    source,
    {
      Component(value) {
        definition = value;
      },
    },
    {
      filename: "miniapp/components/artist-portrait/artist-portrait.js",
    },
  );

  const properties = Object.fromEntries(
    Object.entries(definition.properties).map(([name, config]) => [name, config.value]),
  );
  const events = [];
  const component = {
    properties,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    triggerEvent(name, detail) {
      events.push({ name, detail });
    },
    events,
  };
  for (const [name, method] of Object.entries(definition.methods)) {
    component[name] = method.bind(component);
  }
  component.properties.artist = null;
  definition.lifetimes.attached.call(component);
  return component;
}

test("approved portrait URL is displayed and exposes an accessible label", () => {
  const component = loadComponent();
  component.properties.artist = {
    nameZh: "克洛德·莫奈",
    avatarText: "莫",
    portraitUrl: "https://cdn.example.test/monet.webp",
    portraitStatus: "approved",
  };
  component.preparePortrait();

  assert.equal(component.data.showImage, true);
  assert.equal(component.data.loading, true);
  assert.equal(component.data.failed, false);
  assert.equal(component.data.imageSrc, "https://cdn.example.test/monet.webp");
  assert.equal(component.data.displayText, "莫");
  assert.equal(component.data.ariaLabel, "克洛德·莫奈肖像");
});

test("unapproved URL is never displayed", () => {
  const component = loadComponent();
  component.properties.artist = {
    nameZh: "待审核画家",
    avatarText: "待",
    portraitUrl: "https://cdn.example.test/unreviewed.webp",
    portraitStatus: "rights_blocked",
  };
  component.preparePortrait();

  assert.equal(component.data.showImage, false);
  assert.equal(component.data.loading, false);
  assert.equal(component.data.imageSrc, "");
  assert.equal(component.data.displayText, "待");
});

test("image error immediately falls back to text and emits a diagnostic event", () => {
  const component = loadComponent();
  component.properties.artist = {
    nameEn: "Claude Monet",
    avatarText: "M",
    portrait_url: "https://cdn.example.test/missing.webp",
    portrait_status: "approved",
  };
  component.preparePortrait();
  component.handleError();

  assert.equal(component.data.showImage, false);
  assert.equal(component.data.loading, false);
  assert.equal(component.data.failed, true);
  assert.equal(
    JSON.stringify(component.events),
    JSON.stringify([
      {
        name: "portraiterror",
        detail: {
          src: "https://cdn.example.test/missing.webp",
          fallbackText: "M",
        },
      },
    ]),
  );
});

test("changing artists resets a previous image failure", () => {
  const component = loadComponent();
  component.properties.artist = {
    nameEn: "First Artist",
    avatarText: "F",
    portraitUrl: "https://cdn.example.test/first.webp",
    portraitStatus: "approved",
  };
  component.preparePortrait();
  component.handleError();
  assert.equal(component.data.failed, true);

  component.properties.artist = {
    nameEn: "Second Artist",
    avatarText: "S",
    portraitUrl: "https://cdn.example.test/second.webp",
    portraitStatus: "approved",
  };
  component.preparePortrait();

  assert.equal(component.data.failed, false);
  assert.equal(component.data.showImage, true);
  assert.equal(component.data.imageSrc, "https://cdn.example.test/second.webp");
  assert.equal(component.data.displayText, "S");
});

test("re-observing the same loaded portrait preserves its visible state", () => {
  const component = loadComponent();
  component.properties.artist = {
    id: "claude-monet",
    nameZh: "克洛德·莫奈",
    avatarText: "莫",
    portraitUrl: "https://cdn.example.test/monet.webp",
    portraitStatus: "approved",
  };
  component.preparePortrait();
  component.handleLoad({
    detail: {
      width: 512,
      height: 512,
    },
  });
  assert.equal(component.data.loading, false);
  assert.equal(component.data.showImage, true);

  component.properties.artist = {
    id: "claude-monet",
    nameZh: "克洛德·莫奈",
    avatarText: "莫",
    portraitUrl: "https://cdn.example.test/monet.webp",
    portraitStatus: "approved",
  };
  component.preparePortrait();

  assert.equal(component.data.loading, false);
  assert.equal(component.data.failed, false);
  assert.equal(component.data.showImage, true);
  assert.equal(component.data.imageSrc, "https://cdn.example.test/monet.webp");
});

test("missing avatar text falls back to the first name character", () => {
  const component = loadComponent();
  component.properties.artist = {
    nameZh: "拉斐尔",
  };
  component.preparePortrait();

  assert.equal(component.data.showImage, false);
  assert.equal(component.data.displayText, "拉");
});

test("template uses aspectFill, lazy loading, and image error fallback", () => {
  const template = readFileSync("miniapp/components/artist-portrait/artist-portrait.wxml", "utf8");
  const styles = readFileSync("miniapp/components/artist-portrait/artist-portrait.wxss", "utf8");
  const config = JSON.parse(
    readFileSync("miniapp/components/artist-portrait/artist-portrait.json", "utf8"),
  );

  assert.match(template, /mode="aspectFill"/u);
  assert.match(template, /lazy-load="\{\{lazyLoad\}\}"/u);
  assert.match(template, /binderror="handleError"/u);
  assert.match(template, /wx:else class="artist-portrait-fallback"/u);
  assert.match(styles, /\.artist-portrait-shell\.list/u);
  assert.match(styles, /\.artist-portrait-shell\.detail/u);
  assert.match(styles, /\.artist-portrait-shell\.followed/u);
  assert.equal(config.component, true);
});
