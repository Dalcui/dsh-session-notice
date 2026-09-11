/**
 * dsh-session-notice —— Bark 响应分类（纯函数，零依赖，可直接单测）。
 *
 * 分类顺序与档位来自调研 t3/t4 定稿（bark-server v2.3.5 源码 + 对官方端点的
 * 实测）。要点：
 * - 413（nginx HTML）与 418（纯文本 I'm a teapot）不是 JSON，必须先按
 *   status + content-type 分流再 JSON.parse；
 * - 批量 device_keys 外层恒 200、真结果在 data[]（本插件只用单发，仍保留判定）；
 * - 403/429 在 bark-server 源码中不存在，出现即运维层，不归为密钥错误；
 * - message 含 `device token` 是密钥错误（熔断不重试：服务端遇 APNs 410/
 *   BadDeviceToken 会删 token，此后该 key 永远 400）。
 * @module dsh-session-notice/classify
 */

/** Bark 统一信封（单发）。 */
export interface BarkEnvelope {
  code?: number
  message?: string
  data?: unknown
}

/** 推送结果判定。 */
export type PushVerdict =
  | { ok: true; kind: 'success' }
  | { ok: false; kind: 'network'; message: string }
  | { ok: false; kind: 'auth'; message: string }
  | { ok: false; kind: 'too-large'; message: string }
  | { ok: false; kind: 'not-json'; message: string }
  | { ok: false; kind: 'key-error'; message: string }
  | { ok: false; kind: 'upstream'; message: string }
  | { ok: false; kind: 'format'; message: string }

/** ping 探测判定：reachable / wrong-prefix / intercepted / unreachable。 */
export type PingVerdict =
  | { ok: true; kind: 'reachable' }
  | { ok: false; kind: 'wrong-prefix'; message: string }
  | { ok: false; kind: 'intercepted'; message: string }
  | { ok: false; kind: 'unreachable'; message: string }

/** register 探测判定：registered / missing / empty-key / other。 */
export type RegisterVerdict =
  | { ok: true; kind: 'registered' }
  | { ok: false; kind: 'missing'; message: string }
  | { ok: false; kind: 'empty-key'; message: string }
  | { ok: false; kind: 'other'; message: string }

/** 判定响应体是否可当作 JSON 解析（status 413/418 一定不是；按 content-type 兜底）。 */
export function isJsonBody(status: number, contentType: string): boolean {
  if (status === 413 || status === 418) return false
  const ct = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return ct === 'application/json' || ct === 'text/json' || ct === ''
}

/** 解析 JSON 信封；失败返回 null。 */
export function parseEnvelope(text: string): BarkEnvelope | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as BarkEnvelope
  } catch {
    return null
  }
}

/** 信封 message 是否表明密钥错误（/push 前缀 `failed to get device token: …`）。 */
export function isKeyErrorMessage(message: string | undefined): boolean {
  return message !== undefined && message.includes('device token')
}

/**
 * 分类一次 POST /push 的响应。
 * @param status - HTTP status。
 * @param contentType - Content-Type 头（可能为空）。
 * @param bodyText - 响应正文。
 */
export function classifyPush(status: number, contentType: string, bodyText: string): PushVerdict {
  if (!isJsonBody(status, contentType)) {
    if (status === 418) {
      return { ok: false, kind: 'auth', message: '推送被服务器鉴权拒绝（418）：请在 server 填写 user:pass 或检查服务端 Basic Auth' }
    }
    if (status === 413) {
      return { ok: false, kind: 'too-large', message: '请求体超过服务器上限（413）：截断逻辑失效，属插件缺陷，不可重试' }
    }
    return { ok: false, kind: 'not-json', message: `响应不是 JSON（HTTP ${status}）：打到的可能不是 bark-server（反代/CDN/鉴权拦截）` }
  }
  const envelope = parseEnvelope(bodyText)
  if (envelope === null) {
    return { ok: false, kind: 'not-json', message: '响应体无法解析为 JSON：端点不是直达的 Bark' }
  }
  // 单发成功（本插件不用批量 device_keys；若出现 data[] 仍需逐项判定，外层 200 不可信）。
  if (status === 200 && envelope.code === 200 && envelope.message === 'success' && envelope.data === undefined) {
    return { ok: true, kind: 'success' }
  }
  if (envelope.data !== undefined) {
    return { ok: false, kind: 'format', message: '响应携带 data[]（批量形态）：本插件只发单条，判定为异常响应' }
  }
  if (isKeyErrorMessage(envelope.message)) {
    return {
      ok: false,
      kind: 'key-error',
      message: '密钥或服务器不匹配（device token 查无此 key）：请检查 key 是否属于该服务器，熔断不重试',
    }
  }
  if (status >= 500) {
    return { ok: false, kind: 'upstream', message: `上游 APNs 拒绝（HTTP ${status}）：${envelope.message ?? 'push failed'}` }
  }
  return { ok: false, kind: 'format', message: `请求被拒（HTTP ${status}）：${envelope.message ?? '未知格式错误'}` }
}

/**
 * 分类一次 GET /ping 的响应（三档，别都叫「不可达」）。
 * 契约：成功 `{"code":200,"message":"pong","timestamp":<秒>}`；
 * 404 JSON 信封 ⇒ 打到了 bark-server 但缺 url-prefix；非 JSON ⇒ 被拦截。
 */
export function classifyPing(status: number, contentType: string, bodyText: string): PingVerdict {
  if (!isJsonBody(status, contentType)) {
    if (status === 200) {
      // 200 但非 JSON：几乎不可能，按被拦截处理。
      return { ok: false, kind: 'intercepted', message: '响应不是 JSON：端点被反代/CDN/鉴权拦截' }
    }
    return { ok: false, kind: 'unreachable', message: `服务器不可达（HTTP ${status}）` }
  }
  const envelope = parseEnvelope(bodyText)
  if (envelope === null) {
    return { ok: false, kind: 'intercepted', message: '响应无法解析为 JSON：端点不是直达的 Bark' }
  }
  if (status === 200 && envelope.code === 200 && envelope.message === 'pong') {
    return { ok: true, kind: 'reachable' }
  }
  if (status === 404) {
    return { ok: false, kind: 'wrong-prefix', message: '地址缺少服务器路径前缀（--url-prefix）：请求已到 bark-server 但路径不对' }
  }
  return { ok: false, kind: 'unreachable', message: `服务器不可达（HTTP ${status}）：${envelope.message ?? ''}` }
}

/**
 * 分类一次 GET /register/<key> 的响应。
 * 契约：存在 `{"code":200,"message":"success"}`；
 * 不存在 `{"code":400,"message":"failed to get [<key>] device token from database"}`；
 * 空 key `{"code":400,"message":"device key is empty"}`。
 * ⚠ 与 /push 的失败 message 前缀差一层，不能共用正则（本模块按「含 device token」判定即可）。
 */
export function classifyRegister(status: number, contentType: string, bodyText: string): RegisterVerdict {
  if (!isJsonBody(status, contentType)) {
    return { ok: false, kind: 'other', message: `注册探测响应异常（HTTP ${status}）` }
  }
  const envelope = parseEnvelope(bodyText)
  if (envelope === null) {
    return { ok: false, kind: 'other', message: '注册探测响应无法解析为 JSON' }
  }
  if (status === 200 && envelope.code === 200 && envelope.message === 'success') {
    return { ok: true, kind: 'registered' }
  }
  if (envelope.message === 'device key is empty') {
    return { ok: false, kind: 'empty-key', message: 'key 为空：请先填写 key 再测试' }
  }
  if (isKeyErrorMessage(envelope.message)) {
    return { ok: false, kind: 'missing', message: 'key 不在该服务器（未注册）' }
  }
  return { ok: false, kind: 'other', message: `注册探测失败（HTTP ${status}）：${envelope.message ?? ''}` }
}
