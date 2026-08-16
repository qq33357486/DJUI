# DJUI Runtime 部署契约

> 本文件由 DJUI 编辑器随 Runtime 分发（`djui_version.txt` 记录版本）。
> 描述 Runtime 与星火工程之间的**部署契约与使用范式**。改 Runtime 行为请回 DJUI 仓库 `runtime/` 源文件，勿在此手改 .cs。

## 路径契约（谁写哪、谁读哪）

| 资源 | 唯一写入方（DJUI「发布」） | Runtime 读取路径 | 说明 |
|---|---|---|---|
| 页面 JSON | `ui/AppBundle/user_files/djui/pages/` | 相对路径 `user_files/djui/pages`（客户端进程 CWD=`ui/`） | **服务端不消费页面 JSON**（Runtime 全部 `#if CLIENT`），根 AppBundle 无需发布 djui 资源。源文件在 `ui/djui/pages/`，仅供编辑器编辑，运行不读 |
| 音效配置 | `ui/AppBundle/user_files/djui/sounds.json` | `user_files/djui/sounds.json` | 同上，仅客户端 |
| 图片素材 | `ui/image/djui/` | 引擎直读（`image/djui/...` 相对 `ui/` 根），不进 AppBundle | 控件 `appearance.image` 写 `image/djui/...` |

**关键点**：页面/音效的唯一运行消费方是客户端进程（CWD=`ui/`），发布只写 `ui/AppBundle`。任何手工拷贝页面 JSON 的行为都被禁止——拷错位置（如拷到根 AppBundle）或版本错位正是「页面没开 / 图不对」类故障的根源。

## 使用范式（客户端代码）

```csharp
using DjuiRuntime;

// 1. 初始化（OnGameTriggerInitialization 阶段）：扫描双端 pages 目录并缓存
DjuiWindowManager.Initialize();

// 2. 打开窗口（nodeKind=window 的页面）
DjuiWindowManager.OpenWindow("main_menu");

// 3. 查找控件（按节点 ID；建议业务侧用常量类收敛 ID）
var btn = DjuiWindowManager.GetControl<Button>("button_start");

// 4. 事件路由（页面 JSON 中 djui.action 声明的动作名）
DjuiActionRouter.On("open_inventory", () => { ... });

// 5. 数据绑定（Set 后绑定该 key 的控件自动刷新）
DjuiBindingSystem.Set("coin_count", 999);
```

## 故障定位表

| 症状 | 根因 | 修复 |
|---|---|---|
| 日志「页面目录不存在或为空」 | `ui/AppBundle` 断供（发布后手工删了/未发布） | 在 DJUI 编辑器重新点「发布」（写入 `ui/AppBundle/user_files/djui/pages`） |
| `OpenWindow` 报「页面 xxx 不存在」并列出已注册页面 | 该 pageId 没发布，或 pageId 拼写与 JSON 不一致 | 对照日志列出的已注册清单检查；重新发布 |
| 页面开了但图片不显示 | 图片引用路径不含 `image/djui/` 前缀，或素材未发布到 `ui/image/djui/` | 检查控件 `appearance.image` 与素材发布状态 |
| 页面拷到了根 AppBundle 仍不生效 | 根 AppBundle 不是消费方（服务端不读页面 JSON） | 只发布到 `ui/AppBundle`；用编辑器发布而非手工拷贝 |

## 禁止

- 禁止手工拷贝页面 JSON 到任何 AppBundle（版本错位源头）
- 禁止直接修改本目录 .cs 文件（编辑器升级会整目录覆盖；改动请去 DJUI 仓库 `runtime/`）
