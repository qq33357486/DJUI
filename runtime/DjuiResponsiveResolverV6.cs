using System.Text.Json;

namespace DjuiRuntime;

/// <summary>Applies the closed v6 wide-tier override allowlist to an isolated page copy.</summary>
public static class DjuiResponsiveResolverV6
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = false };

    public static DjuiPageV6 Resolve(DjuiPageV6 source, bool wide)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!wide || source.Responsive?.Wide?.Overrides.Count is not > 0) return source;
        var json = JsonSerializer.Serialize(source, JsonOptions);
        var page = JsonSerializer.Deserialize<DjuiPageV6>(json, JsonOptions)
            ?? throw new InvalidDataException("DJUI v6: 响应式页面复制失败");
        CopyRuntimeMetadata(source.Root, page.Root);
        var nodes = new Dictionary<string, DjuiNodeV6>(StringComparer.Ordinal);
        Index(page.Root, nodes);
        foreach (var (nodeId, fields) in page.Responsive!.Wide.Overrides)
        {
            if (!nodes.TryGetValue(nodeId, out var node)) throw new InvalidDataException($"DJUI v6: wide 覆盖引用不存在的节点: {nodeId}");
            foreach (var (path, value) in fields) Apply(node, path, value);
        }
        return page;
    }

    private static void Index(DjuiNodeV6 node, Dictionary<string, DjuiNodeV6> nodes)
    {
        if (string.IsNullOrWhiteSpace(node.Id) || !nodes.TryAdd(node.Id, node)) throw new InvalidDataException($"DJUI v6: 页面节点 ID 为空或重复: {node.Id}");
        foreach (var child in node.Children) Index(child, nodes);
    }

    private static void CopyRuntimeMetadata(DjuiNodeV6 source, DjuiNodeV6 target)
    {
        if (!string.Equals(source.Id, target.Id, StringComparison.Ordinal) || source.Children.Count != target.Children.Count)
            throw new InvalidDataException("DJUI v6: responsive clone structure changed");
        target.TemplateLocalSize = source.TemplateLocalSize == null ? null : new DjuiSizeV6 { Width = source.TemplateLocalSize.Width, Height = source.TemplateLocalSize.Height };
        for (var i = 0; i < source.Children.Count; i++) CopyRuntimeMetadata(source.Children[i], target.Children[i]);
    }

    internal static void ApplyOverride(DjuiNodeV6 node, string path, JsonElement value) => Apply(node, path, value);

    private static void Apply(DjuiNodeV6 node, string path, JsonElement value)
    {
        switch (path)
        {
            case "basic.visible": (node.Basic ??= new()).Visible = Bool(value, path); break;
            case "basic.disabled": (node.Basic ??= new()).Disabled = Bool(value, path); break;
            case "transform.x": (node.Transform ??= new()).X = Number(value, path); break;
            case "transform.y": (node.Transform ??= new()).Y = Number(value, path); break;
            case "transform.width": (node.Transform ??= new()).Width = Number(value, path); break;
            case "transform.height": (node.Transform ??= new()).Height = Number(value, path); break;
            case "appearance.image": (node.Appearance ??= new()).Image = NullableString(value, path); break;
            case "appearance.background": (node.Appearance ??= new()).Background = NullableString(value, path); break;
            case "appearance.imageFit": (node.Appearance ??= new()).ImageFit = EnumString(value, path, "stretch", "contain", "cover"); break;
            case "appearance.focalX": (node.Appearance ??= new()).FocalX = Unit(value, path); break;
            case "appearance.focalY": (node.Appearance ??= new()).FocalY = Unit(value, path); break;
            case "appearance.borderThickness": (node.Appearance ??= new()).BorderThickness = Number(value, path); break;
            case "appearance.borderColor": (node.Appearance ??= new()).BorderColor = NullableString(value, path); break;
            case "text.text": (node.Text ??= new()).Text = NullableString(value, path); break;
            case "text.fontSize": (node.Text ??= new()).FontSize = Number(value, path); break;
            case "text.textColor": (node.Text ??= new()).TextColor = NullableString(value, path); break;
            case "text.strokeSize": (node.Text ??= new()).StrokeSize = Number(value, path); break;
            case "text.strokeColor": (node.Text ??= new()).StrokeColor = NullableString(value, path); break;
            case "text.bold": (node.Text ??= new()).Bold = Bool(value, path); break;
            case "text.font": (node.Text ??= new()).Font = NullableString(value, path); break;
            case "text.textWrap": (node.Text ??= new()).TextWrap = Bool(value, path); break;
            case "button.imageHover": (node.Button ??= new()).ImageHover = NullableString(value, path); break;
            case "button.imagePressed": (node.Button ??= new()).ImagePressed = NullableString(value, path); break;
            case "progress.value": (node.Progress ??= new()).Value = Unit(value, path); break;
            default: throw new InvalidDataException($"DJUI v6: 不允许响应式覆盖字段: {path}");
        }
    }

    private static float Number(JsonElement value, string path) => value.ValueKind == JsonValueKind.Number && value.TryGetSingle(out var result) && float.IsFinite(result) ? result : throw Invalid(path);
    private static float Unit(JsonElement value, string path) => Math.Clamp(Number(value, path), 0, 1);
    private static bool Bool(JsonElement value, string path) => value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : throw Invalid(path);
    private static string? NullableString(JsonElement value, string path) => value.ValueKind == JsonValueKind.Null ? null : value.ValueKind == JsonValueKind.String ? value.GetString() : throw Invalid(path);
    private static string EnumString(JsonElement value, string path, params string[] legal)
    {
        var result = NullableString(value, path) ?? throw Invalid(path);
        return legal.Contains(result, StringComparer.Ordinal) ? result : throw Invalid(path);
    }
    private static InvalidDataException Invalid(string path) => new($"DJUI v6: 响应式覆盖值无效: {path}");
}
