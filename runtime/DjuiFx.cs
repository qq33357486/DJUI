// DJUI Runtime - DjuiFx 门面：代码层 2D 特效的唯一公开入口（不进画布、不进页面 JSON）
// 设计目标：AI 友好——名字即语义、调用不带坐标运算、出错不抛异常而是给可操作的 Warning、可自描述（Describe）。
#if CLIENT

using System.Numerics;
using System.Text;

namespace DjuiRuntime;

/// <summary>特效需要的锚点形态，仅作元数据供 Describe 展示。</summary>
public enum FxAnchorKind { Point, Node, FromTo }

/// <summary>特效元数据。AttachWidth/Height＝挂在节点上时的挂接区域（设计像素，原点为节点中心）。</summary>
public sealed record FxInfo(string Description, FxAnchorKind Anchor = FxAnchorKind.Point, float AttachWidth = 512f, float AttachHeight = 512f);

/// <summary>特效锚点：窗口画布内的一个点，或某个节点的中心。可由 string（节点 ID）或 (x, y) 元组隐式转换。</summary>
public readonly struct FxAnchor
{
    private readonly string? _nodeId;
    private readonly Vector2 _point;

    private FxAnchor(string? nodeId, Vector2 point)
    {
        _nodeId = nodeId;
        _point = point;
    }

    public static FxAnchor At(float x, float y) => new(null, new Vector2(x, y));
    public static FxAnchor Node(string nodeId) => new(nodeId, default);

    public static implicit operator FxAnchor(string nodeId) => Node(nodeId);
    public static implicit operator FxAnchor((float x, float y) p) => At(p.x, p.y);

    internal FxResolve Resolve(FxSurface surface, out Vector2 point, out string? error)
    {
        error = null;
        if (_nodeId == null)
        {
            point = _point;
            return FxResolve.Ok;
        }

        var result = surface.TryNodeCenter(_nodeId, out point);
        if (result == FxResolve.Missing) error = $"节点 {_nodeId} 不存在";
        return result;
    }

    public override string ToString() => _nodeId != null ? $"node:{_nodeId}" : $"({_point.X:0},{_point.Y:0})";
}

/// <summary>依赖预检结果。Ok＝基础功能可用；Problems 每条都带修复提示。</summary>
public sealed record FxCheckResult(bool Ok, IReadOnlyList<string> Problems);

/// <summary>
/// 2D 特效门面。典型用法（页面必须已打开）：
/// <code>
/// DjuiFx.Define("火球", "火球飞向目标", ctx =&gt; new FxDef(...), new FxInfo("...", FxAnchorKind.FromTo));
/// DjuiFx.Cast("战斗", "火球", "caster_node", "boss_node");      // 弹道：施法节点 → 目标节点
/// DjuiFx.Play("战斗", "爆炸", (540f, 800f));                      // 一次性：落在坐标
/// DjuiFx.Attach("建筑详情", "chest_icon", "宝箱光");             // 常驻：跟随节点，关窗自动销毁
/// </code>
/// 生命周期：窗口关闭时该窗口的全部特效自动销毁并归还渲染资源，业务无需写清理。
/// </summary>
public static class DjuiFx
{
    private sealed record Entry(string Name, FxInfo Info, Func<FxContext, FxDef> Factory);

    private static readonly Dictionary<string, Entry> Registry = new(StringComparer.Ordinal);
    private static bool _checked;

    /// <summary>注册（或覆盖）一个特效。factory 每次播放调用一次，传入当次场地信息。</summary>
    public static void Define(string name, string description, Func<FxContext, FxDef> factory, FxInfo? info = null)
    {
        Registry[name] = new Entry(name, info ?? new FxInfo(description), factory);
    }

    /// <summary>特效是否已注册。</summary>
    public static bool IsDefined(string name) => Registry.ContainsKey(name);

    /// <summary>
    /// 窗口级覆盖：在窗口画布坐标 / 节点中心播放一次。未注册、页面未开、节点缺失只记 Warning 并返回 null。
    /// 窗口刚打开、锚点布局尚未解算时返回占位句柄，布局就绪后自动播放（最多等 1 秒）。
    /// </summary>
    public static FxHandle? Play(string pageId, string effect, FxAnchor at) => Overlay(pageId, effect, at, at, "Play");

    /// <summary>弹道类：从 from 到 to。特效从 from 出发，to 作为目标点传给定义。同样支持窗口刚打开时的延迟播放。</summary>
    public static FxHandle? Cast(string pageId, string effect, FxAnchor from, FxAnchor to) => Overlay(pageId, effect, from, to, "Cast");

    private static FxHandle? Overlay(string pageId, string effect, FxAnchor from, FxAnchor to, string verb)
    {
        if (!Prepare(pageId, effect, out var entry, out var surface)) return null;
        var rf = from.Resolve(surface, out _, out var errorFrom);
        var rt = to.Resolve(surface, out _, out var errorTo);
        if (rf == FxResolve.Missing || rt == FxResolve.Missing)
        {
            Game.Logger.LogWarning("DjuiFx: {Verb} {Effect} 失败：{Error}", verb, effect, errorFrom ?? errorTo);
            return null;
        }

        // 返回 null＝锚点还没就绪继续等；false＝确定失败；true＝已播放
        bool? Attempt(FxHandle? into, out FxHandle? played)
        {
            played = null;
            if (from.Resolve(surface, out var a, out _) != FxResolve.Ok || to.Resolve(surface, out var b, out _) != FxResolve.Ok) return null;
            var (w, h) = surface.CanvasSize;
            var def = Build(entry, new FxContext(w, h, a.X, a.Y, b.X, b.Y));
            if (def == null) return false;
            played = surface.PlayOverlay(def, a.X, a.Y, FxClock.Now, into);
            return played != null;
        }

        if (rf == FxResolve.Ok && rt == FxResolve.Ok)
        {
            Attempt(null, out var handle);
            return handle;
        }

        return surface.Defer(effect, FxClock.Now, into => Attempt(into, out _));
    }

    /// <summary>挂在节点上：跟随节点（缩放、位移），前后层夹住节点自己的子件，原点＝节点中心。同节点同特效重复调用会替换旧的。</summary>
    public static FxHandle? Attach(string pageId, string nodeId, string effect)
    {
        if (!Prepare(pageId, effect, out var entry, out var surface)) return null;
        var w = entry.Info.AttachWidth;
        var h = entry.Info.AttachHeight;
        var def = Build(entry, new FxContext(w, h, w / 2f, h / 2f, w / 2f, h / 2f));
        if (def == null) return null;
        var handle = surface.Attach(nodeId, def, w, h, FxClock.Now);
        if (handle == null) Game.Logger.LogWarning("DjuiFx: Attach {Effect} 失败：节点 {Node} 不存在（页面 {Page}）", effect, nodeId, pageId);
        return handle;
    }

    /// <summary>停止并销毁。句柄为 null 或已失效时是空操作。</summary>
    public static void Stop(FxHandle? handle) => handle?.Owner?.Stop(handle);

    /// <summary>停止某窗口上的全部特效（窗口未开则空操作）。</summary>
    public static void StopAll(string pageId) => FxSurface.ForPage(pageId, create: false)?.StopAll();

    /// <summary>泄漏自检计数。全部特效停止且窗口关闭后，Surfaces / Handles / Nodes / InUseCells 应全为 0。</summary>
    public static FxStats GetStats() => new(FxSurface.Count, FxSurface.HandleCount, FxSurface.NodeCount, FxCellPool.InUse, FxCellPool.IdleCount, FxCellPool.Created, FxCellPool.Disposed);

    /// <summary>自描述目录：已注册特效、元数据和当前计数。AI 使用特效前先读它。</summary>
    public static string Describe()
    {
        var sb = new StringBuilder();
        sb.AppendLine("DjuiFx 已注册特效：");
        foreach (var entry in Registry.Values.OrderBy(e => e.Name, StringComparer.Ordinal))
            sb.AppendLine($"- {entry.Name} [{entry.Info.Anchor}] {entry.Info.Description}（挂接区域 {entry.Info.AttachWidth:0}x{entry.Info.AttachHeight:0}）");
        var s = GetStats();
        sb.AppendLine($"计数：窗口 {s.Surfaces}，句柄 {s.Handles}，节点 {s.Nodes}，渲染单元 使用中 {s.InUseCells} / 空闲 {s.IdleCells}（累计创建 {s.CellsCreated}，销毁 {s.CellsDisposed}）");
        return sb.ToString();
    }

    /// <summary>
    /// 依赖预检（只检查，不安装）。首次播放会自动执行一次。
    /// 依赖：工程提供透明清屏的 RTT 渲染路径文件（DjuiFxOptions.RenderPath）。详见 runtime/AGENTS.md「特效」。
    /// </summary>
    public static FxCheckResult Check()
    {
        _checked = true;
        var problems = new List<string>();
        var cell = FxCellPool.Rent(64, 64);
        if (cell == null)
            problems.Add($"无法创建渲染纹理：请确认工程 res/ 下存在渲染路径文件 {DjuiFxOptions.RenderPath}（透明清屏），或设置 DjuiFxOptions.RenderPath。模板见 runtime/AGENTS.md「特效」");
        else
            FxCellPool.Return(cell, FxClock.Now);

        foreach (var problem in problems) Game.Logger.LogWarning("DjuiFx 依赖预检：{Problem}", problem);
        return new FxCheckResult(problems.Count == 0, problems);
    }

    private static bool Prepare(string pageId, string effect, out Entry entry, out FxSurface surface)
    {
        surface = null!;
        if (!Registry.TryGetValue(effect, out entry!))
        {
            Game.Logger.LogWarning("DjuiFx: 特效 {Effect} 未注册。已注册：{Names}", effect, string.Join(", ", Registry.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList()));
            return false;
        }

        if (!_checked && !Check().Ok) return false;
        var found = FxSurface.ForPage(pageId, create: true);
        if (found == null)
        {
            Game.Logger.LogWarning("DjuiFx: 页面 {Page} 未打开，特效 {Effect} 未播放（先 OpenWindow）", pageId, effect);
            return false;
        }

        surface = found;
        return true;
    }

    private static FxDef? Build(Entry entry, FxContext context)
    {
        try { return entry.Factory(context); }
        catch (Exception ex)
        {
            Game.Logger.LogWarning("DjuiFx: 特效 {Effect} 的定义构建异常（已隔离）：{Message}", entry.Name, ex.Message);
            return null;
        }
    }
}

#endif
