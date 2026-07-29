import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadModule() {
  const filename = fileURLToPath(new URL("./detail-artist-label.js", import.meta.url));
  const module = { exports: {} };
  vm.runInNewContext(
    readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
    },
    { filename },
  );
  return module.exports;
}

const { formatArtistButtonText, shortenRawArtistText } = loadModule();

test("artist button uses canonical Chinese and English names without lifespan", () => {
  assert.equal(
    formatArtistButtonText({
      nameZh: "雅克-路易·大卫",
      nameEn: "Jacques-Louis David",
      lifespan: "1748–1825",
    }),
    "雅克-路易·大卫（Jacques-Louis David）",
  );
});

test("raw bilingual artist text drops nationality and lifespan immediately", () => {
  assert.equal(
    shortenRawArtistText("雅克-路易·大卫（Jacques Louis David, French, 1748-1825）"),
    "雅克-路易·大卫（Jacques Louis David）",
  );
  assert.equal(
    shortenRawArtistText("爱德华·蒙克 (Edvard Munch, 1863-1944)"),
    "爱德华·蒙克（Edvard Munch）",
  );
});

test("an English-only raw label drops its lifespan suffix", () => {
  assert.equal(shortenRawArtistText("Claude Monet, 1840-1926"), "Claude Monet");
});

test("duplicate Chinese and English names are shown once", () => {
  assert.equal(
    formatArtistButtonText({
      nameZh: "Rembrandt",
      nameEn: "Rembrandt",
    }),
    "Rembrandt",
  );
});
