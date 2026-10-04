// 仅模拟引擎公开控件与帧调度契约；被测建树、克隆、布局、图片与按钮逻辑均链接生产源码。
global using System.Drawing;
global using GameUI.Struct;

public interface IThinker { bool DoesThink { get; set; } void Think(int delta); }
public static class Game
{
    public static TestLogger Logger { get; } = new();
    private static readonly List<IThinker> Thinkers = [];
    public static void RegisterThinker(IThinker thinker) => Thinkers.Add(thinker);
    public static void UnregisterThinker(IThinker thinker) => Thinkers.Remove(thinker);
    public static void Tick() { foreach (var t in Thinkers.ToArray()) if (t.DoesThink) t.Think(16); }
}
public sealed class TestLogger
{
    public void LogWarning(string message, params object?[] values) { }
    public void LogInformation(string message, params object?[] values) { }
}
namespace GameUI.Enum
{
    public enum UIPositionType { Absolute }
    public enum HorizontalAlignment { Left }
    public enum VerticalAlignment { Top }
    public enum HorizontalContentAlignment { Left, Center }
    public enum VerticalContentAlignment { Top, Center }
    public enum RoutedEvents { None }
    public enum TextTrimming { None }
    public enum ProgressionMode { LeftToRight, RightToLeft, TopToBottom, BottomToTop, Clockwise, CounterClockwise }
    public enum DisplayOrientations { Portrait, Landscape }
    public enum ScaleMode { Contain, MatchWidth, MatchHeight }
}
namespace GameUI.Struct
{
    public record struct UIPosition(float X, float Y);
    public record struct Thickness(float Left, float Top, float Right, float Bottom);
}
namespace GameUI.Control.Primitive { public sealed class PointerEventArgs : EventArgs { } }
namespace GameUI.Control.Behavior { public sealed class StubBehavior { } }
namespace GameUI.Control
{
    using GameUI.Enum;
    using GameUI.Control.Primitive;
    public abstract class Control : IDisposable
    {
        private Control? _parent;
        public Control? Parent
        {
            get => _parent;
            set { _parent?.Children.Remove(this); _parent = value; value?.Children.Add(this); }
        }
        public List<Control> Children { get; } = [];
        // Setter 故意没有尺寸事件，测试覆盖未挂树/隐藏控件也可同步的公共尺寸契约。
        public float Width { get; set; } = 100;
        public float Height { get; set; } = 100;
        public int RectWrites { get; private set; }
        private UIPosition _position;
        public UIPosition Position { get => _position; set { _position = value; RectWrites++; } }
        public bool IsValid { get; private set; } = true;
        public bool IsStatic { get; set; }
        public bool Visible { get; set; } = true;
        public bool Disabled { get; set; }
        public bool IsActuallyDisabled => Disabled || (Parent?.IsActuallyDisabled ?? false);
        public string Name { get; set; } = "";
        public string Image { get; set; } = "";
        public bool ClipContent { get; set; }
        public bool Desaturated { get; set; }
        public bool ImageFlipX { get; set; }
        public bool ImageFlipY { get; set; }
        public Color? Background { get; set; }
        public Color BorderColor { get; set; }
        public float BorderThickness { get; set; }
        public Thickness SlicedEdges { get; set; }
        public Thickness Padding { get; set; }
        public float CornerRadius { get; set; }
        public float Rotation { get; set; }
        public float Opacity { get; set; } = 1;
        public int ZIndex { get; set; }
        public UIPositionType PositionType { get; set; }
        public HorizontalAlignment HorizontalAlignment { get; set; }
        public VerticalAlignment VerticalAlignment { get; set; }
        public HorizontalContentAlignment HorizontalContentAlignment { get; set; }
        public VerticalContentAlignment VerticalContentAlignment { get; set; }
        public RoutedEvents RoutedEvents { get; set; }
        public bool AllowDrag { get; set; }
        public bool AllowDrop { get; set; }
        public event EventHandler? OnPointerEntered;
        public event EventHandler? OnPointerExited;
        public event EventHandler<PointerEventArgs>? OnPointerPressed;
        public event EventHandler<PointerEventArgs>? OnPointerReleased;
        public event EventHandler<PointerEventArgs>? OnPointerClicked;
        public void Click() => OnPointerClicked?.Invoke(this, new());
        public void Hover() => OnPointerEntered?.Invoke(this, EventArgs.Empty);
        public void Exit() => OnPointerExited?.Invoke(this, EventArgs.Empty);
        public void Press() => OnPointerPressed?.Invoke(this, new());
        public void Release() => OnPointerReleased?.Invoke(this, new());
        public void ClearBehaviors() { }
        public void RemoveFromVisualTreeAndParent() => Parent = null;
        public void Dispose() { if (!IsValid) return; foreach (var c in Children.ToArray()) c.Dispose(); Parent = null; IsValid = false; }
    }
    public class Panel : Control { }
    public sealed class PanelScrollable : Panel { }
    public sealed class Button : Control { public string ImageHover { get; set; } = ""; public string ImagePressed { get; set; } = ""; }
    public class Input : Control
    {
        public string Text { get; set; } = "";
        public string Font { get; set; } = "";
        public float FontSize { get; set; }
        public Color TextColor { get; set; }
        public bool Bold { get; set; }
    }
    public sealed class Label : Input
    {
        public float StrokeSize { get; set; }
        public Color StrokeColor { get; set; }
        public bool TextWrap { get; set; }
        public TextTrimming TextTrimming { get; set; }
    }
    public sealed class Progress : Control { public float Value { get; set; } public float ProgressRotation { get; set; } public ProgressionMode ProgressionMode { get; set; } }
}
namespace GameUI.Control.Extensions
{
    public static class StubExtensions
    {
        public static void FullScreen(this Control control) { control.Width = 900; control.Height = 1600; }
        public static void FillParent(this Control control) { control.Width = control.Parent?.Width ?? 0; control.Height = control.Parent?.Height ?? 0; }
        public static void AddTouchBehavior(this Control control, float scale, bool animation, bool longPress) { }
        public static void RemoveFromVisualTreeAndParent(this Control control) => control.Parent = null;
        public static void AddToVisualTree(this Control control) { }
    }
}
namespace GameUI.Extensions
{
    public static class ColorExtensions
    {
        public static Color FromHex(string value) => Color.FromArgb(255, Convert.ToInt32(value[1..3], 16), Convert.ToInt32(value[3..5], 16), Convert.ToInt32(value[5..7], 16));
        public static Color FromRgbaHex(string value) => Color.FromArgb(Convert.ToInt32(value[7..9], 16), FromHex(value));
    }
}
namespace GameUI.Device
{
    using GameUI.Enum;
    public static class DeviceInfo { public static ScreenViewport PrimaryViewport { get; } = new(); }
    public sealed class ScreenViewport
    {
        public SizeF Size { get; private set; } = new(900, 1600);
        public int WidthPx => (int)Size.Width;
        public int HeightPx => (int)Size.Height;
        public Thickness SafeZonePadding => new(0, 0, 0, 0);
        public event Action<int, int>? OnSizeChanged;
        public event Action<DisplayOrientations>? OnOrientationChanged;
        public event Action<float>? OnDevicePixelRatioChanged;
        public void SetDesignResolution(float w, float h, ScaleMode mode) => Size = new(w, h);
        public void Notify() { OnSizeChanged?.Invoke(WidthPx, HeightPx); OnOrientationChanged?.Invoke(DisplayOrientations.Portrait); OnDevicePixelRatioChanged?.Invoke(1); }
    }
}
namespace DjuiRuntime
{
    using GameUI.Control;
    public static class DjuiActionRouter { public static void BindAction(Control c, string? action) { } }
    public static class DjuiAudioSystem { public static void Initialize() { } public static void BindClickSound(Control c, string? sound) { } }
    public static class DjuiEffectPlayer { public static void Stop(Control c) { } }
    public static class DjuiEffectPresets { public static void Apply(string preset, Control c) { } }
    public static class DjuiBindingSystem
    {
        public static IDisposable RegisterBinding(Control c, string property, string key, string nodeId, DjuiLayoutSessionV6 session) => new Empty();
        private sealed class Empty : IDisposable { public void Dispose() { } }
    }
    public static class DjuiTransitionPlayer
    {
        public static int PlayWindow(DjuiTreeInstanceV6 tree, string? preset, Action? done = null) => -1;
        public static int Play(Control c, string? preset, Action? done = null) => -1;
        public static void Stop(Control c) { }
        public static void Stop(int id) { }
    }
}
