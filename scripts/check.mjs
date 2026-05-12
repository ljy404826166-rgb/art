import { readFile } from "node:fs/promises";

const requiredPublicEnv = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
for (const key of requiredPublicEnv) {
  if (!process.env[key] && !process.env.CI) {
    console.warn(`Warning: ${key} is not set in the current shell. Vite will read .env.local at runtime.`);
  }
}

const source = await readFile(new URL("../src/data/seed-artworks.js", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { seedArtworks, featuredArtworkIds } = await import(moduleUrl);

const ids = new Set();
for (const item of seedArtworks) {
  for (const field of ["id", "title", "artist", "year", "sourceUrl", "license", "imageId"]) {
    if (!item[field]) throw new Error(`Missing ${field} on ${item.title || item.id}`);
  }
  if (ids.has(item.id)) throw new Error(`Duplicate artwork id ${item.id}`);
  ids.add(item.id);
}

if (!featuredArtworkIds.length) throw new Error("featuredArtworkIds must not be empty");
console.log(`Validated ${seedArtworks.length} seed artworks and ${featuredArtworkIds.length} featured API ids.`);
