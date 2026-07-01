import test from "node:test";
import assert from "node:assert/strict";

import {
  parsePublishArgs,
  parseReviewedRecordsFromText,
  reviewedRecordToCloudbaseDocument,
} from "./artvee-publish-reviewed.mjs";

test("parsePublishArgs defaults to dry-run and requires an input file", () => {
  assert.throws(() => parsePublishArgs([]), /--input is required/);

  const options = parsePublishArgs([
    "--input",
    "D:\\art\\csv\\reviewed\\artvee-reviewed.jsonl",
    "--cos-upload",
    "--cloudbase-db",
  ]);

  assert.equal(options.run, false);
  assert.equal(options.input, "D:\\art\\csv\\reviewed\\artvee-reviewed.jsonl");
  assert.equal(options.cosUpload, true);
  assert.equal(options.cloudbaseDb, true);
});

test("parseReviewedRecordsFromText accepts only approved reviewed records", () => {
  const approved = {
    review_status: "approved",
    image: { asset_name: "001_standard.jpg", local_path: "D:\\art\\csv\\images\\001_standard.jpg" },
    reviewed_metadata: {
      title_cn: "示例作品",
      title_en: "Example Work",
      artist: "示例艺术家 (Example Artist)",
      location: "示例馆藏 (Example Museum)",
      year_and_place: "1900年，暂不明确",
      medium: "暂不明确",
      dimensions: "暂不明确",
      description: "这是一段通过审核的中文说明。",
      tags: ["风景", "公共领域", "十九世纪", "绘画"],
    },
  };

  assert.equal(parseReviewedRecordsFromText(`${JSON.stringify(approved)}\n`).length, 1);

  assert.throws(
    () => parseReviewedRecordsFromText(`${JSON.stringify({ ...approved, review_status: "pending" })}\n`),
    /not approved/,
  );
});

test("reviewedRecordToCloudbaseDocument publishes reviewed metadata with COS URLs", () => {
  const doc = reviewedRecordToCloudbaseDocument(
    {
      source: {
        name: "Artvee",
        url: "https://artvee.com/dl/example/",
        record_id: "80705",
      },
      image: {
        asset_name: "001_standard.jpg",
      },
      raw: {
        title_en: "Raw Title",
        artist: "Raw Artist",
        license: "Public domain",
      },
      reviewed_metadata: {
        title_cn: "审核标题",
        title_en: "Reviewed Title",
        artist: "审核艺术家 (Reviewed Artist)",
        location: "审核馆藏 (Reviewed Museum)",
        year_and_place: "1900年，法国",
        medium: "布面油画 (Oil on canvas)",
        dimensions: "50 x 60 cm",
        description: "审核后的说明文字。",
        tags: ["风景", "油画", "法国", "公共领域"],
      },
    },
    "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com/ppaintings/001_standard.jpg",
    {
      status: "published",
      cosPrefix: "ppaintings",
      cosDomain: "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com",
    },
  );

  assert.equal(doc._id, "artwork_001_standard");
  assert.equal(doc.title_cn, "审核标题");
  assert.equal(doc.title_en, "Reviewed Title");
  assert.equal(doc.artist, "审核艺术家 (Reviewed Artist)");
  assert.equal(doc.source_record_id, "80705");
  assert.equal(doc.download_url, "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com/ppaintings/001_standard.jpg");
  assert.equal(doc.thumbnail_url, "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com/ppaintings/derivatives/thumb/001_standard.webp");
  assert.deepEqual(doc.tag_keys, ["风景", "油画", "法国", "公共领域"]);
  assert.equal(doc.sync_target, "cloudbase");
});
