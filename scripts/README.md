# DJUI 工具脚本集

此目录由 DJUI Editor 维护，通过「检查工作区更新」同步到 UI 工作区的「脚本区/」目录。
请勿在工作区内手动修改这些脚本；如需定制，请改 DJUI 仓库本目录的源码。

## 脚本

| 脚本 | 用途 | 何时使用 |
|---|---|---|
| `green_key_to_png.py` | 去绿幕 | 从绿幕背景的 AI 生图/截图抠出前景 |
| `trim_compress.py` | 裁边 + 压缩 | 把任意 PNG 规范化为符合 DJUI 分类尺寸的待审核素材 |

两个脚本都是纯 Python + Pillow，无第三方依赖（除 PIL）。

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

# 2. 裁边+压缩+规范化尺寸：临时文件/去绿幕后/*.png → 临时文件/待审核/<分类>/
#    通过目录名自动推断分类目标尺寸，随后在 DJUI 的「待审核素材」面板批准入库
python trim_compress.py --input-dir 临时文件/去绿幕后 \
                        --output-dir 临时文件/待审核/icons
# 或显式指定分类
python trim_compress.py --input-dir 临时文件/去绿幕后 \
                        --output-dir 临时文件/待审核/buttons \
                        --category buttons
```

## 分类目标尺寸（trim_compress.py 默认表）

| 分类 | 目标尺寸 | padding | 说明 |
|---|---|---|---|
| icons | 256×256 | 32 | 小图标可二次输出 64/128 版本 |
| buttons | 512×128 | 24 | 横长按钮；方按钮请用 256×256 |
| backgrounds | 1024×1024 | 0 | 全屏背景按 9:16 或 16:9 |
| frames | 256×256 | 16 | 九宫格切片框 |
| lists | 512×256 | 24 | 列表项/卡片 |
| decorations | 256×256 | 16 | 装饰物 |
| text | 512×256 | 16 | 艺术字标题 |
| misc | 512×512 | 24 | 未分类 |

> Apple/Google 移动应用建议：单张贴图 ≤ 1024，UI 元素尽量 ≤ 512，小图标 ≤ 256。
> 详细规则见工作区 AGENTS.md。

## 版本

`version.txt` 记录脚本集版本号。DJUI Editor 启动时比较 workspace 脚本区的版本号与本仓库的版本号，
过期则提示更新。
