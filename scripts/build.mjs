import { build } from 'esbuild'
import { transform } from 'lightningcss'
import { mkdir, readFile, readdir, copyFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'

await build({ entryPoints: ['src/index.ts'], outdir: 'dist', bundle: true, format: 'esm', platform: 'node', target: 'node24',
  packages: 'external', logLevel: 'warning' })
const cssPlugin = {
  name: 'css-modules', setup(b) {
    b.onResolve({ filter: /\.module\.css$/ }, args => ({ path: resolve(args.resolveDir, args.path), namespace: 'css-module' }))
    b.onLoad({ filter: /.*/, namespace: 'css-module' }, async args => {
      const result = transform({ filename: relative(process.cwd(), args.path).replaceAll('\\', '/'), code: await readFile(args.path), cssModules: { pattern: 'dshTools_[hash]_[local]' }, minify: true })
      return { loader: 'js', contents: `export const cssText=${JSON.stringify(result.code.toString())}; export default ${JSON.stringify(Object.fromEntries(Object.entries(result.exports).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, value.name])))};` }
    })
  },
}
const platform = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', 'zod',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives']
await build({ entryPoints: ['src/client/index.ts'], outfile: 'dist/client.js', bundle: true, format: 'cjs', platform: 'browser', target: 'es2024',
  external: platform, plugins: [cssPlugin], define: { 'process.env.NODE_ENV': '"production"' }, minify: true,
  banner: { js: `window.__ModuleLoader__.load({id:"dsh-conversation-tools",factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
  footer: { js: 'return module.exports;}});' }, logLevel: 'warning',
})
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.host.json'], { stdio: 'inherit' })
await mkdir('dist/protocol', { recursive: true })
for (const file of await readdir('src/protocol')) if (/\.(js|ts)$/.test(file)) {
  await copyFile(`src/protocol/${file}`, `dist/protocol/${file}`)
}
console.log('Built independent DSH plugin (host, browser, Remote descriptors, and types).')
