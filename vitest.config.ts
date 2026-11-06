import { defineConfig } from 'vitest/config'
import { transformSync } from 'esbuild'

export default defineConfig({
  // Use the production compiler for the host's standard Remote decorators.
  plugins: [{ name: 'host-decorators', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/host/index.ts')) return transformSync(code, { loader: 'ts', format: 'esm', target: 'node24', sourcemap: 'inline' })
  } }],
  test: { include: ['tests/**/*.spec.ts'] },
})
