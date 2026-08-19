// 打包的静态资源：runtime .cs 文件和 scripts
// Vite 的 ?raw 导入会在构建时把文件内容内联到 JS bundle 中

export { RUNTIME_FILES, RUNTIME_VERSION, type BundledRuntimeFile } from './runtimeBundle'
import { RUNTIME_VERSION } from './runtimeBundle'

// scripts 文件
import greenKeyToPng from '../../../../scripts/green_key_to_png.py?raw'
import trimCompress from '../../../../scripts/trim_compress.py?raw'
import djuiPublish from '../../../../scripts/djui-publish.mjs?raw'
import scriptsReadme from '../../../../scripts/README.md?raw'
import scriptsVersion from '../../../../scripts/version.txt?raw'

export interface BundledScriptFile {
  path: string
  content: string
}

export const SCRIPT_FILES: BundledScriptFile[] = [
  { path: 'green_key_to_png.py', content: greenKeyToPng },
  { path: 'trim_compress.py', content: trimCompress },
  { path: 'djui-publish.mjs', content: djuiPublish },
  { path: 'README.md', content: scriptsReadme },
]

// scripts/version.txt 只维护素材脚本部分（green_key_to_png.py 等）；
// 发布器 djui-publish.mjs 内嵌整套 Runtime，其版本必须跟随 RUNTIME_VERSION 派生，
// 否则只升 RUNTIME_VERSION 时工作区 CLI 仍携旧版且网页无从提醒（0.2.1 版曾因此翻车）。
export const SCRIPTS_VERSION = `${scriptsVersion.trim()}+rt${RUNTIME_VERSION}`
