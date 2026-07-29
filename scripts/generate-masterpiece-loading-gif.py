from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image


SVG_WIDTH = 8048
LETTER_BOUNDS = [
    (0, 954),
    (1046, 1894),
    (1962, 2599),
    (2679, 3331),
    (3433, 3950),
    (4082, 4745),
    (4865, 5508),
    (5614, 5820),
    (5968, 6485),
    (6582, 7406),
    (7531, 8048),
]


def pulse(letter_index: int, progress: float) -> float:
    distance = letter_index - progress
    return math.exp(-(distance * distance) / (2 * 0.58 * 0.58))


def render_frames(
    wordmark: Image.Image,
    reverse: bool = False,
    target_width: int = 1000,
    canvas_width: int = 1200,
    canvas_height: int = 220,
    frame_count: int = 44,
    base_color: int | None = None,
    active_color: int | None = None,
    background_color: int = 249,
) -> list[Image.Image]:
    wordmark = wordmark.convert("RGBA")
    target_height = round(wordmark.height * target_width / wordmark.width)
    wordmark = wordmark.resize(
        (target_width, target_height),
        Image.Resampling.LANCZOS,
    )

    canvas_size = (canvas_width, canvas_height)
    origin = (
        (canvas_size[0] - target_width) // 2,
        (canvas_size[1] - target_height) // 2,
    )
    default_base, default_active = (18, 205) if reverse else (205, 18)
    base_color = default_base if base_color is None else base_color
    active_color = default_active if active_color is None else active_color
    frames: list[Image.Image] = []

    scaled_bounds = [
        (
            round(start / SVG_WIDTH * target_width),
            round(end / SVG_WIDTH * target_width),
        )
        for start, end in LETTER_BOUNDS
    ]

    for frame_index in range(frame_count):
        progress = -1.15 + frame_index / (frame_count - 1) * 13.3
        frame = Image.new(
            "RGBA",
            canvas_size,
            (background_color, background_color, background_color, 255),
        )

        for letter_index, (left, right) in enumerate(scaled_bounds):
            mask = wordmark.getchannel("A").crop(
                (left, 0, right, target_height),
            )
            intensity = round(
                base_color
                - (base_color - active_color)
                * pulse(letter_index, progress)
            )
            letter = Image.new(
                "RGBA",
                (right - left, target_height),
                (intensity, intensity, intensity, 255),
            )
            letter.putalpha(mask)
            frame.alpha_composite(letter, (origin[0] + left, origin[1]))

        frames.append(frame.convert("P", palette=Image.Palette.ADAPTIVE))

    return frames


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wordmark_png", type=Path)
    parser.add_argument("output_gif", type=Path)
    parser.add_argument(
        "--reverse",
        action="store_true",
        help="Use a black wordmark with a light pulse moving left to right.",
    )
    parser.add_argument("--target-width", type=int, default=1000)
    parser.add_argument("--canvas-width", type=int, default=1200)
    parser.add_argument("--canvas-height", type=int, default=220)
    parser.add_argument("--frame-count", type=int, default=44)
    parser.add_argument("--duration", type=int, default=50)
    parser.add_argument("--base-color", type=int)
    parser.add_argument("--active-color", type=int)
    parser.add_argument("--background-color", type=int, default=249)
    args = parser.parse_args()

    wordmark = Image.open(args.wordmark_png)
    frames = render_frames(
        wordmark,
        reverse=args.reverse,
        target_width=args.target_width,
        canvas_width=args.canvas_width,
        canvas_height=args.canvas_height,
        frame_count=args.frame_count,
        base_color=args.base_color,
        active_color=args.active_color,
        background_color=args.background_color,
    )
    args.output_gif.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        args.output_gif,
        save_all=True,
        append_images=frames[1:],
        duration=args.duration,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(args.output_gif.resolve())


if __name__ == "__main__":
    main()
