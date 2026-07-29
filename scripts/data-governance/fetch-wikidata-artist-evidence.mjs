#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const AUDIT_FILE = path.resolve(
  "outputs",
  "artist-enrichment",
  "artist-enrichment-audit-20260725T034957Z.json",
);
const BATCH_PATTERN = /^artist-enrichment-(?:candidates|dispositions)-batch-\d+\.json$/;
const OUTPUT_DIR = path.resolve("outputs", "artist-enrichment", "authority-evidence");
const ENTITY_API = "https://www.wikidata.org/w/api.php";
const REFERENCE_PROPERTIES = ["P19", "P20", "P27", "P106", "P135", "P101", "P937"];

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function chunks(values, size = 40) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function preferredText(entity, property) {
  const claims = entity?.claims?.[property] || [];
  const preferred = claims.find((claim) => claim.rank === "preferred") || claims[0];
  return preferred?.mainsnak?.datavalue?.value || null;
}

function entityIds(entity, property) {
  return (entity?.claims?.[property] || [])
    .map((claim) => claim?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
}

function timeText(value) {
  if (!value?.time) return null;
  const match = String(value.time).match(/^([+-])(\d+)-(\d{2})-(\d{2})T/);
  if (!match) return null;
  const year = Number(match[2]) * (match[1] === "-" ? -1 : 1);
  const month = Number(match[3]);
  const day = Number(match[4]);
  return {
    year,
    month: month || null,
    day: day || null,
    precision: Number(value.precision || 0),
    calendar_model: value.calendarmodel || "",
  };
}

function label(entity) {
  return (
    entity?.labels?.zh?.value ||
    entity?.labels?.["zh-hans"]?.value ||
    entity?.labels?.en?.value ||
    ""
  );
}

async function requestJson(url, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "art-miniapp-data-governance/1.0 (artist authority verification)",
        },
      });
      if (response.ok) return response.json();
      lastError = new Error(`Wikidata request failed: ${response.status}`);
      if (response.status !== 429 && response.status < 500) throw lastError;
      const retryAfter = Number(response.headers.get("retry-after") || 0) * 1000;
      await wait(Math.max(retryAfter, attempt * 2000));
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(attempt * 2000);
    }
  }
  throw lastError;
}

async function fetchEntities(ids, props = "labels|aliases|claims|sitelinks") {
  const entities = {};
  for (const batch of chunks([...new Set(ids)].filter(Boolean), 25)) {
    const url = new URL(ENTITY_API);
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", batch.join("|"));
    url.searchParams.set("props", props);
    url.searchParams.set("languages", "zh|zh-hans|en");
    url.searchParams.set("languagefallback", "1");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    const data = await requestJson(url);
    Object.assign(entities, data.entities || {});
    await wait(750);
  }
  return entities;
}

function completedArtistIds(directory) {
  const result = new Set();
  for (const name of fs.readdirSync(directory).filter((item) => BATCH_PATTERN.test(item))) {
    const batch = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    for (const field of ["records", "record_corrections", "record_dispositions"]) {
      for (const record of batch[field] || []) result.add(record._id);
    }
  }
  return result;
}

export async function buildEvidence() {
  const enrichmentDir = path.dirname(AUDIT_FILE);
  const audit = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
  const completed = completedArtistIds(enrichmentDir);
  const targets = audit.artists.filter(
    (artist) => !completed.has(artist._id) && artist.authority_ids?.wikidata,
  );
  const entities = await fetchEntities(targets.map((artist) => artist.authority_ids.wikidata));
  const referencedIds = [];
  for (const entity of Object.values(entities)) {
    for (const property of REFERENCE_PROPERTIES) {
      referencedIds.push(...entityIds(entity, property));
    }
  }
  const references = await fetchEntities(referencedIds, "labels");
  const records = targets.map((artist) => {
    const qid = artist.authority_ids.wikidata;
    const entity = entities[qid];
    const resolved = Object.fromEntries(
      REFERENCE_PROPERTIES.map((property) => [
        property,
        entityIds(entity, property).map((id) => ({
          id,
          label: label(references[id]),
        })),
      ]),
    );
    const birth = timeText(preferredText(entity, "P569"));
    const death = timeText(preferredText(entity, "P570"));
    return {
      artist_id: artist._id,
      priority: artist.research_priority,
      qid,
      wikidata_url: `https://www.wikidata.org/wiki/${qid}`,
      name_zh: label(entity),
      name_en: entity?.labels?.en?.value || "",
      aliases_zh: (entity?.aliases?.zh || entity?.aliases?.["zh-hans"] || []).map(
        (item) => item.value,
      ),
      aliases_en: (entity?.aliases?.en || []).map((item) => item.value),
      birth,
      death,
      birth_places: resolved.P19,
      death_places: resolved.P20,
      countries_of_citizenship: resolved.P27,
      occupations: resolved.P106,
      movements: resolved.P135,
      fields_of_work: resolved.P101,
      work_locations: resolved.P937,
      sitelinks: {
        zh: entity?.sitelinks?.zhwiki?.url || "",
        en: entity?.sitelinks?.enwiki?.url || "",
      },
      audit_comparison: {
        birth_year: artist.birth_year,
        wikidata_birth_year: birth?.year ?? null,
        birth_year_matches: artist.birth_year == null || artist.birth_year === birth?.year,
        death_year: artist.death_year,
        wikidata_death_year: death?.year ?? null,
        death_year_matches: artist.death_year == null || artist.death_year === death?.year,
      },
    };
  });
  return {
    generated_at: new Date().toISOString(),
    source: "Wikidata wbgetentities API",
    source_url: ENTITY_API,
    completed_before_fetch: completed.size,
    targets: records.length,
    priorities: records.reduce((summary, record) => {
      summary[record.priority] = (summary[record.priority] || 0) + 1;
      return summary;
    }, {}),
    mismatched_years: records
      .filter(
        (record) =>
          !record.audit_comparison.birth_year_matches ||
          !record.audit_comparison.death_year_matches,
      )
      .map((record) => ({
        artist_id: record.artist_id,
        ...record.audit_comparison,
      })),
    records,
  };
}

async function main() {
  const evidence = await buildEvidence();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const output = path.join(OUTPUT_DIR, `wikidata-artist-evidence-${timestamp()}.json`);
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        output,
        targets: evidence.targets,
        priorities: evidence.priorities,
        mismatched_years: evidence.mismatched_years,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
