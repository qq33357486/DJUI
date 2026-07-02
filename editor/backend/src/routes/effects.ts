import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'

const DEFAULT_PRESETS = [
  { id: 'button_default', category: '组合', label: '标准按钮', desc: '按压+悬停' },
  { id: 'press_scale_92', category: '按压', label: '按压 0.92', desc: '轻按缩放' },
  { id: 'press_scale_85_bounce', category: '按压', label: '重按+弹回', desc: '缩到0.85' },
  { id: 'hover_scale_105', category: '悬停', label: '悬停 1.05', desc: '悬停放大' },
  { id: 'fade_in', category: '出现', label: '淡入', desc: '透明度渐显' },
  { id: 'fade_out', category: '消失', label: '淡出', desc: '透明度渐隐' },
  { id: 'scale_in', category: '出现', label: '缩放出现', desc: 'Scale 0→1' },
  { id: 'slide_in_bottom', category: '出现', label: '底部滑入', desc: '从下滑入' },
  { id: 'loop_pulse', category: '循环', label: '脉冲', desc: '持续缩放' },
  { id: 'loop_floating', category: '循环', label: '浮动', desc: '上下浮动' },
]

export async function registerEffectRoutes(app: FastifyInstance) {
  // 获取动效预设清单
  app.get('/api/effects/presets', async () => {
    // 尝试从工程目录读取 manifest
    const configPath = path.resolve(process.cwd(), 'djui_config.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const manifestPath = config.effectManifestPath
      if (manifestPath && fs.existsSync(manifestPath)) {
        try {
          return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
        } catch { /* fall through */ }
      }
    }
    return DEFAULT_PRESETS
  })
}
