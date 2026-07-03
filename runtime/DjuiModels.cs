// DJUI Runtime - JSON 反序列化模型
// 对应协议 v4

using System.Text.Json;
using System.Text.Json.Serialization;

namespace DjuiRuntime;

public class DjuiPageJson
{
    [JsonPropertyName("version")]
    public int Version { get; set; }

    [JsonPropertyName("pageId")]
    public string PageId { get; set; } = "";

    [JsonPropertyName("designWidth")]
    public float DesignWidth { get; set; } = 900;

    [JsonPropertyName("designHeight")]
    public float DesignHeight { get; set; } = 1600;

    [JsonPropertyName("adaptation")]
    public DjuiAdaptationJson? Adaptation { get; set; }

    [JsonPropertyName("root")]
    public DjuiNodeJson Root { get; set; } = new();

    [JsonPropertyName("nodeKind")]
    public string NodeKind { get; set; } = "";

    [JsonPropertyName("windowMode")]
    public string? WindowMode { get; set; }

    [JsonPropertyName("transition")]
    public DjuiTransitionJson? Transition { get; set; }
}

public class DjuiTransitionJson
{
    [JsonPropertyName("open")]
    public string? Open { get; set; }

    [JsonPropertyName("close")]
    public string? Close { get; set; }
}

public class DjuiNodeJson
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("starType")]
    public string StarType { get; set; } = "Panel";

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("basic")]
    public DjuiBasicJson? Basic { get; set; }

    [JsonPropertyName("transform")]
    public DjuiTransformJson? Transform { get; set; }

    [JsonPropertyName("appearance")]
    public DjuiAppearanceJson? Appearance { get; set; }

    [JsonPropertyName("layout")]
    public DjuiLayoutJson? Layout { get; set; }

    [JsonPropertyName("interaction")]
    public DjuiInteractionJson? Interaction { get; set; }

    [JsonPropertyName("effects")]
    public DjuiEffectsJson? Effects { get; set; }

    [JsonPropertyName("text")]
    public DjuiTextJson? Text { get; set; }

    [JsonPropertyName("button")]
    public DjuiButtonJson? Button { get; set; }

    [JsonPropertyName("progress")]
    public DjuiProgressJson? Progress { get; set; }

    [JsonPropertyName("djui")]
    public DjuiExtensionJson? Djui { get; set; }

    // Flex 属性
    [JsonPropertyName("widthStretchRatio")]
    public float? WidthStretchRatio { get; set; }
    [JsonPropertyName("heightStretchRatio")]
    public float? HeightStretchRatio { get; set; }
    [JsonPropertyName("widthCompactRatio")]
    public float? WidthCompactRatio { get; set; }
    [JsonPropertyName("heightCompactRatio")]
    public float? HeightCompactRatio { get; set; }

    [JsonPropertyName("children")]
    public List<DjuiNodeJson> Children { get; set; } = new();

    // ★ uGUI 风格锚点
    [JsonPropertyName("anchor")]
    public DjuiAnchorJson? Anchor { get; set; }

    // ★ 拉伸（NGUI UIStretch 风格）
    [JsonPropertyName("stretch")]
    public DjuiStretchJson? Stretch { get; set; }

    // ★ 宽高比
    [JsonPropertyName("aspectRatio")]
    public DjuiAspectRatioJson? AspectRatio { get; set; }

    [JsonPropertyName("templateRef")]
    public string? TemplateRef { get; set; }

    [JsonPropertyName("templateOverrides")]
    public Dictionary<string, Dictionary<string, JsonElement>>? TemplateOverrides { get; set; }

    [JsonPropertyName("adapt")]
    public DjuiNodeAdaptJson? Adapt { get; set; }
}

public class DjuiAdaptationJson
{
    [JsonPropertyName("orientation")]
    public string? Orientation { get; set; }

    [JsonPropertyName("designWidth")]
    public float? DesignWidth { get; set; }

    [JsonPropertyName("designHeight")]
    public float? DesignHeight { get; set; }

    [JsonPropertyName("contentFit")]
    public string? ContentFit { get; set; }

    [JsonPropertyName("backgroundFit")]
    public string? BackgroundFit { get; set; }

    [JsonPropertyName("safeArea")]
    public bool? SafeArea { get; set; }

    [JsonPropertyName("contentAlign")]
    public string? ContentAlign { get; set; }

    [JsonPropertyName("minScale")]
    public float? MinScale { get; set; }

    [JsonPropertyName("maxScale")]
    public float? MaxScale { get; set; }
}

public class DjuiNodeAdaptJson
{
    [JsonPropertyName("role")]
    public string? Role { get; set; }

    [JsonPropertyName("safePin")]
    public string? SafePin { get; set; }

    [JsonPropertyName("bleed")]
    public bool? Bleed { get; set; }
}

public class DjuiAnchorJson
{
    // 锚定目标：屏幕 / 父节点
    [JsonPropertyName("target")]
    public string? Target { get; set; }

    // NGUI 风格 9-way 锚点位置
    [JsonPropertyName("side")]
    public string? Side { get; set; }

    // === 向后兼容旧字段（自动迁移用）===
    [JsonPropertyName("anchorMin")]
    public Vec2Json? AnchorMin { get; set; }

    [JsonPropertyName("anchorMax")]
    public Vec2Json? AnchorMax { get; set; }

    [JsonPropertyName("left")]
    public float? Left { get; set; }

    [JsonPropertyName("right")]
    public float? Right { get; set; }

    [JsonPropertyName("top")]
    public float? Top { get; set; }

    [JsonPropertyName("bottom")]
    public float? Bottom { get; set; }
}

public class DjuiStretchJson
{
    // 拉伸风格：None / Horizontal / Vertical / Both
    [JsonPropertyName("style")]
    public string? Style { get; set; }

    // 拉伸边距（像素）
    [JsonPropertyName("margins")]
    public DjuiStretchMarginsJson? Margins { get; set; }
}

public class DjuiStretchMarginsJson
{
    [JsonPropertyName("left")]
    public float Left { get; set; }

    [JsonPropertyName("right")]
    public float Right { get; set; }

    [JsonPropertyName("top")]
    public float Top { get; set; }

    [JsonPropertyName("bottom")]
    public float Bottom { get; set; }
}

public class DjuiAspectRatioJson
{
    // 模式：None / WidthControlsHeight / HeightControlsWidth / FitInParent / EnvelopeParent
    [JsonPropertyName("mode")]
    public string? Mode { get; set; }

    // 宽 / 高
    [JsonPropertyName("ratio")]
    public float? Ratio { get; set; }
}

public class Vec2Json
{
    [JsonPropertyName("x")]
    public float X { get; set; }

    [JsonPropertyName("y")]
    public float Y { get; set; }
}

public class DjuiBasicJson
{
    [JsonPropertyName("visible")]
    public bool? Visible { get; set; }

    [JsonPropertyName("disabled")]
    public bool? Disabled { get; set; }

    [JsonPropertyName("isStatic")]
    public bool? IsStatic { get; set; }
}

public class DjuiTransformJson
{
    [JsonPropertyName("positionType")]
    public string? PositionType { get; set; }

    [JsonPropertyName("x")]
    public float? X { get; set; }

    [JsonPropertyName("y")]
    public float? Y { get; set; }

    [JsonPropertyName("width")]
    public float? Width { get; set; }

    [JsonPropertyName("height")]
    public float? Height { get; set; }

    [JsonPropertyName("rotation")]
    public float? Rotation { get; set; }

    [JsonPropertyName("scale")]
    public float[]? Scale { get; set; }

    [JsonPropertyName("opacity")]
    public float? Opacity { get; set; }

    [JsonPropertyName("zIndex")]
    public int? ZIndex { get; set; }

    // ★ 中心点（0~1，屏幕约定 Y 朝下：0=顶 1=底）
    [JsonPropertyName("pivot")]
    public Vec2Json? Pivot { get; set; }
}

public class DjuiAppearanceJson
{
    [JsonPropertyName("image")]
    public string? Image { get; set; }

    [JsonPropertyName("background")]
    public string? Background { get; set; }

    [JsonPropertyName("borderThickness")]
    public float? BorderThickness { get; set; }

    [JsonPropertyName("borderColor")]
    public string? BorderColor { get; set; }

    [JsonPropertyName("cornerRadius")]
    public float? CornerRadius { get; set; }

    [JsonPropertyName("clipContent")]
    public bool? ClipContent { get; set; }

    [JsonPropertyName("desaturated")]
    public bool? Desaturated { get; set; }

    [JsonPropertyName("imageFlipX")]
    public bool? ImageFlipX { get; set; }

    [JsonPropertyName("imageFlipY")]
    public bool? ImageFlipY { get; set; }

    [JsonPropertyName("slicedEdges")]
    public float[]? SlicedEdges { get; set; } // [left, top, right, bottom]
}

public class DjuiLayoutJson
{
    [JsonPropertyName("margin")]
    public float[]? Margin { get; set; }

    [JsonPropertyName("padding")]
    public float[]? Padding { get; set; }

    [JsonPropertyName("autoSize")]
    public string? AutoSize { get; set; }

    [JsonPropertyName("flowOrientation")]
    public string? FlowOrientation { get; set; }

    [JsonPropertyName("spacing")]
    public float? Spacing { get; set; }

    [JsonPropertyName("horizontalAlignment")]
    public string? HorizontalAlignment { get; set; }

    [JsonPropertyName("verticalAlignment")]
    public string? VerticalAlignment { get; set; }

    [JsonPropertyName("horizontalContentAlignment")]
    public string? HorizontalContentAlignment { get; set; }

    [JsonPropertyName("verticalContentAlignment")]
    public string? VerticalContentAlignment { get; set; }
}

public class DjuiInteractionJson
{
    [JsonPropertyName("routedEvents")]
    public string? RoutedEvents { get; set; }

    [JsonPropertyName("allowDrag")]
    public bool? AllowDrag { get; set; }

    [JsonPropertyName("allowDrop")]
    public bool? AllowDrop { get; set; }

    [JsonPropertyName("behaviors")]
    public List<DjuiTouchBehaviorJson>? Behaviors { get; set; }
}

public class DjuiTouchBehaviorJson
{
    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("scaleFactor")]
    public float? ScaleFactor { get; set; }

    [JsonPropertyName("enablePressAnimation")]
    public bool? EnablePressAnimation { get; set; }

    [JsonPropertyName("enableLongPress")]
    public bool? EnableLongPress { get; set; }
}

public class DjuiEffectsJson
{
    [JsonPropertyName("preset")]
    public string? Preset { get; set; }
}

public class DjuiTextJson
{
    [JsonPropertyName("text")]
    public string? Text { get; set; }

    [JsonPropertyName("fontSize")]
    public float? FontSize { get; set; }

    [JsonPropertyName("textColor")]
    public string? TextColor { get; set; }

    [JsonPropertyName("strokeSize")]
    public float? StrokeSize { get; set; }

    [JsonPropertyName("strokeColor")]
    public string? StrokeColor { get; set; }

    [JsonPropertyName("bold")]
    public bool? Bold { get; set; }

    [JsonPropertyName("font")]
    public string? Font { get; set; }

    [JsonPropertyName("textWrap")]
    public bool? TextWrap { get; set; }

    [JsonPropertyName("textOverflow")]
    public string? TextOverflow { get; set; }
}

public class DjuiButtonJson
{
    [JsonPropertyName("imageHover")]
    public string? ImageHover { get; set; }

    [JsonPropertyName("imagePressed")]
    public string? ImagePressed { get; set; }
}

public class DjuiProgressJson
{
    [JsonPropertyName("value")]
    public float? Value { get; set; }

    [JsonPropertyName("progressionMode")]
    public string? ProgressionMode { get; set; }

    [JsonPropertyName("rotation")]
    public float? Rotation { get; set; }
}

public class DjuiExtensionJson
{
    [JsonPropertyName("action")]
    public string? Action { get; set; }

    [JsonPropertyName("clickSoundId")]
    public string? ClickSoundId { get; set; }

    [JsonPropertyName("locked")]
    public bool? Locked { get; set; }
}
