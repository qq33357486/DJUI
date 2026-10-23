// Runtime 文件是网页安装器和本地发布 CLI 共用的唯一来源。
// CLI 构建脚本会把这些 ?raw 内容内联进脚本区的单文件 .mjs。
import DjuiActionRouter from '../../../../runtime/DjuiActionRouter.cs?raw'
import DjuiAudioSystem from '../../../../runtime/DjuiAudioSystem.cs?raw'
import DjuiBindingSystem from '../../../../runtime/DjuiBindingSystem.cs?raw'
import DjuiEffectPlayer from '../../../../runtime/DjuiEffectPlayer.cs?raw'
import DjuiEffectPresets from '../../../../runtime/DjuiEffectPresets.cs?raw'
import DjuiFlowBorder from '../../../../runtime/DjuiFlowBorder.cs?raw'
import DjuiFx from '../../../../runtime/DjuiFx.cs?raw'
import DjuiFxCore from '../../../../runtime/DjuiFxCore.cs?raw'
import DjuiFxKit from '../../../../runtime/DjuiFxKit.cs?raw'
import DjuiFxSurface from '../../../../runtime/DjuiFxSurface.cs?raw'
import DjuiLayoutArranger from '../../../../runtime/DjuiLayoutArranger.cs?raw'
import DjuiLayoutSolver from '../../../../runtime/DjuiLayoutSolver.cs?raw'
import DjuiCanvasV6 from '../../../../runtime/DjuiCanvasV6.cs?raw'
import DjuiLayoutSessionV6 from '../../../../runtime/DjuiLayoutSessionV6.cs?raw'
import DjuiImageVisualLayerV6 from '../../../../runtime/DjuiImageVisualLayerV6.cs?raw'
import DjuiProgressVisualLayerV6 from '../../../../runtime/DjuiProgressVisualLayerV6.cs?raw'
import DjuiBorderVisualLayerV6 from '../../../../runtime/DjuiBorderVisualLayerV6.cs?raw'
import DjuiButtonStateV6 from '../../../../runtime/DjuiButtonStateV6.cs?raw'
import DjuiTreeBuilderV6 from '../../../../runtime/DjuiTreeBuilderV6.cs?raw'
import DjuiModels from '../../../../runtime/DjuiModels.cs?raw'
import DjuiProtocolV6 from '../../../../runtime/DjuiProtocolV6.cs?raw'
import DjuiResponsiveResolverV6 from '../../../../runtime/DjuiResponsiveResolverV6.cs?raw'
import DjuiTemplateExpanderV6 from '../../../../runtime/DjuiTemplateExpanderV6.cs?raw'
import DjuiTestSupport from '../../../../runtime/DjuiTestSupport.cs?raw'
import DjuiTransitionPlayer from '../../../../runtime/DjuiTransitionPlayer.cs?raw'
import DjuiTransitionRegistry from '../../../../runtime/DjuiTransitionRegistry.cs?raw'
import DjuiUiLoader from '../../../../runtime/DjuiUiLoader.cs?raw'
import DjuiViewportAdapter from '../../../../runtime/DjuiViewportAdapter.cs?raw'
import DjuiWindowManager from '../../../../runtime/DjuiWindowManager.cs?raw'
import DjuiWindowManagerV6 from '../../../../runtime/DjuiWindowManagerV6.cs?raw'
import DjuiWindowTransitionV6 from '../../../../runtime/DjuiWindowTransitionV6.cs?raw'
import runtimeAgentsMd from '../../../../runtime/AGENTS.md?raw'

export const RUNTIME_VERSION = '0.14.0'

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
  { name: 'DjuiFlowBorder.cs', content: DjuiFlowBorder },
  { name: 'DjuiFx.cs', content: DjuiFx },
  { name: 'DjuiFxCore.cs', content: DjuiFxCore },
  { name: 'DjuiFxKit.cs', content: DjuiFxKit },
  { name: 'DjuiFxSurface.cs', content: DjuiFxSurface },
  { name: 'DjuiLayoutArranger.cs', content: DjuiLayoutArranger },
  { name: 'DjuiLayoutSolver.cs', content: DjuiLayoutSolver },
  { name: 'DjuiCanvasV6.cs', content: DjuiCanvasV6 },
  { name: 'DjuiLayoutSessionV6.cs', content: DjuiLayoutSessionV6 },
  { name: 'DjuiImageVisualLayerV6.cs', content: DjuiImageVisualLayerV6 },
  { name: 'DjuiProgressVisualLayerV6.cs', content: DjuiProgressVisualLayerV6 },
  { name: 'DjuiBorderVisualLayerV6.cs', content: DjuiBorderVisualLayerV6 },
  { name: 'DjuiButtonStateV6.cs', content: DjuiButtonStateV6 },
  { name: 'DjuiTreeBuilderV6.cs', content: DjuiTreeBuilderV6 },
  { name: 'DjuiModels.cs', content: DjuiModels },
  { name: 'DjuiProtocolV6.cs', content: DjuiProtocolV6 },
  { name: 'DjuiResponsiveResolverV6.cs', content: DjuiResponsiveResolverV6 },
  { name: 'DjuiTemplateExpanderV6.cs', content: DjuiTemplateExpanderV6 },
  { name: 'DjuiTestSupport.cs', content: DjuiTestSupport },
  { name: 'DjuiTransitionPlayer.cs', content: DjuiTransitionPlayer },
  { name: 'DjuiTransitionRegistry.cs', content: DjuiTransitionRegistry },
  { name: 'DjuiUiLoader.cs', content: DjuiUiLoader },
  { name: 'DjuiViewportAdapter.cs', content: DjuiViewportAdapter },
  { name: 'DjuiWindowManager.cs', content: DjuiWindowManager },
  { name: 'DjuiWindowManagerV6.cs', content: DjuiWindowManagerV6 },
  { name: 'DjuiWindowTransitionV6.cs', content: DjuiWindowTransitionV6 },
  { name: 'AGENTS.md', content: runtimeAgentsMd },
]
