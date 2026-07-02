// DJUI Runtime - Action 路由

#if CLIENT

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
}

#endif
