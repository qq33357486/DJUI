// DJUI Runtime - scoped data binding system
#if CLIENT

using GameUI.Control;

namespace DjuiRuntime;

/// <summary>Global binding values with instance-scoped control registrations.</summary>
public static class DjuiBindingSystem
{
    private sealed class Registration : IDisposable
    {
        public required string Key { get; init; }
        public required Control Control { get; init; }
        public required Action<object?> Apply { get; init; }
        public void Dispose()
        {
            if (_bindings.TryGetValue(Key, out var list))
            {
                list.Remove(this);
                if (list.Count == 0) _bindings.Remove(Key);
            }
        }
    }

    private static readonly Dictionary<string, object?> _values = new();
    private static readonly Dictionary<string, List<Registration>> _bindings = new();
    // Legacy v5 registry only. v6 registers controls directly and never uses global bare IDs.
    private static readonly Dictionary<string, Control> _controlRegistry = new();

    internal static void RegisterControl(string nodeId, Control ctrl) => _controlRegistry[nodeId] = ctrl;
    internal static Control? GetRegisteredControl(string nodeId) => _controlRegistry.TryGetValue(nodeId, out var ctrl) ? ctrl : null;

    internal static void RegisterBinding(string nodeId, string propertyName, string bindingKey)
    {
        if (_controlRegistry.TryGetValue(nodeId, out var control)) RegisterBinding(control, propertyName, bindingKey);
    }

    /// <summary>Registers one v6 instance-owned binding without publishing a bare node ID globally.</summary>
    internal static IDisposable RegisterBinding(Control control, string propertyName, string bindingKey)
    {
        var apply = CreateBindingAction(propertyName, control);
        if (apply == null) return EmptyDisposable.Instance;
        var registration = new Registration { Key = bindingKey, Control = control, Apply = apply };
        if (!_bindings.TryGetValue(bindingKey, out var list)) _bindings[bindingKey] = list = new List<Registration>();
        list.Add(registration);
        if (_values.TryGetValue(bindingKey, out var value)) apply(value);
        return registration;
    }

    /// <summary>image 绑定通道的注册上下文：定位 authored 模型与所属会话。注册点（DjuiTreeBuilderV6.BuildNode）天然齐备这两项。</summary>
    private sealed record ImageBindingContext(DjuiLayoutSessionV6 Session, string NodeId);

    /// <summary>
    /// v6 注册重载（带节点 id 与布局会话）：image 绑定经它取得模型定位，其余属性与无上下文重载行为一致。
    /// 绑定键已有值时立即重放（同无上下文重载）——这是 image 绑定跨树重建自动恢复最近图值的机制。
    /// </summary>
    internal static IDisposable RegisterBinding(Control control, string propertyName, string bindingKey,
        string nodeId, DjuiLayoutSessionV6 session)
    {
        var apply = CreateBindingAction(propertyName, control,
            string.Equals(propertyName, "image", StringComparison.Ordinal) ? new ImageBindingContext(session, nodeId) : null);
        if (apply == null) return EmptyDisposable.Instance;
        var registration = new Registration { Key = bindingKey, Control = control, Apply = apply };
        if (!_bindings.TryGetValue(bindingKey, out var list)) _bindings[bindingKey] = list = new List<Registration>();
        list.Add(registration);
        if (_values.TryGetValue(bindingKey, out var value)) apply(value);
        return registration;
    }

    private static Action<object?>? CreateBindingAction(string propertyName, Control control,
        ImageBindingContext? imageContext = null)
    {
        return propertyName switch
        {
            "visible" => value => control.Visible = value is bool visible && visible,
            "disabled" => value => DjuiButtonState.SetDisabled(control, value is bool disabled && disabled),
            "text" when control is Label label => value => label.Text = value?.ToString() ?? "",
            "value" when control is Progress progress => value =>
            {
                progress.Value = Convert.ToSingle(value ?? 0f);
                DjuiProgressVisualLayerV6.NotifyValueChanged(progress);
            },
            // image 绑定＝SetImage 同一通道（SetImageCore）：模型写入、克隆分流、Progress 排除、
            // Button 状态机协同全部自动继承；空值归一为撤销图片。无上下文（结构性误用）落入 _ => null 静默无效。
            "image" when imageContext != null => value => DjuiWindowManagerV6.SetImageCore(
                imageContext.Session, imageContext.NodeId,
                string.IsNullOrWhiteSpace(value?.ToString()) ? null : value.ToString()),
            _ => null,
        };
    }

    public static void Set<T>(string key, T value)
    {
        _values[key] = value;
        if (!_bindings.TryGetValue(key, out var bindings)) return;
        foreach (var registration in bindings.ToArray())
        {
            if (!registration.Control.IsValid) { registration.Dispose(); continue; }
            try { registration.Apply(value); } catch (Exception ex) { Game.Logger.LogWarning(ex, "DJUI: 绑定 {Key} 更新失败", key); }
        }
    }

    public static T? Get<T>(string key) => _values.TryGetValue(key, out var value) && value is T typed ? typed : default;

    private sealed class EmptyDisposable : IDisposable
    {
        public static readonly EmptyDisposable Instance = new();
        public void Dispose() { }
    }
}

#endif
