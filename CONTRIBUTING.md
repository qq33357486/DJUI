# 贡献指南

感谢你愿意改进 DJUI。这个项目同时包含 Web Editor、素材工作流和 StarEngine Runtime，改动时请尽量保持三者协议一致。

## 开发环境

```powershell
cd editor/backend
npm ci

cd ../frontend
npm ci
```

开发启动：

```powershell
npm run dev:backend
npm run dev:frontend
```

提交前检查：

```powershell
npm run typecheck
npm run build
```

## 代码风格

- TypeScript 使用 strict，避免 `any` 扩散到公共接口。
- 后端使用 Fastify 路由拆分，新增 API 优先放到对应 `routes/*.ts`。
- 前端使用 React 函数组件、Zustand store 和 Ant Design。
- 面向用户的 UI 文案使用中文。
- 文件路径统一用 `path.join` / `path.resolve`，返回给前端的相对路径统一转 `/`。

## 修改协议时

修改页面 JSON 字段时，通常需要同步：

- `editor/frontend/src/types/layout.ts`
- 保存/加载该字段的前端组件
- `runtime/DjuiModels.cs`
- `runtime/DjuiUiLoader.cs`
- `docs/runtime.md`

## 修改 Runtime 时

如果改动 `runtime/*.cs` 的行为或文件列表，请同步提升：

```text
editor/backend/src/routes/project.ts -> RUNTIME_VERSION
```

这样已安装旧 Runtime 的用户才会在前端看到升级提示。

## 修改工作区 AGENTS 规范时

唯一权威源是：

```text
editor/backend/src/agentsTemplate.ts
```

改模板内容时必须提升 `AGENTS_VERSION`：

- 小修文案：patch
- 新增分类或流程：minor
- 删除/重命名分类：major

不要把工作区 `AGENTS.md` 的正文复制到其他源码里。

## 修改素材分类时

分类目录必须保持一致：

- `editor/backend/src/agentsTemplate.ts`
- `editor/backend/src/routes/project.ts` 的 `FINISHED_SUBDIRS`
- `scripts/README.md`

新增图片格式时再同步 `editor/backend/src/routes/assets.ts` 的 `IMAGE_EXTS`。

## 提交前不要包含

- `editor/backend/djui_config.json`
- `node_modules/`
- `dist/`
- `*.tsbuildinfo`
- 真实项目素材、私有路径、临时截图、调试日志

## Issue 建议

报告问题时请附上：

- 操作系统
- Node.js 和 npm 版本
- 前后端启动命令
- 报错日志
- 最小复现步骤
- 是否使用 Docker

涉及本机路径时可以脱敏，例如 `D:/game/MyProject` 改成 `D:/path/to/project`。
