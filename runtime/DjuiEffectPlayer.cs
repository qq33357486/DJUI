// DJUI Runtime - 动效播放器（帧更新驱动）

#if CLIENT

using GameUI.Control;
using System.Numerics;

namespace DjuiRuntime;

/// <summary>
/// 动效播放器，通过 IThinker 帧更新处理持续动画。
/// </summary>
public class DjuiEffectPlayer : IThinker
{
    private static readonly List<(Control ctrl, float phase, float speed)> _pulses = new();
    private static DjuiEffectPlayer? _instance;

    public bool DoesThink { get; set; } = true;

    /// <summary>
    /// 启动脉冲缩放动画。
    /// </summary>
    public static void StartPulse(Control ctrl, float speed = 3f)
    {
        _pulses.Add((ctrl, 0f, speed));
        EnsureRegistered();
    }

    private static void EnsureRegistered()
    {
        if (_instance != null) return;
        _instance = new DjuiEffectPlayer();
        Game.RegisterThinker(_instance);
    }

    public void Think(int delta)
    {
        if (!Game.IsActive) return;

        var dt = delta / 1000f;
        for (int i = _pulses.Count - 1; i >= 0; i--)
        {
            var (ctrl, phase, speed) = _pulses[i];
            phase += dt * speed;
            var pulse = 1f + 0.05f * MathF.Sin(phase);
            ctrl.Scale = new Vector2(pulse, pulse);
            _pulses[i] = (ctrl, phase, speed);
        }
    }
}

#endif
