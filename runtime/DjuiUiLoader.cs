// DJUI Runtime - 主加载器
// 读取 DJUI-Editor 输出的 JSON，构建完整的星火 UI 控件树

#if CLIENT

using System.IO;
using System.Numerics;
using System.Text.Json;
using System.Text.RegularExpressions;
using GameUI.Control;
using GameUI.Control.Primitive;
using GameUI.Control.Behavior;
using GameUI.Control.Extensions;
using GameUI.Device;
using GameUI.Enum;
using GameUI.Extensions;
using GameCore.Platform.SDL;

namespace DjuiRuntime;

/// <summary>
/// DJUI UI 加载器。读取页面 JSON 文件并构建控件树。
/// </summary>
public class DjuiUiLoader
{
    private DjuiPageJson? _page;
    private static readonly HashSet<string> TemplateStack = new();

    private static bool TryParseColor(string? raw, out Color color)
    {
        color = Color.White;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        var value = raw.Trim();
        try
        {
            if (value.StartsWith("#"))
            {
                color = value.Length == 9
                    ? ColorExtensions.FromRgbaHex(value)
                    : ColorExtensions.FromHex(value);
                return true;
            }

            var match = Regex.Match(value, @"^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$", RegexOptions.IgnoreCase);
            if (!match.Success) return false;

            var r = Math.Clamp(int.Parse(match.Groups[1].Value), 0, 255);
            var g = Math.Clamp(int.Parse(match.Groups[2].Value), 0, 255);
            var b = Math.Clamp(int.Parse(match.Groups[3].Value), 0, 255);
            var a = 255;
            if (match.Groups[4].Success)
            {
                var alpha = float.Parse(match.Groups[4].Value);
                a = alpha <= 1f ? Math.Clamp((int)MathF.Round(alpha * 255f), 0, 255) : Math.Clamp((int)MathF.Round(alpha), 0, 255);
            }
            color = Color.FromArgb(a, r, g, b);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// 加载页面 JSON 文件。
    /// </summary>
    public DjuiPageJson LoadPageJson(string filePath)
    {
        var json = File.ReadAllText(filePath);
        _page = JsonSerializer.Deserialize<DjuiPageJson>(json)!;
        return _page;
    }

    /// <summary>
    /// 构建页面控件树，返回根 Panel。
    /// </summary>
    public Panel Build()
    {
        if (_page == null)
            throw new InvalidOperationException("请先调用 LoadPageJson");

        // 读取全局默认字体
        var defaultFont = ReadDefaultFont();

        var host = new Panel();
        host.FullScreen();
        host.ClipContent = true;

        void Rebuild()
        {
            host.ClearChildren();
            BuildIntoHost(host, _page, defaultFont);
        }

        DeviceInfo.PrimaryViewport.SetDesignResolution(_page.DesignWidth, _page.DesignHeight, ScaleMode.Contain);
        Rebuild();
        DeviceInfo.PrimaryViewport.OnSizeChanged += (_, _) => Rebuild();
        DeviceInfo.PrimaryViewport.OnOrientationChanged += _ => Rebuild();
        DeviceInfo.PrimaryViewport.OnDevicePixelRatioChanged += _ => Rebuild();
        return host;
    }

    /// <summary>
    /// 构建模板实例：固定尺寸，不全屏，不做视口适配。
    /// </summary>
    public static Control BuildTemplateRoot(DjuiPageJson page)
    {
        var defaultFont = ReadDefaultFont();
        return BuildNode(page.Root, 0, 0, page.DesignWidth, page.DesignHeight, page.DesignWidth, page.DesignHeight, defaultFont);
    }

    private static void BuildIntoHost(Panel host, DjuiPageJson page, string? defaultFont)
    {
        var plan = DjuiViewportAdapter.CreatePlan(page);
        var backgroundNodes = page.Root.Children.Where(IsBackgroundNode).ToList();
        var hudNodes = page.Root.Children.Where(IsHudNode).ToList();
        var stageNodes = page.Root.Children.Where(x => !IsBackgroundNode(x) && !IsHudNode(x)).ToList();

        var backgroundLayer = new Panel();
        backgroundLayer.Width = plan.Viewport.Width;
        backgroundLayer.Height = plan.Viewport.Height;
        backgroundLayer.ClipContent = true;
        backgroundLayer.Margin = new Thickness(0, 0, 0, 0);
        host.AddChild(backgroundLayer);

        foreach (var backgroundNode in backgroundNodes)
        {
            var background = BuildNode(backgroundNode, 0, 0, plan.Background.Width, plan.Background.Height, plan.Viewport.Width, plan.Viewport.Height, defaultFont);
            background.Margin = new Thickness(plan.Background.X, plan.Background.Y, 0, 0);
            backgroundLayer.AddChild(background);
        }

        var stageRootNode = CreateRuntimeRoot(page.Root, stageNodes);
        var stageRoot = BuildNode(stageRootNode, 0, 0, page.DesignWidth, page.DesignHeight, page.DesignWidth, page.DesignHeight, defaultFont);
        stageRoot.Margin = new Thickness(plan.Content.X, plan.Content.Y, 0, 0);
        stageRoot.Scale = new Vector2(plan.Content.Scale, plan.Content.Scale);
        host.AddChild(stageRoot);

        var hudLayer = new Panel();
        hudLayer.Width = plan.Viewport.Width;
        hudLayer.Height = plan.Viewport.Height;
        hudLayer.Margin = new Thickness(0, 0, 0, 0);
        host.AddChild(hudLayer);

        foreach (var hudNode in hudNodes)
        {
            var hud = BuildNode(hudNode, 0, 0, page.DesignWidth, page.DesignHeight, page.DesignWidth, page.DesignHeight, defaultFont);
            var solved = DjuiLayoutSolver.Solve(hudNode, 0, 0, page.DesignWidth, page.DesignHeight, page.DesignWidth, page.DesignHeight);
            hud.Margin = ComputeHudMargin(hudNode, solved, page, plan);
            hud.Scale = new Vector2(plan.Content.Scale, plan.Content.Scale);
            hudLayer.AddChild(hud);
        }
    }

    private static bool IsBackgroundNode(DjuiNodeJson node)
    {
        if (string.Equals(node.Adapt?.Role, "background", StringComparison.OrdinalIgnoreCase))
            return true;
        if (!string.Equals(node.Name, "背景", StringComparison.OrdinalIgnoreCase))
            return false;
        return !string.IsNullOrEmpty(node.Appearance?.Image);
    }

    private static bool IsHudNode(DjuiNodeJson node)
    {
        return string.Equals(node.Adapt?.Role, "hud", StringComparison.OrdinalIgnoreCase);
    }

    private static Thickness ComputeHudMargin(DjuiNodeJson node, SolvedRect solved, DjuiPageJson page, DjuiViewportPlan plan)
    {
        var scale = plan.Content.Scale;
        var pin = node.Adapt?.SafePin ?? "";
        var pinLeft = HasSafePin(pin, "left");
        var pinRight = HasSafePin(pin, "right");
        var pinTop = HasSafePin(pin, "top");
        var pinBottom = HasSafePin(pin, "bottom");

        var x = plan.Content.X + solved.X * scale;
        var y = plan.Content.Y + solved.Y * scale;

        if (pinLeft)
        {
            x = plan.Safe.X + solved.X * scale;
        }
        else if (pinRight)
        {
            x = plan.Safe.X + plan.Safe.Width - (page.DesignWidth - solved.X) * scale;
        }

        if (pinTop)
        {
            y = plan.Safe.Y + solved.Y * scale;
        }
        else if (pinBottom)
        {
            y = plan.Safe.Y + plan.Safe.Height - (page.DesignHeight - solved.Y) * scale;
        }

        return new Thickness(x, y, 0, 0);
    }

    private static bool HasSafePin(string safePin, string value)
    {
        return safePin
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(x => string.Equals(x, value, StringComparison.OrdinalIgnoreCase));
    }

    private static DjuiNodeJson CreateRuntimeRoot(DjuiNodeJson root, List<DjuiNodeJson> children)
    {
        return new DjuiNodeJson
        {
            Id = root.Id,
            StarType = root.StarType,
            Name = root.Name,
            Basic = root.Basic,
            Transform = root.Transform,
            Appearance = root.Appearance,
            Layout = root.Layout,
            Interaction = root.Interaction,
            Effects = root.Effects,
            Text = root.Text,
            Button = root.Button,
            Progress = root.Progress,
            Djui = root.Djui,
            WidthStretchRatio = root.WidthStretchRatio,
            HeightStretchRatio = root.HeightStretchRatio,
            WidthCompactRatio = root.WidthCompactRatio,
            HeightCompactRatio = root.HeightCompactRatio,
            Children = children,
            Anchor = root.Anchor,
            Stretch = root.Stretch,
            AspectRatio = root.AspectRatio,
            TemplateRef = root.TemplateRef,
            TemplateOverrides = root.TemplateOverrides,
            Adapt = root.Adapt,
        };
    }

    /// <summary>
    /// 读取全局默认字体配置。
    /// </summary>
    private static string? ReadDefaultFont()
    {
        try
        {
            var configPath = Path.Combine("user_files", "djui", "djui_config.json");
            if (File.Exists(configPath))
            {
                var cfgJson = File.ReadAllText(configPath);
                using var doc = JsonDocument.Parse(cfgJson);
                if (doc.RootElement.TryGetProperty("defaultFont", out var fontEl))
                    return fontEl.GetString();
            }
        }
        catch { /* ignore */ }
        return null;
    }

    /// <summary>
    /// 加载并构建页面，返回根 Panel。
    /// </summary>
    public Panel LoadAndBuild(string filePath)
    {
        LoadPageJson(filePath);
        return Build();
    }

    /// <summary>
    /// 递归构建控件节点。
    /// </summary>
    /// <param name="parentWidth">父节点宽度</param>
    /// <param name="parentHeight">父节点高度</param>
    /// <param name="screenWidth">屏幕宽度（target=screen 时用）</param>
    /// <param name="screenHeight">屏幕高度</param>
    internal static Control BuildNode(
        DjuiNodeJson def,
        float parentX,
        float parentY,
        float parentWidth,
        float parentHeight,
        float screenWidth,
        float screenHeight,
        string? defaultFont = null)
    {
        if (string.Equals(def.StarType, "TemplateInstance", StringComparison.OrdinalIgnoreCase))
        {
            return BuildTemplateInstance(def, parentX, parentY, parentWidth, parentHeight, screenWidth, screenHeight, defaultFont);
        }

        // 根据类型创建控件
        Control ctrl = def.StarType switch
        {
            "Button" => new Button(),
            "Label" => new Label(),
            "Input" => new Input(),
            "Progress" => new Progress(),
            // SpacingPanel 需要 GameLink，用 Panel + FlowOrientation 替代
            "SpacingPanel" => new Panel(),
            "PanelScrollable" => new PanelScrollable(),
            _ => new Panel(),
        };

        // ★ root 节点代表设计画布，必须使用页面设计尺寸，不能落到默认 100x100
        var solved = def.Id == "root"
            ? new SolvedRect(0, 0, parentWidth, parentHeight)
            : DjuiLayoutSolver.Solve(def, parentX, parentY, parentWidth, parentHeight, screenWidth, screenHeight);
        var relativeSolved = new SolvedRect(solved.X - parentX, solved.Y - parentY, solved.Width, solved.Height);

        // 应用各属性组
        ApplyBasic(ctrl, def.Basic);
        ApplySolvedLayout(ctrl, relativeSolved, def.Transform, def);
        ApplyAppearance(ctrl, def.Appearance);
        ApplyInteraction(ctrl, def.Interaction);
        ApplyLayout(ctrl, def.Layout, def);
        ApplyText(ctrl, def.Text, def.StarType, defaultFont);
        ApplyButtonTypeSpecific(ctrl, def);
        ApplyProgress(ctrl, def.Progress);

        ApplyEffects(ctrl, def);

        // 注册控件到绑定系统
        DjuiBindingSystem.RegisterControl(def.Id, ctrl);

        // Action 路由
        if (def.Djui != null)
        {
            DjuiAudioSystem.BindClickSound(ctrl, def.Djui.ClickSoundId);
            DjuiActionRouter.BindAction(ctrl, def.Djui.Action);
        }

        // 递归构建子控件（子节点的父矩形 = 当前控件的 solved 矩形）
        foreach (var childDef in def.Children)
        {
            var child = BuildNode(childDef, solved.X, solved.Y, solved.Width, solved.Height, screenWidth, screenHeight, defaultFont);
            child.Parent = ctrl;
        }

        return ApplyBorderWrapper(ctrl, def.Appearance);
    }

    private static Control ApplyBorderWrapper(Control ctrl, DjuiAppearanceJson? app)
    {
        if (app?.BorderThickness == null || app.BorderThickness.Value <= 0f)
            return ctrl;

        var thickness = Math.Max(0f, app.BorderThickness.Value);
        if (TryParseColor(app.BorderColor, out var borderColor))
            return ctrl.Border(thickness, borderColor);

        return ctrl.Border(thickness);
    }

    private static void ApplyEffects(Control ctrl, DjuiNodeJson def)
    {
        if (!string.IsNullOrEmpty(def.Effects?.Preset))
        {
            DjuiEffectPresets.Apply(def.Effects.Preset, ctrl);
            return;
        }

        if (ctrl is Button)
            DjuiEffectPresets.Apply("button_default", ctrl);
    }

    private static Control BuildTemplateInstance(
        DjuiNodeJson def,
        float parentX,
        float parentY,
        float parentWidth,
        float parentHeight,
        float screenWidth,
        float screenHeight,
        string? defaultFont)
    {
        var solved = DjuiLayoutSolver.Solve(def, parentX, parentY, parentWidth, parentHeight, screenWidth, screenHeight);
        var relativeSolved = new SolvedRect(solved.X - parentX, solved.Y - parentY, solved.Width, solved.Height);

        var host = new Panel();
        ApplyBasic(host, def.Basic);
        ApplySolvedLayout(host, relativeSolved, def.Transform, def);
        ApplyInteraction(host, def.Interaction);
        ApplyLayout(host, def.Layout, def);

        if (def.Effects != null && !string.IsNullOrEmpty(def.Effects.Preset))
            DjuiEffectPresets.Apply(def.Effects.Preset, host);

        DjuiBindingSystem.RegisterControl(def.Id, host);
        if (def.Djui != null)
        {
            DjuiAudioSystem.BindClickSound(host, def.Djui.ClickSoundId);
            DjuiActionRouter.BindAction(host, def.Djui.Action);
        }

        if (string.IsNullOrWhiteSpace(def.TemplateRef))
        {
            Game.Logger.LogWarning("DJUI: 模板实例 {Id} 未配置 templateRef", def.Id);
            return host;
        }

        if (!DjuiWindowManager.TryGetPage(def.TemplateRef, out var templatePage))
        {
            Game.Logger.LogWarning("DJUI: 模板 {TemplateRef} 不存在", def.TemplateRef);
            return host;
        }

        if (!string.Equals(templatePage.NodeKind, "template", StringComparison.OrdinalIgnoreCase))
        {
            Game.Logger.LogWarning("DJUI: {TemplateRef} 不是模板", def.TemplateRef);
            return host;
        }

        if (TemplateStack.Contains(def.TemplateRef))
        {
            Game.Logger.LogWarning("DJUI: 检测到模板循环引用 {TemplateRef}", def.TemplateRef);
            return host;
        }

        TemplateStack.Add(def.TemplateRef);
        try
        {
            foreach (var sourceChild in templatePage.Root.Children)
            {
                var childDef = CloneNode(sourceChild);
                ApplyTemplateOverrides(childDef, def.TemplateOverrides);
                var child = BuildNode(childDef, 0, 0, solved.Width, solved.Height, solved.Width, solved.Height, defaultFont);
                child.Parent = host;
            }
        }
        finally
        {
            TemplateStack.Remove(def.TemplateRef);
        }

        return host;
    }

    private static DjuiNodeJson CloneNode(DjuiNodeJson node)
    {
        var json = JsonSerializer.Serialize(node);
        return JsonSerializer.Deserialize<DjuiNodeJson>(json) ?? new DjuiNodeJson();
    }

    private static void ApplyTemplateOverrides(DjuiNodeJson node, Dictionary<string, Dictionary<string, JsonElement>>? overrides)
    {
        if (overrides == null) return;

        if (!string.IsNullOrEmpty(node.Name) && overrides.TryGetValue(node.Name, out var fields))
        {
            foreach (var (fieldPath, value) in fields)
                ApplyNodeOverride(node, fieldPath, value);
        }

        foreach (var child in node.Children)
            ApplyTemplateOverrides(child, overrides);
    }

    private static void ApplyNodeOverride(DjuiNodeJson node, string fieldPath, JsonElement value)
    {
        switch (fieldPath)
        {
            case "basic.visible":
                node.Basic ??= new DjuiBasicJson();
                node.Basic.Visible = ReadBool(value);
                break;
            case "basic.disabled":
                node.Basic ??= new DjuiBasicJson();
                node.Basic.Disabled = ReadBool(value);
                break;
            case "basic.isStatic":
                node.Basic ??= new DjuiBasicJson();
                node.Basic.IsStatic = ReadBool(value);
                break;
            case "transform.x":
                node.Transform ??= new DjuiTransformJson();
                node.Transform.X = ReadFloat(value);
                break;
            case "transform.y":
                node.Transform ??= new DjuiTransformJson();
                node.Transform.Y = ReadFloat(value);
                break;
            case "transform.width":
                node.Transform ??= new DjuiTransformJson();
                node.Transform.Width = ReadFloat(value);
                break;
            case "transform.height":
                node.Transform ??= new DjuiTransformJson();
                node.Transform.Height = ReadFloat(value);
                break;
            case "appearance.image":
                node.Appearance ??= new DjuiAppearanceJson();
                node.Appearance.Image = ReadString(value);
                break;
            case "appearance.background":
                node.Appearance ??= new DjuiAppearanceJson();
                node.Appearance.Background = ReadString(value);
                break;
            case "appearance.borderThickness":
                node.Appearance ??= new DjuiAppearanceJson();
                node.Appearance.BorderThickness = ReadFloat(value);
                break;
            case "appearance.borderColor":
                node.Appearance ??= new DjuiAppearanceJson();
                node.Appearance.BorderColor = ReadString(value);
                break;
            case "text.text":
                node.Text ??= new DjuiTextJson();
                node.Text.Text = ReadString(value);
                break;
            case "text.fontSize":
                node.Text ??= new DjuiTextJson();
                node.Text.FontSize = ReadFloat(value);
                break;
            case "text.textColor":
                node.Text ??= new DjuiTextJson();
                node.Text.TextColor = ReadString(value);
                break;
            case "text.strokeSize":
                node.Text ??= new DjuiTextJson();
                node.Text.StrokeSize = ReadFloat(value);
                break;
            case "text.strokeColor":
                node.Text ??= new DjuiTextJson();
                node.Text.StrokeColor = ReadString(value);
                break;
            case "text.bold":
                node.Text ??= new DjuiTextJson();
                node.Text.Bold = ReadBool(value);
                break;
            case "text.font":
                node.Text ??= new DjuiTextJson();
                node.Text.Font = ReadString(value);
                break;
            case "text.textWrap":
                node.Text ??= new DjuiTextJson();
                node.Text.TextWrap = ReadBool(value);
                break;
            case "text.textOverflow":
                node.Text ??= new DjuiTextJson();
                node.Text.TextOverflow = ReadString(value);
                break;
            case "button.imageHover":
                node.Button ??= new DjuiButtonJson();
                node.Button.ImageHover = ReadString(value);
                break;
            case "button.imagePressed":
                node.Button ??= new DjuiButtonJson();
                node.Button.ImagePressed = ReadString(value);
                break;
            case "progress.value":
                node.Progress ??= new DjuiProgressJson();
                node.Progress.Value = ReadFloat(value);
                break;
        }
    }

    private static string? ReadString(JsonElement value)
    {
        return value.ValueKind == JsonValueKind.Null ? null : value.ToString();
    }

    private static float? ReadFloat(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetSingle(out var result))
            return result;
        if (value.ValueKind == JsonValueKind.String && float.TryParse(value.GetString(), out result))
            return result;
        return null;
    }

    private static bool? ReadBool(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.True) return true;
        if (value.ValueKind == JsonValueKind.False) return false;
        if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var result))
            return result;
        return null;
    }

    private static void ApplyBasic(Control ctrl, DjuiBasicJson? basic)
    {
        if (basic == null) return;
        if (basic.Visible.HasValue) ctrl.Visible = basic.Visible.Value;
        if (basic.Disabled.HasValue) ctrl.Disabled = basic.Disabled.Value;
        if (basic.IsStatic.HasValue) ctrl.IsStatic = basic.IsStatic.Value;
    }

    /// <summary>
    /// 应用 layout solver 算出的最终矩形到控件。
    /// 锚点/拉伸/宽高比已经由 solver 处理，这里只做绝对定位 + 尺寸 + 旋转/透明度。
    /// </summary>
    private static void ApplySolvedLayout(Control ctrl, SolvedRect solved, DjuiTransformJson? t, DjuiNodeJson? node)
    {
        // 绝对定位（solver 算出的 x/y 已经是相对父矩形左上的最终坐标）
        ctrl.HorizontalAlignment = HorizontalAlignment.Left;
        ctrl.VerticalAlignment = VerticalAlignment.Top;
        if (node != null && DjuiLayoutSolver.ShouldUseNativeAutoWidth(node))
            ctrl.AutoWidth();
        else
            ctrl.Width = solved.Width;

        if (node != null && DjuiLayoutSolver.ShouldUseNativeAutoHeight(node))
            ctrl.AutoHeight();
        else
            ctrl.Height = solved.Height;

        ctrl.Margin = new Thickness(solved.X, solved.Y, 0, 0);

        // 旋转/透明度/Z（这些不参与布局求解）
        if (t != null)
        {
            if (t.Rotation.HasValue) ctrl.Rotation = t.Rotation.Value;
            if (t.Opacity.HasValue) ctrl.Opacity = t.Opacity.Value;
            if (t.ZIndex.HasValue) ctrl.ZIndex = t.ZIndex.Value;
        }
    }

    private static void ApplyAppearance(Control ctrl, DjuiAppearanceJson? app)
    {
        if (app == null) return;

        if (!string.IsNullOrEmpty(app.Image))
            ctrl.Image = app.Image!;

        if (!string.IsNullOrEmpty(app.Background))
        {
            if (TryParseColor(app.Background, out var bg))
                ctrl.Background = bg;
            else
                Game.Logger.LogWarning("DJUI: 忽略无法解析的背景色 {Color}", app.Background);
        }

        if (app.CornerRadius.HasValue) ctrl.CornerRadius = app.CornerRadius.Value;
        if (app.ClipContent.HasValue) ctrl.ClipContent = app.ClipContent.Value;
        if (app.Desaturated.HasValue) ctrl.Desaturated = app.Desaturated.Value;
        if (app.ImageFlipX.HasValue) ctrl.ImageFlipX = app.ImageFlipX.Value;
        if (app.ImageFlipY.HasValue) ctrl.ImageFlipY = app.ImageFlipY.Value;
        if (app.SlicedEdges != null && app.SlicedEdges.Length == 4)
            ctrl.SlicedEdges = new Thickness(app.SlicedEdges[0], app.SlicedEdges[1], app.SlicedEdges[2], app.SlicedEdges[3]);
    }

    private static void ApplyInteraction(Control ctrl, DjuiInteractionJson? interaction)
    {
        if (interaction == null) return;

        if (!string.IsNullOrEmpty(interaction.RoutedEvents))
        {
            if (Enum.TryParse<RoutedEvents>(interaction.RoutedEvents, out var re))
                ctrl.RoutedEvents = re;
        }

        if (interaction.AllowDrag.HasValue) ctrl.AllowDrag = interaction.AllowDrag.Value;
        if (interaction.AllowDrop.HasValue) ctrl.AllowDrop = interaction.AllowDrop.Value;

        // TouchBehavior 解析
        if (interaction.Behaviors != null)
        {
            foreach (var beh in interaction.Behaviors)
            {
                if (beh.Type == "TouchBehavior")
                {
                    ctrl.AddTouchBehavior(
                        scaleFactor: beh.ScaleFactor ?? 1f,
                        enablePressAnimation: beh.EnablePressAnimation ?? false,
                        enableLongPress: beh.EnableLongPress ?? false
                    );
                }
            }
        }
    }

    /// <summary>
    /// 应用布局属性：内容对齐、自动布局方向、间距、Flex。
    /// 注意：内容对齐是控件内部内容的对齐，与控件自身在父级中的位置无关。
    /// </summary>
    private static void ApplyLayout(Control ctrl, DjuiLayoutJson? layout, DjuiNodeJson? node)
    {
        if (layout == null) return;
        // 内容对齐
        if (!string.IsNullOrEmpty(layout.HorizontalContentAlignment))
        {
            if (Enum.TryParse<HorizontalContentAlignment>(layout.HorizontalContentAlignment, out var ha))
                ctrl.HorizontalContentAlignment = ha;
        }
        if (!string.IsNullOrEmpty(layout.VerticalContentAlignment))
        {
            if (Enum.TryParse<VerticalContentAlignment>(layout.VerticalContentAlignment, out var va))
                ctrl.VerticalContentAlignment = va;
        }
        // 自动布局在编辑器中已经写回 transform。
        // 运行时只按 transform 渲染，不能再设置 FlowOrientation / Flex，否则会二次排版导致位置漂移。
    }

    private static void ApplyText(Control ctrl, DjuiTextJson? text, string starType, string? defaultFont)
    {
        if (text == null) return;
        if (text.Text == null) return;

        // 字体优先级：节点字体 > 全局默认字体
        var font = !string.IsNullOrEmpty(text.Font) ? text.Font! : defaultFont;

        if (ctrl is Label label)
        {
            ApplyTextToLabel(label, text, font);
        }
        else if (ctrl is Input input)
        {
            input.Text = text.Text;
            if (!string.IsNullOrEmpty(font)) input.Font = font;
            if (text.FontSize.HasValue) input.FontSize = text.FontSize.Value;
            if (TryParseColor(text.TextColor, out var color)) input.TextColor = color;
            if (text.Bold.HasValue) input.Bold = text.Bold.Value;
        }
        else if (ctrl is Button button)
        {
            var buttonLabel = new Label
            {
                IsStatic = true,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                HorizontalContentAlignment = button.HorizontalContentAlignment,
                VerticalContentAlignment = button.VerticalContentAlignment,
                Width = button.Width,
                Height = button.Height,
                Margin = new Thickness(0, 0, 0, 0),
            };
            ApplyTextToLabel(buttonLabel, text, font);
            buttonLabel.Parent = button;
        }
    }

    private static void ApplyTextToLabel(Label label, DjuiTextJson text, string? font)
    {
        label.Text = text.Text;
        if (!string.IsNullOrEmpty(font)) label.Font = font;
        if (text.FontSize.HasValue) label.FontSize = text.FontSize.Value;
        if (TryParseColor(text.TextColor, out var color)) label.TextColor = color;
        if (text.StrokeSize.HasValue) label.StrokeSize = Math.Max(0f, text.StrokeSize.Value);
        if (TryParseColor(text.StrokeColor, out var strokeColor)) label.StrokeColor = strokeColor;
        if (text.Bold.HasValue) label.Bold = text.Bold.Value;
        if (text.TextWrap.HasValue) label.TextWrap = text.TextWrap.Value;
        if (!string.IsNullOrEmpty(text.TextOverflow))
        {
            label.TextTrimming = text.TextOverflow switch
            {
                "None" => TextTrimming.None,
                "Clip" => TextTrimming.Clip,
                "Ellipsis" => TextTrimming.Ellipsis,
                "Shrink" => TextTrimming.Shrink,
                _ => label.TextTrimming
            };
        }
    }

    private static void ApplyButtonTypeSpecific(Control ctrl, DjuiNodeJson def)
    {
        if (ctrl is not Button btn || def.Button == null) return;

        if (!string.IsNullOrEmpty(def.Button.ImageHover))
            btn.ImageHover = def.Button.ImageHover!;

        if (!string.IsNullOrEmpty(def.Button.ImagePressed))
            btn.ImagePressed = def.Button.ImagePressed!;
    }

    private static void ApplyProgress(Control ctrl, DjuiProgressJson? progress)
    {
        if (ctrl is not Progress prog || progress == null) return;

        if (progress.Value.HasValue) prog.Value = progress.Value.Value;

        if (!string.IsNullOrEmpty(progress.ProgressionMode))
        {
            if (Enum.TryParse<ProgressionMode>(progress.ProgressionMode, out var mode))
                prog.ProgressionMode = mode;
        }

        if (progress.Rotation.HasValue) prog.ProgressRotation = progress.Rotation.Value;
    }
}

#endif
