// DJUI Runtime - 窗口管理器
// 提供窗口注册、打开、关闭、查找功能

#if CLIENT

using System.IO;
using System.Text.Json;
using GameUI.Control;
using GameUI.Control.Primitive;
using GameUI.Control.Extensions;
using GameCore.Platform.SDL;

namespace DjuiRuntime;

/// <summary>
/// 窗口管理器。负责扫描页面 JSON、注册窗口、打开/关闭窗口。
/// 用法：
///   DjuiWindowManager.Initialize();
///   DjuiWindowManager.OpenWindow("main_menu");
///   var btn = DjuiWindowManager.GetControl("button_start");
/// </summary>
public static class DjuiWindowManager
{
    // 页面 JSON 根目录
    private const string PagesDir = "user_files/djui/pages";
    private const int NormalWindowBaseZIndex = 1000;
    private const int PopupWindowBaseZIndex = 100000;

    // 已加载的页面 JSON 缓存
    private static readonly Dictionary<string, DjuiPageJson> _pageCache = new();

    // 当前打开的窗口（pageId → 根 Panel）
    private static readonly Dictionary<string, Panel> _openWindows = new();
    private static readonly HashSet<string> _closingWindows = new();
    private static int _nextWindowOrder = 0;

    /// <summary>
    /// 初始化：扫描页面目录，加载所有页面 JSON。
    /// 应在 OnGameTriggerInitialization 中调用。
    /// </summary>
    public static void Initialize()
    {
        _pageCache.Clear();
        _closingWindows.Clear();
        _nextWindowOrder = 0;
        DjuiAudioSystem.Initialize();
        if (!Directory.Exists(PagesDir)) return;

        foreach (var file in Directory.GetFiles(PagesDir, "*.json"))
        {
            try
            {
                var json = File.ReadAllText(file);
                var page = JsonSerializer.Deserialize<DjuiPageJson>(json);
                if (page != null && !string.IsNullOrEmpty(page.PageId))
                {
                    _pageCache[page.PageId] = page;
                }
            }
            catch (Exception ex)
            {
                Game.Logger.LogWarning("DJUI: 加载页面 {File} 失败: {Error}", file, ex.Message);
            }
        }

        Game.Logger.LogInformation("DJUI: 已加载 {Count} 个页面", _pageCache.Count);
    }

    /// <summary>
    /// 打开窗口（全屏）。
    /// </summary>
    /// <param name="pageId">页面 ID（JSON 中的 pageId 字段）</param>
    /// <returns>根 Panel，失败返回 null</returns>
    public static Panel? OpenWindow(string pageId)
    {
        if (_openWindows.TryGetValue(pageId, out var existing))
        {
            if (_closingWindows.Remove(pageId))
            {
                DjuiTransitionPlayer.Stop(existing);
                existing.RemoveFromVisualTree();
                _openWindows.Remove(pageId);
            }
            else
            {
                return existing;
            }
        }

        if (!_pageCache.TryGetValue(pageId, out var page))
        {
            Game.Logger.LogWarning("DJUI: 页面 {PageId} 不存在", pageId);
            return null;
        }

        if (!string.Equals(page.NodeKind, "window", StringComparison.OrdinalIgnoreCase))
        {
            Game.Logger.LogWarning("DJUI: {PageId} 不是窗口，请检查页面 nodeKind 配置", pageId);
            return null;
        }

        // 构建控件树
        var loader = new DjuiUiLoader();
        loader.LoadPageJson(Path.Combine(PagesDir, $"{pageId}.json"));
        var root = loader.Build();
        root.FullScreen();
        root.ZIndex = AllocateWindowZIndex(page);
        root.AddToVisualTree();

        _closingWindows.Remove(pageId);
        _openWindows[pageId] = root;
        DjuiTransitionPlayer.Play(root, GetOpenTransition(page));
        Game.Logger.LogInformation("DJUI: 已打开窗口 {PageId}", pageId);
        return root;
    }

    /// <summary>
    /// 从模板实例化控件。返回固定尺寸根控件，不自动添加到可视树。
    /// </summary>
    public static Control? CreateTemplate(string templateId)
    {
        if (!_pageCache.TryGetValue(templateId, out var page))
        {
            Game.Logger.LogWarning("DJUI: 模板 {TemplateId} 不存在", templateId);
            return null;
        }

        if (!string.Equals(page.NodeKind, "template", StringComparison.OrdinalIgnoreCase))
        {
            Game.Logger.LogWarning("DJUI: {TemplateId} 不是模板", templateId);
            return null;
        }

        return DjuiUiLoader.BuildTemplateRoot(page);
    }

    /// <summary>
    /// 关闭窗口。
    /// </summary>
    public static void CloseWindow(string pageId)
    {
        if (!_openWindows.TryGetValue(pageId, out var panel)) return;
        if (_closingWindows.Contains(pageId)) return;

        var page = _pageCache.TryGetValue(pageId, out var cachedPage) ? cachedPage : null;
        var closeTransition = GetCloseTransition(page);
        _closingWindows.Add(pageId);

        var transitionId = DjuiTransitionPlayer.Play(panel, closeTransition, () =>
        {
            if (_openWindows.TryGetValue(pageId, out var currentPanel) && ReferenceEquals(currentPanel, panel))
            {
                panel.RemoveFromVisualTree();
                _openWindows.Remove(pageId);
            }

            _closingWindows.Remove(pageId);
            Game.Logger.LogInformation("DJUI: 已关闭窗口 {PageId}", pageId);
        });

        if (transitionId < 0)
        {
            if (_openWindows.TryGetValue(pageId, out var currentPanel) && ReferenceEquals(currentPanel, panel))
            {
                panel.RemoveFromVisualTree();
                _openWindows.Remove(pageId);
            }

            _closingWindows.Remove(pageId);
            Game.Logger.LogInformation("DJUI: 已关闭窗口 {PageId}", pageId);
        }
    }

    /// <summary>
    /// 关闭所有窗口。
    /// </summary>
    public static void CloseAll()
    {
        foreach (var pageId in _openWindows.Keys.ToList())
        {
            CloseWindow(pageId);
        }
    }

    /// <summary>
    /// 窗口是否已打开。
    /// </summary>
    public static bool IsOpen(string pageId)
    {
        return _openWindows.ContainsKey(pageId);
    }

    public static Panel? GetOpenWindow(string pageId)
    {
        return _openWindows.TryGetValue(pageId, out var panel) ? panel : null;
    }

    /// <summary>
    /// 获取所有已注册的页面 ID。
    /// </summary>
    public static IReadOnlyList<string> GetRegisteredPageIds()
    {
        return _pageCache.Keys.ToList();
    }

    internal static bool TryGetPage(string pageId, out DjuiPageJson page)
    {
        return _pageCache.TryGetValue(pageId, out page!);
    }

    /// <summary>
    /// 从当前打开的窗口中按节点 ID 查找控件。
    /// 若有多个窗口打开，搜索所有窗口。
    /// </summary>
    public static Control? GetControl(string nodeId)
    {
        foreach (var panel in _openWindows.Values)
        {
            var found = FindControlById(panel, nodeId);
            if (found != null) return found;
        }
        return null;
    }

    /// <summary>
    /// 从指定窗口中按节点 ID 查找控件。
    /// </summary>
    public static Control? GetControl(string pageId, string nodeId)
    {
        if (!_openWindows.TryGetValue(pageId, out var panel)) return null;
        return FindControlById(panel, nodeId);
    }

    /// <summary>
    /// 从指定控件按类型查找（如 Button、Label）。
    /// </summary>
    public static T? GetControl<T>(string nodeId) where T : Control
    {
        return GetControl(nodeId) as T;
    }

    // 递归查找子控件（按 DJUI 节点 ID，存储在控件的 Tag 或遍历 Name）
    // DJUI loader 注册了 ID 到 DjuiBindingSystem，这里做 fallback
    private static Control? FindControlById(Control root, string nodeId)
    {
        // 优先从绑定系统查找
        var ctrl = DjuiBindingSystem.GetRegisteredControl(nodeId);
        if (ctrl != null) return ctrl;

        // Fallback：递归遍历子控件
        return SearchChildren(root, nodeId);
    }

    private static Control? SearchChildren(Control ctrl, string nodeId)
    {
        if (ctrl.Name == nodeId) return ctrl;

        if (ctrl.Children != null)
        {
            foreach (var child in ctrl.Children)
            {
                var found = SearchChildren(child, nodeId);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static string GetOpenTransition(DjuiPageJson page)
    {
        if (!string.IsNullOrWhiteSpace(page.Transition?.Open))
            return page.Transition.Open!;

        return IsPopupWindow(page) ? "pop_in" : "fade_in";
    }

    private static string GetCloseTransition(DjuiPageJson? page)
    {
        if (!string.IsNullOrWhiteSpace(page?.Transition?.Close))
            return page.Transition.Close!;

        return page != null && IsPopupWindow(page) ? "pop_out" : "fade_out";
    }

    private static bool IsPopupWindow(DjuiPageJson page)
    {
        return string.Equals(page.WindowMode, "popup", StringComparison.OrdinalIgnoreCase);
    }

    private static int AllocateWindowZIndex(DjuiPageJson page)
    {
        var baseZIndex = IsPopupWindow(page) ? PopupWindowBaseZIndex : NormalWindowBaseZIndex;
        return baseZIndex + ++_nextWindowOrder;
    }
}

#endif
