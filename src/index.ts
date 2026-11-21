/**
 * dsh-session-notice —— Host 半入口。
 *
 * 挂载三块：
 *   1. 插件 Config（settings-store 的 volatile schema）—— dsh-settings 0.1.7
 *      契约：Loader 把 schema 挂进 profile patch，ctx.settings.describe()/update()
 *      读写，值持久化到 patch、live 生效、重启后保持；entry id = 'bark-notify'；
 *   2. session/event 监听：turn/end 六种 reason → 检查该会话开关 → 组装并推送 Bark
 *      （Host 侧发送：bark-server 无 CORS，浏览器直连自建必失败）；
 *   3. /plugins/dsh-session-notice HTTP RPC：设置页与会话按钮经此读写（密钥永不过线）。
 *
 * 0.2.0 兼容性（本机 0.2.0-rc.2 源码验证，无代码改动）：settings.describe/update
 * 契约、webServer 路由 register、session/event turn/end 六种 live reason（另有
 * forked 种子标记，运行时不发出）、客户端
 * slots 两入口（plugins.bundle.config / conversation.session.header.utilities）、
 * 浏览器半 __ModuleLoader__ 懒 CJS 加载格式全部保持；唯一破坏面是 dsh 0.2.0
 * 新增的插件 peerDependencies 版本门禁（dsh-app-boot evaluatePluginCompatibility），
 * 在 package.json peerDeps 增加 ^0.2.0-rc.1 行解决。
 *
 * 0.2.2 兼容性（本机 0.2.2-rc.1 源码 + 隔离实例真机复核，同样零代码改动）：
 * describe() 不带 redactSecrets 仍回完整值、update(ns, patch) 省略 expectedRevision
 * 仍是无 CAS 的 merge；webServer exact 路由匹配顺序仍为 exact → 最长 prefix →
 * fallback，重复 (kind, path) 仍抛；turn/end reason 与取消 cause 全集未变；
 * slots 两入口与 __ModuleLoader__ 懒 CJS 未变（dsh.client 新增的 external 字段
 * 本产物用不到，只 require react 与 react/jsx-runtime，已在基线 externals 内）。
 * 门禁比较带 includePrerelease，^0.2.0-rc.1 已覆盖 0.2.2，peerDeps 追加
 * ^0.2.2-rc.1 分支只为让 npm install 把类型包解析到 0.2.2。
 *
 * 0.1.5→0.1.7 适配要点（本机 0.1.7-rc.2 源码验证）：
 * - ctx.settings.register(ns, schema, { base, applies }) 已移除；改为导出
 *   Config（含 volatile 字段）+ ctx.settings.describe()/update(ns, patch)；
 * - volatile 字段的值经 cosmokit Volatile<T> 包装，读取需解包；
 * - webServer 仍用 ctx.inject(['webServer'], cb) 回调里注册（见 rpc.ts），
 *   不放进静态 inject。
 *
 * 浏览器半（./client 入口，esbuild 产物 lib/client.js）注册插件配置页与会话切换按钮。
 * @module dsh-session-notice
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only：拉 session/event 事件类型。
import type {} from '@deepseek-ai/dsh-session'
// Type-only：拉 ctx.settings / SettingsDescriptor 类型。
import type {} from '@deepseek-ai/dsh-settings'
// Type-only：拉 ctx.webServer merge（在 rpc.ts 的回调注入里使用）。
import type {} from '@deepseek-ai/dsh-host-webserver'

import { isVolatile } from '@deepseek-ai/cosmokit'

import { composePushPayload, sendPush } from './bark-service.js'
import { createDedupLedger, createTurnEndHandler, type SessionLike } from './event-listener.js'
import {
  approvalIntent,
  approvalPolicyOf,
  findPendingQuestion,
  pendingQuestionIntent,
  questionIntent,
  summarizeQuestions,
  type ApprovalAskedLike,
  type QuestionRequestLike,
  type SessionEventLike,
} from './intervention.js'
import type { NotificationIntent } from './intent.js'
import { registerBarkRpc } from './rpc.js'
import { barkSettingsSchema, DEFAULT_SETTINGS, SETTINGS_NAMESPACE, type BarkSettings } from './settings-store.js'

/** 稳定 cordis 插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = 'bark-notify'

/**
 * 插件 Config（dsh-settings 0.1.7 契约）：全字段 volatile —— live 可编辑、
 * 写入 profile patch、重启后保持。Loader 读取本导出生成设置表单与读写通道。
 */
export const Config = barkSettingsSchema

/**
 * 硬依赖：仅 settings（描述/更新 profile patch 中的本插件配置）。
 *
 * webServer 不放进静态 inject：真机验证过 connection.rpc.handle 会以调用者
 * fiber 访问 ctx.webServer 而抛 "without inject" 并导致 profile 崩溃循环，
 * 因此本插件改为自建 HTTP 路由，并在 ctx.inject(['webServer'], cb) 回调里注册
 * （见 rpc.ts）。settings 缺失的 profile（如 headless）本插件不激活。
 */
export const inject = ['settings'] as const

/** 解开 cosmokit 对 volatile 字段的 Volatile<T> 包装（无包装则原值返回）。 */
function unwrapVolatile<T>(value: unknown): T {
  if (isVolatile(value)) return unwrapVolatile<T>((value as { get(): unknown }).get())
  return value as T
}

/**
 * 插件入口。
 * @param ctx - 插件上下文。
 * @param config - 组合层覆盖（entry config，含 schema 默认值；volatile 字段为
 *   Volatile 包装，读取前解包）。
 */
export function apply(ctx: Context, config: Partial<BarkSettings> = {}): void {
  // 启动兜底：apply 时 Loader/entry 可能尚未进入 ACTIVE，describe 拿不到条目时用
  // 组合层解析值（解包后）；此后每次读写都以 describe 的最新值为准。
  let fallback: BarkSettings = {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(
      Object.entries(config)
        .filter(([key]) => key in DEFAULT_SETTINGS)
        .map(([key, value]) => [key, unwrapVolatile(value)]),
    ),
  }

  // describe 结果短 TTL 缓存（describe 会对整表做 schema.toJSON/stringify，热路径避免重复扫描）。
  let settingsCache: { at: number; value: BarkSettings } | null = null
  /** describe 条目短暂不可见的 TTL（ms）。 */
  const SETTINGS_CACHE_TTL = 300
  let warnedMissingDescribe = false

  /** 读取当前设置（Host 侧完整值，含 key；describe 就绪前用启动兜底）。 */
  const current = (): BarkSettings => {
    if (settingsCache !== null && Date.now() - settingsCache.at < SETTINGS_CACHE_TTL) return settingsCache.value
    let value: BarkSettings | undefined
    try {
      const descriptor = ctx.settings.describe().find((row) => row.ns === SETTINGS_NAMESPACE)
      value = descriptor !== undefined ? (descriptor.value as BarkSettings | undefined) : undefined
    } catch {
      // configEditor / Loader 未就绪（apply 早期）：回退启动兜底，绝不向上抛。
      value = undefined
    }
    if (value !== undefined) {
      settingsCache = { at: Date.now(), value }
      return value
    }
    // 激活后条目仍不可见时至少告警一次，避免用户以为配置生效了。
    if (!warnedMissingDescribe) {
      warnedMissingDescribe = true
      ctx.logger.warn('[bark-notify] settings.describe 未返回条目 ' + SETTINGS_NAMESPACE + '，暂用启动配置兜底')
    }
    return fallback
  }

  /** 写入后失效设置缓存（update 内部已同步完成 profile patch 持久化）。 */
  const invalidateSettingsCache = (): void => {
    settingsCache = null
  }

  /** merge 写入 profile patch（dsh-settings 0.1.7；不整段 replace，防清空密钥）。 */
  const persist = async (patch: Partial<Pick<BarkSettings, 'server' | 'key' | 'group' | 'enabledSessions' | 'maxBodyChars' | 'interventionNotify'>>): Promise<void> => {
    await ctx.settings.update(SETTINGS_NAMESPACE, patch)
  }

  /** 当前工作区 cwd（进程 cwd）——测试推送没有会话上下文，用它作为默认 group 来源。 */
  const workspaceCwd = (): string | undefined => {
    const cwd = process.cwd()
    return cwd.length > 0 ? cwd : undefined
  }

  /** 未配置 key 时返回 null（静默跳过）。 */
  const toConfig = (settings: BarkSettings, cwd?: string) => {
    if (settings.key.trim().length === 0) return null
    return {
      server: settings.server,
      key: settings.key,
      group: settings.group,
      cwd,
      maxBodyChars: settings.maxBodyChars,
    }
  }

  // toggle 是「读改写整数组」，进程内用 promise 链串行化，避免并发 toggle 后写覆盖先写。
  let toggleChain: Promise<unknown> = Promise.resolve()

  registerBarkRpc(ctx, {
    getSettings: current,
    updateSettings: async (patch) => {
      await persist(patch)
      invalidateSettingsCache()
    },
    workspaceCwd,
    toggleSession: (sessionId) => {
      const run = toggleChain.then(async () => {
        const settings = current()
        const has = settings.enabledSessions.includes(sessionId)
        const next = has
          ? settings.enabledSessions.filter((id) => id !== sessionId)
          : [...settings.enabledSessions, sessionId]
        await persist({ enabledSessions: next })
        invalidateSettingsCache()
        return { enabled: !has, enabledSessions: next }
      })
      toggleChain = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
  })

  /** 发送一条推送；失败只告警，绝不影响宿主流程。 */
  const deliverPayload = async (payload: Parameters<typeof sendPush>[1]): Promise<Awaited<ReturnType<typeof sendPush>>> => {
    const settings = current()
    try {
      const verdict = await sendPush(
        {
          server: settings.server,
          key: settings.key,
          group: settings.group,
          maxBodyChars: settings.maxBodyChars,
        },
        payload,
      )
      if (!verdict.ok) ctx.logger.warn(`[bark-notify] 推送未成功（${verdict.kind}）：${verdict.message}`)
      return verdict
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`[bark-notify] 推送异常：${message}`)
      return { ok: false, kind: 'network', message }
    }
  }

  /**
   * 人工介入提醒的统一出口（审批 / 提问 / timed 挂起）。
   *
   * 与「回合结束通知」的区别（有意设计）：**不受 `enabledSessions` 约束**。
   * 需要你介入时你通常已经离开屏幕，而这类提醒的全部价值就是「别漏掉」；
   * 由独立的 `interventionNotify`（默认开）统一开关。key 未配置时静默。
   */
  const pushIntervention = (sessionId: string | undefined, intent: NotificationIntent): void => {
    if (!current().interventionNotify || current().key.trim().length === 0) return
    const settings = current()
    const conf = {
      server: settings.server,
      key: settings.key,
      group: settings.group,
      cwd: workspaceCwd(),
      maxBodyChars: settings.maxBodyChars,
    }
    const body = intent.headline
    const { payload, bytes } = composePushPayload(conf, intent, body, [...body].length, {
      ...(sessionId === undefined ? {} : { sessionId }),
    })
    if (payload === null) {
      ctx.logger.warn(`[bark-notify] 人工介入提醒整包 ${bytes} 字节超过上限，已放弃`)
      return
    }
    void deliverPayload(payload)
  }

  // 三类介入提醒各有独立去重账本（每会话:id 一条，24h 窗口 + LRU）。
  const approvalDedup = createDedupLedger()
  const questionDedup = createDedupLedger()
  /** 「提问仍未回答」总账本：onChanged 与 turn/end 改写共用，保证同一问题只提醒一次。 */
  const pendingNoticeDedup = createDedupLedger()

  /**
   * 每个会话当前是否有回合在跑（turn/start 置真、turn/end 置假）。
   * 用于区分「提问超时但回合仍在继续」与「回合已结束但问题仍未回答」——
   * 前者由回合结束时的 turn/end 改写提醒，后者才是投影兜底的独立信号。
   */
  const runningTurns = new Map<string, boolean>()

  /** `approval/asked`：审批请求一经写入即提醒（之后才阻塞等批准，且无等待超时）。 */
  const handleApprovalAsked = (session: SessionLike, event: SessionEventLike): void => {
    if (event.type !== 'approval/asked') return
    if (!current().interventionNotify) return
    if (approvalPolicyOf(session.snapshotEvents() as unknown as readonly { type?: string; data?: { policy?: string } }[]) === 'never') return
    const id = event.data?.id ?? `seq:${event.seq ?? -1}`
    if (!approvalDedup.test(`${session.id}:${id}`)) return
    pushIntervention(session.id, approvalIntent(event as ApprovalAskedLike))
  }

  const turnEndHandler = createTurnEndHandler({
    isEnabled: (sessionId) => current().enabledSessions.includes(sessionId),
    getConfig: (session: SessionLike) => toConfig(current(), session.header?.cwd),
    deliver: (payload) => deliverPayload(payload),
    // 回合「正常完成」但仍有 timed 提问挂起时，改推「⏳ 等待回答」而非「✅ 完成」。
    // interventionNotify 关闭时保持旧行为（「✅ 完成」）且不消耗共享账本 ——
    // 让「统一开关」名实相符：关闭后人工介入提醒的三条通道全部停用。
    pendingQuestion: (session: SessionLike) => {
      if (!current().interventionNotify) return null
      const pending = findPendingQuestion(session.snapshotEvents() as unknown as readonly SessionEventLike[])
      // 与投影兜底共用账本：无论哪条路径先处理，同一问题只提醒一次。
      if (pending !== null) pendingNoticeDedup.test(`${session.id}:${pending.callId}`)
      return pending
    },
    logger: ctx.logger,
  })

  /** 会话事件统一分发：turn/start 记录回合状态、turn/end 结束通知、approval/asked 审批提醒。 */
  ctx.on('session/event', ((session: SessionLike, event: SessionEventLike) => {
    if (event.type === 'turn/start') {
      runningTurns.set(session.id, true)
      return
    }
    if (event.type === 'turn/end') {
      runningTurns.set(session.id, false)
      turnEndHandler(session, event)
      return
    }
    handleApprovalAsked(session, event)
  }) as (session: never, event: never) => void)

  /**
   * `user-questions/request`：模型每次调用 `ask_user_question` 必经（legacy 阻塞式
   * 与 timed 首次发问都走它），此时工具在 `execute` 内挂起等待回答、回合不结束，
   * 只靠 turn/end 永远收不到信号。
   *
   * **绝不可认领请求**：waterfall 语义是「返回值即认领」，本 listener 只旁观，
   * 无论发生什么都必须 `next()` 交还给真正的答案器；自身异常一律吞掉。
   */
  ctx.on(
    'user-questions/request' as never,
    ((request: QuestionRequestLike, next: () => Promise<unknown>): Promise<unknown> => {
      try {
        // 开关判断放在记账之前：关闭期间的介入点不消耗 dedup，
        // 重新开启后同一问题仍能提醒（与 turn/end 的既有约定一致）。
        if (current().interventionNotify) {
          const sessionId = request.agent?.session?.id
          const key = request.wait?.callId ?? summarizeQuestions((request.questions ?? []).map(item => item.question ?? ''))
          if (questionDedup.test(`${sessionId ?? 'global'}:${key}`)) {
            pushIntervention(sessionId, questionIntent(request))
          }
        }
      } catch (error: unknown) {
        ctx.logger.warn(`[bark-notify] 提问提醒失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return next()
    }) as never,
  )

  /**
   * `userQuestions` 投影：timed 提问超时后工具以 `{pending:true}` 正常结果收尾，
   * 回合照常结束。投影 `active[].state === 'continued'` 即「问题仍等你回答」；
   * 此时立刻提醒一次（每 callId 一次），补上 turn/end 之外的持续等待信号。
   *
   * 投影由 dsh-user-questions 注册；本插件只订阅变更，不重复注册定义
   * （同 key 重复注册虽会共享引用，但没必要）。服务缺席时 inject 回调不执行。
   */
  ctx.inject(['sessionProjections'], (scoped) => {
    const registry = (scoped as unknown as {
      sessionProjections?: {
        onChanged?: (listener: (session: SessionLike, key: string, value: unknown, seq: unknown) => void) => () => void
      }
    }).sessionProjections
    if (typeof registry?.onChanged !== 'function') return
    registry.onChanged((session, key, value) => {
      if (key !== 'userQuestions') return
      try {
        if (!current().interventionNotify) return
        type ActiveQuestion = { callId?: string; state?: string; questions?: readonly { question?: string; header?: string }[] }
        const view = value as { active?: readonly ActiveQuestion[] } | undefined
        if (!Array.isArray(view?.active)) return
        // 只在**回合已结束**时兜底：回合仍在跑时问题刚超时（open→continued），
        // 此刻说「回合已结束」是失真文案，且回合收尾时 turn/end 会统一改写提醒。
        // 真正属于本通道的场景是崩溃恢复后 repair 合成的 unknown-outcome 结果。
        if (runningTurns.get(session.id) === true) return
        for (const item of view.active as readonly ActiveQuestion[]) {
          if (item.state !== 'continued') continue
          const callId = item.callId ?? ''
          // 与 turn/end 改写共用账本，避免同一问题连推两条。
          if (!pendingNoticeDedup.test(`${session.id}:${callId}`)) continue
          const questions = (item.questions ?? []).map(question => question.question ?? question.header ?? '')
          pushIntervention(session.id, pendingQuestionIntent({ callId, questions }))
        }
      } catch (error: unknown) {
        // 投影驱动在 session/event 的容错边界内，但本回调不应制造任何抛点。
        ctx.logger.warn(`[bark-notify] 挂起提问提醒失败：${error instanceof Error ? error.message : String(error)}`)
      }
    })
  })
}