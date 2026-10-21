// DJUI Runtime - protocol v6 border visual sublayer
#if CLIENT

using GameUI.Control;
using GameUI.Control.Primitive;
using GameUI.Graphics;

namespace DjuiRuntime;

/// <summary>
/// Renders appearance.borderThickness/borderColor as a stroked rectangle on an engine Canvas
/// sublayer. The stroke path runs exactly on the node bounds (centered like the editor canvas),
/// so the Canvas control itself is grown by thickness/2 on each side to keep the outer half of
/// the stroke inside its own bounds. cornerRadius follows the host fill radius (StrokeRoundedRectangle).
/// </summary>
internal sealed class DjuiBorderVisualLayerV6 : IDisposable, IThinker
{
    internal const string ReservedNamePrefix = "__djui.v6.visual.border.";
    private readonly Dictionary<Control, State> _states = new();
    private bool _disposed;

    public bool DoesThink { get; set; } = true;

    public DjuiBorderVisualLayerV6() => Game.RegisterThinker(this);

    private sealed class State(Canvas canvas, SolidPaint paint)
    {
        public Canvas Canvas { get; } = canvas;
        public SolidPaint Paint { get; } = paint;
        public float Thickness { get; set; }
        public float Radius { get; set; }
        public float Width { get; set; } = float.NaN;
        public float Height { get; set; } = float.NaN;

        public void Draw(object? sender, EventArgs e)
        {
            var canvas = Canvas;
            if (float.IsNaN(Width) || float.IsNaN(Height) || Width <= 0f || Height <= 0f) return;
            canvas.StrokePaint = Paint;
            canvas.StrokeWidth = Thickness;
            var half = Thickness / 2f;
            if (Radius > 0f)
            {
                var radius = Math.Clamp(Radius, 0f, MathF.Min(Width, Height) / 2f);
                canvas.StrokeRoundedRectangle(half, half, Width, Height, radius);
            }
            else
            {
                canvas.StrokeRectangle(half, half, Width, Height);
            }
        }
    }

    /// <summary>
    /// 建树/relayout 重放/SetImage 同构入口。thickness 为 0/缺省即拆除边框层（幂等）。
    /// sceneScale：场景画板子树内控件矩形由 solver 缩放，描边粗细是"非矩形属性"须自行补乘
    /// （与字号/文字描边同规则）；cornerRadius 与宿主填充圆角同值，保证描边贴着底色圆角走。
    /// </summary>
    public void Apply(string nodeId, Control authored, DjuiAppearanceV6? appearance, float sceneScale = 1f)
    {
        var thickness = MathF.Max(0f, (appearance?.BorderThickness ?? 0f) * sceneScale);
        if (thickness <= 0f)
        {
            Remove(authored);
            return;
        }

        if (!_states.TryGetValue(authored, out var state))
        {
            var canvas = new Canvas { Name = ReservedNamePrefix + nodeId, IsStatic = true };
            var paint = new SolidPaint(TryParseBorderColor(appearance));
            state = new State(canvas, paint);
            canvas.OnRender += state.Draw;
            canvas.Parent = authored;
            _states.Add(authored, state);
        }
        else
        {
            state.Paint.Color = TryParseBorderColor(appearance);
        }

        state.Thickness = thickness;
        state.Radius = (appearance?.CornerRadius ?? 0f) * sceneScale;
        RefreshGeometry(authored);
    }

    // 边框层画布外扩 thickness/2（居中描边的外半侧不出画布边界），矩形只吃宿主当前宽高。
    internal void RefreshGeometry(Control authored)
    {
        if (_disposed || !authored.IsValid || !_states.TryGetValue(authored, out var state)) return;
        var canvas = state.Canvas;
        if (!canvas.IsValid) return;
        state.Width = MathF.Max(0f, authored.Width);
        state.Height = MathF.Max(0f, authored.Height);
        var grow = state.Thickness;
        DjuiLayoutSessionV6.ApplyRect(canvas, new DjuiRectV6(-grow / 2f, -grow / 2f, state.Width + grow, state.Height + grow));
    }

    public void Think(int delta)
    {
        if (_disposed) return;
        List<Control>? invalid = null;
        foreach (var (authored, state) in _states)
        {
            if (!authored.IsValid || !state.Canvas.IsValid)
            {
                (invalid ??= new()).Add(authored);
                continue;
            }
            var width = MathF.Max(0f, authored.Width);
            var height = MathF.Max(0f, authored.Height);
            if (state.Width != width || state.Height != height)
                RefreshGeometry(authored);
        }
        if (invalid != null) foreach (var authored in invalid) _states.Remove(authored);
    }

    // 编辑器画布默认描边色为白色（app.borderColor ?? '#FFFFFFFF'），缺省/非法颜色同规则兜白。
    private static Color TryParseBorderColor(DjuiAppearanceV6? appearance)
        => DjuiTreeBuilderV6.TryParseColor(appearance?.BorderColor, out var color) ? color : Color.White;

    private void Remove(Control authored)
    {
        if (!_states.Remove(authored, out var state)) return;
        state.Canvas.OnRender -= state.Draw;
        state.Canvas.RemoveFromVisualTreeAndParent();
        state.Canvas.Dispose();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        DoesThink = false;
        Game.UnregisterThinker(this);
        foreach (var state in _states.Values)
        {
            if (!state.Canvas.IsValid) continue;
            state.Canvas.OnRender -= state.Draw;
            state.Canvas.RemoveFromVisualTreeAndParent();
            state.Canvas.Dispose();
        }
        _states.Clear();
    }
}

#endif
