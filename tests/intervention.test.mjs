import assert from 'node:assert/strict'
import test from 'node:test'

import {
  approvalIntent,
  approvalPolicyOf,
  findPendingQuestion,
  isPendingQuestionResult,
  pendingQuestionIntent,
  questionIntent,
  questionsOfArguments,
  summarizeQuestions,
} from '../lib/intervention.js'

/** 构造一条 tool/call（ask_user_question）。 */
function toolCall(callId, questions) {
  return {
    type: 'tool/call',
    data: { name: 'ask_user_question', callId, arguments: JSON.stringify({ questions }) },
  }
}

/** 构造一条 timed 超时的 tool/result（{pending:true} 正常结果）。 */
function pendingResult(callId) {
  return {
    type: 'tool/result',
    data: { message: { toolCallId: callId, content: [{ type: 'text', text: JSON.stringify({ pending: true, callId }) }] } },
  }
}

/** 构造一条正常回答后的 tool/result。 */
function answeredResult(callId) {
  return {
    type: 'tool/result',
    data: { message: { toolCallId: callId, content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: 'q1', selected: ['A'] }] }) }] } },
  }
}

/** 构造一条用户晚回答注入的 user/message。 */
function lateReply(callId) {
  return { type: 'user/message', data: { source: { kind: 'user-question-reply', callId } } }
}

test('approvalIntent：带工具名与原因 → 等待批准（timeSensitive）', () => {
  const intent = approvalIntent({ type: 'approval/asked', data: { id: 'r1', toolName: 'bash', reason: 'escalate sandbox to workspace-write' } })
  assert.equal(intent.kind, 'approval')
  assert.equal(intent.title, '⏳ 等待批准')
  assert.equal(intent.level, 'timeSensitive')
  assert.ok(intent.headline.includes('bash'))
  assert.ok(intent.headline.includes('escalate sandbox to workspace-write'))
})

test('approvalIntent：缺工具名/原因时有兜底文案，不抛异常', () => {
  const intent = approvalIntent({ type: 'approval/asked', data: {} })
  assert.equal(intent.title, '⏳ 等待批准')
  assert.ok(intent.headline.includes('有一项操作等待你批准'))
  assert.equal(approvalIntent({ type: 'approval/asked' }).kind, 'approval')
})

test('questionIntent：拼出题面摘要与「需要你回答」标题', () => {
  const intent = questionIntent({ questions: [{ id: 'q1', question: '用哪种方案？' }] })
  assert.equal(intent.kind, 'question')
  assert.equal(intent.title, '💬 需要你回答')
  assert.equal(intent.level, 'timeSensitive')
  assert.ok(intent.headline.includes('用哪种方案？'))
})

test('summarizeQuestions：最多 3 题，超出用「等 N 题」；空题面兜底', () => {
  assert.equal(summarizeQuestions([]), '有一项提问等待你回答')
  assert.equal(summarizeQuestions(['  ', '']), '有一项提问等待你回答')
  assert.equal(summarizeQuestions(['a', 'b', 'c', 'd', 'e']), 'a / b / c 等 5 题')
  assert.equal(summarizeQuestions(['多行\n问题']), '多行 问题')
})

test('pendingQuestionIntent：回合已结束但问题未答（不再显示“完成”）', () => {
  const intent = pendingQuestionIntent({ callId: 'c1', questions: ['确认删除吗？'] })
  assert.equal(intent.kind, 'pending-question')
  assert.equal(intent.title, '⏳ 等待回答')
  assert.ok(intent.headline.includes('回合已结束'))
  assert.ok(intent.headline.includes('确认删除吗？'))
})

test('questionsOfArguments：解析题面；非法 JSON / 非数组一律安全返回空', () => {
  assert.deepEqual(questionsOfArguments(JSON.stringify({ questions: [{ question: 'A' }, { header: 'B' }] })), ['A', 'B'])
  assert.deepEqual(questionsOfArguments('not json'), [])
  assert.deepEqual(questionsOfArguments(undefined), [])
  assert.deepEqual(questionsOfArguments(JSON.stringify({ questions: 'x' })), [])
})

test('questionsOfArguments：也接受对象形式（tool/ptc-dispatch 的 arguments）', () => {
  assert.deepEqual(questionsOfArguments({ questions: [{ question: '对象题面' }] }), ['对象题面'])
  assert.deepEqual(questionsOfArguments({ questions: [] }), [])
  assert.deepEqual(questionsOfArguments({}), [])
})

test('findPendingQuestion：tool/ptc-dispatch 的挂起子调用也算待答（对齐官方投影）', () => {
  const pending = findPendingQuestion([
    {
      type: 'tool/ptc-dispatch',
      data: {
        name: 'ask_user_question',
        subCallId: 'sub-1',
        arguments: { questions: [{ question: 'PTC 要发布吗？' }] },
        content: [{ type: 'text', text: JSON.stringify({ pending: true }) }],
      },
    },
  ])
  assert.equal(pending?.callId, 'sub-1')
  assert.deepEqual(pending?.questions, ['PTC 要发布吗？'])
  // isError 或非 pending 内容不进入待答
  assert.equal(findPendingQuestion([{
    type: 'tool/ptc-dispatch',
    data: { name: 'ask_user_question', subCallId: 'sub-2', isError: true, content: [{ type: 'text', text: JSON.stringify({ pending: true }) }] },
  }]), null)
})

test('isPendingQuestionResult：只认 {pending:true} 的文本块', () => {
  assert.equal(isPendingQuestionResult([{ type: 'text', text: JSON.stringify({ pending: true }) }]), true)
  assert.equal(isPendingQuestionResult([{ type: 'text', text: JSON.stringify({ answers: [] }) }]), false)
  assert.equal(isPendingQuestionResult([{ type: 'text', text: 'plain' }]), false)
  assert.equal(isPendingQuestionResult(undefined), false)
})

test('findPendingQuestion：pending 结果未被回答 → 返回题面', () => {
  const pending = findPendingQuestion([
    toolCall('c1', [{ question: '要发布吗？' }]),
    pendingResult('c1'),
  ])
  assert.equal(pending?.callId, 'c1')
  assert.deepEqual(pending?.questions, ['要发布吗？'])
})

test('findPendingQuestion：晚回答的 user/message 会清除待答', () => {
  assert.equal(findPendingQuestion([
    toolCall('c1', [{ question: '要发布吗？' }]),
    pendingResult('c1'),
    lateReply('c1'),
  ]), null)
})

test('findPendingQuestion：正常回答结果或后到的正常结果会清除待答', () => {
  assert.equal(findPendingQuestion([
    toolCall('c1', [{ question: '要发布吗？' }]),
    pendingResult('c1'),
    answeredResult('c1'),
  ]), null)
})

test('findPendingQuestion：无 pending / 空事件 → null；多个 pending 取最后一个', () => {
  assert.equal(findPendingQuestion([]), null)
  assert.equal(findPendingQuestion([toolCall('c1', [{ question: 'A' }]), answeredResult('c1')]), null)
  const pending = findPendingQuestion([
    toolCall('c1', [{ question: 'A' }]),
    toolCall('c2', [{ question: 'B' }]),
    pendingResult('c1'),
    pendingResult('c2'),
  ])
  assert.equal(pending?.callId, 'c2')
  assert.deepEqual(pending?.questions, ['B'])
})

test('approvalPolicyOf：默认 ask；最后一次 approval/policy 覆盖优先', () => {
  assert.equal(approvalPolicyOf([]), 'ask')
  assert.equal(approvalPolicyOf([{ type: 'approval/asked', data: {} }]), 'ask')
  assert.equal(approvalPolicyOf([{ type: 'approval/policy', data: { policy: 'never' } }]), 'never')
  assert.equal(approvalPolicyOf([
    { type: 'approval/policy', data: { policy: 'never' } },
    { type: 'approval/policy', data: { policy: 'ask' } },
  ]), 'ask')
  assert.equal(approvalPolicyOf([
    { type: 'approval/policy', data: { policy: 'ask' } },
    { type: 'approval/policy', data: { policy: 'never' } },
  ]), 'never')
})

test('findPendingQuestion：崩溃恢复合成的 TOOL_OUTCOME_UNKNOWN 结果也算仍待答', () => {
  const pending = findPendingQuestion([
    toolCall('c1', [{ question: '要发布吗？' }]),
    {
      type: 'tool/result',
      data: {
        message: { toolCallId: 'c1', content: [{ type: 'text', text: 'call never finished' }] },
        error: { code: 'TOOL_OUTCOME_UNKNOWN' },
      },
    },
  ])
  assert.equal(pending?.callId, 'c1')
  assert.deepEqual(pending?.questions, ['要发布吗？'])
})

test('findPendingQuestion：arg 不可解析时仍能给出 callId（题面为空）', () => {
  const pending = findPendingQuestion([
    { type: 'tool/call', data: { name: 'ask_user_question', callId: 'c1', arguments: 'not json' } },
    pendingResult('c1'),
  ])
  assert.equal(pending?.callId, 'c1')
  assert.deepEqual(pending?.questions, [])
})
