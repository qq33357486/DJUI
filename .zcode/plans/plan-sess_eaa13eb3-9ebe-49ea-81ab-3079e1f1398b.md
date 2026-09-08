# DJUI 窗口池化复用 + 业务层生命周期迁移（两阶段总计划）

## 方案定稿（五轮讨论结论）

- **关闭→全部入池**：`CloseWindow` 只摘栈隐藏；白名单页钉住永不挤出；非白名单进 FIFO 池（容量 5，复用重排＝隐式 LRU）；**挤出→250ms 销毁缓冲→Dispose**（兜底同帧挤爆池时按压动画未播完的极端路径）；`CloseAll`/`Initialize` 全清池
- **四段生命周期事件**：OnCreate（建树后）/ OnOpen（每次显示：新建、池复用）/ OnClose（摘栈进池前，树仍可寻址）/ OnDestroy（Dispose 前）；转场中 CancelClosing 不触发事件
- **配置进 project.json**：`retainedPages[]` + `poolCapacity`（默认 5），编辑器工程配置弹窗设置；schemaVersion **不升**（常量被全部页面 JSON 共用＋schemaV6 严格门禁会误伤 18 个存量页面；可选字段向后兼容，老 Runtime 读新 JSON 由发布前 Runtime 版本检查拦截）
- **业务层全量迁移**（本次新增）：18 个有码页面按新事件范式重构，摘除 4 处 220ms 延时关窗
- `IsOpen`/`GetSingletonControl`/`CloseAll` 对外语义不变；`OpenInstance` 多实例不入池（关闭直接走 250ms 缓冲）；飘字模块（纯多实例）不迁移

---

## 阶段一：DJUI 仓库改造（Runtime 0.8.0 / 编辑器 0.19.0）

### Runtime（runtime/）
1. **`DjuiProtocolV6.cs`**：`DjuiProjectV6` 加可选字段 `RetainedPages: List<string>?`、`PoolCapacity: int?`（Disallow 严格校验要求模型有属性；`RequireVersion` 不动仍 6/1）
2. **`DjuiWindowManagerV6.cs` 池化重构**（约 +160 行，内聚单文件）：
   - 新状态：`LinkedList<RetainedEntry>` FIFO 池（条目含 Instance/PageId/FromSingleton/Pinned）；销毁延迟队列；四事件订阅表；`Initialize` 读 `_pinnedPages`/`_poolCapacity`；计数器 + `GetLifecycleStats()`
   - `FinalizeClose` 拆两步：`DetachWindow`（OnClose → 注销三注册表 → 停转场 → Host 摘树 → 入池 → 容量检查淘汰最老非钉住转 250ms 队列）/ `DisposeInstance`（OnDestroy → Dispose，try/catch 隔离）
   - `CloseWindow`：无转场不再同帧销毁改调 `DetachWindow`；有转场维持「转场完→DetachWindow」
   - `OpenWindow`：池命中（pageId 匹配 FromSingleton 条目）→ 挂树＋回注册表＋Relayout＋播 open 转场＋OnOpen；未命中走现有新建路径（Build 成功后 OnCreate＋OnOpen）
   - `RetentionThinker : IThinker`（照抄 DjuiTransitionPlayer 的 `Game.RegisterThinker` 模式）：销毁队列倒计时，到期先出队再 Dispose
   - `CloseAll`/`Initialize`：栈内条目 OnClose→OnDestroy→Dispose，池与队列全清
   - 事件 API `OnCreate/OnOpen/OnClose/OnDestroy(pageId, Action)`，多订阅、逐回调 try/catch 记日志
3. **`runtime/AGENTS.md`**：补「窗口池化与生命周期」契约段（关闭语义、池规则、四事件触发时机表、`_已接线`→OnCreate 迁移指引、禁止跨关闭缓存控件引用、GetLifecycleStats）
4. **`runtimeBundle.ts`**：`RUNTIME_VERSION = '0.8.0'`

### 编辑器（editor/frontend/src/）
5. `types/protocolV6.ts`：`ProjectFileV6` 加 `retainedPages?: string[]`、`poolCapacity?: number`（schemaVersion 常量不动）
6. `types/layout.ts`：`ProjectConfig` 加同名字段
7. `api/client.ts`：`createProjectFileV6` Pick＋兜底链、`projectConfigFromV6` 反向映射
8. `components/ConfigModal.tsx`：`mode !== 'new'` 区加「常驻复用页面」`Select mode="multiple"`＋「窗口池容量」`InputNumber`，`handleOk` 组装（App.tsx 传 `pages`）
9. `package.json` → 0.19.0；`CHANGELOG.md` 加条目（用户视角：关窗不再拖 220ms、高频页秒开、按压僵尸报错根除、窗口池可配置）

### 阶段一验证（对应用户四步流程）
1. `npx tsc --noEmit` + `npm run build`（前置钩子重打包发布器）
2. `npm run dev` → Study 工作区：配置弹窗新字段保存落盘验证 → 一键更新 Runtime 0.8.0 → 配 retainedPages/poolCapacity → 发布
3. Study 客户端：S00016 复现零 `Control is not valid` soak；连弹/切换看 `GetLifecycleStats()` 建树数；`IsOpen` 守卫；隐藏页穿透；`CloseAll` 清池重开；四事件触发顺序与配对（临时日志回调）
4. commit/push → `gh run watch` → 服务器 `docker compose pull && up -d` → curl 200

---

## 阶段二：Project_Movie 业务层迁移（Runtime 0.8.0 同步后，可紧接 Study 验证通过开工）

### 迁移模板（每模块统一）
```csharp
// 模块初始化() 里注册一次（DjuiWindowManagerV6.Initialize 之后）：
DjuiWindowManagerV6.OnCreate(页, () => 接线X页());              // 替代 _已接线 flag 懒接线（Router.On 已确认覆盖语义，重建重复触发安全）
DjuiWindowManagerV6.OnOpen (页, () => 刷新X页());               // 替代「OpenWindow 后手动刷新」
DjuiWindowManagerV6.OnClose(页, () => { 停驱动器(); 清会话态(); }); // 替代关闭三步中的清理
```
打开方法瘦身成「**先存状态字段 → OpenWindow(页)**」（多数模块已是此序；通用确认框需把标题/文本参数字段化）。

**不迁清单**：数据变化订阅（`+=` 叠加语义且 IsOpen 守卫在池化下依然正确，保持模块初始化挂一次）；飘字模块（纯多实例无页面级开关）；OnDestroy 暂无必需用例按需用。

### 分批迁移（13 个业务文件 / 18 页）
- **第一批（5 模块＝白名单四页＋拍摄，同步摘除全部 4 处 220ms 延时关窗改直关）**：通用确认框.客户端.cs、通用奖励弹窗.客户端.cs、谈判战斗模块.战斗页接线.cs（`关闭战斗页()` 三步→OnClose）、地推关卡模块.页面接线.cs、拍摄系统模块.页面接线.cs（演出驱动器停止迁 OnClose）
- **第二批（8 模块 13 页）**：公司模块（HUD＋场景1/2/3）、GM业务模块（急切接线顺手统一到 OnCreate）、建筑系统模块.详情页接线、艺人系统模块.页面接线（五页）、阵容系统模块.页面接线
- **测试集同步**：地推测试集.cs:614 等基于「延时关窗 220ms＋裕量」的断言改为直关断言（随第一批）

### 阶段二验证
- S00016 场景 soak 零报错；四页连开连关 N 次建树数＝1；池挤出/复用日志计数核对；各页功能回归（打开刷新、数据守卫刷新、关闭清理）；Project_Movie 独立提交流程
- 回归通过后更新 `DJUI需求-按压动画僵尸报错.md` 与需求登记文档状态

## 风险与注意
- Study/Project_Movie 装上 0.8.0 后不可降级（拒绝降级机制）；回退须手删 `djui_version.txt`
- 内存常驻＝池 5＋钉住页，Study 阶段观察内存曲线；`poolCapacity` 可配 0 应急
- build 前置钩子跑完再提交（否则脚本区 CLI 携旧 Runtime，逐字校验会拦截）
- 迁移期间新旧范式可共存（事件可选），分批不阻塞发版