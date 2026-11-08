/**
 * dsh-session-notice 构建：
 *   1. tsc 编译 Host 半（src/*.ts → lib/*.js + d.ts，exclude src/client）；
 *   2. esbuild 打包浏览器半（src/client/index.tsx → lib/client.js），
 *      包装成 window.__ModuleLoader__.load({id, factory}) 格式 —— 与
 *      dsh-auto-collapse / ui-* 包的 tsdown 产物同形，由 dsh-client-modules
 *      的懒 CJS 模块表在浏览器内解析 require。
 *
 * external 的名字必须是 client boot graph 的模块表行：dsh 0.2.2 的基线 externals
 * 已含 react / react/jsx-runtime / react-dom 与平台包名；本产物实际只 require
 * react 与 react/jsx-runtime（见 lib/client.js 里的 require 规格串），因此
 * package.json 的 dsh.client 无需声明 external。（inject 则是 bundle 物化的到达
 * 顺序声明，与 external 是两回事，详见 package.json 的 dsh.client 与
 * src/client/index.tsx 顶部注释。）
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * 直接跑本地 typescript 的 JS 入口，不经 npx：
 * Node ≥ 24 在 Windows 上 spawnSync('.cmd')（如 npx.cmd）报 EINVAL（要求 shell），
 * 而 npx 本身也只是转发一层；解析包内 bin/tsc 后交给当前 node 执行，跨平台一致。
 */
const require = createRequire(import.meta.url)
const projectDir = dirname(fileURLToPath(import.meta.url))
let tscBin
try {
  tscBin = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
} catch {
  tscBin = join(projectDir, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tscBin)) throw new Error('build: 未找到 typescript/bin/tsc，请先 npm install')
}
const tsc = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.json'], { stdio: 'inherit', cwd: projectDir })
if (tsc.status !== 0) throw new Error('build: tsc 失败（exit ' + tsc.status + '）')

// entryPoints / outfile 用基于本文件的**绝对路径**：esbuild 的相对路径按
// process.cwd() 解析，直接 `node /abs/path/build.mjs` 从别的目录调用时会解析错
// （Windows 上跨盘符 process.chdir 还会失败），绝对路径彻底消除这个依赖。
await build({
  entryPoints: [join(projectDir, 'src', 'client', 'index.tsx')],
  outfile: join(projectDir, 'lib', 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2022',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/*'],
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-session-notice",factory:function(require){var module={exports:{}};var exports=module.exports;Object.defineProperty(exports,Symbol.toStringTag,{value:"Module"});',
  },
  footer: {
    js: 'return module.exports;}});',
  },
  logLevel: 'info',
})

console.log('build: lib/ (host) + lib/client.js (browser) OK')
