# DJUI 工具脚本集

此目录由 DJUI Editor 维护，通过「检查工作区更新」同步到 UI 工作区的「脚本区/」目录。
请勿在工作区内手动修改这些脚本；如需定制，请改 DJUI 仓库本目录的源码。

## 脚本

| 脚本 | 用途 | 何时使用 |
|---|---|---|
| `green_key_to_png.py` | 去绿幕 | 从绿幕背景的 AI 生图/截图抠出前景 |
| `trim_compress.py` | 裁边 + 压缩 | 按分类最大边压缩 PNG，并保留原始比例 |
| `djui-publish.mjs` | 发布到星火工程 | 供 AI 或命令行在不打开网页时检查 Runtime、发布资源或升级 Runtime |

图片加工脚本均为纯 Python + Pillow（除 PIL 外无依赖）；发布器是内置的单文件 Node CLI，无需另行安装 npm 包。

## AI / 命令行发布

在 UI 工作区根目录执行。第一次先记录星火工程目录：

```powershell
node .\脚本区\djui-publish.mjs configure --star-project "D:\\git\\MyStarProject" --json
```

之后 AI 可直接读取 JSON 结果并按退出码处理：

```powershell
node .\脚本区\djui-publish.mjs status --json
node .\脚本区\djui-publish.mjs publish --json
node .\脚本区\djui-publish.mjs upgrade-runtime --json
```

- `publish` 会严格镜像成品素材和页面，目标中已经从 UI 工程删除的文件也会清理。
- Runtime 缺失或过期时，`publish` 会以退出码 `20` 阻止发布，并返回可转述给用户的更新提示；必须先征得用户同意，再单独执行 `upgrade-runtime`。
- 发布规则与 DJUI 网页发布共用同一核心；请勿手改本脚本，编辑器的「检查工作区更新」会同步新版。

## 安装

```bash
pip install pillow
# 可选：更强的 PNG 压缩
# Windows: scoop install oxipng  或  choco install oxipng
# macOS:   brew install oxipng
# Linux:   apt install oxipng  或  cargo install oxipng
```

## 工作流

完整加工流程（详见工作区 AGENTS.md「加工流程」章节）：

```bash
# 1. 去绿幕：原始素材/YYYY-MM-DD/xxx-绿幕/*.png → 临时文件/去绿幕后/
python green_key_to_png.py --input-dir 原始素材/2026-06-28/batch01-绿幕 \
                           --output-dir 临时文件/去绿幕后

# 2. 裁边+压缩：默认按分类最大边等比缩小，不补成正方形画布
python trim_compress.py --input-dir 临时文件/去绿幕后 \
                        --output-dir 临时文件/待审核/icons
# 或显式指定分类
python trim_compress.py --input-dir 临时文件/去绿幕后 \
                        --output-dir 临时文件/待审核/buttons \
                        --category buttons
```

## 分类最大边（trim_compress.py 默认表）

| 分类 | 最大边 | 说明 |
|---|---|---|
| icons | 256 | 小图标可用 `--max-edge 64` 或 `128` 单独输出 |
| buttons | 512 | 保留横长或方形按钮的原比例 |
| backgrounds | 1024 | 背景不超过硬性上限 |
| frames | 512 | 九宫格框保留原比例 |
| lists | 512 | 列表项/卡片保留原比例 |
| decorations | 512 | 插画、花纹、角标保留原比例 |
| text | 512 | 艺术字标题保留原比例 |
| misc | 512 | 未分类素材保留原比例 |

> Apple/Google 移动应用建议：单张贴图 ≤ 1024，UI 元素尽量 ≤ 512，小图标 ≤ 256。
> 详细规则见工作区 AGENTS.md。

只有确实需要统一画布（例如外部系统明确要求方形图标）时，才显式传入 `--width`、`--height` 和可选 `--padding`；该模式不会自动启用。

## 版本

`version.txt` 记录脚本集版本号。DJUI Editor 启动时比较 workspace 脚本区的版本号与本仓库的版本号，
过期则提示更新。
