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
        var snapshot = new DjuiTransitionSnapshot(control.Scale, control.Opacity, control.Margin);
        var animation = new TransitionAnimation(id, control, preset, snapshot, onComplete);
        Animations.Add(animation);
        preset.Apply(control, 0f, snapshot);
        EnsureRegistered();
        return id;
    }

    public static void Stop(int id)
    {
        for (var i = Animations.Count - 1; i >= 0; i--)
        {
            if (Animations[i].Id == id)
                Animations.RemoveAt(i);
        }
    }

    public static void Stop(Control control)
    {
        for (var i = Animations.Count - 1; i >= 0; i--)
        {
            if (ReferenceEquals(Animations[i].Control, control))
                Animations.RemoveAt(i);
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
        for (var i = Animations.Count - 1; i >= 0; i--)
        {
            var animation = Animations[i];
            if (!animation.Control.IsValid)
            {
                Animations.RemoveAt(i);
                continue;
            }

            animation.Elapsed += dt;
            var progress = Math.Clamp(animation.Elapsed / animation.Preset.Duration, 0f, 1f);
            animation.Preset.Apply(animation.Control, progress, animation.Snapshot);

            if (progress >= 1f)
            {
                Animations.RemoveAt(i);
                animation.OnComplete?.Invoke();
            }
            else
            {
                Animations[i] = animation;
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
            Action? onComplete)
        {
            Id = id;
            Control = control;
            Preset = preset;
            Snapshot = snapshot;
            OnComplete = onComplete;
        }

        public int Id { get; }
        public Control Control { get; }
        public DjuiTransitionPreset Preset { get; }
        public DjuiTransitionSnapshot Snapshot { get; }
        public Action? OnComplete { get; }
        public float Elapsed { get; set; }
    }
}

#endif
