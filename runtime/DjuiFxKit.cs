// DJUI Runtime - DjuiFx 通用零件（Kit）：构建 FxPart 的常用积木，业务特效用它们拼装
// 只放与具体素材、具体游戏无关的零件；贴图、shader 由调用方提供，缺失时记 Warning 并降级，不抛异常。
#if CLIENT

using System.Numerics;
using GameGraph.MaterialSystem;
using GameGraph.NodeSystem;
using GameGraph.NodeSystem.Component.Graphics;
using GameGraph.ResourceSystem;

namespace DjuiRuntime;

/// <summary>
/// 精灵层：一张贴图＋随时间变化的曲线（位置、宽度、角度、透明度）＋混合方式＋存活区间。
/// 所有曲线入参为特效开始后的秒数 t，位置是特效世界坐标（原点＝播放锚点所在画布中心、y 向上，单位＝设计像素）。
/// 一个特效＝若干层叠加；球体、漩涡、光晕、拖尾各是独立的层。
/// </summary>
public sealed class FxSprite
{
    /// <summary>贴图路径（相对 res/，不带 res）。</summary>
    public string Texture = "";
    public FxLayer Layer = FxLayer.Front;
    /// <summary>存活区间 [Start, End] 秒，区间外隐藏。</summary>
    public float Start;
    public float End = 99f;
    public Func<float, Vector2> Position = _ => Vector2.Zero;
    /// <summary>宽度（设计像素）；高度＝宽度 × Aspect。</summary>
    public Func<float, float> Width = _ => 100f;
    public float Aspect = 1f;
    /// <summary>旋转角（度）。</summary>
    public Func<float, float> Angle = _ => 0f;
    /// <summary>0~1。</summary>
    public Func<float, float> Alpha = _ => 1f;
    public System.Drawing.Color Tint = System.Drawing.Color.White;
    /// <summary>true＝加色混合（光、火）；false＝普通 Alpha 混合。</summary>
    public bool Additive = true;
    /// <summary>
    /// 非空则使用溶解 shader：返回 0 完整 → 1 全部消散。此时 Alpha/Tint/Additive 不再生效，边缘发光色取 DissolveEdge。
    /// 需要工程提供溶解 shader（DjuiFxOptions.DissolveTechnique / NoiseTexture），缺失时降级为淡出并记一次 Warning。
    /// </summary>
    public Func<float, float>? Dissolve;
    public System.Drawing.Color DissolveEdge = System.Drawing.Color.FromArgb(255, 255, 230, 120);
}

/// <summary>零件工厂与常用曲线。</summary>
public static class FxKit
{
    private static bool _warnedDissolve;

    /// <summary>把精灵层转成可放进 FxDef 的部件。每次调用返回的部件自带状态，不要在多个 FxDef 间复用。</summary>
    public static FxPart Sprite(FxSprite layer)
    {
        Node? node = null;
        StaticSprite2D? sprite = null;
        MaterialCustom? material = null;
        // 引擎按 100 像素/单位换算：单位尺寸＝贴图像素÷100，曲线里的宽高才是设计像素
        float unitW = 1.28f, unitH = 1.28f;

        void SetProgress(float progress) =>
            material?.SetColor("MatDiffColor", new GameCore.Drawing.HdrColor(layer.DissolveEdge.R, layer.DissolveEdge.G, layer.DissolveEdge.B, (short)(Math.Clamp(progress, 0f, 1f) * 255f)));

        void Hide()
        {
            if (material != null) SetProgress(1f);
            else if (sprite != null) sprite.Color = System.Drawing.Color.FromArgb(0, 255, 255, 255);
        }

        return new FxPart(layer.Layer, scene =>
        {
            node = scene.CreateChild("fx-sprite")!;
            var tex = Sprite2D.Load(layer.Texture);
            if (tex == null)
            {
                Game.Logger.LogWarning("DjuiFx: 贴图缺失 {Path}，该层不显示", layer.Texture);
            }
            else
            {
                unitW = tex.Rectangle.Width / 100f;
                unitH = tex.Rectangle.Height / 100f;
            }

            sprite = node.CreateComponent<StaticSprite2D>()!;
            sprite.Sprite = tex;
            var technique = layer.Dissolve != null && !string.IsNullOrEmpty(DjuiFxOptions.DissolveTechnique) ? Technique.Find(DjuiFxOptions.DissolveTechnique) : null;
            if (layer.Dissolve != null && technique == null && !_warnedDissolve)
            {
                _warnedDissolve = true;
                Game.Logger.LogWarning("DjuiFx: 溶解 shader 不可用（DjuiFxOptions.DissolveTechnique={Tech}），溶解层降级为淡出。依赖说明见 runtime/AGENTS.md「特效」", DjuiFxOptions.DissolveTechnique ?? "未设置");
            }

            if (technique != null && tex != null)
            {
                material = new MaterialCustom(technique);
                material.Textures[EngineInterface.Urho3DInterface.Graphics.TextureUnit.Diffuse] = tex.Texture;
                if (!string.IsNullOrEmpty(DjuiFxOptions.NoiseTexture))
                    material.Textures[EngineInterface.Urho3DInterface.Graphics.TextureUnit.Normal] = Texture2D.Load(DjuiFxOptions.NoiseTexture);
                sprite.CustomMaterial = material;
            }

            sprite.BlendMode = layer.Additive
                ? EngineInterface.Urho3DInterface.Graphics.BlendMode.AddAlpha
                : EngineInterface.Urho3DInterface.Graphics.BlendMode.Alpha;
            Hide();
            return node;
        }, (_, t) =>
        {
            if (node == null || sprite == null) return;
            if (t < layer.Start || t > layer.End)
            {
                Hide();
                return;
            }

            var p = layer.Position(t);
            var w = Math.Max(0.01f, layer.Width(t));
            node.Position = new Vector3(p.X, p.Y, 0f);
            node.Rotation2D = layer.Angle(t);
            node.LocalScale = new Vector3(w / unitW, w * layer.Aspect / unitH, 1f);
            if (layer.Dissolve != null)
            {
                var progress = layer.Dissolve(t);
                if (material != null)
                {
                    SetProgress(progress);
                    return;
                }

                sprite.Color = System.Drawing.Color.FromArgb((int)(Math.Clamp(1f - progress, 0f, 1f) * 255f), layer.Tint.R, layer.Tint.G, layer.Tint.B);
                return;
            }

            sprite.Color = System.Drawing.Color.FromArgb((int)(Math.Clamp(layer.Alpha(t), 0f, 1f) * 255f), layer.Tint.R, layer.Tint.G, layer.Tint.B);
        });
    }

    /// <summary>
    /// 随曲线移动的粒子部件。粒子在构建时创建并播放；发射器用 localSpace:false 时粒子留在世界空间（做拖尾），
    /// localSpace:true 时整体随节点走。
    /// </summary>
    public static FxPart FollowParticle(Func<float, Vector2> position, Action<ParticleSystem> fill, FxLayer layer = FxLayer.Front)
    {
        return new FxPart(layer, scene =>
        {
            var particles = ParticleSystem.CreateRuntime();
            fill(particles);
            var node = scene.CreateChild("fx-particle")!;
            particles.AddToNode(node);
            ParticleSystem.Play(node);
            return node;
        }, (node, t) =>
        {
            var p = position(t);
            node.Position = new Vector3(p.X, p.Y, 0f);
        });
    }

    /// <summary>固定位置的粒子部件（播放时放到 position，之后不动）。</summary>
    public static FxPart Particle(Vector2 position, Action<ParticleSystem> fill, FxLayer layer = FxLayer.Front)
    {
        return new FxPart(layer, scene =>
        {
            var particles = ParticleSystem.CreateRuntime();
            fill(particles);
            var node = scene.CreateChild("fx-particle")!;
            particles.AddToNode(node);
            ParticleSystem.Play(node);
            return node;
        }, (node, t) =>
        {
            if (t == 0f) node.Position = new Vector3(position.X, position.Y, 0f);
        });
    }

    /// <summary>给发射器设贴图与混合：additive＝加色。</summary>
    public static void ParticleMaterial(ParticleEmitterBuilder emitter, string texture, bool additive = true)
    {
        emitter.Material
            .Texture(ParticleTextureSlot.Diffuse, (GameCore.ResourceType.Texture)texture)
            .Blend(additive ? ParticleBlendMode.AddAlpha : ParticleBlendMode.Alpha)
            .UseVertexColor();
    }

    /// <summary>缓出：1-(1-p)²。</summary>
    public static float EaseOut(float p) => 1f - (1f - p) * (1f - p);

    /// <summary>弧线路径：起→终，侧向弧高中段最大、两端为零（仍从起点出发、准确命中）。accel 越大越晚加速。</summary>
    public static Func<float, Vector2> ArcPath(Vector2 from, Vector2 to, float start, float duration, float arcHeight, float accel = 1.5f)
    {
        var line = to - from;
        var normal = Vector2.Normalize(new Vector2(-line.Y, line.X));
        return t =>
        {
            var p = Math.Clamp((t - start) / duration, 0f, 1f);
            return Vector2.Lerp(from, to, MathF.Pow(p, accel)) + normal * (arcHeight * MathF.Sin(MathF.PI * p));
        };
    }

    /// <summary>路径在 t 处的朝向（度）。</summary>
    public static float FacingAngle(Func<float, Vector2> path, float t)
    {
        var v = path(t + 0.01f) - path(Math.Max(0f, t - 0.01f));
        return MathF.Atan2(v.Y, v.X) * 180f / MathF.PI;
    }
}

#endif
