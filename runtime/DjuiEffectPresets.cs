// DJUI Runtime - 预设动效注册表
// 动效由 C# 代码定义，Web 端只做选择

#if CLIENT

using GameUI.Control;
using GameUI.Control.Primitive;
using GameUI.Control.Behavior;
using GameCore.Animation.EasingFunction;
using GameUI.Control.Extensions;
using GameCore.Platform.SDL;

namespace DjuiRuntime;

/// <summary>
/// 预设动效注册表。Web 端通过清单文件获取可选预设。
/// 新增动效在此注册即可。
/// </summary>
public static class DjuiEffectPresets
{
    private static readonly Dictionary<string, Action<Control>> _presets = new();

    static DjuiEffectPresets()
    {
        Register("none", static _ => { });

        // === 按压反馈 ===
        Register("press_scale_92", ctrl =>
        {
            ctrl.AddTouchBehavior(scaleFactor: 0.92f, enablePressAnimation: true, enableLongPress: false);
        });

        Register("press_scale_85_bounce", ctrl =>
        {
            var behavior = ctrl.AddTouchBehavior(scaleFactor: 0.85f);
            behavior.PressAnimationEasing = new BounceEase();
        });

        // === 悬停反馈 ===
        Register("hover_scale_105", ctrl =>
        {
            ctrl.Hover(
                onEnter: c => c.Scale = new System.Numerics.Vector2(1.05f, 1.05f),
                onLeave: c => c.Scale = System.Numerics.Vector2.One
            );
        });

        // === 出现动画 ===
        Register("fade_in", ctrl =>
        {
            ctrl.FadeIn(0.3f);
        });

        Register("fade_out", ctrl =>
        {
            ctrl.FadeOut(0.3f);
        });

        Register("scale_in", ctrl =>
        {
            ctrl.Animate(BuilderExtensions.AnimationType.ScaleIn, 0.3f);
        });

        // === 持续循环（简化版，实际需要 ticker） ===
        Register("loop_pulse", ctrl =>
        {
            DjuiEffectPlayer.StartPulse(ctrl);
        });

        // === 组合：NGUI 标准按钮 ===
        Register("button_default", ctrl =>
        {
            ctrl.AddTouchBehavior(scaleFactor: 0.92f, enablePressAnimation: true, enableLongPress: false);
            ctrl.Hover(
                onEnter: c => c.Scale = new System.Numerics.Vector2(1.05f, 1.05f),
                onLeave: c => c.Scale = System.Numerics.Vector2.One
            );
        });
    }

    /// <summary>
    /// 注册新预设。开发者可在外部调用此方法扩展。
    /// </summary>
    public static void Register(string name, Action<Control> factory)
    {
        _presets[name] = factory;
    }

    /// <summary>
    /// 应用预设动效到控件。
    /// </summary>
    public static void Apply(string? presetName, Control ctrl)
    {
        if (string.IsNullOrEmpty(presetName)) return;

        if (_presets.TryGetValue(presetName, out var factory))
        {
            factory(ctrl);
        }
        else
        {
            Game.Logger.LogWarning("DJUI: 未知动效预设 {Name}", presetName);
        }
    }
}

#endif
