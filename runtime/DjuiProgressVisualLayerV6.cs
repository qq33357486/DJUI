// DJUI Runtime - v6 linear progress visual layer
#if CLIENT

using GameUI.Control;
using GameUI.Enum;
using GameUI.Struct;

namespace DjuiRuntime;

/// <summary>
/// Renders linear Progress nodes as a rounded clipping host plus a full-size image.
/// The image is never compressed to the current value, so tiny values keep their round cap.
/// Circular modes stay on StarEngine's native Progress path.
/// </summary>
internal sealed class DjuiProgressVisualLayerV6 : IDisposable, IThinker
{
    internal const string ReservedNamePrefix = "__djui.v6.visual.progress.";
    private static readonly Dictionary<Progress, DjuiProgressVisualLayerV6> Owners = new();
    private readonly Dictionary<Progress, State> _states = new();
    private bool _disposed;

    public bool DoesThink { get; set; } = true;

    public DjuiProgressVisualLayerV6()
    {
        Game.RegisterThinker(this);
    }

    public void Apply(string nodeId, Progress authored, DjuiAppearanceV6? appearance)
    {
        authored.Image = "";
        authored.SlicedEdges = new Thickness(0, 0, 0, 0);

        if (string.IsNullOrWhiteSpace(appearance?.Image))
        {
            Remove(authored);
            return;
        }

        if (!_states.TryGetValue(authored, out var state))
        {
            var host = new Panel
            {
                Name = ReservedNamePrefix + nodeId,
                IsStatic = true,
                ClipContent = true,
            };
            var image = new Panel
            {
                Name = ReservedNamePrefix + nodeId + ".image",
                IsStatic = true,
            };
            image.Parent = host;
            host.Parent = authored;
            state = new State(authored, host, image);
            _states.Add(authored, state);
            Owners[authored] = this;
        }

        state.ImagePath = appearance.Image!;
        state.Appearance = appearance;
        Refresh(state, force: true);
    }

    internal static void NotifyValueChanged(Progress progress)
    {
        if (Owners.TryGetValue(progress, out var owner)) owner.Refresh(progress, force: true);
    }

    public void Think(int delta)
    {
        if (_disposed) return;
        foreach (var state in _states.Values.ToArray())
        {
            if (!state.Progress.IsValid)
            {
                Remove(state.Progress);
                continue;
            }

            Refresh(state, force: false);
        }
    }

    private void Refresh(Progress progress, bool force)
    {
        if (_states.TryGetValue(progress, out var state)) Refresh(state, force);
    }

    private void Refresh(State state, bool force)
    {
        var progress = state.Progress;
        if (!progress.IsValid) return;

        var width = Math.Max(0, progress.Width);
        var height = Math.Max(0, progress.Height);
        var value = Math.Clamp(progress.Value, 0f, 1f);
        if (!force && MathF.Abs(value - state.LastValue) < 0.0001f &&
            MathF.Abs(width - state.LastWidth) < 0.01f && MathF.Abs(height - state.LastHeight) < 0.01f)
            return;

        state.LastValue = value;
        state.LastWidth = width;
        state.LastHeight = height;

        var mode = progress.ProgressionMode;
        var horizontal = mode is ProgressionMode.LeftToRight or ProgressionMode.RightToLeft;
        var reverse = mode is ProgressionMode.RightToLeft or ProgressionMode.BottomToTop;
        var fillWidth = horizontal ? width * value : width;
        var fillHeight = horizontal ? height : height * value;
        var fillX = horizontal && reverse ? width - fillWidth : 0;
        var fillY = !horizontal && reverse ? height - fillHeight : 0;

        var radius = state.Appearance?.CornerRadius ?? MathF.Min(width, height) / 2f;
        radius = Math.Clamp(radius, 0, MathF.Min(fillWidth, fillHeight) / 2f);
        state.Host.CornerRadius = radius;
        state.Host.ClipContent = true;
        state.Host.Visible = value > 0.0001f && fillWidth > 0 && fillHeight > 0;
        DjuiLayoutSessionV6.ApplyRect(state.Host, new DjuiRectV6(fillX, fillY, fillWidth, fillHeight));

        var imageRect = CalculateImageRect(width, height, state.Appearance);
        DjuiLayoutSessionV6.ApplyRect(
            state.Image,
            new DjuiRectV6(imageRect.X - fillX, imageRect.Y - fillY, imageRect.Width, imageRect.Height));
        state.Image.Image = state.ImagePath;
        state.Image.Desaturated = state.Appearance?.Desaturated ?? false;
        state.Image.ImageFlipX = state.Appearance?.ImageFlipX ?? false;
        state.Image.ImageFlipY = state.Appearance?.ImageFlipY ?? false;
        state.Image.SlicedEdges = state.Appearance?.SlicedEdges is { Length: 4 } edges
            ? new Thickness(edges[0], edges[1], edges[2], edges[3])
            : new Thickness(0, 0, 0, 0);
    }

    private static DjuiRectV6 CalculateImageRect(float width, float height, DjuiAppearanceV6? appearance)
    {
        var fit = appearance?.ImageFit ?? "stretch";
        var source = appearance?.SourceSize;
        if (string.Equals(fit, "stretch", StringComparison.Ordinal) || source is not { Width: > 0, Height: > 0 })
            return new DjuiRectV6(0, 0, width, height);

        var cover = string.Equals(fit, "cover", StringComparison.Ordinal);
        var scale = cover
            ? MathF.Max(width / source.Width, height / source.Height)
            : MathF.Min(width / source.Width, height / source.Height);
        var imageWidth = source.Width * scale;
        var imageHeight = source.Height * scale;
        var focalX = Math.Clamp(appearance?.FocalX ?? 0.5f, 0, 1);
        var focalY = Math.Clamp(appearance?.FocalY ?? 0.5f, 0, 1);
        return new DjuiRectV6(
            (width - imageWidth) * focalX,
            (height - imageHeight) * focalY,
            imageWidth,
            imageHeight);
    }

    private void Remove(Progress progress)
    {
        if (!_states.Remove(progress, out var state)) return;
        Owners.Remove(progress);
        state.Host.RemoveFromVisualTreeAndParent();
        state.Host.Dispose();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var progress in _states.Keys.ToArray()) Remove(progress);
        _states.Clear();
    }

    private sealed class State
    {
        public State(Progress progress, Panel host, Panel image)
        {
            Progress = progress;
            Host = host;
            Image = image;
        }

        public Progress Progress { get; }
        public Panel Host { get; }
        public Panel Image { get; }
        public string ImagePath { get; set; } = "";
        public DjuiAppearanceV6? Appearance { get; set; }
        public float LastValue { get; set; } = -1;
        public float LastWidth { get; set; } = -1;
        public float LastHeight { get; set; } = -1;
    }
}

#endif
