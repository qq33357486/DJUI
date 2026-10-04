# Runtime 接入

DJUI Runtime 是 `runtime/*.cs` 中的一组 C# 源码。编辑器会把这些文件复制到 StarEngine 工程：

Runtime 0.8.10 起，克隆预置图片会在返回前同步绘制尺寸；直接修改显式 Width/Height 后也会自动同步。需要批量调整后立即刷新整棵子树时，调用 `DjuiWindowManagerV6.RefreshVisuals(control, recursive: true)`。使用契约和限制见 [Runtime 随附文档](../runtime/AGENTS.md#克隆与动态尺寸的图片同步runtime-0810)。

```text
StarEngine 工程/src/DjuiRuntime/
```

## 安装和升级

在 DJUI 的「工程配置」里选择 StarEngine 工程后：

1. 如果未安装 Runtime，点击「初始化」。
2. 如果版本过期，点击「升级」。

Runtime 版本号由 `editor/frontend/src/lib/runtimeBundle.ts` 中的 `RUNTIME_VERSION` 管理（`bundledAssets.ts` 仅做转出口）。改动 `runtime/*.cs` 的兼容行为时，应同步提升版本号。

## 发布后的文件位置

发布（DJUI 编辑器 ≥0.9.4）会把页面 JSON 写入星火工程的客户端 AppBundle：

```text
StarEngine 工程/ui/AppBundle/user_files/djui/pages/
```

素材会进入：

```text
StarEngine 工程/ui/image/djui/
```

音效配置会写入：

```text
StarEngine 工程/ui/AppBundle/user_files/djui/sounds.json
```

Runtime（全部 `#if CLIENT`）从相对路径 `user_files/djui/pages` 扫描页面（客户端进程工作目录为 `ui/`，解析到 `ui/AppBundle/...`），并从 `user_files/djui/sounds.json` 读取 DJUI 音效配置。**服务端不消费页面 JSON**，根 `AppBundle/` 无需发布 djui 资源。

> 部署契约（路径表、使用范式、故障定位）见随 Runtime 分发的 `src/DjuiRuntime/AGENTS.md`。禁止手工拷贝页面 JSON 到 AppBundle——位置拷错或版本错位是"页面没开/图不对"类故障的根源。

## 初始化

在客户端初始化阶段调用：

```csharp
using DjuiRuntime;

DjuiWindowManagerV6.Initialize();
```

`Initialize()` 会扫描页面 JSON 并缓存页面定义。

## 打开和关闭窗口

```csharp
var root = DjuiWindowManagerV6.OpenWindow("main_menu");
```

`pageId` 必须和编辑器页面 ID 一致。只有 `kind` 为 `window` 的页面能通过 `OpenWindow` 打开。

关闭：

```csharp
DjuiWindowManagerV6.CloseWindow("main_menu");
```

关闭所有：

```csharp
DjuiWindowManagerV6.CloseAll();
```

## 查找控件

优先使用页面作用域查询（同页多实例不冲突）：

```csharp
var btn = DjuiWindowManagerV6.GetSingletonControl<Button>("main_menu", "button_start");
```

只有确实需要同页多实例时才用实例 API：

```csharp
string instanceId = DjuiWindowManagerV6.OpenInstance("toast");
var label = DjuiWindowManagerV6.GetControl<Label>(instanceId, "toast_text");
```

## 模板

编辑器中的模板页面会以 `kind = "template"` 保存。模板实例可以在编辑器中放入页面，Runtime 会按 `templateRef` 展开；运行时多实例用 `OpenInstance`。

## 按钮状态视觉

按钮支持 `button.imageHover / imagePressed / imageDisabled` 三张可选状态图，由 Runtime 状态机（`DjuiButtonStateV6`）监听指针事件自动切换；未设置的态沿用正常图。

- 禁用时未配置 `imageDisabled` → 自动兜底：图片灰度 + 整体透明度降为 50%（常量 `DjuiButtonStateV6.DisabledFallbackOpacity`）。
- 运行时动态切换禁用：数据绑定属性 `disabled`，或调用 `DjuiButtonState.SetDisabled(control, bool)`。
- 已知限制：直接给引擎控件赋 `Disabled` 只拦截点击、不刷新 DJUI 禁用视觉（引擎没有 Disabled 变更通知）。

## 运行时换图（SetImage）

游戏代码可在运行时替换节点图片，**只换图不动排版**（imageFit / sourceSize / focal 等沿用原属性，宿主矩形不变）：

```csharp
// 单例页口径（业务最常用）
DjuiWindowManagerV6.SetImage("building_detail", "building_detail_upgrade_button", "image/djui/buttons/upgrade_green.png");

// OpenInstance 多实例页口径
DjuiWindowManagerV6.SetImageByInstance(instanceId, "float_icon", "image/djui/icons/new.png");

// 直控口径：克隆体（CloneControl 产物）/ authored 节点通吃，按 Control 引用换图
DjuiWindowManagerV6.SetImage(cellControl, "image/djui/frames/quality_epic.png");
```

- `image` 传 `null`/空串＝撤销图片；对 Button＝换 normal 底图（hover/pressed/disabled 未配置的态与禁用灰化自动跟随新底图）
- 已开窗口换图后，转屏/重新布局不会把图片恢复成旧图（换图写入布局数据模型，与重放同源）
- 失败语义：返回 `false`（页面未开 / 节点不存在 / 节点是 Progress）并记 Warning 日志，不抛异常
- **Z 序限制**：带子件的节点，运行时建层（authored 空图片节点首次换图）或「SetImage(null) 撤销后再设回」会把图片绘制在子件之上（与编辑器相反且不被重放纠正）——带子件的节点避免撤销操作，恢复层级只能销毁重建窗口
- 窗口池淘汰销毁重建后直接 SetImage 的值会丢失：在 `OnCreate`/`OnOpen` 重放，或改走 image 绑定（新树注册时自动恢复最近值）
- 更多口径与限制见随 Runtime 分发的 `src/DjuiRuntime/AGENTS.md`「运行时换图」

## 动作路由

节点的 `djui.action` 会交给 `DjuiActionRouter`。项目可以在 Runtime 侧扩展动作注册逻辑，把编辑器中的动作名映射到游戏代码。

建议动作命名保持稳定，例如：

```text
open_inventory
close_window
start_game
buy_item
```

## 点击音效

编辑器中的「声音配置」会保存到 UI 工作区的 `.djui/layout/sounds.json`，发布时镜像为运行端的 `ui/AppBundle/user_files/djui/sounds.json`。每条配置引用一个已存在的 `GameDataSound`，并保存该数编项的 `Asset` 快照。

控件节点的 `djui.clickSoundId` 会在 Runtime 构建控件时绑定到点击事件。未找到音效配置、资源路径为空或加载失败时，Runtime 只记录 warning，不会阻断 UI 或 action。

默认情况下，Runtime 使用 StarEngine 的 2D 音源播放：

```text
SoundResource.Load("sound/...")
SoundSourceComponent.Play(...)
```

如果项目有自己的统一音频系统，可以注册后端接管：

```csharp
DjuiAudioSystem.SetBackend(new MyDjuiAudioBackend());
```

后端实现 `IDjuiAudioBackend.Play(DjuiSoundItemJson sound)`。返回 `true` 表示已处理，返回 `false` 时 DJUI 会继续使用默认播放方式。

## 数据绑定

页面节点的 `djui.bindings` 声明「属性 → 绑定 key」。游戏侧用 `Set` 推值，绑定该 key 的控件自动刷新：

```csharp
DjuiBindingSystem.Set("coin_count", 999);
```

当前支持的绑定属性：

| 属性 | 适用控件 | 行为 |
|---|---|---|
| `visible` | 全部 | 显隐 |
| `disabled` | 全部 | 禁用并刷新 DJUI 禁用视觉（走 `DjuiButtonState.SetDisabled`） |
| `text` | Label / Input | 文本 |
| `value` | Progress | 进度值 |
| `image` | Panel / Button（非 Progress） | 换图片（值＝图片路径，走 `SetImage` 同一通道；空值撤销图片） |

动态禁用也可以直接调 `DjuiButtonState.SetDisabled(control, bool)`（设置引擎属性并同步视觉）。

## 注意事项

- Runtime 文件被 DJUI 管理，不建议在 StarEngine 工程中直接手改；如需改动，请改 DJUI 仓库的 `runtime/` 源文件再同步。
- 修改 v6 协议字段时，需要同步更新 `editor/frontend/src/types/protocolV6.ts`（协议与宽屏覆盖白名单）与 `runtime/DjuiProtocolV6.cs`（v6 JSON 模型）；编辑器内部节点模型 `types/layout.ts` 若受影响也需同步。
- 修改 Runtime 行为后要提升 `RUNTIME_VERSION`，否则前端不会提示用户升级 Runtime。
