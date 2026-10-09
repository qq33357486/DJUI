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
  if (applyLayoutCompatToNode(node)) result.changed = true;
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) patchNode(child, defaultButtonSoundId, result);
  }
}
function applyLayoutCompatToNode(node) {
  let changed = false;
  const layout = isRecord(node.layout) ? node.layout : null;
  if (layout && typeof layout.spacing === "number") {
    layout.spacing = [layout.spacing, layout.spacing];
    changed = true;
  }
  if (node.starType === "SpacingPanel") {
    node.starType = "Panel";
    changed = true;
  }
  return changed;
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
var DJUI_SCHEMA_VERSION = 1;
var RESPONSIVE_OVERRIDE_PATHS = [
  "basic.visible",
  "basic.disabled",
  "transform.x",
  "transform.y",
  "transform.width",
  "transform.height",
  "appearance.image",
  "appearance.imageTint",
  "appearance.background",
  "appearance.imageFit",
  "appearance.focalX",
  "appearance.focalY",
  "appearance.borderThickness",
  "appearance.borderColor",
  "text.text",
  "text.fontSize",
  "text.textColor",
  "text.strokeSize",
  "text.strokeColor",
  "text.bold",
  "text.font",
  "text.textWrap",
  "button.imageHover",
  "button.imagePressed",
  "button.imageDisabled",
  "progress.value"
];

// src/lib/schemaV6.ts
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function versionKind(raw, issues) {
  if (raw.protocolVersion === DJUI_PROTOCOL_VERSION && raw.schemaVersion === DJUI_SCHEMA_VERSION) return "ok";
  const version = typeof raw.protocolVersion === "number" ? raw.protocolVersion : typeof raw.version === "number" ? raw.version : null;
  if (version !== null && version < DJUI_PROTOCOL_VERSION) {
    issues.push({ path: "$.protocolVersion", message: "\u65E7\u534F\u8BAE\u6587\u4EF6\u5FC5\u987B\u663E\u5F0F\u8FC1\u79FB\u5230 v6" });
    return "legacy";
  }
  if (version !== null && version > DJUI_PROTOCOL_VERSION) {
    issues.push({ path: "$.protocolVersion", message: "\u6587\u4EF6\u534F\u8BAE\u9AD8\u4E8E\u5F53\u524D\u7F16\u8F91\u5668\u652F\u6301\u7684 v6" });
    return "future";
  }
  issues.push({ path: "$.protocolVersion", message: "\u7F3A\u5C11 protocolVersion=6 \u6216 schemaVersion=1" });
  return "invalid";
}
function checkPositive(value, path, issues) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) issues.push({ path, message: "\u5FC5\u987B\u662F\u5927\u4E8E 0 \u7684\u6709\u9650\u6570\u5B57" });
}
function inspectProjectV6(raw) {
  const issues = [];
  if (!isRecord2(raw)) return { ok: false, kind: "invalid", issues: [{ path: "$", message: "\u9879\u76EE\u914D\u7F6E\u5FC5\u987B\u662F JSON \u5BF9\u8C61" }] };
  const kind = versionKind(raw, issues);
  if (kind !== "ok") return { ok: false, kind, issues };
  if (raw.orientation !== "portrait" && raw.orientation !== "landscape") issues.push({ path: "$.orientation", message: "\u5FC5\u987B\u662F portrait \u6216 landscape" });
  if (!isRecord2(raw.canvas)) issues.push({ path: "$.canvas", message: "\u7F3A\u5C11 Canvas \u914D\u7F6E" });
  else {
    checkPositive(raw.canvas.referenceWidth, "$.canvas.referenceWidth", issues);
    checkPositive(raw.canvas.referenceHeight, "$.canvas.referenceHeight", issues);
    if (!["Contain", "MatchWidth", "MatchHeight"].includes(String(raw.canvas.mode))) issues.push({ path: "$.canvas.mode", message: "\u4E0D\u652F\u6301\u7684 Canvas \u6A21\u5F0F" });
  }
  if (!isRecord2(raw.responsive)) issues.push({ path: "$.responsive", message: "\u7F3A\u5C11\u54CD\u5E94\u5F0F\u914D\u7F6E" });
  else {
    checkPositive(raw.responsive.wideRatio, "$.responsive.wideRatio", issues);
    if (typeof raw.responsive.wideRatio === "number" && raw.responsive.wideRatio <= 1) issues.push({ path: "$.responsive.wideRatio", message: "\u5FC5\u987B\u5927\u4E8E 1" });
  }
  if (raw.retainedPages !== void 0 && (!Array.isArray(raw.retainedPages) || raw.retainedPages.some((page) => typeof page !== "string"))) {
    issues.push({ path: "$.retainedPages", message: "\u5FC5\u987B\u662F\u9875\u9762 ID \u5B57\u7B26\u4E32\u6570\u7EC4" });
  }
  if (raw.poolCapacity !== void 0 && (typeof raw.poolCapacity !== "number" || !Number.isInteger(raw.poolCapacity) || raw.poolCapacity < 0 || raw.poolCapacity > 100)) {
    issues.push({ path: "$.poolCapacity", message: "\u5FC5\u987B\u662F 0~100 \u7684\u6574\u6570" });
  }
  return issues.length ? { ok: false, kind: "invalid", issues } : { ok: true, value: raw };
}
function inspectPageV6(raw) {
  const issues = [];
  if (!isRecord2(raw)) return { ok: false, kind: "invalid", issues: [{ path: "$", message: "\u9875\u9762\u5FC5\u987B\u662F JSON \u5BF9\u8C61" }] };
  const kind = versionKind(raw, issues);
  if (kind !== "ok") return { ok: false, kind, issues };
  if (typeof raw.pageId !== "string" || !raw.pageId.trim()) issues.push({ path: "$.pageId", message: "\u9875\u9762 ID \u4E0D\u80FD\u4E3A\u7A7A" });
  if (raw.kind !== "window" && raw.kind !== "template") issues.push({ path: "$.kind", message: "\u5FC5\u987B\u662F window \u6216 template" });
  if (raw.kind === "window" && !isRecord2(raw.window)) issues.push({ path: "$.window", message: "Window \u9875\u9762\u7F3A\u5C11 window \u914D\u7F6E" });
  if (raw.kind === "template") {
    if (!isRecord2(raw.localSize)) issues.push({ path: "$.localSize", message: "Template \u7F3A\u5C11 localSize" });
    else {
      checkPositive(raw.localSize.width, "$.localSize.width", issues);
      checkPositive(raw.localSize.height, "$.localSize.height", issues);
    }
  }
  const nodeIds = /* @__PURE__ */ new Set();
  if (!isRecord2(raw.root) || !Array.isArray(raw.root.children)) issues.push({ path: "$.root", message: "\u7F3A\u5C11\u7ED3\u6784\u6839\u6216 root.children" });
  else {
    validateNode(raw.root, "$.root", issues, nodeIds);
    validateSceneFrames(raw.root, "$.root", issues);
  }
  validateOverrideMaps(raw.responsive, "$.responsive", issues, nodeIds);
  return issues.length ? { ok: false, kind: "invalid", issues } : { ok: true, value: raw };
}
function validateSceneFrames(root, rootPath, issues) {
  const rootChildren = Array.isArray(root.children) ? root.children : [];
  const rootById = /* @__PURE__ */ new Map();
  rootChildren.forEach((child) => {
    if (isRecord2(child) && typeof child.id === "string") rootById.set(child.id, child);
  });
  const walk = (node, path, insideScene, isRootChild) => {
    const frame = isRecord2(node.sceneFrame) ? node.sceneFrame : null;
    const nowInsideScene = insideScene || !!frame;
    if (frame) {
      if (!isRootChild) issues.push({ path: path + ".sceneFrame", message: "\u573A\u666F\u753B\u677F\u53EA\u80FD\u653E\u5728\u9875\u9762\u6839\u8282\u70B9\u4E0B" });
      const backgroundId = typeof frame.backgroundId === "string" ? frame.backgroundId : "";
      const background = rootById.get(backgroundId);
      if (!background) issues.push({ path: path + ".sceneFrame.backgroundId", message: "\u5F15\u7528\u7684\u80CC\u666F\u5FC5\u987B\u662F\u9875\u9762\u6839\u4E0B\u8282\u70B9" });
      else if (!isRecord2(background.appearance) || typeof background.appearance.image !== "string" || !background.appearance.image) {
        issues.push({ path: path + ".sceneFrame.backgroundId", message: "\u5F15\u7528\u8282\u70B9\u5FC5\u987B\u662F\u5E26\u56FE\u7247\u7684\u80CC\u666F" });
      }
      if (!isRecord2(node.anchor) || node.anchor.target !== "image") {
        issues.push({ path: path + ".anchor.target", message: "\u573A\u666F\u753B\u677F\u5BB9\u5668\u5FC5\u987B\u951A\u5B9A image \u56FE\u5E27" });
      }
      if (!isRecord2(node.stretch) || node.stretch.style !== "Both") {
        issues.push({ path: path + ".stretch.style", message: "\u573A\u666F\u753B\u677F\u5BB9\u5668\u5FC5\u987B\u4F7F\u7528 Both \u62C9\u4F38\u586B\u6EE1\u56FE\u5E27" });
      }
    } else if (insideScene && isRecord2(node.anchor) && node.anchor.target !== void 0 && node.anchor.target !== "parent") {
      issues.push({ path: path + ".anchor.target", message: "\u573A\u666F\u753B\u677F\u5185\u8282\u70B9\u53EA\u80FD\u951A\u5B9A parent" });
    }
    if (!Array.isArray(node.children)) return;
    node.children.forEach((child, index) => {
      if (isRecord2(child)) walk(child, path + ".children[" + index + "]", nowInsideScene, false);
    });
  };
  rootChildren.forEach((child, index) => {
    if (isRecord2(child)) walk(child, rootPath + ".children[" + index + "]", false, true);
  });
}
function validateNode(value, path, issues, nodeIds) {
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) issues.push({ path: path + ".id", message: "\u8282\u70B9 ID \u4E0D\u80FD\u4E3A\u7A7A" });
  else if (nodeIds.has(id)) issues.push({ path: path + ".id", message: "\u8282\u70B9 ID \u5FC5\u987B\u5728\u9875\u9762\u5185\u552F\u4E00" });
  else nodeIds.add(id);
  const starTypes = ["Panel", "Button", "Label", "Input", "Progress", "SpacingPanel", "PanelScrollable", "TemplateInstance"];
  if (!starTypes.includes(String(value.starType))) issues.push({ path: path + ".starType", message: "\u4E0D\u652F\u6301\u7684\u63A7\u4EF6\u7C7B\u578B" });
  if (isRecord2(value.anchor)) {
    if (!["parent", "screen", "safe", "image"].includes(String(value.anchor.target ?? "parent"))) issues.push({ path: path + ".anchor.target", message: "\u5FC5\u987B\u662F parent\u3001screen\u3001safe \u6216 image" });
    const sides = ["None", "TopLeft", "Top", "TopRight", "Left", "Center", "Right", "BottomLeft", "Bottom", "BottomRight"];
    if (!sides.includes(String(value.anchor.side ?? "TopLeft"))) issues.push({ path: path + ".anchor.side", message: "\u4E0D\u652F\u6301\u7684\u951A\u70B9\u4F4D\u7F6E" });
    if (value.anchor.target === "safe") {
      const edges = value.anchor.safeEdges;
      if (!Array.isArray(edges) || edges.length === 0) issues.push({ path: path + ".anchor.safeEdges", message: "\u5B89\u5168\u533A\u951A\u70B9\u81F3\u5C11\u9009\u62E9\u4E00\u6761\u8FB9" });
      else {
        const legal = /* @__PURE__ */ new Set(["left", "top", "right", "bottom"]);
        if (edges.some((edge) => typeof edge !== "string" || !legal.has(edge))) issues.push({ path: path + ".anchor.safeEdges", message: "\u5305\u542B\u975E\u6CD5\u5B89\u5168\u8FB9" });
        if (new Set(edges).size !== edges.length) issues.push({ path: path + ".anchor.safeEdges", message: "\u5B89\u5168\u8FB9\u4E0D\u80FD\u91CD\u590D" });
      }
    }
  }
  if (isRecord2(value.appearance)) {
    const fit = value.appearance.imageFit;
    if (fit !== void 0 && !["stretch", "contain", "cover"].includes(String(fit))) issues.push({ path: path + ".appearance.imageFit", message: "\u56FE\u7247\u94FA\u653E\u65B9\u5F0F\u65E0\u6548" });
    if (fit === "contain" || fit === "cover") {
      const size = value.appearance.sourceSize;
      if (!isRecord2(size)) issues.push({ path: path + ".appearance.sourceSize", message: "contain/cover \u5FC5\u987B\u8BB0\u5F55\u7D20\u6750\u539F\u59CB\u5C3A\u5BF8" });
      else {
        checkPositive(size.width, path + ".appearance.sourceSize.width", issues);
        checkPositive(size.height, path + ".appearance.sourceSize.height", issues);
      }
    }
    for (const key of ["focalX", "focalY"]) {
      const n = value.appearance[key];
      if (n !== void 0 && (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1)) issues.push({ path: path + ".appearance." + key, message: "\u5FC5\u987B\u662F 0 \u5230 1 \u7684\u6709\u9650\u6570\u5B57" });
    }
  }
  if (value.sceneFrame !== void 0 && value.sceneFrame !== null) {
    if (!isRecord2(value.sceneFrame)) {
      issues.push({ path: path + ".sceneFrame", message: "\u573A\u666F\u753B\u677F\u5FC5\u987B\u662F\u5BF9\u8C61" });
    } else {
      if (typeof value.sceneFrame.backgroundId !== "string" || !value.sceneFrame.backgroundId.trim()) {
        issues.push({ path: path + ".sceneFrame.backgroundId", message: "\u5FC5\u987B\u5F15\u7528\u80CC\u666F\u8282\u70B9 ID" });
      }
      if (!isRecord2(value.sceneFrame.artboard)) {
        issues.push({ path: path + ".sceneFrame.artboard", message: "\u7F3A\u5C11\u573A\u666F\u753B\u677F\u5C3A\u5BF8" });
      } else {
        checkPositive(value.sceneFrame.artboard.width, path + ".sceneFrame.artboard.width", issues);
        checkPositive(value.sceneFrame.artboard.height, path + ".sceneFrame.artboard.height", issues);
      }
    }
  }
  if (isRecord2(value.interaction)) {
    const routed = value.interaction.routedEvents;
    if (routed !== void 0 && routed !== null && typeof routed !== "string") issues.push({ path: path + ".interaction.routedEvents", message: "\u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6216 null" });
    for (const key of ["allowDrag", "allowDrop"]) if (value.interaction[key] !== void 0 && typeof value.interaction[key] !== "boolean") issues.push({ path: path + ".interaction." + key, message: "\u5FC5\u987B\u662F\u5E03\u5C14\u503C" });
    const behaviors = value.interaction.behaviors;
    if (behaviors !== void 0) {
      if (!Array.isArray(behaviors)) issues.push({ path: path + ".interaction.behaviors", message: "\u5FC5\u987B\u662F\u6570\u7EC4" });
      else behaviors.forEach((behavior, index) => {
        if (!isRecord2(behavior) || behavior.type !== "TouchBehavior") issues.push({ path: path + ".interaction.behaviors[" + index + "]", message: "\u53EA\u652F\u6301 TouchBehavior" });
        else if (behavior.scaleFactor !== void 0 && (typeof behavior.scaleFactor !== "number" || !Number.isFinite(behavior.scaleFactor) || behavior.scaleFactor <= 0)) issues.push({ path: path + ".interaction.behaviors[" + index + "].scaleFactor", message: "\u5FC5\u987B\u5927\u4E8E 0" });
      });
    }
  }
  if (isRecord2(value.effects) && value.effects.preset !== void 0 && value.effects.preset !== null && typeof value.effects.preset !== "string") issues.push({ path: path + ".effects.preset", message: "\u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6216 null" });
  if (!Array.isArray(value.children)) issues.push({ path: path + ".children", message: "children \u5FC5\u987B\u662F\u6570\u7EC4" });
  else value.children.forEach((child, index) => {
    if (!isRecord2(child)) issues.push({ path: path + ".children[" + index + "]", message: "\u8282\u70B9\u5FC5\u987B\u662F\u5BF9\u8C61" });
    else validateNode(child, path + ".children[" + index + "]", issues, nodeIds);
  });
}
function validateOverrideMaps(value, path, issues, nodeIds) {
  if (value === void 0) return;
  if (!isRecord2(value) || !isRecord2(value.wide) || !isRecord2(value.wide.overrides)) {
    issues.push({ path, message: "\u54CD\u5E94\u5F0F\u8986\u76D6\u5FC5\u987B\u4F7F\u7528 wide.overrides \u7ED3\u6784" });
    return;
  }
  const legal = new Set(RESPONSIVE_OVERRIDE_PATHS);
  for (const [nodeId, map] of Object.entries(value.wide.overrides)) {
    if (!nodeIds.has(nodeId)) issues.push({ path: path + ".wide.overrides." + nodeId, message: "\u8986\u76D6\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u8282\u70B9 ID" });
    if (!isRecord2(map)) {
      issues.push({ path: path + ".wide.overrides." + nodeId, message: "\u8282\u70B9\u8986\u76D6\u5FC5\u987B\u662F\u5BF9\u8C61" });
      continue;
    }
    for (const field of Object.keys(map)) {
      if (!legal.has(field)) issues.push({ path: path + ".wide.overrides." + nodeId + "." + field, message: "\u5B57\u6BB5\u4E0D\u5141\u8BB8\u88AB\u54CD\u5E94\u5F0F\u8986\u76D6" });
    }
  }
}

// raw:D:\git\DJUI\runtime\DjuiActionRouter.cs
var DjuiActionRouter_default = '// DJUI Runtime - Action \u8DEF\u7531\r\n\r\n#if CLIENT\r\n\r\nusing GameUI.Control;\r\nusing GameCore.Platform.SDL;\r\n\r\nnamespace DjuiRuntime;\r\n\r\n/// <summary>\r\n/// Action \u8DEF\u7531\u7CFB\u7EDF\u3002JSON \u4E2D\u58F0\u660E action\uFF0C\u8FD0\u884C\u65F6\u81EA\u52A8\u7ED1\u5B9A\u70B9\u51FB\u4E8B\u4EF6\u3002\r\n/// \u5F00\u53D1\u8005\u6CE8\u518C\u5904\u7406\u51FD\u6570\u5373\u53EF\u3002\r\n/// </summary>\r\npublic static class DjuiActionRouter\r\n{\r\n    private static readonly Dictionary<string, Action<Control, PointerEventArgs?>> _handlers = new();\r\n\r\n    /// <summary>\r\n    /// \u6CE8\u518C Action \u5904\u7406\u51FD\u6570\u3002\r\n    /// </summary>\r\n    public static void On(string actionName, Action handler)\r\n    {\r\n        _handlers[actionName] = (ctrl, args) => handler();\r\n    }\r\n\r\n    /// <summary>\r\n    /// \u6CE8\u518C Action \u5904\u7406\u51FD\u6570\uFF08\u5E26\u53C2\u6570\uFF09\u3002\r\n    /// </summary>\r\n    public static void On(string actionName, Action<Control, PointerEventArgs?> handler)\r\n    {\r\n        _handlers[actionName] = handler;\r\n    }\r\n\r\n    public static bool Trigger(string actionName)\r\n    {\r\n        if (!_handlers.TryGetValue(actionName, out var handler))\r\n            return false;\r\n\r\n        handler(null!, null);\r\n        return true;\r\n    }\r\n\r\n    /// <summary>\r\n    /// \u5185\u90E8\uFF1A\u5C06 action \u7ED1\u5B9A\u5230\u63A7\u4EF6\u7684\u70B9\u51FB\u4E8B\u4EF6\u3002\r\n    /// </summary>\r\n    internal static void BindAction(Control ctrl, string? actionName)\r\n    {\r\n        if (string.IsNullOrEmpty(actionName)) return;\r\n\r\n        ctrl.OnPointerClicked += (sender, args) =>\r\n        {\r\n            var owner = DjuiLayoutSessionV6.FindOwner(ctrl);\r\n            if (owner != null && DjuiWindowManagerV6.IsClosing(owner.WindowInstanceId)) return;\r\n            if (_handlers.TryGetValue(actionName, out var handler))\r\n            {\r\n                handler(ctrl, args);\r\n            }\r\n            else\r\n            {\r\n                Game.Logger.LogWarning("DJUI: \u672A\u6CE8\u518C\u7684 Action {Name}", actionName);\r\n            }\r\n        };\r\n    }\r\n}\r\n\r\n#endif\r\n';

// raw:D:\git\DJUI\runtime\DjuiAudioSystem.cs
var DjuiAudioSystem_default = '// DJUI Runtime - \u97F3\u6548\u64AD\u653E\n\n#if CLIENT\n\nusing System.IO;\nusing System.Text.Json;\nusing System.Text.Json.Serialization;\nusing GameCore.ResourceType;\nusing GameGraph.NodeSystem;\nusing GameGraph.NodeSystem.Component.Audio;\nusing GameGraph.ResourceSystem;\nusing GameUI.Control;\n\nnamespace DjuiRuntime;\n\npublic interface IDjuiAudioBackend\n{\n    bool Play(DjuiSoundItemJson sound);\n}\n\npublic static class DjuiAudioSystem\n{\n    private const string SoundsFile = "user_files/djui/sounds.json";\n\n    private static readonly Dictionary<string, DjuiSoundItemJson> _sounds = new();\n    private static readonly HashSet<string> _warned = new();\n    private static bool _loaded;\n    private static SceneGraph? _sceneGraph;\n    private static SoundSourceComponent? _source;\n    private static IDjuiAudioBackend? _backend;\n\n    public static void SetBackend(IDjuiAudioBackend? backend)\n    {\n        _backend = backend;\n    }\n\n    public static void Initialize()\n    {\n        LoadConfig();\n    }\n\n    public static void BindClickSound(Control ctrl, string? soundId)\n    {\n        if (string.IsNullOrWhiteSpace(soundId)) return;\n\n        ctrl.OnPointerClicked += (_, _) =>\n        {\n            Play(soundId);\n        };\n    }\n\n    public static bool Play(string soundId)\n    {\n        if (!_loaded)\n            LoadConfig();\n\n        if (!_sounds.TryGetValue(soundId, out var sound))\n        {\n            WarnOnce($"missing:{soundId}", "DJUI: \u672A\u627E\u5230\u97F3\u6548\u914D\u7F6E {SoundId}", soundId);\n            return false;\n        }\n\n        try\n        {\n            if (_backend != null && _backend.Play(sound))\n                return true;\n        }\n        catch (Exception ex)\n        {\n            WarnOnce($"backend:{soundId}", "DJUI: \u97F3\u9891\u540E\u7AEF\u64AD\u653E {SoundId} \u5931\u8D25: {Error}", soundId, ex.Message);\n        }\n\n        return PlayFallback(sound);\n    }\n\n    private static void LoadConfig()\n    {\n        _sounds.Clear();\n        _loaded = true;\n\n        if (!File.Exists(SoundsFile))\n            return;\n\n        try\n        {\n            var json = File.ReadAllText(SoundsFile);\n            var config = JsonSerializer.Deserialize<DjuiSoundConfigJson>(json);\n            if (config?.Sounds == null) return;\n\n            foreach (var sound in config.Sounds)\n            {\n                if (!string.IsNullOrWhiteSpace(sound.Id))\n                    _sounds[sound.Id] = sound;\n            }\n        }\n        catch (Exception ex)\n        {\n            WarnOnce("config", "DJUI: \u8BFB\u53D6\u58F0\u97F3\u914D\u7F6E\u5931\u8D25: {Error}", ex.Message);\n        }\n    }\n\n    private static bool PlayFallback(DjuiSoundItemJson sound)\n    {\n        if (string.IsNullOrWhiteSpace(sound.Asset))\n        {\n            WarnOnce($"empty:{sound.Id}", "DJUI: \u97F3\u6548 {SoundId} \u6CA1\u6709\u8D44\u6E90\u8DEF\u5F84", sound.Id);\n            return false;\n        }\n\n        try\n        {\n            var source = EnsureSource();\n            if (source == null) return false;\n\n            Sound soundPath = sound.Asset!;\n            var resource = SoundResource.Load(soundPath);\n            if (resource == null)\n            {\n                WarnOnce($"load:{sound.Id}", "DJUI: \u97F3\u9891\u8D44\u6E90\u52A0\u8F7D\u5931\u8D25 {Asset}", sound.Asset);\n                return false;\n            }\n\n            source.SoundType = "Effect";\n            source.Gain = 1f;\n            source.MixOutput = true;\n            source.Play(resource);\n            return true;\n        }\n        catch (Exception ex)\n        {\n            WarnOnce($"fallback:{sound.Id}", "DJUI: \u64AD\u653E\u97F3\u6548 {SoundId} \u5931\u8D25: {Error}", sound.Id, ex.Message);\n            return false;\n        }\n    }\n\n    private static SoundSourceComponent? EnsureSource()\n    {\n        if (_source != null)\n            return _source;\n\n        _sceneGraph ??= new SceneGraph(false);\n        var node = _sceneGraph.CreateChild("DjuiAudio");\n        _source = node?.CreateComponent<SoundSourceComponent>();\n\n        if (_source != null)\n        {\n            _source.SoundType = "Effect";\n            _source.Gain = 1f;\n            _source.MixOutput = true;\n        }\n\n        return _source;\n    }\n\n    private static void WarnOnce(string key, string message, params object?[] args)\n    {\n        if (!_warned.Add(key)) return;\n        Game.Logger.LogWarning(message, args);\n    }\n}\n\npublic class DjuiSoundConfigJson\n{\n    [JsonPropertyName("version")]\n    public int Version { get; set; } = 1;\n\n    [JsonPropertyName("sounds")]\n    public List<DjuiSoundItemJson> Sounds { get; set; } = new();\n}\n\npublic class DjuiSoundItemJson\n{\n    [JsonPropertyName("id")]\n    public string Id { get; set; } = "";\n\n    [JsonPropertyName("name")]\n    public string? Name { get; set; }\n\n    [JsonPropertyName("gameDataPath")]\n    public string? GameDataPath { get; set; }\n\n    [JsonPropertyName("asset")]\n    public string? Asset { get; set; }\n\n    [JsonPropertyName("category")]\n    public string? Category { get; set; }\n\n    [JsonPropertyName("controlTypes")]\n    public List<string> ControlTypes { get; set; } = new();\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiBindingSystem.cs
var DjuiBindingSystem_default = '// DJUI Runtime - scoped data binding system\n#if CLIENT\n\nusing GameUI.Control;\n\nnamespace DjuiRuntime;\n\n/// <summary>Global binding values with instance-scoped control registrations.</summary>\npublic static class DjuiBindingSystem\n{\n    private sealed class Registration : IDisposable\n    {\n        public required string Key { get; init; }\n        public required Control Control { get; init; }\n        public required Action<object?> Apply { get; init; }\n        public void Dispose()\n        {\n            if (_bindings.TryGetValue(Key, out var list))\n            {\n                list.Remove(this);\n                if (list.Count == 0) _bindings.Remove(Key);\n            }\n        }\n    }\n\n    private static readonly Dictionary<string, object?> _values = new();\n    private static readonly Dictionary<string, List<Registration>> _bindings = new();\n    // Legacy v5 registry only. v6 registers controls directly and never uses global bare IDs.\n    private static readonly Dictionary<string, Control> _controlRegistry = new();\n\n    internal static void RegisterControl(string nodeId, Control ctrl) => _controlRegistry[nodeId] = ctrl;\n    internal static Control? GetRegisteredControl(string nodeId) => _controlRegistry.TryGetValue(nodeId, out var ctrl) ? ctrl : null;\n\n    internal static void RegisterBinding(string nodeId, string propertyName, string bindingKey)\n    {\n        if (_controlRegistry.TryGetValue(nodeId, out var control)) RegisterBinding(control, propertyName, bindingKey);\n    }\n\n    /// <summary>Registers one v6 instance-owned binding without publishing a bare node ID globally.</summary>\n    internal static IDisposable RegisterBinding(Control control, string propertyName, string bindingKey)\n    {\n        var apply = CreateBindingAction(propertyName, control);\n        if (apply == null) return EmptyDisposable.Instance;\n        var registration = new Registration { Key = bindingKey, Control = control, Apply = apply };\n        if (!_bindings.TryGetValue(bindingKey, out var list)) _bindings[bindingKey] = list = new List<Registration>();\n        list.Add(registration);\n        if (_values.TryGetValue(bindingKey, out var value)) apply(value);\n        return registration;\n    }\n\n    /// <summary>image \u7ED1\u5B9A\u901A\u9053\u7684\u6CE8\u518C\u4E0A\u4E0B\u6587\uFF1A\u5B9A\u4F4D authored \u6A21\u578B\u4E0E\u6240\u5C5E\u4F1A\u8BDD\u3002\u6CE8\u518C\u70B9\uFF08DjuiTreeBuilderV6.BuildNode\uFF09\u5929\u7136\u9F50\u5907\u8FD9\u4E24\u9879\u3002</summary>\n    private sealed record ImageBindingContext(DjuiLayoutSessionV6 Session, string NodeId);\n\n    /// <summary>\n    /// v6 \u6CE8\u518C\u91CD\u8F7D\uFF08\u5E26\u8282\u70B9 id \u4E0E\u5E03\u5C40\u4F1A\u8BDD\uFF09\uFF1Aimage \u7ED1\u5B9A\u7ECF\u5B83\u53D6\u5F97\u6A21\u578B\u5B9A\u4F4D\uFF0C\u5176\u4F59\u5C5E\u6027\u4E0E\u65E0\u4E0A\u4E0B\u6587\u91CD\u8F7D\u884C\u4E3A\u4E00\u81F4\u3002\n    /// \u7ED1\u5B9A\u952E\u5DF2\u6709\u503C\u65F6\u7ACB\u5373\u91CD\u653E\uFF08\u540C\u65E0\u4E0A\u4E0B\u6587\u91CD\u8F7D\uFF09\u2014\u2014\u8FD9\u662F image \u7ED1\u5B9A\u8DE8\u6811\u91CD\u5EFA\u81EA\u52A8\u6062\u590D\u6700\u8FD1\u56FE\u503C\u7684\u673A\u5236\u3002\n    /// </summary>\n    internal static IDisposable RegisterBinding(Control control, string propertyName, string bindingKey,\n        string nodeId, DjuiLayoutSessionV6 session)\n    {\n        var apply = CreateBindingAction(propertyName, control,\n            string.Equals(propertyName, "image", StringComparison.Ordinal) ? new ImageBindingContext(session, nodeId) : null);\n        if (apply == null) return EmptyDisposable.Instance;\n        var registration = new Registration { Key = bindingKey, Control = control, Apply = apply };\n        if (!_bindings.TryGetValue(bindingKey, out var list)) _bindings[bindingKey] = list = new List<Registration>();\n        list.Add(registration);\n        if (_values.TryGetValue(bindingKey, out var value)) apply(value);\n        return registration;\n    }\n\n    private static Action<object?>? CreateBindingAction(string propertyName, Control control,\n        ImageBindingContext? imageContext = null)\n    {\n        return propertyName switch\n        {\n            "visible" => value => control.Visible = value is bool visible && visible,\n            "disabled" => value => DjuiButtonState.SetDisabled(control, value is bool disabled && disabled),\n            "text" when control is Label label => value => label.Text = value?.ToString() ?? "",\n            "value" when control is Progress progress => value =>\n            {\n                progress.Value = Convert.ToSingle(value ?? 0f);\n                DjuiProgressVisualLayerV6.NotifyValueChanged(progress);\n            },\n            // image \u7ED1\u5B9A\uFF1DSetImage \u540C\u4E00\u901A\u9053\uFF08SetImageCore\uFF09\uFF1A\u6A21\u578B\u5199\u5165\u3001\u514B\u9686\u5206\u6D41\u3001Progress \u6392\u9664\u3001\n            // Button \u72B6\u6001\u673A\u534F\u540C\u5168\u90E8\u81EA\u52A8\u7EE7\u627F\uFF1B\u7A7A\u503C\u5F52\u4E00\u4E3A\u64A4\u9500\u56FE\u7247\u3002\u65E0\u4E0A\u4E0B\u6587\uFF08\u7ED3\u6784\u6027\u8BEF\u7528\uFF09\u843D\u5165 _ => null \u9759\u9ED8\u65E0\u6548\u3002\n            "image" when imageContext != null => value => DjuiWindowManagerV6.SetImageCore(\n                imageContext.Session, imageContext.NodeId,\n                string.IsNullOrWhiteSpace(value?.ToString()) ? null : value.ToString()),\n            _ => null,\n        };\n    }\n\n    public static void Set<T>(string key, T value)\n    {\n        _values[key] = value;\n        if (!_bindings.TryGetValue(key, out var bindings)) return;\n        foreach (var registration in bindings.ToArray())\n        {\n            if (!registration.Control.IsValid) { registration.Dispose(); continue; }\n            try { registration.Apply(value); } catch (Exception ex) { Game.Logger.LogWarning(ex, "DJUI: \u7ED1\u5B9A {Key} \u66F4\u65B0\u5931\u8D25", key); }\n        }\n    }\n\n    public static T? Get<T>(string key) => _values.TryGetValue(key, out var value) && value is T typed ? typed : default;\n\n    private sealed class EmptyDisposable : IDisposable\n    {\n        public static readonly EmptyDisposable Instance = new();\n        public void Dispose() { }\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiEffectPlayer.cs
var DjuiEffectPlayer_default = "// DJUI Runtime - \u52A8\u6548\u64AD\u653E\u5668\uFF08\u5E27\u66F4\u65B0\u9A71\u52A8\uFF09\n\n#if CLIENT\n\nusing GameUI.Control;\nusing System.Numerics;\n\nnamespace DjuiRuntime;\n\n/// <summary>\n/// \u52A8\u6548\u64AD\u653E\u5668\uFF0C\u901A\u8FC7 IThinker \u5E27\u66F4\u65B0\u5904\u7406\u6301\u7EED\u52A8\u753B\u3002\n/// </summary>\npublic class DjuiEffectPlayer : IThinker\n{\n    private static readonly List<(Control ctrl, float phase, float speed)> _pulses = new();\n    private static DjuiEffectPlayer? _instance;\n\n    public bool DoesThink { get; set; } = true;\n\n    /// <summary>\n    /// \u542F\u52A8\u8109\u51B2\u7F29\u653E\u52A8\u753B\u3002\n    /// </summary>\n    public static void StartPulse(Control ctrl, float speed = 3f)\n    {\n        _pulses.Add((ctrl, 0f, speed));\n        EnsureRegistered();\n    }\n\n    public static void Stop(Control ctrl)\n    {\n        for (var i = _pulses.Count - 1; i >= 0; i--)\n            if (ReferenceEquals(_pulses[i].ctrl, ctrl)) _pulses.RemoveAt(i);\n    }\n\n    private static void EnsureRegistered()\n    {\n        if (_instance != null) return;\n        _instance = new DjuiEffectPlayer();\n        Game.RegisterThinker(_instance);\n    }\n\n    public void Think(int delta)\n    {\n        if (!Game.IsActive) return;\n\n        var dt = delta / 1000f;\n        for (int i = _pulses.Count - 1; i >= 0; i--)\n        {\n            var (ctrl, phase, speed) = _pulses[i];\n            if (!ctrl.IsValid) { _pulses.RemoveAt(i); continue; }\n            phase += dt * speed;\n            var pulse = 1f + 0.05f * MathF.Sin(phase);\n            ctrl.Scale = new Vector2(pulse, pulse);\n            _pulses[i] = (ctrl, phase, speed);\n        }\n    }\n}\n\n#endif\n";

// raw:D:\git\DJUI\runtime\DjuiEffectPresets.cs
var DjuiEffectPresets_default = '// DJUI Runtime - \u9884\u8BBE\u52A8\u6548\u6CE8\u518C\u8868\n// \u52A8\u6548\u7531 C# \u4EE3\u7801\u5B9A\u4E49\uFF0CWeb \u7AEF\u53EA\u505A\u9009\u62E9\n\n#if CLIENT\n\nusing GameUI.Control;\nusing GameUI.Control.Primitive;\nusing GameUI.Control.Behavior;\nusing GameCore.Animation.EasingFunction;\nusing GameUI.Control.Extensions;\nusing GameCore.Platform.SDL;\n\nnamespace DjuiRuntime;\n\n/// <summary>\n/// \u9884\u8BBE\u52A8\u6548\u6CE8\u518C\u8868\u3002Web \u7AEF\u901A\u8FC7\u6E05\u5355\u6587\u4EF6\u83B7\u53D6\u53EF\u9009\u9884\u8BBE\u3002\n/// \u65B0\u589E\u52A8\u6548\u5728\u6B64\u6CE8\u518C\u5373\u53EF\u3002\n/// </summary>\npublic static class DjuiEffectPresets\n{\n    private static readonly Dictionary<string, Action<Control>> _presets = new();\n\n    static DjuiEffectPresets()\n    {\n        Register("none", static _ => { });\n\n        // === \u6309\u538B\u53CD\u9988 ===\n        Register("press_scale_92", ctrl =>\n        {\n            ctrl.AddTouchBehavior(scaleFactor: 0.92f, enablePressAnimation: true, enableLongPress: false);\n        });\n\n        Register("press_scale_85_bounce", ctrl =>\n        {\n            var behavior = ctrl.AddTouchBehavior(scaleFactor: 0.85f);\n            behavior.PressAnimationEasing = new BounceEase();\n        });\n\n        // === \u60AC\u505C\u53CD\u9988 ===\n        Register("hover_scale_105", ctrl =>\n        {\n            ctrl.Hover(\n                onEnter: c => c.Scale = new System.Numerics.Vector2(1.05f, 1.05f),\n                onLeave: c => c.Scale = System.Numerics.Vector2.One\n            );\n        });\n\n        // === \u51FA\u73B0\u52A8\u753B ===\n        Register("fade_in", ctrl =>\n        {\n            ctrl.FadeIn(0.3f);\n        });\n\n        Register("fade_out", ctrl =>\n        {\n            ctrl.FadeOut(0.3f);\n        });\n\n        Register("scale_in", ctrl =>\n        {\n            ctrl.Animate(BuilderExtensions.AnimationType.ScaleIn, 0.3f);\n        });\n\n        // === \u6301\u7EED\u5FAA\u73AF\uFF08\u7B80\u5316\u7248\uFF0C\u5B9E\u9645\u9700\u8981 ticker\uFF09 ===\n        Register("loop_pulse", ctrl =>\n        {\n            DjuiEffectPlayer.StartPulse(ctrl);\n        });\n\n        // === \u7EC4\u5408\uFF1ANGUI \u6807\u51C6\u6309\u94AE ===\n        Register("button_default", ctrl =>\n        {\n            ctrl.AddTouchBehavior(scaleFactor: 0.92f, enablePressAnimation: true, enableLongPress: false);\n            ctrl.Hover(\n                onEnter: c => c.Scale = new System.Numerics.Vector2(1.05f, 1.05f),\n                onLeave: c => c.Scale = System.Numerics.Vector2.One\n            );\n        });\n    }\n\n    /// <summary>\n    /// \u6CE8\u518C\u65B0\u9884\u8BBE\u3002\u5F00\u53D1\u8005\u53EF\u5728\u5916\u90E8\u8C03\u7528\u6B64\u65B9\u6CD5\u6269\u5C55\u3002\n    /// </summary>\n    public static void Register(string name, Action<Control> factory)\n    {\n        _presets[name] = factory;\n    }\n\n    /// <summary>\n    /// \u5E94\u7528\u9884\u8BBE\u52A8\u6548\u5230\u63A7\u4EF6\u3002\n    /// </summary>\n    public static void Apply(string? presetName, Control ctrl)\n    {\n        if (string.IsNullOrEmpty(presetName)) return;\n\n        if (_presets.TryGetValue(presetName, out var factory))\n        {\n            factory(ctrl);\n        }\n        else\n        {\n            Game.Logger.LogWarning("DJUI: \u672A\u77E5\u52A8\u6548\u9884\u8BBE {Name}", presetName);\n        }\n    }\n}\n\n#endif\n';

// raw:D:\git\DJUI\runtime\DjuiFlowBorder.cs
var DjuiFlowBorder_default = '// DJUI Runtime - \u6D41\u5149\u8FB9\u6846\uFF08CanvasAnimated \u7A0B\u5E8F\u5316\u7ED8\u5236\uFF1A\u547C\u5438\u63CF\u8FB9\uFF0B\u7ED5\u6846\u6D41\u5149\u62D6\u5C3E\uFF09\r\n\r\n#if CLIENT\r\n\r\nusing GameUI.Control;\r\nusing GameUI.Control.Enum;\r\nusing GameUI.Control.Primitive;\r\nusing GameUI.Graphics;\r\n\r\nnamespace DjuiRuntime;\r\n\r\n/// <summary>\r\n/// \u6D41\u5149\u8FB9\u6846\u9AD8\u7EA7\u9009\u9879\uFF08\u9003\u751F\u53E3\uFF0C\u4E00\u822C\u7528\u4E0D\u5230\uFF09\uFF1A\u53EA\u5728\u9700\u8981\u8C03\u901F\u3001\u5E76\u5217\u63A7\u4EF6\u9519\u4F4D\u3001\u7279\u6B8A\u5706\u89D2\u6216"\u53EA\u547C\u5438\u6846"\u65F6\u4F7F\u7528\u3002\r\n/// </summary>\r\npublic sealed class DjuiFlowBorderOptions\r\n{\r\n    /// <summary>\u7ED5\u5708\u901F\u5EA6\uFF08\u5708/\u79D2\uFF0C\u9ED8\u8BA4 0.42\uFF1B\u8D1F\u503C\uFF1D\u9006\u65F6\u9488\uFF0C0\uFF1D\u5149\u70B9\u505C\u4F4F\u53EA\u547C\u5438\uFF09</summary>\r\n    public float Speed { get; set; } = 0.42f;\r\n\r\n    /// <summary>\u521D\u59CB\u76F8\u4F4D\u504F\u79FB\uFF080~1\uFF0C\u5468\u957F\u6BD4\u4F8B\uFF1B\u5E76\u5217\u63A7\u4EF6\u6D41\u5149\u9519\u4F4D\u7528\uFF0C\u5982 i * 0.23f\uFF09</summary>\r\n    public float PhaseOffset { get; set; } = 0f;\r\n\r\n    /// <summary>\u5706\u89D2\u534A\u5F84\uFF08px\uFF1Bnull\uFF1D\u81EA\u9002\u5E94 min(20, \u9AD8\xD70.3)\uFF0C0\uFF1D\u76F4\u89D2\uFF09</summary>\r\n    public float? Radius { get; set; } = null;\r\n\r\n    /// <summary>true\uFF1D\u53EA\u547C\u5438\u63CF\u8FB9\u6846\uFF0C\u4E0D\u8DD1\u6D41\u5149\uFF08\u5F15\u5BFC/\u63D0\u793A\u6001\u7528\uFF09</summary>\r\n    public bool BreathOnly { get; set; } = false;\r\n}\r\n\r\n/// <summary>\r\n/// \u6D41\u5149\u8FB9\u6846\uFF1A\u5F80\u4EFB\u610F Control \u6302\u4E00\u5757 CanvasAnimated\uFF0C\u6309\u5E27\u7A0B\u5E8F\u5316\u7ED8\u5236\u547C\u5438\u63CF\u8FB9\uFF0B\u4E09\u7EC4\u7ED5\u6846\u6D41\u5149\u62D6\u5C3E\u3002\r\n/// \u989C\u8272\u53EA\u4F20\u4E00\u4E2A\u4E3B\u8272\uFF0C\u6846\u4F53/\u62D6\u5C3E/\u5934\u90E8/\u8F89\u5149\u56DB\u8272\u7531\u4E3B\u8272 HSL \u81EA\u52A8\u63A8\u5BFC\uFF0C\u4FDD\u8BC1\u914D\u8272\u534F\u8C03\u3002\r\n/// \u65E0\u8D34\u56FE\u4F9D\u8D56\uFF1B\u51E0\u4F55\uFF08\u5706\u89D2\u8DEF\u5F84\u3001\u5300\u901F\u7ED5\u5708\uFF09\u7EAF\u6570\u5B66\u8BA1\u7B97\uFF0C\u63A7\u4EF6\u591A\u5927\u6846\u591A\u5927\u3002\r\n/// </summary>\r\npublic static class DjuiFlowBorder\r\n{\r\n    // \u5E38\u7528\u4E3B\u8272\u9884\u8BBE\uFF08\u53EF\u76F4\u63A5\u4F20\u7ED9 Attach\uFF1BGM \u914D\u8272\u8F6E\u9009\u5B9E\u673A\u62CD\u677F 2026-09-08\uFF09\r\n    public static readonly Color Gold = Color.FromArgb(255, 216, 158, 40);\r\n    public static readonly Color Purple = Color.FromArgb(255, 178, 108, 255);\r\n    public static readonly Color Blue = Color.FromArgb(255, 96, 160, 255);\r\n    public static readonly Color Cyan = Color.FromArgb(255, 64, 224, 208);\r\n    public static readonly Color Green = Color.FromArgb(255, 80, 220, 120);\r\n    public static readonly Color White = Color.FromArgb(255, 170, 200, 235);\r\n    public static readonly Color Orange = Color.FromArgb(255, 255, 130, 40);\r\n    public static readonly Color Red = Color.FromArgb(255, 240, 82, 82);\r\n\r\n    private sealed record Entry(CanvasAnimated Canvas, DjuiFlowBorderOptions Options);\r\n    private static readonly Dictionary<Control, Entry> _attached = new();\r\n\r\n    /// <summary>\u6302\u8F7D\u91D1\u8272\u6D41\u5149\uFF08\u9ED8\u8BA4\u6837\u5F0F\uFF0C\u6700\u5E38\u7528\uFF09\u3002\u76EE\u6807\u5931\u6548\u6216\u5BBD\u9AD8\u672A\u5B9A\uFF08\u22640\uFF09\u65F6\u8FD4\u56DE false\u3002</summary>\r\n    public static bool Attach(Control target) => Attach(target, Gold, null);\r\n\r\n    /// <summary>\u6302\u8F7D\u6307\u5B9A\u4E3B\u8272\u7684\u6D41\u5149\uFF1A\u6846/\u62D6\u5C3E/\u5934\u90E8/\u8F89\u5149\u56DB\u8272\u7531\u4E3B\u8272\u81EA\u52A8\u63A8\u5BFC\u3002</summary>\r\n    public static bool Attach(Control target, Color color) => Attach(target, color, null);\r\n\r\n    /// <summary>\u5B8C\u6574\u7248\uFF1A\u4E3B\u8272\uFF0B\u53EF\u9009\u5FAE\u8C03\u3002\u5E42\u7B49\uFF1A\u5DF2\u6302\u5219\u5148\u5378\u518D\u6302\uFF08\u6837\u5F0F\u70ED\u66F4\u65B0\uFF09\u3002</summary>\r\n    public static bool Attach(Control target, Color color, DjuiFlowBorderOptions? options)\r\n    {\r\n        if (target == null || !target.IsValid || target.Width <= 0 || target.Height <= 0) return false;\r\n        Detach(target);   // \u5E42\u7B49\uFF1D\u70ED\u66F4\u65B0\r\n\r\n        options ??= new DjuiFlowBorderOptions();\r\n        var palette = DerivePalette(color);\r\n        var canvas = new CanvasAnimated\r\n        {\r\n            Width = target.Width,\r\n            Height = target.Height,\r\n            ZIndex = 8,\r\n            HorizontalAlignment = HorizontalAlignment.Left,\r\n            VerticalAlignment = VerticalAlignment.Top,\r\n            Margin = new Thickness(0, 0, 0, 0),\r\n        };\r\n        canvas.OnAnimatedRender += (_, e) => Draw(canvas, e.TotalElapsedTimeInSeconds, palette, options);\r\n        target.AddChild(canvas);\r\n        canvas.StartTiming();\r\n        _attached[target] = new Entry(canvas, options);\r\n        return true;\r\n    }\r\n\r\n    /// <summary>\u5378\u8F7D\u5E76\u91CA\u653E\u753B\u5E03\uFF08\u5E42\u7B49\uFF1B\u76EE\u6807\u5DF2\u5931\u6548\u65F6\u9759\u9ED8\u6210\u529F\uFF09\u3002</summary>\r\n    public static void Detach(Control target)\r\n    {\r\n        if (target == null) return;\r\n        if (_attached.TryGetValue(target, out var e))\r\n        {\r\n            _attached.Remove(target);\r\n            if (e.Canvas.IsValid)\r\n            {\r\n                e.Canvas.RemoveFromVisualTreeAndParent();\r\n                e.Canvas.Dispose();\r\n            }\r\n        }\r\n    }\r\n\r\n    /// <summary>\u662F\u5426\u6302\u8F7D\u4E2D\u3002</summary>\r\n    public static bool IsAttached(Control target) => target != null && _attached.ContainsKey(target);\r\n\r\n    // ---------------- \u914D\u8272\u63A8\u5BFC\uFF08\u4E3B\u8272 \u2192 \u56DB\u8272\uFF09 ----------------\r\n\r\n    private sealed record Palette(Color Frame, Color Trail, Color Head, Color Glow);\r\n\r\n    private static Palette DerivePalette(Color primary)\r\n    {\r\n        var (h, s, l) = ToHsl(primary);\r\n        var glow = FromHsl(h, s, MathF.Min(0.75f, l + 0.12f));\r\n        var glowA = Color.FromArgb(150, glow.R, glow.G, glow.B);\r\n        return new Palette(\r\n            Frame: primary,\r\n            Trail: FromHsl(h, MathF.Min(1f, s * 0.9f), MathF.Min(0.85f, l + 0.27f)),\r\n            Head: FromHsl(h, MathF.Min(1f, s * 0.85f), 0.95f),   // \u540C\u8272\u7CFB\u9AD8\u4EAE\u8272\uFF08\u975E\u767D\uFF09\u2014\u2014\u4FDD\u6301\u8272\u7CFB\u7EDF\u4E00\r\n            Glow: glowA);\r\n    }\r\n\r\n    private static (float h, float s, float l) ToHsl(Color c)\r\n    {\r\n        var r = c.R / 255f; var g = c.G / 255f; var b = c.B / 255f;\r\n        var max = MathF.Max(r, MathF.Max(g, b)); var min = MathF.Min(r, MathF.Min(g, b));\r\n        var l = (max + min) / 2f;\r\n        if (max == min) return (0f, 0f, l);\r\n        var d = max - min;\r\n        var s = l > 0.5f ? d / (2f - max - min) : d / (max + min);\r\n        float h;\r\n        if (max == r) h = ((g - b) / d + (g < b ? 6f : 0f)) / 6f;\r\n        else if (max == g) h = ((b - r) / d + 2f) / 6f;\r\n        else h = ((r - g) / d + 4f) / 6f;\r\n        return (h, s, l);\r\n    }\r\n\r\n    private static Color FromHsl(float h, float s, float l)\r\n    {\r\n        if (s == 0f) return Color.FromArgb(255, (int)(l * 255f), (int)(l * 255f), (int)(l * 255f));\r\n        float q = l < 0.5f ? l * (1f + s) : l + s - l * s;\r\n        float p = 2f * l - q;\r\n        float f(float t)\r\n        {\r\n            if (t < 0f) t += 1f;\r\n            if (t > 1f) t -= 1f;\r\n            if (t < 1f / 6f) return p + (q - p) * 6f * t;\r\n            if (t < 1f / 2f) return q;\r\n            if (t < 2f / 3f) return p + (q - p) * (2f / 3f - t) * 6f;\r\n            return p;\r\n        }\r\n        return Color.FromArgb(255, (int)(f(h + 1f / 3f) * 255f), (int)(f(h) * 255f), (int)(f(h - 1f / 3f) * 255f));\r\n    }\r\n\r\n    // ---------------- \u7ED8\u5236\uFF08\u89C2\u611F\u53C2\u6570\u5185\u90E8\u56FA\u5B9A\uFF1A2026-09-07 Project_Movie \u4EFB\u52A1\u680F\u5B9E\u673A\u8C03\u4F18\u62CD\u677F\u503C\uFF09 ----------------\r\n\r\n    private static void Draw(Canvas canvas, float time, Palette p, DjuiFlowBorderOptions o)\r\n    {\r\n        const float inset = 4f;\r\n        var w = canvas.Width - inset * 2;\r\n        var h = canvas.Height - inset * 2;\r\n        var radius = o.Radius ?? MathF.Min(20f, MathF.Min(w, h) * 0.3f);\r\n        radius = MathF.Max(0f, MathF.Min(radius, MathF.Min(w, h) / 2f));   // wasm BCL \u65E0 MathF.Clamp\r\n\r\n        canvas.ResetState();\r\n        canvas.LineCap = LineCap.Round;\r\n        canvas.LineJoin = LineJoin.Round;\r\n\r\n        // \u547C\u5438\u63CF\u8FB9\u4E09\u5C42\uFF08\u91D1\u5C5E\u4EAE\u8FB9\u7ED3\u6784\uFF09\uFF1A\u5BBD\u8F89\u5149\u57AB\u5E95\uFF0B\u4E3B\u8272\u4E3B\u6846\uFF0B\u767D\u8272\u4E2D\u7EBF\r\n        var pulse = 0.5f + 0.5f * MathF.Sin(time * 2.4f);\r\n        canvas.Alpha = 0.85f + pulse * 0.15f;\r\n        canvas.StrokeWidth = 7f;\r\n        canvas.StrokePaint = p.Frame;\r\n        canvas.StrokeRoundedRectangle(inset, inset, w, h, radius);\r\n        canvas.Alpha = 1f;\r\n        canvas.StrokeWidth = 3f;\r\n        canvas.StrokePaint = p.Head;\r\n        canvas.StrokeRoundedRectangle(inset, inset, w, h, radius);\r\n\r\n        if (o.BreathOnly || o.Speed == 0f) return;\r\n\r\n        // \u4E09\u7EC4\u62D6\u5C3E\u6CBF\u6846\u7EBF\u4E2D\u7EBF\u8DD1\uFF08\u76F8\u4F4D\u9519\u5F00\uFF0C\u4E00\u5927\u4E24\u5C0F\uFF09\uFF0B\u5934\u90E8\u4EAE\u70B9\r\n        const float trailInset = inset + 2.5f;\r\n        var tw = canvas.Width - trailInset * 2;\r\n        var th = canvas.Height - trailInset * 2;\r\n        var tr = MathF.Max(0f, MathF.Min(radius - 1.5f, MathF.Min(tw, th) / 2f));\r\n        var basePhase = time * o.Speed + o.PhaseOffset;\r\n        DrawSnake(canvas, basePhase, trailInset, trailInset, tw, th, tr, p);\r\n    }\r\n\r\n    /// <summary>\r\n    /// \u874C\u86AA\u5149\u5E26\uFF08\u6C34\u6EF4\u5F62\uFF09\uFF1A\u4E00\u6761\u95ED\u5408\u8DEF\u5F84\u753B\u51FA\u6574\u4E2A\u5F62\u72B6\u2014\u2014\u5DE6\u53F3\u6CBF\u6E10\u7EC6\u6536\u62E2\u5230\u5C3E\u5C16\u3001\u5934\u7AEF\u534A\u5706\u5F27\u5C01\u53E3\uFF0C\r\n    /// \u586B\u5145\u4E0E\u63CF\u8FB9\u5171\u7528\u540C\u4E00\u8DEF\u5F84\uFF0C\u4E00\u4F53\u6210\u5F62\u65E0\u63A5\u7F1D\uFF1B\u5185\u82AF\u4E3A\u540C\u6784\u7F29\u7A84\u7684\u5C0F\u6C34\u6EF4\u3002\r\n    /// </summary>\r\n    private static void DrawSnake(Canvas canvas, float phase, float x, float y, float w, float h, float r, Palette p)\r\n    {\r\n        const float tailPx = 180f;   // \u62D6\u5C3E\u603B\u957F\uFF08px\uFF09\r\n        const int samples = 44;      // \u8F6E\u5ED3\u91C7\u6837\u70B9\u6570\r\n        const int capSteps = 10;     // \u5934\u90E8\u534A\u5706\u5C01\u53E3\u5F27\u91C7\u6837\u6570\r\n        var hw = w - 2 * r;\r\n        var vh = h - 2 * r;\r\n        var perimeter = 2 * (hw + vh) + 4 * (MathF.PI * r / 2f);\r\n        var stepPx = tailPx / samples;\r\n\r\n        var pts = new PointF[samples + 1];\r\n        for (var i = 0; i <= samples; i++)\r\n            pts[i] = RoundedPoint(Norm(phase - i * stepPx / perimeter), x, y, w, h, r);\r\n\r\n        // \u6CD5\u5411\uFF08\u5DE6\uFF09\u4E0E\u5207\u5411\uFF08\u6307\u5411\u5C3E\uFF09\r\n        (PointF n, PointF t) Frame(int i)\r\n        {\r\n            var prev = pts[Math.Max(0, i - 1)];\r\n            var next = pts[Math.Min(samples, i + 1)];\r\n            var dx = next.X - prev.X; var dy = next.Y - prev.Y;\r\n            var len = MathF.Max(0.0001f, MathF.Sqrt(dx * dx + dy * dy));\r\n            return (new PointF(-dy / len, dx / len), new PointF(dx / len, dy / len));\r\n        }\r\n\r\n        PathF Waterdrop(float headHalf)\r\n        {\r\n            float Half(float t) => headHalf * MathF.Pow(1f - t, 0.55f);   // \u9010\u6E10\u53D8\u5C0F\uFF0C\u5C3E\u5C16\u6536\u5230 0\r\n            var v = new List<PointF>(samples * 2 + capSteps);\r\n            for (var i = 0; i <= samples; i++)                    // \u5DE6\u6CBF\uFF1A\u5934\u2192\u5C3E\r\n            {\r\n                var t = i / (float)samples;\r\n                var (n, _) = Frame(i);\r\n                var half = Half(t);\r\n                v.Add(new PointF(pts[i].X + n.X * half, pts[i].Y + n.Y * half));\r\n            }\r\n            for (var i = samples - 1; i >= 0; i--)                // \u53F3\u6CBF\uFF1A\u5C3E\u2192\u5934\r\n            {\r\n                var t = i / (float)samples;\r\n                var (n, _) = Frame(i);\r\n                var half = Half(t);\r\n                v.Add(new PointF(pts[i].X - n.X * half, pts[i].Y - n.Y * half));\r\n            }\r\n            var (n0, t0) = Frame(0);                               // \u5934\u90E8\u534A\u5706\u5C01\u53E3\uFF1A\u53F3\u6CBF\u7AEF\u2192\u524D\u51F8\u2192\u5DE6\u6CBF\u7AEF\r\n            var r0 = Half(0);\r\n            for (var k = 1; k < capSteps; k++)\r\n            {\r\n                var a = MathF.PI * k / capSteps;\r\n                var dirX = -n0.X * MathF.Cos(a) - t0.X * MathF.Sin(a);   // -t0\uFF1D\u884C\u8FDB\u524D\u5411\r\n                var dirY = -n0.Y * MathF.Cos(a) - t0.Y * MathF.Sin(a);\r\n                v.Add(new PointF(pts[0].X + dirX * r0, pts[0].Y + dirY * r0));\r\n            }\r\n            // \u95ED\u5408\u4E8C\u6B21\u6837\u6761\uFF08\u4E2D\u70B9\u6CD5\uFF09\uFF1A\u9876\u70B9\u4E3A\u63A7\u5236\u70B9\u3001\u76F8\u90BB\u4E2D\u70B9\u4E3A\u951A\u70B9\u2014\u2014\u8FB9\u7F18\u5E73\u6ED1\u65E0\u952F\u9F7F\r\n            var \u9876\u70B9\u6570 = v.Count;\r\n            PointF Mid(PointF a, PointF b) => new((a.X + b.X) / 2f, (a.Y + b.Y) / 2f);\r\n            var path = new PathF();\r\n            path.MoveTo(Mid(v[\u9876\u70B9\u6570 - 1], v[0]));\r\n            for (var i = 0; i < \u9876\u70B9\u6570; i++)\r\n                path.QuadTo(v[i], Mid(v[i], v[(i + 1) % \u9876\u70B9\u6570]));\r\n            path.Close();\r\n            return path;\r\n        }\r\n\r\n        canvas.LineCap = LineCap.Round;\r\n        canvas.LineJoin = LineJoin.Round;\r\n\r\n        // \u4E3B\u4F53\u6C34\u6EF4\uFF1A\u540C\u4E00\u8DEF\u5F84\u5148\u586B\u5145\u540E\u63CF\u8FB9\uFF08\u63CF\u8FB9\u4E00\u534A\u538B\u5728\u586B\u5145\u8FB9\u4E0A\uFF0C\u65E0\u9732\u5E95\u7F1D\uFF09\r\n        var body = Waterdrop(7f);\r\n        canvas.Alpha = 1f;\r\n        canvas.FillPaint = new SolidPaint(p.Trail);\r\n        canvas.FillPath(body);\r\n        canvas.Alpha = 0.9f;\r\n        canvas.StrokeWidth = 1.6f;\r\n        canvas.StrokePaint = p.Head;\r\n        canvas.DrawPath(body);\r\n\r\n        // \u5185\u82AF\uFF1A\u540C\u6784\u7F29\u7A84\u7684\u5C0F\u6C34\u6EF4\uFF08\u7EAF\u8272\u9AD8\u4EAE\uFF0C\u4E0D\u63CF\u8FB9\uFF09\r\n        canvas.Alpha = 1f;\r\n        canvas.FillPaint = new SolidPaint(p.Head);\r\n        canvas.FillPath(Waterdrop(4f));\r\n    }\r\n\r\n    /// <summary>\u5706\u89D2\u77E9\u5F62\u8DEF\u5F84\u70B9\uFF1As\u2208[0,1) \u6CBF\u5468\u957F\u5300\u901F\uFF08\u76F4\u8FB9\uFF0B\u56DB\u6BB5 90\xB0 \u5706\u5F27\uFF09\uFF0C\u4ECE\u5DE6\u4E0A\u89D2\u5706\u5F27\u8D77\u70B9\u987A\u65F6\u9488\u3002</summary>\r\n    private static PointF RoundedPoint(float s, float x, float y, float w, float h, float r)\r\n    {\r\n        s = Norm(s);\r\n        var hw = w - 2 * r;\r\n        var vh = h - 2 * r;\r\n        var arc = MathF.PI * r / 2f;\r\n        var d = s * (2 * (hw + vh) + 4 * arc);   // \u6BB5\u5185\u6B63\u5411\u8FDB\u5EA6\uFF0C\u9010\u6BB5\u9012\u51CF\r\n\r\n        PointF ArcPt(float cx, float cy, float a0, float t) => new(\r\n            cx + r * MathF.Cos(a0 + t / arc * MathF.PI / 2f),\r\n            cy + r * MathF.Sin(a0 + t / arc * MathF.PI / 2f));\r\n\r\n        if (d < hw) return new PointF(x + r + d, y);\r\n        d -= hw;\r\n        if (d < arc) return ArcPt(x + w - r, y + r, -MathF.PI / 2f, d);\r\n        d -= arc;\r\n        if (d < vh) return new PointF(x + w, y + r + d);\r\n        d -= vh;\r\n        if (d < arc) return ArcPt(x + w - r, y + h - r, 0f, d);\r\n        d -= arc;\r\n        if (d < hw) return new PointF(x + w - r - d, y + h);\r\n        d -= hw;\r\n        if (d < arc) return ArcPt(x + r, y + h - r, MathF.PI / 2f, d);\r\n        d -= arc;\r\n        if (d < vh) return new PointF(x, y + h - r - d);\r\n        d -= vh;\r\n        return ArcPt(x + r, y + r, MathF.PI, d);\r\n    }\r\n\r\n    private static float Norm(float v) => v - MathF.Floor(v);\r\n}\r\n\r\n#endif\r\n';

// raw:D:\git\DJUI\runtime\DjuiLayoutArranger.cs
var DjuiLayoutArranger_default = `// DJUI Runtime - \u6392\u5217\u7B97\u6CD5\uFF08\u7EAF\u7B97\u6CD5\u7C7B\uFF0C\u96F6\u5F15\u64CE\u4F9D\u8D56\uFF09
// \u4E0E editor \u7AEF utils/layoutSolver.ts \u7684 arrangeChildren \u4FDD\u6301\u4E00\u81F4\uFF0C\u53CC\u7AEF\u8BED\u4E49\u6539\u52A8
// \uFF08clamp \u987A\u5E8F\u3001\u53D6\u6574\u65F6\u673A\u3001null \u5904\u7406\uFF09\u5FC5\u987B\u540C\u6B65\uFF0C\u5E76\u7528 .tmp/layout-cases.json \u5BF9\u62CD
// \u7528\u4F8B\u9A8C\u8BC1\uFF08\u5BB9\u5DEE 0.01\uFF09\uFF0C\u5426\u5219\u53CC\u7AEF\u7B97\u6CD5\u6F02\u79FB\u3002
//
// \u5750\u6807\u7EA6\u5B9A\uFF1A\u8F93\u51FA\u4E3A\u5BB9\u5668\u5C40\u90E8\u5750\u6807\uFF08\u5185\u5BB9\u533A = \u5BB9\u5668\u77E9\u5F62\u51CF\u56DB\u8FB9 padding\uFF0C\u987A\u5E8F [left, top, right, bottom]\uFF09\uFF0C
// \u8F93\u51FA\u4E0D\u53D6\u6574\uFF08\u53D6\u6574\u53EA\u5728\u7F16\u8F91\u5668\u70D8\u7119\u5199\u56DE transform \u65F6\u505A\uFF09\u3002
//
// \u672C\u6587\u4EF6\u7981\u6B62 using \u4EFB\u4F55\u5F15\u64CE\u547D\u540D\u7A7A\u95F4\uFF1A\u5FC5\u987B\u80FD\u4E0E DjuiModels.cs \u4E00\u8D77\u5728\u65E0\u5F15\u64CE\u73AF\u5883
// \uFF08.tmp/layoutparity \u5BF9\u62CD\u5DE5\u7A0B\uFF0Cnet9.0\uFF09\u7F16\u8BD1\u3002

using System;
using System.Collections.Generic;
using System.Linq;

namespace DjuiRuntime;

public static class DjuiLayoutArranger
{
    /// <summary>\u6392\u5217\u5B50\u9879\u8F93\u5165\u3002Name \u4E3A\u6392\u5E8F\u952E\uFF08null \u5F52\u4E00\u7A7A\u4E32\uFF0C\u6392\u6700\u524D\uFF09\uFF1B
    /// HGrow/VGrow \u4E3A\u5F39\u6027\u6BD4\u4F8B\uFF08= widthStretchRatio / heightStretchRatio\uFF09\uFF0C\u5217\u8868\u6A21\u5F0F\u5206\u4E3B\u8F74/\u4EA4\u53C9\u8F74\u7528\uFF0CGrid \u4E0D\u53C2\u4E0E\u3002</summary>
    public sealed class ArrangerItem
    {
        public string Id = "";
        public string? Name;
        public float Width;
        public float Height;
        public float HGrow;
        public float VGrow;
    }

    /// <summary>\u6392\u5217\u53C2\u6570\uFF08\u7F16\u8F91\u5668 DjuiLayout \u7684\u6241\u5E73\u6295\u5F71\uFF1Anull/\u7F3A\u7701\u7531\u8C03\u7528\u65B9\u5F52\u4E00\u4E3A\u9ED8\u8BA4\u503C\uFF09\u3002</summary>
    public sealed class ArrangerParams
    {
        public string Flow = "Vertical";           // Vertical | Horizontal | Grid
        public float SpacingH;                     // \u5B50\u9879\u6C34\u5E73\u95F4\u8DDD
        public float SpacingV;                     // \u5B50\u9879\u5782\u76F4\u95F4\u8DDD
        public float PadLeft;
        public float PadTop;
        public float PadRight;
        public float PadBottom;
        public string HAlign = "Left";             // Left | Center | Right | Stretch\uFF08Stretch=\u7EF4\u6301\u6491\u6EE1\u884C\u4E3A\uFF0C\u4E0D\u989D\u5916\u504F\u79FB\uFF09
        public string VAlign = "Top";              // Top | Center | Bottom | Stretch
        public string GridFlow = "Horizontal";     // Horizontal=\u6C34\u5E73\u4F18\u5148\uFF08\u6BCF\u884C N \u4E2A\u653E\u6EE1\u6362\u884C\uFF09| Vertical=\u5782\u76F4\u4F18\u5148\uFF08\u6BCF\u5217 N \u4E2A\u653E\u6EE1\u6362\u5217\uFF09
        public int GridCount = 1;                  // \u6BCF\u884C/\u6BCF\u5217\u4E2A\u6570 N\uFF08<1 \u7531\u7B97\u6CD5\u94B3\u5236\u4E3A 1\uFF09
        public string ChildOrder = "Default";      // Default=\u6587\u6863\u987A\u5E8F | ByName=\u6309\u540D\u79F0\u7801\u70B9\u5347\u5E8F\uFF08\u7A33\u5B9A\u6392\u5E8F\uFF09
    }

    public readonly record struct ArrangerRect(string Id, float X, float Y, float Width, float Height);

    /// <summary>
    /// \u7EAF\u6392\u5217\u7B97\u6CD5\uFF1A\u4E0D\u4F9D\u8D56\u8282\u70B9/\u63A7\u4EF6\u7ED3\u6784\uFF0C\u8F93\u5165\u5BB9\u5668\u5C3A\u5BF8 + \u6392\u5217\u53C2\u6570 + \u5B50\u9879\u5C3A\u5BF8\uFF0C\u8F93\u51FA\u5BB9\u5668\u5C40\u90E8\u5750\u6807\u77E9\u5F62\u3002
    /// a) \u6392\u5E8F\uFF1AChildOrder='ByName' \u65F6\u6309 Name \u7801\u70B9\u5347\u5E8F\u7A33\u5B9A\u6392\u5E8F\uFF08\u65E0\u540D\u9879\u5F52\u4E00\u7A7A\u4E32\u6392\u6700\u524D\uFF0C\u6BD4\u8F83\u76F8\u7B49\u4FDD\u6301\u6587\u6863\u5E8F\uFF1B
    ///    OrderBy(Ordinal) \u7A33\u5B9A\u6392\u5E8F\uFF0C\u7981 culture\u2014\u2014\u987B\u4E0E JS \u4FA7 sort \u6BD4\u8F83\u5668\u9010\u5B57\u4E00\u81F4\uFF09\uFF1BDefault=\u6587\u6863\u5E8F\u3002
    ///    \u6392\u5E8F\u53EA\u51B3\u5B9A\u6392\u5217\u4F4D\u7F6E\u7684\u8BA1\u7B97\u987A\u5E8F\uFF0C\u7981\u6B62\u6539\u52A8\u5B50\u9879\u96C6\u5408\u672C\u8EAB\u3002
    /// b) Vertical\uFF1A\u95F4\u8DDD SpacingV\uFF1BVGrow>0 \u5B50\u9879\u6309\u6BD4\u4F8B\u5206\u300C\u5185\u9AD8-\u603B\u95F4\u8DDD-\u56FA\u5B9A\u9AD8\u300D\u7684\u5269\u4F59\u9AD8\uFF0C\u56FA\u5B9A\u5B50\u9879\u53D6\u81EA\u8EAB\u9AD8\uFF1B
    ///    \u4EA4\u53C9\u8F74\u5BBD HGrow>0 \u65F6\u6491\u6EE1\u5185\u5BBD\u3002
    /// c) Horizontal\uFF1A\u4E0E b) \u5BF9\u79F0\uFF08SpacingH \u4E3B\u8F74\u3001HGrow \u5206\u5BBD\u3001VGrow>0 \u6491\u6EE1\u5185\u9AD8\uFF09\u3002
    /// d) Grid\uFF1AGridCount \u515C\u5E95 Math.Max(1, \xB7)\uFF0C\u4E25\u683C\u6309\u4E2A\u6570\u65AD\u884C/\u65AD\u5217\uFF08\u7EDD\u4E0D\u6309\u5BB9\u5668\u5BBD\u5EA6\u81EA\u52A8\u6362\u884C\uFF09\uFF1B
    ///    \u6C34\u5E73\u4F18\u5148=\u6BCF\u884C N \u4E2A\u653E\u6EE1\u6362\u884C\uFF0C\u884C\u9AD8=\u884C\u5185\u5B50\u9879\u6700\u5927\u9AD8\u3001\u884C\u5185\u9876\u5BF9\u9F50\uFF1B\u5782\u76F4\u4F18\u5148\u5BF9\u79F0\uFF08\u5217\u5BBD=\u5217\u5185\u6700\u5927\u5BBD\u3001
    ///    \u5217\u5185\u5DE6\u5BF9\u9F50\uFF09\uFF1B\u683C\u5B50\u5C3A\u5BF8=\u5B50\u9879\u81EA\u8EAB\u5C3A\u5BF8\uFF08\u4E0D\u8BBE\u7EDF\u4E00\u683C\u5BBD\u9AD8\uFF0CstretchRatio \u4E0D\u53C2\u4E0E\uFF09\u3002
    /// e) \u5185\u5BB9\u5BF9\u9F50\uFF1A\u5148\u6309\u8D34\u8D77\u70B9 (PadLeft, PadTop) \u6392\u51FA\u5185\u5BB9\u5757\u5305\u56F4\u76D2\uFF08\u542B spacing\uFF09\uFF0C\u518D\u6574\u4F53\u504F\u79FB\u2014\u2014
    ///    Center=max(0, (\u5185\u5C3A\u5BF8-\u5185\u5BB9\u5C3A\u5BF8)/2)\u3001Right/Bottom=max(0, \u5185\u5C3A\u5BF8-\u5185\u5BB9\u5C3A\u5BF8)\u3001Left/Top/Stretch=0\uFF1B
    ///    \u8D85\u51FA\u5185\u5BB9\u533A\u65F6\u8D34\u8D77\u70B9\u7167\u6392\u3001\u7EDD\u4E0D\u538B\u7F29\uFF08offset \u94B3 0\uFF09\uFF1BStretch=\u7EF4\u6301\u6491\u6EE1\u884C\u4E3A\uFF0C\u4E0D\u989D\u5916\u504F\u79FB\u3002
    /// </summary>
    public static List<ArrangerRect> Arrange(float containerW, float containerH, ArrangerParams p, List<ArrangerItem> items)
    {
        if (items == null || items.Count == 0) return new List<ArrangerRect>();

        // a) \u6392\u5E8F\uFF08OrderBy \u8FD4\u56DE\u65B0\u5E8F\u5217\uFF0C\u4E0D\u6539\u52A8\u8C03\u7528\u65B9\u5217\u8868\uFF09
        List<ArrangerItem> ordered = items;
        if (p.ChildOrder == "ByName")
            ordered = items.OrderBy(i => i.Name ?? string.Empty, StringComparer.Ordinal).ToList();

        var padLeft = p.PadLeft;
        var padTop = p.PadTop;
        var innerW = containerW - padLeft - p.PadRight;
        var innerH = containerH - padTop - p.PadBottom;

        var rects = new List<ArrangerRect>(ordered.Count);

        if (p.Flow == "Vertical")
        {
            // b) \u5782\u76F4\u5806\u53E0
            var spacing = p.SpacingV;
            var totalSpacing = spacing * (ordered.Count - 1);
            var availH = innerH - totalSpacing;

            // \u7B2C\u4E00\u904D\uFF1A\u7B97\u51FA\u56FA\u5B9A\u9AD8\u5EA6\u548C\u9700\u8981 flex \u7684
            var heights = new float[ordered.Count];
            var fixedH = 0f;
            var totalGrow = 0f;
            for (var i = 0; i < ordered.Count; i++)
            {
                var it = ordered[i];
                if (it.VGrow > 0)
                {
                    heights[i] = -1f; // \u5F85\u5B9A
                    totalGrow += it.VGrow;
                }
                else
                {
                    heights[i] = it.Height;
                    fixedH += it.Height;
                }
            }

            // \u5206\u914D flex \u7A7A\u95F4
            var freeH = Math.Max(0f, availH - fixedH);
            for (var i = 0; i < ordered.Count; i++)
            {
                if (heights[i] == -1f)
                    heights[i] = totalGrow > 0f ? freeH * ordered[i].VGrow / totalGrow : 0f;
            }

            // \u6392\u5217\uFF08\u8D34\u8D77\u70B9\uFF09
            var curY = padTop;
            for (var i = 0; i < ordered.Count; i++)
            {
                var it = ordered[i];
                var w = it.HGrow > 0f ? innerW : it.Width;
                rects.Add(new ArrangerRect(it.Id, padLeft, curY, w, heights[i]));
                curY += heights[i] + spacing;
            }
        }
        else if (p.Flow == "Horizontal")
        {
            // c) \u6C34\u5E73\u5806\u53E0\uFF08\u4E0E\u5782\u76F4\u5BF9\u79F0\uFF09
            var spacing = p.SpacingH;
            var totalSpacing = spacing * (ordered.Count - 1);
            var availW = innerW - totalSpacing;

            var widths = new float[ordered.Count];
            var fixedW = 0f;
            var totalGrow = 0f;
            for (var i = 0; i < ordered.Count; i++)
            {
                var it = ordered[i];
                if (it.HGrow > 0f)
                {
                    widths[i] = -1f; // \u5F85\u5B9A
                    totalGrow += it.HGrow;
                }
                else
                {
                    widths[i] = it.Width;
                    fixedW += it.Width;
                }
            }

            var freeW = Math.Max(0f, availW - fixedW);
            for (var i = 0; i < ordered.Count; i++)
            {
                if (widths[i] == -1f)
                    widths[i] = totalGrow > 0f ? freeW * ordered[i].HGrow / totalGrow : 0f;
            }

            var curX = padLeft;
            for (var i = 0; i < ordered.Count; i++)
            {
                var it = ordered[i];
                var h = it.VGrow > 0f ? innerH : it.Height;
                rects.Add(new ArrangerRect(it.Id, curX, padTop, widths[i], h));
                curX += widths[i] + spacing;
            }
        }
        else
        {
            // d) \u7F51\u683C
            var count = Math.Max(1, p.GridCount);
            if (p.GridFlow == "Vertical")
            {
                // \u5782\u76F4\u4F18\u5148\uFF1A\u6BCF count \u4E2A\u4E00\u5217\u653E\u6EE1\u6362\u5217\uFF1B\u5217\u5BBD=\u5217\u5185\u5B50\u9879\u6700\u5927\u5BBD\uFF0C\u5217\u5185\u5DE6\u5BF9\u9F50
                var colLeft = padLeft;
                for (var start = 0; start < ordered.Count; start += count)
                {
                    var end = Math.Min(start + count, ordered.Count);
                    var colW = 0f;
                    for (var i = start; i < end; i++) colW = Math.Max(colW, ordered[i].Width);
                    var curY = padTop;
                    for (var i = start; i < end; i++)
                    {
                        var it = ordered[i];
                        rects.Add(new ArrangerRect(it.Id, colLeft, curY, it.Width, it.Height));
                        curY += it.Height + p.SpacingV;
                    }
                    colLeft += colW + p.SpacingH;
                }
            }
            else
            {
                // \u6C34\u5E73\u4F18\u5148\uFF1A\u6BCF count \u4E2A\u4E00\u884C\u653E\u6EE1\u6362\u884C\uFF1B\u884C\u9AD8=\u884C\u5185\u5B50\u9879\u6700\u5927\u9AD8\uFF0C\u884C\u5185\u9876\u5BF9\u9F50
                var rowTop = padTop;
                for (var start = 0; start < ordered.Count; start += count)
                {
                    var end = Math.Min(start + count, ordered.Count);
                    var rowH = 0f;
                    for (var i = start; i < end; i++) rowH = Math.Max(rowH, ordered[i].Height);
                    var curX = padLeft;
                    for (var i = start; i < end; i++)
                    {
                        var it = ordered[i];
                        rects.Add(new ArrangerRect(it.Id, curX, rowTop, it.Width, it.Height));
                        curX += it.Width + p.SpacingH;
                    }
                    rowTop += rowH + p.SpacingV;
                }
            }
        }

        // e) \u5185\u5BB9\u5BF9\u9F50\uFF1A\u5185\u5BB9\u5757\u5305\u56F4\u76D2\uFF08\u76F8\u5BF9\u5185\u5BB9\u8D77\u70B9\uFF09\u2192 \u6574\u4F53\u504F\u79FB
        var contentW = 0f;
        var contentH = 0f;
        foreach (var r in rects)
        {
            contentW = Math.Max(contentW, r.X - padLeft + r.Width);
            contentH = Math.Max(contentH, r.Y - padTop + r.Height);
        }
        var offsetX = 0f;
        if (p.HAlign == "Center") offsetX = Math.Max(0f, (innerW - contentW) / 2f);
        else if (p.HAlign == "Right") offsetX = Math.Max(0f, innerW - contentW);
        var offsetY = 0f;
        if (p.VAlign == "Center") offsetY = Math.Max(0f, (innerH - contentH) / 2f);
        else if (p.VAlign == "Bottom") offsetY = Math.Max(0f, innerH - contentH);
        if (offsetX != 0f || offsetY != 0f)
        {
            for (var i = 0; i < rects.Count; i++)
                rects[i] = rects[i] with { X = rects[i].X + offsetX, Y = rects[i].Y + offsetY };
        }

        return rects;
    }
}
`;

// raw:D:\git\DJUI\runtime\DjuiLayoutSolver.cs
var DjuiLayoutSolver_default = '// DJUI Runtime - \u5E03\u5C40\u89E3\u6790\u5F15\u64CE\uFF08NGUI \u98CE\u683C\uFF1A\u951A\u70B9\u7BA1\u4F4D\u7F6E\uFF0C\u62C9\u4F38\u7BA1\u5927\u5C0F\uFF09\n// \u4E0E editor \u7AEF utils/layoutSolver.ts \u4FDD\u6301\u4E00\u81F4\n//\n// anchor.side (9-way) \u2192 \u51B3\u5B9A\u63A7\u4EF6\u4F4D\u7F6E\u57FA\u51C6\n// stretch.style (None/H/V/Both) \u2192 \u51B3\u5B9A\u63A7\u4EF6\u5C3A\u5BF8\u662F\u5426\u8DDF\u968F\u7236\u7EA7\n// aspectRatio \u2192 \u6BD4\u4F8B\u7EA6\u675F\uFF08\u6700\u540E\u5E94\u7528\uFF09\n\nusing System;\nusing System.Collections.Generic;\n\nnamespace DjuiRuntime;\n\n/// <summary>\n/// \u5E03\u5C40\u6C42\u89E3\u7ED3\u679C\n/// </summary>\npublic readonly struct SolvedRect\n{\n    public readonly float X;\n    public readonly float Y;\n    public readonly float Width;\n    public readonly float Height;\n\n    public SolvedRect(float x, float y, float w, float h)\n    {\n        X = x; Y = y; Width = w; Height = h;\n    }\n}\n\n/// <summary>\n/// \u5E03\u5C40\u89E3\u6790\u5F15\u64CE\u3002\u5BF9\u5E94 editor \u7AEF utils/layoutSolver.ts\u3002\n/// </summary>\npublic static class DjuiLayoutSolver\n{\n    // \u9ED8\u8BA4\u503C\n    private static readonly Vec2Json DefaultPivot = new() { X = 0.5f, Y = 0.5f };\n    private const string DefaultSide = "TopLeft";\n\n    // 9-way \u951A\u70B9\u8868\uFF1Aid \u2192 (nx, ny)\n    // nx: 0=\u5DE6 0.5=\u4E2D 1=\u53F3\n    // ny: uGUI Y \u671D\u4E0A\uFF080=\u5E95 0.5=\u4E2D 1=\u9876\uFF09\n    private static readonly Dictionary<string, (float nx, float ny)> AnchorSides = new()\n    {\n        { "TopLeft",     (0f,    1f)    },\n        { "Top",         (0.5f,  1f)    },\n        { "TopRight",    (1f,    1f)    },\n        { "Left",        (0f,    0.5f)  },\n        { "Center",      (0.5f,  0.5f)  },\n        { "Right",       (1f,    0.5f)  },\n        { "BottomLeft",  (0f,    0f)    },\n        { "Bottom",      (0.5f,  0f)    },\n        { "BottomRight", (1f,    0f)    },\n    };\n\n    /// <summary>\n    /// \u89E3\u6790\u5355\u4E2A\u8282\u70B9\u7684\u6700\u7EC8\u5C4F\u5E55\u77E9\u5F62\u3002\n    /// </summary>\n    public static SolvedRect Solve(\n        DjuiNodeJson node,\n        float parentX, float parentY,\n        float parentWidth, float parentHeight,\n        float screenWidth, float screenHeight,\n        HashSet<string>? measuring = null)\n    {\n        measuring ??= new HashSet<string>();\n\n        var t = node.Transform;\n        var anchor = node.Anchor;\n        var stretch = node.Stretch;\n        var ar = node.AspectRatio;\n\n        var target = anchor?.Target ?? "parent";\n        var sideId = anchor?.Side ?? DefaultSide;\n        var pivot = t?.Pivot ?? DefaultPivot;\n        var stretchStyle = stretch?.Style ?? "None";\n\n        // 1. \u53C2\u8003\u77E9\u5F62\n        float refX, refY, refW, refH;\n        if (target == "screen")\n        {\n            refX = 0; refY = 0; refW = screenWidth; refH = screenHeight;\n        }\n        else\n        {\n            refX = parentX; refY = parentY; refW = parentWidth; refH = parentHeight;\n        }\n\n        // 2. \u83B7\u53D6 9-way \u951A\u70B9\u5750\u6807\n        float nx = 0f, ny = 1f; // \u9ED8\u8BA4 TopLeft\n        if (sideId != null && AnchorSides.TryGetValue(sideId, out var side))\n        {\n            nx = side.nx;\n            ny = side.ny;\n        }\n\n        // \u951A\u70B9\u4F4D\u7F6E\uFF08\u5C4F\u5E55\u5750\u6807\uFF09\n        float anchorX = refX + nx * refW;\n        float anchorY = refY + (1 - ny) * refH;\n\n        // 3. \u62C9\u4F38\u8FB9\u8DDD\n        float ml = stretch?.Margins?.Left ?? 0;\n        float mr = stretch?.Margins?.Right ?? 0;\n        float mt = stretch?.Margins?.Top ?? 0;\n        float mb = stretch?.Margins?.Bottom ?? 0;\n\n        bool hStretch = stretchStyle == "Horizontal" || stretchStyle == "Both";\n        bool vStretch = stretchStyle == "Vertical" || stretchStyle == "Both";\n\n        float x, y, w, h;\n\n        // === \u65E0\u951A\u70B9\uFF1A\u7EAF\u7EDD\u5BF9\u5B9A\u4F4D\uFF08\u4E0E editor \u4E00\u81F4\uFF09===\n        if (sideId == "None" || target == "none")\n        {\n            x = t?.X ?? 0;\n            y = t?.Y ?? 0;\n            w = t?.Width ?? 100;\n            h = t?.Height ?? 100;\n            // \u62C9\u4F38\u4ECD\u751F\u6548\uFF08\u57FA\u4E8E\u53C2\u8003\u77E9\u5F62\uFF09\n            if (hStretch)\n            {\n                w = Math.Max(0, refW - ml - mr);\n                x = refX + ml;\n            }\n            if (vStretch)\n            {\n                h = Math.Max(0, refH - mt - mb);\n                y = refY + mt;\n            }\n        }\n        else\n        {\n            // --- \u6C34\u5E73\u8F74 ---\n            if (hStretch)\n            {\n                w = Math.Max(0, refW - ml - mr);\n                x = refX + ml;\n            }\n            else\n            {\n                w = t?.Width ?? 100;\n                x = anchorX + (t?.X ?? 0) - nx * w;\n            }\n\n            // --- \u5782\u76F4\u8F74 ---\n            if (vStretch)\n            {\n                h = Math.Max(0, refH - mt - mb);\n                y = refY + mt;\n            }\n            else\n            {\n                h = t?.Height ?? 100;\n                y = anchorY + (t?.Y ?? 0) - (1 - ny) * h;\n            }\n        }\n\n        // 5. \u5E94\u7528 AspectRatio\n        if (ar != null && !string.IsNullOrEmpty(ar.Mode) && ar.Mode != "None")\n        {\n            float ratio = ar.Ratio ?? 1;\n            if (ratio > 0)\n            {\n                switch (ar.Mode)\n                {\n                    case "WidthControlsHeight":\n                    {\n                        float newH = w / ratio;\n                        float cy = y + pivot.Y * h;\n                        y = cy - pivot.Y * newH;\n                        h = newH;\n                        break;\n                    }\n                    case "HeightControlsWidth":\n                    {\n                        float newW = h * ratio;\n                        float cx = x + pivot.X * w;\n                        x = cx - pivot.X * newW;\n                        w = newW;\n                        break;\n                    }\n                    case "FitInParent":\n                    {\n                        float scaleW = refW / w;\n                        float scaleH = refH / h;\n                        float s = Math.Min(scaleW, scaleH);\n                        float newW = w * s;\n                        float newH = h * s;\n                        float cx = refX + pivot.X * refW;\n                        float cy = refY + pivot.Y * refH;\n                        x = cx - pivot.X * newW;\n                        y = cy - pivot.Y * newH;\n                        w = newW; h = newH;\n                        break;\n                    }\n                    case "EnvelopeParent":\n                    {\n                        float scaleW = refW / w;\n                        float scaleH = refH / h;\n                        float s = Math.Max(scaleW, scaleH);\n                        float newW = w * s;\n                        float newH = h * s;\n                        float cx = refX + pivot.X * refW;\n                        float cy = refY + pivot.Y * refH;\n                        x = cx - pivot.X * newW;\n                        y = cy - pivot.Y * newH;\n                        w = newW; h = newH;\n                        break;\n                    }\n                }\n            }\n        }\n\n        return ApplyAutoSize(\n            node,\n            new SolvedRect(x, y, w, h),\n            screenWidth,\n            screenHeight,\n            sideId ?? DefaultSide,\n            target,\n            nx,\n            ny,\n            hStretch,\n            vStretch,\n            measuring);\n    }\n\n    private static SolvedRect ApplyAutoSize(\n        DjuiNodeJson node,\n        SolvedRect baseRect,\n        float screenWidth,\n        float screenHeight,\n        string sideId,\n        string target,\n        float sideNx,\n        float sideNy,\n        bool hStretch,\n        bool vStretch,\n        HashSet<string> measuring)\n    {\n        bool autoWidth = UsesAutoWidth(node);\n        bool autoHeight = UsesAutoHeight(node);\n        if (!autoWidth && !autoHeight) return baseRect;\n\n        if (measuring.Contains(node.Id)) return baseRect;\n\n        bool blockedWidth = false;\n        bool blockedHeight = false;\n        string widthReason = "";\n        string heightReason = "";\n\n        if (autoWidth && hStretch)\n        {\n            blockedWidth = true;\n            widthReason = "\u81EA\u8EAB\u6C34\u5E73\u62C9\u4F38\u4F1A\u8986\u76D6\u81EA\u52A8\u5BBD";\n        }\n        if (autoHeight && vStretch)\n        {\n            blockedHeight = true;\n            heightReason = "\u81EA\u8EAB\u5782\u76F4\u62C9\u4F38\u4F1A\u8986\u76D6\u81EA\u52A8\u9AD8";\n        }\n\n        foreach (var child in node.Children)\n        {\n            if (child.Basic?.Visible == false) continue;\n\n            if (autoWidth && !blockedWidth && GetChildAutoSizeConflict(child, true, out var reason))\n            {\n                blockedWidth = true;\n                widthReason = $"{child.Id}: {reason}";\n            }\n            if (autoHeight && !blockedHeight && GetChildAutoSizeConflict(child, false, out reason))\n            {\n                blockedHeight = true;\n                heightReason = $"{child.Id}: {reason}";\n            }\n        }\n\n        if (autoWidth && blockedWidth)\n            Game.Logger.LogWarning("DJUI: \u8282\u70B9 {Id} \u81EA\u52A8\u5BBD\u56DE\u9000\u5230\u57FA\u51C6\u5BBD\uFF1A{Reason}", node.Id, widthReason);\n        if (autoHeight && blockedHeight)\n            Game.Logger.LogWarning("DJUI: \u8282\u70B9 {Id} \u81EA\u52A8\u9AD8\u56DE\u9000\u5230\u57FA\u51C6\u9AD8\uFF1A{Reason}", node.Id, heightReason);\n\n        if ((autoWidth && !blockedWidth) || (autoHeight && !blockedHeight))\n        {\n            measuring.Add(node.Id);\n        }\n        else\n        {\n            return baseRect;\n        }\n\n        try\n        {\n            if (!MeasureChildrenBounds(node, baseRect, screenWidth, screenHeight, measuring, out var measuredWidth, out var measuredHeight))\n                return baseRect;\n\n            var nextWidth = baseRect.Width;\n            var nextHeight = baseRect.Height;\n\n            if (autoWidth && !blockedWidth)\n                nextWidth = Math.Max(1, measuredWidth);\n            if (autoHeight && !blockedHeight)\n                nextHeight = Math.Max(1, measuredHeight);\n\n            var nextX = baseRect.X;\n            var nextY = baseRect.Y;\n            if (sideId != "None" && target != "none")\n            {\n                nextX -= sideNx * (nextWidth - baseRect.Width);\n                nextY -= (1 - sideNy) * (nextHeight - baseRect.Height);\n            }\n\n            return new SolvedRect(nextX, nextY, nextWidth, nextHeight);\n        }\n        finally\n        {\n            measuring.Remove(node.Id);\n        }\n    }\n\n    private static bool MeasureChildrenBounds(\n        DjuiNodeJson node,\n        SolvedRect containerRect,\n        float screenWidth,\n        float screenHeight,\n        HashSet<string> measuring,\n        out float measuredWidth,\n        out float measuredHeight)\n    {\n        measuredWidth = containerRect.Width;\n        measuredHeight = containerRect.Height;\n\n        bool hasBounds = false;\n        float maxRight = 0;\n        float maxBottom = 0;\n\n        foreach (var child in node.Children)\n        {\n            if (child.Basic?.Visible == false) continue;\n\n            var childSolved = Solve(\n                child,\n                containerRect.X,\n                containerRect.Y,\n                containerRect.Width,\n                containerRect.Height,\n                screenWidth,\n                screenHeight,\n                measuring);\n\n            var localRight = childSolved.X - containerRect.X + childSolved.Width;\n            var localBottom = childSolved.Y - containerRect.Y + childSolved.Height;\n            if (!IsFinite(localRight) || !IsFinite(localBottom)) continue;\n\n            maxRight = Math.Max(maxRight, localRight);\n            maxBottom = Math.Max(maxBottom, localBottom);\n            hasBounds = true;\n        }\n\n        if (!hasBounds) return false;\n\n        var padding = node.Layout?.Padding;\n        var paddingRight = padding != null && padding.Length >= 3 ? padding[2] : 0;\n        var paddingBottom = padding != null && padding.Length >= 4 ? padding[3] : 0;\n\n        measuredWidth = MathF.Ceiling(Math.Max(0, maxRight + paddingRight));\n        measuredHeight = MathF.Ceiling(Math.Max(0, maxBottom + paddingBottom));\n        return true;\n    }\n\n    public static bool ShouldUseNativeAutoWidth(DjuiNodeJson node)\n    {\n        return UsesAutoWidth(node) && HasVisibleChildren(node) && !HasAutoSizeConflict(node, true);\n    }\n\n    public static bool ShouldUseNativeAutoHeight(DjuiNodeJson node)\n    {\n        return UsesAutoHeight(node) && HasVisibleChildren(node) && !HasAutoSizeConflict(node, false);\n    }\n\n    private static bool UsesAutoWidth(DjuiNodeJson node)\n    {\n        var mode = node.Layout?.AutoSize;\n        return mode == "Width" || mode == "Both";\n    }\n\n    private static bool UsesAutoHeight(DjuiNodeJson node)\n    {\n        var mode = node.Layout?.AutoSize;\n        return mode == "Height" || mode == "Both";\n    }\n\n    private static bool GetChildAutoSizeConflict(DjuiNodeJson child, bool widthAxis, out string reason)\n    {\n        var anchor = child.Anchor;\n        var target = anchor?.Target ?? "parent";\n        var sideId = anchor?.Side ?? DefaultSide;\n        var stretchStyle = child.Stretch?.Style ?? "None";\n\n        if (target == "screen")\n        {\n            reason = "\u951A\u5B9A\u5230\u5C4F\u5E55\uFF0C\u5C3A\u5BF8\u4E0D\u5C5E\u4E8E\u7236\u5BB9\u5668\u5185\u5BB9\u6D41";\n            return true;\n        }\n\n        if (StretchUsesAxis(stretchStyle, widthAxis))\n        {\n            reason = widthAxis ? "\u6C34\u5E73\u62C9\u4F38\u4F9D\u8D56\u7236\u5BBD" : "\u5782\u76F4\u62C9\u4F38\u4F9D\u8D56\u7236\u9AD8";\n            return true;\n        }\n\n        if (sideId == "None" || target == "none")\n        {\n            reason = "";\n            return false;\n        }\n\n        if (!AnchorSides.TryGetValue(sideId, out var side))\n        {\n            reason = "";\n            return false;\n        }\n\n        if (widthAxis && Math.Abs(side.nx) > 0.001f)\n        {\n            reason = "\u6C34\u5E73\u4E2D/\u53F3\u951A\u70B9\u4F9D\u8D56\u7236\u5BBD";\n            return true;\n        }\n\n        if (!widthAxis && Math.Abs(side.ny - 1f) > 0.001f)\n        {\n            reason = "\u5782\u76F4\u4E2D/\u5E95\u951A\u70B9\u4F9D\u8D56\u7236\u9AD8";\n            return true;\n        }\n\n        reason = "";\n        return false;\n    }\n\n    private static bool StretchUsesAxis(string? style, bool widthAxis)\n    {\n        if (widthAxis) return style == "Horizontal" || style == "Both";\n        return style == "Vertical" || style == "Both";\n    }\n\n    private static bool HasVisibleChildren(DjuiNodeJson node)\n    {\n        foreach (var child in node.Children)\n        {\n            if (child.Basic?.Visible != false) return true;\n        }\n        return false;\n    }\n\n    private static bool HasAutoSizeConflict(DjuiNodeJson node, bool widthAxis)\n    {\n        var stretchStyle = node.Stretch?.Style ?? "None";\n        if (StretchUsesAxis(stretchStyle, widthAxis)) return true;\n\n        foreach (var child in node.Children)\n        {\n            if (child.Basic?.Visible == false) continue;\n            if (GetChildAutoSizeConflict(child, widthAxis, out _)) return true;\n        }\n\n        return false;\n    }\n\n    private static bool IsFinite(float value)\n    {\n        return !float.IsNaN(value) && !float.IsInfinity(value);\n    }\n}\n';

// raw:D:\git\DJUI\runtime\DjuiCanvasV6.cs
var DjuiCanvasV6_default = '// DJUI Runtime - pure protocol v6 canvas and top-down layout math\nusing System;\nusing System.Collections.Generic;\nusing System.IO;\nusing System.Text.Json.Serialization;\n\nnamespace DjuiRuntime;\n\npublic readonly struct DjuiRectV6\n{\n    public readonly float X, Y, Width, Height;\n    public DjuiRectV6(float x, float y, float width, float height) { X = x; Y = y; Width = width; Height = height; }\n}\n\npublic struct DjuiInsetsV6\n{\n    [JsonPropertyName("left")] public float Left { get; set; }\n    [JsonPropertyName("top")] public float Top { get; set; }\n    [JsonPropertyName("right")] public float Right { get; set; }\n    [JsonPropertyName("bottom")] public float Bottom { get; set; }\n    public DjuiInsetsV6(float left, float top, float right, float bottom) { Left = left; Top = top; Right = right; Bottom = bottom; }\n}\n\npublic sealed class DjuiCanvasPlanV6\n{\n    public float Scale { get; init; }\n    public DjuiRectV6 CanvasRect { get; init; }\n    public DjuiRectV6 ReferenceRect { get; init; }\n    public DjuiRectV6 SafeRect { get; init; }\n    public bool Wide { get; init; }\n}\n\npublic static class DjuiCanvasV6\n{\n    public static DjuiCanvasPlanV6 CreatePlan(float viewportWidth, float viewportHeight, DjuiInsetsV6 physicalSafeInsets, DjuiProjectV6 project)\n    {\n        float vw = Math.Max(1, viewportWidth), vh = Math.Max(1, viewportHeight);\n        float rw = Math.Max(1, project.Canvas.ReferenceWidth), rh = Math.Max(1, project.Canvas.ReferenceHeight);\n        float scale = CanvasScale(project.Canvas.Mode, vw, vh, rw, rh);\n        var canvas = new DjuiRectV6(0, 0, vw / scale, vh / scale);\n        var reference = new DjuiRectV6((canvas.Width - rw) * 0.5f, (canvas.Height - rh) * 0.5f, rw, rh);\n        var safe = Inset(canvas, new DjuiInsetsV6(physicalSafeInsets.Left / scale, physicalSafeInsets.Top / scale, physicalSafeInsets.Right / scale, physicalSafeInsets.Bottom / scale));\n        // \u5BBD\u5C4F\u6863\u5224\u5B9A\u5FC5\u987B\u65B9\u5411\u611F\u77E5\uFF1A\u53EA\u6709\u7269\u7406\u5BBD > \u9AD8 \u4E14\u6BD4\u503C\u8FBE\u5230\u9608\u503C\u624D\u7B97 wide\uFF0C\u7AD6\u5C4F\uFF08\u542B\u6298\u53E0\u5C4F\u5185\u5C4F\uFF09\u4E0D\u8FDB wide \u6863\n        bool wide = vw / vh >= project.Responsive.WideRatio;\n        return new DjuiCanvasPlanV6 { Scale = scale, CanvasRect = canvas, ReferenceRect = reference, SafeRect = safe, Wide = wide };\n    }\n\n    /// <summary>\n    /// \u5F15\u64CE\u5DF2\u7ECF\u8C03\u7528 SetDesignResolution \u540E\uFF0CSize \u4E0E SafeZonePadding \u90FD\u662F\u903B\u8F91\u5750\u6807\u3002\n    /// \u6B64\u5165\u53E3\u76F4\u63A5\u4F7F\u7528\u8BE5\u5750\u6807\uFF0C\u4E0D\u518D\u91CD\u590D\u7F29\u653E\u3002\n    /// </summary>\n    public static DjuiCanvasPlanV6 CreateLogicalPlan(float logicalWidth, float logicalHeight, DjuiInsetsV6 logicalSafeInsets, float physicalWidth, float physicalHeight, DjuiProjectV6 project)\n    {\n        float width = Math.Max(1, logicalWidth), height = Math.Max(1, logicalHeight);\n        float rw = Math.Max(1, project.Canvas.ReferenceWidth), rh = Math.Max(1, project.Canvas.ReferenceHeight);\n        var canvas = new DjuiRectV6(0, 0, width, height);\n        var reference = new DjuiRectV6((width - rw) * 0.5f, (height - rh) * 0.5f, rw, rh);\n        var safe = Inset(canvas, logicalSafeInsets);\n        float pw = Math.Max(1, physicalWidth), ph = Math.Max(1, physicalHeight);\n        return new DjuiCanvasPlanV6\n        {\n            Scale = 1,\n            CanvasRect = canvas,\n            ReferenceRect = reference,\n            SafeRect = safe,\n            // \u65B9\u5411\u611F\u77E5\uFF1A\u7269\u7406\u6A2A\u5411\u6BD4\u503C\u8FBE\u9608\u503C\u624D\u7B97 wide\uFF0C\u7AD6\u5C4F\u4E0D\u8FDB wide \u6863\n            Wide = pw / ph >= project.Responsive.WideRatio,\n        };\n    }\n\n    public static float CanvasScale(string mode, float vw, float vh, float rw, float rh)\n    {\n        vw = Math.Max(1, vw); vh = Math.Max(1, vh); rw = Math.Max(1, rw); rh = Math.Max(1, rh);\n        if (mode == "MatchWidth") return vw / rw;\n        if (mode == "MatchHeight") return vh / rh;\n        return Math.Min(vw / rw, vh / rh);\n    }\n\n    public static DjuiRectV6 Inset(DjuiRectV6 rect, DjuiInsetsV6 insets)\n    {\n        float l = Math.Max(0, insets.Left), t = Math.Max(0, insets.Top), r = Math.Max(0, insets.Right), b = Math.Max(0, insets.Bottom);\n        return new DjuiRectV6(rect.X + l, rect.Y + t, Math.Max(0, rect.Width - l - r), Math.Max(0, rect.Height - t - b));\n    }\n\n    public static DjuiRectV6 SelectSafeEdges(DjuiRectV6 canvas, DjuiRectV6 safe, IList<string>? edges)\n    {\n        bool all = edges == null;\n        bool l = all || edges!.Contains("left"), t = all || edges!.Contains("top"), r = all || edges!.Contains("right"), b = all || edges!.Contains("bottom");\n        return Inset(canvas, new DjuiInsetsV6(l ? safe.X - canvas.X : 0, t ? safe.Y - canvas.Y : 0, r ? canvas.X + canvas.Width - safe.X - safe.Width : 0, b ? canvas.Y + canvas.Height - safe.Y - safe.Height : 0));\n    }\n}\n\npublic static class DjuiLayoutSolverV6\n{\n    public static Dictionary<string, DjuiRectV6> SolveV6(DjuiPageV6 page, DjuiCanvasPlanV6 plan, Dictionary<string, float>? sceneScales = null)\n    {\n        var solved = new Dictionary<string, DjuiRectV6>();\n        solved[page.Root.Id] = new DjuiRectV6(0, 0, plan.CanvasRect.Width, plan.CanvasRect.Height); // root is local to the window host\n        // \u56FE\u5E27\u951A\u5B9A,\u573A\u666F\u753B\u677F\u4F18\u5148\u663E\u5F0F\u58F0\u660E backgroundId\uFF1B\u65E7\u9875\u9762\u624D\u517C\u5BB9\u56DE\u9000\u5230\n        // \u6839\u4E0B\u7B2C\u4E00\u4E2A stretch Both + image \u8282\u70B9\u3002\u4E0D\u8981\u518D\u8BA9\u65B0\u9875\u9762\u4F9D\u8D56\u8282\u70B9\u987A\u5E8F\u3002\n        DjuiRectV6? imageFrame = null;\n        string? backgroundId = null;\n        foreach (var child in page.Root.Children)\n            if (!string.IsNullOrWhiteSpace(child.SceneFrame?.BackgroundId)) { backgroundId = child.SceneFrame.BackgroundId; break; }\n        foreach (var child in page.Root.Children)\n        {\n            var ap = child.Appearance;\n            var st = child.Stretch;\n            bool both = st?.Style == "Both";\n            bool hasImage = !string.IsNullOrEmpty(ap?.Image);\n            if (both && hasImage && (backgroundId == null || child.Id == backgroundId)) { imageFrame = ComputeImageFrame(solved: default, child, plan); break; }\n        }\n        foreach (var child in page.Root.Children) SolveTree(child, plan.CanvasRect, plan, solved, imageFrame, null, null, sceneScales);\n        return solved;\n    }\n\n    /// <summary>cover/contain \u540E\u56FE\u7247\u5728\u5BBF\u4E3B\u77E9\u5F62\u5185\u7684\u53EF\u89C1\u5E27(\u951A\u70B9\u6309 focal,\u9ED8\u8BA4\u5C45\u4E2D)\u3002</summary>\n    private static DjuiRectV6 ComputeImageFrame(DjuiRectV6 solved, DjuiNodeV6 host, DjuiCanvasPlanV6 plan)\n    {\n        var rect = SolveV6(host, plan.CanvasRect, plan);\n        var ap = host.Appearance;\n        float sw = ap?.SourceSize?.Width ?? 0, sh = ap?.SourceSize?.Height ?? 0;\n        if (sw <= 0 || sh <= 0) return rect;\n        float fx = Math.Clamp(ap?.FocalX ?? 0.5f, 0, 1), fy = Math.Clamp(ap?.FocalY ?? 0.5f, 0, 1);\n        string fit = ap?.ImageFit ?? "stretch";\n        if (fit == "contain")\n        {\n            float scale = Math.Min(rect.Width / sw, rect.Height / sh);\n            float w = sw * scale, h = sh * scale;\n            return new DjuiRectV6(rect.X + (rect.Width - w) * fx, rect.Y + (rect.Height - h) * fy, w, h);\n        }\n        // cover(\u9ED8\u8BA4\u6309 cover \u5904\u7406):\u56FE\u7F29\u653E\u94FA\u6EE1\u5BBF\u4E3B,\u53EF\u89C1\u5E27=\u5BBF\u4E3B\u5C3A\u5BF8,\u4F46\u5750\u6807\u7CFB\u53D6\u300C\u56FE\u5185\u5BB9\u5BF9\u9F50\u300D\u2014\n        // \u5BF9\u951A\u5B9A\u8BED\u4E49\u800C\u8A00,\u53EF\u89C1\u5E27\u5C31\u662F\u5BBF\u4E3B\u77E9\u5F62\u672C\u8EAB;\u5EFA\u7B51\u8981\u9489\u5728\u56FE\u4E0A,\u9700\u8981\u7684\u662F\u56FE\u7684\u5B8C\u6574\u7F29\u653E\u6846:\n        float scaleC = Math.Max(rect.Width / sw, rect.Height / sh);\n        float fw = sw * scaleC, fh = sh * scaleC;\n        return new DjuiRectV6(rect.X + (rect.Width - fw) * fx, rect.Y + (rect.Height - fh) * fy, fw, fh);\n    }\n\n    public static DjuiRectV6 SolveV6(DjuiNodeV6 node, DjuiRectV6 parent, DjuiCanvasPlanV6 plan, DjuiRectV6? imageFrame = null)\n    {\n        var a = node.Anchor; var t = node.Transform; var s = node.Stretch; var ar = node.AspectRatio;\n        string side = a?.Side ?? "TopLeft";\n        DjuiRectV6 reference = a?.Target == "screen" ? plan.CanvasRect : a?.Target == "safe" ? DjuiCanvasV6.SelectSafeEdges(plan.CanvasRect, plan.SafeRect, a.SafeEdges) : a?.Target == "image" ? (imageFrame ?? plan.CanvasRect) : parent;\n        float x, y, w = t?.Width ?? 100, h = t?.Height ?? 100;\n        bool hs = s?.Style == "Horizontal" || s?.Style == "Both", vs = s?.Style == "Vertical" || s?.Style == "Both";\n        var m = s?.Margins; float ml = m?.Left ?? 0, mt = m?.Top ?? 0, mr = m?.Right ?? 0, mb = m?.Bottom ?? 0;\n        Side(side, out float nx, out float ny);\n        // side=None \u8BED\u4E49:\u7236\u5BB9\u5668\u5C40\u90E8\u5750\u6807(\u4E0E\u7F16\u8F91\u5668 layoutSolver \u4E00\u81F4)\u3002\n        // \u66FE\u7ECF\u76F4\u63A5\u7528 t.X \u5F53\u53C2\u8003\u7CFB\u7EDD\u5BF9\u503C,\u7236\u5BB9\u5668\u88AB Center \u7B49\u951A\u5B9A\u4F4D\u540E\u5B50\u8282\u70B9\u6574\u4F53\u504F\u79FB\u3002\n        if (side == "None") { x = reference.X + (t?.X ?? 0); y = reference.Y + (t?.Y ?? 0); }\n        else { x = reference.X + nx * reference.Width + (t?.X ?? 0) - nx * w; y = reference.Y + ny * reference.Height + (t?.Y ?? 0) - ny * h; }\n        if (hs) { x = reference.X + ml; w = Math.Max(0, reference.Width - ml - mr); }\n        if (vs) { y = reference.Y + mt; h = Math.Max(0, reference.Height - mt - mb); }\n        if (ar != null && ar.Ratio > 0 && ar.Mode != "None")\n        {\n            if (ar.Mode == "WidthControlsHeight") { var next = w / ar.Ratio; y += (h - next) * 0.5f; h = next; }\n            else if (ar.Mode == "HeightControlsWidth") { var next = h * ar.Ratio; x += (w - next) * 0.5f; w = next; }\n            else if (ar.Mode == "FitInParent") { float scale = Math.Min(reference.Width / Math.Max(1, w), reference.Height / Math.Max(1, h)); w *= scale; h *= scale; x = reference.X + (reference.Width - w) * 0.5f; y = reference.Y + (reference.Height - h) * 0.5f; }\n        }\n        return new DjuiRectV6(x, y, w, h);\n    }\n\n    private readonly struct SceneSpace\n    {\n        public readonly DjuiRectV6 Frame;\n        public readonly float ScaleX, ScaleY;\n        public SceneSpace(DjuiRectV6 frame, DjuiSizeV6 artboard)\n        {\n            Frame = frame;\n            ScaleX = frame.Width / artboard.Width;\n            ScaleY = frame.Height / artboard.Height;\n        }\n        public DjuiRectV6 Map(DjuiRectV6 authored) => new(\n            Frame.X + authored.X * ScaleX,\n            Frame.Y + authored.Y * ScaleY,\n            authored.Width * ScaleX,\n            authored.Height * ScaleY);\n    }\n\n    private static void SolveTree(\n        DjuiNodeV6 node,\n        DjuiRectV6 parent,\n        DjuiCanvasPlanV6 plan,\n        Dictionary<string, DjuiRectV6> output,\n        DjuiRectV6? imageFrame = null,\n        SceneSpace? sceneSpace = null,\n        DjuiRectV6? sceneParent = null,\n        Dictionary<string, float>? sceneScales = null)\n    {\n        DjuiRectV6 rect;\n        DjuiRectV6 authoredRect = default;\n        if (sceneSpace != null)\n        {\n            string target = node.Anchor?.Target ?? "parent";\n            if (target != "parent")\n                throw new InvalidDataException($"DJUI v6: \u573A\u666F\u753B\u677F\u5185\u8282\u70B9 {node.Id} \u53EA\u80FD\u4F7F\u7528 parent \u951A\u70B9");\n            authoredRect = SolveV6(node, sceneParent ?? default, plan);\n            rect = sceneSpace.Value.Map(authoredRect);\n            // \u573A\u666F\u753B\u677F\u5185\u8282\u70B9\u7684\u5B57\u53F7/\u63CF\u8FB9\u9700\u8865\u4E58\u753B\u677F\u7F29\u653E\uFF1A\u7F16\u8F91\u5668\u753B\u5E03\u5BF9\u753B\u677F\u5B50\u6811\u662F\u6574\u7EC4\u7F29\u653E\uFF08\u5B57\u53F7\u8DDF\u968F\uFF09\uFF0C\n            // \u5F15\u64CE\u53EA\u6620\u5C04\u63A7\u4EF6\u77E9\u5F62\uFF0CFontSize \u4E0D\u4E58\u4F1A\u5BFC\u81F4\u573A\u666F\u9875\u6587\u5B57\u76F8\u5BF9\u63A7\u4EF6\u5C0F artboard\u2192\u80CC\u666F\u5E27\u4E00\u500D\u591A\u3002\n            // rect \u5DF2\u662F\u5168\u5C40\u7CFB\uFF0CScaleX \u5373\u300Cartboard \u5C40\u90E8\u503C \u2192 \u5168\u5C40\u300D\u603B\u7F29\u653E\uFF08\u5D4C\u5957\u753B\u677F\u5929\u7136\u7D2F\u8BA1\uFF09\u3002\n            sceneScales?.Add(node.Id, sceneSpace.Value.ScaleX);\n        }\n        else\n        {\n            rect = SolveV6(node, parent, plan, imageFrame);\n        }\n        output[node.Id] = rect;\n        var frame = node.SceneFrame;\n        if (frame?.Artboard is { Width: > 0, Height: > 0 })\n        {\n            var nextSpace = new SceneSpace(rect, frame.Artboard);\n            var authoredRoot = new DjuiRectV6(0, 0, frame.Artboard.Width, frame.Artboard.Height);\n            foreach (var child in node.Children) SolveTree(child, rect, plan, output, imageFrame, nextSpace, authoredRoot, sceneScales);\n            return;\n        }\n        foreach (var child in node.Children)\n            SolveTree(child, rect, plan, output, imageFrame, sceneSpace, sceneSpace != null ? authoredRect : null, sceneScales);\n    }\n\n\n    private static void Side(string side, out float x, out float y)\n    {\n        x = side == "Top" || side == "Center" || side == "Bottom" ? 0.5f : side == "TopRight" || side == "Right" || side == "BottomRight" ? 1 : 0;\n        y = side == "Left" || side == "Center" || side == "Right" ? 0.5f : side == "BottomLeft" || side == "Bottom" || side == "BottomRight" ? 1 : 0;\n    }\n}\n';

// raw:D:\git\DJUI\runtime\DjuiLayoutSessionV6.cs
var DjuiLayoutSessionV6_default = '#if CLIENT\r\n\r\nusing System.Runtime.CompilerServices;\r\nusing GameUI.Control;\r\nusing GameUI.Device;\r\nusing GameUI.Enum;\r\nusing GameUI.Struct;\r\n\r\nnamespace DjuiRuntime;\r\n\r\n/// <summary>\r\n/// v6 \u7A97\u53E3\u5B9E\u4F8B\u7684\u6301\u4E45\u5E03\u5C40\u4F1A\u8BDD\u3002\u63A7\u4EF6\u6811\u53EA\u6784\u5EFA\u4E00\u6B21\uFF0C\u89C6\u53E3\u53D8\u5316\u65F6\u539F\u5730\u5E94\u7528\u65B0\u77E9\u5F62\u3002\r\n/// </summary>\r\npublic sealed class DjuiLayoutSessionV6 : IDisposable\r\n{\r\n    private readonly ScreenViewport _viewport;\r\n    private readonly DjuiProjectV6 _project;\r\n    private readonly DjuiPageV6 _page;\r\n    private readonly Dictionary<string, Control> _controls = new();\r\n    // Control \u2192 \u8282\u70B9\u5B9E\u4F8B id \u53CD\u67E5\u8868\uFF08\u4E0E _controls \u540C\u6B65\u7EF4\u62A4\uFF09\uFF1ASetImage(Control) \u76F4\u63A7\u53E3\u5F84\u7684\u5BFB\u5740\u4F9D\u636E\r\n    private readonly Dictionary<Control, string> _controlIds = new();\r\n    // \u5BBD\u5C4F override \u51B2\u7A81\u544A\u8B66\u53BB\u91CD\uFF08\u540C\u8282\u70B9\u53EA\u63D0\u9192\u4E00\u6B21\uFF0C\u5148\u4F8B\uFF1ADjuiImageVisualLayerV6._warnedMissingSourceSize\uFF09\r\n    private readonly HashSet<string> _warnedImageOverride = new(StringComparer.Ordinal);\r\n    private readonly HashSet<string> _warnedTintOverride = new(StringComparer.Ordinal);\r\n    // Control \u2192 \u6240\u5C5E\u4F1A\u8BDD\u7684\u8FDB\u7A0B\u7EA7\u5F31\u8868\uFF1A\u63A7\u4EF6 Dispose \u540E\u6761\u76EE\u81EA\u52A8\u6D88\u5931\uFF0C\u65E0\u6CC4\u6F0F\uFF08\u5148\u4F8B\uFF1ADjuiButtonStateRegistryV6.States\uFF09\r\n    private static readonly ConditionalWeakTable<Control, DjuiLayoutSessionV6> OwnerIndex = new();\r\n    private Action<DjuiNodeV6, Control, float>? _nodeUpdater;\r\n    private readonly Action<int, int> _sizeChanged;\r\n    private readonly Action<DisplayOrientations> _orientationChanged;\r\n    private readonly Action<float> _dprChanged;\r\n    private bool _disposed;\r\n\r\n    public string WindowInstanceId { get; }\r\n    public IReadOnlyDictionary<string, Control> Controls => _controls;\r\n    /// <summary>\u6301\u6709\u672C\u4F1A\u8BDD\u7684\u6811\u5B9E\u4F8B\uFF08DjuiTreeBuilderV6.Build \u6536\u5C3E\u8D4B\u503C\uFF1B\u5EFA\u6811\u671F\u5185\u4E3A null\uFF09\u3002\r\n    /// SetImage \u8FD0\u884C\u671F\u53D6 ImageVisuals/ButtonStates \u5237\u65B0 visual \u7528\u3002</summary>\r\n    internal DjuiTreeInstanceV6? Owner { get; set; }\r\n    public DjuiCanvasPlanV6 CurrentPlan { get; private set; }\r\n    public DjuiPageV6 CurrentPage { get; private set; }\r\n    // \u8F6C\u573A\u5728\u89E3\u7B97\u524D\u64A4\u9500\u4E34\u65F6\u51E0\u4F55\uFF0C\u89E3\u7B97\u540E\u4EE5\u65B0\u5E03\u5C40\u7EE7\u7EED\u540C\u4E00\u65F6\u95F4\u8FDB\u5EA6\uFF1B\u4E0D\u91CD\u5EFA\u6811\u3002\r\n    internal event Action? BeforeRelayout;\r\n    internal event Action? AfterRelayout;\r\n\r\n    public DjuiLayoutSessionV6(string windowInstanceId, DjuiProjectV6 project, DjuiPageV6 page, ScreenViewport? viewport = null)\r\n    {\r\n        if (string.IsNullOrWhiteSpace(windowInstanceId)) throw new ArgumentException("\u7A97\u53E3\u5B9E\u4F8B ID \u4E0D\u80FD\u4E3A\u7A7A", nameof(windowInstanceId));\r\n        WindowInstanceId = windowInstanceId;\r\n        _project = project ?? throw new ArgumentNullException(nameof(project));\r\n        _page = page ?? throw new ArgumentNullException(nameof(page));\r\n        _viewport = viewport ?? DeviceInfo.PrimaryViewport;\r\n        CurrentPlan = CreateCurrentPlan();\r\n        CurrentPage = DjuiResponsiveResolverV6.Resolve(_page, CurrentPlan.Wide);\r\n        _sizeChanged = (_, _) => Relayout();\r\n        _orientationChanged = _ => Relayout();\r\n        _dprChanged = _ => Relayout();\r\n        _viewport.OnSizeChanged += _sizeChanged;\r\n        _viewport.OnOrientationChanged += _orientationChanged;\r\n        _viewport.OnDevicePixelRatioChanged += _dprChanged;\r\n    }\r\n\r\n    public void Register(string nodeInstanceId, Control control)\r\n    {\r\n        ObjectDisposedException.ThrowIf(_disposed, this);\r\n        if (string.IsNullOrWhiteSpace(nodeInstanceId)) throw new ArgumentException("\u8282\u70B9\u5B9E\u4F8B ID \u4E0D\u80FD\u4E3A\u7A7A", nameof(nodeInstanceId));\r\n        if (!_controls.TryAdd(nodeInstanceId, control)) throw new InvalidOperationException($"DJUI v6: \u5B9E\u4F8B {WindowInstanceId} \u5185\u8282\u70B9 ID \u91CD\u590D: {nodeInstanceId}");\r\n        // authored \u4E0E\u514B\u9686\u4F53\u7684\u552F\u4E00\u767B\u8BB0\u53E3\u90FD\u5728\u8FD9\u91CC\u2014\u2014\u53CD\u67E5\u8868\u4E0E\u5F31\u8868\u4E00\u6B21\u6027\u5168\u8986\u76D6\u4E24\u7C7B\u63A7\u4EF6\r\n        _controlIds[control] = nodeInstanceId;\r\n        OwnerIndex.AddOrUpdate(control, this);\r\n    }\r\n\r\n    /// <summary>\u6309 Control \u5F15\u7528\u53CD\u67E5\u6240\u5C5E\u5E03\u5C40\u4F1A\u8BDD\uFF08\u975E DJUI \u7BA1\u7406\u7684\u63A7\u4EF6\u8FD4\u56DE null\uFF09\u3002</summary>\r\n    internal static DjuiLayoutSessionV6? FindOwner(Control control)\r\n        => OwnerIndex.TryGetValue(control, out var session) ? session : null;\r\n\r\n    /// <summary>\u6309 Control \u5F15\u7528\u53CD\u67E5\u8282\u70B9\u5B9E\u4F8B id\uFF08\u672A\u767B\u8BB0\u8FD4\u56DE null\uFF09\u3002</summary>\r\n    internal string? FindNodeId(Control control)\r\n        => _controlIds.TryGetValue(control, out var id) ? id : null;\r\n\r\n    /// <summary>\r\n    /// SetImage / image \u7ED1\u5B9A\u901A\u9053\u7684\u6A21\u578B\u5199\u5165\u70B9\uFF1A\u540C\u6B65\u66F4\u65B0\u4F1A\u8BDD\u6E90\u6811 _page \u4E0E\u5F53\u524D\u89E3\u6790\u89C6\u56FE CurrentPage \u7684\r\n    /// appearance.Image\u2014\u2014relayout \u91CD\u653E\uFF08ApplyNodeFields \u2192 imageVisuals.Apply / ApplyButton\uFF09\u4EE5\u8FD9\u4E24\u68F5\u6811\u4E3A\r\n    /// \u552F\u4E00\u6570\u636E\u6E90\uFF0C\u5199\u5728\u8FD9\u91CC\u624D\u80FD\u6D3B\u8FC7\u4EFB\u610F\u6B21\u91CD\u653E\uFF08\u5BBD\u5C4F\u6DF1\u62F7\u8D1D\u6001\u4E5F\u56E0\u5199\u7A7F _page \u800C\u5B58\u6D3B\uFF09\u3002\r\n    /// \u7A7A\u4E32/void \u7EDF\u4E00\u5F52\u4E00\u4E3A null\u3002\u8FD4\u56DE\u8282\u70B9\u662F\u5426\u5728 authored \u6811\u4E2D\uFF08\u514B\u9686 id \u4E0D\u5728\uFF0C\u8FD4\u56DE false\uFF09\u3002\r\n    /// </summary>\r\n    internal bool UpdateAuthoredImage(string nodeInstanceId, string? image)\r\n    {\r\n        var normalized = string.IsNullOrWhiteSpace(image) ? null : image;\r\n        // \u5BBD\u5C4F override \u51B2\u7A81\u68C0\u6D4B\uFF1A\u8BE5\u8282\u70B9\u58F0\u660E\u4E86 responsive.wide.overrides \u7684 "appearance.image" \u65F6\uFF0C\r\n        // \u5BBD\u5C4F\u5C42\u6BCF\u6B21 Resolve \u90FD\u4F1A\u628A authored \u5BBD\u5C4F\u56FE\u76D6\u56DE\u6765\uFF0C\u5199\u5165\u65E0\u6548\u2014\u2014\u544A\u8B66\u4E00\u6B21\u5E76\u63D0\u793A\u66FF\u4EE3\u65B9\u6848\r\n        if (_warnedImageOverride.Add(nodeInstanceId)\r\n            && _page.Responsive?.Wide.Overrides.TryGetValue(nodeInstanceId, out var fields) == true\r\n            && fields.ContainsKey("appearance.image"))\r\n        {\r\n            Game.Logger.LogWarning("DJUI v6: \u8282\u70B9 {Node} \u58F0\u660E\u4E86\u5BBD\u5C4F\u8986\u76D6 appearance.image\uFF0C\u5BBD\u5C4F\u6001 SetImage \u6362\u56FE\u4E0D\u751F\u6548\uFF08\u8BF7\u6539\u7528\u53CC\u8282\u70B9\u6CD5\u6216\u53BB\u6389\u8BE5\u8986\u76D6\uFF09", nodeInstanceId);\r\n        }\r\n        var node = FindNodeIn(_page.Root, nodeInstanceId);\r\n        if (node == null) return false;\r\n        node.Appearance ??= new DjuiAppearanceV6();\r\n        node.Appearance.Image = normalized;\r\n        // \u5BBD\u5C4F\u526F\u672C\u6001\uFF08CurrentPage \u662F _page \u7684\u6DF1\u62F7\u8D1D\uFF09\uFF1A\u4E24\u68F5\u6811\u90FD\u5199\uFF0C\u5F53\u524D\u663E\u793A\u7ACB\u5373\u4E00\u81F4\uFF0C\u65E0\u9700\u5F3A\u5236 Relayout\r\n        if (!ReferenceEquals(CurrentPage, _page))\r\n        {\r\n            var viewNode = FindNodeIn(CurrentPage.Root, nodeInstanceId);\r\n            if (viewNode != null)\r\n            {\r\n                viewNode.Appearance ??= new DjuiAppearanceV6();\r\n                viewNode.Appearance.Image = normalized;\r\n            }\r\n        }\r\n        return true;\r\n    }\r\n\r\n    /// <summary>\r\n    /// SetTint \u7684\u6A21\u578B\u5199\u5165\u70B9\uFF08\u4E0E UpdateAuthoredImage \u540C\u6784\uFF09\uFF1A\u5199\u7A7F _page \u4E0E CurrentPage \u4E24\u68F5\u6811\u7684\r\n    /// appearance.ImageTint\uFF0Crelayout \u91CD\u653E\u65F6\u7531 imageVisuals.Apply / progressVisuals.Apply \u6D88\u8D39\u3002\r\n    /// \u7A7A\u4E32\u7EDF\u4E00\u5F52\u4E00\u4E3A null\uFF08\u64A4\u9500\u67D3\u8272\uFF09\u3002\u8FD4\u56DE\u8282\u70B9\u662F\u5426\u5728 authored \u6811\u4E2D\u3002\r\n    /// </summary>\r\n    internal bool UpdateAuthoredTint(string nodeInstanceId, string? tint)\r\n    {\r\n        var normalized = string.IsNullOrWhiteSpace(tint) ? null : tint;\r\n        if (_warnedTintOverride.Add(nodeInstanceId)\r\n            && _page.Responsive?.Wide.Overrides.TryGetValue(nodeInstanceId, out var fields) == true\r\n            && fields.ContainsKey("appearance.imageTint"))\r\n        {\r\n            Game.Logger.LogWarning("DJUI v6: \u8282\u70B9 {Node} \u58F0\u660E\u4E86\u5BBD\u5C4F\u8986\u76D6 appearance.imageTint\uFF0C\u5BBD\u5C4F\u6001 SetTint \u67D3\u8272\u4E0D\u751F\u6548\uFF08\u8BF7\u6539\u7528\u53CC\u8282\u70B9\u6CD5\u6216\u53BB\u6389\u8BE5\u8986\u76D6\uFF09", nodeInstanceId);\r\n        }\r\n        var node = FindNodeIn(_page.Root, nodeInstanceId);\r\n        if (node == null) return false;\r\n        node.Appearance ??= new DjuiAppearanceV6();\r\n        node.Appearance.ImageTint = normalized;\r\n        if (!ReferenceEquals(CurrentPage, _page))\r\n        {\r\n            var viewNode = FindNodeIn(CurrentPage.Root, nodeInstanceId);\r\n            if (viewNode != null)\r\n            {\r\n                viewNode.Appearance ??= new DjuiAppearanceV6();\r\n                viewNode.Appearance.ImageTint = normalized;\r\n            }\r\n        }\r\n        return true;\r\n    }\r\n\r\n    private static DjuiNodeV6? FindNodeIn(DjuiNodeV6 node, string id)\r\n    {\r\n        if (string.Equals(node.Id, id, StringComparison.Ordinal)) return node;\r\n        foreach (var child in node.Children)\r\n        {\r\n            var hit = FindNodeIn(child, id);\r\n            if (hit != null) return hit;\r\n        }\r\n        return null;\r\n    }\r\n\r\n    /// <summary>\u6CE8\u518C\u8282\u70B9\u5B57\u6BB5\u66F4\u65B0\u5668\uFF08relayout \u65F6\u9010\u8282\u70B9\u56DE\u8C03\uFF09\u3002\u7B2C\u4E09\u53C2\u4E3A\u573A\u666F\u753B\u677F\u7D2F\u8BA1\u7F29\u653E\r\n    /// \uFF08sceneFrame \u5B50\u6811\u5185 artboard\u2192\u80CC\u666F\u5E27\u7684\u6620\u5C04\u6BD4\u4F8B\uFF0C\u753B\u677F\u5916\u6052\u4E3A 1\uFF09\u2014\u2014\u5B57\u53F7/\u63CF\u8FB9\u7B49"\u975E\u77E9\u5F62\u5C5E\u6027"\u9700\u81EA\u884C\u8865\u4E58\u3002</summary>\r\n    public void SetNodeUpdater(Action<DjuiNodeV6, Control, float> updater)\r\n    {\r\n        ObjectDisposedException.ThrowIf(_disposed, this);\r\n        _nodeUpdater = updater ?? throw new ArgumentNullException(nameof(updater));\r\n    }\r\n\r\n    public T? GetControl<T>(string nodeInstanceId) where T : Control\r\n    {\r\n        return _controls.TryGetValue(nodeInstanceId, out var control) ? control as T : null;\r\n    }\r\n\r\n    public void Relayout()\r\n    {\r\n        ObjectDisposedException.ThrowIf(_disposed, this);\r\n        BeforeRelayout?.Invoke();\r\n        CurrentPlan = CreateCurrentPlan();\r\n        CurrentPage = DjuiResponsiveResolverV6.Resolve(_page, CurrentPlan.Wide);\r\n        var nodes = new Dictionary<string, DjuiNodeV6>(StringComparer.Ordinal);\r\n        IndexNodes(CurrentPage.Root, nodes);\r\n        var sceneScales = new Dictionary<string, float>();\r\n        var solved = DjuiLayoutSolverV6.SolveV6(CurrentPage, CurrentPlan, sceneScales);\r\n        var parents = new Dictionary<string, string?>(StringComparer.Ordinal);\r\n        IndexParents(CurrentPage.Root, null, parents);\r\n        foreach (var (nodeId, rect) in solved)\r\n        {\r\n            if (!_controls.TryGetValue(nodeId, out var control)) continue;\r\n            var localRect = rect;\r\n            if (parents.TryGetValue(nodeId, out var parentId) && parentId != null && solved.TryGetValue(parentId, out var parentRect))\r\n                localRect = new DjuiRectV6(rect.X - parentRect.X, rect.Y - parentRect.Y, rect.Width, rect.Height);\r\n            ApplyRect(control, localRect);\r\n            if (_nodeUpdater != null && nodes.TryGetValue(nodeId, out var node))\r\n                _nodeUpdater(node, control, sceneScales.TryGetValue(nodeId, out var sceneScale) ? sceneScale : 1f);\r\n        }\r\n        AfterRelayout?.Invoke();\r\n    }\r\n\r\n    private static void IndexNodes(DjuiNodeV6 node, Dictionary<string, DjuiNodeV6> nodes)\r\n    {\r\n        if (!nodes.TryAdd(node.Id, node)) throw new InvalidDataException($"DJUI v6: expanded node ID duplicate: {node.Id}");\r\n        foreach (var child in node.Children) IndexNodes(child, nodes);\r\n    }\r\n\r\n    private static void IndexParents(DjuiNodeV6 node, string? parentId, Dictionary<string, string?> parents)\r\n    {\r\n        parents[node.Id] = parentId;\r\n        foreach (var child in node.Children) IndexParents(child, node.Id, parents);\r\n    }\r\n\r\n    public static void ApplyRect(Control control, DjuiRectV6 rect)\r\n    {\r\n        control.PositionType = UIPositionType.Absolute;\r\n        control.HorizontalAlignment = HorizontalAlignment.Left;\r\n        control.VerticalAlignment = VerticalAlignment.Top;\r\n        control.Position = new UIPosition(rect.X, rect.Y);\r\n        control.Width = rect.Width;\r\n        control.Height = rect.Height;\r\n    }\r\n\r\n    private DjuiCanvasPlanV6 CreateCurrentPlan()\r\n    {\r\n        var size = _viewport.Size;\r\n        var safe = _viewport.SafeZonePadding;\r\n        Game.Logger.LogInformation($"DJUI v6 layout: viewport.Size={size.Width}x{size.Height} px={_viewport.WidthPx}x{_viewport.HeightPx} safe={safe.Left},{safe.Top},{safe.Right},{safe.Bottom} canvas={CurrentPlan?.CanvasRect.Width ?? -1}x{CurrentPlan?.CanvasRect.Height ?? -1}");\r\n        // \u5E03\u5C40\u5BF9\u9F50\u8BCA\u65AD:\u8F93\u51FA\u5173\u952E\u8282\u70B9\u89E3\u7B97\u77E9\u5F62(\u8BBE\u8BA1\u5750\u6807\u7CFB),\u914D\u5408 viewport \u65E5\u5FD7\u53EF\u4EBA\u5DE5\u6838\u7B97\u5BF9\u9F50\r\n        try\r\n        {\r\n            var solved = DjuiLayoutSolverV6.SolveV6(CurrentPage, DjuiCanvasV6.CreateLogicalPlan(size.Width, size.Height, new DjuiInsetsV6(safe.Left, safe.Top, safe.Right, safe.Bottom), _viewport.WidthPx, _viewport.HeightPx, _project));\r\n            var pick = new[] { "scene_background", "building_group", "scene02_background", "scene02_building_group", "scene03_hangzhou_background", "scene03_hangzhou_building_group" };\r\n            foreach (var id in pick)\r\n                if (solved.TryGetValue(id, out var r))\r\n                    Game.Logger.LogInformation($"DJUI v6 rect {id}: ({r.X:F1},{r.Y:F1}) {r.Width:F1}x{r.Height:F1}");\r\n        }\r\n        catch { /* \u8BCA\u65AD\u5931\u8D25\u4E0D\u5F71\u54CD\u5E03\u5C40 */ }\r\n        // Size \u4E0E SafeZonePadding \u5747\u5DF2\u7ECF\u662F\u5F15\u64CE\u5F53\u524D\u8BBE\u8BA1\u5750\u6807\uFF1B\u4E0D\u518D\u505A\u7B2C\u4E8C\u6B21 DPR \u6216 Canvas \u7F29\u653E\u3002\r\n        return DjuiCanvasV6.CreateLogicalPlan(\r\n            size.Width,\r\n            size.Height,\r\n            new DjuiInsetsV6(safe.Left, safe.Top, safe.Right, safe.Bottom),\r\n            _viewport.WidthPx,\r\n            _viewport.HeightPx,\r\n            _project);\r\n    }\r\n\r\n    public void Dispose()\r\n    {\r\n        if (_disposed) return;\r\n        _disposed = true;\r\n        _viewport.OnSizeChanged -= _sizeChanged;\r\n        _viewport.OnOrientationChanged -= _orientationChanged;\r\n        _viewport.OnDevicePixelRatioChanged -= _dprChanged;\r\n        _controls.Clear();\r\n        _controlIds.Clear();\r\n    }\r\n}\r\n\r\n#endif\r\n';

// raw:D:\git\DJUI\runtime\DjuiImageVisualLayerV6.cs
var DjuiImageVisualLayerV6_default = `// DJUI Runtime - protocol v6 internal image visual sublayer
#if CLIENT

using GameUI.Control;

namespace DjuiRuntime;

/// <summary>
/// Manages non-authored image children. StarEngine's public Texture API exposes only Path,
/// so contain/cover use appearance.sourceSize as the synchronous intrinsic-size contract.
/// </summary>
internal sealed class DjuiImageVisualLayerV6 : IDisposable, IThinker
{
    internal const string ReservedNamePrefix = "__djui.v6.visual.image.";
    private readonly Dictionary<Control, State> _visuals = new();
    private readonly HashSet<string> _warnedMissingSourceSize = new(StringComparer.Ordinal);
    private bool _disposed;

    public bool DoesThink { get; set; } = true;

    public DjuiImageVisualLayerV6() => Game.RegisterThinker(this);

    private sealed class State(Panel visual, string nodeId)
    {
        public Panel Visual { get; } = visual;
        public string NodeId { get; } = nodeId;
        public DjuiAppearanceV6? Appearance { get; set; }
        public float LastWidth { get; set; } = float.NaN;
        public float LastHeight { get; set; } = float.NaN;
    }

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
        if (!_visuals.TryGetValue(authored, out var state))
        {
            var created = new Panel { Name = ReservedNamePrefix + nodeId, IsStatic = true };
            state = new State(created, nodeId);
            created.Parent = authored;
            _visuals.Add(authored, state);
        }
        state.Appearance = appearance;
        var visual = state.Visual;

        visual.Image = image;
        visual.Desaturated = appearance?.Desaturated ?? false;
        // \u56FE\u7247\u67D3\u8272\uFF1A\u5F15\u64CE\u4E58\u7B97 tint \u53EA\u53D1\u751F\u5728\u540C\u4E00 Control \u7684 Background\xD7Image \u4E4B\u95F4\uFF08\u8DE8\u63A7\u4EF6\u4E0D\u4F5C\u7528\uFF0C
        // 1003 \u63A2\u9488\u5B9E\u6D4B\uFF09\uFF0C\u5FC5\u987B\u5199\u5728\u753B\u56FE\u7684 visual \u5B50\u5C42\u4E0A\u800C\u4E0D\u662F\u5BBF\u4E3B\u3002\u7A7A/\u975E\u6CD5\uFF1D\u64A4\u9500\u67D3\u8272\u3002
        visual.Background = DjuiTreeBuilderV6.TryParseColor(appearance?.ImageTint, out var tintColor)
            ? tintColor
            : null;
        visual.ImageFlipX = appearance?.ImageFlipX ?? false;
        visual.ImageFlipY = appearance?.ImageFlipY ?? false;
        // \u56FE\u7247\u5B9E\u9645\u7ED8\u5236\u5728 visual \u5B50\u8282\u70B9\uFF1B\u4E5D\u5BAB\u683C\u8FB9\u8DDD\u4E5F\u5FC5\u987B\u843D\u5728\u8BE5\u8282\u70B9\uFF0C
        // \u4E0D\u80FD\u53EA\u8BBE\u7F6E\u5BBF\u4E3B authored\uFF08\u5BBF\u4E3B\u81EA\u8EAB Image \u5DF2\u88AB\u6E05\u7A7A\uFF09\u3002
        visual.SlicedEdges = appearance?.SlicedEdges is { Length: 4 } edges
            ? new Thickness(edges[0], edges[1], edges[2], edges[3])
            : new Thickness(0, 0, 0, 0);

        // cover/\u5706\u89D2\u9700\u8981\u5BBF\u4E3B\u88C1\u526A\uFF1B\u5C3A\u5BF8\u540C\u6B65\u53EA\u66F4\u65B0\u77E9\u5F62\uFF0C\u4E0D\u56DE\u9000\u4E1A\u52A1\u540E\u7EED\u8BBE\u7F6E\u7684\u88C1\u526A\u5C5E\u6027\u3002
        authored.ClipContent = string.Equals(appearance?.ImageFit, "cover", StringComparison.Ordinal)
            || (appearance?.CornerRadius ?? 0f) > 0f || (appearance?.ClipContent ?? false);

        RefreshGeometry(authored);
    }

    // \u4EC5\u91CD\u7B97\u56FE\u7247\u77E9\u5F62\uFF1A\u4E0D\u91CD\u653E normal \u56FE\u3001\u7070\u5EA6\u3001\u67D3\u8272\u6216\u5BBF\u4E3B\u663E\u9690/\u900F\u660E\u5EA6\uFF0C\u4FDD\u6301\u6309\u94AE\u5F53\u524D\u72B6\u6001\u3002
    internal void RefreshGeometry(Control authored)
    {
        if (_disposed || !authored.IsValid || !_visuals.TryGetValue(authored, out var state)) return;
        var visual = state.Visual;
        if (!visual.IsValid) return;
        var appearance = state.Appearance;
        var fit = appearance?.ImageFit ?? "stretch";
        var cover = string.Equals(fit, "cover", StringComparison.Ordinal);
        var parentWidth = Math.Max(0, authored.Width);
        var parentHeight = Math.Max(0, authored.Height);
        state.LastWidth = parentWidth;
        state.LastHeight = parentHeight;
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
        else if (!string.Equals(fit, "stretch", StringComparison.Ordinal) && _warnedMissingSourceSize.Add(state.NodeId + "\\n" + appearance?.Image))
        {
            Game.Logger.LogWarning("DJUI v6: node {NodeId} uses imageFit={ImageFit} without positive appearance.sourceSize; falling back to stretch because StarEngine does not expose synchronous intrinsic texture dimensions.", state.NodeId, fit);
        }

        DjuiLayoutSessionV6.ApplyRect(visual, new DjuiRectV6(x, y, width, height));
    }

    public void Think(int delta)
    {
        if (_disposed) return;
        // \u4E0E\u7EBF\u6027\u8FDB\u5EA6\u6761\u540C\u6837\u6309\u8BBE\u5B9A\u5BBD\u9AD8\u540C\u6B65\uFF0C\u4E0D\u4F9D\u8D56\u5E03\u5C40\u540E\u7684 OnSizeChanged\uFF08\u9690\u85CF/\u672A\u6302\u6811\u4E5F\u8981\u540C\u6B65\uFF09\u3002
        List<Control>? invalid = null;
        foreach (var (authored, state) in _visuals)
        {
            if (!authored.IsValid || !state.Visual.IsValid)
            {
                (invalid ??= new()).Add(authored);
                continue;
            }
            if (state.LastWidth != Math.Max(0, authored.Width) || state.LastHeight != Math.Max(0, authored.Height))
                RefreshGeometry(authored);
        }
        if (invalid != null) foreach (var authored in invalid) _visuals.Remove(authored);
    }

    /// <summary>\u53D6\u56DE\u5BBF\u4E3B\u5BF9\u5E94\u7684 visual \u5B50 Panel\uFF08\u672A\u521B\u5EFA\u56FE\u7247\u5C42\u65F6\u4E3A null\uFF09\u3002\u6309\u94AE\u72B6\u6001\u673A\u7528\u5B83\u5207\u6362\u72B6\u6001\u56FE\u3002</summary>
    internal Panel? GetVisual(Control authored) => _visuals.TryGetValue(authored, out var state) ? state.Visual : null;

    private void Remove(Control authored)
    {
        authored.Image = "";
        if (!_visuals.Remove(authored, out var state)) return;
        state.Visual.Dispose();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        DoesThink = false;
        Game.UnregisterThinker(this);
        foreach (var state in _visuals.Values) if (state.Visual.IsValid) state.Visual.Dispose();
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

    internal void RefreshGeometry(Progress progress) => Refresh(progress, force: true);

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
        // \u67D3\u8272\u4E0E\u666E\u901A\u56FE\u7247\u540C\u89C4\u5219\uFF1A\u4E58\u7B97 tint \u5FC5\u987B\u4E0E Image \u540C\u63A7\u4EF6\uFF0C\u843D\u5728\u8FDB\u5EA6\u6761 image \u5B50\u5C42\u4E0A
        state.Image.Background = DjuiTreeBuilderV6.TryParseColor(state.Appearance?.ImageTint, out var tintColor)
            ? tintColor
            : null;
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
var DjuiTreeBuilderV6_default = `// DJUI Runtime - focused protocol v6 persistent authored-tree builder\r
#if CLIENT\r
\r
using System.Text.Json;\r
using System.Text.RegularExpressions;\r
using System.Runtime.CompilerServices;\r
using GameUI.Control;\r
using GameUI.Control.Primitive;\r
using GameUI.Control.Behavior;\r
using GameUI.Control.Extensions;\r
using GameUI.Extensions;\r
using GameUI.Enum;\r
using GameUI.Struct;\r
\r
namespace DjuiRuntime;\r
\r
/// <summary>\r
/// Owns one v6 authored control tree and its persistent layout session.\r
/// The host is a mounting boundary, not an authored node and is never registered in the session.\r
/// </summary>\r
public sealed class DjuiTreeInstanceV6 : IDisposable\r
{\r
    private bool _disposed;\r
\r
    public Panel Host { get; }\r
    public Panel Root { get; }\r
    public DjuiLayoutSessionV6 Session { get; }\r
    public bool OwnsHost { get; }\r
    private readonly DjuiImageVisualLayerV6 _imageVisuals;\r
    private readonly DjuiProgressVisualLayerV6 _progressVisuals;\r
    private readonly DjuiButtonStateRegistryV6 _buttonStates;\r
    private readonly List<IDisposable> _bindingRegistrations;\r
\r
    internal DjuiTreeInstanceV6(Panel host, Panel root, DjuiLayoutSessionV6 session, bool ownsHost, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, List<IDisposable> bindingRegistrations)\r
    {\r
        Host = host;\r
        Root = root;\r
        Session = session;\r
        OwnsHost = ownsHost;\r
        _imageVisuals = imageVisuals;\r
        _progressVisuals = progressVisuals;\r
        _buttonStates = buttonStates;\r
        _bindingRegistrations = bindingRegistrations;\r
    }\r
\r
    public T? GetControl<T>(string nodeId) where T : Control => Session.GetControl<T>(nodeId);\r
\r
    // CloneControl \u6784\u5EFA\u7BA1\u7EBF\u5165\u53E3\uFF08BuildClone \u4F7F\u7528\uFF09\r
    internal DjuiImageVisualLayerV6 ImageVisuals => _imageVisuals;\r
    internal DjuiProgressVisualLayerV6 ProgressVisuals => _progressVisuals;\r
    internal DjuiButtonStateRegistryV6 ButtonStates => _buttonStates;\r
\r
    public void Dispose()\r
    {\r
        if (_disposed) return;\r
        _disposed = true;\r
        DjuiTransitionPlayer.Stop(Root);\r
        foreach (var registration in _bindingRegistrations) registration.Dispose();\r
        _bindingRegistrations.Clear();\r
\r
        // R5\uFF080.7.18\uFF09\uFF1A\u9500\u6BC1\u6811\u524D\u63D0\u524D\u6E05\u7A7A behaviors\u2014\u2014\u63A7\u4EF6\u8FDB\u5165 Dispose \u540E IsValid \u5373\u5931\u6548\uFF0C\r
        // \u5F15\u64CE DisposeManaged \u4ECD\u4F1A ClearBehaviors\uFF0CTouchBehavior.OnDetached \u5728\u5931\u6548\u6001\u6062\u590D\u6309\u538B\r
        // \u5FEB\u7167\u5199 Oplicity \u4F1A\u629B "Control is not valid"\uFF08\u5173\u7A97\u8F6C\u573A FinalizeClose \u8DEF\u5F84\u5FC5\u73B0\u4E00\u6B21\uFF09\u3002\r
        // \u6B64\u5904\u63A7\u4EF6\u4ECD\u6709\u6548\uFF0COnDetached \u5728\u5408\u6CD5\u65F6\u673A\u6267\u884C\uFF0C\u4ECE\u6839\u4E0A\u7ED5\u5F00\u7ADE\u6001\u3002\r
        foreach (var control in Session.Controls.Values)\r
        {\r
            if (control.IsValid) control.ClearBehaviors();\r
        }\r
\r
        foreach (var control in Session.Controls.Values) DjuiEffectPlayer.Stop(control);\r
        Session.Dispose();\r
        _imageVisuals.Dispose();\r
        _progressVisuals.Dispose();\r
        _buttonStates.Dispose();\r
\r
        // R5 \u515C\u5E95\uFF1A\u6811\u9500\u6BC1\u5206\u6B65\u9694\u79BB\u2014\u2014\u5355\u6B65\u5F02\u5E38\u4E0D\u963B\u65AD\u540E\u7EED\u6E05\u7406\uFF08Host \u60AC\u6302\u6CC4\u6F0F\u6BD4\u4E00\u6B21\u53EF\u6355\u83B7\u5F02\u5E38\u66F4\u7CDF\uFF09\r
        try { Root.Dispose(); }\r
        catch (Exception ex) { Game.Logger.LogWarning("DJUI v6: Root.Dispose \u5F02\u5E38\uFF08\u5DF2\u9694\u79BB\uFF09\uFF1A{Message}", ex.Message); }\r
        Host.RemoveFromVisualTreeAndParent();\r
        try { Host.Dispose(); }\r
        catch (Exception ex) { Game.Logger.LogWarning("DJUI v6: Host.Dispose \u5F02\u5E38\uFF08\u5DF2\u9694\u79BB\uFF09\uFF1A{Message}", ex.Message); }\r
    }\r
}\r
\r
/// <summary>\r
/// Builds exactly one persistent authored v6 tree under one Panel host.\r
/// Template instances must be expanded beforehand; the expanded instance remains one registered Panel.\r
/// </summary>\r
public static class DjuiTreeBuilderV6\r
{\r
    public static DjuiTreeInstanceV6 Build(string windowInstanceId, DjuiProjectV6 project, DjuiPageV6 page, Panel? host = null)\r
    {\r
        ArgumentNullException.ThrowIfNull(project);\r
        ArgumentNullException.ThrowIfNull(page);\r
        if (!string.Equals(page.Kind, "window", StringComparison.OrdinalIgnoreCase))\r
            throw new NotSupportedException($"DJUI v6: single-tree builder only supports expanded window pages; page '{page.PageId}' has kind '{page.Kind}'.");\r
        if (!string.Equals(page.Root.StarType, "Panel", StringComparison.OrdinalIgnoreCase))\r
            throw new InvalidOperationException($"DJUI v6: page root '{page.Root.Id}' must be a Panel.");\r
\r
        var ownsHost = host == null;\r
        host ??= new Panel();\r
        if (ownsHost) host.FullScreen();\r
        host.ClipContent = true;\r
\r
        var session = new DjuiLayoutSessionV6(windowInstanceId, project, page);\r
        var imageVisuals = new DjuiImageVisualLayerV6();\r
        var progressVisuals = new DjuiProgressVisualLayerV6();\r
        var buttonStates = new DjuiButtonStateRegistryV6(imageVisuals);\r
        var bindingRegistrations = new List<IDisposable>();\r
        Panel? root = null;\r
        try\r
        {\r
            root = (Panel)BuildNode(session.CurrentPage.Root, session, project.DefaultFont, imageVisuals, progressVisuals, buttonStates, bindingRegistrations);\r
            root.Parent = host;\r
            session.SetNodeUpdater((node, control, sceneScale) => ApplyNodeFields(control, node, project.DefaultFont, imageVisuals, progressVisuals, buttonStates, sceneScale));\r
            session.Relayout();\r
            var instance = new DjuiTreeInstanceV6(host, root, session, ownsHost, imageVisuals, progressVisuals, buttonStates, bindingRegistrations);\r
            session.Owner = instance;   // SetImage \u8FD0\u884C\u671F\u7ECF\u5B83\u53D6 ImageVisuals/ButtonStates\uFF08\u5EFA\u6811\u671F\u7ED1\u5B9A\u9996\u653E\u65F6\u4E3A null\uFF0CSetImageCore \u6709\u4E13\u95E8\u5904\u7406\uFF09\r
            return instance;\r
        }\r
        catch\r
        {\r
            foreach (var registration in bindingRegistrations) registration.Dispose();\r
            session.Dispose();\r
            imageVisuals.Dispose();\r
            progressVisuals.Dispose();\r
            buttonStates.Dispose();\r
            if (ownsHost) host.Dispose();\r
            else root?.Dispose();\r
            throw;\r
        }\r
    }\r
\r
    private static Control BuildNode(DjuiNodeV6 node, DjuiLayoutSessionV6 session, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, List<IDisposable> bindingRegistrations, bool bindBehaviors = true, bool recurse = true, float sceneScale = 1f)\r
    {\r
        if (string.Equals(node.StarType, "TemplateInstance", StringComparison.OrdinalIgnoreCase))\r
            throw new InvalidOperationException($"DJUI v6: template node '{node.Id}' was not expanded.");\r
        if (string.IsNullOrWhiteSpace(node.Id))\r
            throw new InvalidOperationException("DJUI v6: every authored node must have a non-empty ID.");\r
\r
        Control control = node.StarType switch\r
        {\r
            "Panel" => new Panel(),\r
            "Button" => new Button(),\r
            "Label" => new Label(),\r
            "Input" => new Input(),\r
            "Progress" => new Progress(),\r
            "SpacingPanel" => new Panel(),\r
            "PanelScrollable" => new PanelScrollable(),\r
            _ => throw new NotSupportedException($"DJUI v6: node '{node.Id}' uses unsupported starType '{node.StarType}'.")\r
        };\r
\r
        ApplyNodeFields(control, node, defaultFont, imageVisuals, progressVisuals, buttonStates, sceneScale);\r
        ApplyInteraction(control, node.Interaction);\r
        ApplyEffects(control, node.Effects);\r
        session.Register(node.Id, control);\r
        if (bindBehaviors)\r
        {\r
            DjuiActionRouter.BindAction(control, node.Djui?.Action);\r
            DjuiAudioSystem.BindClickSound(control, node.Djui?.ClickSoundId);\r
            foreach (var binding in node.Djui?.Bindings ?? [])\r
                bindingRegistrations.Add(DjuiBindingSystem.RegisterBinding(control, binding.Key, binding.Value, node.Id, session));\r
        }\r
\r
        if (recurse)\r
            foreach (var childNode in node.Children)\r
            {\r
                var child = BuildNode(childNode, session, defaultFont, imageVisuals, progressVisuals, buttonStates, bindingRegistrations);\r
                child.Parent = control;\r
            }\r
        return control;\r
    }\r
\r
    /// <summary>\r
    /// CloneControl \u6784\u5EFA\u6838\u5FC3\uFF1AJSON \u514B\u9686\u6E90\u5B50\u6811 \u2192 \u5168\u6811 id \u52A0\u9632\u51B2\u7A81\u540E\u7F00 \u2192 \u9010\u8282\u70B9\u8D70\u540C\u4E00\u6784\u5EFA\u7BA1\u7EBF\r
    /// \uFF08\u4E0D\u7ED1 action/\u97F3\u6548/\u6570\u636E\u7ED1\u5B9A\u2014\u2014\u514B\u9686\u4F53\u65E0\u884C\u4E3A\uFF0C\u5982\u540C new\uFF09\u2192 \u6309\u6E90\u5B50\u6811\u89E3\u7B97\u77E9\u5F62 ApplyRect\r
    /// \uFF08\u5C40\u90E8\u77E9\u5F62\uFF0C\u514B\u9686\u4F53\u521D\u59CB\u4E0E\u6E90\u5B8C\u5168\u91CD\u53E0\uFF0C\u7236\u7EA7/\u4F4D\u7F6E\u5F52\u8C03\u7528\u65B9\uFF09\u3002\r
    /// \u514B\u9686\u8282\u70B9\u4EE5\u65B0 id \u767B\u8BB0\u8FDB\u5E03\u5C40\u4F1A\u8BDD\uFF1A\u4E0D\u53C2\u4E0E relayout\uFF0C\u4F46\u6811\u9500\u6BC1\u65F6 ClearBehaviors/\u7279\u6548\u6E05\u7406\u8986\u76D6\u514B\u9686\u4F53\uFF08R5 \u540C\u6B3E\u7ADE\u6001\u9632\u62A4\uFF09\u3002\r
    /// </summary>\r
    internal static Control BuildClone(DjuiNodeV6 source, DjuiLayoutSessionV6 session, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, string idSuffix, IReadOnlyDictionary<string, DjuiRectV6> solved, IReadOnlyDictionary<string, float>? sceneScales = null)\r
    {\r
        var node = JsonSerializer.Deserialize<DjuiNodeV6>(JsonSerializer.Serialize(source, CloneJsonOptions), CloneJsonOptions)\r
            ?? throw new InvalidOperationException("DJUI v6: clone JSON round-trip failed");\r
        ApplyCloneIds(node, idSuffix);\r
        return BuildCloneNode(node, source, session, defaultFont, imageVisuals, progressVisuals, buttonStates, solved, sceneScales, null);\r
    }\r
\r
    // \u514B\u9686\u8282\u70B9\u5F31\u8868\uFF1A\u514B\u9686 node \u6811\u672C\u662F JSON round-trip \u7684\u7528\u5B8C\u5373\u5F03\u4EA7\u7269\uFF0C\u5B58\u5F31\u8868\u540E SetImage(Control)\r
    // \u53EF\u53D6\u5230\u5B8C\u6574 appearance \u6392\u7248\u53C2\u6570\uFF08\u514B\u9686\u4F53\u4E0D\u53C2\u4E0E relayout\uFF0Cnode \u65E0\u5931\u6548\u95EE\u9898\uFF1B\u63A7\u4EF6\u9500\u6BC1\u540E\u6761\u76EE\u81EA\u6E05\uFF09\r
    private static readonly ConditionalWeakTable<Control, DjuiNodeV6> CloneNodeIndex = new();\r
\r
    /// <summary>\u6309\u514B\u9686\u63A7\u4EF6\u5F15\u7528\u53D6\u56DE\u5176\u8282\u70B9\u6A21\u578B\uFF08\u975E\u514B\u9686\u4F53\u8FD4\u56DE null\uFF09\u3002</summary>\r
    internal static DjuiNodeV6? FindCloneNode(Control control)\r
        => CloneNodeIndex.TryGetValue(control, out var node) ? node : null;\r
\r
    private static readonly JsonSerializerOptions CloneJsonOptions = new();\r
\r
    private static void ApplyCloneIds(DjuiNodeV6 node, string idSuffix)\r
    {\r
        node.Id += idSuffix;\r
        foreach (var child in node.Children) ApplyCloneIds(child, idSuffix);\r
    }\r
\r
    private static Control BuildCloneNode(DjuiNodeV6 node, DjuiNodeV6 origin, DjuiLayoutSessionV6 session, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, IReadOnlyDictionary<string, DjuiRectV6> solved, IReadOnlyDictionary<string, float>? sceneScales, DjuiRectV6? parentRect)\r
    {\r
        // \u514B\u9686\u4F53\u4E0D\u53C2\u4E0E relayout\uFF0C\u573A\u666F\u753B\u677F\u5B57\u53F7\u7F29\u653E\u987B\u5728\u5EFA\u6811\u65F6\u4E00\u6B21\u5230\u4F4D\uFF08\u6309\u514B\u9686\u6E90 id \u67E5\u7D2F\u8BA1\u7F29\u653E\uFF09\r
        var sceneScale = sceneScales != null && sceneScales.TryGetValue(origin.Id, out var scale) ? scale : 1f;\r
        var control = BuildNode(node, session, defaultFont, imageVisuals, progressVisuals, buttonStates, new List<IDisposable>(), bindBehaviors: false, recurse: false, sceneScale);\r
        CloneNodeIndex.AddOrUpdate(control, node);\r
        if (solved.TryGetValue(origin.Id, out var rect))\r
        {\r
            var local = parentRect is { } pr ? new DjuiRectV6(rect.X - pr.X, rect.Y - pr.Y, rect.Width, rect.Height) : rect;\r
            DjuiLayoutSessionV6.ApplyRect(control, local);\r
        }\r
        // BuildNode \u521D\u6B21\u5EFA\u5C42\u65F6\u5C1A\u65E0\u89E3\u7B97\u5BBD\u9AD8\uFF1B\u514B\u9686\u4E0D\u8D70 authored Relayout\uFF0C\u5FC5\u987B\u5728\u8FD4\u56DE\u524D\u8865\u9F50\u7ED8\u5236\u77E9\u5F62\u3002\r
        imageVisuals.RefreshGeometry(control);\r
        if (control is Progress progress) progressVisuals.RefreshGeometry(progress);\r
        DjuiRectV6? ownRect = solved.TryGetValue(origin.Id, out var own) ? own : null;\r
        for (var i = 0; i < node.Children.Count; i++)\r
        {\r
            var child = BuildCloneNode(node.Children[i], origin.Children[i], session, defaultFont, imageVisuals, progressVisuals, buttonStates, solved, sceneScales, ownRect);\r
            child.Parent = control;\r
        }\r
        return control;\r
    }\r
\r
    private static void ApplyNodeFields(Control control, DjuiNodeV6 node, string? defaultFont, DjuiImageVisualLayerV6 imageVisuals, DjuiProgressVisualLayerV6 progressVisuals, DjuiButtonStateRegistryV6 buttonStates, float sceneScale = 1f)\r
    {\r
        // \u63A7\u4EF6 Name \u53D6\u9875\u9762 JSON \u7684 name \u5B57\u6BB5\u2014\u2014\u5F15\u64CE FindChild(name) / FindChildren(name) \u7684\u5BFB\u5740\u4F9D\u636E\uFF08\u542B\u514B\u9686\u4F53\uFF09\r
        if (!string.IsNullOrWhiteSpace(node.Name)) control.Name = node.Name;\r
        ApplyBasic(control, node.Basic);\r
        ApplyTransformFields(control, node.Transform);\r
        ApplyAppearance(control, node.Appearance);\r
        ApplyProgress(control, node.Progress);\r
        var isRadialProgress = control is Progress progress && IsRadial(progress);\r
        ApplyText(control, node.Text, defaultFont, sceneScale);\r
        ApplyImageRefresh(control, node, imageVisuals, buttonStates);\r
        if (control is Progress target)\r
        {\r
            if (isRadialProgress) ApplyNativeProgressImage(target, node.Appearance);\r
            else progressVisuals.Apply(node.Id, target, node.Appearance);\r
        }\r
        ApplyLayout(control, node.Layout);\r
    }\r
\r
    /// <summary>\r
    /// \u8FD0\u884C\u671F\u56FE\u7247\u5237\u65B0\uFF08SetImage / image \u7ED1\u5B9A / relayout \u91CD\u653E\u4E09\u65B9\u5171\u7528\uFF09\uFF1A\r
    /// \u975E Progress \u8D70 imageVisuals.Apply\uFF08\u56FE\u7247\u5185\u5BB9\uFF0Bvisual \u77E9\u5F62\u63A8\u5BFC\uFF0C\u77E9\u5F62\u53EA\u5403 appearance \u6392\u7248\u53C2\u6570\u4E0E\r
    /// \u5BBF\u4E3B\u5F53\u524D\u5BBD\u9AD8\uFF0C\u4E0D\u6539\u5BBF\u4E3B\u77E9\u5F62\uFF1D\u53EA\u6362\u56FE\u4E0D\u52A8\u5E03\u5C40\uFF09\uFF1BButton \u518D\u7ECF ApplyButton \u2192 buttonStates.Attach\r
    /// \u5237\u65B0\u72B6\u6001\u673A normal \u56FE\uFF08hover/pressed/disabled \u672A\u914D\u7F6E\u7684\u6001\u81EA\u52A8\u8DDF\u968F\u65B0\u5E95\u56FE\uFF09\u3002\r
    /// Progress \u9759\u9ED8\u8DF3\u8FC7\u2014\u2014\u8FDB\u5EA6\u6761\u56FE\u7247\u8D70\u4E13\u5C5E\u89C6\u89C9\u5C42\uFF0CSetImageCore \u5165\u53E3\u5904\u5DF2\u62E6\u622A\u3002\r
    /// </summary>\r
    internal static void ApplyImageRefresh(Control control, DjuiNodeV6 node,\r
        DjuiImageVisualLayerV6 imageVisuals, DjuiButtonStateRegistryV6 buttonStates)\r
    {\r
        if (control is Progress) return;\r
        imageVisuals.Apply(node.Id, control, node.Appearance);\r
        if (control is Button)\r
            ApplyButton(control, node.Button, node.Appearance, node.Transform, imageVisuals, buttonStates);\r
    }\r
\r
    private static void ApplyInteraction(Control control, DjuiInteractionV6? interaction)\r
    {\r
        if (interaction == null) return;\r
        if (!string.IsNullOrEmpty(interaction.RoutedEvents) && Enum.TryParse<RoutedEvents>(interaction.RoutedEvents, out var routed)) control.RoutedEvents = routed;\r
        if (interaction.AllowDrag is bool allowDrag) control.AllowDrag = allowDrag;\r
        if (interaction.AllowDrop is bool allowDrop) control.AllowDrop = allowDrop;\r
        foreach (var behavior in interaction.Behaviors ?? [])\r
            if (behavior.Type == "TouchBehavior") control.AddTouchBehavior(behavior.ScaleFactor ?? 1f, behavior.EnablePressAnimation ?? false, behavior.EnableLongPress ?? false);\r
    }\r
\r
    private static void ApplyEffects(Control control, DjuiEffectsV6? effects)\r
    {\r
        if (!string.IsNullOrEmpty(effects?.Preset)) DjuiEffectPresets.Apply(effects.Preset, control);\r
        else if (control is Button) DjuiEffectPresets.Apply("button_default", control);\r
    }\r
\r
    private static void ApplyLayout(Control control, DjuiLayoutV6? layout)\r
    {\r
        if (layout == null) return;\r
        // Position/alignment/margin belong to the v6 solver. Applying authored layout margin here\r
        // would offset an already solved absolute rectangle a second time.\r
        if (layout.Padding is { Length: 4 } padding) control.Padding = new Thickness(padding[0], padding[1], padding[2], padding[3]);\r
        if (!string.IsNullOrEmpty(layout.HorizontalContentAlignment) && Enum.TryParse<HorizontalContentAlignment>(layout.HorizontalContentAlignment, out var horizontal))\r
            control.HorizontalContentAlignment = horizontal;\r
        if (!string.IsNullOrEmpty(layout.VerticalContentAlignment) && Enum.TryParse<VerticalContentAlignment>(layout.VerticalContentAlignment, out var vertical))\r
            control.VerticalContentAlignment = vertical;\r
    }\r
\r
    private static void ApplyBasic(Control control, DjuiBasicV6? basic)\r
    {\r
        if (basic?.Visible is bool visible) control.Visible = visible;\r
        if (basic?.Disabled is bool disabled) control.Disabled = disabled;\r
        if (basic?.IsStatic is bool isStatic) control.IsStatic = isStatic;\r
    }\r
\r
    private static void ApplyTransformFields(Control control, DjuiTransformV6? transform)\r
    {\r
        if (transform?.Rotation is float rotation) control.Rotation = rotation;\r
        if (transform?.Opacity is float opacity) control.Opacity = opacity;\r
        if (transform?.ZIndex is int zIndex) control.ZIndex = zIndex;\r
    }\r
\r
    private static void ApplyAppearance(Control control, DjuiAppearanceV6? appearance)\r
    {\r
        if (appearance == null) return;\r
        if (TryParseColor(appearance.Background, out var background)) control.Background = background;\r
        if (appearance.CornerRadius is float radius) control.CornerRadius = radius;\r
        if (appearance.ClipContent is bool clip) control.ClipContent = clip;\r
        if (appearance.Desaturated is bool desaturated) control.Desaturated = desaturated;\r
        if (appearance.ImageFlipX is bool flipX) control.ImageFlipX = flipX;\r
        if (appearance.ImageFlipY is bool flipY) control.ImageFlipY = flipY;\r
        if (appearance.SlicedEdges is { Length: 4 } edges) control.SlicedEdges = new Thickness(edges[0], edges[1], edges[2], edges[3]);\r
    }\r
\r
    private static void ApplyText(Control control, DjuiTextV6? text, string? defaultFont, float sceneScale = 1f)\r
    {\r
        if (text == null) return;\r
        var font = string.IsNullOrEmpty(text.Font) ? defaultFont : text.Font;\r
        if (control is Label label) ApplyLabelText(label, text, font, sceneScale);\r
        else if (control is Input input)\r
        {\r
            if (text.Text != null) input.Text = text.Text;\r
            if (!string.IsNullOrEmpty(font)) input.Font = font;\r
            if (text.FontSize is float size) input.FontSize = size * sceneScale;\r
            if (TryParseColor(text.TextColor, out var color)) input.TextColor = color;\r
            if (text.Bold is bool bold) input.Bold = bold;\r
        }\r
        else if (control is Button button && text.Text != null)\r
        {\r
            var buttonLabel = button.Children?.OfType<Label>().FirstOrDefault(child => child.Name == DjuiButtonStateV6.ButtonLabelName);\r
            if (buttonLabel == null)\r
            {\r
                buttonLabel = new Label { Name = DjuiButtonStateV6.ButtonLabelName, IsStatic = true };\r
                buttonLabel.FullScreen();\r
                buttonLabel.Parent = button;\r
            }\r
            ApplyLabelText(buttonLabel, text, font, sceneScale);\r
        }\r
    }\r
\r
    // \u5B57\u53F7/\u63CF\u8FB9\u8865\u4E58\u573A\u666F\u753B\u677F\u7F29\u653E\uFF08sceneScale\uFF09\uFF1A\u753B\u677F\u5B50\u6811\u5185\u5F15\u64CE\u53EA\u6620\u5C04\u63A7\u4EF6\u77E9\u5F62\uFF0C\u975E\u77E9\u5F62\u5C5E\u6027\u9700\u81EA\u884C\u7F29\u653E\uFF0C\r
    // \u5426\u5219\u573A\u666F\u9875\u6587\u5B57\u76F8\u5BF9\u63A7\u4EF6\u5C0F\u4E00\u500D\u591A\uFF08\u7F16\u8F91\u5668\u753B\u5E03\u662F\u6574\u7EC4\u7F29\u653E\uFF0C\u5B57\u53F7\u8DDF\u968F\uFF0C\u4E24\u8FB9\u987B\u4E00\u81F4\uFF09\u3002\r
    private static void ApplyLabelText(Label label, DjuiTextV6 text, string? font, float sceneScale = 1f)\r
    {\r
        if (text.Text != null) label.Text = text.Text;\r
        if (!string.IsNullOrEmpty(font)) label.Font = font;\r
        if (text.FontSize is float size) label.FontSize = size * sceneScale;\r
        if (TryParseColor(text.TextColor, out var color)) label.TextColor = color;\r
        if (text.StrokeSize is float strokeSize) label.StrokeSize = Math.Max(0, strokeSize * sceneScale);\r
        if (TryParseColor(text.StrokeColor, out var strokeColor)) label.StrokeColor = strokeColor;\r
        if (text.Bold is bool bold) label.Bold = bold;\r
        if (text.TextWrap is bool wrap) label.TextWrap = wrap;\r
        if (!string.IsNullOrEmpty(text.TextOverflow) && Enum.TryParse<TextTrimming>(text.TextOverflow, out var trimming)) label.TextTrimming = trimming;\r
    }\r
\r
    private static void ApplyButton(Control control, DjuiButtonV6? button, DjuiAppearanceV6? appearance, DjuiTransformV6? transform, DjuiImageVisualLayerV6 imageVisuals, DjuiButtonStateRegistryV6 buttonStates)\r
    {\r
        // \u5F15\u64CE Button \u7684 ImageHover/ImagePressed \u5728 v6 \u4E0B\u4E0D\u53EF\u7528\uFF08\u56FE\u7247\u753B\u5728 visual \u5B50 Panel\uFF0C\u5BBF\u4E3B Image \u4E3A\u7A7A\uFF0C\r
        // \u4E14\u5F15\u64CE\u6CA1\u6709 ImageDisabled\uFF09\uFF0C\u56DB\u6001\u6362\u56FE\u4E0E\u7981\u7528\u7070\u5316\u5168\u90E8\u7531 DjuiButtonStateV6 \u5728 visual \u5C42\u81EA\u7BA1\u3002\r
        // \u663E\u5F0F\u6E05\u7A7A\u4E24\u6001\u56FE\uFF080.8.5\uFF09\uFF1A\u65E0\u53C2\u6784\u9020\u8D70 DefaultTemplate\uFF0C\u5F15\u64CE\u9ED8\u8BA4 hover \u56FE\u4E3A\u84DD\u8272\u9AD8\u4EAE\u2014\u2014\r
        // DJUI \u672A\u63A5\u7BA1\u65F6\u4F1A\u53E0\u52A0\u663E\u793A\uFF0C\u9020\u6210"\u5355\u9879\u53D8\u84DD"\u7684\u6B67\u4E49\uFF082026-09-08 \u4E1A\u52A1\u9A8C\u6536\u95EE\u98982\uFF09\u3002\r
        if (control is not Button target) return;\r
        target.ImageHover = "";\r
        target.ImagePressed = "";\r
        buttonStates.Attach(target, button, appearance?.Image, transform?.Opacity ?? 1f, appearance?.Desaturated ?? false);\r
    }\r
\r
    private static void ApplyProgress(Control control, DjuiProgressV6? progress)\r
    {\r
        if (control is not Progress target || progress == null) return;\r
        if (progress.Value is float value) target.Value = value;\r
        if (!string.IsNullOrEmpty(progress.ProgressionMode) && Enum.TryParse<ProgressionMode>(progress.ProgressionMode, out var mode)) target.ProgressionMode = mode;\r
        if (progress.Rotation is float rotation) target.ProgressRotation = rotation;\r
    }\r
\r
    private static bool IsRadial(Progress progress)\r
        => progress.ProgressionMode is ProgressionMode.Clockwise or ProgressionMode.CounterClockwise;\r
\r
    /// <summary>\u653E\u5C04\u72B6\u8FDB\u5EA6\u6761\u539F\u751F\u8DEF\u5F84\u5E94\u7528\uFF08\u5EFA\u6811\u4E0E SetTint \u8FD0\u884C\u671F\u5171\u7528\uFF09\u3002</summary>\r
    internal static void ApplyNativeProgressImage(Progress target, DjuiAppearanceV6? appearance)\r
    {\r
        target.Image = appearance?.Image ?? "";\r
        // \u653E\u5C04\u72B6\u8FDB\u5EA6\u6761\u56FE\u5728\u5BBF\u4E3B\u81EA\u8EAB\uFF08\u539F\u751F\u88C1\u526A\u8DEF\u5F84\uFF09\uFF0C\u67D3\u8272\u76F4\u63A5\u843D\u5BBF\u4E3B Background\uFF08\u540C\u63A7\u4EF6\u4E58\u7B97\uFF09\r
        target.Background = TryParseColor(appearance?.ImageTint, out var tintColor) ? tintColor : null;\r
        target.SlicedEdges = appearance?.SlicedEdges is { Length: 4 } edges\r
            ? new Thickness(edges[0], edges[1], edges[2], edges[3])\r
            : new Thickness(0, 0, 0, 0);\r
        target.ClipContent = appearance?.ClipContent ?? false;\r
    }\r
\r
    /// <summary>hex / rgba() \u989C\u8272\u4E32\u89E3\u6790\uFF08background\u3001imageTint \u5171\u7528\uFF09\u3002\u89E3\u6790\u5931\u8D25\u8FD4\u56DE false\u3001color \u4E3A White\u3002</summary>\r
    internal static bool TryParseColor(string? raw, out Color color)\r
    {\r
        color = Color.White;\r
        if (string.IsNullOrWhiteSpace(raw)) return false;\r
        var value = raw.Trim();\r
        try\r
        {\r
            if (value.StartsWith("#"))\r
            {\r
                color = value.Length == 9 ? ColorExtensions.FromRgbaHex(value) : ColorExtensions.FromHex(value);\r
                return true;\r
            }\r
            var match = Regex.Match(value, @"^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)$", RegexOptions.IgnoreCase);\r
            if (!match.Success) return false;\r
            var r = Math.Clamp(int.Parse(match.Groups[1].Value), 0, 255);\r
            var g = Math.Clamp(int.Parse(match.Groups[2].Value), 0, 255);\r
            var b = Math.Clamp(int.Parse(match.Groups[3].Value), 0, 255);\r
            var a = match.Groups[4].Success ? (float.Parse(match.Groups[4].Value) is var alpha && alpha <= 1 ? Math.Clamp((int)MathF.Round(alpha * 255), 0, 255) : Math.Clamp((int)MathF.Round(alpha), 0, 255)) : 255;\r
            color = Color.FromArgb(a, r, g, b);\r
            return true;\r
        }\r
        catch { return false; }\r
    }\r
}\r
\r
#endif\r
`;

// raw:D:\git\DJUI\runtime\DjuiModels.cs
var DjuiModels_default = '// DJUI Runtime - JSON \u53CD\u5E8F\u5217\u5316\u6A21\u578B\n// \u5BF9\u5E94\u534F\u8BAE v4\n\nusing System.Text.Json;\nusing System.Text.Json.Serialization;\n\nnamespace DjuiRuntime;\n\npublic class DjuiPageJson\n{\n    [JsonPropertyName("version")]\n    public int Version { get; set; }\n\n    [JsonPropertyName("pageId")]\n    public string PageId { get; set; } = "";\n\n    [JsonPropertyName("designWidth")]\n    public float DesignWidth { get; set; } = 900;\n\n    [JsonPropertyName("designHeight")]\n    public float DesignHeight { get; set; } = 1600;\n\n    [JsonPropertyName("adaptation")]\n    public DjuiAdaptationJson? Adaptation { get; set; }\n\n    [JsonPropertyName("root")]\n    public DjuiNodeJson Root { get; set; } = new();\n\n    [JsonPropertyName("nodeKind")]\n    public string NodeKind { get; set; } = "";\n\n    [JsonPropertyName("windowMode")]\n    public string? WindowMode { get; set; }\n\n    [JsonPropertyName("transition")]\n    public DjuiTransitionJson? Transition { get; set; }\n}\n\npublic class DjuiTransitionJson\n{\n    [JsonPropertyName("open")]\n    public string? Open { get; set; }\n\n    [JsonPropertyName("close")]\n    public string? Close { get; set; }\n}\n\npublic class DjuiNodeJson\n{\n    [JsonPropertyName("id")]\n    public string Id { get; set; } = "";\n\n    [JsonPropertyName("starType")]\n    public string StarType { get; set; } = "Panel";\n\n    [JsonPropertyName("name")]\n    public string? Name { get; set; }\n\n    [JsonPropertyName("basic")]\n    public DjuiBasicJson? Basic { get; set; }\n\n    [JsonPropertyName("transform")]\n    public DjuiTransformJson? Transform { get; set; }\n\n    [JsonPropertyName("appearance")]\n    public DjuiAppearanceJson? Appearance { get; set; }\n\n    [JsonPropertyName("layout")]\n    public DjuiLayoutJson? Layout { get; set; }\n\n    [JsonPropertyName("interaction")]\n    public DjuiInteractionJson? Interaction { get; set; }\n\n    [JsonPropertyName("effects")]\n    public DjuiEffectsJson? Effects { get; set; }\n\n    [JsonPropertyName("text")]\n    public DjuiTextJson? Text { get; set; }\n\n    [JsonPropertyName("button")]\n    public DjuiButtonJson? Button { get; set; }\n\n    [JsonPropertyName("progress")]\n    public DjuiProgressJson? Progress { get; set; }\n\n    [JsonPropertyName("djui")]\n    public DjuiExtensionJson? Djui { get; set; }\n\n    // Flex \u5C5E\u6027\n    [JsonPropertyName("widthStretchRatio")]\n    public float? WidthStretchRatio { get; set; }\n    [JsonPropertyName("heightStretchRatio")]\n    public float? HeightStretchRatio { get; set; }\n    [JsonPropertyName("widthCompactRatio")]\n    public float? WidthCompactRatio { get; set; }\n    [JsonPropertyName("heightCompactRatio")]\n    public float? HeightCompactRatio { get; set; }\n\n    [JsonPropertyName("children")]\n    public List<DjuiNodeJson> Children { get; set; } = new();\n\n    // \u2605 uGUI \u98CE\u683C\u951A\u70B9\n    [JsonPropertyName("anchor")]\n    public DjuiAnchorJson? Anchor { get; set; }\n\n    // \u2605 \u62C9\u4F38\uFF08NGUI UIStretch \u98CE\u683C\uFF09\n    [JsonPropertyName("stretch")]\n    public DjuiStretchJson? Stretch { get; set; }\n\n    // \u2605 \u5BBD\u9AD8\u6BD4\n    [JsonPropertyName("aspectRatio")]\n    public DjuiAspectRatioJson? AspectRatio { get; set; }\n\n    [JsonPropertyName("templateRef")]\n    public string? TemplateRef { get; set; }\n\n    [JsonPropertyName("templateOverrides")]\n    public Dictionary<string, Dictionary<string, JsonElement>>? TemplateOverrides { get; set; }\n\n    [JsonPropertyName("adapt")]\n    public DjuiNodeAdaptJson? Adapt { get; set; }\n}\n\npublic class DjuiAdaptationJson\n{\n    [JsonPropertyName("orientation")]\n    public string? Orientation { get; set; }\n\n    [JsonPropertyName("designWidth")]\n    public float? DesignWidth { get; set; }\n\n    [JsonPropertyName("designHeight")]\n    public float? DesignHeight { get; set; }\n\n    [JsonPropertyName("contentFit")]\n    public string? ContentFit { get; set; }\n\n    [JsonPropertyName("backgroundFit")]\n    public string? BackgroundFit { get; set; }\n\n    [JsonPropertyName("safeArea")]\n    public bool? SafeArea { get; set; }\n\n    [JsonPropertyName("contentAlign")]\n    public string? ContentAlign { get; set; }\n\n    [JsonPropertyName("minScale")]\n    public float? MinScale { get; set; }\n\n    [JsonPropertyName("maxScale")]\n    public float? MaxScale { get; set; }\n}\n\npublic class DjuiNodeAdaptJson\n{\n    [JsonPropertyName("role")]\n    public string? Role { get; set; }\n\n    [JsonPropertyName("safePin")]\n    public string? SafePin { get; set; }\n\n    [JsonPropertyName("bleed")]\n    public bool? Bleed { get; set; }\n}\n\npublic class DjuiAnchorJson\n{\n    // \u951A\u5B9A\u76EE\u6807\uFF1A\u5C4F\u5E55 / \u7236\u8282\u70B9\n    [JsonPropertyName("target")]\n    public string? Target { get; set; }\n\n    // NGUI \u98CE\u683C 9-way \u951A\u70B9\u4F4D\u7F6E\n    [JsonPropertyName("side")]\n    public string? Side { get; set; }\n\n    // === \u5411\u540E\u517C\u5BB9\u65E7\u5B57\u6BB5\uFF08\u81EA\u52A8\u8FC1\u79FB\u7528\uFF09===\n    [JsonPropertyName("anchorMin")]\n    public Vec2Json? AnchorMin { get; set; }\n\n    [JsonPropertyName("anchorMax")]\n    public Vec2Json? AnchorMax { get; set; }\n\n    [JsonPropertyName("left")]\n    public float? Left { get; set; }\n\n    [JsonPropertyName("right")]\n    public float? Right { get; set; }\n\n    [JsonPropertyName("top")]\n    public float? Top { get; set; }\n\n    [JsonPropertyName("bottom")]\n    public float? Bottom { get; set; }\n}\n\npublic class DjuiStretchJson\n{\n    // \u62C9\u4F38\u98CE\u683C\uFF1ANone / Horizontal / Vertical / Both\n    [JsonPropertyName("style")]\n    public string? Style { get; set; }\n\n    // \u62C9\u4F38\u8FB9\u8DDD\uFF08\u50CF\u7D20\uFF09\n    [JsonPropertyName("margins")]\n    public DjuiStretchMarginsJson? Margins { get; set; }\n}\n\npublic class DjuiStretchMarginsJson\n{\n    [JsonPropertyName("left")]\n    public float Left { get; set; }\n\n    [JsonPropertyName("right")]\n    public float Right { get; set; }\n\n    [JsonPropertyName("top")]\n    public float Top { get; set; }\n\n    [JsonPropertyName("bottom")]\n    public float Bottom { get; set; }\n}\n\npublic class DjuiAspectRatioJson\n{\n    // \u6A21\u5F0F\uFF1ANone / WidthControlsHeight / HeightControlsWidth / FitInParent / EnvelopeParent\n    [JsonPropertyName("mode")]\n    public string? Mode { get; set; }\n\n    // \u5BBD / \u9AD8\n    [JsonPropertyName("ratio")]\n    public float? Ratio { get; set; }\n}\n\npublic class Vec2Json\n{\n    [JsonPropertyName("x")]\n    public float X { get; set; }\n\n    [JsonPropertyName("y")]\n    public float Y { get; set; }\n}\n\npublic class DjuiBasicJson\n{\n    [JsonPropertyName("visible")]\n    public bool? Visible { get; set; }\n\n    [JsonPropertyName("disabled")]\n    public bool? Disabled { get; set; }\n\n    [JsonPropertyName("isStatic")]\n    public bool? IsStatic { get; set; }\n}\n\npublic class DjuiTransformJson\n{\n    [JsonPropertyName("positionType")]\n    public string? PositionType { get; set; }\n\n    [JsonPropertyName("x")]\n    public float? X { get; set; }\n\n    [JsonPropertyName("y")]\n    public float? Y { get; set; }\n\n    [JsonPropertyName("width")]\n    public float? Width { get; set; }\n\n    [JsonPropertyName("height")]\n    public float? Height { get; set; }\n\n    [JsonPropertyName("rotation")]\n    public float? Rotation { get; set; }\n\n    [JsonPropertyName("scale")]\n    public float[]? Scale { get; set; }\n\n    [JsonPropertyName("opacity")]\n    public float? Opacity { get; set; }\n\n    [JsonPropertyName("zIndex")]\n    public int? ZIndex { get; set; }\n\n    // \u2605 \u4E2D\u5FC3\u70B9\uFF080~1\uFF0C\u5C4F\u5E55\u7EA6\u5B9A Y \u671D\u4E0B\uFF1A0=\u9876 1=\u5E95\uFF09\n    [JsonPropertyName("pivot")]\n    public Vec2Json? Pivot { get; set; }\n}\n\npublic class DjuiAppearanceJson\n{\n    [JsonPropertyName("image")]\n    public string? Image { get; set; }\n\n    [JsonPropertyName("background")]\n    public string? Background { get; set; }\n\n    [JsonPropertyName("imageTint")]\n    public string? ImageTint { get; set; }\n\n    [JsonPropertyName("borderThickness")]\n    public float? BorderThickness { get; set; }\n\n    [JsonPropertyName("borderColor")]\n    public string? BorderColor { get; set; }\n\n    [JsonPropertyName("cornerRadius")]\n    public float? CornerRadius { get; set; }\n\n    [JsonPropertyName("clipContent")]\n    public bool? ClipContent { get; set; }\n\n    [JsonPropertyName("desaturated")]\n    public bool? Desaturated { get; set; }\n\n    [JsonPropertyName("imageFlipX")]\n    public bool? ImageFlipX { get; set; }\n\n    [JsonPropertyName("imageFlipY")]\n    public bool? ImageFlipY { get; set; }\n\n    [JsonPropertyName("slicedEdges")]\n    public float[]? SlicedEdges { get; set; } // [left, top, right, bottom]\n}\n\npublic class DjuiLayoutJson\n{\n    [JsonPropertyName("margin")]\n    public float[]? Margin { get; set; }\n\n    [JsonPropertyName("padding")]\n    public float[]? Padding { get; set; }\n\n    [JsonPropertyName("autoSize")]\n    public string? AutoSize { get; set; }\n\n    [JsonPropertyName("flowOrientation")]\n    public string? FlowOrientation { get; set; }\n\n    [JsonPropertyName("spacing")]\n    public float? Spacing { get; set; } // v6 \u534F\u8BAE\u4E3A float[] \u4E8C\u5143\u7EC4 [\u6C34\u5E73, \u5782\u76F4]\uFF1Bv4 \u4EC5\u5386\u53F2\u5355\u503C\uFF08\u65B0\u7F16\u8F91\u5668\u53EA\u4EA7 v6 \u6587\u4EF6\uFF0Cv4 \u94FE\u8DEF\u96F6\u6D88\u8D39\uFF09\n\n    [JsonPropertyName("horizontalAlignment")]\n    public string? HorizontalAlignment { get; set; }\n\n    [JsonPropertyName("verticalAlignment")]\n    public string? VerticalAlignment { get; set; }\n\n    [JsonPropertyName("horizontalContentAlignment")]\n    public string? HorizontalContentAlignment { get; set; }\n\n    [JsonPropertyName("verticalContentAlignment")]\n    public string? VerticalContentAlignment { get; set; }\n\n    // \u4EE5\u4E0B\u56DB\u4E2A\u4E3A 0.29.0 \u5BB9\u5668\u6392\u5217\u7CFB\u7EDF\u7684\u5E03\u5C40\u7EC4\u5B57\u6BB5\uFF0C\u4E0E v6 DjuiLayoutV6 \u5BF9\u9F50\u7684\u6A21\u578B\u6587\u6863\u6027\u58F0\u660E\uFF1A\n    // v4 \u8FD0\u884C\u6001\u96F6\u6392\u7248\uFF08\u89C1 DjuiUiLoader \u7684\u8FD0\u884C\u6001\u96F6\u6392\u7248\u6CE8\u91CA\uFF09\u3001\u5BBD\u677E\u53CD\u5E8F\u5217\u5316\u81EA\u52A8\u8DF3\u8FC7\u672A\u6620\u5C04\u6210\u5458\uFF0C\u65B0\u5B57\u6BB5\u96F6\u6D88\u8D39\u3002\n    [JsonPropertyName("gridFlow")]\n    public string? GridFlow { get; set; }\n\n    [JsonPropertyName("gridCount")]\n    public int? GridCount { get; set; }\n\n    [JsonPropertyName("childOrder")]\n    public string? ChildOrder { get; set; }\n\n    [JsonPropertyName("autoRelayout")]\n    public bool? AutoRelayout { get; set; }\n}\n\npublic class DjuiInteractionJson\n{\n    [JsonPropertyName("routedEvents")]\n    public string? RoutedEvents { get; set; }\n\n    [JsonPropertyName("allowDrag")]\n    public bool? AllowDrag { get; set; }\n\n    [JsonPropertyName("allowDrop")]\n    public bool? AllowDrop { get; set; }\n\n    [JsonPropertyName("behaviors")]\n    public List<DjuiTouchBehaviorJson>? Behaviors { get; set; }\n}\n\npublic class DjuiTouchBehaviorJson\n{\n    [JsonPropertyName("type")]\n    public string? Type { get; set; }\n\n    [JsonPropertyName("scaleFactor")]\n    public float? ScaleFactor { get; set; }\n\n    [JsonPropertyName("enablePressAnimation")]\n    public bool? EnablePressAnimation { get; set; }\n\n    [JsonPropertyName("enableLongPress")]\n    public bool? EnableLongPress { get; set; }\n}\n\npublic class DjuiEffectsJson\n{\n    [JsonPropertyName("preset")]\n    public string? Preset { get; set; }\n}\n\npublic class DjuiTextJson\n{\n    [JsonPropertyName("text")]\n    public string? Text { get; set; }\n\n    [JsonPropertyName("fontSize")]\n    public float? FontSize { get; set; }\n\n    [JsonPropertyName("textColor")]\n    public string? TextColor { get; set; }\n\n    [JsonPropertyName("strokeSize")]\n    public float? StrokeSize { get; set; }\n\n    [JsonPropertyName("strokeColor")]\n    public string? StrokeColor { get; set; }\n\n    [JsonPropertyName("bold")]\n    public bool? Bold { get; set; }\n\n    [JsonPropertyName("font")]\n    public string? Font { get; set; }\n\n    [JsonPropertyName("textWrap")]\n    public bool? TextWrap { get; set; }\n\n    [JsonPropertyName("textOverflow")]\n    public string? TextOverflow { get; set; }\n}\n\npublic class DjuiButtonJson\n{\n    [JsonPropertyName("imageHover")]\n    public string? ImageHover { get; set; }\n\n    [JsonPropertyName("imagePressed")]\n    public string? ImagePressed { get; set; }\n}\n\npublic class DjuiProgressJson\n{\n    [JsonPropertyName("value")]\n    public float? Value { get; set; }\n\n    [JsonPropertyName("progressionMode")]\n    public string? ProgressionMode { get; set; }\n\n    [JsonPropertyName("rotation")]\n    public float? Rotation { get; set; }\n}\n\npublic class DjuiExtensionJson\n{\n    [JsonPropertyName("action")]\n    public string? Action { get; set; }\n\n    [JsonPropertyName("clickSoundId")]\n    public string? ClickSoundId { get; set; }\n\n    [JsonPropertyName("locked")]\n    public bool? Locked { get; set; }\n}\n';

// raw:D:\git\DJUI\runtime\DjuiProtocolV6.cs
var DjuiProtocolV6_default = '// DJUI Runtime - protocol v6 isolated models (v5 loader remains unchanged)\nusing System.Collections.Generic;\nusing System.Text.Json;\nusing System.Text.Json.Serialization;\n\nnamespace DjuiRuntime;\n\npublic static class DjuiProtocolV6\n{\n    public const int ProtocolVersion = 6;\n    public const int SchemaVersion = 1;\n}\n\npublic sealed class DjuiProjectV6\n{\n    [JsonPropertyName("protocolVersion")] public int ProtocolVersion { get; set; } = DjuiProtocolV6.ProtocolVersion;\n    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; } = DjuiProtocolV6.SchemaVersion;\n    [JsonPropertyName("projectId")] public string? ProjectId { get; set; }\n    [JsonPropertyName("name")] public string? Name { get; set; }\n    [JsonPropertyName("orientation")] public string Orientation { get; set; } = "portrait";\n    [JsonPropertyName("canvas")] public DjuiCanvasConfigV6 Canvas { get; set; } = new();\n    [JsonPropertyName("responsive")] public DjuiResponsiveConfigV6 Responsive { get; set; } = new();\n    [JsonPropertyName("defaultFont")] public string? DefaultFont { get; set; }\n\n    // 0.8.0 \u53EF\u9009\u5B57\u6BB5\uFF1A\u5173\u95ED\u9875\u9762\u7684\u4FDD\u7559\u6C60\u914D\u7F6E\uFF08\u7F3A\u7701\uFF1D\u7A7A\u540D\u5355\uFF0B\u9ED8\u8BA4\u5BB9\u91CF\uFF0C\u8001\u5DE5\u7A0B\u96F6\u914D\u7F6E\u5373\u4EAB\u6C60\u5316\uFF09\n    [JsonPropertyName("retainedPages")] public List<string>? RetainedPages { get; set; }\n    [JsonPropertyName("poolCapacity")] public int? PoolCapacity { get; set; }\n}\n\npublic sealed class DjuiCanvasConfigV6\n{\n    [JsonPropertyName("referenceWidth")] public float ReferenceWidth { get; set; } = 900;\n    [JsonPropertyName("referenceHeight")] public float ReferenceHeight { get; set; } = 1600;\n    [JsonPropertyName("mode")] public string Mode { get; set; } = "Contain";\n}\n\npublic sealed class DjuiResponsiveConfigV6\n{\n    [JsonPropertyName("wideRatio")] public float WideRatio { get; set; } = 1.25f;\n}\n\npublic sealed class DjuiPageV6\n{\n    [JsonPropertyName("protocolVersion")] public int ProtocolVersion { get; set; } = DjuiProtocolV6.ProtocolVersion;\n    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; } = DjuiProtocolV6.SchemaVersion;\n    [JsonPropertyName("pageId")] public string PageId { get; set; } = "";\n    [JsonPropertyName("kind")] public string Kind { get; set; } = "window";\n    [JsonPropertyName("localSize")] public DjuiSizeV6? LocalSize { get; set; }\n    [JsonPropertyName("window")] public DjuiWindowConfigV6? Window { get; set; }\n    [JsonPropertyName("root")] public DjuiNodeV6 Root { get; set; } = new();\n    [JsonPropertyName("responsive")] public DjuiPageResponsiveV6? Responsive { get; set; }\n}\n\npublic sealed class DjuiSizeV6 { [JsonPropertyName("width")] public float Width { get; set; } [JsonPropertyName("height")] public float Height { get; set; } }\npublic sealed class DjuiWindowConfigV6 { [JsonPropertyName("mode")] public string? Mode { get; set; } [JsonPropertyName("transition")] public DjuiTransitionV6? Transition { get; set; } }\npublic sealed class DjuiTransitionV6 { [JsonPropertyName("open")] public string? Open { get; set; } [JsonPropertyName("close")] public string? Close { get; set; } }\npublic sealed class DjuiPageResponsiveV6 { [JsonPropertyName("wide")] public DjuiWideOverridesV6 Wide { get; set; } = new(); }\npublic sealed class DjuiWideOverridesV6 { [JsonPropertyName("overrides")] public Dictionary<string, Dictionary<string, JsonElement>> Overrides { get; set; } = new(); }\n\n[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)]\npublic sealed class DjuiNodeV6\n{\n    [JsonPropertyName("id")] public string Id { get; set; } = "";\n    [JsonPropertyName("starType")] public string StarType { get; set; } = "Panel";\n    [JsonPropertyName("name")] public string? Name { get; set; }\n    [JsonPropertyName("basic")] public DjuiBasicV6? Basic { get; set; }\n    [JsonPropertyName("transform")] public DjuiTransformV6? Transform { get; set; }\n    [JsonPropertyName("anchor")] public DjuiAnchorV6? Anchor { get; set; }\n    [JsonPropertyName("stretch")] public DjuiStretchV6? Stretch { get; set; }\n    [JsonPropertyName("aspectRatio")] public DjuiAspectRatioV6? AspectRatio { get; set; }\n    [JsonPropertyName("sceneFrame")] public DjuiSceneFrameV6? SceneFrame { get; set; }\n    [JsonPropertyName("appearance")] public DjuiAppearanceV6? Appearance { get; set; }\n    [JsonPropertyName("text")] public DjuiTextV6? Text { get; set; }\n    [JsonPropertyName("button")] public DjuiButtonV6? Button { get; set; }\n    [JsonPropertyName("progress")] public DjuiProgressV6? Progress { get; set; }\n    [JsonPropertyName("layout")] public DjuiLayoutV6? Layout { get; set; }\n    [JsonPropertyName("interaction")] public DjuiInteractionV6? Interaction { get; set; }\n    [JsonPropertyName("effects")] public DjuiEffectsV6? Effects { get; set; }\n    [JsonPropertyName("djui")] public DjuiExtensionsV6? Djui { get; set; }\n    [JsonPropertyName("widthStretchRatio")] public float? WidthStretchRatio { get; set; }\n    [JsonPropertyName("heightStretchRatio")] public float? HeightStretchRatio { get; set; }\n    [JsonPropertyName("widthCompactRatio")] public float? WidthCompactRatio { get; set; }\n    [JsonPropertyName("heightCompactRatio")] public float? HeightCompactRatio { get; set; }\n    [JsonPropertyName("templateRef")] public string? TemplateRef { get; set; }\n    [JsonPropertyName("templateOverrides")] public Dictionary<string, Dictionary<string, JsonElement>>? TemplateOverrides { get; set; }\n    [JsonIgnore] public DjuiSizeV6? TemplateLocalSize { get; set; }\n    [JsonPropertyName("children")] public List<DjuiNodeV6> Children { get; set; } = new();\n}\n\npublic sealed class DjuiTransformV6\n{\n    [JsonPropertyName("x")] public float? X { get; set; }\n    [JsonPropertyName("y")] public float? Y { get; set; }\n    [JsonPropertyName("width")] public float? Width { get; set; }\n    [JsonPropertyName("height")] public float? Height { get; set; }\n    [JsonPropertyName("rotation")] public float? Rotation { get; set; }\n    [JsonPropertyName("scale")] public float[]? Scale { get; set; }\n    [JsonPropertyName("opacity")] public float? Opacity { get; set; }\n    [JsonPropertyName("zIndex")] public int? ZIndex { get; set; }\n}\npublic sealed class DjuiAnchorV6\n{\n    [JsonPropertyName("target")] public string Target { get; set; } = "parent";\n    [JsonPropertyName("side")] public string Side { get; set; } = "TopLeft";\n    [JsonPropertyName("safeEdges")] public List<string> SafeEdges { get; set; } = new() { "left", "top", "right", "bottom" };\n}\npublic sealed class DjuiStretchV6 { [JsonPropertyName("style")] public string Style { get; set; } = "None"; [JsonPropertyName("margins")] public DjuiInsetsV6? Margins { get; set; } }\npublic sealed class DjuiAspectRatioV6 { [JsonPropertyName("mode")] public string Mode { get; set; } = "None"; [JsonPropertyName("ratio")] public float Ratio { get; set; } = 1; }\npublic sealed class DjuiSceneFrameV6 { [JsonPropertyName("backgroundId")] public string BackgroundId { get; set; } = ""; [JsonPropertyName("artboard")] public DjuiSizeV6 Artboard { get; set; } = new(); }\n\npublic sealed class DjuiBasicV6\n{\n    [JsonPropertyName("visible")] public bool? Visible { get; set; }\n    [JsonPropertyName("disabled")] public bool? Disabled { get; set; }\n    [JsonPropertyName("isStatic")] public bool? IsStatic { get; set; }\n}\n\npublic sealed class DjuiAppearanceV6\n{\n    [JsonPropertyName("image")] public string? Image { get; set; }\n    [JsonPropertyName("background")] public string? Background { get; set; }\n    /// <summary>\u56FE\u7247\u67D3\u8272\uFF08\u4E58\u7B97 tint\uFF0Chex \u989C\u8272\u4E32\uFF09\u3002\u5F15\u64CE\u8BED\u4E49\uFF1ABackground \u753B\u5237\u4E0E Image \u540C\u63A7\u4EF6\u65F6\u4E58\u7B97\u6DF7\u5408\u3001\n    /// \u53EA\u4F5C\u7528\u56FE\u7247\u50CF\u7D20\uFF08\u900F\u660E\u5904\u4FDD\u6301\u900F\u660E\uFF0C\u63A2\u9488 1003 \u5B9E\u6D4B\uFF09\uFF0C\u8DE8\u63A7\u4EF6\u4E0D\u4F5C\u7528\u2014\u2014\u6545\u5FC5\u987B\u843D\u5728 visual \u5B50\u5C42\u4E0A\u3002</summary>\n    [JsonPropertyName("imageTint")] public string? ImageTint { get; set; }\n    [JsonPropertyName("imageMask")] public string? ImageMask { get; set; }\n    [JsonPropertyName("slicedEdges")] public float[]? SlicedEdges { get; set; }\n    [JsonPropertyName("imageBlurLevel")] public float? ImageBlurLevel { get; set; }\n    [JsonPropertyName("imageFit")] public string ImageFit { get; set; } = "stretch";\n    [JsonPropertyName("focalX")] public float? FocalX { get; set; }\n    [JsonPropertyName("focalY")] public float? FocalY { get; set; }\n    [JsonPropertyName("sourceSize")] public DjuiSizeV6? SourceSize { get; set; }\n    [JsonPropertyName("borderThickness")] public float? BorderThickness { get; set; }\n    [JsonPropertyName("borderColor")] public string? BorderColor { get; set; }\n    [JsonPropertyName("cornerRadius")] public float? CornerRadius { get; set; }\n    [JsonPropertyName("clipContent")] public bool? ClipContent { get; set; }\n    [JsonPropertyName("desaturated")] public bool? Desaturated { get; set; }\n    [JsonPropertyName("imageFlipX")] public bool? ImageFlipX { get; set; }\n    [JsonPropertyName("imageFlipY")] public bool? ImageFlipY { get; set; }\n}\n\npublic sealed class DjuiTextV6\n{\n    [JsonPropertyName("text")] public string? Text { get; set; }\n    [JsonPropertyName("fontSize")] public float? FontSize { get; set; }\n    [JsonPropertyName("textColor")] public string? TextColor { get; set; }\n    [JsonPropertyName("strokeSize")] public float? StrokeSize { get; set; }\n    [JsonPropertyName("strokeColor")] public string? StrokeColor { get; set; }\n    [JsonPropertyName("bold")] public bool? Bold { get; set; }\n    [JsonPropertyName("font")] public string? Font { get; set; }\n    [JsonPropertyName("textWrap")] public bool? TextWrap { get; set; }\n    [JsonPropertyName("textOverflow")] public string? TextOverflow { get; set; }\n}\n\n\npublic sealed class DjuiInteractionV6\n{\n    [JsonPropertyName("routedEvents")] public string? RoutedEvents { get; set; }\n    [JsonPropertyName("allowDrag")] public bool? AllowDrag { get; set; }\n    [JsonPropertyName("allowDrop")] public bool? AllowDrop { get; set; }\n    [JsonPropertyName("behaviors")] public List<DjuiTouchBehaviorV6>? Behaviors { get; set; }\n}\npublic sealed class DjuiTouchBehaviorV6\n{\n    [JsonPropertyName("type")] public string? Type { get; set; }\n    [JsonPropertyName("scaleFactor")] public float? ScaleFactor { get; set; }\n    [JsonPropertyName("enablePressAnimation")] public bool? EnablePressAnimation { get; set; }\n    [JsonPropertyName("enableLongPress")] public bool? EnableLongPress { get; set; }\n}\npublic sealed class DjuiEffectsV6 { [JsonPropertyName("preset")] public string? Preset { get; set; } }\n\npublic sealed class DjuiLayoutV6\n{\n    [JsonPropertyName("margin")] public float[]? Margin { get; set; }\n    [JsonPropertyName("padding")] public float[]? Padding { get; set; }\n    [JsonPropertyName("autoSize")] public string? AutoSize { get; set; }\n    [JsonPropertyName("flowOrientation")] public string? FlowOrientation { get; set; }\n    // \u95F4\u8DDD\u4E8C\u5143\u7EC4 [\u6C34\u5E73, \u5782\u76F4]\uFF1B\u65E7\u7F16\u8F91\u5668\u4EA7\u51FA\u7684\u5355\u503C number \u7531 DjuiSpacingArrayConverter \u517C\u5BB9\u8BFB\u4E3A [v, v]\n    [JsonPropertyName("spacing")]\n    [JsonConverter(typeof(DjuiSpacingArrayConverter))]\n    public float[]? Spacing { get; set; }\n    [JsonPropertyName("horizontalAlignment")] public string? HorizontalAlignment { get; set; }\n    [JsonPropertyName("verticalAlignment")] public string? VerticalAlignment { get; set; }\n    [JsonPropertyName("horizontalContentAlignment")] public string? HorizontalContentAlignment { get; set; }\n    [JsonPropertyName("verticalContentAlignment")] public string? VerticalContentAlignment { get; set; }\n    [JsonPropertyName("gridFlow")] public string? GridFlow { get; set; }\n    [JsonPropertyName("gridCount")] public int? GridCount { get; set; }\n    [JsonPropertyName("childOrder")] public string? ChildOrder { get; set; }\n    [JsonPropertyName("autoRelayout")] public bool? AutoRelayout { get; set; }\n}\n\n/// <summary>\n/// layout.spacing \u8FC7\u6E21\u671F\u517C\u5BB9\uFF1Av6 \u9875\u9762\u4E25\u683C\u53CD\u5E8F\u5217\u5316\uFF08UnmappedMemberHandling=Disallow\uFF09\u4E0B\uFF0C\n/// \u65E7\u7F16\u8F91\u5668\u4EA7\u51FA\u7684\u5355\u503C number \u8BFB\u4E3A [v, v] \u4E8C\u5143\u7EC4\uFF08\u81EA 0.29.0 \u8D77 10 \u4E2A\u7248\u672C\u540E\u5220\u9664\uFF09\u3002\n/// \u7578\u5F62\u6570\u7EC4\u957F\u5EA6\u515C\u5E95\uFF1A0 \u2192 [0,0]\u30011 \u2192 [v,v]\u3001\u22652 \u53D6\u524D\u4E24\u9879\u2014\u2014\u9632\u4E0B\u6E38 Spacing[1] \u7D22\u5F15\u8D8A\u754C\u3002\n/// Write \u53EA\u5199\u6570\u7EC4\u5F62\u6001\uFF08\u540C\u6B3E\u957F\u5EA6\u515C\u5E95\uFF09\uFF0C\u4FDD\u8BC1\u56DE\u5199\u6587\u4EF6\u6052\u4E3A\u65B0\u683C\u5F0F\u3002\n/// </summary>\npublic sealed class DjuiSpacingArrayConverter : JsonConverter<float[]?>\n{\n    public override float[]? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)\n    {\n        if (reader.TokenType == JsonTokenType.Null) return null;\n        if (reader.TokenType == JsonTokenType.Number)\n        {\n            var single = reader.GetSingle();\n            return new[] { single, single };\n        }\n        if (reader.TokenType == JsonTokenType.StartArray)\n        {\n            var values = new List<float>();\n            while (reader.Read())\n            {\n                if (reader.TokenType == JsonTokenType.EndArray) break;\n                if (reader.TokenType == JsonTokenType.Number) values.Add(reader.GetSingle());\n                else reader.Skip();\n            }\n            if (values.Count == 0) return new[] { 0f, 0f };\n            if (values.Count == 1) return new[] { values[0], values[0] };\n            return new[] { values[0], values[1] };\n        }\n        throw new JsonException($"DJUI v6: layout.spacing \u975E\u6CD5\u5F62\u6001: {reader.TokenType}");\n    }\n\n    public override void Write(Utf8JsonWriter writer, float[]? value, JsonSerializerOptions options)\n    {\n        if (value == null)\n        {\n            writer.WriteNullValue();\n            return;\n        }\n        writer.WriteStartArray();\n        switch (value.Length)\n        {\n            case 0:\n                writer.WriteNumberValue(0f);\n                writer.WriteNumberValue(0f);\n                break;\n            case 1:\n                writer.WriteNumberValue(value[0]);\n                writer.WriteNumberValue(value[0]);\n                break;\n            default:\n                writer.WriteNumberValue(value[0]);\n                writer.WriteNumberValue(value[1]);\n                break;\n        }\n        writer.WriteEndArray();\n    }\n}\n\npublic sealed class DjuiExtensionsV6\n{\n    [JsonPropertyName("action")] public string? Action { get; set; }\n    [JsonPropertyName("clickSoundId")] public string? ClickSoundId { get; set; }\n    [JsonPropertyName("bindings")] public Dictionary<string, string>? Bindings { get; set; }\n    [JsonPropertyName("locked")] public bool? Locked { get; set; }\n}\n\npublic sealed class DjuiButtonV6\n{\n    [JsonPropertyName("imageHover")] public string? ImageHover { get; set; }\n    [JsonPropertyName("imagePressed")] public string? ImagePressed { get; set; }\n    [JsonPropertyName("imageDisabled")] public string? ImageDisabled { get; set; }\n}\n\npublic sealed class DjuiProgressV6\n{\n    [JsonPropertyName("value")] public float? Value { get; set; }\n    [JsonPropertyName("progressionMode")] public string? ProgressionMode { get; set; }\n    [JsonPropertyName("rotation")] public float? Rotation { get; set; }\n}\n';

// raw:D:\git\DJUI\runtime\DjuiResponsiveResolverV6.cs
var DjuiResponsiveResolverV6_default = 'using System.Text.Json;\n\nnamespace DjuiRuntime;\n\n/// <summary>Applies the closed v6 wide-tier override allowlist to an isolated page copy.</summary>\npublic static class DjuiResponsiveResolverV6\n{\n    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = false };\n\n    public static DjuiPageV6 Resolve(DjuiPageV6 source, bool wide)\n    {\n        ArgumentNullException.ThrowIfNull(source);\n        if (!wide || source.Responsive?.Wide?.Overrides.Count is not > 0) return source;\n        var json = JsonSerializer.Serialize(source, JsonOptions);\n        var page = JsonSerializer.Deserialize<DjuiPageV6>(json, JsonOptions)\n            ?? throw new InvalidDataException("DJUI v6: \u54CD\u5E94\u5F0F\u9875\u9762\u590D\u5236\u5931\u8D25");\n        CopyRuntimeMetadata(source.Root, page.Root);\n        var nodes = new Dictionary<string, DjuiNodeV6>(StringComparer.Ordinal);\n        Index(page.Root, nodes);\n        foreach (var (nodeId, fields) in page.Responsive!.Wide.Overrides)\n        {\n            if (!nodes.TryGetValue(nodeId, out var node)) throw new InvalidDataException($"DJUI v6: wide \u8986\u76D6\u5F15\u7528\u4E0D\u5B58\u5728\u7684\u8282\u70B9: {nodeId}");\n            foreach (var (path, value) in fields) Apply(node, path, value);\n        }\n        return page;\n    }\n\n    private static void Index(DjuiNodeV6 node, Dictionary<string, DjuiNodeV6> nodes)\n    {\n        if (string.IsNullOrWhiteSpace(node.Id) || !nodes.TryAdd(node.Id, node)) throw new InvalidDataException($"DJUI v6: \u9875\u9762\u8282\u70B9 ID \u4E3A\u7A7A\u6216\u91CD\u590D: {node.Id}");\n        foreach (var child in node.Children) Index(child, nodes);\n    }\n\n    private static void CopyRuntimeMetadata(DjuiNodeV6 source, DjuiNodeV6 target)\n    {\n        if (!string.Equals(source.Id, target.Id, StringComparison.Ordinal) || source.Children.Count != target.Children.Count)\n            throw new InvalidDataException("DJUI v6: responsive clone structure changed");\n        target.TemplateLocalSize = source.TemplateLocalSize == null ? null : new DjuiSizeV6 { Width = source.TemplateLocalSize.Width, Height = source.TemplateLocalSize.Height };\n        for (var i = 0; i < source.Children.Count; i++) CopyRuntimeMetadata(source.Children[i], target.Children[i]);\n    }\n\n    internal static void ApplyOverride(DjuiNodeV6 node, string path, JsonElement value) => Apply(node, path, value);\n\n    private static void Apply(DjuiNodeV6 node, string path, JsonElement value)\n    {\n        switch (path)\n        {\n            case "basic.visible": (node.Basic ??= new()).Visible = Bool(value, path); break;\n            case "basic.disabled": (node.Basic ??= new()).Disabled = Bool(value, path); break;\n            case "transform.x": (node.Transform ??= new()).X = Number(value, path); break;\n            case "transform.y": (node.Transform ??= new()).Y = Number(value, path); break;\n            case "transform.width": (node.Transform ??= new()).Width = Number(value, path); break;\n            case "transform.height": (node.Transform ??= new()).Height = Number(value, path); break;\n            case "appearance.image": (node.Appearance ??= new()).Image = NullableString(value, path); break;\n            case "appearance.imageTint": (node.Appearance ??= new()).ImageTint = NullableString(value, path); break;\n            case "appearance.background": (node.Appearance ??= new()).Background = NullableString(value, path); break;\n            case "appearance.imageFit": (node.Appearance ??= new()).ImageFit = EnumString(value, path, "stretch", "contain", "cover"); break;\n            case "appearance.focalX": (node.Appearance ??= new()).FocalX = Unit(value, path); break;\n            case "appearance.focalY": (node.Appearance ??= new()).FocalY = Unit(value, path); break;\n            case "appearance.borderThickness": (node.Appearance ??= new()).BorderThickness = Number(value, path); break;\n            case "appearance.borderColor": (node.Appearance ??= new()).BorderColor = NullableString(value, path); break;\n            case "text.text": (node.Text ??= new()).Text = NullableString(value, path); break;\n            case "text.fontSize": (node.Text ??= new()).FontSize = Number(value, path); break;\n            case "text.textColor": (node.Text ??= new()).TextColor = NullableString(value, path); break;\n            case "text.strokeSize": (node.Text ??= new()).StrokeSize = Number(value, path); break;\n            case "text.strokeColor": (node.Text ??= new()).StrokeColor = NullableString(value, path); break;\n            case "text.bold": (node.Text ??= new()).Bold = Bool(value, path); break;\n            case "text.font": (node.Text ??= new()).Font = NullableString(value, path); break;\n            case "text.textWrap": (node.Text ??= new()).TextWrap = Bool(value, path); break;\n            case "button.imageHover": (node.Button ??= new()).ImageHover = NullableString(value, path); break;\n            case "button.imagePressed": (node.Button ??= new()).ImagePressed = NullableString(value, path); break;\n            case "button.imageDisabled": (node.Button ??= new()).ImageDisabled = NullableString(value, path); break;\n            case "progress.value": (node.Progress ??= new()).Value = Unit(value, path); break;\n            default: throw new InvalidDataException($"DJUI v6: \u4E0D\u5141\u8BB8\u54CD\u5E94\u5F0F\u8986\u76D6\u5B57\u6BB5: {path}");\n        }\n    }\n\n    private static float Number(JsonElement value, string path) => value.ValueKind == JsonValueKind.Number && value.TryGetSingle(out var result) && float.IsFinite(result) ? result : throw Invalid(path);\n    private static float Unit(JsonElement value, string path) => Math.Clamp(Number(value, path), 0, 1);\n    private static bool Bool(JsonElement value, string path) => value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : throw Invalid(path);\n    private static string? NullableString(JsonElement value, string path) => value.ValueKind == JsonValueKind.Null ? null : value.ValueKind == JsonValueKind.String ? value.GetString() : throw Invalid(path);\n    private static string EnumString(JsonElement value, string path, params string[] legal)\n    {\n        var result = NullableString(value, path) ?? throw Invalid(path);\n        return legal.Contains(result, StringComparer.Ordinal) ? result : throw Invalid(path);\n    }\n    private static InvalidDataException Invalid(string path) => new($"DJUI v6: \u54CD\u5E94\u5F0F\u8986\u76D6\u503C\u65E0\u6548: {path}");\n}\n';

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
var DjuiTransitionPlayer_default = '#if CLIENT\r\n\r\nusing GameUI.Control;\r\n\r\nnamespace DjuiRuntime;\r\n\r\npublic sealed class DjuiTransitionPlayer : IThinker\r\n{\r\n    private static readonly List<TransitionAnimation> Animations = new();\r\n    private static DjuiTransitionPlayer? _instance;\r\n    private static int _nextId;\r\n\r\n    public bool DoesThink { get; set; } = true;\r\n\r\n    public static int Play(Control control, string? presetName, Action? onComplete = null)\r\n        => PlayCore(control, presetName, onComplete, null);\r\n\r\n    /// <summary>v6 \u7A97\u53E3\u7EDF\u4E00\u5165\u53E3\uFF1B\u53EA\u6709 popup \u7684\u5185\u7F6E\u51E0\u4F55\u8F6C\u573A\u81EA\u52A8\u56FA\u5B9A\u5168\u5C4F\u5C42\u3002</summary>\r\n    public static int PlayWindow(DjuiTreeInstanceV6 instance, string? presetName, Action? onComplete = null)\r\n        => PlayCore(instance.Root, presetName, onComplete, instance);\r\n\r\n    private static int PlayCore(Control control, string? presetName, Action? onComplete, DjuiTreeInstanceV6? instance)\r\n    {\r\n        if (control == null || !control.IsValid)\r\n            return -1;\r\n\r\n        if (string.IsNullOrWhiteSpace(presetName) || string.Equals(presetName, "none", StringComparison.OrdinalIgnoreCase))\r\n            return -1;\r\n\r\n        if (!DjuiTransitionRegistry.TryGet(presetName, out var preset))\r\n        {\r\n            Game.Logger.LogWarning("DJUI: \u672A\u77E5\u7A97\u53E3\u8F6C\u573A\u9884\u8BBE {Name}", presetName);\r\n            return -1;\r\n        }\r\n\r\n        Stop(control);\r\n\r\n        var id = ++_nextId;\r\n        var snapshot = DjuiWindowTransitionV6.Snapshot(control);\r\n        var windowTarget = instance != null && instance.Session.CurrentPage.Window?.Mode == "popup" && preset.CoordinateWindowContent\r\n            ? new DjuiWindowTransitionV6(instance, preset) : null;\r\n        var animation = new TransitionAnimation(id, control, preset, snapshot, onComplete, windowTarget);\r\n        Animations.Add(animation);\r\n        animation.Apply(0f);\r\n        EnsureRegistered();\r\n        return id;\r\n    }\r\n\r\n    public static void Stop(int id)\r\n    {\r\n        for (var i = Animations.Count - 1; i >= 0; i--)\r\n        {\r\n            if (Animations[i].Id == id)\r\n            {\r\n                Animations[i].Restore();\r\n                Animations.RemoveAt(i);\r\n            }\r\n        }\r\n    }\r\n\r\n    public static void Stop(Control control)\r\n    {\r\n        for (var i = Animations.Count - 1; i >= 0; i--)\r\n        {\r\n            if (ReferenceEquals(Animations[i].Control, control))\r\n            {\r\n                Animations[i].Restore();\r\n                Animations.RemoveAt(i);\r\n            }\r\n        }\r\n    }\r\n\r\n    private static void EnsureRegistered()\r\n    {\r\n        if (_instance != null) return;\r\n        _instance = new DjuiTransitionPlayer();\r\n        Game.RegisterThinker(_instance);\r\n    }\r\n\r\n    public void Think(int delta)\r\n    {\r\n        var dt = delta / 1000f;\r\n        // \u5B8C\u6210\u56DE\u8C03\u53EF\u5F00/\u5173\u5176\u4ED6\u7A97\u53E3\uFF1B\u904D\u5386\u672C\u5E27\u5FEB\u7167\u907F\u514D\u56DE\u8C03\u4FEE\u6539\u5217\u8868\u540E\u8D8A\u754C\u6216\u91CD\u653E\u3002\r\n        var frameAnimations = Animations.ToArray();\r\n        for (var i = frameAnimations.Length - 1; i >= 0; i--)\r\n        {\r\n            var animation = frameAnimations[i];\r\n            if (!Animations.Contains(animation)) continue;\r\n            if (!animation.Control.IsValid)\r\n            {\r\n                Animations.Remove(animation);\r\n                animation.Restore();\r\n                continue;\r\n            }\r\n\r\n            animation.Elapsed += dt;\r\n            var progress = Math.Clamp(animation.Elapsed / animation.Preset.Duration, 0f, 1f);\r\n            animation.Apply(progress);\r\n\r\n            if (progress >= 1f)\r\n            {\r\n                Animations.Remove(animation);\r\n                animation.Restore();   // \u7EC8\u5E27\u5F52\u4E00\uFF1A\u6062\u590D\u8F6C\u573A\u524D\u5FEB\u7167\u2014\u2014close \u8F6C\u573A\u7EC8\u6001\uFF08opacity=0 \u7B49\uFF09\u4E0D\u80FD\u6B8B\u7559\uFF0C\u7A97\u53E3\u4FDD\u7559\u6C60\u590D\u7528\u65F6 open \u8F6C\u573A\u4F1A\u4EE5\u5F53\u524D\u503C\u4E3A\u5FEB\u7167\u521D\u59CB\r\n                animation.OnComplete?.Invoke();\r\n            }\r\n        }\r\n    }\r\n\r\n    private sealed class TransitionAnimation\r\n    {\r\n        public TransitionAnimation(\r\n            int id,\r\n            Control control,\r\n            DjuiTransitionPreset preset,\r\n            DjuiTransitionSnapshot snapshot,\r\n            Action? onComplete,\r\n            DjuiWindowTransitionV6? windowTarget)\r\n        {\r\n            Id = id;\r\n            Control = control;\r\n            Preset = preset;\r\n            Snapshot = snapshot;\r\n            OnComplete = onComplete;\r\n            WindowTarget = windowTarget;\r\n        }\r\n\r\n        public int Id { get; }\r\n        public Control Control { get; }\r\n        public DjuiTransitionPreset Preset { get; }\r\n        public DjuiTransitionSnapshot Snapshot { get; }\r\n        public Action? OnComplete { get; }\r\n        public float Elapsed { get; set; }\r\n        private DjuiWindowTransitionV6? WindowTarget { get; }\r\n\r\n        public void Apply(float progress)\r\n        {\r\n            if (WindowTarget != null) WindowTarget.Apply(progress);\r\n            else Preset.Apply(Control, progress, Snapshot);\r\n        }\r\n\r\n        /// <summary>\u6062\u590D\u8F6C\u573A\u524D\u5FEB\u7167\uFF08\u8F6C\u573A\u5B8C\u6210/\u53D6\u6D88\u65F6\u5F52\u4E00\u63A7\u4EF6\u72B6\u6001\uFF0C\u9632\u6B62\u4E2D\u9014\u503C\u6216\u7EC8\u6001\u6B8B\u7559\uFF09\u3002</summary>\r\n        public void Restore()\r\n        {\r\n            if (WindowTarget != null) { WindowTarget.Dispose(); return; }\r\n            if (!Control.IsValid) return;\r\n            Control.Scale = Snapshot.Scale;\r\n            Control.Opacity = Snapshot.Opacity;\r\n            Control.Margin = Snapshot.Margin;\r\n            Control.Position = Snapshot.Position;\r\n        }\r\n    }\r\n}\r\n\r\n#endif\r\n';

// raw:D:\git\DJUI\runtime\DjuiTransitionRegistry.cs
var DjuiTransitionRegistry_default = '#if CLIENT\r\n\r\nusing System.Numerics;\r\nusing GameUI.Control;\r\nusing GameUI.Struct;\r\nusing GameUI.Enum;\r\n\r\nnamespace DjuiRuntime;\r\n\r\npublic sealed class DjuiTransitionPreset\r\n{\r\n    public DjuiTransitionPreset(float duration, Action<Control, float, DjuiTransitionSnapshot> apply, bool coordinateWindowContent = false)\r\n    {\r\n        Duration = MathF.Max(0.01f, duration);\r\n        Apply = apply;\r\n        CoordinateWindowContent = coordinateWindowContent;\r\n    }\r\n\r\n    public float Duration { get; }\r\n    public Action<Control, float, DjuiTransitionSnapshot> Apply { get; }\r\n    /// <summary>\u5185\u7F6E\u8F6C\u573A\u4F7F\u7528\u7EDF\u4E00\u7684\u8F74\u5411\u7F29\u653E/\u5E73\u79FB\uFF1B\u81EA\u5B9A\u4E49\u9884\u8BBE\u9ED8\u8BA4\u4FDD\u7559\u5355\u63A7\u4EF6\u884C\u4E3A\u3002</summary>\r\n    public bool CoordinateWindowContent { get; }\r\n}\r\n\r\npublic readonly record struct DjuiTransitionSnapshot(Vector2 Scale, float Opacity, Thickness Margin)\r\n{\r\n    public UIPosition Position { get; init; }\r\n}\r\n\r\npublic static class DjuiTransitionRegistry\r\n{\r\n    private static readonly Dictionary<string, DjuiTransitionPreset> _presets = new();\r\n\r\n    static DjuiTransitionRegistry()\r\n    {\r\n        Register("none", new DjuiTransitionPreset(0.01f, static (_, _, _) => { }));\r\n\r\n        Register("pop_in", new DjuiTransitionPreset(0.28f, static (ctrl, progress, snapshot) =>\r\n        {\r\n            var p = Math.Clamp(progress, 0f, 1f);\r\n            var targetScale = GetTargetScale(snapshot);\r\n            var overshootScale = targetScale * 1.06f;\r\n            var startScale = targetScale * 0.85f;\r\n\r\n            ctrl.Opacity = GetTargetOpacity(snapshot) * EaseOutQuad(p);\r\n            ctrl.Scale = p < 0.62f\r\n                ? Lerp(startScale, overshootScale, EaseOutCubic(p / 0.62f))\r\n                : Lerp(overshootScale, targetScale, EaseOutCubic((p - 0.62f) / 0.38f));\r\n        }, coordinateWindowContent: true));\r\n\r\n        Register("pop_out", new DjuiTransitionPreset(0.16f, static (ctrl, progress, snapshot) =>\r\n        {\r\n            var p = Math.Clamp(progress, 0f, 1f);\r\n            var eased = EaseInCubic(p);\r\n            var targetScale = GetTargetScale(snapshot);\r\n\r\n            ctrl.Opacity = GetTargetOpacity(snapshot) * (1f - eased);\r\n            ctrl.Scale = Lerp(targetScale, targetScale * 0.9f, eased);\r\n        }, coordinateWindowContent: true));\r\n\r\n        Register("fade_in", new DjuiTransitionPreset(0.25f, static (ctrl, progress, snapshot) =>\r\n        {\r\n            ctrl.Opacity = GetTargetOpacity(snapshot) * EaseOutQuad(Math.Clamp(progress, 0f, 1f));\r\n        }, coordinateWindowContent: true));\r\n\r\n        Register("fade_out", new DjuiTransitionPreset(0.2f, static (ctrl, progress, snapshot) =>\r\n        {\r\n            ctrl.Opacity = GetTargetOpacity(snapshot) * (1f - EaseInCubic(Math.Clamp(progress, 0f, 1f)));\r\n        }, coordinateWindowContent: true));\r\n\r\n        Register("slide_up_in", new DjuiTransitionPreset(0.3f, static (ctrl, progress, snapshot) =>\r\n        {\r\n            var p = EaseOutCubic(Math.Clamp(progress, 0f, 1f));\r\n            var offset = 60f * (1f - p);\r\n            var margin = snapshot.Margin;\r\n\r\n            ctrl.Opacity = GetTargetOpacity(snapshot) * p;\r\n            if (ctrl.PositionType == UIPositionType.Absolute)\r\n                ctrl.Position = new UIPosition(snapshot.Position.X, snapshot.Position.Y + offset);\r\n            else\r\n                ctrl.Margin = new Thickness(margin.Left, margin.Top + offset, margin.Right, margin.Bottom);\r\n        }, coordinateWindowContent: true));\r\n\r\n        Register("slide_down_out", new DjuiTransitionPreset(0.2f, static (ctrl, progress, snapshot) =>\r\n        {\r\n            var p = EaseInCubic(Math.Clamp(progress, 0f, 1f));\r\n            var margin = snapshot.Margin;\r\n\r\n            ctrl.Opacity = GetTargetOpacity(snapshot) * (1f - p);\r\n            if (ctrl.PositionType == UIPositionType.Absolute)\r\n                ctrl.Position = new UIPosition(snapshot.Position.X, snapshot.Position.Y + 60f * p);\r\n            else\r\n                ctrl.Margin = new Thickness(margin.Left, margin.Top + 60f * p, margin.Right, margin.Bottom);\r\n        }, coordinateWindowContent: true));\r\n    }\r\n\r\n    public static void Register(string name, DjuiTransitionPreset preset)\r\n    {\r\n        _presets[name] = preset;\r\n    }\r\n\r\n    public static bool TryGet(string? name, out DjuiTransitionPreset preset)\r\n    {\r\n        if (!string.IsNullOrWhiteSpace(name) && _presets.TryGetValue(name, out preset!))\r\n            return true;\r\n\r\n        preset = null!;\r\n        return false;\r\n    }\r\n\r\n    private static Vector2 GetTargetScale(DjuiTransitionSnapshot snapshot)\r\n    {\r\n        return snapshot.Scale;\r\n    }\r\n\r\n    private static float GetTargetOpacity(DjuiTransitionSnapshot snapshot)\r\n    {\r\n        return snapshot.Opacity;\r\n    }\r\n\r\n    private static Vector2 Lerp(Vector2 from, Vector2 to, float progress)\r\n    {\r\n        return from + (to - from) * Math.Clamp(progress, 0f, 1f);\r\n    }\r\n\r\n    private static float EaseOutQuad(float value)\r\n    {\r\n        var t = Math.Clamp(value, 0f, 1f);\r\n        return 1f - (1f - t) * (1f - t);\r\n    }\r\n\r\n    private static float EaseOutCubic(float value)\r\n    {\r\n        var t = Math.Clamp(value, 0f, 1f);\r\n        var inv = 1f - t;\r\n        return 1f - inv * inv * inv;\r\n    }\r\n\r\n    private static float EaseInCubic(float value)\r\n    {\r\n        var t = Math.Clamp(value, 0f, 1f);\r\n        return t * t * t;\r\n    }\r\n}\r\n\r\n#endif\r\n';

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
            case "appearance.imageTint":
                node.Appearance ??= new DjuiAppearanceJson();
                node.Appearance.ImageTint = ReadString(value);
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
var DjuiWindowManagerV6_default = `#if CLIENT\r
\r
using System.Text.Json;\r
using System.Text.Json.Serialization;\r
using GameUI.Control;\r
using GameUI.Control.Extensions;\r
using GameUI.Device;\r
using GameUI.Enum;\r
\r
namespace DjuiRuntime;\r
\r
/// <summary>DJUI v6 \u4E25\u683C\u9879\u76EE\u4E0E\u7A97\u53E3\u5B9E\u4F8B\u7BA1\u7406\u5668\u3002</summary>\r
public static class DjuiWindowManagerV6\r
{\r
    private const string RootDir = "user_files/djui";\r
    private const string ProjectFile = RootDir + "/project.json";\r
    private const string PagesDir = RootDir + "/pages";\r
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = false, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };\r
    private static readonly Dictionary<string, DjuiPageV6> Pages = new();\r
    private static readonly Dictionary<string, DjuiTreeInstanceV6> Instances = new();\r
    private static readonly Dictionary<string, List<string>> PageInstances = new();\r
    private static readonly Dictionary<string, string> SingletonInstances = new(StringComparer.Ordinal);\r
    private static readonly Dictionary<string, int> ClosingTransitions = new(StringComparer.Ordinal);\r
    private static readonly Dictionary<string, Panel> ClosingInputGuards = new(StringComparer.Ordinal);\r
    private static DjuiProjectV6? _project;\r
    private static ulong _nextInstanceId;\r
\r
    // === \u7A97\u53E3\u4FDD\u7559\u6C60\uFF080.8.0\uFF1A\u5173\u95ED\u4E0E\u9500\u6BC1\u5206\u79BB\uFF09===\r
    // CloseWindow \u53EA\u6458\u6808\u9690\u85CF\uFF08IsOpen \u7ACB\u5373 false\uFF09\uFF1B\u5355\u4F8B\u5B9E\u4F8B\u5165 FIFO \u6C60\u5F85\u590D\u7528\uFF08\u590D\u7528\u91CD\u6392\u5230\u6700\u65B0\uFF1D\u9690\u5F0F LRU\uFF09\uFF0C\r
    // \u767D\u540D\u5355\u9875\u9489\u4F4F\u6C38\u4E0D\u6DD8\u6C70\uFF1B\u6DD8\u6C70\u4E0E\u5F3A\u5173\u7EDF\u4E00\u7ECF DisposeDelayMs \u7F13\u51B2\u518D\u9500\u6BC1\u2014\u2014\u6309\u538B\u56DE\u5F39\u52A8\u753B\u5728\u6D3B\u6811\u4E0A\u81EA\u7136\u64AD\u5B8C\uFF0C\r
    // \u89C4\u907F\u5F15\u64CE TouchBehavior \u5BF9\u5DF2\u9500\u6BC1\u63A7\u4EF6\u6BCF\u5E27\u62A5 "Control is not valid" \u7684\u50F5\u5C38\u52A8\u753B\uFF08S00016 \u5B9E\u8BC1\uFF09\u3002\r
    private const int DefaultPoolCapacity = 5;\r
    private const int DisposeDelayMs = 250;\r
    private static readonly LinkedList<RetainedEntry> Pool = new();      // FIFO\uFF1A\u5934\uFF1D\u6700\u8001\uFF08\u6DD8\u6C70\u4F4D\uFF09\uFF0C\u5C3E\uFF1D\u6700\u65B0\r
    private static readonly List<RetainedEntry> Disposing = new();       // \u9500\u6BC1\u7F13\u51B2\u961F\u5217\uFF08250ms \u5012\u8BA1\u65F6\uFF09\r
    private static readonly HashSet<string> PinnedPages = new(StringComparer.Ordinal);\r
    private static readonly HashSet<string> SingletonOpened = new(StringComparer.Ordinal); // OpenWindow \u5355\u4F8B\u8DEF\u5F84\u5F00\u7684\u5B9E\u4F8B\uFF08\u552F\u4E00\u53EF\u5165\u6C60\u590D\u7528\u7684\u6765\u6E90\uFF1BOpenInstance \u591A\u5B9E\u4F8B\u4E0D\u5165\u6C60\uFF09\r
    private static int _poolCapacity = DefaultPoolCapacity;\r
\r
    // === \u751F\u547D\u5468\u671F\u4E8B\u4EF6\uFF080.8.0\uFF09===\r
    // OnCreate\uFF1D\u5EFA\u6811\u540E\uFF08\u6C60\u6DD8\u6C70\u91CD\u5EFA\u4F1A\u518D\u6B21\u89E6\u53D1\uFF09\uFF1BOnOpen\uFF1D\u6BCF\u6B21\u663E\u793A\uFF08\u65B0\u5EFA / \u6C60\u590D\u7528\uFF0COpenWindow \u8FD4\u56DE\u524D\u540C\u6B65\u89E6\u53D1\uFF09\uFF1B\r
    // OnClose\uFF1D\u6458\u6808\u8FDB\u6C60\u524D\uFF08\u5BFB\u5740\u6CE8\u518C\u8868\u5C1A\u672A\u6CE8\u9500\uFF0C\u56DE\u8C03\u5185\u63A7\u4EF6\u4ECD\u53EF\u5BFB\u5740\uFF09\uFF1BOnDestroy\uFF1D\u771F\u6B63 Dispose \u524D\u3002\r
    // \u5173\u95ED\u8F6C\u573A\u4E2D\u9014\u91CD\u5F00\uFF08CancelClosing\uFF09\u4E0D\u89E6\u53D1\u4EFB\u4F55\u4E8B\u4EF6\u2014\u2014\u7A97\u53E3\u4ECE\u672A\u771F\u6B63\u5173\u95ED\u3002\r
    private static readonly Dictionary<string, List<Action>> CreateHandlers = new(StringComparer.Ordinal);\r
    private static readonly Dictionary<string, List<Action>> OpenHandlers = new(StringComparer.Ordinal);\r
    private static readonly Dictionary<string, List<Action>> CloseHandlers = new(StringComparer.Ordinal);\r
    private static readonly Dictionary<string, List<Action>> DestroyHandlers = new(StringComparer.Ordinal);\r
\r
    // \u751F\u547D\u5468\u671F\u8BA1\u6570\uFF08\u9A8C\u6536\u6392\u969C\uFF1A\u5EFA\u6811 / \u590D\u7528 / \u9500\u6BC1\uFF09\r
    private static int _buildCount;\r
    private static int _reuseCount;\r
    private static int _disposeCount;\r
\r
    private sealed class RetainedEntry\r
    {\r
        public required string InstanceId { get; init; }\r
        public required DjuiTreeInstanceV6 Instance { get; init; }\r
        public required string PageId { get; init; }\r
        public bool Pinned { get; init; }\r
        public double RemainingMs { get; set; }             // \u4EC5 Disposing \u961F\u5217\u4F7F\u7528\r
        public LinkedListNode<RetainedEntry>? Node { get; set; }\r
    }\r
\r
    public static void Initialize()\r
    {\r
        CloseAll();\r
        Pages.Clear();\r
        PageInstances.Clear();\r
        SingletonInstances.Clear();\r
        ClosingTransitions.Clear();\r
        _nextInstanceId = 0;\r
        DjuiAudioSystem.Initialize();\r
        if (!File.Exists(ProjectFile)) throw new FileNotFoundException("DJUI v6: \u7F3A\u5C11\u9879\u76EE\u914D\u7F6E", ProjectFile);\r
        _project = DeserializeStrict<DjuiProjectV6>(ProjectFile);\r
        RequireVersion(_project.ProtocolVersion, _project.SchemaVersion, ProjectFile);\r
        if (_project.Canvas.ReferenceWidth <= 0 || _project.Canvas.ReferenceHeight <= 0) throw new InvalidDataException("DJUI v6: \u9879\u76EE\u53C2\u8003\u5C3A\u5BF8\u5FC5\u987B\u5927\u4E8E 0");\r
        var mode = _project.Canvas.Mode switch\r
        {\r
            "Contain" => ScaleMode.Contain,\r
            "MatchWidth" => ScaleMode.MatchWidth,\r
            "MatchHeight" => ScaleMode.MatchHeight,\r
            _ => throw new InvalidDataException($"DJUI v6: \u4E0D\u652F\u6301 Canvas \u6A21\u5F0F {_project.Canvas.Mode}"),\r
        };\r
        DeviceInfo.PrimaryViewport.SetDesignResolution(_project.Canvas.ReferenceWidth, _project.Canvas.ReferenceHeight, mode);\r
        if (!Directory.Exists(PagesDir)) throw new DirectoryNotFoundException($"DJUI v6: \u9875\u9762\u76EE\u5F55\u4E0D\u5B58\u5728: {PagesDir}");\r
        foreach (var file in Directory.GetFiles(PagesDir, "*.json"))\r
        {\r
            var page = DeserializeStrict<DjuiPageV6>(file);\r
            RequireVersion(page.ProtocolVersion, page.SchemaVersion, file);\r
            if (string.IsNullOrWhiteSpace(page.PageId)) throw new InvalidDataException($"DJUI v6: \u9875\u9762 ID \u4E3A\u7A7A: {file}");\r
            if (!Pages.TryAdd(page.PageId, page)) throw new InvalidDataException($"DJUI v6: \u9875\u9762 ID \u91CD\u590D: {file}");\r
        }\r
        // \u4FDD\u7559\u6C60\u914D\u7F6E\uFF08project.json \u53EF\u9009\u5B57\u6BB5\uFF1B\u9875\u9762\u52A0\u8F7D\u540E\u6821\u9A8C\u540D\u5355\uFF09\r
        PinnedPages.Clear();\r
        foreach (var pageId in _project.RetainedPages ?? [])\r
        {\r
            if (!Pages.ContainsKey(pageId))\r
            {\r
                Game.Logger.LogWarning("DJUI v6: retainedPages \u542B\u672A\u77E5\u9875\u9762 {Page}\uFF0C\u5DF2\u5FFD\u7565", pageId);\r
                continue;\r
            }\r
            PinnedPages.Add(pageId);\r
        }\r
        _poolCapacity = Math.Max(0, _project.PoolCapacity ?? DefaultPoolCapacity);\r
        Game.Logger.LogInformation("DJUI v6: \u5DF2\u4E25\u683C\u52A0\u8F7D {Count} \u4E2A\u9875\u9762\uFF08\u7A97\u53E3\u6C60\u5BB9\u91CF {Capacity}\uFF0C\u9489\u4F4F {Pinned} \u9875\uFF09", Pages.Count, _poolCapacity, PinnedPages.Count);\r
    }\r
\r
    /// <summary>\u517C\u5BB9\u4E1A\u52A1\u9875\u9762\u8BED\u4E49\uFF1A\u540C\u4E00 pageId \u53EA\u6253\u5F00\u4E00\u4E2A\u5355\u4F8B\u7A97\u53E3\u3002\u5DF2\u5F00\uFF1D\u7F6E\u9876\u805A\u7126\uFF08\u91CD\u6302\u89C6\u89C9\u6811\u672B\u5C3E\uFF0C\u547D\u4E2D\u5E8F\uFF1D\u6811\u5E8F\uFF0CZIndex \u4E0D\u53C2\u4E0E\u547D\u4E2D\uFF09\u3002</summary>\r
    public static Panel OpenWindow(string pageId)\r
    {\r
        if (SingletonInstances.TryGetValue(pageId, out var existing) && Instances.TryGetValue(existing, out var open))\r
        {\r
            CancelClosing(existing);\r
            open.Host.RemoveFromVisualTreeAndParent();   // \u5F00\u7A97\uFF1D\u805A\u7126\u7F6E\u9876\uFF1A\u9632\u88AB\u540E\u5F00\u7684\u57FA\u7840\u9875\u76D6\u4F4F\r
            open.Host.AddToVisualTree();\r
            return open.Root;\r
        }\r
        if (TryReusePooled(pageId, out var reused)) return reused;\r
        var id = OpenInstance(pageId);\r
        SingletonInstances[pageId] = id;\r
        SingletonOpened.Add(id);\r
        return Instances[id].Root;\r
    }\r
\r
    /// <summary>\u628A\u5DF2\u5F00\u7A97\u53E3\u79FB\u5230\u7A97\u53E3\u6808\u6700\u524D\uFF08\u91CD\u6302\u89C6\u89C9\u6811\u672B\u5C3E\uFF09\u3002\u5148\u5F00\u7684\u5F39\u7A97\u88AB\u540E\u5F00\u7684\u57FA\u7840\u9875\u76D6\u4F4F\u65F6\u7528\u5B83\u6062\u590D\u53EF\u70B9\u6027\u3002</summary>\r
    public static void BringToFront(string pageId)\r
    {\r
        if (!SingletonInstances.TryGetValue(pageId, out var id) || !Instances.TryGetValue(id, out var instance)) return;\r
        instance.Host.RemoveFromVisualTreeAndParent();\r
        instance.Host.AddToVisualTree();\r
    }\r
\r
    /// <summary>\r
    /// \u628A\u5DF2\u5F00\u7A97\u53E3\u538B\u5230\u7A97\u53E3\u6808\u6700\u5E95\uFF1A\u5176\u4F59\u5DF2\u5F00\u7A97\u53E3\u9010\u4E2A\u91CD\u6302\u5230\u89C6\u89C9\u6811\u672B\u5C3E\uFF08\u547D\u4E2D\u5E8F\uFF1D\u6811\u5E8F\uFF0C\u91CD\u6302\u540E\u5176\u4F59\u7A97\u53E3\u90FD\u5728\u76EE\u6807\u4E4B\u4E0A\uFF09\u3002\r
    /// \u573A\u666F\u7C7B\u57FA\u7840\u9875\u4E13\u7528\u2014\u2014\u65E0\u8BBA\u4F55\u65F6\uFF08\u91CD\uFF09\u5F00\u90FD\u4E0D\u906E\u4E1A\u52A1\u5F39\u7A97\u3002\r
    /// </summary>\r
    public static void SendToBack(string pageId)\r
    {\r
        if (!SingletonInstances.TryGetValue(pageId, out var targetId)) return;\r
        foreach (var pair in Instances)\r
        {\r
            if (pair.Key == targetId) continue;\r
            pair.Value.Host.RemoveFromVisualTreeAndParent();\r
            pair.Value.Host.AddToVisualTree();\r
        }\r
    }\r
\r
    /// <summary>\u4FDD\u7559\u6C60\u590D\u7528\uFF1A\u6309 pageId \u627E\u5355\u4F8B\u5B9E\u4F8B\u6761\u76EE\uFF0C\u53D6\u51FA\u6302\u6811\u3001\u56DE\u6CE8\u518C\u8868\u3001\u91CD\u89E3\u7B97\u3001\u64AD open \u8F6C\u573A\u3002</summary>\r
    private static bool TryReusePooled(string pageId, out Panel? root)\r
    {\r
        RetainedEntry? hit = null;\r
        for (var node = Pool.Last; node != null; node = node.Previous)\r
        {\r
            if (!string.Equals(node.Value.PageId, pageId, StringComparison.Ordinal)) continue;\r
            hit = node.Value;\r
            break;\r
        }\r
        if (hit == null)\r
        {\r
            root = null;\r
            return false;\r
        }\r
        Pool.Remove(hit.Node!);\r
        var instance = hit.Instance;\r
        var id = hit.InstanceId;\r
        Instances.Add(id, instance);\r
        if (!PageInstances.TryGetValue(pageId, out var list)) PageInstances[pageId] = list = new List<string>();\r
        list.Add(id);\r
        SingletonInstances[pageId] = id;\r
        SingletonOpened.Add(id);\r
        instance.Host.AddToVisualTree();          // \u5F15\u64CE\u5B98\u65B9\u6CE8\u91CA\uFF1A\u5BF9\u8C61\u6C60\u590D\u7528\u573A\u666F\u5373\u6458/\u6302\u53EF\u89C6\u6811\r
        instance.Session.Relayout();              // \u9690\u85CF\u671F\u95F4\u53EF\u80FD\u8F6C\u5C4F\u2014\u2014\u91CD\u89E3\u7B97\u5E03\u5C40\r
        _reuseCount++;\r
        Game.Logger.LogInformation("DJUI v6: \u590D\u7528\u7A97\u53E3 {Page}#{Id}\uFF08{Kind}\uFF09", pageId, id, hit.Pinned ? "\u9489\u4F4F" : "\u7A97\u53E3\u6C60");\r
        DjuiTransitionPlayer.PlayWindow(instance, Pages.TryGetValue(pageId, out var page) ? page.Window?.Transition?.Open : null);\r
        RaiseEvent(OpenHandlers, pageId, "OnOpen");\r
        root = instance.Root;\r
        return true;\r
    }\r
\r
    /// <summary>\u663E\u5F0F\u521B\u5EFA\u540C\u4E00\u9875\u9762\u7684\u72EC\u7ACB\u7A97\u53E3\u5B9E\u4F8B\uFF08\u591A\u5B9E\u4F8B\u4E0D\u590D\u7528\u3001\u4E0D\u5165\u6C60\uFF0C\u5173\u95ED\u8D70\u9500\u6BC1\u7F13\u51B2\uFF09\u3002</summary>\r
    public static string OpenInstance(string pageId)\r
    {\r
        var project = _project ?? throw new InvalidOperationException("DJUI v6: \u8BF7\u5148 Initialize");\r
        if (!Pages.TryGetValue(pageId, out var page)) throw new KeyNotFoundException($"DJUI v6: \u9875\u9762\u4E0D\u5B58\u5728: {pageId}");\r
        if (!string.Equals(page.Kind, "window", StringComparison.Ordinal)) throw new InvalidOperationException($"DJUI v6: {pageId} \u4E0D\u662F Window \u9875\u9762");\r
        var id = "w" + (++_nextInstanceId).ToString();\r
        var host = new Panel { Name = $"DJUI.v6.{pageId}.{id}" };\r
        host.FullScreen();\r
        host.AddToVisualTree();\r
        try\r
        {\r
            var expandedPage = DjuiTemplateExpanderV6.Expand(page, Pages);\r
            var instance = DjuiTreeBuilderV6.Build(id, project, expandedPage, host);\r
            Instances.Add(id, instance);\r
            if (!PageInstances.TryGetValue(pageId, out var list)) PageInstances[pageId] = list = new List<string>();\r
            list.Add(id);\r
            DjuiTransitionPlayer.PlayWindow(instance, page.Window?.Transition?.Open);\r
            _buildCount++;\r
            Game.Logger.LogInformation("DJUI v6: \u5EFA\u6811 {Page}#{Id}", pageId, id);\r
            RaiseEvent(CreateHandlers, pageId, "OnCreate");\r
            RaiseEvent(OpenHandlers, pageId, "OnOpen");\r
            return id;\r
        }\r
        catch\r
        {\r
            host.RemoveFromVisualTreeAndParent();\r
            host.Dispose();\r
            throw;\r
        }\r
    }\r
\r
    public static T? GetControl<T>(string windowInstanceId, string nodeInstanceId) where T : Control\r
    {\r
        return Instances.TryGetValue(windowInstanceId, out var instance) ? instance.Session.GetControl<T>(nodeInstanceId) : null;\r
    }\r
\r
    public static Control? GetControl(string pageId, string nodeInstanceId)\r
        => GetSingletonControl<Control>(pageId, nodeInstanceId);\r
\r
    public static T? GetControlByPage<T>(string pageId, string nodeInstanceId) where T : Control\r
        => GetSingletonControl<T>(pageId, nodeInstanceId);\r
\r
    public static T? GetSingletonControl<T>(string pageId, string nodeInstanceId) where T : Control\r
    {\r
        return SingletonInstances.TryGetValue(pageId, out var id) ? GetControl<T>(id, nodeInstanceId) : null;\r
    }\r
\r
    /// <summary>\r
    /// \u8FD0\u884C\u65F6\u66FF\u6362\u8282\u70B9\u56FE\u7247\uFF08\u5355\u4F8B\u9875\u53E3\u5F84\uFF0C\u4E1A\u52A1\u6700\u5E38\u7528\uFF09\u3002\u53EA\u6362\u56FE\u4E0D\u52A8\u6392\u7248\uFF1A\r
    /// imageFit / sourceSize / focalX/focalY / slicedEdges / desaturated \u7B49\u6CBF\u7528\u8BE5\u8282\u70B9\u539F appearance \u503C\u3002\r
    /// image \u4F20 null \u6216\u7A7A\u4E32\uFF1D\u64A4\u9500\u56FE\u7247\uFF08\u56DE\u5230\u65E0\u56FE\u5F62\u6001\uFF1B\u5E26\u5B50\u4EF6\u7684\u8282\u70B9\u6CE8\u610F\uFF1A\u64A4\u9500\u540E\u518D\u8BBE\u56DE\u4F1A\u89E6\u53D1 visual \u672B\u4F4D\u91CD\u5EFA\u3001\r
    /// \u56FE\u7247\u76D6\u4F4F\u5B50\u4EF6\uFF0CZ \u5E8F\u4E0E\u5EFA\u6811\u671F\u76F8\u53CD\uFF0C\u8BE6\u89C1\u968F Runtime \u5206\u53D1\u7684 AGENTS.md\u300C\u8FD0\u884C\u65F6\u6362\u56FE\u300D\u9650\u5236\uFF09\u3002\r
    /// \u5BF9 Button\uFF1D\u66F4\u6362 normal \u5E95\u56FE\uFF08hover/pressed/disabled \u4E09\u6001\u914D\u7F6E\u4E0D\u52A8\uFF0C\u672A\u914D\u7F6E\u7684\u6001\u7531\u72B6\u6001\u673A\u81EA\u52A8\u8DDF\u968F\u65B0\u5E95\u56FE\uFF09\u3002\r
    /// \u8FD4\u56DE false\uFF1D\u9875\u9762\u672A\u5F00 / \u8282\u70B9\u4E0D\u5B58\u5728 / \u8282\u70B9\u662F Progress\uFF08\u4E0D\u652F\u6301\uFF09\uFF0C\u5747\u5DF2\u8BB0\u65E5\u5FD7\uFF0C\u4E0D\u629B\u5F02\u5E38\u3002\r
    /// </summary>\r
    public static bool SetImage(string pageId, string nodeInstanceId, string? image)\r
    {\r
        if (!SingletonInstances.TryGetValue(pageId, out var id) || !Instances.TryGetValue(id, out var instance))\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetImage \u9875\u9762\u672A\u6253\u5F00: {Page}\uFF08\u8282\u70B9 {Node}\uFF09", pageId, nodeInstanceId);\r
            return false;\r
        }\r
        return SetImageCore(instance.Session, nodeInstanceId, image);\r
    }\r
\r
    /// <summary>\u540C SetImage\uFF0C\u4F46\u6309\u7A97\u53E3\u5B9E\u4F8B id \u5BFB\u5740\uFF08OpenInstance \u591A\u5B9E\u4F8B\u9875\uFF0C\u5982\u98D8\u5B57\uFF09\u3002</summary>\r
    public static bool SetImageByInstance(string windowInstanceId, string nodeInstanceId, string? image)\r
    {\r
        if (!Instances.TryGetValue(windowInstanceId, out var instance))\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetImageByInstance \u7A97\u53E3\u5B9E\u4F8B\u4E0D\u5B58\u5728: {Instance}\uFF08\u8282\u70B9 {Node}\uFF09", windowInstanceId, nodeInstanceId);\r
            return false;\r
        }\r
        return SetImageCore(instance.Session, nodeInstanceId, image);\r
    }\r
\r
    /// <summary>\r
    /// \u76F4\u63A7\u53E3\u5F84\uFF1A\u6309 Control \u5F15\u7528\u6362\u56FE\uFF08\u514B\u9686\u4F53 / \u6A21\u677F\u5B9E\u4F8B / authored \u8282\u70B9\u901A\u5403\uFF0C\u5185\u90E8\u81EA\u52A8\u5224\u522B\uFF09\u3002\r
    /// \u624B\u91CC\u53EA\u6709 Control \u5F15\u7528\u7684\u4E1A\u52A1\uFF08\u5982\u7269\u54C1\u683C\u5B50\u586B\u5145\uFF09\u7528\u8FD9\u4E2A\uFF1Bauthored \u8282\u70B9\u540C\u6837\u4F1A\u5199\u4F1A\u8BDD\u6570\u636E\u6A21\u578B\uFF0C\r
    /// \u514B\u9686\u4F53\uFF08id \u5E26 #cN\uFF09\u5219\u53EA\u5237\u65B0\u81EA\u8EAB visual\uFF0F\u6309\u94AE\u72B6\u6001\u673A\uFF08\u514B\u9686\u4F53\u4E0D\u53C2\u4E0E relayout\uFF0C\u672C\u5C31\u65E0\u56DE\u9000\u95EE\u9898\uFF09\u3002\r
    /// </summary>\r
    public static bool SetImage(Control control, string? image)\r
    {\r
        var session = DjuiLayoutSessionV6.FindOwner(control);\r
        if (session == null)\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetImage(Control) \u63A7\u4EF6\u4E0D\u5C5E\u4E8E\u4EFB\u4F55 DJUI \u7A97\u53E3: {Name}", control.Name);\r
            return false;\r
        }\r
        var nodeId = session.FindNodeId(control);\r
        if (nodeId == null)\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetImage(Control) \u63A7\u4EF6\u672A\u767B\u8BB0\u8282\u70B9 ID: {Name}", control.Name);\r
            return false;\r
        }\r
        return SetImageCore(session, nodeId, image);\r
    }\r
\r
    /// <summary>\r
    /// SetImage \u4E09\u91CD\u8F7D\u4E0E image \u7ED1\u5B9A\u5171\u7528\u7684\u552F\u4E00\u6838\u5FC3\uFF1A\u5148\u5199\u5E03\u5C40\u4F1A\u8BDD\u6570\u636E\u6A21\u578B\uFF08\u9632 relayout \u56DE\u9000\u7684\u6839\u672C\uFF09\uFF0C\r
    /// \u518D\u7528\u4E0E relayout \u91CD\u653E\u5B8C\u5168\u76F8\u540C\u7684\u4EE3\u7801\uFF08ApplyImageRefresh\uFF09\u5237\u65B0 visual \u5B50\u5C42\u3002\u5BBD\u5BB9\u5931\u8D25\uFF0C\u4E0D\u629B\u5F02\u5E38\u3002\r
    /// </summary>\r
    internal static bool SetImageCore(DjuiLayoutSessionV6 session, string nodeInstanceId, string? image)\r
    {\r
        var control = session.GetControl<Control>(nodeInstanceId);\r
        if (control == null)\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetImage \u8282\u70B9\u4E0D\u5B58\u5728: \u5B9E\u4F8B {Instance} \u8282\u70B9 {Node}", session.WindowInstanceId, nodeInstanceId);\r
            return false;\r
        }\r
        if (control is Progress)\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetImage \u4E0D\u652F\u6301 Progress\uFF08\u8FDB\u5EA6\u6761\u56FE\u7247\u8D70\u4E13\u5C5E\u89C6\u89C9\u5C42\uFF09: \u5B9E\u4F8B {Instance} \u8282\u70B9 {Node}", session.WindowInstanceId, nodeInstanceId);\r
            return false;\r
        }\r
        DjuiNodeV6? node;\r
        if (session.UpdateAuthoredImage(nodeInstanceId, image))\r
        {\r
            // authored \u5206\u652F\uFF1AApply \u53C2\u6570\u53D6 CurrentPage \u6811\u7684\u540C id \u8282\u70B9\uFF08\u4E0E relayout \u91CD\u653E\u540C\u6E90\u540C\u6A21\u578B\uFF09\r
            node = FindNode(session.CurrentPage.Root, nodeInstanceId);\r
            if (node == null)\r
            {\r
                Game.Logger.LogWarning("DJUI v6: SetImage \u5F53\u524D\u89E3\u6790\u89C6\u56FE\u7F3A\u8282\u70B9: \u5B9E\u4F8B {Instance} \u8282\u70B9 {Node}", session.WindowInstanceId, nodeInstanceId);\r
                return false;\r
            }\r
        }\r
        else\r
        {\r
            // \u514B\u9686\u5206\u652F\uFF08id \u5E26 #cN\uFF0C\u4E0D\u5728 authored \u6811\uFF09\uFF1A\u514B\u9686\u8282\u70B9\u5BF9\u8C61\u662F\u72EC\u7ACB JSON \u62F7\u8D1D\u3001\u65E0\u91CD\u653E\u6D88\u8D39\u65B9\uFF0C\r
            // \u76F4\u63A5\u5199\u5165\u514B\u9686\u79C1\u6709\u6A21\u578B\u5373\u53EF\uFF08appearance \u662F\u53EF\u7A7A\u5757\uFF0C??= \u4E0D\u53EF\u7701\u2014\u2014\u90E8\u5206\u514B\u9686\u6E90\u8282\u70B9\u65E0 appearance\uFF09\r
            node = DjuiTreeBuilderV6.FindCloneNode(control);\r
            if (node == null)\r
            {\r
                Game.Logger.LogWarning("DJUI v6: SetImage \u514B\u9686\u8282\u70B9\u8BB0\u5F55\u7F3A\u5931: \u5B9E\u4F8B {Instance} \u8282\u70B9 {Node}", session.WindowInstanceId, nodeInstanceId);\r
                return false;\r
            }\r
            node.Appearance ??= new DjuiAppearanceV6();\r
            node.Appearance.Image = string.IsNullOrWhiteSpace(image) ? null : image;\r
        }\r
        var owner = session.Owner;\r
        if (owner == null) return true;   // \u5EFA\u6811\u671F\u7ED1\u5B9A\u9996\u653E\uFF1A\u6A21\u578B\u5DF2\u5199\uFF0CBuild \u6536\u5C3E\u7684 Relayout \u4F1A\u6309\u65B0\u6A21\u578B\u94FA\u56FE\r
        DjuiTreeBuilderV6.ApplyImageRefresh(control, node, owner.ImageVisuals, owner.ButtonStates);\r
        return true;\r
    }\r
\r
    /// <summary>\r
    /// \u8FD0\u884C\u65F6\u56FE\u7247\u67D3\u8272\uFF08\u5355\u4F8B\u9875\u53E3\u5F84\uFF0C\u4E1A\u52A1\u6700\u5E38\u7528\uFF09\u3002\u4E58\u7B97 tint\uFF1A\u56FE\u7247\u50CF\u7D20 \xD7 \u989C\u8272\uFF0C\u767D\u8272\u7D20\u6750\uFF1D\u76F4\u63A5\u53D8\u6210\u8BE5\u989C\u8272\uFF0C\r
    /// \u900F\u660E\u533A\u57DF\u4FDD\u6301\u900F\u660E\uFF08\u4E0D\u4EA7\u751F\u8272\u5757\uFF09\u3002\u4E0E SetImage \u540C\u6784\uFF1A\u5199\u5E03\u5C40\u4F1A\u8BDD\u6A21\u578B\u9632 relayout \u56DE\u9000\uFF0C\u8FDB\u5EA6\u6761\u540C\u6837\u652F\u6301\r
    /// \uFF08\u653E\u5C04\u72B6\u843D\u5BBF\u4E3B\u3001\u7EBF\u6027\u843D\u8FDB\u5EA6\u6761 image \u5B50\u5C42\uFF0C\u4E0E\u5EFA\u6811\u671F\u4E00\u81F4\uFF09\u3002Button \u67D3\u7684\u662F normal \u5E95\u56FE\u6240\u5728 visual \u5C42\uFF0C\r
    /// hover/pressed/disabled \u672A\u914D\u7F6E\u7684\u6001\u81EA\u52A8\u8DDF\u968F\u3002tint \u4F20 null \u6216\u7A7A\u4E32\uFF1D\u64A4\u9500\u67D3\u8272\u3002\r
    /// \u989C\u8272\u683C\u5F0F\uFF1A#RRGGBB / #RRGGBBAA / rgba() \u4E32\u3002\u8FD4\u56DE false\uFF1D\u9875\u9762\u672A\u5F00 / \u8282\u70B9\u4E0D\u5B58\u5728 / \u989C\u8272\u975E\u6CD5\uFF0C\u5747\u5DF2\u8BB0\u65E5\u5FD7\u3002\r
    /// </summary>\r
    public static bool SetTint(string pageId, string nodeInstanceId, string? tint)\r
    {\r
        if (!SingletonInstances.TryGetValue(pageId, out var id) || !Instances.TryGetValue(id, out var instance))\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetTint \u9875\u9762\u672A\u6253\u5F00: {Page}\uFF08\u8282\u70B9 {Node}\uFF09", pageId, nodeInstanceId);\r
            return false;\r
        }\r
        return SetTintCore(instance.Session, nodeInstanceId, tint);\r
    }\r
\r
    /// <summary>\u540C SetTint\uFF0C\u4F46\u6309\u7A97\u53E3\u5B9E\u4F8B id \u5BFB\u5740\uFF08OpenInstance \u591A\u5B9E\u4F8B\u9875\uFF09\u3002</summary>\r
    public static bool SetTintByInstance(string windowInstanceId, string nodeInstanceId, string? tint)\r
    {\r
        if (!Instances.TryGetValue(windowInstanceId, out var instance))\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetTintByInstance \u7A97\u53E3\u5B9E\u4F8B\u4E0D\u5B58\u5728: {Instance}\uFF08\u8282\u70B9 {Node}\uFF09", windowInstanceId, nodeInstanceId);\r
            return false;\r
        }\r
        return SetTintCore(instance.Session, nodeInstanceId, tint);\r
    }\r
\r
    /// <summary>\r
    /// \u76F4\u63A7\u53E3\u5F84\uFF1A\u6309 Control \u5F15\u7528\u67D3\u8272\uFF08\u514B\u9686\u4F53 / \u6A21\u677F\u5B9E\u4F8B / authored \u8282\u70B9\u901A\u5403\uFF09\uFF0C\u4E0E SetImage(Control) \u540C\u6784\u3002\r
    /// </summary>\r
    public static bool SetTint(Control control, string? tint)\r
    {\r
        var session = DjuiLayoutSessionV6.FindOwner(control);\r
        if (session == null)\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetTint(Control) \u63A7\u4EF6\u4E0D\u5C5E\u4E8E\u4EFB\u4F55 DJUI \u7A97\u53E3: {Name}", control.Name);\r
            return false;\r
        }\r
        var nodeId = session.FindNodeId(control);\r
        if (nodeId == null)\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetTint(Control) \u63A7\u4EF6\u672A\u767B\u8BB0\u8282\u70B9 ID: {Name}", control.Name);\r
            return false;\r
        }\r
        return SetTintCore(session, nodeId, tint);\r
    }\r
\r
    /// <summary>\r
    /// SetTint \u4E09\u91CD\u8F7D\u5171\u7528\u6838\u5FC3\uFF1A\u5148\u6821\u9A8C\u989C\u8272\uFF08\u975E\u6CD5\u76F4\u63A5\u5931\u8D25\uFF0C\u6A21\u578B\u4E0D\u52A8\uFF09\uFF0C\u518D\u5199\u4F1A\u8BDD\u6570\u636E\u6A21\u578B\r
    /// \uFF08\u9632 relayout \u56DE\u9000\uFF09\uFF0C\u6700\u540E\u8D70\u4E0E relayout \u91CD\u653E\u76F8\u540C\u7684\u5237\u65B0\u8DEF\u5F84\u3002\r
    /// </summary>\r
    internal static bool SetTintCore(DjuiLayoutSessionV6 session, string nodeInstanceId, string? tint)\r
    {\r
        var normalized = string.IsNullOrWhiteSpace(tint) ? null : tint.Trim();\r
        if (normalized != null && !DjuiTreeBuilderV6.TryParseColor(normalized, out _))\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetTint \u989C\u8272\u65E0\u6CD5\u89E3\u6790: {Tint}\uFF08\u8282\u70B9 {Node}\uFF0C\u652F\u6301 #RRGGBB / #RRGGBBAA / rgba()\uFF09", tint, nodeInstanceId);\r
            return false;\r
        }\r
        var control = session.GetControl<Control>(nodeInstanceId);\r
        if (control == null)\r
        {\r
            Game.Logger.LogWarning("DJUI v6: SetTint \u8282\u70B9\u4E0D\u5B58\u5728: \u5B9E\u4F8B {Instance} \u8282\u70B9 {Node}", session.WindowInstanceId, nodeInstanceId);\r
            return false;\r
        }\r
        DjuiNodeV6? node;\r
        if (session.UpdateAuthoredTint(nodeInstanceId, normalized))\r
        {\r
            node = FindNode(session.CurrentPage.Root, nodeInstanceId);\r
            if (node == null)\r
            {\r
                Game.Logger.LogWarning("DJUI v6: SetTint \u5F53\u524D\u89E3\u6790\u89C6\u56FE\u7F3A\u8282\u70B9: \u5B9E\u4F8B {Instance} \u8282\u70B9 {Node}", session.WindowInstanceId, nodeInstanceId);\r
                return false;\r
            }\r
        }\r
        else\r
        {\r
            node = DjuiTreeBuilderV6.FindCloneNode(control);\r
            if (node == null)\r
            {\r
                Game.Logger.LogWarning("DJUI v6: SetTint \u514B\u9686\u8282\u70B9\u8BB0\u5F55\u7F3A\u5931: \u5B9E\u4F8B {Instance} \u8282\u70B9 {Node}", session.WindowInstanceId, nodeInstanceId);\r
                return false;\r
            }\r
            node.Appearance ??= new DjuiAppearanceV6();\r
            node.Appearance.ImageTint = normalized;\r
        }\r
        var owner = session.Owner;\r
        if (owner == null) return true;\r
        DjuiTreeBuilderV6.ApplyImageRefresh(control, node, owner.ImageVisuals, owner.ButtonStates);\r
        // \u8FDB\u5EA6\u6761\u67D3\u8272\u4E0D\u8D70 imageVisuals\uFF08ApplyImageRefresh \u5BF9 Progress \u9759\u9ED8\u8DF3\u8FC7\uFF09\uFF0C\r
        // \u590D\u7528\u5EFA\u6811\u671F\u7684 Progress \u5206\u652F\u624D\u80FD\u8986\u76D6\u653E\u5C04\u72B6\uFF08\u5BBF\u4E3B\u539F\u751F\u56FE\uFF09\u4E0E\u7EBF\u6027\uFF08\u8FDB\u5EA6\u6761\u4E13\u5C5E\u5B50\u5C42\uFF09\u4E24\u6761\u8DEF\u5F84\r
        if (control is Progress progressTarget)\r
        {\r
            if (progressTarget.ProgressionMode is ProgressionMode.Clockwise or ProgressionMode.CounterClockwise)\r
            {\r
                DjuiTreeBuilderV6.ApplyNativeProgressImage(progressTarget, node.Appearance);\r
            }\r
            else\r
            {\r
                owner.ProgressVisuals.Apply(node.Id, progressTarget, node.Appearance);\r
            }\r
        }\r
        return true;\r
    }\r
\r
    public static bool IsOpen(string pageId)\r
        => SingletonInstances.TryGetValue(pageId, out var id) && Instances.ContainsKey(id);\r
\r
    public static Panel? GetOpenWindow(string pageId)\r
        => SingletonInstances.TryGetValue(pageId, out var id) && Instances.TryGetValue(id, out var instance) ? instance.Root : null;\r
\r
    public static string? GetSingletonInstanceId(string pageId)\r
        => IsOpen(pageId) ? SingletonInstances[pageId] : null;\r
\r
    public static IReadOnlyList<string> GetInstances(string pageId)\r
    {\r
        return PageInstances.TryGetValue(pageId, out var ids) ? ids.AsReadOnly() : Array.Empty<string>();\r
    }\r
\r
    private static ulong _nextCloneSeq;\r
\r
    /// <summary>\r
    /// \u6309\u5F53\u524D\u8BBE\u5B9A Width/Height \u7ACB\u5373\u540C\u6B65 DJUI \u56FE\u7247/\u8FDB\u5EA6\u6761\u89C6\u89C9\u77E9\u5F62\uFF0C\u9ED8\u8BA4\u5305\u62EC\u5DF2\u6302\u63A5\u7684\u5B50\u63A7\u4EF6\u3002\r
    /// \u4E0D\u91CD\u89E3\u7B97\u5E03\u5C40\u3001\u4E0D\u5199\u9875\u9762\u6A21\u578B\u3001\u4E0D\u6062\u590D\u663E\u9690\u6216\u6309\u94AE\u72B6\u6001\uFF1B\u652F\u6301 authored \u4E0E\u514B\u9686\u63A7\u4EF6\u3002\r
    /// \u76F4\u63A5\u4FEE\u6539\u663E\u5F0F\u5C3A\u5BF8\u540E\u65E0\u9700\u8C03\u7528\u4E5F\u4F1A\u5728\u4E0B\u6B21\u56FE\u7247\u540C\u6B65 Think \u81EA\u52A8\u66F4\u65B0\uFF1B\u9700\u8981\u540C\u6B65\u5B8C\u6210\u65F6\u8C03\u7528\u672C\u65B9\u6CD5\u3002\r
    /// \u8FD4\u56DE false \u8868\u793A\u63A7\u4EF6\u65E0\u6548\u6216\u4E0D\u5C5E\u4E8E\u5B58\u6D3B\u7684 DJUI \u6811\u3002Auto/\u767E\u5206\u6BD4\u5B9E\u9645\u5E03\u5C40\u5C3A\u5BF8\u4E0D\u5728\u6B64\u5951\u7EA6\u5185\u3002\r
    /// </summary>\r
    public static bool RefreshVisuals(Control control, bool recursive = true)\r
    {\r
        if (control == null || !control.IsValid) return false;\r
        var session = DjuiLayoutSessionV6.FindOwner(control);\r
        var owner = session?.Owner;\r
        if (session?.FindNodeId(control) == null) return false;\r
        if (owner == null) return false;\r
        RefreshVisualSubtree(control, owner, recursive);\r
        return true;\r
    }\r
\r
    private static void RefreshVisualSubtree(Control control, DjuiTreeInstanceV6 owner, bool recursive)\r
    {\r
        if (!control.IsValid) return;\r
        owner.ImageVisuals.RefreshGeometry(control);\r
        if (control is Progress progress) owner.ProgressVisuals.RefreshGeometry(progress);\r
        if (!recursive) return;\r
        foreach (var child in control.Children ?? [])\r
            RefreshVisualSubtree(child, owner, recursive: true);\r
    }\r
\r
    /// <summary>\r
    /// \u590D\u5236\u7A97\u53E3\u5185\u4E00\u4E2A\u8282\u70B9\u5B50\u6811\uFF0C\u8FD4\u56DE\u4E00\u4EFD\u65B0\u6784\u5EFA\u7684\u63A7\u4EF6\u5B9E\u4F8B\uFF08\u4E0D\u6302\u6811\u3001\u4E0D\u7ED1 action/\u97F3\u6548/\u6570\u636E\u7ED1\u5B9A\u2014\u2014\u5982\u540C new\uFF09\u3002\r
    /// \u514B\u9686\u4F53\u6CBF\u7528\u6E90\u5B50\u6811\u5F53\u524D\u89E3\u7B97\u77E9\u5F62\uFF0C\u521D\u59CB\u4E0E\u6E90\u5B8C\u5168\u91CD\u53E0\uFF1B\u7236\u7EA7/\u4F4D\u7F6E/\u663E\u9690\u7531\u8C03\u7528\u65B9\u7BA1\u7406\u3002\r
    /// \u514B\u9686\u4F53\u767B\u8BB0\u8FDB\u5E03\u5C40\u4F1A\u8BDD\u4F46 authored \u6811\u4E0D\u53D8\u2014\u2014relayout\uFF08\u8F6C\u5C4F/\u7F29\u653E\uFF09\u4E0D\u4F5C\u7528\u4E8E\u514B\u9686\u4F53\uFF0C\u9700\u8981\u8DDF\u968F\u91CD\u6392\u65F6\u9500\u6BC1\u91CD\u5EFA\u3002\r
    /// \u5B50\u63A7\u4EF6\u5BFB\u5740\uFF1A\u63A7\u4EF6 Name \u53D6\u81EA\u9875\u9762 JSON \u7684 name \u5B57\u6BB5\uFF0C\u7528\u5F15\u64CE FindChild(name)/FindChildren(name)\u3002\r
    /// </summary>\r
    public static Control CloneControl(string windowInstanceId, string nodeInstanceId)\r
    {\r
        var project = _project ?? throw new InvalidOperationException("DJUI v6: \u8BF7\u5148 Initialize");\r
        var instance = Instances.TryGetValue(windowInstanceId, out var tree)\r
            ? tree\r
            : throw new KeyNotFoundException($"DJUI v6: \u7A97\u53E3\u5B9E\u4F8B\u4E0D\u5B58\u5728: {windowInstanceId}");\r
        var source = FindNode(instance.Session.CurrentPage.Root, nodeInstanceId)\r
            ?? throw new KeyNotFoundException($"DJUI v6: \u8282\u70B9\u4E0D\u5B58\u5728: {nodeInstanceId}");\r
        var sceneScales = new Dictionary<string, float>();\r
        var solved = DjuiLayoutSolverV6.SolveV6(instance.Session.CurrentPage, instance.Session.CurrentPlan, sceneScales);\r
        var suffix = "#c" + (++_nextCloneSeq).ToString();\r
        return DjuiTreeBuilderV6.BuildClone(source, instance.Session, project.DefaultFont, instance.ImageVisuals, instance.ProgressVisuals, instance.ButtonStates, suffix, solved, sceneScales);\r
    }\r
\r
    /// <summary>\r
    /// \u624B\u52A8\u91CD\u6392\uFF1A\u91CD\u6392\u7A97\u53E3\u5185 containerNodeId \u5B50\u6811\u4E2D\u6240\u6709\u5F00\u542F\u6392\u5217\u6A21\u5F0F\uFF08layout.flowOrientation \u4E3A\r
    /// Vertical/Horizontal/Grid\uFF09\u7684\u5BB9\u5668\uFF0C\u81EA\u5E95\u5411\u4E0A\uFF08\u6DF1\u5C42\u5BB9\u5668\u5148\u6392\u2014\u2014\u7236\u5BB9\u5668\u8BFB\u53D6\u5B50\u9879\u5F15\u64CE\u5B9E\u9645\u5C3A\u5BF8\u65F6\uFF0C\r
    /// \u5DF2\u62FF\u5230\u5B50\u5BB9\u5668\u521A\u5199\u597D\u7684\u65B0\u5C3A\u5BF8\uFF09\u3002\u6392\u5217\u8BED\u4E49\u4E0E\u7F16\u8F91\u5668\u7AEF\u6392\u5217\u5B8C\u5168\u4E00\u81F4\uFF08DjuiLayoutArranger\uFF0C\u53CC\u7AEF\u5BF9\u62CD\u57FA\u51C6\uFF09\u3002\r
    /// \u5B50\u9879\u5C3A\u5BF8\u6570\u636E\u6E90\uFF1D\u5F15\u64CE\u63A7\u4EF6\u5F53\u524D\u5B9E\u9645\u5C3A\u5BF8\uFF08\u514B\u9686\u4F53\u53EF\u80FD\u88AB\u4E1A\u52A1\u6539\u8FC7\u3001\u4E0D\u5728 JSON \u91CC\uFF09\uFF1Bauthored \u5B50\u9879\u7684\r
    /// \u5F39\u6027\u6BD4\u4F8B\u53D6 JSON stretchRatio\uFF0C\u514B\u9686\u4F53\u65E0 JSON \u8BB0\u5F55\u6309 0\u3002\u5B50\u9879\u96C6\u5408\uFF1D\u5BB9\u5668\u63A7\u4EF6\u5F15\u64CE Children \u904D\u5386\u5E8F\r
    /// \uFF08\u542B\u514B\u9686\u4F53\uFF1BDJUI \u5185\u90E8 visual \u8F85\u52A9\u5C42\u4E0E JSON \u91CC visible=false \u7684 authored \u5B50\u9879\u4E0D\u53C2\u4E0E\u6392\u5217\uFF09\u3002\r
    /// \u6392\u5E8F\u4F18\u5148\u7EA7\uFF1Aorder \u53C2\u6570 &gt; JSON layout.childOrder\uFF08'ByName'\uFF1D\u6309\u63A7\u4EF6 Name \u7801\u70B9\u5347\u5E8F\u7A33\u5B9A\u6392\u5E8F\uFF0C\r
    /// \u65E0\u540D\u5F52\u4E00\u7A7A\u4E32\u6392\u6700\u524D\uFF09&gt; \u5F15\u64CE Children \u904D\u5386\u5E8F\uFF1B\u6392\u5E8F\u53EA\u51B3\u5B9A\u6392\u5217\u4F4D\u7F6E\u7684\u8BA1\u7B97\u987A\u5E8F\uFF0C\u4E0D\u6539\u63A7\u4EF6\u6811\u7ED3\u6784/ZIndex\u3002\r
    /// \u6392\u5217\u7ED3\u679C\u7ECF DjuiLayoutSessionV6.ApplyRect \u5199\u5165\uFF08Absolute \u5B9A\u4F4D\uFF0C\u5BB9\u5668\u5C40\u90E8\u5750\u6807\uFF09\u3002\r
    /// \u6CE8\u610F\uFF1A\u672C API \u4E0D\u5199\u4F1A\u8BDD\u6570\u636E\u6A21\u578B\u2014\u2014authored \u8282\u70B9\u4F4D\u7F6E\u4F1A\u88AB\u540E\u7EED\u8F6C\u5C4F/\u7F29\u653E\u89E6\u53D1\u7684 session.Relayout\r
    /// \uFF08JSON solved \u57FA\u51C6\uFF09\u8986\u76D6\u56DE JSON \u6392\u5E03\uFF1B\u514B\u9686\u4F53\u4E0D\u5728 authored \u6811\uFF0C\u4E0D\u53D7\u5F71\u54CD\u3002\u4E1A\u52A1\u6539\u8FC7\u5C3A\u5BF8\u7684 Auto\r
    /// \u63A7\u4EF6\uFF08\u5982\u514B\u9686\u4F53\uFF09\u8BFB ActualSize\uFF0C\u5E27\u672B\u624D\u751F\u6548\uFF0C\u5EFA\u6811\u540C\u5E27\u8C03\u7528\u53EF\u80FD\u53D6\u5230\u65E7\u503C\u3002\r
    /// \u8FD4\u56DE false\uFF1D\u5B50\u6811\u5185\u6CA1\u6709\u5F00\u542F\u6392\u5217\u6A21\u5F0F\u7684\u5BB9\u5668\uFF08\u5DF2\u8BB0\u65E5\u5FD7\uFF09\uFF1B\u672A Initialize \u629B InvalidOperationException\u3001\r
    /// \u5B9E\u4F8B/\u8282\u70B9\u4E0D\u5B58\u5728\u629B KeyNotFoundException\uFF08\u7F16\u7A0B\u9519\u8BEF\uFF0CCloneControl \u540C\u6B3E\u53E3\u5F84\uFF09\u3002\r
    /// </summary>\r
    public static bool Relayout(string windowInstanceId, string containerNodeId, IComparer<Control>? order = null)\r
    {\r
        if (_project == null) throw new InvalidOperationException("DJUI v6: \u8BF7\u5148 Initialize");\r
        var instance = Instances.TryGetValue(windowInstanceId, out var tree)\r
            ? tree\r
            : throw new KeyNotFoundException($"DJUI v6: \u7A97\u53E3\u5B9E\u4F8B\u4E0D\u5B58\u5728: {windowInstanceId}");\r
        var container = FindNode(instance.Session.CurrentPage.Root, containerNodeId)\r
            ?? throw new KeyNotFoundException($"DJUI v6: \u8282\u70B9\u4E0D\u5B58\u5728: {containerNodeId}");\r
        return RelayoutCore(instance, container, order, null);\r
    }\r
\r
    /// <summary>\r
    /// \u540C Relayout\uFF0C\u4F46\u5B50\u9879\u987A\u5E8F\u663E\u5F0F\u7ED9\u5B9A\uFF1AorderedNodeIds \u5185\u7684\u5B50\u9879\u6309\u5176\u76F8\u5BF9\u987A\u5E8F\u6392\u524D\uFF0C\u672A\u5217\u51FA\u7684\uFF08\u542B\u514B\u9686\u4F53\uFF09\r
    /// \u6309\u5F15\u64CE Children \u904D\u5386\u5E8F\u9644\u540E\uFF08\u7A33\u5B9A\u6392\u5E8F\uFF0C\u5E76\u5217\u4FDD\u6301\u539F\u5E8F\uFF09\uFF1BorderedNodeIds \u91CC\u7684 id \u53EA\u5728\u5176\u6240\u5C5E\u5BB9\u5668\u5185\r
    /// \u751F\u6548\uFF08\u5B50\u6811\u591A\u5C42\u5BB9\u5668\u65F6\u5404\u53D6\u6240\u9700\uFF09\u3002\u663E\u5F0F\u987A\u5E8F\u4F18\u5148\u4E8E JSON layout.childOrder\u3002\r
    /// </summary>\r
    public static bool RelayoutByOrder(string windowInstanceId, string containerNodeId, IReadOnlyList<string> orderedNodeIds)\r
    {\r
        if (orderedNodeIds == null) throw new ArgumentNullException(nameof(orderedNodeIds));\r
        if (_project == null) throw new InvalidOperationException("DJUI v6: \u8BF7\u5148 Initialize");\r
        var instance = Instances.TryGetValue(windowInstanceId, out var tree)\r
            ? tree\r
            : throw new KeyNotFoundException($"DJUI v6: \u7A97\u53E3\u5B9E\u4F8B\u4E0D\u5B58\u5728: {windowInstanceId}");\r
        var container = FindNode(instance.Session.CurrentPage.Root, containerNodeId)\r
            ?? throw new KeyNotFoundException($"DJUI v6: \u8282\u70B9\u4E0D\u5B58\u5728: {containerNodeId}");\r
        return RelayoutCore(instance, container, null, orderedNodeIds);\r
    }\r
\r
    /// <summary>Relayout / RelayoutByOrder \u5171\u7528\u6838\u5FC3\uFF1A\u6536\u96C6\u5B50\u6811\u5185\u5168\u90E8\u6392\u5217\u5BB9\u5668\uFF0C\u6309\u6DF1\u5EA6\u964D\u5E8F\u81EA\u5E95\u5411\u4E0A\u9010\u4E2A\u91CD\u6392\u3002</summary>\r
    private static bool RelayoutCore(DjuiTreeInstanceV6 instance, DjuiNodeV6 container, IComparer<Control>? order, IReadOnlyList<string>? orderedNodeIds)\r
    {\r
        var containers = new List<(DjuiNodeV6 Node, int Depth)>();\r
        CollectArrangeContainers(container, 0, containers);\r
        if (containers.Count == 0)\r
        {\r
            Game.Logger.LogWarning("DJUI v6: Relayout \u5B50\u6811\u5185\u6CA1\u6709\u5F00\u542F\u6392\u5217\u6A21\u5F0F\u7684\u5BB9\u5668: \u5B9E\u4F8B {Instance} \u8282\u70B9 {Node}",\r
                instance.Session.WindowInstanceId, container.Id);\r
            return false;\r
        }\r
        // \u81EA\u5E95\u5411\u4E0A\uFF1D\u6DF1\u5EA6\u964D\u5E8F\uFF08OrderByDescending \u7A33\u5B9A\u6392\u5E8F\uFF1B\u7981 List.Sort/Array.Sort\u2014\u2014\u6BD4\u8F83\u76F8\u7B49\u5FC5\u987B\u4FDD\u6301\u539F\u5E8F\uFF09\r
        foreach (var (node, _) in containers.OrderByDescending(c => c.Depth))\r
            RelayoutOneContainer(instance, node, order, orderedNodeIds);\r
        return true;\r
    }\r
\r
    /// <summary>\u9012\u5F52\u6536\u96C6\u5B50\u6811\u5185\u5F00\u542F\u6392\u5217\u6A21\u5F0F\u7684\u5BB9\u5668\u8282\u70B9\uFF08\u542B\u81EA\u8EAB\uFF09\u3002</summary>\r
    private static void CollectArrangeContainers(DjuiNodeV6 node, int depth, List<(DjuiNodeV6 Node, int Depth)> sink)\r
    {\r
        var flow = node.Layout?.FlowOrientation;\r
        if (flow == "Vertical" || flow == "Horizontal" || flow == "Grid") sink.Add((node, depth));\r
        foreach (var child in node.Children) CollectArrangeContainers(child, depth + 1, sink);\r
    }\r
\r
    private sealed class RelayoutChild\r
    {\r
        public required Control Control { get; init; }\r
        public required string Id { get; init; }\r
        /// <summary>authored \u76F4\u63A5\u5B50\u9879\u7684 JSON \u8282\u70B9\uFF1B\u514B\u9686\u4F53/\u5916\u90E8\u6302\u5165\u63A7\u4EF6\u4E0D\u5728 authored \u6811\uFF0C\u4E3A null\uFF08\u5F39\u6027\u6BD4\u4F8B\u6309 0\uFF09\u3002</summary>\r
        public DjuiNodeV6? Json { get; init; }\r
    }\r
\r
    /// <summary>\u91CD\u6392\u5355\u4E2A\u5BB9\u5668\uFF1A\u8BFB JSON \u6392\u5217\u53C2\u6570\u4E0E\u5B50\u9879\u5F15\u64CE\u5B9E\u9645\u5C3A\u5BF8\uFF0C\u8C03 DjuiLayoutArranger \u6392\u5217\u5E76 ApplyRect \u5199\u56DE\u3002</summary>\r
    private static void RelayoutOneContainer(DjuiTreeInstanceV6 instance, DjuiNodeV6 node, IComparer<Control>? order, IReadOnlyList<string>? orderedNodeIds)\r
    {\r
        var session = instance.Session;\r
        var containerControl = session.GetControl<Control>(node.Id);\r
        if (containerControl == null)\r
        {\r
            Game.Logger.LogWarning("DJUI v6: Relayout \u5BB9\u5668\u63A7\u4EF6\u672A\u767B\u8BB0: \u5B9E\u4F8B {Instance} \u8282\u70B9 {Node}", session.WindowInstanceId, node.Id);\r
            return;\r
        }\r
\r
        // authored \u76F4\u63A5\u5B50\u9879\u7D22\u5F15\uFF08id \u2192 JSON \u8282\u70B9\uFF09\uFF1A\u5F39\u6027\u6BD4\u4F8B\u4E0E\u53EF\u89C1\u6027\u8FC7\u6EE4\u7684\u6570\u636E\u6E90\r
        var authored = new Dictionary<string, DjuiNodeV6>(StringComparer.Ordinal);\r
        foreach (var child in node.Children) authored[child.Id] = child;\r
\r
        // \u5B50\u9879\u96C6\u5408\uFF1D\u5F15\u64CE Children \u904D\u5386\u5E8F\uFF08\u542B\u514B\u9686\u4F53\uFF09\uFF1B\u5254\u9664 DJUI \u5185\u90E8 visual \u8F85\u52A9\u5C42\u3001\u672A\u767B\u8BB0\u63A7\u4EF6\u4E0E\u9690\u85CF\u7684 authored \u5B50\u9879\r
        var entries = new List<RelayoutChild>();\r
        foreach (var child in containerControl.Children ?? [])\r
        {\r
            if (IsAuxiliaryVisual(child)) continue;\r
            var id = session.FindNodeId(child);\r
            if (id == null) continue;\r
            var json = authored.TryGetValue(id, out var childNode) ? childNode : null;\r
            if (json?.Basic?.Visible == false) continue;   // \u9690\u85CF\u5B50\u9879\u4E0D\u53C2\u4E0E\u6392\u5217\uFF08\u4E0E\u7F16\u8F91\u5668\u6392\u5217\u53E3\u5F84\u4E00\u81F4\uFF09\r
            entries.Add(new RelayoutChild { Control = child, Id = id, Json = json });\r
        }\r
        if (entries.Count == 0) return;\r
\r
        // \u6392\u5E8F\u4F18\u5148\u7EA7\uFF1Aorder \u53C2\u6570 > orderedNodeIds > JSON childOrder\uFF08ByName \u4EA4\u7ED9 Arranger \u5185\u90E8\u5904\u7406\uFF0C\u52FF\u5728\u6B64\u6392\uFF09\u3002\r
        // OrderBy \u7A33\u5B9A\u6392\u5E8F\uFF0C\u6BD4\u8F83\u76F8\u7B49\u4FDD\u6301 Children \u904D\u5386\u5E8F\u3002\r
        IEnumerable<RelayoutChild> sorted = entries;\r
        if (order != null)\r
            sorted = entries.OrderBy(e => e.Control, order);\r
        else if (orderedNodeIds != null)\r
            sorted = entries.OrderBy(e => RankInOrder(e.Id, orderedNodeIds));\r
\r
        var layout = node.Layout;\r
        var spacing = layout?.Spacing;\r
        var padding = layout?.Padding;\r
        var p = new DjuiLayoutArranger.ArrangerParams\r
        {\r
            Flow = layout?.FlowOrientation ?? "Vertical",\r
            // spacing \u957F\u5EA6\u515C\u5E95\uFF08null/Length<2 \u2192 0\uFF09\uFF1A\u4E0E DjuiSpacingArrayConverter \u7684\u957F\u5EA6\u515C\u5E95\u6784\u6210\u53CC\u4FDD\u9669\uFF0C\r
            // \u9632\u53CD\u5E8F\u5217\u5316\u4E4B\u5916\u8DEF\u5F84\u7684\u7578\u5F62\u6570\u7EC4\u4E0B\u6E38\u7D22\u5F15\u8D8A\u754C\r
            SpacingH = spacing is { Length: >= 2 } ? spacing[0] : 0f,\r
            SpacingV = spacing is { Length: >= 2 } ? spacing[1] : 0f,\r
            PadLeft = padding is { Length: 4 } ? padding[0] : 0f,\r
            PadTop = padding is { Length: 4 } ? padding[1] : 0f,\r
            PadRight = padding is { Length: 4 } ? padding[2] : 0f,\r
            PadBottom = padding is { Length: 4 } ? padding[3] : 0f,\r
            HAlign = string.IsNullOrEmpty(layout?.HorizontalContentAlignment) ? "Left" : layout!.HorizontalContentAlignment!,\r
            VAlign = string.IsNullOrEmpty(layout?.VerticalContentAlignment) ? "Top" : layout!.VerticalContentAlignment!,\r
            GridFlow = layout?.GridFlow == "Vertical" ? "Vertical" : "Horizontal",\r
            GridCount = layout?.GridCount is int gridCount ? gridCount : 1,\r
            ChildOrder = order == null && orderedNodeIds == null && layout?.ChildOrder == "ByName" ? "ByName" : "Default",\r
        };\r
\r
        var items = new List<DjuiLayoutArranger.ArrangerItem>(entries.Count);\r
        foreach (var e in sorted)\r
        {\r
            items.Add(new DjuiLayoutArranger.ArrangerItem\r
            {\r
                Id = e.Id,\r
                Name = e.Control.Name,\r
                Width = ReadWidth(e.Control),\r
                Height = ReadHeight(e.Control),\r
                HGrow = e.Json?.WidthStretchRatio ?? 0f,\r
                VGrow = e.Json?.HeightStretchRatio ?? 0f,\r
            });\r
        }\r
\r
        var rects = DjuiLayoutArranger.Arrange(ReadWidth(containerControl), ReadHeight(containerControl), p, items);\r
        var controlsById = new Dictionary<string, Control>(StringComparer.Ordinal);\r
        foreach (var e in entries) controlsById[e.Id] = e.Control;\r
        foreach (var rect in rects)\r
        {\r
            // \u5199\u4F4D\u7F6E\u6CBF\u7528 DjuiLayoutSessionV6.ApplyRect \u7684\u5199\u6CD5\uFF08Absolute + UIPosition\uFF09\uFF0C\u4E0D\u53D1\u660E\u65B0\u5199\u6CD5\r
            if (controlsById.TryGetValue(rect.Id, out var childControl))\r
                DjuiLayoutSessionV6.ApplyRect(childControl, new DjuiRectV6(rect.X, rect.Y, rect.Width, rect.Height));\r
        }\r
    }\r
\r
    /// <summary>\u5B50\u9879 id \u5728\u663E\u5F0F\u987A\u5E8F\u8868\u4E2D\u7684\u540D\u6B21\uFF1A\u672A\u5217\u51FA\uFF08\u542B\u514B\u9686\u4F53\uFF09\u6052\u6392\u5DF2\u5217\u51FA\u9879\u4E4B\u540E\uFF08int.MaxValue \u5E76\u5217\u4FDD\u6301\u904D\u5386\u5E8F\uFF09\u3002</summary>\r
    private static int RankInOrder(string id, IReadOnlyList<string> orderedNodeIds)\r
    {\r
        for (var i = 0; i < orderedNodeIds.Count; i++)\r
            if (string.Equals(orderedNodeIds[i], id, StringComparison.Ordinal)) return i;\r
        return int.MaxValue;\r
    }\r
\r
    /// <summary>DJUI \u5185\u90E8 visual \u8F85\u52A9\u5C42\uFF08\u56FE\u7247/\u8FDB\u5EA6\u6761\u5B50\u5C42\u3001\u6309\u94AE\u6587\u672C Label\uFF09\u4E0D\u53C2\u4E0E\u5BB9\u5668\u6392\u5217\u3002</summary>\r
    private static bool IsAuxiliaryVisual(Control control)\r
    {\r
        var name = control.Name;\r
        if (string.IsNullOrEmpty(name)) return false;\r
        return name.StartsWith(DjuiImageVisualLayerV6.ReservedNamePrefix, StringComparison.Ordinal)\r
            || name.StartsWith(DjuiProgressVisualLayerV6.ReservedNamePrefix, StringComparison.Ordinal)\r
            || name == DjuiButtonStateV6.ButtonLabelName;\r
    }\r
\r
    /// <summary>\r
    /// \u8BFB\u63A7\u4EF6\u5F53\u524D\u5B9E\u9645\u5BBD\uFF08DIP\uFF09\u3002\u975E Auto \u8D70 Width.Value\uFF08ApplyRect \u663E\u5F0F\u8BBE\u503C\u3001\u540C\u6B65\u53EF\u8BFB\uFF0C\u5F15\u64CE\u6587\u6863\uFF1A\r
    /// Width \u53EA\u53CD\u6620\u7528\u6237\u8BBE\u7F6E\u7684\u503C\uFF09\uFF1BAuto\uFF08\u4E1A\u52A1\u6539\u8FC7\u5C3A\u5BF8\u7684\u514B\u9686\u4F53\uFF09\u9000 ActualSize\uFF08\u5F15\u64CE\u6587\u6863\uFF1A\u5E27\u672B\u624D\u751F\u6548\uFF0C\r
    /// \u5EFA\u6811\u540C\u5E27\u8C03\u7528\u53EF\u80FD\u53D6\u5230\u65E7\u503C\uFF09\u3002\u8D1F\u503C\u515C 0\u3002\u5148\u4F8B\uFF1ADjuiWindowTransitionV6 \u540C\u6B3E\u8BFB\u6CD5\u3002\r
    /// </summary>\r
    private static float ReadWidth(Control control)\r
        => Math.Max(0f, control.Width.IsAuto ? control.ActualSize.Width : control.Width.Value);\r
\r
    private static float ReadHeight(Control control)\r
        => Math.Max(0f, control.Height.IsAuto ? control.ActualSize.Height : control.Height.Value);\r
\r
    private static DjuiNodeV6? FindNode(DjuiNodeV6 root, string id)\r
    {\r
        if (string.Equals(root.Id, id, StringComparison.Ordinal)) return root;\r
        foreach (var child in root.Children)\r
        {\r
            var hit = FindNode(child, id);\r
            if (hit != null) return hit;\r
        }\r
        return null;\r
    }\r
\r
    public static void CloseWindow(string pageOrInstanceId)\r
    {\r
        var windowInstanceId = SingletonInstances.TryGetValue(pageOrInstanceId, out var singletonId) ? singletonId : pageOrInstanceId;\r
        if (!Instances.TryGetValue(windowInstanceId, out var instance) || ClosingTransitions.ContainsKey(windowInstanceId)) return;\r
        var closePreset = instance.Session.CurrentPage.Window?.Transition?.Close;\r
        // \u65E0 close \u8F6C\u573A\u4E0D\u518D\u540C\u5E27\u9500\u6BC1\u2014\u2014\u6458\u6808\u9690\u85CF\u8FDB\u4FDD\u7559\u6C60\uFF0C\u9500\u6BC1\u7EDF\u4E00\u5EF6\u540E\uFF08\u50F5\u5C38\u52A8\u753B\u515C\u5E95\uFF09\r
        ClosingTransitions[windowInstanceId] = -1; // \u540C\u5E27\u91CD\u5165\u4E5F\u53EA\u80FD\u5173\u95ED\u4E00\u6B21\r
        if (instance.Session.CurrentPage.Window?.Mode == "popup")\r
        {\r
            // Host \u4FDD\u6301\u5168\u5C4F\uFF0C\u963B\u6321\u5C42\u4E3A Root \u7684\u540E\u7F6E\u5144\u5F1F\uFF1A\u65E2\u4E0D\u6DE1\u51FA\uFF0C\u4E5F\u4E0D\u66F4\u6539\u4E1A\u52A1 Disabled/Visible/action\u3002\r
            var guard = new Panel { Name = "DJUI.closing-input", IsStatic = false, ZIndex = int.MaxValue, Parent = instance.Host };\r
            guard.FillParent();\r
            // \u539F\u751F\u547D\u4E2D\u9700\u8981\u4E8B\u4EF6\u63A5\u6536\u8005\uFF1B\u4EC5\u653E\u4E00\u4E2A\u65E0\u8BA2\u9605\u7684\u900F\u660E Panel \u4F1A\u7EE7\u7EED\u547D\u4E2D\u4E0B\u5C42\u3002\r
            guard.OnPointerPressed += (_, _) => { };\r
            guard.OnPointerReleased += (_, _) => { };\r
            guard.OnPointerClicked += (_, _) => { };\r
            ClosingInputGuards[windowInstanceId] = guard;\r
        }\r
        var transitionId = DjuiTransitionPlayer.PlayWindow(instance, closePreset, () => DetachWindow(windowInstanceId));\r
        if (transitionId < 0) DetachWindow(windowInstanceId);\r
        else ClosingTransitions[windowInstanceId] = transitionId;\r
    }\r
\r
    private static void CancelClosing(string windowInstanceId)\r
    {\r
        if (!ClosingTransitions.Remove(windowInstanceId, out var transitionId)) return;\r
        DjuiTransitionPlayer.Stop(transitionId);\r
        RemoveClosingInputGuard(windowInstanceId);\r
        if (Instances.TryGetValue(windowInstanceId, out var instance)) instance.Session.Relayout();\r
    }\r
\r
    /// <summary>\r
    /// \u6458\u6808\u9690\u85CF\uFF08\u53EF\u9006\uFF09\uFF1AOnClose \u4E8B\u4EF6 \u2192 \u6CE8\u9500\u5BFB\u5740\u6CE8\u518C\u8868\uFF08IsOpen \u7ACB\u5373 false\uFF0C\u8BED\u4E49\u4E0E\u65E7\u7248\u4E00\u81F4\uFF09\u2192\r
    /// \u505C\u8F6C\u573A \u2192 Host \u6458\u51FA\u53EF\u89C6\u6811\uFF08\u4E0D\u53EF\u89C1\uFF0B\u9000\u51FA\u4E8B\u4EF6\u94FE\uFF0C\u5F15\u64CE\u5BF9\u8C61\u6C60\u590D\u7528\u5B98\u65B9\u59FF\u52BF\uFF09\u2192 \u5165\u4FDD\u7559\u6C60\u6216\u9500\u6BC1\u7F13\u51B2\u3002\r
    /// \u5355\u4F8B\u5B9E\u4F8B\u5165 FIFO \u6C60\uFF08\u767D\u540D\u5355\u9875\u9489\u4F4F\u6C38\u4E0D\u6DD8\u6C70\uFF1B\u5BB9\u91CF\u6EE1\u6DD8\u6C70\u6700\u8001\u975E\u9489\u4F4F\u6761\u76EE\uFF09\uFF1B\r
    /// OpenInstance \u591A\u5B9E\u4F8B\u4E0E\u6C60\u5BB9\u91CF 0 \u7684\u9875\u76F4\u63A5\u8FDB\u9500\u6BC1\u7F13\u51B2\u3002\r
    /// </summary>\r
    private static void DetachWindow(string windowInstanceId)\r
    {\r
        if (!Instances.TryGetValue(windowInstanceId, out var instance)) return;\r
        ClosingTransitions[windowInstanceId] = -1; // OnClose \u56DE\u8C03\u5185\u518D\u6B21\u5173\u95ED\u4E5F\u4E0D\u9012\u5F52\r
        var pageId = instance.Session.CurrentPage.PageId;\r
        var fromSingleton = SingletonOpened.Remove(windowInstanceId);\r
\r
        // OnClose \u5FC5\u987B\u5728\u6CE8\u9500\u5BFB\u5740\u6CE8\u518C\u8868\u4E4B\u524D\u89E6\u53D1\u2014\u2014\u6B64\u65F6 IsOpen \u4ECD\u4E3A true\u3001GetSingletonControl \u4ECD\u53EF\u7528\r
        RaiseEvent(CloseHandlers, pageId, "OnClose");\r
\r
        ClosingTransitions.Remove(windowInstanceId);\r
        RemoveClosingInputGuard(windowInstanceId);\r
\r
        Instances.Remove(windowInstanceId);\r
        foreach (var singleton in SingletonInstances.Where(pair => pair.Value == windowInstanceId).ToArray()) SingletonInstances.Remove(singleton.Key);\r
        foreach (var pair in PageInstances.ToArray())\r
        {\r
            if (!pair.Value.Remove(windowInstanceId)) continue;\r
            if (pair.Value.Count == 0) PageInstances.Remove(pair.Key);\r
            break;\r
        }\r
        DjuiTransitionPlayer.Stop(instance.Root);\r
        instance.Host.RemoveFromVisualTreeAndParent();\r
\r
        var pinned = fromSingleton && PinnedPages.Contains(pageId);\r
        if (!fromSingleton || (!pinned && _poolCapacity <= 0))\r
        {\r
            // \u591A\u5B9E\u4F8B\u4E0D\u590D\u7528\uFF1B\u5BB9\u91CF 0\uFF1D\u7EAF\u9489\u4F4F\u6A21\u5F0F\uFF1A\u975E\u9489\u4F4F\u6761\u76EE\u4E0D\u5165\u6C60\r
            ScheduleDispose(new RetainedEntry { InstanceId = windowInstanceId, Instance = instance, PageId = pageId, Pinned = false });\r
            return;\r
        }\r
        var entry = new RetainedEntry { InstanceId = windowInstanceId, Instance = instance, PageId = pageId, Pinned = pinned };\r
        entry.Node = Pool.AddLast(entry);\r
        TrimPool();\r
    }\r
\r
    internal static bool IsClosing(string windowInstanceId) => ClosingTransitions.ContainsKey(windowInstanceId);\r
\r
    private static void RemoveClosingInputGuard(string windowInstanceId)\r
    {\r
        if (!ClosingInputGuards.Remove(windowInstanceId, out var guard)) return;\r
        guard.RemoveFromVisualTreeAndParent();\r
        guard.Dispose();\r
    }\r
\r
    /// <summary>\u5BB9\u91CF\u68C0\u67E5\uFF1A\u975E\u9489\u4F4F\u6761\u76EE\u8D85\u5BB9\u91CF\u65F6\uFF0C\u4ECE\u6C60\u5934\uFF08\u6700\u8001\uFF09\u9010\u4E2A\u6DD8\u6C70\u8FDB\u9500\u6BC1\u7F13\u51B2\u3002</summary>\r
    private static void TrimPool()\r
    {\r
        var unpinned = 0;\r
        for (var node = Pool.First; node != null; node = node.Next)\r
            if (!node.Value.Pinned) unpinned++;\r
        while (unpinned > _poolCapacity)\r
        {\r
            for (var node = Pool.First; node != null; node = node.Next)\r
            {\r
                if (node.Value.Pinned) continue;\r
                var evicted = node.Value;\r
                Pool.Remove(node);\r
                unpinned--;\r
                Game.Logger.LogInformation("DJUI v6: \u7A97\u53E3\u6C60\u6EE1\uFF0C\u6DD8\u6C70 {Page}#{Id}\uFF08{Delay}ms \u540E\u9500\u6BC1\uFF09", evicted.PageId, evicted.InstanceId, DisposeDelayMs);\r
                ScheduleDispose(evicted);\r
                break;\r
            }\r
        }\r
    }\r
\r
    /// <summary>\u767B\u8BB0\u9500\u6BC1\u7F13\u51B2\uFF08DisposeDelayMs \u5E27\u9A71\u52A8\u5012\u8BA1\u65F6\uFF09\u2014\u2014\u6DD8\u6C70\u3001\u591A\u5B9E\u4F8B\u5173\u95ED\u3001\u5BB9\u91CF 0 \u9875\u5171\u7528\u3002</summary>\r
    private static void ScheduleDispose(RetainedEntry entry)\r
    {\r
        entry.RemainingMs = DisposeDelayMs;\r
        entry.Node = null;\r
        Disposing.Add(entry);\r
        EnsureRetentionThinker();\r
    }\r
\r
    /// <summary>\u771F\u6B63\u9500\u6BC1\uFF08\u4E0D\u53EF\u9006\uFF09\uFF1AOnDestroy \u4E8B\u4EF6 \u2192 Dispose\u3002\u5916\u5C42\u515C\u5E95\u5F02\u5E38\u2014\u2014\u6761\u76EE\u5DF2\u5148\u51FA\u961F\uFF0C\u65E0\u8BBA\u6210\u8D25\u4E0D\u6B8B\u7559\u3002</summary>\r
    private static void DisposeInstance(RetainedEntry entry)\r
    {\r
        RaiseEvent(DestroyHandlers, entry.PageId, "OnDestroy");\r
        _disposeCount++;\r
        try { entry.Instance.Dispose(); }\r
        catch (Exception ex) { Game.Logger.LogWarning("DJUI v6: \u7A97\u53E3\u9500\u6BC1\u5F02\u5E38\uFF08\u5DF2\u9694\u79BB\uFF09\uFF1A{Page}#{Id} {Message}", entry.PageId, entry.InstanceId, ex.Message); }\r
    }\r
\r
    /// <summary>\u9500\u6BC1\u7F13\u51B2\u5012\u8BA1\u65F6\uFF08\u4E0E DjuiTransitionPlayer \u540C\u6B3E IThinker \u5E27\u9A71\u52A8\u6A21\u5F0F\uFF0Cdelta \u5355\u4F4D\u6BEB\u79D2\uFF09\u3002</summary>\r
    private sealed class RetentionThinker : IThinker\r
    {\r
        public bool DoesThink { get; set; } = true;\r
\r
        public void Think(int delta)\r
        {\r
            for (var i = Disposing.Count - 1; i >= 0; i--)\r
            {\r
                var entry = Disposing[i];\r
                entry.RemainingMs -= delta;\r
                if (entry.RemainingMs > 0) continue;\r
                Disposing.RemoveAt(i);   // \u5148\u51FA\u961F\u518D\u9500\u6BC1\u2014\u2014\u5F02\u5E38\u4E0D\u4E22\u6761\u76EE\r
                DisposeInstance(entry);\r
            }\r
        }\r
    }\r
\r
    private static RetentionThinker? _retentionThinker;\r
\r
    private static void EnsureRetentionThinker()\r
    {\r
        if (_retentionThinker != null) return;\r
        _retentionThinker = new RetentionThinker();\r
        Game.RegisterThinker(_retentionThinker);\r
    }\r
\r
    public static void CloseAll()\r
    {\r
        foreach (var id in Instances.Keys.ToArray())\r
        {\r
            CancelClosing(id);\r
            DetachWindow(id);\r
        }\r
        // \u6C60\u4E0E\u9500\u6BC1\u7F13\u51B2\u5168\u6E05\uFF08\u7ACB\u5373\u9500\u6BC1\uFF09\uFF1A\u8DE8 Initialize \u7684\u65E7\u6811\u7EDD\u4E0D\u80FD\u590D\u7528\u2014\u2014\u9875\u9762 JSON \u53EF\u80FD\u5728\u8FDB\u7A0B\u91CD\u542F\u95F4\u9699\u66F4\u65B0\u8FC7\r
        foreach (var entry in Pool.ToArray()) DisposeInstance(entry);\r
        Pool.Clear();\r
        foreach (var entry in Disposing.ToArray()) DisposeInstance(entry);\r
        Disposing.Clear();\r
        SingletonOpened.Clear();\r
    }\r
\r
    /// <summary>\u6CE8\u518C\u7A97\u53E3\u751F\u547D\u5468\u671F\u4E8B\u4EF6\uFF08\u591A\u8BA2\u9605\uFF0C\u8FDB\u7A0B\u7EA7\uFF09\u3002OnCreate\uFF1D\u5EFA\u6811\u540E\uFF1BOnOpen\uFF1D\u6BCF\u6B21\u663E\u793A\uFF08\u65B0\u5EFA/\u6C60\u590D\u7528\uFF09\uFF1BOnClose\uFF1D\u6458\u6808\u8FDB\u6C60\u524D\uFF1BOnDestroy\uFF1D\u771F\u6B63\u9500\u6BC1\u524D\u3002\u8F6C\u573A\u4E2D\u9014\u91CD\u5F00\u4E0D\u89E6\u53D1\u4EFB\u4F55\u4E8B\u4EF6\u3002</summary>\r
    public static void OnCreate(string pageId, Action handler) => AddHandler(CreateHandlers, pageId, handler);\r
    public static void OnOpen(string pageId, Action handler) => AddHandler(OpenHandlers, pageId, handler);\r
    public static void OnClose(string pageId, Action handler) => AddHandler(CloseHandlers, pageId, handler);\r
    public static void OnDestroy(string pageId, Action handler) => AddHandler(DestroyHandlers, pageId, handler);\r
\r
    private static void AddHandler(Dictionary<string, List<Action>> table, string pageId, Action handler)\r
    {\r
        if (!table.TryGetValue(pageId, out var list)) table[pageId] = list = new List<Action>();\r
        list.Add(handler);\r
    }\r
\r
    /// <summary>\u89E6\u53D1\u4E8B\u4EF6\uFF1A\u9010\u56DE\u8C03\u9694\u79BB\u5F02\u5E38\u2014\u2014\u751F\u547D\u5468\u671F\u901A\u77E5\u662F\u65C1\u8DEF\u903B\u8F91\uFF0C\u4E0D\u5141\u8BB8\u963B\u65AD\u7A97\u53E3\u72B6\u6001\u673A\u3002</summary>\r
    private static void RaiseEvent(Dictionary<string, List<Action>> table, string pageId, string eventName)\r
    {\r
        if (!table.TryGetValue(pageId, out var list)) return;\r
        foreach (var handler in list.ToArray())\r
        {\r
            try { handler(); }\r
            catch (Exception ex) { Game.Logger.LogWarning("DJUI v6: {Event} \u4E8B\u4EF6\u56DE\u8C03\u5F02\u5E38\uFF08\u5DF2\u9694\u79BB\uFF09\uFF1A{Page} {Message}", eventName, pageId, ex.Message); }\r
        }\r
    }\r
\r
    /// <summary>\u7A97\u53E3\u751F\u547D\u5468\u671F\u8BA1\u6570\uFF08\u5EFA\u6811 / \u590D\u7528 / \u9500\u6BC1\uFF09\uFF0C\u4F9B\u9A8C\u6536\u4E0E\u6392\u969C\uFF1A\u8FDE\u5F00\u8FDE\u5173 N \u6B21\u5EFA\u6811\u6570\u5E94\u6052\u5B9A\u3001\u590D\u7528\u6570\u5E94\u9012\u589E\u3002</summary>\r
    public static (int Built, int Reused, int Disposed) GetLifecycleStats() => (_buildCount, _reuseCount, _disposeCount);\r
\r
    private static T DeserializeStrict<T>(string file) where T : class\r
    {\r
        var json = File.ReadAllText(file);\r
        return JsonSerializer.Deserialize<T>(json, JsonOptions) ?? throw new InvalidDataException($"DJUI v6: JSON \u4E3A\u7A7A: {file}");\r
    }\r
\r
    private static void RequireVersion(int protocolVersion, int schemaVersion, string file)\r
    {\r
        if (protocolVersion != DjuiProtocolV6.ProtocolVersion || schemaVersion != DjuiProtocolV6.SchemaVersion)\r
            throw new InvalidDataException($"DJUI v6: \u7248\u672C\u4E0D\u5339\u914D {file}; \u9700\u8981 protocolVersion=6, schemaVersion=1");\r
    }\r
}\r
\r
#endif\r
`;

// raw:D:\git\DJUI\runtime\DjuiWindowTransitionV6.cs
var DjuiWindowTransitionV6_default = '#if CLIENT\r\nusing System.Numerics;\r\nusing GameUI.Control;\r\nusing GameUI.Struct;\r\n\r\nnamespace DjuiRuntime;\r\n\r\n/// <summary>\r\n/// popup \u8F6C\u573A\u7684\u5171\u4EAB\u51E0\u4F55\u7A7A\u95F4\u3002\u6839\u53EA\u6DE1\u5165\u6DE1\u51FA\uFF1B\u94FA\u6EE1 screen/parent \u7684\u6839\u5C42\u4E0D\u53D8\u5F62\u3002\r\n/// \u5176\u4F59\u76F4\u63A5\u5B50\u6811\u6309\u540C\u4E00\u4E2A\u6839\u4E2D\u5FC3\u505A\u4EFF\u5C04\u53D8\u6362\uFF0C\u800C\u975E\u5404\u81EA\u5728\u539F\u4F4D\u7F6E\u7F29\u653E\u3002\r\n/// \u4E0D\u6539\u7236\u5B50\u5173\u7CFB\u3001\u6811\u5E8F\u3001ID\u3001\u663E\u9690\u6216\u5B50\u5C42\u900F\u660E\u5EA6\uFF0C\u514B\u9686\u5B50\u6811\u81EA\u7136\u7EE7\u627F\u5176\u7236\u53D8\u6362\u3002\r\n/// </summary>\r\ninternal sealed class DjuiWindowTransitionV6 : IDisposable\r\n{\r\n    private readonly DjuiTreeInstanceV6 _instance;\r\n    private readonly DjuiTransitionPreset _preset;\r\n    private readonly Dictionary<Control, Geometry> _content = new();\r\n    private DjuiTransitionSnapshot _root;\r\n    private float _progress;\r\n\r\n    internal DjuiWindowTransitionV6(DjuiTreeInstanceV6 instance, DjuiTransitionPreset preset)\r\n    {\r\n        _instance = instance;\r\n        _preset = preset;\r\n        _root = Snapshot(instance.Root);\r\n        instance.Session.BeforeRelayout += BeforeRelayout;\r\n        instance.Session.AfterRelayout += AfterRelayout;\r\n    }\r\n\r\n    internal static DjuiTransitionSnapshot Snapshot(Control control)\r\n        => new(control.Scale, control.Opacity, control.Margin) { Position = control.Position };\r\n\r\n    internal static bool IsFixedLayer(DjuiNodeV6 node)\r\n    {\r\n        var target = node.Anchor?.Target ?? "parent";\r\n        if (target != "screen" && target != "parent") return false;\r\n        if (node.Stretch?.Style != "Both") return false;\r\n        // \u5BBD\u9AD8\u6BD4\u4F1A\u6539\u5199\u62C9\u4F38\u7ED3\u679C\uFF0C\u8FD9\u7C7B\u8282\u70B9\u5E76\u6CA1\u6709\u58F0\u660E\u94FA\u6EE1\u6839\u5BB9\u5668\u3002\r\n        if (node.AspectRatio?.Mode is string mode && mode != "None") return false;\r\n        var m = node.Stretch.Margins;\r\n        return (m?.Left ?? 0) == 0 && (m?.Top ?? 0) == 0 && (m?.Right ?? 0) == 0 && (m?.Bottom ?? 0) == 0;\r\n    }\r\n\r\n    internal void Apply(float progress)\r\n    {\r\n        _progress = progress;\r\n        var root = _instance.Root;\r\n        var fixedControls = new HashSet<Control>();\r\n        foreach (var node in _instance.Session.CurrentPage.Root.Children)\r\n            if (IsFixedLayer(node) && _instance.Session.GetControl<Control>(node.Id) is { } fixedControl)\r\n                fixedControls.Add(fixedControl);\r\n\r\n        // \u4FDD\u7559\u65B0\u589E\u7684\u6839\u5C42\u514B\u9686/\u4E1A\u52A1\u5B50\u6811\uFF0C\u4E14\u4ECE\u4E0D\u63A5\u7BA1\u5B83\u4EEC\u7684 Visible/Opacity\u3002\r\n        foreach (var child in root.Children ?? Array.Empty<Control>())\r\n        {\r\n            if (!child.IsValid || fixedControls.Contains(child)) continue;\r\n            if (!_content.ContainsKey(child)) _content.Add(child, new Geometry(child));\r\n        }\r\n        _preset.Apply(root, progress, _root);\r\n        var factor = new Vector2(\r\n            _root.Scale.X == 0 ? 1 : root.Scale.X / _root.Scale.X,\r\n            _root.Scale.Y == 0 ? 1 : root.Scale.Y / _root.Scale.Y);\r\n        var offset = new Vector2(root.Position.X - _root.Position.X, root.Position.Y - _root.Position.Y);\r\n        RestoreRootGeometry();\r\n        var pivot = new Vector2(root.Width.Value, root.Height.Value) * 0.5f;\r\n        foreach (var (control, geometry) in _content)\r\n        {\r\n            if (!control.IsValid || !ReferenceEquals(control.Parent, root)) continue;\r\n            geometry.Apply(control, pivot, factor, offset);\r\n        }\r\n    }\r\n\r\n    private void RestoreRootGeometry()\r\n    {\r\n        if (!_instance.Root.IsValid) return;\r\n        _instance.Root.Scale = _root.Scale;\r\n        _instance.Root.Margin = _root.Margin;\r\n        _instance.Root.Position = _root.Position;\r\n    }\r\n\r\n    private void BeforeRelayout()\r\n    {\r\n        Restore();\r\n        _content.Clear();\r\n    }\r\n\r\n    private void AfterRelayout()\r\n    {\r\n        _root = Snapshot(_instance.Root);\r\n        Apply(_progress);\r\n    }\r\n\r\n    internal void Restore()\r\n    {\r\n        RestoreRootGeometry();\r\n        if (_instance.Root.IsValid) _instance.Root.Opacity = _root.Opacity;\r\n        foreach (var (control, geometry) in _content)\r\n            if (control.IsValid) geometry.Restore(control);\r\n    }\r\n\r\n    public void Dispose()\r\n    {\r\n        _instance.Session.BeforeRelayout -= BeforeRelayout;\r\n        _instance.Session.AfterRelayout -= AfterRelayout;\r\n        Restore();\r\n    }\r\n\r\n    private sealed class Geometry\r\n    {\r\n        private Vector2 _scale;\r\n        private UIPosition _position;\r\n        private Vector2 _lastScale;\r\n        private UIPosition _lastPosition;\r\n\r\n        internal Geometry(Control control)\r\n        {\r\n            _lastScale = _scale = control.Scale;\r\n            _lastPosition = _position = control.Position;\r\n        }\r\n\r\n        // \u4E1A\u52A1\u5728\u8F6C\u573A\u671F\u95F4\u4E3B\u52A8\u6539\u52A8\u51E0\u4F55\u65F6\uFF0C\u4E0D\u7528\u65E7\u5FEB\u7167\u8986\u76D6\u65B0\u503C\u3002\r\n        private void CaptureChanges(Control control)\r\n        {\r\n            if (control.Scale != _lastScale) _scale = control.Scale;\r\n            if (control.Position != _lastPosition) _position = control.Position;\r\n        }\r\n\r\n        internal void Apply(Control control, Vector2 pivot, Vector2 factor, Vector2 offset)\r\n        {\r\n            CaptureChanges(control);\r\n            var halfSize = new Vector2(control.Width.IsAuto ? control.ActualSize.Width : control.Width.Value,\r\n                control.Height.IsAuto ? control.ActualSize.Height : control.Height.Value) * 0.5f;\r\n            var center = new Vector2(_position.X, _position.Y) + halfSize;\r\n            var translated = pivot + (center - pivot) * factor + offset - halfSize;\r\n            control.Scale = _lastScale = _scale * factor;\r\n            control.Position = _lastPosition = new UIPosition(translated.X, translated.Y);\r\n        }\r\n\r\n        internal void Restore(Control control)\r\n        {\r\n            CaptureChanges(control);\r\n            control.Scale = _scale;\r\n            control.Position = _position;\r\n        }\r\n    }\r\n}\r\n#endif\r\n';

// raw:D:\git\DJUI\runtime\AGENTS.md
var AGENTS_default = '# DJUI Runtime \u90E8\u7F72\u5951\u7EA6\r\n\r\n> \u672C\u6587\u4EF6\u7531 DJUI \u7F16\u8F91\u5668\u968F Runtime \u5206\u53D1\uFF08`djui_version.txt` \u8BB0\u5F55\u7248\u672C\uFF09\u3002\r\n> \u63CF\u8FF0 Runtime \u4E0E\u661F\u706B\u5DE5\u7A0B\u4E4B\u95F4\u7684**\u90E8\u7F72\u5951\u7EA6\u4E0E\u4F7F\u7528\u8303\u5F0F**\u3002\u6539 Runtime \u884C\u4E3A\u8BF7\u56DE DJUI \u4ED3\u5E93 `runtime/` \u6E90\u6587\u4EF6\uFF0C\u52FF\u5728\u6B64\u624B\u6539 .cs\u3002\r\n\r\n## \u8DEF\u5F84\u5951\u7EA6\uFF08\u8C01\u5199\u54EA\u3001\u8C01\u8BFB\u54EA\uFF09\r\n\r\n| \u8D44\u6E90 | \u552F\u4E00\u5199\u5165\u65B9\uFF08DJUI\u300C\u53D1\u5E03\u300D\uFF09 | Runtime \u8BFB\u53D6\u8DEF\u5F84 | \u8BF4\u660E |\r\n|---|---|---|---|\r\n| \u9879\u76EE\u914D\u7F6E | `ui/AppBundle/user_files/djui/project.json` | `user_files/djui/project.json` | v6 Canvas\u3001\u5BBD\u5C4F\u9608\u503C\u548C\u9ED8\u8BA4\u5B57\u4F53\u7684\u552F\u4E00\u8FD0\u884C\u914D\u7F6E |\r\n| \u9875\u9762 JSON | `ui/AppBundle/user_files/djui/pages/` | \u76F8\u5BF9\u8DEF\u5F84 `user_files/djui/pages`\uFF08\u5BA2\u6237\u7AEF\u8FDB\u7A0B CWD=`ui/`\uFF09 | **\u670D\u52A1\u7AEF\u4E0D\u6D88\u8D39\u9875\u9762 JSON**\uFF08Runtime \u5168\u90E8 `#if CLIENT`\uFF09\uFF0C\u6839 AppBundle \u65E0\u9700\u53D1\u5E03 djui \u8D44\u6E90\u3002\u7F16\u8F91\u6E90\u5728 UI \u5DE5\u4F5C\u533A `.djui/layout/pages/`\uFF0C\u661F\u706B\u5DE5\u7A0B\u7684 `ui/djui` \u662F\u53D1\u5E03\u955C\u50CF\uFF0C\u8FD0\u884C\u4E0D\u8BFB |\r\n| \u97F3\u6548\u914D\u7F6E | `ui/AppBundle/user_files/djui/sounds.json` | `user_files/djui/sounds.json` | \u540C\u4E0A\uFF0C\u4EC5\u5BA2\u6237\u7AEF |\r\n| \u56FE\u7247\u7D20\u6750 | `ui/image/djui/` | \u5F15\u64CE\u76F4\u8BFB\uFF08`image/djui/...` \u76F8\u5BF9 `ui/` \u6839\uFF09\uFF0C\u4E0D\u8FDB AppBundle | \u63A7\u4EF6 `appearance.image` \u5199 `image/djui/...` |\r\n\r\n**\u5173\u952E\u70B9**\uFF1A\u9875\u9762/\u97F3\u6548\u7684\u552F\u4E00\u8FD0\u884C\u6D88\u8D39\u65B9\u662F\u5BA2\u6237\u7AEF\u8FDB\u7A0B\uFF08CWD=`ui/`\uFF09\uFF0C\u53D1\u5E03\u53EA\u5199 `ui/AppBundle`\u3002\u4EFB\u4F55\u624B\u5DE5\u62F7\u8D1D\u9875\u9762 JSON \u7684\u884C\u4E3A\u90FD\u88AB\u7981\u6B62\u2014\u2014\u62F7\u9519\u4F4D\u7F6E\uFF08\u5982\u62F7\u5230\u6839 AppBundle\uFF09\u6216\u7248\u672C\u9519\u4F4D\u6B63\u662F\u300C\u9875\u9762\u6CA1\u5F00 / \u56FE\u4E0D\u5BF9\u300D\u7C7B\u6545\u969C\u7684\u6839\u6E90\u3002\r\n\r\n## \u4F7F\u7528\u8303\u5F0F\uFF08\u5BA2\u6237\u7AEF\u4EE3\u7801\uFF09\r\n\r\n```csharp\r\nusing DjuiRuntime;\r\n\r\n// 1. \u521D\u59CB\u5316\uFF1A\u4E25\u683C\u52A0\u8F7D protocolVersion=6/schemaVersion=1 \u9879\u76EE\u4E0E\u9875\u9762\r\nDjuiWindowManagerV6.Initialize();\r\n\r\n// 2. \u9875\u9762\u5355\u4F8B\uFF1A\u91CD\u590D\u6253\u5F00\u540C\u4E00 pageId \u4E0D\u4F1A\u521B\u5EFA\u91CD\u590D\u7A97\u53E3\r\nPanel root = DjuiWindowManagerV6.OpenWindow("main_menu");\r\n\r\n// 3. \u9875\u9762\u4F5C\u7528\u57DF\u67E5\u8BE2\uFF1B\u4E0D\u8981\u4F7F\u7528\u5168\u5C40\u88F8\u8282\u70B9 ID\r\nvar btn = DjuiWindowManagerV6.GetSingletonControl<Button>("main_menu", "button_start");\r\n\r\n// 4. \u53EA\u6709\u786E\u5B9E\u9700\u8981\u540C\u9875\u591A\u5B9E\u4F8B\u65F6\u624D\u4F7F\u7528\u5B9E\u4F8B API\r\nstring instanceId = DjuiWindowManagerV6.OpenInstance("toast");\r\nvar label = DjuiWindowManagerV6.GetControl<Label>(instanceId, "toast_text");\r\n\r\n// 5. \u4E8B\u4EF6\u8DEF\u7531\uFF08\u9875\u9762 JSON \u4E2D djui.action \u58F0\u660E\u7684\u52A8\u4F5C\u540D\uFF09\r\nDjuiActionRouter.On("open_inventory", () => { ... });\r\n\r\n// 6. \u6570\u636E\u7ED1\u5B9A\uFF08Set \u540E\u7ED1\u5B9A\u8BE5 key \u7684\u63A7\u4EF6\u81EA\u52A8\u5237\u65B0\uFF09\r\nDjuiBindingSystem.Set("coin_count", 999);\r\n\r\n// 7. \u8FD0\u884C\u65F6\u52A8\u6001\u7981\u7528\uFF08\u8D70\u6B64\u65B9\u6CD5\u6216 disabled \u7ED1\u5B9A\u624D\u4F1A\u5237\u65B0 DJUI \u7981\u7528\u89C6\u89C9\uFF1B\r\n//    \u76F4\u63A5\u7ED9\u5F15\u64CE\u63A7\u4EF6\u8D4B Disabled \u53EA\u62E6\u622A\u70B9\u51FB\u3001\u4E0D\u53D8\u7070\u2014\u2014\u5F15\u64CE\u65E0 Disabled \u53D8\u66F4\u901A\u77E5\uFF09\r\nDjuiButtonState.SetDisabled(btn, false);\r\n\r\n// 8. \u8FD0\u884C\u65F6\u6362\u56FE\uFF08SetImage \u4E09\u53E3\u5F84\uFF0C\u8BE6\u89C1\u4E0B\u65B9\u300C\u8FD0\u884C\u65F6\u6362\u56FE\uFF08SetImage\uFF09\u300D\uFF09\r\nDjuiWindowManagerV6.SetImage(\u9875\u9762\u6807\u8BC6.\u5EFA\u7B51\u8BE6\u60C5, "building_detail_upgrade_button", "image/djui/buttons/\u5347\u7EA7\u7EFF\u5E95.png");\r\nDjuiWindowManagerV6.SetImage(\u683C\u5B50\u63A7\u4EF6\u5F15\u7528, \u54C1\u8D28\u5E95\u56FE\u8DEF\u5F84);   // \u76F4\u63A7\u53E3\u5F84\uFF1A\u514B\u9686\u4F53/authored \u901A\u5403\r\n```\r\n\r\n## \u6309\u94AE\u72B6\u6001\u89C6\u89C9\uFF08normal / hover / pressed / disabled\uFF09\r\n\r\n\u6309\u94AE\u56DB\u6001\u6362\u56FE\u4E0E\u7981\u7528\u7070\u5316\u7531 DJUI Runtime \u81EA\u7BA1\uFF08\u661F\u706B\u5F15\u64CE Button \u65E0 ImageDisabled\uFF0C\u4E14 v6 \u56FE\u7247\u753B\u5728\u5B50 Panel \u4E0A\u3001\u5F15\u64CE\u72B6\u6001\u6362\u56FE\u4E0D\u53EF\u7528\uFF09\uFF1A\r\n\r\n- `button.imageHover` / `button.imagePressed` / `button.imageDisabled`\uFF1A\u4E09\u4E2A\u53EF\u9009\u72B6\u6001\u56FE\uFF0C\u672A\u8BBE\u7F6E\u7684\u6001\u6CBF\u7528\u6B63\u5E38\u56FE\r\n- \u7981\u7528\u65F6\u672A\u914D\u7F6E `imageDisabled` \u2192 \u81EA\u52A8\u515C\u5E95\uFF1A\u56FE\u7247\u7070\u5EA6 + \u6574\u4F53\u900F\u660E\u5EA6\u964D\u4E3A 50%\uFF08\u5E38\u91CF `DjuiButtonStateV6.DisabledFallbackOpacity`\uFF0C\u5B9E\u6D4B\u540E\u53EF\u8C03\uFF09\r\n- \u52A8\u6001\u5207\u6362\u7981\u7528\uFF1A\u6570\u636E\u7ED1\u5B9A\u5C5E\u6027 `disabled`\uFF08`DjuiBindingSystem.Set("key", bool)`\uFF09\u6216 `DjuiButtonState.SetDisabled(control, bool)`\r\n- \u8FD0\u884C\u65F6\u6362 normal \u5E95\u56FE\uFF1A`DjuiWindowManagerV6.SetImage(...)`\u2014\u2014\u8D70 `DjuiButtonStateV6` \u72B6\u6001\u673A\u901A\u9053\uFF08`Attach \u2192 Update`\uFF09\uFF0Chover/pressed/disabled \u672A\u914D\u7F6E\u7684\u6001\u4E0E\u7981\u7528\u7070\u5316\u515C\u5E95\u81EA\u52A8\u8DDF\u968F\u65B0\u5E95\u56FE\uFF1B\u4E0E `SetDisabled` \u540C\u72B6\u6001\u673A\u5355\u70B9\u5199 visual\uFF0C\u4E92\u4E0D\u8986\u76D6\r\n\r\n## \u8FD0\u884C\u65F6\u6362\u56FE\uFF08SetImage\uFF09\r\n\r\n\u6E38\u620F\u4EE3\u7801\u53EF\u5728\u8FD0\u884C\u65F6\u66FF\u6362\u8282\u70B9\u56FE\u7247\uFF0C**\u53EA\u6362\u56FE\u4E0D\u52A8\u6392\u7248**\uFF1A`imageFit / sourceSize / focalX/focalY / slicedEdges / desaturated` \u7B49\u6CBF\u7528\u8BE5\u8282\u70B9\u539F appearance \u503C\uFF0C\u5BBF\u4E3B\u77E9\u5F62\u4E0D\u53D8\u3002\u4E09\u4E2A\u516C\u5F00\u91CD\u8F7D\uFF1A\r\n\r\n- `SetImage(pageId, nodeInstanceId, image)`\uFF1A\u5355\u4F8B\u9875\u53E3\u5F84\uFF08\u4E1A\u52A1\u6700\u5E38\u7528\uFF09\r\n- `SetImageByInstance(windowInstanceId, nodeInstanceId, image)`\uFF1A`OpenInstance` \u591A\u5B9E\u4F8B\u9875\u53E3\u5F84\uFF08\u5982\u98D8\u5B57\uFF09\r\n- `SetImage(control, image)`\uFF1A\u76F4\u63A7\u53E3\u5F84\uFF0C\u6309 `Control` \u5F15\u7528\u6362\u56FE\u2014\u2014**\u514B\u9686\u4F53\uFF08CloneControl \u4EA7\u7269\uFF09/ authored \u8282\u70B9\u901A\u5403**\uFF0C\u4E1A\u52A1\u624B\u91CC\u662F\u514B\u9686\u63A7\u4EF6\u5F15\u7528\u65F6\u7528\u8FD9\u4E2A\uFF08\u514B\u9686\u4F53\u4E0D\u80FD\u7528 id \u5BFB\u5740\u65F6\u4E5F\u515C\u5E95\u652F\u6301 `\u6E90id#cN`\uFF09\r\n\r\n\u884C\u4E3A\u53E3\u5F84\uFF1A\r\n\r\n- `image` \u4F20 `null`/\u7A7A\u4E32\uFF1D\u64A4\u9500\u56FE\u7247\uFF08\u56DE\u5230\u65E0\u56FE\u5F62\u6001\uFF09\r\n- authored \u7A7A\u56FE\u7247\u7684\u8282\u70B9\uFF08\u5982\u5BBF\u4E3B\u81EA\u6E32\u67D3\u7684\u98D8\u5B57\u56FE\u6807\uFF09\u6362\u56FE\u540E\u81EA\u52A8\u5207\u6362\u4E3A visual \u5B50\u5C42\u6E32\u67D3\uFF1B\u64A4\u9500\u540E\u8FD8\u539F\r\n- \u5DF2\u5F00\u7A97\u53E3\u6362\u56FE\u540E\uFF0C\u8F6C\u5C4F/\u89C6\u53E3\u53D8\u5316\u89E6\u53D1\u7684\u91CD\u65B0\u5E03\u5C40**\u4E0D\u4F1A\u628A\u56FE\u7247\u6062\u590D\u6210\u65E7\u503C**\uFF08\u6362\u56FE\u540C\u6B65\u5199\u5165\u5E03\u5C40\u6570\u636E\u6A21\u578B\uFF09\r\n- \u5BF9 Button\uFF1D\u66F4\u6362 normal \u5E95\u56FE\uFF0C\u4E0E `SetDisabled` \u7981\u7528\u7070\u5316\u81EA\u7136\u5171\u5B58\r\n- \u8FD4\u56DE `false`\uFF1D\u9875\u9762\u672A\u5F00 / \u8282\u70B9\u4E0D\u5B58\u5728 / \u8282\u70B9\u662F Progress\uFF0C\u5747\u8BB0 Warning \u65E5\u5FD7\u3001\u4E0D\u629B\u5F02\u5E38\r\n\r\n\u6570\u636E\u7ED1\u5B9A\u901A\u9053\uFF1A\u8282\u70B9 `djui.bindings` \u58F0\u660E `"image": "\u7ED1\u5B9Akey"` \u540E\uFF0C`DjuiBindingSystem.Set(key, \u56FE\u7247\u8DEF\u5F84)` \u5373\u6362\u56FE\uFF08\u4E0E SetImage \u540C\u4E00\u901A\u9053\uFF0C\u7A7A\u503C\u64A4\u9500\uFF09\u3002\u7ED1\u5B9A\u901A\u9053\u7684\u72EC\u7279\u4F18\u52BF\uFF1A**\u7A97\u53E3\u9500\u6BC1\u91CD\u5EFA\uFF08\u6C60\u6DD8\u6C70\uFF09\u540E\u65B0\u6811\u6CE8\u518C\u65F6\u81EA\u52A8\u6062\u590D\u6700\u8FD1\u4E00\u6B21\u56FE\u503C**\uFF1B\u76F4\u63A5 SetImage \u7684\u503C\u968F\u65E7\u6811\u9500\u6BC1\u4E22\u5931\uFF0C\u4E1A\u52A1\u9700\u5728 `OnCreate`/`OnOpen` \u91CC\u91CD\u653E\uFF08\u4E1A\u52A1\u5DF2\u6709\u91CD\u5F00\u5168\u91CF\u91CD\u5237\u60EF\u4F8B\uFF09\u3002\r\n\r\n**\u9650\u5236\uFF08\u9996\u7248\u53E3\u5F84\uFF09**\uFF1A\r\n\r\n1. Progress \u8FDB\u5EA6\u6761\u56FE\u7247\u4E0D\u652F\u6301\u8FD0\u884C\u65F6\u6362\u56FE\uFF08\u8D70\u4E13\u5C5E\u89C6\u89C9\u5C42\uFF0C\u4E09\u5904\u673A\u5236\u4E92\u4E0D\u76F8\u540C\uFF0C\u9996\u7248\u660E\u786E\u6392\u9664\uFF09\r\n2. \u8282\u70B9\u58F0\u660E\u4E86\u5BBD\u5C4F\u8986\u76D6 `responsive.wide.overrides` \u7684 `appearance.image` \u65F6\uFF0C\u5BBD\u5C4F\u6001 SetImage \u4E0D\u751F\u6548\uFF08\u5BBD\u5C4F\u5C42\u6BCF\u6B21\u89E3\u6790\u90FD\u4F1A\u628A\u8986\u76D6\u56FE\u76D6\u56DE\u6765\uFF09\u2014\u2014\u6539\u7528\u53CC\u8282\u70B9\u6CD5\u6216\u53BB\u6389\u8BE5\u8986\u76D6\uFF08\u4F1A\u6709\u4E00\u6B21\u6027 Warning \u63D0\u793A\uFF09\r\n3. \u7A97\u53E3\u6C60\u6DD8\u6C70\u9500\u6BC1\u91CD\u5EFA\u540E\uFF0C\u76F4\u63A5 SetImage \u7684\u503C\u4E22\u5931\u2014\u2014\u5728 `OnCreate`/`OnOpen` \u91CD\u653E\uFF0C\u6216\u6539\u8D70 image \u7ED1\u5B9A\r\n4. \u514B\u9686\u4F53\u65E0\u6570\u636E\u7ED1\u5B9A\uFF08\u514B\u9686\u4E0D\u7ED1\u884C\u4E3A\uFF09\uFF0C\u6362\u56FE\u53EA\u80FD\u8D70 `SetImage(Control, \u2026)`\r\n5. **\u5E26\u5B50\u4EF6\u7684\u8282\u70B9\uFF0C\u8FD0\u884C\u65F6\u5EFA\u5C42\u6216\u300C\u64A4\u9500\u56FE\u7247\u540E\u518D\u8BBE\u56DE\u300D\u90FD\u4F1A\u628A\u56FE\u7247\u7ED8\u5236\u5728\u5B50\u4EF6\u4E4B\u4E0A**\uFF08Z \u5E8F\u4E0E\u7F16\u8F91\u5668\u53CA\u521D\u59CB\u5EFA\u6811\u76F8\u53CD\uFF0C\u4E14\u4E0D\u4F1A\u88AB\u91CD\u653E\u7EA0\u6B63\uFF09\uFF1A\u7A7A\u56FE\u7247\u7684\u5BB9\u5668\u8282\u70B9\u9996\u6B21\u6362\u56FE\u3001\u4EE5\u53CA\u4EFB\u4F55\u8282\u70B9 `SetImage(null)` \u64A4\u9500\u540E\u518D\u8BBE\u56DE\uFF0C\u90FD\u4F1A\u89E6\u53D1\u3002**\u5E26\u5B50\u4EF6\u7684\u8282\u70B9\u5E94\u907F\u514D SetImage(null) \u64A4\u9500\u64CD\u4F5C**\uFF1B\u786E\u9700\u6062\u590D\u6B63\u786E\u5C42\u7EA7\u53EA\u80FD\u9500\u6BC1\u91CD\u5EFA\u7A97\u53E3\uFF08\u6C60\u6DD8\u6C70/CloseAll \u540E\u91CD\u5F00\uFF09\r\n\r\n## \u514B\u9686\u4E0E\u52A8\u6001\u5C3A\u5BF8\u7684\u56FE\u7247\u540C\u6B65\uFF08Runtime 0.8.10\uFF09\r\n\r\n`CloneControl` \u8FD4\u56DE\u524D\u4F1A\u6309\u514B\u9686\u7684\u6700\u7EC8\u89E3\u7B97\u77E9\u5F62\u540C\u6B65\u9884\u7F6E\u56FE\u7247\u4E0E\u7EBF\u6027\u8FDB\u5EA6\u6761\u7684\u7ED8\u5236\u5C42\uFF0C\u65E0\u9700\u91CD\u590D\u8BBE\u7F6E\u540C\u4E00\u5F20\u56FE\u7247\u3002\r\n\r\n- \u76F4\u63A5\u8BBE\u7F6E DJUI \u63A7\u4EF6\u7684\u663E\u5F0F `Width/Height` \u540E\uFF0C\u666E\u901A\u56FE\u7247\u5728\u4E0B\u4E00\u6B21 Runtime \u56FE\u7247\u540C\u6B65 `Think` \u81EA\u52A8\u91CD\u7B97\u77E9\u5F62\uFF1B\u9690\u85CF\u6216\u672A\u6302\u6811\u7684\u63A7\u4EF6\u540C\u6837\u540C\u6B65\u3002\u7EBF\u6027\u8FDB\u5EA6\u6761\u6CBF\u7528\u539F\u6709\u5E27\u540C\u6B65\u673A\u5236\u3002\r\n- \u9700\u8981\u672C\u6B21\u8C03\u7528\u5185\u540C\u6B65\u5B8C\u6210\u65F6\uFF0C\u4F7F\u7528 `public static bool DjuiWindowManagerV6.RefreshVisuals(Control control, bool recursive = true)`\uFF1B\u9ED8\u8BA4\u5237\u65B0\u63A7\u4EF6\u53CA\u5F53\u524D\u5DF2\u6302\u63A5\u7684\u5B50\u6811\uFF0C`recursive: false` \u53EA\u5237\u65B0\u672C\u63A7\u4EF6\u3002\u65E0\u6548\u63A7\u4EF6\u6216\u4E0D\u5C5E\u4E8E\u5B58\u6D3B DJUI \u4F1A\u8BDD\u7684\u63A7\u4EF6\u8FD4\u56DE `false`\u3002\r\n- \u63A5\u53E3\u53EA\u540C\u6B65\u73B0\u6709\u7ED8\u5236\u5C42\uFF1A\u4E0D\u6539\u5BBF\u4E3B\u4F4D\u7F6E/\u5C3A\u5BF8\u3001\u663E\u9690\u3001\u9875\u9762\u6570\u636E\u6216\u951A\u70B9/\u62C9\u4F38\u7EA6\u675F\uFF0C\u4E0D\u89E6\u53D1 authored \u5E03\u5C40\u91CD\u6392\uFF0C\u4E0D\u6362\u56FE\u7247\uFF1B\u56FE\u7247\u6BD4\u4F8B\u3001sourceSize\u3001\u7126\u70B9\u3001\u4E5D\u5BAB\u683C\u3001\u67D3\u8272\u548C\u6309\u94AE\u5F53\u524D\u72B6\u6001\u6CBF\u7528\u3002\u653E\u5C04\u72B6\u8FDB\u5EA6\u6761\u4ECD\u7531\u5F15\u64CE\u539F\u751F\u6E32\u67D3\u3002\r\n- \u5951\u7EA6\u662F **\u663E\u5F0F\u8BBE\u5B9A\u7684 Width/Height**\uFF0C\u4E0D\u4FDD\u8BC1\u5F15\u64CE Auto/\u767E\u5206\u6BD4\u5E03\u5C40\u8BA1\u7B97\u51FA\u7684 `ActualSize` \u540C\u6B65\u3002\u4E1A\u52A1\u4FEE\u6539\u591A\u4E2A\u5B50\u63A7\u4EF6\u65F6\uFF0C\u5148\u6302\u63A5\u5230\u514B\u9686\u6811\u3001\u6279\u91CF\u8BBE\u5B8C\u5C3A\u5BF8\uFF0C\u518D\u5237\u65B0\u514B\u9686\u6839\u3002\u4EC5\u6539\u53D8 Position/Visible \u65E0\u9700\u5237\u65B0\u3002\r\n- authored \u63A7\u4EF6\u7684\u4E1A\u52A1\u5C3A\u5BF8\u4FEE\u6539\u662F\u4E34\u65F6\u8986\u76D6\uFF0C\u540E\u7EED authored Relayout \u4ECD\u6309\u9875\u9762\u6A21\u578B\u91CD\u65B0\u5E03\u5C40\uFF1B\u514B\u9686\u4F53\u4FDD\u6301\u65E2\u6709\u300C\u4E0D\u53C2\u4E0E authored Relayout\u300D\u8BED\u4E49\u3002\u5C3A\u5BF8\u5237\u65B0\u4E0D\u7F29\u653E\u6216\u91CD\u65B0\u6392\u5E03\u4E1A\u52A1\u5B50\u63A7\u4EF6\u3002\r\n- \u65B0 API \u9700 Runtime \u2265 0.8.10\uFF1B\u65E2\u6709 CloneControl/SetImage/SetTint \u8C03\u7528\u517C\u5BB9\uFF0C\u9884\u7F6E\u56FE\u7247\u7684\u81EA\u52A8\u540C\u6B65\u4E0D\u8981\u6C42\u4FEE\u6539\u4E1A\u52A1\u4EE3\u7801\u3002\u540C\u6B65 Runtime \u4E0E\u811A\u672C\u533A\u540E\u518D\u63A5\u5165\u65B0 API\u3002\r\n\r\n```csharp\r\nvar cell = DjuiWindowManagerV6.CloneControl(windowInstanceId, templateNodeId);\r\ncell.Parent = list;\r\ncell.Width = 96;\r\ncell.Height = 96;\r\n// \u5B50\u63A7\u4EF6 Position/Width/Height \u6309\u4E1A\u52A1\u89C4\u5219\u8BBE\u7F6E\u5B8C\u6BD5\u4E4B\u540E\uFF1A\r\nDjuiWindowManagerV6.RefreshVisuals(cell); // \u672C\u6B21\u8C03\u7528\u5185\u540C\u6B65\u6574\u68F5\u514B\u9686\u5B50\u6811\r\nbadge.Visible = true;                    // \u9884\u7F6E\u56FE\u65E0\u9700\u91CD\u590D SetImage\r\n```\r\n\r\n## \u8FD0\u884C\u65F6\u67D3\u8272\uFF08SetTint\uFF09\r\n\r\n\u6E38\u620F\u4EE3\u7801\u53EF\u5728\u8FD0\u884C\u65F6\u7ED9\u8282\u70B9\u56FE\u7247\u67D3\u4E0A\u4E58\u7B97\u8272\uFF0C**\u53EA\u67D3\u8272\u4E0D\u52A8\u56FE\u7247\u4E0E\u6392\u7248**\u3002\u4E09\u4E2A\u516C\u5F00\u91CD\u8F7D\u4E0E SetImage \u4E00\u4E00\u540C\u6784\uFF1A\r\n\r\n- `SetTint(pageId, nodeInstanceId, tint)`\uFF1A\u5355\u4F8B\u9875\u53E3\u5F84\uFF08\u4E1A\u52A1\u6700\u5E38\u7528\uFF09\r\n- `SetTintByInstance(windowInstanceId, nodeInstanceId, tint)`\uFF1A`OpenInstance` \u591A\u5B9E\u4F8B\u9875\u53E3\u5F84\r\n- `SetTint(control, tint)`\uFF1A\u76F4\u63A7\u53E3\u5F84\uFF0C\u514B\u9686\u4F53 / authored \u8282\u70B9\u901A\u5403\r\n\r\n\u884C\u4E3A\u53E3\u5F84\uFF1A\r\n\r\n- \u67D3\u8272\u662F**\u4E58\u7B97**\uFF1A\u56FE\u7247\u50CF\u7D20 \xD7 \u989C\u8272\u3002\u767D\u8272\u7D20\u6750\uFF1D\u76F4\u63A5\u53D8\u6210\u8BE5\u989C\u8272\uFF08\u4E00\u5957\u767D\u56FE\u591A\u8272\u590D\u7528\uFF0C\u5982\u661F\u7EA7\u661F\u3001\u54C1\u8D28\u6846\uFF09\uFF1B**\u900F\u660E\u533A\u57DF\u4FDD\u6301\u900F\u660E**\uFF0C\u4E0D\u4F1A\u51FA\u73B0\u8272\u5757\r\n- \u989C\u8272\u5E26 alpha \u65F6\u6309 `\u539F\u56FE\xD7\u989C\u8272\xD7\u03B1 + \u539F\u56FE\xD7(1-\u03B1)` \u6DF7\u5408\uFF08\u534A\u900F\u660E\u67D3\u8272\uFF09\r\n- `tint` \u4F20 `null`/\u7A7A\u4E32\uFF1D\u64A4\u9500\u67D3\u8272\uFF1B\u683C\u5F0F `#RRGGBB` / `#RRGGBBAA` / `rgba()`\uFF0C\u975E\u6CD5\u503C\u8FD4\u56DE false \u5E76\u8BB0 Warning\r\n- \u6362\u56FE\u4E0D\u4E22\u67D3\u8272\uFF1A`SetImage` \u6362\u56FE\u540E tint \u6CBF\u7528\uFF08\u540C\u4E00 visual \u5C42\uFF09\uFF1BButton \u67D3 normal \u5E95\u56FE\u6240\u5728 visual\uFF0C\u672A\u914D\u7F6E\u7684 hover/pressed/disabled \u6001\u81EA\u52A8\u8DDF\u968F\r\n- Progress \u8FDB\u5EA6\u6761**\u652F\u6301\u67D3\u8272**\uFF08\u653E\u5C04\u72B6\u4E0E\u7EBF\u6027\u90FD\u8D70\u5EFA\u6811\u540C\u6B3E\u901A\u9053\uFF09\uFF0C\u8FD9\u70B9\u4E0E SetImage \u4E0D\u540C\uFF08SetImage \u4E0D\u652F\u6301 Progress\uFF09\r\n- \u9875\u9762 JSON \u91CC\u5199 `appearance.imageTint` \u5373\u5EFA\u6811\u671F\u9759\u6001\u67D3\u8272\uFF08\u7F16\u8F91\u5668\u53F3\u4FA7\u9762\u677F\u300C\u56FE\u7247\u67D3\u8272\u300D\uFF09\uFF0C\u8FD0\u884C\u65F6 SetTint \u8986\u76D6\u4E4B\r\n- \u5DF2\u5F00\u7A97\u53E3\u67D3\u8272\u540E\u8F6C\u5C4F/\u91CD\u5E03\u5C40\u4E0D\u56DE\u9000\uFF08\u540C\u6B65\u5199\u5165\u5E03\u5C40\u6570\u636E\u6A21\u578B\uFF09\uFF1B\u7A97\u53E3\u6C60\u9500\u6BC1\u91CD\u5EFA\u540E\u8FD0\u884C\u65F6\u503C\u4E22\u5931\uFF0C\u9700\u5728 `OnCreate`/`OnOpen` \u91CD\u653E\uFF08\u540C SetImage \u53E3\u5F84\uFF09\r\n- \u8282\u70B9\u58F0\u660E\u4E86\u5BBD\u5C4F\u8986\u76D6 `appearance.imageTint` \u65F6\u5BBD\u5C4F\u6001 SetTint \u4E0D\u751F\u6548\uFF08\u540C SetImage \u7684\u5BBD\u5C4F\u9650\u5236\uFF09\r\n\r\n```csharp\r\n// \u661F\u7EA7\u661F\u56FE\u67D3\u8272\uFF1A\u767D\u8272\u661F\u6BCD\u7248\u4E00\u5957\u56FE\uFF0C\u6309\u54C1\u8D28\u8FD0\u884C\u65F6\u53D8\u8272\r\nDjuiWindowManagerV6.SetTint(\u9875\u9762\u6807\u8BC6.\u827A\u4EBA\u5217\u8868, "star_icon_3", "#FFC53D");   // \u91D1\r\nDjuiWindowManagerV6.SetTint(\u683C\u5B50\u63A7\u4EF6\u5F15\u7528, "#7B61FF");                      // \u76F4\u63A7\u53E3\u5F84\uFF08\u514B\u9686\u683C\uFF09\r\nDjuiWindowManagerV6.SetTint(\u9875\u9762\u6807\u8BC6.\u827A\u4EBA\u5217\u8868, "star_icon_3", null);       // \u64A4\u9500\u67D3\u8272\r\n```\r\n\r\n## \u7A97\u53E3\u8F6C\u573A\uFF08Runtime 0.9.0\uFF09\r\n\r\n`mode: popup` \u7684\u5185\u7F6E pop / slide / fade \u8F6C\u573A\u81EA\u52A8\u6309\u5E03\u5C40\u7EA6\u675F\u534F\u8C03\uFF0C\u65E0\u9700\u65B0\u589E\u52A8\u6548\u76EE\u6807\u914D\u7F6E\uFF1A\r\n\r\n- \u6839\u5C42\u8282\u70B9\u58F0\u660E `stretch.style: Both`\uFF0C\u56DB\u8FB9 margins \u4E3A\u96F6\uFF08\u7701\u7565\u6309\u96F6\u5904\u7406\uFF09\uFF0C\u4E14 `anchor.target` \u4E3A `screen` \u6216 `parent`\uFF08\u7701\u7565\u6309 parent\uFF09\uFF0C\u8F6C\u573A\u4E2D\u4FDD\u6301\u539F\u6709\u4F4D\u7F6E\u548C\u5C3A\u5BF8\uFF0C\u4EC5\u7EE7\u627F\u6839\u8282\u70B9\u900F\u660E\u5EA6\u53D8\u5316\u3002\u5E26\u975E None \u5BBD\u9AD8\u6BD4\u7EA6\u675F\u7684\u8282\u70B9\u4E0D\u5C5E\u4E8E\u94FA\u6EE1\u5C42\u3002\r\n- \u5176\u4F59\u6839\u5C42\u5185\u5BB9\u4EE5\u9875\u9762\u4E2D\u5FC3\u6267\u884C\u540C\u4E00\u4E2A\u7F29\u653E/\u5E73\u79FB\u53D8\u6362\u3002\u72EC\u7ACB\u5173\u95ED\u63D0\u793A\u4E0E\u4E3B\u4F53\u7684\u76F8\u5BF9\u4F4D\u7F6E\u4E00\u8D77\u53D8\u5316\uFF1B\u5168\u5C4F\u5C42\u4E0B\u7684\u63D0\u793A\u968F\u5176\u539F\u6709\u7236\u5C42\u56FA\u5B9A\uFF0C\u4E0D\u642C\u8282\u70B9\u3001\u4E0D\u6539\u5C42\u7EA7\u3002\r\n- \u56E0\u6B64 popup \u7684\u4E3B\u4F53\u5982\u679C\u672C\u8EAB\u4E5F\u662F\u53CC\u5411\u96F6\u8FB9\u8DDD\u94FA\u6EE1\u5C42\uFF08\u4F8B\u5982\u5168\u5C4F\u62CD\u6444 sheet\uFF09\uFF0C\u81EA\u7136\u4EC5\u6DE1\u5165\u6DE1\u51FA\u3002`fullscreen` \u9875\u9762\u7EF4\u6301\u539F\u6709\u6574\u6839\u8F6C\u573A\uFF0C\u4E0D\u6309\u6A21\u6001\u89C4\u5219\u5206\u5C42\u3002\r\n- \u4FDD\u7559\u5168\u90E8\u8282\u70B9\u7684 Visible \u548C\u5B50\u5C42 Opacity\uFF1B\u9690\u85CF\u6982\u7387\u5C42\u3001\u900F\u660E\u5EA6\u96F6\u5C42\u4E0D\u4F1A\u88AB\u8F6C\u573A\u6062\u590D\u6210\u53EF\u89C1\u3002\u906E\u7F69 action \u539F\u6837\u6267\u884C\uFF0C\u961F\u5217\u7EE7\u7EED\u7B49\u4E1A\u52A1\u8BED\u4E49\u4ECD\u7531\u4E1A\u52A1\u5904\u7406\u3002\r\n- \u5173\u95ED\u671F\u95F4\u65B0\u589E\u65E0\u89C6\u89C9\u7684\u5168\u5C4F\u8F93\u5165\u963B\u6321\uFF0C\u52A8\u753B\u7ED3\u675F\u5E76\u89E6\u53D1 OnClose \u540E\u6458\u6808\uFF1B\u53D6\u6D88\u5173\u95ED\u79FB\u9664\u963B\u6321\uFF0C\u4E0D\u89E6\u53D1 OnClose/OnOpen\u3002\u91CD\u590D\u5173\u95ED\u88AB\u5408\u5E76\uFF0C\u6C60\u590D\u7528\u4E0E\u591A\u5B9E\u4F8B\u9500\u6BC1\u4F1A\u6E05\u7406\u4E34\u65F6\u53D8\u6362\u3002\r\n- \u8F6C\u5C4F\u65F6\u5148\u64A4\u9500\u8F6C\u573A\u51E0\u4F55\uFF0C\u6309\u65B0\u89C6\u53E3\u89E3\u7B97\uFF0C\u518D\u7EE7\u7EED\u540C\u4E00\u8FDB\u5EA6\u3002\u63A7\u4EF6 ID \u5BFB\u5740\u3001\u7236\u5B50\u6811\u3001\u514B\u9686\u3001action \u548C\u7ED1\u5B9A\u4FDD\u6301\u539F\u6709\u5951\u7EA6\u3002\r\n\r\n\u7EDD\u5BF9\u5B9A\u4F4D\u63A7\u4EF6\u7684 slide \u8F6C\u573A\u4F7F\u7528 Position\uFF08\u800C\u975E\u88AB\u7EDD\u5BF9\u5B9A\u4F4D\u5FFD\u7565\u7684 Margin\uFF09\u3002\u7EAF\u6DE1\u5165\u6DE1\u51FA\u548C none \u6CBF\u7528\u5DF2\u6709\u9884\u8BBE\u4E0E\u65F6\u5E8F\u3002\r\n\r\n\u81EA\u5B9A\u4E49 `DjuiTransitionPreset` \u9ED8\u8BA4\u4FDD\u7559\u5355\u63A7\u4EF6\u884C\u4E3A\uFF1B\u53EA\u5305\u542B\u7EDF\u4E00\u8F74\u5411\u7F29\u653E/\u5E73\u79FB/\u900F\u660E\u5EA6\uFF0C\u4E14\u7F29\u653E\u4E0E\u8282\u70B9\u65CB\u8F6C\u53EF\u4EA4\u6362\u7684\u81EA\u5B9A\u4E49\u9884\u8BBE\uFF0C\u53EF\u663E\u5F0F\u4F20 `coordinateWindowContent: true`\u3002\u4E0D\u8981\u5C06\u65CB\u8F6C\u3001\u91CD\u6392\u6216\u4EFB\u610F\u5C5E\u6027\u52A8\u753B\u58F0\u660E\u4E3A\u8BE5\u6A21\u5F0F\u3002\u5185\u7F6E pop \u4E3A\u7EDF\u4E00\u7B49\u6BD4\u4F8B\u7F29\u653E\u3002\r\n\r\n\u63A5\u5165\u65F6\u901A\u8FC7\u7F51\u9875\u300C\u66F4\u65B0 Runtime\u300D\u6216\u540C\u4EE3\u672C\u5730\u53D1\u5E03\u5668 `upgrade-runtime` \u66F4\u65B0\u6574\u5957\u6E90\u7801\uFF08\u7248\u672C\u6807\u8BB0\u4E3A 0.9.0\uFF09\uFF0C\u518D\u901A\u8FC7\u661F\u706B\u7F16\u8F91\u5668\u5B8C\u6574 `debug_start` \u7F16\u8BD1\u548C\u90E8\u7F72\u3002\u65E0\u9700\u4FEE\u6539\u73B0\u6709 Movie \u9875\u9762 JSON \u6216\u4E1A\u52A1\u906E\u7F69\u63A5\u7EBF\u3002\r\n\r\n## \u54CD\u5E94\u5F0F\u5BBD\u5C4F\u5C42\uFF08\u57FA\u7840\u5C42 / \u5BBD\u5C4F\u5C42\uFF09\r\n\r\n\u9875\u9762\u5206\u4E24\u5C42\uFF1A**\u57FA\u7840\u5C42**\uFF08\u9875\u9762 JSON \u91CC\u7684\u8282\u70B9\u4E0E\u5C5E\u6027\u672C\u4F53\uFF09\u4E0E**\u5BBD\u5C4F\u5C42**\uFF08`responsive.wide.overrides` \u5DEE\u5F02\u8865\u4E01\u8868\uFF09\u3002\u8FD0\u884C\u65F6\u6309**\u65B9\u5411\u611F\u77E5**\u89C4\u5219\u81EA\u52A8\u9009\u5C42\uFF1A\r\n\r\n- \u5224\u5B9A\uFF1A**\u7269\u7406\u5BBD / \u9AD8 \u2265 wideRatio**\uFF08`project.json` \u7684 `responsive.wideRatio`\uFF0C\u9ED8\u8BA4 1.25\uFF09\u624D\u8FDB\u5BBD\u5C4F\u5C42\uFF1B\u7AD6\u5C4F\u624B\u673A\uFF08\u5BBD < \u9AD8\uFF09\u6C38\u8FDC\u7528\u57FA\u7840\u5C42\r\n- \u9ED8\u8BA4 1.25 \u7684\u542B\u4E49\uFF1A\u6298\u53E0\u5C4F\u5C55\u5F00\u6A2A\u7528\uFF08\u6BD4\u503C 1.10~1.20\uFF09\u5F52\u57FA\u7840\u5C42\uFF1BiPad / \u5B89\u5353\u5E73\u677F\u6A2A\u7F6E\uFF081.33+\uFF09\u3001\u684C\u9762\u8FDB\u5BBD\u5C4F\u5C42\u3002\u9700\u8981\u6298\u53E0\u5C4F\u4E5F\u8D70\u5BBD\u5C4F\u5C42\u65F6\u628A\u9608\u503C\u964D\u5230\u7EA6 1.05\r\n- \u5BBD\u5C4F\u5C42\u751F\u6548\u65F6\uFF1A\u5148\u53D6\u57FA\u7840\u5C42\uFF0C\u518D\u628A\u8865\u4E01\u8868\u91CC\u7684\u5C5E\u6027\u76D6\u4E0A\u53BB\uFF1B**\u6CA1\u5199\u5728\u8865\u4E01\u8868\u91CC\u7684\u5C5E\u6027\u6CBF\u7528\u57FA\u7840\u5C42**\r\n\r\n### \u5BBD\u5C4F\u5C42\u5141\u8BB8\u8986\u76D6\u7684\u5B57\u6BB5\uFF08\u5C01\u95ED\u5217\u8868\uFF0C\u8D85\u5217\u5373\u6821\u9A8C\u5931\u8D25\uFF09\r\n\r\n| \u7C7B\u522B | \u5B57\u6BB5 |\r\n|---|---|\r\n| \u57FA\u7840 | `basic.visible`\u3001`basic.disabled` |\r\n| \u53D8\u6362 | `transform.x` / `y` / `width` / `height` |\r\n| \u5916\u89C2 | `appearance.image`\u3001`imageTint`\u3001`background`\u3001`imageFit`\u3001`focalX`\u3001`focalY`\u3001`borderThickness`\u3001`borderColor` |\r\n| \u6587\u672C | `text.text`\u3001`fontSize`\u3001`textColor`\u3001`strokeSize`\u3001`strokeColor`\u3001`bold`\u3001`font`\u3001`textWrap` |\r\n| \u6309\u94AE/\u8FDB\u5EA6 | `button.imageHover`\u3001`button.imagePressed`\u3001`button.imageDisabled`\u3001`progress.value` |\r\n\r\n### \u5168\u5C4F\u80CC\u666F\u6362\u56FE\u8303\u5F0F\uFF08\u53CC\u8282\u70B9\u6CD5\uFF09\r\n\r\n\u5BBD\u5C4F\u5C42**\u4E0D\u80FD\u8986\u76D6 `appearance.sourceSize`**\uFF08\u4E0D\u5728\u5141\u8BB8\u5217\u8868\uFF09\u3002\u7AD6\u7248 / \u5BBD\u7248\u4E24\u5957\u5168\u5C4F\u56FE\u7528\u4E24\u4E2A\u8282\u70B9 + `basic.visible` \u5207\u6362\uFF1A\r\n\r\n```json\r\n{ "id": "fullscreen_art_portrait", "basic": { "visible": true },\r\n  "appearance": { "image": "image/djui/backgrounds/bg_xxx_portrait.png",\r\n    "imageFit": "cover", "sourceSize": { "width": 1080, "height": 2400 } } },\r\n{ "id": "fullscreen_art_wide", "basic": { "visible": false },\r\n  "appearance": { "image": "image/djui/backgrounds/bg_xxx_wide.png",\r\n    "imageFit": "cover", "sourceSize": { "width": 1920, "height": 1200 } } }\r\n```\r\n\r\n\u5BBD\u5C4F\u5C42\u8865\u4E01\uFF1A\r\n\r\n```json\r\n"responsive": { "wide": { "overrides": {\r\n  "fullscreen_art_portrait": { "basic.visible": false },\r\n  "fullscreen_art_wide": { "basic.visible": true } } } }\r\n```\r\n\r\n\u6BCF\u4E2A\u8282\u70B9\u5404\u81EA\u643A\u5E26\u6B63\u786E\u7684 `sourceSize`\uFF08cover/contain \u7684\u88C1\u5207\u4F9D\u636E\uFF09\uFF0C\u8FD0\u884C\u65F6\u6309\u5C42\u5207\u6362\u53EF\u89C1\u6027\u5373\u53EF\u3002\r\n\r\n### \u573A\u666F\u753B\u677F\uFF08\u80CC\u666F\u4E0E\u7D20\u6750\u5750\u6807\u540C\u7F29\u653E\uFF09\r\n\r\n\u9700\u8981\u300C\u9489\u5728\u80CC\u666F\u56FE\u4E0A\u300D\u7684\u5185\u5BB9\uFF08\u573A\u666F\u5EFA\u7B51\u3001\u5730\u56FE\u6807\u8BB0\u7B49\uFF09\u4F7F\u7528 sceneFrame\uFF0C\u800C\u4E0D\u662F\u53EA\u4F9D\u8D56 target: image\uFF1A\r\n\r\n- \u80CC\u666F\u548C\u573A\u666F\u753B\u677F\u5FC5\u987B\u90FD\u662F\u9875\u9762\u6839\u4E0B\u8282\u70B9\uFF1B\u753B\u677F\u4EE5 sceneFrame.backgroundId \u663E\u5F0F\u6307\u5411\u80CC\u666F\uFF0C\u907F\u514D\u4F9D\u8D56\u8282\u70B9\u987A\u5E8F\u3002\r\n- \u753B\u677F\u672C\u8EAB\u5FC5\u987B anchor.target: image + stretch.style: Both\uFF1B\u5B83\u5148\u94FA\u6EE1\u80CC\u666F\u7684\u5B8C\u6574 contain/cover \u56FE\u5E27\u3002\r\n- sceneFrame.artboard \u662F\u7D20\u6750\u539F\u59CB\u753B\u5E45\u3002\u753B\u677F\u5185\u7684\u5B50\u6811\u4F7F\u7528\u8FD9\u5957\u5C40\u90E8\u5750\u6807\uFF0C\u8FD0\u884C\u65F6\u4E0E\u7F16\u8F91\u5668\u4E00\u8D77\u6309\u56FE\u5E27\u6A2A\u3001\u7EB5\u6BD4\u4F8B\u6620\u5C04\uFF0C**\u4F4D\u7F6E\u548C\u5C3A\u5BF8\u90FD\u4F1A\u968F\u80CC\u666F\u7F29\u653E**\u3002\r\n- \u753B\u677F\u5185\u5B50\u8282\u70B9\u53EA\u80FD\u7528 anchor.target: parent\uFF1B\u5C4F\u5E55 UI\uFF08\u8FD4\u56DE\u3001\u8D27\u5E01\u3001\u8BBE\u7F6E\u7B49\uFF09\u5FC5\u987B\u7559\u5728\u753B\u677F\u5916\uFF0C\u4F7F\u7528 safe / screen \u951A\u70B9\u3002\r\n\r\n~~~json\r\n{\r\n  "id": "building_group",\r\n  "anchor": { "target": "image", "side": "TopLeft" },\r\n  "stretch": { "style": "Both", "margins": { "left": 0, "top": 0, "right": 0, "bottom": 0 } },\r\n  "sceneFrame": {\r\n    "backgroundId": "scene_background",\r\n    "artboard": { "width": 1080, "height": 2400 }\r\n  }\r\n}\r\n~~~\r\n\r\n\u65E7\u7684 target: image \u4ECD\u53EF\u7528\u4E8E\u201C\u53EA\u8DDF\u968F\u56FE\u5E27\u4F4D\u7F6E/\u8FB9\u754C\u201D\u7684\u666E\u901A\u5BB9\u5668\uFF0C\u4F46\u5B83**\u4E0D\u4F1A**\u628A\u7EDD\u5BF9\u5B9A\u4F4D\u7684\u5B50\u5143\u7D20\u7F29\u653E\uFF1B\u7D20\u6750\u5750\u6807\u573A\u666F\u5FC5\u987B\u5347\u7EA7\u4E3A sceneFrame\u3002\r\n\r\n## \u7A97\u53E3\u6C60\u5316\u4E0E\u751F\u547D\u5468\u671F\uFF080.8.0\uFF1A\u5173\u95ED\u4E0E\u9500\u6BC1\u5206\u79BB\uFF09\r\n\r\n`CloseWindow` \u53EA\u505A\u300C\u6458\u6808\uFF0B\u9690\u85CF\u300D\uFF08`IsOpen` \u7ACB\u5373 false\uFF0C\u5BFB\u5740\u6CE8\u518C\u8868\u540C\u6B65\u6CE8\u9500\u2014\u2014\u8BED\u4E49\u4E0E\u65E7\u7248\u4E00\u81F4\uFF09\uFF1B\u63A7\u4EF6\u6811\u8FDB\u5165**\u4FDD\u7559\u6C60**\u5F85\u590D\u7528\uFF0C\u4E0D\u518D\u540C\u5E27\u9500\u6BC1\uFF1A\r\n\r\n- **\u7A97\u53E3\u6C60**\uFF1A`OpenWindow` \u5355\u4F8B\u8DEF\u5F84\u7684\u5B9E\u4F8B\u5173\u95ED\u540E\u8FDB FIFO \u6C60\uFF08\u9ED8\u8BA4\u5BB9\u91CF `project.json` \u7684 `poolCapacity`\uFF1D5\uFF09\uFF1B\u91CD\u5F00\u547D\u4E2D\u6C60\uFF1D\u76F4\u63A5\u590D\u7528\uFF08\u4E0D\u91CD\u5EFA\u6811\u3001\u64AD open \u8F6C\u573A\uFF09\uFF1B\u590D\u7528\u540E\u518D\u5173\u95ED\u91CD\u65B0\u6392\u5230\u6700\u65B0\uFF1D\u9AD8\u9891\u9875\u5929\u7136\u7559\u6C60\r\n- **\u9489\u4F4F\u767D\u540D\u5355**\uFF1A`project.json` \u7684 `retainedPages: [...]` \u4E2D\u7684\u9875\u9762\u6C38\u4E0D\u6DD8\u6C70\u3001\u5E38\u9A7B\u590D\u7528\uFF08\u901A\u7528\u786E\u8BA4\u6846\u8FD9\u7C7B\u8FDE\u5F39\u9875\u5EFA\u8BAE\u9489\u4F4F\uFF09\r\n- **\u9500\u6BC1\u7F13\u51B2**\uFF1A\u6C60\u6DD8\u6C70 / `OpenInstance` \u591A\u5B9E\u4F8B\u5173\u95ED / `CloseAll` \u7EDF\u4E00\u7ECF 250ms \u7F13\u51B2\u518D\u771F\u6B63 `Dispose`\u2014\u2014\u6309\u538B\u56DE\u5F39\u52A8\u753B\u5728\u6D3B\u6811\u4E0A\u81EA\u7136\u64AD\u5B8C\uFF0C\u4E1A\u52A1\u4FA7**\u4E0D\u518D\u9700\u8981\u5EF6\u65F6\u5173\u7A97\u89C4\u907F**\uFF08\u76F4\u63A5 `CloseWindow` \u5373\u53EF\uFF09\r\n- `OpenInstance` \u663E\u5F0F\u591A\u5B9E\u4F8B\u4E0D\u5165\u6C60\u4E0D\u590D\u7528\uFF1B`CloseAll`/`Initialize` \u5168\u6E05\u6C60\uFF08\u9875\u9762 JSON \u66F4\u65B0\u540E\u65E7\u6811\u7EDD\u4E0D\u590D\u7528\uFF09\r\n\r\n### \u751F\u547D\u5468\u671F\u4E8B\u4EF6\uFF08\u4E1A\u52A1\u4FA7\u8303\u5F0F\uFF09\r\n\r\n```csharp\r\n// \u6A21\u5757\u521D\u59CB\u5316() \u91CC\u6CE8\u518C\u4E00\u6B21\uFF08Initialize \u4E4B\u540E\uFF1B\u8FDB\u7A0B\u7EA7\uFF0C\u591A\u8BA2\u9605\uFF09\uFF1A\r\nDjuiWindowManagerV6.OnCreate(\u9875, () => \u63A5\u7EBFX\u9875());   // \u5EFA\u6811\u540E\uFF08\u6C60\u6DD8\u6C70\u540E\u91CD\u5F00\uFF1D\u91CD\u5EFA\uFF1D\u518D\u6B21\u89E6\u53D1\uFF1BDjuiActionRouter.On \u4E3A\u8986\u76D6\u8BED\u4E49\uFF0C\u91CD\u590D\u63A5\u7EBF\u5B89\u5168\uFF09\r\nDjuiWindowManagerV6.OnOpen (\u9875, () => \u5237\u65B0X\u9875());    // \u6BCF\u6B21\u663E\u793A\uFF08\u65B0\u5EFA / \u6C60\u590D\u7528\uFF09\uFF0COpenWindow \u8FD4\u56DE\u524D\u540C\u6B65\u89E6\u53D1\r\nDjuiWindowManagerV6.OnClose(\u9875, () => \u6E05\u7406X\u9875());   // \u6458\u6808\u8FDB\u6C60\u524D\u2014\u2014\u5BFB\u5740\u4ECD\u53EF\u7528\uFF0C\u6E05\u56DE\u8C03\u5F15\u7528/\u91CD\u7F6E\u4E34\u65F6\u72B6\u6001\u7684\u6700\u540E\u673A\u4F1A\r\nDjuiWindowManagerV6.OnDestroy(\u9875, () => { });       // \u771F\u6B63\u9500\u6BC1\u524D\uFF08\u6781\u5C11\u7528\u5230\uFF1B\u6570\u636E\u8BA2\u9605\u6302\u6A21\u5757\u521D\u59CB\u5316\u3001\u52FF\u6302\u6B64\u5904\uFF09\r\n```\r\n\r\n- \u6253\u5F00\u65B9\u6CD5\u7626\u8EAB\u6210\u300C**\u5148\u5B58\u72B6\u6001\u5B57\u6BB5 \u2192 `OpenWindow(\u9875)`**\u300D\uFF0C\u5237\u65B0\u903B\u8F91\u653E `OnOpen`\uFF08\u7B49\u4EF7\u4E8E\u65E7\u300C\u6253\u5F00\u540E\u624B\u52A8\u5237\u65B0\u300D\uFF0C\u4E8C\u9009\u4E00\u5373\u53EF\uFF09\r\n- \u5173\u95ED\u8F6C\u573A\u4E2D\u9014\u91CD\u5F00\uFF08`CancelClosing`\uFF09\u4E0D\u89E6\u53D1\u4EFB\u4F55\u4E8B\u4EF6\u2014\u2014\u7A97\u53E3\u4ECE\u672A\u771F\u6B63\u5173\u95ED\r\n- **\u4E0D\u8981\u8DE8\u5173\u95ED\u7F13\u5B58\u63A7\u4EF6\u5F15\u7528**\uFF1A\u5173\u95ED\u540E\u91CD\u5F00\u53EF\u80FD\u62FF\u5230\u590D\u7528\u65E7\u6811\u6216\u91CD\u5EFA\u65B0\u6811\uFF0C\u4E00\u5F8B `GetSingletonControl` \u73B0\u67E5\u73B0\u7528\r\n- \u4E8B\u4EF6\u56DE\u8C03\u5F02\u5E38\u4F1A\u88AB\u9694\u79BB\u5E76\u8BB0\u65E5\u5FD7\uFF0C\u4E0D\u4F1A\u963B\u65AD\u7A97\u53E3\u72B6\u6001\u673A\uFF1B`GetLifecycleStats()` \u8FD4\u56DE\uFF08\u5EFA\u6811/\u590D\u7528/\u9500\u6BC1\uFF09\u8BA1\u6570\uFF0C\u4F9B\u9A8C\u6536\u6392\u969C\r\n\r\n### \u7A97\u53E3\u5C42\u5E8F\u7BA1\u7406\r\n\r\n\u7A97\u53E3\u9ED8\u8BA4\u6309\u6253\u5F00\u6B21\u5E8F\u53E0\u653E\uFF08\u540E\u5F00\u5728\u4E0A\uFF1B**\u547D\u4E2D\u5E8F\uFF1D\u89C6\u89C9\u6811\u5E8F\uFF0CZIndex \u4E0D\u53C2\u4E0E\u547D\u4E2D**\uFF09\uFF1A\r\n\r\n- `OpenWindow` \u5DF2\u5F00\u9875\uFF1D\u7F6E\u9876\u805A\u7126\uFF08\u81EA\u52A8\u91CD\u6302\u6811\u672B\u5C3E\uFF09\uFF0C\u5148\u5F00\u7684\u5F39\u7A97\u4E0D\u4F1A\u88AB\u540E\u5F00\u7684\u57FA\u7840\u9875\u76D6\u4F4F\r\n- `BringToFront(pageId)`\uFF1A\u628A\u5DF2\u5F00\u7A97\u53E3\u624B\u52A8\u79FB\u5230\u6700\u524D\uFF08\u6062\u590D\u88AB\u76D6\u4F4F\u5F39\u7A97\u7684\u53EF\u70B9\u6027\uFF09\r\n- `SendToBack(pageId)`\uFF1A\u628A\u5DF2\u5F00\u7A97\u53E3\u538B\u5230\u6700\u5E95\u2014\u2014\u573A\u666F\u7C7B\u57FA\u7840\u9875\u4E13\u7528\uFF0C\u4EFB\u4F55\u65F6\u523B\uFF08\u91CD\uFF09\u5F00\u90FD\u4E0D\u906E\u4E1A\u52A1\u5F39\u7A97\r\n\r\n## \u5B57\u4F53\r\n\r\n- \u9875\u9762\u63A7\u4EF6\u4E0D\u5199 `text.font` \u65F6\uFF0C\u7528 `project.json` \u7684 `defaultFont`\uFF1B`defaultFont` \u4E3A `null` \u65F6\u7528**\u5F15\u64CE\u9ED8\u8BA4\u5B57\u4F53**\r\n- \u81EA\u5B9A\u4E49\u5B57\u4F53 = **\u6807\u51C6\u5B57\u4F53\u6587\u4EF6**\uFF08.ttf / .otf / .ttc\uFF09\u653E `ui/font/<family>/`\uFF0C\u5E76\u5728 `ref/fontref.txt` \u52A0\u4E00\u884C family \u8DEF\u5F84\u3002\u5F15\u64CE\u4E0E DJUI \u753B\u5E03\u52A0\u8F7D\u540C\u4E00\u6587\u4EF6\uFF0C\u4E24\u7AEF\u4E00\u81F4\r\n- \u661F\u706B\u81EA\u5E26\u7684 `.otf` \u662F\u5F15\u64CE\u79C1\u6709\u5C01\u88C5\uFF0C\u4EC5\u5F15\u64CE\u53EF\u89E3\u7801\uFF1B\u753B\u5E03\u53EA\u80FD\u8FD1\u4F3C\u9884\u89C8\u3002\u7CFB\u7EDF\u5B57\u4F53\uFF08\u5982 `ui/font/msyh`\uFF09\u4E24\u7AEF\u90FD\u8C03\u64CD\u4F5C\u7CFB\u7EDF\u5B57\u4F53\uFF0C\u4E5F\u4E00\u81F4\r\n- \u63A8\u8350\u7528 DJUI \u7F16\u8F91\u5668\u7684\u300C\u5B57\u4F53\u7BA1\u7406\u300D\u5BFC\u5165\uFF0C\u81EA\u52A8\u5B8C\u6210\u62F7\u8D1D\u4E0E\u6CE8\u518C\uFF0C\u4E0D\u8981\u624B\u5DE5\u642C\u8FD0\u5B57\u4F53\u6587\u4EF6\r\n\r\n## \u6545\u969C\u5B9A\u4F4D\u8868\r\n\r\n| \u75C7\u72B6 | \u6839\u56E0 | \u4FEE\u590D |\r\n|---|---|---|\r\n| \u65E5\u5FD7\u300C\u9875\u9762\u76EE\u5F55\u4E0D\u5B58\u5728\u6216\u4E3A\u7A7A\u300D | `ui/AppBundle` \u65AD\u4F9B\uFF08\u53D1\u5E03\u540E\u624B\u5DE5\u5220\u4E86/\u672A\u53D1\u5E03\uFF09 | \u5728 DJUI \u7F16\u8F91\u5668\u91CD\u65B0\u70B9\u300C\u53D1\u5E03\u300D\uFF08\u5199\u5165 `ui/AppBundle/user_files/djui/pages`\uFF09 |\r\n| `OpenWindow` \u62A5\u300C\u9875\u9762 xxx \u4E0D\u5B58\u5728\u300D\u5E76\u5217\u51FA\u5DF2\u6CE8\u518C\u9875\u9762 | \u8BE5 pageId \u6CA1\u53D1\u5E03\uFF0C\u6216 pageId \u62FC\u5199\u4E0E JSON \u4E0D\u4E00\u81F4 | \u5BF9\u7167\u65E5\u5FD7\u5217\u51FA\u7684\u5DF2\u6CE8\u518C\u6E05\u5355\u68C0\u67E5\uFF1B\u91CD\u65B0\u53D1\u5E03 |\r\n| \u9875\u9762\u5F00\u4E86\u4F46\u56FE\u7247\u4E0D\u663E\u793A | \u56FE\u7247\u5F15\u7528\u8DEF\u5F84\u4E0D\u542B `image/djui/` \u524D\u7F00\uFF0C\u6216\u7D20\u6750\u672A\u53D1\u5E03\u5230 `ui/image/djui/` | \u68C0\u67E5\u63A7\u4EF6 `appearance.image` \u4E0E\u7D20\u6750\u53D1\u5E03\u72B6\u6001 |\r\n| \u9875\u9762\u62F7\u5230\u4E86\u6839 AppBundle \u4ECD\u4E0D\u751F\u6548 | \u6839 AppBundle \u4E0D\u662F\u6D88\u8D39\u65B9\uFF08\u670D\u52A1\u7AEF\u4E0D\u8BFB\u9875\u9762 JSON\uFF09 | \u53EA\u53D1\u5E03\u5230 `ui/AppBundle`\uFF1B\u7528\u7F16\u8F91\u5668\u53D1\u5E03\u800C\u975E\u624B\u5DE5\u62F7\u8D1D |\r\n| \u7AD6\u5C4F\u624B\u673A\u663E\u793A\u4E86\u5BBD\u5C4F\u5C42\u5185\u5BB9\uFF08\u5BBD\u56FE/\u5BBD\u5C4F\u6587\u6848\uFF09 | \u65E7\u7248 Runtime \u7528\u300C\u957F\u77ED\u8FB9\u6BD4\u503C\u300D\u5224\u5B9A\uFF0C\u7AD6\u5C4F 9:16 \u6BD4\u503C 1.78 \u4E5F\u88AB\u5224\u5BBD\u5C4F | \u5347\u7EA7 Runtime \u2265 0.7.9\uFF08\u65B9\u5411\u611F\u77E5\u5224\u5B9A\uFF1A\u7269\u7406\u5BBD/\u9AD8 \u2265 wideRatio\uFF09 |\r\n| \u6587\u5B57\u5B57\u4F53\u4E0E\u7F16\u8F91\u5668\u753B\u5E03\u4E0D\u4E00\u81F4 | \u7528\u4E86\u5F15\u64CE\u5C01\u88C5\u683C\u5F0F\u5B57\u4F53\uFF0C\u753B\u5E03\u65E0\u6CD5\u89E3\u7801\u53EA\u80FD\u8FD1\u4F3C | \u6539\u7528\u6807\u51C6\u5B57\u4F53\u6587\u4EF6\u6216\u7CFB\u7EDF\u5B57\u4F53\uFF1B\u5728 DJUI\u300C\u5B57\u4F53\u7BA1\u7406\u300D\u91CD\u65B0\u5BFC\u5165 |\r\n| cover \u80CC\u666F\u88C1\u5207\u65B9\u5411\u4E0D\u5BF9 | \u63A7\u4EF6 `appearance.sourceSize` \u4E0E\u7D20\u6750\u771F\u5B9E\u5C3A\u5BF8\u4E0D\u7B26 | \u5728\u7F16\u8F91\u5668\u53F3\u4FA7\u5C5E\u6027\u91CC\u4FEE\u6B63\u7D20\u6750\u539F\u59CB\u5C3A\u5BF8\uFF0C\u91CD\u65B0\u53D1\u5E03 |\r\n\r\n## \u7981\u6B62\r\n\r\n- \u7981\u6B62\u624B\u5DE5\u62F7\u8D1D\u9875\u9762 JSON \u5230\u4EFB\u4F55 AppBundle\uFF08\u7248\u672C\u9519\u4F4D\u6E90\u5934\uFF09\r\n- \u7981\u6B62\u76F4\u63A5\u4FEE\u6539\u672C\u76EE\u5F55 .cs \u6587\u4EF6\uFF08\u7F16\u8F91\u5668\u5347\u7EA7\u4F1A\u6574\u76EE\u5F55\u8986\u76D6\uFF1B\u6539\u52A8\u8BF7\u53BB DJUI \u4ED3\u5E93 `runtime/`\uFF09\r\n';

// src/lib/runtimeBundle.ts
var RUNTIME_VERSION = "0.10.0";
var RUNTIME_FILES = [
  { name: "DjuiActionRouter.cs", content: DjuiActionRouter_default },
  { name: "DjuiAudioSystem.cs", content: DjuiAudioSystem_default },
  { name: "DjuiBindingSystem.cs", content: DjuiBindingSystem_default },
  { name: "DjuiEffectPlayer.cs", content: DjuiEffectPlayer_default },
  { name: "DjuiEffectPresets.cs", content: DjuiEffectPresets_default },
  { name: "DjuiFlowBorder.cs", content: DjuiFlowBorder_default },
  { name: "DjuiLayoutArranger.cs", content: DjuiLayoutArranger_default },
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
  { name: "DjuiWindowTransitionV6.cs", content: DjuiWindowTransitionV6_default },
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
function isRecord3(value) {
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
var MIRROR_CONCURRENCY = 8;
async function runPool(items, limit, worker) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) await worker(items[index++]);
  }));
}
async function mirrorDirectory(source, sourcePath, target, targetPath, transform, shouldSkip, basePath = sourcePath) {
  const stats = { copied: 0, skipped: 0, removed: 0, total: 0 };
  await target.ensureDir(targetPath);
  const sourceEntries = await source.listEntries(sourcePath);
  const remaining = new Map((await target.listEntries(targetPath)).map((entry) => [entry.name, entry]));
  const directories = [];
  const files = [];
  for (const entry of sourceEntries) {
    remaining.delete(entry.name);
    (entry.kind === "directory" ? directories : files).push(entry);
  }
  await runPool(files, MIRROR_CONCURRENCY, async (entry) => {
    stats.total++;
    const from = joinPath(sourcePath, entry.name);
    const to = joinPath(targetPath, entry.name);
    const relative2 = from.slice(basePath.length).replace(/^\//, "");
    const info = await source.fileInfo(from);
    if (info && shouldSkip && await shouldSkip(relative2, info) && await target.fileExists(to)) {
      stats.skipped++;
      return;
    }
    const content = await source.readBytes(from);
    if (content === null) throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u53D1\u5E03\u6E90\u6587\u4EF6\uFF1A${from}`);
    await target.writeBytes(to, transform ? await transform(from, relative2, content) : content);
    stats.copied++;
  });
  const nestedResults = await Promise.all(directories.map(
    (directory) => mirrorDirectory(source, joinPath(sourcePath, directory.name), target, joinPath(targetPath, directory.name), transform, shouldSkip, basePath)
  ));
  for (const nested of nestedResults) {
    stats.copied += nested.copied;
    stats.skipped += nested.skipped;
    stats.removed += nested.removed;
    stats.total += nested.total;
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
    result[file.slice(dir.length).replace(/^\//, "")] = [info.size, Math.round(info.mtime)];
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
    const protocolVersion = isRecord3(page) && typeof page.protocolVersion === "number" ? page.protocolVersion : null;
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
  return isRecord3(raw) ? raw : {};
}
function collectSoundRefs(node, refs) {
  if (!isRecord3(node)) return;
  const djui = isRecord3(node.djui) ? node.djui : null;
  if (typeof djui?.clickSoundId === "string" && djui.clickSoundId) refs.add(djui.clickSoundId);
  if (Array.isArray(node.children)) node.children.forEach((child) => collectSoundRefs(child, refs));
}
async function validateWorkspaceCore(store) {
  const issues = [];
  if (!await store.dirExists(UI_LAYOUT_DIR)) {
    issues.push({ file: UI_LAYOUT_DIR, path: "$", message: "\u5DE5\u4F5C\u533A\u7F3A\u5C11 .djui/layout\uFF1A\u5DE5\u7A0B\u672A\u521D\u59CB\u5316\uFF0C\u6216\u65E7\u5DE5\u7A0B\u5C1A\u672A\u8FC1\u79FB\uFF1B\u8BF7\u5148\u5728 DJUI \u7F51\u9875\u6253\u5F00\u5DE5\u7A0B\u5B8C\u6210\u521D\u59CB\u5316/\u540C\u6B65" });
    return { ok: false, issues, warnings: [] };
  }
  const projectRaw = await store.readText(PROJECT_FILE);
  if (projectRaw === null) {
    issues.push({ file: PROJECT_FILE, path: "$", message: "\u7F3A\u5C11\u9879\u76EE\u914D\u7F6E project.json\uFF08\u6216\u4E0D\u53EF\u8BFB\u53D6\uFF09" });
  } else {
    try {
      const inspected = inspectProjectV6(JSON.parse(projectRaw.replace(/^\uFEFF/, "")));
      if (!inspected.ok) for (const issue of inspected.issues) issues.push({ file: PROJECT_FILE, ...issue });
    } catch (error) {
      issues.push({ file: PROJECT_FILE, path: "$", message: `JSON \u89E3\u6790\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` });
    }
  }
  const soundIds = new Set(sanitizeSoundConfig(await store.readJson(SOUNDS_FILE)).sounds.map((sound) => sound.id));
  const refs = /* @__PURE__ */ new Set();
  if (!await store.dirExists(PAGES_DIR)) issues.push({ file: PAGES_DIR, path: "$", message: "\u9875\u9762\u76EE\u5F55\u4E0D\u5B58\u5728" });
  for (const file of (await walkFiles(store, PAGES_DIR)).filter((file2) => file2.toLowerCase().endsWith(".json"))) {
    const raw = await store.readText(file);
    if (raw === null) {
      issues.push({ file, path: "$", message: "\u9875\u9762 JSON \u8BFB\u53D6\u5931\u8D25" });
      continue;
    }
    let page;
    try {
      page = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch (error) {
      issues.push({ file, path: "$", message: `JSON \u89E3\u6790\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const inspected = inspectPageV6(page);
    if (!inspected.ok) for (const issue of inspected.issues) issues.push({ file, ...issue });
    if (isRecord3(page)) collectSoundRefs(page.root, refs);
  }
  const warnings = [];
  for (const ref of refs) if (!soundIds.has(ref)) warnings.push(`\u97F3\u6548\u5F15\u7528 ${ref} \u5728 sounds.json \u4E2D\u4E0D\u5B58\u5728`);
  return { ok: issues.length === 0, issues, warnings };
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
  const validation = await validateWorkspaceCore(workspace);
  if (!validation.ok) {
    return {
      ok: false,
      code: "INVALID_WORKSPACE",
      error: ["\u5DE5\u4F5C\u533A\u7ED3\u6784\u6821\u9A8C\u672A\u901A\u8FC7\uFF0C\u53D1\u5E03\u5DF2\u963B\u6B62\uFF1A", ...validation.issues.map((issue) => `${issue.file}${issue.path}: ${issue.message}`)].join("\n"),
      userAction: "\u6309 error \u6E05\u5355\u9010\u6761\u4FEE\u590D\u540E\u91CD\u8BD5\uFF1B\u53EF\u5148\u5728 UI \u5DE5\u4F5C\u533A\u6267\u884C node \u811A\u672C\u533A/djui-publish.mjs validate \u81EA\u68C0\u3002"
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
    return !!previous && previous[0] === info.size && Math.round(previous[1]) === Math.round(info.mtime);
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
  warnings.push(...validation.warnings);
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
    "node \u811A\u672C\u533A/djui-publish.mjs validate --json",
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
  if (command === "validate") {
    const validation = await validateWorkspaceCore(workspace);
    if (asJson) {
      output({ ok: validation.ok, issues: validation.issues, warnings: validation.warnings }, asJson);
      return validation.ok ? 0 : 1;
    }
    console.log(`DJUI \u5DE5\u4F5C\u533A\u6821\u9A8C \u2014 ${resolve(workspacePath)}`);
    for (const issue of validation.issues) console.error(`  \u2717 ${issue.file}${issue.path}: ${issue.message}`);
    for (const warning of validation.warnings) console.error(`  \u26A0 ${warning}`);
    console.log(validation.ok ? "\u68C0\u67E5\u5B8C\u6210: \u5168\u90E8\u901A\u8FC7 \u2713" : `\u68C0\u67E5\u5B8C\u6210: ${validation.issues.length} \u4E2A\u95EE\u9898 \u2717\uFF08\u97F3\u6548\u5F15\u7528\u7F3A\u5931\u4EC5 \u26A0 \u8B66\u544A\uFF09`);
    return validation.ok ? 0 : 1;
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
