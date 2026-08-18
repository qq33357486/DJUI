import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawPlugin = {
  name: 'raw-import',
  setup(buildApi) {
    buildApi.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    buildApi.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }))
  },
}

await build({
  absWorkingDir: frontendRoot,
  entryPoints: ['src/cli/djui-publish.ts'],
  outfile: '../../scripts/djui-publish.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  plugins: [rawPlugin],
  banner: { js: '// 此文件由 DJUI 构建生成；请勿在 UI 工作区手动编辑。' },
})
