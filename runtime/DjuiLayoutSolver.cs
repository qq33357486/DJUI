// DJUI Runtime - 布局解析引擎（NGUI 风格：锚点管位置，拉伸管大小）
// 与 editor 端 utils/layoutSolver.ts 保持一致
//
// anchor.side (9-way) → 决定控件位置基准
// stretch.style (None/H/V/Both) → 决定控件尺寸是否跟随父级
// aspectRatio → 比例约束（最后应用）

using System;
using System.Collections.Generic;

namespace DjuiRuntime;

/// <summary>
/// 布局求解结果
/// </summary>
public readonly struct SolvedRect
{
    public readonly float X;
    public readonly float Y;
    public readonly float Width;
    public readonly float Height;

    public SolvedRect(float x, float y, float w, float h)
    {
        X = x; Y = y; Width = w; Height = h;
    }
}

/// <summary>
/// 布局解析引擎。对应 editor 端 utils/layoutSolver.ts。
/// </summary>
public static class DjuiLayoutSolver
{
    // 默认值
    private static readonly Vec2Json DefaultPivot = new() { X = 0.5f, Y = 0.5f };
    private const string DefaultSide = "TopLeft";

    // 9-way 锚点表：id → (nx, ny)
    // nx: 0=左 0.5=中 1=右
    // ny: uGUI Y 朝上（0=底 0.5=中 1=顶）
    private static readonly Dictionary<string, (float nx, float ny)> AnchorSides = new()
    {
        { "TopLeft",     (0f,    1f)    },
        { "Top",         (0.5f,  1f)    },
        { "TopRight",    (1f,    1f)    },
        { "Left",        (0f,    0.5f)  },
        { "Center",      (0.5f,  0.5f)  },
        { "Right",       (1f,    0.5f)  },
        { "BottomLeft",  (0f,    0f)    },
        { "Bottom",      (0.5f,  0f)    },
        { "BottomRight", (1f,    0f)    },
    };

    /// <summary>
    /// 解析单个节点的最终屏幕矩形。
    /// </summary>
    public static SolvedRect Solve(
        DjuiNodeJson node,
        float parentX, float parentY,
        float parentWidth, float parentHeight,
        float screenWidth, float screenHeight)
    {
        var t = node.Transform;
        var anchor = node.Anchor;
        var stretch = node.Stretch;
        var ar = node.AspectRatio;

        var target = anchor?.Target ?? "parent";
        var sideId = anchor?.Side ?? DefaultSide;
        var pivot = t?.Pivot ?? DefaultPivot;
        var stretchStyle = stretch?.Style ?? "None";

        // 1. 参考矩形
        float refX, refY, refW, refH;
        if (target == "screen")
        {
            refX = 0; refY = 0; refW = screenWidth; refH = screenHeight;
        }
        else
        {
            refX = parentX; refY = parentY; refW = parentWidth; refH = parentHeight;
        }

        // 2. 获取 9-way 锚点坐标
        float nx = 0f, ny = 1f; // 默认 TopLeft
        if (sideId != null && AnchorSides.TryGetValue(sideId, out var side))
        {
            nx = side.nx;
            ny = side.ny;
        }

        // 锚点位置（屏幕坐标）
        float anchorX = refX + nx * refW;
        float anchorY = refY + (1 - ny) * refH;

        // 3. 拉伸边距
        float ml = stretch?.Margins?.Left ?? 0;
        float mr = stretch?.Margins?.Right ?? 0;
        float mt = stretch?.Margins?.Top ?? 0;
        float mb = stretch?.Margins?.Bottom ?? 0;

        bool hStretch = stretchStyle == "Horizontal" || stretchStyle == "Both";
        bool vStretch = stretchStyle == "Vertical" || stretchStyle == "Both";

        float x, y, w, h;

        // === 无锚点：纯绝对定位（与 editor 一致）===
        if (sideId == "None" || target == "none")
        {
            x = t?.X ?? 0;
            y = t?.Y ?? 0;
            w = t?.Width ?? 100;
            h = t?.Height ?? 100;
            // 拉伸仍生效（基于参考矩形）
            if (hStretch)
            {
                w = Math.Max(0, refW - ml - mr);
                x = refX + ml;
            }
            if (vStretch)
            {
                h = Math.Max(0, refH - mt - mb);
                y = refY + mt;
            }
        }
        else
        {
            // --- 水平轴 ---
            if (hStretch)
            {
                w = Math.Max(0, refW - ml - mr);
                x = refX + ml;
            }
            else
            {
                w = t?.Width ?? 100;
                x = anchorX + (t?.X ?? 0) - nx * w;
            }

            // --- 垂直轴 ---
            if (vStretch)
            {
                h = Math.Max(0, refH - mt - mb);
                y = refY + mt;
            }
            else
            {
                h = t?.Height ?? 100;
                y = anchorY + (t?.Y ?? 0) - (1 - ny) * h;
            }
        }

        // 5. 应用 AspectRatio
        if (ar != null && !string.IsNullOrEmpty(ar.Mode) && ar.Mode != "None")
        {
            float ratio = ar.Ratio ?? 1;
            if (ratio > 0)
            {
                switch (ar.Mode)
                {
                    case "WidthControlsHeight":
                    {
                        float newH = w / ratio;
                        float cy = y + pivot.Y * h;
                        y = cy - pivot.Y * newH;
                        h = newH;
                        break;
                    }
                    case "HeightControlsWidth":
                    {
                        float newW = h * ratio;
                        float cx = x + pivot.X * w;
                        x = cx - pivot.X * newW;
                        w = newW;
                        break;
                    }
                    case "FitInParent":
                    {
                        float scaleW = refW / w;
                        float scaleH = refH / h;
                        float s = Math.Min(scaleW, scaleH);
                        float newW = w * s;
                        float newH = h * s;
                        float cx = refX + pivot.X * refW;
                        float cy = refY + pivot.Y * refH;
                        x = cx - pivot.X * newW;
                        y = cy - pivot.Y * newH;
                        w = newW; h = newH;
                        break;
                    }
                    case "EnvelopeParent":
                    {
                        float scaleW = refW / w;
                        float scaleH = refH / h;
                        float s = Math.Max(scaleW, scaleH);
                        float newW = w * s;
                        float newH = h * s;
                        float cx = refX + pivot.X * refW;
                        float cy = refY + pivot.Y * refH;
                        x = cx - pivot.X * newW;
                        y = cy - pivot.Y * newH;
                        w = newW; h = newH;
                        break;
                    }
                }
            }
        }

        return new SolvedRect(x, y, w, h);
    }
}
