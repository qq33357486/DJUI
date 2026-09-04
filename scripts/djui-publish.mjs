#!/usr/bin/env node
// 此文件由 DJUI 构建生成；请勿在 UI 工作区手动编辑。

// src/cli/djui-publish.ts
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// src/lib/patches.ts
var SOUND_CONFIG_VERSION = 2;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}
function getDefaultSoundConfig() {
  return { version: SOUND_CONFIG_VERSION, defaultButtonSoundId: null, sounds: [] };
}
function soundAppliesToButton(sound) {
  return sound.controlTypes.length === 0 || sound.controlTypes.includes("Button");
}
function sanitizeSoundConfig(raw) {
  const source = isRecord(raw) ? raw : {};
  const rawSounds = Array.isArray(source.sounds) ? source.sounds : [];
  const ids = /* @__PURE__ */ new Set();
  const sounds = [];
  for (const item of rawSounds) {
    if (!isRecord(item)) continue;
    const id = String(item.id ?? "").trim();
    if (!id || ids.has(id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) continue;
    const name = String(item.name ?? id).trim() || id;
    const gameDataPath = String(item.gameDataPath ?? "").trim();
    const asset = normalizeSlashes(String(item.asset ?? "").trim());
    const category = String(item.category ?? "").trim();
    const controlTypes = Array.isArray(item.controlTypes) ? [...new Set(item.controlTypes.map((x) => String(x).trim()).filter(Boolean))] : [];
    sounds.push({ id, name, gameDataPath, asset, category, controlTypes });
    ids.add(id);
  }
  const requestedDefault = typeof source.defaultButtonSoundId === "string" ? source.defaultButtonSoundId.trim() : "";
  const defaultSound = requestedDefault ? sounds.find((sound) => sound.id === requestedDefault && soundAppliesToButton(sound)) : null;
  return {
    version: SOUND_CONFIG_VERSION,
    defaultButtonSoundId: defaultSound ? defaultSound.id : null,
    sounds
  };
}
function migrateOldAnchor(anchor) {
  if (typeof anchor.side === "string" && anchor.side) {
    return { side: anchor.side, stretchStyle: "None" };
  }
  const min = isRecord(anchor.anchorMin) ? anchor.anchorMin : null;
  const max = isRecord(anchor.anchorMax) ? anchor.anchorMax : null;
  const minX = typeof min?.x === "number" ? min.x : null;
  const minY = typeof min?.y === "number" ? min.y : null;
  const maxX = typeof max?.x === "number" ? max.x : null;
  const maxY = typeof max?.y === "number" ? max.y : null;
  if (minX === null || minY === null || maxX === null || maxY === null) {
    return { side: "TopLeft", stretchStyle: "None" };
  }
  const hStretch = Math.abs(maxX - minX) > 1e-3;
  const vStretch = Math.abs(maxY - minY) > 1e-3;
  const hSide = minX < 0.25 ? "Left" : minX > 0.75 ? "Right" : "Center";
  const vSide = minY < 0.25 ? "Bottom" : minY > 0.75 ? "Top" : "Middle";
  let side;
  if (hStretch && vStretch) {
    side = "Center";
  } else if (hStretch) {
    side = vSide === "Middle" ? "Center" : vSide;
  } else if (vStretch) {
    side = hSide;
  } else if (vSide === "Middle" && hSide === "Center") {
    side = "Center";
  } else if (vSide === "Middle") {
    side = hSide;
  } else if (hSide === "Center") {
    side = vSide;
  } else {
    side = `${vSide}${hSide}`;
  }
  const stretchStyle = hStretch && vStretch ? "Both" : hStretch ? "Horizontal" : vStretch ? "Vertical" : "None";
  return { side, stretchStyle };
}
function patchNode(node, defaultButtonSoundId, result) {
  if (!isRecord(node)) return;
  const anchor = isRecord(node.anchor) ? node.anchor : null;
  if (anchor && isRecord(anchor.anchorMin) && !anchor.side) {
    const migrated = migrateOldAnchor(anchor);
    anchor.side = migrated.side;
    if (migrated.stretchStyle !== "None") {
      node.stretch = {
        style: migrated.stretchStyle,
        margins: {
          left: typeof anchor.left === "number" ? anchor.left : 0,
          right: typeof anchor.right === "number" ? anchor.right : 0,
          top: typeof anchor.top === "number" ? anchor.top : 0,
          bottom: typeof anchor.bottom === "number" ? anchor.bottom : 0
        }
      };
    }
    delete anchor.anchorMin;
    delete anchor.anchorMax;
    delete anchor.left;
    delete anchor.right;
    delete anchor.top;
    delete anchor.bottom;
    delete anchor.preset;
    result.changed = true;
    result.migratedAnchors++;
  }
  if (anchor && !anchor.side) {
    anchor.side = "TopLeft";
    result.changed = true;
  }
  if (node.starType === "Button") {
    const djui = isRecord(node.djui) ? node.djui : {};
    const currentSound = typeof djui.clickSoundId === "string" ? djui.clickSoundId.trim() : "";
    if (!currentSound) {
      if (defaultButtonSoundId) {
        if (!isRecord(node.djui)) node.djui = djui;
        djui.clickSoundId = defaultButtonSoundId;
        result.changed = true;
        result.patchedButtonSounds++;
      } else {
        result.missingButtonSounds++;
      }
    }
  }
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) patchNode(child, defaultButtonSoundId, result);
  }
}
function patchPageNodeTree(page, defaultButtonSoundId) {
  const result = {
    changed: false,
    migratedAnchors: 0,
    patchedButtonSounds: 0,
    missingButtonSounds: 0
  };
  if (!isRecord(page) || !isRecord(page.root)) return result;
  patchNode(page.root, defaultButtonSoundId, result);
  return result;
}
function injectSliceEdges(node, meta) {
  if (!node) return;
  const appearance = node.appearance;
  if (isRecord(appearance) && typeof appearance.image === "string" && appearance.image) {
    const key = normalizeSlashes(appearance.image);
    const edges = meta[key];
    if (edges) {
      node.appearance.slicedEdges = [edges.left, edges.top, edges.right, edges.bottom];
    } else if ("slicedEdges" in appearance) {
      delete appearance.slicedEdges;
    }
  }
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) injectSliceEdges(child, meta);
  }
}
function stripEditorFields(node) {
  if (!isRecord(node)) return;
  delete node.editorLocked;
  delete node.editorHidden;
  delete node.editorLockAspect;
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) stripEditorFields(child);
  }
}
function applyRuntimeOnlyFields(data, sliceMeta) {
  if (!data?.root) return;
  injectSliceEdges(data.root, sliceMeta);
  stripEditorFields(data.root);
}
function createRuntimePageSnapshot(pageData, sliceMeta) {
  const data = JSON.parse(JSON.stringify(pageData));
  applyRuntimeOnlyFields(data, sliceMeta);
  return data;
}

// src/types/protocolV6.ts
var DJUI_PROTOCOL_VERSION = 6;

// raw:D:\git\DJUI\runtime\DjuiActionRouter.cs
var DjuiActionRouter_default = '// DJUI Runtime - Action \u8DEF\u7531\n\n#if CLIENT\n\nusing GameUI.Control;\nusing GameCore.Platform.SDL;\n\nnamespace DjuiRuntime;\n\n/// <summary>\n/// Action \u8DEF\u7531\u7CFB\u7EDF\u3002JSON \u4E2D\u58F0\u660E action\uFF0C\u8FD0\u884C\u65F6\u81EA\u52A8\u7ED1\u5B9A\u70B9\u51FB\u4E8B\u4EF6\u3002\n/// \u5F00\u53D1\u8005\u6CE8\u518C\u5904\u7406\u51FD\u6570\u5373\u53EF\u3002\n/// </summary>\npublic static class DjuiActionRouter\n{\n    private static readonly Dictionary<string, Action<Control, PointerEventArgs?>> _handlers = new();\n\n    /// <summary>\n    /// \u6CE8\u518C Action \u5904\u7406\u51FD\u6570\u3002\n    /// </summary>\n    public static void On(string actionName, Action handler)\n    {\n        _handlers[actionName] = (ctrl, args) => handler();\n    }\n\n    /// <summary>\n    /// \u6CE8\u518C Action \u5904\u7406\u51FD\u6570\uFF08\u5E26\u53C2\u6570\uFF09\u3002\n    /// </summary>\n    public static void On(string actionName, Action<Control, PointerEventArgs?> handler)\n    {\n        _handlers[actionName] = handler;\n    }\n\n    public static bool Trigger(string actionName)\n    {\n        if (!_handlers.TryGetValue(actionName, out var handler))\n            return false;\n\n        handler(null!, null);\n        return true;\n    }\n\n    /// <summary>\n    /// \u5185\u90E8\uFF1A\u5C06 action \u7ED1\u5B9A\u5230\u63A7\u4EF6\u7684\u70B9\u51FB\u4E8B\u4EF6\u3002\n    /// </summary>\n    internal static void BindAction(Control ctrl, string? actionName)\n    {\n        if (string.IsNullOrEmpty(actionName)) return;\n\n        ctrl.OnPointerClicked += (sender, args) =>\n        {\n            if (_handlers.TryGetValue(actionName, out var handler))\n            {\n                handler(ctrl, args);\n            }\n            else\n            {\n                Game.Logger.LogWarning("DJUI: \u672A\u6CE8\u518C\u7684 Action {Name}", actionName);\n            }\n        };\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiAudioSystem.cs
var DjuiAudioSystem_default = '// DJUI Runtime - \u97F3\u6548\u64AD\u653E\n\n#if CLIENT\n\nusing System.IO;\nusing System.Text.Json;\nusing System.Text.Json.Serialization;\nusing GameCore.ResourceType;\nusing GameGraph.NodeSystem;\nusing GameGraph.NodeSystem.Component.Audio;\nusing GameGraph.ResourceSystem;\nusing GameUI.Control;\n\nnamespace DjuiRuntime;\n\npublic interface IDjuiAudioBackend\n{\n    bool Play(DjuiSoundItemJson sound);\n}\n\npublic static class DjuiAudioSystem\n{\n    private const string SoundsFile = "user_files/djui/sounds.json";\n\n    private static readonly Dictionary<string, DjuiSoundItemJson> _sounds = new();\n    private static readonly HashSet<string> _warned = new();\n    private static bool _loaded;\n    private static SceneGraph? _sceneGraph;\n    private static SoundSourceComponent? _source;\n    private static IDjuiAudioBackend? _backend;\n\n    public static void SetBackend(IDjuiAudioBackend? backend)\n    {\n        _backend = backend;\n    }\n\n    public static void Initialize()\n    {\n        LoadConfig();\n    }\n\n    public static void BindClickSound(Control ctrl, string? soundId)\n    {\n        if (string.IsNullOrWhiteSpace(soundId)) return;\n\n        ctrl.OnPointerClicked += (_, _) =>\n        {\n            Play(soundId);\n        };\n    }\n\n    public static bool Play(string soundId)\n    {\n        if (!_loaded)\n            LoadConfig();\n\n        if (!_sounds.TryGetValue(soundId, out var sound))\n        {\n            WarnOnce($"missing:{soundId}", "DJUI: \u672A\u627E\u5230\u97F3\u6548\u914D\u7F6E {SoundId}", soundId);\n            return false;\n        }\n\n        try\n        {\n            if (_backend != null && _backend.Play(sound))\n                return true;\n        }\n        catch (Exception ex)\n        {\n            WarnOnce($"backend:{soundId}", "DJUI: \u97F3\u9891\u540E\u7AEF\u64AD\u653E {SoundId} \u5931\u8D25: {Error}", soundId, ex.Message);\n        }\n\n        return PlayFallback(sound);\n    }\n\n    private static void LoadConfig()\n    {\n        _sounds.Clear();\n        _loaded = true;\n\n        if (!File.Exists(SoundsFile))\n            return;\n\n        try\n        {\n            var json = File.ReadAllText(SoundsFile);\n            var config = JsonSerializer.Deserialize<DjuiSoundConfigJson>(json);\n            if (config?.Sounds == null) return;\n\n            foreach (var sound in config.Sounds)\n            {\n                if (!string.IsNullOrWhiteSpace(sound.Id))\n                    _sounds[sound.Id] = sound;\n            }\n        }\n        catch (Exception ex)\n        {\n            WarnOnce("config", "DJUI: \u8BFB\u53D6\u58F0\u97F3\u914D\u7F6E\u5931\u8D25: {Error}", ex.Message);\n        }\n    }\n\n    private static bool PlayFallback(DjuiSoundItemJson sound)\n    {\n        if (string.IsNullOrWhiteSpace(sound.Asset))\n        {\n            WarnOnce($"empty:{sound.Id}", "DJUI: \u97F3\u6548 {SoundId} \u6CA1\u6709\u8D44\u6E90\u8DEF\u5F84", sound.Id);\n            return false;\n        }\n\n        try\n        {\n            var source = EnsureSource();\n            if (source == null) return false;\n\n            Sound soundPath = sound.Asset!;\n            var resource = SoundResource.Load(soundPath);\n            if (resource == null)\n            {\n                WarnOnce($"load:{sound.Id}", "DJUI: \u97F3\u9891\u8D44\u6E90\u52A0\u8F7D\u5931\u8D25 {Asset}", sound.Asset);\n                return false;\n            }\n\n            source.SoundType = "Effect";\n            source.Gain = 1f;\n            source.MixOutput = true;\n            source.Play(resource);\n            return true;\n        }\n        catch (Exception ex)\n        {\n            WarnOnce($"fallback:{sound.Id}", "DJUI: \u64AD\u653E\u97F3\u6548 {SoundId} \u5931\u8D25: {Error}", sound.Id, ex.Message);\n            return false;\n        }\n    }\n\n    private static SoundSourceComponent? EnsureSource()\n    {\n        if (_source != null)\n            return _source;\n\n        _sceneGraph ??= new SceneGraph(false);\n        var node = _sceneGraph.CreateChild("DjuiAudio");\n        _source = node?.CreateComponent<SoundSourceComponent>();\n\n        if (_source != null)\n        {\n            _source.SoundType = "Effect";\n            _source.Gain = 1f;\n            _source.MixOutput = true;\n        }\n\n        return _source;\n    }\n\n    private static void WarnOnce(string key, string message, params object?[] args)\n    {\n        if (!_warned.Add(key)) return;\n        Game.Logger.LogWarning(message, args);\n    }\n}\n\npublic class DjuiSoundConfigJson\n{\n    [JsonPropertyName("version")]\n    public int Version { get; set; } = 1;\n\n    [JsonPropertyName("sounds")]\n    public List<DjuiSoundItemJson> Sounds { get; set; } = new();\n}\n\npublic class DjuiSoundItemJson\n{\n    [JsonPropertyName("id")]\n    public string Id { get; set; } = "";\n\n    [JsonPropertyName("name")]\n    public string? Name { get; set; }\n\n    [JsonPropertyName("gameDataPath")]\n    public string? GameDataPath { get; set; }\n\n    [JsonPropertyName("asset")]\n    public string? Asset { get; set; }\n\n    [JsonPropertyName("category")]\n    public string? Category { get; set; }\n\n    [JsonPropertyName("controlTypes")]\n    public List<string> ControlTypes { get; set; } = new();\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiBindingSystem.cs
var DjuiBindingSystem_default = '// DJUI Runtime - scoped data binding system\n#if CLIENT\n\nusing GameUI.Control;\n\nnamespace DjuiRuntime;\n\n/// <summary>Global binding values with instance-scoped control registrations.</summary>\npublic static class DjuiBindingSystem\n{\n    private sealed class Registration : IDisposable\n    {\n        public required string Key { get; init; }\n        public required Control Control { get; init; }\n        public required Action<object?> Apply { get; init; }\n        public void Dispose()\n        {\n            if (_bindings.TryGetValue(Key, out var list))\n            {\n                list.Remove(this);\n                if (list.Count == 0) _bindings.Remove(Key);\n            }\n        }\n    }\n\n    private static readonly Dictionary<string, object?> _values = new();\n    private static readonly Dictionary<string, List<Registration>> _bindings = new();\n    // Legacy v5 registry only. v6 registers controls directly and never uses global bare IDs.\n    private static readonly Dictionary<string, Control> _controlRegistry = new();\n\n    internal static void RegisterControl(string nodeId, Control ctrl) => _controlRegistry[nodeId] = ctrl;\n    internal static Control? GetRegisteredControl(string nodeId) => _controlRegistry.TryGetValue(nodeId, out var ctrl) ? ctrl : null;\n\n    internal static void RegisterBinding(string nodeId, string propertyName, string bindingKey)\n    {\n        if (_controlRegistry.TryGetValue(nodeId, out var control)) RegisterBinding(control, propertyName, bindingKey);\n    }\n\n    /// <summary>Registers one v6 instance-owned binding without publishing a bare node ID globally.</summary>\n    internal static IDisposable RegisterBinding(Control control, string propertyName, string bindingKey)\n    {\n        var apply = CreateBindingAction(propertyName, control);\n        if (apply == null) return EmptyDisposable.Instance;\n        var registration = new Registration { Key = bindingKey, Control = control, Apply = apply };\n        if (!_bindings.TryGetValue(bindingKey, out var list)) _bindings[bindingKey] = list = new List<Registration>();\n        list.Add(registration);\n        if (_values.TryGetValue(bindingKey, out var value)) apply(value);\n        return registration;\n    }\n\n    private static Action<object?>? CreateBindingAction(string propertyName, Control control)\n    {\n        return propertyName switch\n        {\n            "visible" => value => control.Visible = value is bool visible && visible,\n            "disabled" => value => DjuiButtonState.SetDisabled(control, value is bool disabled && disabled),\n            "text" when control is Label label => value => label.Text = value?.ToString() ?? "",\n            "value" when control is Progress progress => value =>\n            {\n                progress.Value = Convert.ToSingle(value ?? 0f);\n                DjuiProgressVisualLayerV6.NotifyValueChanged(progress);\n            },\n            _ => null,\n        };\n    }\n\n    public static void Set<T>(string key, T value)\n    {\n        _values[key] = value;\n        if (!_bindings.TryGetValue(key, out var bindings)) return;\n        foreach (var registration in bindings.ToArray())\n        {\n            if (!registration.Control.IsValid) { registration.Dispose(); continue; }\n            try { registration.Apply(value); } catch (Exception ex) { Game.Logger.LogWarning(ex, "DJUI: \u7ED1\u5B9A {Key} \u66F4\u65B0\u5931\u8D25", key); }\n        }\n    }\n\n    public static T? Get<T>(string key) => _values.TryGetValue(key, out var value) && value is T typed ? typed : default;\n\n    private sealed class EmptyDisposable : IDisposable\n    {\n        public static readonly EmptyDisposable Instance = new();\n        public void Dispose() { }\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiEffectPlayer.cs
var DjuiEffectPlayer_default = "// DJUI Runtime - \u52A8\u6548\u64AD\u653E\u5668\uFF08\u5E27\u66F4\u65B0\u9A71\u52A8\uFF09\n\n#if CLIENT\n\nusing GameUI.Control;\nusing System.Numerics;\n\nnamespace DjuiRuntime;\n\n/// <summary>\n/// \u52A8\u6548\u64AD\u653E\u5668\uFF0C\u901A\u8FC7 IThinker \u5E27\u66F4\u65B0\u5904\u7406\u6301\u7EED\u52A8\u753B\u3002\n/// </summary>\npublic class DjuiEffectPlayer : IThinker\n{\n    private static readonly List<(Control ctrl, float phase, float speed)> _pulses = new();\n    private static DjuiEffectPlayer? _instance;\n\n    public bool DoesThink { get; set; } = true;\n\n    /// <summary>\n    /// \u542F\u52A8\u8109\u51B2\u7F29\u653E\u52A8\u753B\u3002\n    /// </summary>\n    public static void StartPulse(Control ctrl, float speed = 3f)\n    {\n        _pulses.Add((ctrl, 0f, speed));\n        EnsureRegistered();\n    }\n\n    public static void Stop(Control ctrl)\n    {\n        for (var i = _pulses.Count - 1; i >= 0; i--)\n            if (ReferenceEquals(_pulses[i].ctrl, ctrl)) _pulses.RemoveAt(i);\n    }\n\n    private static void EnsureRegistered()\n    {\n        if (_instance != null) return;\n        _instance = new DjuiEffectPlayer();\n        Game.RegisterThinker(_instance);\n    }\n\n    public void Think(int delta)\n    {\n        if (!Game.IsActive) return;\n\n        var dt = delta / 1000f;\n        for (int i = _pulses.Count - 1; i >= 0; i--)\n        {\n            var (ctrl, phase, speed) = _pulses[i];\n            if (!ctrl.IsValid) { _pulses.RemoveAt(i); continue; }\n            phase += dt * speed;\n            var pulse = 1f + 0.05f * MathF.Sin(phase);\n            ctrl.Scale = new Vector2(pulse, pulse);\n            _pulses[i] = (ctrl, phase, speed);\n        }\n    }\n}\n\n#endif\n";

// raw:D:\git\DJUI\runtime\DjuiEffectPresets.cs
var DjuiEffectPresets_default = '// DJUI Runtime - \u9884\u8BBE\u52A8\u6548\u6CE8\u518C\u8868\n// \u52A8\u6548\u7531 C# \u4EE3\u7801\u5B9A\u4E49\uFF0CWeb \u7AEF\u53EA\u505A\u9009\u62E9\n\n#if CLIENT\n\nusing GameUI.Control;\nusing GameUI.Control.Primitive;\nusing GameUI.Control.Behavior;\nusing GameCore.Animation.EasingFunction;\nusing GameUI.Control.Extensions;\nusing GameCore.Platform.SDL;\n\nnamespace DjuiRuntime;\n\n/// <summary>\n/// \u9884\u8BBE\u52A8\u6548\u6CE8\u518C\u8868\u3002Web \u7AEF\u901A\u8FC7\u6E05\u5355\u6587\u4EF6\u83B7\u53D6\u53EF\u9009\u9884\u8BBE\u3002\n/// \u65B0\u589E\u52A8\u6548\u5728\u6B64\u6CE8\u518C\u5373\u53EF\u3002\n/// </summary>\npublic static class DjuiEffectPresets\n{\n    private static readonly Dictionary<string, Action<Control>> _presets = new();\n\n    static DjuiEffectPresets()\n    {\n        Register("none", static _ => { });\n\n        // === \u6309\u538B\u53CD\u9988 ===\n        Register("press_scale_92", ctrl =>\n        {\n            ctrl.AddTouchBehavior(scaleFactor: 0.92f, enablePressAnimation: true, enableLongPress: false);\n        });\n\n        Register("press_scale_85_bounce", ctrl =>\n        {\n            var behavior = ctrl.AddTouchBehavior(scaleFactor: 0.85f);\n            behavior.PressAnimationEasing = new BounceEase();\n        });\n\n        // === \u60AC\u505C\u53CD\u9988 ===\n        Register("hover_scale_105", ctrl =>\n        {\n            ctrl.Hover(\n                onEnter: c => c.Scale = new System.Numerics.Vector2(1.05f, 1.05f),\n                onLeave: c => c.Scale = System.Numerics.Vector2.One\n            );\n        });\n\n        // === \u51FA\u73B0\u52A8\u753B ===\n        Register("fade_in", ctrl =>\n        {\n            ctrl.FadeIn(0.3f);\n        });\n\n        Register("fade_out", ctrl =>\n        {\n            ctrl.FadeOut(0.3f);\n        });\n\n        Register("scale_in", ctrl =>\n        {\n            ctrl.Animate(BuilderExtensions.AnimationType.ScaleIn, 0.3f);\n        });\n\n        // === \u6301\u7EED\u5FAA\u73AF\uFF08\u7B80\u5316\u7248\uFF0C\u5B9E\u9645\u9700\u8981 ticker\uFF09 ===\n        Register("loop_pulse", ctrl =>\n        {\n            DjuiEffectPlayer.StartPulse(ctrl);\n        });\n\n        // === \u7EC4\u5408\uFF1ANGUI \u6807\u51C6\u6309\u94AE ===\n        Register("button_default", ctrl =>\n        {\n            ctrl.AddTouchBehavior(scaleFactor: 0.92f, enablePressAnimation: true, enableLongPress: false);\n            ctrl.Hover(\n                onEnter: c => c.Scale = new System.Numerics.Vector2(1.05f, 1.05f),\n                onLeave: c => c.Scale = System.Numerics.Vector2.One\n            );\n        });\n    }\n\n    /// <summary>\n    /// \u6CE8\u518C\u65B0\u9884\u8BBE\u3002\u5F00\u53D1\u8005\u53EF\u5728\u5916\u90E8\u8C03\u7528\u6B64\u65B9\u6CD5\u6269\u5C55\u3002\n    /// </summary>\n    public static void Register(string name, Action<Control> factory)\n    {\n        _presets[name] = factory;\n    }\n\n    /// <summary>\n    /// \u5E94\u7528\u9884\u8BBE\u52A8\u6548\u5230\u63A7\u4EF6\u3002\n    /// </summary>\n    public static void Apply(string? presetName, Control ctrl)\n    {\n        if (string.IsNullOrEmpty(presetName)) return;\n\n        if (_presets.TryGetValue(presetName, out var factory))\n        {\n            factory(ctrl);\n        }\n        else\n        {\n            Game.Logger.LogWarning("DJUI: \u672A\u77E5\u52A8\u6548\u9884\u8BBE {Name}", presetName);\n        }\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiLayoutSolver.cs
var DjuiLayoutSolver_default = '// DJUI Runtime - \u5E03\u5C40\u89E3\u6790\u5F15\u64CE\uFF08NGUI \u98CE\u683C\uFF1A\u951A\u70B9\u7BA1\u4F4D\u7F6E\uFF0C\u62C9\u4F38\u7BA1\u5927\u5C0F\uFF09\n// \u4E0E editor \u7AEF utils/layoutSolver.ts \u4FDD\u6301\u4E00\u81F4\n//\n// anchor.side (9-way) \u2192 \u51B3\u5B9A\u63A7\u4EF6\u4F4D\u7F6E\u57FA\u51C6\n// stretch.style (None/H/V/Both) \u2192 \u51B3\u5B9A\u63A7\u4EF6\u5C3A\u5BF8\u662F\u5426\u8DDF\u968F\u7236\u7EA7\n// aspectRatio \u2192 \u6BD4\u4F8B\u7EA6\u675F\uFF08\u6700\u540E\u5E94\u7528\uFF09\n\nusing System;\nusing System.Collections.Generic;\n\nnamespace DjuiRuntime;\n\n/// <summary>\n/// \u5E03\u5C40\u6C42\u89E3\u7ED3\u679C\n/// </summary>\npublic readonly struct SolvedRect\n{\n    public readonly float X;\n    public readonly float Y;\n    public readonly float Width;\n    public readonly float Height;\n\n    public SolvedRect(float x, float y, float w, float h)\n    {\n        X = x; Y = y; Width = w; Height = h;\n    }\n}\n\n/// <summary>\n/// \u5E03\u5C40\u89E3\u6790\u5F15\u64CE\u3002\u5BF9\u5E94 editor \u7AEF utils/layoutSolver.ts\u3002\n/// </summary>\npublic static class DjuiLayoutSolver\n{\n    // \u9ED8\u8BA4\u503C\n    private static readonly Vec2Json DefaultPivot = new() { X = 0.5f, Y = 0.5f };\n    private const string DefaultSide = "TopLeft";\n\n    // 9-way \u951A\u70B9\u8868\uFF1Aid \u2192 (nx, ny)\n    // nx: 0=\u5DE6 0.5=\u4E2D 1=\u53F3\n    // ny: uGUI Y \u671D\u4E0A\uFF080=\u5E95 0.5=\u4E2D 1=\u9876\uFF09\n    private static readonly Dictionary<string, (float nx, float ny)> AnchorSides = new()\n    {\n        { "TopLeft",     (0f,    1f)    },\n        { "Top",         (0.5f,  1f)    },\n        { "TopRight",    (1f,    1f)    },\n        { "Left",        (0f,    0.5f)  },\n        { "Center",      (0.5f,  0.5f)  },\n        { "Right",       (1f,    0.5f)  },\n        { "BottomLeft",  (0f,    0f)    },\n        { "Bottom",      (0.5f,  0f)    },\n        { "BottomRight", (1f,    0f)    },\n    };\n\n    /// <summary>\n    /// \u89E3\u6790\u5355\u4E2A\u8282\u70B9\u7684\u6700\u7EC8\u5C4F\u5E55\u77E9\u5F62\u3002\n    /// </summary>\n    public static SolvedRect Solve(\n        DjuiNodeJson node,\n        float parentX, float parentY,\n        float parentWidth, float parentHeight,\n        float screenWidth, float screenHeight,\n        HashSet<string>? measuring = null)\n    {\n        measuring ??= new HashSet<string>();\n\n        var t = node.Transform;\n        var anchor = node.Anchor;\n        var stretch = node.Stretch;\n        var ar = node.AspectRatio;\n\n        var target = anchor?.Target ?? "parent";\n        var sideId = anchor?.Side ?? DefaultSide;\n        var pivot = t?.Pivot ?? DefaultPivot;\n        var stretchStyle = stretch?.Style ?? "None";\n\n        // 1. \u53C2\u8003\u77E9\u5F62\n        float refX, refY, refW, refH;\n        if (target == "screen")\n        {\n            refX = 0; refY = 0; refW = screenWidth; refH = screenHeight;\n        }\n        else\n        {\n            refX = parentX; refY = parentY; refW = parentWidth; refH = parentHeight;\n        }\n\n        // 2. \u83B7\u53D6 9-way \u951A\u70B9\u5750\u6807\n        float nx = 0f, ny = 1f; // \u9ED8\u8BA4 TopLeft\n        if (sideId != null && AnchorSides.TryGetValue(sideId, out var side))\n        {\n            nx = side.nx;\n            ny = side.ny;\n        }\n\n        // \u951A\u70B9\u4F4D\u7F6E\uFF08\u5C4F\u5E55\u5750\u6807\uFF09\n        float anchorX = refX + nx * refW;\n        float anchorY = refY + (1 - ny) * refH;\n\n        // 3. \u62C9\u4F38\u8FB9\u8DDD\n        float ml = stretch?.Margins?.Left ?? 0;\n        float mr = stretch?.Margins?.Right ?? 0;\n        float mt = stretch?.Margins?.Top ?? 0;\n        float mb = stretch?.Margins?.Bottom ?? 0;\n\n        bool hStretch = stretchStyle == "Horizontal" || stretchStyle == "Both";\n        bool vStretch = stretchStyle == "Vertical" || stretchStyle == "Both";\n\n        float x, y, w, h;\n\n        // === \u65E0\u951A\u70B9\uFF1A\u7EAF\u7EDD\u5BF9\u5B9A\u4F4D\uFF08\u4E0E editor \u4E00\u81F4\uFF09===\n        if (sideId == "None" || target == "none")\n        {\n            x = t?.X ?? 0;\n            y = t?.Y ?? 0;\n            w = t?.Width ?? 100;\n            h = t?.Height ?? 100;\n            // \u62C9\u4F38\u4ECD\u751F\u6548\uFF08\u57FA\u4E8E\u53C2\u8003\u77E9\u5F62\uFF09\n            if (hStretch)\n            {\n                w = Math.Max(0, refW - ml - mr);\n                x = refX + ml;\n            }\n            if (vStretch)\n            {\n                h = Math.Max(0, refH - mt - mb);\n                y = refY + mt;\n            }\n        }\n        else\n        {\n            // --- \u6C34\u5E73\u8F74 ---\n            if (hStretch)\n            {\n                w = Math.Max(0, refW - ml - mr);\n                x = refX + ml;\n            }\n            else\n            {\n                w = t?.Width ?? 100;\n                x = anchorX + (t?.X ?? 0) - nx * w;\n            }\n\n            // --- \u5782\u76F4\u8F74 ---\n            if (vStretch)\n            {\n                h = Math.Max(0, refH - mt - mb);\n                y = refY + mt;\n            }\n            else\n            {\n                h = t?.Height ?? 100;\n                y = anchorY + (t?.Y ?? 0) - (1 - ny) * h;\n            }\n        }\n\n        // 5. \u5E94\u7528 AspectRatio\n        if (ar != null && !string.IsNullOrEmpty(ar.Mode) && ar.Mode != "None")\n        {\n            float ratio = ar.Ratio ?? 1;\n            if (ratio > 0)\n            {\n                switch (ar.Mode)\n                {\n                    case "WidthControlsHeight":\n                    {\n                        float newH = w / ratio;\n                        float cy = y + pivot.Y * h;\n                        y = cy - pivot.Y * newH;\n                        h = newH;\n                        break;\n                    }\n                    case "HeightControlsWidth":\n                    {\n                        float newW = h * ratio;\n                        float cx = x + pivot.X * w;\n                        x = cx - pivot.X * newW;\n                        w = newW;\n                        break;\n                    }\n                    case "FitInParent":\n                    {\n                        float scaleW = refW / w;\n                        float scaleH = refH / h;\n                        float s = Math.Min(scaleW, scaleH);\n                        float newW = w * s;\n                        float newH = h * s;\n                        float cx = refX + pivot.X * refW;\n                        float cy = refY + pivot.Y * refH;\n                        x = cx - pivot.X * newW;\n                        y = cy - pivot.Y * newH;\n                        w = newW; h = newH;\n                        break;\n                    }\n                    case "EnvelopeParent":\n                    {\n                        float scaleW = refW / w;\n                        float scaleH = refH / h;\n                        float s = Math.Max(scaleW, scaleH);\n                        float newW = w * s;\n                        float newH = h * s;\n                        float cx = refX + pivot.X * refW;\n                        float cy = refY + pivot.Y * refH;\n                        x = cx - pivot.X * newW;\n                        y = cy - pivot.Y * newH;\n                        w = newW; h = newH;\n                        break;\n                    }\n                }\n            }\n        }\n\n        return ApplyAutoSize(\n            node,\n            new SolvedRect(x, y, w, h),\n            screenWidth,\n            screenHeight,\n            sideId ?? DefaultSide,\n            target,\n            nx,\n            ny,\n            hStretch,\n            vStretch,\n            measuring);\n    }\n\n    private static SolvedRect ApplyAutoSize(\n        DjuiNodeJson node,\n        SolvedRect baseRect,\n        float screenWidth,\n        float screenHeight,\n        string sideId,\n        string target,\n        float sideNx,\n        float sideNy,\n        bool hStretch,\n        bool vStretch,\n        HashSet<string> measuring)\n    {\n        bool autoWidth = UsesAutoWidth(node);\n        bool autoHeight = UsesAutoHeight(node);\n        if (!autoWidth && !autoHeight) return baseRect;\n\n        if (measuring.Contains(node.Id)) return baseRect;\n\n        bool blockedWidth = false;\n        bool blockedHeight = false;\n        string widthReason = "";\n        string heightReason = "";\n\n        if (autoWidth && hStretch)\n        {\n            blockedWidth = true;\n            widthReason = "\u81EA\u8EAB\u6C34\u5E73\u62C9\u4F38\u4F1A\u8986\u76D6\u81EA\u52A8\u5BBD";\n        }\n        if (autoHeight && vStretch)\n        {\n            blockedHeight = true;\n            heightReason = "\u81EA\u8EAB\u5782\u76F4\u62C9\u4F38\u4F1A\u8986\u76D6\u81EA\u52A8\u9AD8";\n        }\n\n        foreach (var child in node.Children)\n        {\n            if (child.Basic?.Visible == false) continue;\n\n            if (autoWidth && !blockedWidth && GetChildAutoSizeConflict(child, true, out var reason))\n            {\n                blockedWidth = true;\n                widthReason = $"{child.Id}: {reason}";\n            }\n            if (autoHeight && !blockedHeight && GetChildAutoSizeConflict(child, false, out reason))\n            {\n                blockedHeight = true;\n                heightReason = $"{child.Id}: {reason}";\n            }\n        }\n\n        if (autoWidth && blockedWidth)\n            Game.Logger.LogWarning("DJUI: \u8282\u70B9 {Id} \u81EA\u52A8\u5BBD\u56DE\u9000\u5230\u57FA\u51C6\u5BBD\uFF1A{Reason}", node.Id, widthReason);\n        if (autoHeight && blockedHeight)\n            Game.Logger.LogWarning("DJUI: \u8282\u70B9 {Id} \u81EA\u52A8\u9AD8\u56DE\u9000\u5230\u57FA\u51C6\u9AD8\uFF1A{Reason}", node.Id, heightReason);\n\n        if ((autoWidth && !blockedWidth) || (autoHeight && !blockedHeight))\n        {\n            measuring.Add(node.Id);\n        }\n        else\n        {\n            return baseRect;\n        }\n\n        try\n        {\n            if (!MeasureChildrenBounds(node, baseRect, screenWidth, screenHeight, measuring, out var measuredWidth, out var measuredHeight))\n                return baseRect;\n\n            var nextWidth = baseRect.Width;\n            var nextHeight = baseRect.Height;\n\n            if (autoWidth && !blockedWidth)\n                nextWidth = Math.Max(1, measuredWidth);\n            if (autoHeight && !blockedHeight)\n                nextHeight = Math.Max(1, measuredHeight);\n\n            var nextX = baseRect.X;\n            var nextY = baseRect.Y;\n            if (sideId != "None" && target != "none")\n            {\n                nextX -= sideNx * (nextWidth - baseRect.Width);\n                nextY -= (1 - sideNy) * (nextHeight - baseRect.Height);\n            }\n\n            return new SolvedRect(nextX, nextY, nextWidth, nextHeight);\n        }\n        finally\n        {\n            measuring.Remove(node.Id);\n        }\n    }\n\n    private static bool MeasureChildrenBounds(\n        DjuiNodeJson node,\n        SolvedRect containerRect,\n        float screenWidth,\n        float screenHeight,\n        HashSet<string> measuring,\n        out float measuredWidth,\n        out float measuredHeight)\n    {\n        measuredWidth = containerRect.Width;\n        measuredHeight = containerRect.Height;\n\n        bool hasBounds = false;\n        float maxRight = 0;\n        float maxBottom = 0;\n\n        foreach (var child in node.Children)\n        {\n            if (child.Basic?.Visible == false) continue;\n\n            var childSolved = Solve(\n                child,\n                containerRect.X,\n                containerRect.Y,\n                containerRect.Width,\n                containerRect.Height,\n                screenWidth,\n                screenHeight,\n                measuring);\n\n            var localRight = childSolved.X - containerRect.X + childSolved.Width;\n            var localBottom = childSolved.Y - containerRect.Y + childSolved.Height;\n            if (!IsFinite(localRight) || !IsFinite(localBottom)) continue;\n\n            maxRight = Math.Max(maxRight, localRight);\n            maxBottom = Math.Max(maxBottom, localBottom);\n            hasBounds = true;\n        }\n\n        if (!hasBounds) return false;\n\n        var padding = node.Layout?.Padding;\n        var paddingRight = padding != null && padding.Length >= 3 ? padding[2] : 0;\n        var paddingBottom = padding != null && padding.Length >= 4 ? padding[3] : 0;\n\n        measuredWidth = MathF.Ceiling(Math.Max(0, maxRight + paddingRight));\n        measuredHeight = MathF.Ceiling(Math.Max(0, maxBottom + paddingBottom));\n        return true;\n    }\n\n    public static bool ShouldUseNativeAutoWidth(DjuiNodeJson node)\n    {\n        return UsesAutoWidth(node) && HasVisibleChildren(node) && !HasAutoSizeConflict(node, true);\n    }\n\n    public static bool ShouldUseNativeAutoHeight(DjuiNodeJson node)\n    {\n        return UsesAutoHeight(node) && HasVisibleChildren(node) && !HasAutoSizeConflict(node, false);\n    }\n\n    private static bool UsesAutoWidth(DjuiNodeJson node)\n    {\n        var mode = node.Layout?.AutoSize;\n        return mode == "Width" || mode == "Both";\n    }\n\n    private static bool UsesAutoHeight(DjuiNodeJson node)\n    {\n        var mode = node.Layout?.AutoSize;\n        return mode == "Height" || mode == "Both";\n    }\n\n    private static bool GetChildAutoSizeConflict(DjuiNodeJson child, bool widthAxis, out string reason)\n    {\n        var anchor = child.Anchor;\n        var target = anchor?.Target ?? "parent";\n        var sideId = anchor?.Side ?? DefaultSide;\n        var stretchStyle = child.Stretch?.Style ?? "None";\n\n        if (target == "screen")\n        {\n            reason = "\u951A\u5B9A\u5230\u5C4F\u5E55\uFF0C\u5C3A\u5BF8\u4E0D\u5C5E\u4E8E\u7236\u5BB9\u5668\u5185\u5BB9\u6D41";\n            return true;\n        }\n\n        if (StretchUsesAxis(stretchStyle, widthAxis))\n        {\n            reason = widthAxis ? "\u6C34\u5E73\u62C9\u4F38\u4F9D\u8D56\u7236\u5BBD" : "\u5782\u76F4\u62C9\u4F38\u4F9D\u8D56\u7236\u9AD8";\n            return true;\n        }\n\n        if (sideId == "None" || target == "none")\n        {\n            reason = "";\n            return false;\n        }\n\n        if (!AnchorSides.TryGetValue(sideId, out var side))\n        {\n            reason = "";\n            return false;\n        }\n\n        if (widthAxis && Math.Abs(side.nx) > 0.001f)\n        {\n            reason = "\u6C34\u5E73\u4E2D/\u53F3\u951A\u70B9\u4F9D\u8D56\u7236\u5BBD";\n            return true;\n        }\n\n        if (!widthAxis && Math.Abs(side.ny - 1f) > 0.001f)\n        {\n            reason = "\u5782\u76F4\u4E2D/\u5E95\u951A\u70B9\u4F9D\u8D56\u7236\u9AD8";\n            return true;\n        }\n\n        reason = "";\n        return false;\n    }\n\n    private static bool StretchUsesAxis(string? style, bool widthAxis)\n    {\n        if (widthAxis) return style == "Horizontal" || style == "Both";\n        return style == "Vertical" || style == "Both";\n    }\n\n    private static bool HasVisibleChildren(DjuiNodeJson node)\n    {\n        foreach (var child in node.Children)\n        {\n            if (child.Basic?.Visible != false) return true;\n        }\n        return false;\n    }\n\n    private static bool HasAutoSizeConflict(DjuiNodeJson node, bool widthAxis)\n    {\n        var stretchStyle = node.Stretch?.Style ?? "None";\n        if (StretchUsesAxis(stretchStyle, widthAxis)) return true;\n\n        foreach (var child in node.Children)\n        {\n            if (child.Basic?.Visible == false) continue;\n            if (GetChildAutoSizeConflict(child, widthAxis, out _)) return true;\n        }\n\n        return false;\n    }\n\n    private static bool IsFinite(float value)\n    {\n        return !float.IsNaN(value) && !float.IsInfinity(value);\n    }\n}\n';

// raw:D:\git\DJUI\runtime\DjuiCanvasV6.cs
var DjuiCanvasV6_default = '// DJUI Runtime - pure protocol v6 canvas and top-down layout math\nusing System;\nusing System.Collections.Generic;\nusing System.IO;\nusing System.Text.Json.Serialization;\n\nnamespace DjuiRuntime;\n\npublic readonly struct DjuiRectV6\n{\n    public readonly float X, Y, Width, Height;\n    public DjuiRectV6(float x, float y, float width, float height) { X = x; Y = y; Width = width; Height = height; }\n}\n\npublic struct DjuiInsetsV6\n{\n    [JsonPropertyName("left")] public float Left { get; set; }\n    [JsonPropertyName("top")] public float Top { get; set; }\n    [JsonPropertyName("right")] public float Right { get; set; }\n    [JsonPropertyName("bottom")] public float Bottom { get; set; }\n    public DjuiInsetsV6(float left, float top, float right, float bottom) { Left = left; Top = top; Right = right; Bottom = bottom; }\n}\n\npublic sealed class DjuiCanvasPlanV6\n{\n    public float Scale { get; init; }\n    public DjuiRectV6 CanvasRect { get; init; }\n    public DjuiRectV6 ReferenceRect { get; init; }\n    public DjuiRectV6 SafeRect { get; init; }\n    public bool Wide { get; init; }\n}\n\npublic static class DjuiCanvasV6\n{\n    public static DjuiCanvasPlanV6 CreatePlan(float viewportWidth, float viewportHeight, DjuiInsetsV6 physicalSafeInsets, DjuiProjectV6 project)\n    {\n        float vw = Math.Max(1, viewportWidth), vh = Math.Max(1, viewportHeight);\n        float rw = Math.Max(1, project.Canvas.ReferenceWidth), rh = Math.Max(1, project.Canvas.ReferenceHeight);\n        float scale = CanvasScale(project.Canvas.Mode, vw, vh, rw, rh);\n        var canvas = new DjuiRectV6(0, 0, vw / scale, vh / scale);\n        var reference = new DjuiRectV6((canvas.Width - rw) * 0.5f, (canvas.Height - rh) * 0.5f, rw, rh);\n        var safe = Inset(canvas, new DjuiInsetsV6(physicalSafeInsets.Left / scale, physicalSafeInsets.Top / scale, physicalSafeInsets.Right / scale, physicalSafeInsets.Bottom / scale));\n        // \u5BBD\u5C4F\u6863\u5224\u5B9A\u5FC5\u987B\u65B9\u5411\u611F\u77E5\uFF1A\u53EA\u6709\u7269\u7406\u5BBD > \u9AD8 \u4E14\u6BD4\u503C\u8FBE\u5230\u9608\u503C\u624D\u7B97 wide\uFF0C\u7AD6\u5C4F\uFF08\u542B\u6298\u53E0\u5C4F\u5185\u5C4F\uFF09\u4E0D\u8FDB wide \u6863\n        bool wide = vw / vh >= project.Responsive.WideRatio;\n        return new DjuiCanvasPlanV6 { Scale = scale, CanvasRect = canvas, ReferenceRect = reference, SafeRect = safe, Wide = wide };\n    }\n\n    /// <summary>\n    /// \u5F15\u64CE\u5DF2\u7ECF\u8C03\u7528 SetDesignResolution \u540E\uFF0CSize \u4E0E SafeZonePadding \u90FD\u662F\u903B\u8F91\u5750\u6807\u3002\n    /// \u6B64\u5165\u53E3\u76F4\u63A5\u4F7F\u7528\u8BE5\u5750\u6807\uFF0C\u4E0D\u518D\u91CD\u590D\u7F29\u653E\u3002\n    /// </summary>\n    public static DjuiCanvasPlanV6 CreateLogicalPlan(float logicalWidth, float logicalHeight, DjuiInsetsV6 logicalSafeInsets, float physicalWidth, float physicalHeight, DjuiProjectV6 project)\n    {\n        float width = Math.Max(1, logicalWidth), height = Math.Max(1, logicalHeight);\n        float rw = Math.Max(1, project.Canvas.ReferenceWidth), rh = Math.Max(1, project.Canvas.ReferenceHeight);\n        var canvas = new DjuiRectV6(0, 0, width, height);\n        var reference = new DjuiRectV6((width - rw) * 0.5f, (height - rh) * 0.5f, rw, rh);\n        var safe = Inset(canvas, logicalSafeInsets);\n        float pw = Math.Max(1, physicalWidth), ph = Math.Max(1, physicalHeight);\n        return new DjuiCanvasPlanV6\n        {\n            Scale = 1,\n            CanvasRect = canvas,\n            ReferenceRect = reference,\n            SafeRect = safe,\n            // \u65B9\u5411\u611F\u77E5\uFF1A\u7269\u7406\u6A2A\u5411\u6BD4\u503C\u8FBE\u9608\u503C\u624D\u7B97 wide\uFF0C\u7AD6\u5C4F\u4E0D\u8FDB wide \u6863\n            Wide = pw / ph >= project.Responsive.WideRatio,\n        };\n    }\n\n    public static float CanvasScale(string mode, float vw, float vh, float rw, float rh)\n    {\n        vw = Math.Max(1, vw); vh = Math.Max(1, vh); rw = Math.Max(1, rw); rh = Math.Max(1, rh);\n        if (mode == "MatchWidth") return vw / rw;\n        if (mode == "MatchHeight") return vh / rh;\n        return Math.Min(vw / rw, vh / rh);\n    }\n\n    public static DjuiRectV6 Inset(DjuiRectV6 rect, DjuiInsetsV6 insets)\n    {\n        float l = Math.Max(0, insets.Left), t = Math.Max(0, insets.Top), r = Math.Max(0, insets.Right), b = Math.Max(0, insets.Bottom);\n        return new DjuiRectV6(rect.X + l, rect.Y + t, Math.Max(0, rect.Width - l - r), Math.Max(0, rect.Height - t - b));\n    }\n\n    public static DjuiRectV6 SelectSafeEdges(DjuiRectV6 canvas, DjuiRectV6 safe, IList<string>? edges)\n    {\n        bool all = edges == null;\n        bool l = all || edges!.Contains("left"), t = all || edges!.Contains("top"), r = all || edges!.Contains("right"), b = all || edges!.Contains("bottom");\n        return Inset(canvas, new DjuiInsetsV6(l ? safe.X - canvas.X : 0, t ? safe.Y - canvas.Y : 0, r ? canvas.X + canvas.Width - safe.X - safe.Width : 0, b ? canvas.Y + canvas.Height - safe.Y - safe.Height : 0));\n    }\n}\n\npublic static class DjuiLayoutSolverV6\n{\n    public static Dictionary<string, DjuiRectV6> SolveV6(DjuiPageV6 page, DjuiCanvasPlanV6 plan)\n    {\n        var solved = new Dictionary<string, DjuiRectV6>();\n        solved[page.Root.Id] = new DjuiRectV6(0, 0, plan.CanvasRect.Width, plan.CanvasRect.Height); // root is local to the window host\n        // \u56FE\u5E27\u951A\u5B9A:\u573A\u666F\u753B\u677F\u4F18\u5148\u663E\u5F0F\u58F0\u660E backgroundId\uFF1B\u65E7\u9875\u9762\u624D\u517C\u5BB9\u56DE\u9000\u5230\n        // \u6839\u4E0B\u7B2C\u4E00\u4E2A stretch Both + image \u8282\u70B9\u3002\u4E0D\u8981\u518D\u8BA9\u65B0\u9875\u9762\u4F9D\u8D56\u8282\u70B9\u987A\u5E8F\u3002\n        DjuiRectV6? imageFrame = null;\n        string? backgroundId = null;\n        foreach (var child in page.Root.Children)\n            if (!string.IsNullOrWhiteSpace(child.SceneFrame?.BackgroundId)) { backgroundId = child.SceneFrame.BackgroundId; break; }\n        foreach (var child in page.Root.Children)\n        {\n            var ap = child.Appearance;\n            var st = child.Stretch;\n            bool both = st?.Style == "Both";\n            bool hasImage = !string.IsNullOrEmpty(ap?.Image);\n            if (both && hasImage && (backgroundId == null || child.Id == backgroundId)) { imageFrame = ComputeImageFrame(solved: default, child, plan); break; }\n        }\n        foreach (var child in page.Root.Children) SolveTree(child, plan.CanvasRect, plan, solved, imageFrame);\n        return solved;\n    }\n\n    /// <summary>cover/contain \u540E\u56FE\u7247\u5728\u5BBF\u4E3B\u77E9\u5F62\u5185\u7684\u53EF\u89C1\u5E27(\u951A\u70B9\u6309 focal,\u9ED8\u8BA4\u5C45\u4E2D)\u3002</summary>\n    private static DjuiRectV6 ComputeImageFrame(DjuiRectV6 solved, DjuiNodeV6 host, DjuiCanvasPlanV6 plan)\n    {\n        var rect = SolveV6(host, plan.CanvasRect, plan);\n        var ap = host.Appearance;\n        float sw = ap?.SourceSize?.Width ?? 0, sh = ap?.SourceSize?.Height ?? 0;\n        if (sw <= 0 || sh <= 0) return rect;\n        float fx = Math.Clamp(ap?.FocalX ?? 0.5f, 0, 1), fy = Math.Clamp(ap?.FocalY ?? 0.5f, 0, 1);\n        string fit = ap?.ImageFit ?? "stretch";\n        if (fit == "contain")\n        {\n            float scale = Math.Min(rect.Width / sw, rect.Height / sh);\n            float w = sw * scale, h = sh * scale;\n            return new DjuiRectV6(rect.X + (rect.Width - w) * fx, rect.Y + (rect.Height - h) * fy, w, h);\n        }\n        // cover(\u9ED8\u8BA4\u6309 cover \u5904\u7406):\u56FE\u7F29\u653E\u94FA\u6EE1\u5BBF\u4E3B,\u53EF\u89C1\u5E27=\u5BBF\u4E3B\u5C3A\u5BF8,\u4F46\u5750\u6807\u7CFB\u53D6\u300C\u56FE\u5185\u5BB9\u5BF9\u9F50\u300D\u2014\n        // \u5BF9\u951A\u5B9A\u8BED\u4E49\u800C\u8A00,\u53EF\u89C1\u5E27\u5C31\u662F\u5BBF\u4E3B\u77E9\u5F62\u672C\u8EAB;\u5EFA\u7B51\u8981\u9489\u5728\u56FE\u4E0A,\u9700\u8981\u7684\u662F\u56FE\u7684\u5B8C\u6574\u7F29\u653E\u6846:\n        float scaleC = Math.Max(rect.Width / sw, rect.Height / sh);\n        float fw = sw * scaleC, fh = sh * scaleC;\n        return new DjuiRectV6(rect.X + (rect.Width - fw) * fx, rect.Y + (rect.Height - fh) * fy, fw, fh);\n    }\n\n    public static DjuiRectV6 SolveV6(DjuiNodeV6 node, DjuiRectV6 parent, DjuiCanvasPlanV6 plan, DjuiRectV6? imageFrame = null)\n    {\n        var a = node.Anchor; var t = node.Transform; var s = node.Stretch; var ar = node.AspectRatio;\n        string side = a?.Side ?? "TopLeft";\n        DjuiRectV6 reference = a?.Target == "screen" ? plan.CanvasRect : a?.Target == "safe" ? DjuiCanvasV6.SelectSafeEdges(plan.CanvasRect, plan.SafeRect, a.SafeEdges) : a?.Target == "image" ? (imageFrame ?? plan.CanvasRect) : parent;\n        float x, y, w = t?.Width ?? 100, h = t?.Height ?? 100;\n        bool hs = s?.Style == "Horizontal" || s?.Style == "Both", vs = s?.Style == "Vertical" || s?.Style == "Both";\n        var m = s?.Margins; float ml = m?.Left ?? 0, mt = m?.Top ?? 0, mr = m?.Right ?? 0, mb = m?.Bottom ?? 0;\n        Side(side, out float nx, out float ny);\n        // side=None \u8BED\u4E49:\u7236\u5BB9\u5668\u5C40\u90E8\u5750\u6807(\u4E0E\u7F16\u8F91\u5668 layoutSolver \u4E00\u81F4)\u3002\n        // \u66FE\u7ECF\u76F4\u63A5\u7528 t.X \u5F53\u53C2\u8003\u7CFB\u7EDD\u5BF9\u503C,\u7236\u5BB9\u5668\u88AB Center \u7B49\u951A\u5B9A\u4F4D\u540E\u5B50\u8282\u70B9\u6574\u4F53\u504F\u79FB\u3002\n        if (side == "None") { x = reference.X + (t?.X ?? 0); y = reference.Y + (t?.Y ?? 0); }\n        else { x = reference.X + nx * reference.Width + (t?.X ?? 0) - nx * w; y = reference.Y + ny * reference.Height + (t?.Y ?? 0) - ny * h; }\n        if (hs) { x = reference.X + ml; w = Math.Max(0, reference.Width - ml - mr); }\n        if (vs) { y = reference.Y + mt; h = Math.Max(0, reference.Height - mt - mb); }\n        if (ar != null && ar.Ratio > 0 && ar.Mode != "None")\n        {\n            if (ar.Mode == "WidthControlsHeight") { var next = w / ar.Ratio; y += (h - next) * 0.5f; h = next; }\n            else if (ar.Mode == "HeightControlsWidth") { var next = h * ar.Ratio; x += (w - next) * 0.5f; w = next; }\n            else if (ar.Mode == "FitInParent") { float scale = Math.Min(reference.Width / Math.Max(1, w), reference.Height / Math.Max(1, h)); w *= scale; h *= scale; x = reference.X + (reference.Width - w) * 0.5f; y = reference.Y + (reference.Height - h) * 0.5f; }\n        }\n        return new DjuiRectV6(x, y, w, h);\n    }\n\n    private readonly struct SceneSpace\n    {\n        public readonly DjuiRectV6 Frame;\n        public readonly float ScaleX, ScaleY;\n        public SceneSpace(DjuiRectV6 frame, DjuiSizeV6 artboard)\n        {\n            Frame = frame;\n            ScaleX = frame.Width / artboard.Width;\n            ScaleY = frame.Height / artboard.Height;\n        }\n        public DjuiRectV6 Map(DjuiRectV6 authored) => new(\n            Frame.X + authored.X * ScaleX,\n            Frame.Y + authored.Y * ScaleY,\n            authored.Width * ScaleX,\n            authored.Height * ScaleY);\n    }\n\n    private static void SolveTree(\n        DjuiNodeV6 node,\n        DjuiRectV6 parent,\n        DjuiCanvasPlanV6 plan,\n        Dictionary<string, DjuiRectV6> output,\n        DjuiRectV6? imageFrame = null,\n        SceneSpace? sceneSpace = null,\n        DjuiRectV6? sceneParent = null)\n    {\n        DjuiRectV6 rect;\n        DjuiRectV6 authoredRect = default;\n        if (sceneSpace != null)\n        {\n            string target = node.Anchor?.Target ?? "parent";\n            if (target != "parent")\n                throw new InvalidDataException($"DJUI v6: \u573A\u666F\u753B\u677F\u5185\u8282\u70B9 {node.Id} \u53EA\u80FD\u4F7F\u7528 parent \u951A\u70B9");\n            authoredRect = SolveV6(node, sceneParent ?? default, plan);\n            rect = sceneSpace.Value.Map(authoredRect);\n        }\n        else\n        {\n            rect = SolveV6(node, parent, plan, imageFrame);\n        }\n        output[node.Id] = rect;\n        var frame = node.SceneFrame;\n        if (frame?.Artboard is { Width: > 0, Height: > 0 })\n        {\n            var nextSpace = new SceneSpace(rect, frame.Artboard);\n            var authoredRoot = new DjuiRectV6(0, 0, frame.Artboard.Width, frame.Artboard.Height);\n            foreach (var child in node.Children) SolveTree(child, rect, plan, output, imageFrame, nextSpace, authoredRoot);\n            return;\n        }\n        foreach (var child in node.Children)\n            SolveTree(child, rect, plan, output, imageFrame, sceneSpace, sceneSpace != null ? authoredRect : null);\n    }\n\n\n    private static void Side(string side, out float x, out float y)\n    {\n        x = side == "Top" || side == "Center" || side == "Bottom" ? 0.5f : side == "TopRight" || side == "Right" || side == "BottomRight" ? 1 : 0;\n        y = side == "Left" || side == "Center" || side == "Right" ? 0.5f : side == "BottomLeft" || side == "Bottom" || side == "BottomRight" ? 1 : 0;\n    }\n}\n';

// raw:D:\git\DJUI\runtime\DjuiLayoutSessionV6.cs
var DjuiLayoutSessionV6_default = '#if CLIENT\n\nusing GameUI.Control;\nusing GameUI.Device;\nusing GameUI.Enum;\nusing GameUI.Struct;\n\nnamespace DjuiRuntime;\n\n/// <summary>\n/// v6 \u7A97\u53E3\u5B9E\u4F8B\u7684\u6301\u4E45\u5E03\u5C40\u4F1A\u8BDD\u3002\u63A7\u4EF6\u6811\u53EA\u6784\u5EFA\u4E00\u6B21\uFF0C\u89C6\u53E3\u53D8\u5316\u65F6\u539F\u5730\u5E94\u7528\u65B0\u77E9\u5F62\u3002\n/// </summary>\npublic sealed class DjuiLayoutSessionV6 : IDisposable\n{\n    private readonly ScreenViewport _viewport;\n    private readonly DjuiProjectV6 _project;\n    private readonly DjuiPageV6 _page;\n    private readonly Dictionary<string, Control> _controls = new();\n    private Action<DjuiNodeV6, Control>? _nodeUpdater;\n    private readonly Action<int, int> _sizeChanged;\n    private readonly Action<DisplayOrientations> _orientationChanged;\n    private readonly Action<float> _dprChanged;\n    private bool _disposed;\n\n    public string WindowInstanceId { get; }\n    public IReadOnlyDictionary<string, Control> Controls => _controls;\n    public DjuiCanvasPlanV6 CurrentPlan { get; private set; }\n    public DjuiPageV6 CurrentPage { get; private set; }\n\n    public DjuiLayoutSessionV6(string windowInstanceId, DjuiProjectV6 project, DjuiPageV6 page, ScreenViewport? viewport = null)\n    {\n        if (string.IsNullOrWhiteSpace(windowInstanceId)) throw new ArgumentException("\u7A97\u53E3\u5B9E\u4F8B ID \u4E0D\u80FD\u4E3A\u7A7A", nameof(windowInstanceId));\n        WindowInstanceId = windowInstanceId;\n        _project = project ?? throw new ArgumentNullException(nameof(project));\n        _page = page ?? throw new ArgumentNullException(nameof(page));\n        _viewport = viewport ?? DeviceInfo.PrimaryViewport;\n        CurrentPlan = CreateCurrentPlan();\n        CurrentPage = DjuiResponsiveResolverV6.Resolve(_page, CurrentPlan.Wide);\n        _sizeChanged = (_, _) => Relayout();\n        _orientationChanged = _ => Relayout();\n        _dprChanged = _ => Relayout();\n        _viewport.OnSizeChanged += _sizeChanged;\n        _viewport.OnOrientationChanged += _orientationChanged;\n        _viewport.OnDevicePixelRatioChanged += _dprChanged;\n    }\n\n    public void Register(string nodeInstanceId, Control control)\n    {\n        ObjectDisposedException.ThrowIf(_disposed, this);\n        if (string.IsNullOrWhiteSpace(nodeInstanceId)) throw new ArgumentException("\u8282\u70B9\u5B9E\u4F8B ID \u4E0D\u80FD\u4E3A\u7A7A", nameof(nodeInstanceId));\n        if (!_controls.TryAdd(nodeInstanceId, control)) throw new InvalidOperationException($"DJUI v6: \u5B9E\u4F8B {WindowInstanceId} \u5185\u8282\u70B9 ID \u91CD\u590D: {nodeInstanceId}");\n    }\n\n    public void SetNodeUpdater(Action<DjuiNodeV6, Control> updater)\n    {\n        ObjectDisposedException.ThrowIf(_disposed, this);\n        _nodeUpdater = updater ?? throw new ArgumentNullException(nameof(updater));\n    }\n\n    public T? GetControl<T>(string nodeInstanceId) where T : Control\n    {\n        return _controls.TryGetValue(nodeInstanceId, out var control) ? control as T : null;\n    }\n\n    public void Relayout()\n    {\n        ObjectDisposedException.ThrowIf(_disposed, this);\n        CurrentPlan = CreateCurrentPlan();\n        CurrentPage = DjuiResponsiveResolverV6.Resolve(_page, CurrentPlan.Wide);\n        var nodes = new Dictionary<string, DjuiNodeV6>(StringComparer.Ordinal);\n        IndexNodes(CurrentPage.Root, nodes);\n        var solved = DjuiLayoutSolverV6.SolveV6(CurrentPage, CurrentPlan);\n        var parents = new Dictionary<string, string?>(StringComparer.Ordinal);\n        IndexParents(CurrentPage.Root, null, parents);\n        foreach (var (nodeId, rect) in solved)\n        {\n            if (!_controls.TryGetValue(nodeId, out var control)) continue;\n            var localRect = rect;\n            if (parents.TryGetValue(nodeId, out var parentId) && parentId != null && solved.TryGetValue(parentId, out var parentRect))\n                localRect = new DjuiRectV6(rect.X - parentRect.X, rect.Y - parentRect.Y, rect.Width, rect.Height);\n            ApplyRect(control, localRect);\n            if (_nodeUpdater != null && nodes.TryGetValue(nodeId, out var node)) _nodeUpdater(node, control);\n        }\n    }\n\n    private static void IndexNodes(DjuiNodeV6 node, Dictionary<string, DjuiNodeV6> nodes)\n    {\n        if (!nodes.TryAdd(node.Id, node)) throw new InvalidDataException($"DJUI v6: expanded node ID duplicate: {node.Id}");\n        foreach (var child in node.Children) IndexNodes(child, nodes);\n    }\n\n    private static void IndexParents(DjuiNodeV6 node, string? parentId, Dictionary<string, string?> parents)\n    {\n        parents[node.Id] = parentId;\n        foreach (var child in node.Children) IndexParents(child, node.Id, parents);\n    }\n\n    public static void ApplyRect(Control control, DjuiRectV6 rect)\n    {\n        control.PositionType = UIPositionType.Absolute;\n        control.HorizontalAlignment = HorizontalAlignment.Left;\n        control.VerticalAlignment = VerticalAlignment.Top;\n        control.Position = new UIPosition(rect.X, rect.Y);\n        control.Width = rect.Width;\n        control.Height = rect.Height;\n    }\n\n    private DjuiCanvasPlanV6 CreateCurrentPlan()\n    {\n        var size = _viewport.Size;\n        var safe = _viewport.SafeZonePadding;\n        Game.Logger.LogInformation($"DJUI v6 layout: viewport.Size={size.Width}x{size.Height} px={_viewport.WidthPx}x{_viewport.HeightPx} safe={safe.Left},{safe.Top},{safe.Right},{safe.Bottom} canvas={CurrentPlan?.CanvasRect.Width ?? -1}x{CurrentPlan?.CanvasRect.Height ?? -1}");\n        // \u5E03\u5C40\u5BF9\u9F50\u8BCA\u65AD:\u8F93\u51FA\u5173\u952E\u8282\u70B9\u89E3\u7B97\u77E9\u5F62(\u8BBE\u8BA1\u5750\u6807\u7CFB),\u914D\u5408 viewport \u65E5\u5FD7\u53EF\u4EBA\u5DE5\u6838\u7B97\u5BF9\u9F50\n        try\n        {\n            var solved = DjuiLayoutSolverV6.SolveV6(CurrentPage, DjuiCanvasV6.CreateLogicalPlan(size.Width, size.Height, new DjuiInsetsV6(safe.Left, safe.Top, safe.Right, safe.Bottom), _viewport.WidthPx, _viewport.HeightPx, _project));\n            var pick = new[] { "scene_background", "building_group", "scene02_background", "scene02_building_group", "scene03_hangzhou_background", "scene03_hangzhou_building_group" };\n            foreach (var id in pick)\n                if (solved.TryGetValue(id, out var r))\n                    Game.Logger.LogInformation($"DJUI v6 rect {id}: ({r.X:F1},{r.Y:F1}) {r.Width:F1}x{r.Height:F1}");\n        }\n        catch { /* \u8BCA\u65AD\u5931\u8D25\u4E0D\u5F71\u54CD\u5E03\u5C40 */ }\n        // Size \u4E0E SafeZonePadding \u5747\u5DF2\u7ECF\u662F\u5F15\u64CE\u5F53\u524D\u8BBE\u8BA1\u5750\u6807\uFF1B\u4E0D\u518D\u505A\u7B2C\u4E8C\u6B21 DPR \u6216 Canvas \u7F29\u653E\u3002\n        return DjuiCanvasV6.CreateLogicalPlan(\n            size.Width,\n            size.Height,\n            new DjuiInsetsV6(safe.Left, safe.Top, safe.Right, safe.Bottom),\n            _viewport.WidthPx,\n            _viewport.HeightPx,\n            _project);\n    }\n\n    public void Dispose()\n    {\n        if (_disposed) return;\n        _disposed = true;\n        _viewport.OnSizeChanged -= _sizeChanged;\n        _viewport.OnOrientationChanged -= _orientationChanged;\n        _viewport.OnDevicePixelRatioChanged -= _dprChanged;\n        _controls.Clear();\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiImageVisualLayerV6.cs
var DjuiImageVisualLayerV6_default = `// DJUI Runtime - protocol v6 internal image visual sublayer
#if CLIENT

using GameUI.Control;

namespace DjuiRuntime;

/// <summary>
/// Manages non-authored image children. StarEngine's public Texture API exposes only Path,
/// so contain/cover use appearance.sourceSize as the synchronous intrinsic-size contract.
/// </summary>
internal sealed class DjuiImageVisualLayerV6 : IDisposable
{
    internal const string ReservedNamePrefix = "__djui.v6.visual.image.";
    private readonly Dictionary<Control, Panel> _visuals = new();
    private readonly HashSet<string> _warnedMissingSourceSize = new(StringComparer.Ordinal);

    public void Apply(string nodeId, Control authored, DjuiAppearanceV6? appearance)
    {
        var image = appearance?.Image;
        if (string.IsNullOrWhiteSpace(image))
        {
            Remove(authored);
            authored.ClipContent = appearance?.ClipContent ?? false;
            return;
        }

        // The authored control remains layout/control only; rendering lives in one persistent static child.
        authored.Image = "";
        if (!_visuals.TryGetValue(authored, out var visual))
        {
            visual = new Panel { Name = ReservedNamePrefix + nodeId, IsStatic = true };
            visual.Parent = authored;
            _visuals.Add(authored, visual);
        }

        visual.Image = image;
        visual.Desaturated = appearance?.Desaturated ?? false;
        visual.ImageFlipX = appearance?.ImageFlipX ?? false;
        visual.ImageFlipY = appearance?.ImageFlipY ?? false;
        // \u56FE\u7247\u5B9E\u9645\u7ED8\u5236\u5728 visual \u5B50\u8282\u70B9\uFF1B\u4E5D\u5BAB\u683C\u8FB9\u8DDD\u4E5F\u5FC5\u987B\u843D\u5728\u8BE5\u8282\u70B9\uFF0C
        // \u4E0D\u80FD\u53EA\u8BBE\u7F6E\u5BBF\u4E3B authored\uFF08\u5BBF\u4E3B\u81EA\u8EAB Image \u5DF2\u88AB\u6E05\u7A7A\uFF09\u3002
        visual.SlicedEdges = appearance?.SlicedEdges is { Length: 4 } edges
            ? new Thickness(edges[0], edges[1], edges[2], edges[3])
            : new Thickness(0, 0, 0, 0);

        var fit = appearance?.ImageFit ?? "stretch";
        var cover = string.Equals(fit, "cover", StringComparison.Ordinal);
        authored.ClipContent = cover || (appearance?.ClipContent ?? false);

        var parentWidth = Math.Max(0, authored.Width);
        var parentHeight = Math.Max(0, authored.Height);
        var x = 0f;
        var y = 0f;
        var width = parentWidth;
        var height = parentHeight;
        var source = appearance?.SourceSize;
        if (!string.Equals(fit, "stretch", StringComparison.Ordinal) && source is { Width: > 0, Height: > 0 })
        {
            var scale = cover
                ? MathF.Max(parentWidth / source.Width, parentHeight / source.Height)
                : MathF.Min(parentWidth / source.Width, parentHeight / source.Height);
            width = source.Width * scale;
            height = source.Height * scale;
            var focalX = Math.Clamp(appearance?.FocalX ?? 0.5f, 0, 1);
            var focalY = Math.Clamp(appearance?.FocalY ?? 0.5f, 0, 1);
            x = (parentWidth - width) * focalX;
            y = (parentHeight - height) * focalY;
        }
        else if (!string.Equals(fit, "stretch", StringComparison.Ordinal) && _warnedMissingSourceSize.Add(nodeId + "\\n" + image))
        {
            Game.Logger.LogWarning("DJUI v6: node {NodeId} uses imageFit={ImageFit} without positive appearance.sourceSize; falling back to stretch because StarEngine does not expose synchronous intrinsic texture dimensions.", nodeId, fit);
        }

        DjuiLayoutSessionV6.ApplyRect(visual, new DjuiRectV6(x, y, width, height));
    }

    /// <summary>\u53D6\u56DE\u5BBF\u4E3B\u5BF9\u5E94\u7684 visual \u5B50 Panel\uFF08\u672A\u521B\u5EFA\u56FE\u7247\u5C42\u65F6\u4E3A null\uFF09\u3002\u6309\u94AE\u72B6\u6001\u673A\u7528\u5B83\u5207\u6362\u72B6\u6001\u56FE\u3002</summary>
    internal Panel? GetVisual(Control authored) => _visuals.TryGetValue(authored, out var visual) ? visual : null;

    private void Remove(Control authored)
    {
        authored.Image = "";
        if (!_visuals.Remove(authored, out var visual)) return;
        visual.Dispose();
    }

    public void Dispose()
    {
        foreach (var visual in _visuals.Values) visual.Dispose();
        _visuals.Clear();
        _warnedMissingSourceSize.Clear();
    }
}

#endif
`;

// raw:D:\git\DJUI\runtime\DjuiProgressVisualLayerV6.cs
var DjuiProgressVisualLayerV6_default = `// DJUI Runtime - v6 linear progress visual layer
#if CLIENT

using GameUI.Control;
using GameUI.Enum;
using GameUI.Struct;

namespace DjuiRuntime;

/// <summary>
/// Renders linear Progress nodes as a rounded clipping host plus a full-size image.
/// The image is never compressed to the current value, so tiny values keep their round cap.
/// Circular modes stay on StarEngine's native Progress path.
/// </summary>
internal sealed class DjuiProgressVisualLayerV6 : IDisposable, IThinker
{
    internal const string ReservedNamePrefix = "__djui.v6.visual.progress.";
    private static readonly Dictionary<Progress, DjuiProgressVisualLayerV6> Owners = new();
    private readonly Dictionary<Progress, State> _states = new();
    private bool _disposed;

    public bool DoesThink { get; set; } = true;

    public DjuiProgressVisualLayerV6()
    {
        Game.RegisterThinker(this);
    }

    public void Apply(string nodeId, Progress authored, DjuiAppearanceV6? appearance)
    {
        authored.Image = "";
        authored.SlicedEdges = new Thickness(0, 0, 0, 0);

        if (string.IsNullOrWhiteSpace(appearance?.Image))
        {
            Remove(authored);
            return;
        }

        if (!_states.TryGetValue(authored, out var state))
        {
            var host = new Panel
            {
                Name = ReservedNamePrefix + nodeId,
                IsStatic = true,
                ClipContent = true,
            };
            var image = new Panel
            {
                Name = ReservedNamePrefix + nodeId + ".image",
                IsStatic = true,
            };
            image.Parent = host;
            host.Parent = authored;
            state = new State(authored, host, image);
            _states.Add(authored, state);
            Owners[authored] = this;
        }

        state.ImagePath = appearance.Image!;
        state.Appearance = appearance;
        Refresh(state, force: true);
    }

    internal static void NotifyValueChanged(Progress progress)
    {
        if (Owners.TryGetValue(progress, out var owner)) owner.Refresh(progress, force: true);
    }

    public void Think(int delta)
    {
        if (_disposed) return;
        foreach (var state in _states.Values.ToArray())
        {
            if (!state.Progress.IsValid)
            {
                Remove(state.Progress);
                continue;
            }

            Refresh(state, force: false);
        }
    }

    private void Refresh(Progress progress, bool force)
    {
        if (_states.TryGetValue(progress, out var state)) Refresh(state, force);
    }

    private void Refresh(State state, bool force)
    {
        var progress = state.Progress;
        if (!progress.IsValid) return;

        var width = Math.Max(0, progress.Width);
        var height = Math.Max(0, progress.Height);
        var value = Math.Clamp(progress.Value, 0f, 1f);
        if (!force && MathF.Abs(value - state.LastValue) < 0.0001f &&
            MathF.Abs(width - state.LastWidth) < 0.01f && MathF.Abs(height - state.LastHeight) < 0.01f)
            return;

        state.LastValue = value;
        state.LastWidth = width;
        state.LastHeight = height;

        var mode = progress.ProgressionMode;
        var horizontal = mode is ProgressionMode.LeftToRight or ProgressionMode.RightToLeft;
        var reverse = mode is ProgressionMode.RightToLeft or ProgressionMode.BottomToTop;
        var fillWidth = horizontal ? width * value : width;
        var fillHeight = horizontal ? height : height * value;
        var fillX = horizontal && reverse ? width - fillWidth : 0;
        var fillY = !horizontal && reverse ? height - fillHeight : 0;

        var radius = state.Appearance?.CornerRadius ?? MathF.Min(width, height) / 2f;
        radius = Math.Clamp(radius, 0, MathF.Min(fillWidth, fillHeight) / 2f);
        state.Host.CornerRadius = radius;
        state.Host.ClipContent = true;
        state.Host.Visible = value > 0.0001f && fillWidth > 0 && fillHeight > 0;
        DjuiLayoutSessionV6.ApplyRect(state.Host, new DjuiRectV6(fillX, fillY, fillWidth, fillHeight));

        var imageRect = CalculateImageRect(width, height, state.Appearance);
        DjuiLayoutSessionV6.ApplyRect(
            state.Image,
            new DjuiRectV6(imageRect.X - fillX, imageRect.Y - fillY, imageRect.Width, imageRect.Height));
        state.Image.Image = state.ImagePath;
        state.Image.Desaturated = state.Appearance?.Desaturated ?? false;
        state.Image.ImageFlipX = state.Appearance?.ImageFlipX ?? false;
        state.Image.ImageFlipY = state.Appearance?.ImageFlipY ?? false;
        state.Image.SlicedEdges = state.Appearance?.SlicedEdges is { Length: 4 } edges
            ? new Thickness(edges[0], edges[1], edges[2], edges[3])
            : new Thickness(0, 0, 0, 0);
    }

    private static DjuiRectV6 CalculateImageRect(float width, float height, DjuiAppearanceV6? appearance)
    {
        var fit = appearance?.ImageFit ?? "stretch";
        var source = appearance?.SourceSize;
        if (string.Equals(fit, "stretch", StringComparison.Ordinal) || source is not { Width: > 0, Height: > 0 })
            return new DjuiRectV6(0, 0, width, height);

        var cover = string.Equals(fit, "cover", StringComparison.Ordinal);
        var scale = cover
            ? MathF.Max(width / source.Width, height / source.Height)
            : MathF.Min(width / source.Width, height / source.Height);
        var imageWidth = source.Width * scale;
        var imageHeight = source.Height * scale;
        var focalX = Math.Clamp(appearance?.FocalX ?? 0.5f, 0, 1);
        var focalY = Math.Clamp(appearance?.FocalY ?? 0.5f, 0, 1);
        return new DjuiRectV6(
            (width - imageWidth) * focalX,
            (height - imageHeight) * focalY,
            imageWidth,
            imageHeight);
    }

    private void Remove(Progress progress)
    {
        if (!_states.Remove(progress, out var state)) return;
        Owners.Remove(progress);
        state.Host.RemoveFromVisualTreeAndParent();
        state.Host.Dispose();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var progress in _states.Keys.ToArray()) Remove(progress);
        _states.Clear();
    }

    private sealed class State
    {
        public State(Progress progress, Panel host, Panel image)
        {
            Progress = progress;
            Host = host;
            Image = image;
        }

        public Progress Progress { get; }
        public Panel Host { get; }
        public Panel Image { get; }
        public string ImagePath { get; set; } = "";
        public DjuiAppearanceV6? Appearance { get; set; }
        public float LastValue { get; set; } = -1;
        public float LastWidth { get; set; } = -1;
        public float LastHeight { get; set; } = -1;
    }
}

#endif
`;

// raw:D:\git\DJUI\runtime\DjuiButtonStateV6.cs
var DjuiButtonStateV6_default = '// DJUI Runtime - protocol v6 button visual state machine\n#if CLIENT\n\nusing System.Runtime.CompilerServices;\nusing GameUI.Control;\nusing GameUI.Control.Primitive;\n\nnamespace DjuiRuntime;\n\n/// <summary>\n/// Button \u56DB\u6001\u89C6\u89C9\uFF08normal/hover/pressed/disabled\uFF09\u7684 Runtime \u72B6\u6001\u673A\u3002\n/// StarEngine \u7684 Button \u53EA\u66B4\u9732 ImageHover/ImagePressed \u4E14\u6CA1\u6709 ImageDisabled\uFF1B\n/// \u800C v6 \u7684\u56FE\u7247\u7ED8\u5236\u5728 visual \u5B50 Panel \u4E0A\uFF08\u5BBF\u4E3B Image \u88AB\u6E05\u7A7A\uFF09\uFF0C\u5F15\u64CE\u72B6\u6001\u6362\u56FE\u5B9E\u9645\u4E0D\u53EF\u7528\u3002\n/// \u56E0\u6B64\u8FD9\u91CC\u76D1\u542C\u5BBF\u4E3B\u6307\u9488\u4E8B\u4EF6\uFF0C\u5728 visual \u5C42\u81EA\u7BA1\u6362\u56FE\uFF0C\u7981\u7528\u6001\u672A\u914D\u7F6E\u56FE\u7247\u65F6\u81EA\u52A8\u7070\u5316\u515C\u5E95\u3002\n/// </summary>\npublic sealed class DjuiButtonStateV6 : IDisposable\n{\n    /// <summary>Button \u5185\u5EFA\u6587\u672C\u5B50\u8282\u70B9\u540D\uFF0C\u4E0E DjuiTreeBuilderV6 \u521B\u5EFA\u7684 label \u5171\u7528\u3002</summary>\n    internal const string ButtonLabelName = "__djui.v6.visual.button-label";\n\n    /// <summary>\u7981\u7528\u515C\u5E95\uFF08\u672A\u914D\u7F6E\u7981\u7528\u56FE\uFF09\u65F6\u7684\u6574\u4F53\u900F\u660E\u5EA6\u7CFB\u6570\u3002\u89C6\u89C9\u5F3A\u5EA6\u5F85\u5B9E\u6D4B\u540E\u53EF\u8C03\u6574\u3002</summary>\n    public const float DisabledFallbackOpacity = 0.5f;\n\n    private readonly Control _button;\n    private readonly DjuiImageVisualLayerV6 _imageVisuals;\n    private DjuiButtonV6? _config;\n    private string? _normalImage;\n    private float _authoredOpacity;\n    private bool _authoredDesaturated;\n    private bool _hover;\n    private bool _pressed;\n    /// <summary>\u5F53\u524D\u89C6\u89C9\u5DF2\u5448\u73B0\u7684\u7981\u7528\u72B6\u6001\uFF1Bnull \u8868\u793A\u9700\u8981\u5F3A\u5236\u91CD\u5199\u4E00\u6B21\uFF08\u5982\u5BBD\u5C4F\u91CD\u653E\u540E\uFF09\u3002</summary>\n    private bool? _visualDisabled;\n\n    internal DjuiButtonStateV6(Control button, DjuiImageVisualLayerV6 imageVisuals, DjuiButtonV6? config, string? normalImage, float authoredOpacity, bool authoredDesaturated)\n    {\n        _button = button;\n        _imageVisuals = imageVisuals;\n        _config = config;\n        _normalImage = normalImage;\n        _authoredOpacity = authoredOpacity;\n        _authoredDesaturated = authoredDesaturated;\n    }\n\n    /// <summary>\u5BBF\u4E3B/\u5BBD\u5C4F\u91CD\u653E\u540E\u66F4\u65B0\u914D\u7F6E\u5E76\u91CD\u7B97\u89C6\u89C9\u3002</summary>\n    internal void Update(DjuiButtonV6? config, string? normalImage, float authoredOpacity, bool authoredDesaturated)\n    {\n        _config = config;\n        _normalImage = normalImage;\n        _authoredOpacity = authoredOpacity;\n        _authoredDesaturated = authoredDesaturated;\n        _visualDisabled = null;\n        Apply();\n    }\n\n    /// <summary>\u6309\u5F53\u524D\u6307\u9488/\u7981\u7528\u72B6\u6001\u91CD\u7B97 visual \u56FE\u7247\u3001\u7070\u5EA6\u4E0E\u6574\u4F53\u900F\u660E\u5EA6\u3002</summary>\n    internal void Apply()\n    {\n        if (!_button.IsValid) return;\n        var disabled = _button.IsActuallyDisabled;\n        var visual = _imageVisuals.GetVisual(_button);\n\n        string? image;\n        var desaturated = _authoredDesaturated;\n        // Opacity \u53EA\u5728\u7981\u7528\u6001\u5207\u6362\u65F6\u5199\u5165\uFF0C\u907F\u514D\u4E0E TouchBehavior \u7684\u6309\u538B\u7F29\u653E/\u900F\u660E\u52A8\u753B\u4E92\u76F8\u8986\u76D6\u3002\n        var writeOpacity = _visualDisabled != disabled;\n\n        if (disabled)\n        {\n            var disabledImage = _config?.ImageDisabled;\n            if (!string.IsNullOrEmpty(disabledImage))\n            {\n                image = disabledImage;\n            }\n            else\n            {\n                // \u7070\u5316\u515C\u5E95\uFF1A\u65E0\u7981\u7528\u56FE\u65F6\u4FDD\u6301 normal \u56FE\uFF0C\u5957\u7070\u5EA6\u5E76\u6574\u4F53\u964D\u900F\u660E\u3002\n                // Opacity \u4F9D\u8D56\u5F15\u64CE\u7684\u5408\u6210\u7EA7\u8054\uFF0Cvisual \u5B50\u56FE\u4E0E\u6587\u672C label \u4F1A\u4E00\u5E76\u53D8\u6DE1\u3002\n                image = _normalImage;\n                desaturated = true;\n                if (writeOpacity) _button.Opacity = _authoredOpacity * DisabledFallbackOpacity;\n            }\n        }\n        else\n        {\n            image = ResolveInteractiveImage();\n            if (writeOpacity) _button.Opacity = _authoredOpacity;\n        }\n        _visualDisabled = disabled;\n\n        if (visual != null)\n        {\n            visual.Image = image ?? "";\n            visual.Desaturated = desaturated;\n        }\n    }\n\n    private string? ResolveInteractiveImage()\n    {\n        if (_pressed && !string.IsNullOrEmpty(_config?.ImagePressed)) return _config!.ImagePressed;\n        if (_hover && !string.IsNullOrEmpty(_config?.ImageHover)) return _config!.ImageHover;\n        return _normalImage;\n    }\n\n    public void Dispose()\n    {\n        _button.OnPointerEntered -= HandlePointerEntered;\n        _button.OnPointerExited -= HandlePointerExited;\n        _button.OnPointerPressed -= HandlePointerPressed;\n        _button.OnPointerReleased -= HandlePointerReleased;\n    }\n\n    internal void HandlePointerEntered(object? sender, EventArgs e) { _hover = true; Apply(); }\n    internal void HandlePointerExited(object? sender, EventArgs e) { _hover = false; Apply(); }\n    internal void HandlePointerPressed(object? sender, PointerEventArgs e) { _pressed = true; Apply(); }\n    internal void HandlePointerReleased(object? sender, PointerEventArgs e) { _pressed = false; Apply(); }\n}\n\n/// <summary>\n/// \u6BCF\u68F5 v6 \u6811\u6301\u6709\u7684\u6309\u94AE\u72B6\u6001\u673A\u6CE8\u518C\u8868\uFF1B\u53E6\u4EE5\u5F31\u8868\u66B4\u9732\u5168\u5C40\u5237\u65B0\u901A\u9053\u7ED9\u7ED1\u5B9A\u7CFB\u7EDF\u4F7F\u7528\u3002\n/// </summary>\ninternal sealed class DjuiButtonStateRegistryV6 : IDisposable\n{\n    private static readonly ConditionalWeakTable<Control, DjuiButtonStateV6> States = new();\n\n    private readonly DjuiImageVisualLayerV6 _imageVisuals;\n    private readonly Dictionary<Control, DjuiButtonStateV6> _states = new();\n\n    public DjuiButtonStateRegistryV6(DjuiImageVisualLayerV6 imageVisuals) => _imageVisuals = imageVisuals;\n\n    /// <summary>\u4E3A Button \u5BBF\u4E3B\u521B\u5EFA\uFF08\u6216\u66F4\u65B0\uFF09\u72B6\u6001\u673A\u3002\u65E0 button \u914D\u7F6E\u7684\u6309\u94AE\u4E5F\u4F1A\u521B\u5EFA\u2014\u2014\u7981\u7528\u7070\u5316\u515C\u5E95\u4E0D\u4F9D\u8D56\u72B6\u6001\u56FE\u3002</summary>\n    internal void Attach(Control button, DjuiButtonV6? config, string? normalImage, float authoredOpacity, bool authoredDesaturated)\n    {\n        if (_states.TryGetValue(button, out var existing))\n        {\n            existing.Update(config, normalImage, authoredOpacity, authoredDesaturated);\n            return;\n        }\n        var state = new DjuiButtonStateV6(button, _imageVisuals, config, normalImage, authoredOpacity, authoredDesaturated);\n        _states[button] = state;\n        States.AddOrUpdate(button, state);\n        button.OnPointerEntered += state.HandlePointerEntered;\n        button.OnPointerExited += state.HandlePointerExited;\n        button.OnPointerPressed += state.HandlePointerPressed;\n        button.OnPointerReleased += state.HandlePointerReleased;\n        state.Apply();\n    }\n\n    /// <summary>\u7ED1\u5B9A\u7CFB\u7EDF/\u5E2E\u52A9 API \u901A\u9053\uFF1A\u6309\u63A7\u4EF6\u5237\u65B0\u7981\u7528\u89C6\u89C9\uFF08\u975E DJUI \u7BA1\u7406\u7684\u6309\u94AE\u662F no-op\uFF09\u3002</summary>\n    internal static void RefreshVisual(Control control)\n    {\n        if (States.TryGetValue(control, out var state)) state.Apply();\n    }\n\n    public void Dispose()\n    {\n        foreach (var state in _states.Values) state.Dispose();\n        _states.Clear();\n    }\n}\n\n/// <summary>\u6E38\u620F\u4FA7\u52A8\u6001\u7981\u7528\u5165\u53E3\uFF1A\u540C\u6B65\u5F15\u64CE\u4EA4\u4E92\u5C5E\u6027\u5E76\u5237\u65B0 DJUI \u7981\u7528\u89C6\u89C9\u3002</summary>\npublic static class DjuiButtonState\n{\n    /// <summary>\n    /// \u8FD0\u884C\u65F6\u5207\u6362\u63A7\u4EF6\u7981\u7528\u72B6\u6001\u3002\u76F4\u63A5\u7ED9\u5F15\u64CE\u63A7\u4EF6\u8D4B Disabled \u4E0D\u4F1A\u5237\u65B0 DJUI \u7981\u7528\u89C6\u89C9\n    /// \uFF08\u5F15\u64CE\u6CA1\u6709 Disabled \u53D8\u66F4\u901A\u77E5\uFF09\uFF0C\u9700\u8981\u52A8\u6001\u5207\u6362\u65F6\u8BF7\u4E00\u5F8B\u8D70\u672C\u65B9\u6CD5\u6216 disabled \u7ED1\u5B9A\u3002\n    /// </summary>\n    public static void SetDisabled(Control control, bool disabled)\n    {\n        control.Disabled = disabled;\n        DjuiButtonStateRegistryV6.RefreshVisual(control);\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiTreeBuilderV6.cs
var DjuiTreeBuilderV6_default = `// DJUI Runtime - focused protocol v6 persistent authored-tree builder
#if CLIENT

using System.Text.Json;
using System.Text.RegularExpressions;
using GameUI.Control;
using GameUI.Control.Primitive;
using GameUI.Control.Behavior;
using GameUI.Control.Extensions;
using GameUI.Extensions;
using GameUI.Enum;
using GameUI.Struct;

namespace DjuiRuntime;

/// <summary>
/// Owns one v6 authored control tree and its persistent layout session.
/// The host is a mounting boundary, not an authored node and is never registered in the session.
/// </summary>
public sealed class DjuiTreeInstanceV6 : IDisposable
{
    private bool _disposed;

    public Panel Host { get; }
    public Panel Root { get; }
    public DjuiLayoutSessionV6 Session { get; }
    public bool OwnsHost { get; }
    private readonly DjuiImageVisualLayerV6 _imageVisuals;
    private readonly DjuiProgressVisualLayerV6 _progressVisuals;
    private readonly DjuiButtonStateRegistryV6 _buttonStates;
    private readonly List<IDisposable> _bindingRegistrations;

    internal DjuiTreeInstanceV6(Panel host, Panel root, DjuiLayoutSessionV6 session, bool ownsHost, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, List<IDisposable> bindingRegistrations)
    {
        Host = host;
        Root = root;
        Session = session;
        OwnsHost = ownsHost;
        _imageVisuals = imageVisuals;
        _progressVisuals = progressVisuals;
        _buttonStates = buttonStates;
        _bindingRegistrations = bindingRegistrations;
    }

    public T? GetControl<T>(string nodeId) where T : Control => Session.GetControl<T>(nodeId);

    // CloneControl \u6784\u5EFA\u7BA1\u7EBF\u5165\u53E3\uFF08BuildClone \u4F7F\u7528\uFF09
    internal DjuiImageVisualLayerV6 ImageVisuals => _imageVisuals;
    internal DjuiProgressVisualLayerV6 ProgressVisuals => _progressVisuals;
    internal DjuiButtonStateRegistryV6 ButtonStates => _buttonStates;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var registration in _bindingRegistrations) registration.Dispose();
        _bindingRegistrations.Clear();

        // R5\uFF080.7.18\uFF09\uFF1A\u9500\u6BC1\u6811\u524D\u63D0\u524D\u6E05\u7A7A behaviors\u2014\u2014\u63A7\u4EF6\u8FDB\u5165 Dispose \u540E IsValid \u5373\u5931\u6548\uFF0C
        // \u5F15\u64CE DisposeManaged \u4ECD\u4F1A ClearBehaviors\uFF0CTouchBehavior.OnDetached \u5728\u5931\u6548\u6001\u6062\u590D\u6309\u538B
        // \u5FEB\u7167\u5199 Oplicity \u4F1A\u629B "Control is not valid"\uFF08\u5173\u7A97\u8F6C\u573A FinalizeClose \u8DEF\u5F84\u5FC5\u73B0\u4E00\u6B21\uFF09\u3002
        // \u6B64\u5904\u63A7\u4EF6\u4ECD\u6709\u6548\uFF0COnDetached \u5728\u5408\u6CD5\u65F6\u673A\u6267\u884C\uFF0C\u4ECE\u6839\u4E0A\u7ED5\u5F00\u7ADE\u6001\u3002
        foreach (var control in Session.Controls.Values)
        {
            if (control.IsValid) control.ClearBehaviors();
        }

        foreach (var control in Session.Controls.Values) DjuiEffectPlayer.Stop(control);
        Session.Dispose();
        _imageVisuals.Dispose();
        _progressVisuals.Dispose();
        _buttonStates.Dispose();

        // R5 \u515C\u5E95\uFF1A\u6811\u9500\u6BC1\u5206\u6B65\u9694\u79BB\u2014\u2014\u5355\u6B65\u5F02\u5E38\u4E0D\u963B\u65AD\u540E\u7EED\u6E05\u7406\uFF08Host \u60AC\u6302\u6CC4\u6F0F\u6BD4\u4E00\u6B21\u53EF\u6355\u83B7\u5F02\u5E38\u66F4\u7CDF\uFF09
        try { Root.Dispose(); }
        catch (Exception ex) { Game.Logger.LogWarning("DJUI v6: Root.Dispose \u5F02\u5E38\uFF08\u5DF2\u9694\u79BB\uFF09\uFF1A{Message}", ex.Message); }
        Host.RemoveFromVisualTreeAndParent();
        try { Host.Dispose(); }
        catch (Exception ex) { Game.Logger.LogWarning("DJUI v6: Host.Dispose \u5F02\u5E38\uFF08\u5DF2\u9694\u79BB\uFF09\uFF1A{Message}", ex.Message); }
    }
}

/// <summary>
/// Builds exactly one persistent authored v6 tree under one Panel host.
/// Template instances must be expanded beforehand; the expanded instance remains one registered Panel.
/// </summary>
public static class DjuiTreeBuilderV6
{
    public static DjuiTreeInstanceV6 Build(string windowInstanceId, DjuiProjectV6 project, DjuiPageV6 page, Panel? host = null)
    {
        ArgumentNullException.ThrowIfNull(project);
        ArgumentNullException.ThrowIfNull(page);
        if (!string.Equals(page.Kind, "window", StringComparison.OrdinalIgnoreCase))
            throw new NotSupportedException($"DJUI v6: single-tree builder only supports expanded window pages; page '{page.PageId}' has kind '{page.Kind}'.");
        if (!string.Equals(page.Root.StarType, "Panel", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"DJUI v6: page root '{page.Root.Id}' must be a Panel.");

        var ownsHost = host == null;
        host ??= new Panel();
        if (ownsHost) host.FullScreen();
        host.ClipContent = true;

        var session = new DjuiLayoutSessionV6(windowInstanceId, project, page);
        var imageVisuals = new DjuiImageVisualLayerV6();
        var progressVisuals = new DjuiProgressVisualLayerV6();
        var buttonStates = new DjuiButtonStateRegistryV6(imageVisuals);
        var bindingRegistrations = new List<IDisposable>();
        Panel? root = null;
        try
        {
            root = (Panel)BuildNode(session.CurrentPage.Root, session, project.DefaultFont, imageVisuals, progressVisuals, buttonStates, bindingRegistrations);
            root.Parent = host;
            session.SetNodeUpdater((node, control) => ApplyNodeFields(control, node, project.DefaultFont, imageVisuals, progressVisuals, buttonStates));
            session.Relayout();
            return new DjuiTreeInstanceV6(host, root, session, ownsHost, imageVisuals, progressVisuals, buttonStates, bindingRegistrations);
        }
        catch
        {
            foreach (var registration in bindingRegistrations) registration.Dispose();
            session.Dispose();
            imageVisuals.Dispose();
            progressVisuals.Dispose();
            buttonStates.Dispose();
            if (ownsHost) host.Dispose();
            else root?.Dispose();
            throw;
        }
    }

    private static Control BuildNode(DjuiNodeV6 node, DjuiLayoutSessionV6 session, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, List<IDisposable> bindingRegistrations, bool bindBehaviors = true, bool recurse = true)
    {
        if (string.Equals(node.StarType, "TemplateInstance", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"DJUI v6: template node '{node.Id}' was not expanded.");
        if (string.IsNullOrWhiteSpace(node.Id))
            throw new InvalidOperationException("DJUI v6: every authored node must have a non-empty ID.");

        Control control = node.StarType switch
        {
            "Panel" => new Panel(),
            "Button" => new Button(),
            "Label" => new Label(),
            "Input" => new Input(),
            "Progress" => new Progress(),
            "SpacingPanel" => new Panel(),
            "PanelScrollable" => new PanelScrollable(),
            _ => throw new NotSupportedException($"DJUI v6: node '{node.Id}' uses unsupported starType '{node.StarType}'.")
        };

        ApplyNodeFields(control, node, defaultFont, imageVisuals, progressVisuals, buttonStates);
        ApplyInteraction(control, node.Interaction);
        ApplyEffects(control, node.Effects);
        session.Register(node.Id, control);
        if (bindBehaviors)
        {
            DjuiActionRouter.BindAction(control, node.Djui?.Action);
            DjuiAudioSystem.BindClickSound(control, node.Djui?.ClickSoundId);
            foreach (var binding in node.Djui?.Bindings ?? [])
                bindingRegistrations.Add(DjuiBindingSystem.RegisterBinding(control, binding.Key, binding.Value));
        }

        if (recurse)
            foreach (var childNode in node.Children)
            {
                var child = BuildNode(childNode, session, defaultFont, imageVisuals, progressVisuals, buttonStates, bindingRegistrations);
                child.Parent = control;
            }
        return control;
    }

    /// <summary>
    /// CloneControl \u6784\u5EFA\u6838\u5FC3\uFF1AJSON \u514B\u9686\u6E90\u5B50\u6811 \u2192 \u5168\u6811 id \u52A0\u9632\u51B2\u7A81\u540E\u7F00 \u2192 \u9010\u8282\u70B9\u8D70\u540C\u4E00\u6784\u5EFA\u7BA1\u7EBF
    /// \uFF08\u4E0D\u7ED1 action/\u97F3\u6548/\u6570\u636E\u7ED1\u5B9A\u2014\u2014\u514B\u9686\u4F53\u65E0\u884C\u4E3A\uFF0C\u5982\u540C new\uFF09\u2192 \u6309\u6E90\u5B50\u6811\u89E3\u7B97\u77E9\u5F62 ApplyRect
    /// \uFF08\u5C40\u90E8\u77E9\u5F62\uFF0C\u514B\u9686\u4F53\u521D\u59CB\u4E0E\u6E90\u5B8C\u5168\u91CD\u53E0\uFF0C\u7236\u7EA7/\u4F4D\u7F6E\u5F52\u8C03\u7528\u65B9\uFF09\u3002
    /// \u514B\u9686\u8282\u70B9\u4EE5\u65B0 id \u767B\u8BB0\u8FDB\u5E03\u5C40\u4F1A\u8BDD\uFF1A\u4E0D\u53C2\u4E0E relayout\uFF0C\u4F46\u6811\u9500\u6BC1\u65F6 ClearBehaviors/\u7279\u6548\u6E05\u7406\u8986\u76D6\u514B\u9686\u4F53\uFF08R5 \u540C\u6B3E\u7ADE\u6001\u9632\u62A4\uFF09\u3002
    /// </summary>
    internal static Control BuildClone(DjuiNodeV6 source, DjuiLayoutSessionV6 session, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, string idSuffix, IReadOnlyDictionary<string, DjuiRectV6> solved)
    {
        var node = JsonSerializer.Deserialize<DjuiNodeV6>(JsonSerializer.Serialize(source, CloneJsonOptions), CloneJsonOptions)
            ?? throw new InvalidOperationException("DJUI v6: clone JSON round-trip failed");
        ApplyCloneIds(node, idSuffix);
        return BuildCloneNode(node, source, session, defaultFont, imageVisuals, progressVisuals, buttonStates, solved, null);
    }

    private static readonly JsonSerializerOptions CloneJsonOptions = new();

    private static void ApplyCloneIds(DjuiNodeV6 node, string idSuffix)
    {
        node.Id += idSuffix;
        foreach (var child in node.Children) ApplyCloneIds(child, idSuffix);
    }

    private static Control BuildCloneNode(DjuiNodeV6 node, DjuiNodeV6 origin, DjuiLayoutSessionV6 session, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, IReadOnlyDictionary<string, DjuiRectV6> solved, DjuiRectV6? parentRect)
    {
        var control = BuildNode(node, session, defaultFont, imageVisuals, progressVisuals, buttonStates, new List<IDisposable>(), bindBehaviors: false, recurse: false);
        if (solved.TryGetValue(origin.Id, out var rect))
        {
            var local = parentRect is { } pr ? new DjuiRectV6(rect.X - pr.X, rect.Y - pr.Y, rect.Width, rect.Height) : rect;
            DjuiLayoutSessionV6.ApplyRect(control, local);
        }
        DjuiRectV6? ownRect = solved.TryGetValue(origin.Id, out var own) ? own : null;
        for (var i = 0; i < node.Children.Count; i++)
        {
            var child = BuildCloneNode(node.Children[i], origin.Children[i], session, defaultFont, imageVisuals, progressVisuals, buttonStates, solved, ownRect);
            child.Parent = control;
        }
        return control;
    }

    private static void ApplyNodeFields(Control control, DjuiNodeV6 node, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates)
    {
        // \u63A7\u4EF6 Name \u53D6\u9875\u9762 JSON \u7684 name \u5B57\u6BB5\u2014\u2014\u5F15\u64CE FindChild(name) / FindChildren(name) \u7684\u5BFB\u5740\u4F9D\u636E\uFF08\u542B\u514B\u9686\u4F53\uFF09
        if (!string.IsNullOrWhiteSpace(node.Name)) control.Name = node.Name;
        ApplyBasic(control, node.Basic);
        ApplyTransformFields(control, node.Transform);
        ApplyAppearance(control, node.Appearance);
        ApplyProgress(control, node.Progress);
        var isRadialProgress = control is Progress progress && IsRadial(progress);
        if (control is not Progress) imageVisuals.Apply(node.Id, control, node.Appearance);
        ApplyText(control, node.Text, defaultFont);
        ApplyButton(control, node.Button, node.Appearance, node.Transform, imageVisuals, buttonStates);
        if (control is Progress target)
        {
            if (isRadialProgress) ApplyNativeProgressImage(target, node.Appearance);
            else progressVisuals.Apply(node.Id, target, node.Appearance);
        }
        ApplyLayout(control, node.Layout);
    }

    private static void ApplyInteraction(Control control, DjuiInteractionV6? interaction)
    {
        if (interaction == null) return;
        if (!string.IsNullOrEmpty(interaction.RoutedEvents) && Enum.TryParse<RoutedEvents>(interaction.RoutedEvents, out var routed)) control.RoutedEvents = routed;
        if (interaction.AllowDrag is bool allowDrag) control.AllowDrag = allowDrag;
        if (interaction.AllowDrop is bool allowDrop) control.AllowDrop = allowDrop;
        foreach (var behavior in interaction.Behaviors ?? [])
            if (behavior.Type == "TouchBehavior") control.AddTouchBehavior(behavior.ScaleFactor ?? 1f, behavior.EnablePressAnimation ?? false, behavior.EnableLongPress ?? false);
    }

    private static void ApplyEffects(Control control, DjuiEffectsV6? effects)
    {
        if (!string.IsNullOrEmpty(effects?.Preset)) DjuiEffectPresets.Apply(effects.Preset, control);
        else if (control is Button) DjuiEffectPresets.Apply("button_default", control);
    }

    private static void ApplyLayout(Control control, DjuiLayoutV6? layout)
    {
        if (layout == null) return;
        // Position/alignment/margin belong to the v6 solver. Applying authored layout margin here
        // would offset an already solved absolute rectangle a second time.
        if (layout.Padding is { Length: 4 } padding) control.Padding = new Thickness(padding[0], padding[1], padding[2], padding[3]);
        if (!string.IsNullOrEmpty(layout.HorizontalContentAlignment) && Enum.TryParse<HorizontalContentAlignment>(layout.HorizontalContentAlignment, out var horizontal))
            control.HorizontalContentAlignment = horizontal;
        if (!string.IsNullOrEmpty(layout.VerticalContentAlignment) && Enum.TryParse<VerticalContentAlignment>(layout.VerticalContentAlignment, out var vertical))
            control.VerticalContentAlignment = vertical;
    }

    private static void ApplyBasic(Control control, DjuiBasicV6? basic)
    {
        if (basic?.Visible is bool visible) control.Visible = visible;
        if (basic?.Disabled is bool disabled) control.Disabled = disabled;
        if (basic?.IsStatic is bool isStatic) control.IsStatic = isStatic;
    }

    private static void ApplyTransformFields(Control control, DjuiTransformV6? transform)
    {
        if (transform?.Rotation is float rotation) control.Rotation = rotation;
        if (transform?.Opacity is float opacity) control.Opacity = opacity;
        if (transform?.ZIndex is int zIndex) control.ZIndex = zIndex;
    }

    private static void ApplyAppearance(Control control, DjuiAppearanceV6? appearance)
    {
        if (appearance == null) return;
        if (TryParseColor(appearance.Background, out var background)) control.Background = background;
        if (appearance.CornerRadius is float radius) control.CornerRadius = radius;
        if (appearance.ClipContent is bool clip) control.ClipContent = clip;
        if (appearance.Desaturated is bool desaturated) control.Desaturated = desaturated;
        if (appearance.ImageFlipX is bool flipX) control.ImageFlipX = flipX;
        if (appearance.ImageFlipY is bool flipY) control.ImageFlipY = flipY;
        if (appearance.SlicedEdges is { Length: 4 } edges) control.SlicedEdges = new Thickness(edges[0], edges[1], edges[2], edges[3]);
    }

    private static void ApplyText(Control control, DjuiTextV6? text, string? defaultFont)
    {
        if (text == null) return;
        var font = string.IsNullOrEmpty(text.Font) ? defaultFont : text.Font;
        if (control is Label label) ApplyLabelText(label, text, font);
        else if (control is Input input)
        {
            if (text.Text != null) input.Text = text.Text;
            if (!string.IsNullOrEmpty(font)) input.Font = font;
            if (text.FontSize is float size) input.FontSize = size;
            if (TryParseColor(text.TextColor, out var color)) input.TextColor = color;
            if (text.Bold is bool bold) input.Bold = bold;
        }
        else if (control is Button button && text.Text != null)
        {
            var buttonLabel = button.Children?.OfType<Label>().FirstOrDefault(child => child.Name == DjuiButtonStateV6.ButtonLabelName);
            if (buttonLabel == null)
            {
                buttonLabel = new Label { Name = DjuiButtonStateV6.ButtonLabelName, IsStatic = true };
                buttonLabel.FullScreen();
                buttonLabel.Parent = button;
            }
            ApplyLabelText(buttonLabel, text, font);
        }
    }

    private static void ApplyLabelText(Label label, DjuiTextV6 text, string? font)
    {
        if (text.Text != null) label.Text = text.Text;
        if (!string.IsNullOrEmpty(font)) label.Font = font;
        if (text.FontSize is float size) label.FontSize = size;
        if (TryParseColor(text.TextColor, out var color)) label.TextColor = color;
        if (text.StrokeSize is float strokeSize) label.StrokeSize = Math.Max(0, strokeSize);
        if (TryParseColor(text.StrokeColor, out var strokeColor)) label.StrokeColor = strokeColor;
        if (text.Bold is bool bold) label.Bold = bold;
        if (text.TextWrap is bool wrap) label.TextWrap = wrap;
        if (!string.IsNullOrEmpty(text.TextOverflow) && Enum.TryParse<TextTrimming>(text.TextOverflow, out var trimming)) label.TextTrimming = trimming;
    }

    private static void ApplyButton(Control control, DjuiButtonV6? button, DjuiAppearanceV6? appearance, DjuiTransformV6? transform, DjuiImageVisualLayerV6 imageVisuals, DjuiButtonStateRegistryV6 buttonStates)
    {
        // \u5F15\u64CE Button \u7684 ImageHover/ImagePressed \u5728 v6 \u4E0B\u4E0D\u53EF\u7528\uFF08\u56FE\u7247\u753B\u5728 visual \u5B50 Panel\uFF0C\u5BBF\u4E3B Image \u4E3A\u7A7A\uFF0C
        // \u4E14\u5F15\u64CE\u6CA1\u6709 ImageDisabled\uFF09\uFF0C\u56DB\u6001\u6362\u56FE\u4E0E\u7981\u7528\u7070\u5316\u5168\u90E8\u7531 DjuiButtonStateV6 \u5728 visual \u5C42\u81EA\u7BA1\u3002
        if (control is not Button target) return;
        buttonStates.Attach(target, button, appearance?.Image, transform?.Opacity ?? 1f, appearance?.Desaturated ?? false);
    }

    private static void ApplyProgress(Control control, DjuiProgressV6? progress)
    {
        if (control is not Progress target || progress == null) return;
        if (progress.Value is float value) target.Value = value;
        if (!string.IsNullOrEmpty(progress.ProgressionMode) && Enum.TryParse<ProgressionMode>(progress.ProgressionMode, out var mode)) target.ProgressionMode = mode;
        if (progress.Rotation is float rotation) target.ProgressRotation = rotation;
    }

    private static bool IsRadial(Progress progress)
        => progress.ProgressionMode is ProgressionMode.Clockwise or ProgressionMode.CounterClockwise;

    private static void ApplyNativeProgressImage(Progress target, DjuiAppearanceV6? appearance)
    {
        target.Image = appearance?.Image ?? "";
        target.SlicedEdges = appearance?.SlicedEdges is { Length: 4 } edges
            ? new Thickness(edges[0], edges[1], edges[2], edges[3])
            : new Thickness(0, 0, 0, 0);
        target.ClipContent = appearance?.ClipContent ?? false;
    }

    private static bool TryParseColor(string? raw, out Color color)
    {
        color = Color.White;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var value = raw.Trim();
        try
        {
            if (value.StartsWith("#"))
            {
                color = value.Length == 9 ? ColorExtensions.FromRgbaHex(value) : ColorExtensions.FromHex(value);
                return true;
            }
            var match = Regex.Match(value, @"^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)$", RegexOptions.IgnoreCase);
            if (!match.Success) return false;
            var r = Math.Clamp(int.Parse(match.Groups[1].Value), 0, 255);
            var g = Math.Clamp(int.Parse(match.Groups[2].Value), 0, 255);
            var b = Math.Clamp(int.Parse(match.Groups[3].Value), 0, 255);
            var a = match.Groups[4].Success ? (float.Parse(match.Groups[4].Value) is var alpha && alpha <= 1 ? Math.Clamp((int)MathF.Round(alpha * 255), 0, 255) : Math.Clamp((int)MathF.Round(alpha), 0, 255)) : 255;
            color = Color.FromArgb(a, r, g, b);
            return true;
        }
        catch { return false; }
    }
}

#endif
`;

// raw:D:\git\DJUI\runtime\DjuiModels.cs
var DjuiModels_default = '// DJUI Runtime - JSON \u53CD\u5E8F\u5217\u5316\u6A21\u578B\n// \u5BF9\u5E94\u534F\u8BAE v4\n\nusing System.Text.Json;\nusing System.Text.Json.Serialization;\n\nnamespace DjuiRuntime;\n\npublic class DjuiPageJson\n{\n    [JsonPropertyName("version")]\n    public int Version { get; set; }\n\n    [JsonPropertyName("pageId")]\n    public string PageId { get; set; } = "";\n\n    [JsonPropertyName("designWidth")]\n    public float DesignWidth { get; set; } = 900;\n\n    [JsonPropertyName("designHeight")]\n    public float DesignHeight { get; set; } = 1600;\n\n    [JsonPropertyName("adaptation")]\n    public DjuiAdaptationJson? Adaptation { get; set; }\n\n    [JsonPropertyName("root")]\n    public DjuiNodeJson Root { get; set; } = new();\n\n    [JsonPropertyName("nodeKind")]\n    public string NodeKind { get; set; } = "";\n\n    [JsonPropertyName("windowMode")]\n    public string? WindowMode { get; set; }\n\n    [JsonPropertyName("transition")]\n    public DjuiTransitionJson? Transition { get; set; }\n}\n\npublic class DjuiTransitionJson\n{\n    [JsonPropertyName("open")]\n    public string? Open { get; set; }\n\n    [JsonPropertyName("close")]\n    public string? Close { get; set; }\n}\n\npublic class DjuiNodeJson\n{\n    [JsonPropertyName("id")]\n    public string Id { get; set; } = "";\n\n    [JsonPropertyName("starType")]\n    public string StarType { get; set; } = "Panel";\n\n    [JsonPropertyName("name")]\n    public string? Name { get; set; }\n\n    [JsonPropertyName("basic")]\n    public DjuiBasicJson? Basic { get; set; }\n\n    [JsonPropertyName("transform")]\n    public DjuiTransformJson? Transform { get; set; }\n\n    [JsonPropertyName("appearance")]\n    public DjuiAppearanceJson? Appearance { get; set; }\n\n    [JsonPropertyName("layout")]\n    public DjuiLayoutJson? Layout { get; set; }\n\n    [JsonPropertyName("interaction")]\n    public DjuiInteractionJson? Interaction { get; set; }\n\n    [JsonPropertyName("effects")]\n    public DjuiEffectsJson? Effects { get; set; }\n\n    [JsonPropertyName("text")]\n    public DjuiTextJson? Text { get; set; }\n\n    [JsonPropertyName("button")]\n    public DjuiButtonJson? Button { get; set; }\n\n    [JsonPropertyName("progress")]\n    public DjuiProgressJson? Progress { get; set; }\n\n    [JsonPropertyName("djui")]\n    public DjuiExtensionJson? Djui { get; set; }\n\n    // Flex \u5C5E\u6027\n    [JsonPropertyName("widthStretchRatio")]\n    public float? WidthStretchRatio { get; set; }\n    [JsonPropertyName("heightStretchRatio")]\n    public float? HeightStretchRatio { get; set; }\n    [JsonPropertyName("widthCompactRatio")]\n    public float? WidthCompactRatio { get; set; }\n    [JsonPropertyName("heightCompactRatio")]\n    public float? HeightCompactRatio { get; set; }\n\n    [JsonPropertyName("children")]\n    public List<DjuiNodeJson> Children { get; set; } = new();\n\n    // \u2605 uGUI \u98CE\u683C\u951A\u70B9\n    [JsonPropertyName("anchor")]\n    public DjuiAnchorJson? Anchor { get; set; }\n\n    // \u2605 \u62C9\u4F38\uFF08NGUI UIStretch \u98CE\u683C\uFF09\n    [JsonPropertyName("stretch")]\n    public DjuiStretchJson? Stretch { get; set; }\n\n    // \u2605 \u5BBD\u9AD8\u6BD4\n    [JsonPropertyName("aspectRatio")]\n    public DjuiAspectRatioJson? AspectRatio { get; set; }\n\n    [JsonPropertyName("templateRef")]\n    public string? TemplateRef { get; set; }\n\n    [JsonPropertyName("templateOverrides")]\n    public Dictionary<string, Dictionary<string, JsonElement>>? TemplateOverrides { get; set; }\n\n    [JsonPropertyName("adapt")]\n    public DjuiNodeAdaptJson? Adapt { get; set; }\n}\n\npublic class DjuiAdaptationJson\n{\n    [JsonPropertyName("orientation")]\n    public string? Orientation { get; set; }\n\n    [JsonPropertyName("designWidth")]\n    public float? DesignWidth { get; set; }\n\n    [JsonPropertyName("designHeight")]\n    public float? DesignHeight { get; set; }\n\n    [JsonPropertyName("contentFit")]\n    public string? ContentFit { get; set; }\n\n    [JsonPropertyName("backgroundFit")]\n    public string? BackgroundFit { get; set; }\n\n    [JsonPropertyName("safeArea")]\n    public bool? SafeArea { get; set; }\n\n    [JsonPropertyName("contentAlign")]\n    public string? ContentAlign { get; set; }\n\n    [JsonPropertyName("minScale")]\n    public float? MinScale { get; set; }\n\n    [JsonPropertyName("maxScale")]\n    public float? MaxScale { get; set; }\n}\n\npublic class DjuiNodeAdaptJson\n{\n    [JsonPropertyName("role")]\n    public string? Role { get; set; }\n\n    [JsonPropertyName("safePin")]\n    public string? SafePin { get; set; }\n\n    [JsonPropertyName("bleed")]\n    public bool? Bleed { get; set; }\n}\n\npublic class DjuiAnchorJson\n{\n    // \u951A\u5B9A\u76EE\u6807\uFF1A\u5C4F\u5E55 / \u7236\u8282\u70B9\n    [JsonPropertyName("target")]\n    public string? Target { get; set; }\n\n    // NGUI \u98CE\u683C 9-way \u951A\u70B9\u4F4D\u7F6E\n    [JsonPropertyName("side")]\n    public string? Side { get; set; }\n\n    // === \u5411\u540E\u517C\u5BB9\u65E7\u5B57\u6BB5\uFF08\u81EA\u52A8\u8FC1\u79FB\u7528\uFF09===\n    [JsonPropertyName("anchorMin")]\n    public Vec2Json? AnchorMin { get; set; }\n\n    [JsonPropertyName("anchorMax")]\n    public Vec2Json? AnchorMax { get; set; }\n\n    [JsonPropertyName("left")]\n    public float? Left { get; set; }\n\n    [JsonPropertyName("right")]\n    public float? Right { get; set; }\n\n    [JsonPropertyName("top")]\n    public float? Top { get; set; }\n\n    [JsonPropertyName("bottom")]\n    public float? Bottom { get; set; }\n}\n\npublic class DjuiStretchJson\n{\n    // \u62C9\u4F38\u98CE\u683C\uFF1ANone / Horizontal / Vertical / Both\n    [JsonPropertyName("style")]\n    public string? Style { get; set; }\n\n    // \u62C9\u4F38\u8FB9\u8DDD\uFF08\u50CF\u7D20\uFF09\n    [JsonPropertyName("margins")]\n    public DjuiStretchMarginsJson? Margins { get; set; }\n}\n\npublic class DjuiStretchMarginsJson\n{\n    [JsonPropertyName("left")]\n    public float Left { get; set; }\n\n    [JsonPropertyName("right")]\n    public float Right { get; set; }\n\n    [JsonPropertyName("top")]\n    public float Top { get; set; }\n\n    [JsonPropertyName("bottom")]\n    public float Bottom { get; set; }\n}\n\npublic class DjuiAspectRatioJson\n{\n    // \u6A21\u5F0F\uFF1ANone / WidthControlsHeight / HeightControlsWidth / FitInParent / EnvelopeParent\n    [JsonPropertyName("mode")]\n    public string? Mode { get; set; }\n\n    // \u5BBD / \u9AD8\n    [JsonPropertyName("ratio")]\n    public float? Ratio { get; set; }\n}\n\npublic class Vec2Json\n{\n    [JsonPropertyName("x")]\n    public float X { get; set; }\n\n    [JsonPropertyName("y")]\n    public float Y { get; set; }\n}\n\npublic class DjuiBasicJson\n{\n    [JsonPropertyName("visible")]\n    public bool? Visible { get; set; }\n\n    [JsonPropertyName("disabled")]\n    public bool? Disabled { get; set; }\n\n    [JsonPropertyName("isStatic")]\n    public bool? IsStatic { get; set; }\n}\n\npublic class DjuiTransformJson\n{\n    [JsonPropertyName("positionType")]\n    public string? PositionType { get; set; }\n\n    [JsonPropertyName("x")]\n    public float? X { get; set; }\n\n    [JsonPropertyName("y")]\n    public float? Y { get; set; }\n\n    [JsonPropertyName("width")]\n    public float? Width { get; set; }\n\n    [JsonPropertyName("height")]\n    public float? Height { get; set; }\n\n    [JsonPropertyName("rotation")]\n    public float? Rotation { get; set; }\n\n    [JsonPropertyName("scale")]\n    public float[]? Scale { get; set; }\n\n    [JsonPropertyName("opacity")]\n    public float? Opacity { get; set; }\n\n    [JsonPropertyName("zIndex")]\n    public int? ZIndex { get; set; }\n\n    // \u2605 \u4E2D\u5FC3\u70B9\uFF080~1\uFF0C\u5C4F\u5E55\u7EA6\u5B9A Y \u671D\u4E0B\uFF1A0=\u9876 1=\u5E95\uFF09\n    [JsonPropertyName("pivot")]\n    public Vec2Json? Pivot { get; set; }\n}\n\npublic class DjuiAppearanceJson\n{\n    [JsonPropertyName("image")]\n    public string? Image { get; set; }\n\n    [JsonPropertyName("background")]\n    public string? Background { get; set; }\n\n    [JsonPropertyName("borderThickness")]\n    public float? BorderThickness { get; set; }\n\n    [JsonPropertyName("borderColor")]\n    public string? BorderColor { get; set; }\n\n    [JsonPropertyName("cornerRadius")]\n    public float? CornerRadius { get; set; }\n\n    [JsonPropertyName("clipContent")]\n    public bool? ClipContent { get; set; }\n\n    [JsonPropertyName("desaturated")]\n    public bool? Desaturated { get; set; }\n\n    [JsonPropertyName("imageFlipX")]\n    public bool? ImageFlipX { get; set; }\n\n    [JsonPropertyName("imageFlipY")]\n    public bool? ImageFlipY { get; set; }\n\n    [JsonPropertyName("slicedEdges")]\n    public float[]? SlicedEdges { get; set; } // [left, top, right, bottom]\n}\n\npublic class DjuiLayoutJson\n{\n    [JsonPropertyName("margin")]\n    public float[]? Margin { get; set; }\n\n    [JsonPropertyName("padding")]\n    public float[]? Padding { get; set; }\n\n    [JsonPropertyName("autoSize")]\n    public string? AutoSize { get; set; }\n\n    [JsonPropertyName("flowOrientation")]\n    public string? FlowOrientation { get; set; }\n\n    [JsonPropertyName("spacing")]\n    public float? Spacing { get; set; }\n\n    [JsonPropertyName("horizontalAlignment")]\n    public string? HorizontalAlignment { get; set; }\n\n    [JsonPropertyName("verticalAlignment")]\n    public string? VerticalAlignment { get; set; }\n\n    [JsonPropertyName("horizontalContentAlignment")]\n    public string? HorizontalContentAlignment { get; set; }\n\n    [JsonPropertyName("verticalContentAlignment")]\n    public string? VerticalContentAlignment { get; set; }\n}\n\npublic class DjuiInteractionJson\n{\n    [JsonPropertyName("routedEvents")]\n    public string? RoutedEvents { get; set; }\n\n    [JsonPropertyName("allowDrag")]\n    public bool? AllowDrag { get; set; }\n\n    [JsonPropertyName("allowDrop")]\n    public bool? AllowDrop { get; set; }\n\n    [JsonPropertyName("behaviors")]\n    public List<DjuiTouchBehaviorJson>? Behaviors { get; set; }\n}\n\npublic class DjuiTouchBehaviorJson\n{\n    [JsonPropertyName("type")]\n    public string? Type { get; set; }\n\n    [JsonPropertyName("scaleFactor")]\n    public float? ScaleFactor { get; set; }\n\n    [JsonPropertyName("enablePressAnimation")]\n    public bool? EnablePressAnimation { get; set; }\n\n    [JsonPropertyName("enableLongPress")]\n    public bool? EnableLongPress { get; set; }\n}\n\npublic class DjuiEffectsJson\n{\n    [JsonPropertyName("preset")]\n    public string? Preset { get; set; }\n}\n\npublic class DjuiTextJson\n{\n    [JsonPropertyName("text")]\n    public string? Text { get; set; }\n\n    [JsonPropertyName("fontSize")]\n    public float? FontSize { get; set; }\n\n    [JsonPropertyName("textColor")]\n    public string? TextColor { get; set; }\n\n    [JsonPropertyName("strokeSize")]\n    public float? StrokeSize { get; set; }\n\n    [JsonPropertyName("strokeColor")]\n    public string? StrokeColor { get; set; }\n\n    [JsonPropertyName("bold")]\n    public bool? Bold { get; set; }\n\n    [JsonPropertyName("font")]\n    public string? Font { get; set; }\n\n    [JsonPropertyName("textWrap")]\n    public bool? TextWrap { get; set; }\n\n    [JsonPropertyName("textOverflow")]\n    public string? TextOverflow { get; set; }\n}\n\npublic class DjuiButtonJson\n{\n    [JsonPropertyName("imageHover")]\n    public string? ImageHover { get; set; }\n\n    [JsonPropertyName("imagePressed")]\n    public string? ImagePressed { get; set; }\n}\n\npublic class DjuiProgressJson\n{\n    [JsonPropertyName("value")]\n    public float? Value { get; set; }\n\n    [JsonPropertyName("progressionMode")]\n    public string? ProgressionMode { get; set; }\n\n    [JsonPropertyName("rotation")]\n    public float? Rotation { get; set; }\n}\n\npublic class DjuiExtensionJson\n{\n    [JsonPropertyName("action")]\n    public string? Action { get; set; }\n\n    [JsonPropertyName("clickSoundId")]\n    public string? ClickSoundId { get; set; }\n\n    [JsonPropertyName("locked")]\n    public bool? Locked { get; set; }\n}\n';

// raw:D:\git\DJUI\runtime\DjuiProtocolV6.cs
var DjuiProtocolV6_default = '// DJUI Runtime - protocol v6 isolated models (v5 loader remains unchanged)\nusing System.Collections.Generic;\nusing System.Text.Json;\nusing System.Text.Json.Serialization;\n\nnamespace DjuiRuntime;\n\npublic static class DjuiProtocolV6\n{\n    public const int ProtocolVersion = 6;\n    public const int SchemaVersion = 1;\n}\n\npublic sealed class DjuiProjectV6\n{\n    [JsonPropertyName("protocolVersion")] public int ProtocolVersion { get; set; } = DjuiProtocolV6.ProtocolVersion;\n    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; } = DjuiProtocolV6.SchemaVersion;\n    [JsonPropertyName("projectId")] public string? ProjectId { get; set; }\n    [JsonPropertyName("name")] public string? Name { get; set; }\n    [JsonPropertyName("orientation")] public string Orientation { get; set; } = "portrait";\n    [JsonPropertyName("canvas")] public DjuiCanvasConfigV6 Canvas { get; set; } = new();\n    [JsonPropertyName("responsive")] public DjuiResponsiveConfigV6 Responsive { get; set; } = new();\n    [JsonPropertyName("defaultFont")] public string? DefaultFont { get; set; }\n}\n\npublic sealed class DjuiCanvasConfigV6\n{\n    [JsonPropertyName("referenceWidth")] public float ReferenceWidth { get; set; } = 900;\n    [JsonPropertyName("referenceHeight")] public float ReferenceHeight { get; set; } = 1600;\n    [JsonPropertyName("mode")] public string Mode { get; set; } = "Contain";\n}\n\npublic sealed class DjuiResponsiveConfigV6\n{\n    [JsonPropertyName("wideRatio")] public float WideRatio { get; set; } = 1.25f;\n}\n\npublic sealed class DjuiPageV6\n{\n    [JsonPropertyName("protocolVersion")] public int ProtocolVersion { get; set; } = DjuiProtocolV6.ProtocolVersion;\n    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; } = DjuiProtocolV6.SchemaVersion;\n    [JsonPropertyName("pageId")] public string PageId { get; set; } = "";\n    [JsonPropertyName("kind")] public string Kind { get; set; } = "window";\n    [JsonPropertyName("localSize")] public DjuiSizeV6? LocalSize { get; set; }\n    [JsonPropertyName("window")] public DjuiWindowConfigV6? Window { get; set; }\n    [JsonPropertyName("root")] public DjuiNodeV6 Root { get; set; } = new();\n    [JsonPropertyName("responsive")] public DjuiPageResponsiveV6? Responsive { get; set; }\n}\n\npublic sealed class DjuiSizeV6 { [JsonPropertyName("width")] public float Width { get; set; } [JsonPropertyName("height")] public float Height { get; set; } }\npublic sealed class DjuiWindowConfigV6 { [JsonPropertyName("mode")] public string? Mode { get; set; } [JsonPropertyName("transition")] public DjuiTransitionV6? Transition { get; set; } }\npublic sealed class DjuiTransitionV6 { [JsonPropertyName("open")] public string? Open { get; set; } [JsonPropertyName("close")] public string? Close { get; set; } }\npublic sealed class DjuiPageResponsiveV6 { [JsonPropertyName("wide")] public DjuiWideOverridesV6 Wide { get; set; } = new(); }\npublic sealed class DjuiWideOverridesV6 { [JsonPropertyName("overrides")] public Dictionary<string, Dictionary<string, JsonElement>> Overrides { get; set; } = new(); }\n\n[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]\npublic sealed class DjuiNodeV6\n{\n    [JsonPropertyName("id")] public string Id { get; set; } = "";\n    [JsonPropertyName("starType")] public string StarType { get; set; } = "Panel";\n    [JsonPropertyName("name")] public string? Name { get; set; }\n    [JsonPropertyName("basic")] public DjuiBasicV6? Basic { get; set; }\n    [JsonPropertyName("transform")] public DjuiTransformV6? Transform { get; set; }\n    [JsonPropertyName("anchor")] public DjuiAnchorV6? Anchor { get; set; }\n    [JsonPropertyName("stretch")] public DjuiStretchV6? Stretch { get; set; }\n    [JsonPropertyName("aspectRatio")] public DjuiAspectRatioV6? AspectRatio { get; set; }\n    [JsonPropertyName("sceneFrame")] public DjuiSceneFrameV6? SceneFrame { get; set; }\n    [JsonPropertyName("appearance")] public DjuiAppearanceV6? Appearance { get; set; }\n    [JsonPropertyName("text")] public DjuiTextV6? Text { get; set; }\n    [JsonPropertyName("button")] public DjuiButtonV6? Button { get; set; }\n    [JsonPropertyName("progress")] public DjuiProgressV6? Progress { get; set; }\n    [JsonPropertyName("layout")] public DjuiLayoutV6? Layout { get; set; }\n    [JsonPropertyName("interaction")] public DjuiInteractionV6? Interaction { get; set; }\n    [JsonPropertyName("effects")] public DjuiEffectsV6? Effects { get; set; }\n    [JsonPropertyName("djui")] public DjuiExtensionsV6? Djui { get; set; }\n    [JsonPropertyName("widthStretchRatio")] public float? WidthStretchRatio { get; set; }\n    [JsonPropertyName("heightStretchRatio")] public float? HeightStretchRatio { get; set; }\n    [JsonPropertyName("widthCompactRatio")] public float? WidthCompactRatio { get; set; }\n    [JsonPropertyName("heightCompactRatio")] public float? HeightCompactRatio { get; set; }\n    [JsonPropertyName("templateRef")] public string? TemplateRef { get; set; }\n    [JsonPropertyName("templateOverrides")] public Dictionary<string, Dictionary<string, JsonElement>>? TemplateOverrides { get; set; }\n    [JsonIgnore] public DjuiSizeV6? TemplateLocalSize { get; set; }\n    [JsonPropertyName("children")] public List<DjuiNodeV6> Children { get; set; } = new();\n}\n\npublic sealed class DjuiTransformV6\n{\n    [JsonPropertyName("x")] public float? X { get; set; }\n    [JsonPropertyName("y")] public float? Y { get; set; }\n    [JsonPropertyName("width")] public float? Width { get; set; }\n    [JsonPropertyName("height")] public float? Height { get; set; }\n    [JsonPropertyName("rotation")] public float? Rotation { get; set; }\n    [JsonPropertyName("scale")] public float[]? Scale { get; set; }\n    [JsonPropertyName("opacity")] public float? Opacity { get; set; }\n    [JsonPropertyName("zIndex")] public int? ZIndex { get; set; }\n}\npublic sealed class DjuiAnchorV6\n{\n    [JsonPropertyName("target")] public string Target { get; set; } = "parent";\n    [JsonPropertyName("side")] public string Side { get; set; } = "TopLeft";\n    [JsonPropertyName("safeEdges")] public List<string> SafeEdges { get; set; } = new() { "left", "top", "right", "bottom" };\n}\npublic sealed class DjuiStretchV6 { [JsonPropertyName("style")] public string Style { get; set; } = "None"; [JsonPropertyName("margins")] public DjuiInsetsV6? Margins { get; set; } }\npublic sealed class DjuiAspectRatioV6 { [JsonPropertyName("mode")] public string Mode { get; set; } = "None"; [JsonPropertyName("ratio")] public float Ratio { get; set; } = 1; }\npublic sealed class DjuiSceneFrameV6 { [JsonPropertyName("backgroundId")] public string BackgroundId { get; set; } = ""; [JsonPropertyName("artboard")] public DjuiSizeV6 Artboard { get; set; } = new(); }\n\npublic sealed class DjuiBasicV6\n{\n    [JsonPropertyName("visible")] public bool? Visible { get; set; }\n    [JsonPropertyName("disabled")] public bool? Disabled { get; set; }\n    [JsonPropertyName("isStatic")] public bool? IsStatic { get; set; }\n}\n\npublic sealed class DjuiAppearanceV6\n{\n    [JsonPropertyName("image")] public string? Image { get; set; }\n    [JsonPropertyName("background")] public string? Background { get; set; }\n    [JsonPropertyName("imageMask")] public string? ImageMask { get; set; }\n    [JsonPropertyName("slicedEdges")] public float[]? SlicedEdges { get; set; }\n    [JsonPropertyName("imageBlurLevel")] public float? ImageBlurLevel { get; set; }\n    [JsonPropertyName("imageFit")] public string ImageFit { get; set; } = "stretch";\n    [JsonPropertyName("focalX")] public float? FocalX { get; set; }\n    [JsonPropertyName("focalY")] public float? FocalY { get; set; }\n    [JsonPropertyName("sourceSize")] public DjuiSizeV6? SourceSize { get; set; }\n    [JsonPropertyName("borderThickness")] public float? BorderThickness { get; set; }\n    [JsonPropertyName("borderColor")] public string? BorderColor { get; set; }\n    [JsonPropertyName("cornerRadius")] public float? CornerRadius { get; set; }\n    [JsonPropertyName("clipContent")] public bool? ClipContent { get; set; }\n    [JsonPropertyName("desaturated")] public bool? Desaturated { get; set; }\n    [JsonPropertyName("imageFlipX")] public bool? ImageFlipX { get; set; }\n    [JsonPropertyName("imageFlipY")] public bool? ImageFlipY { get; set; }\n}\n\npublic sealed class DjuiTextV6\n{\n    [JsonPropertyName("text")] public string? Text { get; set; }\n    [JsonPropertyName("fontSize")] public float? FontSize { get; set; }\n    [JsonPropertyName("textColor")] public string? TextColor { get; set; }\n    [JsonPropertyName("strokeSize")] public float? StrokeSize { get; set; }\n    [JsonPropertyName("strokeColor")] public string? StrokeColor { get; set; }\n    [JsonPropertyName("bold")] public bool? Bold { get; set; }\n    [JsonPropertyName("font")] public string? Font { get; set; }\n    [JsonPropertyName("textWrap")] public bool? TextWrap { get; set; }\n    [JsonPropertyName("textOverflow")] public string? TextOverflow { get; set; }\n}\n\n\npublic sealed class DjuiInteractionV6\n{\n    [JsonPropertyName("routedEvents")] public string? RoutedEvents { get; set; }\n    [JsonPropertyName("allowDrag")] public bool? AllowDrag { get; set; }\n    [JsonPropertyName("allowDrop")] public bool? AllowDrop { get; set; }\n    [JsonPropertyName("behaviors")] public List<DjuiTouchBehaviorV6>? Behaviors { get; set; }\n}\npublic sealed class DjuiTouchBehaviorV6\n{\n    [JsonPropertyName("type")] public string? Type { get; set; }\n    [JsonPropertyName("scaleFactor")] public float? ScaleFactor { get; set; }\n    [JsonPropertyName("enablePressAnimation")] public bool? EnablePressAnimation { get; set; }\n    [JsonPropertyName("enableLongPress")] public bool? EnableLongPress { get; set; }\n}\npublic sealed class DjuiEffectsV6 { [JsonPropertyName("preset")] public string? Preset { get; set; } }\n\npublic sealed class DjuiLayoutV6\n{\n    [JsonPropertyName("margin")] public float[]? Margin { get; set; }\n    [JsonPropertyName("padding")] public float[]? Padding { get; set; }\n    [JsonPropertyName("autoSize")] public string? AutoSize { get; set; }\n    [JsonPropertyName("horizontalAlignment")] public string? HorizontalAlignment { get; set; }\n    [JsonPropertyName("verticalAlignment")] public string? VerticalAlignment { get; set; }\n    [JsonPropertyName("horizontalContentAlignment")] public string? HorizontalContentAlignment { get; set; }\n    [JsonPropertyName("verticalContentAlignment")] public string? VerticalContentAlignment { get; set; }\n}\n\npublic sealed class DjuiExtensionsV6\n{\n    [JsonPropertyName("action")] public string? Action { get; set; }\n    [JsonPropertyName("clickSoundId")] public string? ClickSoundId { get; set; }\n    [JsonPropertyName("bindings")] public Dictionary<string, string>? Bindings { get; set; }\n    [JsonPropertyName("locked")] public bool? Locked { get; set; }\n}\n\npublic sealed class DjuiButtonV6\n{\n    [JsonPropertyName("imageHover")] public string? ImageHover { get; set; }\n    [JsonPropertyName("imagePressed")] public string? ImagePressed { get; set; }\n    [JsonPropertyName("imageDisabled")] public string? ImageDisabled { get; set; }\n}\n\npublic sealed class DjuiProgressV6\n{\n    [JsonPropertyName("value")] public float? Value { get; set; }\n    [JsonPropertyName("progressionMode")] public string? ProgressionMode { get; set; }\n    [JsonPropertyName("rotation")] public float? Rotation { get; set; }\n}\n';

// raw:D:\git\DJUI\runtime\DjuiResponsiveResolverV6.cs
var DjuiResponsiveResolverV6_default = 'using System.Text.Json;\n\nnamespace DjuiRuntime;\n\n/// <summary>Applies the closed v6 wide-tier override allowlist to an isolated page copy.</summary>\npublic static class DjuiResponsiveResolverV6\n{\n    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = false };\n\n    public static DjuiPageV6 Resolve(DjuiPageV6 source, bool wide)\n    {\n        ArgumentNullException.ThrowIfNull(source);\n        if (!wide || source.Responsive?.Wide?.Overrides.Count is not > 0) return source;\n        var json = JsonSerializer.Serialize(source, JsonOptions);\n        var page = JsonSerializer.Deserialize<DjuiPageV6>(json, JsonOptions)\n            ?? throw new InvalidDataException("DJUI v6: \u54CD\u5E94\u5F0F\u9875\u9762\u590D\u5236\u5931\u8D25");\n        CopyRuntimeMetadata(source.Root, page.Root);\n        var nodes = new Dictionary<string, DjuiNodeV6>(StringComparer.Ordinal);\n        Index(page.Root, nodes);\n        foreach (var (nodeId, fields) in page.Responsive!.Wide.Overrides)\n        {\n            if (!nodes.TryGetValue(nodeId, out var node)) throw new InvalidDataException($"DJUI v6: wide \u8986\u76D6\u5F15\u7528\u4E0D\u5B58\u5728\u7684\u8282\u70B9: {nodeId}");\n            foreach (var (path, value) in fields) Apply(node, path, value);\n        }\n        return page;\n    }\n\n    private static void Index(DjuiNodeV6 node, Dictionary<string, DjuiNodeV6> nodes)\n    {\n        if (string.IsNullOrWhiteSpace(node.Id) || !nodes.TryAdd(node.Id, node)) throw new InvalidDataException($"DJUI v6: \u9875\u9762\u8282\u70B9 ID \u4E3A\u7A7A\u6216\u91CD\u590D: {node.Id}");\n        foreach (var child in node.Children) Index(child, nodes);\n    }\n\n    private static void CopyRuntimeMetadata(DjuiNodeV6 source, DjuiNodeV6 target)\n    {\n        if (!string.Equals(source.Id, target.Id, StringComparison.Ordinal) || source.Children.Count != target.Children.Count)\n            throw new InvalidDataException("DJUI v6: responsive clone structure changed");\n        target.TemplateLocalSize = source.TemplateLocalSize == null ? null : new DjuiSizeV6 { Width = source.TemplateLocalSize.Width, Height = source.TemplateLocalSize.Height };\n        for (var i = 0; i < source.Children.Count; i++) CopyRuntimeMetadata(source.Children[i], target.Children[i]);\n    }\n\n    internal static void ApplyOverride(DjuiNodeV6 node, string path, JsonElement value) => Apply(node, path, value);\n\n    private static void Apply(DjuiNodeV6 node, string path, JsonElement value)\n    {\n        switch (path)\n        {\n            case "basic.visible": (node.Basic ??= new()).Visible = Bool(value, path); break;\n            case "basic.disabled": (node.Basic ??= new()).Disabled = Bool(value, path); break;\n            case "transform.x": (node.Transform ??= new()).X = Number(value, path); break;\n            case "transform.y": (node.Transform ??= new()).Y = Number(value, path); break;\n            case "transform.width": (node.Transform ??= new()).Width = Number(value, path); break;\n            case "transform.height": (node.Transform ??= new()).Height = Number(value, path); break;\n            case "appearance.image": (node.Appearance ??= new()).Image = NullableString(value, path); break;\n            case "appearance.background": (node.Appearance ??= new()).Background = NullableString(value, path); break;\n            case "appearance.imageFit": (node.Appearance ??= new()).ImageFit = EnumString(value, path, "stretch", "contain", "cover"); break;\n            case "appearance.focalX": (node.Appearance ??= new()).FocalX = Unit(value, path); break;\n            case "appearance.focalY": (node.Appearance ??= new()).FocalY = Unit(value, path); break;\n            case "appearance.borderThickness": (node.Appearance ??= new()).BorderThickness = Number(value, path); break;\n            case "appearance.borderColor": (node.Appearance ??= new()).BorderColor = NullableString(value, path); break;\n            case "text.text": (node.Text ??= new()).Text = NullableString(value, path); break;\n            case "text.fontSize": (node.Text ??= new()).FontSize = Number(value, path); break;\n            case "text.textColor": (node.Text ??= new()).TextColor = NullableString(value, path); break;\n            case "text.strokeSize": (node.Text ??= new()).StrokeSize = Number(value, path); break;\n            case "text.strokeColor": (node.Text ??= new()).StrokeColor = NullableString(value, path); break;\n            case "text.bold": (node.Text ??= new()).Bold = Bool(value, path); break;\n            case "text.font": (node.Text ??= new()).Font = NullableString(value, path); break;\n            case "text.textWrap": (node.Text ??= new()).TextWrap = Bool(value, path); break;\n            case "button.imageHover": (node.Button ??= new()).ImageHover = NullableString(value, path); break;\n            case "button.imagePressed": (node.Button ??= new()).ImagePressed = NullableString(value, path); break;\n            case "button.imageDisabled": (node.Button ??= new()).ImageDisabled = NullableString(value, path); break;\n            case "progress.value": (node.Progress ??= new()).Value = Unit(value, path); break;\n            default: throw new InvalidDataException($"DJUI v6: \u4E0D\u5141\u8BB8\u54CD\u5E94\u5F0F\u8986\u76D6\u5B57\u6BB5: {path}");\n        }\n    }\n\n    private static float Number(JsonElement value, string path) => value.ValueKind == JsonValueKind.Number && value.TryGetSingle(out var result) && float.IsFinite(result) ? result : throw Invalid(path);\n    private static float Unit(JsonElement value, string path) => Math.Clamp(Number(value, path), 0, 1);\n    private static bool Bool(JsonElement value, string path) => value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : throw Invalid(path);\n    private static string? NullableString(JsonElement value, string path) => value.ValueKind == JsonValueKind.Null ? null : value.ValueKind == JsonValueKind.String ? value.GetString() : throw Invalid(path);\n    private static string EnumString(JsonElement value, string path, params string[] legal)\n    {\n        var result = NullableString(value, path) ?? throw Invalid(path);\n        return legal.Contains(result, StringComparer.Ordinal) ? result : throw Invalid(path);\n    }\n    private static InvalidDataException Invalid(string path) => new($"DJUI v6: \u54CD\u5E94\u5F0F\u8986\u76D6\u503C\u65E0\u6548: {path}");\n}\n';

// raw:D:\git\DJUI\runtime\DjuiTemplateExpanderV6.cs
var DjuiTemplateExpanderV6_default = `using System.Text.Json;

namespace DjuiRuntime;

/// <summary>Expands v6 template instances into one scoped authored tree.</summary>
public static class DjuiTemplateExpanderV6
{
    public const int MaxTemplateDepth = 32;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = false };

    public static DjuiPageV6 Expand(DjuiPageV6 window, IReadOnlyDictionary<string, DjuiPageV6> pages)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(pages);
        var result = Clone(window);
        var pageStack = new List<string> { window.PageId };
        ExpandChildren(result.Root, "", pages, pageStack, 0);
        return result;
    }

    private static void ExpandChildren(DjuiNodeV6 parent, string scope, IReadOnlyDictionary<string, DjuiPageV6> pages, List<string> pageStack, int depth)
    {
        for (var i = 0; i < parent.Children.Count; i++)
        {
            var node = parent.Children[i];
            node.Id = Scoped(scope, node.Id);
            if (!IsTemplateInstance(node))
            {
                ExpandChildren(node, scope, pages, pageStack, depth);
                continue;
            }

            if (!string.Equals(node.StarType, "TemplateInstance", StringComparison.Ordinal))
                throw new InvalidDataException($"DJUI v6: node '{node.Id}' with templateRef must use starType TemplateInstance");
            if (node.Children.Count != 0) throw new InvalidDataException($"DJUI v6: template instance '{node.Id}' cannot author children");
            if (string.IsNullOrWhiteSpace(node.TemplateRef)) throw new InvalidDataException($"DJUI v6: template instance '{node.Id}' has no templateRef");
            if (depth >= MaxTemplateDepth) throw new InvalidDataException($"DJUI v6: template nesting exceeds {MaxTemplateDepth} at '{node.Id}'");
            if (!pages.TryGetValue(node.TemplateRef, out var template)) throw new InvalidDataException($"DJUI v6: template not found: {node.TemplateRef}");
            if (!string.Equals(template.Kind, "template", StringComparison.Ordinal)) throw new InvalidDataException($"DJUI v6: page '{node.TemplateRef}' is not a template");
            if (template.LocalSize == null || template.LocalSize.Width <= 0 || template.LocalSize.Height <= 0) throw new InvalidDataException($"DJUI v6: template '{template.PageId}' has invalid localSize");
            if (pageStack.Contains(template.PageId, StringComparer.Ordinal)) throw new InvalidDataException($"DJUI v6: template cycle: {string.Join(" -> ", pageStack)} -> {template.PageId}");

            var children = template.Root.Children.Select(child => Clone(child)).ToList();
            ApplyOverrides(children, node.TemplateOverrides, node.Id);
            node.StarType = "Panel";
            node.TemplateLocalSize = new DjuiSizeV6 { Width = template.LocalSize.Width, Height = template.LocalSize.Height };
            node.Children = children;
            pageStack.Add(template.PageId);
            try { ExpandChildren(node, node.Id, pages, pageStack, depth + 1); }
            finally { pageStack.RemoveAt(pageStack.Count - 1); }
        }
    }

    private static void ApplyOverrides(List<DjuiNodeV6> roots, Dictionary<string, Dictionary<string, JsonElement>>? overrides, string instanceId)
    {
        if (overrides == null || overrides.Count == 0) return;
        var names = new Dictionary<string, DjuiNodeV6>(StringComparer.Ordinal);
        var duplicates = new HashSet<string>(StringComparer.Ordinal);
        foreach (var root in roots) IndexNames(root, names, duplicates);
        foreach (var (name, fields) in overrides)
        {
            if (duplicates.Contains(name)) throw new InvalidDataException($"DJUI v6: template instance '{instanceId}' override name is duplicate: {name}");
            if (!names.TryGetValue(name, out var node)) throw new InvalidDataException($"DJUI v6: template instance '{instanceId}' override name not found: {name}");
            foreach (var (path, value) in fields) DjuiResponsiveResolverV6.ApplyOverride(node, path, value);
        }
    }

    private static void IndexNames(DjuiNodeV6 node, Dictionary<string, DjuiNodeV6> names, HashSet<string> duplicates)
    {
        if (!string.IsNullOrWhiteSpace(node.Name) && !names.TryAdd(node.Name, node)) duplicates.Add(node.Name);
        foreach (var child in node.Children) IndexNames(child, names, duplicates);
    }

    private static bool IsTemplateInstance(DjuiNodeV6 node) => string.Equals(node.StarType, "TemplateInstance", StringComparison.Ordinal) || !string.IsNullOrWhiteSpace(node.TemplateRef);
    private static string Scoped(string scope, string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidDataException("DJUI v6: every node must have a non-empty ID");
        if (id.Contains('/')) throw new InvalidDataException($"DJUI v6: authored node ID cannot contain '/': {id}");
        return string.IsNullOrEmpty(scope) ? id : scope + "/" + id;
    }
    private static T Clone<T>(T source) where T : class => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(source, JsonOptions), JsonOptions) ?? throw new InvalidDataException("DJUI v6: template clone failed");
}
`;

// raw:D:\git\DJUI\runtime\DjuiTransitionPlayer.cs
var DjuiTransitionPlayer_default = '#if CLIENT\n\nusing GameUI.Control;\n\nnamespace DjuiRuntime;\n\npublic sealed class DjuiTransitionPlayer : IThinker\n{\n    private static readonly List<TransitionAnimation> Animations = new();\n    private static DjuiTransitionPlayer? _instance;\n    private static int _nextId;\n\n    public bool DoesThink { get; set; } = true;\n\n    public static int Play(Control control, string? presetName, Action? onComplete = null)\n    {\n        if (control == null || !control.IsValid)\n            return -1;\n\n        if (string.IsNullOrWhiteSpace(presetName) || string.Equals(presetName, "none", StringComparison.OrdinalIgnoreCase))\n            return -1;\n\n        if (!DjuiTransitionRegistry.TryGet(presetName, out var preset))\n        {\n            Game.Logger.LogWarning("DJUI: \u672A\u77E5\u7A97\u53E3\u8F6C\u573A\u9884\u8BBE {Name}", presetName);\n            return -1;\n        }\n\n        Stop(control);\n\n        var id = ++_nextId;\n        var snapshot = new DjuiTransitionSnapshot(control.Scale, control.Opacity, control.Margin);\n        var animation = new TransitionAnimation(id, control, preset, snapshot, onComplete);\n        Animations.Add(animation);\n        preset.Apply(control, 0f, snapshot);\n        EnsureRegistered();\n        return id;\n    }\n\n    public static void Stop(int id)\n    {\n        for (var i = Animations.Count - 1; i >= 0; i--)\n        {\n            if (Animations[i].Id == id)\n                Animations.RemoveAt(i);\n        }\n    }\n\n    public static void Stop(Control control)\n    {\n        for (var i = Animations.Count - 1; i >= 0; i--)\n        {\n            if (ReferenceEquals(Animations[i].Control, control))\n                Animations.RemoveAt(i);\n        }\n    }\n\n    private static void EnsureRegistered()\n    {\n        if (_instance != null) return;\n        _instance = new DjuiTransitionPlayer();\n        Game.RegisterThinker(_instance);\n    }\n\n    public void Think(int delta)\n    {\n        var dt = delta / 1000f;\n        for (var i = Animations.Count - 1; i >= 0; i--)\n        {\n            var animation = Animations[i];\n            if (!animation.Control.IsValid)\n            {\n                Animations.RemoveAt(i);\n                continue;\n            }\n\n            animation.Elapsed += dt;\n            var progress = Math.Clamp(animation.Elapsed / animation.Preset.Duration, 0f, 1f);\n            animation.Preset.Apply(animation.Control, progress, animation.Snapshot);\n\n            if (progress >= 1f)\n            {\n                Animations.RemoveAt(i);\n                animation.OnComplete?.Invoke();\n            }\n            else\n            {\n                Animations[i] = animation;\n            }\n        }\n    }\n\n    private sealed class TransitionAnimation\n    {\n        public TransitionAnimation(\n            int id,\n            Control control,\n            DjuiTransitionPreset preset,\n            DjuiTransitionSnapshot snapshot,\n            Action? onComplete)\n        {\n            Id = id;\n            Control = control;\n            Preset = preset;\n            Snapshot = snapshot;\n            OnComplete = onComplete;\n        }\n\n        public int Id { get; }\n        public Control Control { get; }\n        public DjuiTransitionPreset Preset { get; }\n        public DjuiTransitionSnapshot Snapshot { get; }\n        public Action? OnComplete { get; }\n        public float Elapsed { get; set; }\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiTransitionRegistry.cs
var DjuiTransitionRegistry_default = '#if CLIENT\n\nusing System.Numerics;\nusing GameUI.Control;\nusing GameUI.Struct;\n\nnamespace DjuiRuntime;\n\npublic sealed class DjuiTransitionPreset\n{\n    public DjuiTransitionPreset(float duration, Action<Control, float, DjuiTransitionSnapshot> apply)\n    {\n        Duration = MathF.Max(0.01f, duration);\n        Apply = apply;\n    }\n\n    public float Duration { get; }\n    public Action<Control, float, DjuiTransitionSnapshot> Apply { get; }\n}\n\npublic readonly record struct DjuiTransitionSnapshot(Vector2 Scale, float Opacity, Thickness Margin);\n\npublic static class DjuiTransitionRegistry\n{\n    private static readonly Dictionary<string, DjuiTransitionPreset> _presets = new();\n\n    static DjuiTransitionRegistry()\n    {\n        Register("none", new DjuiTransitionPreset(0.01f, static (_, _, _) => { }));\n\n        Register("pop_in", new DjuiTransitionPreset(0.28f, static (ctrl, progress, snapshot) =>\n        {\n            var p = Math.Clamp(progress, 0f, 1f);\n            var targetScale = GetTargetScale(snapshot);\n            var overshootScale = targetScale * 1.06f;\n            var startScale = targetScale * 0.85f;\n\n            ctrl.Opacity = GetTargetOpacity(snapshot) * EaseOutQuad(p);\n            ctrl.Scale = p < 0.62f\n                ? Lerp(startScale, overshootScale, EaseOutCubic(p / 0.62f))\n                : Lerp(overshootScale, targetScale, EaseOutCubic((p - 0.62f) / 0.38f));\n        }));\n\n        Register("pop_out", new DjuiTransitionPreset(0.16f, static (ctrl, progress, snapshot) =>\n        {\n            var p = Math.Clamp(progress, 0f, 1f);\n            var eased = EaseInCubic(p);\n            var targetScale = GetTargetScale(snapshot);\n\n            ctrl.Opacity = GetTargetOpacity(snapshot) * (1f - eased);\n            ctrl.Scale = Lerp(targetScale, targetScale * 0.9f, eased);\n        }));\n\n        Register("fade_in", new DjuiTransitionPreset(0.25f, static (ctrl, progress, snapshot) =>\n        {\n            ctrl.Opacity = GetTargetOpacity(snapshot) * EaseOutQuad(Math.Clamp(progress, 0f, 1f));\n        }));\n\n        Register("fade_out", new DjuiTransitionPreset(0.2f, static (ctrl, progress, snapshot) =>\n        {\n            ctrl.Opacity = GetTargetOpacity(snapshot) * (1f - EaseInCubic(Math.Clamp(progress, 0f, 1f)));\n        }));\n\n        Register("slide_up_in", new DjuiTransitionPreset(0.3f, static (ctrl, progress, snapshot) =>\n        {\n            var p = EaseOutCubic(Math.Clamp(progress, 0f, 1f));\n            var offset = 60f * (1f - p);\n            var margin = snapshot.Margin;\n\n            ctrl.Opacity = GetTargetOpacity(snapshot) * p;\n            ctrl.Margin = new Thickness(margin.Left, margin.Top + offset, margin.Right, margin.Bottom);\n        }));\n\n        Register("slide_down_out", new DjuiTransitionPreset(0.2f, static (ctrl, progress, snapshot) =>\n        {\n            var p = EaseInCubic(Math.Clamp(progress, 0f, 1f));\n            var margin = snapshot.Margin;\n\n            ctrl.Opacity = GetTargetOpacity(snapshot) * (1f - p);\n            ctrl.Margin = new Thickness(margin.Left, margin.Top + 60f * p, margin.Right, margin.Bottom);\n        }));\n    }\n\n    public static void Register(string name, DjuiTransitionPreset preset)\n    {\n        _presets[name] = preset;\n    }\n\n    public static bool TryGet(string? name, out DjuiTransitionPreset preset)\n    {\n        if (!string.IsNullOrWhiteSpace(name) && _presets.TryGetValue(name, out preset!))\n            return true;\n\n        preset = null!;\n        return false;\n    }\n\n    private static Vector2 GetTargetScale(DjuiTransitionSnapshot snapshot)\n    {\n        return snapshot.Scale is { X: > 0.01f, Y: > 0.01f }\n            ? snapshot.Scale\n            : Vector2.One;\n    }\n\n    private static float GetTargetOpacity(DjuiTransitionSnapshot snapshot)\n    {\n        return snapshot.Opacity > 0.01f ? snapshot.Opacity : 1f;\n    }\n\n    private static Vector2 Lerp(Vector2 from, Vector2 to, float progress)\n    {\n        return from + (to - from) * Math.Clamp(progress, 0f, 1f);\n    }\n\n    private static float EaseOutQuad(float value)\n    {\n        var t = Math.Clamp(value, 0f, 1f);\n        return 1f - (1f - t) * (1f - t);\n    }\n\n    private static float EaseOutCubic(float value)\n    {\n        var t = Math.Clamp(value, 0f, 1f);\n        var inv = 1f - t;\n        return 1f - inv * inv * inv;\n    }\n\n    private static float EaseInCubic(float value)\n    {\n        var t = Math.Clamp(value, 0f, 1f);\n        return t * t * t;\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiUiLoader.cs
var DjuiUiLoader_default = `// DJUI Runtime - \u4E3B\u52A0\u8F7D\u5668
// \u8BFB\u53D6 DJUI-Editor \u8F93\u51FA\u7684 JSON\uFF0C\u6784\u5EFA\u5B8C\u6574\u7684\u661F\u706B UI \u63A7\u4EF6\u6811

#if CLIENT

using System.IO;
using System.Numerics;
using System.Text.Json;
using System.Text.RegularExpressions;
using GameUI.Control;
using GameUI.Control.Primitive;
using GameUI.Control.Behavior;
using GameUI.Control.Extensions;
using GameUI.Device;
using GameUI.Enum;
using GameUI.Extensions;
using GameCore.Platform.SDL;

namespace DjuiRuntime;

/// <summary>
/// DJUI UI \u52A0\u8F7D\u5668\u3002\u8BFB\u53D6\u9875\u9762 JSON \u6587\u4EF6\u5E76\u6784\u5EFA\u63A7\u4EF6\u6811\u3002
/// </summary>
public class DjuiUiLoader
{
    private DjuiPageJson? _page;
    private static readonly HashSet<string> TemplateStack = new();

    private static bool TryParseColor(string? raw, out Color color)
    {
        color = Color.White;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        var value = raw.Trim();
        try
        {
            if (value.StartsWith("#"))
            {
                color = value.Length == 9
                    ? ColorExtensions.FromRgbaHex(value)
                    : ColorExtensions.FromHex(value);
                return true;
            }

            var match = Regex.Match(value, @"^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)$", RegexOptions.IgnoreCase);
            if (!match.Success) return false;

            var r = Math.Clamp(int.Parse(match.Groups[1].Value), 0, 255);
            var g = Math.Clamp(int.Parse(match.Groups[2].Value), 0, 255);
            var b = Math.Clamp(int.Parse(match.Groups[3].Value), 0, 255);
            var a = 255;
            if (match.Groups[4].Success)
            {
                var alpha = float.Parse(match.Groups[4].Value);
                a = alpha <= 1f ? Math.Clamp((int)MathF.Round(alpha * 255f), 0, 255) : Math.Clamp((int)MathF.Round(alpha), 0, 255);
            }
            color = Color.FromArgb(a, r, g, b);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// \u52A0\u8F7D\u9875\u9762 JSON \u6587\u4EF6\u3002
    /// </summary>
    public DjuiPageJson LoadPageJson(string filePath)
    {
        var json = File.ReadAllText(filePath);
        _page = JsonSerializer.Deserialize<DjuiPageJson>(json)!;
        return _page;
    }

    /// <summary>
    /// \u6784\u5EFA\u9875\u9762\u63A7\u4EF6\u6811\uFF0C\u8FD4\u56DE\u6839 Panel\u3002
    /// </summary>
    public Panel Build()
    {
        if (_page == null)
            throw new InvalidOperationException("\u8BF7\u5148\u8C03\u7528 LoadPageJson");

        // \u8BFB\u53D6\u5168\u5C40\u9ED8\u8BA4\u5B57\u4F53
        var defaultFont = ReadDefaultFont();

        var host = new Panel();
        host.FullScreen();
        host.ClipContent = true;

        void Rebuild()
        {
            host.ClearChildren();
            BuildIntoHost(host, _page, defaultFont);
        }

        DeviceInfo.PrimaryViewport.SetDesignResolution(_page.DesignWidth, _page.DesignHeight, ScaleMode.Contain);
        Rebuild();
        DeviceInfo.PrimaryViewport.OnSizeChanged += (_, _) => Rebuild();
        DeviceInfo.PrimaryViewport.OnOrientationChanged += _ => Rebuild();
        DeviceInfo.PrimaryViewport.OnDevicePixelRatioChanged += _ => Rebuild();
        return host;
    }

    /// <summary>
    /// \u6784\u5EFA\u6A21\u677F\u5B9E\u4F8B\uFF1A\u56FA\u5B9A\u5C3A\u5BF8\uFF0C\u4E0D\u5168\u5C4F\uFF0C\u4E0D\u505A\u89C6\u53E3\u9002\u914D\u3002
    /// </summary>
    public static Control BuildTemplateRoot(DjuiPageJson page)
    {
        var defaultFont = ReadDefaultFont();
        return BuildNode(page.Root, 0, 0, page.DesignWidth, page.DesignHeight, page.DesignWidth, page.DesignHeight, defaultFont);
    }

    private static void BuildIntoHost(Panel host, DjuiPageJson page, string? defaultFont)
    {
        var plan = DjuiViewportAdapter.CreatePlan(page);
        var backgroundNodes = page.Root.Children.Where(IsBackgroundNode).ToList();
        var hudNodes = page.Root.Children.Where(IsHudNode).ToList();
        var stageNodes = page.Root.Children.Where(x => !IsBackgroundNode(x) && !IsHudNode(x)).ToList();

        var backgroundLayer = new Panel();
        backgroundLayer.Width = plan.Viewport.Width;
        backgroundLayer.Height = plan.Viewport.Height;
        backgroundLayer.ClipContent = true;
        backgroundLayer.Margin = new Thickness(0, 0, 0, 0);
        host.AddChild(backgroundLayer);

        foreach (var backgroundNode in backgroundNodes)
        {
            var background = BuildNode(backgroundNode, 0, 0, plan.Background.Width, plan.Background.Height, plan.Viewport.Width, plan.Viewport.Height, defaultFont);
            background.Margin = new Thickness(plan.Background.X, plan.Background.Y, 0, 0);
            backgroundLayer.AddChild(background);
        }

        var stageRootNode = CreateRuntimeRoot(page.Root, stageNodes);
        var stageRoot = BuildNode(stageRootNode, 0, 0, page.DesignWidth, page.DesignHeight, page.DesignWidth, page.DesignHeight, defaultFont);
        stageRoot.Margin = new Thickness(plan.Content.X, plan.Content.Y, 0, 0);
        stageRoot.Scale = new Vector2(plan.Content.Scale, plan.Content.Scale);
        host.AddChild(stageRoot);

        var hudLayer = new Panel();
        hudLayer.Width = plan.Viewport.Width;
        hudLayer.Height = plan.Viewport.Height;
        hudLayer.Margin = new Thickness(0, 0, 0, 0);
        host.AddChild(hudLayer);

        foreach (var hudNode in hudNodes)
        {
            var hud = BuildNode(hudNode, 0, 0, page.DesignWidth, page.DesignHeight, page.DesignWidth, page.DesignHeight, defaultFont);
            var solved = DjuiLayoutSolver.Solve(hudNode, 0, 0, page.DesignWidth, page.DesignHeight, page.DesignWidth, page.DesignHeight);
            hud.Margin = ComputeHudMargin(hudNode, solved, page, plan);
            hud.Scale = new Vector2(plan.Content.Scale, plan.Content.Scale);
            hudLayer.AddChild(hud);
        }
    }

    private static bool IsBackgroundNode(DjuiNodeJson node)
    {
        if (string.Equals(node.Adapt?.Role, "background", StringComparison.OrdinalIgnoreCase))
            return true;
        if (!string.Equals(node.Name, "\u80CC\u666F", StringComparison.OrdinalIgnoreCase))
            return false;
        return !string.IsNullOrEmpty(node.Appearance?.Image);
    }

    private static bool IsHudNode(DjuiNodeJson node)
    {
        return string.Equals(node.Adapt?.Role, "hud", StringComparison.OrdinalIgnoreCase);
    }

    private static Thickness ComputeHudMargin(DjuiNodeJson node, SolvedRect solved, DjuiPageJson page, DjuiViewportPlan plan)
    {
        var scale = plan.Content.Scale;
        var pin = node.Adapt?.SafePin ?? "";
        var pinLeft = HasSafePin(pin, "left");
        var pinRight = HasSafePin(pin, "right");
        var pinTop = HasSafePin(pin, "top");
        var pinBottom = HasSafePin(pin, "bottom");

        var x = plan.Content.X + solved.X * scale;
        var y = plan.Content.Y + solved.Y * scale;

        if (pinLeft)
        {
            x = plan.Safe.X + solved.X * scale;
        }
        else if (pinRight)
        {
            x = plan.Safe.X + plan.Safe.Width - (page.DesignWidth - solved.X) * scale;
        }

        if (pinTop)
        {
            y = plan.Safe.Y + solved.Y * scale;
        }
        else if (pinBottom)
        {
            y = plan.Safe.Y + plan.Safe.Height - (page.DesignHeight - solved.Y) * scale;
        }

        return new Thickness(x, y, 0, 0);
    }

    private static bool HasSafePin(string safePin, string value)
    {
        return safePin
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(x => string.Equals(x, value, StringComparison.OrdinalIgnoreCase));
    }

    private static DjuiNodeJson CreateRuntimeRoot(DjuiNodeJson root, List<DjuiNodeJson> children)
    {
        return new DjuiNodeJson
        {
            Id = root.Id,
            StarType = root.StarType,
            Name = root.Name,
            Basic = root.Basic,
            Transform = root.Transform,
            Appearance = root.Appearance,
            Layout = root.Layout,
            Interaction = root.Interaction,
            Effects = root.Effects,
            Text = root.Text,
            Button = root.Button,
            Progress = root.Progress,
            Djui = root.Djui,
            WidthStretchRatio = root.WidthStretchRatio,
            HeightStretchRatio = root.HeightStretchRatio,
            WidthCompactRatio = root.WidthCompactRatio,
            HeightCompactRatio = root.HeightCompactRatio,
            Children = children,
            Anchor = root.Anchor,
            Stretch = root.Stretch,
            AspectRatio = root.AspectRatio,
            TemplateRef = root.TemplateRef,
            TemplateOverrides = root.TemplateOverrides,
            Adapt = root.Adapt,
        };
    }

    /// <summary>
    /// \u8BFB\u53D6\u5168\u5C40\u9ED8\u8BA4\u5B57\u4F53\u914D\u7F6E\u3002
    /// </summary>
    private static string? ReadDefaultFont()
    {
        try
        {
            var configPath = Path.Combine("user_files", "djui", "djui_config.json");
            if (File.Exists(configPath))
            {
                var cfgJson = File.ReadAllText(configPath);
                using var doc = JsonDocument.Parse(cfgJson);
                if (doc.RootElement.TryGetProperty("defaultFont", out var fontEl))
                    return fontEl.GetString();
            }
        }
        catch { /* ignore */ }
        return null;
    }

    /// <summary>
    /// \u52A0\u8F7D\u5E76\u6784\u5EFA\u9875\u9762\uFF0C\u8FD4\u56DE\u6839 Panel\u3002
    /// </summary>
    public Panel LoadAndBuild(string filePath)
    {
        LoadPageJson(filePath);
        return Build();
    }

    /// <summary>
    /// \u9012\u5F52\u6784\u5EFA\u63A7\u4EF6\u8282\u70B9\u3002
    /// </summary>
    /// <param name="parentWidth">\u7236\u8282\u70B9\u5BBD\u5EA6</param>
    /// <param name="parentHeight">\u7236\u8282\u70B9\u9AD8\u5EA6</param>
    /// <param name="screenWidth">\u5C4F\u5E55\u5BBD\u5EA6\uFF08target=screen \u65F6\u7528\uFF09</param>
    /// <param name="screenHeight">\u5C4F\u5E55\u9AD8\u5EA6</param>
    internal static Control BuildNode(
        DjuiNodeJson def,
        float parentX,
        float parentY,
        float parentWidth,
        float parentHeight,
        float screenWidth,
        float screenHeight,
        string? defaultFont = null)
    {
        if (string.Equals(def.StarType, "TemplateInstance", StringComparison.OrdinalIgnoreCase))
        {
            return BuildTemplateInstance(def, parentX, parentY, parentWidth, parentHeight, screenWidth, screenHeight, defaultFont);
        }

        // \u6839\u636E\u7C7B\u578B\u521B\u5EFA\u63A7\u4EF6
        Control ctrl = def.StarType switch
        {
            "Button" => new Button(),
            "Label" => new Label(),
            "Input" => new Input(),
            "Progress" => new Progress(),
            // SpacingPanel \u9700\u8981 GameLink\uFF0C\u7528 Panel + FlowOrientation \u66FF\u4EE3
            "SpacingPanel" => new Panel(),
            "PanelScrollable" => new PanelScrollable(),
            _ => new Panel(),
        };

        // \u2605 root \u8282\u70B9\u4EE3\u8868\u8BBE\u8BA1\u753B\u5E03\uFF0C\u5FC5\u987B\u4F7F\u7528\u9875\u9762\u8BBE\u8BA1\u5C3A\u5BF8\uFF0C\u4E0D\u80FD\u843D\u5230\u9ED8\u8BA4 100x100
        var solved = def.Id == "root"
            ? new SolvedRect(0, 0, parentWidth, parentHeight)
            : DjuiLayoutSolver.Solve(def, parentX, parentY, parentWidth, parentHeight, screenWidth, screenHeight);
        var relativeSolved = new SolvedRect(solved.X - parentX, solved.Y - parentY, solved.Width, solved.Height);

        // \u5E94\u7528\u5404\u5C5E\u6027\u7EC4
        ApplyBasic(ctrl, def.Basic);
        ApplySolvedLayout(ctrl, relativeSolved, def.Transform, def);
        ApplyAppearance(ctrl, def.Appearance);
        ApplyInteraction(ctrl, def.Interaction);
        ApplyLayout(ctrl, def.Layout, def);
        ApplyText(ctrl, def.Text, def.StarType, defaultFont);
        ApplyButtonTypeSpecific(ctrl, def);
        ApplyProgress(ctrl, def.Progress);

        ApplyEffects(ctrl, def);

        // \u6CE8\u518C\u63A7\u4EF6\u5230\u7ED1\u5B9A\u7CFB\u7EDF
        DjuiBindingSystem.RegisterControl(def.Id, ctrl);

        // Action \u8DEF\u7531
        if (def.Djui != null)
        {
            DjuiAudioSystem.BindClickSound(ctrl, def.Djui.ClickSoundId);
            DjuiActionRouter.BindAction(ctrl, def.Djui.Action);
        }

        // \u9012\u5F52\u6784\u5EFA\u5B50\u63A7\u4EF6\uFF08\u5B50\u8282\u70B9\u7684\u7236\u77E9\u5F62 = \u5F53\u524D\u63A7\u4EF6\u7684 solved \u77E9\u5F62\uFF09
        foreach (var childDef in def.Children)
        {
            var child = BuildNode(childDef, solved.X, solved.Y, solved.Width, solved.Height, screenWidth, screenHeight, defaultFont);
            child.Parent = ctrl;
        }

        return ApplyBorderWrapper(ctrl, def.Appearance);
    }

    private static Control ApplyBorderWrapper(Control ctrl, DjuiAppearanceJson? app)
    {
        if (app?.BorderThickness == null || app.BorderThickness.Value <= 0f)
            return ctrl;

        var thickness = Math.Max(0f, app.BorderThickness.Value);
        if (TryParseColor(app.BorderColor, out var borderColor))
            return ctrl.Border(thickness, borderColor);

        return ctrl.Border(thickness);
    }

    private static void ApplyEffects(Control ctrl, DjuiNodeJson def)
    {
        if (!string.IsNullOrEmpty(def.Effects?.Preset))
        {
            DjuiEffectPresets.Apply(def.Effects.Preset, ctrl);
            return;
        }

        if (ctrl is Button)
            DjuiEffectPresets.Apply("button_default", ctrl);
    }

    private static Control BuildTemplateInstance(
        DjuiNodeJson def,
        float parentX,
        float parentY,
        float parentWidth,
        float parentHeight,
        float screenWidth,
        float screenHeight,
        string? defaultFont)
    {
        var solved = DjuiLayoutSolver.Solve(def, parentX, parentY, parentWidth, parentHeight, screenWidth, screenHeight);
        var relativeSolved = new SolvedRect(solved.X - parentX, solved.Y - parentY, solved.Width, solved.Height);

        var host = new Panel();
        ApplyBasic(host, def.Basic);
        ApplySolvedLayout(host, relativeSolved, def.Transform, def);
        ApplyInteraction(host, def.Interaction);
        ApplyLayout(host, def.Layout, def);

        if (def.Effects != null && !string.IsNullOrEmpty(def.Effects.Preset))
            DjuiEffectPresets.Apply(def.Effects.Preset, host);

        DjuiBindingSystem.RegisterControl(def.Id, host);
        if (def.Djui != null)
        {
            DjuiAudioSystem.BindClickSound(host, def.Djui.ClickSoundId);
            DjuiActionRouter.BindAction(host, def.Djui.Action);
        }

        if (string.IsNullOrWhiteSpace(def.TemplateRef))
        {
            Game.Logger.LogWarning("DJUI: \u6A21\u677F\u5B9E\u4F8B {Id} \u672A\u914D\u7F6E templateRef", def.Id);
            return host;
        }

        if (!DjuiWindowManager.TryGetPage(def.TemplateRef, out var templatePage))
        {
            Game.Logger.LogWarning("DJUI: \u6A21\u677F {TemplateRef} \u4E0D\u5B58\u5728", def.TemplateRef);
            return host;
        }

        if (!string.Equals(templatePage.NodeKind, "template", StringComparison.OrdinalIgnoreCase))
        {
            Game.Logger.LogWarning("DJUI: {TemplateRef} \u4E0D\u662F\u6A21\u677F", def.TemplateRef);
            return host;
        }

        if (TemplateStack.Contains(def.TemplateRef))
        {
            Game.Logger.LogWarning("DJUI: \u68C0\u6D4B\u5230\u6A21\u677F\u5FAA\u73AF\u5F15\u7528 {TemplateRef}", def.TemplateRef);
            return host;
        }

        TemplateStack.Add(def.TemplateRef);
        try
        {
            foreach (var sourceChild in templatePage.Root.Children)
            {
                var childDef = CloneNode(sourceChild);
                ApplyTemplateOverrides(childDef, def.TemplateOverrides);
                var child = BuildNode(childDef, 0, 0, solved.Width, solved.Height, solved.Width, solved.Height, defaultFont);
                child.Parent = host;
            }
        }
        finally
        {
            TemplateStack.Remove(def.TemplateRef);
        }

        return host;
    }

    private static DjuiNodeJson CloneNode(DjuiNodeJson node)
    {
        var json = JsonSerializer.Serialize(node);
        return JsonSerializer.Deserialize<DjuiNodeJson>(json) ?? new DjuiNodeJson();
    }

    private static void ApplyTemplateOverrides(DjuiNodeJson node, Dictionary<string, Dictionary<string, JsonElement>>? overrides)
    {
        if (overrides == null) return;

        if (!string.IsNullOrEmpty(node.Name) && overrides.TryGetValue(node.Name, out var fields))
        {
            foreach (var (fieldPath, value) in fields)
                ApplyNodeOverride(node, fieldPath, value);
        }

        foreach (var child in node.Children)
            ApplyTemplateOverrides(child, overrides);
    }

    private static void ApplyNodeOverride(DjuiNodeJson node, string fieldPath, JsonElement value)
    {
        switch (fieldPath)
        {
            case "basic.visible":
                node.Basic ??= new DjuiBasicJson();
                node.Basic.Visible = ReadBool(value);
                break;
            case "basic.disabled":
                node.Basic ??= new DjuiBasicJson();
                node.Basic.Disabled = ReadBool(value);
                break;
            case "basic.isStatic":
                node.Basic ??= new DjuiBasicJson();
                node.Basic.IsStatic = ReadBool(value);
                break;
            case "transform.x":
                node.Transform ??= new DjuiTransformJson();
                node.Transform.X = ReadFloat(value);
                break;
            case "transform.y":
                node.Transform ??= new DjuiTransformJson();
                node.Transform.Y = ReadFloat(value);
                break;
            case "transform.width":
                node.Transform ??= new DjuiTransformJson();
                node.Transform.Width = ReadFloat(value);
                break;
            case "transform.height":
                node.Transform ??= new DjuiTransformJson();
                node.Transform.Height = ReadFloat(value);
                break;
            case "appearance.image":
                node.Appearance ??= new DjuiAppearanceJson();
                node.Appearance.Image = ReadString(value);
                break;
            case "appearance.background":
                node.Appearance ??= new DjuiAppearanceJson();
                node.Appearance.Background = ReadString(value);
                break;
            case "appearance.borderThickness":
                node.Appearance ??= new DjuiAppearanceJson();
                node.Appearance.BorderThickness = ReadFloat(value);
                break;
            case "appearance.borderColor":
                node.Appearance ??= new DjuiAppearanceJson();
                node.Appearance.BorderColor = ReadString(value);
                break;
            case "text.text":
                node.Text ??= new DjuiTextJson();
                node.Text.Text = ReadString(value);
                break;
            case "text.fontSize":
                node.Text ??= new DjuiTextJson();
                node.Text.FontSize = ReadFloat(value);
                break;
            case "text.textColor":
                node.Text ??= new DjuiTextJson();
                node.Text.TextColor = ReadString(value);
                break;
            case "text.strokeSize":
                node.Text ??= new DjuiTextJson();
                node.Text.StrokeSize = ReadFloat(value);
                break;
            case "text.strokeColor":
                node.Text ??= new DjuiTextJson();
                node.Text.StrokeColor = ReadString(value);
                break;
            case "text.bold":
                node.Text ??= new DjuiTextJson();
                node.Text.Bold = ReadBool(value);
                break;
            case "text.font":
                node.Text ??= new DjuiTextJson();
                node.Text.Font = ReadString(value);
                break;
            case "text.textWrap":
                node.Text ??= new DjuiTextJson();
                node.Text.TextWrap = ReadBool(value);
                break;
            case "text.textOverflow":
                node.Text ??= new DjuiTextJson();
                node.Text.TextOverflow = ReadString(value);
                break;
            case "button.imageHover":
                node.Button ??= new DjuiButtonJson();
                node.Button.ImageHover = ReadString(value);
                break;
            case "button.imagePressed":
                node.Button ??= new DjuiButtonJson();
                node.Button.ImagePressed = ReadString(value);
                break;
            case "progress.value":
                node.Progress ??= new DjuiProgressJson();
                node.Progress.Value = ReadFloat(value);
                break;
        }
    }

    private static string? ReadString(JsonElement value)
    {
        return value.ValueKind == JsonValueKind.Null ? null : value.ToString();
    }

    private static float? ReadFloat(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetSingle(out var result))
            return result;
        if (value.ValueKind == JsonValueKind.String && float.TryParse(value.GetString(), out result))
            return result;
        return null;
    }

    private static bool? ReadBool(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.True) return true;
        if (value.ValueKind == JsonValueKind.False) return false;
        if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var result))
            return result;
        return null;
    }

    private static void ApplyBasic(Control ctrl, DjuiBasicJson? basic)
    {
        if (basic == null) return;
        if (basic.Visible.HasValue) ctrl.Visible = basic.Visible.Value;
        if (basic.Disabled.HasValue) ctrl.Disabled = basic.Disabled.Value;
        if (basic.IsStatic.HasValue) ctrl.IsStatic = basic.IsStatic.Value;
    }

    /// <summary>
    /// \u5E94\u7528 layout solver \u7B97\u51FA\u7684\u6700\u7EC8\u77E9\u5F62\u5230\u63A7\u4EF6\u3002
    /// \u951A\u70B9/\u62C9\u4F38/\u5BBD\u9AD8\u6BD4\u5DF2\u7ECF\u7531 solver \u5904\u7406\uFF0C\u8FD9\u91CC\u53EA\u505A\u7EDD\u5BF9\u5B9A\u4F4D + \u5C3A\u5BF8 + \u65CB\u8F6C/\u900F\u660E\u5EA6\u3002
    /// </summary>
    private static void ApplySolvedLayout(Control ctrl, SolvedRect solved, DjuiTransformJson? t, DjuiNodeJson? node)
    {
        // \u7EDD\u5BF9\u5B9A\u4F4D\uFF08solver \u7B97\u51FA\u7684 x/y \u5DF2\u7ECF\u662F\u76F8\u5BF9\u7236\u77E9\u5F62\u5DE6\u4E0A\u7684\u6700\u7EC8\u5750\u6807\uFF09
        ctrl.HorizontalAlignment = HorizontalAlignment.Left;
        ctrl.VerticalAlignment = VerticalAlignment.Top;
        if (node != null && DjuiLayoutSolver.ShouldUseNativeAutoWidth(node))
            ctrl.AutoWidth();
        else
            ctrl.Width = solved.Width;

        if (node != null && DjuiLayoutSolver.ShouldUseNativeAutoHeight(node))
            ctrl.AutoHeight();
        else
            ctrl.Height = solved.Height;

        ctrl.Margin = new Thickness(solved.X, solved.Y, 0, 0);

        // \u65CB\u8F6C/\u900F\u660E\u5EA6/Z\uFF08\u8FD9\u4E9B\u4E0D\u53C2\u4E0E\u5E03\u5C40\u6C42\u89E3\uFF09
        if (t != null)
        {
            if (t.Rotation.HasValue) ctrl.Rotation = t.Rotation.Value;
            if (t.Opacity.HasValue) ctrl.Opacity = t.Opacity.Value;
            if (t.ZIndex.HasValue) ctrl.ZIndex = t.ZIndex.Value;
        }
    }

    private static void ApplyAppearance(Control ctrl, DjuiAppearanceJson? app)
    {
        if (app == null) return;

        if (!string.IsNullOrEmpty(app.Image))
            ctrl.Image = app.Image!;

        if (!string.IsNullOrEmpty(app.Background))
        {
            if (TryParseColor(app.Background, out var bg))
                ctrl.Background = bg;
            else
                Game.Logger.LogWarning("DJUI: \u5FFD\u7565\u65E0\u6CD5\u89E3\u6790\u7684\u80CC\u666F\u8272 {Color}", app.Background);
        }

        if (app.CornerRadius.HasValue) ctrl.CornerRadius = app.CornerRadius.Value;
        if (app.ClipContent.HasValue) ctrl.ClipContent = app.ClipContent.Value;
        if (app.Desaturated.HasValue) ctrl.Desaturated = app.Desaturated.Value;
        if (app.ImageFlipX.HasValue) ctrl.ImageFlipX = app.ImageFlipX.Value;
        if (app.ImageFlipY.HasValue) ctrl.ImageFlipY = app.ImageFlipY.Value;
        if (app.SlicedEdges != null && app.SlicedEdges.Length == 4)
            ctrl.SlicedEdges = new Thickness(app.SlicedEdges[0], app.SlicedEdges[1], app.SlicedEdges[2], app.SlicedEdges[3]);
    }

    private static void ApplyInteraction(Control ctrl, DjuiInteractionJson? interaction)
    {
        if (interaction == null) return;

        if (!string.IsNullOrEmpty(interaction.RoutedEvents))
        {
            if (Enum.TryParse<RoutedEvents>(interaction.RoutedEvents, out var re))
                ctrl.RoutedEvents = re;
        }

        if (interaction.AllowDrag.HasValue) ctrl.AllowDrag = interaction.AllowDrag.Value;
        if (interaction.AllowDrop.HasValue) ctrl.AllowDrop = interaction.AllowDrop.Value;

        // TouchBehavior \u89E3\u6790
        if (interaction.Behaviors != null)
        {
            foreach (var beh in interaction.Behaviors)
            {
                if (beh.Type == "TouchBehavior")
                {
                    ctrl.AddTouchBehavior(
                        scaleFactor: beh.ScaleFactor ?? 1f,
                        enablePressAnimation: beh.EnablePressAnimation ?? false,
                        enableLongPress: beh.EnableLongPress ?? false
                    );
                }
            }
        }
    }

    /// <summary>
    /// \u5E94\u7528\u5E03\u5C40\u5C5E\u6027\uFF1A\u5185\u5BB9\u5BF9\u9F50\u3001\u81EA\u52A8\u5E03\u5C40\u65B9\u5411\u3001\u95F4\u8DDD\u3001Flex\u3002
    /// \u6CE8\u610F\uFF1A\u5185\u5BB9\u5BF9\u9F50\u662F\u63A7\u4EF6\u5185\u90E8\u5185\u5BB9\u7684\u5BF9\u9F50\uFF0C\u4E0E\u63A7\u4EF6\u81EA\u8EAB\u5728\u7236\u7EA7\u4E2D\u7684\u4F4D\u7F6E\u65E0\u5173\u3002
    /// </summary>
    private static void ApplyLayout(Control ctrl, DjuiLayoutJson? layout, DjuiNodeJson? node)
    {
        if (layout == null) return;
        // \u5185\u5BB9\u5BF9\u9F50
        if (!string.IsNullOrEmpty(layout.HorizontalContentAlignment))
        {
            if (Enum.TryParse<HorizontalContentAlignment>(layout.HorizontalContentAlignment, out var ha))
                ctrl.HorizontalContentAlignment = ha;
        }
        if (!string.IsNullOrEmpty(layout.VerticalContentAlignment))
        {
            if (Enum.TryParse<VerticalContentAlignment>(layout.VerticalContentAlignment, out var va))
                ctrl.VerticalContentAlignment = va;
        }
        // \u81EA\u52A8\u5E03\u5C40\u5728\u7F16\u8F91\u5668\u4E2D\u5DF2\u7ECF\u5199\u56DE transform\u3002
        // \u8FD0\u884C\u65F6\u53EA\u6309 transform \u6E32\u67D3\uFF0C\u4E0D\u80FD\u518D\u8BBE\u7F6E FlowOrientation / Flex\uFF0C\u5426\u5219\u4F1A\u4E8C\u6B21\u6392\u7248\u5BFC\u81F4\u4F4D\u7F6E\u6F02\u79FB\u3002
    }

    private static void ApplyText(Control ctrl, DjuiTextJson? text, string starType, string? defaultFont)
    {
        if (text == null) return;
        if (text.Text == null) return;

        // \u5B57\u4F53\u4F18\u5148\u7EA7\uFF1A\u8282\u70B9\u5B57\u4F53 > \u5168\u5C40\u9ED8\u8BA4\u5B57\u4F53
        var font = !string.IsNullOrEmpty(text.Font) ? text.Font! : defaultFont;

        if (ctrl is Label label)
        {
            ApplyTextToLabel(label, text, font);
        }
        else if (ctrl is Input input)
        {
            input.Text = text.Text;
            if (!string.IsNullOrEmpty(font)) input.Font = font;
            if (text.FontSize.HasValue) input.FontSize = text.FontSize.Value;
            if (TryParseColor(text.TextColor, out var color)) input.TextColor = color;
            if (text.Bold.HasValue) input.Bold = text.Bold.Value;
        }
        else if (ctrl is Button button)
        {
            var buttonLabel = new Label
            {
                IsStatic = true,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                HorizontalContentAlignment = button.HorizontalContentAlignment,
                VerticalContentAlignment = button.VerticalContentAlignment,
                Width = button.Width,
                Height = button.Height,
                Margin = new Thickness(0, 0, 0, 0),
            };
            ApplyTextToLabel(buttonLabel, text, font);
            buttonLabel.Parent = button;
        }
    }

    private static void ApplyTextToLabel(Label label, DjuiTextJson text, string? font)
    {
        label.Text = text.Text;
        if (!string.IsNullOrEmpty(font)) label.Font = font;
        if (text.FontSize.HasValue) label.FontSize = text.FontSize.Value;
        if (TryParseColor(text.TextColor, out var color)) label.TextColor = color;
        if (text.StrokeSize.HasValue) label.StrokeSize = Math.Max(0f, text.StrokeSize.Value);
        if (TryParseColor(text.StrokeColor, out var strokeColor)) label.StrokeColor = strokeColor;
        if (text.Bold.HasValue) label.Bold = text.Bold.Value;
        if (text.TextWrap.HasValue) label.TextWrap = text.TextWrap.Value;
        if (!string.IsNullOrEmpty(text.TextOverflow))
        {
            label.TextTrimming = text.TextOverflow switch
            {
                "None" => TextTrimming.None,
                "Clip" => TextTrimming.Clip,
                "Ellipsis" => TextTrimming.Ellipsis,
                "Shrink" => TextTrimming.Shrink,
                _ => label.TextTrimming
            };
        }
    }

    private static void ApplyButtonTypeSpecific(Control ctrl, DjuiNodeJson def)
    {
        if (ctrl is not Button btn || def.Button == null) return;

        if (!string.IsNullOrEmpty(def.Button.ImageHover))
            btn.ImageHover = def.Button.ImageHover!;

        if (!string.IsNullOrEmpty(def.Button.ImagePressed))
            btn.ImagePressed = def.Button.ImagePressed!;
    }

    private static void ApplyProgress(Control ctrl, DjuiProgressJson? progress)
    {
        if (ctrl is not Progress prog || progress == null) return;

        if (progress.Value.HasValue) prog.Value = progress.Value.Value;

        if (!string.IsNullOrEmpty(progress.ProgressionMode))
        {
            if (Enum.TryParse<ProgressionMode>(progress.ProgressionMode, out var mode))
                prog.ProgressionMode = mode;
        }

        if (progress.Rotation.HasValue) prog.ProgressRotation = progress.Rotation.Value;
    }
}

#endif
`;

// raw:D:\git\DJUI\runtime\DjuiViewportAdapter.cs
var DjuiViewportAdapter_default = "#if CLIENT\n\nusing GameUI.Device;\n\nnamespace DjuiRuntime;\n\npublic readonly struct DjuiLayoutRect\n{\n    public readonly float X;\n    public readonly float Y;\n    public readonly float Width;\n    public readonly float Height;\n    public readonly float Scale;\n\n    public DjuiLayoutRect(float x, float y, float width, float height, float scale)\n    {\n        X = x;\n        Y = y;\n        Width = width;\n        Height = height;\n        Scale = scale;\n    }\n}\n\npublic sealed class DjuiViewportPlan\n{\n    public DjuiLayoutRect Viewport { get; init; }\n    public DjuiLayoutRect Safe { get; init; }\n    public DjuiLayoutRect Content { get; init; }\n    public DjuiLayoutRect Background { get; init; }\n}\n\npublic static class DjuiViewportAdapter\n{\n    public static DjuiViewportPlan CreatePlan(DjuiPageJson page)\n    {\n        var viewport = DeviceInfo.PrimaryViewport;\n        var size = viewport.Size;\n        var safePadding = viewport.SafeZonePadding;\n        var adaptation = page.Adaptation;\n        var useSafeArea = adaptation?.SafeArea ?? true;\n        var designWidth = adaptation?.DesignWidth ?? page.DesignWidth;\n        var designHeight = adaptation?.DesignHeight ?? page.DesignHeight;\n\n        var viewportRect = new DjuiLayoutRect(0, 0, MathF.Max(1, size.Width), MathF.Max(1, size.Height), 1);\n        var safeLeft = useSafeArea ? MathF.Max(0, safePadding.Left) : 0;\n        var safeTop = useSafeArea ? MathF.Max(0, safePadding.Top) : 0;\n        var safeRight = useSafeArea ? MathF.Max(0, safePadding.Right) : 0;\n        var safeBottom = useSafeArea ? MathF.Max(0, safePadding.Bottom) : 0;\n        var safeRect = new DjuiLayoutRect(\n            safeLeft,\n            safeTop,\n            MathF.Max(1, viewportRect.Width - safeLeft - safeRight),\n            MathF.Max(1, viewportRect.Height - safeTop - safeBottom),\n            1);\n\n        var minScale = adaptation?.MinScale ?? 0.75f;\n        var maxScale = adaptation?.MaxScale ?? 1.25f;\n        var contentScale = MathF.Min(safeRect.Width / designWidth, safeRect.Height / designHeight);\n        contentScale = Math.Clamp(contentScale, minScale, maxScale);\n        contentScale = MathF.Min(contentScale, MathF.Min(safeRect.Width / designWidth, safeRect.Height / designHeight));\n\n        var contentWidth = designWidth * contentScale;\n        var contentHeight = designHeight * contentScale;\n        var contentX = safeRect.X + (safeRect.Width - contentWidth) * 0.5f;\n        var contentY = safeRect.Y + (safeRect.Height - contentHeight) * 0.5f;\n        var contentRect = new DjuiLayoutRect(contentX, contentY, contentWidth, contentHeight, contentScale);\n\n        var backgroundScale = MathF.Max(viewportRect.Width / designWidth, viewportRect.Height / designHeight);\n        var backgroundWidth = designWidth * backgroundScale;\n        var backgroundHeight = designHeight * backgroundScale;\n        var backgroundRect = new DjuiLayoutRect(\n            (viewportRect.Width - backgroundWidth) * 0.5f,\n            (viewportRect.Height - backgroundHeight) * 0.5f,\n            backgroundWidth,\n            backgroundHeight,\n            backgroundScale);\n\n        return new DjuiViewportPlan\n        {\n            Viewport = viewportRect,\n            Safe = safeRect,\n            Content = contentRect,\n            Background = backgroundRect,\n        };\n    }\n}\n\n#endif\n";

// raw:D:\git\DJUI\runtime\DjuiWindowManager.cs
var DjuiWindowManager_default = '// DJUI Runtime - \u7A97\u53E3\u7BA1\u7406\u5668\n// \u63D0\u4F9B\u7A97\u53E3\u6CE8\u518C\u3001\u6253\u5F00\u3001\u5173\u95ED\u3001\u67E5\u627E\u529F\u80FD\n\n#if CLIENT\n\nusing System.IO;\nusing System.Text.Json;\nusing GameUI.Control;\nusing GameUI.Control.Primitive;\nusing GameUI.Control.Extensions;\nusing GameCore.Platform.SDL;\n\nnamespace DjuiRuntime;\n\n/// <summary>\n/// \u7A97\u53E3\u7BA1\u7406\u5668\u3002\u8D1F\u8D23\u626B\u63CF\u9875\u9762 JSON\u3001\u6CE8\u518C\u7A97\u53E3\u3001\u6253\u5F00/\u5173\u95ED\u7A97\u53E3\u3002\n/// \u7528\u6CD5\uFF1A\n///   DjuiWindowManager.Initialize();\n///   DjuiWindowManager.OpenWindow("main_menu");\n///   var btn = DjuiWindowManager.GetControl("button_start");\n/// </summary>\npublic static class DjuiWindowManager\n{\n    // \u9875\u9762 JSON \u6839\u76EE\u5F55\n    private const string PagesDir = "user_files/djui/pages";\n    private const int NormalWindowBaseZIndex = 1000;\n    private const int PopupWindowBaseZIndex = 100000;\n\n    // \u5DF2\u52A0\u8F7D\u7684\u9875\u9762 JSON \u7F13\u5B58\n    private static readonly Dictionary<string, DjuiPageJson> _pageCache = new();\n\n    // \u5F53\u524D\u6253\u5F00\u7684\u7A97\u53E3\uFF08pageId \u2192 \u6839 Panel\uFF09\n    private static readonly Dictionary<string, Panel> _openWindows = new();\n    private static readonly HashSet<string> _closingWindows = new();\n    private static int _nextWindowOrder = 0;\n\n    /// <summary>\n    /// \u521D\u59CB\u5316\uFF1A\u626B\u63CF\u9875\u9762\u76EE\u5F55\uFF0C\u52A0\u8F7D\u6240\u6709\u9875\u9762 JSON\u3002\n    /// \u5E94\u5728 OnGameTriggerInitialization \u4E2D\u8C03\u7528\u3002\n    /// </summary>\n    public static void Initialize()\n    {\n        _pageCache.Clear();\n        _closingWindows.Clear();\n        _nextWindowOrder = 0;\n        DjuiAudioSystem.Initialize();\n\n        if (!Directory.Exists(PagesDir))\n        {\n            // \u663E\u5F0F\u62A5\u9519\uFF08\u539F\u4E3A\u9759\u9ED8 return\uFF0CAppBundle \u65AD\u4F9B\u4F1A\u4EE5"\u9875\u9762\u6CA1\u5F00"\u8F6F\u6545\u969C\u5F62\u5F0F\u6F0F\u8FC7\uFF09\n            Game.Logger.LogError(\n                "DJUI: \u9875\u9762\u76EE\u5F55 {Dir} \u4E0D\u5B58\u5728\u2014\u2014AppBundle \u65AD\u4F9B\u3002\u8BF7\u5728 DJUI \u7F16\u8F91\u5668\u70B9\u300C\u53D1\u5E03\u300D\uFF08\u81EA\u52A8\u5199\u5165 AppBundle \u4E0E ui/AppBundle \u53CC\u7AEF user_files/djui/pages\uFF09\uFF0C\u52FF\u624B\u5DE5\u62F7\u8D1D\u3002\u8BE6\u89C1 src/DjuiRuntime/AGENTS.md",\n                PagesDir);\n            return;\n        }\n\n        foreach (var file in Directory.GetFiles(PagesDir, "*.json"))\n        {\n            try\n            {\n                var json = File.ReadAllText(file);\n                var page = JsonSerializer.Deserialize<DjuiPageJson>(json);\n                if (page != null && !string.IsNullOrEmpty(page.PageId))\n                {\n                    _pageCache[page.PageId] = page;\n                }\n            }\n            catch (Exception ex)\n            {\n                Game.Logger.LogError("DJUI: \u52A0\u8F7D\u9875\u9762 {File} \u5931\u8D25: {Error}", file, ex.Message);\n            }\n        }\n\n        if (_pageCache.Count == 0)\n        {\n            Game.Logger.LogError(\n                "DJUI: \u9875\u9762\u76EE\u5F55 {Dir} \u5B58\u5728\u4F46\u672A\u626B\u63CF\u5230\u4EFB\u4F55\u9875\u9762\u2014\u2014\u53D1\u5E03\u53EF\u80FD\u4E2D\u65AD\u6216\u9875\u9762 JSON \u5168\u90E8\u65E0\u6548\u3002\u8BF7\u91CD\u65B0\u5728 DJUI \u7F16\u8F91\u5668\u70B9\u300C\u53D1\u5E03\u300D\u3002\u8BE6\u89C1 src/DjuiRuntime/AGENTS.md",\n                PagesDir);\n        }\n        else\n        {\n            Game.Logger.LogInformation("DJUI: \u5DF2\u52A0\u8F7D {Count} \u4E2A\u9875\u9762", _pageCache.Count);\n        }\n    }\n\n    /// <summary>\n    /// \u6253\u5F00\u7A97\u53E3\uFF08\u5168\u5C4F\uFF09\u3002\n    /// </summary>\n    /// <param name="pageId">\u9875\u9762 ID\uFF08JSON \u4E2D\u7684 pageId \u5B57\u6BB5\uFF09</param>\n    /// <returns>\u6839 Panel\uFF0C\u5931\u8D25\u8FD4\u56DE null</returns>\n    public static Panel? OpenWindow(string pageId)\n    {\n        if (_openWindows.TryGetValue(pageId, out var existing))\n        {\n            if (_closingWindows.Remove(pageId))\n            {\n                DjuiTransitionPlayer.Stop(existing);\n                existing.RemoveFromVisualTree();\n                _openWindows.Remove(pageId);\n            }\n            else\n            {\n                return existing;\n            }\n        }\n\n        if (!_pageCache.TryGetValue(pageId, out var page))\n        {\n            // \u663E\u5F0F\u5217\u51FA\u5DF2\u6CE8\u518C\u9875\u9762\u4E0E\u4FEE\u590D\u6307\u5F15\uFF08\u539F\u4E3A\u5355\u884C warning\uFF0C\u6392\u969C\u56F0\u96BE\uFF09\n            var registered = _pageCache.Count > 0 ? string.Join(", ", _pageCache.Keys) : "\uFF08\u65E0\u2014\u2014Initialize \u672A\u626B\u63CF\u5230\u4EFB\u4F55\u9875\u9762\uFF0CAppBundle \u53EF\u80FD\u65AD\u4F9B\uFF09";\n            Game.Logger.LogError(\n                "DJUI: \u9875\u9762 {PageId} \u4E0D\u5B58\u5728\u3002\u5DF2\u6CE8\u518C\u9875\u9762\uFF1A{Registered}\u3002\u82E5\u6E05\u5355\u4E3A\u7A7A\u6216\u7F3A\u5C11\u76EE\u6807\u9875\uFF1A\u8BF7\u5728 DJUI \u7F16\u8F91\u5668\u70B9\u300C\u53D1\u5E03\u300D\uFF08\u53CC\u7AEF AppBundle\uFF09\uFF1B\u82E5\u62FC\u5199\u9519\u8BEF\uFF1A\u5BF9\u7167\u6E05\u5355\u4FEE\u6B63 pageId\u3002\u8BE6\u89C1 src/DjuiRuntime/AGENTS.md",\n                pageId, registered);\n            return null;\n        }\n\n        if (!string.Equals(page.NodeKind, "window", StringComparison.OrdinalIgnoreCase))\n        {\n            Game.Logger.LogWarning("DJUI: {PageId} \u4E0D\u662F\u7A97\u53E3\uFF0C\u8BF7\u68C0\u67E5\u9875\u9762 nodeKind \u914D\u7F6E", pageId);\n            return null;\n        }\n\n        // \u6784\u5EFA\u63A7\u4EF6\u6811\n        var loader = new DjuiUiLoader();\n        loader.LoadPageJson(Path.Combine(PagesDir, $"{pageId}.json"));\n        var root = loader.Build();\n        root.FullScreen();\n        root.ZIndex = AllocateWindowZIndex(page);\n        root.AddToVisualTree();\n\n        _closingWindows.Remove(pageId);\n        _openWindows[pageId] = root;\n        DjuiTransitionPlayer.Play(root, GetOpenTransition(page));\n        Game.Logger.LogInformation("DJUI: \u5DF2\u6253\u5F00\u7A97\u53E3 {PageId}", pageId);\n        return root;\n    }\n\n    /// <summary>\n    /// \u4ECE\u6A21\u677F\u5B9E\u4F8B\u5316\u63A7\u4EF6\u3002\u8FD4\u56DE\u56FA\u5B9A\u5C3A\u5BF8\u6839\u63A7\u4EF6\uFF0C\u4E0D\u81EA\u52A8\u6DFB\u52A0\u5230\u53EF\u89C6\u6811\u3002\n    /// </summary>\n    public static Control? CreateTemplate(string templateId)\n    {\n        if (!_pageCache.TryGetValue(templateId, out var page))\n        {\n            Game.Logger.LogWarning("DJUI: \u6A21\u677F {TemplateId} \u4E0D\u5B58\u5728", templateId);\n            return null;\n        }\n\n        if (!string.Equals(page.NodeKind, "template", StringComparison.OrdinalIgnoreCase))\n        {\n            Game.Logger.LogWarning("DJUI: {TemplateId} \u4E0D\u662F\u6A21\u677F", templateId);\n            return null;\n        }\n\n        return DjuiUiLoader.BuildTemplateRoot(page);\n    }\n\n    /// <summary>\n    /// \u5173\u95ED\u7A97\u53E3\u3002\n    /// </summary>\n    public static void CloseWindow(string pageId)\n    {\n        if (!_openWindows.TryGetValue(pageId, out var panel)) return;\n        if (_closingWindows.Contains(pageId)) return;\n\n        var page = _pageCache.TryGetValue(pageId, out var cachedPage) ? cachedPage : null;\n        var closeTransition = GetCloseTransition(page);\n        _closingWindows.Add(pageId);\n\n        var transitionId = DjuiTransitionPlayer.Play(panel, closeTransition, () =>\n        {\n            if (_openWindows.TryGetValue(pageId, out var currentPanel) && ReferenceEquals(currentPanel, panel))\n            {\n                panel.RemoveFromVisualTree();\n                _openWindows.Remove(pageId);\n            }\n\n            _closingWindows.Remove(pageId);\n            Game.Logger.LogInformation("DJUI: \u5DF2\u5173\u95ED\u7A97\u53E3 {PageId}", pageId);\n        });\n\n        if (transitionId < 0)\n        {\n            if (_openWindows.TryGetValue(pageId, out var currentPanel) && ReferenceEquals(currentPanel, panel))\n            {\n                panel.RemoveFromVisualTree();\n                _openWindows.Remove(pageId);\n            }\n\n            _closingWindows.Remove(pageId);\n            Game.Logger.LogInformation("DJUI: \u5DF2\u5173\u95ED\u7A97\u53E3 {PageId}", pageId);\n        }\n    }\n\n    /// <summary>\n    /// \u5173\u95ED\u6240\u6709\u7A97\u53E3\u3002\n    /// </summary>\n    public static void CloseAll()\n    {\n        foreach (var pageId in _openWindows.Keys.ToList())\n        {\n            CloseWindow(pageId);\n        }\n    }\n\n    /// <summary>\n    /// \u7A97\u53E3\u662F\u5426\u5DF2\u6253\u5F00\u3002\n    /// </summary>\n    public static bool IsOpen(string pageId)\n    {\n        return _openWindows.ContainsKey(pageId);\n    }\n\n    public static Panel? GetOpenWindow(string pageId)\n    {\n        return _openWindows.TryGetValue(pageId, out var panel) ? panel : null;\n    }\n\n    /// <summary>\n    /// \u83B7\u53D6\u6240\u6709\u5DF2\u6CE8\u518C\u7684\u9875\u9762 ID\u3002\n    /// </summary>\n    public static IReadOnlyList<string> GetRegisteredPageIds()\n    {\n        return _pageCache.Keys.ToList();\n    }\n\n    internal static bool TryGetPage(string pageId, out DjuiPageJson page)\n    {\n        return _pageCache.TryGetValue(pageId, out page!);\n    }\n\n    /// <summary>\n    /// \u4ECE\u5F53\u524D\u6253\u5F00\u7684\u7A97\u53E3\u4E2D\u6309\u8282\u70B9 ID \u67E5\u627E\u63A7\u4EF6\u3002\n    /// \u82E5\u6709\u591A\u4E2A\u7A97\u53E3\u6253\u5F00\uFF0C\u641C\u7D22\u6240\u6709\u7A97\u53E3\u3002\n    /// </summary>\n    public static Control? GetControl(string nodeId)\n    {\n        foreach (var panel in _openWindows.Values)\n        {\n            var found = FindControlById(panel, nodeId);\n            if (found != null) return found;\n        }\n        return null;\n    }\n\n    /// <summary>\n    /// \u4ECE\u6307\u5B9A\u7A97\u53E3\u4E2D\u6309\u8282\u70B9 ID \u67E5\u627E\u63A7\u4EF6\u3002\n    /// </summary>\n    public static Control? GetControl(string pageId, string nodeId)\n    {\n        if (!_openWindows.TryGetValue(pageId, out var panel)) return null;\n        return FindControlById(panel, nodeId);\n    }\n\n    /// <summary>\n    /// \u4ECE\u6307\u5B9A\u63A7\u4EF6\u6309\u7C7B\u578B\u67E5\u627E\uFF08\u5982 Button\u3001Label\uFF09\u3002\n    /// </summary>\n    public static T? GetControl<T>(string nodeId) where T : Control\n    {\n        return GetControl(nodeId) as T;\n    }\n\n    // \u9012\u5F52\u67E5\u627E\u5B50\u63A7\u4EF6\uFF08\u6309 DJUI \u8282\u70B9 ID\uFF0C\u5B58\u50A8\u5728\u63A7\u4EF6\u7684 Tag \u6216\u904D\u5386 Name\uFF09\n    // DJUI loader \u6CE8\u518C\u4E86 ID \u5230 DjuiBindingSystem\uFF0C\u8FD9\u91CC\u505A fallback\n    private static Control? FindControlById(Control root, string nodeId)\n    {\n        // \u4F18\u5148\u4ECE\u7ED1\u5B9A\u7CFB\u7EDF\u67E5\u627E\n        var ctrl = DjuiBindingSystem.GetRegisteredControl(nodeId);\n        if (ctrl != null) return ctrl;\n\n        // Fallback\uFF1A\u9012\u5F52\u904D\u5386\u5B50\u63A7\u4EF6\n        return SearchChildren(root, nodeId);\n    }\n\n    private static Control? SearchChildren(Control ctrl, string nodeId)\n    {\n        if (ctrl.Name == nodeId) return ctrl;\n\n        if (ctrl.Children != null)\n        {\n            foreach (var child in ctrl.Children)\n            {\n                var found = SearchChildren(child, nodeId);\n                if (found != null) return found;\n            }\n        }\n        return null;\n    }\n\n    private static string GetOpenTransition(DjuiPageJson page)\n    {\n        if (!string.IsNullOrWhiteSpace(page.Transition?.Open))\n            return page.Transition.Open!;\n\n        return IsPopupWindow(page) ? "pop_in" : "fade_in";\n    }\n\n    private static string GetCloseTransition(DjuiPageJson? page)\n    {\n        if (!string.IsNullOrWhiteSpace(page?.Transition?.Close))\n            return page.Transition.Close!;\n\n        return page != null && IsPopupWindow(page) ? "pop_out" : "fade_out";\n    }\n\n    private static bool IsPopupWindow(DjuiPageJson page)\n    {\n        return string.Equals(page.WindowMode, "popup", StringComparison.OrdinalIgnoreCase);\n    }\n\n    private static int AllocateWindowZIndex(DjuiPageJson page)\n    {\n        var baseZIndex = IsPopupWindow(page) ? PopupWindowBaseZIndex : NormalWindowBaseZIndex;\n        return baseZIndex + ++_nextWindowOrder;\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiWindowManagerV6.cs
var DjuiWindowManagerV6_default = '#if CLIENT\n\nusing System.Text.Json;\nusing System.Text.Json.Serialization;\nusing GameUI.Control;\nusing GameUI.Control.Extensions;\nusing GameUI.Device;\nusing GameUI.Enum;\n\nnamespace DjuiRuntime;\n\n/// <summary>DJUI v6 \u4E25\u683C\u9879\u76EE\u4E0E\u7A97\u53E3\u5B9E\u4F8B\u7BA1\u7406\u5668\u3002</summary>\npublic static class DjuiWindowManagerV6\n{\n    private const string RootDir = "user_files/djui";\n    private const string ProjectFile = RootDir + "/project.json";\n    private const string PagesDir = RootDir + "/pages";\n    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = false, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };\n    private static readonly Dictionary<string, DjuiPageV6> Pages = new();\n    private static readonly Dictionary<string, DjuiTreeInstanceV6> Instances = new();\n    private static readonly Dictionary<string, List<string>> PageInstances = new();\n    private static readonly Dictionary<string, string> SingletonInstances = new(StringComparer.Ordinal);\n    private static readonly Dictionary<string, int> ClosingTransitions = new(StringComparer.Ordinal);\n    private static DjuiProjectV6? _project;\n    private static ulong _nextInstanceId;\n\n    public static void Initialize()\n    {\n        CloseAll();\n        Pages.Clear();\n        PageInstances.Clear();\n        SingletonInstances.Clear();\n        ClosingTransitions.Clear();\n        _nextInstanceId = 0;\n        DjuiAudioSystem.Initialize();\n        if (!File.Exists(ProjectFile)) throw new FileNotFoundException("DJUI v6: \u7F3A\u5C11\u9879\u76EE\u914D\u7F6E", ProjectFile);\n        _project = DeserializeStrict<DjuiProjectV6>(ProjectFile);\n        RequireVersion(_project.ProtocolVersion, _project.SchemaVersion, ProjectFile);\n        if (_project.Canvas.ReferenceWidth <= 0 || _project.Canvas.ReferenceHeight <= 0) throw new InvalidDataException("DJUI v6: \u9879\u76EE\u53C2\u8003\u5C3A\u5BF8\u5FC5\u987B\u5927\u4E8E 0");\n        var mode = _project.Canvas.Mode switch\n        {\n            "Contain" => ScaleMode.Contain,\n            "MatchWidth" => ScaleMode.MatchWidth,\n            "MatchHeight" => ScaleMode.MatchHeight,\n            _ => throw new InvalidDataException($"DJUI v6: \u4E0D\u652F\u6301 Canvas \u6A21\u5F0F {_project.Canvas.Mode}"),\n        };\n        DeviceInfo.PrimaryViewport.SetDesignResolution(_project.Canvas.ReferenceWidth, _project.Canvas.ReferenceHeight, mode);\n        if (!Directory.Exists(PagesDir)) throw new DirectoryNotFoundException($"DJUI v6: \u9875\u9762\u76EE\u5F55\u4E0D\u5B58\u5728: {PagesDir}");\n        foreach (var file in Directory.GetFiles(PagesDir, "*.json"))\n        {\n            var page = DeserializeStrict<DjuiPageV6>(file);\n            RequireVersion(page.ProtocolVersion, page.SchemaVersion, file);\n            if (string.IsNullOrWhiteSpace(page.PageId)) throw new InvalidDataException($"DJUI v6: \u9875\u9762 ID \u4E3A\u7A7A: {file}");\n            if (!Pages.TryAdd(page.PageId, page)) throw new InvalidDataException($"DJUI v6: \u9875\u9762 ID \u91CD\u590D: {page.PageId}");\n        }\n        Game.Logger.LogInformation("DJUI v6: \u5DF2\u4E25\u683C\u52A0\u8F7D {Count} \u4E2A\u9875\u9762", Pages.Count);\n    }\n\n    /// <summary>\u517C\u5BB9\u4E1A\u52A1\u9875\u9762\u8BED\u4E49\uFF1A\u540C\u4E00 pageId \u53EA\u6253\u5F00\u4E00\u4E2A\u5355\u4F8B\u7A97\u53E3\u3002</summary>\n    public static Panel OpenWindow(string pageId)\n    {\n        if (SingletonInstances.TryGetValue(pageId, out var existing) && Instances.TryGetValue(existing, out var open))\n        {\n            CancelClosing(existing);\n            return open.Root;\n        }\n        var id = OpenInstance(pageId);\n        SingletonInstances[pageId] = id;\n        return Instances[id].Root;\n    }\n\n    /// <summary>\u663E\u5F0F\u521B\u5EFA\u540C\u4E00\u9875\u9762\u7684\u72EC\u7ACB\u7A97\u53E3\u5B9E\u4F8B\u3002</summary>\n    public static string OpenInstance(string pageId)\n    {\n        var project = _project ?? throw new InvalidOperationException("DJUI v6: \u8BF7\u5148 Initialize");\n        if (!Pages.TryGetValue(pageId, out var page)) throw new KeyNotFoundException($"DJUI v6: \u9875\u9762\u4E0D\u5B58\u5728: {pageId}");\n        if (!string.Equals(page.Kind, "window", StringComparison.Ordinal)) throw new InvalidOperationException($"DJUI v6: {pageId} \u4E0D\u662F Window \u9875\u9762");\n        var id = "w" + (++_nextInstanceId).ToString();\n        var host = new Panel { Name = $"DJUI.v6.{pageId}.{id}" };\n        host.FullScreen();\n        host.AddToVisualTree();\n        try\n        {\n            var expandedPage = DjuiTemplateExpanderV6.Expand(page, Pages);\n            var instance = DjuiTreeBuilderV6.Build(id, project, expandedPage, host);\n            Instances.Add(id, instance);\n            if (!PageInstances.TryGetValue(pageId, out var list)) PageInstances[pageId] = list = new List<string>();\n            list.Add(id);\n            DjuiTransitionPlayer.Play(instance.Root, page.Window?.Transition?.Open);\n            return id;\n        }\n        catch\n        {\n            host.RemoveFromVisualTreeAndParent();\n            host.Dispose();\n            throw;\n        }\n    }\n\n    public static T? GetControl<T>(string windowInstanceId, string nodeInstanceId) where T : Control\n    {\n        return Instances.TryGetValue(windowInstanceId, out var instance) ? instance.Session.GetControl<T>(nodeInstanceId) : null;\n    }\n\n    public static Control? GetControl(string pageId, string nodeInstanceId)\n        => GetSingletonControl<Control>(pageId, nodeInstanceId);\n\n    public static T? GetControlByPage<T>(string pageId, string nodeInstanceId) where T : Control\n        => GetSingletonControl<T>(pageId, nodeInstanceId);\n\n    public static T? GetSingletonControl<T>(string pageId, string nodeInstanceId) where T : Control\n    {\n        return SingletonInstances.TryGetValue(pageId, out var id) ? GetControl<T>(id, nodeInstanceId) : null;\n    }\n\n    public static bool IsOpen(string pageId)\n        => SingletonInstances.TryGetValue(pageId, out var id) && Instances.ContainsKey(id);\n\n    public static Panel? GetOpenWindow(string pageId)\n        => SingletonInstances.TryGetValue(pageId, out var id) && Instances.TryGetValue(id, out var instance) ? instance.Root : null;\n\n    public static string? GetSingletonInstanceId(string pageId)\n        => IsOpen(pageId) ? SingletonInstances[pageId] : null;\n\n    public static IReadOnlyList<string> GetInstances(string pageId)\n    {\n        return PageInstances.TryGetValue(pageId, out var ids) ? ids.AsReadOnly() : Array.Empty<string>();\n    }\n\n    private static ulong _nextCloneSeq;\n\n    /// <summary>\n    /// \u590D\u5236\u7A97\u53E3\u5185\u4E00\u4E2A\u8282\u70B9\u5B50\u6811\uFF0C\u8FD4\u56DE\u4E00\u4EFD\u65B0\u6784\u5EFA\u7684\u63A7\u4EF6\u5B9E\u4F8B\uFF08\u4E0D\u6302\u6811\u3001\u4E0D\u7ED1 action/\u97F3\u6548/\u6570\u636E\u7ED1\u5B9A\u2014\u2014\u5982\u540C new\uFF09\u3002\n    /// \u514B\u9686\u4F53\u6CBF\u7528\u6E90\u5B50\u6811\u5F53\u524D\u89E3\u7B97\u77E9\u5F62\uFF0C\u521D\u59CB\u4E0E\u6E90\u5B8C\u5168\u91CD\u53E0\uFF1B\u7236\u7EA7/\u4F4D\u7F6E/\u663E\u9690\u7531\u8C03\u7528\u65B9\u7BA1\u7406\u3002\n    /// \u514B\u9686\u4F53\u767B\u8BB0\u8FDB\u5E03\u5C40\u4F1A\u8BDD\u4F46 authored \u6811\u4E0D\u53D8\u2014\u2014relayout\uFF08\u8F6C\u5C4F/\u7F29\u653E\uFF09\u4E0D\u4F5C\u7528\u4E8E\u514B\u9686\u4F53\uFF0C\u9700\u8981\u8DDF\u968F\u91CD\u6392\u65F6\u9500\u6BC1\u91CD\u5EFA\u3002\n    /// \u5B50\u63A7\u4EF6\u5BFB\u5740\uFF1A\u63A7\u4EF6 Name \u53D6\u81EA\u9875\u9762 JSON \u7684 name \u5B57\u6BB5\uFF0C\u7528\u5F15\u64CE FindChild(name)/FindChildren(name)\u3002\n    /// </summary>\n    public static Control CloneControl(string windowInstanceId, string nodeInstanceId)\n    {\n        var project = _project ?? throw new InvalidOperationException("DJUI v6: \u8BF7\u5148 Initialize");\n        var instance = Instances.TryGetValue(windowInstanceId, out var tree)\n            ? tree\n            : throw new KeyNotFoundException($"DJUI v6: \u7A97\u53E3\u5B9E\u4F8B\u4E0D\u5B58\u5728: {windowInstanceId}");\n        var source = FindNode(instance.Session.CurrentPage.Root, nodeInstanceId)\n            ?? throw new KeyNotFoundException($"DJUI v6: \u8282\u70B9\u4E0D\u5B58\u5728: {nodeInstanceId}");\n        var solved = DjuiLayoutSolverV6.SolveV6(instance.Session.CurrentPage, instance.Session.CurrentPlan);\n        var suffix = "#c" + (++_nextCloneSeq).ToString();\n        return DjuiTreeBuilderV6.BuildClone(source, instance.Session, project.DefaultFont, instance.ImageVisuals, instance.ProgressVisuals, instance.ButtonStates, suffix, solved);\n    }\n\n    private static DjuiNodeV6? FindNode(DjuiNodeV6 root, string id)\n    {\n        if (string.Equals(root.Id, id, StringComparison.Ordinal)) return root;\n        foreach (var child in root.Children)\n        {\n            var hit = FindNode(child, id);\n            if (hit != null) return hit;\n        }\n        return null;\n    }\n\n    public static void CloseWindow(string pageOrInstanceId)\n    {\n        var windowInstanceId = SingletonInstances.TryGetValue(pageOrInstanceId, out var singletonId) ? singletonId : pageOrInstanceId;\n        if (!Instances.TryGetValue(windowInstanceId, out var instance) || ClosingTransitions.ContainsKey(windowInstanceId)) return;\n        var closePreset = instance.Session.CurrentPage.Window?.Transition?.Close;\n        var transitionId = DjuiTransitionPlayer.Play(instance.Root, closePreset, () => FinalizeClose(windowInstanceId));\n        if (transitionId < 0) FinalizeClose(windowInstanceId);\n        else ClosingTransitions[windowInstanceId] = transitionId;\n    }\n\n    private static void CancelClosing(string windowInstanceId)\n    {\n        if (!ClosingTransitions.Remove(windowInstanceId, out var transitionId)) return;\n        DjuiTransitionPlayer.Stop(transitionId);\n        if (Instances.TryGetValue(windowInstanceId, out var instance)) instance.Session.Relayout();\n    }\n\n    private static void FinalizeClose(string windowInstanceId)\n    {\n        ClosingTransitions.Remove(windowInstanceId);\n        if (!Instances.Remove(windowInstanceId, out var instance)) return;\n        foreach (var singleton in SingletonInstances.Where(pair => pair.Value == windowInstanceId).ToArray()) SingletonInstances.Remove(singleton.Key);\n        foreach (var pair in PageInstances.ToArray())\n        {\n            if (!pair.Value.Remove(windowInstanceId)) continue;\n            if (pair.Value.Count == 0) PageInstances.Remove(pair.Key);\n            break;\n        }\n        DjuiTransitionPlayer.Stop(instance.Root);\n        instance.Dispose();\n    }\n\n    public static void CloseAll()\n    {\n        foreach (var id in Instances.Keys.ToArray())\n        {\n            CancelClosing(id);\n            FinalizeClose(id);\n        }\n    }\n\n    private static T DeserializeStrict<T>(string file) where T : class\n    {\n        var json = File.ReadAllText(file);\n        return JsonSerializer.Deserialize<T>(json, JsonOptions) ?? throw new InvalidDataException($"DJUI v6: JSON \u4E3A\u7A7A: {file}");\n    }\n\n    private static void RequireVersion(int protocolVersion, int schemaVersion, string file)\n    {\n        if (protocolVersion != DjuiProtocolV6.ProtocolVersion || schemaVersion != DjuiProtocolV6.SchemaVersion)\n            throw new InvalidDataException($"DJUI v6: \u7248\u672C\u4E0D\u5339\u914D {file}; \u9700\u8981 protocolVersion=6, schemaVersion=1");\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\AGENTS.md
var AGENTS_default = '# DJUI Runtime \u90E8\u7F72\u5951\u7EA6\n\n> \u672C\u6587\u4EF6\u7531 DJUI \u7F16\u8F91\u5668\u968F Runtime \u5206\u53D1\uFF08`djui_version.txt` \u8BB0\u5F55\u7248\u672C\uFF09\u3002\n> \u63CF\u8FF0 Runtime \u4E0E\u661F\u706B\u5DE5\u7A0B\u4E4B\u95F4\u7684**\u90E8\u7F72\u5951\u7EA6\u4E0E\u4F7F\u7528\u8303\u5F0F**\u3002\u6539 Runtime \u884C\u4E3A\u8BF7\u56DE DJUI \u4ED3\u5E93 `runtime/` \u6E90\u6587\u4EF6\uFF0C\u52FF\u5728\u6B64\u624B\u6539 .cs\u3002\n\n## \u8DEF\u5F84\u5951\u7EA6\uFF08\u8C01\u5199\u54EA\u3001\u8C01\u8BFB\u54EA\uFF09\n\n| \u8D44\u6E90 | \u552F\u4E00\u5199\u5165\u65B9\uFF08DJUI\u300C\u53D1\u5E03\u300D\uFF09 | Runtime \u8BFB\u53D6\u8DEF\u5F84 | \u8BF4\u660E |\n|---|---|---|---|\n| \u9879\u76EE\u914D\u7F6E | `ui/AppBundle/user_files/djui/project.json` | `user_files/djui/project.json` | v6 Canvas\u3001\u5BBD\u5C4F\u9608\u503C\u548C\u9ED8\u8BA4\u5B57\u4F53\u7684\u552F\u4E00\u8FD0\u884C\u914D\u7F6E |\n| \u9875\u9762 JSON | `ui/AppBundle/user_files/djui/pages/` | \u76F8\u5BF9\u8DEF\u5F84 `user_files/djui/pages`\uFF08\u5BA2\u6237\u7AEF\u8FDB\u7A0B CWD=`ui/`\uFF09 | **\u670D\u52A1\u7AEF\u4E0D\u6D88\u8D39\u9875\u9762 JSON**\uFF08Runtime \u5168\u90E8 `#if CLIENT`\uFF09\uFF0C\u6839 AppBundle \u65E0\u9700\u53D1\u5E03 djui \u8D44\u6E90\u3002\u7F16\u8F91\u6E90\u5728 UI \u5DE5\u4F5C\u533A `.djui/layout/pages/`\uFF0C\u661F\u706B\u5DE5\u7A0B\u7684 `ui/djui` \u662F\u53D1\u5E03\u955C\u50CF\uFF0C\u8FD0\u884C\u4E0D\u8BFB |\n| \u97F3\u6548\u914D\u7F6E | `ui/AppBundle/user_files/djui/sounds.json` | `user_files/djui/sounds.json` | \u540C\u4E0A\uFF0C\u4EC5\u5BA2\u6237\u7AEF |\n| \u56FE\u7247\u7D20\u6750 | `ui/image/djui/` | \u5F15\u64CE\u76F4\u8BFB\uFF08`image/djui/...` \u76F8\u5BF9 `ui/` \u6839\uFF09\uFF0C\u4E0D\u8FDB AppBundle | \u63A7\u4EF6 `appearance.image` \u5199 `image/djui/...` |\n\n**\u5173\u952E\u70B9**\uFF1A\u9875\u9762/\u97F3\u6548\u7684\u552F\u4E00\u8FD0\u884C\u6D88\u8D39\u65B9\u662F\u5BA2\u6237\u7AEF\u8FDB\u7A0B\uFF08CWD=`ui/`\uFF09\uFF0C\u53D1\u5E03\u53EA\u5199 `ui/AppBundle`\u3002\u4EFB\u4F55\u624B\u5DE5\u62F7\u8D1D\u9875\u9762 JSON \u7684\u884C\u4E3A\u90FD\u88AB\u7981\u6B62\u2014\u2014\u62F7\u9519\u4F4D\u7F6E\uFF08\u5982\u62F7\u5230\u6839 AppBundle\uFF09\u6216\u7248\u672C\u9519\u4F4D\u6B63\u662F\u300C\u9875\u9762\u6CA1\u5F00 / \u56FE\u4E0D\u5BF9\u300D\u7C7B\u6545\u969C\u7684\u6839\u6E90\u3002\n\n## \u4F7F\u7528\u8303\u5F0F\uFF08\u5BA2\u6237\u7AEF\u4EE3\u7801\uFF09\n\n```csharp\nusing DjuiRuntime;\n\n// 1. \u521D\u59CB\u5316\uFF1A\u4E25\u683C\u52A0\u8F7D protocolVersion=6/schemaVersion=1 \u9879\u76EE\u4E0E\u9875\u9762\nDjuiWindowManagerV6.Initialize();\n\n// 2. \u9875\u9762\u5355\u4F8B\uFF1A\u91CD\u590D\u6253\u5F00\u540C\u4E00 pageId \u4E0D\u4F1A\u521B\u5EFA\u91CD\u590D\u7A97\u53E3\nPanel root = DjuiWindowManagerV6.OpenWindow("main_menu");\n\n// 3. \u9875\u9762\u4F5C\u7528\u57DF\u67E5\u8BE2\uFF1B\u4E0D\u8981\u4F7F\u7528\u5168\u5C40\u88F8\u8282\u70B9 ID\nvar btn = DjuiWindowManagerV6.GetSingletonControl<Button>("main_menu", "button_start");\n\n// 4. \u53EA\u6709\u786E\u5B9E\u9700\u8981\u540C\u9875\u591A\u5B9E\u4F8B\u65F6\u624D\u4F7F\u7528\u5B9E\u4F8B API\nstring instanceId = DjuiWindowManagerV6.OpenInstance("toast");\nvar label = DjuiWindowManagerV6.GetControl<Label>(instanceId, "toast_text");\n\n// 5. \u4E8B\u4EF6\u8DEF\u7531\uFF08\u9875\u9762 JSON \u4E2D djui.action \u58F0\u660E\u7684\u52A8\u4F5C\u540D\uFF09\nDjuiActionRouter.On("open_inventory", () => { ... });\n\n// 6. \u6570\u636E\u7ED1\u5B9A\uFF08Set \u540E\u7ED1\u5B9A\u8BE5 key \u7684\u63A7\u4EF6\u81EA\u52A8\u5237\u65B0\uFF09\nDjuiBindingSystem.Set("coin_count", 999);\n\n// 7. \u8FD0\u884C\u65F6\u52A8\u6001\u7981\u7528\uFF08\u8D70\u6B64\u65B9\u6CD5\u6216 disabled \u7ED1\u5B9A\u624D\u4F1A\u5237\u65B0 DJUI \u7981\u7528\u89C6\u89C9\uFF1B\n//    \u76F4\u63A5\u7ED9\u5F15\u64CE\u63A7\u4EF6\u8D4B Disabled \u53EA\u62E6\u622A\u70B9\u51FB\u3001\u4E0D\u53D8\u7070\u2014\u2014\u5F15\u64CE\u65E0 Disabled \u53D8\u66F4\u901A\u77E5\uFF09\nDjuiButtonState.SetDisabled(btn, false);\n```\n\n## \u6309\u94AE\u72B6\u6001\u89C6\u89C9\uFF08normal / hover / pressed / disabled\uFF09\n\n\u6309\u94AE\u56DB\u6001\u6362\u56FE\u4E0E\u7981\u7528\u7070\u5316\u7531 DJUI Runtime \u81EA\u7BA1\uFF08\u661F\u706B\u5F15\u64CE Button \u65E0 ImageDisabled\uFF0C\u4E14 v6 \u56FE\u7247\u753B\u5728\u5B50 Panel \u4E0A\u3001\u5F15\u64CE\u72B6\u6001\u6362\u56FE\u4E0D\u53EF\u7528\uFF09\uFF1A\n\n- `button.imageHover` / `button.imagePressed` / `button.imageDisabled`\uFF1A\u4E09\u4E2A\u53EF\u9009\u72B6\u6001\u56FE\uFF0C\u672A\u8BBE\u7F6E\u7684\u6001\u6CBF\u7528\u6B63\u5E38\u56FE\n- \u7981\u7528\u65F6\u672A\u914D\u7F6E `imageDisabled` \u2192 \u81EA\u52A8\u515C\u5E95\uFF1A\u56FE\u7247\u7070\u5EA6 + \u6574\u4F53\u900F\u660E\u5EA6\u964D\u4E3A 50%\uFF08\u5E38\u91CF `DjuiButtonStateV6.DisabledFallbackOpacity`\uFF0C\u5B9E\u6D4B\u540E\u53EF\u8C03\uFF09\n- \u52A8\u6001\u5207\u6362\u7981\u7528\uFF1A\u6570\u636E\u7ED1\u5B9A\u5C5E\u6027 `disabled`\uFF08`DjuiBindingSystem.Set("key", bool)`\uFF09\u6216 `DjuiButtonState.SetDisabled(control, bool)`\n\n## \u54CD\u5E94\u5F0F\u5BBD\u5C4F\u5C42\uFF08\u57FA\u7840\u5C42 / \u5BBD\u5C4F\u5C42\uFF09\n\n\u9875\u9762\u5206\u4E24\u5C42\uFF1A**\u57FA\u7840\u5C42**\uFF08\u9875\u9762 JSON \u91CC\u7684\u8282\u70B9\u4E0E\u5C5E\u6027\u672C\u4F53\uFF09\u4E0E**\u5BBD\u5C4F\u5C42**\uFF08`responsive.wide.overrides` \u5DEE\u5F02\u8865\u4E01\u8868\uFF09\u3002\u8FD0\u884C\u65F6\u6309**\u65B9\u5411\u611F\u77E5**\u89C4\u5219\u81EA\u52A8\u9009\u5C42\uFF1A\n\n- \u5224\u5B9A\uFF1A**\u7269\u7406\u5BBD / \u9AD8 \u2265 wideRatio**\uFF08`project.json` \u7684 `responsive.wideRatio`\uFF0C\u9ED8\u8BA4 1.25\uFF09\u624D\u8FDB\u5BBD\u5C4F\u5C42\uFF1B\u7AD6\u5C4F\u624B\u673A\uFF08\u5BBD < \u9AD8\uFF09\u6C38\u8FDC\u7528\u57FA\u7840\u5C42\n- \u9ED8\u8BA4 1.25 \u7684\u542B\u4E49\uFF1A\u6298\u53E0\u5C4F\u5C55\u5F00\u6A2A\u7528\uFF08\u6BD4\u503C 1.10~1.20\uFF09\u5F52\u57FA\u7840\u5C42\uFF1BiPad / \u5B89\u5353\u5E73\u677F\u6A2A\u7F6E\uFF081.33+\uFF09\u3001\u684C\u9762\u8FDB\u5BBD\u5C4F\u5C42\u3002\u9700\u8981\u6298\u53E0\u5C4F\u4E5F\u8D70\u5BBD\u5C4F\u5C42\u65F6\u628A\u9608\u503C\u964D\u5230\u7EA6 1.05\n- \u5BBD\u5C4F\u5C42\u751F\u6548\u65F6\uFF1A\u5148\u53D6\u57FA\u7840\u5C42\uFF0C\u518D\u628A\u8865\u4E01\u8868\u91CC\u7684\u5C5E\u6027\u76D6\u4E0A\u53BB\uFF1B**\u6CA1\u5199\u5728\u8865\u4E01\u8868\u91CC\u7684\u5C5E\u6027\u6CBF\u7528\u57FA\u7840\u5C42**\n\n### \u5BBD\u5C4F\u5C42\u5141\u8BB8\u8986\u76D6\u7684\u5B57\u6BB5\uFF08\u5C01\u95ED\u5217\u8868\uFF0C\u8D85\u5217\u5373\u6821\u9A8C\u5931\u8D25\uFF09\n\n| \u7C7B\u522B | \u5B57\u6BB5 |\n|---|---|\n| \u57FA\u7840 | `basic.visible`\u3001`basic.disabled` |\n| \u53D8\u6362 | `transform.x` / `y` / `width` / `height` |\n| \u5916\u89C2 | `appearance.image`\u3001`background`\u3001`imageFit`\u3001`focalX`\u3001`focalY`\u3001`borderThickness`\u3001`borderColor` |\n| \u6587\u672C | `text.text`\u3001`fontSize`\u3001`textColor`\u3001`strokeSize`\u3001`strokeColor`\u3001`bold`\u3001`font`\u3001`textWrap` |\n| \u6309\u94AE/\u8FDB\u5EA6 | `button.imageHover`\u3001`button.imagePressed`\u3001`button.imageDisabled`\u3001`progress.value` |\n\n### \u5168\u5C4F\u80CC\u666F\u6362\u56FE\u8303\u5F0F\uFF08\u53CC\u8282\u70B9\u6CD5\uFF09\n\n\u5BBD\u5C4F\u5C42**\u4E0D\u80FD\u8986\u76D6 `appearance.sourceSize`**\uFF08\u4E0D\u5728\u5141\u8BB8\u5217\u8868\uFF09\u3002\u7AD6\u7248 / \u5BBD\u7248\u4E24\u5957\u5168\u5C4F\u56FE\u7528\u4E24\u4E2A\u8282\u70B9 + `basic.visible` \u5207\u6362\uFF1A\n\n```json\n{ "id": "fullscreen_art_portrait", "basic": { "visible": true },\n  "appearance": { "image": "image/djui/backgrounds/bg_xxx_portrait.png",\n    "imageFit": "cover", "sourceSize": { "width": 1080, "height": 2400 } } },\n{ "id": "fullscreen_art_wide", "basic": { "visible": false },\n  "appearance": { "image": "image/djui/backgrounds/bg_xxx_wide.png",\n    "imageFit": "cover", "sourceSize": { "width": 1920, "height": 1200 } } }\n```\n\n\u5BBD\u5C4F\u5C42\u8865\u4E01\uFF1A\n\n```json\n"responsive": { "wide": { "overrides": {\n  "fullscreen_art_portrait": { "basic.visible": false },\n  "fullscreen_art_wide": { "basic.visible": true } } } }\n```\n\n\u6BCF\u4E2A\u8282\u70B9\u5404\u81EA\u643A\u5E26\u6B63\u786E\u7684 `sourceSize`\uFF08cover/contain \u7684\u88C1\u5207\u4F9D\u636E\uFF09\uFF0C\u8FD0\u884C\u65F6\u6309\u5C42\u5207\u6362\u53EF\u89C1\u6027\u5373\u53EF\u3002\n\n### \u573A\u666F\u753B\u677F\uFF08\u80CC\u666F\u4E0E\u7D20\u6750\u5750\u6807\u540C\u7F29\u653E\uFF09\n\n\u9700\u8981\u300C\u9489\u5728\u80CC\u666F\u56FE\u4E0A\u300D\u7684\u5185\u5BB9\uFF08\u573A\u666F\u5EFA\u7B51\u3001\u5730\u56FE\u6807\u8BB0\u7B49\uFF09\u4F7F\u7528 sceneFrame\uFF0C\u800C\u4E0D\u662F\u53EA\u4F9D\u8D56 target: image\uFF1A\n\n- \u80CC\u666F\u548C\u573A\u666F\u753B\u677F\u5FC5\u987B\u90FD\u662F\u9875\u9762\u6839\u4E0B\u8282\u70B9\uFF1B\u753B\u677F\u4EE5 sceneFrame.backgroundId \u663E\u5F0F\u6307\u5411\u80CC\u666F\uFF0C\u907F\u514D\u4F9D\u8D56\u8282\u70B9\u987A\u5E8F\u3002\n- \u753B\u677F\u672C\u8EAB\u5FC5\u987B anchor.target: image + stretch.style: Both\uFF1B\u5B83\u5148\u94FA\u6EE1\u80CC\u666F\u7684\u5B8C\u6574 contain/cover \u56FE\u5E27\u3002\n- sceneFrame.artboard \u662F\u7D20\u6750\u539F\u59CB\u753B\u5E45\u3002\u753B\u677F\u5185\u7684\u5B50\u6811\u4F7F\u7528\u8FD9\u5957\u5C40\u90E8\u5750\u6807\uFF0C\u8FD0\u884C\u65F6\u4E0E\u7F16\u8F91\u5668\u4E00\u8D77\u6309\u56FE\u5E27\u6A2A\u3001\u7EB5\u6BD4\u4F8B\u6620\u5C04\uFF0C**\u4F4D\u7F6E\u548C\u5C3A\u5BF8\u90FD\u4F1A\u968F\u80CC\u666F\u7F29\u653E**\u3002\n- \u753B\u677F\u5185\u5B50\u8282\u70B9\u53EA\u80FD\u7528 anchor.target: parent\uFF1B\u5C4F\u5E55 UI\uFF08\u8FD4\u56DE\u3001\u8D27\u5E01\u3001\u8BBE\u7F6E\u7B49\uFF09\u5FC5\u987B\u7559\u5728\u753B\u677F\u5916\uFF0C\u4F7F\u7528 safe / screen \u951A\u70B9\u3002\n\n~~~json\n{\n  "id": "building_group",\n  "anchor": { "target": "image", "side": "TopLeft" },\n  "stretch": { "style": "Both", "margins": { "left": 0, "top": 0, "right": 0, "bottom": 0 } },\n  "sceneFrame": {\n    "backgroundId": "scene_background",\n    "artboard": { "width": 1080, "height": 2400 }\n  }\n}\n~~~\n\n\u65E7\u7684 target: image \u4ECD\u53EF\u7528\u4E8E\u201C\u53EA\u8DDF\u968F\u56FE\u5E27\u4F4D\u7F6E/\u8FB9\u754C\u201D\u7684\u666E\u901A\u5BB9\u5668\uFF0C\u4F46\u5B83**\u4E0D\u4F1A**\u628A\u7EDD\u5BF9\u5B9A\u4F4D\u7684\u5B50\u5143\u7D20\u7F29\u653E\uFF1B\u7D20\u6750\u5750\u6807\u573A\u666F\u5FC5\u987B\u5347\u7EA7\u4E3A sceneFrame\u3002\n\n## \u5B57\u4F53\n\n- \u9875\u9762\u63A7\u4EF6\u4E0D\u5199 `text.font` \u65F6\uFF0C\u7528 `project.json` \u7684 `defaultFont`\uFF1B`defaultFont` \u4E3A `null` \u65F6\u7528**\u5F15\u64CE\u9ED8\u8BA4\u5B57\u4F53**\n- \u81EA\u5B9A\u4E49\u5B57\u4F53 = **\u6807\u51C6\u5B57\u4F53\u6587\u4EF6**\uFF08.ttf / .otf / .ttc\uFF09\u653E `ui/font/<family>/`\uFF0C\u5E76\u5728 `ref/fontref.txt` \u52A0\u4E00\u884C family \u8DEF\u5F84\u3002\u5F15\u64CE\u4E0E DJUI \u753B\u5E03\u52A0\u8F7D\u540C\u4E00\u6587\u4EF6\uFF0C\u4E24\u7AEF\u4E00\u81F4\n- \u661F\u706B\u81EA\u5E26\u7684 `.otf` \u662F\u5F15\u64CE\u79C1\u6709\u5C01\u88C5\uFF0C\u4EC5\u5F15\u64CE\u53EF\u89E3\u7801\uFF1B\u753B\u5E03\u53EA\u80FD\u8FD1\u4F3C\u9884\u89C8\u3002\u7CFB\u7EDF\u5B57\u4F53\uFF08\u5982 `ui/font/msyh`\uFF09\u4E24\u7AEF\u90FD\u8C03\u64CD\u4F5C\u7CFB\u7EDF\u5B57\u4F53\uFF0C\u4E5F\u4E00\u81F4\n- \u63A8\u8350\u7528 DJUI \u7F16\u8F91\u5668\u7684\u300C\u5B57\u4F53\u7BA1\u7406\u300D\u5BFC\u5165\uFF0C\u81EA\u52A8\u5B8C\u6210\u62F7\u8D1D\u4E0E\u6CE8\u518C\uFF0C\u4E0D\u8981\u624B\u5DE5\u642C\u8FD0\u5B57\u4F53\u6587\u4EF6\n\n## \u6545\u969C\u5B9A\u4F4D\u8868\n\n| \u75C7\u72B6 | \u6839\u56E0 | \u4FEE\u590D |\n|---|---|---|\n| \u65E5\u5FD7\u300C\u9875\u9762\u76EE\u5F55\u4E0D\u5B58\u5728\u6216\u4E3A\u7A7A\u300D | `ui/AppBundle` \u65AD\u4F9B\uFF08\u53D1\u5E03\u540E\u624B\u5DE5\u5220\u4E86/\u672A\u53D1\u5E03\uFF09 | \u5728 DJUI \u7F16\u8F91\u5668\u91CD\u65B0\u70B9\u300C\u53D1\u5E03\u300D\uFF08\u5199\u5165 `ui/AppBundle/user_files/djui/pages`\uFF09 |\n| `OpenWindow` \u62A5\u300C\u9875\u9762 xxx \u4E0D\u5B58\u5728\u300D\u5E76\u5217\u51FA\u5DF2\u6CE8\u518C\u9875\u9762 | \u8BE5 pageId \u6CA1\u53D1\u5E03\uFF0C\u6216 pageId \u62FC\u5199\u4E0E JSON \u4E0D\u4E00\u81F4 | \u5BF9\u7167\u65E5\u5FD7\u5217\u51FA\u7684\u5DF2\u6CE8\u518C\u6E05\u5355\u68C0\u67E5\uFF1B\u91CD\u65B0\u53D1\u5E03 |\n| \u9875\u9762\u5F00\u4E86\u4F46\u56FE\u7247\u4E0D\u663E\u793A | \u56FE\u7247\u5F15\u7528\u8DEF\u5F84\u4E0D\u542B `image/djui/` \u524D\u7F00\uFF0C\u6216\u7D20\u6750\u672A\u53D1\u5E03\u5230 `ui/image/djui/` | \u68C0\u67E5\u63A7\u4EF6 `appearance.image` \u4E0E\u7D20\u6750\u53D1\u5E03\u72B6\u6001 |\n| \u9875\u9762\u62F7\u5230\u4E86\u6839 AppBundle \u4ECD\u4E0D\u751F\u6548 | \u6839 AppBundle \u4E0D\u662F\u6D88\u8D39\u65B9\uFF08\u670D\u52A1\u7AEF\u4E0D\u8BFB\u9875\u9762 JSON\uFF09 | \u53EA\u53D1\u5E03\u5230 `ui/AppBundle`\uFF1B\u7528\u7F16\u8F91\u5668\u53D1\u5E03\u800C\u975E\u624B\u5DE5\u62F7\u8D1D |\n| \u7AD6\u5C4F\u624B\u673A\u663E\u793A\u4E86\u5BBD\u5C4F\u5C42\u5185\u5BB9\uFF08\u5BBD\u56FE/\u5BBD\u5C4F\u6587\u6848\uFF09 | \u65E7\u7248 Runtime \u7528\u300C\u957F\u77ED\u8FB9\u6BD4\u503C\u300D\u5224\u5B9A\uFF0C\u7AD6\u5C4F 9:16 \u6BD4\u503C 1.78 \u4E5F\u88AB\u5224\u5BBD\u5C4F | \u5347\u7EA7 Runtime \u2265 0.7.9\uFF08\u65B9\u5411\u611F\u77E5\u5224\u5B9A\uFF1A\u7269\u7406\u5BBD/\u9AD8 \u2265 wideRatio\uFF09 |\n| \u6587\u5B57\u5B57\u4F53\u4E0E\u7F16\u8F91\u5668\u753B\u5E03\u4E0D\u4E00\u81F4 | \u7528\u4E86\u5F15\u64CE\u5C01\u88C5\u683C\u5F0F\u5B57\u4F53\uFF0C\u753B\u5E03\u65E0\u6CD5\u89E3\u7801\u53EA\u80FD\u8FD1\u4F3C | \u6539\u7528\u6807\u51C6\u5B57\u4F53\u6587\u4EF6\u6216\u7CFB\u7EDF\u5B57\u4F53\uFF1B\u5728 DJUI\u300C\u5B57\u4F53\u7BA1\u7406\u300D\u91CD\u65B0\u5BFC\u5165 |\n| cover \u80CC\u666F\u88C1\u5207\u65B9\u5411\u4E0D\u5BF9 | \u63A7\u4EF6 `appearance.sourceSize` \u4E0E\u7D20\u6750\u771F\u5B9E\u5C3A\u5BF8\u4E0D\u7B26 | \u5728\u7F16\u8F91\u5668\u53F3\u4FA7\u5C5E\u6027\u91CC\u4FEE\u6B63\u7D20\u6750\u539F\u59CB\u5C3A\u5BF8\uFF0C\u91CD\u65B0\u53D1\u5E03 |\n\n## \u7981\u6B62\n\n- \u7981\u6B62\u624B\u5DE5\u62F7\u8D1D\u9875\u9762 JSON \u5230\u4EFB\u4F55 AppBundle\uFF08\u7248\u672C\u9519\u4F4D\u6E90\u5934\uFF09\n- \u7981\u6B62\u76F4\u63A5\u4FEE\u6539\u672C\u76EE\u5F55 .cs \u6587\u4EF6\uFF08\u7F16\u8F91\u5668\u5347\u7EA7\u4F1A\u6574\u76EE\u5F55\u8986\u76D6\uFF1B\u6539\u52A8\u8BF7\u53BB DJUI \u4ED3\u5E93 `runtime/`\uFF09\n';

// src/lib/runtimeBundle.ts
var RUNTIME_VERSION = "0.7.20";
var RUNTIME_FILES = [
  { name: "DjuiActionRouter.cs", content: DjuiActionRouter_default },
  { name: "DjuiAudioSystem.cs", content: DjuiAudioSystem_default },
  { name: "DjuiBindingSystem.cs", content: DjuiBindingSystem_default },
  { name: "DjuiEffectPlayer.cs", content: DjuiEffectPlayer_default },
  { name: "DjuiEffectPresets.cs", content: DjuiEffectPresets_default },
  { name: "DjuiLayoutSolver.cs", content: DjuiLayoutSolver_default },
  { name: "DjuiCanvasV6.cs", content: DjuiCanvasV6_default },
  { name: "DjuiLayoutSessionV6.cs", content: DjuiLayoutSessionV6_default },
  { name: "DjuiImageVisualLayerV6.cs", content: DjuiImageVisualLayerV6_default },
  { name: "DjuiProgressVisualLayerV6.cs", content: DjuiProgressVisualLayerV6_default },
  { name: "DjuiButtonStateV6.cs", content: DjuiButtonStateV6_default },
  { name: "DjuiTreeBuilderV6.cs", content: DjuiTreeBuilderV6_default },
  { name: "DjuiModels.cs", content: DjuiModels_default },
  { name: "DjuiProtocolV6.cs", content: DjuiProtocolV6_default },
  { name: "DjuiResponsiveResolverV6.cs", content: DjuiResponsiveResolverV6_default },
  { name: "DjuiTemplateExpanderV6.cs", content: DjuiTemplateExpanderV6_default },
  { name: "DjuiTransitionPlayer.cs", content: DjuiTransitionPlayer_default },
  { name: "DjuiTransitionRegistry.cs", content: DjuiTransitionRegistry_default },
  { name: "DjuiUiLoader.cs", content: DjuiUiLoader_default },
  { name: "DjuiViewportAdapter.cs", content: DjuiViewportAdapter_default },
  { name: "DjuiWindowManager.cs", content: DjuiWindowManager_default },
  { name: "DjuiWindowManagerV6.cs", content: DjuiWindowManagerV6_default },
  { name: "AGENTS.md", content: AGENTS_default }
];

// src/lib/publishCore.ts
function compareVersions(a, b) {
  const parse = (v) => v.trim().split(".").map((part) => parseInt(part, 10));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}
var PUBLISH_CONFIG_FILE = ".djui/publish.json";
var UI_LAYOUT_DIR = ".djui/layout";
var PROJECT_FILE = UI_LAYOUT_DIR + "/project.json";
var PAGES_DIR = UI_LAYOUT_DIR + "/pages";
var SOUNDS_FILE = UI_LAYOUT_DIR + "/sounds.json";
var SLICE_META_FILE = ".djui/slice-meta.json";
var STAR_LAYOUT_DIR = "ui/djui";
var STAR_PROJECT_FILE = STAR_LAYOUT_DIR + "/project.json";
var STAR_PAGES_DIR = STAR_LAYOUT_DIR + "/pages";
var STAR_SOUNDS_FILE = STAR_LAYOUT_DIR + "/sounds.json";
var CLIENT_DJUI_DIR = "ui/AppBundle/user_files/djui";
var CLIENT_PAGES_DIR = CLIENT_DJUI_DIR + "/pages";
var IMAGE_TARGET_DIR = "ui/image/djui";
var MANIFEST_PATH = "ui/.djui-publish-manifest.json";
function joinPath(...parts) {
  return parts.filter(Boolean).join("/").replace(/\\/g, "/");
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function jsonEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
async function walkFiles(store, path) {
  if (!await store.dirExists(path)) return [];
  const result = [];
  for (const entry of await store.listEntries(path)) {
    const child = joinPath(path, entry.name);
    if (entry.kind === "directory") result.push(...await walkFiles(store, child));
    else result.push(child);
  }
  return result.sort((a, b) => a.localeCompare(b, "zh-CN"));
}
async function mirrorDirectory(source, sourcePath, target, targetPath, transform, shouldSkip) {
  const stats = { copied: 0, skipped: 0, removed: 0, total: 0 };
  await target.ensureDir(targetPath);
  const sourceEntries = await source.listEntries(sourcePath);
  const remaining = new Map((await target.listEntries(targetPath)).map((entry) => [entry.name, entry]));
  for (const entry of sourceEntries) {
    remaining.delete(entry.name);
    const from = joinPath(sourcePath, entry.name);
    const to = joinPath(targetPath, entry.name);
    if (entry.kind === "directory") {
      const nested = await mirrorDirectory(source, from, target, to, transform, shouldSkip);
      stats.copied += nested.copied;
      stats.skipped += nested.skipped;
      stats.removed += nested.removed;
      stats.total += nested.total;
      continue;
    }
    stats.total++;
    const relative2 = from.slice(sourcePath.length).replace(/^\//, "");
    const info = await source.fileInfo(from);
    if (info && shouldSkip && await shouldSkip(relative2, info) && await target.fileExists(to)) {
      stats.skipped++;
      continue;
    }
    const content = await source.readBytes(from);
    if (content === null) throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u53D1\u5E03\u6E90\u6587\u4EF6\uFF1A${from}`);
    await target.writeBytes(to, transform ? await transform(from, relative2, content) : content);
    stats.copied++;
  }
  for (const entry of remaining.values()) {
    await target.remove(joinPath(targetPath, entry.name), entry.kind === "directory");
    stats.removed++;
  }
  return stats;
}
async function collectFingerprints(store, dir) {
  const result = {};
  for (const file of await walkFiles(store, dir)) {
    const info = await store.fileInfo(file);
    if (!info) continue;
    result[file.slice(dir.length).replace(/^\//, "")] = [info.size, info.mtime];
  }
  return result;
}
async function applyProjectPatchesCore(store) {
  const result = {
    ok: true,
    changed: false,
    warnings: [],
    blockers: [],
    patches: [],
    soundSetup: { status: "missing-config", soundCount: 0, defaultButtonSoundId: null, missingButtonSounds: 0 }
  };
  const rawSound = await store.readJson(SOUNDS_FILE);
  const hasSoundConfig = rawSound !== null;
  const soundConfig = rawSound === null ? getDefaultSoundConfig() : sanitizeSoundConfig(rawSound);
  if (rawSound !== null && !jsonEquals(rawSound, soundConfig)) {
    await store.writeJson(SOUNDS_FILE, soundConfig);
    result.changed = true;
    result.patches.push({ id: "sound-config-v2", changedFiles: [SOUNDS_FILE], message: "\u58F0\u97F3\u914D\u7F6E\u5DF2\u5347\u7EA7\u5230 v2" });
  }
  const pages = (await walkFiles(store, PAGES_DIR)).filter((file) => file.toLowerCase().endsWith(".json"));
  const migratedAnchorFiles = [];
  const patchedButtonFiles = [];
  let missingButtonSounds = 0;
  for (const file of pages) {
    const displayName = file.slice(PAGES_DIR.length + 1);
    const page = await store.readJson(file);
    if (page === null) {
      result.blockers.push(`\u9875\u9762 JSON \u8BFB\u53D6\u5931\u8D25\uFF1A${displayName}`);
      continue;
    }
    const protocolVersion = isRecord2(page) && typeof page.protocolVersion === "number" ? page.protocolVersion : null;
    if (protocolVersion !== DJUI_PROTOCOL_VERSION) {
      result.blockers.push(
        `\u9875\u9762 ${displayName} \u4E0D\u662F v6 \u534F\u8BAE\uFF08protocolVersion=${protocolVersion ?? "\u7F3A\u5931"}\uFF09\uFF0C\u53D1\u5E03\u5668\u62D2\u7EDD\u81EA\u52A8\u8FC1\u79FB\uFF1B\u8BF7\u5728 DJUI \u7F16\u8F91\u5668\u6253\u5F00\u5E76\u4FDD\u5B58\u8BE5\u9875\u9762\u5B8C\u6210 v6 \u8FC1\u79FB\u540E\u518D\u53D1\u5E03`
      );
      continue;
    }
    const patch = patchPageNodeTree(page, soundConfig.defaultButtonSoundId);
    missingButtonSounds += patch.missingButtonSounds;
    if (patch.changed) {
      await store.writeJson(file, page);
      result.changed = true;
      if (patch.migratedAnchors > 0) migratedAnchorFiles.push(file);
      if (patch.patchedButtonSounds > 0) patchedButtonFiles.push(file);
    }
  }
  if (migratedAnchorFiles.length) result.patches.push({ id: "page-anchor-v4", changedFiles: migratedAnchorFiles, message: `\u5DF2\u8FC1\u79FB ${migratedAnchorFiles.length} \u4E2A\u9875\u9762\u7684\u65E7\u951A\u70B9\u6570\u636E` });
  if (patchedButtonFiles.length) result.patches.push({ id: "button-default-click-sound", changedFiles: patchedButtonFiles, message: `\u5DF2\u4E3A ${patchedButtonFiles.length} \u4E2A\u9875\u9762\u8865\u9F50 Button \u9ED8\u8BA4\u70B9\u51FB\u97F3\u6548` });
  result.soundSetup = {
    status: !hasSoundConfig ? "missing-config" : soundConfig.sounds.length === 0 ? "no-sounds" : !soundConfig.defaultButtonSoundId ? "missing-default" : "ok",
    soundCount: soundConfig.sounds.length,
    defaultButtonSoundId: soundConfig.defaultButtonSoundId,
    missingButtonSounds
  };
  return result;
}
async function getSliceMeta(store) {
  const raw = await store.readJson(SLICE_META_FILE);
  return isRecord2(raw) ? raw : {};
}
async function buildPublishWarnings(store) {
  const warnings = [];
  const config = sanitizeSoundConfig(await store.readJson(SOUNDS_FILE));
  const soundIds = new Set(config.sounds.map((sound) => sound.id));
  const refs = /* @__PURE__ */ new Set();
  const collectRefs = (node) => {
    if (!isRecord2(node)) return;
    const djui = isRecord2(node.djui) ? node.djui : null;
    if (typeof djui?.clickSoundId === "string" && djui.clickSoundId) refs.add(djui.clickSoundId);
    if (Array.isArray(node.children)) node.children.forEach(collectRefs);
  };
  for (const file of (await walkFiles(store, PAGES_DIR)).filter((file2) => file2.endsWith(".json"))) {
    const page = await store.readJson(file);
    if (isRecord2(page)) collectRefs(page.root);
  }
  for (const ref of refs) if (!soundIds.has(ref)) warnings.push(`\u97F3\u6548\u5F15\u7528 ${ref} \u5728 sounds.json \u4E2D\u4E0D\u5B58\u5728`);
  return warnings;
}
async function migrateLegacyLayoutCore(workspace, star) {
  if (await workspace.fileExists(PROJECT_FILE) || !await star.fileExists(STAR_PROJECT_FILE)) {
    return { migrated: false, pages: 0, sounds: false };
  }
  const project = await star.readBytes(STAR_PROJECT_FILE);
  if (project === null) throw new Error("\u65E7\u7248\u9879\u76EE\u914D\u7F6E\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u65E0\u6CD5\u8FC1\u79FB");
  await workspace.writeBytes(PROJECT_FILE, project);
  let pages = 0;
  for (const file of await walkFiles(star, STAR_PAGES_DIR)) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const data = await star.readBytes(file);
    if (data === null) throw new Error(`\u65E7\u7248\u9875\u9762\u65E0\u6CD5\u8BFB\u53D6\uFF1A${file}`);
    await workspace.writeBytes(joinPath(PAGES_DIR, file.slice(STAR_PAGES_DIR.length).replace(/^\//, "")), data);
    pages++;
  }
  let sounds = false;
  const soundData = await star.readBytes(STAR_SOUNDS_FILE);
  if (soundData !== null) {
    await workspace.writeBytes(SOUNDS_FILE, soundData);
    sounds = true;
  }
  return { migrated: true, pages, sounds };
}
async function checkRuntimeCore(star) {
  const runtimeDir = "src/DjuiRuntime";
  if (!await star.dirExists(runtimeDir)) return { status: "missing", message: "\u672A\u5B89\u88C5 Runtime" };
  const installedVersion = (await star.readText(runtimeDir + "/djui_version.txt"))?.trim() ?? "unknown";
  const installedFiles = (await star.listEntries(runtimeDir)).filter((entry) => entry.kind === "file" && (entry.name.endsWith(".cs") || entry.name === "AGENTS.md")).map((entry) => entry.name);
  const sourceFiles = RUNTIME_FILES.map((file) => file.name);
  const missingFiles = sourceFiles.filter((file) => !installedFiles.includes(file));
  const extraFiles = installedFiles.filter((file) => !sourceFiles.includes(file));
  if (installedVersion === RUNTIME_VERSION && missingFiles.length === 0 && extraFiles.length === 0) {
    return { status: "ok", message: "Runtime \u5DF2\u5C31\u7EEA", installedVersion, expectedVersion: RUNTIME_VERSION };
  }
  if (compareVersions(installedVersion, RUNTIME_VERSION) > 0) {
    return {
      status: "outdated",
      installedNewer: true,
      message: `\u661F\u706B\u5DE5\u7A0B Runtime\uFF08${installedVersion}\uFF09\u6BD4\u5F53\u524D\u5DE5\u5177\u5185\u7F6E\uFF08${RUNTIME_VERSION}\uFF09\u66F4\u65B0\uFF0C\u5DE5\u5177\u4FA7\u8FC7\u65E7`,
      installedVersion,
      expectedVersion: RUNTIME_VERSION,
      installedFiles,
      sourceFiles,
      missingFiles,
      extraFiles
    };
  }
  return { status: "outdated", message: "Runtime \u53EF\u5347\u7EA7", installedVersion, expectedVersion: RUNTIME_VERSION, installedFiles, sourceFiles, missingFiles, extraFiles };
}
async function upgradeRuntimeCore(star, files = RUNTIME_FILES) {
  const dir = "src/DjuiRuntime";
  const current = (await star.readText(dir + "/djui_version.txt"))?.trim();
  if (current && compareVersions(current, RUNTIME_VERSION) > 0) {
    return {
      ok: false,
      code: "RUNTIME_DOWNGRADE_BLOCKED",
      error: `\u661F\u706B\u5DE5\u7A0B Runtime \u5DF2\u662F ${current}\uFF0C\u6BD4\u5F53\u524D\u5DE5\u5177\u5185\u7F6E\u7684 ${RUNTIME_VERSION} \u66F4\u65B0`,
      userAction: "\u7981\u6B62\u964D\u7EA7\uFF1A\u8BF7\u5148\u5728 DJUI \u7F51\u9875\u6267\u884C\u300C\u68C0\u67E5\u5DE5\u4F5C\u533A\u66F4\u65B0\u300D\u540C\u6B65\u811A\u672C\u533A\uFF0C\u8BA9\u672C\u5730\u53D1\u5E03\u5668\u4E0E Runtime \u540C\u4EE3\u540E\u518D\u64CD\u4F5C\u3002"
    };
  }
  await star.ensureDir(dir);
  for (const entry of await star.listEntries(dir)) if (entry.kind === "file" && entry.name.endsWith(".cs")) await star.remove(joinPath(dir, entry.name));
  for (const file of files) await star.writeText(joinPath(dir, file.name), file.content);
  await star.writeText(joinPath(dir, "djui_version.txt"), RUNTIME_VERSION);
  await star.writeText(joinPath(dir, "README.md"), `# DJUI Runtime

Version: ${RUNTIME_VERSION}

This directory was auto-created by DJUI Editor.
Do not edit manually - use DJUI Editor to update.
`);
  return { ok: true, version: RUNTIME_VERSION, targetDir: dir, copiedFiles: files.map((file) => file.name) };
}
async function publishCore(workspace, star) {
  await migrateLegacyLayoutCore(workspace, star);
  const runtime = await checkRuntimeCore(star);
  if (runtime.status !== "ok") {
    if (runtime.installedNewer) return {
      ok: false,
      code: "PUBLISHER_OUTDATED",
      error: `\u661F\u706B\u5DE5\u7A0B Runtime \u5DF2\u662F ${runtime.installedVersion ?? "\u672A\u77E5\u7248\u672C"}\uFF0C\u6BD4\u672C\u53D1\u5E03\u5668\u5185\u7F6E\u7684 ${RUNTIME_VERSION} \u66F4\u65B0`,
      userAction: "\u672C\u5730\u53D1\u5E03\u5668\u8FC7\u65E7\uFF1A\u8BF7\u8BA9\u7528\u6237\u5728 DJUI \u7F51\u9875\u6267\u884C\u300C\u68C0\u67E5\u5DE5\u4F5C\u533A\u66F4\u65B0\u300D\u540C\u6B65\u811A\u672C\u533A\u540E\u518D\u53D1\u5E03\u3002\u7981\u6B62\u6267\u884C upgrade-runtime\uFF08\u4F1A\u628A Runtime \u964D\u7EA7\uFF09\u3002"
    };
    return {
      ok: false,
      code: "RUNTIME_NOT_READY",
      error: runtime.message,
      userAction: `DJUI Runtime \u72B6\u6001\u4E3A ${runtime.status}\uFF08\u5DF2\u5B89\u88C5 ${runtime.installedVersion ?? "\u65E0"}\uFF0C\u9700\u8981 ${runtime.expectedVersion ?? RUNTIME_VERSION}\uFF09\u3002\u8BF7\u8BE2\u95EE\u7528\u6237\u662F\u5426\u5141\u8BB8\u6267\u884C upgrade-runtime\u3002`
    };
  }
  const patches = await applyProjectPatchesCore(workspace);
  if (!patches.ok || patches.blockers.length) return { ok: false, code: "INVALID_WORKSPACE", error: patches.blockers.join("\n") || "\u8865\u4E01\u5E94\u7528\u5931\u8D25" };
  if (!await workspace.dirExists("\u6210\u54C1\u7D20\u6750")) return { ok: false, code: "INVALID_WORKSPACE", error: "\u6210\u54C1\u7D20\u6750\u76EE\u5F55\u4E0D\u5B58\u5728" };
  if (!await workspace.dirExists(PAGES_DIR)) return { ok: false, code: "INVALID_WORKSPACE", error: "\u9875\u9762\u76EE\u5F55\u4E0D\u5B58\u5728" };
  const projectData = await workspace.readText(PROJECT_FILE);
  if (!projectData) return { ok: false, code: "INVALID_WORKSPACE", error: "\u7F3A\u5C11\u5DE5\u4F5C\u533A .djui/layout/project.json" };
  const prevManifest = await star.readJson(MANIFEST_PATH) ?? {};
  const previousFiles = prevManifest.files ?? {};
  const assets = await mirrorDirectory(workspace, "\u6210\u54C1\u7D20\u6750", star, IMAGE_TARGET_DIR, void 0, async (relative2, info) => {
    const previous = previousFiles[relative2];
    return !!previous && previous[0] === info.size && previous[1] === info.mtime;
  });
  await star.writeJson(MANIFEST_PATH, { files: await collectFingerprints(workspace, "\u6210\u54C1\u7D20\u6750") });
  const warnings = [];
  const serverPages = await mirrorDirectory(workspace, PAGES_DIR, star, STAR_PAGES_DIR);
  const sliceMeta = await getSliceMeta(workspace);
  const clientPagesExisted = await star.dirExists(CLIENT_PAGES_DIR);
  const clientPages = await mirrorDirectory(workspace, PAGES_DIR, star, CLIENT_PAGES_DIR, async (file, _relative, bytes) => {
    if (!file.toLowerCase().endsWith(".json")) return bytes;
    const page = JSON.parse(new TextDecoder().decode(bytes));
    return new TextEncoder().encode(JSON.stringify(createRuntimePageSnapshot(page, sliceMeta), null, 2));
  });
  if (!clientPagesExisted) warnings.push(`\u76EE\u5F55 ${CLIENT_PAGES_DIR} \u539F\u672C\u4E0D\u5B58\u5728\uFF0C\u5DF2\u81EA\u52A8\u521B\u5EFA\uFF08\u82E5\u8FD9\u4E0D\u662F\u661F\u706B\u5DE5\u7A0B\u7ED3\u6784\u8BF7\u68C0\u67E5\uFF09`);
  await star.writeText(STAR_PROJECT_FILE, projectData);
  await star.writeText(CLIENT_DJUI_DIR + "/project.json", projectData);
  let copiedSoundsConfig = false;
  const sounds = await workspace.readText(SOUNDS_FILE);
  if (sounds) {
    await star.writeText(STAR_SOUNDS_FILE, sounds);
    await star.writeText(CLIENT_DJUI_DIR + "/sounds.json", sounds);
    copiedSoundsConfig = true;
  }
  warnings.push(...await buildPublishWarnings(workspace));
  return {
    ok: true,
    copiedAssets: new Array(assets.total).fill(""),
    copiedPages: new Array(serverPages.total).fill(""),
    copiedClientPages: new Array(clientPages.total).fill(""),
    copiedSoundsConfig,
    copiedConfig: true,
    warnings,
    targetDir: IMAGE_TARGET_DIR,
    targetDirs: { images: IMAGE_TARGET_DIR, clientPages: CLIENT_PAGES_DIR, clientSounds: copiedSoundsConfig ? CLIENT_DJUI_DIR + "/sounds.json" : void 0 },
    message: `\u53D1\u5E03\u5B8C\u6210\uFF1A\u7D20\u6750 ${assets.copied} \u590D\u5236 / ${assets.skipped} \u672A\u53D8\u8DF3\u8FC7 / ${assets.removed} \u6E05\u7406`
  };
}

// src/cli/djui-publish.ts
var NodePublishStore = class {
  label;
  root;
  constructor(root) {
    this.root = resolve(root);
    this.label = this.root;
  }
  full(path) {
    if (isAbsolute(path)) throw new Error("\u53D1\u5E03\u5668\u5185\u90E8\u8DEF\u5F84\u4E0D\u80FD\u662F\u7EDD\u5BF9\u8DEF\u5F84");
    const target = resolve(this.root, path.replace(/[\\/]/g, sep));
    const rel = relative(this.root, target);
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error(`\u53D1\u5E03\u8DEF\u5F84\u8D8A\u754C\uFF1A${path}`);
    return target;
  }
  async fileExists(path) {
    try {
      return (await stat(this.full(path))).isFile();
    } catch {
      return false;
    }
  }
  async dirExists(path) {
    try {
      return (await stat(this.full(path))).isDirectory();
    } catch {
      return false;
    }
  }
  async ensureDir(path) {
    await mkdir(this.full(path), { recursive: true });
  }
  async listEntries(path) {
    try {
      const entries = await readdir(this.full(path), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() || entry.isDirectory()).map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? "directory" : "file" })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    } catch {
      return [];
    }
  }
  async readText(path) {
    try {
      return await readFile(this.full(path), "utf8");
    } catch {
      return null;
    }
  }
  async readBytes(path) {
    try {
      return new Uint8Array(await readFile(this.full(path)));
    } catch {
      return null;
    }
  }
  async readJson(path) {
    const text = await this.readText(path);
    if (text === null) return null;
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      return null;
    }
  }
  async writeText(path, content) {
    const output2 = this.full(path);
    await mkdir(dirname(output2), { recursive: true });
    await writeFile(output2, content, "utf8");
  }
  async writeBytes(path, content) {
    const output2 = this.full(path);
    await mkdir(dirname(output2), { recursive: true });
    await writeFile(output2, content);
  }
  async writeJson(path, data) {
    await this.writeText(path, JSON.stringify(data, null, 2));
  }
  async remove(path, recursive = false) {
    await rm(this.full(path), { recursive, force: true });
  }
  async fileInfo(path) {
    try {
      const value = await stat(this.full(path));
      return value.isFile() ? { size: value.size, mtime: value.mtimeMs } : null;
    } catch {
      return null;
    }
  }
};
function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
}
function output(payload, asJson) {
  if (asJson) console.log(JSON.stringify(payload, null, 2));
  else console.log(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
}
function usage() {
  return [
    "DJUI \u672C\u5730\u53D1\u5E03\u5668",
    "node \u811A\u672C\u533A/djui-publish.mjs configure --star-project <\u661F\u706B\u5DE5\u7A0B\u76EE\u5F55> --json",
    "node \u811A\u672C\u533A/djui-publish.mjs status --json",
    "node \u811A\u672C\u533A/djui-publish.mjs runtime-status --json",
    "node \u811A\u672C\u533A/djui-publish.mjs publish --json",
    "node \u811A\u672C\u533A/djui-publish.mjs upgrade-runtime --json"
  ].join("\n");
}
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  const asJson = args.includes("--json");
  const workspacePath = optionValue(args, "--workspace") ?? process.cwd();
  const workspace = new NodePublishStore(workspacePath);
  if (command === "help" || command === "--help" || command === "-h") {
    output(usage(), asJson);
    return 0;
  }
  if (command === "configure") {
    const starProjectPath = optionValue(args, "--star-project");
    if (!starProjectPath) {
      output({ ok: false, code: "MISSING_STAR_PROJECT", error: "configure \u5FC5\u987B\u63D0\u4F9B --star-project <\u661F\u706B\u5DE5\u7A0B\u76EE\u5F55>" }, asJson);
      return 2;
    }
    const absoluteStarPath = resolve(starProjectPath);
    try {
      if (!await new NodePublishStore(absoluteStarPath).dirExists("")) throw new Error("\u76EE\u5F55\u4E0D\u5B58\u5728\u6216\u65E0\u6CD5\u8BBF\u95EE");
      await workspace.writeJson(PUBLISH_CONFIG_FILE, { version: 1, starProjectPath: absoluteStarPath });
      output({ ok: true, workspace: resolve(workspacePath), starProjectPath: absoluteStarPath, configFile: PUBLISH_CONFIG_FILE }, asJson);
      return 0;
    } catch (error) {
      output({ ok: false, code: "INVALID_STAR_PROJECT", error: error instanceof Error ? error.message : String(error) }, asJson);
      return 2;
    }
  }
  const config = await workspace.readJson(PUBLISH_CONFIG_FILE);
  if (!config || config.version !== 1 || !config.starProjectPath) {
    output({ ok: false, code: "MISSING_TARGET_CONFIG", error: "\u5C1A\u672A\u914D\u7F6E\u661F\u706B\u5DE5\u7A0B\u76EE\u5F55", userAction: "\u8BF7\u5411\u7528\u6237\u7D22\u53D6\u661F\u706B\u5DE5\u7A0B\u76EE\u5F55\uFF0C\u7136\u540E\u6267\u884C configure --star-project <\u8DEF\u5F84>\u3002" }, asJson);
    return 10;
  }
  const star = new NodePublishStore(config.starProjectPath);
  if (!await star.dirExists("")) {
    output({ ok: false, code: "INVALID_TARGET_CONFIG", error: `\u661F\u706B\u5DE5\u7A0B\u76EE\u5F55\u65E0\u6CD5\u8BBF\u95EE\uFF1A${config.starProjectPath}`, userAction: "\u8BF7\u5411\u7528\u6237\u786E\u8BA4\u5DE5\u7A0B\u76EE\u5F55\u662F\u5426\u5DF2\u79FB\u52A8\uFF0C\u518D\u91CD\u65B0\u6267\u884C configure\u3002" }, asJson);
    return 10;
  }
  if (command === "status" || command === "runtime-status") {
    const runtime = await checkRuntimeCore(star);
    output({ ok: true, workspace: resolve(workspacePath), starProjectPath: config.starProjectPath, runtime }, asJson);
    return runtime.status === "ok" ? 0 : 20;
  }
  if (command === "upgrade-runtime") {
    const result = await upgradeRuntimeCore(star);
    output(result, asJson);
    return result.ok ? 0 : 26;
  }
  if (command === "publish") {
    try {
      const result = await publishCore(workspace, star);
      output(result, asJson);
      return result.ok ? 0 : result.code === "RUNTIME_NOT_READY" ? 20 : result.code === "PUBLISHER_OUTDATED" ? 25 : 30;
    } catch (error) {
      output({ ok: false, code: "PUBLISH_FAILED", error: error instanceof Error ? error.message : String(error) }, asJson);
      return 40;
    }
  }
  output({ ok: false, code: "UNKNOWN_COMMAND", error: usage() }, asJson);
  return 2;
}
main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.log(JSON.stringify({ ok: false, code: "UNEXPECTED_ERROR", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 40;
});
