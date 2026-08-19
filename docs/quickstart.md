# 快速开始

本文从零说明如何把 DJUI 接到一个 StarEngine 2.0 工程里。

## 1. 准备目录

建议把游戏工程和 UI 工作区分开：

```text
StarEngine 工程/
UI 工作区/
```

UI 工作区由 DJUI 初始化，初始化后会生成：

```text
UI 工作区/
├── AGENTS.md
├── 原始素材/
├── 成品素材/
├── 临时文件/
├── 文档/
└── 脚本区/
```

## 2. 启动编辑器

安装并启动（纯前端架构，无后端）：

```powershell
cd editor/frontend
npm ci
npm run dev
```

打开 `http://localhost:7321`。

## 3. 初始化工程

首次进入会弹出「工程配置」：

1. 选择 StarEngine 2.0 工程根目录。
2. 选择或新建 UI 工作区目录。
3. 选择横屏/竖屏和设计分辨率。
4. 点击「初始化 / 升级」，把 `runtime/*.cs` 复制到 StarEngine 工程的 `src/DjuiRuntime/`。
5. 点击「初始化工作区」，创建素材目录、`AGENTS.md` 和脚本区。
6. 保存配置。

工程目录授权由浏览器记住，最近工程列表保存在浏览器本地，不会产生本机配置文件。

## 4. 创建页面

在左侧面板新建页面：

- **窗口**：运行时可通过 `DjuiWindowManagerV6.OpenWindow("page_id")` 打开。
- **模板**：可在其他页面中作为可复用控件引用。

编辑时建议：

- 页面 ID 使用小写英文、数字、下划线或短横线。
- 素材路径来自 `成品素材/`。
- 保存页面后，JSON 会写入 UI 工作区的 `.djui/layout/pages/`。星火工程中的副本由「发布」生成，不作为编辑源。

## 5. 配置点击音效（可选）

DJUI 的音效只引用 StarEngine 数编里已经创建好的 `GameDataSound`：

1. 先在 StarEngine 数据编辑器里创建 `GameDataSound`，并确认 `Asset` 指向正确的 `sound/...`。
2. 在 DJUI 顶部菜单打开「编辑 → 声音配置」。
3. 从已创建的 `GameDataSound` 列表中添加 DJUI 音效项，并选择允许使用的控件类型。
4. 选中画布控件，在右侧「反馈效果 → 点击音效」里选择音效。

## 6. 发布到 StarEngine 工程

点击顶部菜单「发布 → 发布到星火工程」。发布会同步：

```text
UI 工作区/成品素材/*        -> StarEngine 工程/ui/image/djui/*
UI 工作区/.djui/layout/pages/* -> StarEngine 工程/ui/djui/pages/*
UI 工作区/.djui/layout/pages/* -> StarEngine 工程/ui/AppBundle/user_files/djui/pages/*
UI 工作区/.djui/layout/project.json -> StarEngine 工程/ui/djui/project.json 与 ui/AppBundle/user_files/djui/project.json
UI 工作区/.djui/layout/sounds.json -> StarEngine 工程/ui/djui/sounds.json 与 ui/AppBundle/user_files/djui/sounds.json
```

发布前请关闭正在占用资源的游戏进程，避免 Windows 文件锁导致复制失败。

## 7. 运行时打开窗口

在 StarEngine 客户端初始化时调用：

```csharp
DjuiRuntime.DjuiWindowManagerV6.Initialize();
```

需要打开页面时：

```csharp
DjuiRuntime.DjuiWindowManagerV6.OpenWindow("main_menu");
```

关闭窗口：

```csharp
DjuiRuntime.DjuiWindowManagerV6.CloseWindow("main_menu");
```

更多 Runtime API 见 [Runtime 接入](runtime.md)。
