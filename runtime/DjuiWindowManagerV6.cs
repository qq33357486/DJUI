#if CLIENT

using System.Text.Json;
using System.Text.Json.Serialization;
using GameUI.Control;
using GameUI.Control.Extensions;
using GameUI.Device;
using GameUI.Enum;

namespace DjuiRuntime;

/// <summary>DJUI v6 严格项目与窗口实例管理器。</summary>
public static class DjuiWindowManagerV6
{
    private const string RootDir = "user_files/djui";
    private const string ProjectFile = RootDir + "/project.json";
    private const string PagesDir = RootDir + "/pages";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = false, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    private static readonly Dictionary<string, DjuiPageV6> Pages = new();
    private static readonly Dictionary<string, DjuiTreeInstanceV6> Instances = new();
    private static readonly Dictionary<string, List<string>> PageInstances = new();
    private static readonly Dictionary<string, string> SingletonInstances = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, int> ClosingTransitions = new(StringComparer.Ordinal);
    private static DjuiProjectV6? _project;
    private static ulong _nextInstanceId;

    // === 窗口保留池（0.8.0：关闭与销毁分离）===
    // CloseWindow 只摘栈隐藏（IsOpen 立即 false）；单例实例入 FIFO 池待复用（复用重排到最新＝隐式 LRU），
    // 白名单页钉住永不淘汰；淘汰与强关统一经 DisposeDelayMs 缓冲再销毁——按压回弹动画在活树上自然播完，
    // 规避引擎 TouchBehavior 对已销毁控件每帧报 "Control is not valid" 的僵尸动画（S00016 实证）。
    private const int DefaultPoolCapacity = 5;
    private const int DisposeDelayMs = 250;
    private static readonly LinkedList<RetainedEntry> Pool = new();      // FIFO：头＝最老（淘汰位），尾＝最新
    private static readonly List<RetainedEntry> Disposing = new();       // 销毁缓冲队列（250ms 倒计时）
    private static readonly HashSet<string> PinnedPages = new(StringComparer.Ordinal);
    private static readonly HashSet<string> SingletonOpened = new(StringComparer.Ordinal); // OpenWindow 单例路径开的实例（唯一可入池复用的来源；OpenInstance 多实例不入池）
    private static int _poolCapacity = DefaultPoolCapacity;

    // === 生命周期事件（0.8.0）===
    // OnCreate＝建树后（池淘汰重建会再次触发）；OnOpen＝每次显示（新建 / 池复用，OpenWindow 返回前同步触发）；
    // OnClose＝摘栈进池前（寻址注册表尚未注销，回调内控件仍可寻址）；OnDestroy＝真正 Dispose 前。
    // 关闭转场中途重开（CancelClosing）不触发任何事件——窗口从未真正关闭。
    private static readonly Dictionary<string, List<Action>> CreateHandlers = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, List<Action>> OpenHandlers = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, List<Action>> CloseHandlers = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, List<Action>> DestroyHandlers = new(StringComparer.Ordinal);

    // 生命周期计数（验收排障：建树 / 复用 / 销毁）
    private static int _buildCount;
    private static int _reuseCount;
    private static int _disposeCount;

    private sealed class RetainedEntry
    {
        public required string InstanceId { get; init; }
        public required DjuiTreeInstanceV6 Instance { get; init; }
        public required string PageId { get; init; }
        public bool Pinned { get; init; }
        public double RemainingMs { get; set; }             // 仅 Disposing 队列使用
        public LinkedListNode<RetainedEntry>? Node { get; set; }
    }

    public static void Initialize()
    {
        CloseAll();
        Pages.Clear();
        PageInstances.Clear();
        SingletonInstances.Clear();
        ClosingTransitions.Clear();
        _nextInstanceId = 0;
        DjuiAudioSystem.Initialize();
        if (!File.Exists(ProjectFile)) throw new FileNotFoundException("DJUI v6: 缺少项目配置", ProjectFile);
        _project = DeserializeStrict<DjuiProjectV6>(ProjectFile);
        RequireVersion(_project.ProtocolVersion, _project.SchemaVersion, ProjectFile);
        if (_project.Canvas.ReferenceWidth <= 0 || _project.Canvas.ReferenceHeight <= 0) throw new InvalidDataException("DJUI v6: 项目参考尺寸必须大于 0");
        var mode = _project.Canvas.Mode switch
        {
            "Contain" => ScaleMode.Contain,
            "MatchWidth" => ScaleMode.MatchWidth,
            "MatchHeight" => ScaleMode.MatchHeight,
            _ => throw new InvalidDataException($"DJUI v6: 不支持 Canvas 模式 {_project.Canvas.Mode}"),
        };
        DeviceInfo.PrimaryViewport.SetDesignResolution(_project.Canvas.ReferenceWidth, _project.Canvas.ReferenceHeight, mode);
        if (!Directory.Exists(PagesDir)) throw new DirectoryNotFoundException($"DJUI v6: 页面目录不存在: {PagesDir}");
        foreach (var file in Directory.GetFiles(PagesDir, "*.json"))
        {
            var page = DeserializeStrict<DjuiPageV6>(file);
            RequireVersion(page.ProtocolVersion, page.SchemaVersion, file);
            if (string.IsNullOrWhiteSpace(page.PageId)) throw new InvalidDataException($"DJUI v6: 页面 ID 为空: {file}");
            if (!Pages.TryAdd(page.PageId, page)) throw new InvalidDataException($"DJUI v6: 页面 ID 重复: {file}");
        }
        // 保留池配置（project.json 可选字段；页面加载后校验名单）
        PinnedPages.Clear();
        foreach (var pageId in _project.RetainedPages ?? [])
        {
            if (!Pages.ContainsKey(pageId))
            {
                Game.Logger.LogWarning("DJUI v6: retainedPages 含未知页面 {Page}，已忽略", pageId);
                continue;
            }
            PinnedPages.Add(pageId);
        }
        _poolCapacity = Math.Max(0, _project.PoolCapacity ?? DefaultPoolCapacity);
        Game.Logger.LogInformation("DJUI v6: 已严格加载 {Count} 个页面（窗口池容量 {Capacity}，钉住 {Pinned} 页）", Pages.Count, _poolCapacity, PinnedPages.Count);
    }

    /// <summary>兼容业务页面语义：同一 pageId 只打开一个单例窗口。保留池命中时直接复用（不重建树）。</summary>
    public static Panel OpenWindow(string pageId)
    {
        if (SingletonInstances.TryGetValue(pageId, out var existing) && Instances.TryGetValue(existing, out var open))
        {
            CancelClosing(existing);
            return open.Root;
        }
        if (TryReusePooled(pageId, out var reused)) return reused;
        var id = OpenInstance(pageId);
        SingletonInstances[pageId] = id;
        SingletonOpened.Add(id);
        return Instances[id].Root;
    }

    /// <summary>保留池复用：按 pageId 找单例实例条目，取出挂树、回注册表、重解算、播 open 转场。</summary>
    private static bool TryReusePooled(string pageId, out Panel? root)
    {
        RetainedEntry? hit = null;
        for (var node = Pool.Last; node != null; node = node.Previous)
        {
            if (!string.Equals(node.Value.PageId, pageId, StringComparison.Ordinal)) continue;
            hit = node.Value;
            break;
        }
        if (hit == null)
        {
            root = null;
            return false;
        }
        Pool.Remove(hit.Node!);
        var instance = hit.Instance;
        var id = hit.InstanceId;
        Instances.Add(id, instance);
        if (!PageInstances.TryGetValue(pageId, out var list)) PageInstances[pageId] = list = new List<string>();
        list.Add(id);
        SingletonInstances[pageId] = id;
        SingletonOpened.Add(id);
        instance.Host.AddToVisualTree();          // 引擎官方注释：对象池复用场景即摘/挂可视树
        instance.Session.Relayout();              // 隐藏期间可能转屏——重解算布局
        _reuseCount++;
        Game.Logger.LogInformation("DJUI v6: 复用窗口 {Page}#{Id}（{Kind}）", pageId, id, hit.Pinned ? "钉住" : "窗口池");
        DjuiTransitionPlayer.Play(instance.Root, Pages.TryGetValue(pageId, out var page) ? page.Window?.Transition?.Open : null);
        RaiseEvent(OpenHandlers, pageId, "OnOpen");
        root = instance.Root;
        return true;
    }

    /// <summary>显式创建同一页面的独立窗口实例（多实例不复用、不入池，关闭走销毁缓冲）。</summary>
    public static string OpenInstance(string pageId)
    {
        var project = _project ?? throw new InvalidOperationException("DJUI v6: 请先 Initialize");
        if (!Pages.TryGetValue(pageId, out var page)) throw new KeyNotFoundException($"DJUI v6: 页面不存在: {pageId}");
        if (!string.Equals(page.Kind, "window", StringComparison.Ordinal)) throw new InvalidOperationException($"DJUI v6: {pageId} 不是 Window 页面");
        var id = "w" + (++_nextInstanceId).ToString();
        var host = new Panel { Name = $"DJUI.v6.{pageId}.{id}" };
        host.FullScreen();
        host.AddToVisualTree();
        try
        {
            var expandedPage = DjuiTemplateExpanderV6.Expand(page, Pages);
            var instance = DjuiTreeBuilderV6.Build(id, project, expandedPage, host);
            Instances.Add(id, instance);
            if (!PageInstances.TryGetValue(pageId, out var list)) PageInstances[pageId] = list = new List<string>();
            list.Add(id);
            DjuiTransitionPlayer.Play(instance.Root, page.Window?.Transition?.Open);
            _buildCount++;
            Game.Logger.LogInformation("DJUI v6: 建树 {Page}#{Id}", pageId, id);
            RaiseEvent(CreateHandlers, pageId, "OnCreate");
            RaiseEvent(OpenHandlers, pageId, "OnOpen");
            return id;
        }
        catch
        {
            host.RemoveFromVisualTreeAndParent();
            host.Dispose();
            throw;
        }
    }

    public static T? GetControl<T>(string windowInstanceId, string nodeInstanceId) where T : Control
    {
        return Instances.TryGetValue(windowInstanceId, out var instance) ? instance.Session.GetControl<T>(nodeInstanceId) : null;
    }

    public static Control? GetControl(string pageId, string nodeInstanceId)
        => GetSingletonControl<Control>(pageId, nodeInstanceId);

    public static T? GetControlByPage<T>(string pageId, string nodeInstanceId) where T : Control
        => GetSingletonControl<T>(pageId, nodeInstanceId);

    public static T? GetSingletonControl<T>(string pageId, string nodeInstanceId) where T : Control
    {
        return SingletonInstances.TryGetValue(pageId, out var id) ? GetControl<T>(id, nodeInstanceId) : null;
    }

    public static bool IsOpen(string pageId)
        => SingletonInstances.TryGetValue(pageId, out var id) && Instances.ContainsKey(id);

    public static Panel? GetOpenWindow(string pageId)
        => SingletonInstances.TryGetValue(pageId, out var id) && Instances.TryGetValue(id, out var instance) ? instance.Root : null;

    public static string? GetSingletonInstanceId(string pageId)
        => IsOpen(pageId) ? SingletonInstances[pageId] : null;

    public static IReadOnlyList<string> GetInstances(string pageId)
    {
        return PageInstances.TryGetValue(pageId, out var ids) ? ids.AsReadOnly() : Array.Empty<string>();
    }

    private static ulong _nextCloneSeq;

    /// <summary>
    /// 复制窗口内一个节点子树，返回一份新构建的控件实例（不挂树、不绑 action/音效/数据绑定——如同 new）。
    /// 克隆体沿用源子树当前解算矩形，初始与源完全重叠；父级/位置/显隐由调用方管理。
    /// 克隆体登记进布局会话但 authored 树不变——relayout（转屏/缩放）不作用于克隆体，需要跟随重排时销毁重建。
    /// 子控件寻址：控件 Name 取自页面 JSON 的 name 字段，用引擎 FindChild(name)/FindChildren(name)。
    /// </summary>
    public static Control CloneControl(string windowInstanceId, string nodeInstanceId)
    {
        var project = _project ?? throw new InvalidOperationException("DJUI v6: 请先 Initialize");
        var instance = Instances.TryGetValue(windowInstanceId, out var tree)
            ? tree
            : throw new KeyNotFoundException($"DJUI v6: 窗口实例不存在: {windowInstanceId}");
        var source = FindNode(instance.Session.CurrentPage.Root, nodeInstanceId)
            ?? throw new KeyNotFoundException($"DJUI v6: 节点不存在: {nodeInstanceId}");
        var solved = DjuiLayoutSolverV6.SolveV6(instance.Session.CurrentPage, instance.Session.CurrentPlan);
        var suffix = "#c" + (++_nextCloneSeq).ToString();
        return DjuiTreeBuilderV6.BuildClone(source, instance.Session, project.DefaultFont, instance.ImageVisuals, instance.ProgressVisuals, instance.ButtonStates, suffix, solved);
    }

    private static DjuiNodeV6? FindNode(DjuiNodeV6 root, string id)
    {
        if (string.Equals(root.Id, id, StringComparison.Ordinal)) return root;
        foreach (var child in root.Children)
        {
            var hit = FindNode(child, id);
            if (hit != null) return hit;
        }
        return null;
    }

    public static void CloseWindow(string pageOrInstanceId)
    {
        var windowInstanceId = SingletonInstances.TryGetValue(pageOrInstanceId, out var singletonId) ? singletonId : pageOrInstanceId;
        if (!Instances.TryGetValue(windowInstanceId, out var instance) || ClosingTransitions.ContainsKey(windowInstanceId)) return;
        var closePreset = instance.Session.CurrentPage.Window?.Transition?.Close;
        // 无 close 转场不再同帧销毁——摘栈隐藏进保留池，销毁统一延后（僵尸动画兜底）
        var transitionId = DjuiTransitionPlayer.Play(instance.Root, closePreset, () => DetachWindow(windowInstanceId));
        if (transitionId < 0) DetachWindow(windowInstanceId);
        else ClosingTransitions[windowInstanceId] = transitionId;
    }

    private static void CancelClosing(string windowInstanceId)
    {
        if (!ClosingTransitions.Remove(windowInstanceId, out var transitionId)) return;
        DjuiTransitionPlayer.Stop(transitionId);
        if (Instances.TryGetValue(windowInstanceId, out var instance)) instance.Session.Relayout();
    }

    /// <summary>
    /// 摘栈隐藏（可逆）：OnClose 事件 → 注销寻址注册表（IsOpen 立即 false，语义与旧版一致）→
    /// 停转场 → Host 摘出可视树（不可见＋退出事件链，引擎对象池复用官方姿势）→ 入保留池或销毁缓冲。
    /// 单例实例入 FIFO 池（白名单页钉住永不淘汰；容量满淘汰最老非钉住条目）；
    /// OpenInstance 多实例与池容量 0 的页直接进销毁缓冲。
    /// </summary>
    private static void DetachWindow(string windowInstanceId)
    {
        ClosingTransitions.Remove(windowInstanceId);
        if (!Instances.TryGetValue(windowInstanceId, out var instance)) return;
        var pageId = instance.Session.CurrentPage.PageId;
        var fromSingleton = SingletonOpened.Remove(windowInstanceId);

        // OnClose 必须在注销寻址注册表之前触发——此时 IsOpen 仍为 true、GetSingletonControl 仍可用
        RaiseEvent(CloseHandlers, pageId, "OnClose");

        Instances.Remove(windowInstanceId);
        foreach (var singleton in SingletonInstances.Where(pair => pair.Value == windowInstanceId).ToArray()) SingletonInstances.Remove(singleton.Key);
        foreach (var pair in PageInstances.ToArray())
        {
            if (!pair.Value.Remove(windowInstanceId)) continue;
            if (pair.Value.Count == 0) PageInstances.Remove(pair.Key);
            break;
        }
        DjuiTransitionPlayer.Stop(instance.Root);
        instance.Host.RemoveFromVisualTreeAndParent();

        var pinned = fromSingleton && PinnedPages.Contains(pageId);
        if (!fromSingleton || (!pinned && _poolCapacity <= 0))
        {
            // 多实例不复用；容量 0＝纯钉住模式：非钉住条目不入池
            ScheduleDispose(new RetainedEntry { InstanceId = windowInstanceId, Instance = instance, PageId = pageId, Pinned = false });
            return;
        }
        var entry = new RetainedEntry { InstanceId = windowInstanceId, Instance = instance, PageId = pageId, Pinned = pinned };
        entry.Node = Pool.AddLast(entry);
        TrimPool();
    }

    /// <summary>容量检查：非钉住条目超容量时，从池头（最老）逐个淘汰进销毁缓冲。</summary>
    private static void TrimPool()
    {
        var unpinned = 0;
        for (var node = Pool.First; node != null; node = node.Next)
            if (!node.Value.Pinned) unpinned++;
        while (unpinned > _poolCapacity)
        {
            for (var node = Pool.First; node != null; node = node.Next)
            {
                if (node.Value.Pinned) continue;
                var evicted = node.Value;
                Pool.Remove(node);
                unpinned--;
                Game.Logger.LogInformation("DJUI v6: 窗口池满，淘汰 {Page}#{Id}（{Delay}ms 后销毁）", evicted.PageId, evicted.InstanceId, DisposeDelayMs);
                ScheduleDispose(evicted);
                break;
            }
        }
    }

    /// <summary>登记销毁缓冲（DisposeDelayMs 帧驱动倒计时）——淘汰、多实例关闭、容量 0 页共用。</summary>
    private static void ScheduleDispose(RetainedEntry entry)
    {
        entry.RemainingMs = DisposeDelayMs;
        entry.Node = null;
        Disposing.Add(entry);
        EnsureRetentionThinker();
    }

    /// <summary>真正销毁（不可逆）：OnDestroy 事件 → Dispose。外层兜底异常——条目已先出队，无论成败不残留。</summary>
    private static void DisposeInstance(RetainedEntry entry)
    {
        RaiseEvent(DestroyHandlers, entry.PageId, "OnDestroy");
        _disposeCount++;
        try { entry.Instance.Dispose(); }
        catch (Exception ex) { Game.Logger.LogWarning("DJUI v6: 窗口销毁异常（已隔离）：{Page}#{Id} {Message}", entry.PageId, entry.InstanceId, ex.Message); }
    }

    /// <summary>销毁缓冲倒计时（与 DjuiTransitionPlayer 同款 IThinker 帧驱动模式，delta 单位毫秒）。</summary>
    private sealed class RetentionThinker : IThinker
    {
        public bool DoesThink { get; set; } = true;

        public void Think(int delta)
        {
            for (var i = Disposing.Count - 1; i >= 0; i--)
            {
                var entry = Disposing[i];
                entry.RemainingMs -= delta;
                if (entry.RemainingMs > 0) continue;
                Disposing.RemoveAt(i);   // 先出队再销毁——异常不丢条目
                DisposeInstance(entry);
            }
        }
    }

    private static RetentionThinker? _retentionThinker;

    private static void EnsureRetentionThinker()
    {
        if (_retentionThinker != null) return;
        _retentionThinker = new RetentionThinker();
        Game.RegisterThinker(_retentionThinker);
    }

    public static void CloseAll()
    {
        foreach (var id in Instances.Keys.ToArray())
        {
            CancelClosing(id);
            DetachWindow(id);
        }
        // 池与销毁缓冲全清（立即销毁）：跨 Initialize 的旧树绝不能复用——页面 JSON 可能在进程重启间隙更新过
        foreach (var entry in Pool.ToArray()) DisposeInstance(entry);
        Pool.Clear();
        foreach (var entry in Disposing.ToArray()) DisposeInstance(entry);
        Disposing.Clear();
        SingletonOpened.Clear();
    }

    /// <summary>注册窗口生命周期事件（多订阅，进程级）。OnCreate＝建树后；OnOpen＝每次显示（新建/池复用）；OnClose＝摘栈进池前；OnDestroy＝真正销毁前。转场中途重开不触发任何事件。</summary>
    public static void OnCreate(string pageId, Action handler) => AddHandler(CreateHandlers, pageId, handler);
    public static void OnOpen(string pageId, Action handler) => AddHandler(OpenHandlers, pageId, handler);
    public static void OnClose(string pageId, Action handler) => AddHandler(CloseHandlers, pageId, handler);
    public static void OnDestroy(string pageId, Action handler) => AddHandler(DestroyHandlers, pageId, handler);

    private static void AddHandler(Dictionary<string, List<Action>> table, string pageId, Action handler)
    {
        if (!table.TryGetValue(pageId, out var list)) table[pageId] = list = new List<Action>();
        list.Add(handler);
    }

    /// <summary>触发事件：逐回调隔离异常——生命周期通知是旁路逻辑，不允许阻断窗口状态机。</summary>
    private static void RaiseEvent(Dictionary<string, List<Action>> table, string pageId, string eventName)
    {
        if (!table.TryGetValue(pageId, out var list)) return;
        foreach (var handler in list.ToArray())
        {
            try { handler(); }
            catch (Exception ex) { Game.Logger.LogWarning("DJUI v6: {Event} 事件回调异常（已隔离）：{Page} {Message}", eventName, pageId, ex.Message); }
        }
    }

    /// <summary>窗口生命周期计数（建树 / 复用 / 销毁），供验收与排障：连开连关 N 次建树数应恒定、复用数应递增。</summary>
    public static (int Built, int Reused, int Disposed) GetLifecycleStats() => (_buildCount, _reuseCount, _disposeCount);

    private static T DeserializeStrict<T>(string file) where T : class
    {
        var json = File.ReadAllText(file);
        return JsonSerializer.Deserialize<T>(json, JsonOptions) ?? throw new InvalidDataException($"DJUI v6: JSON 为空: {file}");
    }

    private static void RequireVersion(int protocolVersion, int schemaVersion, string file)
    {
        if (protocolVersion != DjuiProtocolV6.ProtocolVersion || schemaVersion != DjuiProtocolV6.SchemaVersion)
            throw new InvalidDataException($"DJUI v6: 版本不匹配 {file}; 需要 protocolVersion=6, schemaVersion=1");
    }
}

#endif
