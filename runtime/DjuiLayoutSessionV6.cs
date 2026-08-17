#if CLIENT

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
    private Action<DjuiNodeV6, Control>? _nodeUpdater;
    private readonly Action<int, int> _sizeChanged;
    private readonly Action<DisplayOrientations> _orientationChanged;
    private readonly Action<float> _dprChanged;
    private bool _disposed;

    public string WindowInstanceId { get; }
    public IReadOnlyDictionary<string, Control> Controls => _controls;
    public DjuiCanvasPlanV6 CurrentPlan { get; private set; }
    public DjuiPageV6 CurrentPage { get; private set; }

    public DjuiLayoutSessionV6(string windowInstanceId, DjuiProjectV6 project, DjuiPageV6 page, ScreenViewport? viewport = null)
    {
        if (string.IsNullOrWhiteSpace(windowInstanceId)) throw new ArgumentException("窗口实例 ID 不能为空", nameof(windowInstanceId));
        WindowInstanceId = windowInstanceId;
        _project = project ?? throw new ArgumentNullException(nameof(project));
        _page = page ?? throw new ArgumentNullException(nameof(page));
        _viewport = viewport ?? DeviceInfo.PrimaryViewport;
        CurrentPlan = CreateCurrentPlan();
        CurrentPage = DjuiResponsiveResolverV6.Resolve(_page, CurrentPlan.Wide);
        _sizeChanged = (_, _) => Relayout();
        _orientationChanged = _ => Relayout();
        _dprChanged = _ => Relayout();
        _viewport.OnSizeChanged += _sizeChanged;
        _viewport.OnOrientationChanged += _orientationChanged;
        _viewport.OnDevicePixelRatioChanged += _dprChanged;
    }

    public void Register(string nodeInstanceId, Control control)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (string.IsNullOrWhiteSpace(nodeInstanceId)) throw new ArgumentException("节点实例 ID 不能为空", nameof(nodeInstanceId));
        if (!_controls.TryAdd(nodeInstanceId, control)) throw new InvalidOperationException($"DJUI v6: 实例 {WindowInstanceId} 内节点 ID 重复: {nodeInstanceId}");
    }

    public void SetNodeUpdater(Action<DjuiNodeV6, Control> updater)
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
        CurrentPlan = CreateCurrentPlan();
        CurrentPage = DjuiResponsiveResolverV6.Resolve(_page, CurrentPlan.Wide);
        var nodes = new Dictionary<string, DjuiNodeV6>(StringComparer.Ordinal);
        IndexNodes(CurrentPage.Root, nodes);
        var solved = DjuiLayoutSolverV6.SolveV6(CurrentPage, CurrentPlan);
        var parents = new Dictionary<string, string?>(StringComparer.Ordinal);
        IndexParents(CurrentPage.Root, null, parents);
        foreach (var (nodeId, rect) in solved)
        {
            if (!_controls.TryGetValue(nodeId, out var control)) continue;
            var localRect = rect;
            if (parents.TryGetValue(nodeId, out var parentId) && parentId != null && solved.TryGetValue(parentId, out var parentRect))
                localRect = new DjuiRectV6(rect.X - parentRect.X, rect.Y - parentRect.Y, rect.Width, rect.Height);
            ApplyRect(control, localRect);
            if (_nodeUpdater != null && nodes.TryGetValue(nodeId, out var node)) _nodeUpdater(node, control);
        }
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
        _controls.Clear();
    }
}

#endif
