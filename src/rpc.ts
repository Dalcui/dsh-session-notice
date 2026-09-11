/**
 * dsh-session-notice —— Host 侧 loopback RPC。
 *
 * 浏览器（设置卡片 / 会话按钮）只经此通道读写 Host：
 * - `get`：返回脱敏视图（server 掩码、key 只回末 4 位），完整 key 永不过线；
 * - `set`：写 server/key/group（key 仅在提供新值时写入，空串=显式清除）；
 * - `toggle`：翻转某会话的「会通知」状态（持久化到 settings.enabledSessions）；
 * - `test`：ping → push →（失败才）register 三步连通性测试，只有 push 成功才算「已就绪」。
 *
 * 本机 dsh-client-connection@0.1.5-rc.1 的 `rpc.handle(channel, handler)` 是两参签名
 * （参考插件 dsh-notify-bark 用的第三参 {authority} 是旧版 API，本机不存在）。
 * @module dsh-session-notice/rpc
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'

import { DEFAULT_SERVER, runConnectivityTest, weakKeyCheck, type BarkConfig } from './bark-service.js'
import { maskKey, maskServer, type BarkSettings } from './settings-store.js'

/** 本插件 RPC 通道。 */
export const RPC_CHANNEL = '/bark-notify'

/** RPC 层依赖（由插件入口绑定 settings 持久化）。 */
export interface BarkRpcDeps {
  getSettings(): BarkSettings
  /** merge 写入（Host 侧；绝不整段替换，防浏览器脱敏视图清空密钥）。 */
  updateSettings(patch: { server?: string; key?: string; group?: string }): Promise<void>
  /** 翻转会话开关；返回最新状态与集合。 */
  toggleSession(sessionId: string): Promise<{ enabled: boolean; enabledSessions: string[] }>
  /** 当前工作区（默认 group 来源，可选）。 */
  workspaceCwd?(): string | undefined
}

function ok<T>(value: T): ConnectionRpcResult<T> {
  return { ok: true, value }
}

function err(message: string): ConnectionRpcResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** 注册 /bark-notify loopback RPC 通道。 */
export function registerBarkRpc(ctx: Context, deps: BarkRpcDeps): void {
  ctx.inject(['connection'], (sctx) => {
    const handler: ConnectionRpcHandler = async (endpoint, payload, _signal) => {
      try {
        switch (endpoint) {
          case 'get': {
            const settings = deps.getSettings()
            const mask = maskKey(settings.key)
            const serverVisible = maskServer(settings.server)
            return ok({
              server: serverVisible,
              serverMasked: serverVisible !== settings.server,
              keyConfigured: mask.configured,
              keyMasked: mask.masked,
              group: settings.group,
              enabledSessions: settings.enabledSessions,
            })
          }
          case 'set': {
            const patch = (payload ?? {}) as { server?: unknown; key?: unknown; group?: unknown }
            if (typeof patch !== 'object' || patch === null) return err('set: payload 必须是对象')
            const next: { server?: string; key?: string; group?: string } = {}
            if (patch.server !== undefined) {
              if (typeof patch.server !== 'string') return err('set: server 必须是字符串')
              const trimmed = patch.server.trim().replace(/\/+$/, '')
              next.server = trimmed.length > 0 ? trimmed : DEFAULT_SERVER
            }
            if (patch.key !== undefined) {
              if (typeof patch.key !== 'string') return err('set: key 必须是字符串')
              if (patch.key.trim().length === 0) {
                next.key = '' // 显式清除密钥
              } else {
                const invalid = weakKeyCheck(patch.key)
                if (invalid !== undefined) return err(`set: ${invalid}`)
                next.key = patch.key.trim()
              }
            }
            if (patch.group !== undefined) {
              if (typeof patch.group !== 'string') return err('set: group 必须是字符串')
              next.group = patch.group
            }
            if (Object.keys(next).length === 0) return ok({ saved: true, noop: true })
            await deps.updateSettings(next)
            return ok({ saved: true })
          }
          case 'toggle': {
            const body = (payload ?? {}) as { sessionId?: unknown }
            if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) return err('toggle: sessionId 缺失')
            return ok(await deps.toggleSession(body.sessionId))
          }
          case 'test': {
            const settings = deps.getSettings()
            if (settings.key.trim().length === 0) return err('尚未配置 key，请先填写并保存')
            const conf: BarkConfig = {
              server: settings.server,
              key: settings.key,
              group: settings.group,
              cwd: deps.workspaceCwd?.(),
            }
            return ok(await runConnectivityTest(conf))
          }
          default:
            return err(`unknown endpoint: ${String(endpoint)}`)
        }
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error))
      }
    }

    sctx.effect(() => {
      const dispose = sctx.connection.rpc.handle(RPC_CHANNEL, handler)
      return () => {
        void dispose()
      }
    })
  })
}
