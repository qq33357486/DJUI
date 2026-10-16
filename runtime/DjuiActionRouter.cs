// DJUI Runtime - Action 路由

#if CLIENT

using System.Collections.Concurrent;
using GameUI.Control;
using GameCore.Platform.SDL;

namespace DjuiRuntime;

/// <summary>
/// Action 路由系统。JSON 中声明 action，运行时自动绑定点击事件。
/// 开发者注册处理函数即可。
/// </summary>
public static class DjuiActionRouter
{
    private static readonly Dictionary<string, Action<Control, PointerEventArgs?>> _handlers = new();

    /// <summary>
    /// 注册 Action 处理函数。
    /// </summary>
    public static void On(string actionName, Action handler)
    {
        _handlers[actionName] = (ctrl, args) => handler();
    }

    /// <summary>
    /// 注册 Action 处理函数（带参数）。
    /// </summary>
    public static void On(string actionName, Action<Control, PointerEventArgs?> handler)
    {
        _handlers[actionName] = handler;
    }

    public static bool Trigger(string actionName)
    {
#if DENGINE_TESTS
        ProbeRecordProgrammatic(actionName);
#endif
        if (!_handlers.TryGetValue(actionName, out var handler))
            return false;

        handler(null!, null);
        return true;
    }

    /// <summary>
    /// 内部：将 action 绑定到控件的点击事件。
    /// </summary>
    internal static void BindAction(Control ctrl, string? actionName)
    {
        if (string.IsNullOrEmpty(actionName)) return;

        ctrl.OnPointerClicked += (sender, args) =>
        {
#if DENGINE_TESTS
            ProbeRecordRealClick(actionName, ctrl);
#endif
            var owner = DjuiLayoutSessionV6.FindOwner(ctrl);
            if (owner != null && DjuiWindowManagerV6.IsClosing(owner.WindowInstanceId)) return;
            if (_handlers.TryGetValue(actionName, out var handler))
            {
                handler(ctrl, args);
            }
            else
            {
                Game.Logger.LogWarning("DJUI: 未注册的 Action {Name}", actionName);
            }
        };
    }

#if DENGINE_TESTS

    // ------------------------------------------------------------------
    // Action 触发探针（DENGINE_TESTS 专用）：区分「真实输入管线点击」与「程序化 Trigger 直调」。
    // 供 DjuiTestSupport 转发查询；不计入正常业务流程，仅做记录，不影响任何既有行为。
    // ------------------------------------------------------------------

    private static readonly ConcurrentDictionary<string, DjuiActionProbeRecord> _probeRecords = new();

    /// <summary>记录一次真实输入管线点击到达（控件 OnPointerClicked 触发，含关窗守卫丢弃与 handler 未命中的情形）。</summary>
    internal static void ProbeRecordRealClick(string actionName, Control ctrl)
    {
        var record = _probeRecords.GetOrAdd(actionName, name => new DjuiActionProbeRecord { ActionName = name });
        System.Threading.Interlocked.Increment(ref record.RealClickCount);
        record.LastRealClickGameMs = Game.TotalElapsedTickInMilliseconds;
        record.LastRealClickControlName = ctrl.Name;
        record.LastRealClickControlIsStatic = ctrl.IsStatic;
    }

    /// <summary>记录一次程序化触发（DjuiActionRouter.Trigger 直调，绕过输入管线；含 action 未注册的调用）。</summary>
    internal static void ProbeRecordProgrammatic(string actionName)
    {
        var record = _probeRecords.GetOrAdd(actionName, name => new DjuiActionProbeRecord { ActionName = name });
        System.Threading.Interlocked.Increment(ref record.ProgrammaticCount);
        record.LastProgrammaticGameMs = Game.TotalElapsedTickInMilliseconds;
    }

    /// <summary>取全部探针记录快照（按 ActionName 排序，便于稳定断言与日志比对）。</summary>
    internal static IReadOnlyList<DjuiActionProbeRecord> ProbeGetRecords()
        => _probeRecords.Values.OrderBy(r => r.ActionName, StringComparer.Ordinal).ToList();

    /// <summary>按 action 名取单条探针记录（尚未触发过时为 null）。</summary>
    internal static DjuiActionProbeRecord? ProbeFindRecord(string actionName)
        => _probeRecords.TryGetValue(actionName, out var record) ? record : null;

    /// <summary>清空全部探针记录（测试用例之间隔离用）。</summary>
    internal static void ProbeReset() => _probeRecords.Clear();

#endif
}

#if DENGINE_TESTS

/// <summary>
/// Action 触发探针记录（仅 DENGINE_TESTS 编译）。
/// 背景：2026-10-16 阵容页事故中自动测试直调业务方法，无法发现「真实点击永远到不了 handler」。
/// 该记录让测试能断言「真实点击 → action 触发」全链路：RealClickCount 只会在引擎输入管线
/// （命中测试 + 事件派发）真实送达时递增；ProgrammaticCount 则是绕过输入管线的直调计数，
/// 新测试严禁以 Trigger 代替真实点击——若某测试只有 ProgrammaticCount 增长而 RealClickCount 为 0，
/// 说明它压根没有验证真实命中链路。
/// </summary>
public sealed class DjuiActionProbeRecord
{
    /// <summary>Action 名（JSON 节点里声明的 action 字符串）。</summary>
    public string ActionName;

    /// <summary>真实输入管线点击次数（引擎 OnPointerClicked 派发到达；含被关窗守卫丢弃、handler 未注册的情形）。</summary>
    public int RealClickCount;

    /// <summary>最后一次真实点击的游戏时间（Game.TotalElapsedTickInMilliseconds，从未发生为 -1）。</summary>
    public int LastRealClickGameMs = -1;

    /// <summary>最后一次真实点击命中的控件名（JSON 未命名时为 null）。</summary>
    public string? LastRealClickControlName;

    /// <summary>最后一次真实点击命中的控件是否 IsStatic（为 true 说明点击命中的是别的子控件，而非绑定的静态控件自身）。</summary>
    public bool LastRealClickControlIsStatic;

    /// <summary>程序化触发次数（Trigger 直调，绕过输入管线）。</summary>
    public int ProgrammaticCount;

    /// <summary>最后一次程序化触发的游戏时间（从未发生为 -1）。</summary>
    public int LastProgrammaticGameMs = -1;
}

#endif

#endif
