/**
 * dsh-session-notice 构建：
 *   1. tsc 编译 Host 半（src/*.ts → lib/*.js + d.ts，exclude src/client）；
 *   2. esbuild 打包浏览器半（src/client/index.tsx → lib/client.js），
 *      包装成 window.__ModuleLoader__.load({id, factory}) 格式 —— 与
 *      dsh-auto-collapse / ui-* 包的 tsdown 产物同形，由 dsh-client-modules
 *      的懒 CJS 模块表在浏览器内解析 require。
 *
 * external 的名字必须是 boot graph 的行（@deepseek-ai/dsh-client-ui-slots、
 * dsh-client-connection 已在本 profile 对齐 0.1.5-rc.1）或 seed word（react）。
 */
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '-p', 'tsconfig.json'], { stdio: 'inherit' })

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
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
