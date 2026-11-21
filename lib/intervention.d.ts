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
import type { NotificationIntent } from './intent.js';
/** `approval/asked` 事件的最小形状（dsh-user-approval 的 SessionEventMap 条目）。 */
export interface ApprovalAskedLike {
    type: string;
    seq?: number;
    data?: {
        /** 审批请求 id（与 approval/decided 配对）。 */
        id?: string;
        /** 被审批的工具名。 */
        toolName?: string;
        /** 对应工具调用（有则给出）。 */
        callId?: string;
        /** 发起方的人类可读原因（如 hook 的权限决策、sandbox 升级说明）。 */
        reason?: string;
    };
}
/** `user-questions/request` 参数的题目最小形状。 */
export interface QuestionItemLike {
    id?: string;
    question?: string;
    header?: string;
    detail?: string;
}
/** `user-questions/request` 参数的最小形状（水瀑布事件首参）。 */
export interface QuestionRequestLike {
    questions?: readonly QuestionItemLike[];
    /** 发起提问的 live agent（子代理不允许提问；可缺省）。 */
    agent?: {
        session?: {
            id?: string;
        };
    };
    /** timed 模式的前台等待信息；legacy 阻塞式为 undefined。 */
    wait?: {
        callId?: string;
        timed?: boolean;
    };
}
/** 会话事件的宽松形状（只读本模块关心的字段）。 */
export interface SessionEventLike {
    type: string;
    seq?: number;
    data?: {
        /** approval/asked 的请求 id。 */
        id?: string;
        name?: string;
        callId?: string;
        /** tool/call 里是 JSON 字符串；tool/ptc-dispatch 里已是对象。 */
        arguments?: string | Record<string, unknown>;
        /** tool/ptc-dispatch 的失败标记。 */
        isError?: boolean;
        /** tool/ptc-dispatch 的记录内容块。 */
        content?: ReadonlyArray<{
            type?: string;
            text?: string;
        }>;
        /** tool/ptc-dispatch 的子调用 id。 */
        subCallId?: string;
        message?: {
            toolCallId?: string;
            content?: ReadonlyArray<{
                type?: string;
                text?: string;
            }>;
            isError?: boolean;
        };
        source?: {
            kind?: string;
            callId?: string;
        };
        error?: {
            code?: string;
        };
    };
}
/** 一个仍未被回答的提问。 */
export interface PendingQuestion {
    /** 工具调用 id。 */
    callId: string;
    /** 题面（可能为空，取不到时退回通用文案）。 */
    questions: readonly string[];
}
/** 审批提醒意图（等待用户批准）。 */
export declare function approvalIntent(event: ApprovalAskedLike): NotificationIntent;
/** 把若干题面拼成一句可读摘要（最多 3 题，超出的以「等 N 题」收尾）。 */
export declare function summarizeQuestions(questions: readonly string[]): string;
/** 提问提醒意图（模型正在等你回答）。 */
export declare function questionIntent(request: QuestionRequestLike): NotificationIntent;
/** 回合已结束但问题仍未回答（timed 超时挂起）的意图：替代误导性的「✅ 完成」。 */
export declare function pendingQuestionIntent(pending: PendingQuestion): NotificationIntent;
/**
 * 解析调用参数里的题面（失败返回空数组，绝不上抛）。
 * `tool/call` 的 arguments 是 JSON 字符串，`tool/ptc-dispatch` 的已是对象。
 */
export declare function questionsOfArguments(input: string | Record<string, unknown> | undefined): string[];
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
export declare function approvalPolicyOf(events: readonly {
    type?: string;
    data?: {
        policy?: string;
    };
}[]): 'ask' | 'never';
/** 判断一条 tool/result 是否是 timed 提问的 `{pending:true}` 正常结果。 */
export declare function isPendingQuestionResult(content: ReadonlyArray<{
    type?: string;
    text?: string;
}> | undefined): boolean;
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
export declare function findPendingQuestion(events: readonly SessionEventLike[]): PendingQuestion | null;
//# sourceMappingURL=intervention.d.ts.map