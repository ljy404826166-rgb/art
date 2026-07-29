import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const SOURCE_PATH = path.join(PROJECT_ROOT, "miniapp", "services", "search-terms.js");

const source = fs.readFileSync(SOURCE_PATH, "utf8");
const commonJsModule = { exports: {} };
vm.runInNewContext(
  source,
  {
    module: commonJsModule,
    exports: commonJsModule.exports,
    String,
    Set,
    Array,
    Number,
    Math,
  },
  { filename: SOURCE_PATH },
);

export const {
  MAX_ARTWORK_SEARCH_TERMS,
  SEARCH_SOURCE_FIELDS,
  buildArtworkSearchTerms,
  buildSearchQueryTerms,
  normalizeSearchTermText,
} = commonJsModule.exports;
