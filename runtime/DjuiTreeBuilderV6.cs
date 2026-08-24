// DJUI Runtime - focused protocol v6 persistent authored-tree builder
#if CLIENT

using System.Text.Json;
using System.Text.RegularExpressions;
using GameUI.Control;
using GameUI.Control.Primitive;
using GameUI.Control.Behavior;
using GameUI.Control.Extensions;
using GameUI.Extensions;
using GameUI.Enum;
using GameUI.Struct;

namespace DjuiRuntime;

/// <summary>
/// Owns one v6 authored control tree and its persistent layout session.
/// The host is a mounting boundary, not an authored node and is never registered in the session.
/// </summary>
public sealed class DjuiTreeInstanceV6 : IDisposable
{
    private bool _disposed;

    public Panel Host { get; }
    public Panel Root { get; }
    public DjuiLayoutSessionV6 Session { get; }
    public bool OwnsHost { get; }
    private readonly DjuiImageVisualLayerV6 _imageVisuals;
    private readonly DjuiProgressVisualLayerV6 _progressVisuals;
    private readonly DjuiButtonStateRegistryV6 _buttonStates;
    private readonly List<IDisposable> _bindingRegistrations;

    internal DjuiTreeInstanceV6(Panel host, Panel root, DjuiLayoutSessionV6 session, bool ownsHost, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, List<IDisposable> bindingRegistrations)
    {
        Host = host;
        Root = root;
        Session = session;
        OwnsHost = ownsHost;
        _imageVisuals = imageVisuals;
        _progressVisuals = progressVisuals;
        _buttonStates = buttonStates;
        _bindingRegistrations = bindingRegistrations;
    }

    public T? GetControl<T>(string nodeId) where T : Control => Session.GetControl<T>(nodeId);

    // CloneControl 构建管线入口（BuildClone 使用）
    internal DjuiImageVisualLayerV6 ImageVisuals => _imageVisuals;
    internal DjuiProgressVisualLayerV6 ProgressVisuals => _progressVisuals;
    internal DjuiButtonStateRegistryV6 ButtonStates => _buttonStates;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var registration in _bindingRegistrations) registration.Dispose();
        _bindingRegistrations.Clear();

        // R5（0.7.18）：销毁树前提前清空 behaviors——控件进入 Dispose 后 IsValid 即失效，
        // 引擎 DisposeManaged 仍会 ClearBehaviors，TouchBehavior.OnDetached 在失效态恢复按压
        // 快照写 Oplicity 会抛 "Control is not valid"（关窗转场 FinalizeClose 路径必现一次）。
        // 此处控件仍有效，OnDetached 在合法时机执行，从根上绕开竞态。
        foreach (var control in Session.Controls.Values)
        {
            if (control.IsValid) control.ClearBehaviors();
        }

        foreach (var control in Session.Controls.Values) DjuiEffectPlayer.Stop(control);
        Session.Dispose();
        _imageVisuals.Dispose();
        _progressVisuals.Dispose();
        _buttonStates.Dispose();

        // R5 兜底：树销毁分步隔离——单步异常不阻断后续清理（Host 悬挂泄漏比一次可捕获异常更糟）
        try { Root.Dispose(); }
        catch (Exception ex) { Game.Logger.LogWarning("DJUI v6: Root.Dispose 异常（已隔离）：{Message}", ex.Message); }
        Host.RemoveFromVisualTreeAndParent();
        try { Host.Dispose(); }
        catch (Exception ex) { Game.Logger.LogWarning("DJUI v6: Host.Dispose 异常（已隔离）：{Message}", ex.Message); }
    }
}

/// <summary>
/// Builds exactly one persistent authored v6 tree under one Panel host.
/// Template instances must be expanded beforehand; the expanded instance remains one registered Panel.
/// </summary>
public static class DjuiTreeBuilderV6
{
    public static DjuiTreeInstanceV6 Build(string windowInstanceId, DjuiProjectV6 project, DjuiPageV6 page, Panel? host = null)
    {
        ArgumentNullException.ThrowIfNull(project);
        ArgumentNullException.ThrowIfNull(page);
        if (!string.Equals(page.Kind, "window", StringComparison.OrdinalIgnoreCase))
            throw new NotSupportedException($"DJUI v6: single-tree builder only supports expanded window pages; page '{page.PageId}' has kind '{page.Kind}'.");
        if (!string.Equals(page.Root.StarType, "Panel", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"DJUI v6: page root '{page.Root.Id}' must be a Panel.");

        var ownsHost = host == null;
        host ??= new Panel();
        if (ownsHost) host.FullScreen();
        host.ClipContent = true;

        var session = new DjuiLayoutSessionV6(windowInstanceId, project, page);
        var imageVisuals = new DjuiImageVisualLayerV6();
        var progressVisuals = new DjuiProgressVisualLayerV6();
        var buttonStates = new DjuiButtonStateRegistryV6(imageVisuals);
        var bindingRegistrations = new List<IDisposable>();
        Panel? root = null;
        try
        {
            root = (Panel)BuildNode(session.CurrentPage.Root, session, project.DefaultFont, imageVisuals, progressVisuals, buttonStates, bindingRegistrations);
            root.Parent = host;
            session.SetNodeUpdater((node, control) => ApplyNodeFields(control, node, project.DefaultFont, imageVisuals, progressVisuals, buttonStates));
            session.Relayout();
            return new DjuiTreeInstanceV6(host, root, session, ownsHost, imageVisuals, progressVisuals, buttonStates, bindingRegistrations);
        }
        catch
        {
            foreach (var registration in bindingRegistrations) registration.Dispose();
            session.Dispose();
            imageVisuals.Dispose();
            progressVisuals.Dispose();
            buttonStates.Dispose();
            if (ownsHost) host.Dispose();
            else root?.Dispose();
            throw;
        }
    }

    private static Control BuildNode(DjuiNodeV6 node, DjuiLayoutSessionV6 session, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, List<IDisposable> bindingRegistrations, bool bindBehaviors = true, bool recurse = true)
    {
        if (string.Equals(node.StarType, "TemplateInstance", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"DJUI v6: template node '{node.Id}' was not expanded.");
        if (string.IsNullOrWhiteSpace(node.Id))
            throw new InvalidOperationException("DJUI v6: every authored node must have a non-empty ID.");

        Control control = node.StarType switch
        {
            "Panel" => new Panel(),
            "Button" => new Button(),
            "Label" => new Label(),
            "Input" => new Input(),
            "Progress" => new Progress(),
            "SpacingPanel" => new Panel(),
            "PanelScrollable" => new PanelScrollable(),
            _ => throw new NotSupportedException($"DJUI v6: node '{node.Id}' uses unsupported starType '{node.StarType}'.")
        };

        ApplyNodeFields(control, node, defaultFont, imageVisuals, progressVisuals, buttonStates);
        ApplyInteraction(control, node.Interaction);
        ApplyEffects(control, node.Effects);
        session.Register(node.Id, control);
        if (bindBehaviors)
        {
            DjuiActionRouter.BindAction(control, node.Djui?.Action);
            DjuiAudioSystem.BindClickSound(control, node.Djui?.ClickSoundId);
            foreach (var binding in node.Djui?.Bindings ?? [])
                bindingRegistrations.Add(DjuiBindingSystem.RegisterBinding(control, binding.Key, binding.Value));
        }

        if (recurse)
            foreach (var childNode in node.Children)
            {
                var child = BuildNode(childNode, session, defaultFont, imageVisuals, progressVisuals, buttonStates, bindingRegistrations);
                child.Parent = control;
            }
        return control;
    }

    /// <summary>
    /// CloneControl 构建核心：JSON 克隆源子树 → 全树 id 加防冲突后缀 → 逐节点走同一构建管线
    /// （不绑 action/音效/数据绑定——克隆体无行为，如同 new）→ 按源子树解算矩形 ApplyRect
    /// （局部矩形，克隆体初始与源完全重叠，父级/位置归调用方）。
    /// 克隆节点以新 id 登记进布局会话：不参与 relayout，但树销毁时 ClearBehaviors/特效清理覆盖克隆体（R5 同款竞态防护）。
    /// </summary>
    internal static Control BuildClone(DjuiNodeV6 source, DjuiLayoutSessionV6 session, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, string idSuffix, IReadOnlyDictionary<string, DjuiRectV6> solved)
    {
        var node = JsonSerializer.Deserialize<DjuiNodeV6>(JsonSerializer.Serialize(source, CloneJsonOptions), CloneJsonOptions)
            ?? throw new InvalidOperationException("DJUI v6: clone JSON round-trip failed");
        ApplyCloneIds(node, idSuffix);
        return BuildCloneNode(node, source, session, defaultFont, imageVisuals, progressVisuals, buttonStates, solved, null);
    }

    private static readonly JsonSerializerOptions CloneJsonOptions = new();

    private static void ApplyCloneIds(DjuiNodeV6 node, string idSuffix)
    {
        node.Id += idSuffix;
        foreach (var child in node.Children) ApplyCloneIds(child, idSuffix);
    }

    private static Control BuildCloneNode(DjuiNodeV6 node, DjuiNodeV6 origin, DjuiLayoutSessionV6 session, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, IReadOnlyDictionary<string, DjuiRectV6> solved, DjuiRectV6? parentRect)
    {
        var control = BuildNode(node, session, defaultFont, imageVisuals, progressVisuals, buttonStates, new List<IDisposable>(), bindBehaviors: false, recurse: false);
        if (solved.TryGetValue(origin.Id, out var rect))
        {
            var local = parentRect is { } pr ? new DjuiRectV6(rect.X - pr.X, rect.Y - pr.Y, rect.Width, rect.Height) : rect;
            DjuiLayoutSessionV6.ApplyRect(control, local);
        }
        DjuiRectV6? ownRect = solved.TryGetValue(origin.Id, out var own) ? own : null;
        for (var i = 0; i < node.Children.Count; i++)
        {
            var child = BuildCloneNode(node.Children[i], origin.Children[i], session, defaultFont, imageVisuals, progressVisuals, buttonStates, solved, ownRect);
            child.Parent = control;
        }
        return control;
    }

    private static void ApplyNodeFields(Control control, DjuiNodeV6 node, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates)
    {
        // 控件 Name 取页面 JSON 的 name 字段——引擎 FindChild(name) / FindChildren(name) 的寻址依据（含克隆体）
        if (!string.IsNullOrWhiteSpace(node.Name)) control.Name = node.Name;
        ApplyBasic(control, node.Basic);
        ApplyTransformFields(control, node.Transform);
        ApplyAppearance(control, node.Appearance);
        ApplyProgress(control, node.Progress);
        var isRadialProgress = control is Progress progress && IsRadial(progress);
        if (control is not Progress) imageVisuals.Apply(node.Id, control, node.Appearance);
        ApplyText(control, node.Text, defaultFont);
        ApplyButton(control, node.Button, node.Appearance, node.Transform, imageVisuals, buttonStates);
        if (control is Progress target)
        {
            if (isRadialProgress) ApplyNativeProgressImage(target, node.Appearance);
            else progressVisuals.Apply(node.Id, target, node.Appearance);
        }
        ApplyLayout(control, node.Layout);
    }

    private static void ApplyInteraction(Control control, DjuiInteractionV6? interaction)
    {
        if (interaction == null) return;
        if (!string.IsNullOrEmpty(interaction.RoutedEvents) && Enum.TryParse<RoutedEvents>(interaction.RoutedEvents, out var routed)) control.RoutedEvents = routed;
        if (interaction.AllowDrag is bool allowDrag) control.AllowDrag = allowDrag;
        if (interaction.AllowDrop is bool allowDrop) control.AllowDrop = allowDrop;
        foreach (var behavior in interaction.Behaviors ?? [])
            if (behavior.Type == "TouchBehavior") control.AddTouchBehavior(behavior.ScaleFactor ?? 1f, behavior.EnablePressAnimation ?? false, behavior.EnableLongPress ?? false);
    }

    private static void ApplyEffects(Control control, DjuiEffectsV6? effects)
    {
        if (!string.IsNullOrEmpty(effects?.Preset)) DjuiEffectPresets.Apply(effects.Preset, control);
        else if (control is Button) DjuiEffectPresets.Apply("button_default", control);
    }

    private static void ApplyLayout(Control control, DjuiLayoutV6? layout)
    {
        if (layout == null) return;
        // Position/alignment/margin belong to the v6 solver. Applying authored layout margin here
        // would offset an already solved absolute rectangle a second time.
        if (layout.Padding is { Length: 4 } padding) control.Padding = new Thickness(padding[0], padding[1], padding[2], padding[3]);
        if (!string.IsNullOrEmpty(layout.HorizontalContentAlignment) && Enum.TryParse<HorizontalContentAlignment>(layout.HorizontalContentAlignment, out var horizontal))
            control.HorizontalContentAlignment = horizontal;
        if (!string.IsNullOrEmpty(layout.VerticalContentAlignment) && Enum.TryParse<VerticalContentAlignment>(layout.VerticalContentAlignment, out var vertical))
            control.VerticalContentAlignment = vertical;
    }

    private static void ApplyBasic(Control control, DjuiBasicV6? basic)
    {
        if (basic?.Visible is bool visible) control.Visible = visible;
        if (basic?.Disabled is bool disabled) control.Disabled = disabled;
        if (basic?.IsStatic is bool isStatic) control.IsStatic = isStatic;
    }

    private static void ApplyTransformFields(Control control, DjuiTransformV6? transform)
    {
        if (transform?.Rotation is float rotation) control.Rotation = rotation;
        if (transform?.Opacity is float opacity) control.Opacity = opacity;
        if (transform?.ZIndex is int zIndex) control.ZIndex = zIndex;
    }

    private static void ApplyAppearance(Control control, DjuiAppearanceV6? appearance)
    {
        if (appearance == null) return;
        if (TryParseColor(appearance.Background, out var background)) control.Background = background;
        if (appearance.CornerRadius is float radius) control.CornerRadius = radius;
        if (appearance.ClipContent is bool clip) control.ClipContent = clip;
        if (appearance.Desaturated is bool desaturated) control.Desaturated = desaturated;
        if (appearance.ImageFlipX is bool flipX) control.ImageFlipX = flipX;
        if (appearance.ImageFlipY is bool flipY) control.ImageFlipY = flipY;
        if (appearance.SlicedEdges is { Length: 4 } edges) control.SlicedEdges = new Thickness(edges[0], edges[1], edges[2], edges[3]);
    }

    private static void ApplyText(Control control, DjuiTextV6? text, string? defaultFont)
    {
        if (text == null) return;
        var font = string.IsNullOrEmpty(text.Font) ? defaultFont : text.Font;
        if (control is Label label) ApplyLabelText(label, text, font);
        else if (control is Input input)
        {
            if (text.Text != null) input.Text = text.Text;
            if (!string.IsNullOrEmpty(font)) input.Font = font;
            if (text.FontSize is float size) input.FontSize = size;
            if (TryParseColor(text.TextColor, out var color)) input.TextColor = color;
            if (text.Bold is bool bold) input.Bold = bold;
        }
        else if (control is Button button && text.Text != null)
        {
            var buttonLabel = button.Children?.OfType<Label>().FirstOrDefault(child => child.Name == DjuiButtonStateV6.ButtonLabelName);
            if (buttonLabel == null)
            {
                buttonLabel = new Label { Name = DjuiButtonStateV6.ButtonLabelName, IsStatic = true };
                buttonLabel.FullScreen();
                buttonLabel.Parent = button;
            }
            ApplyLabelText(buttonLabel, text, font);
        }
    }

    private static void ApplyLabelText(Label label, DjuiTextV6 text, string? font)
    {
        if (text.Text != null) label.Text = text.Text;
        if (!string.IsNullOrEmpty(font)) label.Font = font;
        if (text.FontSize is float size) label.FontSize = size;
        if (TryParseColor(text.TextColor, out var color)) label.TextColor = color;
        if (text.StrokeSize is float strokeSize) label.StrokeSize = Math.Max(0, strokeSize);
        if (TryParseColor(text.StrokeColor, out var strokeColor)) label.StrokeColor = strokeColor;
        if (text.Bold is bool bold) label.Bold = bold;
        if (text.TextWrap is bool wrap) label.TextWrap = wrap;
        if (!string.IsNullOrEmpty(text.TextOverflow) && Enum.TryParse<TextTrimming>(text.TextOverflow, out var trimming)) label.TextTrimming = trimming;
    }

    private static void ApplyButton(Control control, DjuiButtonV6? button, DjuiAppearanceV6? appearance, DjuiTransformV6? transform, DjuiImageVisualLayerV6 imageVisuals, DjuiButtonStateRegistryV6 buttonStates)
    {
        // 引擎 Button 的 ImageHover/ImagePressed 在 v6 下不可用（图片画在 visual 子 Panel，宿主 Image 为空，
        // 且引擎没有 ImageDisabled），四态换图与禁用灰化全部由 DjuiButtonStateV6 在 visual 层自管。
        if (control is not Button target) return;
        buttonStates.Attach(target, button, appearance?.Image, transform?.Opacity ?? 1f, appearance?.Desaturated ?? false);
    }

    private static void ApplyProgress(Control control, DjuiProgressV6? progress)
    {
        if (control is not Progress target || progress == null) return;
        if (progress.Value is float value) target.Value = value;
        if (!string.IsNullOrEmpty(progress.ProgressionMode) && Enum.TryParse<ProgressionMode>(progress.ProgressionMode, out var mode)) target.ProgressionMode = mode;
        if (progress.Rotation is float rotation) target.ProgressRotation = rotation;
    }

    private static bool IsRadial(Progress progress)
        => progress.ProgressionMode is ProgressionMode.Clockwise or ProgressionMode.CounterClockwise;

    private static void ApplyNativeProgressImage(Progress target, DjuiAppearanceV6? appearance)
    {
        target.Image = appearance?.Image ?? "";
        target.SlicedEdges = appearance?.SlicedEdges is { Length: 4 } edges
            ? new Thickness(edges[0], edges[1], edges[2], edges[3])
            : new Thickness(0, 0, 0, 0);
        target.ClipContent = appearance?.ClipContent ?? false;
    }

    private static bool TryParseColor(string? raw, out Color color)
    {
        color = Color.White;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var value = raw.Trim();
        try
        {
            if (value.StartsWith("#"))
            {
                color = value.Length == 9 ? ColorExtensions.FromRgbaHex(value) : ColorExtensions.FromHex(value);
                return true;
            }
            var match = Regex.Match(value, @"^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$", RegexOptions.IgnoreCase);
            if (!match.Success) return false;
            var r = Math.Clamp(int.Parse(match.Groups[1].Value), 0, 255);
            var g = Math.Clamp(int.Parse(match.Groups[2].Value), 0, 255);
            var b = Math.Clamp(int.Parse(match.Groups[3].Value), 0, 255);
            var a = match.Groups[4].Success ? (float.Parse(match.Groups[4].Value) is var alpha && alpha <= 1 ? Math.Clamp((int)MathF.Round(alpha * 255), 0, 255) : Math.Clamp((int)MathF.Round(alpha), 0, 255)) : 255;
            color = Color.FromArgb(a, r, g, b);
            return true;
        }
        catch { return false; }
    }
}

#endif
