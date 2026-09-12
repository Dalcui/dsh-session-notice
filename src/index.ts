/**
 * dsh-session-notice —— Host 半入口。
 *
 * 挂载三块：
 *   1. `bark-notify` settings namespace（ctx.settings → 持久化、live 生效），
 *      承载 server/key/group 与「会通知」会话集合（enabledSessions，重启后保持）；
 *   2. session/event 监听：turn/end 六种 reason → 检查该会话开关 → 组装并推送 Bark
 *      （Host 侧发送：bark-server 无 CORS，浏览器直连自建必失败）；
 *   3. /bark-notify loopback RPC：设置卡片与会话按钮经此读写（密钥永不过线）。
 *
 * 注意（真机验证）：本机 0.1.5-rc.1 上回调式 `ctx.inject(['settings'], cb)`
 * 不触发（参考插件 dsh-notify-bark 的写法在本机失效），必须用静态 inject
 * 硬依赖 + 直接访问 ctx.settings / ctx.connection。
 *
 * 浏览器半（./client 入口，esbuild 产物 lib/client.js）注册设置卡片与会话切换按钮。
 * @module dsh-session-notice
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only：拉 ctx.connection merge（Host Connection 服务）。
import type {} from '@deepseek-ai/dsh-client-connection'
// Type-only：拉 session/event 事件类型。
import type {} from '@deepseek-ai/dsh-session'
// Type-only：拉 ctx.settings merge（settings 服务）。
import type {} from '@deepseek-ai/dsh-settings'

import { sendPush } from './bark-service.js'
import { createTurnEndHandler, type SessionLike } from './event-listener.js'
import { registerBarkRpc } from './rpc.js'
import { barkSettingsSchema, DEFAULT_SETTINGS, SETTINGS_NAMESPACE, type BarkSettings } from './settings-store.js'

/** 稳定 cordis 插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = 'bark-notify'

/**
 * 硬依赖：settings（持久化）与 connection（RPC）。两者在 web profile 均存在；
 * 缺失的 profile（如 headless）本插件不激活（通知功能本就不适用）。
 */
export const inject = ['settings', 'connection'] as const

/**
 * 插件入口。
 * @param ctx - 插件上下文。
 * @param config - 组合层覆盖（entry config），合并进默认值。
 */
export function apply(ctx: Context, config: Partial<BarkSettings> = {}): void {
  const base: BarkSettings = { ...DEFAULT_SETTINGS, ...config }

  const scope = ctx.settings.register(SETTINGS_NAMESPACE, barkSettingsSchema, {
    base,
    applies: 'live',
  })
  const current = (): BarkSettings => scope.get()
  const persist = (patch: object): Promise<void> => scope.update(patch)

  /** 未配置 key 时返回 null（静默跳过）。 */
  const toConfig = (settings: BarkSettings, cwd?: string) => {
    if (settings.key.trim().length === 0) return null
    return { server: settings.server, key: settings.key, group: settings.group, cwd }
  }

  registerBarkRpc(ctx, {
    getSettings: current,
    updateSettings: persist,
    toggleSession: async (sessionId) => {
      const settings = current()
      const has = settings.enabledSessions.includes(sessionId)
      const next = has
        ? settings.enabledSessions.filter((id) => id !== sessionId)
        : [...settings.enabledSessions, sessionId]
      await persist({ enabledSessions: next })
      return { enabled: !has, enabledSessions: next }
    },
  })

  const handler = createTurnEndHandler({
    isEnabled: (sessionId) => current().enabledSessions.includes(sessionId),
    getConfig: (session: SessionLike) => toConfig(current(), session.header?.cwd),
    deliver: (payload) => {
      const settings = current()
      return sendPush({ server: settings.server, key: settings.key, group: settings.group }, payload)
    },
    logger: ctx.logger,
  })
  ctx.on('session/event', handler as (session: never, event: never) => void)
}
