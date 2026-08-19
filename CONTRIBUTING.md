# 贡献指南

感谢你愿意改进 DJUI。这个项目同时包含 Web Editor、素材工作流和 StarEngine Runtime，改动时请尽量保持三者协议一致。

## 开发环境

```powershell
cd editor/frontend
npm ci
```

开发启动（纯前端架构，无后端）：

```powershell
npm run dev
```

提交前检查：

```powershell
npx tsc --noEmit
npm run build
```

## 代码风格

- TypeScript 使用 strict，避免 `any` 扩散到公共接口。
- 文件系统访问统一走 `src/fs/` 封装层（File System Access API），新增文件操作优先扩展该层。
- 前端使用 React 函数组件、Zustand store 和 Ant Design。
- 面向用户的 UI 文案使用中文。
- 文件路径统一用正斜杠（`/`）拼接的相对路径，跨平台一致。

## 修改协议时

修改页面 JSON 字段时，通常需要同步：

- `editor/frontend/src/types/protocolV6.ts`（v6 协议与宽屏覆盖白名单）
- `editor/frontend/src/types/layout.ts`（编辑器内部节点模型，若受影响）
- 保存/加载该字段的前端组件
- `runtime/DjuiProtocolV6.cs`（v6 JSON 模型）
- `runtime/DjuiTreeBuilderV6.cs`（v6 应用逻辑）
- `docs/runtime.md`

## 修改 Runtime 时

如果改动 `runtime/*.cs` 的行为或文件列表，请同步提升：

```text
editor/frontend/src/lib/runtimeBundle.ts -> RUNTIME_VERSION
```

并在 `RUNTIME_FILES` 中登记新增文件。这样已安装旧 Runtime 的用户才会在前端看到升级提示。

## 修改工作区 AGENTS 规范时

唯一权威源是：

```text
editor/frontend/src/lib/agentsTemplate.ts
```

改模板内容时必须提升 `AGENTS_VERSION`：

- 小修文案：patch
- 新增分类或流程：minor
- 删除/重命名分类：major

不要把工作区 `AGENTS.md` 的正文复制到其他源码里。

## 修改素材分类时

分类目录必须保持一致：

- `editor/frontend/src/lib/agentsTemplate.ts`
- `editor/frontend/src/api/client.ts` 的 `FINISHED_SUBDIRS`
- `scripts/README.md`

新增图片格式时再同步 `editor/frontend/src/fs/fsAccess.ts` 的 `IMAGE_EXTS`。

## 提交前不要包含

- `node_modules/`
- `dist/`
- `*.tsbuildinfo`
- 真实项目素材、私有路径、临时截图、调试日志

## Issue 建议

报告问题时请附上：

- 操作系统
- Node.js 和 npm 版本
- 前端启动命令
- 报错日志
- 最小复现步骤
- 是否使用 Docker

涉及本机路径时可以脱敏，例如 `D:/game/MyProject` 改成 `D:/path/to/project`。
