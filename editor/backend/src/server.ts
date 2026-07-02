import Fastify from 'fastify'
import cors from '@fastify/cors'
import { fileURLToPath } from 'url'
import path, { dirname } from 'path'
import { registerProjectRoutes } from './routes/project.js'
import { registerPageRoutes } from './routes/pages.js'
import { registerAssetRoutes } from './routes/assets.js'
import { registerEffectRoutes } from './routes/effects.js'
import { registerSoundRoutes } from './routes/sounds.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 不常见端口，降低冲突概率
const PORT = Number(process.env.DJUI_PORT ?? 37241)
// 默认只监听本机，避免把目录浏览和本地文件接口暴露到局域网。
// 如确实需要远程访问，可显式设置 DJUI_HOST=0.0.0.0。
const HOST = process.env.DJUI_HOST ?? '127.0.0.1'

function parseExtraCorsOrigins(): Set<string> {
  return new Set(
    (process.env.DJUI_CORS_ORIGIN ?? '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
  )
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function isAllowedOrigin(origin: string, extraOrigins: Set<string>): boolean {
  if (isLocalOrigin(origin)) return true
  if (extraOrigins.has(origin)) return true
  return extraOrigins.has('*')
}

async function main() {
  const app = Fastify({ logger: true })
  const extraCorsOrigins = parseExtraCorsOrigins()

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || isAllowedOrigin(origin, extraCorsOrigins)) {
        cb(null, true)
        return
      }
      cb(null, false)
    },
  })

  // API 路由
  await registerProjectRoutes(app)
  await registerPageRoutes(app)
  await registerAssetRoutes(app)
  await registerEffectRoutes(app)
  await registerSoundRoutes(app)

  // 静态文件（生产模式 serve 前端 build）
  if (process.env.NODE_ENV === 'production') {
    const { default: fastifyStatic } = await import('@fastify/static')
    const frontendDist = path.resolve(__dirname, '../../frontend/dist')
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    })
    app.setNotFoundHandler((req, reply) => {
      reply.sendFile('index.html')
    })
  }

  try {
    await app.listen({ port: PORT, host: HOST })
    app.log.info(`DJUI Editor backend running on http://${HOST}:${PORT}`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      app.log.error(`DJUI 端口 ${PORT} 已被占用。请关闭占用进程，或设置 DJUI_PORT 使用其他端口。`)
    }
    app.log.error(err)
    process.exit(1)
  }
}

main()
