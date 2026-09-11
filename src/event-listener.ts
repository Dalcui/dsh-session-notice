/**
 * dsh-session-notice —— 回合停止监听（核心逻辑，依赖注入以便单测）。
 *
 * 权威机制（本机 dsh 0.1.5-rc.1 源码验证）：
 * - 回合结束必须以 `ctx.on('session/event')` 监听并按 `event.type === 'turn/end'`
 *   分派；`agent/turn-stopping` 只在自然收尾触发、会漏 abort/error；`ctx.on('turn/end')`
 *   永不触发；
 * - 最后文本：倒序扫 `session.snapshotEvents()` 取 `assistant/message` 的 text blocks
 *   （本机 Session 类没有 `events` getter，参考插件那处写法在本机是 undefined）。
 * @module dsh-session-notice/event-listener
 */

import { type BarkConfig, type BarkPushPayload, type PushVerdict, composePushPayload, MAX_REQUEST_BYTES } from './bark-service.js'
import { composeBody, intentOfTurnEnd } from './intent.js'

/** 与 dsh-session 的 Session 兼容的最小形状（运行时不 import DSH 包）。 */
export interface SessionLike {
  id: string
  header?: { cwd?: string }
  snapshotEvents(): readonly SessionEventLike[]
}

/** 与 SessionEvent 兼容的最小形状。 */
export interface SessionEventLike {
  type: string
  seq?: number
  data?: {
    turn?: number
    reason?: { kind?: string; error?: { message?: string; code?: string; status?: number }; reason?: { kind?: string; reason?: string } }
    message?: { content?: ReadonlyArray<{ type?: string; text?: string }> }
  }
}

/** 从会话日志取最后一条助手文本（倒序扫 assistant/message 的 text blocks）。 */
export function lastAssistantText(session: SessionLike): string {
  const events = session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const blocks = event.data?.message?.content
    if (!Array.isArray(blocks)) continue
    const text = blocks
      .filter((block): block is { type: 'text'; text: string } => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim()
    if (text.length > 0) return text
  }
  return ''
}

/** 有界去重账本：每会话:seq 一条，24h 窗口 + LRU 上限。 */
export function createDedupLedger(maxEntries = 500): { test(key: string): boolean } {
  const seen = new Map<string, number>()
  const windowMs = 24 * 60 * 60 * 1000
  return {
    test(key: string): boolean {
      const now = Date.now()
      const previous = seen.get(key)
      if (previous !== undefined && now - previous < windowMs) return false
      seen.set(key, now)
      if (seen.size > maxEntries) {
        const oldest = seen.keys().next().value
        if (oldest !== undefined) seen.delete(oldest)
      }
      return true
    },
  }
}

/** 处理器依赖（全部可注入，测试不碰真实网络）。 */
export interface TurnEndHandlerDeps {
  /** 该会话是否开启「会通知」（持久化集合判定）。 */
  isEnabled(sessionId: string): boolean
  /** 当前配置；null = 未配置（server/key 缺失），静默跳过。可结合 session.header.cwd 生成默认 group。 */
  getConfig(session: SessionLike): BarkConfig | null
  /** 投递一条组装好的 payload；返回分类判定（conf 由闭包绑定）。 */
  deliver(payload: BarkPushPayload): Promise<PushVerdict>
  /** 会话 Web 地址（点击通知跳回会话）。 */
  sessionUrl?(sessionId: string): string | undefined
  /** 警告日志（脱敏后）。 */
  logger?: { warn(message: string): void }
}

/**
 * 创建 session/event 处理器。订阅本身（ctx.on）在插件入口完成，本函数只造 handler。
 * @returns (session, event) => void，供 ctx.on('session/event', handler) 使用。
 */
export function createTurnEndHandler(deps: TurnEndHandlerDeps): (session: SessionLike, event: SessionEventLike) => void {
  const dedup = createDedupLedger()
  return (session, event) => {
    if (event.type !== 'turn/end') return
    if (!deps.isEnabled(session.id)) return
    const conf = deps.getConfig(session)
    if (conf === null) return
    const reason = event.data?.reason
    if (reason === undefined) return
    const intent = intentOfTurnEnd(reason)
    if (intent === null) return
    // dedup 放在所有前置检查之后：禁用/未配置期间的 seq 不消耗记账，
    // 之后再开启时同一轮次的首次处理仍能推送。
    if (!dedup.test(`${session.id}:${event.seq ?? -1}`)) return
    const lastText = lastAssistantText(session)
    const draft = composeBody(intent, lastText)
    const { payload, bytes } = composePushPayload(conf, intent, draft.body, draft.totalChars, {
      sessionId: session.id,
      // turn 缺失时省略 id（避免与 turn=0 碰撞产生错误折叠）。
      turn: typeof event.data?.turn === 'number' ? event.data.turn : undefined,
      sessionUrl: deps.sessionUrl?.(session.id),
    })
    if (payload === null) {
      deps.logger?.warn(`[bark-notify] 整包 ${bytes} 字节超过 ${MAX_REQUEST_BYTES} 上限，已放弃（截断逻辑失效？）`)
      return
    }
    void deps.deliver(payload).then((verdict) => {
      // 只打分类与文案，绝不打印 server/key（凭据与密钥不进日志）。
      if (!verdict.ok) deps.logger?.warn(`[bark-notify] 推送未成功（${verdict.kind}）：${verdict.message}`)
    })
  }
}
