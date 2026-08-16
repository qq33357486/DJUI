#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DJUI 工具：裁边 + 压缩 + 尺寸规范化

把任意透明 PNG 按分类最大边限制压缩，并保留原始比例。
对应工作区 AGENTS.md「加工流程」的第二步。

用法:
    # 自动从 output-dir 目录名推断分类（推荐）
    python trim_compress.py --input-dir 临时文件/去绿幕后 --output-dir 成品素材/icons

    # 显式指定分类
    python trim_compress.py --input-dir 临时文件/去绿幕后 --output-dir 成品素材/buttons --category buttons

    # 只有需要固定画布时才显式指定宽高
    python trim_compress.py --input-dir 输入 --output-dir 输出 --width 1024 --height 512 --padding 40

说明:
    - 自动 alpha 裁边（去掉四周透明像素）
    - 默认保持 alpha 紧裁与原始比例，只限制分类最大边
    - 仅在显式传入 --width/--height 时居中适配到固定画布
    - PNG 量化压缩（默认 192 色，FASTOCTREE 算法）
    - 可选调用 oxipng 做最终无损优化（如果系统装了）
    - 输出文件名自动记录实际尺寸后缀（如 icon_coin_256x180.png）
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


# ---------- DJUI 分类尺寸表（对应工作区 AGENTS.md §3） ----------
# 依据 Apple/Google 移动应用建议：
#   - 单张贴图 ≤ 1024
#   - 常规 UI 元素最大边 ≤ 512
#   - 小图标 ≤ 256

@dataclass(frozen=True)
class AssetSpec:
    """分类默认最大边规范（保留原始宽高比，不强制固定画布）"""
    max_edge: int
    colors: int = 192          # PNG 量化颜色数


DEFAULT_SPECS: dict[str, AssetSpec] = {
    "icons":        AssetSpec(256, 192),   # 功能、物品、状态图标
    "buttons":      AssetSpec(512, 192),   # 保留按钮原比例
    "backgrounds":  AssetSpec(1024, 160),  # 全屏或分区背景
    "frames":       AssetSpec(512, 192),   # 九宫格外框
    "lists":        AssetSpec(512, 192),   # 列表项、卡片
    "decorations":  AssetSpec(512, 192),   # 插画、花纹、角标
    "text":         AssetSpec(512, 192),   # 艺术字标题
    "misc":         AssetSpec(512, 192),   # 未分类
}


# ---------- 命名规范化 ----------

SIZE_SUFFIX = re.compile(r"[_\-]?\d+x?\d*$", re.IGNORECASE)


def normalize_output_name(stem: str, category: str, size: tuple[int, int]) -> str:
    """规范化输出文件名：小写下划线 + 分类前缀 + 尺寸后缀"""
    # 去掉已有的尺寸后缀（如 _512、_1024x512）
    base = SIZE_SUFFIX.sub("", stem)
    base = base.replace(" ", "_").replace("-", "_").lower()
    while "__" in base:
        base = base.replace("__", "_")
    base = base.strip("_")

    # 确保以分类前缀开头
    if not base.startswith(category):
        base = f"{category}_{base}" if base else category

    # 加尺寸后缀：方形只写一边，长方形写 WxH
    w, h = size
    size_str = str(w) if w == h else f"{w}x{h}"
    return f"{base}_{size_str}"


# ---------- 处理 ----------

def alpha_bbox(img: Image.Image):
    return img.getchannel("A").getbbox()


def fit_to_canvas(img: Image.Image, size: tuple[int, int], padding: int) -> Image.Image:
    """仅供明确要求固定画布的素材使用。"""
    bbox = alpha_bbox(img)
    if bbox:
        img = img.crop(bbox)

    max_w = max(1, size[0] - padding * 2)
    max_h = max(1, size[1] - padding * 2)
    scale = min(max_w / img.width, max_h / img.height)
    new_size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))

    resized = img.resize(new_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size[0] - new_size[0]) // 2, (size[1] - new_size[1]) // 2))
    return canvas


def fit_to_max_edge(img: Image.Image, max_edge: int) -> Image.Image:
    """alpha 紧裁后，仅在超过最大边时等比缩小；绝不补透明方形画布。"""
    bbox = alpha_bbox(img)
    if bbox:
        img = img.crop(bbox)

    largest_edge = max(img.width, img.height)
    if largest_edge <= max_edge:
        return img

    scale = max_edge / largest_edge
    new_size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.resize(new_size, Image.Resampling.LANCZOS)


def save_compressed_png(img: Image.Image, dst: Path, colors: int) -> None:
    """PNG 量化 + 高压缩"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    quantized = img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE)
    quantized.save(dst, optimize=True, compress_level=9)


def run_optional_optimizer(path: Path) -> None:
    """如果系统装了 oxipng，调用它做最终无损优化"""
    oxipng = shutil.which("oxipng")
    if oxipng:
        subprocess.run(
            [oxipng, "-o", "4", "--strip", "safe", str(path)],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def normalize_image(
    img: Image.Image,
    max_edge: int,
    canvas_size: tuple[int, int] | None,
    padding: int,
) -> Image.Image:
    if canvas_size is not None:
        return fit_to_canvas(img, canvas_size, padding)
    return fit_to_max_edge(img, max_edge)


def process_file(
    src: Path,
    dst_dir: Path,
    spec: AssetSpec,
    category: str,
    canvas_size: tuple[int, int] | None,
    padding: int,
) -> tuple[Path, int, int]:
    original_size = src.stat().st_size
    img = Image.open(src).convert("RGBA")
    normalized = normalize_image(img, spec.max_edge, canvas_size, padding)

    out_stem = normalize_output_name(src.stem, category, normalized.size)
    dst = dst_dir / f"{out_stem}.png"

    save_compressed_png(normalized, dst, spec.colors)
    run_optional_optimizer(dst)

    return dst, original_size, dst.stat().st_size


# ---------- 分类推断 ----------

def infer_category(output_dir: Path) -> str | None:
    """从输出目录名推断分类（支持中英双语目录名）"""
    name = output_dir.name.lower()
    name_map = {
        "icons": "icons", "icon": "icons", "图标": "icons",
        "buttons": "buttons", "button": "buttons", "按钮": "buttons",
        "backgrounds": "backgrounds", "background": "backgrounds", "bg": "backgrounds", "背景": "backgrounds",
        "frames": "frames", "frame": "frames", "边框": "frames", "框": "frames",
        "lists": "lists", "list": "lists", "card": "lists", "cards": "lists", "列表": "lists", "卡片": "lists",
        "decorations": "decorations", "deco": "decorations", "装饰": "decorations",
        "text": "text", "文字": "text", "标题": "text",
        "misc": "misc", "其他": "misc",
    }
    return name_map.get(name)


# ---------- CLI ----------

def main() -> None:
    parser = argparse.ArgumentParser(description="DJUI: 裁边 + 压缩 + 尺寸规范化（批量）")
    parser.add_argument("--input-dir", type=Path, required=True, help="待处理 PNG 目录")
    parser.add_argument("--output-dir", type=Path, required=True, help="输出目录（成品素材/分类名）")
    parser.add_argument("--category", type=str, default=None,
                        help="显式分类（icons/buttons/...）。不填则从 output-dir 目录名推断")
    parser.add_argument("--width", type=int, default=None, help="明确要求固定画布时的目标宽度")
    parser.add_argument("--height", type=int, default=None, help="明确要求固定画布时的目标高度")
    parser.add_argument("--max-edge", type=int, default=None,
                        help="仅限制最长边并保留原始比例（覆盖分类默认）")
    parser.add_argument("--padding", type=int, default=None,
                        help="固定画布四周 padding；仅配合 --width/--height 使用，默认 0")
    parser.add_argument("--colors", type=int, default=None, help="自定义量化颜色数（默认 192）")
    parser.add_argument("--keep-name", action="store_true", help="不规范化输出文件名")
    args = parser.parse_args()

    # 确定分类
    category = args.category or infer_category(args.output_dir)
    if category is None:
        raise SystemExit(
            f"无法从目录名 '{args.output_dir.name}' 推断分类，请用 --category 显式指定\n"
            f"可选分类: {', '.join(DEFAULT_SPECS.keys())}"
        )

    if category not in DEFAULT_SPECS:
        raise SystemExit(f"未知分类 '{category}'，可选: {', '.join(DEFAULT_SPECS.keys())}")

    spec = DEFAULT_SPECS[category]
    canvas_size: tuple[int, int] | None = None
    padding = 0
    if args.width is not None and args.height is not None:
        if args.max_edge is not None:
            raise SystemExit("--max-edge 不能与 --width/--height 同时使用")
        canvas_size = (args.width, args.height)
        padding = args.padding if args.padding is not None else 0
        spec = AssetSpec(max(args.width, args.height), args.colors if args.colors is not None else spec.colors)
    elif args.width is not None or args.height is not None:
        raise SystemExit("--width 和 --height 必须同时指定")
    else:
        if args.padding is not None:
            raise SystemExit("--padding 仅能与 --width/--height 一起使用")
        spec = AssetSpec(args.max_edge if args.max_edge is not None else spec.max_edge,
                         args.colors if args.colors is not None else spec.colors)

    if spec.max_edge <= 0:
        raise SystemExit("最大边必须为正整数")

    if canvas_size is not None:
        print(f"分类: {category}  固定画布: {canvas_size[0]}x{canvas_size[1]}  padding: {padding}  colors: {spec.colors}")
    else:
        print(f"分类: {category}  最大边: {spec.max_edge}  保留比例/紧裁  colors: {spec.colors}")

    sources = sorted(args.input_dir.glob("*.png"))
    if not sources:
        raise SystemExit(f"未找到 PNG: {args.input_dir}")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    total_old = total_new = 0
    for src in sources:
        try:
            if args.keep_name:
                # 保留原名（不规范化）
                dst = args.output_dir / src.name
                original_size = src.stat().st_size
                img = Image.open(src).convert("RGBA")
                normalized = normalize_image(img, spec.max_edge, canvas_size, padding)
                save_compressed_png(normalized, dst, spec.colors)
                run_optional_optimizer(dst)
                new_size = dst.stat().st_size
            else:
                dst, original_size, new_size = process_file(src, args.output_dir, spec, category, canvas_size, padding)
            ratio = new_size / original_size if original_size else 0
            print(f"  {src.name} -> {dst.name}  {original_size} -> {new_size} bytes ({ratio:.1%})")
            total_old += original_size
            total_new += new_size
        except Exception as e:
            print(f"  [失败] {src.name}: {e}")

    if total_old:
        print(f"\n合计: {total_old} -> {total_new} bytes ({total_new / total_old:.1%})，节省 {total_old - total_new} bytes")


if __name__ == "__main__":
    main()
