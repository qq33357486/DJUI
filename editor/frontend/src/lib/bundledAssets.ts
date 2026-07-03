// 打包的静态资源：runtime .cs 文件和 scripts
// Vite 的 ?raw 导入会在构建时把文件内容内联到 JS bundle 中

// runtime .cs 文件
import DjuiActionRouter from '../../../../runtime/DjuiActionRouter.cs?raw'
import DjuiAudioSystem from '../../../../runtime/DjuiAudioSystem.cs?raw'
import DjuiBindingSystem from '../../../../runtime/DjuiBindingSystem.cs?raw'
import DjuiEffectPlayer from '../../../../runtime/DjuiEffectPlayer.cs?raw'
import DjuiEffectPresets from '../../../../runtime/DjuiEffectPresets.cs?raw'
import DjuiLayoutSolver from '../../../../runtime/DjuiLayoutSolver.cs?raw'
import DjuiModels from '../../../../runtime/DjuiModels.cs?raw'
import DjuiTransitionPlayer from '../../../../runtime/DjuiTransitionPlayer.cs?raw'
import DjuiTransitionRegistry from '../../../../runtime/DjuiTransitionRegistry.cs?raw'
import DjuiUiLoader from '../../../../runtime/DjuiUiLoader.cs?raw'
import DjuiViewportAdapter from '../../../../runtime/DjuiViewportAdapter.cs?raw'
import DjuiWindowManager from '../../../../runtime/DjuiWindowManager.cs?raw'

// scripts 文件
import greenKeyToPng from '../../../../scripts/green_key_to_png.py?raw'
import trimCompress from '../../../../scripts/trim_compress.py?raw'
import scriptsReadme from '../../../../scripts/README.md?raw'
import scriptsVersion from '../../../../scripts/version.txt?raw'

export const RUNTIME_VERSION = '0.3.1'

export interface BundledRuntimeFile {
  name: string
  content: string
}

export const RUNTIME_FILES: BundledRuntimeFile[] = [
  { name: 'DjuiActionRouter.cs', content: DjuiActionRouter },
  { name: 'DjuiAudioSystem.cs', content: DjuiAudioSystem },
  { name: 'DjuiBindingSystem.cs', content: DjuiBindingSystem },
  { name: 'DjuiEffectPlayer.cs', content: DjuiEffectPlayer },
  { name: 'DjuiEffectPresets.cs', content: DjuiEffectPresets },
  { name: 'DjuiLayoutSolver.cs', content: DjuiLayoutSolver },
  { name: 'DjuiModels.cs', content: DjuiModels },
  { name: 'DjuiTransitionPlayer.cs', content: DjuiTransitionPlayer },
  { name: 'DjuiTransitionRegistry.cs', content: DjuiTransitionRegistry },
  { name: 'DjuiUiLoader.cs', content: DjuiUiLoader },
  { name: 'DjuiViewportAdapter.cs', content: DjuiViewportAdapter },
  { name: 'DjuiWindowManager.cs', content: DjuiWindowManager },
]

export interface BundledScriptFile {
  path: string
  content: string
}

export const SCRIPT_FILES: BundledScriptFile[] = [
  { path: 'green_key_to_png.py', content: greenKeyToPng },
  { path: 'trim_compress.py', content: trimCompress },
  { path: 'README.md', content: scriptsReadme },
]

export const SCRIPTS_VERSION = scriptsVersion.trim()
