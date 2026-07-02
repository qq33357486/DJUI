# 发布检查清单

在把 DJUI 推到公开 Git 仓库前，建议逐项确认。

## 代码与构建

- [ ] `npm run typecheck` 通过。
- [ ] `npm run build` 通过。
- [ ] `editor/backend/djui_config.json` 不在提交列表中。
- [ ] `node_modules/`、`dist/`、`*.tsbuildinfo` 不在提交列表中。
- [ ] Docker 镜像可从仓库根目录构建：

```powershell
docker build -f editor/Dockerfile -t djui-editor .
```

## 功能冒烟

- [ ] 后端可启动：`cd editor/backend; npm run dev`
- [ ] 前端可启动：`cd editor/frontend; npm run dev`
- [ ] 浏览器可打开 `http://localhost:7321`
- [ ] 可选择 StarEngine 工程目录。
- [ ] 可初始化 Runtime。
- [ ] 可初始化 UI 工作区。
- [ ] 可新建页面并保存。
- [ ] 可读取 StarEngine 工程中已创建的 `GameDataSound`。
- [ ] 可创建 DJUI 声音配置，并在控件右侧属性选择点击音效。
- [ ] 可把成品素材和页面发布到 StarEngine 工程。
- [ ] 发布后 `sounds.json` 同步到 `user_files/djui/`。
- [ ] StarEngine 客户端可调用 `DjuiWindowManager.Initialize()`。
- [ ] StarEngine 客户端可调用 `DjuiWindowManager.OpenWindow("页面ID")`。

## 文档

- [ ] README 能让第一次看到项目的人完成安装和启动。
- [ ] `docs/quickstart.md` 与当前 UI 文案一致。
- [ ] `docs/workflow.md` 与工作区 `AGENTS.md` 的分类和流程一致。
- [ ] 修改 Runtime 时同步更新 `docs/runtime.md`。
- [ ] 修改安全默认值时同步更新 `docs/security.md`。

## 版本同步

- [ ] 改 `runtime/*.cs` 后提升 `RUNTIME_VERSION`。
- [ ] 改工作区 `AGENTS.md` 模板后提升 `AGENTS_VERSION`。
- [ ] 改 `scripts/` 后提升 `scripts/version.txt`。
- [ ] 修改素材分类时同步：
  - `editor/backend/src/agentsTemplate.ts`
  - `editor/backend/src/routes/project.ts` 的 `FINISHED_SUBDIRS`
  - `editor/backend/src/routes/assets.ts` 的 `IMAGE_EXTS`（仅新增图片格式时）

## 安全和仓库卫生

- [ ] 没有真实本机路径、密钥、Token、私有服务器地址。
- [ ] 没有临时截图、调试日志、旧需求草稿进入提交。
- [ ] 默认监听仍是 `127.0.0.1`。
- [ ] CORS 没有默认放开 `*`。
- [ ] 删除/覆盖目录的逻辑只操作用户明确选择的项目目录或工作区目录。
