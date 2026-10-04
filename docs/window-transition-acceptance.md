# Popup 窗口转场验收

版本：编辑器 0.24.0 / Runtime 0.9.0。源码、网页安装器与单文件发布器使用同一 `runtimeBundle.ts` 清单。

## 规则与实现

只对 `window.mode = popup` 的内置 pop/slide/fade 分组。根保持几何不变，只改变根透明度。
根层节点声明 screen/parent 锚定、Both 拉伸、四边零边距，且没有改变矩形的宽高比约束时，几何保持原样。
其他根层子树以页面中心 `P`、共享比例 `s` 与位移 `d` 协调变换：子树中心 `C' = P + (C-P)*s + d`，子树 Scale 乘 `s`。
这使独立提示和主体之间的距离同步缩放；单独改变各节点 Scale 而不补偿中心坐标不能实现同样效果。
内置 pop 是等比例缩放，与节点自己的旋转可交换。父子树和树序不变，子树的图片、文字、克隆及命中继承真实引擎变换。

只接管转场几何与根 Opacity，不保存/重写子节点 Visible 或 Opacity。根 Opacity 为零时仍为零。
绝对定位的 slide 写 Position；相对定位兼容 Margin。完成、取消、销毁时恢复快照并退订布局通知。
转屏解算前撤销几何，解算后续播同一进度；关闭中的 popup 在 Host 末尾使用透明全屏输入控件阻挡。
原遮罩 action 不替换，OnClose 仍发生于动画完成、注销实例之前。窗口池复用仍按原生命周期执行。

## 自动化验证

```powershell
dotnet run --project tests/RuntimeTransitions/RuntimeTransitions.csproj
dotnet run --project tests/RuntimeTransitions/RuntimeTransitions.csproj -- <Movie工作区>/.djui/layout/pages
```

测试直接编译生产转场源码。最小引擎替身只存储属性和转发布局事件，不能证明原生绘制和命中效果。
标准测试覆盖约束判定、统一中心、旋转提示、取消、转屏续播、隐藏层、透明度零、动态根层克隆、反复复用、无效根和完成回调重入。
可选 Movie 核对读取当前源页并使用真实模板展开、响应式解析和布局求解，绝不写页面 JSON 或部署镜像。
2026-10-04 的核对结果：13 popup、7 fullscreen；5 视口 × 6 预设 × 20 页 = 600 场景，7637 断言通过。

## 实机验收要求

通过发布器 `upgrade-runtime` 接入源码，再以星火编辑器完整 `debug_start` 编译、部署、起局，并使用 Runtime MCP 验证。
不得用 client-only、手动拷 DLL 或修改 AppBundle 产物替代。
`ui.get_rect` 是布局矩形，不包含 Scale 的原生绘制变换；视觉几何须结合截图。

2026-10-04 在完整 Movie 调试环境完成引擎探针：400×600 的父层 Scale=0.8 后截图矩形以中心缩小，父缩放被子树继承；子层逆缩放1.25后截图恢复原范围。
绝对定位父层改 Margin.Top=60，截图不移动；改 Position.Y=60 后截图下移，验证 slide 必须用 Position。
这些探针确认变换依据，不能代替新 Runtime 的正式页面验收。

正式清单：

- 艺人详情 pop：开关全过程遮罩四边覆盖；safe sheet 正确缩放。
- 新艺人介绍 slide：遮罩不移动；原 artist_intro_backdrop 仍走“继续下一艺人”队列入口。
- 阵容配置：parent 锚定遮罩同样固定。
- 建筑详情：主体与根层独立提示共享变换；关闭提示位置关系不散。
- 通用奖励：遮罩子提示保留父子布局和点击层级。
- 艺人招募：隐藏概率 backdrop/panel 不误显；业务显隐和透明度零不被还原。
- 拍摄玩法：全屏 Both 零边距 sheet 自然仅淡入淡出。
- fullscreen：场景/HUD/战斗不使用模态分组；战斗闪光/暗屏层不受影响。
- 关闭重复点击无穿透；OnClose 不重复；关闭中重开取消阻挡且无残留。
- 池复用及多实例销毁归一；转屏和不同视口续播正确；none/fade 保持兼容。

### 2026-10-04 实际结果与边界

新 Runtime 已在完整 debug_start 起局后通过 Runtime MCP 核对：艺人详情 pop、新艺人介绍 slide、阵容配置 parent 遮罩、建筑详情独立提示、通用奖励、艺人招募隐藏层、拍摄 full-stretch sheet。固定层矩形与 Scale 不变，主体共享变换，所有根层 Visible/Opacity 保持原值；截图复核遮罩铺满。原生数据见 [运行证据](window-transition-runtime-evidence.json)。

关闭中重开保持同实例并恢复原几何；关闭后重开计数 Reused 递增。关闭期间连续 5 次原生指针点击，原遮罩接收计数为 0；完成只触发一次 OnClose，OnClose 内再调用 CloseWindow 不递归；重开后原遮罩恢复接收。两份 OpenInstance 重复关闭后 Remaining=0，阻挡层无残留。概率两层人为设置 Visible=false、Opacity=0 后，在转场和原生 Relayout 后均不误显。

输入层需要最高同级 ZIndex 和显式指针事件接收；无订阅的透明 Panel 实测仍会命中下层，不能作为阻挡证据。

Movie 数组原地 Reverse 扩展返回 void，曾使 foreach 编译失败（CS1579）；现使用快照倒序索引遍历，测试加入同名扩展以防回归。修复后完整客户端/服务端编译均零错误。

业务测试：服务端「艺人系统」16/16 通过；客户端「艺人UI」「通用UI」12/13 通过，包含 YUIT5/YUIT7 的逐项介绍与原 backdrop action。YUIT3 升级断言失败：客户端前置显示 Lv.11，服务端回复 Lv.2/30；单跑客户端组仍 Lv.11→Lv.3/30，已回报 Movie 会话，不计为通过。其前置缓存与服务端等级差异需在 Movie 业务测试中处理。

原生实机为 832×1850 竖屏；真正物理转屏、非零设备安全区未实机验证。5 视口的宽竖屏覆盖及转场中布局续播由自动化测试验证，不能替代设备转屏。fullscreen 场景/HUD 起局正常；战斗闪光/暗屏未另行触发实机验收。

临时 Runtime 探针与注册入口验收后移除，再执行完整 debug_start；不留业务接线或页面 JSON 改动。

清理后完整起局操作 `d13e0c3fa7f143dba22d46541cc8713b` succeeded；Runtime `debug.ping` 返回 client_only=false，工具表不再含 project.djui_probe。最终客户端 51 警告/0 错误、服务端 12 警告/0 错误；当局新客户端/服务端运行日志未检出 error、Unhandled 或 Exception。业务测试失败属于前一验收局，保留上述原始结果。

## Movie 接入

```powershell
node <同代发布器>/djui-publish.mjs runtime-status --workspace <Movie工作区> --json
node <同代发布器>/djui-publish.mjs upgrade-runtime --workspace <Movie工作区> --json
```

无需改页面和业务接线。网页发布前先同步脚本区，同代 CLI 使用 Runtime 0.9.0；之后由编辑器 debug_start 托管部署。
自定义预设默认沿用旧整根行为；仅符合共享轴向变换契约的预设可显式启用 `coordinateWindowContent`。
