#if CLIENT

using GameUI.Control;

namespace DjuiRuntime;

public sealed class DjuiTransitionPlayer : IThinker
{
    private static readonly List<TransitionAnimation> Animations = new();
    private static DjuiTransitionPlayer? _instance;
    private static int _nextId;

    public bool DoesThink { get; set; } = true;

    public static int Play(Control control, string? presetName, Action? onComplete = null)
        => PlayCore(control, presetName, onComplete, null);

    /// <summary>v6 窗口统一入口；只有 popup 的内置几何转场自动固定全屏层。</summary>
    public static int PlayWindow(DjuiTreeInstanceV6 instance, string? presetName, Action? onComplete = null)
        => PlayCore(instance.Root, presetName, onComplete, instance);

    private static int PlayCore(Control control, string? presetName, Action? onComplete, DjuiTreeInstanceV6? instance)
    {
        if (control == null || !control.IsValid)
            return -1;

        if (string.IsNullOrWhiteSpace(presetName) || string.Equals(presetName, "none", StringComparison.OrdinalIgnoreCase))
            return -1;

        if (!DjuiTransitionRegistry.TryGet(presetName, out var preset))
        {
            Game.Logger.LogWarning("DJUI: 未知窗口转场预设 {Name}", presetName);
            return -1;
        }

        Stop(control);

        var id = ++_nextId;
        var snapshot = DjuiWindowTransitionV6.Snapshot(control);
        var windowTarget = instance != null && instance.Session.CurrentPage.Window?.Mode == "popup" && preset.CoordinateWindowContent
            ? new DjuiWindowTransitionV6(instance, preset) : null;
        var animation = new TransitionAnimation(id, control, preset, snapshot, onComplete, windowTarget);
        Animations.Add(animation);
        animation.Apply(0f);
        EnsureRegistered();
        return id;
    }

    public static void Stop(int id)
    {
        for (var i = Animations.Count - 1; i >= 0; i--)
        {
            if (Animations[i].Id == id)
            {
                Animations[i].Restore();
                Animations.RemoveAt(i);
            }
        }
    }

    public static void Stop(Control control)
    {
        for (var i = Animations.Count - 1; i >= 0; i--)
        {
            if (ReferenceEquals(Animations[i].Control, control))
            {
                Animations[i].Restore();
                Animations.RemoveAt(i);
            }
        }
    }

    private static void EnsureRegistered()
    {
        if (_instance != null) return;
        _instance = new DjuiTransitionPlayer();
        Game.RegisterThinker(_instance);
    }

    public void Think(int delta)
    {
        var dt = delta / 1000f;
        // 完成回调可开/关其他窗口；遍历本帧快照避免回调修改列表后越界或重放。
        var frameAnimations = Animations.ToArray();
        for (var i = frameAnimations.Length - 1; i >= 0; i--)
        {
            var animation = frameAnimations[i];
            if (!Animations.Contains(animation)) continue;
            if (!animation.Control.IsValid)
            {
                Animations.Remove(animation);
                animation.Restore();
                continue;
            }

            animation.Elapsed += dt;
            var progress = Math.Clamp(animation.Elapsed / animation.Preset.Duration, 0f, 1f);
            animation.Apply(progress);

            if (progress >= 1f)
            {
                Animations.Remove(animation);
                animation.Restore();   // 终帧归一：恢复转场前快照——close 转场终态（opacity=0 等）不能残留，窗口保留池复用时 open 转场会以当前值为快照初始
                animation.OnComplete?.Invoke();
            }
        }
    }

    private sealed class TransitionAnimation
    {
        public TransitionAnimation(
            int id,
            Control control,
            DjuiTransitionPreset preset,
            DjuiTransitionSnapshot snapshot,
            Action? onComplete,
            DjuiWindowTransitionV6? windowTarget)
        {
            Id = id;
            Control = control;
            Preset = preset;
            Snapshot = snapshot;
            OnComplete = onComplete;
            WindowTarget = windowTarget;
        }

        public int Id { get; }
        public Control Control { get; }
        public DjuiTransitionPreset Preset { get; }
        public DjuiTransitionSnapshot Snapshot { get; }
        public Action? OnComplete { get; }
        public float Elapsed { get; set; }
        private DjuiWindowTransitionV6? WindowTarget { get; }

        public void Apply(float progress)
        {
            if (WindowTarget != null) WindowTarget.Apply(progress);
            else Preset.Apply(Control, progress, Snapshot);
        }

        /// <summary>恢复转场前快照（转场完成/取消时归一控件状态，防止中途值或终态残留）。</summary>
        public void Restore()
        {
            if (WindowTarget != null) { WindowTarget.Dispose(); return; }
            if (!Control.IsValid) return;
            Control.Scale = Snapshot.Scale;
            Control.Opacity = Snapshot.Opacity;
            Control.Margin = Snapshot.Margin;
            Control.Position = Snapshot.Position;
        }
    }
}

#endif
