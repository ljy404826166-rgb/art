from __future__ import annotations

import argparse
import csv
import json
import math
from io import StringIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageStat


HEADERS = [
    "id",
    "title_cn",
    "title_en",
    "artist",
    "location",
    "year_and_place",
    "medium",
    "dimensions",
    "description",
    "tags",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--source-dir", type=Path, action="append", required=True)
    parser.add_argument("--batch-size", type=int, default=20)
    return parser.parse_args()


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
    ):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def csv_text(rows: list[dict[str, str]]) -> str:
    stream = StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=HEADERS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return "\ufeff" + stream.getvalue()


def metrics(image: Image.Image) -> dict:
    rgb = image.convert("RGB")
    sample = ImageOps.contain(rgb, (192, 192))
    stat = ImageStat.Stat(sample)
    hsv_stat = ImageStat.Stat(sample.convert("HSV"))
    quantized = sample.quantize(colors=8, method=Image.Quantize.MEDIANCUT).convert("RGB")
    colors = quantized.getcolors(maxcolors=sample.width * sample.height) or []
    palette = [
        {"rgb": list(color), "share": round(count / (sample.width * sample.height), 4)}
        for count, color in sorted(colors, reverse=True)[:8]
    ]
    edge = sample.convert("L").filter(ImageFilter.FIND_EDGES)
    edge_values = list(edge.getdata())
    return {
        "width": rgb.width,
        "height": rgb.height,
        "orientation": (
            "横幅"
            if rgb.width > rgb.height * 1.12
            else "竖幅"
            if rgb.height > rgb.width * 1.12
            else "近方形"
        ),
        "mean_rgb": [round(value, 1) for value in stat.mean],
        "stddev_rgb": [round(value, 1) for value in stat.stddev],
        "mean_saturation": round(hsv_stat.mean[1], 1),
        "mean_brightness": round(hsv_stat.mean[2], 1),
        "edge_density": round(
            sum(1 for value in edge_values if value >= 32) / max(1, len(edge_values)),
            4,
        ),
        "palette": palette,
    }


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sheet_dir = args.output / "contact-sheets"
    sheet_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict[str, str]] = []
    images: dict[str, Path] = {}
    evidence: dict[str, dict] = {}
    source_files: list[str] = []
    for directory in args.source_dir:
        csv_files = sorted(directory.glob("*.csv"), key=lambda path: path.stat().st_mtime)
        if not csv_files:
            raise RuntimeError(f"No CSV found in {directory}")
        source = csv_files[-1]
        source_files.append(str(source))
        with source.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            current = list(reader)
            if list(reader.fieldnames or []) != HEADERS:
                raise RuntimeError(f"Unexpected CSV headers: {source}")
            rows.extend(current)
        for image_path in (directory / "images").glob("*"):
            if image_path.is_file():
                images[image_path.stem] = image_path
        evidence_files = sorted(directory.glob("*.evidence.jsonl"))
        if not evidence_files:
            raise RuntimeError(f"No evidence JSONL found in {directory}")
        for line in evidence_files[-1].read_text(encoding="utf-8").splitlines():
            if line.strip():
                record = json.loads(line)
                evidence[record["image"]["id"]] = record

    expected = [f"{number}_standard" for number in range(args.start, args.end + 1)]
    rows = [row for row in rows if row["id"] in set(expected)]
    rows.sort(key=lambda row: int(row["id"].split("_", 1)[0]))
    ids = [row["id"] for row in rows]
    if ids != expected:
        raise RuntimeError("CSV IDs do not match the requested continuous range")
    if set(images) < set(expected):
        raise RuntimeError(f"Missing images: {sorted(set(expected) - set(images))[:10]}")
    if set(evidence) < set(expected):
        raise RuntimeError(f"Missing evidence: {sorted(set(expected) - set(evidence))[:10]}")

    (args.output / "checkpoint-000-source.csv").write_text(
        csv_text(rows), encoding="utf-8"
    )
    manifest: list[dict] = []
    visual_metrics: dict[str, dict] = {}
    for row in rows:
        record = evidence[row["id"]]
        manifest.append(
            {
                "id": row["id"],
                "title_en": row["title_en"],
                "artist": row["artist"],
                "year_and_place": row["year_and_place"],
                "image_path": str(images[row["id"]]),
                "source_url": record["source"]["url"],
                "raw_tags": record["raw"].get("tags", []),
                "pixel_dimensions": record["image"].get("pixel_dimensions", ""),
            }
        )
        with Image.open(images[row["id"]]) as image:
            visual_metrics[row["id"]] = metrics(image)

    id_font = font(22)
    title_font = font(16)
    cols, rows_per_sheet = 4, 5
    cell_w, cell_h, label_h, pad = 500, 380, 76, 12
    for sheet_index in range(math.ceil(len(manifest) / args.batch_size)):
        current = manifest[
            sheet_index * args.batch_size : (sheet_index + 1) * args.batch_size
        ]
        canvas = Image.new(
            "RGB", (cols * cell_w, rows_per_sheet * cell_h), (242, 239, 232)
        )
        draw = ImageDraw.Draw(canvas)
        for slot, record in enumerate(current):
            col, row_index = slot % cols, slot // cols
            x0, y0 = col * cell_w, row_index * cell_h
            with Image.open(record["image_path"]) as source_image:
                preview = ImageOps.contain(
                    source_image.convert("RGB"),
                    (cell_w - pad * 2, cell_h - label_h - pad * 2),
                )
            px = x0 + (cell_w - preview.width) // 2
            py = y0 + pad + (cell_h - label_h - pad * 2 - preview.height) // 2
            canvas.paste(preview, (px, py))
            draw.rectangle(
                (x0, y0 + cell_h - label_h, x0 + cell_w, y0 + cell_h),
                fill=(252, 250, 246),
            )
            draw.text(
                (x0 + pad, y0 + cell_h - label_h + 6),
                record["id"],
                fill=(20, 20, 20),
                font=id_font,
            )
            title = " ".join(record["title_en"].split())
            if len(title) > 55:
                title = title[:54] + "…"
            draw.text(
                (x0 + pad, y0 + cell_h - label_h + 38),
                title,
                fill=(65, 65, 65),
                font=title_font,
            )
        first_id, last_id = current[0]["id"], current[-1]["id"]
        canvas.save(
            sheet_dir
            / f"sheet-{sheet_index + 1:02d}-{first_id}-{last_id}.jpg",
            quality=92,
        )

    (args.output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (args.output / "visual-metrics.json").write_text(
        json.dumps(visual_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (args.output / "checkpoint.json").write_text(
        json.dumps(
            {
                "status": "prepared",
                "start": args.start,
                "end": args.end,
                "total": len(rows),
                "completed": 0,
                "last_id": None,
                "source_files": source_files,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"rows": len(rows), "sheets": math.ceil(len(rows) / args.batch_size)}))


if __name__ == "__main__":
    main()
