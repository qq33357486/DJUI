#if CLIENT

using System.Numerics;
using GameUI.Control;
using GameUI.Struct;

namespace DjuiRuntime;

public sealed class DjuiTransitionPreset
{
    public DjuiTransitionPreset(float duration, Action<Control, float, DjuiTransitionSnapshot> apply)
    {
        Duration = MathF.Max(0.01f, duration);
        Apply = apply;
    }

    public float Duration { get; }
    public Action<Control, float, DjuiTransitionSnapshot> Apply { get; }
}

public readonly record struct DjuiTransitionSnapshot(Vector2 Scale, float Opacity, Thickness Margin);

public static class DjuiTransitionRegistry
{
    private static readonly Dictionary<string, DjuiTransitionPreset> _presets = new();

    static DjuiTransitionRegistry()
    {
        Register("none", new DjuiTransitionPreset(0.01f, static (_, _, _) => { }));

        Register("pop_in", new DjuiTransitionPreset(0.28f, static (ctrl, progress, snapshot) =>
        {
            var p = Math.Clamp(progress, 0f, 1f);
            var targetScale = GetTargetScale(snapshot);
            var overshootScale = targetScale * 1.06f;
            var startScale = targetScale * 0.85f;

            ctrl.Opacity = GetTargetOpacity(snapshot) * EaseOutQuad(p);
            ctrl.Scale = p < 0.62f
                ? Lerp(startScale, overshootScale, EaseOutCubic(p / 0.62f))
                : Lerp(overshootScale, targetScale, EaseOutCubic((p - 0.62f) / 0.38f));
        }));

        Register("pop_out", new DjuiTransitionPreset(0.16f, static (ctrl, progress, snapshot) =>
        {
            var p = Math.Clamp(progress, 0f, 1f);
            var eased = EaseInCubic(p);
            var targetScale = GetTargetScale(snapshot);

            ctrl.Opacity = GetTargetOpacity(snapshot) * (1f - eased);
            ctrl.Scale = Lerp(targetScale, targetScale * 0.9f, eased);
        }));

        Register("fade_in", new DjuiTransitionPreset(0.25f, static (ctrl, progress, snapshot) =>
        {
            ctrl.Opacity = GetTargetOpacity(snapshot) * EaseOutQuad(Math.Clamp(progress, 0f, 1f));
        }));

        Register("fade_out", new DjuiTransitionPreset(0.2f, static (ctrl, progress, snapshot) =>
        {
            ctrl.Opacity = GetTargetOpacity(snapshot) * (1f - EaseInCubic(Math.Clamp(progress, 0f, 1f)));
        }));

        Register("slide_up_in", new DjuiTransitionPreset(0.3f, static (ctrl, progress, snapshot) =>
        {
            var p = EaseOutCubic(Math.Clamp(progress, 0f, 1f));
            var offset = 60f * (1f - p);
            var margin = snapshot.Margin;

            ctrl.Opacity = GetTargetOpacity(snapshot) * p;
            ctrl.Margin = new Thickness(margin.Left, margin.Top + offset, margin.Right, margin.Bottom);
        }));

        Register("slide_down_out", new DjuiTransitionPreset(0.2f, static (ctrl, progress, snapshot) =>
        {
            var p = EaseInCubic(Math.Clamp(progress, 0f, 1f));
            var margin = snapshot.Margin;

            ctrl.Opacity = GetTargetOpacity(snapshot) * (1f - p);
            ctrl.Margin = new Thickness(margin.Left, margin.Top + 60f * p, margin.Right, margin.Bottom);
        }));
    }

    public static void Register(string name, DjuiTransitionPreset preset)
    {
        _presets[name] = preset;
    }

    public static bool TryGet(string? name, out DjuiTransitionPreset preset)
    {
        if (!string.IsNullOrWhiteSpace(name) && _presets.TryGetValue(name, out preset!))
            return true;

        preset = null!;
        return false;
    }

    private static Vector2 GetTargetScale(DjuiTransitionSnapshot snapshot)
    {
        return snapshot.Scale is { X: > 0.01f, Y: > 0.01f }
            ? snapshot.Scale
            : Vector2.One;
    }

    private static float GetTargetOpacity(DjuiTransitionSnapshot snapshot)
    {
        return snapshot.Opacity > 0.01f ? snapshot.Opacity : 1f;
    }

    private static Vector2 Lerp(Vector2 from, Vector2 to, float progress)
    {
        return from + (to - from) * Math.Clamp(progress, 0f, 1f);
    }

    private static float EaseOutQuad(float value)
    {
        var t = Math.Clamp(value, 0f, 1f);
        return 1f - (1f - t) * (1f - t);
    }

    private static float EaseOutCubic(float value)
    {
        var t = Math.Clamp(value, 0f, 1f);
        var inv = 1f - t;
        return 1f - inv * inv * inv;
    }

    private static float EaseInCubic(float value)
    {
        var t = Math.Clamp(value, 0f, 1f);
        return t * t * t;
    }
}

#endif
