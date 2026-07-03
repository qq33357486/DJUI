# DJUI - StarEngine 2.0 可视化 UI 编辑器

DJUI 是配套星火编辑器（StarEngine 2.0）使用的 UI 编辑器，分离的「Web Editor（编辑态）+ Runtime（运行态）」架构。
Web Editor 部署在线上，导出 JSON；Runtime 是一组 C# 类，丢到星火工程里读取 JSON 构建控件树。

> 本文件描述 **DJUI 工具仓库本身**（这个 repo）怎么维护。
> 工作区里的 AGENTS.md（描述 UI 素材工作流）由编辑器自动生成到 workspace 根目录，**不要**和本文件混淆。

---

## 一、仓库结构

```
DJUI/
├── AGENTS.md              # 本文件（仓库维护说明）
├── editor/
│   ├── frontend/          # React + Vite + Konva + Antd 纯前端（dev 端口 7321）
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── main.tsx               # 入口，包裹 AppErrorBoundary
│   │       ├── components/            # TopBar / LeftPanel / CanvasArea / RightPanel / AssetPickerModal 等
│   │       │   └── AppErrorBoundary.tsx  # 顶层错误兜底（防白屏）
│   │       ├── store/                 # editorStore（画布）+ projectStore（配置/agents 状态）
│   │       ├── fs/                    # File System Access API 封装层
│   │       ├── api/client.ts          # 所有文件操作集中在此（页面 CRUD、素材、发布）
│   │       ├── lib/normalize.ts       # ★ 数据边界关卡：unknown JSON → 安全 UiPage
│   │       ├── lib/patches.ts         # 语义迁移：锚点升级、音效补丁
│   │       └── types/layout.ts        # UI 节点数据模型
│   ├── Dockerfile         # 纯前端镜像（Nginx serve dist）
│   └── screenshots/       # 截图归档
├── runtime/               # C# Runtime（发布到星火工程 src/DjuiRuntime/）
├── projects/              # 内置示例工程（导出 JSON 样例）
└── docs/                  # 设计文档
```

> 纯前端架构：使用浏览器 File System Access API 直接读写用户选择的工程目录，无后端服务。

## 二、开发工作流

### 启动
```powershell
# 前端（端口 7321，vite HMR）
cd editor/frontend; npm run dev
```
浏览器打开 `http://localhost:7321`。

### 类型检查（提交前必跑）
```powershell
cd editor/frontend; npx tsc --noEmit
```

### 生产构建
```powershell
cd editor/frontend; npm run build      # 产物在 frontend/dist
# Docker 镜像用 Nginx serve dist/
```

## 三、Runtime 同步

- 源在 `runtime/*.cs`
- 通过前端 `api/client.ts` 的 `initRuntime()` 复制到 `<星火工程>/src/DjuiRuntime/`
- 版本号在 `lib/bundledAssets.ts` 的 `RUNTIME_VERSION` 常量
- 升级 Runtime 时同步升 `RUNTIME_VERSION`，前端 TopBar 会出现"更新 Runtime"提示

## 四、AGENTS.md 规范更新机制（重点）

工作区 AGENTS.md 是「描述素材规范」的文档，由编辑器维护。完整流程：

1. **改 DJUI**：编辑 `editor/backend/src/agentsTemplate.ts`
   - 修改 `buildAgentsMd()` 内容
   - **必须升级** `AGENTS_VERSION`（小修 patch，新增分类 minor，删除/重命名分类 major）
2. **触发更新提醒**：编辑器启动时前端调用 `GET /api/workspace/check-agents`，
   后端读取 workspace `AGENTS.md` 顶部的 `<!-- DJUI-AGENTS-VERSION: x.x.x -->` 标记，
   与 `AGENTS_VERSION` 比较，返回 `ok` / `outdated` / `missing`。
3. **用户点更新**：TopBar 右侧出现橙色徽章（`SyncOutlined`），点击弹窗确认，
   调用 `POST /api/workspace/update-agents` 把 `buildAgentsMd()` 整文件写入 workspace。
   旧文件备份为 `AGENTS.md.bak`。

**永远不要**把 workspace AGENTS.md 的内容硬编码到别处，唯一权威源是 `agentsTemplate.ts`。

## 五、成品素材分类规范

工作区 AGENTS.md 里维护着完整的成品素材分类决策树和命名规范（backgrounds/buttons/frames/icons/lists/decorations/text/misc）。
修改分类时同步：
- `agentsTemplate.ts` 的 `buildAgentsMd()`（文档）
- `project.ts` 的 `FINISHED_SUBDIRS`（实际初始化时创建的目录）
- `assets.ts` 的 `IMAGE_EXTS`（如果引入新格式）

三者必须保持一致。

## 六、端口约定

| 用途 | 端口 | 备注 |
|---|---|---|
| 前端 dev | 7321 | 不常见，避开 Vite 默认 5173 |

> 纯前端架构（File System Access API），无后端端口。

## 七、编码规范

- TypeScript strict，提交前 `npx tsc --noEmit` 必须过
- 前端：React 函数组件 + Zustand store + Antd UI，避免 class 组件
- 中文注释和提示文案；变量/函数名英文
- 文件路径相关代码统一用 `path.join` + `replace(/\\/g, '/')`，跨平台

## 八、页面数据边界防护（重要！避免白屏）

页面 JSON 从磁盘加载到运行时渲染，必须经过三层防护管线。**修改涉及数据加载或节点结构的代码时，务必遵守以下规范。**

### 数据流管线

```
磁盘 JSON
  │
  ▼ normalizePage()          ← lib/normalize.ts
  │  结构归一化：确保 children:[], id, starType 等必填字段
  │  宽容输入，严格输出，永不抛异常
  │
  ▼ patchPageData()          ← lib/patches.ts
  │  语义迁移：锚点格式升级、音效补齐、version 升级
  │
  ▼ 组件渲染
  │  渲染层防御：(node.children ?? []).map()
  │
  ▼ AppErrorBoundary         ← components/AppErrorBoundary.tsx
     最终安全网：崩溃显示错误页而非白屏
```

### 核心规则

1. **所有页面数据入口必须经过 `normalizePage()`**
   - `api/client.ts` 的 `loadPage()` 是唯一公开入口
   - 直接用 `readFileJson` 读页面 JSON 然后绕过 normalize 是**禁止的**
   - `patches.ts` 的 `patchPageData()` 内部也调了 normalize（双重保险）

2. **新增节点字段时的检查清单**
   - 在 `types/layout.ts` 加字段 → 同步在 `lib/normalize.ts` 的 `normalizeNode` 里补上透传逻辑
   - 如果新字段是渲染必需的 → 在 `normalizeNode` 里兜底默认值（不只是透传）
   - 渲染组件里访问新字段时仍要防御：`node.newField ?? defaultValue`

3. **`normalize.ts` 与 `patches.ts` 的分工**
   - `normalize`：只管结构完整性（字段存不存在、类型对不对），**不改语义**
   - `patches`：只管语义迁移（旧格式转新格式、补数据），**假设结构已完整**
   - 不要把这两个职责混在一起

4. **渲染层编码约定**
   - 遍历子节点永远用 `(node.children ?? []).map(...)`，不要裸写 `node.children.map`
   - 这是为了防御未来 normalize 可能遗漏的边界情况

5. **AppErrorBoundary 是最后的防线**
   - 任何未捕获的渲染异常都会显示错误页而非白屏
   - 错误页提供"刷新"和"清除记忆页面"两个恢复选项
   - 不要移除这个 Boundary
## 九、更新公告与版本管理

### 版本号
- 编辑器版本号在 `editor/frontend/package.json` 的 `version` 字段
- 每次发版（Docker 更新）**必须**同步升版本号（patch/minor/major）

### CHANGELOG.md 规范（强制）
- 仓库根目录 `CHANGELOG.md` 是更新公告的**唯一权威源**
- 格式：`## [版本号] - YYYY-MM-DD`，下面按分类列条目
- 支持的分类标题（`###` 级别）：`新增`、`修复`、`优化`、`破坏性变更`、`移除`
- **每次提交涉及用户可见变化的，必须在 CHANGELOG.md 对应版本下记录**
- CHANGELOG.md 会被 vite build 通过 `?raw` 内联到前端 JS bundle

### 更新公告功能工作流
1. `editor/frontend/src/lib/changelog.ts` 解析 CHANGELOG.md 为结构化数据
2. 用户打开编辑器时，App.tsx 比对 `localStorage('djui.lastSeenVersion')` 与 `APP_VERSION`
3. 版本不一致 → 自动弹出 WhatsNewModal（时间线 UI），最新版本条目高亮闪烁
4. 关闭弹窗后写入 `localStorage('djui.lastSeenVersion')`，下次不再弹
5. 帮助菜单 → 「更新公告」可随时手动查看

### 发版检查清单
- [ ] `editor/frontend/package.json` 版本号已升级
- [ ] `CHANGELOG.md` 有对应版本的条目，分类和条目完整
- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run build` 通过

> 此文件由人工维护，描述工具仓库本身。请随架构演进同步更新。
