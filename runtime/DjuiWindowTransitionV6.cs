#if CLIENT
using System.Numerics;
using GameUI.Control;
using GameUI.Struct;

namespace DjuiRuntime;

/// <summary>
/// popup 转场的共享几何空间。根只淡入淡出；铺满 screen/parent 的根层不变形。
/// 其余直接子树按同一个根中心做仿射变换，而非各自在原位置缩放。
/// 不改父子关系、树序、ID、显隐或子层透明度，克隆子树自然继承其父变换。
/// </summary>
internal sealed class DjuiWindowTransitionV6 : IDisposable
{
    private readonly DjuiTreeInstanceV6 _instance;
    private readonly DjuiTransitionPreset _preset;
    private readonly Dictionary<Control, Geometry> _content = new();
    private DjuiTransitionSnapshot _root;
    private float _progress;

    internal DjuiWindowTransitionV6(DjuiTreeInstanceV6 instance, DjuiTransitionPreset preset)
    {
        _instance = instance;
        _preset = preset;
        _root = Snapshot(instance.Root);
        instance.Session.BeforeRelayout += BeforeRelayout;
        instance.Session.AfterRelayout += AfterRelayout;
    }

    internal static DjuiTransitionSnapshot Snapshot(Control control)
        => new(control.Scale, control.Opacity, control.Margin) { Position = control.Position };

    internal static bool IsFixedLayer(DjuiNodeV6 node)
    {
        var target = node.Anchor?.Target ?? "parent";
        if (target != "screen" && target != "parent") return false;
        if (node.Stretch?.Style != "Both") return false;
        // 宽高比会改写拉伸结果，这类节点并没有声明铺满根容器。
        if (node.AspectRatio?.Mode is string mode && mode != "None") return false;
        var m = node.Stretch.Margins;
        return (m?.Left ?? 0) == 0 && (m?.Top ?? 0) == 0 && (m?.Right ?? 0) == 0 && (m?.Bottom ?? 0) == 0;
    }

    internal void Apply(float progress)
    {
        _progress = progress;
        var root = _instance.Root;
        var fixedControls = new HashSet<Control>();
        foreach (var node in _instance.Session.CurrentPage.Root.Children)
            if (IsFixedLayer(node) && _instance.Session.GetControl<Control>(node.Id) is { } fixedControl)
                fixedControls.Add(fixedControl);

        // 保留新增的根层克隆/业务子树，且从不接管它们的 Visible/Opacity。
        foreach (var child in root.Children ?? Array.Empty<Control>())
        {
            if (!child.IsValid || fixedControls.Contains(child)) continue;
            if (!_content.ContainsKey(child)) _content.Add(child, new Geometry(child));
        }
        _preset.Apply(root, progress, _root);
        var factor = new Vector2(
            _root.Scale.X == 0 ? 1 : root.Scale.X / _root.Scale.X,
            _root.Scale.Y == 0 ? 1 : root.Scale.Y / _root.Scale.Y);
        var offset = new Vector2(root.Position.X - _root.Position.X, root.Position.Y - _root.Position.Y);
        RestoreRootGeometry();
        var pivot = new Vector2(root.Width.Value, root.Height.Value) * 0.5f;
        foreach (var (control, geometry) in _content)
        {
            if (!control.IsValid || !ReferenceEquals(control.Parent, root)) continue;
            geometry.Apply(control, pivot, factor, offset);
        }
    }

    private void RestoreRootGeometry()
    {
        if (!_instance.Root.IsValid) return;
        _instance.Root.Scale = _root.Scale;
        _instance.Root.Margin = _root.Margin;
        _instance.Root.Position = _root.Position;
    }

    private void BeforeRelayout()
    {
        Restore();
        _content.Clear();
    }

    private void AfterRelayout()
    {
        _root = Snapshot(_instance.Root);
        Apply(_progress);
    }

    internal void Restore()
    {
        RestoreRootGeometry();
        if (_instance.Root.IsValid) _instance.Root.Opacity = _root.Opacity;
        foreach (var (control, geometry) in _content)
            if (control.IsValid) geometry.Restore(control);
    }

    public void Dispose()
    {
        _instance.Session.BeforeRelayout -= BeforeRelayout;
        _instance.Session.AfterRelayout -= AfterRelayout;
        Restore();
    }

    private sealed class Geometry
    {
        private Vector2 _scale;
        private UIPosition _position;
        private Vector2 _lastScale;
        private UIPosition _lastPosition;

        internal Geometry(Control control)
        {
            _lastScale = _scale = control.Scale;
            _lastPosition = _position = control.Position;
        }

        // 业务在转场期间主动改动几何时，不用旧快照覆盖新值。
        private void CaptureChanges(Control control)
        {
            if (control.Scale != _lastScale) _scale = control.Scale;
            if (control.Position != _lastPosition) _position = control.Position;
        }

        internal void Apply(Control control, Vector2 pivot, Vector2 factor, Vector2 offset)
        {
            CaptureChanges(control);
            var halfSize = new Vector2(control.Width.IsAuto ? control.ActualSize.Width : control.Width.Value,
                control.Height.IsAuto ? control.ActualSize.Height : control.Height.Value) * 0.5f;
            var center = new Vector2(_position.X, _position.Y) + halfSize;
            var translated = pivot + (center - pivot) * factor + offset - halfSize;
            control.Scale = _lastScale = _scale * factor;
            control.Position = _lastPosition = new UIPosition(translated.X, translated.Y);
        }

        internal void Restore(Control control)
        {
            CaptureChanges(control);
            control.Scale = _scale;
            control.Position = _position;
        }
    }
}
#endif
