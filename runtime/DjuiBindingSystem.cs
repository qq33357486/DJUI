// DJUI Runtime - 数据绑定系统

#if CLIENT

using GameUI.Control;

namespace DjuiRuntime;

/// <summary>
/// 数据绑定系统。业务代码设置值，UI 自动更新。
/// </summary>
public static class DjuiBindingSystem
{
    private static readonly Dictionary<string, object?> _values = new();
    private static readonly Dictionary<string, List<(Control ctrl, Action<Control> action)>> _bindings = new();
    private static readonly Dictionary<string, Control> _controlRegistry = new();

    /// <summary>
    /// 注册控件到绑定系统（由 DjuiNodeBuilder 自动调用）。
    /// </summary>
    internal static void RegisterControl(string nodeId, Control ctrl)
    {
        _controlRegistry[nodeId] = ctrl;
    }

    /// <summary>
    /// 获取已注册的控件（供 DjuiWindowManager 使用）。
    /// </summary>
    internal static Control? GetRegisteredControl(string nodeId)
    {
        return _controlRegistry.TryGetValue(nodeId, out var ctrl) ? ctrl : null;
    }

    /// <summary>
    /// 为指定节点注册绑定。
    /// </summary>
    internal static void RegisterBinding(string nodeId, string propertyName, string bindingKey)
    {
        if (!_controlRegistry.TryGetValue(nodeId, out var ctrl)) return;

        var action = CreateBindingAction(propertyName, ctrl);
        if (action == null) return;

        if (!_bindings.ContainsKey(bindingKey))
            _bindings[bindingKey] = new List<(Control, Action<Control>)>();

        _bindings[bindingKey].Add((ctrl, action));

        // 初始值应用
        if (_values.TryGetValue(bindingKey, out _))
            action(ctrl);
    }

    private static Action<Control>? CreateBindingAction(string propertyName, Control sampleCtrl)
    {
        return propertyName switch
        {
            "visible" => ctrl => ctrl.Visible = Get<bool>("__last_value"),
            "text" => ctrl =>
            {
                if (ctrl is Label label)
                    label.Text = Get<string>("__last_value") ?? "";
            },
            "value" => ctrl =>
            {
                if (ctrl is Progress progress)
                    progress.Value = Get<float>("__last_value");
            },
            _ => null,
        };
    }

    /// <summary>
    /// 设置绑定值。UI 自动更新。
    /// </summary>
    public static void Set<T>(string key, T value)
    {
        _values[key] = value;
        _values["__last_value"] = value!;

        if (_bindings.TryGetValue(key, out var bindings))
        {
            foreach (var (ctrl, action) in bindings)
            {
                try { action(ctrl); } catch { }
            }
        }
    }

    /// <summary>
    /// 获取绑定值。
    /// </summary>
    public static T? Get<T>(string key)
    {
        if (_values.TryGetValue(key, out var val) && val is T typed)
            return typed;
        return default;
    }
}

#endif
