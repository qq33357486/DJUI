// DJUI Runtime - 排列算法（纯算法类，零引擎依赖）
// 与 editor 端 utils/layoutSolver.ts 的 arrangeChildren 保持一致，双端语义改动
// （clamp 顺序、取整时机、null 处理）必须同步，并用 .tmp/layout-cases.json 对拍
// 用例验证（容差 0.01），否则双端算法漂移。
//
// 坐标约定：输出为容器局部坐标（内容区 = 容器矩形减四边 padding，顺序 [left, top, right, bottom]），
// 输出不取整（取整只在编辑器烘焙写回 transform 时做）。
//
// 本文件禁止 using 任何引擎命名空间：必须能与 DjuiModels.cs 一起在无引擎环境
// （.tmp/layoutparity 对拍工程，net9.0）编译。

using System;
using System.Collections.Generic;
using System.Linq;

namespace DjuiRuntime;

public static class DjuiLayoutArranger
{
    /// <summary>排列子项输入。Name 为排序键（null 归一空串，排最前）；
    /// HGrow/VGrow 为弹性比例（= widthStretchRatio / heightStretchRatio），列表模式分主轴/交叉轴用，Grid 不参与。</summary>
    public sealed class ArrangerItem
    {
        public string Id = "";
        public string? Name;
        public float Width;
        public float Height;
        public float HGrow;
        public float VGrow;
    }

    /// <summary>排列参数（编辑器 DjuiLayout 的扁平投影：null/缺省由调用方归一为默认值）。</summary>
    public sealed class ArrangerParams
    {
        public string Flow = "Vertical";           // Vertical | Horizontal | Grid
        public float SpacingH;                     // 子项水平间距
        public float SpacingV;                     // 子项垂直间距
        public float PadLeft;
        public float PadTop;
        public float PadRight;
        public float PadBottom;
        public string HAlign = "Left";             // Left | Center | Right | Stretch（Stretch=维持撑满行为，不额外偏移）
        public string VAlign = "Top";              // Top | Center | Bottom | Stretch
        public string GridFlow = "Horizontal";     // Horizontal=水平优先（每行 N 个放满换行）| Vertical=垂直优先（每列 N 个放满换列）
        public int GridCount = 1;                  // 每行/每列个数 N（<1 由算法钳制为 1）
        public string ChildOrder = "Default";      // Default=文档顺序 | ByName=按名称码点升序（稳定排序）
    }

    public readonly record struct ArrangerRect(string Id, float X, float Y, float Width, float Height);

    /// <summary>
    /// 纯排列算法：不依赖节点/控件结构，输入容器尺寸 + 排列参数 + 子项尺寸，输出容器局部坐标矩形。
    /// a) 排序：ChildOrder='ByName' 时按 Name 码点升序稳定排序（无名项归一空串排最前，比较相等保持文档序；
    ///    OrderBy(Ordinal) 稳定排序，禁 culture——须与 JS 侧 sort 比较器逐字一致）；Default=文档序。
    ///    排序只决定排列位置的计算顺序，禁止改动子项集合本身。
    /// b) Vertical：间距 SpacingV；VGrow>0 子项按比例分「内高-总间距-固定高」的剩余高，固定子项取自身高；
    ///    交叉轴宽 HGrow>0 时撑满内宽。
    /// c) Horizontal：与 b) 对称（SpacingH 主轴、HGrow 分宽、VGrow>0 撑满内高）。
    /// d) Grid：GridCount 兜底 Math.Max(1, ·)，严格按个数断行/断列（绝不按容器宽度自动换行）；
    ///    水平优先=每行 N 个放满换行，行高=行内子项最大高、行内顶对齐；垂直优先对称（列宽=列内最大宽、
    ///    列内左对齐）；格子尺寸=子项自身尺寸（不设统一格宽高，stretchRatio 不参与）。
    /// e) 内容对齐：先按贴起点 (PadLeft, PadTop) 排出内容块包围盒（含 spacing），再整体偏移——
    ///    Center=max(0, (内尺寸-内容尺寸)/2)、Right/Bottom=max(0, 内尺寸-内容尺寸)、Left/Top/Stretch=0；
    ///    超出内容区时贴起点照排、绝不压缩（offset 钳 0）；Stretch=维持撑满行为，不额外偏移。
    /// </summary>
    public static List<ArrangerRect> Arrange(float containerW, float containerH, ArrangerParams p, List<ArrangerItem> items)
    {
        if (items == null || items.Count == 0) return new List<ArrangerRect>();

        // a) 排序（OrderBy 返回新序列，不改动调用方列表）
        List<ArrangerItem> ordered = items;
        if (p.ChildOrder == "ByName")
            ordered = items.OrderBy(i => i.Name ?? string.Empty, StringComparer.Ordinal).ToList();

        var padLeft = p.PadLeft;
        var padTop = p.PadTop;
        var innerW = containerW - padLeft - p.PadRight;
        var innerH = containerH - padTop - p.PadBottom;

        var rects = new List<ArrangerRect>(ordered.Count);

        if (p.Flow == "Vertical")
        {
            // b) 垂直堆叠
            var spacing = p.SpacingV;
            var totalSpacing = spacing * (ordered.Count - 1);
            var availH = innerH - totalSpacing;

            // 第一遍：算出固定高度和需要 flex 的
            var heights = new float[ordered.Count];
            var fixedH = 0f;
            var totalGrow = 0f;
            for (var i = 0; i < ordered.Count; i++)
            {
                var it = ordered[i];
                if (it.VGrow > 0)
                {
                    heights[i] = -1f; // 待定
                    totalGrow += it.VGrow;
                }
                else
                {
                    heights[i] = it.Height;
                    fixedH += it.Height;
                }
            }

            // 分配 flex 空间
            var freeH = Math.Max(0f, availH - fixedH);
            for (var i = 0; i < ordered.Count; i++)
            {
                if (heights[i] == -1f)
                    heights[i] = totalGrow > 0f ? freeH * ordered[i].VGrow / totalGrow : 0f;
            }

            // 排列（贴起点）
            var curY = padTop;
            for (var i = 0; i < ordered.Count; i++)
            {
                var it = ordered[i];
                var w = it.HGrow > 0f ? innerW : it.Width;
                rects.Add(new ArrangerRect(it.Id, padLeft, curY, w, heights[i]));
                curY += heights[i] + spacing;
            }
        }
        else if (p.Flow == "Horizontal")
        {
            // c) 水平堆叠（与垂直对称）
            var spacing = p.SpacingH;
            var totalSpacing = spacing * (ordered.Count - 1);
            var availW = innerW - totalSpacing;

            var widths = new float[ordered.Count];
            var fixedW = 0f;
            var totalGrow = 0f;
            for (var i = 0; i < ordered.Count; i++)
            {
                var it = ordered[i];
                if (it.HGrow > 0f)
                {
                    widths[i] = -1f; // 待定
                    totalGrow += it.HGrow;
                }
                else
                {
                    widths[i] = it.Width;
                    fixedW += it.Width;
                }
            }

            var freeW = Math.Max(0f, availW - fixedW);
            for (var i = 0; i < ordered.Count; i++)
            {
                if (widths[i] == -1f)
                    widths[i] = totalGrow > 0f ? freeW * ordered[i].HGrow / totalGrow : 0f;
            }

            var curX = padLeft;
            for (var i = 0; i < ordered.Count; i++)
            {
                var it = ordered[i];
                var h = it.VGrow > 0f ? innerH : it.Height;
                rects.Add(new ArrangerRect(it.Id, curX, padTop, widths[i], h));
                curX += widths[i] + spacing;
            }
        }
        else
        {
            // d) 网格
            var count = Math.Max(1, p.GridCount);
            if (p.GridFlow == "Vertical")
            {
                // 垂直优先：每 count 个一列放满换列；列宽=列内子项最大宽，列内左对齐
                var colLeft = padLeft;
                for (var start = 0; start < ordered.Count; start += count)
                {
                    var end = Math.Min(start + count, ordered.Count);
                    var colW = 0f;
                    for (var i = start; i < end; i++) colW = Math.Max(colW, ordered[i].Width);
                    var curY = padTop;
                    for (var i = start; i < end; i++)
                    {
                        var it = ordered[i];
                        rects.Add(new ArrangerRect(it.Id, colLeft, curY, it.Width, it.Height));
                        curY += it.Height + p.SpacingV;
                    }
                    colLeft += colW + p.SpacingH;
                }
            }
            else
            {
                // 水平优先：每 count 个一行放满换行；行高=行内子项最大高，行内顶对齐
                var rowTop = padTop;
                for (var start = 0; start < ordered.Count; start += count)
                {
                    var end = Math.Min(start + count, ordered.Count);
                    var rowH = 0f;
                    for (var i = start; i < end; i++) rowH = Math.Max(rowH, ordered[i].Height);
                    var curX = padLeft;
                    for (var i = start; i < end; i++)
                    {
                        var it = ordered[i];
                        rects.Add(new ArrangerRect(it.Id, curX, rowTop, it.Width, it.Height));
                        curX += it.Width + p.SpacingH;
                    }
                    rowTop += rowH + p.SpacingV;
                }
            }
        }

        // e) 内容对齐：内容块包围盒（相对内容起点）→ 整体偏移
        var contentW = 0f;
        var contentH = 0f;
        foreach (var r in rects)
        {
            contentW = Math.Max(contentW, r.X - padLeft + r.Width);
            contentH = Math.Max(contentH, r.Y - padTop + r.Height);
        }
        var offsetX = 0f;
        if (p.HAlign == "Center") offsetX = Math.Max(0f, (innerW - contentW) / 2f);
        else if (p.HAlign == "Right") offsetX = Math.Max(0f, innerW - contentW);
        var offsetY = 0f;
        if (p.VAlign == "Center") offsetY = Math.Max(0f, (innerH - contentH) / 2f);
        else if (p.VAlign == "Bottom") offsetY = Math.Max(0f, innerH - contentH);
        if (offsetX != 0f || offsetY != 0f)
        {
            for (var i = 0; i < rects.Count; i++)
                rects[i] = rects[i] with { X = rects[i].X + offsetX, Y = rects[i].Y + offsetY };
        }

        return rects;
    }
}
