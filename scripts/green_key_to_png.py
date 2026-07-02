#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DJUI 工具：去绿幕

将绿幕背景的 AI 生图/截图抠出前景，输出透明 PNG。

用法:
    python green_key_to_png.py --input-dir <含绿幕图目录> --output-dir <输出目录>

说明:
    - 自动批量处理 input-dir 下所有 .png
    - 输出文件名规则:
        * 去掉文件名中的 "-绿幕"、"_绿幕"、" green" 等标记
        * 否则原名输出
    - 算法: HSV 绿色判定 + MaxFilter 边缘扩散 + BFS 连通边缘溢出清除
"""

from __future__ import annotations

import argparse
import colorsys
import re
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


# ---------- 绿色判定 ----------

def hsv(r: int, g: int, b: int) -> tuple[float, float, float]:
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    return h * 360.0, s, v


def distance_to_green(r: int, g: int, b: int) -> float:
    return ((r - 0) ** 2 + (g - 255) ** 2 + (b - 0) ** 2) ** 0.5


def is_chroma_green(r: int, g: int, b: int) -> bool:
    """主体绿幕像素（明亮饱和的纯绿）"""
    h, s, v = hsv(r, g, b)
    return (
        75 <= h <= 150
        and s >= 0.20
        and v >= 0.50
        and g >= 145
        and g - r >= 25
        and g - b >= 25
        and distance_to_green(r, g, b) <= 275
    )


def is_green_fringe(r: int, g: int, b: int) -> bool:
    """绿幕边缘溢出（半透明绿边）"""
    h, s, v = hsv(r, g, b)
    return (
        65 <= h <= 165
        and s >= 0.15
        and v >= 0.30
        and g >= 95
        and g - r >= 15
        and g - b >= 15
        and distance_to_green(r, g, b) <= 310
    )


def is_edge_green_spill(r: int, g: int, b: int) -> bool:
    """连通的弱绿色溢出（从图边向内的污染）"""
    h, s, v = hsv(r, g, b)
    return (
        60 <= h <= 170
        and s >= 0.12
        and v >= 0.12
        and g >= 35
        and g - r >= 8
        and g - b >= 8
    )


# ---------- 核心算法 ----------

def remove_connected_edge_spill(img: Image.Image) -> None:
    """BFS 清除从图边连通进来的绿色溢出"""
    width, height = img.size
    pixels = img.load()
    visited: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()

    def add_if_edge_spill(x: int, y: int) -> None:
        if (x, y) in visited:
            return
        r, g, b, a = pixels[x, y]
        if a == 0 or is_edge_green_spill(r, g, b):
            visited.add((x, y))
            queue.append((x, y))

    for x in range(width):
        add_if_edge_spill(x, 0)
        add_if_edge_spill(x, height - 1)
    for y in range(height):
        add_if_edge_spill(0, y)
        add_if_edge_spill(width - 1, y)

    while queue:
        x, y = queue.popleft()
        r, g, b, a = pixels[x, y]
        if is_edge_green_spill(r, g, b):
            pixels[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                add_if_edge_spill(nx, ny)


def key_image(src: Path, dst: Path) -> None:
    img = Image.open(src).convert("RGBA")
    pixels = img.load()
    width, height = img.size

    # 1. 标记主体绿幕
    mask = Image.new("L", img.size, 0)
    mask_pixels = mask.load()
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            if is_chroma_green(r, g, b):
                mask_pixels[x, y] = 255

    # 2. 边缘扩散 5x5，处理半透明绿边
    fringe = mask.filter(ImageFilter.MaxFilter(5))
    fringe_pixels = fringe.load()

    # 3. 清除主体 + 边缘溢出
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            if mask_pixels[x, y] or (fringe_pixels[x, y] and is_green_fringe(r, g, b)):
                pixels[x, y] = (0, 0, 0, 0)

    # 4. 清除图边连通的弱绿色
    remove_connected_edge_spill(img)

    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst)


# ---------- 命名规范化 ----------

GREEN_MARKERS = re.compile(r"[-_\s]*(?:绿幕|green|greenscreen|chroma)[-_\s]*", re.IGNORECASE)


def normalize_name(stem: str) -> str:
    """去掉文件名中的绿幕标记，避免成品目录里出现'绿幕'字样"""
    cleaned = GREEN_MARKERS.sub("-", stem).strip("-_")
    # 转小写 + 下划线（DJUI 命名规范）
    cleaned = cleaned.replace(" ", "_").replace("-", "_")
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned or stem


# ---------- CLI ----------

def main() -> None:
    parser = argparse.ArgumentParser(description="DJUI: 去绿幕（批量）")
    parser.add_argument("--input-dir", type=Path, required=True, help="含绿幕 PNG 的目录")
    parser.add_argument("--output-dir", type=Path, required=True, help="输出去绿幕后 PNG 的目录")
    parser.add_argument("--keep-name", action="store_true", help="不规范化文件名（保留原始名）")
    args = parser.parse_args()

    sources = sorted(args.input_dir.glob("*.png"))
    if not sources:
        raise SystemExit(f"未找到 PNG: {args.input_dir}")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    for src in sources:
        name = src.stem if args.keep_name else normalize_name(src.stem)
        dst = args.output_dir / f"{name}.png"
        # 防止重名覆盖：加序号
        i = 1
        while dst.exists() and dst != src:
            dst = args.output_dir / f"{name}_{i}.png"
            i += 1
        key_image(src, dst)
        print(f"{src.name} -> {dst.name}")


if __name__ == "__main__":
    main()
