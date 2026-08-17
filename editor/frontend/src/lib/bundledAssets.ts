// 打包的静态资源：runtime .cs 文件和 scripts
// Vite 的 ?raw 导入会在构建时把文件内容内联到 JS bundle 中

// runtime .cs 文件
import DjuiActionRouter from '../../../../runtime/DjuiActionRouter.cs?raw'
import DjuiAudioSystem from '../../../../runtime/DjuiAudioSystem.cs?raw'
import DjuiBindingSystem from '../../../../runtime/DjuiBindingSystem.cs?raw'
import DjuiEffectPlayer from '../../../../runtime/DjuiEffectPlayer.cs?raw'
import DjuiEffectPresets from '../../../../runtime/DjuiEffectPresets.cs?raw'
import DjuiLayoutSolver from '../../../../runtime/DjuiLayoutSolver.cs?raw'
import DjuiCanvasV6 from '../../../../runtime/DjuiCanvasV6.cs?raw'
import DjuiLayoutSessionV6 from '../../../../runtime/DjuiLayoutSessionV6.cs?raw'
import DjuiImageVisualLayerV6 from '../../../../runtime/DjuiImageVisualLayerV6.cs?raw'
import DjuiTreeBuilderV6 from '../../../../runtime/DjuiTreeBuilderV6.cs?raw'
import DjuiModels from '../../../../runtime/DjuiModels.cs?raw'
import DjuiProtocolV6 from '../../../../runtime/DjuiProtocolV6.cs?raw'
import DjuiResponsiveResolverV6 from '../../../../runtime/DjuiResponsiveResolverV6.cs?raw'
import DjuiTemplateExpanderV6 from '../../../../runtime/DjuiTemplateExpanderV6.cs?raw'
import DjuiTransitionPlayer from '../../../../runtime/DjuiTransitionPlayer.cs?raw'
import DjuiTransitionRegistry from '../../../../runtime/DjuiTransitionRegistry.cs?raw'
import DjuiUiLoader from '../../../../runtime/DjuiUiLoader.cs?raw'
import DjuiViewportAdapter from '../../../../runtime/DjuiViewportAdapter.cs?raw'
import DjuiWindowManager from '../../../../runtime/DjuiWindowManager.cs?raw'
import DjuiWindowManagerV6 from '../../../../runtime/DjuiWindowManagerV6.cs?raw'

// runtime 附带文档（部署契约，随 Runtime 分发）
import runtimeAgentsMd from '../../../../runtime/AGENTS.md?raw'

// scripts 文件
import greenKeyToPng from '../../../../scripts/green_key_to_png.py?raw'
import trimCompress from '../../../../scripts/trim_compress.py?raw'
import scriptsReadme from '../../../../scripts/README.md?raw'
import scriptsVersion from '../../../../scripts/version.txt?raw'

export const RUNTIME_VERSION = '0.7.13'

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
  { name: 'DjuiCanvasV6.cs', content: DjuiCanvasV6 },
  { name: 'DjuiLayoutSessionV6.cs', content: DjuiLayoutSessionV6 },
  { name: 'DjuiImageVisualLayerV6.cs', content: DjuiImageVisualLayerV6 },
  { name: 'DjuiTreeBuilderV6.cs', content: DjuiTreeBuilderV6 },
  { name: 'DjuiModels.cs', content: DjuiModels },
  { name: 'DjuiProtocolV6.cs', content: DjuiProtocolV6 },
  { name: 'DjuiResponsiveResolverV6.cs', content: DjuiResponsiveResolverV6 },
  { name: 'DjuiTemplateExpanderV6.cs', content: DjuiTemplateExpanderV6 },
  { name: 'DjuiTransitionPlayer.cs', content: DjuiTransitionPlayer },
  { name: 'DjuiTransitionRegistry.cs', content: DjuiTransitionRegistry },
  { name: 'DjuiUiLoader.cs', content: DjuiUiLoader },
  { name: 'DjuiViewportAdapter.cs', content: DjuiViewportAdapter },
  { name: 'DjuiWindowManager.cs', content: DjuiWindowManager },
  { name: 'DjuiWindowManagerV6.cs', content: DjuiWindowManagerV6 },
  { name: 'AGENTS.md', content: runtimeAgentsMd },
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
