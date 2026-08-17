using System.Text.Json;

namespace DjuiRuntime;

/// <summary>Expands v6 template instances into one scoped authored tree.</summary>
public static class DjuiTemplateExpanderV6
{
    public const int MaxTemplateDepth = 32;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = false };

    public static DjuiPageV6 Expand(DjuiPageV6 window, IReadOnlyDictionary<string, DjuiPageV6> pages)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(pages);
        var result = Clone(window);
        var pageStack = new List<string> { window.PageId };
        ExpandChildren(result.Root, "", pages, pageStack, 0);
        return result;
    }

    private static void ExpandChildren(DjuiNodeV6 parent, string scope, IReadOnlyDictionary<string, DjuiPageV6> pages, List<string> pageStack, int depth)
    {
        for (var i = 0; i < parent.Children.Count; i++)
        {
            var node = parent.Children[i];
            node.Id = Scoped(scope, node.Id);
            if (!IsTemplateInstance(node))
            {
                ExpandChildren(node, scope, pages, pageStack, depth);
                continue;
            }

            if (!string.Equals(node.StarType, "TemplateInstance", StringComparison.Ordinal))
                throw new InvalidDataException($"DJUI v6: node '{node.Id}' with templateRef must use starType TemplateInstance");
            if (node.Children.Count != 0) throw new InvalidDataException($"DJUI v6: template instance '{node.Id}' cannot author children");
            if (string.IsNullOrWhiteSpace(node.TemplateRef)) throw new InvalidDataException($"DJUI v6: template instance '{node.Id}' has no templateRef");
            if (depth >= MaxTemplateDepth) throw new InvalidDataException($"DJUI v6: template nesting exceeds {MaxTemplateDepth} at '{node.Id}'");
            if (!pages.TryGetValue(node.TemplateRef, out var template)) throw new InvalidDataException($"DJUI v6: template not found: {node.TemplateRef}");
            if (!string.Equals(template.Kind, "template", StringComparison.Ordinal)) throw new InvalidDataException($"DJUI v6: page '{node.TemplateRef}' is not a template");
            if (template.LocalSize == null || template.LocalSize.Width <= 0 || template.LocalSize.Height <= 0) throw new InvalidDataException($"DJUI v6: template '{template.PageId}' has invalid localSize");
            if (pageStack.Contains(template.PageId, StringComparer.Ordinal)) throw new InvalidDataException($"DJUI v6: template cycle: {string.Join(" -> ", pageStack)} -> {template.PageId}");

            var children = template.Root.Children.Select(child => Clone(child)).ToList();
            ApplyOverrides(children, node.TemplateOverrides, node.Id);
            node.StarType = "Panel";
            node.TemplateLocalSize = new DjuiSizeV6 { Width = template.LocalSize.Width, Height = template.LocalSize.Height };
            node.Children = children;
            pageStack.Add(template.PageId);
            try { ExpandChildren(node, node.Id, pages, pageStack, depth + 1); }
            finally { pageStack.RemoveAt(pageStack.Count - 1); }
        }
    }

    private static void ApplyOverrides(List<DjuiNodeV6> roots, Dictionary<string, Dictionary<string, JsonElement>>? overrides, string instanceId)
    {
        if (overrides == null || overrides.Count == 0) return;
        var names = new Dictionary<string, DjuiNodeV6>(StringComparer.Ordinal);
        var duplicates = new HashSet<string>(StringComparer.Ordinal);
        foreach (var root in roots) IndexNames(root, names, duplicates);
        foreach (var (name, fields) in overrides)
        {
            if (duplicates.Contains(name)) throw new InvalidDataException($"DJUI v6: template instance '{instanceId}' override name is duplicate: {name}");
            if (!names.TryGetValue(name, out var node)) throw new InvalidDataException($"DJUI v6: template instance '{instanceId}' override name not found: {name}");
            foreach (var (path, value) in fields) DjuiResponsiveResolverV6.ApplyOverride(node, path, value);
        }
    }

    private static void IndexNames(DjuiNodeV6 node, Dictionary<string, DjuiNodeV6> names, HashSet<string> duplicates)
    {
        if (!string.IsNullOrWhiteSpace(node.Name) && !names.TryAdd(node.Name, node)) duplicates.Add(node.Name);
        foreach (var child in node.Children) IndexNames(child, names, duplicates);
    }

    private static bool IsTemplateInstance(DjuiNodeV6 node) => string.Equals(node.StarType, "TemplateInstance", StringComparison.Ordinal) || !string.IsNullOrWhiteSpace(node.TemplateRef);
    private static string Scoped(string scope, string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidDataException("DJUI v6: every node must have a non-empty ID");
        if (id.Contains('/')) throw new InvalidDataException($"DJUI v6: authored node ID cannot contain '/': {id}");
        return string.IsNullOrEmpty(scope) ? id : scope + "/" + id;
    }
    private static T Clone<T>(T source) where T : class => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(source, JsonOptions), JsonOptions) ?? throw new InvalidDataException("DJUI v6: template clone failed");
}
