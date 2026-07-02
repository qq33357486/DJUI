#if CLIENT

using GameUI.Device;

namespace DjuiRuntime;

public readonly struct DjuiLayoutRect
{
    public readonly float X;
    public readonly float Y;
    public readonly float Width;
    public readonly float Height;
    public readonly float Scale;

    public DjuiLayoutRect(float x, float y, float width, float height, float scale)
    {
        X = x;
        Y = y;
        Width = width;
        Height = height;
        Scale = scale;
    }
}

public sealed class DjuiViewportPlan
{
    public DjuiLayoutRect Viewport { get; init; }
    public DjuiLayoutRect Safe { get; init; }
    public DjuiLayoutRect Content { get; init; }
    public DjuiLayoutRect Background { get; init; }
}

public static class DjuiViewportAdapter
{
    public static DjuiViewportPlan CreatePlan(DjuiPageJson page)
    {
        var viewport = DeviceInfo.PrimaryViewport;
        var size = viewport.Size;
        var safePadding = viewport.SafeZonePadding;
        var adaptation = page.Adaptation;
        var useSafeArea = adaptation?.SafeArea ?? true;
        var designWidth = adaptation?.DesignWidth ?? page.DesignWidth;
        var designHeight = adaptation?.DesignHeight ?? page.DesignHeight;

        var viewportRect = new DjuiLayoutRect(0, 0, MathF.Max(1, size.Width), MathF.Max(1, size.Height), 1);
        var safeLeft = useSafeArea ? MathF.Max(0, safePadding.Left) : 0;
        var safeTop = useSafeArea ? MathF.Max(0, safePadding.Top) : 0;
        var safeRight = useSafeArea ? MathF.Max(0, safePadding.Right) : 0;
        var safeBottom = useSafeArea ? MathF.Max(0, safePadding.Bottom) : 0;
        var safeRect = new DjuiLayoutRect(
            safeLeft,
            safeTop,
            MathF.Max(1, viewportRect.Width - safeLeft - safeRight),
            MathF.Max(1, viewportRect.Height - safeTop - safeBottom),
            1);

        var minScale = adaptation?.MinScale ?? 0.75f;
        var maxScale = adaptation?.MaxScale ?? 1.25f;
        var contentScale = MathF.Min(safeRect.Width / designWidth, safeRect.Height / designHeight);
        contentScale = Math.Clamp(contentScale, minScale, maxScale);
        contentScale = MathF.Min(contentScale, MathF.Min(safeRect.Width / designWidth, safeRect.Height / designHeight));

        var contentWidth = designWidth * contentScale;
        var contentHeight = designHeight * contentScale;
        var contentX = safeRect.X + (safeRect.Width - contentWidth) * 0.5f;
        var contentY = safeRect.Y + (safeRect.Height - contentHeight) * 0.5f;
        var contentRect = new DjuiLayoutRect(contentX, contentY, contentWidth, contentHeight, contentScale);

        var backgroundScale = MathF.Max(viewportRect.Width / designWidth, viewportRect.Height / designHeight);
        var backgroundWidth = designWidth * backgroundScale;
        var backgroundHeight = designHeight * backgroundScale;
        var backgroundRect = new DjuiLayoutRect(
            (viewportRect.Width - backgroundWidth) * 0.5f,
            (viewportRect.Height - backgroundHeight) * 0.5f,
            backgroundWidth,
            backgroundHeight,
            backgroundScale);

        return new DjuiViewportPlan
        {
            Viewport = viewportRect,
            Safe = safeRect,
            Content = contentRect,
            Background = backgroundRect,
        };
    }
}

#endif
