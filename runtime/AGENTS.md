# DJUI Runtime 部署契约

> 本文件由 DJUI 编辑器随 Runtime 分发（`djui_version.txt` 记录版本）。
> 描述 Runtime 与星火工程之间的**部署契约与使用范式**。改 Runtime 行为请回 DJUI 仓库 `runtime/` 源文件，勿在此手改 .cs。

## 路径契约（谁写哪、谁读哪）

| 资源 | 唯一写入方（DJUI「发布」） | Runtime 读取路径 | 说明 |
|---|---|---|---|
| 项目配置 | `ui/AppBundle/user_files/djui/project.json` | `user_files/djui/project.json` | v6 Canvas、宽屏阈值和默认字体的唯一运行配置 |
| 页面 JSON | `ui/AppBundle/user_files/djui/pages/` | 相对路径 `user_files/djui/pages`（客户端进程 CWD=`ui/`） | **服务端不消费页面 JSON**（Runtime 全部 `#if CLIENT`），根 AppBundle 无需发布 djui 资源。源文件在 `ui/djui/pages/`，仅供编辑器编辑，运行不读 |
| 音效配置 | `ui/AppBundle/user_files/djui/sounds.json` | `user_files/djui/sounds.json` | 同上，仅客户端 |
| 图片素材 | `ui/image/djui/` | 引擎直读（`image/djui/...` 相对 `ui/` 根），不进 AppBundle | 控件 `appearance.image` 写 `image/djui/...` |

**关键点**：页面/音效的唯一运行消费方是客户端进程（CWD=`ui/`），发布只写 `ui/AppBundle`。任何手工拷贝页面 JSON 的行为都被禁止——拷错位置（如拷到根 AppBundle）或版本错位正是「页面没开 / 图不对」类故障的根源。

## 使用范式（客户端代码）

```csharp
using DjuiRuntime;

// 1. 初始化：严格加载 protocolVersion=6/schemaVersion=1 项目与页面
DjuiWindowManagerV6.Initialize();

// 2. 页面单例：重复打开同一 pageId 不会创建重复窗口
Panel root = DjuiWindowManagerV6.OpenWindow("main_menu");

// 3. 页面作用域查询；不要使用全局裸节点 ID
var btn = DjuiWindowManagerV6.GetSingletonControl<Button>("main_menu", "button_start");

// 4. 只有确实需要同页多实例时才使用实例 API
string instanceId = DjuiWindowManagerV6.OpenInstance("toast");
var label = DjuiWindowManagerV6.GetControl<Label>(instanceId, "toast_text");

// 5. 事件路由（页面 JSON 中 djui.action 声明的动作名）
DjuiActionRouter.On("open_inventory", () => { ... });

// 6. 数据绑定（Set 后绑定该 key 的控件自动刷新）
DjuiBindingSystem.Set("coin_count", 999);
```

## 响应式宽屏层（基础层 / 宽屏层）

页面分两层：**基础层**（页面 JSON 里的节点与属性本体）与**宽屏层**（`responsive.wide.overrides` 差异补丁表）。运行时按**方向感知**规则自动选层：

- 判定：**物理宽 / 高 ≥ wideRatio**（`project.json` 的 `responsive.wideRatio`，默认 1.25）才进宽屏层；竖屏手机（宽 < 高）永远用基础层
- 默认 1.25 的含义：折叠屏展开横用（比值 1.10~1.20）归基础层；iPad / 安卓平板横置（1.33+）、桌面进宽屏层。需要折叠屏也走宽屏层时把阈值降到约 1.05
- 宽屏层生效时：先取基础层，再把补丁表里的属性盖上去；**没写在补丁表里的属性沿用基础层**

### 宽屏层允许覆盖的字段（封闭列表，超列即校验失败）

| 类别 | 字段 |
|---|---|
| 基础 | `basic.visible`、`basic.disabled` |
| 变换 | `transform.x` / `y` / `width` / `height` |
| 外观 | `appearance.image`、`background`、`imageFit`、`focalX`、`focalY`、`borderThickness`、`borderColor` |
| 文本 | `text.text`、`fontSize`、`textColor`、`strokeSize`、`strokeColor`、`bold`、`font`、`textWrap` |
| 按钮/进度 | `button.imageHover`、`button.imagePressed`、`progress.value` |

### 全屏背景换图范式（双节点法）

宽屏层**不能覆盖 `appearance.sourceSize`**（不在允许列表）。竖版 / 宽版两套全屏图用两个节点 + `basic.visible` 切换：

```json
{ "id": "fullscreen_art_portrait", "basic": { "visible": true },
  "appearance": { "image": "image/djui/backgrounds/bg_xxx_portrait.png",
    "imageFit": "cover", "sourceSize": { "width": 1080, "height": 2400 } } },
{ "id": "fullscreen_art_wide", "basic": { "visible": false },
  "appearance": { "image": "image/djui/backgrounds/bg_xxx_wide.png",
    "imageFit": "cover", "sourceSize": { "width": 1920, "height": 1200 } } }
```

宽屏层补丁：

```json
"responsive": { "wide": { "overrides": {
  "fullscreen_art_portrait": { "basic.visible": false },
  "fullscreen_art_wide": { "basic.visible": true } } } }
```

每个节点各自携带正确的 `sourceSize`（cover/contain 的裁切依据），运行时按层切换可见性即可。

## 字体

- 页面控件不写 `text.font` 时，用 `project.json` 的 `defaultFont`；`defaultFont` 为 `null` 时用**引擎默认字体**
- 自定义字体 = **标准字体文件**（.ttf / .otf / .ttc）放 `ui/font/<family>/`，并在 `ref/fontref.txt` 加一行 family 路径。引擎与 DJUI 画布加载同一文件，两端一致
- 星火自带的 `.otf` 是引擎私有封装，仅引擎可解码；画布只能近似预览。系统字体（如 `ui/font/msyh`）两端都调操作系统字体，也一致
- 推荐用 DJUI 编辑器的「字体管理」导入，自动完成拷贝与注册，不要手工搬运字体文件

## 故障定位表

| 症状 | 根因 | 修复 |
|---|---|---|
| 日志「页面目录不存在或为空」 | `ui/AppBundle` 断供（发布后手工删了/未发布） | 在 DJUI 编辑器重新点「发布」（写入 `ui/AppBundle/user_files/djui/pages`） |
| `OpenWindow` 报「页面 xxx 不存在」并列出已注册页面 | 该 pageId 没发布，或 pageId 拼写与 JSON 不一致 | 对照日志列出的已注册清单检查；重新发布 |
| 页面开了但图片不显示 | 图片引用路径不含 `image/djui/` 前缀，或素材未发布到 `ui/image/djui/` | 检查控件 `appearance.image` 与素材发布状态 |
| 页面拷到了根 AppBundle 仍不生效 | 根 AppBundle 不是消费方（服务端不读页面 JSON） | 只发布到 `ui/AppBundle`；用编辑器发布而非手工拷贝 |
| 竖屏手机显示了宽屏层内容（宽图/宽屏文案） | 旧版 Runtime 用「长短边比值」判定，竖屏 9:16 比值 1.78 也被判宽屏 | 升级 Runtime ≥ 0.7.9（方向感知判定：物理宽/高 ≥ wideRatio） |
| 文字字体与编辑器画布不一致 | 用了引擎封装格式字体，画布无法解码只能近似 | 改用标准字体文件或系统字体；在 DJUI「字体管理」重新导入 |
| cover 背景裁切方向不对 | 控件 `appearance.sourceSize` 与素材真实尺寸不符 | 在编辑器右侧属性里修正素材原始尺寸，重新发布 |

## 禁止

- 禁止手工拷贝页面 JSON 到任何 AppBundle（版本错位源头）
- 禁止直接修改本目录 .cs 文件（编辑器升级会整目录覆盖；改动请去 DJUI 仓库 `runtime/`）
