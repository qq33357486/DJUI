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
    /// <summary>排列子项输入。Name 为排序键（null 归一空串，排最前）。
    /// 0.30.0 起排列语义统一：子项弹性比例不参与排列（旧列表模式弹性由编辑器 patches 迁移收编）。</summary>
    public sealed class ArrangerItem
    {
        public string Id = "";
        public string? Name;
        public float Width;
        public float Height;
    }

    /// <summary>排列参数（编辑器 DjuiLayout 的扁平投影：null/缺省由调用方归一为默认值）。</summary>
    public sealed class ArrangerParams
    {
        public string FlowDirection = "LeftToRight"; // LeftToRight/RightToLeft=每行 N 个（换行向下）| TopDown/BottomUp=每列 N 个（换列向右）
        public float SpacingH;                       // 子项水平间距
        public float SpacingV;                       // 子项垂直间距
        public float PadLeft;
        public float PadTop;
        public float PadRight;
        public float PadBottom;
        public string HAlign = "Left";               // 起始锚点（内容块整体停靠）：Left | Center | Right（Stretch 与 Left 等价）
        public string VAlign = "Top";                // Top | Center | Bottom（Stretch 与 Top 等价）
        public int GridCount = 1;                    // 每行/每列个数 N（<1 由算法钳制为 1；1=单行条/单列列表）
        public float OffsetX;                        // 锚点定位后的显式偏移（= layout.contentOffset[0]，不钳制）
        public float OffsetY;                        // = layout.contentOffset[1]
        public string ChildOrder = "Default";        // Default=文档顺序 | ByName=按名称码点升序（稳定排序）
    }

    public readonly record struct ArrangerRect(string Id, float X, float Y, float Width, float Height);

    /// <summary>
    /// 纯排列算法：不依赖节点/控件结构，输入容器尺寸 + 排列参数 + 子项尺寸，输出容器局部坐标矩形。
    /// a) 排序：ChildOrder='ByName' 时按 Name 码点升序稳定排序（无名项归一空串排最前，比较相等保持文档序；
    ///    OrderBy(Ordinal) 稳定排序，禁 culture——须与 JS 侧 sort 比较器逐字一致）；Default=文档序。
    ///    排序只决定排列位置的计算顺序，禁止改动子项集合本身。
    /// b) 排列（单一网格语义，单列/单行/网格统一）：GridCount 兜底 Math.Max(1, ·)，严格按个数断行/断列
    ///    （绝不按容器宽度自动换行）；格子尺寸=子项自身尺寸（不设统一格宽高，弹性比例不参与）。
    ///    流向四向：LeftToRight=每行 N 个左→右换行向下；RightToLeft=行内右→左（子项右缘贴推进沿），
    ///    换行向下；TopDown=每列 N 个上→下换列向右；BottomUp=列内下→上（子项底缘贴推进沿），换列向右。
    ///    行内交叉轴对齐恒贴起点（每行的子项顶对齐、每列的子项左对齐），不随流向镜像；
    ///    行高=行内子项最大高、列宽=列内子项最大宽。
    /// c) 起始锚点 + 偏移：先按贴起点 (PadLeft, PadTop) 排出内容块包围盒（含 spacing），锚点整体偏移——
    ///    Center=max(0, (内尺寸-内容尺寸)/2)、Right/Bottom=max(0, 内尺寸-内容尺寸)、Left/Top/Stretch=0
    ///    （超出内容区时贴起点照排、绝不压缩，锚点偏移钳 0）；
    ///    再叠加显式偏移 OffsetX/OffsetY（不钳制，允许负值与越界——显式意图优先）。
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

        // b) 排列（单一网格语义）
        var count = Math.Max(1, p.GridCount);
        var horizontalRows = p.FlowDirection == "LeftToRight" || p.FlowDirection == "RightToLeft";
        if (horizontalRows)
        {
            // 每行 N 个，换行向下；行高=行内最大高，行内顶对齐（交叉轴不随流向镜像）
            var rowTop = padTop;
            for (var start = 0; start < ordered.Count; start += count)
            {
                var end = Math.Min(start + count, ordered.Count);
                var rowH = 0f;
                for (var i = start; i < end; i++) rowH = Math.Max(rowH, ordered[i].Height);
                if (p.FlowDirection == "RightToLeft")
                {
                    // 行内右→左：子项右缘贴推进沿（起点=内容区右缘）
                    var curRight = padLeft + innerW;
                    for (var i = start; i < end; i++)
                    {
                        var it = ordered[i];
                        rects.Add(new ArrangerRect(it.Id, curRight - it.Width, rowTop, it.Width, it.Height));
                        curRight -= it.Width + p.SpacingH;
                    }
                }
                else
                {
                    var curX = padLeft;
                    for (var i = start; i < end; i++)
                    {
                        var it = ordered[i];
                        rects.Add(new ArrangerRect(it.Id, curX, rowTop, it.Width, it.Height));
                        curX += it.Width + p.SpacingH;
                    }
                }
                rowTop += rowH + p.SpacingV;
            }
        }
        else
        {
            // 每列 N 个，换列向右；列宽=列内最大宽，列内左对齐（交叉轴不随流向镜像）
            var colLeft = padLeft;
            for (var start = 0; start < ordered.Count; start += count)
            {
                var end = Math.Min(start + count, ordered.Count);
                var colW = 0f;
                for (var i = start; i < end; i++) colW = Math.Max(colW, ordered[i].Width);
                if (p.FlowDirection == "BottomUp")
                {
                    // 列内下→上：子项底缘贴推进沿（起点=内容区下缘）
                    var curBottom = padTop + innerH;
                    for (var i = start; i < end; i++)
                    {
                        var it = ordered[i];
                        rects.Add(new ArrangerRect(it.Id, colLeft, curBottom - it.Height, it.Width, it.Height));
                        curBottom -= it.Height + p.SpacingV;
                    }
                }
                else
                {
                    var curY = padTop;
                    for (var i = start; i < end; i++)
                    {
                        var it = ordered[i];
                        rects.Add(new ArrangerRect(it.Id, colLeft, curY, it.Width, it.Height));
                        curY += it.Height + p.SpacingV;
                    }
                }
                colLeft += colW + p.SpacingH;
            }
        }

        // c) 起始锚点：内容块包围盒（相对内容起点）→ 整体偏移；再叠加显式偏移（不钳制）
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
        offsetX += p.OffsetX;
        offsetY += p.OffsetY;
        for (var i = 0; i < rects.Count; i++)
            rects[i] = rects[i] with { X = rects[i].X + offsetX, Y = rects[i].Y + offsetY };

        return rects;
    }
}
