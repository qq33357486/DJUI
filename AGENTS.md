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
│   ├── backend/           # Fastify + tsx 后端
│   │   ├── src/
│   │   │   ├── server.ts            # 入口，监听端口 37241
│   │   │   ├── agentsTemplate.ts    # 工作区 AGENTS.md 的模板源 + 版本号
│   │   │   └── routes/
│   │   │       ├── project.ts       # 工程配置、目录浏览、Runtime 同步、workspace 初始化/发布、AGENTS 更新
│   │   │       ├── pages.ts         # UI 页面 JSON CRUD
│   │   │       ├── assets.ts        # 素材层级浏览 + 图片 HTTP 接口
│   │   │       └── effects.ts       # 效果预设
│   │   ├── djui_config.example.json # 本机配置示例
│   │   └── djui_config.json         # 当前绑定的工作区/星火工程路径（gitignored，本机生成）
│   ├── frontend/          # React + Vite + Konva + Antd 前端（dev 端口 7321）
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── components/           # TopBar / LeftPanel / CanvasArea / RightPanel / AssetPickerModal 等
│   │       ├── store/                # editorStore（画布）+ projectStore（配置/agents 状态）
│   │       ├── api/client.ts         # 所有 HTTP 调用集中在此
│   │       └── types/layout.ts       # UI 节点数据模型
│   ├── Dockerfile         # 一体化镜像（backend serve frontend dist）
│   └── screenshots/       # 截图归档
├── runtime/               # C# Runtime（发布到星火工程 src/DjuiRuntime/）
│   ├── DjuiUiLoader.cs        # 主加载器，读 JSON 构建控件树
│   ├── DjuiModels.cs          # 数据模型
│   ├── DjuiBindingSystem.cs   # 数据绑定
│   ├── DjuiActionRouter.cs    # 事件路由
│   ├── DjuiEffectPlayer.cs    # 效果播放器
│   └── DjuiEffectPresets.cs   # 效果预设
├── projects/              # 内置示例工程（导出 JSON 样例）
├── docs/                  # 设计文档
├── 临时区/
├── 代码区/
└── 文档区/
```

## 二、开发工作流

### 启动
```powershell
# 后端（端口 37241，tsx watch 自动重载）
cd editor/backend; npm run dev

# 前端（端口 7321 不常见端口，vite HMR）
cd editor/frontend; npm run dev
```
浏览器打开 `http://localhost:7321`。前端通过 `vite.config.ts` 的 proxy 把 `/api` 转发到后端。

### 类型检查（提交前必跑）
```powershell
cd editor/backend;  npx tsc --noEmit
cd editor/frontend; npx tsc --noEmit
```

### 生产构建
```powershell
cd editor/frontend; npm run build      # 产物在 frontend/dist
cd editor/backend;  npm run build      # 产物在 backend/dist
# 一体化运行：NODE_ENV=production node backend/dist/server.js
# 后端会自动 serve frontend/dist
```

## 三、Runtime 同步

- 源在 `runtime/*.cs`
- 通过 `POST /api/project/init-runtime` 复制到 `<星火工程>/src/DjuiRuntime/`
- 版本号在 `project.ts` 的 `RUNTIME_VERSION` 常量
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
| 后端 API | 37241 | 不常见，`server.ts` 中 `DJUI_PORT` |
| 前端 dev | 7321 | 不常见，避开 Vite 默认 5173 |
| 前端 proxy | - | `/api` → `http://localhost:37241` |

## 七、编码规范

- TypeScript strict，提交前 `npx tsc --noEmit` 必须过
- 后端：Fastify 风格，路由按文件拆分，`register*Routes(app)` 注册
- 前端：React 函数组件 + Zustand store + Antd UI，避免 class 组件
- 中文注释和提示文案；变量/函数名英文
- 文件路径相关代码统一用 `path.join` + `replace(/\\/g, '/')`，跨平台

> 此文件由人工维护，描述工具仓库本身。请随架构演进同步更新。
