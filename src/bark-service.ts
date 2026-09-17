/**
 * dsh-session-notice —— Bark 发送层（Host 侧专用；传输可注入以便测试）。
 *
 * 协议定稿（t3/t4 实测）：
 * - 唯一发送路径 `POST {server}/push` + JSON，key 在 body 的 `device_key`（字段名小写）；
 * - 整包 JSON ≤ MAX_REQUEST_BYTES 字节，按码点截断；
 * - UA 固定 USER_AGENT；超时 8s；超时=结果不确定，默认不自动重试；
 * - 探测 `/ping`、`/register/<key>`（key 空禁止发请求；只拼 encodeURIComponent(key)；
 *   永不带 query/body —— 裸 /register 是写接口，会覆盖设备 token）。
 *
 * 默认传输 = `directFetch`（node:http/https + `agent: false`），**刻意不用全局
 * `globalThis.fetch`**：
 * - Node ≥ 24 在环境变量 `NODE_USE_ENV_PROXY=1` + `HTTP(S)_PROXY` 时会把全局
 *   fetch（undici）劫持到代理（实测：代理不可达时 `fetch failed`，Bark 推送全部
 *   静默失败且无任何日志）；`http.request({ agent: false })` 不读环境代理，
 *   不受其影响；
 * - 自建 Bark 服务器同样只走直连，不依赖用户的代理/网络拓扑。
 * 单测/集成仍可注入 `fetchImpl` 假件（shape 与全局 fetch 一致）。
 * @module dsh-session-notice/bark-service
 */

import { createHash } from 'node:crypto'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'

import { classifyPing, classifyPush, classifyRegister, type PingVerdict, type PushVerdict, type RegisterVerdict } from './classify.js'
import {
  BODY_BUDGET_BYTES,
  BODY_CHARS_MAX,
  BODY_CHARS_MIN,
  DEFAULT_BODY_CHARS,
  DEFAULT_SERVER,
  MAX_REQUEST_BYTES,
  TIMEOUT_MS,
  TITLE_BUDGET_BYTES,
  USER_AGENT,
  type BarkLevel,
} from './constants.js'
import { normalizeGroup } from './group.js'
import type { NotificationIntent } from './intent.js'
import { decorateSummary, summarizeBody } from './summarize.js'
import { byteLength, truncateByBytes } from './truncate.js'

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
  /** 通知正文展示上限（码点）；缺省用 DEFAULT_BODY_CHARS。 */
  maxBodyChars?: number
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

/** 3xx 中可安全跟随的状态码（含 Location 的跳转）。 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** GET 探测可跟随的最大跳数（防重定向环/恶意链，锁定在极小值）。 */
const MAX_REDIRECTS = 3

/** 判断重定向目标是否与当前请求同源（协议+主机+端口），防凭据泄漏。 */
function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/** 递归实现一次直连请求（GET 同源 3xx 仅跟随，限跳；POST 原样返回给分类层）。 */
function directRequest(
  target: URL,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
  redirects: number,
): Promise<FetchResponseLike> {
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest
  // IPv6 字面量：new URL('http://[::1]:8080/').hostname === '[::1]'（含方括号，
  // 直接透传给 options.hostname 会 ENOTFOUND），这里剥掉。
  const hostname = target.hostname.startsWith('[') ? target.hostname.slice(1, -1) : target.hostname
  const headers: Record<string, string> = { ...init.headers }
  if (init.body !== undefined && headers['content-length'] === undefined) {
    // 显式 Content-Length：避免 node:http 走 chunked，个别严格反代拒绝，
    // 且与 3900B 请求体预算的字节口径一致。
    headers['content-length'] = String(Buffer.byteLength(init.body))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const req = request(
      {
        protocol: target.protocol,
        hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: init.method,
        headers,
        // 关键：独立直连连接，不读 HTTP(S)_PROXY / NODE_USE_ENV_PROXY。
        agent: false,
        signal: init.signal,
      },
      (res: IncomingMessage) => {
        // GET 探测跟随同源 3xx（限跳）；跨源不跟随（避免 Authorization 头
        // 泄漏到异源）。POST /push 一律不自动跟随：device_key 不应被重放到
        // 其它地址，3xx 原样返回交给 classify 决策。
        if (
          init.method === 'GET'
          && res.statusCode !== undefined
          && REDIRECT_STATUSES.has(res.statusCode)
          && res.headers.location !== undefined
          && redirects < MAX_REDIRECTS
        ) {
          // 纵深防御：drain 3xx 响应体期间若 Node 在 res 上发 error，也有兜底
          // （实测 Node 这类场景走 req error，此处仅为不被 uncaughtException 击穿）。
          res.on('error', fail)
          res.resume() // 丢到已读流末端，避免 socket 挂起
          let next: URL
          try {
            next = new URL(res.headers.location, target)
          } catch {
            fail(new TypeError(`directFetch: 无效的重定向地址 ${String(res.headers.location)}`))
            return
          }
          if (isSameOrigin(target, next)) {
            void directRequest(next, init, redirects + 1).then(resolve, fail)
            return
          }
          // 跨源：降级为「原样返回 3xx」，让分类层/用户看到真实状态。
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('error', fail)
        // 响应头已到但正文未读完连接被对端中止（RST/close）：立即拒绝，
        // 不再悬挂等到 8s 超时或误报为「请求超时」。
        res.on('aborted', () => fail(new Error('directFetch: 响应被对端中止（aborted）')))
        res.on('close', () => {
          if (!settled) fail(new Error('directFetch: 响应在正文未读完时关闭'))
        })
        res.on('end', () => {
          if (settled) return
          settled = true
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: res.statusCode ?? 0,
            headers: { get: (name: string): string | null => { const value = res.headers[name.toLowerCase()]; return Array.isArray(value) ? value[0] ?? null : value ?? null } },
            text: async () => text,
          })
        })
      },
    )
    req.on('error', fail)
    if (init.body !== undefined) req.write(init.body)
    req.end()
  })
}

/**
 * 默认传输：node:http(s)/https 直连，`agent: false`。
 *
 * 为什么不用 `globalThis.fetch`（Node ≥ 24 实测）：当进程环境带
 * `NODE_USE_ENV_PROXY=1` 与 `HTTP(S)_PROXY`（如本机 launchd plist 注入
 * Clash Verge 的 127.0.0.1:7897）时，全局 fetch（undici）会被劫持到代理；
 * 代理不可达/无法完成 TLS 时返回 `fetch failed`，Bark 推送静默失败、设置页
 * 三步测试报「不可达：fetch failed」。`http.request({ agent: false })` 建立
 * 独立直连连接、不读取环境代理，行为与用户实测可用的 `curl --noproxy` 一致。
 *
 * 兼容 FetchImpl 形状：返回 { status, headers.get, text }，分类逻辑不感知传输。
 * 注意：不做 keep-alive 复用（每次新连接），推送/探测低频，开销可忽略。
 * 已知契约（与全局 fetch 的差异，均为有意设计）：
 * - 仅支持 http/https scheme（其它协议异步 reject）；
 * - GET 仅跟随**同源** 3xx（≤3 跳）；POST 不自动跟随，3xx 原样返回；
 * - 响应在正文未读完时断开会立即 reject（而非悬挂到超时）。
 * @param url - 完整请求地址（base 已由 extractBasicAuth 剔除 userinfo）。
 * @param init - 与 FetchImpl 相同的请求参数。
 */
export function directFetch(url: string | URL, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<FetchResponseLike> {
  let target: URL
  try {
    target = new URL(String(url))
  } catch {
    // 畸形 URL 以异步 reject 呈现（与 Promise 契约一致，而非同步抛错）。
    return Promise.reject(new TypeError(`directFetch: 无效的请求地址 ${String(url)}`))
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return Promise.reject(new TypeError(`directFetch: 只支持 http/https，收到 ${target.protocol}`))
  }
  return directRequest(target, init, 0)
}

/**
 * 选择默认传输：默认 directFetch（直连、免疫环境代理劫持）；
 * 极端环境（内网 Bark 必须走代理才可达）可用 `BARK_USE_FETCH=1` 显式回退全局 fetch。
 */
export function defaultFetchImpl(): FetchImpl {
  if (process.env.BARK_USE_FETCH === '1') return globalThis.fetch as unknown as FetchImpl
  return directFetch
}

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
  /** 通知正文展示上限（码点）；缺省用 DEFAULT_BODY_CHARS。 */
  maxBodyChars?: number
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
 * 组装一条推送的完整 payload 并做双层预算：
 * - title 硬截 TITLE_BUDGET_BYTES（不追加省略号）；
 * - body 按停止类型分支：
 *   · completed（正常完成）→ **展示层摘要**（方案 C：首段 + 末段，≤ maxBodyChars
 *     码点，超出缀「（共 N 字）」）—— iOS 横幅只显示约 4 行，长文全量塞进去既看不全又笨重；
 *   · 其余（异常停止）→ **不做展示层摘要**，intent.headline（错误原因）完整保留，
 *     仅把剩余协议预算让给末尾正文；
 * - body **协议层字节闸门**：上述结果仍按码点截到 BODY_BUDGET_BYTES 内（防 413/PayloadTooLarge）；
 * - group 归一化（≤40B，空则省略字段）；
 * - 整包校验 > MAX_REQUEST_BYTES 视为插件缺陷（调用方拒绝发送）。
 * @param bodyFull - 完整正文（未摘要）。
 * @param totalChars - 原文字符数（供长度提示；仅 completed 路径使用）。
 * @param opts - 折叠 id / 会话地址 / 展示上限等。
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
  let body: string
  if (intent.kind === 'completed') {
    // 正常完成：展示层摘要（首段 + 末段），未知上限时退回默认 200 字。
    const limitChars = Math.max(
      BODY_CHARS_MIN,
      Math.min(BODY_CHARS_MAX, opts.maxBodyChars ?? conf.maxBodyChars ?? DEFAULT_BODY_CHARS),
    )
    const summary = summarizeBody(bodyFull, limitChars)
    const summarized = decorateSummary(summary, totalChars, '会话轮次已结束')
    // 协议层字节闸门（双保险；摘要通常远小于预算）。
    body = truncateByBytes(summarized, BODY_BUDGET_BYTES, '…').text
  } else {
    // 异常停止：错误原因（intent.headline）完整通知，不做展示层摘要。
    // bodyFull 由 composeBody 拼成 `${headline}\n\n${text}`（无正文时仅 headline），
    // 因此这里单独保留整条 headline，只把剩余协议预算让给末尾正文：
    //  - headline ≤ 预算：headline 完整 + 正文按剩余字节截断（错误内容 100% 保留）；
    //  - headline > 预算（极端，错误串本身超 3400B）：物理上限无解，按字节硬截到预算内，
    //    仅保留错误信息头部主体（code/status 等尾随元数据可能丢失）。
    const headline = intent.headline
    if (byteLength(headline) > BODY_BUDGET_BYTES) {
      body = truncateByBytes(headline, BODY_BUDGET_BYTES, '…').text
    } else {
      const tail = bodyFull.startsWith(headline) ? bodyFull.slice(headline.length) : ''
      body = headline + truncateByBytes(tail, BODY_BUDGET_BYTES - byteLength(headline), '…').text
    }
  }
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
  const fetchImpl = opts.fetchImpl ?? defaultFetchImpl()
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
  const fetchImpl = opts.fetchImpl ?? defaultFetchImpl()
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
  const fetchImpl = opts.fetchImpl ?? defaultFetchImpl()
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
