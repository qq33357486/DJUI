# 素材与 AI 工作流

DJUI 推荐把 UI 素材分成三层：原始素材、临时文件、成品素材。只有成品素材会被发布到 StarEngine 工程。

## 标准流程

```text
原始素材/
  -> 临时文件/去绿幕后/
  -> 临时文件/待审核/<分类>/
  -> 成品素材/<分类>/
  -> 发布到 StarEngine 工程/ui/image/djui/
```

## 目录职责

| 目录 | 用途 | 是否发布 |
|---|---|---|
| `原始素材/` | AI 生图、设计稿、截图、PSD、参考图 | 否 |
| `临时文件/` | 去绿幕、裁边、压缩后的中间产物 | 否 |
| `临时文件/待审核/` | 等待人工确认的候选成品 | 否 |
| `成品素材/` | 已审核、可被页面引用的最终素材 | 是 |
| `脚本区/` | DJUI 同步的素材处理脚本 | 否 |

## 成品素材分类

成品素材必须放到以下分类之一：

| 分类 | 用途 |
|---|---|
| `backgrounds/` | 全屏背景、分区大背景、面板底图 |
| `buttons/` | 按钮 normal/pressed/disabled/hover 状态 |
| `frames/` | 对话框外框、九宫格切片框 |
| `icons/` | 功能图标、道具图标、货币图标、头像 |
| `lists/` | 列表行背景、商品卡、技能卡底图 |
| `decorations/` | 光效、花纹、角标、非交互装饰 |
| `text/` | 艺术字标题、Logo、装饰性数字 |
| `misc/` | 临时无法归类的素材 |

命名建议：

```text
icons/icon_coin_256.png
buttons/btn_confirm_normal.png
buttons/btn_confirm_pressed.png
frames/frame_dialog.png
backgrounds/bg_main_menu.png
```

## 用脚本处理 AI 素材

安装 Pillow：

```powershell
pip install pillow
```

去绿幕：

```powershell
cd UI工作区/脚本区
python green_key_to_png.py `
  --input-dir ../原始素材/2026-06-28/batch01 `
  --output-dir ../临时文件/去绿幕后
```

裁边、压缩并输出到待审核目录：

```powershell
python trim_compress.py `
  --input-dir ../临时文件/去绿幕后 `
  --output-dir ../临时文件/待审核/icons `
  --category icons
```

随后在 DJUI 顶部菜单「发布 → 待审核素材」里逐张确认：

- 批准：移动到 `成品素材/<分类>/`
- 拒绝：删除候选文件

## 给 AI 的工作提示

UI 工作区根目录的 `AGENTS.md` 是给 AI 协作使用的素材规范。DJUI 会维护这个文件的版本，规范更新时可在顶部菜单「帮助 → 检查工作区更新」同步。

让 AI 生成素材时，可以直接要求：

```text
请阅读 UI 工作区 AGENTS.md。
把原始素材加工成 icons 分类的待审核素材。
输出到 临时文件/待审核/icons，不要直接写入 成品素材。
```

这样可以把“AI 批量产出”和“人工最终审核”分开，减少错误素材直接进入游戏包。
