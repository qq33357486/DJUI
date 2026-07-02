# Runtime 接入

DJUI Runtime 是 `runtime/*.cs` 中的一组 C# 源码。编辑器会把这些文件复制到 StarEngine 工程：

```text
StarEngine 工程/src/DjuiRuntime/
```

## 安装和升级

在 DJUI 的「工程配置」里选择 StarEngine 工程后：

1. 如果未安装 Runtime，点击「初始化」。
2. 如果版本过期，点击「升级」。

Runtime 版本号由 `editor/backend/src/routes/project.ts` 中的 `RUNTIME_VERSION` 管理。改动 `runtime/*.cs` 的兼容行为时，应同步提升版本号。

## 发布后的文件位置

发布后页面 JSON 会进入：

```text
StarEngine 工程/AppBundle/user_files/djui/pages/
StarEngine 工程/ui/AppBundle/user_files/djui/pages/
```

素材会进入：

```text
StarEngine 工程/ui/image/djui/
```

音效配置会进入：

```text
StarEngine 工程/AppBundle/user_files/djui/sounds.json
StarEngine 工程/ui/AppBundle/user_files/djui/sounds.json
```

Runtime 默认从 `user_files/djui/pages` 扫描页面，并从 `user_files/djui/sounds.json` 读取 DJUI 音效配置。

## 初始化

在客户端初始化阶段调用：

```csharp
using DjuiRuntime;

DjuiWindowManager.Initialize();
```

`Initialize()` 会扫描页面 JSON 并缓存页面定义。

## 打开和关闭窗口

```csharp
var root = DjuiWindowManager.OpenWindow("main_menu");
```

`pageId` 必须和编辑器页面 ID 一致。只有 `nodeKind` 为 `window` 的页面能通过 `OpenWindow` 打开。

关闭：

```csharp
DjuiWindowManager.CloseWindow("main_menu");
```

关闭所有：

```csharp
DjuiWindowManager.CloseAll();
```

## 查找控件

按节点 ID 查找：

```csharp
var startButton = DjuiWindowManager.GetControl("button_start");
```

按窗口和节点查找：

```csharp
var title = DjuiWindowManager.GetControl("main_menu", "label_title");
```

按类型查找：

```csharp
var button = DjuiWindowManager.GetControl<Button>("button_start");
```

## 模板

编辑器中的模板页面会以 `nodeKind = "template"` 保存。运行时可以手动创建模板控件：

```csharp
var item = DjuiWindowManager.CreateTemplate("item_card");
```

模板实例也可以在编辑器中放入页面，Runtime 会按 `templateRef` 构建。

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

编辑器中的「声音配置」会生成 `ui/djui/sounds.json`。每条配置引用一个已存在的 `GameDataSound`，并保存该数编项的 `Asset` 快照。

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

`DjuiBindingSystem` 负责维护节点 ID 到控件实例的映射。当前版本提供基础注册和查找能力，项目侧可以在此基础上扩展状态同步。

## 注意事项

- Runtime 文件被 DJUI 管理，不建议在 StarEngine 工程中直接手改；如需改动，请改 DJUI 仓库的 `runtime/` 源文件再同步。
- 修改 JSON 协议字段时，需要同步更新 `editor/frontend/src/types/layout.ts` 和 `runtime/DjuiModels.cs`。
- 修改 Runtime 行为后要提升 `RUNTIME_VERSION`，否则前端不会提示用户升级 Runtime。
