// DJUI Runtime - 测试门面（真实输入管线注入 + Action 触发探针查询）
// 背景：2026-10-16 阵容页事故——卡根节点 basic.isStatic:true 导致渲染正常但真人点击无响应，
// 而当时的自动测试直调业务方法（_ForTest 钩子），绕过了输入命中/派发管线，无法捕获这类断链。
// 本门面统一经引擎 Runtime MCP 工具（ui.click / input.pointer）合成输入：合成事件走真实的
// 命中测试与事件派发管线，再配合 DjuiActionRouter 的触发探针，即可断言「真实点击 → action 触发」全链路。
// 绝不要在测试里用 DjuiActionRouter.Trigger 代替点击——它以 (null, null) 直调 handler，是「直调业务」陷阱的变体。

#if CLIENT

using System.Text.Json.Nodes;
using GameUI.Control;
using GameUI.Debug;

namespace DjuiRuntime;

/// <summary>
/// 一次测试注入（ui.click / input.pointer / input.reset）的结果。
/// </summary>
public sealed class DjuiInjectResult
{
    /// <summary>工具调用是否成功（工具已接受该动作；非调试环境、参数非法、工具报错时为 false）。</summary>
    public bool Ok { get; private init; }

    /// <summary>
    /// 工具是否返回 queued=true。
    /// ⚠️ queued=true 只代表动作已排入客户端主线程队列，不代表事件已被引擎派发、更不代表业务已生效；
    /// 断言前必须先等待帧（等待帧原语由 DEngine 游戏内测试框架提供，本文件不实现）。
    /// </summary>
    public bool Queued { get; private init; }

    /// <summary>失败错误码（Ok=true 时为 null）。如 NOT_DEBUG_ENVIRONMENT / TARGET_IS_STATIC / TOOL_RETURNED_ERROR。</summary>
    public string? ErrorCode { get; private init; }

    /// <summary>人类可读的说明（成功时为空串）。</summary>
    public string Message { get; private init; } = "";

    /// <summary>工具原始返回的 JSON 文本（成功时保留，便于排查）。</summary>
    public string? RawJson { get; private init; }

    /// <summary>构造成功结果。</summary>
    public static DjuiInjectResult Succeed(bool queued, string? rawJson = null)
        => new() { Ok = true, Queued = queued, RawJson = rawJson };

    /// <summary>构造失败结果。</summary>
    public static DjuiInjectResult Fail(string errorCode, string message)
        => new() { Ok = false, ErrorCode = errorCode, Message = message };
}

/// <summary>
/// 目标控件的屏幕矩形（设备像素）。
/// </summary>
public sealed class DjuiControlRect
{
    /// <summary>页面标识（pageId）。</summary>
    public string PageId { get; init; } = "";

    /// <summary>节点实例 id（nodeInstanceId，即 JSON 树里的 node id）。</summary>
    public string NodeInstanceId { get; init; } = "";

    /// <summary>控件名（JSON 里未命名时为 null）。</summary>
    public string? ControlName { get; init; }

    /// <summary>控件左上角屏幕坐标 X（设备像素）。</summary>
    public int X { get; init; }

    /// <summary>控件左上角屏幕坐标 Y（设备像素）。</summary>
    public int Y { get; init; }

    /// <summary>控件宽度（设备像素）。⚠️ 控件布局帧末才生效，建树同帧取可能为 0。</summary>
    public int Width { get; init; }

    /// <summary>控件高度（设备像素）。⚠️ 控件布局帧末才生效，建树同帧取可能为 0。</summary>
    public int Height { get; init; }

    /// <summary>控件中心屏幕坐标 X（设备像素），供 ui.click / input.pointer 直接使用。</summary>
    public int CenterX { get; init; }

    /// <summary>控件中心屏幕坐标 Y（设备像素），供 ui.click / input.pointer 直接使用。</summary>
    public int CenterY { get; init; }

    /// <summary>
    /// 控件是否处于 IsStatic（静态：引擎不向它派发任何事件，但子控件仍可响应）。
    /// 目标自身 IsStatic=true 时对它注入点击永远无效——2026-10-16 阵容页事故的直接根因，注入前应拦截。
    /// </summary>
    public bool IsStatic { get; init; }
}

/// <summary>
/// DJUI 自动化测试门面（仅客户端编译）。
/// 能力分三块：
/// <list type="number">
/// <item>探针查询/清零：转发 <see cref="DjuiActionRouter"/> 的 action 触发记录，区分「真实输入管线点击」与「程序化直调」；</item>
/// <item>定位：按页面标识 + 节点实例 id 取控件，算出屏幕设备像素矩形与中心点；</item>
/// <item>注入：ClickAt / 指针 move-down-up 序列，经 Runtime MCP 工具合成真实输入。</item>
/// </list>
/// 坐标口径说明：ui.click / input.pointer 吃「当前游戏 UI 的屏幕像素坐标」；本门面取
/// Control.ScreenPositionPx / ActualSizePx（同为屏幕设备像素），坐标空间一致，
/// 不要再叠加 DjuiViewportAdapter 的 contentScale 换算——那套换算已烘进控件布局数值。
/// </summary>
/// <remarks>
/// ⚠️ 所有注入方法只是「排队」：返回 Queued=true 仅代表动作进入客户端主线程队列。
/// 事件派发、业务处理都发生在后续帧，断言（查探针、查业务状态）之前必须先等待帧。
/// 等待帧原语由 DEngine 游戏内测试框架提供，本文件不实现。
/// 非调试环境（非编辑器调试且非纯客户端模式）下所有注入方法返回 NOT_DEBUG_ENVIRONMENT 明确错误，不抛异常。
/// </remarks>
public static class DjuiTestSupport
{
    private static readonly object _registryGate = new();
    private static bool _registryReady;

    // ------------------------------------------------------------------
    // 探针查询 / 清零（转发 DjuiActionRouter 的触发记录）
    // ------------------------------------------------------------------

#if DENGINE_TESTS

    /// <summary>
    /// 取全部 action 触发探针记录的快照（按 ActionName 排序）。
    /// </summary>
    public static IReadOnlyList<DjuiActionProbeRecord> GetActionProbeRecords()
        => DjuiActionRouter.ProbeGetRecords();

    /// <summary>
    /// 按-action 名取单条探针记录（尚未触发过时为 null）。
    /// </summary>
    public static DjuiActionProbeRecord? FindActionProbeRecord(string actionName)
        => DjuiActionRouter.ProbeFindRecord(actionName);

    /// <summary>
    /// 清空全部 action 触发探针记录（测试用例之间隔离用）。
    /// </summary>
    public static void ResetActionProbe()
        => DjuiActionRouter.ProbeReset();

#endif

    // ------------------------------------------------------------------
    // 定位：页面 + 节点 → 屏幕矩形 / 中心点
    // ------------------------------------------------------------------

    /// <summary>
    /// 按页面标识 + 节点实例 id 取控件的屏幕矩形（单例页口径，业务最常用）。
    /// 返回 null 表示页面未打开（或未以单例方式打开）或节点不存在。
    /// ⚠️ Width/Height 在控件布局帧末才生效，OpenWindow 后同帧调用可能取到 0——请等待帧后再取。
    /// </summary>
    public static DjuiControlRect? GetControlRect(string pageId, string nodeInstanceId)
    {
        var ctrl = DjuiWindowManagerV6.GetSingletonControl<Control>(pageId, nodeInstanceId);
        return BuildRect(pageId, nodeInstanceId, ctrl);
    }

    /// <summary>
    /// 按窗口实例 id（OpenInstance 返回的 "w"+序号）+ 节点实例 id 取控件的屏幕矩形（多实例窗口口径）。
    /// 返回 null 表示窗口实例不存在或节点不存在。
    /// </summary>
    public static DjuiControlRect? GetControlRectInInstance(string windowInstanceId, string nodeInstanceId)
    {
        var ctrl = DjuiWindowManagerV6.GetControl<Control>(windowInstanceId, nodeInstanceId);
        return BuildRect(windowInstanceId, nodeInstanceId, ctrl);
    }

    /// <summary>
    /// 便捷：按页面标识 + 节点实例 id 直接取控件中心点屏幕坐标（设备像素，可直接喂给 <see cref="ClickAt"/>）。
    /// 返回 null 表示页面未打开或节点不存在。
    /// </summary>
    public static (int CenterX, int CenterY)? GetControlScreenCenter(string pageId, string nodeInstanceId)
    {
        var rect = GetControlRect(pageId, nodeInstanceId);
        return rect == null ? null : (rect.CenterX, rect.CenterY);
    }

    // ------------------------------------------------------------------
    // 注入：合成真实输入（Runtime MCP 工具，坐标模式）
    // ------------------------------------------------------------------

    /// <summary>
    /// 在屏幕坐标 (x, y) 处合成一次点击（ui.click，走引擎真实命中/派发管线）。
    /// button：1 左键（默认）/ 2 中键 / 4 右键。
    /// ⚠️ 排队语义：返回 Queued=true 只代表已入队客户端主线程，断言前必须等待帧。
    /// </summary>
    public static DjuiInjectResult ClickAt(int x, int y, int button = 1)
    {
        if (x < 0 || y < 0)
            return DjuiInjectResult.Fail("INVALID_COORDS", $"坐标必须非负: ({x}, {y})");
        return CallInputTool("ui.click", new JsonObject
        {
            ["x"] = x,
            ["y"] = y,
            ["button"] = button,
        });
    }

    /// <summary>
    /// 定位 + 拦截 + 注入的组合（单例页口径）：取节点控件矩形，做 IsStatic / 布局未就绪检查，然后点击中心。
    /// 这是测试普通可点控件的首选入口——目标自身 IsStatic=true 时直接返回 TARGET_IS_STATIC
    /// （引擎不会向静态控件派发任何事件，点击注定无效，2026-10-16 阵容页同款事故在此被拦截）。
    /// </summary>
    public static DjuiInjectResult ClickControl(string pageId, string nodeInstanceId, int button = 1)
    {
        var rect = GetControlRect(pageId, nodeInstanceId);
        if (rect == null)
            return DjuiInjectResult.Fail("CONTROL_NOT_FOUND",
                $"页面 {pageId} 未打开（单例口径）或节点 {nodeInstanceId} 不存在");
        return ClickAtRect(rect, button);
    }

    /// <summary>
    /// ClickControl 的多实例窗口口径（windowInstanceId 为 OpenInstance 返回的 "w"+序号）。
    /// </summary>
    public static DjuiInjectResult ClickControlInInstance(string windowInstanceId, string nodeInstanceId, int button = 1)
    {
        var rect = GetControlRectInInstance(windowInstanceId, nodeInstanceId);
        if (rect == null)
            return DjuiInjectResult.Fail("CONTROL_NOT_FOUND",
                $"窗口实例 {windowInstanceId} 不存在或节点 {nodeInstanceId} 不存在");
        return ClickAtRect(rect, button);
    }

    /// <summary>
    /// 合成指针移动（input.pointer，action=move）。坐标为屏幕像素，必须非负。
    /// ⚠️ 排队语义同 <see cref="ClickAt"/>。
    /// </summary>
    public static DjuiInjectResult PointerMove(int x, int y)
    {
        if (x < 0 || y < 0)
            return DjuiInjectResult.Fail("INVALID_COORDS", $"坐标必须非负: ({x}, {y})");
        return CallInputTool("input.pointer", new JsonObject
        {
            ["action"] = "move",
            ["x"] = x,
            ["y"] = y,
        });
    }

    /// <summary>
    /// 合成指针按下（input.pointer，action=down）。x/y 可选：提供时会先移动到该坐标再按下（必须成对）。
    /// down 必须与 <see cref="PointerUp"/> 配对；中断后用 <see cref="ResetInput"/> 清理。
    /// </summary>
    public static DjuiInjectResult PointerDown(int? x = null, int? y = null, int button = 1)
    {
        if ((x == null) != (y == null))
            return DjuiInjectResult.Fail("INVALID_COORDS", "x/y 必须成对提供（要么都传，要么都不传）");
        return CallInputTool("input.pointer", BuildPointerAction("down", x, y, button));
    }

    /// <summary>
    /// 合成指针抬起（input.pointer，action=up）。x/y 可选：提供时会先移动到该坐标再抬起（必须成对）。
    /// 只释放合成输入自己持有的按钮，不影响物理设备上真人按住的按钮。
    /// </summary>
    public static DjuiInjectResult PointerUp(int? x = null, int? y = null, int button = 1)
    {
        if ((x == null) != (y == null))
            return DjuiInjectResult.Fail("INVALID_COORDS", "x/y 必须成对提供（要么都传，要么都不传）");
        return CallInputTool("input.pointer", BuildPointerAction("up", x, y, button));
    }

    /// <summary>
    /// 合成滚轮滚动（input.pointer，action=wheel）。delta 为滚轮格数、必须非 0（正负方向遵循当前客户端平台的引擎滚轮语义）；
    /// x/y 可选：提供时会先移动到该坐标再滚动（必须成对），不提供则在当前合成指针位置滚动。
    /// 0.30.0 起的滚动容器/裁剪特性（scroll 容器）用此入口驱动。
    /// ⚠️ 排队语义同 <see cref="ClickAt"/>。
    /// </summary>
    public static DjuiInjectResult PointerWheel(int delta, int? x = null, int? y = null)
    {
        if (delta == 0)
            return DjuiInjectResult.Fail("INVALID_WHEEL_DELTA", "delta 必须非 0");
        if ((x == null) != (y == null))
            return DjuiInjectResult.Fail("INVALID_COORDS", "x/y 必须成对提供（要么都传，要么都不传）");
        var obj = new JsonObject { ["action"] = "wheel" };
        if (x != null && y != null)
        {
            obj["x"] = x.Value;
            obj["y"] = y.Value;
        }
        obj["delta"] = delta;
        return CallInputTool("input.pointer", obj);
    }

    /// <summary>
    /// 合成一次完整拖拽序列（验位移门槛用）：move(from) → down → move(to) → up。
    /// 需要更细的步进（如逐像素移动验证门槛阈值）时，请用 PointerMove/PointerDown/PointerUp 自行组合。
    /// 序列中任一步失败即停止并返回该步的错误（Message 注明失败在第几步）。
    /// ⚠️ 整个序列每步都是独立排队的，序列完成后同样要等待帧再断言。
    /// </summary>
    public static DjuiInjectResult PointerDrag(int fromX, int fromY, int toX, int toY, int button = 1)
    {
        var step = PointerMove(fromX, fromY);
        if (!step.Ok) return DragFail(1, step);
        step = PointerDown();
        if (!step.Ok) return DragFail(2, step);
        step = PointerMove(toX, toY);
        if (!step.Ok) return DragFail(3, step);
        step = PointerUp();
        if (!step.Ok) return DragFail(4, step);
        return step;
    }

    /// <summary>
    /// 释放合成输入自持的键与指针按钮，并结束合成指针位置覆盖（input.reset）。
    /// 多步输入序列应把它作为失败清理路径，而不只是成功路径。
    /// </summary>
    public static DjuiInjectResult ResetInput()
        => CallInputTool("input.reset", new JsonObject());

    // ------------------------------------------------------------------
    // 内部实现
    // ------------------------------------------------------------------

    private static DjuiInjectResult ClickAtRect(DjuiControlRect rect, int button)
    {
        if (rect.IsStatic)
            return DjuiInjectResult.Fail("TARGET_IS_STATIC",
                $"节点 {rect.NodeInstanceId} 的控件自身 IsStatic=true：引擎不会向静态控件派发任何事件，"
                + "真实点击注定无效（2026-10-16 阵容页事故根因）。若要点的是它的子控件，请改用子节点的实例 id。");
        if (rect.Width <= 0 || rect.Height <= 0)
            return DjuiInjectResult.Fail("CONTROL_NOT_LAID_OUT",
                $"节点 {rect.NodeInstanceId} 的 ActualSizePx 仍为 {rect.Width}x{rect.Height}："
                + "控件布局要到帧末才生效，请等待帧后再点击。");
        return ClickAt(rect.CenterX, rect.CenterY, button);
    }

    private static DjuiControlRect? BuildRect(string pageId, string nodeInstanceId, Control? ctrl)
    {
        if (ctrl == null) return null;
        var (x, y) = ctrl.ScreenPositionPx;
        var size = ctrl.ActualSizePx;
        // Size 成员为整型设备像素；显式 (int) 兼容万一为浮点的实现
        var w = (int)size.Width;
        var h = (int)size.Height;
        return new DjuiControlRect
        {
            PageId = pageId,
            NodeInstanceId = nodeInstanceId,
            ControlName = ctrl.Name,
            X = x,
            Y = y,
            Width = w,
            Height = h,
            CenterX = x + w / 2,
            CenterY = y + h / 2,
            IsStatic = ctrl.IsStatic,
        };
    }

    private static JsonObject BuildPointerAction(string action, int? x, int? y, int button)
    {
        var obj = new JsonObject { ["action"] = action };
        if (x != null && y != null)
        {
            obj["x"] = x.Value;
            obj["y"] = y.Value;
        }
        obj["button"] = button;
        return obj;
    }

    private static DjuiInjectResult DragFail(int stepIndex, DjuiInjectResult step)
        => DjuiInjectResult.Fail(step.ErrorCode ?? "DRAG_FAILED", $"拖拽序列第 {stepIndex} 步失败: {step.Message}");

    /// <summary>
    /// 确保 Runtime MCP 工具注册表可用：预检调试环境（编辑器调试或纯客户端模式），再 Initialize。
    /// 初始化失败不缓存（环境可能随后就绪），成功后不再重复 Initialize。
    /// </summary>
    private static bool EnsureDebugRegistry()
    {
        if (_registryReady) return true;
        lock (_registryGate)
        {
            if (_registryReady) return true;
            // Runtime MCP 只在编辑器调试或纯客户端调试模式下开放入口
            if (!Game.IsDebugTestMode && !Game.IsClientOnly)
                return false;
            if (!RuntimeDebugToolRegistry.Initialize())
                return false;
            _registryReady = true;
            return true;
        }
    }

    /// <summary>
    /// 统一的工具调用与响应解析（全程不抛异常）。
    /// 兼容两种返回形状：MCP 桥包装 { success, result } / { success, error_code, message }，
    /// 以及 handler 裸返回（进程内直调可能不包 success）。
    /// </summary>
    private static DjuiInjectResult CallInputTool(string toolName, JsonObject arguments)
    {
        if (!EnsureDebugRegistry())
            return DjuiInjectResult.Fail("NOT_DEBUG_ENVIRONMENT",
                "当前不是编辑器调试或纯客户端调试模式，Runtime MCP 输入工具不可用；"
                + "测试需以调试方式启动客户端后运行。");

        JsonNode? raw;
        try
        {
            raw = RuntimeDebugToolRegistry.CallTool(toolName, arguments);
        }
        catch (Exception ex)
        {
            return DjuiInjectResult.Fail("TOOL_CALL_FAILED", $"{toolName} 调用异常: {ex.Message}");
        }

        if (raw is not JsonObject root)
            return DjuiInjectResult.Fail("TOOL_UNEXPECTED_RESPONSE",
                $"{toolName} 未返回 JSON 对象: {raw?.ToJsonString() ?? "null"}");

        var rawText = root.ToJsonString();

        // 形状一：带 success 包装
        if (root["success"] is JsonValue successValue && successValue.TryGetValue<bool>(out var success))
        {
            if (!success)
            {
                var errorCode = root["error_code"]?.ToString() ?? "unknown";
                var message = root["message"]?.ToString() ?? "";
                return DjuiInjectResult.Fail("TOOL_RETURNED_ERROR", $"{toolName}: [{errorCode}] {message}");
            }
            if (root["result"] is JsonObject resultObj)
                return DjuiInjectResult.Succeed(ReadQueued(resultObj), rawText);
            return DjuiInjectResult.Succeed(false, rawText);
        }

        // 形状二：handler 裸返回（视为成功，直接读字段）
        return DjuiInjectResult.Succeed(ReadQueued(root), rawText);
    }

    private static bool ReadQueued(JsonObject obj)
        => obj["queued"] is JsonValue queuedValue && queuedValue.TryGetValue<bool>(out var queued) && queued;
}

#endif
