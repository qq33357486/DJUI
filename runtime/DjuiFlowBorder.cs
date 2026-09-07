// DJUI Runtime - 流光边框（CanvasAnimated 程序化绘制：呼吸描边＋绕框流光拖尾）

#if CLIENT

using GameUI.Control;
using GameUI.Control.Enum;
using GameUI.Control.Primitive;
using GameUI.Graphics;

namespace DjuiRuntime;

/// <summary>
/// 流光边框高级选项（逃生口，一般用不到）：只在需要调速、并列控件错位、特殊圆角或"只呼吸框"时使用。
/// </summary>
public sealed class DjuiFlowBorderOptions
{
    /// <summary>绕圈速度（圈/秒，默认 0.42；负值＝逆时针，0＝光点停住只呼吸）</summary>
    public float Speed { get; set; } = 0.42f;

    /// <summary>初始相位偏移（0~1，周长比例；并列控件流光错位用，如 i * 0.23f）</summary>
    public float PhaseOffset { get; set; } = 0f;

    /// <summary>圆角半径（px；null＝自适应 min(20, 高×0.3)，0＝直角）</summary>
    public float? Radius { get; set; } = null;

    /// <summary>true＝只呼吸描边框，不跑流光（引导/提示态用）</summary>
    public bool BreathOnly { get; set; } = false;
}

/// <summary>
/// 流光边框：往任意 Control 挂一块 CanvasAnimated，按帧程序化绘制呼吸描边＋三组绕框流光拖尾。
/// 颜色只传一个主色，框体/拖尾/头部/辉光四色由主色 HSL 自动推导，保证配色协调。
/// 无贴图依赖；几何（圆角路径、匀速绕圈）纯数学计算，控件多大框多大。
/// </summary>
public static class DjuiFlowBorder
{
    // 常用主色预设（可直接传给 Attach；GM 配色轮选实机拍板 2026-09-08）
    public static readonly Color Gold = Color.FromArgb(255, 216, 158, 40);
    public static readonly Color Purple = Color.FromArgb(255, 178, 108, 255);
    public static readonly Color Blue = Color.FromArgb(255, 96, 160, 255);
    public static readonly Color Cyan = Color.FromArgb(255, 64, 224, 208);
    public static readonly Color Green = Color.FromArgb(255, 80, 220, 120);
    public static readonly Color White = Color.FromArgb(255, 170, 200, 235);
    public static readonly Color Orange = Color.FromArgb(255, 255, 130, 40);
    public static readonly Color Red = Color.FromArgb(255, 240, 82, 82);

    private sealed record Entry(CanvasAnimated Canvas, DjuiFlowBorderOptions Options);
    private static readonly Dictionary<Control, Entry> _attached = new();

    /// <summary>挂载金色流光（默认样式，最常用）。目标失效或宽高未定（≤0）时返回 false。</summary>
    public static bool Attach(Control target) => Attach(target, Gold, null);

    /// <summary>挂载指定主色的流光：框/拖尾/头部/辉光四色由主色自动推导。</summary>
    public static bool Attach(Control target, Color color) => Attach(target, color, null);

    /// <summary>完整版：主色＋可选微调。幂等：已挂则先卸再挂（样式热更新）。</summary>
    public static bool Attach(Control target, Color color, DjuiFlowBorderOptions? options)
    {
        if (target == null || !target.IsValid || target.Width <= 0 || target.Height <= 0) return false;
        Detach(target);   // 幂等＝热更新

        options ??= new DjuiFlowBorderOptions();
        var palette = DerivePalette(color);
        var canvas = new CanvasAnimated
        {
            Width = target.Width,
            Height = target.Height,
            ZIndex = 8,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 0, 0, 0),
        };
        canvas.OnAnimatedRender += (_, e) => Draw(canvas, e.TotalElapsedTimeInSeconds, palette, options);
        target.AddChild(canvas);
        canvas.StartTiming();
        _attached[target] = new Entry(canvas, options);
        return true;
    }

    /// <summary>卸载并释放画布（幂等；目标已失效时静默成功）。</summary>
    public static void Detach(Control target)
    {
        if (target == null) return;
        if (_attached.TryGetValue(target, out var e))
        {
            _attached.Remove(target);
            if (e.Canvas.IsValid)
            {
                e.Canvas.RemoveFromVisualTreeAndParent();
                e.Canvas.Dispose();
            }
        }
    }

    /// <summary>是否挂载中。</summary>
    public static bool IsAttached(Control target) => target != null && _attached.ContainsKey(target);

    // ---------------- 配色推导（主色 → 四色） ----------------

    private sealed record Palette(Color Frame, Color Trail, Color Head, Color Glow);

    private static Palette DerivePalette(Color primary)
    {
        var (h, s, l) = ToHsl(primary);
        var glow = FromHsl(h, s, MathF.Min(0.75f, l + 0.12f));
        var glowA = Color.FromArgb(150, glow.R, glow.G, glow.B);
        return new Palette(
            Frame: primary,
            Trail: FromHsl(h, MathF.Min(1f, s * 0.9f), MathF.Min(0.85f, l + 0.27f)),
            Head: FromHsl(h, MathF.Min(1f, s * 0.85f), 0.95f),   // 同色系高亮色（非白）——保持色系统一
            Glow: glowA);
    }

    private static (float h, float s, float l) ToHsl(Color c)
    {
        var r = c.R / 255f; var g = c.G / 255f; var b = c.B / 255f;
        var max = MathF.Max(r, MathF.Max(g, b)); var min = MathF.Min(r, MathF.Min(g, b));
        var l = (max + min) / 2f;
        if (max == min) return (0f, 0f, l);
        var d = max - min;
        var s = l > 0.5f ? d / (2f - max - min) : d / (max + min);
        float h;
        if (max == r) h = ((g - b) / d + (g < b ? 6f : 0f)) / 6f;
        else if (max == g) h = ((b - r) / d + 2f) / 6f;
        else h = ((r - g) / d + 4f) / 6f;
        return (h, s, l);
    }

    private static Color FromHsl(float h, float s, float l)
    {
        if (s == 0f) return Color.FromArgb(255, (int)(l * 255f), (int)(l * 255f), (int)(l * 255f));
        float q = l < 0.5f ? l * (1f + s) : l + s - l * s;
        float p = 2f * l - q;
        float f(float t)
        {
            if (t < 0f) t += 1f;
            if (t > 1f) t -= 1f;
            if (t < 1f / 6f) return p + (q - p) * 6f * t;
            if (t < 1f / 2f) return q;
            if (t < 2f / 3f) return p + (q - p) * (2f / 3f - t) * 6f;
            return p;
        }
        return Color.FromArgb(255, (int)(f(h + 1f / 3f) * 255f), (int)(f(h) * 255f), (int)(f(h - 1f / 3f) * 255f));
    }

    // ---------------- 绘制（观感参数内部固定：2026-09-07 Project_Movie 任务栏实机调优拍板值） ----------------

    private static void Draw(Canvas canvas, float time, Palette p, DjuiFlowBorderOptions o)
    {
        const float inset = 4f;
        var w = canvas.Width - inset * 2;
        var h = canvas.Height - inset * 2;
        var radius = o.Radius ?? MathF.Min(20f, MathF.Min(w, h) * 0.3f);
        radius = MathF.Max(0f, MathF.Min(radius, MathF.Min(w, h) / 2f));   // wasm BCL 无 MathF.Clamp

        canvas.ResetState();
        canvas.LineCap = LineCap.Round;
        canvas.LineJoin = LineJoin.Round;

        // 呼吸描边三层（金属亮边结构）：宽辉光垫底＋主色主框＋白色中线
        var pulse = 0.5f + 0.5f * MathF.Sin(time * 2.4f);
        canvas.Alpha = 0.85f + pulse * 0.15f;
        canvas.StrokeWidth = 7f;
        canvas.StrokePaint = p.Frame;
        canvas.StrokeRoundedRectangle(inset, inset, w, h, radius);
        canvas.Alpha = 1f;
        canvas.StrokeWidth = 3f;
        canvas.StrokePaint = p.Head;
        canvas.StrokeRoundedRectangle(inset, inset, w, h, radius);

        if (o.BreathOnly || o.Speed == 0f) return;

        // 三组拖尾沿框线中线跑（相位错开，一大两小）＋头部亮点
        const float trailInset = inset + 2.5f;
        var tw = canvas.Width - trailInset * 2;
        var th = canvas.Height - trailInset * 2;
        var tr = MathF.Max(0f, MathF.Min(radius - 1.5f, MathF.Min(tw, th) / 2f));
        var basePhase = time * o.Speed + o.PhaseOffset;
        DrawSnake(canvas, basePhase, trailInset, trailInset, tw, th, tr, p);
    }

    /// <summary>
    /// 蝌蚪光带（水滴形）：一条闭合路径画出整个形状——左右沿渐细收拢到尾尖、头端半圆弧封口，
    /// 填充与描边共用同一路径，一体成形无接缝；内芯为同构缩窄的小水滴。
    /// </summary>
    private static void DrawSnake(Canvas canvas, float phase, float x, float y, float w, float h, float r, Palette p)
    {
        const float tailPx = 180f;   // 拖尾总长（px）
        const int samples = 44;      // 轮廓采样点数
        const int capSteps = 10;     // 头部半圆封口弧采样数
        var hw = w - 2 * r;
        var vh = h - 2 * r;
        var perimeter = 2 * (hw + vh) + 4 * (MathF.PI * r / 2f);
        var stepPx = tailPx / samples;

        var pts = new PointF[samples + 1];
        for (var i = 0; i <= samples; i++)
            pts[i] = RoundedPoint(Norm(phase - i * stepPx / perimeter), x, y, w, h, r);

        // 法向（左）与切向（指向尾）
        (PointF n, PointF t) Frame(int i)
        {
            var prev = pts[Math.Max(0, i - 1)];
            var next = pts[Math.Min(samples, i + 1)];
            var dx = next.X - prev.X; var dy = next.Y - prev.Y;
            var len = MathF.Max(0.0001f, MathF.Sqrt(dx * dx + dy * dy));
            return (new PointF(-dy / len, dx / len), new PointF(dx / len, dy / len));
        }

        PathF Waterdrop(float headHalf)
        {
            float Half(float t) => headHalf * MathF.Pow(1f - t, 0.55f);   // 逐渐变小，尾尖收到 0
            var v = new List<PointF>(samples * 2 + capSteps);
            for (var i = 0; i <= samples; i++)                    // 左沿：头→尾
            {
                var t = i / (float)samples;
                var (n, _) = Frame(i);
                var half = Half(t);
                v.Add(new PointF(pts[i].X + n.X * half, pts[i].Y + n.Y * half));
            }
            for (var i = samples - 1; i >= 0; i--)                // 右沿：尾→头
            {
                var t = i / (float)samples;
                var (n, _) = Frame(i);
                var half = Half(t);
                v.Add(new PointF(pts[i].X - n.X * half, pts[i].Y - n.Y * half));
            }
            var (n0, t0) = Frame(0);                               // 头部半圆封口：右沿端→前凸→左沿端
            var r0 = Half(0);
            for (var k = 1; k < capSteps; k++)
            {
                var a = MathF.PI * k / capSteps;
                var dirX = -n0.X * MathF.Cos(a) - t0.X * MathF.Sin(a);   // -t0＝行进前向
                var dirY = -n0.Y * MathF.Cos(a) - t0.Y * MathF.Sin(a);
                v.Add(new PointF(pts[0].X + dirX * r0, pts[0].Y + dirY * r0));
            }
            // 闭合二次样条（中点法）：顶点为控制点、相邻中点为锚点——边缘平滑无锯齿
            var 顶点数 = v.Count;
            PointF Mid(PointF a, PointF b) => new((a.X + b.X) / 2f, (a.Y + b.Y) / 2f);
            var path = new PathF();
            path.MoveTo(Mid(v[顶点数 - 1], v[0]));
            for (var i = 0; i < 顶点数; i++)
                path.QuadTo(v[i], Mid(v[i], v[(i + 1) % 顶点数]));
            path.Close();
            return path;
        }

        canvas.LineCap = LineCap.Round;
        canvas.LineJoin = LineJoin.Round;

        // 主体水滴：同一路径先填充后描边（描边一半压在填充边上，无露底缝）
        var body = Waterdrop(7f);
        canvas.Alpha = 1f;
        canvas.FillPaint = new SolidPaint(p.Trail);
        canvas.FillPath(body);
        canvas.Alpha = 0.9f;
        canvas.StrokeWidth = 1.6f;
        canvas.StrokePaint = p.Head;
        canvas.DrawPath(body);

        // 内芯：同构缩窄的小水滴（纯色高亮，不描边）
        canvas.Alpha = 1f;
        canvas.FillPaint = new SolidPaint(p.Head);
        canvas.FillPath(Waterdrop(4f));
    }

    /// <summary>圆角矩形路径点：s∈[0,1) 沿周长匀速（直边＋四段 90° 圆弧），从左上角圆弧起点顺时针。</summary>
    private static PointF RoundedPoint(float s, float x, float y, float w, float h, float r)
    {
        s = Norm(s);
        var hw = w - 2 * r;
        var vh = h - 2 * r;
        var arc = MathF.PI * r / 2f;
        var d = s * (2 * (hw + vh) + 4 * arc);   // 段内正向进度，逐段递减

        PointF ArcPt(float cx, float cy, float a0, float t) => new(
            cx + r * MathF.Cos(a0 + t / arc * MathF.PI / 2f),
            cy + r * MathF.Sin(a0 + t / arc * MathF.PI / 2f));

        if (d < hw) return new PointF(x + r + d, y);
        d -= hw;
        if (d < arc) return ArcPt(x + w - r, y + r, -MathF.PI / 2f, d);
        d -= arc;
        if (d < vh) return new PointF(x + w, y + r + d);
        d -= vh;
        if (d < arc) return ArcPt(x + w - r, y + h - r, 0f, d);
        d -= arc;
        if (d < hw) return new PointF(x + w - r - d, y + h);
        d -= hw;
        if (d < arc) return ArcPt(x + r, y + h - r, MathF.PI / 2f, d);
        d -= arc;
        if (d < vh) return new PointF(x, y + h - r - d);
        d -= vh;
        return ArcPt(x + r, y + r, MathF.PI, d);
    }

    private static float Norm(float v) => v - MathF.Floor(v);
}

#endif
