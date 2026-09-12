/**
 * dsh-session-notice —— 浏览器半入口。
 *
 * 注册两处 UI，数据全部走 Host 自建的 loopback HTTP 路由
 * （/plugins/dsh-session-notice/*，见 Host 半 rpc.ts；不再用 connection.rpc，
 * 因为该 API 在 0.1.5-rc.1 web profile 上会因 webServer 注入时序崩溃）。
 *  1. `settings.plugin.item`（key = settings namespace 'bark-notify'）——
 *     设置-插件配置区里本插件的配置卡片（server/key/group + 三步连通测试）；
 *  2. `conversation.session.header.utilities`（id 'bark-notify-toggle'）——
 *     会话头部常驻切换按钮，绑定当前会话（standardProps 提供 sessionId）。
 * @module dsh-session-notice/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only：拉 ctx.slots 服务类型。
import type {} from '@deepseek-ai/dsh-client-ui-slots'

import { BarkPluginCard, type RpcCall } from './BarkPluginCard'
import { ToggleButton } from './ToggleButton'

/** 与 Host 侧 rpc.ts 一致的路由前缀。 */
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

  // 设置-插件配置卡片：key = settings namespace。
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: 'bark-notify',
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
