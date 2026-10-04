// 仅模拟属性存储与布局通知；实际中心缩放、继承和输入命中另外经 SDK 37 完整 PIE 验证。
using System.Numerics;
namespace GameUI.Enum { public enum UIPositionType { Relative, Absolute } }
namespace GameUI.Struct
{
    public readonly record struct UIPosition(float X, float Y);
    public readonly record struct Thickness(float Left, float Top, float Right, float Bottom);
    public readonly record struct Measure(float Value)
    {
        public bool IsAuto => false;
        public static implicit operator Measure(float value) => new(value);
    }
    public readonly record struct Size(float Width, float Height);
}
namespace GameUI.Control
{
    using GameUI.Struct;
    public class Control
    {
        public bool IsValid { get; set; } = true;
        public Control? Parent { get; set; }
        public List<Control> ChildList { get; } = new();
        public IReadOnlyList<Control> Children => ChildList;
        public Vector2 Scale { get; set; } = Vector2.One;
        public float Rotation { get; set; }
        public float Opacity { get; set; } = 1;
        public bool Visible { get; set; } = true;
        public UIPosition Position { get; set; }
        public Thickness Margin { get; set; }
        public Measure Width { get; set; }
        public Measure Height { get; set; }
        public Size ActualSize => new(Width.Value, Height.Value);
        public GameUI.Enum.UIPositionType PositionType { get; set; } = GameUI.Enum.UIPositionType.Absolute;
    }
    public sealed class Panel : Control { }
}
public interface IThinker { bool DoesThink { get; set; } void Think(int delta); }
public static class Game
{
    public static List<IThinker> Thinkers { get; } = new();
    public static void RegisterThinker(IThinker thinker) => Thinkers.Add(thinker);
    public static Log Logger { get; } = new();
    public sealed class Log { public void LogWarning(string text, object? value) { } }
}
namespace DjuiRuntime
{
    using GameUI.Control;
    public sealed class DjuiTreeInstanceV6
    {
        public Panel Root { get; } = new();
        public DjuiLayoutSessionV6 Session { get; } = new();
    }
    public sealed class DjuiLayoutSessionV6
    {
        public DjuiPageV6 CurrentPage { get; set; } = new() { Window = new() { Mode = "popup" } };
        public Dictionary<string, Control> Controls { get; } = new();
        internal event Action? BeforeRelayout;
        internal event Action? AfterRelayout;
        public int SubscriberCount => (BeforeRelayout?.GetInvocationList().Length ?? 0) + (AfterRelayout?.GetInvocationList().Length ?? 0);
        public T? GetControl<T>(string id) where T : Control => Controls.TryGetValue(id, out var c) ? c as T : null;
        public void Relayout(Action layout)
        {
            BeforeRelayout?.Invoke(); layout(); AfterRelayout?.Invoke();
        }
    }
}
