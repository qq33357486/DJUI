# DJUI Runtime 部署契约

> 本文件由 DJUI 编辑器随 Runtime 分发（`djui_version.txt` 记录版本）。
> 描述 Runtime 与星火工程之间的**部署契约与使用范式**。改 Runtime 行为请回 DJUI 仓库 `runtime/` 源文件，勿在此手改 .cs。

## 路径契约（谁写哪、谁读哪）

| 资源 | 唯一写入方（DJUI「发布」） | Runtime 读取路径 | 说明 |
|---|---|---|---|
| 项目配置 | `ui/AppBundle/user_files/djui/project.json` | `user_files/djui/project.json` | v6 Canvas、宽屏阈值和默认字体的唯一运行配置 |
| 页面 JSON | `ui/AppBundle/user_files/djui/pages/` | 相对路径 `user_files/djui/pages`（客户端进程 CWD=`ui/`） | **服务端不消费页面 JSON**（Runtime 全部 `#if CLIENT`），根 AppBundle 无需发布 djui 资源。编辑源在 UI 工作区 `.djui/layout/pages/`，星火工程的 `ui/djui` 是发布镜像，运行不读 |
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

// 7. 运行时动态禁用（走此方法或 disabled 绑定才会刷新 DJUI 禁用视觉；
//    直接给引擎控件赋 Disabled 只拦截点击、不变灰——引擎无 Disabled 变更通知）
DjuiButtonState.SetDisabled(btn, false);

// 8. 运行时换图（SetImage 三口径，详见下方「运行时换图（SetImage）」）
DjuiWindowManagerV6.SetImage(页面标识.建筑详情, "building_detail_upgrade_button", "image/djui/buttons/升级绿底.png");
DjuiWindowManagerV6.SetImage(格子控件引用, 品质底图路径);   // 直控口径：克隆体/authored 通吃
```

## 按钮状态视觉（normal / hover / pressed / disabled）

按钮四态换图与禁用灰化由 DJUI Runtime 自管（星火引擎 Button 无 ImageDisabled，且 v6 图片画在子 Panel 上、引擎状态换图不可用）：

- `button.imageHover` / `button.imagePressed` / `button.imageDisabled`：三个可选状态图，未设置的态沿用正常图
- 禁用时未配置 `imageDisabled` → 自动兜底：图片灰度 + 整体透明度降为 50%（常量 `DjuiButtonStateV6.DisabledFallbackOpacity`，实测后可调）
- 动态切换禁用：数据绑定属性 `disabled`（`DjuiBindingSystem.Set("key", bool)`）或 `DjuiButtonState.SetDisabled(control, bool)`
- 运行时换 normal 底图：`DjuiWindowManagerV6.SetImage(...)`——走 `DjuiButtonStateV6` 状态机通道（`Attach → Update`），hover/pressed/disabled 未配置的态与禁用灰化兜底自动跟随新底图；与 `SetDisabled` 同状态机单点写 visual，互不覆盖

## 运行时换图（SetImage）

游戏代码可在运行时替换节点图片，**只换图不动排版**：`imageFit / sourceSize / focalX/focalY / slicedEdges / desaturated` 等沿用该节点原 appearance 值，宿主矩形不变。三个公开重载：

- `SetImage(pageId, nodeInstanceId, image)`：单例页口径（业务最常用）
- `SetImageByInstance(windowInstanceId, nodeInstanceId, image)`：`OpenInstance` 多实例页口径（如飘字）
- `SetImage(control, image)`：直控口径，按 `Control` 引用换图——**克隆体（CloneControl 产物）/ authored 节点通吃**，业务手里是克隆控件引用时用这个（克隆体不能用 id 寻址时也兜底支持 `源id#cN`）

行为口径：

- `image` 传 `null`/空串＝撤销图片（回到无图形态）
- authored 空图片的节点（如宿主自渲染的飘字图标）换图后自动切换为 visual 子层渲染；撤销后还原
- 已开窗口换图后，转屏/视口变化触发的重新布局**不会把图片恢复成旧值**（换图同步写入布局数据模型）
- 对 Button＝更换 normal 底图，与 `SetDisabled` 禁用灰化自然共存
- 返回 `false`＝页面未开 / 节点不存在 / 节点是 Progress，均记 Warning 日志、不抛异常

数据绑定通道：节点 `djui.bindings` 声明 `"image": "绑定key"` 后，`DjuiBindingSystem.Set(key, 图片路径)` 即换图（与 SetImage 同一通道，空值撤销）。绑定通道的独特优势：**窗口销毁重建（池淘汰）后新树注册时自动恢复最近一次图值**；直接 SetImage 的值随旧树销毁丢失，业务需在 `OnCreate`/`OnOpen` 里重放（业务已有重开全量重刷惯例）。

**限制（首版口径）**：

1. Progress 进度条图片不支持运行时换图（走专属视觉层，三处机制互不相同，首版明确排除）
2. 节点声明了宽屏覆盖 `responsive.wide.overrides` 的 `appearance.image` 时，宽屏态 SetImage 不生效（宽屏层每次解析都会把覆盖图盖回来）——改用双节点法或去掉该覆盖（会有一次性 Warning 提示）
3. 窗口池淘汰销毁重建后，直接 SetImage 的值丢失——在 `OnCreate`/`OnOpen` 重放，或改走 image 绑定
4. 克隆体无数据绑定（克隆不绑行为），换图只能走 `SetImage(Control, …)`
5. **带子件的节点，运行时建层或「撤销图片后再设回」都会把图片绘制在子件之上**（Z 序与编辑器及初始建树相反，且不会被重放纠正）：空图片的容器节点首次换图、以及任何节点 `SetImage(null)` 撤销后再设回，都会触发。**带子件的节点应避免 SetImage(null) 撤销操作**；确需恢复正确层级只能销毁重建窗口（池淘汰/CloseAll 后重开）

## 克隆与动态尺寸的图片同步（Runtime 0.8.10）

`CloneControl` 返回前会按克隆的最终解算矩形同步预置图片与线性进度条的绘制层，无需重复设置同一张图片。

- 直接设置 DJUI 控件的显式 `Width/Height` 后，普通图片在下一次 Runtime 图片同步 `Think` 自动重算矩形；隐藏或未挂树的控件同样同步。线性进度条沿用原有帧同步机制。
- 需要本次调用内同步完成时，使用 `public static bool DjuiWindowManagerV6.RefreshVisuals(Control control, bool recursive = true)`；默认刷新控件及当前已挂接的子树，`recursive: false` 只刷新本控件。无效控件或不属于存活 DJUI 会话的控件返回 `false`。
- 接口只同步现有绘制层：不改宿主位置/尺寸、显隐、页面数据或锚点/拉伸约束，不触发 authored 布局重排，不换图片；图片比例、sourceSize、焦点、九宫格、染色和按钮当前状态沿用。放射状进度条仍由引擎原生渲染。
- 契约是 **显式设定的 Width/Height**，不保证引擎 Auto/百分比布局计算出的 `ActualSize` 同步。业务修改多个子控件时，先挂接到克隆树、批量设完尺寸，再刷新克隆根。仅改变 Position/Visible 无需刷新。
- authored 控件的业务尺寸修改是临时覆盖，后续 authored Relayout 仍按页面模型重新布局；克隆体保持既有「不参与 authored Relayout」语义。尺寸刷新不缩放或重新排布业务子控件。
- 新 API 需 Runtime ≥ 0.8.10；既有 CloneControl/SetImage/SetTint 调用兼容，预置图片的自动同步不要求修改业务代码。同步 Runtime 与脚本区后再接入新 API。

```csharp
var cell = DjuiWindowManagerV6.CloneControl(windowInstanceId, templateNodeId);
cell.Parent = list;
cell.Width = 96;
cell.Height = 96;
// 子控件 Position/Width/Height 按业务规则设置完毕之后：
DjuiWindowManagerV6.RefreshVisuals(cell); // 本次调用内同步整棵克隆子树
badge.Visible = true;                    // 预置图无需重复 SetImage
```

## 运行时染色（SetTint）

游戏代码可在运行时给节点图片染上乘算色，**只染色不动图片与排版**。三个公开重载与 SetImage 一一同构：

- `SetTint(pageId, nodeInstanceId, tint)`：单例页口径（业务最常用）
- `SetTintByInstance(windowInstanceId, nodeInstanceId, tint)`：`OpenInstance` 多实例页口径
- `SetTint(control, tint)`：直控口径，克隆体 / authored 节点通吃

行为口径：

- 染色是**乘算**：图片像素 × 颜色。白色素材＝直接变成该颜色（一套白图多色复用，如星级星、品质框）；**透明区域保持透明**，不会出现色块
- 颜色带 alpha 时按 `原图×颜色×α + 原图×(1-α)` 混合（半透明染色）
- `tint` 传 `null`/空串＝撤销染色；格式 `#RRGGBB` / `#RRGGBBAA` / `rgba()`，非法值返回 false 并记 Warning
- 换图不丢染色：`SetImage` 换图后 tint 沿用（同一 visual 层）；Button 染 normal 底图所在 visual，未配置的 hover/pressed/disabled 态自动跟随
- Progress 进度条**支持染色**（放射状与线性都走建树同款通道），这点与 SetImage 不同（SetImage 不支持 Progress）
- 页面 JSON 里写 `appearance.imageTint` 即建树期静态染色（编辑器右侧面板「图片染色」），运行时 SetTint 覆盖之
- 已开窗口染色后转屏/重布局不回退（同步写入布局数据模型）；窗口池销毁重建后运行时值丢失，需在 `OnCreate`/`OnOpen` 重放（同 SetImage 口径）
- 节点声明了宽屏覆盖 `appearance.imageTint` 时宽屏态 SetTint 不生效（同 SetImage 的宽屏限制）

```csharp
// 星级星图染色：白色星母版一套图，按品质运行时变色
DjuiWindowManagerV6.SetTint(页面标识.艺人列表, "star_icon_3", "#FFC53D");   // 金
DjuiWindowManagerV6.SetTint(格子控件引用, "#7B61FF");                      // 直控口径（克隆格）
DjuiWindowManagerV6.SetTint(页面标识.艺人列表, "star_icon_3", null);       // 撤销染色
```

## 窗口转场（Runtime 0.9.0）

`mode: popup` 的内置 pop / slide / fade 转场自动按布局约束协调，无需新增动效目标配置：

- 根层节点声明 `stretch.style: Both`，四边 margins 为零（省略按零处理），且 `anchor.target` 为 `screen` 或 `parent`（省略按 parent），转场中保持原有位置和尺寸，仅继承根节点透明度变化。带非 None 宽高比约束的节点不属于铺满层。
- 其余根层内容以页面中心执行同一个缩放/平移变换。独立关闭提示与主体的相对位置一起变化；全屏层下的提示随其原有父层固定，不搬节点、不改层级。
- 因此 popup 的主体如果本身也是双向零边距铺满层（例如全屏拍摄 sheet），自然仅淡入淡出。`fullscreen` 页面维持原有整根转场，不按模态规则分层。
- 保留全部节点的 Visible 和子层 Opacity；隐藏概率层、透明度零层不会被转场恢复成可见。遮罩 action 原样执行，队列继续等业务语义仍由业务处理。
- 关闭期间新增无视觉的全屏输入阻挡，动画结束并触发 OnClose 后摘栈；取消关闭移除阻挡，不触发 OnClose/OnOpen。重复关闭被合并，池复用与多实例销毁会清理临时变换。
- 转屏时先撤销转场几何，按新视口解算，再继续同一进度。控件 ID 寻址、父子树、克隆、action 和绑定保持原有契约。

绝对定位控件的 slide 转场使用 Position（而非被绝对定位忽略的 Margin）。纯淡入淡出和 none 沿用已有预设与时序。

自定义 `DjuiTransitionPreset` 默认保留单控件行为；只包含统一轴向缩放/平移/透明度，且缩放与节点旋转可交换的自定义预设，可显式传 `coordinateWindowContent: true`。不要将旋转、重排或任意属性动画声明为该模式。内置 pop 为统一等比例缩放。

接入时通过网页「更新 Runtime」或同代本地发布器 `upgrade-runtime` 更新整套源码（版本标记为 0.9.0），再通过星火编辑器完整 `debug_start` 编译和部署。无需修改现有 Movie 页面 JSON 或业务遮罩接线。

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
| 外观 | `appearance.image`、`imageTint`、`background`、`imageFit`、`focalX`、`focalY`、`borderThickness`、`borderColor` |
| 文本 | `text.text`、`fontSize`、`textColor`、`strokeSize`、`strokeColor`、`bold`、`font`、`textWrap` |
| 按钮/进度 | `button.imageHover`、`button.imagePressed`、`button.imageDisabled`、`progress.value` |

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

### 场景画板（背景与素材坐标同缩放）

需要「钉在背景图上」的内容（场景建筑、地图标记等）使用 sceneFrame，而不是只依赖 target: image：

- 背景和场景画板必须都是页面根下节点；画板以 sceneFrame.backgroundId 显式指向背景，避免依赖节点顺序。
- 画板本身必须 anchor.target: image + stretch.style: Both；它先铺满背景的完整 contain/cover 图帧。
- sceneFrame.artboard 是素材原始画幅。画板内的子树使用这套局部坐标，运行时与编辑器一起按图帧横、纵比例映射，**位置和尺寸都会随背景缩放**。
- 画板内子节点只能用 anchor.target: parent；屏幕 UI（返回、货币、设置等）必须留在画板外，使用 safe / screen 锚点。

~~~json
{
  "id": "building_group",
  "anchor": { "target": "image", "side": "TopLeft" },
  "stretch": { "style": "Both", "margins": { "left": 0, "top": 0, "right": 0, "bottom": 0 } },
  "sceneFrame": {
    "backgroundId": "scene_background",
    "artboard": { "width": 1080, "height": 2400 }
  }
}
~~~

旧的 target: image 仍可用于“只跟随图帧位置/边界”的普通容器，但它**不会**把绝对定位的子元素缩放；素材坐标场景必须升级为 sceneFrame。

## 窗口池化与生命周期（0.8.0：关闭与销毁分离）

`CloseWindow` 只做「摘栈＋隐藏」（`IsOpen` 立即 false，寻址注册表同步注销——语义与旧版一致）；控件树进入**保留池**待复用，不再同帧销毁：

- **窗口池**：`OpenWindow` 单例路径的实例关闭后进 FIFO 池（默认容量 `project.json` 的 `poolCapacity`＝5）；重开命中池＝直接复用（不重建树、播 open 转场）；复用后再关闭重新排到最新＝高频页天然留池
- **钉住白名单**：`project.json` 的 `retainedPages: [...]` 中的页面永不淘汰、常驻复用（通用确认框这类连弹页建议钉住）
- **销毁缓冲**：池淘汰 / `OpenInstance` 多实例关闭 / `CloseAll` 统一经 250ms 缓冲再真正 `Dispose`——按压回弹动画在活树上自然播完，业务侧**不再需要延时关窗规避**（直接 `CloseWindow` 即可）
- `OpenInstance` 显式多实例不入池不复用；`CloseAll`/`Initialize` 全清池（页面 JSON 更新后旧树绝不复用）

### 生命周期事件（业务侧范式）

```csharp
// 模块初始化() 里注册一次（Initialize 之后；进程级，多订阅）：
DjuiWindowManagerV6.OnCreate(页, () => 接线X页());   // 建树后（池淘汰后重开＝重建＝再次触发；DjuiActionRouter.On 为覆盖语义，重复接线安全）
DjuiWindowManagerV6.OnOpen (页, () => 刷新X页());    // 每次显示（新建 / 池复用），OpenWindow 返回前同步触发
DjuiWindowManagerV6.OnClose(页, () => 清理X页());   // 摘栈进池前——寻址仍可用，清回调引用/重置临时状态的最后机会
DjuiWindowManagerV6.OnDestroy(页, () => { });       // 真正销毁前（极少用到；数据订阅挂模块初始化、勿挂此处）
```

- 打开方法瘦身成「**先存状态字段 → `OpenWindow(页)`**」，刷新逻辑放 `OnOpen`（等价于旧「打开后手动刷新」，二选一即可）
- 关闭转场中途重开（`CancelClosing`）不触发任何事件——窗口从未真正关闭
- **不要跨关闭缓存控件引用**：关闭后重开可能拿到复用旧树或重建新树，一律 `GetSingletonControl` 现查现用
- 事件回调异常会被隔离并记日志，不会阻断窗口状态机；`GetLifecycleStats()` 返回（建树/复用/销毁）计数，供验收排障

### 窗口层序管理

窗口默认按打开次序叠放（后开在上；**命中序＝视觉树序，ZIndex 不参与命中**）：

- `OpenWindow` 已开页＝置顶聚焦（自动重挂树末尾），先开的弹窗不会被后开的基础页盖住
- `BringToFront(pageId)`：把已开窗口手动移到最前（恢复被盖住弹窗的可点性）
- `SendToBack(pageId)`：把已开窗口压到最底——场景类基础页专用，任何时刻（重）开都不遮业务弹窗

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
