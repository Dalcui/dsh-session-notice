import assert from 'node:assert/strict'
import test from 'node:test'

import { fallbackFromCwd, normalizeGroup, sanitizeGroupText, shortHash } from '../lib/group.js'
import { byteLength } from '../lib/truncate.js'

test('sanitizeGroupText：trim + 剔除控制字符/换行/制表', () => {
  assert.equal(sanitizeGroupText('  my\nproject\t '), 'myproject')
  assert.equal(sanitizeGroupText('\u0000bad\u0007'), 'bad')
})

test('normalizeGroup：显式值优先；空串回退工作区 basename', () => {
  assert.equal(normalizeGroup('my-group'), 'my-group')
  assert.equal(normalizeGroup('', '/Users/ch/Documents/Project/dsh-x'), 'dsh-x')
  assert.equal(normalizeGroup('  ', '/a/b/c/'), 'c')
})

test('normalizeGroup：归一后为空 → undefined（调用方省略字段，禁止空串）', () => {
  assert.equal(normalizeGroup('   '), undefined)
  assert.equal(normalizeGroup('\n\t'), undefined)
})

test('normalizeGroup：超 40 字节截断到预算内', () => {
  const long = 'x'.repeat(100)
  const result = normalizeGroup(long)
  assert.ok(result !== undefined)
  assert.ok(byteLength(result) <= 40)
})

test('normalizeGroup：中文按 UTF-8 字节限长（40B ≈ 13 个中文字）', () => {
  const result = normalizeGroup('很长的中文分组名'.repeat(10))
  assert.ok(result !== undefined)
  assert.ok(byteLength(result) <= 40, `actual=${byteLength(result)}`)
})

test('fallbackFromCwd：无法取得 basename → undefined', () => {
  assert.equal(fallbackFromCwd(undefined), undefined)
  assert.equal(fallbackFromCwd(''), undefined)
  assert.equal(fallbackFromCwd('/'), undefined)
})

test('fallbackFromCwd：超长 basename 回退 hash 消歧形式', () => {
  const longBase = 'b'.repeat(100)
  const result = fallbackFromCwd(`/x/${longBase}`)
  assert.ok(result !== undefined)
  assert.ok(byteLength(result) <= 40)
  assert.ok(result.includes('·'))
  assert.equal(shortHash('abc').length, 6)
})

test('fallbackFromCwd：Windows 反斜杠路径', () => {
  assert.equal(fallbackFromCwd('C:\\Users\\ch\\proj'), 'proj')
})
