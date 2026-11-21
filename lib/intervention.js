/**
 * dsh-session-notice —— 人工介入提醒（纯函数，零依赖，可直接单测）。
 *
 * 与「回合结束通知」（event-listener.ts，只认 turn/end）互补：有些需要人介入的
 * 时刻回合并没有结束，turn/end 永远不会发出，必须另找监听面。本模块只做
 * 「事件形状 → 通知意图」的纯映射，事件订阅在插件入口完成。
 *
 * 三个来源（均在 dsh 0.2.2 源码复核）：
 *  1. `approval/asked`（dsh-user-approval，Session 事件，log-only audit）：
 *     审批请求**发出时立即 append**，随后才 `await decide()` 阻塞等用户批准，
 *     且**无等待超时**（只能被 signal abort 或 policy=never 终止）。这是「等待
 *     批准」唯一有专属事件可监听的接缝。
 *  2. `user-questions/request`（dsh-user-questions，cordis waterfall）：
 *     每次 `ask_user_question` 必经（legacy 阻塞式与 timed 首次发问都走它）。
 *     legacy 模式下工具挂起在 execute 内等待回答，回合不结束、无 turn/end。
 *     监听者必须 `next()` 交还决策，绝不能认领请求。
 *  3. `userQuestions` 投影（sessionProjections onChanged）：timed 提问超时后
 *     工具返回 `{pending:true}` 正常结果，回合**照常结束**并写 turn/end
 *     completed —— 若不修正，会推一条误导性的「✅ 完成」。投影的
 *     `active[].state === 'continued'` 即「问题仍等你回答」。
 *
 * 去重：审批按 request id、提问按 callId，均用有界账本（见 createDedupLedger）。
 * @module dsh-session-notice/intervention
 */
/** 审批提醒意图（等待用户批准）。 */
export function approvalIntent(event) {
    const toolName = event.data?.toolName?.trim() ?? '';
    const reason = event.data?.reason?.trim() ?? '';
    const head = toolName.length > 0 ? `停止原因：等待你批准 ${toolName}` : '停止原因：有一项操作等待你批准';
    const headline = reason.length > 0 ? `${head}（${reason}）` : head;
    return { kind: 'approval', title: '⏳ 等待批准', level: 'timeSensitive', headline };
}
/** 把若干题面拼成一句可读摘要（最多 3 题，超出的以「等 N 题」收尾）。 */
export function summarizeQuestions(questions) {
    const cleaned = questions
        .map(question => question.trim().replace(/\s+/g, ' '))
        .filter(question => question.length > 0);
    if (cleaned.length === 0)
        return '有一项提问等待你回答';
    const shown = cleaned.slice(0, 3);
    const suffix = cleaned.length > shown.length ? ` 等 ${cleaned.length} 题` : '';
    return shown.join(' / ') + suffix;
}
/** 提问提醒意图（模型正在等你回答）。 */
export function questionIntent(request) {
    const questions = (request.questions ?? []).map(question => question.question ?? question.header ?? '');
    return {
        kind: 'question',
        title: '💬 需要你回答',
        level: 'timeSensitive',
        headline: `停止原因：模型提问等待你回答 —— ${summarizeQuestions(questions)}`,
    };
}
/** 回合已结束但问题仍未回答（timed 超时挂起）的意图：替代误导性的「✅ 完成」。 */
export function pendingQuestionIntent(pending) {
    return {
        kind: 'pending-question',
        title: '⏳ 等待回答',
        level: 'timeSensitive',
        headline: `回合已结束，但提问仍未回答 —— ${summarizeQuestions(pending.questions)}`,
    };
}
/**
 * 解析调用参数里的题面（失败返回空数组，绝不上抛）。
 * `tool/call` 的 arguments 是 JSON 字符串，`tool/ptc-dispatch` 的已是对象。
 */
export function questionsOfArguments(input) {
    if (input === undefined)
        return [];
    let parsed = input;
    if (typeof input === 'string') {
        if (input.length === 0)
            return [];
        try {
            parsed = JSON.parse(input);
        }
        catch {
            return [];
        }
    }
    if (typeof parsed !== 'object' || parsed === null)
        return [];
    const questions = parsed.questions;
    if (!Array.isArray(questions))
        return [];
    return questions
        .map((item) => {
        if (typeof item !== 'object' || item === null)
            return '';
        const record = item;
        return typeof record.question === 'string'
            ? record.question
            : typeof record.header === 'string' ? record.header : '';
    })
        .filter(question => question.length > 0);
}
/**
 * 会话当前生效的审批策略（读日志，默认 `'ask'`）。
 *
 * 为什么需要：`approval/asked` 在 `decide()` 判定 `policy==='never'` **之前**就已
 * 写入日志（dsh-user-approval 先 append 再 decide），而 sandbox 升级路径在
 * never 会话里也照常调用 `approval.request()`。不判策略就会在「审批已禁用」的
 * 会话里推一条根本无人等待的「⏳ 等待批准」——纯误导。
 * 会话内最后一次 `approval/policy` 覆盖优先；从未切换过时按默认 `'ask'`。
 *
 * 已知边界：profile 级 `approval.policy` 默认配成 `never` 且会话内从未切换时，
 * 日志里没有 `approval/policy` 事件 → 这里读成 `'ask'`（本机交互式 Web 的默认
 * 就是 `ask`；headless/never 部署通常也不开通知，实际影响可忽略）。
 * @param events - 会话事件（snapshotEvents() 的返回）。
 */
export function approvalPolicyOf(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type !== 'approval/policy')
            continue;
        return event.data?.policy === 'never' ? 'never' : 'ask';
    }
    return 'ask';
}
/** 判断一条 tool/result 是否是 timed 提问的 `{pending:true}` 正常结果。 */
export function isPendingQuestionResult(content) {
    const text = content?.find(block => block.type === 'text');
    if (text === undefined || typeof text.text !== 'string')
        return false;
    try {
        const parsed = JSON.parse(text.text);
        return typeof parsed === 'object' && parsed !== null && parsed.pending === true;
    }
    catch {
        return false;
    }
}
/**
 * 倒序扫会话事件，找出「最近一个仍未回答的提问」。
 *
 * 判定链（与 dsh-user-questions 投影的 fold 语义对齐，但只保留本插件需要的部分）：
 * - `tool/call`（name=ask_user_question）记录 callId → 题面；
 * - `tool/result` 的 `message.content` 是 `{pending:true}` ⇒ 该 callId 进入「待回答」；
 *   正常结果 ⇒ 移出；
 * - `user/message` 且 `source.kind === 'user-question-reply'` ⇒ 该 callId 已回答，移出。
 *
 * 只返回**最后一个**待回答项（一次回合结束时最多提醒一条），找不到返回 null。
 * 所有结构都按最小形状容错，解析失败一律跳过而非抛错。
 * @param events - 会话事件（snapshotEvents() 的返回）。
 */
export function findPendingQuestion(events) {
    const known = new Map();
    const pending = new Map();
    for (const event of events) {
        if (event.type === 'tool/call') {
            const callId = event.data?.callId;
            if (typeof callId === 'string' && event.data?.name === 'ask_user_question') {
                known.set(callId, questionsOfArguments(event.data?.arguments));
            }
            continue;
        }
        if (event.type === 'tool/result') {
            const callId = event.data?.message?.toolCallId;
            if (typeof callId !== 'string')
                continue;
            // 与 dsh-user-questions 投影一致：`{pending:true}` 是 timed 超时的正常结果；
            // 崩溃恢复 repair 为未完成调用追加的 TOOL_OUTCOME_UNKNOWN 合成结果同样
            // 视为「仍待回答」（dsh-session/src/repair.ts、projection.ts 的判定）。
            const unknownOutcome = event.data?.error?.code === 'TOOL_OUTCOME_UNKNOWN';
            if (isPendingQuestionResult(event.data?.message?.content) || unknownOutcome) {
                pending.set(callId, known.get(callId) ?? []);
            }
            else {
                pending.delete(callId);
            }
            continue;
        }
        if (event.type === 'tool/ptc-dispatch') {
            // PTC 子调用：挂起的 ask_user_question 直接以 continued 进入待答
            // （对齐 dsh-user-questions/src/projection.ts 的 tool/ptc-dispatch 分支）。
            const data = event.data;
            if (data?.name === 'ask_user_question' && data.isError !== true && isPendingQuestionResult(data.content)) {
                const subCallId = data.subCallId;
                if (typeof subCallId === 'string') {
                    const questions = questionsOfArguments(data.arguments);
                    known.set(subCallId, questions);
                    pending.set(subCallId, questions);
                }
            }
            continue;
        }
        if (event.type === 'user/message') {
            const source = event.data?.source;
            if (source?.kind === 'user-question-reply' && typeof source.callId === 'string') {
                pending.delete(source.callId);
            }
        }
    }
    let last = null;
    for (const [callId, questions] of pending)
        last = { callId, questions };
    return last;
}
//# sourceMappingURL=intervention.js.map