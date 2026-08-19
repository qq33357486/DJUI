// DJUI Runtime - focused protocol v6 persistent authored-tree builder
#if CLIENT

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
    private readonly DjuiButtonStateRegistryV6 _buttonStates;
    private readonly List<IDisposable> _bindingRegistrations;

    internal DjuiTreeInstanceV6(Panel host, Panel root, DjuiLayoutSessionV6 session, bool ownsHost, DjuiImageVisualLayerV6 imageVisuals, DjuiButtonStateRegistryV6 buttonStates, List<IDisposable> bindingRegistrations)
    {
        Host = host;
        Root = root;
        Session = session;
        OwnsHost = ownsHost;
        _imageVisuals = imageVisuals;
        _buttonStates = buttonStates;
        _bindingRegistrations = bindingRegistrations;
    }

    public T? GetControl<T>(string nodeId) where T : Control => Session.GetControl<T>(nodeId);

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var registration in _bindingRegistrations) registration.Dispose();
        _bindingRegistrations.Clear();
        foreach (var control in Session.Controls.Values) DjuiEffectPlayer.Stop(control);
        Session.Dispose();
        _imageVisuals.Dispose();
        _buttonStates.Dispose();
        Root.Dispose();
        Host.RemoveFromVisualTreeAndParent();
        Host.Dispose();
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
        var buttonStates = new DjuiButtonStateRegistryV6(imageVisuals);
        var bindingRegistrations = new List<IDisposable>();
        Panel? root = null;
        try
        {
            root = (Panel)BuildNode(session.CurrentPage.Root, session, project.DefaultFont, imageVisuals, buttonStates, bindingRegistrations);
            root.Parent = host;
            session.SetNodeUpdater((node, control) => ApplyNodeFields(control, node, project.DefaultFont, imageVisuals, buttonStates));
            session.Relayout();
            return new DjuiTreeInstanceV6(host, root, session, ownsHost, imageVisuals, buttonStates, bindingRegistrations);
        }
        catch
        {
            foreach (var registration in bindingRegistrations) registration.Dispose();
            session.Dispose();
            imageVisuals.Dispose();
            buttonStates.Dispose();
            if (ownsHost) host.Dispose();
            else root?.Dispose();
            throw;
        }
    }

    private static Control BuildNode(DjuiNodeV6 node, DjuiLayoutSessionV6 session, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiButtonStateRegistryV6 buttonStates, List<IDisposable> bindingRegistrations)
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

        ApplyNodeFields(control, node, defaultFont, imageVisuals, buttonStates);
        ApplyInteraction(control, node.Interaction);
        ApplyEffects(control, node.Effects);
        session.Register(node.Id, control);
        DjuiActionRouter.BindAction(control, node.Djui?.Action);
        DjuiAudioSystem.BindClickSound(control, node.Djui?.ClickSoundId);
        foreach (var binding in node.Djui?.Bindings ?? [])
            bindingRegistrations.Add(DjuiBindingSystem.RegisterBinding(control, binding.Key, binding.Value));

        foreach (var childNode in node.Children)
        {
            var child = BuildNode(childNode, session, defaultFont, imageVisuals, buttonStates, bindingRegistrations);
            child.Parent = control;
        }
        return control;
    }

    private static void ApplyNodeFields(Control control, DjuiNodeV6 node, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiButtonStateRegistryV6 buttonStates)
    {
        ApplyBasic(control, node.Basic);
        ApplyTransformFields(control, node.Transform);
        ApplyAppearance(control, node.Appearance);
        imageVisuals.Apply(node.Id, control, node.Appearance);
        ApplyText(control, node.Text, defaultFont);
        ApplyButton(control, node.Button, node.Appearance, node.Transform, imageVisuals, buttonStates);
        ApplyProgress(control, node.Progress);
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
