// DJUI Runtime - protocol v6 internal image visual sublayer
#if CLIENT

using GameUI.Control;

namespace DjuiRuntime;

/// <summary>
/// Manages non-authored image children. StarEngine's public Texture API exposes only Path,
/// so contain/cover use appearance.sourceSize as the synchronous intrinsic-size contract.
/// </summary>
internal sealed class DjuiImageVisualLayerV6 : IDisposable
{
    internal const string ReservedNamePrefix = "__djui.v6.visual.image.";
    private readonly Dictionary<Control, Panel> _visuals = new();
    private readonly HashSet<string> _warnedMissingSourceSize = new(StringComparer.Ordinal);

    public void Apply(string nodeId, Control authored, DjuiAppearanceV6? appearance)
    {
        var image = appearance?.Image;
        if (string.IsNullOrWhiteSpace(image))
        {
            Remove(authored);
            authored.ClipContent = appearance?.ClipContent ?? false;
            return;
        }

        // The authored control remains layout/control only; rendering lives in one persistent static child.
        authored.Image = "";
        if (!_visuals.TryGetValue(authored, out var visual))
        {
            visual = new Panel { Name = ReservedNamePrefix + nodeId, IsStatic = true };
            visual.Parent = authored;
            _visuals.Add(authored, visual);
        }

        visual.Image = image;
        visual.Desaturated = appearance?.Desaturated ?? false;
        visual.ImageFlipX = appearance?.ImageFlipX ?? false;
        visual.ImageFlipY = appearance?.ImageFlipY ?? false;

        var fit = appearance?.ImageFit ?? "stretch";
        var cover = string.Equals(fit, "cover", StringComparison.Ordinal);
        authored.ClipContent = cover || (appearance?.ClipContent ?? false);

        var parentWidth = Math.Max(0, authored.Width);
        var parentHeight = Math.Max(0, authored.Height);
        var x = 0f;
        var y = 0f;
        var width = parentWidth;
        var height = parentHeight;
        var source = appearance?.SourceSize;
        if (!string.Equals(fit, "stretch", StringComparison.Ordinal) && source is { Width: > 0, Height: > 0 })
        {
            var scale = cover
                ? MathF.Max(parentWidth / source.Width, parentHeight / source.Height)
                : MathF.Min(parentWidth / source.Width, parentHeight / source.Height);
            width = source.Width * scale;
            height = source.Height * scale;
            var focalX = Math.Clamp(appearance?.FocalX ?? 0.5f, 0, 1);
            var focalY = Math.Clamp(appearance?.FocalY ?? 0.5f, 0, 1);
            x = (parentWidth - width) * focalX;
            y = (parentHeight - height) * focalY;
        }
        else if (!string.Equals(fit, "stretch", StringComparison.Ordinal) && _warnedMissingSourceSize.Add(nodeId + "\n" + image))
        {
            Game.Logger.LogWarning("DJUI v6: node {NodeId} uses imageFit={ImageFit} without positive appearance.sourceSize; falling back to stretch because StarEngine does not expose synchronous intrinsic texture dimensions.", nodeId, fit);
        }

        DjuiLayoutSessionV6.ApplyRect(visual, new DjuiRectV6(x, y, width, height));
    }

    private void Remove(Control authored)
    {
        authored.Image = "";
        if (!_visuals.Remove(authored, out var visual)) return;
        visual.Dispose();
    }

    public void Dispose()
    {
        foreach (var visual in _visuals.Values) visual.Dispose();
        _visuals.Clear();
        _warnedMissingSourceSize.Clear();
    }
}

#endif
