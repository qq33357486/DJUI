import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  // Runtime .cs 和 scripts 作为静态资源打包（用 ?raw 导入原始文本）
  // 见 src/lib/bundledAssets.ts
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react') || id.includes('react-dom')) return 'react'
          if (id.includes('antd') || id.includes('@ant-design')) return 'antd'
          if (id.includes('konva') || id.includes('react-konva')) return 'canvas'
          if (id.includes('zustand') || id.includes('immer')) return 'state'
          return undefined
        },
      },
    },
  },
})
