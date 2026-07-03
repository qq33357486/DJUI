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
        float screenWidth, float screenHeight,
        HashSet<string>? measuring = null)
    {
        measuring ??= new HashSet<string>();

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

        return ApplyAutoSize(
            node,
            new SolvedRect(x, y, w, h),
            screenWidth,
            screenHeight,
            sideId ?? DefaultSide,
            target,
            nx,
            ny,
            hStretch,
            vStretch,
            measuring);
    }

    private static SolvedRect ApplyAutoSize(
        DjuiNodeJson node,
        SolvedRect baseRect,
        float screenWidth,
        float screenHeight,
        string sideId,
        string target,
        float sideNx,
        float sideNy,
        bool hStretch,
        bool vStretch,
        HashSet<string> measuring)
    {
        bool autoWidth = UsesAutoWidth(node);
        bool autoHeight = UsesAutoHeight(node);
        if (!autoWidth && !autoHeight) return baseRect;

        if (measuring.Contains(node.Id)) return baseRect;

        bool blockedWidth = false;
        bool blockedHeight = false;
        string widthReason = "";
        string heightReason = "";

        if (autoWidth && hStretch)
        {
            blockedWidth = true;
            widthReason = "自身水平拉伸会覆盖自动宽";
        }
        if (autoHeight && vStretch)
        {
            blockedHeight = true;
            heightReason = "自身垂直拉伸会覆盖自动高";
        }

        foreach (var child in node.Children)
        {
            if (child.Basic?.Visible == false) continue;

            if (autoWidth && !blockedWidth && GetChildAutoSizeConflict(child, true, out var reason))
            {
                blockedWidth = true;
                widthReason = $"{child.Id}: {reason}";
            }
            if (autoHeight && !blockedHeight && GetChildAutoSizeConflict(child, false, out reason))
            {
                blockedHeight = true;
                heightReason = $"{child.Id}: {reason}";
            }
        }

        if (autoWidth && blockedWidth)
            Game.Logger.LogWarning("DJUI: 节点 {Id} 自动宽回退到基准宽：{Reason}", node.Id, widthReason);
        if (autoHeight && blockedHeight)
            Game.Logger.LogWarning("DJUI: 节点 {Id} 自动高回退到基准高：{Reason}", node.Id, heightReason);

        if ((autoWidth && !blockedWidth) || (autoHeight && !blockedHeight))
        {
            measuring.Add(node.Id);
        }
        else
        {
            return baseRect;
        }

        try
        {
            if (!MeasureChildrenBounds(node, baseRect, screenWidth, screenHeight, measuring, out var measuredWidth, out var measuredHeight))
                return baseRect;

            var nextWidth = baseRect.Width;
            var nextHeight = baseRect.Height;

            if (autoWidth && !blockedWidth)
                nextWidth = Math.Max(1, measuredWidth);
            if (autoHeight && !blockedHeight)
                nextHeight = Math.Max(1, measuredHeight);

            var nextX = baseRect.X;
            var nextY = baseRect.Y;
            if (sideId != "None" && target != "none")
            {
                nextX -= sideNx * (nextWidth - baseRect.Width);
                nextY -= (1 - sideNy) * (nextHeight - baseRect.Height);
            }

            return new SolvedRect(nextX, nextY, nextWidth, nextHeight);
        }
        finally
        {
            measuring.Remove(node.Id);
        }
    }

    private static bool MeasureChildrenBounds(
        DjuiNodeJson node,
        SolvedRect containerRect,
        float screenWidth,
        float screenHeight,
        HashSet<string> measuring,
        out float measuredWidth,
        out float measuredHeight)
    {
        measuredWidth = containerRect.Width;
        measuredHeight = containerRect.Height;

        bool hasBounds = false;
        float maxRight = 0;
        float maxBottom = 0;

        foreach (var child in node.Children)
        {
            if (child.Basic?.Visible == false) continue;

            var childSolved = Solve(
                child,
                containerRect.X,
                containerRect.Y,
                containerRect.Width,
                containerRect.Height,
                screenWidth,
                screenHeight,
                measuring);

            var localRight = childSolved.X - containerRect.X + childSolved.Width;
            var localBottom = childSolved.Y - containerRect.Y + childSolved.Height;
            if (!IsFinite(localRight) || !IsFinite(localBottom)) continue;

            maxRight = Math.Max(maxRight, localRight);
            maxBottom = Math.Max(maxBottom, localBottom);
            hasBounds = true;
        }

        if (!hasBounds) return false;

        var padding = node.Layout?.Padding;
        var paddingRight = padding != null && padding.Length >= 3 ? padding[2] : 0;
        var paddingBottom = padding != null && padding.Length >= 4 ? padding[3] : 0;

        measuredWidth = MathF.Ceiling(Math.Max(0, maxRight + paddingRight));
        measuredHeight = MathF.Ceiling(Math.Max(0, maxBottom + paddingBottom));
        return true;
    }

    public static bool ShouldUseNativeAutoWidth(DjuiNodeJson node)
    {
        return UsesAutoWidth(node) && HasVisibleChildren(node) && !HasAutoSizeConflict(node, true);
    }

    public static bool ShouldUseNativeAutoHeight(DjuiNodeJson node)
    {
        return UsesAutoHeight(node) && HasVisibleChildren(node) && !HasAutoSizeConflict(node, false);
    }

    private static bool UsesAutoWidth(DjuiNodeJson node)
    {
        var mode = node.Layout?.AutoSize;
        return mode == "Width" || mode == "Both";
    }

    private static bool UsesAutoHeight(DjuiNodeJson node)
    {
        var mode = node.Layout?.AutoSize;
        return mode == "Height" || mode == "Both";
    }

    private static bool GetChildAutoSizeConflict(DjuiNodeJson child, bool widthAxis, out string reason)
    {
        var anchor = child.Anchor;
        var target = anchor?.Target ?? "parent";
        var sideId = anchor?.Side ?? DefaultSide;
        var stretchStyle = child.Stretch?.Style ?? "None";

        if (target == "screen")
        {
            reason = "锚定到屏幕，尺寸不属于父容器内容流";
            return true;
        }

        if (StretchUsesAxis(stretchStyle, widthAxis))
        {
            reason = widthAxis ? "水平拉伸依赖父宽" : "垂直拉伸依赖父高";
            return true;
        }

        if (sideId == "None" || target == "none")
        {
            reason = "";
            return false;
        }

        if (!AnchorSides.TryGetValue(sideId, out var side))
        {
            reason = "";
            return false;
        }

        if (widthAxis && Math.Abs(side.nx) > 0.001f)
        {
            reason = "水平中/右锚点依赖父宽";
            return true;
        }

        if (!widthAxis && Math.Abs(side.ny - 1f) > 0.001f)
        {
            reason = "垂直中/底锚点依赖父高";
            return true;
        }

        reason = "";
        return false;
    }

    private static bool StretchUsesAxis(string? style, bool widthAxis)
    {
        if (widthAxis) return style == "Horizontal" || style == "Both";
        return style == "Vertical" || style == "Both";
    }

    private static bool HasVisibleChildren(DjuiNodeJson node)
    {
        foreach (var child in node.Children)
        {
            if (child.Basic?.Visible != false) return true;
        }
        return false;
    }

    private static bool HasAutoSizeConflict(DjuiNodeJson node, bool widthAxis)
    {
        var stretchStyle = node.Stretch?.Style ?? "None";
        if (StretchUsesAxis(stretchStyle, widthAxis)) return true;

        foreach (var child in node.Children)
        {
            if (child.Basic?.Visible == false) continue;
            if (GetChildAutoSizeConflict(child, widthAxis, out _)) return true;
        }

        return false;
    }

    private static bool IsFinite(float value)
    {
        return !float.IsNaN(value) && !float.IsInfinity(value);
    }
}
