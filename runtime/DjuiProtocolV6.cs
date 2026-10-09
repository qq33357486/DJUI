// DJUI Runtime - protocol v6 isolated models (v5 loader remains unchanged)
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DjuiRuntime;

public static class DjuiProtocolV6
{
    public const int ProtocolVersion = 6;
    public const int SchemaVersion = 1;
}

public sealed class DjuiProjectV6
{
    [JsonPropertyName("protocolVersion")] public int ProtocolVersion { get; set; } = DjuiProtocolV6.ProtocolVersion;
    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; } = DjuiProtocolV6.SchemaVersion;
    [JsonPropertyName("projectId")] public string? ProjectId { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("orientation")] public string Orientation { get; set; } = "portrait";
    [JsonPropertyName("canvas")] public DjuiCanvasConfigV6 Canvas { get; set; } = new();
    [JsonPropertyName("responsive")] public DjuiResponsiveConfigV6 Responsive { get; set; } = new();
    [JsonPropertyName("defaultFont")] public string? DefaultFont { get; set; }

    // 0.8.0 可选字段：关闭页面的保留池配置（缺省＝空名单＋默认容量，老工程零配置即享池化）
    [JsonPropertyName("retainedPages")] public List<string>? RetainedPages { get; set; }
    [JsonPropertyName("poolCapacity")] public int? PoolCapacity { get; set; }
}

public sealed class DjuiCanvasConfigV6
{
    [JsonPropertyName("referenceWidth")] public float ReferenceWidth { get; set; } = 900;
    [JsonPropertyName("referenceHeight")] public float ReferenceHeight { get; set; } = 1600;
    [JsonPropertyName("mode")] public string Mode { get; set; } = "Contain";
}

public sealed class DjuiResponsiveConfigV6
{
    [JsonPropertyName("wideRatio")] public float WideRatio { get; set; } = 1.25f;
}

public sealed class DjuiPageV6
{
    [JsonPropertyName("protocolVersion")] public int ProtocolVersion { get; set; } = DjuiProtocolV6.ProtocolVersion;
    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; } = DjuiProtocolV6.SchemaVersion;
    [JsonPropertyName("pageId")] public string PageId { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "window";
    [JsonPropertyName("localSize")] public DjuiSizeV6? LocalSize { get; set; }
    [JsonPropertyName("window")] public DjuiWindowConfigV6? Window { get; set; }
    [JsonPropertyName("root")] public DjuiNodeV6 Root { get; set; } = new();
    [JsonPropertyName("responsive")] public DjuiPageResponsiveV6? Responsive { get; set; }
}

public sealed class DjuiSizeV6 { [JsonPropertyName("width")] public float Width { get; set; } [JsonPropertyName("height")] public float Height { get; set; } }
public sealed class DjuiWindowConfigV6 { [JsonPropertyName("mode")] public string? Mode { get; set; } [JsonPropertyName("transition")] public DjuiTransitionV6? Transition { get; set; } }
public sealed class DjuiTransitionV6 { [JsonPropertyName("open")] public string? Open { get; set; } [JsonPropertyName("close")] public string? Close { get; set; } }
public sealed class DjuiPageResponsiveV6 { [JsonPropertyName("wide")] public DjuiWideOverridesV6 Wide { get; set; } = new(); }
public sealed class DjuiWideOverridesV6 { [JsonPropertyName("overrides")] public Dictionary<string, Dictionary<string, JsonElement>> Overrides { get; set; } = new(); }

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]
public sealed class DjuiNodeV6
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("starType")] public string StarType { get; set; } = "Panel";
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("basic")] public DjuiBasicV6? Basic { get; set; }
    [JsonPropertyName("transform")] public DjuiTransformV6? Transform { get; set; }
    [JsonPropertyName("anchor")] public DjuiAnchorV6? Anchor { get; set; }
    [JsonPropertyName("stretch")] public DjuiStretchV6? Stretch { get; set; }
    [JsonPropertyName("aspectRatio")] public DjuiAspectRatioV6? AspectRatio { get; set; }
    [JsonPropertyName("sceneFrame")] public DjuiSceneFrameV6? SceneFrame { get; set; }
    [JsonPropertyName("appearance")] public DjuiAppearanceV6? Appearance { get; set; }
    [JsonPropertyName("text")] public DjuiTextV6? Text { get; set; }
    [JsonPropertyName("button")] public DjuiButtonV6? Button { get; set; }
    [JsonPropertyName("progress")] public DjuiProgressV6? Progress { get; set; }
    [JsonPropertyName("layout")] public DjuiLayoutV6? Layout { get; set; }
    [JsonPropertyName("interaction")] public DjuiInteractionV6? Interaction { get; set; }
    [JsonPropertyName("effects")] public DjuiEffectsV6? Effects { get; set; }
    [JsonPropertyName("djui")] public DjuiExtensionsV6? Djui { get; set; }
    [JsonPropertyName("widthStretchRatio")] public float? WidthStretchRatio { get; set; }
    [JsonPropertyName("heightStretchRatio")] public float? HeightStretchRatio { get; set; }
    [JsonPropertyName("widthCompactRatio")] public float? WidthCompactRatio { get; set; }
    [JsonPropertyName("heightCompactRatio")] public float? HeightCompactRatio { get; set; }
    [JsonPropertyName("templateRef")] public string? TemplateRef { get; set; }
    [JsonPropertyName("templateOverrides")] public Dictionary<string, Dictionary<string, JsonElement>>? TemplateOverrides { get; set; }
    [JsonIgnore] public DjuiSizeV6? TemplateLocalSize { get; set; }
    [JsonPropertyName("children")] public List<DjuiNodeV6> Children { get; set; } = new();
}

public sealed class DjuiTransformV6
{
    [JsonPropertyName("x")] public float? X { get; set; }
    [JsonPropertyName("y")] public float? Y { get; set; }
    [JsonPropertyName("width")] public float? Width { get; set; }
    [JsonPropertyName("height")] public float? Height { get; set; }
    [JsonPropertyName("rotation")] public float? Rotation { get; set; }
    [JsonPropertyName("scale")] public float[]? Scale { get; set; }
    [JsonPropertyName("opacity")] public float? Opacity { get; set; }
    [JsonPropertyName("zIndex")] public int? ZIndex { get; set; }
}
public sealed class DjuiAnchorV6
{
    [JsonPropertyName("target")] public string Target { get; set; } = "parent";
    [JsonPropertyName("side")] public string Side { get; set; } = "TopLeft";
    [JsonPropertyName("safeEdges")] public List<string> SafeEdges { get; set; } = new() { "left", "top", "right", "bottom" };
}
public sealed class DjuiStretchV6 { [JsonPropertyName("style")] public string Style { get; set; } = "None"; [JsonPropertyName("margins")] public DjuiInsetsV6? Margins { get; set; } }
public sealed class DjuiAspectRatioV6 { [JsonPropertyName("mode")] public string Mode { get; set; } = "None"; [JsonPropertyName("ratio")] public float Ratio { get; set; } = 1; }
public sealed class DjuiSceneFrameV6 { [JsonPropertyName("backgroundId")] public string BackgroundId { get; set; } = ""; [JsonPropertyName("artboard")] public DjuiSizeV6 Artboard { get; set; } = new(); }

public sealed class DjuiBasicV6
{
    [JsonPropertyName("visible")] public bool? Visible { get; set; }
    [JsonPropertyName("disabled")] public bool? Disabled { get; set; }
    [JsonPropertyName("isStatic")] public bool? IsStatic { get; set; }
}

public sealed class DjuiAppearanceV6
{
    [JsonPropertyName("image")] public string? Image { get; set; }
    [JsonPropertyName("background")] public string? Background { get; set; }
    /// <summary>图片染色（乘算 tint，hex 颜色串）。引擎语义：Background 画刷与 Image 同控件时乘算混合、
    /// 只作用图片像素（透明处保持透明，探针 1003 实测），跨控件不作用——故必须落在 visual 子层上。</summary>
    [JsonPropertyName("imageTint")] public string? ImageTint { get; set; }
    [JsonPropertyName("imageMask")] public string? ImageMask { get; set; }
    [JsonPropertyName("slicedEdges")] public float[]? SlicedEdges { get; set; }
    [JsonPropertyName("imageBlurLevel")] public float? ImageBlurLevel { get; set; }
    [JsonPropertyName("imageFit")] public string ImageFit { get; set; } = "stretch";
    [JsonPropertyName("focalX")] public float? FocalX { get; set; }
    [JsonPropertyName("focalY")] public float? FocalY { get; set; }
    [JsonPropertyName("sourceSize")] public DjuiSizeV6? SourceSize { get; set; }
    [JsonPropertyName("borderThickness")] public float? BorderThickness { get; set; }
    [JsonPropertyName("borderColor")] public string? BorderColor { get; set; }
    [JsonPropertyName("cornerRadius")] public float? CornerRadius { get; set; }
    [JsonPropertyName("clipContent")] public bool? ClipContent { get; set; }
    [JsonPropertyName("desaturated")] public bool? Desaturated { get; set; }
    [JsonPropertyName("imageFlipX")] public bool? ImageFlipX { get; set; }
    [JsonPropertyName("imageFlipY")] public bool? ImageFlipY { get; set; }
}

public sealed class DjuiTextV6
{
    [JsonPropertyName("text")] public string? Text { get; set; }
    [JsonPropertyName("fontSize")] public float? FontSize { get; set; }
    [JsonPropertyName("textColor")] public string? TextColor { get; set; }
    [JsonPropertyName("strokeSize")] public float? StrokeSize { get; set; }
    [JsonPropertyName("strokeColor")] public string? StrokeColor { get; set; }
    [JsonPropertyName("bold")] public bool? Bold { get; set; }
    [JsonPropertyName("font")] public string? Font { get; set; }
    [JsonPropertyName("textWrap")] public bool? TextWrap { get; set; }
    [JsonPropertyName("textOverflow")] public string? TextOverflow { get; set; }
}


public sealed class DjuiInteractionV6
{
    [JsonPropertyName("routedEvents")] public string? RoutedEvents { get; set; }
    [JsonPropertyName("allowDrag")] public bool? AllowDrag { get; set; }
    [JsonPropertyName("allowDrop")] public bool? AllowDrop { get; set; }
    [JsonPropertyName("behaviors")] public List<DjuiTouchBehaviorV6>? Behaviors { get; set; }
}
public sealed class DjuiTouchBehaviorV6
{
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("scaleFactor")] public float? ScaleFactor { get; set; }
    [JsonPropertyName("enablePressAnimation")] public bool? EnablePressAnimation { get; set; }
    [JsonPropertyName("enableLongPress")] public bool? EnableLongPress { get; set; }
}
public sealed class DjuiEffectsV6 { [JsonPropertyName("preset")] public string? Preset { get; set; } }

public sealed class DjuiLayoutV6
{
    [JsonPropertyName("margin")] public float[]? Margin { get; set; }
    [JsonPropertyName("padding")] public float[]? Padding { get; set; }
    [JsonPropertyName("autoSize")] public string? AutoSize { get; set; }
    [JsonPropertyName("flowOrientation")] public string? FlowOrientation { get; set; }
    // 间距二元组 [水平, 垂直]；旧编辑器产出的单值 number 由 DjuiSpacingArrayConverter 兼容读为 [v, v]
    [JsonPropertyName("spacing")]
    [JsonConverter(typeof(DjuiSpacingArrayConverter))]
    public float[]? Spacing { get; set; }
    [JsonPropertyName("horizontalAlignment")] public string? HorizontalAlignment { get; set; }
    [JsonPropertyName("verticalAlignment")] public string? VerticalAlignment { get; set; }
    [JsonPropertyName("horizontalContentAlignment")] public string? HorizontalContentAlignment { get; set; }
    [JsonPropertyName("verticalContentAlignment")] public string? VerticalContentAlignment { get; set; }
    // gridFlow 已废弃（0.30.0 迁移为 flowDirection）：属性保留以兼容旧 JSON（v6 严格反序列化 Disallow，
    // 旧文件含该字段而类中无映射会直接炸）；运行态消费侧已切到 FlowDirection（WindowManager 含旧值兜底映射）
    [JsonPropertyName("gridFlow")] public string? GridFlow { get; set; }
    [JsonPropertyName("flowDirection")] public string? FlowDirection { get; set; }
    [JsonPropertyName("gridCount")] public int? GridCount { get; set; }
    // 起始锚点偏移 [x, y]（锚点定位后叠加，可为负）；畸形长度由消费侧兜 0（与 spacing 双保险同款做法）
    [JsonPropertyName("contentOffset")] public float[]? ContentOffset { get; set; }
    [JsonPropertyName("childOrder")] public string? ChildOrder { get; set; }
    [JsonPropertyName("autoRelayout")] public bool? AutoRelayout { get; set; }
}

/// <summary>
/// layout.spacing 过渡期兼容：v6 页面严格反序列化（UnmappedMemberHandling=Disallow）下，
/// 旧编辑器产出的单值 number 读为 [v, v] 二元组（自 0.29.0 起 10 个版本后删除）。
/// 畸形数组长度兜底：0 → [0,0]、1 → [v,v]、≥2 取前两项——防下游 Spacing[1] 索引越界。
/// Write 只写数组形态（同款长度兜底），保证回写文件恒为新格式。
/// </summary>
public sealed class DjuiSpacingArrayConverter : JsonConverter<float[]?>
{
    public override float[]? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        if (reader.TokenType == JsonTokenType.Number)
        {
            var single = reader.GetSingle();
            return new[] { single, single };
        }
        if (reader.TokenType == JsonTokenType.StartArray)
        {
            var values = new List<float>();
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndArray) break;
                if (reader.TokenType == JsonTokenType.Number) values.Add(reader.GetSingle());
                else reader.Skip();
            }
            if (values.Count == 0) return new[] { 0f, 0f };
            if (values.Count == 1) return new[] { values[0], values[0] };
            return new[] { values[0], values[1] };
        }
        throw new JsonException($"DJUI v6: layout.spacing 非法形态: {reader.TokenType}");
    }

    public override void Write(Utf8JsonWriter writer, float[]? value, JsonSerializerOptions options)
    {
        if (value == null)
        {
            writer.WriteNullValue();
            return;
        }
        writer.WriteStartArray();
        switch (value.Length)
        {
            case 0:
                writer.WriteNumberValue(0f);
                writer.WriteNumberValue(0f);
                break;
            case 1:
                writer.WriteNumberValue(value[0]);
                writer.WriteNumberValue(value[0]);
                break;
            default:
                writer.WriteNumberValue(value[0]);
                writer.WriteNumberValue(value[1]);
                break;
        }
        writer.WriteEndArray();
    }
}

public sealed class DjuiExtensionsV6
{
    [JsonPropertyName("action")] public string? Action { get; set; }
    [JsonPropertyName("clickSoundId")] public string? ClickSoundId { get; set; }
    [JsonPropertyName("bindings")] public Dictionary<string, string>? Bindings { get; set; }
    [JsonPropertyName("locked")] public bool? Locked { get; set; }
}

public sealed class DjuiButtonV6
{
    [JsonPropertyName("imageHover")] public string? ImageHover { get; set; }
    [JsonPropertyName("imagePressed")] public string? ImagePressed { get; set; }
    [JsonPropertyName("imageDisabled")] public string? ImageDisabled { get; set; }
}

public sealed class DjuiProgressV6
{
    [JsonPropertyName("value")] public float? Value { get; set; }
    [JsonPropertyName("progressionMode")] public string? ProgressionMode { get; set; }
    [JsonPropertyName("rotation")] public float? Rotation { get; set; }
}
