import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyPing, classifyPush, classifyRegister, isJsonBody, parseEnvelope } from '../lib/classify.js'

const JSON_CT = 'application/json'

test('isJsonBody：413/418 一定不是 JSON，其余按 content-type 分流', () => {
  assert.equal(isJsonBody(413, 'text/html'), false)
  assert.equal(isJsonBody(418, 'text/plain'), false)
  assert.equal(isJsonBody(400, 'application/json'), true)
  assert.equal(isJsonBody(400, ''), true) // 空 CT 兜底按 JSON 尝试
  assert.equal(isJsonBody(400, 'text/html'), false)
})

test('classifyPush：单发成功（code=200, message=success）', () => {
  const verdict = classifyPush(200, JSON_CT, '{"code":200,"message":"success","timestamp":1}')
  assert.deepEqual(verdict, { ok: true, kind: 'success' })
})

test('classifyPush：418 纯文本 → auth（不是 401）', () => {
  const verdict = classifyPush(418, 'text/plain', "I'm a teapot")
  assert.equal(verdict.ok, false)
  assert.equal(verdict.kind, 'auth')
})

test('classifyPush：413 nginx HTML → too-large（不可重试）', () => {
  const verdict = classifyPush(413, 'text/html', '<html>413 Request Entity Too Large</html>')
  assert.equal(verdict.ok, false)
  assert.equal(verdict.kind, 'too-large')
})

test('classifyPush：400 含 device token → key-error（熔断）', () => {
  const verdict = classifyPush(
    400,
    JSON_CT,
    '{"code":400,"message":"failed to get device token: failed to get [bogus] device token from database"}',
  )
  assert.equal(verdict.kind, 'key-error')
})

test('classifyPush：批量外层 200 + data[] → 判定异常（外层不可信）', () => {
  const verdict = classifyPush(200, JSON_CT, '{"code":200,"message":"success","data":[{"code":400},{"code":400}]}')
  assert.equal(verdict.ok, false)
  assert.equal(verdict.kind, 'format')
})

test('classifyPush：500 push failed → upstream', () => {
  const verdict = classifyPush(500, JSON_CT, '{"code":500,"message":"push failed: PayloadTooLarge"}')
  assert.equal(verdict.kind, 'upstream')
})

test('classifyPush：其余 4xx → format（403/429 属运维层，不归密钥错）', () => {
  const verdict = classifyPush(403, JSON_CT, '{"code":403,"message":"forbidden by gateway"}')
  assert.equal(verdict.kind, 'format')
})

test('classifyPush：非 JSON 且非 413/418 → not-json（端点被拦截）', () => {
  const verdict = classifyPush(200, 'text/html', '<html>login</html>')
  assert.equal(verdict.kind, 'not-json')
})

test('classifyPing：pong 契约（无 data 字段也不影响判定）', () => {
  const verdict = classifyPing(200, JSON_CT, '{"code":200,"message":"pong","timestamp":1789143686}')
  assert.deepEqual(verdict, { ok: true, kind: 'reachable' })
})

test('classifyPing：404 JSON 信封 → wrong-prefix（打到 bark-server 但路径错）', () => {
  const verdict = classifyPing(404, JSON_CT, '{"code":404,"message":"Cannot GET /ping"}')
  assert.equal(verdict.kind, 'wrong-prefix')
})

test('classifyPing：非 JSON → intercepted（反代/CDN/鉴权拦截）', () => {
  const verdict = classifyPing(200, 'text/html', '<html>Cloudflare Access</html>')
  assert.equal(verdict.kind, 'intercepted')
})

test('classifyPing：连接层错误 → unreachable（由网络档兜底）', () => {
  const verdict = classifyPing(502, 'text/html', '<html>Bad Gateway</html>')
  assert.equal(verdict.kind, 'unreachable')
})

test('classifyRegister：success → registered', () => {
  const verdict = classifyRegister(200, JSON_CT, '{"code":200,"message":"success"}')
  assert.deepEqual(verdict, { ok: true, kind: 'registered' })
})

test('classifyRegister：400 failed to get [key] device token from database → missing', () => {
  const verdict = classifyRegister(400, JSON_CT, '{"code":400,"message":"failed to get [abc] device token from database"}')
  assert.equal(verdict.kind, 'missing')
})

test('classifyRegister：400 device key is empty → empty-key', () => {
  const verdict = classifyRegister(400, JSON_CT, '{"code":400,"message":"device key is empty"}')
  assert.equal(verdict.kind, 'empty-key')
})

test('parseEnvelope：非法 JSON / 非对象返回 null', () => {
  assert.equal(parseEnvelope('I am a teapot'), null)
  assert.equal(parseEnvelope('42'), null)
})
