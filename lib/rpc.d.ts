/**
 * dsh-session-notice —— Host 侧 loopback RPC。
 *
 * 浏览器（设置卡片 / 会话按钮）只经此通道读写 Host：
 * - `get`：返回脱敏视图（server 掩码、key 只回末 4 位），完整 key 永不过线；
 * - `set`：写 server/key/group（key 仅在提供新值时写入，空串=显式清除）；
 * - `toggle`：翻转某会话的「会通知」状态（持久化到 settings.enabledSessions）；
 * - `test`：ping → push →（失败才）register 三步连通性测试，只有 push 成功才算「已就绪」。
 *
 * 本机 dsh-client-connection@0.1.5-rc.1 的 `rpc.handle(channel, handler)` 是两参签名
 * （参考插件 dsh-notify-bark 用的第三参 {authority} 是旧版 API，本机不存在）。
 * @module dsh-session-notice/rpc
 */
import type { Context } from '@deepseek-ai/cordis';
import { type BarkSettings } from './settings-store.js';
/** 本插件 RPC 通道。 */
export declare const RPC_CHANNEL = "/bark-notify";
/** RPC 层依赖（由插件入口绑定 settings 持久化）。 */
export interface BarkRpcDeps {
    getSettings(): BarkSettings;
    /** merge 写入（Host 侧；绝不整段替换，防浏览器脱敏视图清空密钥）。 */
    updateSettings(patch: {
        server?: string;
        key?: string;
        group?: string;
    }): Promise<void>;
    /** 翻转会话开关；返回最新状态与集合。 */
    toggleSession(sessionId: string): Promise<{
        enabled: boolean;
        enabledSessions: string[];
    }>;
    /** 当前工作区（默认 group 来源，可选）。 */
    workspaceCwd?(): string | undefined;
}
/** 注册 /bark-notify loopback RPC 通道。 */
export declare function registerBarkRpc(ctx: Context, deps: BarkRpcDeps): void;
//# sourceMappingURL=rpc.d.ts.map