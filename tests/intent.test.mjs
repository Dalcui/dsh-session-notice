import assert from 'node:assert/strict'
import test from 'node:test'

import { abortedCauseText, composeBody, intentOfTurnEnd } from '../lib/intent.js'

test('completed → 正常完成意图（active）', () => {
  const intent = intentOfTurnEnd({ kind: 'completed' })
  assert.equal(intent?.title, '✅ 完成')
  assert.equal(intent?.level, 'active')
  assert.equal(intent?.headline, '')
})

test('error → 携带 LlmFailure 三要素', () => {
  const intent = intentOfTurnEnd({ kind: 'error', error: { message: '上游 500', code: 'upstream_timeout', status: 500 } })
  assert.equal(intent?.title, '❌ 出错')
  assert.equal(intent?.level, 'timeSensitive')
  assert.ok(intent?.headline.includes('上游 500'))
  assert.ok(intent?.headline.includes('code=upstream_timeout'))
  assert.ok(intent?.headline.includes('status=500'))
})

test('error 缺字段时兜底文案不抛异常', () => {
  const intent = intentOfTurnEnd({ kind: 'error', error: {} })
  assert.ok(intent?.headline.includes('任务执行出错'))
})

test('aborted → 取消原因文案（user/parent/hook/disposed）', () => {
  assert.ok(intentOfTurnEnd({ kind: 'aborted', reason: { kind: 'user' } })?.headline.includes('用户中止'))
  assert.ok(intentOfTurnEnd({ kind: 'aborted', reason: { kind: 'parent' } })?.headline.includes('父级'))
  assert.ok(intentOfTurnEnd({ kind: 'aborted', reason: { kind: 'hook', reason: '权限不足' } })?.headline.includes('权限不足'))
  assert.ok(intentOfTurnEnd({ kind: 'aborted', reason: { kind: 'disposed' } })?.headline.includes('销毁'))
  assert.equal(abortedCauseText({ kind: 'legacy' }), '会话被中止')
})

test('blocked / max-tokens / interrupted → 对应标题与 level', () => {
  assert.equal(intentOfTurnEnd({ kind: 'blocked' })?.title, '🚫 被阻塞')
  assert.equal(intentOfTurnEnd({ kind: 'max-tokens' })?.title, '⚠️ Token 上限')
  assert.equal(intentOfTurnEnd({ kind: 'interrupted' })?.title, '⏸ 中断')
  assert.equal(intentOfTurnEnd({ kind: 'blocked' })?.level, 'timeSensitive')
})

test('未知 reason.kind（插件扩展）→ null，保持沉默', () => {
  assert.equal(intentOfTurnEnd({ kind: 'future-kind' }), null)
})

test('composeBody：正常完成 = 最后文本；无文本兜底', () => {
  const completed = intentOfTurnEnd({ kind: 'completed' })
  const draft = composeBody(completed, ' 你好，任务完成  ')
  assert.equal(draft.body, '你好，任务完成')
  assert.equal(composeBody(completed, '').body, '会话轮次已结束')
})

test('composeBody：异常 = 原因 headline + 最后文本；无文本只留原因', () => {
  const error = intentOfTurnEnd({ kind: 'error', error: { message: 'boom', code: 'x' } })
  const withText = composeBody(error, '最后输出')
  assert.ok(withText.body.startsWith('停止原因：boom，code=x'))
  assert.ok(withText.body.endsWith('最后输出'))
  const noText = composeBody(error, '')
  assert.equal(noText.body, error.headline)
})

test('composeBody：totalChars 按码点计（emoji 不按 UTF-16 单元）', () => {
  const completed = intentOfTurnEnd({ kind: 'completed' })
  const text = '结果✅'
  const draft = composeBody(completed, text)
  assert.equal(draft.totalChars, 3) // 结果 + ✅ 两个码点 = 3
})
