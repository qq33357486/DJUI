// 特效 shader 依赖的引擎头文件（取自引擎 shaders/9 的明文副本）。
// 官方暂无自动检索头的方案：工程里缺头时星火编辑器编译 .glsl 会直接报错、无法调试。
// 发布时按「缺则补、有则不管」放进星火工程，不覆盖已有文件。
import urho3dCompatibility from '../../../../shader-headers/BLGL/urho3d_compatibility.sh?raw'
import uniforms from '../../../../shader-headers/BLGL/uniforms.sh?raw'
import samplers from '../../../../shader-headers/BLGL/samplers.sh?raw'
import transform from '../../../../shader-headers/BLGL/transform.sh?raw'
import common from '../../../../shader-headers/BLGL/Common/common.sh?raw'
import bgfxShader from '../../../../shader-headers/BLGL/Common/bgfx_shader.sh?raw'
import debuglib from '../../../../shader-headers/BLGL/Common/debuglib.sh?raw'
import shaderlib from '../../../../shader-headers/BLGL/Common/shaderlib.sh?raw'

export const SHADER_HEADERS_DIR = 'res/Shaders/BLGL'
/** 版本标记文件：记录头的来源版本，官方变动后据此区分「DJUI 放的旧头」与用户自己的头 */
export const SHADER_HEADERS_MARKER = '.djui-headers-version'
export const SHADER_HEADERS_VERSION = '1 (engine shaders/9)'

export interface BundledShaderHeader {
  /** 相对 SHADER_HEADERS_DIR 的路径 */
  path: string
  content: string
}

export const SHADER_HEADERS: BundledShaderHeader[] = [
  { path: 'urho3d_compatibility.sh', content: urho3dCompatibility },
  { path: 'uniforms.sh', content: uniforms },
  { path: 'samplers.sh', content: samplers },
  { path: 'transform.sh', content: transform },
  { path: 'Common/common.sh', content: common },
  { path: 'Common/bgfx_shader.sh', content: bgfxShader },
  { path: 'Common/debuglib.sh', content: debuglib },
  { path: 'Common/shaderlib.sh', content: shaderlib },
]
