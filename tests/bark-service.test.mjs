import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collapseId,
  composePushPayload,
  extractBasicAuth,
  probePing,
  probeRegister,
  runConnectivityTest,
  sanitizeServer,
  sendPush,
  weakKeyCheck,
  MAX_REQUEST_BYTES,
} from '../lib/bark-service.js'
import { byteLength } from '../lib/truncate.js'

/** 有状态、有序场景序列的假 Bark 服务器（t3/t4 定稿：静态响应表测不出顺序错误）。 */
function statefulFetch(scenarios) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const index = calls.length
    const scenario = scenarios[index]
    calls.push({ url: String(url), init })
    assert.ok(scenario !== undefined, `第 ${index} 次调用超出场景表`)
    if (scenario.method !== undefined) assert.equal(init.method, scenario.method)
    if (scenario.path !== undefined) assert.ok(String(url).endsWith(scenario.path), `期望 ${scenario.path}，实际 ${url}`)
    if (scenario.error !== undefined) throw scenario.error
    return {
      status: scenario.status ?? 200,
      headers: { get: (name) => (name === 'content-type' ? (scenario.contentType ?? 'application/json') : null) },
      text: async () => scenario.body ?? '{"code":200,"message":"success"}',
    }
  }
  return { fetchImpl, calls }
}

const CONF = { server: 'https://api.day.app', key: 'testkey123', group: '', cwd: '/x/demo' }

test('sanitizeServer：trim 去尾斜杠，空回退官方默认', () => {
  assert.equal(sanitizeServer(' https://x.example/bark/ '), 'https://x.example/bark')
  assert.equal(sanitizeServer(''), 'https://api.day.app')
  assert.equal(sanitizeServer(undefined), 'https://api.day.app')
})

test('collapseId：16 hex 且对输入敏感', () => {
  const a = collapseId('session-1', 3)
  const b = collapseId('session-1', 4)
  assert.match(a, /^[0-9a-f]{16}$/)
  assert.notEqual(a, b)
})

test('weakKeyCheck：空 / 含 /?# 空白 拒绝；普通 key 通过（不按 22 位强校验）', () => {
  assert.ok(weakKeyCheck('') !== undefined)
  assert.ok(weakKeyCheck('ab/cd') !== undefined)
  assert.ok(weakKeyCheck('ab cd') !== undefined)
  assert.equal(weakKeyCheck('abc123XYZ'), undefined)
})

test('composePushPayload：展示层摘要（默认 200 字）+ 协议层字节闸门 + group/id', () => {
  const intent = { kind: 'completed', title: '✅ 完成', level: 'active', headline: '' }
  const body = '第一段结论。\n\n' + '中'.repeat(5000) + '\n\n最后一段收尾。'
  const { payload, bytes } = composePushPayload(CONF, intent, body, 5000, { sessionId: 's1', turn: 2 })
  assert.ok(payload !== null)
  assert.ok(bytes <= MAX_REQUEST_BYTES, `整包 ${bytes} 超 ${MAX_REQUEST_BYTES}`)
  assert.equal(payload.device_key, 'testkey123')
  assert.equal(payload.id, collapseId('s1', 2))
  assert.ok(byteLength(payload.title) <= 80)
  // 展示层：首段 + 末段摘要 ≤ 200 字 + 长度提示
  assert.ok(payload.body.includes('第一段结论。'), '含首段')
  assert.ok(payload.body.includes('最后一段收尾。'), '含末段')
  assert.ok(payload.body.includes('共 5000 字'), '含长度提示')
  assert.ok(payload.body.length <= 200 + 20, `摘要过长: ${payload.body.length}`)
  assert.equal(payload.group, 'demo') // cwd basename
  // 不再有 copy 字段（用户拍板：不放全文）
  assert.equal('copy' in payload, false)
})

test('composePushPayload：maxBodyChars 可配置（40/1000 边界与钳制）', () => {
  const intent = { kind: 'completed', title: 't', level: 'active', headline: '' }
  const body = '中'.repeat(2000)
  const small = composePushPayload(CONF, intent, body, 2000, { maxBodyChars: 40 })
  assert.ok(small.payload.body.length <= 40 + 12, `40 档实际 ${small.payload.body.length}`)
  const large = composePushPayload(CONF, intent, body, 2000, { maxBodyChars: 1000 })
  assert.ok(large.payload.body.length <= 1000 + 12, `1000 档实际 ${large.payload.body.length}`)
  // 越界值被钳制到范围内（不抛异常）
  const clamped = composePushPayload(CONF, intent, body, 2000, { maxBodyChars: 99999 })
  assert.ok(clamped.payload.body.length <= 1000 + 12)
})

test('composePushPayload：短正文原样发送（不摘要、不缀长度）', () => {
  const intent = { kind: 'completed', title: '✅ 完成', level: 'active', headline: '' }
  const { payload } = composePushPayload(CONF, intent, '短短一句结论', 6, {})
  assert.equal(payload.body, '短短一句结论')
})

test('composePushPayload：conf.maxBodyChars 生效（会话配置随行）', () => {
  const intent = { kind: 'completed', title: 't', level: 'active', headline: '' }
  const { payload } = composePushPayload({ ...CONF, maxBodyChars: 60 }, intent, '中'.repeat(1000), 1000, {})
  assert.ok(payload.body.length <= 60 + 12, `实际 ${payload.body.length}`)
})

test('composePushPayload：group 空且无 cwd → 省略字段（禁止空串）', () => {
  const intent = { kind: 'completed', title: 't', level: 'active', headline: '' }
  const { payload } = composePushPayload({ ...CONF, group: '   ', cwd: undefined }, intent, 'x', 1, {})
  assert.equal('group' in payload, false)
})

test('composePushPayload：整包超限 → payload null（截断逻辑失效时拒发）', () => {
  const intent = { kind: 'completed', title: 't', level: 'active', headline: '' }
  // 用超长 key 撑爆整包字节预算（key 直接进 payload.device_key）。
  const huge = { ...CONF, key: 'k'.repeat(MAX_REQUEST_BYTES + 100) }
  const { payload, bytes } = composePushPayload(huge, intent, 'x', 1, {})
  assert.equal(payload, null)
  assert.ok(bytes > MAX_REQUEST_BYTES)
})

test('extractBasicAuth：userinfo 拆成 base + Authorization Basic 头（undici 拒绝含凭据 URL）', () => {
  const { base, authHeader } = extractBasicAuth('https://alice:p@ss@bark.example.com/bark/')
  assert.equal(base, 'https://bark.example.com/bark')
  assert.equal(authHeader, `Basic ${Buffer.from('alice:p@ss').toString('base64')}`)
  // 无 userinfo 原样返回、无鉴权头。
  const plain = extractBasicAuth('https://api.day.app')
  assert.equal(plain.base, 'https://api.day.app')
  assert.equal(plain.authHeader, undefined)
  // 非法 URL 回退 trim。
  assert.equal(extractBasicAuth('  https://x.example  ').base, 'https://x.example')
})

test('sendPush：含凭据的 server → fetch 收到无凭据 URL + Authorization 头', async () => {
  const { fetchImpl, calls } = statefulFetch([
    { method: 'POST', path: '/push', status: 200, body: '{"code":200,"message":"success"}' },
  ])
  const verdict = await sendPush(
    { ...CONF, server: 'https://alice:secret@bark.example.com/bark' },
    { device_key: 'k', title: 't', body: 'b' },
    { fetchImpl },
  )
  assert.equal(verdict.ok, true)
  const { url, init } = calls[0]
  assert.equal(url, 'https://bark.example.com/bark/push') // 无凭据、保留前缀
  assert.equal(init.headers.authorization, `Basic ${Buffer.from('alice:secret').toString('base64')}`)
})

test('sendPush：POST /push + JSON + device_key 小写 + 固定 UA + 超时', async () => {
  const { fetchImpl, calls } = statefulFetch([
    { method: 'POST', path: '/push', status: 200, body: '{"code":200,"message":"success"}' },
  ])
  const verdict = await sendPush(CONF, { device_key: 'k', title: 't', body: 'b' }, { fetchImpl })
  assert.equal(verdict.ok, true)
  assert.equal(calls.length, 1)
  const { init } = calls[0]
  assert.equal(init.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(init.headers['user-agent'], 'dsh-bark-notify/0.1.0')
  const body = JSON.parse(init.body)
  assert.equal(body.device_key, 'k')
  assert.ok(!('deviceKey' in body))
})

test('sendPush：网络错误 → network 档；超时(AbortError) → network 且文案含不重试', async () => {
  const { fetchImpl } = statefulFetch([{ error: new TypeError('fetch failed') }])
  const verdict = await sendPush(CONF, { device_key: 'k', title: 't', body: 'b' }, { fetchImpl })
  assert.equal(verdict.kind, 'network')

  const abort = new Error('aborted')
  abort.name = 'AbortError'
  const { fetchImpl: abortFetch } = statefulFetch([{ error: abort }])
  const verdict2 = await sendPush(CONF, { device_key: 'k', title: 't', body: 'b' }, { fetchImpl: abortFetch, timeoutMs: 50 })
  assert.equal(verdict2.kind, 'network')
  assert.ok(verdict2.message.includes('不自动重试'))
})

test('probePing：GET /ping 契约；probeRegister：GET /register/<key> 且 key 空禁发', async () => {
  const { fetchImpl, calls } = statefulFetch([
    { method: 'GET', path: '/ping', status: 200, body: '{"code":200,"message":"pong","timestamp":1}' },
    { method: 'GET', path: '/register/testkey123', status: 200, body: '{"code":200,"message":"success"}' },
  ])
  const ping = await probePing('https://api.day.app', { fetchImpl })
  assert.equal(ping.ok, true)
  const reg = await probeRegister('https://api.day.app', 'testkey123', { fetchImpl })
  assert.equal(reg.ok, true)
  assert.equal(calls.length, 2)

  // key 为空：禁止发请求（安全红线：裸 /register 是写接口）。
  const { fetchImpl: noCall, calls: emptyCalls } = statefulFetch([])
  const empty = await probeRegister('https://api.day.app', '', { fetchImpl: noCall })
  assert.equal(empty.kind, 'empty-key')
  assert.equal(emptyCalls.length, 0)
})

test('runConnectivityTest：ping→push 全绿 = 就绪（不发 register）', async () => {
  const { fetchImpl, calls } = statefulFetch([
    { method: 'GET', path: '/ping', status: 200, body: '{"code":200,"message":"pong"}' },
    { method: 'POST', path: '/push', status: 200, body: '{"code":200,"message":"success"}' },
  ])
  const result = await runConnectivityTest(CONF, { fetchImpl })
  assert.equal(result.ready, true)
  assert.deepEqual(result.steps.map((s) => s.step), ['ping', 'push'])
  assert.equal(calls.length, 2)
})

test('runConnectivityTest：ping 失败 → 不真发 push，仅补 register 诊断', async () => {
  const { fetchImpl, calls } = statefulFetch([
    { method: 'GET', path: '/ping', status: 404, body: '{"code":404,"message":"Cannot GET /ping"}' },
    { method: 'GET', path: '/register/testkey123', status: 200, body: '{"code":200,"message":"success"}' },
  ])
  const result = await runConnectivityTest(CONF, { fetchImpl })
  assert.equal(result.ready, false)
  assert.deepEqual(result.steps.map((s) => s.step), ['ping', 'register'])
  assert.equal(result.steps[0].kind, 'wrong-prefix')
  assert.equal(calls.filter((c) => c.init.method === 'POST').length, 0)
})

test('runConnectivityTest：push 失败五档之一（418 auth）→ register 诊断 + 总态不点亮', async () => {
  const { fetchImpl } = statefulFetch([
    { method: 'GET', path: '/ping', status: 200, body: '{"code":200,"message":"pong"}' },
    { method: 'POST', path: '/push', status: 418, contentType: 'text/plain', body: "I'm a teapot" },
    { method: 'GET', path: '/register/testkey123', status: 200, body: '{"code":200,"message":"success"}' },
  ])
  const result = await runConnectivityTest(CONF, { fetchImpl })
  assert.equal(result.ready, false)
  assert.equal(result.steps.find((s) => s.step === 'push').kind, 'auth')
  assert.deepEqual(result.steps.map((s) => s.step), ['ping', 'push', 'register'])
})

test('因果用例：push 500 BadDeviceToken 后 register 200→400 ⇒ token 已被服务端移除', async () => {
  const { fetchImpl, calls } = statefulFetch([
    { method: 'GET', path: '/ping', status: 200, body: '{"code":200,"message":"pong"}' },
    { method: 'POST', path: '/push', status: 500, body: '{"code":500,"message":"push failed: BadDeviceToken"}' },
    { method: 'GET', path: '/register/testkey123', status: 400, body: '{"code":400,"message":"failed to get [testkey123] device token from database"}' },
  ])
  const result = await runConnectivityTest(CONF, { fetchImpl })
  assert.equal(result.ready, false)
  assert.equal(result.steps.find((s) => s.step === 'register').kind, 'missing')
  assert.ok(result.causalHint !== undefined && result.causalHint.includes('token 已被服务器移除'), String(result.causalHint))
  assert.equal(calls.length, 3)
})

test('因果反面：push 网络失败 → 不用 register 结果决定重试（key 在不在 ≠ 这条投出去没有）', async () => {
  const { fetchImpl, calls } = statefulFetch([
    { method: 'GET', path: '/ping', status: 200, body: '{"code":200,"message":"pong"}' },
    { method: 'POST', path: '/push', error: new TypeError('ECONNRESET') },
    { method: 'GET', path: '/register/testkey123', status: 200, body: '{"code":200,"message":"success"}' },
  ])
  const result = await runConnectivityTest(CONF, { fetchImpl })
  assert.equal(result.ready, false)
  assert.equal(result.steps.find((s) => s.step === 'push').kind, 'network')
  assert.equal(result.causalHint, undefined)
  assert.equal(calls.length, 3)
})
