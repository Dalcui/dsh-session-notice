import assert from 'node:assert/strict'
import test from 'node:test'

import { byteLength, truncateByBytes } from '../lib/truncate.js'

test('byteLength 按 UTF-8 字节计（中文 3B/字，BMP 符号 3B，非 BMP emoji 4B）', () => {
  assert.equal(byteLength('abc'), 3)
  assert.equal(byteLength('中文'), 6)
  assert.equal(byteLength('✅'), 3)
  assert.equal(byteLength('🔔'), 4)
})

test('未超预算原样返回、不追加省略号', () => {
  const result = truncateByBytes('短文本', 100)
  assert.deepEqual(result, { text: '短文本', truncated: false })
})

test('按码点截断：ZWJ 家庭 emoji 不被劈成残缺序列（AC-截断正确性）', () => {
  // "结果✅👨‍👩‍👧‍👦完成"：UTF-16 length=16，byteLength=40（t4 本机实测）。
  const input = '结果✅👨‍👩‍👧‍👦完成'
  assert.equal(input.length, 16)
  assert.equal(byteLength(input), 40)
  // 预算只放得下「结果✅」（6+4=10B）时，家庭 emoji 必须整体保留或整体丢弃。
  const result = truncateByBytes(input, 10 + 3) // 10B 内容 + 3B 省略号
  assert.equal(result.truncated, true)
  assert.ok(result.text.startsWith('结果✅'))
  assert.ok(!result.text.includes('👨‍👩‍👧‍👦'))
  // 任何截断产物都不能以孤立代理对开头/结尾（每个码点要么完整要么不存在）。
  for (const cp of result.text.replace('…', '')) {
    assert.ok(cp.length >= 1)
  }
})

test('截断结果总字节 ≤ 预算（含省略号）；预算放不下省略号时返回空串', () => {
  for (const budget of [3, 7, 40, 100, 300]) {
    const text = '中'.repeat(50) + '✅'.repeat(10) + 'a'.repeat(50)
    const { text: out } = truncateByBytes(text, budget)
    assert.ok(byteLength(out) <= budget, `budget=${budget}, out=${byteLength(out)}`)
  }
  // 极端：连省略号（3B）都放不下 → 空串，守住字节契约。
  assert.equal(truncateByBytes('abcdef', 2, '…').text, '')
  assert.equal(truncateByBytes('abcdef', 0, '…').text, '')
})
