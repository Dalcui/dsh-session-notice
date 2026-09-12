/**
 * dsh-session-notice —— Host 侧 HTTP RPC（/plugins/dsh-session-notice/*）。
 *
 * 为什么不用 `ctx.connection.rpc.handle`（真机验证）：该 API 内部会用
 * **调用者 fiber** 的 `ctx.webServer.register(...)` 挂 HTTP 路由，在 0.1.5-rc.1
 * 的 web profile 里即使声明 `inject: ['webServer']` 也会抛
 * `cannot get property "webServer" without inject`，导致整个 profile 崩溃循环。
 * 因此改用本机已验证可用的写法（同 dsh-codebuddy-cli）：
 * `ctx.inject(['webServer'], (webCtx) => webCtx.webServer.register({ kind:'exact', ... }))`
 * 自建精确路径路由，client 半直接 fetch 这些路径。
 *
 * 路由（仅 loopback 可信请求）：
 *   GET  /plugins/dsh-session-notice/state   → 脱敏设置视图（server 掩码 / key 末 4 位）
 *   POST /plugins/dsh-session-notice/set     → 写 server/key/group（key 仅新值）
 *   POST /plugins/dsh-session-notice/toggle  → 翻转某会话「会通知」状态
 *   POST /plugins/dsh-session-notice/test    → ping → push →（失败才）register 三步连通测试
 * @module dsh-session-notice/rpc
 */
import type { Context } from '@deepseek-ai/cordis';
import { type BarkSettings } from './settings-store.js';
/** 本插件路由前缀（与 client 半 fetch 的路径一致）。 */
export declare const ROUTE_PREFIX = "/plugins/dsh-session-notice";
/** RPC 层依赖（由插件入口绑定 settings 持久化）。 */
export interface BarkRpcDeps {
    getSettings(): BarkSettings;
    /** merge 写入（Host 侧；绝不整段替换，防浏览器脱敏视图清空密钥）。 */
    updateSettings(patch: {
        server?: string;
        key?: string;
        group?: string;
        maxBodyChars?: number;
    }): Promise<void>;
    /** 翻转会话开关；返回最新状态与集合。 */
    toggleSession(sessionId: string): Promise<{
        enabled: boolean;
        enabledSessions: string[];
    }>;
    /** 当前工作区（默认 group 来源，可选）。 */
    workspaceCwd?(): string | undefined;
}
/**
 * 注册四个精确路径路由。
 *
 * 关键：必须在 `ctx.inject(['webServer'], cb)` 的回调 context 里注册——
 * 直接用入口 ctx 访问 webServer 会抛 "without inject"。
 */
export declare function registerBarkRpc(ctx: Context, deps: BarkRpcDeps): void;
//# sourceMappingURL=rpc.d.ts.map