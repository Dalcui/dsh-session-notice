/**
 * dsh-session-notice —— 浏览器半入口。
 *
 * 注册两处 UI，数据全部走 Host 自建的 HTTP 路由（信任判定见 rpc.ts trustedRequest）
 * （/plugins/dsh-session-notice/*，见 Host 半 rpc.ts；不再用 connection.rpc，
 * 因为该 API 在 0.1.5-rc.1 web profile 上会因 webServer 注入时序崩溃）。
 *  1. `plugins.bundle.config`（key = npm 包名 'dsh-session-notice'）——
 *     插件管理页本 bundle 详情页里的配置区（server/key/group + 三步连通测试）。
 *     dsh-settings 0.1.7 移除了 `settings.plugin.item`，插件配置入口统一改为
 *     插件管理页的 bundle/row 配置 slot；
 *  2. `conversation.session.header.utilities`（id 'bark-notify-toggle'）——
 *     会话头部常驻切换按钮，绑定当前会话（standardProps 提供 sessionId）。
 * @module dsh-session-notice/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only：ctx.slots 的类型由 @deepseek-ai/dsh-client-ui-renderer 声明
// （lib/types/client/index.d.ts 的 declare module '@deepseek-ai/cordis'）。
// 旧写法 import type {} from 'dsh-client-ui-slots' 是**无效占位**：该包全套
// .d.ts 里并没有 declare module '@deepseek-ai/cordis'，ctx.slots 根本不会由此
// 获得 —— 直到本轮加入 client 半 typecheck 才暴露（此前 tsconfig exclude 了
// src/client，这个文件从未被检查过）。type-only import 会被擦除，不产生模块请求，
// 也**不需要**写进 dsh.client.inject（inject 只影响 bundle 物化顺序）。0.2.2 起
// inject 从 ui-slots 改指 ui-renderer：ui-slots 已不是 boot graph 的运行时行
// （退为 shell seed word），留在 inject 里永不生效；ui-renderer 是 slots 的
// 运行时提供方且 immediately 预加载，指向它才是一条真实有效的到达顺序声明。
// 下面三个 ./client 子路径只拉类型：SlotMap 是各宿主包用 declare module
// '@deepseek-ai/cordis' 逐个合并的，本插件用到的两个 slot 名分属不同宿主 ——
// 缺了任何一个，SlotMap 里就没有对应 key，typecheck 会报
// '"plugins.bundle.config" is not assignable to "root"'。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

import { BarkPluginCard, type RpcCall } from './BarkPluginCard'
import { ToggleButton } from './ToggleButton'

/**
 * 与 Host 侧 rpc.ts 一致的路由前缀。
 *
 * 命名空间耦合（0.2.2 复核）：`/plugins` 同时是 dsh-client-modules 的
 * **prefix 路由**（PLUGIN_ROUTE，服务 `plugins/??<pkg>/client.js` 这类
 * bundle/asset 请求）。本插件的 4 条是 **exact 路由**，而 dsh-host-webserver
 * 的匹配顺序是 exact → 最长 prefix → fallback，因此 exact 恒胜、互不抢占
 * （已在 0.2.2-rc.1 隔离实例实测：`/state` 回本插件 JSON，
 * `plugins/??dsh-session-notice/client.js&rev=…` 仍由 client-modules 服务）。
 * 若哪天部署改成子路径前缀，或上游把这些 asset 请求改成与本项目同名的 exact
 * 路径，就需要把 RPC 迁到自有顶层命名空间（同 profile 里 dsh-service-status
 * 用 `/dsh-service-status` 的做法）。
 */
export const ROUTE_PREFIX = '/plugins/dsh-session-notice'

/** 必需服务：仅 slots（HTTP 走原生 fetch，不需要 connection 服务）。 */
export const inject = ['slots'] as const

/** 浏览器插件入口。 */
export function apply(ctx: Context): void {
  // 统一 RPC：GET /state、POST /set|/toggle|/test；返回 { ok, value?, message? }。
  const rpc: RpcCall = async (endpoint, payload) => {
    try {
      const isGet = endpoint === 'state'
      const response = await fetch(`${ROUTE_PREFIX}/${endpoint}`, {
        method: isGet ? 'GET' : 'POST',
        headers: isGet ? undefined : { 'Content-Type': 'application/json' },
        body: isGet ? undefined : JSON.stringify(payload ?? {}),
      })
      const body = (await response.json()) as { ok?: boolean; value?: unknown; message?: string }
      if (body.ok === true) return { ok: true, value: body.value }
      return { ok: false, error: { message: body.message ?? `HTTP ${response.status}` } }
    } catch (error) {
      return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
    }
  }

  // 插件管理页本 bundle 的配置区：key = npm 包名（与 Host 侧 entry id 无关）。
  ctx.slots.inject('plugins.bundle.config', () =>
    ctx.slots.register(
      {
        name: 'plugins.bundle.config',
        key: 'dsh-session-notice',
        inject: () => ({ rpc }),
      },
      BarkPluginCard,
    ),
  )

  // 会话头部切换按钮（session 级，standardProps 自带 sessionId）。
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.utilities',
        id: 'bark-notify-toggle',
        order: 20,
        inject: () => ({ rpc }),
      },
      ToggleButton,
    ),
  )
}