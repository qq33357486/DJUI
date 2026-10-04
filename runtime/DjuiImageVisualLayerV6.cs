// DJUI Runtime - protocol v6 internal image visual sublayer
#if CLIENT

using GameUI.Control;

namespace DjuiRuntime;

/// <summary>
/// Manages non-authored image children. StarEngine's public Texture API exposes only Path,
/// so contain/cover use appearance.sourceSize as the synchronous intrinsic-size contract.
/// </summary>
internal sealed class DjuiImageVisualLayerV6 : IDisposable, IThinker
{
    internal const string ReservedNamePrefix = "__djui.v6.visual.image.";
    private readonly Dictionary<Control, State> _visuals = new();
    private readonly HashSet<string> _warnedMissingSourceSize = new(StringComparer.Ordinal);
    private bool _disposed;

    public bool DoesThink { get; set; } = true;

    public DjuiImageVisualLayerV6() => Game.RegisterThinker(this);

    private sealed class State(Panel visual, string nodeId)
    {
        public Panel Visual { get; } = visual;
        public string NodeId { get; } = nodeId;
        public DjuiAppearanceV6? Appearance { get; set; }
        public float LastWidth { get; set; } = float.NaN;
        public float LastHeight { get; set; } = float.NaN;
    }

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
        if (!_visuals.TryGetValue(authored, out var state))
        {
            var created = new Panel { Name = ReservedNamePrefix + nodeId, IsStatic = true };
            state = new State(created, nodeId);
            created.Parent = authored;
            _visuals.Add(authored, state);
        }
        state.Appearance = appearance;
        var visual = state.Visual;

        visual.Image = image;
        visual.Desaturated = appearance?.Desaturated ?? false;
        // 图片染色：引擎乘算 tint 只发生在同一 Control 的 Background×Image 之间（跨控件不作用，
        // 1003 探针实测），必须写在画图的 visual 子层上而不是宿主。空/非法＝撤销染色。
        visual.Background = DjuiTreeBuilderV6.TryParseColor(appearance?.ImageTint, out var tintColor)
            ? tintColor
            : null;
        visual.ImageFlipX = appearance?.ImageFlipX ?? false;
        visual.ImageFlipY = appearance?.ImageFlipY ?? false;
        // 图片实际绘制在 visual 子节点；九宫格边距也必须落在该节点，
        // 不能只设置宿主 authored（宿主自身 Image 已被清空）。
        visual.SlicedEdges = appearance?.SlicedEdges is { Length: 4 } edges
            ? new Thickness(edges[0], edges[1], edges[2], edges[3])
            : new Thickness(0, 0, 0, 0);

        // cover/圆角需要宿主裁剪；尺寸同步只更新矩形，不回退业务后续设置的裁剪属性。
        authored.ClipContent = string.Equals(appearance?.ImageFit, "cover", StringComparison.Ordinal)
            || (appearance?.CornerRadius ?? 0f) > 0f || (appearance?.ClipContent ?? false);

        RefreshGeometry(authored);
    }

    // 仅重算图片矩形：不重放 normal 图、灰度、染色或宿主显隐/透明度，保持按钮当前状态。
    internal void RefreshGeometry(Control authored)
    {
        if (_disposed || !authored.IsValid || !_visuals.TryGetValue(authored, out var state)) return;
        var visual = state.Visual;
        if (!visual.IsValid) return;
        var appearance = state.Appearance;
        var fit = appearance?.ImageFit ?? "stretch";
        var cover = string.Equals(fit, "cover", StringComparison.Ordinal);
        var parentWidth = Math.Max(0, authored.Width);
        var parentHeight = Math.Max(0, authored.Height);
        state.LastWidth = parentWidth;
        state.LastHeight = parentHeight;
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
        else if (!string.Equals(fit, "stretch", StringComparison.Ordinal) && _warnedMissingSourceSize.Add(state.NodeId + "\n" + appearance?.Image))
        {
            Game.Logger.LogWarning("DJUI v6: node {NodeId} uses imageFit={ImageFit} without positive appearance.sourceSize; falling back to stretch because StarEngine does not expose synchronous intrinsic texture dimensions.", state.NodeId, fit);
        }

        DjuiLayoutSessionV6.ApplyRect(visual, new DjuiRectV6(x, y, width, height));
    }

    public void Think(int delta)
    {
        if (_disposed) return;
        // 与线性进度条同样按设定宽高同步，不依赖布局后的 OnSizeChanged（隐藏/未挂树也要同步）。
        List<Control>? invalid = null;
        foreach (var (authored, state) in _visuals)
        {
            if (!authored.IsValid || !state.Visual.IsValid)
            {
                (invalid ??= new()).Add(authored);
                continue;
            }
            if (state.LastWidth != Math.Max(0, authored.Width) || state.LastHeight != Math.Max(0, authored.Height))
                RefreshGeometry(authored);
        }
        if (invalid != null) foreach (var authored in invalid) _visuals.Remove(authored);
    }

    /// <summary>取回宿主对应的 visual 子 Panel（未创建图片层时为 null）。按钮状态机用它切换状态图。</summary>
    internal Panel? GetVisual(Control authored) => _visuals.TryGetValue(authored, out var state) ? state.Visual : null;

    private void Remove(Control authored)
    {
        authored.Image = "";
        if (!_visuals.Remove(authored, out var state)) return;
        state.Visual.Dispose();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        DoesThink = false;
        Game.UnregisterThinker(this);
        foreach (var state in _visuals.Values) if (state.Visual.IsValid) state.Visual.Dispose();
        _visuals.Clear();
        _warnedMissingSourceSize.Clear();
    }
}

#endif
