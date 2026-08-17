// DJUI Runtime - pure protocol v6 canvas and top-down layout math
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json.Serialization;

namespace DjuiRuntime;

public readonly struct DjuiRectV6
{
    public readonly float X, Y, Width, Height;
    public DjuiRectV6(float x, float y, float width, float height) { X = x; Y = y; Width = width; Height = height; }
}

public struct DjuiInsetsV6
{
    [JsonPropertyName("left")] public float Left { get; set; }
    [JsonPropertyName("top")] public float Top { get; set; }
    [JsonPropertyName("right")] public float Right { get; set; }
    [JsonPropertyName("bottom")] public float Bottom { get; set; }
    public DjuiInsetsV6(float left, float top, float right, float bottom) { Left = left; Top = top; Right = right; Bottom = bottom; }
}

public sealed class DjuiCanvasPlanV6
{
    public float Scale { get; init; }
    public DjuiRectV6 CanvasRect { get; init; }
    public DjuiRectV6 ReferenceRect { get; init; }
    public DjuiRectV6 SafeRect { get; init; }
    public bool Wide { get; init; }
}

public static class DjuiCanvasV6
{
    public static DjuiCanvasPlanV6 CreatePlan(float viewportWidth, float viewportHeight, DjuiInsetsV6 physicalSafeInsets, DjuiProjectV6 project)
    {
        float vw = Math.Max(1, viewportWidth), vh = Math.Max(1, viewportHeight);
        float rw = Math.Max(1, project.Canvas.ReferenceWidth), rh = Math.Max(1, project.Canvas.ReferenceHeight);
        float scale = CanvasScale(project.Canvas.Mode, vw, vh, rw, rh);
        var canvas = new DjuiRectV6(0, 0, vw / scale, vh / scale);
        var reference = new DjuiRectV6((canvas.Width - rw) * 0.5f, (canvas.Height - rh) * 0.5f, rw, rh);
        var safe = Inset(canvas, new DjuiInsetsV6(physicalSafeInsets.Left / scale, physicalSafeInsets.Top / scale, physicalSafeInsets.Right / scale, physicalSafeInsets.Bottom / scale));
        // 宽屏档判定必须方向感知：只有物理宽 > 高 且比值达到阈值才算 wide，竖屏（含折叠屏内屏）不进 wide 档
        bool wide = vw / vh >= project.Responsive.WideRatio;
        return new DjuiCanvasPlanV6 { Scale = scale, CanvasRect = canvas, ReferenceRect = reference, SafeRect = safe, Wide = wide };
    }

    /// <summary>
    /// 引擎已经调用 SetDesignResolution 后，Size 与 SafeZonePadding 都是逻辑坐标。
    /// 此入口直接使用该坐标，不再重复缩放。
    /// </summary>
    public static DjuiCanvasPlanV6 CreateLogicalPlan(float logicalWidth, float logicalHeight, DjuiInsetsV6 logicalSafeInsets, float physicalWidth, float physicalHeight, DjuiProjectV6 project)
    {
        float width = Math.Max(1, logicalWidth), height = Math.Max(1, logicalHeight);
        float rw = Math.Max(1, project.Canvas.ReferenceWidth), rh = Math.Max(1, project.Canvas.ReferenceHeight);
        var canvas = new DjuiRectV6(0, 0, width, height);
        var reference = new DjuiRectV6((width - rw) * 0.5f, (height - rh) * 0.5f, rw, rh);
        var safe = Inset(canvas, logicalSafeInsets);
        float pw = Math.Max(1, physicalWidth), ph = Math.Max(1, physicalHeight);
        return new DjuiCanvasPlanV6
        {
            Scale = 1,
            CanvasRect = canvas,
            ReferenceRect = reference,
            SafeRect = safe,
            // 方向感知：物理横向比值达阈值才算 wide，竖屏不进 wide 档
            Wide = pw / ph >= project.Responsive.WideRatio,
        };
    }

    public static float CanvasScale(string mode, float vw, float vh, float rw, float rh)
    {
        vw = Math.Max(1, vw); vh = Math.Max(1, vh); rw = Math.Max(1, rw); rh = Math.Max(1, rh);
        if (mode == "MatchWidth") return vw / rw;
        if (mode == "MatchHeight") return vh / rh;
        return Math.Min(vw / rw, vh / rh);
    }

    public static DjuiRectV6 Inset(DjuiRectV6 rect, DjuiInsetsV6 insets)
    {
        float l = Math.Max(0, insets.Left), t = Math.Max(0, insets.Top), r = Math.Max(0, insets.Right), b = Math.Max(0, insets.Bottom);
        return new DjuiRectV6(rect.X + l, rect.Y + t, Math.Max(0, rect.Width - l - r), Math.Max(0, rect.Height - t - b));
    }

    public static DjuiRectV6 SelectSafeEdges(DjuiRectV6 canvas, DjuiRectV6 safe, IList<string>? edges)
    {
        bool all = edges == null;
        bool l = all || edges!.Contains("left"), t = all || edges!.Contains("top"), r = all || edges!.Contains("right"), b = all || edges!.Contains("bottom");
        return Inset(canvas, new DjuiInsetsV6(l ? safe.X - canvas.X : 0, t ? safe.Y - canvas.Y : 0, r ? canvas.X + canvas.Width - safe.X - safe.Width : 0, b ? canvas.Y + canvas.Height - safe.Y - safe.Height : 0));
    }
}

public static class DjuiLayoutSolverV6
{
    public static Dictionary<string, DjuiRectV6> SolveV6(DjuiPageV6 page, DjuiCanvasPlanV6 plan)
    {
        var solved = new Dictionary<string, DjuiRectV6>();
        solved[page.Root.Id] = new DjuiRectV6(0, 0, plan.CanvasRect.Width, plan.CanvasRect.Height); // root is local to the window host
        // 图帧锚定:场景画板优先显式声明 backgroundId；旧页面才兼容回退到
        // 根下第一个 stretch Both + image 节点。不要再让新页面依赖节点顺序。
        DjuiRectV6? imageFrame = null;
        string? backgroundId = null;
        foreach (var child in page.Root.Children)
            if (!string.IsNullOrWhiteSpace(child.SceneFrame?.BackgroundId)) { backgroundId = child.SceneFrame.BackgroundId; break; }
        foreach (var child in page.Root.Children)
        {
            var ap = child.Appearance;
            var st = child.Stretch;
            bool both = st?.Style == "Both";
            bool hasImage = !string.IsNullOrEmpty(ap?.Image);
            if (both && hasImage && (backgroundId == null || child.Id == backgroundId)) { imageFrame = ComputeImageFrame(solved: default, child, plan); break; }
        }
        foreach (var child in page.Root.Children) SolveTree(child, plan.CanvasRect, plan, solved, imageFrame);
        return solved;
    }

    /// <summary>cover/contain 后图片在宿主矩形内的可见帧(锚点按 focal,默认居中)。</summary>
    private static DjuiRectV6 ComputeImageFrame(DjuiRectV6 solved, DjuiNodeV6 host, DjuiCanvasPlanV6 plan)
    {
        var rect = SolveV6(host, plan.CanvasRect, plan);
        var ap = host.Appearance;
        float sw = ap?.SourceSize?.Width ?? 0, sh = ap?.SourceSize?.Height ?? 0;
        if (sw <= 0 || sh <= 0) return rect;
        float fx = Math.Clamp(ap?.FocalX ?? 0.5f, 0, 1), fy = Math.Clamp(ap?.FocalY ?? 0.5f, 0, 1);
        string fit = ap?.ImageFit ?? "stretch";
        if (fit == "contain")
        {
            float scale = Math.Min(rect.Width / sw, rect.Height / sh);
            float w = sw * scale, h = sh * scale;
            return new DjuiRectV6(rect.X + (rect.Width - w) * fx, rect.Y + (rect.Height - h) * fy, w, h);
        }
        // cover(默认按 cover 处理):图缩放铺满宿主,可见帧=宿主尺寸,但坐标系取「图内容对齐」—
        // 对锚定语义而言,可见帧就是宿主矩形本身;建筑要钉在图上,需要的是图的完整缩放框:
        float scaleC = Math.Max(rect.Width / sw, rect.Height / sh);
        float fw = sw * scaleC, fh = sh * scaleC;
        return new DjuiRectV6(rect.X + (rect.Width - fw) * fx, rect.Y + (rect.Height - fh) * fy, fw, fh);
    }

    public static DjuiRectV6 SolveV6(DjuiNodeV6 node, DjuiRectV6 parent, DjuiCanvasPlanV6 plan, DjuiRectV6? imageFrame = null)
    {
        var a = node.Anchor; var t = node.Transform; var s = node.Stretch; var ar = node.AspectRatio;
        string side = a?.Side ?? "TopLeft";
        DjuiRectV6 reference = a?.Target == "screen" ? plan.CanvasRect : a?.Target == "safe" ? DjuiCanvasV6.SelectSafeEdges(plan.CanvasRect, plan.SafeRect, a.SafeEdges) : a?.Target == "image" ? (imageFrame ?? plan.CanvasRect) : parent;
        float x, y, w = t?.Width ?? 100, h = t?.Height ?? 100;
        bool hs = s?.Style == "Horizontal" || s?.Style == "Both", vs = s?.Style == "Vertical" || s?.Style == "Both";
        var m = s?.Margins; float ml = m?.Left ?? 0, mt = m?.Top ?? 0, mr = m?.Right ?? 0, mb = m?.Bottom ?? 0;
        Side(side, out float nx, out float ny);
        // side=None 语义:父容器局部坐标(与编辑器 layoutSolver 一致)。
        // 曾经直接用 t.X 当参考系绝对值,父容器被 Center 等锚定位后子节点整体偏移。
        if (side == "None") { x = reference.X + (t?.X ?? 0); y = reference.Y + (t?.Y ?? 0); }
        else { x = reference.X + nx * reference.Width + (t?.X ?? 0) - nx * w; y = reference.Y + ny * reference.Height + (t?.Y ?? 0) - ny * h; }
        if (hs) { x = reference.X + ml; w = Math.Max(0, reference.Width - ml - mr); }
        if (vs) { y = reference.Y + mt; h = Math.Max(0, reference.Height - mt - mb); }
        if (ar != null && ar.Ratio > 0 && ar.Mode != "None")
        {
            if (ar.Mode == "WidthControlsHeight") { var next = w / ar.Ratio; y += (h - next) * 0.5f; h = next; }
            else if (ar.Mode == "HeightControlsWidth") { var next = h * ar.Ratio; x += (w - next) * 0.5f; w = next; }
            else if (ar.Mode == "FitInParent") { float scale = Math.Min(reference.Width / Math.Max(1, w), reference.Height / Math.Max(1, h)); w *= scale; h *= scale; x = reference.X + (reference.Width - w) * 0.5f; y = reference.Y + (reference.Height - h) * 0.5f; }
        }
        return new DjuiRectV6(x, y, w, h);
    }

    private readonly struct SceneSpace
    {
        public readonly DjuiRectV6 Frame;
        public readonly float ScaleX, ScaleY;
        public SceneSpace(DjuiRectV6 frame, DjuiSizeV6 artboard)
        {
            Frame = frame;
            ScaleX = frame.Width / artboard.Width;
            ScaleY = frame.Height / artboard.Height;
        }
        public DjuiRectV6 Map(DjuiRectV6 authored) => new(
            Frame.X + authored.X * ScaleX,
            Frame.Y + authored.Y * ScaleY,
            authored.Width * ScaleX,
            authored.Height * ScaleY);
    }

    private static void SolveTree(
        DjuiNodeV6 node,
        DjuiRectV6 parent,
        DjuiCanvasPlanV6 plan,
        Dictionary<string, DjuiRectV6> output,
        DjuiRectV6? imageFrame = null,
        SceneSpace? sceneSpace = null,
        DjuiRectV6? sceneParent = null)
    {
        DjuiRectV6 rect;
        DjuiRectV6 authoredRect = default;
        if (sceneSpace != null)
        {
            string target = node.Anchor?.Target ?? "parent";
            if (target != "parent")
                throw new InvalidDataException($"DJUI v6: 场景画板内节点 {node.Id} 只能使用 parent 锚点");
            authoredRect = SolveV6(node, sceneParent ?? default, plan);
            rect = sceneSpace.Value.Map(authoredRect);
        }
        else
        {
            rect = SolveV6(node, parent, plan, imageFrame);
        }
        output[node.Id] = rect;
        var frame = node.SceneFrame;
        if (frame?.Artboard is { Width: > 0, Height: > 0 })
        {
            var nextSpace = new SceneSpace(rect, frame.Artboard);
            var authoredRoot = new DjuiRectV6(0, 0, frame.Artboard.Width, frame.Artboard.Height);
            foreach (var child in node.Children) SolveTree(child, rect, plan, output, imageFrame, nextSpace, authoredRoot);
            return;
        }
        foreach (var child in node.Children)
            SolveTree(child, rect, plan, output, imageFrame, sceneSpace, sceneSpace != null ? authoredRect : null);
    }


    private static void Side(string side, out float x, out float y)
    {
        x = side == "Top" || side == "Center" || side == "Bottom" ? 0.5f : side == "TopRight" || side == "Right" || side == "BottomRight" ? 1 : 0;
        y = side == "Left" || side == "Center" || side == "Right" ? 0.5f : side == "BottomLeft" || side == "Bottom" || side == "BottomRight" ? 1 : 0;
    }
}
