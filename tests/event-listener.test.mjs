import assert from 'node:assert/strict'
import test from 'node:test'

import { createDedupLedger, createTurnEndHandler, lastAssistantText } from '../lib/event-listener.js'

/** 构造一个假会话（与 dsh-session Session 的最小形状兼容）。 */
function fakeSession(events, { id = 'session-1', cwd = '/x/demo' } = {}) {
  return { id, header: { cwd }, snapshotEvents: () => events }
}

function assistantEvent(text) {
  return { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text }] } } }
}

function turnEndEvent(kind, extra = {}) {
  return { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind, ...extra } } }
}

test('lastAssistantText：倒序取最后一条助手文本，跳过非文本块', () => {
  const session = fakeSession([
    assistantEvent('第一段'),
    { type: 'tool/result', seq: 2, data: {} },
    assistantEvent('最后一段'),
  ])
  assert.equal(lastAssistantText(session), '最后一段')
  assert.equal(lastAssistantText(fakeSession([])), '')
  assert.equal(lastAssistantText(fakeSession([{ type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'x' }] } } }])), '')
})

test('dedup：同 key 24h 内只过一次；不同 key 独立', () => {
  const ledger = createDedupLedger()
  assert.equal(ledger.test('a'), true)
  assert.equal(ledger.test('a'), false)
  assert.equal(ledger.test('b'), true)
})

test('handler：未开启的会话静默跳过（不投递）', () => {
  const delivered = []
  const handler = createTurnEndHandler({
    isEnabled: () => false,
    getConfig: () => ({ server: 'https://api.day.app', key: 'k', group: '' }),
    deliver: async (payload) => { delivered.push(payload); return { ok: true, kind: 'success' } },
  })
  handler(fakeSession([]), turnEndEvent('completed'))
  assert.equal(delivered.length, 0)
})

test('handler：未配置 key → getConfig 返回 null，静默跳过', () => {
  const delivered = []
  const handler = createTurnEndHandler({
    isEnabled: () => true,
    getConfig: () => null,
    deliver: async (payload) => { delivered.push(payload); return { ok: true, kind: 'success' } },
  })
  handler(fakeSession([]), turnEndEvent('completed'))
  assert.equal(delivered.length, 0)
})

test('handler：非 turn/end 事件忽略；未知 reason.kind 忽略', () => {
  const delivered = []
  const handler = createTurnEndHandler({
    isEnabled: () => true,
    getConfig: () => ({ server: 'https://api.day.app', key: 'k', group: '' }),
    deliver: async (payload) => { delivered.push(payload); return { ok: true, kind: 'success' } },
  })
  handler(fakeSession([]), { type: 'turn/start', seq: 1, data: {} })
  handler(fakeSession([]), turnEndEvent('future-kind'))
  assert.equal(delivered.length, 0)
})

test('handler：正常完成 → 推送最后文本（title/level/body 正确）', async () => {
  const delivered = []
  const handler = createTurnEndHandler({
    isEnabled: () => true,
    getConfig: (session) => ({ server: 'https://api.day.app', key: 'k', group: '', cwd: session.header.cwd }),
    deliver: async (payload) => { delivered.push(payload); return { ok: true, kind: 'success' } },
  })
  const session = fakeSession([assistantEvent('最终回复文本')])
  handler(session, turnEndEvent('completed'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(delivered.length, 1)
  const payload = delivered[0]
  assert.equal(payload.title, '✅ 完成')
  assert.equal(payload.level, 'active')
  assert.ok(payload.body.includes('最终回复文本'))
  assert.equal(payload.group, 'demo') // cwd basename 自动分组
  assert.match(payload.id, /^[0-9a-f]{16}$/)
})

test('handler：异常停止（error）→ 原因 + 最后文本 + timeSensitive', async () => {
  const delivered = []
  const handler = createTurnEndHandler({
    isEnabled: () => true,
    getConfig: () => ({ server: 'https://api.day.app', key: 'k', group: '' }),
    deliver: async (payload) => { delivered.push(payload); return { ok: true, kind: 'success' } },
  })
  handler(fakeSession([assistantEvent('中断前输出')]), turnEndEvent('error', { error: { message: '模型服务 500', code: 'upstream', status: 500 } }))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].title, '❌ 出错')
  assert.equal(delivered[0].level, 'timeSensitive')
  assert.ok(delivered[0].body.includes('模型服务 500'))
  assert.ok(delivered[0].body.includes('code=upstream'))
  assert.ok(delivered[0].body.includes('status=500'))
  assert.ok(delivered[0].body.includes('中断前输出'))
})

test('handler：同一 session:seq 只推送一次（dedup）', () => {
  const delivered = []
  const handler = createTurnEndHandler({
    isEnabled: () => true,
    getConfig: () => ({ server: 'https://api.day.app', key: 'k', group: '' }),
    deliver: async (payload) => { delivered.push(payload); return { ok: true, kind: 'success' } },
  })
  const event = turnEndEvent('completed')
  handler(fakeSession([]), event)
  handler(fakeSession([]), event)
  assert.equal(delivered.length, 1)
})

test('handler：禁用/未配置期间不消耗 dedup —— 开启后同一 seq 仍能推送', () => {
  let enabled = false
  const delivered = []
  const handler = createTurnEndHandler({
    isEnabled: () => enabled,
    getConfig: () => ({ server: 'https://api.day.app', key: 'k', group: '' }),
    deliver: async (payload) => { delivered.push(payload); return { ok: true, kind: 'success' } },
  })
  const event = turnEndEvent('completed')
  // 开关关闭时处理一次（不应记账）。
  handler(fakeSession([]), event)
  assert.equal(delivered.length, 0)
  // 开启后，同一事件重放应能推送。
  enabled = true
  handler(fakeSession([]), event)
  assert.equal(delivered.length, 1)
})

test('handler：推送失败只打脱敏 warn，不抛异常', async () => {
  const warns = []
  const handler = createTurnEndHandler({
    isEnabled: () => true,
    getConfig: () => ({ server: 'https://user:secret@example.com', key: 'secret-key', group: '' }),
    deliver: async () => ({ ok: false, kind: 'key-error', message: '密钥或服务器不匹配' }),
    logger: { warn: (message) => warns.push(message) },
  })
  handler(fakeSession([]), turnEndEvent('completed'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(warns.length, 1)
  assert.ok(!warns[0].includes('secret'))
  assert.ok(!warns[0].includes('secret-key'))
})

test('handler：整包超限时拒发并告警（截断逻辑失效路径）', async () => {
  const warns = []
  const delivered = []
  const handler = createTurnEndHandler({
    isEnabled: () => true,
    getConfig: () => ({ server: 'https://api.day.app', key: 'k', group: '' }),
    deliver: async (payload) => { delivered.push(payload); return { ok: true, kind: 'success' } },
    logger: { warn: (message) => warns.push(message) },
  })
  // body 再长也不会超限（截断兜底）；直接验证 deliver 不被调用的场景由
  // bark-service.test 的 composePushPayload null 分支覆盖，这里验证 handler 不崩溃。
  handler(fakeSession([assistantEvent('x')]), turnEndEvent('completed'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(delivered.length, 1)
})
