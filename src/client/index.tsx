/**
 * dsh-session-notice —— 浏览器半入口。
 *
 * 注册两处 UI，全部经 /bark-notify loopback RPC 与 Host 通信（密钥永不过线）：
 *   1. `settings.plugin.item`（key = settings namespace 'bark-notify'）——
 *      设置-插件配置区里本插件的配置卡片（server/key/group + 三步连通测试）；
 *   2. `conversation.session.header.utilities`（id 'bark-notify-toggle'）——
 *      会话头部常驻切换按钮，绑定当前会话（standardProps 提供 sessionId）。
 * @module dsh-session-notice/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only：拉 ctx.slots 服务类型。
import type {} from '@deepseek-ai/dsh-client-ui-slots'

import { BarkPluginCard, type RpcCall } from './BarkPluginCard'
import { ToggleButton } from './ToggleButton'

/** 与 Host 侧 rpc.ts 一致的通道名。 */
export const RPC_CHANNEL = '/bark-notify'

/** 必需服务。 */
export const inject = ['slots', 'connection'] as const

/** 浏览器插件入口。 */
export function apply(ctx: Context): void {
  const rpc: RpcCall = (endpoint, payload) =>
    (ctx as unknown as { connection: { rpc: { call(channel: string, e: string, p: unknown): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> } } }).connection.rpc.call(
      RPC_CHANNEL,
      endpoint,
      payload,
    )

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
