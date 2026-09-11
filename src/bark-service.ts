/**
 * dsh-session-notice —— Bark 发送层（Host 侧专用；fetch 可注入以便测试）。
 *
 * 协议定稿（t3/t4 实测）：
 * - 唯一发送路径 `POST {server}/push` + JSON，key 在 body 的 `device_key`（字段名小写）；
 * - 整包 JSON ≤ MAX_REQUEST_BYTES 字节，按码点截断；
 * - UA 固定 USER_AGENT；超时 8s；超时=结果不确定，默认不自动重试；
 * - 探测 `/ping`、`/register/<key>`（key 空禁止发请求；只拼 encodeURIComponent(key)；
 *   永不带 query/body —— 裸 /register 是写接口，会覆盖设备 token）。
 * @module dsh-session-notice/bark-service
 */

import { createHash } from 'node:crypto'

import { classifyPing, classifyPush, classifyRegister, type PingVerdict, type PushVerdict, type RegisterVerdict } from './classify.js'
import { BODY_BUDGET_BYTES, DEFAULT_SERVER, MAX_REQUEST_BYTES, TIMEOUT_MS, TITLE_BUDGET_BYTES, USER_AGENT, type BarkLevel } from './constants.js'
import { normalizeGroup } from './group.js'
import type { NotificationIntent } from './intent.js'
import { bodyTail, byteLength, truncateByBytes } from './truncate.js'

/** 供发送层消费者（event-listener 等）引用的字节常量与类型。 */
export { BODY_BUDGET_BYTES, DEFAULT_SERVER, MAX_REQUEST_BYTES, TITLE_BUDGET_BYTES }
export type { PushVerdict }

/** Bark 配置（发送层视角）。 */
export interface BarkConfig {
  /** 服务器基址（如 https://api.day.app，或带 url-prefix/基本鉴权 userinfo 的自建地址）。 */
  server: string
  /** 设备密钥。 */
  key: string
  /** 设置页 group 覆盖（空串 → 按工作区 basename 自动）。 */
  group: string
  /** 工作目录（默认 group 来源）。 */
  cwd?: string
}

/** 发送层需要的 payload（全部小写字段）。 */
export interface BarkPushPayload {
  device_key: string
  title: string
  body: string
  group?: string
  level?: BarkLevel
  sound?: string
  url?: string
  id?: string
}

/** 可注入的最小 fetch 形状（Node 全局 fetch / undici / 测试假件均可满足）。 */
export interface FetchResponseLike {
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}

export type FetchImpl = (
  url: string | URL,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<FetchResponseLike>

/** 发送/探测的可注入选项。 */
export interface TransportOptions {
  fetchImpl?: FetchImpl
  timeoutMs?: number
  userAgent?: string
  /** 会话 Web 地址（url 字段，点击跳回会话）。 */
  sessionUrl?: string
  /** 会话 id（折叠 id 输入之一）。 */
  sessionId?: string
  /** 轮次号（折叠 id 输入之一）。 */
  turn?: number
}

/** 归一化服务器基址：trim、去尾斜杠、空则回退官方默认。 */
export function sanitizeServer(input: string | undefined): string {
  const trimmed = (input ?? '').trim().replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : DEFAULT_SERVER
}

/** 拆解后的服务器信息。 */
export interface ServerAuth {
  /** 去掉 userinfo 的基址（保留路径前缀）。 */
  base: string
  /** 可选 Basic 鉴权头（含 'Basic ' 前缀）；无凭据时为 undefined。 */
  authHeader?: string
}

/**
 * 拆解 server 的 userinfo → Authorization: Basic 头。
 *
 * Node undici fetch 对含凭据的 URL 直接抛 TypeError
 * （"Request cannot be constructed from a URL that includes credentials"），
 * 因此必须先把 `https://user:pass@host/prefix` 拆成 base + Authorization 头。
 * 带凭据的 URL 不写日志（本模块从不打印 server）。
 */
export function extractBasicAuth(server: string): ServerAuth {
  const trimmed = (server ?? '').trim()
  let url: URL | null = null
  try {
    url = new URL(trimmed)
  } catch {
    url = null
  }
  if (url === null) return { base: sanitizeServer(trimmed) }
  if (url.username !== '' || url.password !== '') {
    // 畸形百分号（user%ZZ）会让 decodeURIComponent 抛 URIError：回退原值，
    // 避免被 sendPush 的 catch 误报成网络错误。
    const safeDecode = (part: string): string => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    }
    const user = safeDecode(url.username)
    const pass = safeDecode(url.password)
    url.username = ''
    url.password = ''
    const base = url.toString().replace(/\/+$/, '')
    return {
      base,
      authHeader: `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`,
    }
  }
  return { base: sanitizeServer(trimmed) }
}

/** 折叠 id：sha1(sessionId|turn) 前 16 位 hex（≤64B ASCII）。 */
export function collapseId(sessionId: string, turn: number): string {
  return createHash('sha1').update(`${sessionId}|${turn}`).digest('hex').slice(0, 16)
}

/** key 弱校验（t3 定稿：非空 + 不含 / ? # 与空白，不按 22 位强校验）。 */
export function weakKeyCheck(key: string): string | undefined {
  const trimmed = key.trim()
  if (trimmed.length === 0) return 'key 不能为空'
  if (/[/?#\s]/.test(trimmed)) return 'key 不能包含 / ? # 或空白字符'
  return undefined
}

/**
 * 组装一条推送的完整 payload 并做字节预算：
 * - title 硬截 TITLE_BUDGET_BYTES（不追加省略号）；
 * - body 按码点截断到 BODY_BUDGET_BYTES，超出追加「…（共 N 字，见 DSH）」尾部（计入预算）；
 * - group 归一化（≤40B，空则省略字段）；
 * - 整包校验 > MAX_REQUEST_BYTES 视为插件缺陷（调用方拒绝发送）。
 * @returns payload 与字节数；payload 为 null 表示整包超限。
 */
export function composePushPayload(
  conf: BarkConfig,
  intent: NotificationIntent,
  bodyFull: string,
  totalChars: number,
  opts: TransportOptions = {},
): { payload: BarkPushPayload | null; bytes: number } {
  const title = truncateByBytes(intent.title, TITLE_BUDGET_BYTES, '').text
  const { tail, rest } = bodyTail(totalChars, BODY_BUDGET_BYTES)
  const body = truncateByBytes(bodyFull, rest, tail).text
  const group = normalizeGroup(conf.group, conf.cwd)
  const payload: BarkPushPayload = {
    device_key: conf.key,
    title,
    body,
    level: intent.level,
  }
  if (opts.sessionId !== undefined && opts.sessionId.length > 0 && opts.turn !== undefined) {
    payload.id = collapseId(opts.sessionId, opts.turn)
  }
  if (group !== undefined) payload.group = group
  if (opts.sessionUrl !== undefined && opts.sessionUrl.length > 0) payload.url = opts.sessionUrl
  const bytes = byteLength(JSON.stringify(payload))
  if (bytes > MAX_REQUEST_BYTES) return { payload: null, bytes }
  return { payload, bytes }
}

/** 构造一个带超时与固定 UA 的 AbortController。 */
function transport(fetchImpl: FetchImpl, timeoutMs: number, userAgent: string, authHeader?: string): {
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  headers: Record<string, string>
} {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers: Record<string, string> = { 'user-agent': userAgent, accept: 'application/json' }
  if (authHeader !== undefined) headers.authorization = authHeader
  return { controller, timer, headers }
}

/** 把异常翻译成 network 档（超时/断连/DNS 等 → 结果不确定）。 */
export function networkVerdict(error: unknown, timeoutMs: number): PushVerdict {
  const detail = error instanceof Error ? error.message : String(error)
  if (error instanceof Error && error.name === 'AbortError') {
    return { ok: false, kind: 'network', message: `请求超时（${timeoutMs}ms）：结果不确定，不自动重试` }
  }
  return { ok: false, kind: 'network', message: `网络错误：${detail}` }
}

/**
 * 发送一条 Bark 推送（唯一真发路径）。
 * @param conf - 配置。
 * @param payload - 完整 payload（由 composePushPayload 产出）。
 * @returns 分类判定（success / auth / too-large / key-error / upstream / format / network）。
 */
export async function sendPush(
  conf: BarkConfig,
  payload: BarkPushPayload,
  opts: TransportOptions = {},
): Promise<PushVerdict> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl)
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  const userAgent = opts.userAgent ?? USER_AGENT
  const { base, authHeader } = extractBasicAuth(conf.server)
  const { controller, timer, headers } = transport(fetchImpl, timeoutMs, userAgent, authHeader)
  try {
    const response = await fetchImpl(`${base}/push`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const bodyText = await response.text()
    return classifyPush(response.status, response.headers.get('content-type') ?? '', bodyText)
  } catch (error) {
    return networkVerdict(error, timeoutMs)
  } finally {
    clearTimeout(timer)
  }
}

/** GET {server}/ping 探测。 */
export async function probePing(server: string, opts: TransportOptions = {}): Promise<PingVerdict> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl)
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  const userAgent = opts.userAgent ?? USER_AGENT
  const { base, authHeader } = extractBasicAuth(server)
  const { controller, timer, headers } = transport(fetchImpl, timeoutMs, userAgent, authHeader)
  try {
    const response = await fetchImpl(`${base}/ping`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    const bodyText = await response.text()
    return classifyPing(response.status, response.headers.get('content-type') ?? '', bodyText)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, kind: 'unreachable', message: `不可达：${detail}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * GET {server}/register/<key> 探测（不产生推送）。
 * 安全红线：key 为空禁止发请求；只拼 /register/${encodeURIComponent(key)}；永不带 query/body。
 */
export async function probeRegister(server: string, key: string, opts: TransportOptions = {}): Promise<RegisterVerdict> {
  const invalid = weakKeyCheck(key)
  if (invalid !== undefined) {
    return { ok: false, kind: 'empty-key', message: invalid }
  }
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl)
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  const userAgent = opts.userAgent ?? USER_AGENT
  const { base, authHeader } = extractBasicAuth(server)
  const { controller, timer, headers } = transport(fetchImpl, timeoutMs, userAgent, authHeader)
  try {
    const response = await fetchImpl(`${base}/register/${encodeURIComponent(key)}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    const bodyText = await response.text()
    return classifyRegister(response.status, response.headers.get('content-type') ?? '', bodyText)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, kind: 'other', message: `注册探测失败：${detail}` }
  } finally {
    clearTimeout(timer)
  }
}

/** 连通性测试的单步结果（设置页三步状态）。 */
export interface TestStep {
  /** 步骤名。 */
  step: 'ping' | 'push' | 'register'
  ok: boolean
  /** 判定档位（reachable / success / registered / auth / key-error …）。 */
  kind: string
  /** 人话文案。 */
  message: string
}

/** 连通性测试总结果。 */
export interface ConnectivityTestResult {
  steps: TestStep[]
  /** 「配置已就绪」只能由 push 成功点亮。 */
  ready: boolean
  /** push 失败(upstream)后 register 由 200→400 的因果提示（token 已被服务端移除）。 */
  causalHint?: string
}

/**
 * 三步连通性测试（顺序定稿）：
 *   probe-endpoint(GET /ping) → send(POST /push，唯一「就绪」信号) → 仅失败时 diagnose(GET /register/<key>)。
 * 只有「发送测试推送」按钮调用此函数（保存/启动自检/CI 只跑 ping+register，绝不真发）。
 */
export async function runConnectivityTest(conf: BarkConfig, opts: TransportOptions = {}): Promise<ConnectivityTestResult> {
  const steps: TestStep[] = []
  const ping = await probePing(conf.server, opts)
  steps.push({ step: 'ping', ok: ping.ok, kind: ping.kind, message: ping.ok ? '服务器可达（pong）' : ping.message })
  if (!ping.ok) {
    // ping 失败即短路到诊断（有意设计）：ping 都到不了（不可达/前缀错/被拦截），
    // push 必然失败且可能产生无谓请求（如 wrong-prefix 时打到错误路径计入 4xx）。
    // 注意：带 Basic Auth 的自建上 /ping 免鉴权（strings.HasPrefix 无边界），
    // 前一步绿不代表推送能成 —— 总态只能由 push 点亮。
    const register = await probeRegister(conf.server, conf.key, opts)
    steps.push({
      step: 'register',
      ok: register.ok,
      kind: register.kind,
      message: register.ok ? 'key 已注册' : register.message,
    })
    return { steps, ready: false }
  }

  const testPayload: BarkPushPayload = {
    device_key: conf.key,
    title: '✅ Bark 已连通',
    body: '这是一条来自 DSH 的测试推送，请在手机上确认收到。',
    level: 'active',
  }
  const group = normalizeGroup(conf.group, conf.cwd)
  if (group !== undefined) testPayload.group = group

  const push = await sendPush(conf, testPayload, opts)
  steps.push({
    step: 'push',
    ok: push.ok,
    kind: push.kind,
    message: push.ok ? '测试推送已发送，请在手机上确认' : push.message,
  })

  if (push.ok) return { steps, ready: true }

  // 仅失败时诊断；418 也能干净分离「凭据问题」与「密钥问题」（/register 免鉴权）。
  const register = await probeRegister(conf.server, conf.key, opts)
  const step: TestStep = {
    step: 'register',
    ok: register.ok,
    kind: register.kind,
    message: register.ok ? 'key 已注册（推送失败与密钥无关）' : register.message,
  }
  steps.push(step)

  // 因果：push 500（upstream）后 register 显示 missing ⇒ 服务端已删该 key 的 device token。
  let causalHint: string | undefined
  if (push.kind === 'upstream' && register.kind === 'missing') {
    causalHint = '设备 token 已被服务器移除（APNs BadDeviceToken）：请在手机上重新打开 Bark 或重置 key'
  }
  return { steps, ready: false, causalHint }
}
