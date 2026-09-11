/**
 * dsh-session-notice —— 回合停止监听（核心逻辑，依赖注入以便单测）。
 *
 * 权威机制（本机 dsh 0.1.5-rc.1 源码验证）：
 * - 回合结束必须以 `ctx.on('session/event')` 监听并按 `event.type === 'turn/end'`
 *   分派；`agent/turn-stopping` 只在自然收尾触发、会漏 abort/error；`ctx.on('turn/end')`
 *   永不触发；
 * - 最后文本：倒序扫 `session.snapshotEvents()` 取 `assistant/message` 的 text blocks
 *   （本机 Session 类没有 `events` getter，参考插件那处写法在本机是 undefined）。
 * @module dsh-session-notice/event-listener
 */
import { type BarkConfig, type BarkPushPayload, type PushVerdict } from './bark-service.js';
/** 与 dsh-session 的 Session 兼容的最小形状（运行时不 import DSH 包）。 */
export interface SessionLike {
    id: string;
    header?: {
        cwd?: string;
    };
    snapshotEvents(): readonly SessionEventLike[];
}
/** 与 SessionEvent 兼容的最小形状。 */
export interface SessionEventLike {
    type: string;
    seq?: number;
    data?: {
        turn?: number;
        reason?: {
            kind?: string;
            error?: {
                message?: string;
                code?: string;
                status?: number;
            };
            reason?: {
                kind?: string;
                reason?: string;
            };
        };
        message?: {
            content?: ReadonlyArray<{
                type?: string;
                text?: string;
            }>;
        };
    };
}
/** 从会话日志取最后一条助手文本（倒序扫 assistant/message 的 text blocks）。 */
export declare function lastAssistantText(session: SessionLike): string;
/** 有界去重账本：每会话:seq 一条，24h 窗口 + LRU 上限。 */
export declare function createDedupLedger(maxEntries?: number): {
    test(key: string): boolean;
};
/** 处理器依赖（全部可注入，测试不碰真实网络）。 */
export interface TurnEndHandlerDeps {
    /** 该会话是否开启「会通知」（持久化集合判定）。 */
    isEnabled(sessionId: string): boolean;
    /** 当前配置；null = 未配置（server/key 缺失），静默跳过。可结合 session.header.cwd 生成默认 group。 */
    getConfig(session: SessionLike): BarkConfig | null;
    /** 投递一条组装好的 payload；返回分类判定（conf 由闭包绑定）。 */
    deliver(payload: BarkPushPayload): Promise<PushVerdict>;
    /** 会话 Web 地址（点击通知跳回会话）。 */
    sessionUrl?(sessionId: string): string | undefined;
    /** 警告日志（脱敏后）。 */
    logger?: {
        warn(message: string): void;
    };
}
/**
 * 创建 session/event 处理器。订阅本身（ctx.on）在插件入口完成，本函数只造 handler。
 * @returns (session, event) => void，供 ctx.on('session/event', handler) 使用。
 */
export declare function createTurnEndHandler(deps: TurnEndHandlerDeps): (session: SessionLike, event: SessionEventLike) => void;
//# sourceMappingURL=event-listener.d.ts.map