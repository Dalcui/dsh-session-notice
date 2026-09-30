/**
 * dsh-session-notice —— 回合停止意图映射（纯函数，零依赖，可直接单测）。
 *
 * 输入是与 dsh-session 的 TurnEndReasonMap 结构兼容的最小形状（不 import DSH
 * 包，测试环境无 node_modules 也能跑）。六种 reason 全部区分：
 * completed / aborted / blocked / error / max-tokens / interrupted。
 * 例外：**用户主动中止链**（aborted 且 cause 为 user/parent/disposed，含 cause
 * 缺失的历史事件）返回 null 保持沉默 —— 停止是用户自己按的，通知只会打扰；
 * 主会话被停时其 subagent 收到的是 parent 级联中止，同样静默（防一次点击多条
 * 轰炸）。dsh 0.2.0 的 cancel cause 联合类型收敛为 user/parent/disposed/hook
 * （0.1.x 的 legacy 在 0.2.0 已不存在；仍保留识别以防旧日志回放）。
 * @module dsh-session-notice/intent
 */

import type { BarkLevel } from './constants.js'

/** 六种官方回合停止 reason.kind（dsh-session/lib/types 全集）。 */
export type TurnEndKind = 'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens' | 'interrupted'

/** 与 TurnEndReasonMap 兼容的最小结构（运行时只读这些字段）。 */
export interface TurnEndReasonLike {
  kind?: string
  /** kind === 'error'：LlmFailure { message, code, status? }。 */
  error?: { message?: string; code?: string; status?: number }
  /** kind === 'aborted'：TurnEndCancelCause { kind, reason? }。 */
  reason?: { kind?: string; reason?: string }
}

/** 一次已决定的推送意图。 */
export interface NotificationIntent {
  /** 停止类型。 */
  kind: TurnEndKind
  /** title：纯状态短语（≤80 字节，不放项目名）。 */
  title: string
  /** Bark level（服务端零校验，必须枚举化）。 */
  level: BarkLevel
  /** body 首行：停止原因（异常时，完整保留不做摘要截断），正常完成时为空串。 */
  headline: string
}

/** kind → 展示元数据。 */
const META: Record<TurnEndKind, { title: string; level: BarkLevel }> = {
  completed: { title: '✅ 完成', level: 'active' },
  error: { title: '❌ 出错', level: 'timeSensitive' },
  aborted: { title: '⏹ 已中止', level: 'passive' }, // 仅 hook 中止仍推送（自动化策略终止，有信息量）
  blocked: { title: '🚫 被阻塞', level: 'timeSensitive' },
  'max-tokens': { title: '⚠️ Token 上限', level: 'timeSensitive' },
  interrupted: { title: '⏸ 中断', level: 'timeSensitive' },
}

/** 取消原因（aborted.reason）→ 人类可读文案（用户主动中止链在 intentOfTurnEnd 已被过滤；此处保留 hook 等兜底文案）。 */
export function abortedCauseText(cause?: { kind?: string; reason?: string }): string {
  if (cause === undefined) return '用户中止了会话'
  switch (cause.kind) {
    case 'user':
      return '用户中止了会话'
    case 'parent':
      return '被父级会话中止'
    case 'hook':
      return cause.reason !== undefined && cause.reason.length > 0 ? `被钩子中止：${cause.reason}` : '被钩子中止'
    case 'disposed':
      return '会话已销毁'
    default:
      return '会话被中止'
  }
}

/**
 * 把一个 turn/end 的 reason 映射为通知意图。
 * @param reason - TurnEndReasonLike（event.data.reason）。
 * @returns 意图；kind 不是六种官方值、或 aborted 属用户主动中止链时返回 null（保持沉默）。
 */
export function intentOfTurnEnd(reason: TurnEndReasonLike): NotificationIntent | null {
  const kind = reason.kind as TurnEndKind | undefined
  const meta = kind === undefined ? undefined : META[kind]
  if (meta === undefined) return null
  // 用户主动中止链 → 沉默：user 是自己按的停止；parent 是其级联到 subagent 的
  // 同一意图；disposed 是会话销毁；cause 缺失（旧版本不记 cause）语义等同用户
  // 停止。aborted 仅 hook（自动化策略终止，附 reason 文案，有信息量）、legacy
  // （0.1.x 历史标记，0.2.0 已移除、仅旧日志回放可能出现）与未知扩展 kind 保留推送。
  if (kind === 'aborted') {
    const cause = reason.reason?.kind
    if (cause === undefined || cause === 'user' || cause === 'parent' || cause === 'disposed' || cause === 'legacy') return null
  }
  let headline = ''
  if (kind === 'error') {
    const failure = reason.error
    const message = failure?.message !== undefined && failure.message.length > 0
      ? failure.message
      : '任务执行出错'
    const parts = [message]
    if (failure?.code !== undefined && failure.code.length > 0) parts.push(`code=${failure.code}`)
    if (failure?.status !== undefined) parts.push(`status=${failure.status}`)
    headline = `停止原因：${parts.join('，')}`
  } else if (kind === 'aborted') {
    headline = `停止原因：${abortedCauseText(reason.reason)}`
  } else if (kind === 'blocked') {
    headline = '停止原因：会话被阻塞（等待无法独自完成的条件）'
  } else if (kind === 'max-tokens') {
    headline = '停止原因：某一步骤达到输出 Token 上限'
  } else if (kind === 'interrupted') {
    headline = '停止原因：回合被异常中断（崩溃或重载后关闭）'
  }
  // meta 存在 ⇒ kind 必为六种官方值之一。
  return { kind: kind as TurnEndKind, title: meta.title, level: meta.level, headline }
}

/** 组装未截断的 body。 */
export interface BodyDraft {
  /** 完整（未截断）正文。 */
  body: string
  /** 原文总码点数（供尾部提示展示）。 */
  totalChars: number
}

/**
 * 组装 body：正常完成 → 最后一条文本消息；异常停止 → 原因 headline + 最后文本。
 * 字节截断由发送层统一执行（BODY_BUDGET_BYTES）。
 * @param intent - 意图。
 * @param lastText - 会话最后一条助手文本消息（可为空）。
 */
export function composeBody(intent: NotificationIntent, lastText: string): BodyDraft {
  const text = lastText.trim()
  if (intent.kind === 'completed') {
    if (text.length === 0) return { body: '会话轮次已结束', totalChars: 7 }
    return { body: text, totalChars: [...text].length }
  }
  if (text.length === 0) return { body: intent.headline, totalChars: [...intent.headline].length }
  const body = `${intent.headline}\n\n${text}`
  return { body, totalChars: [...body].length }
}