// DJUI Runtime - DjuiFx 核心：渲染单元（场景+RTT）、单元池、视图（画布）、句柄、全局时钟
// 所有权规则：SceneGraph / RTT / Node 只由本文件与 DjuiFxSurface 创建和销毁，业务和 AI 只拿 FxHandle。
#if CLIENT

using System.Numerics;
using GameGraph.NodeSystem;
using GameGraph.NodeSystem.Component.Graphics;
using GameGraph.ResourceSystem;
using GameUI.Control;
using GameUI.Control.Extensions;
using GameUI.Control.Primitive;
using GameUI.Control.Primitive.Struct;
using GameUI.Control.Struct;

namespace DjuiRuntime;

/// <summary>特效部件所在层：Back＝宿主控件之后，Front＝宿主控件之前。窗口级覆盖特效不分前后（统一画在窗口最上层）。</summary>
public enum FxLayer { Back, Front }

/// <summary>特效部件：构建返回一个节点（粒子或精灵），Tick 每帧回调（节点, 已播秒数）。节点位置由 Tick 或播放锚点决定。</summary>
public sealed record FxPart(FxLayer Layer, Func<SceneGraph, Node> Build, Action<Node, float>? Tick = null);

/// <summary>特效定义：Duration ≤ 0 表示常驻，需要 Stop 或窗口关闭才结束。</summary>
public sealed record FxDef(string Name, float Duration, FxPart[] Parts);

/// <summary>
/// 构建特效时的场地信息。坐标是 UI 坐标（左上原点、y 向下，单位＝画布设计像素）。
/// 覆盖特效：Width/Height＝窗口画布尺寸，From/To＝施法点/目标点；挂在节点上的特效：Width/Height＝挂接区域，From=To=区域中心。
/// </summary>
public readonly record struct FxContext(float Width, float Height, float FromX, float FromY, float ToX, float ToY)
{
    public Vector2 FromWorld => new(FromX - Width / 2f, Height / 2f - FromY);
    public Vector2 ToWorld => new(ToX - Width / 2f, Height / 2f - ToY);
}

/// <summary>全局选项。依赖资源由使用方的工程提供，DJUI 只检查不安装（见 DjuiFx.Check）。</summary>
public static class DjuiFxOptions
{
    /// <summary>透明清屏的 RTT 渲染路径文件（相对 res/ 的引擎资源路径）。工程需自行提供。</summary>
    public static string RenderPath = "Fx/RttAlpha.xml";

    /// <summary>RTT 相对画布尺寸的缩放，0.5＝半分辨率。</summary>
    public static float RttScale = 0.5f;

    /// <summary>空闲渲染单元的最大保留数，超出立即销毁。</summary>
    public static int MaxIdleCells = 2;

    /// <summary>空闲渲染单元的保留秒数，超时销毁。</summary>
    public static float IdleReleaseSeconds = 15f;

    /// <summary>可选：溶解 shader 的 Technique 路径。边缘色取 MatDiffColor.rgb、进度取 MatDiffColor.a，噪声图绑 Normal 槽。未设置则溶解层降级为淡出。</summary>
    public static string? DissolveTechnique;

    /// <summary>可选：溶解用的噪声灰度图。</summary>
    public static string? NoiseTexture;
}

/// <summary>泄漏自检计数：全部特效结束且窗口关闭后，InUseCells / Surfaces / Handles 必须为 0。</summary>
public readonly record struct FxStats(int Surfaces, int Handles, int Nodes, int InUseCells, int IdleCells, int CellsCreated, int CellsDisposed);

/// <summary>渲染单元：一个场景＋正交相机＋透明 RTT。按需创建，由 FxCellPool 复用。</summary>
internal sealed class FxCell : IDisposable
{
    public int Width { get; }
    public int Height { get; }
    public SceneGraph Scene { get; private set; }
    public Texture2D Texture { get; private set; }
    public RenderSurface Surface { get; private set; }
    public bool Active { get; private set; }
    public float IdleSince { get; set; }
    private bool _disposed;

    private FxCell(int width, int height, SceneGraph scene, Texture2D texture, RenderSurface surface)
    {
        Width = width;
        Height = height;
        Scene = scene;
        Texture = texture;
        Surface = surface;
    }

    public static FxCell? Create(int width, int height)
    {
        var scene = new SceneGraph(createOctree: true);
        var camNode = scene.CreateChild("Cam")!;
        camNode.Position = new Vector3(0f, 0f, -100f);
        _ = camNode.LookAt(Vector3.Zero, Vector3.UnitY);
        var cam = camNode.CreateComponent<CameraComponent>()!;
        cam.IsOrthographic = true;
        cam.OrthoSize = height;
        cam.AutoAspectRatio = false;
        cam.AspectRatio = (float)width / height;
        cam.NearClip = 1f;
        cam.FarClip = 500f;

        var scale = Math.Clamp(DjuiFxOptions.RttScale, 0.1f, 1f);
        var texture = Texture2D.CreateRenderTarget(Math.Max(64, (int)(width * scale)), Math.Max(64, (int)(height * scale)), RenderTargetFormat.Rgba8);
        var surface = texture?.RenderSurface;
        if (texture == null || surface == null)
        {
            Game.Logger.LogWarning("DjuiFx: 创建渲染纹理失败（{W}x{H}）。请运行 DjuiFx.Check() 查看依赖清单", width, height);
            texture?.Dispose();
            scene.Dispose();
            return null;
        }

        var viewport = Renderer.CreateViewport(scene, cam);
        viewport.SetRect(0, 0, 0, 0);
        viewport.SetRenderPath(DjuiFxOptions.RenderPath);
        surface.NumViewports = 1;
        surface.SetViewport(0, viewport);
        surface.UpdateMode = RenderSurfaceUpdateMode.ManualUpdate;
        surface.QueueUpdate();
        return new FxCell(width, height, scene, texture, surface);
    }

    /// <summary>有活动节点时持续刷新；空闲时停刷并最后清一次屏。</summary>
    public void SetActive(bool active)
    {
        if (_disposed || Active == active) return;
        Active = active;
        Surface.UpdateMode = active ? RenderSurfaceUpdateMode.UpdateAlways : RenderSurfaceUpdateMode.ManualUpdate;
        if (!active) Surface.QueueUpdate();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { Texture.Dispose(); }
        catch (Exception ex) { Game.Logger.LogWarning("DjuiFx: 渲染纹理销毁异常（已隔离）：{Message}", ex.Message); }
        try { Scene.Dispose(); }
        catch (Exception ex) { Game.Logger.LogWarning("DjuiFx: 场景销毁异常（已隔离）：{Message}", ex.Message); }
    }
}

/// <summary>
/// 渲染单元池。Rent/Return 配对；归还时调用方保证场景内节点已全部销毁。
/// 空闲单元超过 MaxIdleCells 立即销毁，其余超过 IdleReleaseSeconds 由时钟销毁。
/// </summary>
internal static class FxCellPool
{
    private static readonly List<FxCell> Idle = new();
    private static int _inUse;
    private static int _created;
    private static int _disposed;

    public static int InUse => _inUse;
    public static int IdleCount => Idle.Count;
    public static int Created => _created;
    public static int Disposed => _disposed;

    public static FxCell? Rent(int width, int height)
    {
        for (var i = 0; i < Idle.Count; i++)
        {
            if (Idle[i].Width != width || Idle[i].Height != height) continue;
            var hit = Idle[i];
            Idle.RemoveAt(i);
            _inUse++;
            return hit;
        }

        var cell = FxCell.Create(width, height);
        if (cell == null) return null;
        _created++;
        _inUse++;
        return cell;
    }

    public static void Return(FxCell cell, float now)
    {
        _inUse--;
        cell.SetActive(false);
        cell.IdleSince = now;
        Idle.Add(cell);
        while (Idle.Count > Math.Max(0, DjuiFxOptions.MaxIdleCells))
        {
            DisposeCell(Idle[0]);
            Idle.RemoveAt(0);
        }
    }

    public static void Trim(float now)
    {
        for (var i = Idle.Count - 1; i >= 0; i--)
        {
            if (now - Idle[i].IdleSince < DjuiFxOptions.IdleReleaseSeconds) continue;
            DisposeCell(Idle[i]);
            Idle.RemoveAt(i);
        }
    }

    private static void DisposeCell(FxCell cell)
    {
        _disposed++;
        cell.Dispose();
    }
}

/// <summary>视图＝一块挂在控件树里的画布＋它独占的渲染单元。画布只负责把 RTT 画出来，不拦截输入。</summary>
internal sealed class FxView : IDisposable
{
    private readonly float _width;
    private readonly float _height;
    private CanvasAnimated? _canvas;
    private FxCell? _cell;

    public FxCell Cell => _cell!;
    public float Width => _width;
    public float Height => _height;
    public int NodeCount { get; set; }
    public float EmptySince { get; set; }

    private FxView(CanvasAnimated canvas, FxCell cell, float width, float height)
    {
        _canvas = canvas;
        _cell = cell;
        _width = width;
        _height = height;
    }

    /// <param name="centered">true＝在父控件内居中（挂在节点上）；false＝左上对齐（窗口级覆盖）</param>
    public static FxView? Create(Control parent, float width, float height, int zIndex, bool centered, float now)
    {
        var cell = FxCellPool.Rent((int)MathF.Ceiling(width), (int)MathF.Ceiling(height));
        if (cell == null) return null;
        // 显式宽高：空 Panel / 刚打开窗口的当帧布局未解算，ActualSize 为 0，不能依赖拉伸
        var canvas = new CanvasAnimated
        {
            Parent = parent,
            Width = width,
            Height = height,
            ZIndex = zIndex,
            HorizontalAlignment = centered ? HorizontalAlignment.Center : HorizontalAlignment.Left,
            VerticalAlignment = centered ? VerticalAlignment.Center : VerticalAlignment.Top,
        };
        var view = new FxView(canvas, cell, width, height) { EmptySince = now };
        canvas.StartTiming();
        canvas.OnAnimatedRender += view.Draw;
        return view;
    }

    private void Draw(object? sender, CanvasAnimatedEventArgs e)
    {
        var c = _canvas;
        var cell = _cell;
        if (c == null || cell == null) return;
        c.ResetState();
        c.DrawTexture(cell.Texture, 0, 0, _width, _height);
    }

    /// <summary>空视图隐藏画布并让单元停刷，省 GPU。</summary>
    public void Sync()
    {
        var active = NodeCount > 0;
        if (_canvas != null) _canvas.Visible = active;
        _cell?.SetActive(active);
    }

    public void Dispose()
    {
        var canvas = _canvas;
        var cell = _cell;
        _canvas = null;
        _cell = null;
        if (canvas != null)
        {
            canvas.OnAnimatedRender -= Draw;
            canvas.Destroy();
        }

        if (cell != null) FxCellPool.Return(cell, FxClock.Now);
    }
}

/// <summary>播放句柄。业务只用 Stop / IsValid；句柄失效后再 Stop 是空操作。</summary>
public sealed class FxHandle
{
    internal FxSurface? Owner;
    internal readonly List<(FxView View, Node Node)> Nodes = new();
    internal readonly List<(Node Node, Action<Node, float> Tick)> Ticks = new();
    /// <summary>该句柄独占的视图（挂在节点上的特效）；Stop 时随句柄一起销毁。覆盖特效共用窗口视图，不在此列。</summary>
    internal readonly List<FxView> OwnedViews = new();
    internal float StartTime;
    internal float ExpireTime = -1f;
    internal string? AttachKey;
    /// <summary>延迟播放（锚点布局未就绪）：返回 null＝继续等，true＝已播放，false＝失败。</summary>
    internal Func<FxHandle, bool?>? Pending;
    internal float PendingUntil;

    public string Effect { get; internal set; } = "";
    public bool IsValid => Owner != null;
}

/// <summary>全局帧时钟：驱动所有窗口的特效 Tick 和单元池回收。无特效且无空闲单元时不工作。</summary>
internal sealed class FxClock : IThinker
{
    private static FxClock? _instance;
    private static float _now;

    public static float Now => _now;
    public bool DoesThink { get; set; } = true;

    public static void EnsureRunning()
    {
        if (_instance != null)
        {
            _instance.DoesThink = true;
            return;
        }

        _instance = new FxClock();
        Game.RegisterThinker(_instance);
    }

    public void Think(int delta)
    {
        if (!Game.IsActive) return;
        _now += delta / 1000f;
        FxSurface.TickAll(_now);
        FxCellPool.Trim(_now);
        if (FxSurface.Count == 0 && FxCellPool.IdleCount == 0) DoesThink = false;
    }
}

#endif
