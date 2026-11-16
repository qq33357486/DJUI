#if CLIENT

using System.Runtime.CompilerServices;
using GameUI.Control;
using GameUI.Device;
using GameUI.Enum;
using GameUI.Struct;

namespace DjuiRuntime;

/// <summary>
/// v6 窗口实例的持久布局会话。控件树只构建一次，视口变化时原地应用新矩形。
/// </summary>
public sealed class DjuiLayoutSessionV6 : IDisposable
{
    private readonly ScreenViewport _viewport;
    private readonly DjuiProjectV6 _project;
    private readonly DjuiPageV6 _page;
    private readonly Dictionary<string, Control> _controls = new();
    // Control → 节点实例 id 反查表（与 _controls 同步维护）：SetImage(Control) 直控口径的寻址依据
    private readonly Dictionary<Control, string> _controlIds = new();
    // 宽屏 override 冲突告警去重（同节点只提醒一次，先例：DjuiImageVisualLayerV6._warnedMissingSourceSize）
    private readonly HashSet<string> _warnedImageOverride = new(StringComparer.Ordinal);
    private readonly HashSet<string> _warnedTintOverride = new(StringComparer.Ordinal);
    // Control → 所属会话的进程级弱表：控件 Dispose 后条目自动消失，无泄漏（先例：DjuiButtonStateRegistryV6.States）
    private static readonly ConditionalWeakTable<Control, DjuiLayoutSessionV6> OwnerIndex = new();
    private Action<DjuiNodeV6, Control, float>? _nodeUpdater;
    private readonly Action<int, int> _sizeChanged;
    private readonly Action<DisplayOrientations> _orientationChanged;
    private readonly Action<float> _dprChanged;
    private readonly Action _viewportChanged;
    private bool _disposed;

    public string WindowInstanceId { get; }
    public IReadOnlyDictionary<string, Control> Controls => _controls;
    /// <summary>窗口挂载边界宿主（DjuiTreeBuilderV6.Build 赋值）。host 建窗时 FullScreen() 的弹性设置是一次性的，
    /// 引擎不保证视口变化后重排视觉树根下的弹性控件（实证快照：外层 host 停旧值 vs 内部解算新值 → 黑边）——
    /// 每轮 Relayout 用与 root 同款的确定式矩形显式同步，覆盖视口去抖/建树收尾/池复用/取消关闭全部路径。</summary>
    internal Panel? MountHost { get; set; }
    /// <summary>持有本会话的树实例（DjuiTreeBuilderV6.Build 收尾赋值；建树期内为 null）。
    /// SetImage 运行期取 ImageVisuals/ButtonStates 刷新 visual 用。</summary>
    internal DjuiTreeInstanceV6? Owner { get; set; }
    public DjuiCanvasPlanV6 CurrentPlan { get; private set; }
    public DjuiPageV6 CurrentPage { get; private set; }
    // 转场在解算前撤销临时几何，解算后以新布局继续同一时间进度；不重建树。
    internal event Action? BeforeRelayout;
    internal event Action? AfterRelayout;

    public DjuiLayoutSessionV6(string windowInstanceId, DjuiProjectV6 project, DjuiPageV6 page, ScreenViewport? viewport = null)
    {
        if (string.IsNullOrWhiteSpace(windowInstanceId)) throw new ArgumentException("窗口实例 ID 不能为空", nameof(windowInstanceId));
        WindowInstanceId = windowInstanceId;
        _project = project ?? throw new ArgumentNullException(nameof(project));
        _page = page ?? throw new ArgumentNullException(nameof(page));
        _viewport = viewport ?? DeviceInfo.PrimaryViewport;
        CurrentPlan = CreateCurrentPlan();
        CurrentPage = DjuiResponsiveResolverV6.Resolve(_page, CurrentPlan.Wide);
        // 视口变化统一走文末去抖器。两类入口并存：
        // ① 统一事件 OnViewportChanged（引擎唯一文档化事件，"完成更新后触发"，新客户端路径只发它——
        //    实证 0.35.1 快照：编辑器切分辨率只改实际尺寸时不发粒度事件，漏订导致布局永不重排）；
        // ② 三个粒度事件（未文档化，旧客户端兼容路径才发；到达时读数可能是中间值）。
        _sizeChanged = (_, _) => MarkViewportDirty();
        _orientationChanged = _ => MarkViewportDirty();
        _dprChanged = _ => MarkViewportDirty();
        _viewportChanged = MarkViewportDirty;
        _viewport.OnSizeChanged += _sizeChanged;
        _viewport.OnOrientationChanged += _orientationChanged;
        _viewport.OnDevicePixelRatioChanged += _dprChanged;
        _viewport.OnViewportChanged += _viewportChanged;
    }

    public void Register(string nodeInstanceId, Control control)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (string.IsNullOrWhiteSpace(nodeInstanceId)) throw new ArgumentException("节点实例 ID 不能为空", nameof(nodeInstanceId));
        if (!_controls.TryAdd(nodeInstanceId, control)) throw new InvalidOperationException($"DJUI v6: 实例 {WindowInstanceId} 内节点 ID 重复: {nodeInstanceId}");
        // authored 与克隆体的唯一登记口都在这里——反查表与弱表一次性全覆盖两类控件
        _controlIds[control] = nodeInstanceId;
        OwnerIndex.AddOrUpdate(control, this);
    }

    /// <summary>按 Control 引用反查所属布局会话（非 DJUI 管理的控件返回 null）。</summary>
    internal static DjuiLayoutSessionV6? FindOwner(Control control)
        => OwnerIndex.TryGetValue(control, out var session) ? session : null;

    /// <summary>按 Control 引用反查节点实例 id（未登记返回 null）。</summary>
    internal string? FindNodeId(Control control)
        => _controlIds.TryGetValue(control, out var id) ? id : null;

    /// <summary>
    /// SetImage / image 绑定通道的模型写入点：同步更新会话源树 _page 与当前解析视图 CurrentPage 的
    /// appearance.Image——relayout 重放（ApplyNodeFields → imageVisuals.Apply / ApplyButton）以这两棵树为
    /// 唯一数据源，写在这里才能活过任意次重放（宽屏深拷贝态也因写穿 _page 而存活）。
    /// 空串/void 统一归一为 null。返回节点是否在 authored 树中（克隆 id 不在，返回 false）。
    /// </summary>
    internal bool UpdateAuthoredImage(string nodeInstanceId, string? image)
    {
        var normalized = string.IsNullOrWhiteSpace(image) ? null : image;
        // 宽屏 override 冲突检测：该节点声明了 responsive.wide.overrides 的 "appearance.image" 时，
        // 宽屏层每次 Resolve 都会把 authored 宽屏图盖回来，写入无效——告警一次并提示替代方案
        if (_warnedImageOverride.Add(nodeInstanceId)
            && _page.Responsive?.Wide.Overrides.TryGetValue(nodeInstanceId, out var fields) == true
            && fields.ContainsKey("appearance.image"))
        {
            Game.Logger.LogWarning("DJUI v6: 节点 {Node} 声明了宽屏覆盖 appearance.image，宽屏态 SetImage 换图不生效（请改用双节点法或去掉该覆盖）", nodeInstanceId);
        }
        var node = FindNodeIn(_page.Root, nodeInstanceId);
        if (node == null) return false;
        node.Appearance ??= new DjuiAppearanceV6();
        node.Appearance.Image = normalized;
        // 宽屏副本态（CurrentPage 是 _page 的深拷贝）：两棵树都写，当前显示立即一致，无需强制 Relayout
        if (!ReferenceEquals(CurrentPage, _page))
        {
            var viewNode = FindNodeIn(CurrentPage.Root, nodeInstanceId);
            if (viewNode != null)
            {
                viewNode.Appearance ??= new DjuiAppearanceV6();
                viewNode.Appearance.Image = normalized;
            }
        }
        return true;
    }

    /// <summary>
    /// SetTint 的模型写入点（与 UpdateAuthoredImage 同构）：写穿 _page 与 CurrentPage 两棵树的
    /// appearance.ImageTint，relayout 重放时由 imageVisuals.Apply / progressVisuals.Apply 消费。
    /// 空串统一归一为 null（撤销染色）。返回节点是否在 authored 树中。
    /// </summary>
    internal bool UpdateAuthoredTint(string nodeInstanceId, string? tint)
    {
        var normalized = string.IsNullOrWhiteSpace(tint) ? null : tint;
        if (_warnedTintOverride.Add(nodeInstanceId)
            && _page.Responsive?.Wide.Overrides.TryGetValue(nodeInstanceId, out var fields) == true
            && fields.ContainsKey("appearance.imageTint"))
        {
            Game.Logger.LogWarning("DJUI v6: 节点 {Node} 声明了宽屏覆盖 appearance.imageTint，宽屏态 SetTint 染色不生效（请改用双节点法或去掉该覆盖）", nodeInstanceId);
        }
        var node = FindNodeIn(_page.Root, nodeInstanceId);
        if (node == null) return false;
        node.Appearance ??= new DjuiAppearanceV6();
        node.Appearance.ImageTint = normalized;
        if (!ReferenceEquals(CurrentPage, _page))
        {
            var viewNode = FindNodeIn(CurrentPage.Root, nodeInstanceId);
            if (viewNode != null)
            {
                viewNode.Appearance ??= new DjuiAppearanceV6();
                viewNode.Appearance.ImageTint = normalized;
            }
        }
        return true;
    }

    private static DjuiNodeV6? FindNodeIn(DjuiNodeV6 node, string id)
    {
        if (string.Equals(node.Id, id, StringComparison.Ordinal)) return node;
        foreach (var child in node.Children)
        {
            var hit = FindNodeIn(child, id);
            if (hit != null) return hit;
        }
        return null;
    }

    /// <summary>注册节点字段更新器（relayout 时逐节点回调）。第三参为场景画板累计缩放
    /// （sceneFrame 子树内 artboard→背景帧的映射比例，画板外恒为 1）——字号/描边等"非矩形属性"需自行补乘。</summary>
    public void SetNodeUpdater(Action<DjuiNodeV6, Control, float> updater)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _nodeUpdater = updater ?? throw new ArgumentNullException(nameof(updater));
    }

    public T? GetControl<T>(string nodeInstanceId) where T : Control
    {
        return _controls.TryGetValue(nodeInstanceId, out var control) ? control as T : null;
    }

    public void Relayout()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        // 手动重算已按当前读数解算，作废视口等待（防紧随其后的去抖重排重复算一遍）
        ForgetViewportPending(this);
        BeforeRelayout?.Invoke();
        CurrentPlan = CreateCurrentPlan();
        CurrentPage = DjuiResponsiveResolverV6.Resolve(_page, CurrentPlan.Wide);
        var nodes = new Dictionary<string, DjuiNodeV6>(StringComparer.Ordinal);
        IndexNodes(CurrentPage.Root, nodes);
        var sceneScales = new Dictionary<string, float>();
        var solved = DjuiLayoutSolverV6.SolveV6(CurrentPage, CurrentPlan, sceneScales);
        var parents = new Dictionary<string, string?>(StringComparer.Ordinal);
        IndexParents(CurrentPage.Root, null, parents);
        foreach (var (nodeId, rect) in solved)
        {
            if (!_controls.TryGetValue(nodeId, out var control)) continue;
            var localRect = rect;
            if (parents.TryGetValue(nodeId, out var parentId) && parentId != null && solved.TryGetValue(parentId, out var parentRect))
                localRect = new DjuiRectV6(rect.X - parentRect.X, rect.Y - parentRect.Y, rect.Width, rect.Height);
            ApplyRect(control, localRect);
            if (_nodeUpdater != null && nodes.TryGetValue(nodeId, out var node))
                _nodeUpdater(node, control, sceneScales.TryGetValue(nodeId, out var sceneScale) ? sceneScale : 1f);
        }
        SyncMountHost();
        AfterRelayout?.Invoke();
    }

    /// <summary>把宿主显式同步为当前画布矩形（与 root 同款确定式写入）。尺寸未变时跳过（含首排读数已相等的情形）。</summary>
    private void SyncMountHost()
    {
        if (MountHost == null) return;
        var width = CurrentPlan.CanvasRect.Width;
        var height = CurrentPlan.CanvasRect.Height;
        // Width 读法同 DjuiWindowManagerV6.ReadWidth：未显式设置时为 Auto，显式回显 NaN → 视为"有变化"落入写入分支
        var hostWidth = MountHost.Width.IsAuto ? float.NaN : MountHost.Width.Value;
        var hostHeight = MountHost.Height.IsAuto ? float.NaN : MountHost.Height.Value;
        // NaN（Auto 未设值）参与比较恒为 false → 视为"有变化"落入写入分支
        var unchanged = Math.Abs(hostWidth - width) < 0.01f && Math.Abs(hostHeight - height) < 0.01f;
        if (unchanged) return;
        Game.Logger.LogInformation($"DJUI v6 host sync {MountHost.Name}: {hostWidth:F0}x{hostHeight:F0} -> {width:F0}x{height:F0}");
        ApplyRect(MountHost, new DjuiRectV6(0, 0, width, height));
    }

    private static void IndexNodes(DjuiNodeV6 node, Dictionary<string, DjuiNodeV6> nodes)
    {
        if (!nodes.TryAdd(node.Id, node)) throw new InvalidDataException($"DJUI v6: expanded node ID duplicate: {node.Id}");
        foreach (var child in node.Children) IndexNodes(child, nodes);
    }

    private static void IndexParents(DjuiNodeV6 node, string? parentId, Dictionary<string, string?> parents)
    {
        parents[node.Id] = parentId;
        foreach (var child in node.Children) IndexParents(child, node.Id, parents);
    }

    public static void ApplyRect(Control control, DjuiRectV6 rect)
    {
        control.PositionType = UIPositionType.Absolute;
        control.HorizontalAlignment = HorizontalAlignment.Left;
        control.VerticalAlignment = VerticalAlignment.Top;
        control.Position = new UIPosition(rect.X, rect.Y);
        control.Width = rect.Width;
        control.Height = rect.Height;
    }

    private DjuiCanvasPlanV6 CreateCurrentPlan()
    {
        var size = _viewport.Size;
        var safe = _viewport.SafeZonePadding;
        Game.Logger.LogInformation($"DJUI v6 layout: viewport.Size={size.Width}x{size.Height} px={_viewport.WidthPx}x{_viewport.HeightPx} safe={safe.Left},{safe.Top},{safe.Right},{safe.Bottom} canvas={CurrentPlan?.CanvasRect.Width ?? -1}x{CurrentPlan?.CanvasRect.Height ?? -1}");
        // 布局对齐诊断:输出关键节点解算矩形(设计坐标系),配合 viewport 日志可人工核算对齐
        try
        {
            var solved = DjuiLayoutSolverV6.SolveV6(CurrentPage, DjuiCanvasV6.CreateLogicalPlan(size.Width, size.Height, new DjuiInsetsV6(safe.Left, safe.Top, safe.Right, safe.Bottom), _viewport.WidthPx, _viewport.HeightPx, _project));
            var pick = new[] { "scene_background", "building_group", "scene02_background", "scene02_building_group", "scene03_hangzhou_background", "scene03_hangzhou_building_group" };
            foreach (var id in pick)
                if (solved.TryGetValue(id, out var r))
                    Game.Logger.LogInformation($"DJUI v6 rect {id}: ({r.X:F1},{r.Y:F1}) {r.Width:F1}x{r.Height:F1}");
        }
        catch { /* 诊断失败不影响布局 */ }
        // Size 与 SafeZonePadding 均已经是引擎当前设计坐标；不再做第二次 DPR 或 Canvas 缩放。
        return DjuiCanvasV6.CreateLogicalPlan(
            size.Width,
            size.Height,
            new DjuiInsetsV6(safe.Left, safe.Top, safe.Right, safe.Bottom),
            _viewport.WidthPx,
            _viewport.HeightPx,
            _project);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _viewport.OnSizeChanged -= _sizeChanged;
        _viewport.OnOrientationChanged -= _orientationChanged;
        _viewport.OnDevicePixelRatioChanged -= _dprChanged;
        _viewport.OnViewportChanged -= _viewportChanged;
        ForgetViewportPending(this);
        _controls.Clear();
        _controlIds.Clear();
    }

    // ===== 视口变化去抖 =====
    // 引擎的 OnSizeChanged 等粒度事件到达时读数可能是中间值（如切换比例时"事件先到、值后到"），
    // 事件只置脏；Thinker 每帧比对视口签名（逻辑尺寸 + 物理像素 + 安全区），连续 StableFrames 帧
    // 不变（或超过 MaxWaitMs 兜底）才真正重排，保证最终按收敛值解算。零引擎改动。
    // 主线程约定：事件回调与 Think 同在游戏主线程，等待队列不加锁（先例：DjuiWindowManagerV6.RetentionThinker）。
    private const int ViewportStableFrames = 2;
    private const int ViewportMaxWaitMs = 300;
    private static ViewportRelayoutThinker? _viewportThinker;

    private static ViewportRelayoutThinker EnsureViewportThinker()
    {
        if (_viewportThinker == null)
        {
            _viewportThinker = new ViewportRelayoutThinker();
            Game.RegisterThinker(_viewportThinker);
        }
        return _viewportThinker;
    }

    /// <summary>视口事件入口：以当前读数为基准挂入等待队列（已在队列则仅刷新基准，等待时长累计保留防事件风暴无限延期）。</summary>
    private void MarkViewportDirty()
    {
        if (_disposed) return;
        EnsureViewportThinker().Mark(this);
    }

    private static void ForgetViewportPending(DjuiLayoutSessionV6 session)
        => _viewportThinker?.Forget(session);

    /// <summary>视口读数稳定确认器（与 RetentionThinker / DjuiTransitionPlayer 同款 IThinker 帧驱动模式）。</summary>
    private sealed class ViewportRelayoutThinker : IThinker
    {
        private sealed class Pending
        {
            public DjuiLayoutSessionV6 Session = null!;
            public (float W, float H, int PxW, int PxH, float SL, float ST, float SR, float SB) Baseline;
            public int StableFrames;
            public int WaitedMs;
        }

        private readonly List<Pending> _pending = new();
        public bool DoesThink { get; set; } = true;

        public void Mark(DjuiLayoutSessionV6 session)
        {
            var signature = ReadSignature(session._viewport);
            foreach (var pending in _pending)
            {
                if (!ReferenceEquals(pending.Session, session)) continue;
                pending.Baseline = signature;
                pending.StableFrames = 0;
                return;
            }
            // 证据链第一环：事件到达 → 等待读数稳定（后续由 layout/host sync 日志衔接）；已在队列的重触发不打，防事件风暴刷屏
            Game.Logger.LogInformation($"DJUI v6 viewport event -> relayout pending (size={signature.W:F0}x{signature.H:F0} px={signature.PxW}x{signature.PxH})");
            _pending.Add(new Pending { Session = session, Baseline = signature });
        }

        public void Forget(DjuiLayoutSessionV6 session)
        {
            for (var i = _pending.Count - 1; i >= 0; i--)
                if (ReferenceEquals(_pending[i].Session, session)) _pending.RemoveAt(i);
        }

        public void Think(int delta)
        {
            for (var i = _pending.Count - 1; i >= 0; i--)
            {
                var pending = _pending[i];
                if (pending.Session._disposed) { _pending.RemoveAt(i); continue; }
                pending.WaitedMs += delta;
                var signature = ReadSignature(pending.Session._viewport);
                if (signature == pending.Baseline) pending.StableFrames++;
                else
                {
                    pending.Baseline = signature;
                    pending.StableFrames = 0;
                }
                if (pending.StableFrames < ViewportStableFrames && pending.WaitedMs < ViewportMaxWaitMs) continue;
                _pending.RemoveAt(i);   // 先出队再重排——重排后新到的事件重新入队
                try { pending.Session.Relayout(); }
                catch (Exception ex)
                {
                    Game.Logger.LogWarning("DJUI v6: 视口稳定后重排异常（已隔离）：{Id} {Message}", pending.Session.WindowInstanceId, ex.Message);
                }
            }
        }

        private static (float W, float H, int PxW, int PxH, float SL, float ST, float SR, float SB) ReadSignature(ScreenViewport viewport)
        {
            var size = viewport.Size;
            var safe = viewport.SafeZonePadding;
            return (size.Width, size.Height, viewport.WidthPx, viewport.HeightPx, safe.Left, safe.Top, safe.Right, safe.Bottom);
        }
    }
}

#endif
