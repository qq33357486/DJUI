// DJUI Runtime - DjuiFx 窗口承载：每个窗口实例一个 FxSurface，持有该窗口上的全部特效句柄与视图
// 生命周期：特效在窗口关闭（WindowClosing）时全部销毁并归还渲染单元；池复用的窗口重开后按需重建，不残留。
#if CLIENT

using System.Numerics;
using GameGraph.NodeSystem;
using GameUI.Control;

namespace DjuiRuntime;

internal enum FxResolve { Ok, NotReady, Missing }

internal sealed class FxSurface
{
    private static readonly Dictionary<DjuiTreeInstanceV6, FxSurface> All = new();
    private static bool _hooked;

    private const float OverlayIdleReleaseSeconds = 2f;

    private readonly DjuiTreeInstanceV6 _instance;
    private readonly string _pageId;
    private readonly List<FxHandle> _handles = new();
    private FxView? _overlay;

    private FxSurface(DjuiTreeInstanceV6 instance, string pageId)
    {
        _instance = instance;
        _pageId = pageId;
    }

    public static int Count => All.Count;
    public static int HandleCount { get { var n = 0; foreach (var s in All.Values) n += s._handles.Count; return n; } }
    public static int NodeCount
    {
        get
        {
            var n = 0;
            foreach (var s in All.Values)
                foreach (var h in s._handles) n += h.Nodes.Count;
            return n;
        }
    }

    public static FxSurface? ForPage(string pageId, bool create)
    {
        var instance = DjuiWindowManagerV6.GetSingletonInstance(pageId);
        if (instance == null) return null;
        if (All.TryGetValue(instance, out var existing)) return existing;
        if (!create) return null;
        if (!_hooked)
        {
            _hooked = true;
            DjuiWindowManagerV6.WindowClosing += OnWindowClosing;
        }

        var surface = new FxSurface(instance, pageId);
        All[instance] = surface;
        FxClock.EnsureRunning();
        return surface;
    }

    private static void OnWindowClosing(string pageId, DjuiTreeInstanceV6 instance)
    {
        if (All.TryGetValue(instance, out var surface)) surface.Release();
    }

    public static void TickAll(float now)
    {
        foreach (var surface in All.Values.ToArray()) surface.Tick(now);
    }

    // ---------------- 锚点 ----------------

    /// <summary>
    /// 控件中心在窗口画布内的 UI 坐标。ScreenPosition/ActualSize 是布局值、不含 Scale，
    /// 所以逐级祖先（不含窗口宿主）按其布局中心补偿 Scale（按钮回弹、窗口 pop 转场都靠 Scale）。
    /// 假设 Scale 的缩放原点是控件中心，待转场/回弹场景实测核对。
    /// </summary>
    public FxResolve TryNodeCenter(string nodeId, out Vector2 center)
    {
        center = default;
        var control = _instance.GetControl<Control>(nodeId);
        if (control == null) return FxResolve.Missing;
        var size = control.ActualSize;
        if (size.Width < 1f && size.Height < 1f) return FxResolve.NotReady; // 窗口刚打开当帧布局未解算

        var pos = control.ScreenPosition;
        var x = pos.Left + size.Width / 2f;
        var y = pos.Top + size.Height / 2f;
        for (var node = control.Parent; node is Control ancestor && !ReferenceEquals(ancestor, _instance.Host); node = ancestor.Parent)
        {
            var s = ancestor.Scale;
            if (s.X == 1f && s.Y == 1f) continue;
            var ap = ancestor.ScreenPosition;
            var asz = ancestor.ActualSize;
            var cx = ap.Left + asz.Width / 2f;
            var cy = ap.Top + asz.Height / 2f;
            x = cx + (x - cx) * s.X;
            y = cy + (y - cy) * s.Y;
        }

        var host = _instance.Host.ScreenPosition;
        center = new Vector2(x - host.Left, y - host.Top);
        return FxResolve.Ok;
    }

    /// <summary>窗口画布尺寸（设计像素）。</summary>
    public (float Width, float Height) CanvasSize
    {
        get
        {
            var rect = _instance.Session.CurrentPlan.CanvasRect;
            return (rect.Width, rect.Height);
        }
    }

    // ---------------- 播放 ----------------

    /// <summary>窗口级覆盖：画在窗口最上层，所有部件不分前后，坐标是窗口画布 UI 坐标。</summary>
    public FxHandle? PlayOverlay(FxDef def, float x, float y, float now, FxHandle? into = null)
    {
        var view = EnsureOverlay(now);
        if (view == null) return null;
        var handle = into ?? NewHandle(def, now);
        if (into != null)
        {
            into.StartTime = now;
            into.ExpireTime = def.Duration > 0f ? now + def.Duration : -1f;
        }

        AddParts(handle, def, _ => view, x, y, view.Width, view.Height);
        return Commit(handle, def);
    }

    /// <summary>
    /// 延迟播放：锚点所在窗口刚打开、布局尚未解算时，先返回一个占位句柄，等布局就绪后自动播放（最多等 1 秒，超时放弃并记 Warning）。
    /// attempt 返回 null＝继续等，true＝已播放，false＝确定失败。
    /// </summary>
    public FxHandle Defer(string effect, float now, Func<FxHandle, bool?> attempt)
    {
        var handle = new FxHandle { Owner = this, Effect = effect, StartTime = now, Pending = attempt, PendingUntil = now + 1f };
        _handles.Add(handle);
        return handle;
    }

    /// <summary>挂在节点上：画布居中于节点、随节点变换（缩放、位移），前后层夹住节点自己的子件。原点＝节点中心。</summary>
    public FxHandle? Attach(string nodeId, FxDef def, float width, float height, float now)
    {
        var control = _instance.GetControl<Control>(nodeId);
        if (control == null) return null;

        var key = nodeId + "|" + def.Name;
        foreach (var old in _handles.ToArray())
            if (old.AttachKey == key) Stop(old);

        var handle = NewHandle(def, now);
        handle.AttachKey = key;
        FxView? back = null;
        FxView? front = null;
        FxView? Pick(FxLayer layer)
        {
            if (layer == FxLayer.Back)
                return back ??= CreateOwned(handle, control, width, height, -1, now);
            return front ??= CreateOwned(handle, control, width, height, 100, now);
        }

        AddParts(handle, def, Pick, width / 2f, height / 2f, width, height);
        return Commit(handle, def);
    }

    private FxView? CreateOwned(FxHandle handle, Control parent, float width, float height, int z, float now)
    {
        var view = FxView.Create(parent, width, height, z, centered: true, now);
        if (view != null) handle.OwnedViews.Add(view);
        return view;
    }

    private FxView? EnsureOverlay(float now)
    {
        var (w, h) = CanvasSize;
        if (_overlay != null && (MathF.Abs(_overlay.Width - w) > 1f || MathF.Abs(_overlay.Height - h) > 1f) && _overlay.NodeCount == 0)
        {
            _overlay.Dispose();
            _overlay = null;
        }

        // 窗口级覆盖挂在窗口宿主下：不继承页面根的转场缩放；ZIndex 低于关闭阻挡层（int.MaxValue）
        return _overlay ??= FxView.Create(_instance.Host, w, h, int.MaxValue - 1, centered: false, now);
    }

    private FxHandle NewHandle(FxDef def, float now) => new()
    {
        Owner = this,
        Effect = def.Name,
        StartTime = now,
        ExpireTime = def.Duration > 0f ? now + def.Duration : -1f,
    };

    private static void AddParts(FxHandle handle, FxDef def, Func<FxLayer, FxView?> pick, float anchorX, float anchorY, float width, float height)
    {
        foreach (var part in def.Parts)
        {
            var view = pick(part.Layer);
            if (view == null) continue;
            try
            {
                var node = part.Build(view.Cell.Scene);
                node.Position = new Vector3(anchorX - width / 2f, height / 2f - anchorY, 0f);
                handle.Nodes.Add((view, node));
                view.NodeCount++;
                if (part.Tick == null) continue;
                handle.Ticks.Add((node, part.Tick));
                part.Tick(node, 0f);
            }
            catch (Exception ex)
            {
                Game.Logger.LogWarning("DjuiFx: 特效 {Effect} 的部件构建异常（已隔离，跳过该部件）：{Message}", def.Name, ex.Message);
            }
        }
    }

    private FxHandle? Commit(FxHandle handle, FxDef def)
    {
        if (handle.Nodes.Count == 0)
        {
            Game.Logger.LogWarning("DjuiFx: 特效 {Effect} 没有产生任何部件，已放弃播放", def.Name);
            _handles.Remove(handle);
            DisposeHandle(handle);
            return null;
        }

        if (!_handles.Contains(handle)) _handles.Add(handle);
        foreach (var view in handle.Nodes.Select(n => n.View).Distinct()) view.Sync();
        return handle;
    }

    // ---------------- 停止与释放 ----------------

    public void Stop(FxHandle handle)
    {
        if (!ReferenceEquals(handle.Owner, this)) return;
        _handles.Remove(handle);
        DisposeHandle(handle);
    }

    public void StopAll()
    {
        foreach (var handle in _handles.ToArray()) Stop(handle);
    }

    private static void DisposeHandle(FxHandle handle)
    {
        var views = handle.Nodes.Select(n => n.View).Distinct().ToList();
        foreach (var (view, node) in handle.Nodes)
        {
            view.NodeCount--;
            try { node.Dispose(); }
            catch (Exception ex) { Game.Logger.LogWarning("DjuiFx: 节点销毁异常（已隔离）：{Message}", ex.Message); }
        }

        handle.Nodes.Clear();
        handle.Ticks.Clear();
        handle.Pending = null;
        handle.Owner = null;
        foreach (var view in views)
            if (!handle.OwnedViews.Contains(view)) view.Sync();
        foreach (var view in handle.OwnedViews) view.Dispose();
        handle.OwnedViews.Clear();
    }

    /// <summary>窗口关闭：销毁全部句柄与视图，归还渲染单元，从全局表摘除。之后该窗口实例复用时会新建 Surface。</summary>
    private void Release()
    {
        StopAll();
        _overlay?.Dispose();
        _overlay = null;
        All.Remove(_instance);
    }

    // ---------------- 每帧 ----------------

    private void Tick(float now)
    {
        foreach (var handle in _handles.ToArray())
        {
            if (handle.Pending != null)
            {
                if (now > handle.PendingUntil)
                {
                    Game.Logger.LogWarning("DjuiFx: 特效 {Effect} 等待锚点布局超时，已放弃", handle.Effect);
                    Stop(handle);
                    continue;
                }

                bool? result;
                try { result = handle.Pending(handle); }
                catch (Exception ex)
                {
                    Game.Logger.LogWarning("DjuiFx: 特效 {Effect} 延迟播放异常（已隔离）：{Message}", handle.Effect, ex.Message);
                    result = false;
                }

                if (result == null) continue;
                handle.Pending = null;
                if (result == false || handle.Nodes.Count == 0) Stop(handle);
                continue;
            }

            if (handle.ExpireTime >= 0f && now >= handle.ExpireTime)
            {
                Stop(handle);
                continue;
            }

            var elapsed = now - handle.StartTime;
            try
            {
                foreach (var (node, tick) in handle.Ticks) tick(node, elapsed);
            }
            catch (Exception ex)
            {
                Game.Logger.LogWarning("DjuiFx: 特效 {Effect} 每帧回调异常，已停止该特效：{Message}", handle.Effect, ex.Message);
                Stop(handle);
            }
        }

        if (_overlay == null) return;
        if (_overlay.NodeCount > 0)
        {
            _overlay.EmptySince = now;
        }
        else if (now - _overlay.EmptySince > OverlayIdleReleaseSeconds)
        {
            _overlay.Dispose();
            _overlay = null;
        }
    }
}

#endif
