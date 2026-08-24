#if CLIENT

using System.Text.Json;
using System.Text.Json.Serialization;
using GameUI.Control;
using GameUI.Control.Extensions;
using GameUI.Device;
using GameUI.Enum;

namespace DjuiRuntime;

/// <summary>DJUI v6 严格项目与窗口实例管理器。</summary>
public static class DjuiWindowManagerV6
{
    private const string RootDir = "user_files/djui";
    private const string ProjectFile = RootDir + "/project.json";
    private const string PagesDir = RootDir + "/pages";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = false, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    private static readonly Dictionary<string, DjuiPageV6> Pages = new();
    private static readonly Dictionary<string, DjuiTreeInstanceV6> Instances = new();
    private static readonly Dictionary<string, List<string>> PageInstances = new();
    private static readonly Dictionary<string, string> SingletonInstances = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, int> ClosingTransitions = new(StringComparer.Ordinal);
    private static DjuiProjectV6? _project;
    private static ulong _nextInstanceId;

    public static void Initialize()
    {
        CloseAll();
        Pages.Clear();
        PageInstances.Clear();
        SingletonInstances.Clear();
        ClosingTransitions.Clear();
        _nextInstanceId = 0;
        DjuiAudioSystem.Initialize();
        if (!File.Exists(ProjectFile)) throw new FileNotFoundException("DJUI v6: 缺少项目配置", ProjectFile);
        _project = DeserializeStrict<DjuiProjectV6>(ProjectFile);
        RequireVersion(_project.ProtocolVersion, _project.SchemaVersion, ProjectFile);
        if (_project.Canvas.ReferenceWidth <= 0 || _project.Canvas.ReferenceHeight <= 0) throw new InvalidDataException("DJUI v6: 项目参考尺寸必须大于 0");
        var mode = _project.Canvas.Mode switch
        {
            "Contain" => ScaleMode.Contain,
            "MatchWidth" => ScaleMode.MatchWidth,
            "MatchHeight" => ScaleMode.MatchHeight,
            _ => throw new InvalidDataException($"DJUI v6: 不支持 Canvas 模式 {_project.Canvas.Mode}"),
        };
        DeviceInfo.PrimaryViewport.SetDesignResolution(_project.Canvas.ReferenceWidth, _project.Canvas.ReferenceHeight, mode);
        if (!Directory.Exists(PagesDir)) throw new DirectoryNotFoundException($"DJUI v6: 页面目录不存在: {PagesDir}");
        foreach (var file in Directory.GetFiles(PagesDir, "*.json"))
        {
            var page = DeserializeStrict<DjuiPageV6>(file);
            RequireVersion(page.ProtocolVersion, page.SchemaVersion, file);
            if (string.IsNullOrWhiteSpace(page.PageId)) throw new InvalidDataException($"DJUI v6: 页面 ID 为空: {file}");
            if (!Pages.TryAdd(page.PageId, page)) throw new InvalidDataException($"DJUI v6: 页面 ID 重复: {page.PageId}");
        }
        Game.Logger.LogInformation("DJUI v6: 已严格加载 {Count} 个页面", Pages.Count);
    }

    /// <summary>兼容业务页面语义：同一 pageId 只打开一个单例窗口。</summary>
    public static Panel OpenWindow(string pageId)
    {
        if (SingletonInstances.TryGetValue(pageId, out var existing) && Instances.TryGetValue(existing, out var open))
        {
            CancelClosing(existing);
            return open.Root;
        }
        var id = OpenInstance(pageId);
        SingletonInstances[pageId] = id;
        return Instances[id].Root;
    }

    /// <summary>显式创建同一页面的独立窗口实例。</summary>
    public static string OpenInstance(string pageId)
    {
        var project = _project ?? throw new InvalidOperationException("DJUI v6: 请先 Initialize");
        if (!Pages.TryGetValue(pageId, out var page)) throw new KeyNotFoundException($"DJUI v6: 页面不存在: {pageId}");
        if (!string.Equals(page.Kind, "window", StringComparison.Ordinal)) throw new InvalidOperationException($"DJUI v6: {pageId} 不是 Window 页面");
        var id = "w" + (++_nextInstanceId).ToString();
        var host = new Panel { Name = $"DJUI.v6.{pageId}.{id}" };
        host.FullScreen();
        host.AddToVisualTree();
        try
        {
            var expandedPage = DjuiTemplateExpanderV6.Expand(page, Pages);
            var instance = DjuiTreeBuilderV6.Build(id, project, expandedPage, host);
            Instances.Add(id, instance);
            if (!PageInstances.TryGetValue(pageId, out var list)) PageInstances[pageId] = list = new List<string>();
            list.Add(id);
            DjuiTransitionPlayer.Play(instance.Root, page.Window?.Transition?.Open);
            return id;
        }
        catch
        {
            host.RemoveFromVisualTreeAndParent();
            host.Dispose();
            throw;
        }
    }

    public static T? GetControl<T>(string windowInstanceId, string nodeInstanceId) where T : Control
    {
        return Instances.TryGetValue(windowInstanceId, out var instance) ? instance.Session.GetControl<T>(nodeInstanceId) : null;
    }

    public static Control? GetControl(string pageId, string nodeInstanceId)
        => GetSingletonControl<Control>(pageId, nodeInstanceId);

    public static T? GetControlByPage<T>(string pageId, string nodeInstanceId) where T : Control
        => GetSingletonControl<T>(pageId, nodeInstanceId);

    public static T? GetSingletonControl<T>(string pageId, string nodeInstanceId) where T : Control
    {
        return SingletonInstances.TryGetValue(pageId, out var id) ? GetControl<T>(id, nodeInstanceId) : null;
    }

    public static bool IsOpen(string pageId)
        => SingletonInstances.TryGetValue(pageId, out var id) && Instances.ContainsKey(id);

    public static Panel? GetOpenWindow(string pageId)
        => SingletonInstances.TryGetValue(pageId, out var id) && Instances.TryGetValue(id, out var instance) ? instance.Root : null;

    public static string? GetSingletonInstanceId(string pageId)
        => IsOpen(pageId) ? SingletonInstances[pageId] : null;

    public static IReadOnlyList<string> GetInstances(string pageId)
    {
        return PageInstances.TryGetValue(pageId, out var ids) ? ids.AsReadOnly() : Array.Empty<string>();
    }

    private static ulong _nextCloneSeq;

    /// <summary>
    /// 复制窗口内一个节点子树，返回一份新构建的控件实例（不挂树、不绑 action/音效/数据绑定——如同 new）。
    /// 克隆体沿用源子树当前解算矩形，初始与源完全重叠；父级/位置/显隐由调用方管理。
    /// 克隆体登记进布局会话但 authored 树不变——relayout（转屏/缩放）不作用于克隆体，需要跟随重排时销毁重建。
    /// 子控件寻址：控件 Name 取自页面 JSON 的 name 字段，用引擎 FindChild(name)/FindChildren(name)。
    /// </summary>
    public static Control CloneControl(string windowInstanceId, string nodeInstanceId)
    {
        var project = _project ?? throw new InvalidOperationException("DJUI v6: 请先 Initialize");
        var instance = Instances.TryGetValue(windowInstanceId, out var tree)
            ? tree
            : throw new KeyNotFoundException($"DJUI v6: 窗口实例不存在: {windowInstanceId}");
        var source = FindNode(instance.Session.CurrentPage.Root, nodeInstanceId)
            ?? throw new KeyNotFoundException($"DJUI v6: 节点不存在: {nodeInstanceId}");
        var solved = DjuiLayoutSolverV6.SolveV6(instance.Session.CurrentPage, instance.Session.CurrentPlan);
        var suffix = "#c" + (++_nextCloneSeq).ToString();
        return DjuiTreeBuilderV6.BuildClone(source, instance.Session, project.DefaultFont, instance.ImageVisuals, instance.ProgressVisuals, instance.ButtonStates, suffix, solved);
    }

    private static DjuiNodeV6? FindNode(DjuiNodeV6 root, string id)
    {
        if (string.Equals(root.Id, id, StringComparison.Ordinal)) return root;
        foreach (var child in root.Children)
        {
            var hit = FindNode(child, id);
            if (hit != null) return hit;
        }
        return null;
    }

    public static void CloseWindow(string pageOrInstanceId)
    {
        var windowInstanceId = SingletonInstances.TryGetValue(pageOrInstanceId, out var singletonId) ? singletonId : pageOrInstanceId;
        if (!Instances.TryGetValue(windowInstanceId, out var instance) || ClosingTransitions.ContainsKey(windowInstanceId)) return;
        var closePreset = instance.Session.CurrentPage.Window?.Transition?.Close;
        var transitionId = DjuiTransitionPlayer.Play(instance.Root, closePreset, () => FinalizeClose(windowInstanceId));
        if (transitionId < 0) FinalizeClose(windowInstanceId);
        else ClosingTransitions[windowInstanceId] = transitionId;
    }

    private static void CancelClosing(string windowInstanceId)
    {
        if (!ClosingTransitions.Remove(windowInstanceId, out var transitionId)) return;
        DjuiTransitionPlayer.Stop(transitionId);
        if (Instances.TryGetValue(windowInstanceId, out var instance)) instance.Session.Relayout();
    }

    private static void FinalizeClose(string windowInstanceId)
    {
        ClosingTransitions.Remove(windowInstanceId);
        if (!Instances.Remove(windowInstanceId, out var instance)) return;
        foreach (var singleton in SingletonInstances.Where(pair => pair.Value == windowInstanceId).ToArray()) SingletonInstances.Remove(singleton.Key);
        foreach (var pair in PageInstances.ToArray())
        {
            if (!pair.Value.Remove(windowInstanceId)) continue;
            if (pair.Value.Count == 0) PageInstances.Remove(pair.Key);
            break;
        }
        DjuiTransitionPlayer.Stop(instance.Root);
        instance.Dispose();
    }

    public static void CloseAll()
    {
        foreach (var id in Instances.Keys.ToArray())
        {
            CancelClosing(id);
            FinalizeClose(id);
        }
    }

    private static T DeserializeStrict<T>(string file) where T : class
    {
        var json = File.ReadAllText(file);
        return JsonSerializer.Deserialize<T>(json, JsonOptions) ?? throw new InvalidDataException($"DJUI v6: JSON 为空: {file}");
    }

    private static void RequireVersion(int protocolVersion, int schemaVersion, string file)
    {
        if (protocolVersion != DjuiProtocolV6.ProtocolVersion || schemaVersion != DjuiProtocolV6.SchemaVersion)
            throw new InvalidDataException($"DJUI v6: 版本不匹配 {file}; 需要 protocolVersion=6, schemaVersion=1");
    }
}

#endif
