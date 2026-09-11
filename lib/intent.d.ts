/**
 * dsh-session-notice —— 回合停止意图映射（纯函数，零依赖，可直接单测）。
 *
 * 输入是与 dsh-session 的 TurnEndReasonMap 结构兼容的最小形状（不 import DSH
 * 包，测试环境无 node_modules 也能跑）。六种 reason 全部区分：
 * completed / aborted / blocked / error / max-tokens / interrupted。
 * @module dsh-session-notice/intent
 */
import type { BarkLevel } from './constants.js';
/** 六种官方回合停止 reason.kind（dsh-session/lib/types 全集）。 */
export type TurnEndKind = 'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens' | 'interrupted';
/** 与 TurnEndReasonMap 兼容的最小结构（运行时只读这些字段）。 */
export interface TurnEndReasonLike {
    kind?: string;
    /** kind === 'error'：LlmFailure { message, code, status? }。 */
    error?: {
        message?: string;
        code?: string;
        status?: number;
    };
    /** kind === 'aborted'：TurnEndCancelCause { kind, reason? }。 */
    reason?: {
        kind?: string;
        reason?: string;
    };
}
/** 一次已决定的推送意图。 */
export interface NotificationIntent {
    /** 停止类型。 */
    kind: TurnEndKind;
    /** title：纯状态短语（≤80 字节，不放项目名）。 */
    title: string;
    /** Bark level（服务端零校验，必须枚举化）。 */
    level: BarkLevel;
    /** body 首行：停止原因摘要（异常时），正常完成时为空串。 */
    headline: string;
}
/** 取消原因（aborted.reason）→ 人类可读文案。 */
export declare function abortedCauseText(cause?: {
    kind?: string;
    reason?: string;
}): string;
/**
 * 把一个 turn/end 的 reason 映射为通知意图。
 * @param reason - TurnEndReasonLike（event.data.reason）。
 * @returns 意图；kind 不是六种官方值时返回 null（插件扩展的 reason 保持沉默）。
 */
export declare function intentOfTurnEnd(reason: TurnEndReasonLike): NotificationIntent | null;
/** 组装未截断的 body。 */
export interface BodyDraft {
    /** 完整（未截断）正文。 */
    body: string;
    /** 原文总码点数（供尾部提示展示）。 */
    totalChars: number;
}
/**
 * 组装 body：正常完成 → 最后一条文本消息；异常停止 → 原因 headline + 最后文本。
 * 字节截断由发送层统一执行（BODY_BUDGET_BYTES）。
 * @param intent - 意图。
 * @param lastText - 会话最后一条助手文本消息（可为空）。
 */
export declare function composeBody(intent: NotificationIntent, lastText: string): BodyDraft;
//# sourceMappingURL=intent.d.ts.map