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

    private static Action<object?>? CreateBindingAction(string propertyName, Control control)
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
