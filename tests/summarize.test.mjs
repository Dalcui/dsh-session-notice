import assert from 'node:assert/strict'
import test from 'node:test'

import { charLength, decorateSummary, splitParagraphs, summarizeBody } from '../lib/summarize.js'

test('splitParagraphs：按空行分段；无空行时退化按单换行', () => {
  assert.deepEqual(splitParagraphs('第一段\n\n第二段\n\n第三段'), ['第一段', '第二段', '第三段'])
  assert.deepEqual(splitParagraphs('一行\n二行\n三行'), ['一行', '二行', '三行'])
  assert.deepEqual(splitParagraphs('只有一段'), ['只有一段'])
})

test('短文本原样返回、不标注截断', () => {
  const result = summarizeBody('这是个短结论', 200)
  assert.deepEqual(result, { text: '这是个短结论', truncated: false })
})

test('空文本 / 全空白 → 空摘要', () => {
  assert.deepEqual(summarizeBody('', 200), { text: '', truncated: false })
  assert.deepEqual(summarizeBody('   \n\n  ', 200), { text: '', truncated: false })
})

test('长文本 → 首段 + 末段，且总长 ≤ limit（方案 C 核心）', () => {
  const first = '修复已完成并验证通过。'
  const middle = '中间这一大段是过程细节，'.repeat(40)
  const last = '下一步等待你确认。'
  const result = summarizeBody(`${first}\n\n${middle}\n\n${last}`, 200)
  assert.equal(result.truncated, true)
  assert.ok(charLength(result.text) <= 200, `实际 ${charLength(result.text)}`)
  assert.ok(result.text.includes(first), '应包含首段结论')
  assert.ok(result.text.includes(last), '应包含末段结论')
  assert.ok(result.text.includes('…'), '应含省略标记')
})

test('首段本身就是超长段（如粘贴日志）→ 仍不超 limit 且不劈码点', () => {
  const huge = '日志行内容'.repeat(200)
  const result = summarizeBody(`${huge}\n\n尾段结论`, 200)
  assert.ok(charLength(result.text) <= 200, `实际 ${charLength(result.text)}`)
  assert.ok(result.text.includes('尾段结论'))
})

test('代码块保护：优先取非代码段作代表，避免摘要被一整块代码吃掉', () => {
  const code = '```\n' + 'const x = 1;\n'.repeat(50) + '```'
  const text = '结论：功能正常。\n\n' + code + '\n\n收尾说明。'
  const result = summarizeBody(text, 200)
  assert.ok(result.text.includes('结论：功能正常。'), `实际摘要: ${result.text.slice(0, 60)}`)
})

test('emoji / ZWJ 不劈码点（按码点截断）', () => {
  const emojiText = '结果✅' + '👨‍👩‍👧‍👦'.repeat(60) + '完成'
  const result = summarizeBody(emojiText, 30)
  assert.ok(charLength(result.text) <= 30)
  // 每个码点完整：不能出现孤立代理对
  for (const ch of result.text) {
    assert.ok(ch.length >= 1)
  }
  assert.ok(!result.text.includes('\uFFFD'), '不应出现替换字符')
})

test('单段超长（无分隔）→ 截断且 ≤ limit', () => {
  const result = summarizeBody('中'.repeat(500), 200)
  assert.equal(result.truncated, true)
  assert.ok(charLength(result.text) <= 200)
})

test('decorateSummary：截断时缀「（共 N 字）」；未截断不缀；空文本用兜底', () => {
  assert.equal(decorateSummary({ text: '摘要', truncated: true }, 1500, '兜底'), '摘要\n（共 1500 字）')
  assert.equal(decorateSummary({ text: '全文', truncated: false }, 2, '兜底'), '全文')
  assert.equal(decorateSummary({ text: '', truncated: false }, 0, '会话轮次已结束'), '会话轮次已结束')
})

test('limit 极小（如 40）时不越界且不抛异常', () => {
  const result = summarizeBody('第一段内容\n\n最后一段内容\n\n中间还有很多', 40)
  assert.ok(charLength(result.text) <= 40, `实际 ${charLength(result.text)}`)
})
