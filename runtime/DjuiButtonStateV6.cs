// DJUI Runtime - protocol v6 button visual state machine
#if CLIENT

using System.Runtime.CompilerServices;
using GameUI.Control;
using GameUI.Control.Primitive;

namespace DjuiRuntime;

/// <summary>
/// Button 四态视觉（normal/hover/pressed/disabled）的 Runtime 状态机。
/// StarEngine 的 Button 只暴露 ImageHover/ImagePressed 且没有 ImageDisabled；
/// 而 v6 的图片绘制在 visual 子 Panel 上（宿主 Image 被清空），引擎状态换图实际不可用。
/// 因此这里监听宿主指针事件，在 visual 层自管换图，禁用态未配置图片时自动灰化兜底。
/// </summary>
public sealed class DjuiButtonStateV6 : IDisposable
{
    /// <summary>Button 内建文本子节点名，与 DjuiTreeBuilderV6 创建的 label 共用。</summary>
    internal const string ButtonLabelName = "__djui.v6.visual.button-label";

    /// <summary>禁用兜底（未配置禁用图）时的整体透明度系数。视觉强度待实测后可调整。</summary>
    public const float DisabledFallbackOpacity = 0.5f;

    private readonly Control _button;
    private readonly DjuiImageVisualLayerV6 _imageVisuals;
    private DjuiButtonV6? _config;
    private string? _normalImage;
    private float _authoredOpacity;
    private bool _authoredDesaturated;
    private bool _hover;
    private bool _pressed;
    /// <summary>当前视觉已呈现的禁用状态；null 表示需要强制重写一次（如宽屏重放后）。</summary>
    private bool? _visualDisabled;

    internal DjuiButtonStateV6(Control button, DjuiImageVisualLayerV6 imageVisuals, DjuiButtonV6? config, string? normalImage, float authoredOpacity, bool authoredDesaturated)
    {
        _button = button;
        _imageVisuals = imageVisuals;
        _config = config;
        _normalImage = normalImage;
        _authoredOpacity = authoredOpacity;
        _authoredDesaturated = authoredDesaturated;
    }

    /// <summary>宿主/宽屏重放后更新配置并重算视觉。</summary>
    internal void Update(DjuiButtonV6? config, string? normalImage, float authoredOpacity, bool authoredDesaturated)
    {
        _config = config;
        _normalImage = normalImage;
        _authoredOpacity = authoredOpacity;
        _authoredDesaturated = authoredDesaturated;
        _visualDisabled = null;
        Apply();
    }

    /// <summary>按当前指针/禁用状态重算 visual 图片、灰度与整体透明度。</summary>
    internal void Apply()
    {
        if (!_button.IsValid) return;
        var disabled = _button.IsActuallyDisabled;
        var visual = _imageVisuals.GetVisual(_button);

        string? image;
        var desaturated = _authoredDesaturated;
        // Opacity 只在禁用态切换时写入，避免与 TouchBehavior 的按压缩放/透明动画互相覆盖。
        var writeOpacity = _visualDisabled != disabled;

        if (disabled)
        {
            var disabledImage = _config?.ImageDisabled;
            if (!string.IsNullOrEmpty(disabledImage))
            {
                image = disabledImage;
            }
            else
            {
                // 灰化兜底：无禁用图时保持 normal 图，套灰度并整体降透明。
                // Opacity 依赖引擎的合成级联，visual 子图与文本 label 会一并变淡。
                image = _normalImage;
                desaturated = true;
                if (writeOpacity) _button.Opacity = _authoredOpacity * DisabledFallbackOpacity;
            }
        }
        else
        {
            image = ResolveInteractiveImage();
            if (writeOpacity) _button.Opacity = _authoredOpacity;
        }
        _visualDisabled = disabled;

        if (visual != null)
        {
            visual.Image = image ?? "";
            visual.Desaturated = desaturated;
        }
    }

    private string? ResolveInteractiveImage()
    {
        if (_pressed && !string.IsNullOrEmpty(_config?.ImagePressed)) return _config!.ImagePressed;
        if (_hover && !string.IsNullOrEmpty(_config?.ImageHover)) return _config!.ImageHover;
        return _normalImage;
    }

    public void Dispose()
    {
        _button.OnPointerEntered -= HandlePointerEntered;
        _button.OnPointerExited -= HandlePointerExited;
        _button.OnPointerPressed -= HandlePointerPressed;
        _button.OnPointerReleased -= HandlePointerReleased;
    }

    internal void HandlePointerEntered(object? sender, EventArgs e) { _hover = true; Apply(); }
    internal void HandlePointerExited(object? sender, EventArgs e) { _hover = false; Apply(); }
    internal void HandlePointerPressed(object? sender, PointerEventArgs e) { _pressed = true; Apply(); }
    internal void HandlePointerReleased(object? sender, PointerEventArgs e) { _pressed = false; Apply(); }
}

/// <summary>
/// 每棵 v6 树持有的按钮状态机注册表；另以弱表暴露全局刷新通道给绑定系统使用。
/// </summary>
internal sealed class DjuiButtonStateRegistryV6 : IDisposable
{
    private static readonly ConditionalWeakTable<Control, DjuiButtonStateV6> States = new();

    private readonly DjuiImageVisualLayerV6 _imageVisuals;
    private readonly Dictionary<Control, DjuiButtonStateV6> _states = new();

    public DjuiButtonStateRegistryV6(DjuiImageVisualLayerV6 imageVisuals) => _imageVisuals = imageVisuals;

    /// <summary>为 Button 宿主创建（或更新）状态机。无 button 配置的按钮也会创建——禁用灰化兜底不依赖状态图。</summary>
    internal void Attach(Control button, DjuiButtonV6? config, string? normalImage, float authoredOpacity, bool authoredDesaturated)
    {
        if (_states.TryGetValue(button, out var existing))
        {
            existing.Update(config, normalImage, authoredOpacity, authoredDesaturated);
            return;
        }
        var state = new DjuiButtonStateV6(button, _imageVisuals, config, normalImage, authoredOpacity, authoredDesaturated);
        _states[button] = state;
        States.AddOrUpdate(button, state);
        button.OnPointerEntered += state.HandlePointerEntered;
        button.OnPointerExited += state.HandlePointerExited;
        button.OnPointerPressed += state.HandlePointerPressed;
        button.OnPointerReleased += state.HandlePointerReleased;
        state.Apply();
    }

    /// <summary>绑定系统/帮助 API 通道：按控件刷新禁用视觉（非 DJUI 管理的按钮是 no-op）。</summary>
    internal static void RefreshVisual(Control control)
    {
        if (States.TryGetValue(control, out var state)) state.Apply();
    }

    public void Dispose()
    {
        foreach (var state in _states.Values) state.Dispose();
        _states.Clear();
    }
}

/// <summary>游戏侧动态禁用入口：同步引擎交互属性并刷新 DJUI 禁用视觉。</summary>
public static class DjuiButtonState
{
    /// <summary>
    /// 运行时切换控件禁用状态。直接给引擎控件赋 Disabled 不会刷新 DJUI 禁用视觉
    /// （引擎没有 Disabled 变更通知），需要动态切换时请一律走本方法或 disabled 绑定。
    /// </summary>
    public static void SetDisabled(Control control, bool disabled)
    {
        control.Disabled = disabled;
        DjuiButtonStateRegistryV6.RefreshVisual(control);
    }
}

#endif
