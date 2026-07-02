#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DJUI 工具：裁边 + 压缩 + 尺寸规范化

把任意透明 PNG 处理成符合 DJUI 成品素材分类规范的尺寸，并做有损压缩。
对应工作区 AGENTS.md「加工流程」的第二步。

用法:
    # 自动从 output-dir 目录名推断分类（推荐）
    python trim_compress.py --input-dir 临时文件/去绿幕后 --output-dir 成品素材/icons

    # 显式指定分类
    python trim_compress.py --input-dir 临时文件/去绿幕后 --output-dir 成品素材/buttons --category buttons

    # 自定义尺寸（覆盖分类默认）
    python trim_compress.py --input-dir 输入 --output-dir 输出 --width 1024 --height 512 --padding 40

说明:
    - 自动 alpha 裁边（去掉四周透明像素）
    - 居中适配到目标尺寸画布（保留比例，加 padding）
    - PNG 量化压缩（默认 192 色，FASTOCTREE 算法）
    - 可选调用 oxipng 做最终无损优化（如果系统装了）
    - 输出文件名自动加尺寸后缀（如 icon_coin_256.png），符合 DJUI 命名规范
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


# ---------- DJUI 分类尺寸表（对应工作区 AGENTS.md §3.3） ----------
# 依据 Apple/Google 移动应用建议：
#   - 单张贴图 ≤ 1024
#   - UI 元素尽量 ≤ 512
#   - 小图标 ≤ 256

@dataclass(frozen=True)
class AssetSpec:
    """分类目标尺寸规范"""
    size: tuple[int, int]      # 目标画布尺寸
    padding: int               # 安全区 padding（四周）
    colors: int = 192          # PNG 量化颜色数


DEFAULT_SPECS: dict[str, AssetSpec] = {
    "icons":        AssetSpec((256, 256),  32, 192),   # 图标
    "buttons":      AssetSpec((512, 128),  24, 192),   # 横长按钮
    "backgrounds":  AssetSpec((1024, 1024), 0, 160),   # 全屏背景
    "frames":       AssetSpec((256, 256),  16, 192),   # 九宫格切片框
    "lists":        AssetSpec((512, 256),  24, 192),   # 列表项/卡片
    "decorations":  AssetSpec((256, 256),  16, 192),   # 装饰物
    "text":         AssetSpec((512, 256),  16, 192),   # 艺术字标题
    "misc":         AssetSpec((512, 512),  24, 192),   # 未分类
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
    """裁边 + 居中适配到目标尺寸画布"""
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


def process_file(src: Path, dst_dir: Path, spec: AssetSpec, category: str) -> tuple[Path, int, int]:
    original_size = src.stat().st_size
    img = Image.open(src).convert("RGBA")
    normalized = fit_to_canvas(img, spec.size, spec.padding)

    out_stem = normalize_output_name(src.stem, category, spec.size)
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
    parser.add_argument("--width", type=int, default=None, help="自定义目标宽度（覆盖分类默认）")
    parser.add_argument("--height", type=int, default=None, help="自定义目标高度（覆盖分类默认）")
    parser.add_argument("--padding", type=int, default=None, help="自定义 padding（覆盖分类默认）")
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
    if args.width is not None and args.height is not None:
        spec = AssetSpec((args.width, args.height), args.padding if args.padding is not None else spec.padding,
                         args.colors if args.colors is not None else spec.colors)
    elif args.width is not None or args.height is not None:
        raise SystemExit("--width 和 --height 必须同时指定")
    elif args.padding is not None or args.colors is not None:
        spec = AssetSpec(spec.size,
                         args.padding if args.padding is not None else spec.padding,
                         args.colors if args.colors is not None else spec.colors)

    print(f"分类: {category}  目标尺寸: {spec.size[0]}x{spec.size[1]}  padding: {spec.padding}  colors: {spec.colors}")

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
                normalized = fit_to_canvas(img, spec.size, spec.padding)
                save_compressed_png(normalized, dst, spec.colors)
                run_optional_optimizer(dst)
                new_size = dst.stat().st_size
            else:
                dst, original_size, new_size = process_file(src, args.output_dir, spec, category)
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
