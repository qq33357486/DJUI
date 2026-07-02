// DJUI Runtime - 音效播放

#if CLIENT

using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using GameCore.ResourceType;
using GameGraph.NodeSystem;
using GameGraph.NodeSystem.Component.Audio;
using GameGraph.ResourceSystem;
using GameUI.Control;

namespace DjuiRuntime;

public interface IDjuiAudioBackend
{
    bool Play(DjuiSoundItemJson sound);
}

public static class DjuiAudioSystem
{
    private const string SoundsFile = "user_files/djui/sounds.json";

    private static readonly Dictionary<string, DjuiSoundItemJson> _sounds = new();
    private static readonly HashSet<string> _warned = new();
    private static bool _loaded;
    private static SceneGraph? _sceneGraph;
    private static SoundSourceComponent? _source;
    private static IDjuiAudioBackend? _backend;

    public static void SetBackend(IDjuiAudioBackend? backend)
    {
        _backend = backend;
    }

    public static void Initialize()
    {
        LoadConfig();
    }

    public static void BindClickSound(Control ctrl, string? soundId)
    {
        if (string.IsNullOrWhiteSpace(soundId)) return;

        ctrl.OnPointerClicked += (_, _) =>
        {
            Play(soundId);
        };
    }

    public static bool Play(string soundId)
    {
        if (!_loaded)
            LoadConfig();

        if (!_sounds.TryGetValue(soundId, out var sound))
        {
            WarnOnce($"missing:{soundId}", "DJUI: 未找到音效配置 {SoundId}", soundId);
            return false;
        }

        try
        {
            if (_backend != null && _backend.Play(sound))
                return true;
        }
        catch (Exception ex)
        {
            WarnOnce($"backend:{soundId}", "DJUI: 音频后端播放 {SoundId} 失败: {Error}", soundId, ex.Message);
        }

        return PlayFallback(sound);
    }

    private static void LoadConfig()
    {
        _sounds.Clear();
        _loaded = true;

        if (!File.Exists(SoundsFile))
            return;

        try
        {
            var json = File.ReadAllText(SoundsFile);
            var config = JsonSerializer.Deserialize<DjuiSoundConfigJson>(json);
            if (config?.Sounds == null) return;

            foreach (var sound in config.Sounds)
            {
                if (!string.IsNullOrWhiteSpace(sound.Id))
                    _sounds[sound.Id] = sound;
            }
        }
        catch (Exception ex)
        {
            WarnOnce("config", "DJUI: 读取声音配置失败: {Error}", ex.Message);
        }
    }

    private static bool PlayFallback(DjuiSoundItemJson sound)
    {
        if (string.IsNullOrWhiteSpace(sound.Asset))
        {
            WarnOnce($"empty:{sound.Id}", "DJUI: 音效 {SoundId} 没有资源路径", sound.Id);
            return false;
        }

        try
        {
            var source = EnsureSource();
            if (source == null) return false;

            Sound soundPath = sound.Asset!;
            var resource = SoundResource.Load(soundPath);
            if (resource == null)
            {
                WarnOnce($"load:{sound.Id}", "DJUI: 音频资源加载失败 {Asset}", sound.Asset);
                return false;
            }

            source.SoundType = "Effect";
            source.Gain = 1f;
            source.MixOutput = true;
            source.Play(resource);
            return true;
        }
        catch (Exception ex)
        {
            WarnOnce($"fallback:{sound.Id}", "DJUI: 播放音效 {SoundId} 失败: {Error}", sound.Id, ex.Message);
            return false;
        }
    }

    private static SoundSourceComponent? EnsureSource()
    {
        if (_source != null)
            return _source;

        _sceneGraph ??= new SceneGraph(false);
        var node = _sceneGraph.CreateChild("DjuiAudio");
        _source = node?.CreateComponent<SoundSourceComponent>();

        if (_source != null)
        {
            _source.SoundType = "Effect";
            _source.Gain = 1f;
            _source.MixOutput = true;
        }

        return _source;
    }

    private static void WarnOnce(string key, string message, params object?[] args)
    {
        if (!_warned.Add(key)) return;
        Game.Logger.LogWarning(message, args);
    }
}

public class DjuiSoundConfigJson
{
    [JsonPropertyName("version")]
    public int Version { get; set; } = 1;

    [JsonPropertyName("sounds")]
    public List<DjuiSoundItemJson> Sounds { get; set; } = new();
}

public class DjuiSoundItemJson
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("gameDataPath")]
    public string? GameDataPath { get; set; }

    [JsonPropertyName("asset")]
    public string? Asset { get; set; }

    [JsonPropertyName("category")]
    public string? Category { get; set; }

    [JsonPropertyName("controlTypes")]
    public List<string> ControlTypes { get; set; } = new();
}

#endif
